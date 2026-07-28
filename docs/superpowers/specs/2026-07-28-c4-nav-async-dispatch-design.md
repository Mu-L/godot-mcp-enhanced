---
date: 2026-07-28
topic: C4 nav bake coroutine → async-dispatch（方案 A-lite）
status: spec（待 plan）
systems:
  - "[[nav-bake-in-undo-action]]"
  - "[[gdscript-coroutine-breaks-sync-dispatch]]"
  - "[[methodology-skills]]"
---

# C4 nav bake coroutine → async-dispatch 设计 spec（方案 A-lite）

> 承接 `test/regression/defects.ts:444-451` `nav-bake-in-undo-action` 的 C4 deferral 段 + memory [[gdscript-coroutine-breaks-sync-dispatch]]。
> brainstorming 2026-07-28 经方案空间→权衡→收敛 A-lite（几轮对话议定，本 spec 直接固化）。

## §1 背景与问题

**C4 deferral 根因**：`NavigationRegion3D.bake_navigation_mesh()` 是 GDScript coroutine。godot-mcp-enhanced 的同步 JSON-RPC dispatch 链不支持 coroutine handler——`addons/godot_mcp_server/command_handler.gd:144` `return _nav_commands.handle_nav_create_region(...)` 同步 return，`addons/godot_mcp_server/websocket_server.gd:351` `if response == null or not response is Dictionary:` 检查响应必须是 Dictionary。handler 含 `await` 即成 coroutine，返回 coroutine state（非 Dictionary），命中 `-32603`。

**当前 deferred 行为**（`nav_commands.gd:17-66`）：
- bake 作为 `do_method` 入 undo 栈 `do_ops`（保 P1 redo 重 bake 正确性）
- `commit_action` 同步执行 do_method，bake_navigation_mesh 跑到首个 await 点启动后台线程后返回（bake 未真正完成）
- bake_result 乐观判据 `want_bake and navigation_mesh != null`（`nav_commands.gd:66`）
- `handle_nav_bake_mesh`（`nav_commands.gd` `:146` 调用）同 bug：`node.bake_navigation_mesh()` 无 await + `success = navigation_mesh != null`

**目标**：MCP 调用路径下 bake_result 准确（bake 真正完成后 `navigation_mesh.get_vertices_count() > 0` 判据），且不破坏现有 30+ 同步 handler 契约。

## §2 目标与范围

**决策（brainstorming 选 B 通用 async-dispatch 架构 → 收敛 A-lite 精确局部化）**：建 nav async 能力，但把 coroutine 严格限制在 nav 路径，非 nav handler 零影响。

**范围两端**：
- **editor addon 侧**（本 spec 主体）：`command_handler.gd` + `websocket_server.gd` + `nav_commands.gd` + `heartbeat.gd`（接线点见 §7）
- **headless 侧**（`src/tools/navigation.ts`）：脚本生成加 `await _nav.bake_navigation_mesh()` + `get_vertices_count()` 判据。headless 走 `executeGdscript`（独立 godot 进程，脚本内可直接 await），**不涉及 dispatch 链**——trivial 修复，与 editor 侧独立。

**非目标**：redo 路径 bake 准确性（editor undo 系统限制，见 §11 已知局限）。

## §3 方案 A-lite 总览

**核心**：分流发生在 `websocket_server.gd:350` 调 `command_handler.handle` **之前**——按 `method.begins_with("nav_")` 识别 nav，nav 走单独 async 入口 `handle_nav_async`，非 nav 仍走同步 `handle`。

- `command_handler.handle` **保持同步不动**（`:104` 同步 return Dictionary 契约不变，30+ handler 零影响）
- 新增 `command_handler.handle_nav_async(method, params, request_id) -> Dictionary`（coroutine），路由 nav 5 method（见 §8）
- `websocket_server.gd:350` 改为：nav method → `var response = await _command_handler.handle_nav_async(...)`；else → 同步 `handle(...)`
- `_handle_message`（在 `_process(delta)` 的 packet while 循环里同步调用，`websocket_server.gd:245-249`）因此含 await 分支成 coroutine——**但 packet 循环对其的异步副作用只发生在 nav 请求上**：非 nav 走同步分支当帧 reply 不挂起（依赖实测假设①，见 §12）

**A-lite 严格优于 A-full（全链 await 化）**：相同 nav async 能力，改动面从"全链 30+ handler + 系统性 reply 异步"收窄到"nav 5 method + 仅 nav 请求异步"，不破坏现有同步契约，符合 Karpathy #3「只动被要求的部分」。

## §4 障碍①处理：undo do_method 同步执行，dispatch await 触及不到

**问题**：create_region 的 bake 不是直调，而是作为 `do_method` 入 undo 栈经 `undo_manager.gd:35-55` `commit_action()`（EditorUndoRedoManager 内置同步方法，`:43`）同步执行所有 add_do_method 注册调用。dispatch 链的 await 改造碰不到 commit_action 内部的 do_method 执行。

**解法（分治）**：
- bake 保留为 do_method 入 do_ops（保住 P1 redo 重 bake 正确性）
- `create_action_mixed` 之后，coroutine 里 `await` bake 完成信号（见 §6 兜底结构），再读 `navigation_mesh.get_vertices_count()` 判据 → MCP 路径 bake_result 准确
- do_method 内 bake 仍同步启动后台线程（redo 路径不变）

## §5 障碍②处理：dispatch 在 _process packet 循环里

**问题**：`_handle_message` 在 `_process(delta)` 的 packet while 循环里同步调用。若 nav coroutine 挂起几秒等 bake：
- **reply 跨帧异步**：nav reply 在 bake 完成后才发
- **乱序**：同 peer 连发两请求，第二个（同步 handler）reply 先于 nav 发出
- **peer 生命周期竞态**：coroutine 恢复时 peer 可能已 `STATE_CLOSED`/被 free
- **心跳**：bake 挂起期间需暂停心跳，否则心跳超时伪断连

**A-lite 把这些风险限制在 nav 请求**（非 nav 30+ handler 零风险）。nav 路径的三个残留风险处理见 §10。

## §6 议点③：bake 完成等待的兜底结构（功能命门）

**注册竞态**：`bake_navigation_mesh()` 启动后台线程后立即返回。空场景 / NavigationMesh 已缓存时，bake 可能在 `await bake_finished` **注册前**就 emit → await 永远等不到 → coroutine 死挂、reply 永不发、client 超时。不能赌概率，必须兜底。

**兜底结构**（plan 实现遵循）：
```gdscript
# create_region / bake_mesh 的 async handler 内
var _baking = true                                   # 前置标志
_nav.bake_finished.connect(func(): _baking = false)  # 信号回调清标志（one-shot）
# do_method 已在 commit_action 内启动 bake 后台线程（见 §4）
var _timer = get_tree().create_timer(30.0)            # 超时守卫（bake_mesh 用 120s 对齐 timeout）
await _baking_cleared_or_timeout(_nav.bake_finished, _timer)  # 信号/timer 竞速
# 任一触发都继续；读当前 mesh 状态判据（超时则退化为乐观，但不死挂）
var bake_result = _nav.navigation_mesh != null and _nav.navigation_mesh.get_vertices_count() > 0
```

关键：`await` 信号与 `create_timer(N)` 竞速，任一触发都继续；超时按当前 mesh 状态读判据（退化为乐观判据，但 reply 必发，不死挂）。

**plan 前置核实**（见 §12）：`NavigationRegion3D` 是否有 `bake_finished` 信号 + 可查询的 baking 状态（优先查状态避免 await 注册竞态）+ Godot 4 `await signal` 对注册前已 emit 的语义。

## §7 议点④：心跳暂停接线点 —— TS 包装（方案 b）

**决策**：选 **(b) TS 侧对 nav bake action 包装 `operation_start/end`**，复用现有协议，GD 侧零改动。

**接线点**（editor 路由层，TS 侧）：TS 识别 `bake_mesh` / `create_region(bake=true)`，请求前发 `operation_start`，响应/超时后发 `operation_end`，try/finally 配对。心跳暂停区间 = 请求往返期，正好覆盖 GD coroutine 挂起期。

**理由**：
- 复用现有协议（`operation_start/end` 已为 TS 主动长操作设计，见 defects `operation-pause-unwired` fix-forward）
- GD `heartbeat.gd` `pause_for_operation(pid)` 已 per-peer 下沉（defects P1#1 `:9` `_peer_activity`）
- GD coroutine 保持纯粹（不掺心跳逻辑，职责单一）
- 与 defects fix-forward 同源，非新机制

**备选 (a) GD 本地 pause/resume**（coroutine 内 `await` 前后 `_heartbeat.pause_for_operation`/`resume`）更内聚，但心跳暂停逻辑分散（TS `operation_start` + GD 本地两套）——不选。

**plan 前置核实**：editor 路由层 nav 工具的 TS 调用链（`ToolDispatcher` → `EditorConnection` → WS），确认 `operation_start/end` 接线点位置。

## §8 议点⑤：nav 5 method 路由 —— 只 bake 两 async

`handle_nav_async` 因含 await 分支（create_region/bake_mesh）整体是 coroutine，`websocket_server` 对所有 nav method 都 `await handle_nav_async(...)`。但内部路由区分，把 coroutine 开销只压在真正 bake 的两 method：

```gdscript
func handle_nav_async(method: String, params: Dictionary, request_id: int) -> Dictionary:
    match method:
        "nav_create_region": return await _nav_commands.handle_nav_create_region_async(params, request_id)
        "nav_bake_mesh":     return await _nav_commands.handle_nav_bake_mesh_async(params)
        "nav_create_agent":  return _nav_commands.handle_nav_create_agent(params, request_id)   # 同步，不 await
        "nav_set_params":    return _nav_commands.handle_nav_set_params(params)
        "nav_create_link":   return _nav_commands.handle_nav_create_link(params, request_id)
```

非 bake 的三个 method 走非 await 分支（依赖实测假设①：coroutine 函数非 await 分支同步执行 return，当帧 reply）。`websocket_server` 侧只按 `method.begins_with("nav_")` 分流到 async 入口，不用细分哪些 bake。

## §9 headless 侧修复（独立于 editor addon）

`src/tools/navigation.ts`：
- `:38-39` `genCreateRegionScript` 的 `bakeBlock`：`_nav.bake_navigation_mesh()` → `await _nav.bake_navigation_mesh()`（executeGdscript 独立进程支持脚本内 await）
- `:60-61` `baked` 输出：从 `${bake}`（是否请求 bake）改为 bake 完成后 `navigation_mesh.get_vertices_count() > 0` 判据
- `:80-82` `genBakeMeshScript`：`_nav.bake_navigation_mesh()` → `await`，`_bake_ok = navigation_mesh != null` → `get_vertices_count() > 0`

headless 脚本内 await 不涉及 dispatch 链，bake 完成后 `_mcp_done()` 正常返回。

## §10 nav 路径残留风险处理

**乱序**：nav bake 挂起期间同 peer 连发的非 nav 请求 reply 先发。JSON-RPC 允许乱序（client 按 id 匹配）。**plan 前置核实**：grep TS 侧 response 匹配逻辑（`EditorConnection` / MCP client），确认按 id 匹配不依赖顺序。

**peer 生命周期竞态**：nav coroutine 在 bake 完成恢复时 peer 可能已 `STATE_CLOSED`/被 free。**恢复点守卫**（`websocket_server` send reply 前）：
```gdscript
if not is_instance_valid(peer) or peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
    return   # coroutine 挂起期间 peer 已关闭，丢弃 reply
```

**心跳**：§7 议点④ TS 包装 `operation_start/end` 处理。

## §11 已知局限

**redo 路径 bake 仍乐观**：redo 不走 MCP dispatch，redo 时 do_method 的 bake 仍同步启动后台线程不等完成（editor undo 系统限制，`EditorUndoRedoManager.commit_action` 同步执行 do_ops，无法在 MCP 层插入 await）。MCP 调用路径 bake 准确，redo 路径仍乐观判据。此局限写进 `defects.ts` C4 deferral 注释更新 + CHANGELOG。

## §12 plan 前置核实项

plan 阶段须先实测/核实以下假设（不核实就写 task = 假设错误的返工风险）：

1. **实测假设①**（A-lite 非 nav 当帧执行的基础）：Godot 4 含 `await` 的函数，非 await 分支的 body 是否同步执行到 return（当帧完成）vs 无论如何总返 coroutine。验证方法：`D:\GitHub\godot-mcp-enhanced\test\fixtures\gdscript-check\` 写最小用例——含 await 的函数走非 await 分支，调用后立即检查分支副作用是否当帧发生。
2. **`NavigationRegion3D.bake_finished` 信号**存在性 + 可查询的 baking 状态（`is_baking` 或类似，优先查状态避免 await 注册竞态）。
3. **Godot 4 `await signal` 注册竞态语义**：await 注册前信号已 emit，await 是否捕获（§6 兜底结构依赖）。
4. **TS 侧 response 匹配**：`EditorConnection` / MCP client 按 JSON-RPC id 匹配，不依赖顺序（§10 乱序）。
5. **editor 路由层 nav 工具调用链**：`operation_start/end` 接线点位置（§7 议点④）。
6. **`bake_navigation_mesh()` 重复调语义**：do_method 已启动后台 bake 后，coroutine 再 `await nav.bake_navigation_mesh()` 是否重复 bake（确认 §6 用 bake_finished 信号而非重调 bake 的必要性）。

## §13 测试策略

- **单元**：`handle_nav_async` 路由（5 method 分流）、bake_result 准确判据（mock bake_finished）、超时兜底（timer 触发读当前 mesh）、peer 守卫（恢复点 peer CLOSED 丢弃 reply）
- **集成**（需真实 Godot editor）：create_region(bake=true) 端到端——bake 完成后 vertices_count > 0、bake 挂起期间心跳不伪断连、peer 中途关闭不崩
- **回归**：全量 vitest（确保非 nav 30+ handler 零影响）+ `check:gdscript` 4.7.1+4.6.2 双版本 `--import` 真编译（coroutine 语义版本敏感）
- **headless**：navigation.ts bake 准确判据测试（vertices_count）

## §14 验收标准

1. MCP 调用 `nav_create_region(bake=true)` / `nav_bake_mesh`：bake_result 基于真实 `get_vertices_count() > 0`（非乐观 `!=null`）
2. nav bake 挂起期间无死挂（兜底结构）、无心跳伪断连（§7）、无 peer 恢复崩溃（§10）
3. 非 nav 30+ handler 行为零变化（全量回归绿 + 当帧 reply）
4. headless 侧 bake_result 同样准确（§9）
5. `defects.ts` C4 deferral 注释更新（标注 MCP 路径 fixed / redo 路径 known limitation）+ CHANGELOG
6. 全门禁绿：tsc 0 / eslint 0 / `check:gdscript` 0-0 / 全量 vitest / `--import` 4.7.1+4.6.2

## §15 风险与回退

**最大风险**：实测假设①不成立（含 await 函数总返 coroutine 不执行 body）→ A-lite 非 nav 分流失效，退化为所有 nav method 都跨帧。即使如此，A-lite 仍不比 A-full 差（nav 分流到独立入口价值不变），且非 nav 走同步 `handle` 完全不受影响。回退预案：若实测假设①错，nav 内部路由不再区分（5 method 都 await），`websocket_server` 仍按 `begins_with("nav_")` 分流。

**redo 已知局限不可消除**（editor undo 系统限制），spec 明确接受。

---

关联：memory [[gdscript-coroutine-breaks-sync-dispatch]]、`test/regression/defects.ts:444-451`、批次 C 开发日志（2026-07-24）、[[godot-mcp-engine-quirks]]（headless coroutine）。
