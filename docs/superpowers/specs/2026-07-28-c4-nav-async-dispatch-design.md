---
date: 2026-07-28
topic: C4 nav bake coroutine → async-dispatch（方案 A-lite）
status: spec r2（待 plan）
systems:
  - "[[nav-bake-in-undo-action]]"
  - "[[gdscript-coroutine-breaks-sync-dispatch]]"
  - "[[methodology-skills]]"
---

# C4 nav bake coroutine → async-dispatch 设计 spec（方案 A-lite）

> 承接 `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:444-451` `nav-bake-in-undo-action` 的 C4 deferral 段 + memory [[gdscript-coroutine-breaks-sync-dispatch]]。
> brainstorming 2026-07-28 经方案空间→权衡→收敛 A-lite；r2 综合两轮 spec 审查修正（§9 await 目标一致性、§6 主方案、§8 叙事、§7 单点故障、§12 核实项重构）。

## §1 背景与问题

**C4 deferral 根因**：`NavigationRegion3D.bake_navigation_mesh()` 是 GDScript coroutine。godot-mcp-enhanced 的同步 JSON-RPC dispatch 链不支持 coroutine handler——`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd:144` `return _nav_commands.handle_nav_create_region(...)` 同步 return，`addons\godot_mcp_server\websocket_server.gd:351` `if response == null or not response is Dictionary:` 检查响应必须是 Dictionary。handler 含 `await` 即成 coroutine，返回 coroutine state（非 Dictionary），命中 `-32603`。

**当前 deferred 行为**（`addons\godot_mcp_server/commands/nav_commands.gd:17-66`）：
- bake 作为 `do_method` 入 undo 栈 `do_ops`（保 P1 redo 重 bake 正确性）
- `commit_action` 同步执行 do_method，bake_navigation_mesh 跑到首个 await 点启动后台线程后返回（bake 未真正完成）
- bake_result 乐观判据 `want_bake and navigation_mesh != null`（`nav_commands.gd:66`）
- `handle_nav_bake_mesh`（`command_handler.gd:146` 路由 → `nav_commands.gd` 的 handler，bake 调用约 `:88`）同 bug：`node.bake_navigation_mesh()` 无 await + `success = navigation_mesh != null`

**bake 完成检测的不确定性**（r2 新增，两轮审查共识）：`bake_navigation_mesh()` 的返回值/可 await 性/真异步性未核实（详见 §12 核实项 1-3，提到 plan 第 0 步前置）。因此本 spec 不预判"裸 `await bake()` 有效"，统一采用"启动 bake + 等完成通知（信号/状态轮询）"模式（§6/§9 一致），消除对未核实语义的依赖。

**目标**：MCP 调用路径下 bake_result 准确（bake 真正完成后 `navigation_mesh.get_vertices_count() > 0` 判据），且不破坏现有 30+ 同步 handler 契约。

## §2 目标与范围

**范围决策**：brainstorming 第一轮选「范围 B = 通用 async-dispatch 架构能力」（非"仅修 nav bake"局部，非"永久 defer"）。

**方案收敛**：方案空间经权衡收敛到 **A-lite（精确局部化）**，否决：
- **方案 A-full**（全链 await 化）：让全部 30+ handler 承担 `_process` packet 循环异步副作用（reply 乱序/peer 竞态/心跳），违反 Karpathy #3
- **方案 B**（websocket 判断 coroutine）：伪选择性——`command_handler.handle` 含任何 await 即整体成 coroutine，判断总走 else，等价 A-full 但更绕

**范围两端**：
- **editor addon 侧**（本 spec 主体）：`command_handler.gd` + `websocket_server.gd` + `nav_commands.gd` + `heartbeat.gd`（接线点见 §7）
- **headless 侧**（`src\tools\navigation.ts`）：脚本生成改为"启动 bake + 等完成通知 + `get_vertices_count()` 判据"。headless 走 `executeGdscript`（独立 godot 进程），不涉及 dispatch 链——与 editor 侧独立，但 bake 完成检测模式同款（§9）。

**非目标**：redo 路径 bake 准确性（editor undo 系统限制，见 §11 已知局限）。

## §3 方案 A-lite 总览

**核心**：分流发生在 `websocket_server.gd:350` 调 `command_handler.handle` **之前**——按 `method.begins_with("nav_")` 识别 nav，nav 走单独 async 入口 `handle_nav_async`，非 nav 仍走同步 `handle`。

- `command_handler.handle` **保持同步不动**（`:104` 同步 return Dictionary 契约不变，30+ handler 零影响）
- 新增 `command_handler.handle_nav_async(method, params, request_id) -> Dictionary`（coroutine），路由 nav 5 method（见 §8）
- `websocket_server.gd:350` 改为：nav method → `var response = await _command_handler.handle_nav_async(...)`；else → 同步 `handle(...)`
- `_handle_message`（在 `_process(delta)` 的 packet while 循环里同步调用，`websocket_server.gd:245-249`）因此含 await 分支成 coroutine——**但 packet 循环对其的异步副作用只发生在 nav 请求上**（非 nav 走同步分支不挂起）

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

**主方案（r2 改，消除注册竞态根因）——is_baking 状态轮询**：
```gdscript
# create_region / bake_mesh 的 async handler 内，commit_action 启动 bake 之后
var _deadline = Time.get_ticks_msec() + BAKE_WAIT_TIMEOUT_MS   # 超时守卫
while _nav.is_baking:
    if Time.get_ticks_msec() > _deadline:
        break   # 超时退化为乐观判据，但 reply 必发（不死挂）
    await get_tree().process_frame
# 读当前 mesh 状态判据
var bake_result = _nav.navigation_mesh != null and _nav.navigation_mesh.get_vertices_count() > 0
```
轮询无信号、无 timer 对象、无注册竞态——查状态是当前快照，不存在"miss 历史 emit"问题。

**fallback（仅当 §12 核实项 4 确认 is_baking 不存在/不可靠）——bake_finished 信号 + timer 竞速**：baking 标志 + `bake_finished` 回调清标志 + `await` 信号/`create_timer` 竞速 + 超时读当前 mesh。信号 one-shot connect 须显式 disconnect（避节点复用累积连接）。

**超时值 BAKE_WAIT_TIMEOUT_MS**：须 **< MCP client 请求超时**（否则防了死挂但 reply 发了 client 已走）。client 超时值见 §12 核实项 6。create_region 用较短值、bake_mesh 用 120s 量级（对齐其 timeout），但两者都必须 < client 超时。

**await 恢复后节点守卫（r2 补）**：coroutine 挂起期间用户可能删了 NavigationRegion3D，恢复读 mesh 前须 `if not is_instance_valid(_nav): return {error: ...}`。

## §7 议点④：心跳暂停接线点 —— TS 包装（方案 b）+ GD 服务端超时兜底

**决策**：选 **(b) TS 侧对 nav bake action 包装 `operation_start/end`**，复用现有协议，GD coroutine 保持纯粹。

**接线点**（editor 路由层，TS 侧）：TS 识别 `bake_mesh` / `create_region(bake=true)`，请求前发 `operation_start`（带 timeout），响应/超时后发 `operation_end`，try/finally 配对。心跳暂停区间 = 请求往返期，覆盖 GD coroutine 挂起期。

**GD 侧服务端超时兜底（r2 补——心跳命门不能只靠调用方守约）**：`operation_end` 若因 TS 崩溃/网络断/bug 没发，GD 心跳会永久暂停 → 伪断连。try/finally 防不住进程崩溃。GD 侧 `heartbeat.gd:58` `pause_for_operation(timeout_sec: float, peer_id: int = -1)`（`timeout_sec` 必传无默认）须有 **hard timeout 自动恢复**：超过 timeout_sec 仍未收 operation_end → 自动 resume 心跳 + 告警日志。TS 侧 operation_start 的 timeout 须 ≥ bake 最长时间（建议对齐 §6 BAKE_WAIT_TIMEOUT_MS 或 bake_mesh 120s 量级），GD hard timeout 须 > TS timeout（留缓冲）。

**理由**：复用现有协议（`operation_start/end` 已为 TS 主动长操作设计，见 defects `operation-pause-unwired` fix-forward）+ GD `pause_for_operation` 已 per-peer 下沉（defects P1#1 `heartbeat.gd:9` `_peer_activity`）+ GD coroutine 不掺心跳逻辑。

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

**r2 叙事修正（消除对实测假设① 的依赖）**：非 bake 的 3 个 method 走非 await 分支直接 return。**正确性不依赖"coroutine 非 await 分支当帧执行"假设**——`websocket_server` 统一 `await handle_nav_async()` 保证拿到 return 值（await 驱动 coroutine 完成）。实测假设①（见 §12 核实项 7）仅影响这 3 个 method 的 **latency**（当帧 reply vs +1 frame），不影响正确性，降级为"语义确认"项。即使假设不成立，3 个非 bake nav method 多 1 frame latency @60fps（~16ms）可忽略。

`websocket_server` 侧只按 `method.begins_with("nav_")` 分流到 async 入口，不用细分哪些 bake。

## §9 headless 侧修复（与 §6 同款完成检测，独立于 editor dispatch）

`src\tools\navigation.ts`：**r2 改——不裸 `await bake()`，与 §6 同款"启动 + 等完成通知 + 判据"模式**：
- `:38-39` `genCreateRegionScript` 的 `bakeBlock`：`_nav.bake_navigation_mesh()` 启动 + 等 `is_baking` 轮询（或 bake_finished，由 §12 核实项 4 结论定）+ `await get_tree().process_frame`
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

## §11 已知局限

**redo 路径 bake 仍乐观（不可消除）**：redo 不走 MCP dispatch，redo 时 do_method 的 bake 仍同步启动后台线程不等完成——editor undo 系统固有限制（`EditorUndoRedoManager.commit_action` 同步执行 do_ops，MCP 层插不进 await）。MCP 调用路径 bake 准确，redo 路径仍乐观判据（`navigation_mesh != null`）。

**用户可见影响**（r2 补，须写进 CHANGELOG + defects 注释）：redo 后 bake_result 是乐观判据，bake 可能仍在后台跑，用户看到的 navmesh 可能不完整。**workaround**：redo 后调 `nav_bake_mesh` 走 MCP 路径得准确 bake（绕过，非消除）。此局限更新 `defects.ts:444-451` C4 deferral 注释 + CHANGELOG。

## §12 plan 前置核实项（提到 plan 第 0 步，结论回填 §6/§9）

plan 阶段须先实测/核实以下（不核实就写 task = 假设错误的返工风险）。**核实项 1-3 是根基，BLOCKING 级——其结论决定 §6/§9 的正确写法**：

1. **【BLOCKING】`bake_navigation_mesh()` 返回值与可 await 性**：返回 void / coroutine / 其他？函数内部是否含 await（即是否 coroutine）？——决定"裸 await bake()"是否有效。核实方法：Godot 文档 + `test\fixtures\gdscript-check\` 最小用例打印返回值 + await 后查 mesh。
2. **【BLOCKING】await bake 的真异步性**：若 bake_navigation_mesh 是 coroutine，`await` 它是否**真异步让出执行权**（让 packet 循环/其他请求继续），而非同步阻塞当前帧到 bake 完成？——若同步阻塞，整个 A-lite 架构（让 dispatch 链不堵）失去意义。这是架构根基假设。
3. **【BLOCKING】`is_baking` 属性/方法存在性与可靠性**：§6 主方案依赖。NavigationRegion3D 或 NavigationServer3D 是否有可查询的 baking 状态？baking 期间是否稳定 true、完成后翻 false？——若不存在，§6 退回 fallback 信号方案。
4. **bake_finished 信号语义**：存在性 + emit 时机（bake 完成时是否必发）+ `await signal` 对注册前已 emit 的行为（注册竞态）。
5. **headless main loop pump**：`godot --headless --script` 模式下 `await signal` / `await get_tree().process_frame` 是否成立（§9 可行性，memory [[godot-mcp-engine-quirks]] headless coroutine 坑）。
6. **MCP client 请求超时 + response 匹配**：client 侧请求超时值（§6 BAKE_WAIT_TIMEOUT_MS 须 < 它）+ response 按 JSON-RPC id 匹配不依赖顺序（§10 乱序）。
7. **实测假设①（降级为语义确认）**：含 await 的函数，非 await 分支的 body 是否当帧同步执行 return（影响 §8 非 bake 3 method 的 latency，不影响正确性）。验证：`test\fixtures\gdscript-check\` 最小用例。
8. **heartbeat 服务端超时行为**：`heartbeat.gd:58` `pause_for_operation(timeout_sec, peer_id)` 是否有 hard timeout 自动恢复（§7 单点故障兜底依赖）。
9. **editor 路由层 nav 调用链**：`operation_start/end` 接线点位置（`ToolDispatcher` → `EditorConnection` → WS，§7）。
10. **do_method 启动的 bake 与完成通知联动**：确认 do_method（commit_action 内）启动的 bake 会触发 `bake_finished` / `is_baking` 翻 true（§4/§6 一致性前提；不重调 bake，只等通知）。

## §13 测试策略

- **单元（TS 侧）**：`handle_nav_async` 路由（5 method 分流）、bake_result 准确判据、超时兜底（deadline 触发读当前 mesh 退化乐观）
- **GD 侧逻辑测试边界（r2 明确）**：项目主测试是 Vitest（TS），GD 侧 coroutine 逻辑（信号/状态轮询/peer 守卫）在 headless 难 mock，**主要靠集成测试**（真实 editor + 真实 bake）。plan 须界定哪些 GD 逻辑可单测、哪些只能集成测
- **集成**（需真实 Godot editor）：create_region(bake=true) 端到端——bake 完成后 vertices_count > 0、bake 挂起期间心跳不伪断连（§7 operation_start/end + GD hard timeout）、peer 中途关闭不崩（§10 守卫）、_nav 中途删除不崩（§6 守卫）
- **回归**：全量 vitest（非 nav 30+ handler 零影响）+ `check:gdscript` 4.7.1+4.6.2 双版本 `--import` 真编译（coroutine 语义版本敏感）
- **headless**：navigation.ts bake 准确判据测试（vertices_count）

## §14 验收标准

1. MCP 调用 `nav_create_region(bake=true)` / `nav_bake_mesh`：bake_result 基于真实 `get_vertices_count() > 0`（非乐观 `!=null`）
2. nav bake 挂起期间无死挂（§6 兜底）、无心跳伪断连（§7）、无 peer/_nav 恢复崩溃（§6/§10）
3. 非 nav 30+ handler 行为零变化（全量回归绿 + 当帧 reply）
4. headless 侧 bake_result 同样准确（§9）
5. `defects.ts:444-451` C4 deferral 注释更新（标注 MCP 路径 fixed / redo 路径 known limitation + workaround）+ CHANGELOG
6. 全门禁绿：tsc 0 / eslint 0 / `check:gdscript` 0-0 / 全量 vitest / `--import` 4.7.1+4.6.2

## §15 风险与回退

**最大风险**：§12 核实项 1-3 结论不利——若 bake 不可 await / await 同步阻塞 / 无 is_baking。回退预案：
- 若 await bake 同步阻塞（核实项 2 不利）：A-lite 架构需重新评估（可能需 NavigationServer callback + 主动轮询完全绕开 coroutine），spec 升级
- 若 is_baking 不存在（核实项 3 不利）：§6 退回 fallback 信号+timer 方案（接受注册竞态靠 timer 兜底，BAKE_WAIT_TIMEOUT_MS 严控 < client 超时）
- 核实项 1-3 任一不利都可能在 plan 第 0 步触发 spec r3 修订

**redo 已知局限不可消除**（editor undo 系统限制），spec 明确接受（§11）。

---

关联：memory [[gdscript-coroutine-breaks-sync-dispatch]]、`D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:444-451`、批次 C 开发日志（2026-07-24）、[[godot-mcp-engine-quirks]]（headless coroutine）。

## §16 r2 修订摘要（两轮审查采纳）

- **§1/§9**：消除"裸 `await bake()`"预判，统一"启动 bake + 等完成通知"模式（两轮审查共识：bake 返回值/可 await 性未核实）
- **§2**：澄清"范围 B（通用架构）"vs"方案 A-full/A-lite/B"编号（审查指出混淆）
- **§6**：主方案改 is_baking 状态轮询（消除信号注册竞态根因），信号+timer 降 fallback；补节点守卫 `is_instance_valid(_nav)`；BAKE_WAIT_TIMEOUT_MS 须 < client 超时
- **§7**：补 GD 侧 `pause_for_operation` hard timeout 自动恢复（心跳单点故障兜底）；补全 `pause_for_operation(timeout_sec, peer_id)` 签名
- **§8**：叙事修正——正确性不依赖实测假设①（外部统一 await 保证拿值），假设① 降级 latency 语义确认
- **§10**：peer 守卫不变（§6 补了 _nav 守卫）
- **§11**：redo 局限补用户可见影响 + workaround
- **§12**：重构为 10 项，核实项 1-3 升 BLOCKING（架构根基：返回值/真异步性/is_baking），前置 plan 第 0 步回填 §6/§9；补 client 超时/heartbeat 服务端超时/headless pump
- **§13**：明确 GD 侧逻辑测试边界（主要靠集成测试）
