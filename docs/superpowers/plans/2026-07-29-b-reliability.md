# B-Reliability 可靠性修复批次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-07-29 可靠性专项审查的 5 条 open finding（3 P1 + 2 P2），对齐 nav bake 请求超时、清理 headless spawn orphan、心跳降级区分 timeout/refused 不抢占自动重连、半开 HOL 预检、全系统扫跳过 --editor 进程。#6（只读并发）defer 独立架构 follow-up，#7（CR-3）已文档化知情接受。

**Architecture:** B 批次聚焦进程通信/崩溃恢复/并发。5 条互相独立，按"简单建立节奏 → 中等 → 最复杂状态机放后"排序。每条 TDD（RED→GREEN），可靠性类须含反向断言（降级/不降级/清理/预检），每修补 `defects.ts` detect 防复发（#1/#2/#4 当前零 detect）。#3 心跳降级采用 pingFn catch 分流 err.code（REQUEST_TIMEOUT→降级；NOT_CONNECTED/CONNECTION_LOST→让 EditorConnection 自动重连兜底，不抢占）。

**Tech Stack:** TypeScript（src/core/）、vitest、defects.ts CI 门禁。本批无 .gd 改动（纯 TS 进程通信层）。

## 关键决策（已与用户对齐）

1. **#3 心跳降级策略**：catch 分流 + 不抢占重连。pingFn catch 保留 err.code；onStateChange(reconnecting) handler 区分——REQUEST_TIMEOUT（TCP OPEN 主线程卡死）→ handleEditorStall 降级；NOT_CONNECTED/CONNECTION_LOST（下线/拒绝）→ 不降级，让 EditorConnection 20 次退避自动重连兜底。重连成功后 health-monitor 复位 connected（避免卡 reconnecting）。
2. **#6 只读并发 defer**：改 executeChain 串行模型是架构级（影响 A0 串行不变量测试 + race 风险），留独立架构 spec/brainstorm。本批不含 #6。
3. **#7 CR-3 不做**：process-state.ts:109 注释已显式"intentionally NOT enqueued"知情接受，符合 finding 自带验收。

## Global Constraints

- master 不 push，push 须 AskUserQuestion 显式确认（[[user-prefers-local-ahead-no-push]]）
- 每条补 `test/regression/defects.ts` detect 防复发（#1/#2/#4 当前零 detect，必补；行号/计数基线写前 grep 实测，[[plan-baseline-verify-grep]]）
- 可靠性类须含**反向断言**（降级触发/不触发、orphan 清空、预检拒绝、超时对齐）
- TS 改后 `tsc` 0；本批无 .gd 故无 check:gdscript（除非误改 .gd）
- 进程通信改动须跨文件查调用链（[[subagent-verification-call-chain]]）——EditorConnection/health-monitor/GodotServer/EditorToolExecutor 协调，尤其 #3/#4
- 验收门禁：tsc 0 / eslint 0 errors / vitest 全 passed（4 pre-existing T11 elicitation baseline 确认非回归）/ defects-fixed 全绿
- 缺陷计数：A-RCE 后 105 FIXED，本批 +5 detect → 110（实测核实头注）

## File Structure

| 文件 | 职责 | 涉及 Task |
|---|---|---|
| `src/core/EditorToolExecutor.ts` | nav bake request timeoutMs（:90）+ _executeInner HOL 预检（:58）+ 构造器注入 healthMonitor（:31） | T1/T3 |
| `src/core/process-state.ts` | fullSystemScanGodot 过滤跳过 --editor（:422） | T2 |
| `src/gdscript-executor.ts` + `src/GodotServer.ts` | spawn 注册 _spawnedGodotPids（:1192）+ close 清理 in-flight（:542） | T4 |
| `src/GodotServer.ts` + `src/core/health-monitor.ts` | pingFn catch 分流 err.code（:480）+ onStateChange 区分降级（:485）+ 重连复位 | T5 |
| `test/regression/defects.ts` | 5 条新 detect（#1/#2/#3/#4/#5） | T6 |
| `CHANGELOG.md` | [Unreleased] B-Reliability 段 | T7 |

---

## Task 1: nav bake 请求超时对齐

**Files:**
- Modify: `src/core/EditorToolExecutor.ts:90`
- Test: `test/core/editor-tool-executor.test.ts`（既有或新建）

**Interfaces:**
- Consumes: `NAV_BAKE_OP_TIMEOUT_SEC = 110`（:85 已就位）、`this.conn.request(method, args, options?)`（EditorConnection.ts:328，第三参 `{timeoutMs}`）
- Produces: nav bake request 用 110s timeout，消除 >30s 烘焙误报 editor_disconnected/do_not_retry

**背景**：`:90 conn.request(method, finalArgs)` 只传 2 参，用默认 requestTimeoutMs=30s（EditorConnection.ts:152）。nav bake `startOperation(110)` 但 request 30s → >30s 烘焙命中 REQUEST_TIMEOUT（EditorConnection.ts:359）→ isConnectionError → editor_disconnected + do_not_retry（:138/141），GD 实际烘成但客户端禁重试。

- [ ] **Step 1: 写失败测试（RED）**

```typescript
it('nav bake request uses 110s timeout (not default 30s)', async () => {
  // mock conn.request 捕获 timeoutMs 参数
  const requestArgs: any[] = [];
  const conn = { request: async (m: string, a: any, o?: any) => { requestArgs.push({ m, o }); return { ok: true }; },
    startOperation: async () => {}, endOperation: async () => {}, addOnDisconnectHandler: () => {}, addOnReconnectHandler: () => {}, removeOnDisconnectHandler: () => {}, removeOnReconnectHandler: () => {} };
  const exec = new EditorToolExecutor(conn as any);
  await exec.execute('nav', { action: 'bake_mesh' });  // method 解析为 nav_bake_mesh
  // 断言 request 收到 timeoutMs=110000
  expect(requestArgs.some(r => r.o?.timeoutMs === 110000)).toBe(true);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run test/core/editor-tool-executor.test.ts -t "nav bake"`
Expected: FAIL（request 未收到 timeoutMs=110000）

- [ ] **Step 3: 实现（一行改）**

`src/core/EditorToolExecutor.ts:90`：
```typescript
const result = await this.conn.request(method, finalArgs, { timeoutMs: NAV_BAKE_OP_TIMEOUT_SEC * 1000 });
```
注：`:100` 非 nav bake 的 `conn.request(method, finalArgs)` 保持默认 30s（不变）。

- [ ] **Step 4: 运行验证通过（GREEN）**

Run: `npx vitest run test/core/editor-tool-executor.test.ts`
Expected: PASS

- [ ] **Step 5: 补 defects.ts detect（T6 统一做，此处先记 key）**

key: `nav-bake-request-timeout-misalign`（detect：EditorToolExecutor nav bake 分支 conn.request 含 timeoutMs: NAV_BAKE_OP_TIMEOUT_SEC）

- [ ] **Step 6: 门禁 + commit**

Run: `npx tsc --noEmit && npx vitest run test/core/editor-tool-executor.test.ts`
Commit:
```bash
git add src/core/EditorToolExecutor.ts test/core/editor-tool-executor.test.ts
git commit -m "fix(reliability): nav bake request 超时对齐 110s

conn.request(method, finalArgs, {timeoutMs: NAV_BAKE_OP_TIMEOUT_SEC*1000}),
消除 >30s 烘焙命中 REQUEST_TIMEOUT→editor_disconnected/do_not_retry(GD 实际
烘成但客户端禁重试)。非 nav bake 保持默认 30s。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 全系统扫跳过 --editor 进程

**Files:**
- Modify: `src/core/process-state.ts`（fullSystemScanGodot PowerShell 过滤 :421-422 + sh 分支）
- Test: `test/core/process-state.test.ts`（既有或新建）

**Interfaces:**
- Consumes: `fullSystemScanGodot`（:405，opt-in GODOT_MCP_FULL_SYSTEM_SCAN）
- Produces: 全系统扫描跳过 `--editor` 进程，不误杀同项目编辑器

**背景**：`:421-422` Windows PowerShell 过滤 `Name LIKE 'Godot%' + CommandLine -like '*--path*' + CommandLine.Contains($path)` 不跳 `--editor`。同项目 `godot --path /proj --editor`（编辑器）匹配即被 taskkill /F /T 误杀。opt-in 默认关缓解，但开启即误杀。15s WMI 已 spawn 异步（非同步阻塞），本 task 只改过滤。

- [ ] **Step 1: 写失败测试（RED）**

```typescript
it('fullSystemScanGodot filter excludes --editor processes', () => {
  // 读 buildScanCommand 或过滤逻辑,断言含 --editor 排除条件
  const src = readFileSync('src/core/process-state.ts', 'utf-8');
  const psBlock = src.match(/Name LIKE 'Godot%'][\s\S]{0,400}?taskkill/);
  expect(psBlock, 'PowerShell filter block found').toBeTruthy();
  // 反向:过滤须排除 --editor
  expect(psBlock![0]).toMatch(/--editor|not.*editor/i);
});
```
（若 fullSystemScanGodot 难单测，用字面量契约测试读源码断言过滤条件，参 defects detect 模式）

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run test/core/process-state.test.ts -t "editor"`
Expected: FAIL（过滤不含 --editor 排除）

- [ ] **Step 3: 实现过滤跳过 --editor**

`src/core/process-state.ts` Windows PowerShell 过滤（:421-422 附近）加 `--editor` 排除：
```powershell
# 原: Where { $_.Name -like 'Godot*' -and $_.CommandLine -like '*--path*' -and $_.CommandLine.Contains('<path>') }
# 改: 加 -not like '*--editor*' 排除编辑器进程(同项目编辑器不该被误杀)
Where { $_.Name -like 'Godot*' -and $_.CommandLine -like '*--path*' -and $_.CommandLine.Contains('<path>') -and -not ($_.CommandLine -like '*--editor*') }
```
POSIX sh 分支（若 :466 附近有 `ps`/`pgrep` 过滤）同理加 `--editor` 排除。implementer 先 Read 确认 POSIX 分支结构。

- [ ] **Step 4: 运行验证通过（GREEN）**

Run: `npx vitest run test/core/process-state.test.ts`
Expected: PASS

- [ ] **Step 5: 补 defects.ts detect（T6）**

key: `fullsystem-scan-kills-editor`（detect：fullSystemScanGodot 过滤含 --editor 排除）

- [ ] **Step 6: 门禁 + commit**

Run: `npx tsc --noEmit && npx vitest run test/core/process-state.test.ts`
Commit:
```bash
git add src/core/process-state.ts test/core/process-state.test.ts
git commit -m "fix(reliability): 全系统扫跳过 --editor 进程防误杀

fullSystemScanGodot PowerShell/sh 过滤加 --editor 排除, opt-in 开启时不误杀
同项目编辑器进程。15s WMI 已异步(非本 task 范围)。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 半开 HOL 预检（_executeInner healthMonitor.getState）

**Files:**
- Modify: `src/core/EditorToolExecutor.ts`（构造器 :31 + _executeInner :58）+ `src/GodotServer.ts`（establishEditorConnection :469 传 hm）
- Test: `test/core/editor-tool-executor.test.ts`

**Interfaces:**
- Consumes: `HealthMonitor.getState(): HealthState`（health-monitor.ts，返回 'connected'|'reconnecting'|'degraded'|...）、`HealthMonitor` 引用（GodotServer.getHealthMonitor()）
- Produces: _executeInner 入口 reconnecting 时即时返 NOT_CONNECTED，跳过 30s HOL 等待

**背景**：EditorToolExecutor 构造器 :31 只注入 conn，不持 healthMonitor；_executeInner :58 直接 conn.request，无 getState 预检。TCP 半开时 conn.connected=true → request 挂满 30s；串行链 ×30s HOL 放大。

- [ ] **Step 1: 写失败测试（RED）**

```typescript
it('HOL precheck: reconnecting state returns NOT_CONNECTED immediately', async () => {
  const hm = { getState: () => 'reconnecting' } as any;
  const conn = { request: async () => { throw new Error('should not reach'); }, /* ... */ } as any;
  const exec = new EditorToolExecutor(conn, hm);  // 新增 hm 参数
  const r = await exec.execute('editor', { action: 'get_scene_tree' });
  // 反向:reconnecting 即时返 NOT_CONNECTED, 不调 conn.request
  expect(r.isError).toBeTruthy();
  expect(JSON.stringify(r)).toMatch(/NOT_CONNECTED|reconnecting/i);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run test/core/editor-tool-executor.test.ts -t "HOL"`
Expected: FAIL（构造器不接受 hm，或 _executeInner 无预检）

- [ ] **Step 3: 实现注入 + 预检**

`src/core/EditorToolExecutor.ts`：
```typescript
// 构造器 :31 改
private readonly healthMonitor?: HealthMonitor;
constructor(conn: EditorConnection, healthMonitor?: HealthMonitor) {
  this.conn = conn;
  this.healthMonitor = healthMonitor;
  this.conn.addOnDisconnectHandler(this._disconnectHandler);
  this.conn.addOnReconnectHandler(this._reconnectHandler);
}

// _executeInner :58 入口加预检（try 之前）
private async _executeInner(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  // HOL 预检:reconnecting 时即时返 NOT_CONNECTED, 跳过 30s conn.request 等待(executeChain 串行 ×30s 放大)
  if (this.healthMonitor && this.healthMonitor.getState() === 'reconnecting') {
    return opsErrorResult('NOT_CONNECTED', 'Editor is reconnecting (half-open precheck). Retry shortly.');
  }
  try {
    // ... 既有逻辑
```
`import` HealthMonitor 类型 + opsErrorResult（若未 import）。

`src/GodotServer.ts:469` 传 hm：
```typescript
const hm = this.dispatcher?.getHealthMonitor();  // :477 既有, 提前到 :469 前
this.editorExecutor = new EditorToolExecutor(this.editorConn, hm);
```
注意 :477 已有 `const hm = this.dispatcher?.getHealthMonitor()`——提取到 establishEditorConnection 前部复用。

- [ ] **Step 4: 运行验证通过（GREEN）**

Run: `npx vitest run test/core/editor-tool-executor.test.ts`
Expected: PASS（含 HOL 预检 + 既有用例不回归）

- [ ] **Step 5: 补 defects.ts detect（T6）**

key: `editor-halfopen-no-precheck`（detect：EditorToolExecutor _executeInner 含 getState()==='reconnecting' 预检）

- [ ] **Step 6: 门禁 + commit**

Run: `npx tsc --noEmit && npx vitest run test/core/editor-tool-executor.test.ts`
Commit:
```bash
git add src/core/EditorToolExecutor.ts src/GodotServer.ts test/core/editor-tool-executor.test.ts
git commit -m "feat(reliability): 半开 HOL 预检(_executeInner healthMonitor.getState)

EditorToolExecutor 构造器注入 healthMonitor, _executeInner 入口 reconnecting
时即时返 NOT_CONNECTED, 跳过 30s conn.request 等待(串行 executeChain ×30s HOL
放大)。establishEditorConnection 传 hm。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: headless spawn orphan 清理

**Files:**
- Modify: `src/gdscript-executor.ts`（spawn :1192 注册 _spawnedGodotPids + 三路径 unregister）+ `src/GodotServer.ts`（close :542 清理 in-flight）+ `src/core/process-state.ts`（暴露活跃 spawn 集合或复用 _spawnedGodotPids）
- Test: `test/gdscript-executor.test.ts` 或 `test/core/process-state.test.ts`

**Interfaces:**
- Consumes: `registerSpawnedGodotPid`/`unregisterSpawnedGodotPid`（process-state，runtime.ts:224 已用）、`forceKillTree`（gdscript-executor:25 已 import）、`_spawnedGodotPids`（process-state.ts:136）
- Produces: gdscript-executor spawn 入 _spawnedGodotPids；close/gracefulShutdown 清理 in-flight short-running spawn

**背景**：gdscript-executor.ts:1192 `spawn(godotPath, godotArgs)` 不入 _spawnedGodotPids（仅 runtime.ts:224 run_project 注册）。GodotServer.close :542 只 kill run_project 长进程。挂起脚本 + 关闭 → 孤儿无兜底；orphan 扫描默认只扫 run_project PID。

- [ ] **Step 1: 核实 process-state 接口**

Run: grep `registerSpawnedGodotPid|unregisterSpawnedGodotPid|_spawnedGodotPids|getActiveSpawnPids` in process-state.ts。确认注册/注销函数签名 + 是否有"获取活跃 spawn 集合"方法（close 清理用）。若无获取方法，需新增 `getActiveShortRunningPids()` 或类似。

- [ ] **Step 2: 写失败测试（RED）**

```typescript
it('gdscript spawn registers pid; close kills in-flight', async () => {
  // mock spawn 返回假 proc; 验证 registerSpawnedGodotPid 被调
  // + 验证 GodotServer.close 清理活跃 gdscript spawn(forceKillTree 被调)
});
```
（具体 mock 模式参既有 gdscript-executor 测试 + process-state orphan 测试）

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run test/gdscript-executor.test.ts -t "orphan"`（或 process-state）
Expected: FAIL（spawn 未注册 pid）

- [ ] **Step 4: 实现 spawn 注册 + close 清理**

`src/gdscript-executor.ts:1192` 附近：
```typescript
const proc = spawn(godotPath, godotArgs, { /* 既有 options */ });
// B批 #2: 注册到 _spawnedGodotPids, close/崩溃可清理 in-flight short-running spawn
registerSpawnedGodotPid(proc.pid);
const unregister = () => unregisterSpawnedGodotPid(proc.pid);
proc.on('exit', unregister);   // 正常 exit
proc.on('error', unregister);  // spawn 错误
// 既有 timeout/pipe-overflow 分支 :1218/:1242/:1252 的 forceKillTree(proc) 后也调 unregister
```
import `registerSpawnedGodotPid, unregisterSpawnedGodotPid`（:25 已 import process-state 函数，补这两个）。

`src/GodotServer.ts` close（:542-580）+ gracefulShutdown（index.ts:86）：清理活跃 gdscript spawn：
```typescript
// close() 内, kill run_project 长进程后, 补清理 in-flight short-running gdscript spawn
for (const pid of getActiveShortRunningPids()) {  // process-state 新增方法或复用
  try { forceKillTree({ pid } as any); } catch { /* best-effort */ }
}
```
implementer 核实 process-state 是否需新增 `getActiveShortRunningPids()`（区分 run_project PID 与 gdscript spawn PID），或 close 清理全部 _spawnedGodotPids（含 run_project，但 run_project 已单独 kill，重复 kill 无害）。

- [ ] **Step 5: 运行验证通过（GREEN）**

Run: `npx vitest run test/gdscript-executor.test.ts test/core/process-state.test.ts`
Expected: PASS

- [ ] **Step 6: 补 defects.ts detect（T6）**

key: `gdscript-spawn-not-registered`（detect：gdscript-executor spawn 后调 registerSpawnedGodotPid）

- [ ] **Step 7: 门禁 + commit**

Run: `npx tsc --noEmit && npx vitest run test/gdscript-executor.test.ts test/core/process-state.test.ts`
Commit:
```bash
git add src/gdscript-executor.ts src/GodotServer.ts src/core/process-state.ts test/
git commit -m "fix(reliability): headless gdscript spawn orphan 清理

gdscript-executor spawn 注册 _spawnedGodotPids(exit/error/timeout 三路径
unregister); GodotServer.close/gracefulShutdown 清理 in-flight short-running
spawn(原只 kill run_project 长进程, 挂起脚本+关闭→孤儿无兜底)。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 心跳降级区分 timeout/refused 不抢占重连（最复杂）

**Files:**
- Modify: `src/GodotServer.ts`（pingFn :480 catch 保留 err.code + onStateChange :485 分流 + 重连成功复位）+ 可能 `src/core/health-monitor.ts`（若需 recordFailure 接受 reason）
- Test: `test/godot-server.test.ts` 或 `test/core/health-monitor.test.ts`

**Interfaces:**
- Consumes: EditorConnection 错误码 `REQUEST_TIMEOUT`（:359）/ `NOT_CONNECTED`（:333）/ `CONNECTION_LOST`（:261）、`HealthMonitor.getState/setState/recordFailure`、EditorConnection 重连状态（`reconnectEnabled`/scheduleReconnect）
- Produces: ping 失败分流——REQUEST_TIMEOUT（卡死）→ 降级；NOT_CONNECTED/CONNECTION_LOST（下线）→ 让 EditorConnection 自动重连兜底，不抢占

**背景**：`:480 pingFn = editorConn.request('ping',{}, {timeoutMs:5000}).then(()=>true).catch(()=>false)` 毯式 catch 丢 err.code。两种失败（REQUEST_TIMEOUT=TCP OPEN 主线程卡死 / NOT_CONNECTED/CONNECTION_LOST=下线）都 recordFailure → reconnecting → handleEditorStall :436 disconnect() → reconnectEnabled=false :512 **杀 20 次退避自动重连**。编辑器重启/瞬时不可达也强制降级须手动 reconnect。

**决策（已对齐）**：catch 分流 + 不抢占重连。

- [ ] **Step 1: 核实 health-monitor + EditorConnection 接口**

Run/Read：
- health-monitor.ts: `recordFailure(reason?)` 签名、`getState()`、`setState()`、`maxConsecutiveFailures`（:48）、state 转换逻辑（:231）
- EditorConnection.ts: 重连状态暴露（`isReconnecting()`? 或 `reconnectEnabled`/attempt 字段）、onReconnect 成功 handler
- 确认 pingFn catch 能拿到 err.code（EditorConnection.ts:359 reject 挂 code）

implementer 先核这三点，方案细节据接口调整。

- [ ] **Step 2: 写失败测试（RED）**

```typescript
it('heartbeat: REQUEST_TIMEOUT (stall) triggers degrade', async () => {
  // mock editorConn.request('ping') reject {code:'REQUEST_TIMEOUT'}
  // 驱动 health-monitor 进 reconnecting → 验证 handleEditorStall/degradeToHeadless 被调
});

it('heartbeat: CONNECTION_LOST (down) does NOT preempt auto-reconnect', async () => {
  // mock editorConn.request('ping') reject {code:'CONNECTION_LOST'}
  // 驱动 reconnecting → 验证 handleEditorStall/disconnect NOT 被调(让 EditorConnection 自动重连)
  // 反向:disconnect() 未被调(reconnectEnabled 保持 true)
});
```

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run test/godot-server.test.ts -t "heartbeat"`
Expected: FAIL（当前毯式 catch，两种失败都降级，第二个 it 失败）

- [ ] **Step 4: 实现 catch 分流 + 不抢占**

`src/GodotServer.ts:480` pingFn 改（保留 err.code）：
```typescript
private _lastPingErrCode: string | undefined;
// ...
hm.startHeartbeat(
  () => (this.editorConn
    ? this.editorConn.request('ping', {}, { timeoutMs: 5000 })
        .then(() => { this._lastPingErrCode = undefined; return true; })
        .catch((err: any) => { this._lastPingErrCode = err?.code; return false; })
    : Promise.resolve(false)),
);
```

`src/GodotServer.ts:485` onStateChange 分流：
```typescript
hm.onStateChange((_from, to) => {
  if (to === 'reconnecting' && this.connectionMode === 'editor') {
    if (this._lastPingErrCode === 'REQUEST_TIMEOUT') {
      // TCP OPEN 但主线程卡死 → 降级(自动重连救不了, 主线程阻塞)
      getLogger().warn('godot-mcp', 'Heartbeat REQUEST_TIMEOUT (editor main thread blocked) — degrading to headless.');
      this.handleEditorStall();
    } else {
      // NOT_CONNECTED/CONNECTION_LOST/undefined → 编辑器下线/重启, 让 EditorConnection 自动重连兜底,
      // 不 disconnect 抢占(reconnectEnabled 保持 true, 20 次退避重连)。重连成功后复位 health-monitor。
      getLogger().info('godot-mcp', `Heartbeat ${this._lastPingErrCode || 'unknown'} (editor down/refused) — letting auto-reconnect handle, not degrading.`);
    }
  }
});
```

**重连成功复位**（避免 refused 后卡 reconnecting）：EditorToolExecutor :34 `addOnReconnectHandler` 已存在。在 establishEditorConnection 或 EditorToolExecutor 重连成功回调里 `hm.setState('connected')` + reset consecutiveHeartbeatFails。implementer 核实 EditorConnection 重连成功的 handler 钩子（addOnReconnectHandler 触发时机），加 `hm.setState('connected')` 复位。

> ⚠️ 状态机风险：refused 不降级时，health-monitor 停在 reconnecting。若 EditorConnection 自动重连成功 → 复位 connected；若重连耗尽（20 次）→ reconnectExhausted handler（:471）→ handleEditorStall 降级（这是正确的最终兜底）。核实这条链完整。

- [ ] **Step 5: 运行验证通过（GREEN）**

Run: `npx vitest run test/godot-server.test.ts test/core/health-monitor.test.ts`
Expected: PASS（timeout 降级 / refused 不抢占 两个反向断言 + 既有心跳测试不回归）

- [ ] **Step 6: 补 defects.ts detect（T6）**

key: `heartbeat-blanket-catch-no-distinguish`（detect：GodotServer pingFn catch 保留 err.code + onStateChange 区分 REQUEST_TIMEOUT）

- [ ] **Step 7: 门禁 + commit**

Run: `npx tsc --noEmit && npx vitest run test/godot-server.test.ts test/core/health-monitor.test.ts`
Commit:
```bash
git add src/GodotServer.ts test/  # + health-monitor.ts 若改
git commit -m "fix(reliability): 心跳降级区分 timeout/refused 不抢占自动重连

pingFn catch 保留 err.code; onStateChange(reconnecting) 分流: REQUEST_TIMEOUT
(TCP OPEN 主线程卡死)→降级; NOT_CONNECTED/CONNECTION_LOST(下线)→让 EditorConnection
20 次退避自动重连兜底, 不 disconnect 抢占(reconnectEnabled 保持 true)。重连成功
复位 health-monitor connected; 重连耗尽 reconnectExhausted handler 最终降级兜底。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: defects.ts 5 条 detect 补全

**Files:**
- Modify: `test/regression/defects.ts`（+5 detect）+ `test/regression/defects-fixed.test.ts`（length 断言 105→110）+ 头注计数

**背景**：#1/#2/#4 当前零 detect（2026-07-29 审查纯审查无 commit），#3/#5 旧 detect 覆盖窄。补 5 条 detect 防复发。

- [ ] **Step 1: 补 5 条 detect**

```typescript
{ key: 'nav-bake-request-timeout-misalign', status: 'fixed', severity: 'CRITICAL', dimension: 'Reliability',
  // EditorToolExecutor nav bake conn.request 用默认 30s != startOperation(110s), >30s 烘焙误报 editor_disconnected/do_not_retry。
  detect: () => {
    const f = readSrc('src/core/EditorToolExecutor.ts');
    const bakeBranch = f.match(/isNavBake[\s\S]{0,300}?conn\.request\(method, finalArgs/);
    return bakeBranch && !/timeoutMs:\s*NAV_BAKE_OP_TIMEOUT_SEC/.test(bakeBranch[0]) ? 1 : 0;
  } },
{ key: 'editor-halfopen-no-precheck', status: 'fixed', severity: 'IMPORTANT', dimension: 'Reliability',
  detect: () => {
    const f = readSrc('src/core/EditorToolExecutor.ts');
    const inner = f.match(/_executeInner[\s\S]{0,400}?try\s*\{/);
    return inner && !/getState\(\)\s*===?\s*['"]reconnecting['"]/.test(inner[0]) ? 1 : 0;
  } },
{ key: 'gdscript-spawn-not-registered', status: 'fixed', severity: 'IMPORTANT', dimension: 'Reliability',
  detect: () => {
    const f = readSrc('src/gdscript-executor.ts');
    const hasSpawn = /const proc = spawn\(/.test(f);
    const hasRegister = /registerSpawnedGodotPid\(proc\.pid\)/.test(f);
    return hasSpawn && !hasRegister ? 1 : 0;
  } },
{ key: 'heartbeat-blanket-catch-no-distinguish', status: 'fixed', severity: 'CRITICAL', dimension: 'Reliability',
  detect: () => {
    const f = readSrc('src/GodotServer.ts');
    const ping = f.match(/request\('ping'[\s\S]{0,200}?startHeartbeat|startHeartbeat[\s\S]{0,300}?request\('ping'/);
    if (!ping) return 0;
    // 反向:毯式 catch(()=>false) 丢 err.code = 复发; 须 catch 保留 err.code
    return /\.catch\(\s*\(\s*\)\s*=>\s*false\s*\)/.test(f) && !/_lastPingErrCode|err\?\.code/.test(f) ? 1 : 0;
  } },
{ key: 'fullsystem-scan-kills-editor', status: 'fixed', severity: 'IMPORTANT', dimension: 'Reliability',
  detect: () => {
    const f = readSrc('src/core/process-state.ts');
    const scan = f.match(/fullSystemScanGodot[\s\S]{0,800}?(taskkill|kill)/);
    return scan && !/--editor/i.test(scan[0]) ? 1 : 0;
  } },
```

- [ ] **Step 2: 更新头注 + length 断言**

头注 FIXED 105→110 + 追加 "+ 2026-07-29 B-Reliability T1-T5 ×5"。defects-fixed.test.ts length 断言 105→110（:129）+ 头注（:2）。

- [ ] **Step 3: 运行验证**

Run: `npx vitest run test/regression/defects-fixed.test.ts`
Expected: 110/110 全绿（新 detect 全 = 0 fixed）

- [ ] **Step 4: commit**

```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "test(reliability): B 批 5 条 detect 补全(nav bake/HOL/spawn orphan/heartbeat/全系统扫)

defects 105→110. #1/#2/#4 原零 detect, #3/#5 旧 detect 覆盖窄, 全补防复发。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 全量门禁收尾 + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`（[Unreleased] B-Reliability 段）

- [ ] **Step 1: 全量门禁**

```bash
cd D:/GitHub/godot-mcp-enhanced
npx tsc --noEmit
npx eslint src --max-warnings 999
npm test                  # 全量 vitest
npm run test:regression   # defects-fixed 110 + defects-open
```
Expected: tsc 0 / eslint 0 / vitest 全 passed（4 pre-existing T11 确认非回归）/ defects-fixed 110/110

- [ ] **Step 2: CHANGELOG [Unreleased] B-Reliability 段**

```markdown
### Fixed — Reliability (B 批次)

- **P1 nav bake 请求超时对齐**：`EditorToolExecutor` nav bake `conn.request` 传 `{timeoutMs: 110000}`（原默认 30s），消除 >30s 烘焙误报 `editor_disconnected/do_not_retry`（GD 实际烘成但客户端禁重试）。
- **P1 headless gdscript spawn orphan 清理**：`gdscript-executor` spawn 注册 `_spawnedGodotPids`（exit/error/timeout 三路径 unregister）；`GodotServer.close`/gracefulShutdown 清理 in-flight short-running spawn（原只 kill run_project 长进程）。
- **P1 心跳降级区分 timeout/refused**：pingFn catch 保留 err.code；`REQUEST_TIMEOUT`（主线程卡死）→ 降级；`NOT_CONNECTED/CONNECTION_LOST`（下线）→ 让 EditorConnection 自动重连兜底，不 disconnect 抢占。重连成功复位 health-monitor。
- **P2 半开 HOL 预检**：`EditorToolExecutor._executeInner` 入口查 `healthMonitor.getState()`，reconnecting 时即时返 NOT_CONNECTED，跳过 30s HOL 等待（串行 executeChain ×30s 放大）。
- **P2 全系统扫跳过 --editor**：`fullSystemScanGodot` 过滤加 `--editor` 排除，opt-in 开启时不误杀同项目编辑器。
- 5 条 defects detect 补全（#1/#2/#4 原零 detect）。
```

- [ ] **Step 3: final commit + requesting-code-review**

```bash
git add CHANGELOG.md
git commit -m "docs(reliability): B 批门禁收尾 + CHANGELOG

B-Reliability 5 finding 全闭环。门禁全绿 tsc0/eslint0/vitest全passed/defects-fixed 110。
Co-Authored-By: Claude <noreply@anthropic.com>"
```
然后 `superpowers:requesting-code-review`（final review 用 opus）。重点核实：#3 状态机链完整（refused→重连→复位 / 耗尽→降级兜底）、#2 close 清理覆盖、#4 预检不误拒 connected 态、跨文件调用链无裂缝（EditorConnection/health-monitor/GodotServer/EditorToolExecutor）。

---

## Self-Review

**1. Spec coverage（总 spec B 批次 + 待办 :51-58）：**
- ✅ #1 nav bake 超时 → T1
- ✅ #2 spawn orphan → T4
- ✅ #3 心跳降级（catch 分流+不抢占，决策已对齐）→ T5
- ✅ #4 HOL 预检 → T3
- ✅ #5 --editor 跳过 → T2
- ⊘ #6 只读并发 → defer（决策已对齐，独立架构 follow-up）
- ⊘ #7 CR-3 → CLOSED（文档化知情接受，不做）
- ✅ 每条补 detect → T6（#1/#2/#4 原零 detect 必补）

**2. Placeholder scan：** 无 TBD；每步含实际代码。#5 PowerShell 过滤 + #3 状态机据接口调整（Step1 核实）。

**3. Type consistency：**
- `NAV_BAKE_OP_TIMEOUT_SEC * 1000`（T1）↔ EditorConnection request timeoutMs
- `HealthMonitor` 注入（T3 构造器）↔ GodotServer establishEditorConnection 传 hm（T3 Step3）
- `registerSpawnedGodotPid/unregisterSpawnedGodotPid`（T4）↔ process-state 既有（runtime.ts:224 先例）
- `_lastPingErrCode`（T5）↔ onStateChange 分流 + 重连复位

**关键风险（review 重点）：**
- T5 #3 状态机：refused 不降级时 health-monitor 卡 reconnecting → 须重连成功复位 + 重连耗尽 reconnectExhausted 兜底降级。链完整是核心
- T4 #2：close 清理范围（run_project PID vs gdscript spawn PID 区分），重复 kill 无害但语义要清
- T3 #4：预检不误拒 connected 态（默认 connected 时 getState!=='reconnecting' 放行）
- 跨文件：EditorToolExecutor 构造器签名变更（+hm）影响所有 `new EditorToolExecutor` 调用点（grep 确认仅 GodotServer:469）
