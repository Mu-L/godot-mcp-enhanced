# Review 2026-07-06: Security & Reliability Audit

> **审查范围**：三层架构全链路（TS MCP server + GDScript 编辑器插件 + 进程桥）
> **审查方法**：先建图再深挖，追踪一条完整调用链：客户端 → TS 工具 → 序列化 → GDScript → 场景树 → undo → 返回
> **结论**：5 条确认 bug + 3 条可疑需验证。最严重：editor 模式并发控制设计盲区（P1）

---

## 初始假设证伪

| 假设 | 实测结果 |
|------|---------|
| WS 服务可能绑 0.0.0.0 | ❌ 绑 `127.0.0.1`（`addons/godot_mcp_server/websocket_server.gd:187`） |
| `build/` 入库与 src/ 漂移 | ❌ 已在 `.gitignore`，`git ls-files build/` = 0 条 |
| install-plugin 有路径注入 | ❌ 要求目标含 `project.godot`，无执行 |
| editor_guards 是 RCE 防线 | ❌ 仅防"覆盖编辑器打开的文件"，与 RCE 无关 |
| 沙箱扫描是对抗边界 | ❌ 注释明确声明图灵完备无法穷举，靠 env flag 兜底 |

## 调用链关键事实

- **WS 鉴权**：32 字节随机 secret + 常时比较（`websocket_server.gd:267,381`）+ per-peer 锁定（`:257`）✅
- **并发模型**：MCP SDK 通过 `Promise.resolve().then` 异步并发派发多个 tools/call（`src/core/ToolDispatcher.ts:234` C-CONC-1 注释），多工具可真并发
- **headless 串行化**：`acquireProcessSlot` 经 `enqueueAsync` 串行（`src/core/process-state.ts:130`），短任务上限 3
- **editor 串行化**：**完全没有对等机制**（见 P1 #2）

---

## 一、确认的 bug

### [P1] operation_start 期间全局暂停 tick，idle peer 的断网超时检测被一并挂起

- **位置**：`addons/godot_mcp_server/heartbeat.gd:14,31-38,58-62,67-75`、`addons/godot_mcp_server/websocket_server.gd:295`
- **问题**：代码已有 per-peer 雏形——`pause_for_operation(timeout, pid)` 接收 peer_id 并存入 `_operation_peer_id`（`:14,58-62`，C-01），超时只 emit 目标 peer（`:35-37`），`resume()` 的 E5 修复只重置目标 peer 的 activity/ping（`:67-75`）。**但 `_is_paused` 仍是单一全局 bool**——pause 期间 `tick` 直接 return（`:31-38`），per-peer 雏形未覆盖 tick 路径，所有 peer 的 inactivity 检测被一并跳过
- **为何是问题**：
  - 触发：客户端 A 发 `operation_start`（长 bake_mesh），客户端 B 正常连接但闲置
  - 后果：A 操作期间 `_is_paused=true`，`tick` 全局 return，B 的 inactivity 计时停滞（既不增长也不被检测）→ B 若在此期间断网，不会在 30s（`INACTIVITY_TIMEOUT`）后触发超时清理，要等 A 的 operation 结束才恢复检测
  - 注：报告初稿"泄漏直到 `_peers.size() >= MAX_PEERS`"不精确——`pause_for_operation` 有 `min(timeout_sec, 600.0)` 上限（`:60`），operation 超时后自动 `_is_paused=false`，不会无限泄漏。但 600s 内 idle peer 的断网不会被清理，仍是泄漏窗口
- **修复**：`tick` 不再全局 return。把 `_is_paused` 下沉为 per-peer 字段——`_peer_activity[pid].paused`，`tick` 遍历每个 peer 时仅对 `paused=true` 的 peer 跳过 inactivity 检测，其余 peer（含 idle 的 B）照常累计 activity 并触发超时；`pause_for_operation` 只置目标 peer 的 paused，`resume()` 只清目标 peer
- **验证**：起两个 ws peer，A 发 operation_start（timeout=60）后 B 断网，35s 后断言 B 被 close（当前实现下 B 会挂到 A 操作结束才被检测到）

### [P1] editor 模式下并发工具调用无串行化，undo 栈跨调用边界错乱 ⭐ 最该修

- **位置**：`src/core/EditorToolExecutor.ts:40-79`、`addons/godot_mcp_server/command_handler.gd:98-202`
- **问题**：`EditorToolExecutor.execute` 直接 `await this.conn.request(toolName, args)` 转发（`EditorToolExecutor.ts:54`），**无任何并发控制**。MCP SDK 异步并发派发已核实——`ToolDispatcher.ts:234-236` C-CONC-1 注释原文"MCP SDK 经 `Promise.resolve().then(handler)` 异步派发多个 tools/call,请求并发执行,实例字段会被互相覆盖(旧注释 'MCP serializes so no race' 为错误前提)"
- **为何是问题**：
  - 触发：客户端并发发 `add_node`（A）和 `set_instance_property`（B）
  - 后果：GDScript 侧 `_process` 单帧内串行处理 packet（`websocket_server.gd:213-224`），但乱序窗口在 **TS 端 send 顺序**——多个并发 handler 各自 `ws.send`，message 到达 GDScript 的顺序不可靠。每个 `create_action_mixed` 是独立 `commit_action`，UndoRedo 是 LIFO 栈：若 commit 顺序与逻辑依赖相反（B 的 set_property 先于 A 的 add_node commit），用户 undo 时先弹栈顶 A（remove 节点）再弹 B（restore 旧值），B 的 undo 作用于已 remove 的节点 → `target == null` 警告（`undo_manager.gd:74` property op；method op 同类警告在 `:47-48`）→ undo 静默丢失
  - headless 有 `acquireProcessSlot` 串行化（`process-state.ts:130`；短任务另有 `MAX_SHORT_CONCURRENT=3` `:17`），**editor 完全没有对等机制**
- **修复**：在 `EditorToolExecutor` 引入与 `acquireProcessSlot` 等价的串行化队列（复用 `enqueueAsync` 模式），或对 mutating 类 editor 工具加 per-editor 锁
- **验证**：并发测试——同时发 10 个 `add_node` + `set_instance_property` 交替，断言全部成功且 undo 栈顺序一致

### [P1] 大响应无背压/分片，10MB/1MB 截断后客户端收到误导性超时

- **位置**：`src/gdscript-executor.ts:1130-1160`、`addons/godot_mcp_server/websocket_server.gd:9,329`、`src/core/EditorConnection.ts:257-260`
- **问题**：三级截断不一致——TS headless stdout 10MB、GDScript WS 1MB、TS 入站 1MB
- **为何是问题**：
  - 触发：`editor_get_scene_tree` 大场景、`query_scene_tree` 深遍、screenshot base64
  - 后果：GDScript 侧 `peer.send_text(reply)`（`:329`）若 > 1MB 返回 ERR_INVALID_DATA 但**请求响应路径未检查返回值**（对比：notification 广播路径 `send_mcp_notification` 已有 M-3 返回值检查 `:346-348`，修复可复用该模式）；TS 入站超 1MB 静默丢弃 → pending request 永等 → 30s 后 `Request timeout`（`EditorConnection.ts:327`），客户端看到"超时"而非"响应过大"，误导排查
  - headless 路径的 10MB 截断注入 `[OUTPUT TRUNCATED]` 文本，破坏 marker 协议 → `parseMcpMarkers` 找不到 marker → `No structured output found`（`gdscript-executor.ts:1256`）
- **修复**：
  1. GDScript `peer.send_text` 检查返回值，失败发 `{error: {code: -32010, message: "Response exceeds 1MB"}}`
  2. TS `EditorConnection` 对超限消息 reject 对应 pending（从消息体提取 id）
  3. headless stdout 截断不应破坏 marker——marker 单独放最后一行
- **验证**：构造 1.5MB 场景树 dump，断言收到 -32010 而非 30s 超时

### [P2] GDScript 侧 params 非字典未防御，畸形输入致 handler 抛错中断帧处理

- **位置**：`addons/godot_mcp_server/websocket_server.gd:243-246,319`、`addons/godot_mcp_server/command_handler.gd:98`
- **问题**：`_handle_message` 校验了 `parsed.has("jsonrpc")`，但 `params.get("params", {})` 不校验类型。客户端发 `{"jsonrpc":"2.0","method":"add_node","params":"not_a_dict"}` 时 params 是 String，`command_handler.handle` 内 `params.get()` 在 String 上调用 → GDScript 运行时错误
- **为何是问题**：
  - 触发：恶意/buggy 客户端发非 Dictionary params
  - 后果：`command_handler.handle` 抛错，`websocket_server.gd:319` 的 `response = _command_handler.handle(...)` **无 try-catch** → 异常冒泡到 `_process` → 该帧后续 peer 处理被跳过 → 多客户端互相影响
- **修复**：`websocket_server.gd:319` 包 try-catch；或 `_handle_message` 校验 `typeof parsed.get("params") == Dictionary`，否则返 -32602
- **验证**：发 `{"jsonrpc":"2.0","id":1,"method":"add_node","params":"x"}`，断言收到 -32602 而非连接断开

### [P2] editor 模式核心风险面缺测试覆盖（并发/崩溃注入/reconnect）

- **位置**：`test/` 目录全扫
- **问题**：
  - 无 editor 模式并发 `add_node`/`set_instance_property` 交错测试（上面 P1 #2 因此未暴露）
  - 无"编辑器进程崩溃后 reconnect，pending request 是否正确 reject、scene tree 状态是否 resync"注入测试
  - `test/helpers/godot-mock.ts` 掩盖真实 Godot 行为差异（marker 协议、import warmup 时序）
  - `test/e2e-full-tool-verification.test.ts` 是 headless 真实 Godot，但 editor 路径全靠 mock
- **为何是问题**：editor 模式是产品主路径（undo、live sync 是卖点），却只有 mock 测试；上面 3 个 P1 在当前测试套件里都不会失败
- **修复**：增加 editor 集成测试档——用真实 Godot 编辑器 headless（`--editor --headless`）启动插件，注入 ws 客户端做并发与崩溃恢复测试
- **验证**：新测试覆盖"并发 10 个 mutating 工具"+"杀编辑器进程后 reconnect"+"reconnect 后 scene tree resync 一致"

---

## 二、可疑需验证

### [可疑 P0] node_commands 白名单含 Node/Node2D/Node3D，ClassDB.instantiate 是否触发用户脚本

- **位置**：`addons/godot_mcp_server/commands/node_commands.gd:6-15,58,79-83`
- **核实结论**：白名单确实含 `Node`/`Node2D`/`Node3D`（`:11`），`_is_allowed_node_type` 用精确字符串匹配（`:83`，注释 `:79-82` 说明已弃用 `is_parent_class` 兜底——原兜底会放行第三方 addon 的 `class_name` 脚本从而触发其 `_init()`/`_ready()`）。`ClassDB.instantiate(node_type)` 按类名查 ClassDB，仅实例化原生类
- **攻击路径评估（很可能不成立）**：原疑虑"用户声明 `class_name Node` 覆盖原生类"——Godot 4.x 解析器**不允许**声明与内置类型同名的 `class_name`（解析期报错 "identifier 'X' is a built-in type"），故覆盖路径在标准 Godot 下无法成立。建议保留此项仅作"若 Godot 未来放宽 class_name 命名约束 / 第三方修改解析器"的防御性观察，非当前可利用漏洞
- **验证步骤（证伪用）**：测试项目声明 `class_name Node`，预期解析失败；再试 `class_name MyNode extends Node` + `add_node(node_type="MyNode")`，预期被白名单拒绝（MyNode 不在 ALLOWED_NODE_TYPES）

### [可疑 P0 → 下调 潜在风险] MULTI_INSTANCE 的 HMAC 认证 send-side only（HTTP 接收端当前未实现）

- **位置**：`src/GodotServer.ts:169-173`、`src/core/instance-api-auth.ts:13-19,107-175`
- **已确认事实**：`GodotServer.ts:169-173` 注释 + `console.warn` 明确承认 send-side only；`instance-api-auth.ts:13-19` 注释进一步写明"HTTP `/api/<tool>` **接收端在本仓库未实现**——TS server 不启动 HTTP 服务端，`mcp_bridge.gd` 走 TCP JSON-RPC 不消费 HMAC 头。因此 `verifyApiToken`（`:121`）**零生产调用**，仅被 `instance-api-auth.test.ts` 覆盖"。`generateApiToken`（`:107`）发签名、`buildAuthHeaders`（`:170`）加 `Authorization` 头，但全仓库无 HTTP server 调用 `verifyApiToken`
- **攻击链修正**：报告初稿"任何本地进程可 POST `/api/<tool>` → `execute_gdscript` → RCE"**当前不成立**——接收端 endpoint 根本不存在，`sendToInstance` 的 `fetch('http://127.0.0.1:${port}/api/${tool}')`（`GodotServer.ts:188`）在当前实现下会连接失败，而非被接受。所以问题不是"接收端不验证 header"，而是"接收端根本不存在"
- **定性**：保持"已知情文档化限制"，但严重性从"可疑 P0（当前可 RCE）"下调为"潜在风险（待接线接收端后才生效）"。MULTI_INSTANCE 默认关闭（`initMultiInstance` 早期 return，`GodotServer.ts:168`）。修复方向不是"给现有接收端加验证"，而是"未来实现接收端时，入口必须 wire `verifyApiToken`，否则 HMAC 沦为装饰"
- **验证步骤（接线后再测）**：当前 `curl http://127.0.0.1:<port>/api/execute_gdscript` 会连接拒绝（无 server 监听）；待 HTTP 接收端实现后，不带 `Authorization` 头 POST 应被 `verifyApiToken` 拒绝

### [可疑 P1] EditorConnection 重连 unref 定时器，进程退出期间重连可能被切断

- **位置**：`src/core/EditorConnection.ts:464-476`
- **疑问**：`reconnectTimer?.unref()`（line 476）让重连定时器不阻止 Node 退出——设计意图正确。但 `gracefulShutdown`（`src/index.ts:86`）调 `server.close()` → `editorConn.disconnect()` → 清理定时器。若在 `scheduleReconnect` 的 `setTimeout` 回调**正在执行** `this.connect()`（line 467 await 中）时收到 SIGINT，`disconnect()` 会置 `reconnectEnabled=false` 但 `connect()` 的 Promise 链仍在跑，可能在进程退出前残留 ws 连接
- **验证步骤**：在重连 active 时发 SIGINT，加日志观察是否有"connect() resolved after disconnect()"

---

## 总体评价

这是一个**工程化程度极高**的项目——安全面有多层防御，进程通信有完整串行化机制，代码注释里到处是 review 闭环标记（I-xx、C-xx、F-x），说明经过多轮审查。

真正的问题集中在两点：
1. **editor 模式并发控制是设计盲区**——headless 有完整串行化，editor 完全没有
2. **大响应处理三级不一致**——截断阈值与错误信号不统一

最该优先修的：**P1 #2（editor 并发串行化）**，因为它是产品主路径且当前测试完全覆盖不到。

---

## 三、核实修订记录（2026-07-06 源码逐条复核）

> 对上述每条声明逐一 Read 源码核实 `文件:行号`、调用链、行为描述。报告整体质量高：约 30 个行号引用全部命中，5 条确认 bug 论点成立；3 条可疑中 2 条经核实下调严重性。

### 行号准确性：约 30 个引用全部命中

`websocket_server.gd:9/187/257/267/295/319/329/346-348/381`、`heartbeat.gd:14/31-38/58-62/67-75`、`EditorToolExecutor.ts:40-79(关键 :54)`、`ToolDispatcher.ts:234-236`、`process-state.ts:17/130`、`node_commands.gd:6-15/58/79-83`、`gdscript-executor.ts:1130/1158/1256`、`command_handler.gd:98-202`、`EditorConnection.ts:257-260/327/464-476`、`GodotServer.ts:168-173/188`、`instance-api-auth.ts:13-19/107/121/170`、`undo_manager.gd:47-48/74`、`index.ts:86` 均精确。

### 已修正的描述性错误（3 处）

| 条目 | 原描述（不准确） | 核实后 |
|------|------------------|--------|
| **P1 #1 heartbeat** | "单一 `_is_paused` 暂停所有 peer，泄漏直到 MAX_PEERS"；修复"改 per-peer" | 代码已有 per-peer 雏形（`_operation_peer_id`/`pause_for_operation(timeout,pid)`/`resume()` E5）；有 `min(timeout,600)` 上限不会无限泄漏；真问题是 tick 全局 return 跳过所有 peer 的 inactivity 检测 |
| **可疑 P0 #1 node_commands** | "`class_name Node` 覆盖原生类 → RCE（行为未知）" | Godot 4.x 解析器禁止与内置类型同名的 `class_name` 声明，覆盖路径很可能不成立；白名单精确匹配已够严 |
| **可疑 P0 #2 MULTI_INSTANCE** | "接收端不验证，本地任意进程可 POST → RCE" | HTTP 接收端根本未实现（`instance-api-auth.ts:15-18` 明确），攻击链当前不成立；下调为潜在风险（接线接收端后才生效） |

### 已补充的精确性（2 处）

- **P1 #2**：明确乱序窗口在 **TS 端 send 顺序**（GDScript `_process` 单帧串行，并发 handler 的 `ws.send` 顺序不可靠才是 undo 栈 LIFO 错乱根因）；补 `undo_manager.gd:47-48` method op 同类警告；补 `MAX_SHORT_CONCURRENT=3`（`process-state.ts:17`）
- **P1 #3**：补 notification 路径 `send_mcp_notification` 已有 M-3 返回值检查（`:346-348`），与请求响应路径 `:329` 无检查对比，修复可复用该模式

### 保持原判定的条目

- **P1 #2 editor 并发**、**P1 #3 大响应三级阈值**、**P2 #1 params 非字典**（`:243-246` 仅校验 `has("jsonrpc")`、`:319` 无 try-catch、`:98` 签名 `params: Dictionary` 在调用边界报错且无兜底）：论点均成立
- **P2 #2 测试覆盖**：主观判断，保留
- **可疑 P1 #3 重连 unref**：`EditorConnection.ts:464-476` unref + `disconnect()` race 描述合理，"设计意图正确"定性保守，保留为待验证

### 仍未实测的点（需真实 Godot 环境）

- **P1 #2 严重性**：并发 send 乱序在实际 MCP 客户端下的发生频率
- **P1 #3 marker 破坏**：截断 forceKill 与 marker 写入 stdout 的时序（若 marker 在超 10MB 前已写入则不受影响）
