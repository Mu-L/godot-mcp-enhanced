# Review 2026-07-06: 进程通信可靠性 + 崩溃恢复 + 并发审查

> **审查范围**：TS MCP server 与 Godot 编辑器插件两进程间的通信可靠性，聚焦断开检测 / 重连 / 崩溃恢复 / 并发 / 资源泄漏
> **审查方法**：先读 `reconnection-manager` / `health-monitor` 建图，沿深挖清单 7 路深挖（重连状态机 / 崩溃恢复 / 心跳 / 并发改状态 / 资源泄漏 / 超时链 / 进程生命周期），追踪完整调用链：客户端 → `EditorConnection.request` → WS → `websocket_server._handle_message` → `command_handler.handle` → undo → 返回
> **结论**：3 条 P0 + 5 条 P1 + 2 条 P2。最严重：HealthMonitor 心跳 / operation 暂停 / ReconnectionManager 三套已实现机制**全部未接线** —— 设计正确但接线层缺失

---

## 初始假设证伪

| 假设 | 实测结果 |
|------|---------|
| 重连后 in-flight 调用会被重放 | ❌ `EditorConnection` 重连后直接 `fireReconnect`，不重放也不通知被 reject 的调用（`EditorConnection.ts:236-241`） |
| HealthMonitor 心跳在守护连接 | ❌ `startHeartbeat` **全代码库零调用**，`pingFn` 永远 null，HealthMonitor 退化为纯被动统计（`health-monitor.ts:209` + `grep` 确认） |
| 长操作期间心跳会被暂停 | ❌ `EditorConnection.startOperation/endOperation` 定义了但**全代码库零调用**（`EditorConnection.ts:387-393`），编辑器侧 `operation_start` 处理器永远收不到请求 |
| `ReconnectionManager` 是重连核心 | ❌ 该类**未被使用** —— `EditorConnection` 用的是自己的内联 `scheduleReconnect`，两套独立实现并存（`reconnection-manager.ts` 全文件 + `EditorConnection.ts:444-477`） |
| 编辑器侧有并发保护 | ❌ `command_handler.handle` 在 `_process` 同步执行，单帧内串行处理 packet，但**慢命令阻塞所有 peer 的心跳与新连接**（`websocket_server.gd:213-237` + `command_handler.gd:98`） |

## 调用链关键事实

- **TS 侧重连**：`EditorConnection` 内置指数退避 + jitter（`EditorConnection.ts:456-461`），`maxReconnectAttempts=20`，到顶触发 `reconnectExhaustedHandlers` → `GodotServer` 降级 headless（`GodotServer.ts:353-360`）
- **断连清理**：`ws.on('close')` reject 所有 pending（`EditorConnection.ts:236-241`），EditorToolExecutor 包成 `{ isError: true }` 返回（`EditorToolExecutor.ts:71-77`）—— 这部分逻辑正确
- **编辑器侧心跳**：`heartbeat.gd` 单向发 ping，5s 间隔，30s 不活跃超时（`heartbeat.gd:3-4`）。TS 侧收到 ping 只 `reset_activity` 不回响应（`websocket_server.gd:314-316`）
- **headless 串行化完整**：`acquireProcessSlot` 经 `enqueueAsync` 串行，短任务上限 3（`process-state.ts:130,17`）；**editor 模式无任何对等机制**
- **gdscript-executor 子进程**：spawn + 10MB 输出限 + timeout kill + sessionDir 清理（`gdscript-executor.ts:1133-1273`）

---

## 一、P0（立即修复）

### [P0] 重连后 in-flight 工具调用被永久抛弃 — 客户端重试致状态不一致

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\core\EditorConnection.ts:236-241`（close 时 reject pending）、`:222` `fireReconnect`（重连成功）、`D:\GitHub\godot-mcp-enhanced\src\core\EditorToolExecutor.ts:54,71-77`
- **问题**：`ws.on('close')` 里 `for (const [, pending] of this.pending) { pending.reject(new Error('Connection lost')); } this.pending.clear();`。下游 `EditorToolExecutor.execute` 把 reject 包成 `{ isError: true, editor_disconnected: true }` 正常返回 —— 这部分是对的。
- **真正的问题**：重连成功后 `fireReconnect()` 只触发 handler 重新订阅 notification（`EditorToolExecutor.ts:22-26` re-subscribe `scene_tree_changed`），**对之前被 reject 的调用不做任何重放或幂等性追踪**。
- **为何是问题**：
  - 触发：客户端发 `add_node`（A），编辑器侧实际执行成功并入 undo 栈；同时 WS 断开 → TS 侧 A 被 reject "Connection lost"；重连成功；客户端（或上层 retry 中间件）对 "Connection lost" 自动重试 → 重试命中新连接 → 编辑器侧**再次执行 add_node** → 同名兄弟节点冲突 / undo 栈多出一项
  - 更糟：`undo_manager.gd:11` 的 `request_id` 是编辑器进程内自增（`websocket_server.gd:318`），重连后 TS 侧 `requestId` 继续递增，但编辑器侧若重启则 `_request_counter` 复位 → 与旧 request_id 概念上冲突（虽不直接碰撞，但 undo action 名 `MCP: op_<id>` 会重复）
- **修复**：
  1. `EditorConnection` 增加 `replayInProgress` 标志 + `getDroppedRequestMethods()` 暴露被 reject 的方法名
  2. reject 消息里加 `nonRetriable: true` 标记，`EditorToolExecutor` 检测到后返回明确的 `editor_disconnected: true, do_not_retry: true`
  3. 或更彻底：在编辑器侧给每个 mutating 操作分配全局单调 ID（持久化跨重启），TS 侧重连后用这个 ID 做幂等去重
- **验证**：模拟断连 → 重连 → 并发 3 个 `add_node`，检查编辑器侧实际执行次数 vs 客户端收到结果数，断言无非幂等重复

### [P0] HealthMonitor 心跳从未启动 — 编辑器卡死/慢响应完全检测不到 ⭐ 最该修

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\core\health-monitor.ts:209` `startHeartbeat()`（定义但零调用）、`D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts:101` `new HealthMonitor()`（实例化但不启动心跳）、`D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:422` `stopHeartbeat()`（关闭时调，但因从未 start，无害）
- **问题**：`grep -rn "startHeartbeat" src/` 确认**零调用点**（只有定义和 `.spec` 测试）。`HealthMonitor` 实例被创建，`pingFn` 永远是 `null`，`scheduleNext()` 因 `!this.pingFn` 直接 return（`health-monitor.ts:279`）。
- **为何是问题**：HealthMonitor 完全退化为"被动统计" —— 只在工具调用本身 success/failure 时 `recordSuccess/Failure`（`ToolDispatcher.ts:383-385`）。如果编辑器进程**卡死但 TCP 连接还 OPEN**（GPU 驱动死锁、脚本死循环、`OS.execute` 阻塞主线程、`undo_redo.commit_action` 触发深层 deferred 链死锁）：
  - HealthMonitor 毫无感知，`getState()` 一直返回 `'connected'`
  - `manage_tools action=sync` 报告状态健康，误导用户继续发请求
  - `EditorConnection` 侧也无应用层 ping（编辑器侧 `heartbeat.gd` 单向发 ping 到 TS，TS 不回响应，`websocket_server.gd:314-316` 只 `reset_activity`）—— **双向都没有真正的活性探测**
- **后果**：编辑器卡死后，客户端所有请求等到 30s `requestTimeoutMs` 才超时（`EditorConnection.ts:325-328`），且因 HealthMonitor 报健康，没有任何主动降级或重连触发
- **修复**：
  1. 在 `GodotServer.establishEditorConnection` 成功后调 `this.dispatcher?.getHealthMonitor().startHeartbeat(() => this.editorConn!.request('ping').then(() => true).catch(() => false))`
  2. 编辑器侧 `websocket_server.gd` 当前 `ping` method 只 `reset_activity` 不回响应 —— 改成回 `{jsonrpc, id, result: {}}` 让 TS 侧 `request('ping')` 能 resolve
  3. 注意心跳间隔（默认 30s）须 < 编辑器侧 `INACTIVITY_TIMEOUT=30s`（`heartbeat.gd:4`），否则心跳本身被误判超时 —— 建议心跳 15s，或一并解决 P0 #3 后放宽 inactivity
- **验证**：启动后用 `manage_tools action=sync` 看 health state；手动 suspend 编辑器进程 60s（`ps -STOP`），确认 state 变 `reconnecting` 且后续工具快速失败而非等 30s

### [P0] `operation_start`/`operation_end` 全代码库无调用方 — 心跳会在长操作期间误杀连接

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\core\EditorConnection.ts:387-393`（定义但零调用）、`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:289-300`（编辑器侧实现了 `operation_start` → `_heartbeat.pause_for_operation`）、`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\heartbeat.gd:58` `pause_for_operation`
- **问题**：`EditorConnection.startOperation/endOperation` 是 public API，但 `grep -rn "startOperation\|endOperation" src/` 确认 **TS 侧零调用**。编辑器侧 `websocket_server.gd:289` 完整实现了 `operation_start` → `_heartbeat.pause_for_operation(timeout, pid)`（C-01 per-peer），设计意图是：长操作（nav bake、export、screenshot、execute_gdscript）期间暂停 30s 不活跃超时。
- **但 TS 侧从不发 operation_start**，所以任何超过 30s 的编辑器操作会被编辑器侧 `heartbeat.gd:48` `if state.activity > INACTIVITY_TIMEOUT: emit timeout_detected` 杀掉连接 —— `_on_heartbeat_timeout`（`websocket_server.gd:351-361`）直接 `peer.close()`。
- **为何是问题**：
  - 触发：`nav_bake_mesh`（复杂导航网格烘焙）、`export_build`（大型项目导出）、大场景 `commit` 操作
  - 后果：操作 >30s → 编辑器侧单方面 `peer.close()` → TS 侧 `ws.on('close')` reject 所有 pending → 即使操作在编辑器侧实际成功了，客户端收到 "Connection lost"。然后触发重连，而**编辑器侧操作还在跑** → 新连接的请求与旧操作并发改场景树（与 P1 #5 编辑器侧无并发保护叠加放大）
- **修复**：
  1. 短期：`EditorToolExecutor.execute` 对已知长操作（`nav_bake_mesh` / `export_build` / 含 `bake` 的 method）包裹 `await startOperation(600) → await request(...) → finally endOperation()`
  2. 中期：把 `INACTIVITY_TIMEOUT` 从 30s 提到 300s 并配合 P0 #2 的真正心跳（心跳活则不超时，比纯时间窗更准确）
  3. 长期：编辑器侧把长操作改为 deferred/异步，`_handle_message` 立即返回"processing"，操作完成后 push notification
- **验证**：触发一个 45s 的编辑器操作（mock nav_bake 延时），确认连接不被杀、客户端收到正确结果而非 "Connection lost"

---

## 二、P1（高优先级）

### [P1] EditorConnection 重连定时器在退出路径泄漏 — 进行中的 connect() 不被终止

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\core\EditorConnection.ts:444-477` `scheduleReconnect`、`:479-502` `disconnect`、`:140-250` `connect`
- **问题**：考虑序列：
  1. 编辑器崩溃 → `ws.on('close')` 触发 → `scheduleReconnect()` 设了 timer
  2. timer fire，回调 `async () => { await this.connect(); }` 开始执行（`EditorConnection.ts:464-473`）
  3. `connect()` 内部 `new WebSocket(url)` 并注册 `open/error/close` listener（`:160`）
  4. **此时** MCP server 开始 shutdown，`GodotServer.close()` 调 `editorConn.disconnect()`
  5. `disconnect` 置 `reconnectEnabled=false`、清 timer、`this.ws.close()`、`this.ws = null`、清 pending
  6. **但** 步骤 3 的 `connect()` Promise 仍在 await 中，它内部新建的 WS 不在 `this.ws`（步骤 5 已置 null），其 listener 持有 `this`（EditorConnection）闭包
  7. `connect()` 的 `open` handler 最终触发，把新连接赋给 `this.ws`、`this.connected=true`（`:163-164`）—— **已 disconnect 的连接"复活"**
- **为何是问题**：
  - 已 disconnected 的 EditorConnection 突然 `connected=true`，`request()` 不再 reject "Not connected" 而走新连接
  - 新 WS 的 listener 持有 EditorConnection → 持有 GodotServer → 阻止 GC，Node 退出时残留（`unref` 缓解但不彻底，因 listener 闭包链未被 `removeAllListeners`）
  - `GodotServer.close()` 之后的 `setEditorExecutor(null)` 等清理对这个"复活"的连接无效
- **修复**：
  1. `connect()` 入口检查 `if (!this.reconnectEnabled && !this.connectAttempt) { reject(new Error('Disconnected during connect')); return; }`
  2. `connect()` 每个 `await` 后复检 `if (!this.reconnectEnabled) { ws.removeAllListeners(); ws.terminate(); reject(...); return; }`
  3. 引入 `connectGeneration` 计数，过期的 `connect()` 完成时忽略赋值
- **验证**：在 `scheduleReconnect` 的 `await connect()` 中途调 `disconnect()`，断言 `this.connected === false`、`this.ws === null`、无残留 WS listener（`EventEmitter.listenerCount` 检查）

### [P1] 编辑器侧命令处理在 `_process` 同步执行 — 单个慢命令阻塞所有 peer 的心跳与消息处理

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:213-237` `_process`、`:319` `_command_handler.handle(...)`、`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd:98-202` `handle`（纯同步）
- **问题**：`_process(delta)` 每帧：① `poll()` 所有 peer；② 对每个 OPEN peer `while get_available_packet_count() > 0 and _pkt_count < 50` 同步调 `_handle_message` → `_command_handler.handle(...)`。`handle` 是**纯同步**（看 `command_handler.gd:98` match 分支 + 各 `handle_*`），`add_node` 里 `ClassDB.instantiate` + `undo_redo.commit_action`、`nav_bake_mesh` 里 bake、`export_build` 里导出 —— 全在主线程同步阻塞。
- **期间阻塞**：其他 peer 的 `poll()`、心跳 `tick()`（`:219`）、新连接 `take_connection()`（`:197`）**全部暂停**。
- **为何是问题**：
  - 多客户端并发时，一个慢操作（bake 20s）让所有人卡住 20s
  - 心跳不 `tick` → 不发 ping → 但因 P0 #2 TS 侧无真心跳，这条目前表现为 TS 侧 `requestTimeoutMs=30s` 触发误杀（慢命令 25s + 网络抖动 6s = 误超时）
  - 新 TCP 连接 backlog 满 → 后续客户端连不上
- **修复**：
  1. 长操作（bake/export/screenshot）改用 `call_deferred` 或在子节点上 `set_process` 异步推进，`_handle_message` 立即返回 `{status: "processing", op_id: ...}`
  2. 或在慢命令前后显式 `operation_start/end`（配合 P0 #3）—— 至少让 `tick` 不被全局阻塞（但 `pause_for_operation` 仍是全局 `_is_paused`，见 6-18 审查 P1 #1）
  3. 限制单 peer 每帧只处理 1 条消息（去 `_pkt_count < 50` 的批量），给其他 peer 公平性
- **验证**：双客户端，A 发 `nav_bake`（mock 10s），B 发 `ping`，测 B 响应延迟应 <100ms（当前会被阻塞到 A 完成）

### [P1] `ReconnectionManager` 死代码 + `cancel`/`exhausted` 竞态 — 未使用但有隐患

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\core\reconnection-manager.ts:100-106`（exhausted 分支）、`:64-68` `cancel()`、`EditorConnection.ts:444-477`（实际使用的内联重连）
- **问题一（死代码）**：`grep ReconnectionManager src/` 确认该类**仅在自身文件和测试中引用** —— `EditorConnection` 用的是自己的 `scheduleReconnect`。两套独立重连逻辑并存，维护时易改错（未来若有人以为 `ReconnectionManager` 是核心并修改它，对生产行为零影响但制造虚假安全感）。
- **问题二（竞态）**：`tryConnect` exhausted 分支（`:100-106`）顺序是：① 置 `this.pendingResolve = null`；② 调 `onExhausted()`；③ 调 `done(false)`。但 `cancel()`（`:64-68`）检查 `if (this.pendingResolve !== null)`。如果 `onExhausted` handler 内部触发 `cancel()`：
  - 此时 `pendingResolve` 还非 null（① 在 ② 之前已置 null，但 ② 的 handler 里若调 cancel 看到 null 就跳过）—— 实际看代码 ① 在 ② 之前，所以 cancel 看到 null，不 resolve —— **OK**
  - 但若顺序调换（未来重构把 `onExhausted` 移到置 null 之前），`cancel` 会看到非 null，resolve(false)，而 `done(false)` 随后也 resolve —— **Promise 双 resolve**（Promise 只取首次，逻辑脆弱）
- **修复**：
  1. **删除未使用的 `ReconnectionManager`**（首选，消除双实现混淆）
  2. 或接线它替换 `EditorConnection.scheduleReconnect`（统一为一套），接线前先修竞态：`done` 回调首行置 `pendingResolve = null`，`cancel` 用局部变量捕获 resolve
- **验证**：删除后跑全测试套件确认无回归；或接线后单元测试模拟 cancel 在 onExhausted 回调内触发，断言 Promise 只 resolve 一次

### [P1] gdscript-executor 子进程异常路径泄漏 short-running slot — 极端情况下渐进不可用

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:1133-1273` `executeGdscript` 的 Promise
- **问题**：清理逻辑分布：
  - `proc.on('close')`（`:1193`）：`clearTimeout(timer)` + `releaseShortRunningSlot()` + `retryRm(sessionDir)`
  - `proc.on('error')`（`:1265`）：`clearTimeout(timer)` + `releaseShortRunningSlot()` + `rm(sessionDir)`
  - 输出超限（`:1159,1183`）：`forceKillTree(proc)`，依赖后续 `close` 事件触发清理
  - `timer`（`:1187`）：到点 `forceKillTree(proc)`，**但不 release slot、不 reject**
- **泄漏路径**：如果 `forceKillTree` 后进程因 OS 异常（Windows taskkill 失败、driver bug）**不产生 `close` 事件**：
  - `timer` 会等到 `timeout` 秒后 fire，`forceKillTree` 一个已死进程（无害）
  - 但 `releaseShortRunningSlot()` 只在 `close`/`error` 里调 → **slot 永久占用**
  - `MAX_SHORT_CONCURRENT=3`（`process-state.ts:17`）打满后，所有 `execute_gdscript` 直接失败
- **为何是问题**：极端情况下（进程死但 Node ChildProcess 句柄不 emit），short-running slot 泄漏 → execute_gdscript 渐进性不可用，需重启 MCP server。配合 P0 #2（无心跳），这种泄漏完全静默。
- **修复**：
  1. `proc.on('exit')` 兜底（与 `close` 区别：`exit` 在进程退出时一定触发，`close` 在所有 stdio 流关闭后触发，可能因 stream bug 不来）
  2. `timer` 回调里也 `releaseShortRunningSlot()` + reject Promise（用 settled 标志防双触发）
  3. 用 `once('close')` + `once('exit')` 合并清理，确保只清一次
- **验证**：mock 一个不 emit `close` 的 ChildProcess（`EventEmitter` 手动控制），确认 `timer` 路径释放 slot 且 Promise reject

### [P1] game-bridge `_ensureConnection` 锁在并发下泄漏 + 无退避 — 高并发首次连接卡死

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\tools\game-bridge.ts:235-253` `_ensureConnection`、`:144-232` `_doConnect`
- **问题一（锁冗余 + 退避缺失）**：
  ```ts
  _connectionLock = _doConnect(timeout).then(...).catch(err => {
    _connectionLock = null; // ① catch 里置 null
    throw err;
  }).finally(() => { _connectionLock = null; }); // ② finally 里又置 null
  ```
  `finally` 总执行，① 冗余。更关键：失败后**立即**置 null，下次调用立即重试 —— 与 `EditorConnection` 的指数退避不同，这里是"立即重试到成功"。若 bridge 重启中，每次 `_doConnect` 都 ECONNREFUSED，高频调用打满。
- **问题二（invalidate race）**：`_doConnect` 入口 `_invalidateSocket()`（`:145`）destroy 旧 socket。考虑：A 的 `_doConnect` 进行中（已 `createConnection` 未 auth 完成），A 的 `.then` 链中 catch 执行置 `_connectionLock=null`，D 调用进来看到 null 发起新 `_doConnect` → `_invalidateSocket` destroy 了 A 的 socket → A 的 auth 永远不完成。A 的 reject 依赖 `sock.on('error')`（`:215`），但 `destroy()` 默认触发 `close` 不一定 `error`。
- **后果**：bridge 连接在高并发首次连接时偶发性卡死 —— A 的 Promise 永挂（D 的 invalidate 杀了 A 的 socket，但 A 的 close handler 在 auth 未完成时走 `:227-230` reject "closed during auth"，这条 OK；但若 invalidate 发生在 auth 已完成、`_socket=sock` 已赋值之后，`_doConnect` 已 resolve，D 的 invalidate 会 destroy 一个正在用的连接）。
- **修复**：
  1. `_connectionLock` 用 generation 计数，`_doConnect` 内 socket 的 error/close handler 只在"该 socket 仍是当前 `_socket`"时才 invalidate 模块状态
  2. 加最小重连退避（如 200ms），失败后不立即允许重试
  3. 删除 catch 里的冗余 `_connectionLock = null`（finally 已覆盖）
- **验证**：并发 10 个 `sendToBridge`（bridge 首次未启动），启动 bridge，确认全部最终 resolve 或全部 reject，无永挂

---

## 三、P2（中优先级）

### [P2] 编辑器侧 `_exit_tree` 不等 in-flight 操作完成 — undo 栈/场景状态半提交

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:392-402` `_exit_tree`
- **问题**：`_exit_tree` 同步 `set_process(false)` + `_server.stop()` + `peer.close()` + `_delete_secret_file()`。但若 `command_handler` 正在执行 `undo_redo.commit_action()` 中途（虽 GDScript 同步，但命令内部的 deferred call 或编辑器自动保存可能未完成）：
  - 编辑器侧自动保存 / 场景 dirty 标记是 deferred，`_exit_tree` 强制清理 → 关闭时未保存的 undo 步骤丢失，下次打开场景状态不一致
  - `_exit_tree` 没等 `peer.close()` 完成（WS close 握手异步），TS 侧可能收到 TCP RST 而非 WS close frame → `EditorConnection.ws.on('close')` 仍触发，但若 TS 侧正好在 `request()` 等响应，要等 30s `requestTimeoutMs` 才 reject
  - secret 文件被删，TS 侧 `rebuildEditorConnection`（`GodotServer.ts:375-384`）重读 secret 失败 → 报"插件未运行"，实际是关闭竞态
- **修复**：
  1. `_exit_tree` 里对每个 OPEN peer 先发 `{"method":"server_shutting_down"}` notification，给 TS 侧 500ms 优雅 reject pending
  2. `_delete_secret_file` 延迟到所有 peer 真正 closed（用 counter 或 await）
- **验证**：MCP 执行 batch `add_node` 时关闭编辑器，检查 TS 侧是否收到明确错误而非 30s timeout

### [P2] 多实例路由 fetch 无连接复用 + 30s 硬超时无重试无熔断 — 单实例慢拖垮路由

- **位置**：`D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:180-210` `sendToInstance`、`:218-239` dynamic sender
- **问题**：`MULTI_INSTANCE` 模式下，每个工具调用 `fetch(url, { signal: AbortSignal.timeout(30000) })`：
  - ① 每次 new 连接，无 keep-alive/agent 复用，高频调用 TCP/TLS 握手开销 + 端口耗尽（Windows 尤其）
  - ② 30s 硬超时，无重试 —— 目标实例 GC pause 或慢查询 30s 一次就失败
  - ③ `buildAuthHeaders` 每次重新 HMAC 计算（开销小但可优化）
  - ④ `response.json()` 无 size 限制，恶意/异常实例返回超大 body 直接 OOM
  - ⑤ 无熔断：实例连续失败 100 次，第 101 次仍发 fetch
- **与可靠性关联**：实例 A 慢（30s 超时）→ 占用路由侧并发槽 → 客户端并发调用时多个 fetch 同时等 A 的 30s → Node 事件循环资源耗尽。配合 P0 #2 无心跳，路由层也无法主动探测实例健康。
- **修复**：
  1. 共享 `undici.Agent` 或 `node:http` Agent 复用连接
  2. per-instance 熔断（连续失败 N 次后短路返回 5xx，定时探测恢复）
  3. `response.json()` 前检查 `content-length`，超限拒绝
- **验证**：模拟一个 35s 响应的实例，确认 30s 后客户端收到明确错误且其他实例不受影响；模拟连续失败 10 次，确认第 11 次被熔断而非继续 fetch

---

## 值得肯定的设计

| 设计 | 位置 | 评价 |
|---|---|---|
| EditorConnection 断连时 reject 所有 pending | `EditorConnection.ts:236-241` | 避免调用方永等，正确 |
| EditorToolExecutor 把 connection error 包成 `editor_disconnected: true` | `EditorToolExecutor.ts:71-77` | 区分连接错误与工具执行错误，利于客户端决策 |
| 重连指数退避 + jitter 防 thundering herd | `EditorConnection.ts:456-461` | 多实例同时重连不会风暴 |
| `reconnectExhaustedHandlers` 独立于 disconnect handler | `EditorConnection.ts:93-98` + `GodotServer.ts:353-360` | I-04 修复，避免降级过早触发 |
| 长定时器 `unref()` | `EditorConnection.ts:476` + `health-monitor.ts:309` | 不阻止 Node 优雅退出 |
| headless 完整串行化（`acquireProcessSlot` + `enqueueAsync`） | `process-state.ts:106-157` | C-04 设计正确，editor 模式缺对等物是盲区 |
| gdscript-executor 输出超限 kill + sessionDir retryRm 清理 | `gdscript-executor.ts:1142-1160,1199-1201` | A-07 retryRm 处理 Windows EPERM |
| `forceKillTree` 跨平台 + 杀进程树 | `process-state.ts:22-44` | taskkill /T + pkill -P 杀子进程 |
| editor secret per-peer 锁定（非全局） | `websocket_server.gd:257` | I-09 修复，单失败源不锁死所有客户端 |
| `orphan` 进程清理 + 30s 节流 | `process-state.ts:318-419` | V-01 第二层防御，防僵尸 Godot |

---

## 审查未发现

- TCP 层面的 keep-alive / SO_KEEPALIVE 配置（WS 层依赖应用心跳，当前无应用心跳见 P0 #2）
- 编辑器侧 `_handle_message` 对 `params` 非 Dictionary 的防御（6-18 审查 P2 #4 已报，本轮不重复）
- editor 模式并发控制缺失（6-18 审查 P1 #2 已报，本轮 P1 #2 是其延伸 —— 同步阻塞放大并发问题）
- 大响应无背压/分片（6-18 审查 P1 #3 已报）

---

## 修复优先级建议

| 优先级 | 编号 | 一句话 |
|---|---|---|
| **立即** | P0-2 | 接线 `startHeartbeat`，让 HealthMonitor 真正工作（影响面最大，且是 P0-1/P0-3 的检测前提） |
| **立即** | P0-3 | 接线 `operation_start/end` 或放宽 `INACTIVITY_TIMEOUT`，防长操作被误杀 |
| **立即** | P0-1 | reject 消息加 `nonRetriable` 标记，防客户端重试致状态不一致 |
| 高 | P1-4 | `connect()` 增加 `reconnectEnabled` 复检，防 disconnect 后连接复活 |
| 高 | P1-5 | 编辑器侧长操作改 deferred，防同步阻塞所有 peer |
| 高 | P1-7 | gdscript-executor 加 `exit` 事件兜底，防 slot 泄漏 |
| 高 | P1-8 | game-bridge 加退避 + generation 锁，防并发卡死 |
| 中 | P1-6 | 删除或接线 `ReconnectionManager`，消除死代码 |
| 低 | P2-9/10 | 编辑器退出优雅通知 + 多实例路由加固 |

---

## 总体评价

这是一个**工程化程度极高**的项目 —— 进程通信有完整的重连管理器、健康监控、操作暂停三套独立机制，代码注释里到处是 review 闭环标记（I-xx、C-xx、F-x、IMP-x），说明经过多轮审查。

**真正的问题集中在一点：接线层缺失**。三套已实现的可靠性机制 —— `ReconnectionManager`、`HealthMonitor.startHeartbeat`、`EditorConnection.startOperation/endOperation` —— **全部未被生产代码调用**。`EditorConnection` 反而用自己内联的 `scheduleReconnect`（设计正确），导致：

1. **HealthMonitor 退化为纯被动统计**（P0-2）—— 编辑器卡死完全检测不到
2. **operation 暂停机制形同虚设**（P0-3）—— 长操作被心跳误杀
3. **ReconnectionManager 死代码**（P1-6）—— 维护陷阱

这类"已实现但未接线"的隐患**最难从单元测试发现**（测试只覆盖被调用的代码），却最易在生产触发。建议：
- 短期：接线 P0-2 和 P0-3（改动小，收益最大）
- 中期：补"接线完整性"检查 —— 用 `grep` 或 TypeScript 的 `unused export` 检测，CI 里跑"public API 是否有调用方"的 lint
- 长期：考虑用依赖注入容器统一管理这些机制的启停，避免"实例化了但没 start"

**审查未修改任何代码**。


---

## 六、核实修订记录（2026-07-06 源码逐条复核）

**核心声明属实**: "三套机制未接线"经 grep 确认 — startHeartbeat(src/ 仅 health-monitor.ts:209 定义零调用)/startOperation/endOperation(src/ 零调用)/ReconnectionManager(src/ 仅自身文件无引用)。

**已修（vitest 3524 绿）**:
- P0-2（startHeartbeat 零调用）→ GodotServer.establishEditorConnection 接线 startHeartbeat + ToolDispatcher HealthMonitor 间隔 15s(<INACTIVITY_TIMEOUT 30s 避免边界竞争) + 编辑器侧 websocket_server.gd:314 ping 加 send_text 回响应(让 TS request(ping) 能 resolve)

**Push back / 登记 defect**:
- P0-1（重连后 in-flight 抛弃）登记: EditorConnection.ts:236-241 断连 reject pending 逻辑本身正确，真问题是重连后无幂等追踪/重放
- P0-3（startOperation/endOperation 零调用）登记: **P0-2 心跳(15s)已间接缓解长操作误杀**(心跳维持 activity)；startOperation 需长操作清单 + RTT 权衡
- P1-4（重连定时器/连接复活 race）登记: 需 connectGeneration 计数
- P1-5（慢命令阻塞，= gdscript P1-10）登记: 需 GDScript command_handler 异步化
- P1-6（ReconnectionManager 死代码）登记: 可安全删除(低风险后续)
- P1-7（gdscript-executor slot 泄漏）/P1-8（game-bridge 锁泄漏）登记
- P2-9/P2-10 登记（P2/MULTI_INSTANCE 默认关闭）

**与其他报告重叠（已修）**: editor 并发(P1-5↔gdscript P1-10↔security P1#2 已修 EditorToolExecutor 串行化); 大响应(P1-3 路径↔security P1#3 已修 send_text 检查); heartbeat(↔gdscript P1-7↔security P1#1 已修 per-peer)。
