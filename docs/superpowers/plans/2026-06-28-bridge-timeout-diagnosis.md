# Bridge 超时分层诊断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `game-bridge.ts` 的 Bridge 错误返回区分「连不上(`BRIDGE_NOT_CONNECTED`)」「连上但卡住(`BRIDGE_TIMEOUT`)」「其他故障(`BRIDGE_ERROR`)」三类，使 agent 能精准自愈。

**Architecture:** 新增 `BridgeNotConnectedError` / `BridgeTimeoutError` 两个 Error 子类，`_doConnect`/`sendToBridge` 的 12 个 reject/throw 点按归类表抛对应子类（ECONNREFUSED 在 `_doConnect:195` 按 `err.code` 源头分流），外层 `handleTool` catch 按 `instanceof` 转成三元 error_code + suggestion。

**Tech Stack:** TypeScript, vitest, Node `net` 模块。

## Global Constraints

- 单文件改造：`src/tools/game-bridge.ts` + `test/game-bridge.test.ts`
- TDD：每 task 先写红测试 → 实现 → 绿 → commit
- 局部 `const ERROR_CODES`（与 `recording.ts:11` / `audio-ops` 项目模式一致）
- `game-bridge.test.ts` 已为规避 vitest Linux mock 失效合并（`:1-9`），新测试**同文件同 mock 模式**（`vi.hoisted` + `vi.mock('net')`）
- ECONNREFUSED 的 message **不含 "ECONNREFUSED" 字样**（保 `:176` 断言"不泄露错误码给用户"）
- `:132` 测试（非 ECONNREFUSED→BRIDGE_ERROR）**守护不变**
- timeout 测试用 `timeout: 1000`（clamp 下限）真实等待，test timeout `5000`
- 收尾：`tsc` + `eslint` + 全量 `vitest` 通过
- spec：`docs/superpowers/specs/2026-06-28-bridge-timeout-diagnosis-design.md`

## File Structure

- Modify: `src/tools/game-bridge.ts` — 新增 2 个 Error 子类 + `ERROR_CODES`；改造 12 个 reject/throw 点（`_doConnect` 7 处 + `sendToBridge` 4 处 + 外层 catch 1 处）
- Test: `test/game-bridge.test.ts` — `:154` 改 mock+断言、新增 3 个测试（secret-not-found / auth-timeout / request-timeout）

---

## Task 1: NOT_CONNECTED — ECONNREFUSED 源头分流 + 外层 catch 骨架

**Files:**
- Modify: `src/tools/game-bridge.ts`（顶部新增子类+ERROR_CODES；`_doConnect:195`；`sendToBridge:305`；外层 catch `:732-739`）
- Test: `test/game-bridge.test.ts:154`（改 mock + 断言）

**Interfaces:**
- Produces: `BridgeNotConnectedError`（export class，`src/tools/game-bridge.ts`）、`ERROR_CODES.BRIDGE_NOT_CONNECTED` / `ERROR_CODES.BRIDGE_ERROR`
- Consumes: `opsErrorResult`（已 import）、`getErrorMessage`（已 import）

- [ ] **Step 1: 改 `:154` 测试为红（mock emit 带 code 的 ECONNREFUSED + 断言 BRIDGE_NOT_CONNECTED）**

替换 `test/game-bridge.test.ts:154-177` 整个 `it(...)` 块为：

```ts
    it('ECONNREFUSED → BRIDGE_NOT_CONNECTED + suggestion(端到端,游戏未运行语义)', async () => {
      // emit 带 code 的 ECONNREFUSED → _doConnect :195 按 err.code 分流 → BridgeNotConnectedError
      // → 外层 catch :733 instanceof → opsErrorResult(BRIDGE_NOT_CONNECTED, suggestion)
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn();
        (sock as any).destroy = vi.fn();
        queueMicrotask(() => {
          if (typeof cb === 'function') cb();
          const e = new Error('connect ECONNREFUSED 127.0.0.1:9081') as NodeJS.ErrnoException;
          e.code = 'ECONNREFUSED';
          sock.emit('error', e);
        });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(result).not.toBeNull();
      expect(result!.isError).toBe(true);
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
      expect(parsed.error).toContain('Cannot connect to MCP Bridge');
      expect(parsed.error).not.toContain('ECONNREFUSED');  // 不泄露原始错误码给用户
      expect(parsed.suggestion).toBeTruthy();
    });
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts -t "ECONNREFUSED"`
Expected: FAIL（当前外层 catch 一律 `BRIDGE_ERROR`，`error_code` 断言不匹配；或 `:195` 未按 code 分流）

- [ ] **Step 3: 新增 Error 子类 + ERROR_CODES（`game-bridge.ts` 顶部 consts 之后）**

在 `const DEFAULT_TIMEOUT = 10000;`（约 `:19`）之后插入：

```ts
/** Bridge 连不上 / 未正常工作(游戏未运行、未装 autoload、认证失败)。agent 自愈:启动游戏 / 确认安装。 */
export class BridgeNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeNotConnectedError';
  }
}
/** Bridge 连上 + 认证成功后请求无响应(游戏被 runtime error 卡住)。agent 自愈:查游戏报错 / 加大 timeout。 */
export class BridgeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeTimeoutError';
  }
}

const ERROR_CODES = {
  BRIDGE_NOT_CONNECTED: 'BRIDGE_NOT_CONNECTED',
  BRIDGE_TIMEOUT: 'BRIDGE_TIMEOUT',
  BRIDGE_ERROR: 'BRIDGE_ERROR',
} as const;
```

- [ ] **Step 4: `_doConnect:193-196` 按 `err.code` 分流**

old:
```ts
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Bridge connection error: ${err.message}`));
    });
```
new:
```ts
    sock.on('error', (err) => {
      clearTimeout(timer);
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ECONNREFUSED') {
        reject(new BridgeNotConnectedError(
          'Cannot connect to MCP Bridge. Is the game running with the bridge autoload installed?'
        ));
      } else {
        reject(new Error(`Bridge connection error: ${err.message}`));
      }
    });
```

- [ ] **Step 5: `sendToBridge:305` `.catch` 删 ECONNREFUSED 特判，纯透传**

old:
```ts
  }).catch(err => {
    const msg = getErrorMessage(err);
    if (msg.includes('ECONNREFUSED')) {
      return Promise.reject(new Error('Cannot connect to MCP Bridge. Is the game running with the bridge autoload installed?'));
    }
    return Promise.reject(err);
  });
```
new:
```ts
  }).catch(err => {
    // 子类(BridgeNotConnectedError / BridgeTimeoutError)从 _doConnect / sendToBridge 穿透,原样抛
    return Promise.reject(err);
  });
```

- [ ] **Step 6: 外层 catch `:732-739` 加 NOT_CONNECTED 分支**

old:
```ts
  } catch (err) {
    // ECONNREFUSED 已被 sendToBridge:305 转译成 'Cannot connect to MCP Bridge...'(抹掉 ECONNREFUSED 字样),
    // 故此处无法按 ECONNREFUSED 分类,统一 BRIDGE_ERROR 兜底。游戏未运行与一般桥接错误同归 BRIDGE_ERROR
    // (恢复 BRIDGE_NOT_CONNECTED 语义需改 sendToBridge 转译层让错误信号穿越,另开任务)。
    return opsErrorResult('BRIDGE_ERROR', getErrorMessage(err));
  }
```
new:
```ts
  } catch (err) {
    const msg = getErrorMessage(err);
    if (err instanceof BridgeNotConnectedError) {
      return opsErrorResult(ERROR_CODES.BRIDGE_NOT_CONNECTED, msg, {
        suggestion: '游戏未运行或 Bridge 未正确响应。先 run_project 启动游戏,确认 game_bridge_install 已执行',
      });
    }
    return opsErrorResult(ERROR_CODES.BRIDGE_ERROR, msg);
  }
```

- [ ] **Step 7: 运行测试验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts`
Expected: PASS（`:154` 绿；`:132` 非 ECONNREFUSED→BRIDGE_ERROR 仍绿）

- [ ] **Step 8: commit**

```bash
git add src/tools/game-bridge.ts test/game-bridge.test.ts
git commit -m "feat(bridge): ECONNREFUSED 源头分流为 BRIDGE_NOT_CONNECTED

_doConnect:195 按 err.code==='ECONNREFUSED' 抛 BridgeNotConnectedError,
删 sendToBridge:307 字符串匹配,外层 catch 按 instanceof 返回
BRIDGE_NOT_CONNECTED + suggestion(游戏未运行语义)。Task1/3。"
```

---

## Task 2: NOT_CONNECTED — 其余 5 条路径改抛子类

`_doConnect` 的 `:128` / `:133` / `:147` / `:182` / `:200`（secret 缺失 / auth 超时 / auth 失败 / 认证期关闭）改抛 `BridgeNotConnectedError`。外层 catch Task 1 已支持 NOT_CONNECTED，本 task 不改外层 catch。

**Files:**
- Modify: `src/tools/game-bridge.ts`（`_doConnect` 5 处 throw/reject）
- Test: `test/game-bridge.test.ts`（新增 secret-not-found + auth-timeout 测试）

**Interfaces:**
- Consumes: `BridgeNotConnectedError`（Task 1 产出）、外层 catch NOT_CONNECTED 分支（Task 1 产出）

- [ ] **Step 1: 写 2 个红测试（在 `:154` 所在 describe 块末尾，`N-1` describe 之前插入新 describe）**

```ts
  describe('Bridge 超时分层: NOT_CONNECTED 其余路径', () => {
    it('secret not found → BRIDGE_NOT_CONNECTED(bridge 未装/未跑)', async () => {
      mockExists.mockReturnValue(false);  // secret 文件不存在 → _doConnect :133
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(result).not.toBeNull();
      expect(result!.isError).toBe(true);
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
      expect(parsed.suggestion).toBeTruthy();
    });

    it('auth timeout → BRIDGE_NOT_CONNECTED(bridge 接受 TCP 不响应认证)', async () => {
      // bridge 接受连接但不回 auth → _doConnect :147 timer → BridgeNotConnectedError
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue('test-secret');
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn();  // 接受 auth write 不回
        (sock as any).destroy = vi.fn();
        queueMicrotask(() => { if (typeof cb === 'function') cb(); });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping', timeout: 1000 }, ctx);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
    }, 5000);
  });
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts -t "NOT_CONNECTED 其余路径"`
Expected: FAIL（`:133` / `:147` 当前抛普通 Error → 外层 catch 返回 `BRIDGE_ERROR`，断言不匹配）

- [ ] **Step 3: `_doConnect:128` throw 改 BridgeNotConnectedError**

old:
```ts
    throw new Error(
      'Bridge project directory not set. Use run_project to start the game, or pass project_path parameter. ' +
```
new:
```ts
    throw new BridgeNotConnectedError(
      'Bridge project directory not set. Use run_project to start the game, or pass project_path parameter. ' +
```

- [ ] **Step 4: `_doConnect:133` throw 改 BridgeNotConnectedError**

old:
```ts
    throw new Error(
      `Bridge secret not found at ${findBridgeSecretPath()}. ` +
```
new:
```ts
    throw new BridgeNotConnectedError(
      `Bridge secret not found at ${findBridgeSecretPath()}. ` +
```

- [ ] **Step 5: `_doConnect:147` reject 改 BridgeNotConnectedError**

old: `      reject(new Error(\`Bridge auth timed out after ${timeout}ms\`));`
new: `      reject(new BridgeNotConnectedError(\`Bridge auth timed out after ${timeout}ms\`));`

- [ ] **Step 6: `_doConnect:182` reject 改 BridgeNotConnectedError**

old: `          reject(new Error(\`Bridge auth failed (${resp.error?.code}): ${resp.error?.message}\`));`
new: `          reject(new BridgeNotConnectedError(\`Bridge auth failed (${resp.error?.code}): ${resp.error?.message}\`));`

- [ ] **Step 7: `_doConnect:200` reject 改 BridgeNotConnectedError**

old: `      if (!authDone) reject(new Error('Bridge connection closed during auth'));`
new: `      if (!authDone) reject(new BridgeNotConnectedError('Bridge connection closed during auth'));`

- [ ] **Step 8: 运行测试验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts`
Expected: PASS（2 个新测试绿；Task 1 测试不回归）

- [ ] **Step 9: commit**

```bash
git add src/tools/game-bridge.ts test/game-bridge.test.ts
git commit -m "feat(bridge): _doConnect 5 处 reject 改抛 BridgeNotConnectedError

:128/:133 secret 缺失、:147 auth 超时、:182 auth 失败、:200 认证期关闭
统一归 BRIDGE_NOT_CONNECTED(连不上/bridge 没正常工作语义)。Task2/3。"
```

---

## Task 3: TIMEOUT — request timeout 改抛子类 + 外层 catch TIMEOUT 分支

`sendToBridge:255` 改抛 `BridgeTimeoutError`，外层 catch 加 TIMEOUT 分支。

**Files:**
- Modify: `src/tools/game-bridge.ts`（`sendToBridge:255` + 外层 catch 加 TIMEOUT 分支）
- Test: `test/game-bridge.test.ts`（新增 request-timeout 测试）

**Interfaces:**
- Consumes: `BridgeTimeoutError`（Task 1 产出）、`ERROR_CODES.BRIDGE_TIMEOUT`
- Produces: 外层 catch 三分支完整（NOT_CONNECTED / TIMEOUT / ERROR）

- [ ] **Step 1: 写红测试（在 Task 2 的 describe 块内追加）**

```ts
    it('request timeout → BRIDGE_TIMEOUT(连上 + 认证后请求无响应,游戏卡住)', async () => {
      // auth 成功但 method 请求不响应 → sendToBridge :255 timer → BridgeTimeoutError
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue('test-secret');
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn((data: string) => {
          let req: { id?: number };
          try { req = JSON.parse(data); } catch { return; }
          queueMicrotask(() => {
            if (req.id === 0) {
              sock.emit('data', Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n'));
            }
            // id >= 1 method 请求不响应 → :255 timer
          });
        });
        (sock as any).destroy = vi.fn();
        (sock as any).writable = true;
        queueMicrotask(() => { if (typeof cb === 'function') cb(); });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping', timeout: 1000 }, ctx);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_TIMEOUT');
      expect(parsed.suggestion).toContain('不是连接问题');
    }, 5000);
```

- [ ] **Step 2: 运行测试验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts -t "request timeout"`
Expected: FAIL（`:255` 当前抛普通 Error → 外层 catch 返回 `BRIDGE_ERROR`，断言不匹配）

- [ ] **Step 3: `sendToBridge:255` 改抛 BridgeTimeoutError**

old:
```ts
      const timer = setTimeout(() => {
        _invalidateSocket();
        doReject(new Error(`Bridge request timed out after ${timeout}ms`));
      }, timeout);
```
new:
```ts
      const timer = setTimeout(() => {
        _invalidateSocket();
        doReject(new BridgeTimeoutError(`Bridge request timed out after ${timeout}ms`));
      }, timeout);
```

- [ ] **Step 4: 外层 catch 加 TIMEOUT 分支（在 NOT_CONNECTED 分支之后、BRIDGE_ERROR 兜底之前）**

old（Task 1 后的外层 catch）:
```ts
    if (err instanceof BridgeNotConnectedError) {
      return opsErrorResult(ERROR_CODES.BRIDGE_NOT_CONNECTED, msg, {
        suggestion: '游戏未运行或 Bridge 未正确响应。先 run_project 启动游戏,确认 game_bridge_install 已执行',
      });
    }
    return opsErrorResult(ERROR_CODES.BRIDGE_ERROR, msg);
```
new:
```ts
    if (err instanceof BridgeNotConnectedError) {
      return opsErrorResult(ERROR_CODES.BRIDGE_NOT_CONNECTED, msg, {
        suggestion: '游戏未运行或 Bridge 未正确响应。先 run_project 启动游戏,确认 game_bridge_install 已执行',
      });
    }
    if (err instanceof BridgeTimeoutError) {
      return opsErrorResult(ERROR_CODES.BRIDGE_TIMEOUT, msg, {
        suggestion: '游戏在运行但无响应(可能被 runtime error 卡住)——这不是连接问题。检查游戏是否报错,或加大 timeout 重试',
      });
    }
    return opsErrorResult(ERROR_CODES.BRIDGE_ERROR, msg);
```

- [ ] **Step 5: 运行测试验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts`
Expected: PASS（request-timeout 绿；Task 1/2 不回归）

- [ ] **Step 6: commit**

```bash
git add src/tools/game-bridge.ts test/game-bridge.test.ts
git commit -m "feat(bridge): request timeout 分流为 BRIDGE_TIMEOUT

sendToBridge:255 改抛 BridgeTimeoutError,外层 catch 加 TIMEOUT 分支 +
suggestion(游戏在跑但卡住,非连接问题)。完成三元分层。Task3/3。"
```

---

## Task 4: 契约守护 + 全量验证 + ROADMAP 收尾

**Files:**
- Modify: `ROADMAP.md`（M2 #5 状态 🟡→✅）

- [ ] **Step 1: 确认 `:132` 契约守护测试仍绿（非 ECONNREFUSED→BRIDGE_ERROR）**

Run: `node.exe node_modules/vitest/vitest.mjs run test/game-bridge.test.ts -t "非 ECONNREFUSED"`
Expected: PASS（`error_code` 仍 `BRIDGE_ERROR`，契约守护）

- [ ] **Step 2: tsc 类型检查**

Run: `node.exe node_modules/typescript/bin/tsc --noEmit`
Expected: 无错误（`NodeJS.ErrnoException` 是 @types/node 全局类型，无需 import）

- [ ] **Step 3: eslint**

Run: `node.exe node_modules/.bin/eslint src/tools/game-bridge.ts test/game-bridge.test.ts`
Expected: 无错误

- [ ] **Step 4: 全量 vitest 回归**

Run: `node.exe node_modules/vitest/vitest.mjs run`
Expected: 全绿（含原 23 个 + 新增 3 个 game-bridge 测试）

- [ ] **Step 5: 更新 ROADMAP M2 #5 状态 🟡→✅**

`ROADMAP.md` M2 表格 `#5` 行：
old: `| 5 | Bridge 超时分层诊断 | 🟡 | 对象从 execute_gdscript 改归 Bridge;spec 待写(对接源码深挖核实) |`
new: `| 5 | Bridge 超时分层诊断 | ✅ | 三元分类(BRIDGE_NOT_CONNECTED/BRIDGE_TIMEOUT/BRIDGE_ERROR)+suggestion;spec: 2026-06-28-bridge-timeout-diagnosis-design.md |`

并在「路线图变更记录」追加：
```
- 2026-06-28 — M2 #5 完成:Bridge 超时分层诊断(三元分类 + Error 子类 + suggestion;ECONNREFUSED/auth 失败→NOT_CONNECTED,request timeout→TIMEOUT)
```

- [ ] **Step 6: commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): M2 #5 Bridge 超时分层诊断 完成(🟡→✅)"
```

---

## Self-Review 核对（spec 覆盖）

| spec 要求 | 落点 task |
|---|---|
| §3 两个 Error 子类 | Task 1 Step 3 |
| §4 归类表 12 点 | Task 1（#6 ECONNREFUSED）+ Task 2（#1/2/3/4/7）+ Task 3（#9）；#5/8/10/11 保持普通 Error（无需改，天然 BRIDGE_ERROR）+ #12 删特判（Task 1 Step 5） |
| §5 路径 A（`:195` err.code 分流） | Task 1 Step 4 |
| §5.4 `:305` 删 ECONNREFUSED 特判 | Task 1 Step 5 |
| §6 外层 catch 三分支 | Task 1 Step 6（NOT_CONNECTED+ERROR）+ Task 3 Step 4（加 TIMEOUT） |
| §7 局部 ERROR_CODES | Task 1 Step 3 |
| §8 契约声明（ECONNREFUSED 语义修正 / `:132` 守护） | Task 1（:154 改）+ Task 4 Step 1（:132 守护） |
| §9 测试（:132 守护 / :154 改 / 新增 timeout+auth+secret） | Task 1（:154）+ Task 2（secret+auth）+ Task 3（timeout）+ Task 4（:132 守护） |
| §10 follow-up A-4（recording.ts） | 不在本 plan 范围，记录于 spec §10 |
| §11 验收（tsc/eslint/全量/ROADMAP） | Task 4 |
