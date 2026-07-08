# MCP Logging 协议注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP server 经 `sendLoggingMessage` 向 client 推送 warn+error 级日志（默认），client 实时可观测异常。

**Architecture:** `logger.ts` 的 `writeEntry` 增量第三写——除现有文件+stderr 双写外，若 MCP Server 已注入（`setLoggerServer`）且 client 已 initialize（`_clientReady` flag，oninitialized 设），按级别过滤（warn→warning, error→error）后 fire-and-forget 调 `sendLoggingMessage`。失败静默，绝不影响主流程。

**Tech Stack:** TypeScript / `@modelcontextprotocol/sdk` `^1.29.0` 低层 `Server.sendLoggingMessage` / vitest

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-08-mcp-logging-design.md`（commit `33ce4bb`，用户认可）

## Global Constraints

- **SDK**：`@modelcontextprotocol/sdk` `^1.29.0`，`Server.sendLoggingMessage(params)`（`mcp.js:751`），params = `{ level, logger, data }`，level 取 MCP LoggingLevel 子集 `'warning'|'error'`
- **发送范围**：默认仅 warn+error；debug/info/toolStart/toolEnd 不发（继续本地双写）
- **fire-and-forget**：`writeEntry` 是同步函数；`sendLoggingMessage` 返 Promise，**不 await**，`.catch(()=>{})` 吞 async reject；同步 throw 用 try/catch 吞
- **失败安全**：sendLoggingMessage 未注入/clientReady false/throw/reject 任一情况，静默 return，**绝不**影响 `writeEntry` 的文件/stderr 双写或主流程
- **安全不变量**：`emitToClient` 发送的 data 是 `log()` 经 `sanitizeMsg`/`sanitizeMeta` 脱敏后的内容（entry 进 writeEntry 时已脱敏）
- **不实现 setLevel**（YAGNI follow-up）；不做节流/去重；不替代现有双写
- **不触及** `test/regression/defects.ts` detect 路径；现有 3604 测试零回归（测试默认不注入 server）
- **测试惯例**：新建 `test/core/logger-mcp-logging.test.ts`（`test/core/*.ts` 先例）；mock 实例方法（`mockServer.sendLoggingMessage = vi.fn()`），**不** `vi.mock` 整个 SDK 模块（避 vitest 4 ESM/Linux 坑，[[vitest-4-node22-mock-isolation]]）
- **提交惯例**：master 直接提交、commit message 中文、无 Co-Authored-By 尾巴

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/core/logger.ts` | 改 | 加 `setLoggerServer`/`setLoggerClientReady` 注入接口 + `emitToClient`/`toMcpLevel` 模块级纯函数 + `writeEntry` 调一行 + `resetLogger` 清理 |
| `test/core/logger-mcp-logging.test.ts` | 新建 | 9 用例覆盖发送/过滤/guard/失败静默/level 映射/reset |
| `src/GodotServer.ts` | 改 3 处 | 构造 `setLoggerServer` + oninitialized `setLoggerClientReady(true)` + close 清理 |

---

## Task 1: `src/core/logger.ts` 核心 + 单元测试

**Files:**
- Modify: `src/core/logger.ts`（顶部 import + 内部工具函数区 + `writeEntry:232` + `resetLogger:443`）
- Test: `test/core/logger-mcp-logging.test.ts`（新建）

**Interfaces:**
- Consumes: `Server` type（`@modelcontextprotocol/sdk/server.js`）；现有 `LogLevel`/`LogEntry`（logger.ts:17/19）
- Produces: `setLoggerServer(server: Server | null): void`、`setLoggerClientReady(ready: boolean): void`（Task 2 GodotServer 调用）；模块级 `emitToClient(entry)` 被 `writeEntry` 调

- [ ] **Step 1: 写失败测试 `test/core/logger-mcp-logging.test.ts`（完整 9 用例）**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLogger, setLoggerServer, setLoggerClientReady, resetLogger } from '../../src/core/logger.js';

describe('MCP Logging emitToClient', () => {
  let mockServer: { sendLoggingMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resetLogger();
    mockServer = { sendLoggingMessage: vi.fn() };
  });

  it('warn 触发 sendLoggingMessage（level=warning, logger=module, data.msg）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().warn('mymodule', 'something wrong');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    const params = mockServer.sendLoggingMessage.mock.calls[0][0];
    expect(params.level).toBe('warning');
    expect(params.logger).toBe('mymodule');
    expect(params.data.msg).toBe('something wrong');
    expect(params.data.module).toBe('mymodule');
  });

  it('error 触发 sendLoggingMessage（level=error）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().error('mod', 'bad');
    const params = mockServer.sendLoggingMessage.mock.calls[0][0];
    expect(params.level).toBe('error');
  });

  it('info 不触发 sendLoggingMessage', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().info('mod', 'hi');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('debug 不触发 sendLoggingMessage', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().debug('mod', 'trace');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('clientReady=false 不触发（client 未 initialize）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(false);
    getLogger().warn('mod', 'msg');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('未注入 server（_mcpServer=null）不触发 —— 证明现有测试零回归', () => {
    setLoggerClientReady(true);
    getLogger().warn('mod', 'msg');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('sendLoggingMessage async reject 静默不崩（fire-and-forget .catch）', async () => {
    mockServer.sendLoggingMessage = vi.fn(() => Promise.reject(new Error('send fail')));
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    expect(() => getLogger().warn('mod', 'msg')).not.toThrow();
    await new Promise(r => setTimeout(r, 10));  // 等 microtask 让 reject settle
  });

  it('sendLoggingMessage 同步 throw 静默不崩（try/catch）', () => {
    mockServer.sendLoggingMessage = vi.fn(() => { throw new Error('sync throw'); });
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    expect(() => getLogger().warn('mod', 'msg')).not.toThrow();
  });

  it('resetLogger 清理 _mcpServer/_clientReady（后续 warn 不发）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    resetLogger();  // 清理
    getLogger().warn('mod', 'after reset');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/core/logger-mcp-logging.test.ts`
Expected: FAIL（`setLoggerServer` / `setLoggerClientReady` 未导出，或 emitToClient 未实现 → sendLoggingMessage 未被调）

- [ ] **Step 3: 改 `src/core/logger.ts`——顶部加 Server type import**

`:8-11` 现有 import 块后加一行：

```ts
import type { Server } from '@modelcontextprotocol/sdk/server.js';
```

- [ ] **Step 4: 加注入接口（模块变量 + setter）**

在 `let instance: Logger | null = null;`（`:427`）上方加：

```ts
// MCP Logging 注入：Server 实例 + client 就绪 flag。null/false 时不发，零开销退化。
let _mcpServer: Server | null = null;
let _clientReady = false;

/** 注入 MCP Server 实例（GodotServer 构造时调）；null 清除（close/测试隔离） */
export function setLoggerServer(server: Server | null): void {
  _mcpServer = server;
}

/** 标记 client 是否已完成 initialize（oninitialized 时设 true）；未就绪不发，避免 SDK 报错 */
export function setLoggerClientReady(ready: boolean): void {
  _clientReady = ready;
}
```

- [ ] **Step 5: 加 `toMcpLevel` + `emitToClient` 模块级纯函数**

在 `sanitizeMsg` 函数（`:128-131`）之后、`formatStderr`（`:134`）之前加：

```ts
/** MCP LoggingLevel 子集映射：本项目 4 级 → MCP 8 级。debug/info 返 null（不发 client）。 */
function toMcpLevel(level: LogLevel): 'warning' | 'error' | null {
  if (level === 'warn') return 'warning';
  if (level === 'error') return 'error';
  return null;
}

/**
 * 增量第三写：按条件向 MCP client 推送 warn/error。
 * guard: _mcpServer 注入 + _clientReady + level∈{warn,error}。
 * 失败静默（try/catch 同步 throw + .catch async reject）——日志是观测层，绝不影响主流程。
 * 安全：entry 经 log() 的 sanitizeMsg/sanitizeMeta 脱敏后才进 writeEntry，data 已脱敏。
 */
function emitToClient(entry: LogEntry): void {
  if (!_mcpServer || !_clientReady) return;
  const mcpLevel = toMcpLevel(entry.level);
  if (!mcpLevel) return;
  const data: Record<string, unknown> = { msg: entry.msg, module: entry.module };
  if (entry.tool) data.tool = entry.tool;
  if (entry.meta) data.meta = entry.meta;
  try {
    const p = _mcpServer.sendLoggingMessage({ level: mcpLevel, logger: entry.module, data });
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      (p as Promise<unknown>).catch(() => {});
    }
  } catch {
    // 同步 throw 静默
  }
}
```

- [ ] **Step 6: `writeEntry` 末尾调 `emitToClient`**

`writeEntry`（`:232-248`）函数体末尾（`flushTimer.unref?.()` 的 `}` 之后、函数闭合 `}` 之前）加一行：

```ts
    emitToClient(entry);
```

即 writeEntry 完整变为：
```ts
  function writeEntry(entry: LogEntry): void {
    buffer.push(entry);
    try {
      process.stderr.write(formatStderr(entry));
    } catch { /* ignore */ }
    if (buffer.length >= bufferMax) {
      doFlush();
    } else if (!flushTimer && !closed) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        doFlush();
      }, bufferMs);
      flushTimer.unref?.();
    }
    emitToClient(entry);
  }
```

- [ ] **Step 7: `resetLogger`（`:443-448`）补清理**

```ts
export function resetLogger(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
  _mcpServer = null;
  _clientReady = false;
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `npx vitest run test/core/logger-mcp-logging.test.ts`
Expected: PASS（9 用例全绿）

- [ ] **Step 9: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 10: 现有 logger 相关测试无回归**

Run: `npx vitest run test/core/ 2>&1 | tail -5`
Expected: 全绿（现有 test/core/*.test.ts 默认不注入 server → emitToClient 直接 return）

- [ ] **Step 11: 提交**

```bash
git add src/core/logger.ts test/core/logger-mcp-logging.test.ts
git commit -m "feat(logger): MCP Logging 注入 setLoggerServer/clientReady + emitToClient warn/error 推送 + 9 单元测试"
```

---

## Task 2: `src/GodotServer.ts` 接线（3 处）+ 无回归

**Files:**
- Modify: `src/GodotServer.ts`（顶部 import + `:107` 构造 + `:219` oninitialized + `:507` close）

**Interfaces:**
- Consumes: `setLoggerServer` / `setLoggerClientReady`（Task 1 产物）；现有 `this.server`（Server 实例）
- Produces: GodotServer 运行时 warn/error 经 MCP 推送 client；close 时干净清理

- [ ] **Step 1: 顶部 import 加 setLoggerServer/setLoggerClientReady**

读 `src/GodotServer.ts` 顶部 import 区，找到 `from './core/logger.js'` 那行（现有 import 含 `getLogger`）。把 `setLoggerServer, setLoggerClientReady` 加到该 import 的命名导入列表。

例如若现有为：
```ts
import { getLogger } from './core/logger.js';
```
改为：
```ts
import { getLogger, setLoggerServer, setLoggerClientReady } from './core/logger.js';
```

- [ ] **Step 2: 构造接线（`:107`）**

`:107` 现有：
```ts
    setMcpServer(this.server);
```
改为：
```ts
    setMcpServer(this.server);
    setLoggerServer(this.server);
```

- [ ] **Step 3: oninitialized 接线（`:219-226`）**

⚠️ **不破坏既有 MCP Roots `initRootsIntegration` 逻辑**。在 `:219` 现有 oninitialized 回调体**首行**加 `setLoggerClientReady(true);`：

```ts
    this.server.oninitialized = async () => {
      setLoggerClientReady(true);   // ← 新增首行。其余 MCP Roots 逻辑保持不变
      const caps = this.server.getClientCapabilities();
      if (caps?.roots) {
        await applyRoots(false);
      } else {
        getLogger().info('security', 'Client does not support MCP Roots — using ALLOWED_PROJECT_PATHS baseline');
      }
    };
```

- [ ] **Step 4: close 清理（`:507` 附近）**

`:507` 现有：
```ts
    clearMcpServer();
    setAllowedRootsFromClient(null);  // 批 P0: 回落 env，干净关闭 + 测试隔离
```
在 `clearMcpServer();` 后加两行：
```ts
    clearMcpServer();
    setLoggerServer(null);          // 批 P1: MCP Logging 干净关闭 + 测试隔离
    setLoggerClientReady(false);
    setAllowedRootsFromClient(null);  // 批 P0: 回落 env，干净关闭 + 测试隔离
```

- [ ] **Step 5: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 6: godot-server 测试无回归（含 MCP Roots oninitialized 测试）**

Run: `npx vitest run test/godot-server.test.js 2>&1 | tail -5`
Expected: 全绿（oninitialized 加首行 setLoggerClientReady 不影响 MCP Roots 既有测试）

- [ ] **Step 7: 提交**

```bash
git add src/GodotServer.ts
git commit -m "feat(godot-server): MCP Logging 接线（构造注入 + oninitialized clientReady + close 清理）"
```

---

## Task 3: 全量门禁（controller 自跑，无代码改动）

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm test 2>&1 | tail -5`
Expected: 全绿（3604 基线 + Task 1 新增 9 = 3613 passed / 8 skipped）。defects baseline 计数不变。

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: tsc exit 0；lint 0 错误（get-context.ts:196 既有 warning 允许，非本次引入）

- [ ] **Step 3: build**

Run: `npm run build 2>&1 | tail -3`
Expected: exit 0

- [ ] **Step 4: 手动验证（可选，spec §11 follow-up）**

Run: `npm run inspector`（启动 inspector），在浏览器里触发一个 warn（如调工具触发路径拒绝），观察 client 是否收 logging notification。

> inspector 在 CLI 不可用则跳过；集成层已由 Task 1 测试（注入+ready→sendLoggingMessage）+ Task 2 接线覆盖。

- [ ] **Step 5: 若 Step 1-3 全绿且 Step 4 验证通过/跳过，无需额外 commit**

---

## Self-Review

**1. Spec coverage（逐节核对）：**
- §2 目标（warn+error 推送 / 零侵入 143 处 / 失败安全 / 3604 零回归）→ Task 1（writeEntry 改一处全覆盖）+ Task 1 Step 10（test/core 无回归）+ Task 3 Step 1（全量）✅
- §3 非目标（setLevel/debug.info/节流/替代双写 4 条）→ plan 全程未引入 ✅
- §5.1 注入接口（setLoggerServer/setLoggerClientReady + 模块变量）→ Task 1 Step 4 ✅
- §5.2 emitToClient + toMcpLevel + writeEntry 调用 → Task 1 Step 5/6 ✅
- §5.3 resetLogger 清理 → Task 1 Step 7 ✅
- §5.4 GodotServer 3 处接线 → Task 2 Step 2/3/4 ✅
- §7 错误处理（未注入/未 ready/throw/reject 静默）→ Task 1 测试用例 5/6/7/8 + emitToClient guard ✅
- §7 安全不变量（脱敏）→ emitToClient 注释 + Global Constraints 声明 ✅
- §8 测试策略（9 用例 + mock 实例方法不 mock SDK）→ Task 1 Step 1 完整 9 用例 ✅
- §10 验收 → Task 1-3 全覆盖 ✅

**2. Placeholder scan：** 无 TBD/TODO；每步含真实代码或命令；9 测试用例完整代码；emitToClient/toMcpLevel 完整实现；GodotServer 3 处 before/after 精确（已读 :107/:219/:507 核实）✅

**3. Type consistency：**
- `setLoggerServer(server: Server | null)` —— Task 1 Step 4 定义、Task 2 Step 2 调 `setLoggerServer(this.server)`、Task 2 Step 4 调 `setLoggerServer(null)` ✅
- `setLoggerClientReady(ready: boolean)` —— Task 1 Step 4 定义、Task 2 Step 3 调 `setLoggerClientReady(true)`、Step 4 调 `setLoggerClientReady(false)` ✅
- `emitToClient(entry: LogEntry)` —— Task 1 Step 5 定义、Step 6 writeEntry 调 `emitToClient(entry)` ✅
- `sendLoggingMessage({ level, logger, data })` —— emitToClient 调用 + 测试断言 params.level/logger/data 一致 ✅
- oninitialized `:219` 既有结构（已读确认）—— Task 2 Step 3 before/after 精确匹配 ✅

无问题，plan 可执行。
