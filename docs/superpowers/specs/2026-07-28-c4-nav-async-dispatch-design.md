---
date: 2026-07-28
topic: C4 nav bake coroutine → async-dispatch（方案 A-lite）
status: spec r3（待 plan）
systems:
  - "[[nav-bake-in-undo-action]]"
  - "[[gdscript-coroutine-breaks-sync-dispatch]]"
  - "[[methodology-skills]]"
---

# C4 nav bake coroutine → async-dispatch 设计 spec（方案 A-lite）

> 承接 `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:444-451` `nav-bake-in-undo-action` 的 C4 deferral 段 + memory [[gdscript-coroutine-breaks-sync-dispatch]]。
> brainstorming 2026-07-28 经方案空间→权衡→收敛 A-lite；r2 综合两轮审查修正；r3 补 §6 守卫位置/时序缝隙、§12 最底层 bake 异步性核实 + 1↔2 条件依赖、§7 嵌套 timeout 时间轴、§8 理由措辞、nav bake 并发非目标。

## §1 背景与问题

**C4 deferral 根因**：`NavigationRegion3D.bake_navigation_mesh()` 的执行模型未核实（详见 §12 核实项 0，BLOCKING，提到 plan 第 0 步前置）。godot-mcp-enhanced 的同步 JSON-RPC dispatch 链不支持 coroutine handler——`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd:144` `return _nav_commands.handle_nav_create_region(...)` 同步 return，`addons\godot_mcp_server\websocket_server.gd:351` `if response == null or not response is Dictionary:` 检查响应必须是 Dictionary。handler 含 `await` 即成 coroutine，返回 coroutine state（非 Dictionary），命中 `-32603`。

**当前 deferred 行为**（`addons\godot_mcp_server/commands/nav_commands.gd:17-66`）：
- bake 作为 `do_method` 入 undo 栈 `do_ops`（保 P1 redo 重 bake 正确性）
- `commit_action` 同步执行 do_method，bake_navigation_mesh 启动后台线程后返回（bake 未真正完成）
- bake_result 乐观判据 `want_bake and navigation_mesh != null`（`nav_commands.gd:66`）
- `handle_nav_bake_mesh`（`command_handler.gd:146` 路由 → `nav_commands.gd` 的 handler，bake 调用约 `:88`）同 bug：`node.bake_navigation_mesh()` 无 await + `success = navigation_mesh != null`

**bake 完成检测的不确定性**（两轮审查共识）：`bake_navigation_mesh()` 的返回值/可 await 性/真异步性/执行模型均未核实（§12 核实项 0-3，BLOCKING）。因此本 spec **不预判"裸 `await bake()` 有效"**，统一采用"启动 bake + 等完成通知（信号/状态轮询）"模式（§6/§9 一致），消除对未核实语义的依赖。

**目标**：MCP 调用路径下 bake_result 准确（bake 真正完成后 `navigation_mesh.get_vertices_count() > 0` 判据），且不破坏现有 30+ 同步 handler 契约。

## §2 目标与范围

**范围决策**：brainstorming 第一轮选「范围 B = 通用 async-dispatch 架构能力」（非"仅修 nav bake"局部，非"永久 defer"）。

**方案收敛**：方案空间经权衡收敛到 **A-lite（精确局部化）**，否决：
- **方案 A-full**（全链 await 化）：让全部 30+ handler 承担 `_process` packet 循环异步副作用（reply 乱序/peer 竞态/心跳），违反 Karpathy #3
- **方案 B**（websocket 判断 coroutine）：伪选择性——`command_handler.handle` 含任何 await 即整体成 coroutine，判断总走 else，等价 A-full 但更绕

**范围两端**：
- **editor addon 侧**（本 spec 主体）：`command_handler.gd` + `websocket_server.gd` + `nav_commands.gd` + `heartbeat.gd`（接线点见 §7）
- **headless 侧**（`src\tools\navigation.ts`）：脚本生成改为"启动 bake + 等完成通知 + `get_vertices_count()` 判据"。headless 走 `executeGdscript`（独立 godot 进程），不涉及 dispatch 链——与 editor 侧独立，但 bake 完成检测模式同款（§9）。

**非目标**：① redo 路径 bake 准确性（editor undo 系统限制，见 §11）；② **并发 nav bake**（多个 nav bake 请求对同一 NavigationRegion3D 并发——Godot 并发 bake 行为未定义，不在本 spec 范围，§12 核实项 11 标注）。

## §3 方案 A-lite 总览

**核心**：分流发生在 `websocket_server.gd:350` 调 `command_handler.handle` **之前**——按 `method.begins_with("nav_")` 识别 nav，nav 走单独 async 入口 `handle_nav_async`，非 nav 仍走同步 `handle`。

- `command_handler.handle` **保持同步不动**（`:104` 同步 return Dictionary 契约不变，30+ handler 零影响）
- 新增 `command_handler.handle_nav_async(method, params, request_id) -> Dictionary`（coroutine），路由 nav 5 method（见 §8）
- `websocket_server.gd:350` 改为：nav method → `var response = await _command_handler.handle_nav_async(...)`；else → 同步 `handle(...)`
- `_handle_message`（在 `_process(delta)` 的 packet while 循环里同步调用，`websocket_server.gd:245-249`）因此含 await 分支成 coroutine。**packet 循环对挂起的 `_handle_message` coroutine 不 await，继续处理下个 packet**；挂起的 coroutine 在 bake 完成后自行恢复发 reply——这是 A-lite 不阻塞非 nav 请求的关键，plan 实现时切勿把 packet 循环串行化（await 挂起的 coroutine）。异步副作用只发生在 nav 请求上（非 nav 走同步分支当帧完成不挂起）

**A-lite 严格优于 A-full**：相同 nav async 能力，改动面从"全链 30+ handler + 系统性 reply 异步"收窄到"nav 5 method + 仅 nav 请求异步"，不破坏现有同步契约。

## §4 障碍①处理：undo do_method 同步执行，dispatch await 触及不到

**问题**：create_region 的 bake 不是直调，而是作为 `do_method` 入 undo 栈经 `undo_manager.gd:35-55` `commit_action()`（EditorUndoRedoManager 内置同步方法，`:43`）同步执行所有 add_do_method 注册调用。dispatch 链的 await 改造碰不到 commit_action 内部的 do_method 执行。

**解法（分治，与 §6 一致——coroutine 不重调 bake）**：
- bake 保留为 do_method 入 do_ops（保住 P1 redo 重 bake 正确性）
- do_method 内 bake 同步启动后台线程（redo 路径不变）
- `create_action_mixed` 之后，coroutine **不重调 `bake_navigation_mesh()`**，而是等 bake 完成通知（§6 主方案：is_baking 状态轮询；fallback：bake_finished 信号 + timer 竞速），再读 `get_vertices_count()` 判据 → MCP 路径 bake_result 准确

## §5 障碍②处理：dispatch 在 _process packet 循环里

**问题**：`_handle_message` 在 `_process(delta)` 的 packet while 循环里同步调用。若 nav coroutine 挂起几秒等 bake：
- **reply 跨帧异步**：nav reply 在 bake 完成后才发
- **乱序**：同 peer 连发两请求，第二个（同步 handler）reply 先于 nav 发出
- **peer 生命周期竞态**：coroutine 恢复时 peer 可能已 `STATE_CLOSED`/被 free
- **心跳**：bake 挂起期间需暂停心跳，否则心跳超时伪断连

**A-lite 把这些风险限制在 nav 请求**（非 nav 30+ handler 零风险）。nav 路径残留风险处理见 §10。

## §6 议点③：bake 完成等待结构（功能命门）

**注册竞态根因**：`bake_finished.connect(...)` 在 bake 启动之后连接（do_method 在 commit_action 内已启动 bake）。空场景/缓存命中时 bake 极快，信号可能在 connect 前 emit → 回调永不触发 → 死挂。信号+timer 只是兜底，**没消除根因**。

**主方案——is_baking 状态轮询（守卫在循环内，r3 改）**：
```gdscript
# create_region / bake_mesh 的 async handler 内，commit_action 启动 bake 之后
await get_tree().process_frame        # r3: 先等一帧确保 is_baking 已置位（避翻 true 时序缝隙，§12 核实项 3 确认翻 true 时机）
var _deadline = Time.get_ticks_msec() + BAKE_WAIT_TIMEOUT_MS
while true:
    if not is_instance_valid(_nav):                       # r3: 守卫在最前（每次访问 _nav 前）
        return {"error": {"code": -32003, "message": "NavigationRegion3D freed during bake"}}
    if not _nav.is_baking:
        break                                              # bake 完成
    if Time.get_ticks_msec() > _deadline:
        break                                              # 超时退化为乐观判据，但 reply 必发（不死挂）
    await get_tree().process_frame                         # ← 恢复点，_nav 可能此帧被删，下次循环开头守卫拦住
var bake_result = _nav.navigation_mesh != null and _nav.navigation_mesh.get_vertices_count() > 0
```
**r3 关键修正**：
- 守卫 `is_instance_valid(_nav)` 必须在**循环内每次访问 _nav 前**（用户删节点时拦），**不能放循环后**——`while _nav.is_baking` 的循环条件本身访问 `_nav`，freed 对象会报错或返垃圾值，根本走不到循环后守卫
- 轮询前 `await process_frame` 等一帧：do_method 在 commit_action 内同步调 bake，若 `is_baking` 翻 true 非同步（线程启动后才置位），commit_action 返回时 is_baking 仍 false → while 跳过轮询直接读未完成 mesh 退化为乐观。先等一帧确保置位（§12 核实项 3 确认翻 true 时机，若同步置位可省此帧）

轮询无信号、无 timer 对象、无注册竞态——查状态是当前快照，不存在"miss 历史 emit"问题。

**fallback（仅当 §12 核实项 3 确认 is_baking 不存在/不可靠）——bake_finished 信号 + timer 竞速**：baking 标志 + `bake_finished` 回调清标志 + `await` 信号/`create_timer` 竞速 + 超时读当前 mesh。信号 one-shot connect 须显式 disconnect（避节点复用累积连接）。守卫同样在循环内。

**超时值 BAKE_WAIT_TIMEOUT_MS**：须 **< MCP client 请求超时**（否则防了死挂但 reply 发了 client 已走）。client 超时值见 §12 核实项 6。create_region 用较短值、bake_mesh 用 120s 量级（对齐其 timeout），但两者都必须 < client 超时。完整超时包含关系见 §7 时间轴。

## §7 议点④：心跳暂停接线点 —— TS 包装（方案 b）+ GD 服务端超时兜底

**决策**：选 **(b) TS 侧对 nav bake action 包装 `operation_start/end`**，复用现有协议，GD coroutine 保持纯粹。

**接线点**（editor 路由层，TS 侧；r4 核实：TS 方法已有，接线非新建）：`D:\GitHub\godot-mcp-enhanced\src\core\EditorConnection.ts:419-424` 已有 `startOperation(timeoutSec)` / `endOperation()`（零生产调用——方法定义了没接线）。plan 的 TS 侧工作是**在 nav bake 调用链接线调用已有方法**（`ToolDispatcher`/`EditorToolExecutor` 识别 `bake_mesh` / `create_region(bake=true)`，请求前 `startOperation`，响应/超时后 `endOperation`，try/finally 配对），非实现新方法。心跳暂停区间 = 请求往返期，覆盖 GD coroutine 挂起期。

**GD 侧服务端超时兜底（r4 核实：已有 P1#3 实现，心跳命门已守）**：`operation_end` 若因 TS 崩溃/网络断/bug 没发，GD 心跳会永久暂停 → 伪断连。try/finally 防不住进程崩溃。**`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\heartbeat.gd:37-46` 已有 P1#3 hard timeout 自动恢复**（2026-07-06 fix：`op_timer > op_timeout` 时 `paused=false` 自动 resume 心跳，注释明确「恢复 normal 心跳而非断连」）——正是本节要求的语义，plan 须验证行为符合预期。**唯一缺口**：现有恢复无 `push_warning` 告警日志，可选 polish 加一行。`heartbeat.gd:58` `pause_for_operation(timeout_sec: float, peer_id: int = -1)`（`timeout_sec` 必传无默认）。

**嵌套 timeout 时间轴（r3 加，统一收口跨层约束）**：
```
t0: TS 发 operation_start(timeout=T_ts) → GD pause_for_operation(hard_timeout=T_gd, peer)
t0: GD coroutine 开始 bake，进入 is_baking 轮询（deadline=t0+BAKE_WAIT_TIMEOUT_MS）
t1: bake 完成（t1 < t0+BAKE_WAIT_TIMEOUT_MS）→ coroutine 读 mesh → reply
t1: TS 收 reply → finally 发 operation_end → GD resume 心跳

异常路径（TS 崩溃不发 operation_end）：
t0+T_gd: GD hard timeout 触发 → 自动 resume 心跳（P1#3 已实现，无告警日志→可选 polish）

跨层约束：BAKE_WAIT_TIMEOUT_MS ≤ T_ts < T_gd < MCP client 请求超时（r4 注：两端 timeout 被 clamp ≤ 600s——TS `EditorConnection.ts:420` `Math.min(timeoutSec,600)` + GD `heartbeat.gd:69` `min(timeout_sec,600.0)`；故 T_ts/T_gd 实际上限 600s，核实项 6 client 超时须 > 600s 否则约束边界要调）
```
**关键**：所有 GD/TS 侧超时（BAKE_WAIT_TIMEOUT_MS / T_ts / T_gd）都必须 **< MCP client 请求超时**，否则兜底防了死挂但 reply 发了 client 已走。

**理由**：复用现有协议（`operation_start/end` 已为 TS 主动长操作设计，见 defects `heartbeat-pause-timeout-disconnect` P1#3 fix（heartbeat 超时恢复））+ GD `pause_for_operation` 已 per-peer 下沉（defects P1#1 `heartbeat.gd:9` `_peer_activity`）+ GD coroutine 不掺心跳逻辑。

**备选 (a) GD 本地 pause/resume**（coroutine 内 await 前后调）更内聚，但心跳暂停逻辑分散（TS `operation_start` + GD 本地两套）——不选。

## §8 议点⑤：nav 5 method 路由

`handle_nav_async` 因含 await 分支（create_region/bake_mesh）整体是 coroutine，`websocket_server` 对所有 nav method 都 `await handle_nav_async(...)`。

```gdscript
func handle_nav_async(method: String, params: Dictionary, request_id: int) -> Dictionary:
    match method:
        "nav_create_region": return await _nav_commands.handle_nav_create_region_async(params, request_id)
        "nav_bake_mesh":     return await _nav_commands.handle_nav_bake_mesh_async(params)
        "nav_create_agent":  return _nav_commands.handle_nav_create_agent(params, request_id)
        "nav_set_params":    return _nav_commands.handle_nav_set_params(params)
        "nav_create_link":   return _nav_commands.handle_nav_create_link(params, request_id)
```

**r3 叙事修正（正确性不依赖实测假设① + 理由改为语义可读性）**：非 bake 的 3 个 method 走非 await 分支直接 return。**正确性不依赖"coroutine 非 await 分支当帧执行"假设**——`websocket_server` 统一 `await handle_nav_async()` 驱动 coroutine 完成拿值。保留 match 分支的真实价值是**语义可读性**（显式标注哪条路径可能挂起，路由表一眼可读）+ **改动最小**（3 个非 bake handler 调用零改动）+ 不给非 bake 路径引入额外 await 关键字，**非性能**（两种写法 latency 等价，均属已降级的实测假设①范畴，§12 核实项 7 确认）。plan 阶段统一 await 亦可，自定。

`websocket_server` 侧只按 `method.begins_with("nav_")` 分流到 async 入口，不用细分哪些 bake。

## §9 headless 侧修复（与 §6 同款完成检测，独立于 editor dispatch）

`src\tools\navigation.ts`：**不裸 `await bake()`，与 §6 同款"启动 + 等完成通知 + 判据"模式**：
- `:38-39` `genCreateRegionScript` 的 `bakeBlock`：`_nav.bake_navigation_mesh()` 启动 + 等 `is_baking` 轮询（或 bake_finished，由 §12 核实项 3 结论定）+ `await get_tree().process_frame` + 守卫 `is_instance_valid(_nav)`
- `:60-61` `baked` 输出：从 `${bake}`（是否请求 bake）改为 bake 完成后 `navigation_mesh.get_vertices_count() > 0` 判据
- `:80-82` `genBakeMeshScript`：同款启动 + 等完成 + `_bake_ok = get_vertices_count() > 0`

headless 走 `executeGdscript` 独立进程，有进程 timeout（`navigation.ts:470`，bake_mesh 120s）兜底死挂。脚本内 await 完成（信号/状态轮询）后 `_mcp_done()` 正常返回。**plan 前置核实**（§12 核实项 5）：`godot --headless --script` 模式下 await 信号/process_frame 是否成立（memory [[godot-mcp-engine-quirks]] 提 headless coroutine 有坑）。

## §10 nav 路径残留风险处理

**乱序**：nav bake 挂起期间同 peer 连发的非 nav 请求 reply 先发。JSON-RPC 允许乱序（client 按 id 匹配）。**plan 前置核实**（§12 核实项 6）：grep TS 侧 response 匹配逻辑（`EditorConnection` / MCP client），确认按 id 匹配不依赖顺序。

**peer 生命周期竞态**：nav coroutine 恢复时 peer 可能已 `STATE_CLOSED`/被 free。**恢复点守卫**（`websocket_server` send reply 前）：
```gdscript
if not is_instance_valid(peer) or peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
    return   # coroutine 挂起期间 peer 已关闭，丢弃 reply
```

**心跳**：§7 议点④ TS 包装 `operation_start/end` + GD 服务端超时兜底处理。

**并发 nav bake（r3 标非目标）**：多个 nav bake 请求对同一 NavigationRegion3D 并发（editor 多 client 连接触发），Godot 并发 bake 行为未定义（可能崩/串行/数据竞争）。**本 spec 不处理**，plan 须核实 Godot 并发 bake 行为或加互斥（§12 核实项 11）。

## §11 已知局限

**redo 路径 bake 仍乐观（不可消除）**：redo 不走 MCP dispatch，redo 时 do_method 的 bake 仍同步启动后台线程不等完成——editor undo 系统固有限制（`EditorUndoRedoManager.commit_action` 同步执行 do_ops，MCP 层插不进 await）。MCP 调用路径 bake 准确，redo 路径仍乐观判据（`navigation_mesh != null`）。

**用户可见影响**（须写进 CHANGELOG + defects 注释）：redo 后 bake_result 是乐观判据，bake 可能仍在后台跑，用户看到的 navmesh 可能不完整。**workaround**：redo 后调 `nav_bake_mesh` 走 MCP 路径得准确 bake（绕过，非消除）。此局限更新 `defects.ts:444-451` C4 deferral 注释 + CHANGELOG。

## §12 plan 前置核实项（提到 plan 第 0 步，结论回填 §6/§9）

plan 阶段须先实测/核实以下（不核实就写 task = 假设错误的返工风险）。**核实项 0-3 是根基，BLOCKING 级——其结论决定 §6/§9 的正确写法 + 整个 A-lite 架构是否成立**。**核实项 0-3 须在 Godot 4.6 + 4.7 双版本均成立**（项目声明双版本支持，§13 `check:gdscript` 4.7.1+4.6.2；若某项仅 4.7 有，§6 须版本分叉或统一 fallback）：

0. **【BLOCKING，最底层地基】bake 执行模型**：`bake_navigation_mesh()` 调用后是否**立即返回（bake 后台线程异步）**，还是**同步阻塞主线程直到 bake 完成才返回**？若同步阻塞，则 is_baking 轮询无意义（返回时已 completed）、信号方案无意义（bake_finished 在返回前已 emit）、**整个 A-lite 架构失去意义**（do_method 同步阻塞 dispatch 链，根本没机会 await）。is_baking/信号等完成检测方案都以"bake 异步"为前提。
1. **【BLOCKING】`bake_navigation_mesh()` 返回值与可 await 性**：返回 void / coroutine / 其他？函数内部是否含 await（即是否 coroutine）？——决定"裸 await bake()"是否有效。
2. **【BLOCKING，条件依赖核实项 1】await bake 的真异步性**：**仅当核实项 1 结论为"bake 是 coroutine 且可 await"时**，核实 `await` 它是否真异步让出执行权（让 packet 循环/其他请求继续），而非同步阻塞当前帧到 bake 完成。若核实项 1 结论为"返回 void"，**本项跳过**，§6 is_baking 轮询为唯一可行方案。
3. **【BLOCKING】`is_baking` 属性/方法存在性 + 翻 true 时机 + 双版本**：NavigationRegion3D 或 NavigationServer3D 是否有可查询的 baking 状态？baking 期间稳定 true、完成后翻 false？**调用 bake 后 is_baking 何时翻 true（同步 vs 下一帧，关系 §6 轮询前是否需 await 一帧）**？4.6+4.7 双版本是否均有？——若不存在/不可靠，§6 退回 fallback 信号方案。
4. **bake_finished 信号语义**：存在性 + emit 时机（bake 完成时是否必发）+ `await signal` 对注册前已 emit 的行为（注册竞态）。
5. **headless main loop pump**：`godot --headless --script` 模式下 `await signal` / `await get_tree().process_frame` 是否成立（§9 可行性，memory [[godot-mcp-engine-quirks]] headless coroutine 坑）。
6. **MCP client 请求超时 + response 匹配**：client 侧请求超时值（§6/§7 所有 GD/TS 超时须 < 它）+ response 按 JSON-RPC id 匹配不依赖顺序（§10 乱序）。
7. **实测假设①（降级为语义确认）**：含 await 的函数，非 await 分支的 body 是否当帧同步执行 return（影响 §8 非 bake 3 method 的 latency，不影响正确性）。验证：`test\fixtures\gdscript-check\` 最小用例。
8. **【确认项，r4 修正：已有】heartbeat hard timeout 行为确认**：`heartbeat.gd:37-46` **已有 P1#3 hard timeout 自动恢复**（`op_timer > op_timeout` → `paused=false`）。plan 须验证：① 行为符合 §7 预期（超时自动 resume 心跳，不断连）；② `timeout_sec` 传值 ≥ bake 最长时间；③ 可选加 `push_warning` 告警（§7 唯一缺口）。**非新增**——与 memory [[godot-mcp-enhanced-defects-status-stale]] 同型模式（spec 信「未实现」假设，未重读代码）。
9. **editor 路由层 nav 调用链（r4 注：TS 方法已有）**：`EditorConnection.ts:419-424` 已有 `startOperation/endOperation`，plan 须定位 nav bake action 接线点（`ToolDispatcher` / `EditorToolExecutor` 识别 bake_mesh / create_region(bake=true) 处，§7）。
10. **do_method 启动的 bake 与完成通知联动**：确认 do_method（commit_action 内）启动的 bake 会触发 `bake_finished` / `is_baking` 翻 true（§4/§6 一致性前提；不重调 bake，只等通知）。
11. **并发 nav bake 行为**（r3）：Godot 对同一 NavigationRegion3D 并发 bake 的行为（§10 非目标，plan 决定加互斥还是标 unsupported）。

## §13 测试策略

- **单元（TS 侧）**：`handle_nav_async` 路由（5 method 分流）、bake_result 准确判据、超时兜底（deadline 触发读当前 mesh 退化乐观）
- **GD 侧逻辑测试边界**：项目主测试是 Vitest（TS），GD 侧 coroutine 逻辑（信号/状态轮询/peer+nav 守卫）在 headless 难 mock，**主要靠集成测试**（真实 editor + 真实 bake）。plan 须界定哪些 GD 逻辑可单测、哪些只能集成测
- **集成**（需真实 Godot editor，4.6+4.7 双版本）：create_region(bake=true) 端到端——bake 完成后 vertices_count > 0、bake 挂起期间心跳不伪断连（§7 operation_start/end + GD hard timeout）、peer 中途关闭不崩（§10 守卫）、_nav 中途删除不崩（§6 循环内守卫）
- **回归**：全量 vitest（非 nav 30+ handler 零影响）+ `check:gdscript` 4.7.1+4.6.2 双版本 `--import` 真编译（coroutine 语义版本敏感）
- **headless**：navigation.ts bake 准确判据测试（vertices_count）

## §14 验收标准

1. MCP 调用 `nav_create_region(bake=true)` / `nav_bake_mesh`：bake_result 基于真实 `get_vertices_count() > 0`（非乐观 `!=null`）
2. nav bake 挂起期间无死挂（§6 兜底）、无心跳伪断连（§7）、无 peer/_nav 恢复崩溃（§6 循环内守卫 + §10 peer 守卫）
3. 非 nav 30+ handler 行为零变化（全量回归绿 + 当帧 reply）
4. headless 侧 bake_result 同样准确（§9）
5. `defects.ts:444-451` C4 deferral 注释更新（标注 MCP 路径 fixed / redo 路径 known limitation + workaround）+ CHANGELOG
6. 全门禁绿：tsc 0 / eslint 0 / `check:gdscript` 0-0 / 全量 vitest / `--import` 4.7.1+4.6.2

## §15 风险与回退

**最大风险**：§12 核实项 0-3 结论不利。回退预案：
- **核实项 0 不利（bake 同步阻塞主线程）**：最致命——A-lite 架构需根本重新评估。可能需 NavigationServer3D callback API + 主动异步轮询完全绕开 `bake_navigation_mesh()` coroutine，或接受同步阻塞（限 editor 路径，bake 期间 dispatch 链堵但不崩）。spec 升级 r5
- **核实项 1-2 不利（bake 不可 await / 返回 void）**：§6 is_baking 轮询为唯一可行方案（fallback 信号方案），spec 局部调整
- **核实项 3 不利（is_baking 不存在/不可靠/单版本）**：§6 退回 fallback 信号+timer 方案（接受注册竞态靠 timer 兜底，BAKE_WAIT_TIMEOUT_MS 严控 < client 超时）；若仅 4.7 有 is_baking，4.6 走 fallback（版本分叉）
- ~~**核实项 8 不利（pause_for_operation 无 hard timeout）**~~ **r4 修正：不会发生**——`heartbeat.gd:37-46` 已有 P1#3 hard timeout 自动恢复，核实项 8 降为行为确认

**redo 已知局限不可消除**（editor undo 系统限制），spec 明确接受（§11）。

---

关联：memory [[gdscript-coroutine-breaks-sync-dispatch]]、`D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:444-451`、批次 C 开发日志（2026-07-24）、[[godot-mcp-engine-quirks]]（headless coroutine）。

## §16 修订摘要

**r2（两轮审查采纳）**：§1/§9 消除"裸 await bake()"预判统一完成检测模式；§2 编号澄清；§6 is_baking 主方案 + 节点守卫 + BAKE_WAIT_TIMEOUT_MS < client 超时；§7 GD hard timeout 单点故障兜底 + 签名补全；§8 正确性不押假设①；§11 redo 用户可见影响；§12 核实项 1-3 BLOCKING 前置；§13 GD 测试边界。

**r3（第三轮审查采纳）**：
- §6 守卫进循环内（命门，原循环后守卫走不到）+ 轮询前 await 一帧处理 is_baking 翻 true 时序缝隙
- §12 插入核实项 0（bake 执行模型，最底层 BLOCKING 地基）+ 核实项 2 改条件依赖 1 + 核实项 3 补翻 true 时机/双版本 + 核实项 8 改行动项 + 新增核实项 11（并发 nav bake）+ 核实项 0-3 双版本适用性
- §7 嵌套 timeout 时间轴 + 统一「所有超时 < client 超时」跨层约束
- §8 理由改语义可读性（原"+1 frame"基于 GDScript 语义误解，两份审查共识）
- §3 补 packet 循环不等挂起 coroutine 语义
- §2/§10 补并发 nav bake 非目标
- §15 补核实项 0/8 不利回退

**r4（plan 前准备核实采纳——事实错误修正）**：plan 阶段读 `heartbeat.gd` / `EditorConnection.ts` 发现 spec r3 信了「未实现」假设（与 memory [[godot-mcp-enhanced-defects-status-stale]] 同型模式）：
- §7/§12 核实项 8：`heartbeat.gd:37-46` **已有 P1#3 hard timeout 自动恢复**（2026-07-06 fix，`op_timer > op_timeout` → `paused=false`），从「行动项新增」降「确认项」（plan Task 1 取消/降级为行为验证）
- §7/§12 核实项 9：`EditorConnection.ts:419-424` **已有 `startOperation/endOperation`**（plan Task 5 改接线非新建，呼应 `startOperation/endOperation` 零生产调用）
- §7 时间轴：两端 timeout clamp ≤600s（TS `:420` `Math.min(timeoutSec,600)` + GD `:69` `min(timeout_sec,600.0)`），核实项 6 client 超时须 >600s
- §15：核实项 8 不利回退删除（不会发生）+ 核实项 0 不利升级改 r5

## §17 r5：Task 0 实测结论与实现方案调整（2026-07-28，权威——优先于 §6/§9 r4 旧描述）

Task 0 probe.gd 双版本（4.7.1+4.6.3）实测推翻 spec r4 部分假设，实现方案调整（plan Task 0 结论 + Task 1-7 落地）。**本段权威——§6 is_baking 主方案 / §9 get_tree 等 r4 描述以本段为准**：

1. **核实项 0 PASS（bake 异步）**：`bake_navigation_mesh()` 立即返回（2.4-3ms，后台线程异步），非同步阻塞 → A-lite 架构成立
2. **核实项 1 void + 核实项 2 SKIP**：`bake_navigation_mesh()` 返回 void（双版本编译器拒赋值），不可 await 返回值
3. **核实项 3 不利 → §6 改 fallback**：NavigationRegion3D **无 is_baking/baking 属性**（双版本 BAKING_PROPS 空）→ §6 主方案 is_baking 轮询**不可用**，改 fallback bake_finished 信号方案（核实项 4 信号存在）
4. **判据 `get_vertices().size()`**：`get_vertices_count()` Nonexistent（双版本）→ 全改 `navigation_mesh.get_vertices().size() > 0`
5. **GDScript 4 lambda by-value**（实测 LOCAL_CAPTURE=1）→ fallback 块用 Dictionary holder `_bake_state = {"done": false}`（非 _baking 局部 bool），lambda 内 `_bake_state["done"] = true`
6. **§9 headless 用 `await process_frame`**：SCENE_TREE_HEADER extends SceneTree 无 `get_tree()`，用 `await process_frame`（非 `get_tree().process_frame`，对齐 material-ops.ts）
7. **核实项 5 headless 清理坑**：bake 后台线程致 `quit()` 不退出 → executeGdscript 进程 timeout 兜底杀 + RID leak 无害
8. **核实项 6 client 30s 硬限制**：EditorConnection `requestTimeoutMs=30000` → editor nav bake 受 30s 限制（BAKE_WAIT_TIMEOUT_MS=28000 < 30s；bake_mesh 110s timeout 超 30s 时 client 先 reject——已知限制，实际 bake 通常 < 30s）
9. **核实项 9 nav 全登记**：`editor-method-map.ts:110-115` nav 5 method 全登记 → editor 路径直达 nav_commands.gd（spec editor 侧前提成立）
10. **redo 已知局限**（§11 不变）：redo 路径 bake 仍乐观，workaround nav_bake_mesh MCP 路径

实现 commits：765bf83(Task0) ec7d92d(Task2) 4dc3dc2+cf060a8(Task3) ed41eb7(Task4) d132d38(Task5) 8394cd7(Task6) 252d6a1(Task7)。全门禁绿：tsc 0 / eslint 0 / check:gdscript 0 双版本 / vitest 4115 passed。
