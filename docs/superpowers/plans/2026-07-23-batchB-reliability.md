# 批次 B 可靠性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 5 份审查暴露的 10 条可靠性 finding（B1-B10）：统一 editor 降级链路（检测/归因/执行/恢复协同）、进程通信错误结构化、17 处资源写原子化、3 条 advisory。

**Architecture:** 纯加固 + 统一重构，不改工具签名与正常路径行为。降级链路 4 环节（B3 检测 + B1 归因 + B2 执行 + B6 恢复）同 task 协同设计（防批次 A I1 式跨 task 裂缝）。资源写 17 处三环境统一 tmp+rename 原子模式（对齐已验证范例 data-import.ts:188 + memory [[resourcesaver-extension-dispatch]]）。

**Tech Stack:** TypeScript（src/core 状态机 + src/tools 模板）、GDScript（src/scripts headless + addons editor 插件）、vitest（单测 + 字面量契约）、Godot headless（集成验证）、defects.ts（防复发 detect 守卫）。

## Global Constraints

- **行号会漂移**：本 plan 所有 `文件:行号` 为 2026-07-23 核查快照，实现时一律以 grep 实际行号为准。
- **不改工具签名/正常路径行为**：降级/重连/资源写改动不得破坏既有连接、既有工具调用、既有 save 语义（返回值/错误码）。
- **B1 不动 recordFailure 签名**：`recordFailure(errorType, message, scope?)` 参数已存在，改 evaluateState 状态机层（spec 83090a7 校准）。
- **B3 timeoutMs 禁入 params**：params 经 JSON-RPC 发给对端，本地超时语义不可外泄；用独立第三参 `options?: { timeoutMs?: number }`。
- **资源写 tmp 扩展名按目标 path 派生**：`var ext := path.get_extension(); var tmp := path + ".tmp." + ext`——tmp 必须以目标扩展名结尾（ResourceSaver 按扩展名分派 saver，裸 .tmp 返回 err 15 ERR_FILE_UNRECOGNIZED，memory [[resourcesaver-extension-dispatch]]）。
- **回归门禁**：每 task 收尾 `npx tsc --noEmit` exit 0；GDScript 改动跑 `npm run check:gdscript` errors=0 warnings=0；全量 `npm test` 无新 failed（pre-existing T11 elicitation 4 failed 不变）。
- **master 本地不 push**（用户惯例，领先 origin）；commit message 中文，按 `fix(reliability):`/`docs(reliability):` 前缀。
- **429 限额**：SDD 执行时分批派 subagent，每批 1-2 个，review 通过再派下一个（用户要求）。
- **Reviewer 路由**：Task1/2 → bridge-reviewer + ecc:typescript-reviewer；Task3a → headless-reviewer；Task3b → editor-plugin-reviewer（addons）+ ecc:typescript-reviewer（TS）；Task4 → ecc:typescript-reviewer；Task5 → controller 自审（detect 闭包须源码判断）；final → opus。

---

## File Structure

| 文件 | 责任 | 本 plan 改动 |
|------|------|-------------|
| `src/core/health-monitor.ts` | 连接健康状态机 + 心跳 | Task1: B1 evaluateState 分流（新增 consecutiveHeartbeatFails 计数器） |
| `src/core/EditorConnection.ts` | editor WebSocket 客户端 | Task1: B3 request() 加 options.timeoutMs；Task2: B4 reject 挂 err.code、B5 fireDisconnect/fireReconnect try/catch；Task4: B8 isConnected JSDoc、B10 authTimeoutMs 参数化 |
| `src/GodotServer.ts` | MCP 服务端主编排 | Task1: B2 handleEditorStall disconnect、B3 pingFn 传 timeoutMs、B6 establishEditorConnection setState connected |
| `src/core/ToolDispatcher.ts` | 工具分发 + healthSample | Task1: 无代码改动（B1 已确认 healthSample:446 传 TOOL_ERROR，改在 health-monitor 侧） |
| `src/core/EditorToolExecutor.ts` | editor 工具转发 | Task2: B4 do_not_retry 改查 err.code（合并 I-12 结构化分支） |
| `src/scripts/godot_operations.gd` | headless GDScript 工具 | Task3a: B7 加 `_save_atomic` helper，9 处改调 |
| `addons/godot_mcp_server/commands/command_helpers.gd` | editor 插件共享 helper | Task3b: B7 加 `_save_atomic` helper（addons 侧） |
| `addons/godot_mcp_server/commands/ui_commands.gd` | editor UI 命令 | Task3b: B7 2 处（:269/:373）改调 helper |
| `addons/godot_mcp_server/commands/asset/asset_commands.gd` | editor 资产命令 | Task3b: B7 1 处（:120）改调 helper |
| `src/tools/ui/ui-theme.ts` | TS 生成 UI theme 脚本 | Task3b: B7 2 处（:58/:141）改 tmp+rename 内联 |
| `src/tools/scene/scene-commit.ts` | TS 生成 scene 提交脚本 | Task3b: B7 1 处（:118）改 tmp+rename 内联 |
| `src/tools/scene/scene-instance.ts` | TS 生成 scene 实例脚本 | Task3b: B7 1 处（:26）改 tmp+rename 内联 |
| `src/tools/material-ops.ts` | TS 生成材质脚本 | Task3b: B7 1 处（:354）改 tmp+rename 内联 |
| `src/defects.ts` | defect 防复发 detect 守卫 | Task5: B1-B10 新增 finding 登记（FIXED detect===0） |
| `CHANGELOG.md` | 变更日志 | Task5: 批次 B 可靠性段 |
| `.claude/rules/godot-mcp-core.md` | orphan 扫描文档 | Task4: B9 注明崩溃恢复 opt-in env |

---

## Task 1: 降级链路协同（B1+B2+B3+B6）

**为什么 4 环节一个 task**：B3（检测快）+ B1（归因准）+ B2（执行净）+ B6（恢复干净）共享 health-monitor 状态机 + EditorConnection + GodotServer.establishEditorConnection 同一方法。拆开会引入批次 A I1 式裂缝（各自改半截状态机）。spec「裂缝风险高时 B6 并入组1」许可。

**Files:**
- Modify: `src/core/health-monitor.ts`（B1：recordFailure:123 / recordSuccess:100 / evaluateState:216 / scheduleNext heartbeat:270-292）
- Modify: `src/core/EditorConnection.ts`（B3：request:306 签名 + timer:329）
- Modify: `src/GodotServer.ts`（B2：handleEditorStall:423 / B3：pingFn:460 / B6：establishEditorConnection:458-471）
- Test: `test/health-monitor.test.ts`（既有，扩展）；`test/editor-connection.test.ts`（既有或新建）

**Interfaces:**
- Consumes: `ToolDispatcher.healthSample` 已调 `recordFailure('TOOL_ERROR', ...)`（:446）/`recordSuccess`（:449），不改。
- Produces:
  - `HealthMonitor` 新增私有字段 `consecutiveHeartbeatFails`，`evaluateState` reconnecting 阈值改查它（仅 heartbeat 类失败驱动）。
  - `EditorConnection.request(method, params={}, options?: { timeoutMs?: number })`——第三参可选，默认回退 `this.requestTimeoutMs`。
  - `GodotServer.handleEditorStall()` 顶部加 `this.editorConn?.disconnect()`（清 zombie）。
  - `GodotServer.establishEditorConnection()` 成功后 `hm.setState('connected')`（B6 重建恢复）。

**★ 已核实事实（实现前无须重复 grep，但 B1 第一步仍按 spec 要求确认）：**
- `health-monitor.ts:126` `this.consecutiveFails++` **无差别累加**（不查 errorType）→ CONFIRMED bug。
- `health-monitor.ts:221` evaluateState 只查 `consecutiveFails >= maxConsecutiveFailures` → CONFIRMED。
- `health-monitor.ts:282/285` 心跳失败已传 `'heartbeat'`；`ToolDispatcher.ts:446` 工具失败已传 `'TOOL_ERROR'` → CONFIRMED。
- `GodotServer.ts:460` pingFn 复用 `request('ping')` 的 30s 超时 → CONFIRMED。
- `GodotServer.ts:423-432` handleEditorStall 无 `disconnect()` → CONFIRMED。

- [ ] **Step 1: 确认 recordFailure 累加逻辑（spec 要求的第一步）**

Run: `rg -n "consecutiveFails" src/core/health-monitor.ts`
Expected: 命中 `:67` 声明 / `:103` recordSuccess 重置 / `:126` recordFailure `++` / `:221` evaluateState 阈值 / `:278` heartbeat success 重置 / `:182` getStats。
确认 `:126` 是无条件 `this.consecutiveFails++`（不区分 errorType）。若已变动则据实调整下面 Step 3。

- [ ] **Step 2: 写 B1 失败测试（TOOL_ERROR 不驱动 reconnecting）**

在 `test/health-monitor.test.ts` 加（若无该文件则新建，参照既有 health-monitor 测试风格）：

```typescript
it('B1: tool errors do not drive reconnecting; only heartbeat failures do', () => {
  const hm = new HealthMonitor({ maxConsecutiveFailures: 5 });
  hm.setState('connected');
  // 模拟 5 次工具失败（ToolDispatcher 传 TOOL_ERROR）
  for (let i = 0; i < 5; i++) {
    hm.recordFailure('TOOL_ERROR', `tool fail ${i}`);
  }
  expect(hm.getState()).not.toBe('reconnecting'); // TOOL_ERROR 不进 reconnecting
  // 5 次心跳失败才进 reconnecting
  for (let i = 0; i < 5; i++) {
    hm.recordFailure('heartbeat', `ping false ${i}`);
  }
  expect(hm.getState()).toBe('reconnecting');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run test/health-monitor.test.ts -t "B1"`
Expected: FAIL（5 次 TOOL_ERROR 后 state 已是 'reconnecting'，断言 `.not.toBe('reconnecting')` 红）。

- [ ] **Step 4: B1 实现——新增 consecutiveHeartbeatFails 计数器**

`src/core/health-monitor.ts` 改 4 处：

(a) 字段声明（:67 `consecutiveFails` 下方加）：
```typescript
  private consecutiveFails = 0;
  // B1: 仅心跳类失败驱动 reconnecting；工具失败(TOOL_ERROR)贡献 degraded 统计不驱动状态机
  private consecutiveHeartbeatFails = 0;
```

(b) recordSuccess（:103 重置处加一行）：
```typescript
    this.consecutiveFails = 0;
    this.consecutiveHeartbeatFails = 0;
```

(c) recordFailure（:126 累加处加分流）：
```typescript
    this.consecutiveFails++;
    if (errorType === 'heartbeat') {
      this.consecutiveHeartbeatFails++;
    }
```

(d) evaluateState（:221 阈值改查新计数器）：
```typescript
    if (this.consecutiveHeartbeatFails >= this.opts.maxConsecutiveFailures) {
      if (this.state !== 'reconnecting') {
        this.setState('reconnecting');
      }
      return;
    }
```

(e) scheduleNext 心跳成功分支（:278 重置处加一行）：
```typescript
          this.consecutiveFails = 0;
          this.consecutiveHeartbeatFails = 0;
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run test/health-monitor.test.ts`
Expected: PASS（含新 B1 用例 + 既有 health-monitor 测试全绿）。

- [ ] **Step 6: 写 B3 失败测试（ping 用独立短超时）**

`test/editor-connection.test.ts` 加（若无不存在的 API 需新建文件，参照既有 editor-connection 测试；若既有文件 mock 了 ws，复用其 setup）：

```typescript
it('B3: request() honors options.timeoutMs (short heartbeat timeout)', async () => {
  // 构造一个 connected 但永不回包的 EditorConnection（mock ws.send 后 pending 挂起）
  const conn = new EditorConnection({ port: 9999, requestTimeout: 30000 });
  // ...复用既有测试的 connected 状态注入（vi.spyOn ws 或私有字段设置）...
  const start = Date.now();
  await expect(conn.request('ping', {}, { timeoutMs: 5000 })).rejects.toThrow('Request timeout');
  const elapsed = Date.now() - start;
  expect(elapsed).toBeGreaterThanOrEqual(4900);
  expect(elapsed).toBeLessThan(15000); // 5s 超时而非 30s
});
```
> 若注入 connected 状态困难（私有字段），用既有测试已有的 helper；实在不可测则在 Step 7 实现后用 `evaluate_script`/run_and_verify 实跑一次心跳路径作集成验证，并在本测试文件加 `it.skip` 注明原因（诚实 skip，不假绿）。

- [ ] **Step 7: B3 实现——request() 加 options.timeoutMs**

`src/core/EditorConnection.ts:306` 改签名 + timer：

```typescript
  request(
    method: string,
    params: Record<string, unknown> = {},
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        reject(new Error('Not connected'));
        return;
      }
      // ...requestId 分配不变...
      const id = this.requestId = candidate;
      // B3: 心跳等活性检测传独立短超时，默认回退业务 requestTimeoutMs(30s)
      const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);
      // ...pending.set / ws.send 不变...
```

`src/GodotServer.ts:460` pingFn 传短超时：

```typescript
        hm.startHeartbeat(
          () => (this.editorConn ? this.editorConn.request('ping', {}, { timeoutMs: 5000 }).then(() => true).catch(() => false) : Promise.resolve(false)),
        );
```

- [ ] **Step 8: 运行 B3 测试 + tsc**

Run: `npx vitest run test/editor-connection.test.ts && npx tsc --noEmit`
Expected: PASS + tsc exit 0（第三参可选，既有 2 参调用不破坏）。

- [ ] **Step 9: 写 B2 失败测试（handleEditorStall 调 disconnect）**

B2 在 GodotServer（集成层），单测 mock 成本高。用**字面量契约测试**（对齐 recording-screen-drag F2 模式）——读源码断言 handleEditorStall 顶部有 disconnect：

`test/godot-server-degrade.test.ts`（既有或新建）加：
```typescript
import { readFileSync } from 'node:fs';
it('B2: handleEditorStall calls disconnect() before nulling editorConn', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');
  const stallFn = src.match(/private handleEditorStall\(\)[\s\S]*?^\s*}/m);
  expect(stallFn, 'handleEditorStall 函数体未找到').toBeTruthy();
  // disconnect 必须出现在 editorConn = null 之前
  const body = stallFn![0];
  const discIdx = body.indexOf('this.editorConn?.disconnect()');
  const nullIdx = body.indexOf('this.editorConn = null');
  expect(discIdx).toBeGreaterThan(-1);
  expect(nullIdx).toBeGreaterThan(discIdx);
});
```

- [ ] **Step 10: 运行确认失败**

Run: `npx vitest run test/godot-server-degrade.test.ts -t "B2"`
Expected: FAIL（disconnect 不存在，discIdx === -1）。

- [ ] **Step 11: B2 实现——handleEditorStall 顶部加 disconnect**

`src/GodotServer.ts:423` handleEditorStall 函数体顶部加（对齐 establishEditorConnection:443 的 disconnect 模式）：

```typescript
  private handleEditorStall(): void {
    // B2: 清 zombie——旧 EditorConnection 的 WS 仍 OPEN + reconnectEnabled=true,
    // 不 disconnect 则闭包重连耗尽后跨实例触发 reconnectExhausted 再降级。
    try { this.editorConn?.disconnect(); } catch { /* best-effort */ }
    this.dispatcher?.markEditorFallback();
    this.connectionMode = 'headless';
    // I-04: atomic degradeToHeadless() 避免 two separate _pendingModeSwitch writes racing
    this.dispatcher?.degradeToHeadless();
    // 降级后停心跳：editorConn 置 null 后 pingFn 必返 false，继续 recordFailure 是噪声。
    this.dispatcher?.getHealthMonitor().stopHeartbeat();
    this.editorConn = null;
  }
```

- [ ] **Step 12: 运行 B2 测试确认通过**

Run: `npx vitest run test/godot-server-degrade.test.ts -t "B2"`
Expected: PASS。

- [ ] **Step 13: B6 实现——establishEditorConnection 重建后 setState connected**

`src/GodotServer.ts` 的 `establishEditorConnection`，在 `if (hm) { ... }` 块末尾（onStateChange 注册之后，:471 之前）加：

```typescript
        hm.onStateChange((_from, to) => {
          if (to === 'reconnecting' && this.connectionMode === 'editor') {
            getLogger().warn('godot-mcp', 'Heartbeat detected editor stall (TCP open but main thread blocked) — degrading to headless.');
            this.handleEditorStall();
          }
        });
        // B6: 重建(rebuild)成功后 hm.state 可能残留 'reconnecting'(上次 stall 留下),
        // 首个心跳要等 heartbeatIntervalMs 才纠正——期间 onStateChange 不再触发降级但状态错。
        // 显式 setState('connected') 即刻复位。首次连接 hm 本就 connected,此处为 no-op。
        hm.setState('connected');
```

**★ B1+B6 联合自检**（reviewer 须确认）：B1 改后 connected 态下工具失败（TOOL_ERROR）只进 degraded 不进 reconnecting，故 B6 的 setState('connected') 后不会因工具失败被 onStateChange 误降级——两改动兼容。

- [ ] **Step 14: 全量回归**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0；vitest 全绿除 pre-existing T11 elicitation 4 failed（baseline ff16a25 同）。**0 新回归**。若 editor-connection/health-monitor 既有测试因行为变化失败，逐一核实是否预期（如某测试断言 TOOL_ERROR 进 reconnecting——那是旧 bug 行为，改测试断言）。

- [ ] **Step 15: Commit**

```bash
git add src/core/health-monitor.ts src/core/EditorConnection.ts src/GodotServer.ts test/health-monitor.test.ts test/editor-connection.test.ts test/godot-server-degrade.test.ts
git commit -m "fix(reliability): B1+B2+B3+B6 降级链路协同（归因分流+ping独立超时+disconnect zombie+重建复位）

B1 evaluateState 分流: 新增 consecutiveHeartbeatFails, 仅 heartbeat 类失败驱动 reconnecting,
  TOOL_ERROR 贡献 degraded 统计不驱动状态机(health-monitor:126 无差别累加实锤)
B3 ping 独立 5s 超时: request(method,params,options?:{timeoutMs?}) 第三参, 禁入 params
B2 handleEditorStall 顶部 disconnect 清 zombie(对齐 establish:443)
B6 重建后 hm.setState('connected') 即刻复位残留 reconnecting"
```

---

## Task 2: 进程通信错误结构化（B4+B5）

**Files:**
- Modify: `src/core/EditorConnection.ts`（B4：reject 站点挂 err.code :243/:299/:309/:331/:499；B5：fireDisconnect:101 / fireReconnect:107 try/catch）
- Modify: `src/core/EditorToolExecutor.ts`（B4：_executeInner catch:80-105 合并分支，按 err.code 判 do_not_retry）
- Test: `test/editor-tool-executor.test.ts`（既有或新建）；`test/editor-connection.test.ts`

**Interfaces:**
- Consumes: Task1 的 EditorConnection.request（签名不变，Task2 只在 reject 路径挂 code）。
- Produces:
  - EditorConnection reject 的连接类错误挂 `err.code` ∈ `{'CONNECTION_LOST','NOT_CONNECTED','REQUEST_TIMEOUT','DISCONNECTED','PARSE_ERROR'}`。
  - EditorToolExecutor `_executeInner` catch 合并 I-12 结构化分支与连接错误分支：连接类 code → `{error, editor_disconnected:true, do_not_retry:true}`；插件结构化 code（非连接类）→ `{error, code, data}`。

**★ 关键交互（必须处理，否则 B4 反而破坏 do_not_retry）**：当前 EditorToolExecutor:81 的 I-12 分支 `'code' in err` 会吞掉任何带 code 的错误并返回**不带** do_not_retry 的结构化结果。若给连接错误挂 err.code，它会落入此分支 → do_not_retry 丢失。Task2 必须把两个分支合并：先判连接 code，再保留插件结构化 code/data。

**★ 已核实事实：**
- `EditorToolExecutor.ts:93` 字符串匹配 `'Connection lost'||'Not connected'||'Request timeout'`，漏 `'Disconnected'`(:499)/`'JSON parse error'`(:299) → CONFIRMED。
- `EditorConnection.ts:243` close handler reject `'Connection lost'`；`:299` JSON parse reject；`:309` not connected；`:331` request timeout；`:499` disconnect reject → CONFIRMED。
- `EditorConnection.ts:101-109` fireDisconnect/fireReconnect 裸迭代 handler Set（fireDisconnect 有 `_disconnectFired` 守卫，fireReconnect 无）→ CONFIRMED。

- [ ] **Step 1: 写 B4 失败测试（do_not_retry 覆盖 Disconnected + JSON parse error）**

`test/editor-tool-executor.test.ts` 加（参照既有测试 mock conn.request）：

```typescript
it('B4: do_not_retry covers Disconnected + JSON parse error via err.code', async () => {
  // 模拟 conn.request reject 带 err.code='DISCONNECTED'
  const conn = { request: vi.fn().mockRejectedValue(Object.assign(new Error('Disconnected'), { code: 'DISCONNECTED' })) };
  const exec = new EditorToolExecutor(conn as any);
  const res = await (exec as any)._executeInner('editor', { action: 'add_node' });
  const payload = JSON.parse((res.content[0] as any).text);
  expect(payload.do_not_retry).toBe(true);
  expect(payload.editor_disconnected).toBe(true);

  // PARSE_ERROR 同理
  conn.request.mockRejectedValueOnce(Object.assign(new Error('JSON parse error in editor response: ...'), { code: 'PARSE_ERROR' }));
  const res2 = await (exec as any)._executeInner('editor', { action: 'add_node' });
  expect(JSON.parse((res2.content[0] as any).text).do_not_retry).toBe(true);
});

it('B4: plugin structured error (non-connection code) preserves code/data WITHOUT do_not_retry', async () => {
  const conn = { request: vi.fn().mockRejectedValue(Object.assign(new Error('NODE_NOT_FOUND'), { code: -32602, data: { path: 'x' } })) };
  const exec = new EditorToolExecutor(conn as any);
  const res = await (exec as any)._executeInner('editor', { action: 'edit_node' });
  const payload = JSON.parse((res.content[0] as any).text);
  expect(payload.code).toBe(-32602);
  expect(payload.data).toEqual({ path: 'x' });
  expect(payload.do_not_retry).toBeUndefined();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/editor-tool-executor.test.ts -t "B4"`
Expected: FAIL（DISCONNECTED 带 code 落入 I-12 分支无 do_not_retry；或 code 未挂）。

- [ ] **Step 3: B4 实现 A——EditorConnection reject 挂 err.code**

`src/core/EditorConnection.ts` 5 处 reject 改为构造带 code 的 Error（用 `Object.assign(new Error(...), { code })` 或 `as Error & { code?: string }`）：

```typescript
// :243 close handler
pending.reject(Object.assign(new Error('Connection lost'), { code: 'CONNECTION_LOST' }));
// :299 JSON parse error
pending.reject(Object.assign(new Error(`JSON parse error in editor response: ${getErrorMessage(err)}`), { code: 'PARSE_ERROR' }));
// :309 request() not connected（在 request 内）
reject(Object.assign(new Error('Not connected'), { code: 'NOT_CONNECTED' }));
// :331 request() timeout
reject(Object.assign(new Error(`Request timeout: ${method}`), { code: 'REQUEST_TIMEOUT' }));
// :499 disconnect()
pending.reject(Object.assign(new Error('Disconnected'), { code: 'DISCONNECTED' }));
```
> `:234`（connect failed）/`:159`（connection timeout）/`:402`（auth）属 connect 阶段非 request，不挂连接 code（保持现状）。

- [ ] **Step 4: B4 实现 B——EditorToolExecutor 合并 catch 分支**

`src/core/EditorToolExecutor.ts:80-105` catch 块整体替换为合并版（先判连接 code，再保留插件结构化）：

```typescript
    } catch (err) {
      const errCode = (err instanceof Error && 'code' in err)
        ? (err as Record<string, unknown>).code
        : undefined;
      const message = err instanceof Error ? err.message : 'Unknown error';
      // B4: 连接类错误结构化判定（覆盖 Disconnected/JSON parse error 等旧字符串匹配漏项）
      const CONN_ERROR_CODES = new Set([
        'CONNECTION_LOST', 'NOT_CONNECTED', 'REQUEST_TIMEOUT', 'DISCONNECTED', 'PARSE_ERROR',
      ]);
      const isConnectionError =
        (typeof errCode === 'string' && CONN_ERROR_CODES.has(errCode)) ||
        message.includes('Connection lost') ||
        message.includes('Not connected') ||
        message.includes('Request timeout') ||
        message.includes('Disconnected') ||
        message.includes('JSON parse error');

      const errorPayload: Record<string, unknown> = { error: message };
      // I-12: 保留插件结构化 code/data（连接类错误除外——它们的 code 是本地连接语义非插件语义）
      if (!isConnectionError && err instanceof Error && 'code' in err) {
        errorPayload.code = (err as Record<string, unknown>).code;
      }
      if (!isConnectionError && err instanceof Error && 'data' in err) {
        errorPayload.data = (err as Record<string, unknown>).data;
      }
      if (isConnectionError) {
        errorPayload.editor_disconnected = true;
        // ipc P0-1: 连接断开期间 in-flight 调用结果未知,客户端不应自动重试
        errorPayload.do_not_retry = true;
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(errorPayload) }],
        isError: true,
      };
    }
```

- [ ] **Step 5: 运行 B4 测试确认通过**

Run: `npx vitest run test/editor-tool-executor.test.ts`
Expected: PASS（含新 B4 两用例 + 既有 executor 测试全绿）。

- [ ] **Step 6: 写 B5 失败测试（handler 抛错不阻断后续 handler + 不阻断 scheduleReconnect）**

`test/editor-connection.test.ts` 加：

```typescript
it('B5: a throwing disconnect handler does not block other handlers', () => {
  const conn = new EditorConnection({ port: 9999 });
  const called: string[] = [];
  conn.addOnDisconnectHandler(() => { called.push('first'); throw new Error('boom'); });
  conn.addOnDisconnectHandler(() => { called.push('second'); });
  (conn as any).fireDisconnect(); // 触发（fireDisconnect 私有，测试用 as any 或暴露 test hook）
  expect(called).toEqual(['first', 'second']); // 两个都跑，不因首个抛错中断
});
```
> 若 `fireDisconnect` 私有不可达，通过 `disconnect()` 公共路径间接触发（disconnect 会清 handler Set，需在 disconnect 前注入——或暴露 test-only 触发器）。实现时据可达性选触发方式，诚实测试不假绿。

- [ ] **Step 7: 运行确认失败**

Run: `npx vitest run test/editor-connection.test.ts -t "B5"`
Expected: FAIL（首个 handler 抛错中断，called 只有 ['first']）。

- [ ] **Step 8: B5 实现——fireDisconnect/fireReconnect try/catch 包裹每个 handler**

`src/core/EditorConnection.ts:101-109`：

```typescript
  private fireDisconnect(): void {
    if (this._disconnectFired) return;
    this._disconnectFired = true;
    // B5: 单 handler 抛错不阻断后续 handler / scheduleReconnect（对齐 health-monitor:156-160）
    for (const handler of this.disconnectHandlers) {
      try {
        handler();
      } catch (err) {
        getLogger().warn('editor', `disconnect handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private fireReconnect(): void {
    for (const handler of this.reconnectHandlers) {
      try {
        handler();
      } catch (err) {
        getLogger().warn('editor', `reconnect handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
```

- [ ] **Step 9: 运行 B5 测试 + 全量回归**

Run: `npx vitest run test/editor-connection.test.ts test/editor-tool-executor.test.ts && npx tsc --noEmit && npx vitest run`
Expected: PASS + tsc 0 + 全量除 pre-existing T11 4 failed 外 0 新回归。

- [ ] **Step 10: Commit**

```bash
git add src/core/EditorConnection.ts src/core/EditorToolExecutor.ts test/editor-tool-executor.test.ts test/editor-connection.test.ts
git commit -m "fix(reliability): B4+B5 进程通信错误结构化（do_not_retry 全覆盖+handler 容错）

B4 reject 挂 err.code(CONNECTION_LOST/NOT_CONNECTED/REQUEST_TIMEOUT/DISCONNECTED/PARSE_ERROR)
  + Executor 合并 I-12 分支: 连接 code→do_not_retry, 插件 code→保留 code/data
  修复字符串匹配漏 Disconnected/JSON parse error(原 :93)
B5 fireDisconnect/fireReconnect try/catch 包裹每个 handler(对齐 health-monitor:156-160),
  单 handler 抛错不阻断后续 handler + scheduleReconnect"
```

---

## Task 3a: 资源写原子化——headless GDScript（B7，9 处）

**Files:**
- Modify: `src/scripts/godot_operations.gd`（加 `_save_atomic(res, path) -> int` helper；9 处 :285/:352/:406/:489/:564/:641/:689/:825/:847 改调）
- Test: `test/godot-operations-atomic.test.ts`（新建，字面量契约）；集成验证用 execute_gdscript

**Interfaces:**
- Produces: godot_operations.gd 内新增静态/顶层 helper `func _save_atomic(res: Resource, full_path: String) -> int`，返回 save error code（OK=0）；内部 tmp+rename+清理失败 tmp。9 处 `ResourceSaver.save(x, path)` 改为 `_save_atomic(x, path)`。

**★ 关键约束：**
- tmp 按目标扩展名派生：`var ext := full_path.get_extension(); var tmp := full_path + ".tmp." + ext`。**特殊：:847 目标是 .gd/.shader/.gdshader**（resave 触发 UID 生成），ext=get_extension() 自动得 "gd"/"shader"/"gdshader"，tmp 以原扩展名结尾，ResourceSaver 按扩展名分派 ScriptSaver/ShaderSaver——通用模式覆盖，**无须特判**。:641 .res 同理（ext="res"）。
- 对齐已验证范例 data-import.ts:188（`:183` full_path / `:186` tmp=get_basename()+".tmp.tres" / `:188` save / `:193` rename_absolute / `:195` remove_absolute 失败清理）。
- 脚本启动须清残留 `*.tmp.tres/*.tmp.tscn/*.tmp.res/*.tmp.gd/...`（data-import.ts 的 clean_dir 模式）。

**★ 已核实事实：** 9 处都在 godot_operations.gd，目标扩展名分布：.tscn(7: 285/352/406/489/564/689/825) + .res(1: 641) + .gd/.shader/.gdshader(1: 847)。

- [ ] **Step 1: 写字面量契约失败测试（helper 存在 + 9 处改调 + 无直写目标残留）**

`test/godot-operations-atomic.test.ts` 新建：

```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('B7 godot_operations.gd 资源写原子化', () => {
  const src = readFileSync('src/scripts/godot_operations.gd', 'utf8');

  it('定义 _save_atomic helper（tmp 按目标扩展名派生 + rename + 失败清理）', () => {
    expect(src).toContain('func _save_atomic(');
    expect(src).toMatch(/get_extension\(\)/);
    expect(src).toContain('".tmp."');
    expect(src).toContain('DirAccess.rename_absolute');
    expect(src).toContain('DirAccess.remove_absolute'); // rename 失败清理 tmp
  });

  it('9 处资源写改调 _save_atomic（无 ResourceSaver.save 直写目标）', () => {
    // helper 内部允许 1 处 ResourceSaver.save(tmp)，其余全走 _save_atomic
    const saveMatches = src.match(/ResourceSaver\.save/g) ?? [];
    expect(saveMatches.length).toBeLessThanOrEqual(1); // 仅 helper 内 1 处
    const atomicCalls = src.match(/_save_atomic\(/g) ?? [];
    expect(atomicCalls.length).toBeGreaterThanOrEqual(9); // 9 处调用点
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/godot-operations-atomic.test.ts`
Expected: FAIL（无 _save_atomic；ResourceSaver.save 计数=9 > 1）。

- [ ] **Step 3: 实现 `_save_atomic` helper**

`src/scripts/godot_operations.gd` 顶层（class/文件作用域，参照既有 helper 风格如 `_count_number_components`）加：

```gdscript
# B7: 原子化资源写——tmp+rename 防超时 kill 落在 save 中途产半截损坏 .tres/.tscn 阻塞项目加载。
# tmp 必须以目标扩展名结尾(ResourceSaver 按扩展名分派 saver, 裸 .tmp 返回 err 15)。
# 对齐 data-import.ts:188 已验证范例 + memory resourcesaver-extension-dispatch。
func _save_atomic(res, full_path: String) -> int:
	var ext := full_path.get_extension()  # tres/res/tscn/gd/shader/gdshader
	var tmp := full_path + ".tmp." + ext
	var save_err: int = ResourceSaver.save(res, tmp)
	if save_err != OK:
		DirAccess.remove_absolute(tmp)  # save 失败清半截 tmp
		return save_err
	var rename_err: int = DirAccess.rename_absolute(tmp, full_path)
	if rename_err != OK:
		DirAccess.remove_absolute(tmp)  # rename 失败清 tmp
		return rename_err
	return OK
```

- [ ] **Step 4: 9 处改调 `_save_atomic`**

逐处把 `ResourceSaver.save(<res>, <path>)` 改为 `_save_atomic(<res>, <path>)`，保留外层错误处理（`if err != OK: ...`）。行号快照：285/352/406/489/564/641/689/825/847——实现时 grep `ResourceSaver.save` 定位实际行。
> :847 特殊（目标 .gd/.shader/.gdshader）：`_save_atomic(res, script_path)` 直接用，ext 自动派生正确 saver。

- [ ] **Step 5: 编译验证 + 字面量测试通过**

Run: `npm run check:gdscript && npx vitest run test/godot-operations-atomic.test.ts`
Expected: check:gdscript errors=0 warnings=0；字面量测试 PASS（ResourceSaver.save 计数 1，_save_atomic 调用 ≥9）。

- [ ] **Step 6: 集成验证（实跑 tmp+rename，对齐 P2-1 csv integration）**

用 execute_gdscript 实跑一次原子写（在 test/fixtures 或临时项目）：
```
# 构造一个 Resource, 调 _save_atomic 写到 tmp 路径, 验证: 目标文件存在 + 无 .tmp.* 残留 + 内容正确
```
> 若无干净 Godot 环境（mcp-verify 子项目可用），用 `execute_gdscript` 片段：load 一个 .tres → `_save_atomic(res, "res://tmp_verify.tres")` → 检查 `FileAccess.file_exists("res://tmp_verify.tres")` 且无 `tmp_verify.tmp.tres`。**诚实**：若 L2 环境不可用则记为手动验收项（spec 验收 #9 同 P2-1），不假绿。

- [ ] **Step 7: 全量回归 + Commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0 + 除 pre-existing T11 外 0 新回归。

```bash
git add src/scripts/godot_operations.gd test/godot-operations-atomic.test.ts
git commit -m "fix(reliability): B7 headless 资源写原子化（godot_operations.gd 9 处 _save_atomic）

加 _save_atomic(res,path) helper: tmp+rename 原子提交, tmp 按目标扩展名派生(.tmp.tres/.tmp.tscn/.tmp.res/.tmp.gd),
  save/rename 失败清 tmp。对齐 data-import.ts:188 已验证范例。
9 处 ResourceSaver.save 改调: create_scene/add_node/edit_node/batch_add_nodes/load_sprite/
  export_mesh_library/save_scene/resave_resources(.tscn + .gd/.shader resave UID)"
```

---

## Task 3b: 资源写原子化——addons + TS 生成（B7，8 处）

**Files:**
- Modify: `addons/godot_mcp_server/commands/command_helpers.gd`（加 `_save_atomic` helper，addons 侧）
- Modify: `addons/godot_mcp_server/commands/ui_commands.gd`（2 处 :269/:373 改调）
- Modify: `addons/godot_mcp_server/commands/asset/asset_commands.gd`（1 处 :120 改调）
- Modify: `src/tools/ui/ui-theme.ts`（2 处 :58/:141 内联 tmp+rename）
- Modify: `src/tools/scene/scene-commit.ts`（1 处 :118 内联）
- Modify: `src/tools/scene/scene-instance.ts`（1 处 :26 内联）
- Modify: `src/tools/material-ops.ts`（1 处 :354 内联）
- Test: `test/resource-write-atomic.test.ts`（新建，字面量契约覆盖 addons + TS）

**Interfaces:**
- Produces: addons 侧 `command_helpers.gd._save_atomic(res, path)`（与 3a 同模式，独立 GDScript 上下文不共享 headless helper）；TS 生成片段每处内联 tmp+rename GDScript 块（对齐 data-import.ts:188，不共享 helper）。

**★ 已核实事实：**
- addons：ui_commands.gd:269/373（.tres theme）、asset_commands.gd:120（.tscn PackedScene）、command_helpers.gd **无** ResourceSaver.save（可放 helper）。
- TS：实际路径在子目录 `src/tools/ui/ui-theme.ts`(:58/:141)、`src/tools/scene/scene-commit.ts`(:118)、`src/tools/scene/scene-instance.ts`(:26)、`src/tools/material-ops.ts`(:354)——spec 写的扁平路径需据此修正。
- TS 片段是模板字符串/数组拼接生成的 GDScript 字面量，每处独立改 tmp+rename 块。

- [ ] **Step 1: 写字面量契约失败测试**

`test/resource-write-atomic.test.ts` 新建，覆盖 addons 3 处 + TS 5 处：

```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const files = {
  commandHelpers: 'addons/godot_mcp_server/commands/command_helpers.gd',
  uiCommands: 'addons/godot_mcp_server/commands/ui_commands.gd',
  assetCommands: 'addons/godot_mcp_server/commands/asset/asset_commands.gd',
  uiTheme: 'src/tools/ui/ui-theme.ts',
  sceneCommit: 'src/tools/scene/scene-commit.ts',
  sceneInstance: 'src/tools/scene/scene-instance.ts',
  materialOps: 'src/tools/material-ops.ts',
};

describe('B7 addons + TS 资源写原子化', () => {
  it('addons command_helpers.gd 定义 _save_atomic', () => {
    const src = readFileSync(files.commandHelpers, 'utf8');
    expect(src).toContain('func _save_atomic(');
    expect(src).toContain('rename_absolute');
  });
  it('addons ui_commands.gd + asset_commands.gd 改调 _save_atomic（无直写目标）', () => {
    for (const f of [files.uiCommands, files.assetCommands]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/ResourceSaver\.save\([^)]+,\s*save_path\)/); // 不直写目标
      expect(src).toContain('_save_atomic(');
    }
  });
  it('TS 生成片段含 tmp+rename 原子模式（对齐 data-import.ts:188）', () => {
    for (const f of [files.uiTheme, files.sceneCommit, files.sceneInstance, files.materialOps]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/\.tmp\./);               // tmp 派生扩展名
      expect(src, f).toMatch(/rename_absolute/);       // 原子提交
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/resource-write-atomic.test.ts`
Expected: FAIL（addons 无 helper；TS 无 tmp/rename）。

- [ ] **Step 3: 实现 addons `_save_atomic` + 3 处改调**

`addons/godot_mcp_server/commands/command_helpers.gd` 加（与 3a 同模式，独立 helper）：
```gdscript
# B7: 原子化资源写——tmp+rename 防超时 kill 产半截损坏资源阻塞项目加载。
# tmp 按目标扩展名派生(裸 .tmp 返回 err 15)。对齐 data-import.ts:188。
static func _save_atomic(res, full_path: String) -> int:
	var ext := full_path.get_extension()
	var tmp := full_path + ".tmp." + ext
	var save_err: int = ResourceSaver.save(res, tmp)
	if save_err != OK:
		DirAccess.remove_absolute(tmp)
		return save_err
	var rename_err: int = DirAccess.rename_absolute(tmp, full_path)
	if rename_err != OK:
		DirAccess.remove_absolute(tmp)
		return rename_err
	return OK
```
> `static` 与否参照 command_helpers.gd 既有 helper 风格（如 `has_path_traversal` 是 static）。3 处调用改为 `CommandHelpers._save_atomic(...)`（或实例形式，据 helper 定义）：
> - ui_commands.gd:269 `ResourceSaver.save(theme, save_path)` → `CommandHelpers._save_atomic(theme, save_path)`
> - ui_commands.gd:373 同
> - asset_commands.gd:120 `ResourceSaver.save(pkg, res_path)` → `CommandHelpers._save_atomic(pkg, res_path)`

- [ ] **Step 4: 实现 TS 5 处内联 tmp+rename**

每处把单行 `var err = ResourceSaver.save(x, "${path}")` 改为多行原子块（对齐 data-import.ts:186-195）。以 material-ops.ts:354 为例（其余 4 处同构，变量名按各处）：

```typescript
// 原行 354:
// `\tvar err = ResourceSaver.save(mat, "${gdEscape(resourcePath)}")`
// 改为:
`\tvar _full := "${gdEscape(resourcePath)}"
\tvar _ext := _full.get_extension()
\tvar _tmp := _full + ".tmp." + _ext
\tvar err := ResourceSaver.save(mat, _tmp)
\tif err != OK:
\t\tDirAccess.remove_absolute(_tmp)
\t\t_mcp_output("error", "Failed to save resource: " + str(err))
\t\t_mcp_done()
\tvar _ren := DirAccess.rename_absolute(_tmp, _full)
\tif _ren != OK:
\t\tDirAccess.remove_absolute(_tmp)
\t\t_mcp_output("error", "Failed to rename tmp: " + str(_ren))
\t\t_mcp_done()`
```
> 注意各 TS 文件的模板语法（ui-theme.ts/scene-commit.ts 用反引号模板；scene-instance.ts 用字符串拼接数组）。逐处保留原错误处理语义（_mcp_done / _mcp_output / quit 风格）。
> scene-commit.ts:118 / scene-instance.ts:26 是 PackedScene → .tscn（ext="tscn"）；ui-theme.ts:58/141 + material-ops.ts:354 是 .tres（ext="tres"）。通用块覆盖。

- [ ] **Step 5: 编译 + 字面量测试通过**

Run: `npm run check:gdscript && npx tsc --noEmit && npx vitest run test/resource-write-atomic.test.ts`
Expected: check:gdscript 0/0（addon 编译）+ tsc 0 + 字面量测试 PASS。

- [ ] **Step 6: 全量回归 + Commit**

Run: `npx vitest run`
Expected: 除 pre-existing T11 外 0 新回归。

```bash
git add addons/godot_mcp_server/commands/command_helpers.gd addons/godot_mcp_server/commands/ui_commands.gd addons/godot_mcp_server/commands/asset/asset_commands.gd src/tools/ui/ui-theme.ts src/tools/scene/scene-commit.ts src/tools/scene/scene-instance.ts src/tools/material-ops.ts test/resource-write-atomic.test.ts
git commit -m "fix(reliability): B7 addons+TS 资源写原子化（8 处 _save_atomic / 内联 tmp+rename）

addons command_helpers.gd 加 _save_atomic(独立 GDScript 上下文, 不共享 headless), ui_commands.gd:269/373 + asset_commands.gd:120 改调
TS 生成 5 处(ui-theme.ts:58/141, scene-commit.ts:118, scene-instance.ts:26, material-ops.ts:354)内联 tmp+rename 块, 对齐 data-import.ts:188
共 8 处. 加上 Task3a headless 9 处 = 17 处全原子化"
```

---

## Task 4: Advisory（B8+B9+B10）

**Files:**
- Modify: `src/core/EditorConnection.ts`（B8：isConnected:535 JSDoc；B10：authTimeoutMs 选项 :13/:406-413）
- Modify: `src/GodotServer.ts`（B10：establishEditorConnection:446 传 authTimeoutMs 或用默认——保持 10000 不改默认行为）
- Modify: `.claude/rules/godot-mcp-core.md`（B9：orphan 段补 opt-in env 说明）

**Interfaces:**
- Produces: `EditorConnectionOptions.authTimeoutMs?: number`（默认 10000，保持现状）；`isConnected()` JSDoc 注明活性语义；orphan rule 文档补 `GODOT_MCP_FULL_SYSTEM_SCAN` opt-in 说明（若已有则校准措辞）。

**★ 已核实事实：**
- `EditorConnection.ts:535-537` isConnected 返 `this.connected`（仅 ws open flag，非 TCP 实时活性）。
- `EditorConnection.ts:406/413` `}, 10000);` authTimeout 硬编码。
- `.claude/rules/godot-mcp-core.md` orphan 段已有 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 说明（核查快照）——B9 校准/补全 opt-in「防误杀是有意设计」措辞。

- [ ] **Step 1: B8 isConnected JSDoc**

`src/core/EditorConnection.ts:535`：

```typescript
  /**
   * B8: 连接活性语义说明。
   * 仅反映 ws 'open'/'close' 事件后的 connected flag, 非TCP 实时活性——
   * TCP 半开(对端 accept 不响应不 close)时此方法仍返回 true。
   * 实时活性检测见 HealthMonitor 心跳(health-monitor.ts startHeartbeat + ping)。
   */
  isConnected(): boolean {
    return this.connected;
  }
```

- [ ] **Step 2: B10 authTimeoutMs 参数化**

`src/core/EditorConnection.ts`：
(a) `EditorConnectionOptions`（:13）加字段：
```typescript
  authTimeout?: number;
```
(b) 构造器（:125-139，与其他 timeout 字段并列）加：
```typescript
  private readonly authTimeoutMs: number;
  // 构造器体内:
  this.authTimeoutMs = options.authTimeout ?? 10000;
```
(c) performAuth（:406）`}, 10000);` 改 `}, this.authTimeoutMs);`

- [ ] **Step 3: B10 GodotServer 调用点（保持默认行为）**

`src/GodotServer.ts:446` `new EditorConnection({ port, reconnect: true, secret })` —— **不传 authTimeout**（用默认 10000，保持现状）。仅参数化使其可配（未来需要时可在 GodotServer 注入）。若 reviewer 认为应显式传 10000 以自文档化，则加 `authTimeout: 10000`——实现时与 reviewer 商定，默认不传。

- [ ] **Step 4: B9 orphan rule 文档补 opt-in 说明**

`.claude/rules/godot-mcp-core.md` orphan 段（已有 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 处），补/校准措辞强调 opt-in 防误杀是有意设计：

```markdown
- **崩溃恢复 opt-in 是有意设计（B9）**：默认 `stop_project` 仅清本会话 PID 集合（防多会话误杀编辑器/游戏进程）。崩溃恢复（MCP server 重启后内存 PID 集合丢失）需显式设 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 才恢复全系统扫描兜底——这是 opt-in 而非默认，因为全系统扫描按目录匹配会清所有匹配的 Godot 进程，多会话环境下会误杀。默认保守是有意设计，不改。
```
> 实现时先 grep `GODOT_MCP_FULL_SYSTEM_SCAN` 在 core.md 定位现有段落，若已充分说明则仅补「opt-in 防误杀是有意设计」一句；勿重复。

- [ ] **Step 5: 验证 + Commit**

Run: `npx tsc --noEmit && npx vitest run test/editor-connection.test.ts`
Expected: tsc 0 + editor-connection 测试全绿（authTimeoutMs 默认 10000 行为不变）。

```bash
git add src/core/EditorConnection.ts src/GodotServer.ts .claude/rules/godot-mcp-core.md
git commit -m "fix(reliability): B8+B9+B10 advisory（isConnected 活性 JSDoc + authTimeoutMs 参数化 + orphan opt-in 文档）

B8 isConnected JSDoc 注明仅 ws flag 非 TCP 实时活性, 活性见 HealthMonitor 心跳
B10 authTimeoutMs 参数化(默认 10000 保持现状), performAuth :406 改用 this.authTimeoutMs
B9 core.md orphan 段补 opt-in 防误杀是有意设计说明"
```

---

## Task 5: defects detect 守卫 + CHANGELOG

**Files:**
- Modify: `src/defects.ts`（B1-B10 新增 finding 登记；FIXED 段 detect===0；OPEN 段若有则 baseline）
- Modify: `test/defects-fixed.test.ts`（FIXED 计数同步）
- Modify: `test/defects-open.test.ts`（若涉及 OPEN baseline）
- Modify: `CHANGELOG.md`（批次 B 可靠性段）

**Interfaces:**
- Produces: defects.ts 新增 B1-B10 detect 闭包（FIXED 类返回 0；参考批次 A Task8 的 detect 模式：内联非 global 字面量正则，每次新建）。CHANGELOG 批次 B 条目。

**★ defect 登记策略（参考批次 A Task8 + csv P2-1 Task3）：**
- **FIXED（detect===0 硬断言）**：B1（health-monitor 无差别 consecutiveFails 累加已分流——detect 查 evaluateState 是否用 consecutiveHeartbeatFails）、B2（handleEditorStall 无 disconnect——detect 查 handleEditorStall 函数体含 disconnect）、B3（ping 复用 30s——detect 查 pingFn 含 timeoutMs）、B5（fireDisconnect/fireReconnect 裸迭代——detect 查 try/catch）、B7（资源写非原子——detect 查 17 处改 _save_atomic/无直写目标，分 3 环境）、B4（do_not_retry 字符串匹配——detect 查 CONN_ERROR_CODES）、B8（isConnected 无 JSDoc——detect 查 JSDoc）、B10（authTimeout 硬编码——detect 查 authTimeoutMs）。
- **ADVISORY（不登记 detect，文档类）**：B9（orphan 文档）。
- **B6**（重建 setState）：与 B1 同状态机，登记 FIXED detect 查 establishEditorConnection 含 setState('connected')。

- [ ] **Step 1: defects.ts 登记 B1-B10 detect 闭包**

`src/defects.ts` 参考 Task8 模式（批次 A）。每个 FIXED finding 加 detect 闭包返回 number（0=已修复）。**正则须内联非 global 字面量每次新建**（批次 A Minor① 教训，避 RegExp.test+global lastIndex bug）。

示例 B1 detect（实现时据 defects.ts 实际结构 / 既有 FIXED 段格式）：
```typescript
{
  id: 'health-monitor-tool-error-misdegrade',
  severity: 'IMPORTANT',
  detect: () => {
    // B1: evaluateState 应改用 consecutiveHeartbeatFails(仅 heartbeat 驱动 reconnecting)
    const src = readFileSync('src/core/health-monitor.ts', 'utf8');
    return src.includes('consecutiveHeartbeatFails >= this.opts.maxConsecutiveFailures') ? 0 : 1;
  },
},
```
> 其余 B2-B8/B10 detect 闭包同理（查各 task 的修复标记字面量）。B7 资源写 detect 分 3 环境（godot_operations.gd / addons / TS），每环境查 _save_atomic 或无直写目标。实现时忠实各 task 修复模式。

- [ ] **Step 2: 同步 defects-fixed.test.ts 计数**

`test/defects-fixed.test.ts` 的 FIXED 计数（头注释 + 条目数 + toBe 断言）同步新增 B1-B8/B10（9 条 FIXED，B9 advisory 不入）。

- [ ] **Step 3: RED→GREEN 验证 detect 有效**

临时 revert 一处修复（如 health-monitor evaluateState 改回 consecutiveFails）→ 跑 `npx vitest run test/defects-fixed.test.ts` 红（detect>0）→ restore 复绿。**铁证 detect 非假绿**（对齐 P2-1 Task3）。

- [ ] **Step 4: CHANGELOG 批次 B 段**

`CHANGELOG.md` 加（参照批次 A Security 段风格）：

```markdown
## 可靠性（批次 B，2026-07-23）

10 条可靠性 finding 修复（5 份审查：专项2 可靠性 4 条 + 通用版进程通信 6 条）：

- **降级链路统一（B1+B2+B3+B6）**：B1 evaluateState 按 errorType 分流（仅 heartbeat 驱动 reconnecting，工具失败不再误降级）；B3 心跳用独立 5s 超时（原复用 30s，TCP 半开降级 ~225s→~85s）；B2 handleEditorStall disconnect 清 zombie；B6 重建后 setState('connected') 即刻复位。
- **进程通信（B4+B5）**：B4 连接类错误结构化 err.code（do_not_retry 覆盖 Disconnected/JSON parse error，Executor 合并 I-12 分支）；B5 fireDisconnect/fireReconnect try/catch 容错。
- **资源写原子化（B7）**：17 处 ResourceSaver.save 改 tmp+rename 原子提交（三环境：headless godot_operations.gd 9 处 + addons 3 处 + TS 生成 5 处），防超时 kill 产半截损坏资源阻塞项目加载。
- **advisory（B8+B9+B10）**：isConnected 活性语义 JSDoc；orphan 崩溃恢复 opt-in 文档；authTimeoutMs 参数化。
```

- [ ] **Step 5: 全量回归 + Commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0 + defects-fixed/open 测试全绿 + 除 pre-existing T11 外 0 新回归。

```bash
git add src/defects.ts test/defects-fixed.test.ts test/defects-open.test.ts CHANGELOG.md
git commit -m "test(reliability): 批次 B defects detect 守卫 + CHANGELOG（B1-B10）

defects.ts 加 B1-B8/B10 detect 闭包(FIXED 返回 0) + B9 advisory 文档不计;
defects-fixed 计数同步; RED→GREEN 验证 detect 有效(临时 revert→红→restore→绿);
CHANGELOG 批次 B 可靠性段(降级链路/进程通信/资源写原子化/advisory)"
```

---

## Self-Review（写完后自查，已执行）

**1. Spec coverage**：
- B1（evaluateState 分流）→ Task1 Step4 ✓
- B2（handleEditorStall disconnect）→ Task1 Step11 ✓
- B3（ping 独立超时）→ Task1 Step7 ✓
- B4（do_not_retry err.code）→ Task2 Step3-4 ✓（含 I-12 分支合并关键交互）
- B5（fireDisconnect/fireReconnect try/catch）→ Task2 Step8 ✓
- B6（重建 setState）→ Task1 Step13 ✓（并入组1，spec 许可）
- B7（17 处原子化）→ Task3a(9) + Task3b(8) ✓
- B8（isConnected JSDoc）→ Task4 Step1 ✓
- B9（orphan opt-in 文档）→ Task4 Step4 ✓
- B10（authTimeoutMs）→ Task4 Step2 ✓
- 验收#5 defects detect → Task5 ✓；验收#6 CHANGELOG → Task5 Step4 ✓；验收#4 回归门禁 → 每 task Step ✓

**2. Placeholder scan**：无 TBD/TODO；所有代码步骤含实际代码；行号标注「快照，grep 为准」非占位。

**3. Type consistency**：
- `consecutiveHeartbeatFails`（Task1 定义）↔ Task5 B1 detect 查同一字面量 ✓
- `request(method, params, options?: {timeoutMs?})`（Task1 定义）↔ GodotServer pingFn 调用一致 ✓
- `Object.assign(new Error(...), { code })` 挂 code（Task2 定义）↔ Executor 读 `err.code` 一致 ✓
- `_save_atomic(res, full_path)` 签名（Task3a/3b）↔ detect 查 `func _save_atomic(` 一致 ✓
- `authTimeoutMs`（Task4 定义）↔ performAuth 使用一致 ✓

**4. 跨 task 裂缝**：B6 并入 Task1（同 health-monitor 状态机 + establishEditorConnection 方法），消除 B1-B6 跨 task 裂缝；Task2 EditorConnection 与 Task1 EditorConnection 不同函数（request vs reject 站点），顺序执行不冲突；Task3a/3b/4 与 Task1/2 文件不重叠（除 Task4 GodotServer:446 不传 authTimeout 不改），可并行但建议顺序。

**5. 偏离 spec 记录**：
- **B6 并入组1**（spec 列组2）：因 B6 与 B1 共享状态机 + B6 在 establishEditorConnection（Task1 B3 pingFn 同方法）+ 批次 A I1 裂缝教训。spec「裂缝风险高时 B6 并入组1」许可。final review 须确认此偏离合理。
- **B4 合并 I-12 分支**（spec 未提及此交互）：核查发现 EditorToolExecutor:81 的 I-12 分支会吞带 code 错误，B4 必须合并两分支否则破坏 do_not_retry。Task2 Step4 已处理。
