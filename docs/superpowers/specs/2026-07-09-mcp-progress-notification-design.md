---
date: 2026-07-09
topic: mcp-progress-notification
status: draft
related:
  - 2026-07-08-mcp-logging-design.md（同为 MCP 协议接入，server 注入 + oninitialized 先例）
  - 2026-07-07-mcp-roots-dynamic-auth-design.md（oninitialized 先例）
  - docs/superpowers/specs/（资料-官方MCP servers借鉴对照.md 第三节 P1-4 候选）
source: 官方 MCP servers 借鉴对照报告 Phase 2 P1-4「Progress 通知」
---

# MCP Progress 通知（dev_loop MVP）设计

## 1. 背景与动机

官方 MCP servers 借鉴对照报告 Phase 2 P1-4「Progress 通知」：

- MCP 协议规定 client 在 `tools/call` 的 `_meta.progressToken`（`string | number`）传入 token；server 执行中发 `notifications/progress`（params: `{ progressToken, progress, total, message }`），client（Claude Code / Cursor 等）实时显示进度条/百分比。
- 本项目长操作（dev_loop / build / export / import / verify_delivery）**阻塞等完成，全库无 progressToken**（`grep sendProgress|progressToken|notifications/progress` 在 `src/` 零命中，2026-07-09 实测）——client 无法获知长操作进度，只能干等或反复轮询工具状态。
- SDK **无 `sendProgressNotification` 高层封装**（logger 的 `sendLoggingMessage` 是 logging 专用，progress 无对等物）。官方 `progressExample.js` 用底层 `extra.sendNotification({ method: 'notifications/progress', params })`；本项目低层 `Server` 用 `server.notification({ method, params })`（`shared/protocol.d.ts:383`，SDK 注释 `:349` 明确"发通知用 `notification()` 别用 `sendNotification`"）。
- 注入先例：`GodotServer.ts:107` `setMcpServer(server)`；`logger.ts:460-466` 模块级 `_mcpServer` + `setLoggerServer`；`GodotServer.ts:221` `oninitialized` 是 client 就绪信号先例。

**与 logger 的本质区别**：logger `sendLoggingMessage` 是**无 token 广播**（可模块级注入）；progress 必须**带 token 路由到特定请求**（per-request，必须随 request 透传）——这是不能直接复用 logger 模块级注入模式的核心原因。

**价值**：client 实时显示 dev_loop 多阶段进度（executing→verifying→bridge→acceptance），省去 LLM 轮询工具状态的 token 开销，长操作体验显著提升。

## 2. 目标

1. MVP 接入 **dev_loop** 一个长操作：client 传入 `_meta.progressToken` 时，dev_loop 执行中按阶段推送 `notifications/progress`。
2. **并发安全**：progressToken per-request 透传，多 tools/call 并发时 token 不串（C-CONC-1）。
3. **失败安全**：无 token / client 未就绪 / server 未注入 / 推送失败 → 全静默退化，绝不影响工具结果或现有行为。
4. **零回归**：现有测试全绿，无 token 时 dev_loop 行为零变化。

## 3. 非目标（YAGNI，明确不做）

- ❌ **取消（AbortSignal）**：progress 与取消是独立 concern；godot 子进程阻塞执行无法中途检查 signal。先交付 progress，取消留 follow-up。
- ❌ **覆盖其他长操作**（build / export / import / verify_delivery / import_resources）：MVP 只验证 dev_loop 模式，验证后按同一四层参数链扩展。
- ❌ **连续百分比**：godot 子进程不吐进度，只能按阶段离散推送（progress = 阶段索引 / total）。
- ❌ **`setLevel` / 节流**：progress 是工具主动推送，量小，无需节流。

## 4. 架构

### 4.1 新文件 `src/core/progress.ts`（与 logger 同构两件套）

```
模块级: _progressSender: Server | null  +  _progressClientReady: boolean
setProgressSender(server | null)        // GodotServer 构造注入（:108，与 setLoggerServer 同点）
setProgressClientReady(ready: boolean)  // oninitialized 注入（:221，与 setLoggerClientReady 同点）
createProgressEmitter(token): ProgressEmitter   // 工厂，闭包捕获 token
type ProgressEmitter = (progress: number, total: number, message?: string) => void
```

emitter 实现：guard `!_progressSender || !_progressClientReady` → return；调 `_progressSender.notification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message } })`；fire-and-forget（promise `.catch(()=>{})` + 同步 throw try/catch）。

**ready gate 独立于 logger**：progress 自带 `_progressClientReady`，**不跨模块读 logger 内部状态**（模块边界清晰）。`oninitialized` 同点触发两者（`setLoggerClientReady(true)` + `setProgressClientReady(true)`）。

### 4.2 ToolContext 扩展（`types.ts:8`）

加 `progress?: ProgressEmitter`（可选，无 token → undefined）。复用现有"dispatcher 注入可选回调"先例（`checkEditorTextResourceWrite` `:24`）。

### 4.3 四层参数链（C-CONC-1 并发安全命门）

emitter **照抄 findGodotOverride 透传机制**，全程局部变量，**绝不进实例字段**。C-CONC-1（`ToolDispatcher.ts:595-597` / `:235-237`）：MCP SDK 经 `Promise.resolve().then(handler)` 异步派发多个 tools/call，请求并发执行，**实例字段会被互相覆盖**（findGodot 当初踩过的坑）。若实现者把 token 存 `this._currentToken`，精准踩中此坑。

| 层 | 位置 | 改动 |
|---|---|---|
| ① 创建 | `handleCall` `:200` 区 | `progressToken = meta?.progressToken`（meta 已在 `:200` 提取）；`progressEmitter = token !== undefined ? createProgressEmitter(token) : undefined` |
| ② 透传 | `executeToolCall` `:213` | 签名加第 4 参 `progressEmitter?`；`:208` 调用传入；内部 `:323`（confirm 分支）/ `:357`（editor fallback）/ `:373`（headless）三处 dispatchTool 作第 5 参传入 |
| ③ 透传 | `dispatchTool` `:571` | 签名加第 5 参 `progressEmitter?` |
| ④ 注入 | `buildPerCallCtx` `:706` | 签名加第 3 参 `progressEmitter?`；`if (progressEmitter) perCallCtx.progress = progressEmitter`（progress 是新增字段非 getter，不破坏 `Object.create(baseCtx)` 的 getter 继承机制） |

**与 findGodotOverride 的区别**（透传机制相同，来源不同）：findGodotOverride 在 `executeToolCall` `:240` 基于 args 算；emitter 从 `handleCall` 基于 `request._meta` 创建、贯穿而下。两者都是不可变局部值。

**editor 直执行路径**（`:350` `currentExecutor.execute`）不经 `buildPerCallCtx` → 无 progress 注入。但 dev_loop 是 `(workflow, dev_loop)` 命名，editor `command_handler` 只认扁平 method → 落 -32601 → 触发 `:355-357` fallback 到 `dispatchTool` → progress 生效。spec 注明此边界。

### 4.4 GodotServer 接线

- 构造 `:108`：`setProgressSender(this.server)`（与 `setLoggerServer` 并列）
- `oninitialized` `:221`：`setProgressClientReady(true)`（与 `setLoggerClientReady` 并列）
- `close` `:511` 区：`setProgressSender(null)` + `setProgressClientReady(false)`（与 logger 清理并列）

### 4.5 总架构图

```
client tools/call (_meta.progressToken)
 → GodotServer CallToolRequestSchema handler
 → dispatcher.handleCall(request)
     ① 提取 meta.progressToken → createProgressEmitter(token)
     ② executeToolCall(name, args, startTime, progressEmitter)
        ③ dispatchTool(name, args, startTime, findGodotOverride, progressEmitter)
           ④ buildPerCallCtx(baseCtx, findGodotOverride, progressEmitter)
              → perCallCtx.progress = progressEmitter
           → targetMod.handleTool(name, args, perCallCtx)
              → dev_loop(args, ctx)
                  算 total → 每阶段 ctx.progress?.(idx, total, label)
 → emitter: guard(ready + sender) → server.notification(notifications/progress, {token, progress, total, message})
     → fire-and-forget (.catch 吞 reject)
```

## 5. 数据流（dev_loop total 矩阵）

dev_loop（`workflow.ts:262-444+`）两种模式，progress 覆盖矩阵：

**A. DSL 模式**（`:279-305`，`allDsl` 时）：`total = dslCommands.length`，每条命令（含 `_sleep`）前推 `(i+1, total, cmd.method)`。此模式无 execute/verify/bridge/acceptance。

**B. 正常模式**（`:307+`）：

```
total = 1(execute 恒有, :307) + (verify?1:0, :341) + (bridge?1:0, :350) + (acceptance?1:0, :411+)
```

阶段索引递增，每阶段**开始前**推 `(idx, total, label)`：
- execute → `'executing GDScript'`
- verify → `'verifying'`
- bridge → `'bridge queries/screenshot'`
- acceptance → `'acceptance assertions'`

**early-return**（`:320-329` execute compile/runtime error）：进度停在 `(1, total)`，**不推假完成**（progress=total 会误导为成功）。

**无 token 退化**：`progressEmitter = undefined` → `perCallCtx.progress = undefined` → `ctx.progress?.()` 全 no-op，现有行为零变化。

## 6. 错误处理

- **ready gate**：progress 自带 `_progressClientReady`；握手前推送 → guard return 不崩（与 logger `emitToClient` `:148` 同构）。
- **fire-and-forget 四重 guard**（复用 logger `:154-161`）：ready/sender guard → `notification()` 返回 promise `.catch(()=>{})` → 同步 throw try/catch → 观测层绝不影响工具结果。
- **token 类型**：`string | number`（MCP 协议两者皆可），emitter 透传不假设。
- **early-return 是合法的部分进度终止**：MCP progress 协议**不要求** progress 必须达 total 才能结束任务。dev_loop execute 失败走 `textResult`（`:322` / `:328`），**`isError` 未设**（`textResult` `types.ts:30-32` 只设 content）——客户端从 `result.step1_execute` 字段（`'compile_error'` / `'runtime_error'`）判断成败，**不从 isError**。progress 停在 `(1, total)` + `step1_execute='compile_error'` = 客户端正确理解"execute 阶段失败"。

## 7. 测试

**progress.ts 单元**：
- ready + sender 时 `notification` params 带 token / progress / total / message
- 未 ready 或无 sender → no-op（不调 notification）
- `notification` reject / throw → 不抛（fire-and-forget）
- `string` / `number` 两种 token 透传

**ToolDispatcher 集成**：
- 有 `_meta.progressToken` → `perCallCtx.progress` 非 undefined
- 无 `_meta` → `perCallCtx.progress` undefined
- **并发两 handleCall 不同 token → emitter 闭包独立不串**（验 C-CONC-1）
- **editor 模式 + dev_loop + `_meta.progressToken`** → `_isUnknownMethod` 触发 `:355-357` fallback → `perCallCtx.progress` 经 fallback 路径注入非 undefined（验 `:357` emitter 透传未被 editor 直执行 `:350` 吞掉；editor 是用户主要模式，progress 在此模式能否生效全靠此路径——声明的架构边界须有测试覆盖）

**dev_loop（workflow.ts）**（mock `ctx.progress`）：
- DSL 模式（3 条命令）→ `[(1,3,m1),(2,3,m2),(3,3,m3)]`
- 正常 verify + bridge + acceptance → 4 次推送，total=4
- 仅 execute → `[(1,1,'executing')]`（total 动态）
- **execute compile_error early-return** → 仅 `[(1,total)]` 推送、结果 `step1_execute='compile_error'`、**isError 未设**（验不推假完成）
- `ctx.progress` undefined → 不抛、结果正常（向后兼容）

## 8. 决策记录

- **方案 A（ToolContext.progress 可选回调）> B（改所有 handler 签名）/ C（DispatchContext）**：A 复用现有 dispatcher 注入可选回调先例（`checkEditorTextResourceWrite` `:24`），改动最小，token 闭包捕获并发安全。B 影响所有 handler 签名（透传链改动面大）。C 工具 handler 用 ToolContext 非 DispatchContext，透传不到实际推送点。
- **取消 = YAGNI**：progress 与取消（AbortSignal）独立 concern；godot 子进程阻塞执行无法中途检查 signal。先交付 progress。
- **ready gate 独立于 logger**：progress 自带 `_progressClientReady`，不跨模块依赖 logger 内部状态（模块边界清晰，避免 progress → logger 的耦合）。
- **total 动态矩阵**：覆盖 DSL / 正常 / early-return 三路径，acceptance 纳入（修正初版 `1 + verify + bridge` 的漏项）。
- **emitter 而非 token 透传**：handleCall 提取 token 后立即创建 emitter，透传 emitter 对象（而非 token 本身）一路向下——token 只在 handleCall 出现一次，emitter 是不可变局部值，减少 token 暴露面。

## 9. 行号卫生声明

本文行号（`:108` / `:200` / `:213` / `:221` / `:323` / `:350` / `:355-357` / `:373` / `:511` / `:571` / `:595-597` / `:706` 等）基于当前 master（`26a1f95`，v0.22.0）。**实现时以实际为准**，重构后可能漂移——plan 阶段与实现阶段须重新核实行号。
