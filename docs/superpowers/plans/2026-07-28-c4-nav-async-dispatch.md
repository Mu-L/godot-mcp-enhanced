# C4 nav bake coroutine → async-dispatch 实现计划（方案 A-lite）

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐 task 实现。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** MCP 调用路径下 nav bake_result 准确（bake 真正完成后 `get_vertices_count() > 0` 判据），且不破坏现有 30+ 同步 handler 契约。

**Architecture:** A-lite 精确局部化——`websocket_server.gd:350` 调 `command_handler.handle` 前按 `method.begins_with("nav_")` 分流到新增 coroutine 入口 `handle_nav_async`，非 nav 仍走同步 `handle`。nav bake 走 is_baking 状态轮询（fallback bake_finished 信号）等完成，配 TS 侧 `operation_start/end` 暂停心跳 + GD P1#3 hard timeout 兜底。

**Tech Stack:** GDScript 4.6+4.7（addon）、TypeScript（TS 侧）、Vitest（主测试）、`check:gdscript` `--import` 真编译（GD 双版本）。

## Global Constraints

- Godot 双版本支持：4.7.1 + 4.6.2，所有 GD 改动须双版本 `check:gdscript` `--import` 真编译通过（coroutine 语义版本敏感）
- 全门禁：tsc 0 / eslint 0 / `check:gdscript` 0-0 / 全量 vitest 绿
- GD 侧 coroutine 逻辑（信号/状态轮询/守卫）在 headless 难 mock，**主要靠集成测试**；可单测的纯逻辑（路由分流、判据）用 Vitest
- spec：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-28-c4-nav-async-dispatch-design.md`（r4），本 plan 承接其 §12 核实项 0-3 为 Task 0 前置门
- 绝对路径引用所有文件

---

## Task 0: BLOCKING 核实（go/no-go 关口）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\test\fixtures\gdscript-check\nav-bake-probe\`（最小核实用例）
- Read: `D:\GitHub\godot-mcp-enhanced\src\core\EditorConnection.ts`（client 超时）

**Interfaces:**
- Produces: 核实结论文档（写入本 plan 顶部「Task 0 结论」段，回填 Task 3/6 写法）

**说明:** 不核实就写 Task 3 = 假设错误的返工风险。Task 0 结论决定 Task 3/6 用 is_baking 主方案还是 fallback 信号方案，或触发 spec r5。

- [ ] **Step 1: 写 bake 执行模型核实脚本（核实项 0/1/2/3）**

`test\fixtures\gdscript-check\nav-bake-probe\probe.gd`：
```gdscript
extends SceneTree

func _init():
    var nav = NavigationRegion3D.new()
    var mesh = NavigationMesh.new()
    nav.navigation_mesh = mesh
    # 核实项 1: 返回值类型
    var ret = nav.bake_navigation_mesh()
    print("BAKE_RET_TYPE=%s" % typeof(ret))
    print("BAKE_RET_VALUE=%s" % ret)
    # 核实项 0: 是否立即返回（bake 后台线程异步 vs 同步阻塞）
    # 核实项 3: is_baking 存在性 + 翻 true 时机
    print("HAS_IS_BAKING=%s" % nav.has_method("is_baking") or "is_baking" in nav)
    if "is_baking" in nav:
        print("IS_BAKING_AFTER_CALL=%s" % nav.is_baking)
    # 核实项 4: bake_finished 信号存在性
    print("HAS_BAKE_FINISHED_SIGNAL=%s" % (nav.is_connected("bake_finished", Callable()) or nav.has_signal("bake_finished")))
    print("PROBE_DONE")
    quit()
```

- [ ] **Step 2: 双版本跑核实脚本**

Run（4.7）: `cd /d/GitHub/godot-mcp-enhanced && "<GODOT_4_7_PATH>" --headless --script test/fixtures/gdscript-check/nav-bake-probe/probe.gd`
Run（4.6）: 同上换 `<GODOT_4_6_PATH>`
Expected: 打印 BAKE_RET_TYPE / HAS_IS_BAKING / IS_BAKING_AFTER_CALL / HAS_BAKE_FINISHED_SIGNAL。**记录输出到本 plan「Task 0 结论」段**。

- [ ] **Step 3: 核实项 0 真异步性（架构根基）**

在 probe.gd 加时间戳：`bake_navigation_mesh()` 调用前后各 `print(Time.get_ticks_usec())`。若两者差值 < 1ms（立即返回，后台线程）→ 核实项 0 通过（A-lite 成立）；若差值 = bake 耗时（同步阻塞）→ **核实项 0 不利，触发 spec r5，STOP**。

- [ ] **Step 4: 核实项 5 headless pump**

probe.gd 已用 `extends SceneTree` + `_init`。若 Step 2 的 print 全部输出（脚本跑完），说明 headless `--script` 支持 await（核实项 5 通过）。若需 await 信号/process_frame，改 probe 加 `await get_tree().process_frame` 确认 headless pump。

- [ ] **Step 5: 核实项 6 client 超时 + response 匹配**

Grep `EditorConnection.ts` 的 request 超时值 + response id 匹配：
Run: `cd /d/GitHub/godot-mcp-enhanced && grep -n "timeout\|requestId\|pending\|id =" src/core/EditorConnection.ts | head -30`
Expected: 找到 client 请求超时值（须 > 600s，否则 §7 时间轴边界要调）+ response 按 id 匹配逻辑（乱序 OK）。

- [ ] **Step 6: 核实项 9/10 editor 调用链 + do_method 联动**

确认 `editor-method-map.ts:110-116` nav 已登记（无 transformArgs，bake 直达）+ `undo_manager.gd:35-55` do_method 经 commit_action 同步执行。do_method 启动的 bake 是否触发 is_baking/bake_finished——若 Step 2 probe 的 IS_BAKING 不可查，Task 3 改用「do_method 不依赖 is_baking，coroutine 直接 await bake_finished 信号 + timer 兜底」。

- [ ] **Step 7: 记录结论 + go/no-go**

在本 plan 顶部「Task 0 结论」段填写：
- 核实项 0（bake 异步）: PASS/FAIL
- 核实项 1（返回值）: void/coroutine/其他
- 核实项 2（await 真异步）: PASS/SKIP（核实项1为void则跳过）/FAIL
- 核实项 3（is_baking）: 存在/不存在 + 翻 true 时机 + 双版本
- 核实项 6（client 超时）: 具体值，是否 > 600s
- 决策: Task 3/6 用【is_baking 主方案】/【fallback 信号方案】/【spec r5 重新评估】

**go/no-go:** 核实项 0 FAIL → STOP，回 spec r5。其余 FAIL → Task 3/6 切 fallback 路径。

- [ ] **Step 8: Commit 核实脚本**

```bash
cd /d/GitHub/godot-mcp-enhanced
git add test/fixtures/gdscript-check/nav-bake-probe/probe.gd
git commit -m "test(nav-bake): Task 0 BLOCKING 核实脚本（bake 执行模型/is_baking/双版本）"
```

---

## Task 1: heartbeat P1#3 行为验证（降级，已有 hard timeout）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\heartbeat.gd:37-46`（可选补告警日志）

**Interfaces:**
- Consumes: `pause_for_operation(timeout_sec, peer_id)` / `resume(peer_id)` 已实现
- Produces: 确认 GD 侧心跳 hard timeout 自动恢复可用（§7 单点故障兜底已守）

**说明:** spec r4 确认 `heartbeat.gd:37-46` 已有 P1#3 hard timeout（`op_timer > op_timeout` → `paused=false`）。本 task 只验证行为 + 可选补 push_warning 告警（spec §7:119 标"可选 polish"）。**不新增 hard timeout 机制**。

- [ ] **Step 1: 验证 P1#3 行为（读代码确认）**

Read `heartbeat.gd:37-46`，确认 `if state.paused: state.op_timer += delta; if state.op_timer > state.op_timeout: state.paused = false ...`。预期：暂停超时后自动恢复，非 emit timeout_detected 断连。

- [ ] **Step 2: 可选补告警日志**

若需告警（spec §7:119 可选），`heartbeat.gd:43` `state.paused = false` 前加：
```gdscript
push_warning("[MCP] heartbeat operation pause hard-timeout (peer_id=%d) — auto-resume (operation_end not received?)" % pid)
```
（`pid` 在 `tick(delta, peer)` 作用域内可用，:34）

- [ ] **Step 3: Commit（若有改动）**

```bash
git add addons/godot_mcp_server/heartbeat.gd
git commit -m "feat(heartbeat): nav bake 长操作暂停超时补告警日志（P1#3 hard timeout 已有，polish）"
```

---

## Task 2: command_handler.handle_nav_async 路由（§8）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd:104-152`（保留同步 `handle`，新增 `handle_nav_async`）
- Test: `D:\GitHub\godot-mcp-enhanced\test\` 新增 command_handler 路由测试（若项目有 GD 路由测试 fixture；否则进集成测试 Task 8）

**Interfaces:**
- Consumes: `_nav_commands`（已 setup，:47-49）
- Produces: `handle_nav_async(method, params, request_id) -> Dictionary`（coroutine，被 websocket_server Task 4 await）

- [ ] **Step 1: 写路由测试（5 method 分流）**

测试 `handle_nav_async` 对 5 个 nav method 路由正确（bake 两 method 走 await async handler，其余同步 return）。若 GD 路由难单测，记为集成测试覆盖（Task 8）。

- [ ] **Step 2: 加 handle_nav_async 函数**

在 `command_handler.gd` 的 `handle` 函数（:104）之后加：
```gdscript
## nav 专用 async 入口（A-lite：nav 走 coroutine，非 nav 走同步 handle）。
## websocket_server 按 method.begins_with("nav_") 分流到此。spec §8。
func handle_nav_async(method: String, params: Dictionary, request_id: int) -> Dictionary:
    match method:
        "nav_create_region": return await _nav_commands.handle_nav_create_region_async(params, request_id)
        "nav_bake_mesh":     return await _nav_commands.handle_nav_bake_mesh_async(params)
        "nav_create_agent":  return _nav_commands.handle_nav_create_agent(params, request_id)
        "nav_set_params":    return _nav_commands.handle_nav_set_params(params)
        "nav_create_link":   return _nav_commands.handle_nav_create_link(params, request_id)
        _:
            return {"error": {"code": -32601, "message": "Unknown nav method: %s" % method}}
```

- [ ] **Step 3: 确认同步 handle 不动**

确认 `handle`（:104-242）的 nav 分支（:143-152）**保留**（作同步兜底，契约不变；实际 websocket_server 会分流 nav 到 handle_nav_async，但 handle 内 nav case 不删——防御性兜底）。

- [ ] **Step 4: check:gdscript 双版本编译**

Run: `cd /d/GitHub/godot-mcp-enhanced && npm run check:gdscript`
Expected: 0 error（4.7.1 + 4.6.2 双版本 `--import` 真编译通过）。

- [ ] **Step 5: Commit**

```bash
git add addons/godot_mcp_server/command_handler.gd
git commit -m "feat(command_handler): 新增 handle_nav_async coroutine 入口（A-lite nav 分流，§8）"
```

---

## Task 3: nav_commands async handler（§6 is_baking 主方案 + 循环内守卫）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\nav_commands.gd:16-90`
- Test: 集成测试（Task 8，GD coroutine 难单测）

**Interfaces:**
- Consumes: Task 0 结论（is_baking 主方案 vs fallback）、`_undo_manager`、`_plugin`
- Produces: `handle_nav_create_region_async(params, request_id) -> Dictionary`、`handle_nav_bake_mesh_async(params) -> Dictionary`（coroutine，被 Task 2 await）

**前置:** Task 0 核实项 3 结论决定主方案（is_baking）或 fallback（信号）。下方 Step 2 给主方案代码；Step 6 给 fallback 替换块（Task 0 不利时用）。

- [ ] **Step 1: 确认 Task 0 结论**

读本 plan「Task 0 结论」段。若核实项 3 = is_baking 存在且双版本 → 用 Step 2 主方案。若不存在/不可靠 → 用 Step 6 fallback。

- [ ] **Step 2: handle_nav_create_region_async（is_baking 主方案）**

在 `nav_commands.gd` 的 `handle_nav_create_region`（:16）之后加 async 兄弟版。原 `handle_nav_create_region` 保留（同步兜底，不删）：
```gdscript
const BAKE_WAIT_TIMEOUT_MS := 28000  # < client 超时（Task 0 核实项 6 确认 > 28s）；bake_mesh 路径用 110000

## nav_create_region async 版（A-lite coroutine handler）。spec §6。
## bake 保留为 do_method 入 undo（保 P1 redo 重 bake），commit 后等 is_baking 轮询完成。
func handle_nav_create_region_async(params: Dictionary, request_id: int) -> Dictionary:
    var root = CommandHelpers.get_edited_scene_root(_plugin)
    if root == null:
        return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

    var node_name: String = params.get("name", "NavRegion")
    var parent_path: String = params.get("parent", "")
    var parent_node: Node = CommandHelpers.find_node(root, parent_path) if parent_path != "" else root
    if parent_node == null:
        return {"error": {"code": -32002, "message": "Parent not found: " + parent_path}}

    var nav = NavigationRegion3D.new()
    nav.name = node_name
    var pos = params.get("position")
    if pos != null and pos is Dictionary:
        nav.position = Vector3(float(pos.get("x", 0.0)), float(pos.get("y", 0.0)), float(pos.get("z", 0.0)))

    var mesh = NavigationMesh.new()
    mesh.geometry_parsed_collision_mask = 0xFFFFFFFF
    nav.navigation_mesh = mesh

    var want_bake: bool = params.get("bake", false)
    var bake_result: bool = false

    # ── do_ops 构建与 commit（与原同步版一致，bake 作 do_method 入 undo）──
    if _undo_manager != null:
        var do_ops: Array = [
            {"type": "method", "target": parent_node, "method": "add_child", "args": [nav]},
            {"type": "method", "target": nav, "method": "set_owner", "args": [root]},
            {"type": "reference", "value": nav}
        ]
        if want_bake:
            do_ops.append({"type": "method", "target": nav, "method": "bake_navigation_mesh", "args": []})
        _undo_manager.create_action_mixed("Create Nav Region (req:%d)" % request_id, do_ops,
            [{"type": "method", "target": parent_node, "method": "remove_child", "args": [nav]}])
    else:
        parent_node.add_child(nav)
        nav.owner = root
        if want_bake:
            nav.bake_navigation_mesh()

    # ── §6: 等 bake 完成（is_baking 轮询，循环内守卫）──
    if want_bake:
        await get_tree().process_frame  # 先等一帧确保 is_baking 已置位（避翻 true 时序缝隙，Task 0 核实项 3）
        var _deadline = Time.get_ticks_msec() + BAKE_WAIT_TIMEOUT_MS
        while true:
            if not is_instance_valid(nav):
                return {"error": {"code": -32003, "message": "NavigationRegion3D freed during bake"}}
            if not nav.is_baking:
                break
            if Time.get_ticks_msec() > _deadline:
                break  # 超时退化为乐观判据，但 reply 必发（不死挂）
            await get_tree().process_frame
        bake_result = is_instance_valid(nav) and nav.navigation_mesh != null and nav.navigation_mesh.get_vertices_count() > 0

    return {"result": {"node_path": str(nav.get_path()), "type": "NavigationRegion3D", "baked": bake_result}}
```

- [ ] **Step 3: handle_nav_bake_mesh_async（is_baking 主方案）**

在 `handle_nav_bake_mesh`（:76）之后加 async 兄弟版：
```gdscript
## nav_bake_mesh async 版（A-lite coroutine handler）。spec §6。bake_mesh 用更长超时。
func handle_nav_bake_mesh_async(params: Dictionary) -> Dictionary:
    var root = CommandHelpers.get_edited_scene_root(_plugin)
    if root == null:
        return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

    var node_path: String = params.get("node_path", "")
    var node = CommandHelpers.find_node(root, node_path)
    if node == null:
        return {"error": {"code": -32002, "message": "Node not found: " + node_path}}
    if not (node is NavigationRegion3D):
        return {"error": {"code": -32004, "message": "Node is not a NavigationRegion3D: " + node_path}}

    var nav: NavigationRegion3D = node
    nav.bake_navigation_mesh()
    await get_tree().process_frame
    var _deadline = Time.get_ticks_msec() + 110000  # bake_mesh 120s timeout 量级，留余量
    while true:
        if not is_instance_valid(nav):
            return {"error": {"code": -32003, "message": "NavigationRegion3D freed during bake"}}
        if not nav.is_baking:
            break
        if Time.get_ticks_msec() > _deadline:
            break
        await get_tree().process_frame
    var success = nav.navigation_mesh != null and nav.navigation_mesh.get_vertices_count() > 0
    return {"result": {"node": node_path, "success": success, "status": "bake_completed"}}
```

- [ ] **Step 4: 更新函数头 C4 注释（:16-22）**

`nav_commands.gd:16-22` 原 C4 deferral 注释更新为：
```gdscript
# C4 resolved (2026-07-28, A-lite async-dispatch): bake 经 handle_nav_create_region_async
# coroutine 等 is_baking 轮询完成，bake_result 准确（get_vertices_count > 0）。
# 原 handle_nav_create_region（同步版）保留作兜底；websocket_server 分流 nav 到 _async 版。
# redo 路径仍乐观（editor undo 系统限制，spec §11）。
```

- [ ] **Step 5: check:gdscript 双版本编译**

Run: `cd /d/GitHub/godot-mcp-enhanced && npm run check:gdscript`
Expected: 0 error。

- [ ] **Step 6（条件）: fallback 信号方案（仅 Task 0 核实项 3 不利时用）**

若 Task 0 确认 is_baking 不存在/不可靠，Step 2/3 的 while 轮询块替换为 bake_finished 信号 + timer 竞速（spec §6 fallback）：
```gdscript
if want_bake:
    var _baking = true
    var _cb = func(): _baking = false
    nav.bake_finished.connect(_cb)
    var _deadline = Time.get_ticks_msec() + BAKE_WAIT_TIMEOUT_MS
    while _baking and Time.get_ticks_msec() < _deadline:
        if not is_instance_valid(nav):
            nav.bake_finished.disconnect(_cb)
            return {"error": {"code": -32003, "message": "NavigationRegion3D freed during bake"}}
        await get_tree().process_frame
    if nav.bake_finished.is_connected(_cb):
        nav.bake_finished.disconnect(_cb)  # one-shot 显式断开，避节点复用累积
    bake_result = is_instance_valid(nav) and nav.navigation_mesh != null and nav.navigation_mesh.get_vertices_count() > 0
```

- [ ] **Step 7: Commit**

```bash
git add addons/godot_mcp_server/commands/nav_commands.gd
git commit -m "feat(nav_commands): create_region/bake_mesh async handler（is_baking 轮询+循环内守卫，§6）"
```

---

## Task 4: websocket_server 分流 nav + peer 守卫（§3/§10）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:264-364`（`_handle_message` 加 nav 分流 + peer 守卫）
- Test: 集成测试（Task 8）

**Interfaces:**
- Consumes: Task 2 `handle_nav_async`、`_heartbeat`（已在作用域）
- Produces: nav 请求走 await handle_nav_async，非 nav 走同步 handle（契约不变）

- [ ] **Step 1: _handle_message 加 nav 分流**

`websocket_server.gd:349-354`（原同步 dispatch）改为：
```gdscript
    _request_counter = (_request_counter + 1) % 1000000
    var _method: String = parsed.get("method", "")
    var response: Dictionary
    if _method.begins_with("nav_"):
        # A-lite: nav 走 async 入口（spec §3）。packet 循环不 await 本 coroutine——
        # 挂起期间循环继续处理下个 packet（非 nav 当帧 reply），nav reply 在 bake 完成后自行恢复发。
        response = await _command_handler.handle_nav_async(_method, parsed.get("params", {}), _request_counter)
    else:
        response = _command_handler.handle(_method, parsed.get("params", {}), _request_counter)
    # §10 peer 生命周期守卫：coroutine 恢复时 peer 可能已 CLOSED/被 free
    if not is_instance_valid(peer) or peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
        push_warning("[MCP] nav coroutine resumed but peer gone (method=%s), reply dropped" % _method)
        return
    if response == null or not response is Dictionary:
        push_warning("[MCP] command_handler returned null/non-dict for method: %s" % _method)
        peer.send_text(JSON.stringify({"jsonrpc": "2.0", "id": parsed.get("id"), "error": {"code": -32603, "message": "Internal error: handler returned invalid response"}}))
        return
```
（下方 `var reply = ...` 起，:355-364 原样保留）

- [ ] **Step 2: 确认 packet 循环不串行化**

Read `websocket_server.gd:245-249`，确认 `while peer.get_available_packet_count() > 0` 循环里调 `_handle_message(text, peer)` **不加 await**（nav coroutine 挂起时循环继续）。spec §3:51 警示：**切勿把 packet 循环串行化 await 挂起 coroutine**（会堵死非 nav 请求）。

- [ ] **Step 3: check:gdscript 双版本编译**

Run: `cd /d/GitHub/godot-mcp-enhanced && npm run check:gdscript`
Expected: 0 error。注意 `_handle_message` 现含 await 分支，成 coroutine——编译器对 `-> void` coroutine 应无警告（GDScript 允许 coroutine 返回 void）。

- [ ] **Step 4: Commit**

```bash
git add addons/godot_mcp_server/websocket_server.gd
git commit -m "feat(websocket_server): nav 分流到 handle_nav_async + peer 生命周期守卫（§3/§10）"
```

---

## Task 5: EditorToolExecutor 接线 startOperation/endOperation（§7）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\EditorToolExecutor.ts:58-79`（`_executeInner` 加 nav bake 包装）
- Test: `D:\GitHub\godot-mcp-enhanced\test\core\EditorToolExecutor.test.ts`（若存在；否则新增）

**Interfaces:**
- Consumes: `this.conn.startOperation(timeoutSec)` / `this.conn.endOperation()`（EditorConnection.ts:419-424 已有，零生产调用——defects operation-pause-unwired）
- Produces: nav bake 请求前后自动 operation_start/end，心跳暂停覆盖 bake 挂起期

**前置:** `editor-method-map.ts:110-116` nav 无 transformArgs，`finalArgs.bake` 直达 `_executeInner`。

- [ ] **Step 1: 写测试（nav bake 触发 startOperation/endOperation 配对）**

测试 `_executeInner` 对 `method === 'nav_bake_mesh'` 或 `(method === 'nav_create_region' && args.bake === true)` 调 `conn.startOperation` + `conn.endOperation`（try/finally），非 bake nav method 不调。mock conn.request 验证调用顺序。

- [ ] **Step 2: 跑测试确认 fail**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx vitest run test/core/EditorToolExecutor.test.ts -t "nav bake operation"`
Expected: FAIL（未实现）。

- [ ] **Step 3: 实现 nav bake 包装**

`EditorToolExecutor.ts:73-79`（resolveEditorMethod 后、conn.request 前）改为：
```typescript
      const entry = resolveEditorMethod(toolName, args);
      const method = entry?.method ?? toolName;
      const finalArgs = entry?.transformArgs ? entry.transformArgs(args) : args;

      // §7 A-lite: nav bake 长操作包 operation_start/end 暂停心跳（EditorConnection.ts:419-424 已有）。
      // 接线 defects operation-pause-unwired（startOperation/endOperation 零生产调用）。
      // T_ts 对齐 §6 BAKE_WAIT_TIMEOUT_MS（bake_mesh 110s 量级，clamp ≤600）。GD P1#3 hard timeout 兜底（heartbeat.gd:37-46）。
      const isNavBake = method === 'nav_bake_mesh'
        || (method === 'nav_create_region' && finalArgs.bake === true);
      const NAV_BAKE_OP_TIMEOUT_SEC = 110;  // < GD clamp 600，> §6 BAKE_WAIT_TIMEOUT_MS

      if (isNavBake) {
        await this.conn.startOperation(NAV_BAKE_OP_TIMEOUT_SEC);
        try {
          const result = await this.conn.request(method, finalArgs);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } finally {
          await this.conn.endOperation();
        }
      }

      const result = await this.conn.request(method, finalArgs);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx vitest run test/core/EditorToolExecutor.test.ts -t "nav bake operation"`
Expected: PASS。

- [ ] **Step 5: tsc + eslint**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx tsc --noEmit && npx eslint src/core/EditorToolExecutor.ts`
Expected: 0 error。

- [ ] **Step 6: Commit**

```bash
git add src/core/EditorToolExecutor.ts test/core/EditorToolExecutor.test.ts
git commit -m "feat(EditorToolExecutor): nav bake 接线 operation_start/end 暂停心跳（§7，defects operation-pause-unwired 闭环）"
```

---

## Task 6: headless navigation.ts 同款完成检测（§9）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\navigation.ts:32-85`（genCreateRegionScript / genBakeMeshScript）

**Interfaces:**
- Consumes: Task 0 核实项 5（headless pump 成立）
- Produces: headless 脚本 bake 完成后 `get_vertices_count() > 0` 判据（非乐观 `!=null`）

- [ ] **Step 1: 改 genBakeMeshScript（:66-85）**

```typescript
function genBakeMeshScript(nodePath: string): string {
  return `${SCENE_TREE_HEADER}

func _initialize():
	_mcp_load_main_scene()
	var _nav = _mcp_get_node("${gdEscape(nodePath)}")
	if _nav == null:
		_mcp_output("error", "NavigationRegion3D not found: ${gdEscape(nodePath)}")
		_mcp_done()
		return
	if not (_nav is NavigationRegion3D):
		_mcp_output("error", "Node is not a NavigationRegion3D: ${gdEscape(nodePath)}")
		_mcp_done()
		return
	_nav.bake_navigation_mesh()
	# §9/§6 同款：等 bake 完成（is_baking 轮询，Task 0 核实项 5 确认 headless pump）
	await _wait_bake_done(_nav)
	var _bake_ok = _nav.navigation_mesh != null and _nav.navigation_mesh.get_vertices_count() > 0
	_mcp_output("baked", {"node": "${gdEscape(nodePath)}", "success": _bake_ok})
	_mcp_done()

func _wait_bake_done(_nav):
	await get_tree().process_frame
	var _deadline = Time.get_ticks_msec() + 110000
	while _nav.is_baking and Time.get_ticks_msec() < _deadline:
		await get_tree().process_frame
`;
}
```
（若 Task 0 核实项 3 不利，`_wait_bake_done` 改 bake_finished 信号版本，与 Task 3 Step 6 同款）

- [ ] **Step 2: 改 genCreateRegionScript bakeBlock（:38-40）+ baked 输出（:60-61）**

bakeBlock 改为启动 bake + 调 `_wait_bake_done`；`baked` 输出从 `${bake}` 改为 bake 完成后 `get_vertices_count() > 0`。`_wait_bake_done` helper 提取为两脚本共用（或在 SCENE_TREE_HEADER 生成）。

- [ ] **Step 3: 跑现有 navigation 测试**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx vitest run test/tools/navigation.test.ts`
Expected: 现有用例 pass（可能需更新 baked 判据断言从 `!=null` 到 `vertices_count`）。

- [ ] **Step 4: tsc + eslint**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx tsc --noEmit && npx eslint src/tools/navigation.ts`
Expected: 0 error。

- [ ] **Step 5: Commit**

```bash
git add src/tools/navigation.ts test/tools/navigation.test.ts
git commit -m "feat(navigation): headless bake 等 is_baking 完成 + vertices_count 判据（§9，与 editor §6 同款）"
```

---

## Task 7: defects.ts + CHANGELOG + close-loop（§11/§14）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:444-457`（C4 deferral 注释 + detect）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts`（`editor-method-map-missing-...-nav` status open→fixed，status 滞后 close-loop）
- Modify: `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md`

**Interfaces:**
- Consumes: Task 0-6 完成
- Produces: C4 注释更新（MCP 路径 fixed / redo 路径 known limitation + workaround）+ editor-method-map status 修正

- [ ] **Step 1: 更新 C4 deferral 注释（defects.ts:444-452）**

`defects.ts:447-452` C4 deferral 段更新为：
```typescript
    // C4 resolved (2026-07-28, A-lite async-dispatch): MCP 调用路径 bake 准确——
    //   handle_nav_create_region_async coroutine 等 is_baking 轮询完成，bake_result = vertices_count > 0。
    //   已知局限: redo 路径 bake 仍乐观（editor undo 系统 commit_action 同步执行 do_ops，MCP 层插不进 await）。
    //   workaround: redo 后调 nav_bake_mesh 走 MCP 路径得准确 bake。详见
    //   docs/superpowers/specs/2026-07-28-c4-nav-async-dispatch-design.md §11。
```

- [ ] **Step 2: detect 沿用或升级（defects.ts:453-456）**

原 detect（`do_ops.append bake = fixed`）保留作 P1 判据。可选加 C4 accurate 判据：
```typescript
    // C4 accurate detect（可选）: handle_nav_create_region_async 存在 + await is_baking 轮询
```

- [ ] **Step 3: close-loop editor-method-map status（status 滞后修正）**

`defects.ts` `editor-method-map-missing-particles-animtree-ui-recording-nav` 条目（status=open），核实 `editor-method-map.ts:110-116` nav 已登记 → status 改 `fixed`，补 `found-in`（2026-07-28 核实）+ last-seen。

- [ ] **Step 4: CHANGELOG**

`CHANGELOG.md` 加条目：nav bake async-dispatch（C4 MCP 路径 fixed，redo 路径 known limitation + workaround）。

- [ ] **Step 5: Commit**

```bash
git add test/regression/defects.ts CHANGELOG.md
git commit -m "docs(defects): C4 nav bake async-dispatch 闭环 + editor-method-map nav status 滞后修正"
```

---

## Task 8: 集成测试 + 全门禁（§13/§14）

**Files:**
- Test: 集成测试（需真实 Godot editor 4.6+4.7）

**Interfaces:**
- Consumes: Task 0-7 完成
- Produces: 全验收标准通过

- [ ] **Step 1: 集成测试（真实 editor）**

手动或 e2e 跑 `nav_create_region(bake=true)` + `nav_bake_mesh`，验收：
1. bake_result 基于真实 `get_vertices_count() > 0`（非乐观 `!=null`）
2. bake 挂起期间无死挂（§6 兜底）、无心跳伪断连（§7）、无 peer/_nav 恢复崩溃（§6/§10）
3. 非 nav 30+ handler 行为零变化（当帧 reply）
4. 双版本（4.6+4.7）均通过

- [ ] **Step 2: 全量 vitest**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx vitest run`
Expected: 全绿（非 nav 30+ handler 零回归）。

- [ ] **Step 3: 全门禁**

Run: `cd /d/GitHub/godot-mcp-enhanced && npm run check:gdscript && npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 全绿（check:gdscript 0-0 / tsc 0 / eslint 0 / vitest 全绿，4.7.1+4.6.2 双版本 `--import` 真编译）。

- [ ] **Step 4: 验收对照（spec §14）**

对照 spec §14 六条验收标准逐条勾选。

- [ ] **Step 5: Commit 集成测试产物（若有）**

```bash
git add test/
git commit -m "test(nav-bake): C4 async-dispatch 集成测试通过（双版本 vertices_count 准确判据）"
```

---

## Task 0 结论（2026-07-28 双版本实测，probe.gd 4.7.1 + 4.6.3）

**probe 实测（核实项 0-5）**:
- 核实项 0（bake 异步立即返回）: ✅ **PASS** — BAKE_DELTA 4.7.1=2403usec / 4.6.3=2961usec（~2.4-3ms 立即返回，后台线程异步，非同步阻塞）→ **A-lite 架构成立**
- 核实项 1（返回值）: **void** — 双版本编译器一致拒赋值（"Cannot get return value... returns void"）
- 核实项 2（await 真异步）: **SKIP** — void 非 coroutine，裸 `await bake()` 无效（印证 spec r4「不裸 await bake」）
- 核实项 3（is_baking）: ❌ **不存在** — 双版本 `BAKING_PROPS_BEFORE/AFTER=[]`，NavigationRegion3D 无 is_baking/baking 属性 → **§6 主方案不可用**
- 核实项 4（bake_finished 信号）: ✅ **存在** — 双版本 `HAS_BAKE_FINISHED_SIGNAL=true` → **fallback 信号方案可行**
- 核实项 5（headless pump）: ⚠️ **有坑** — bake 启动后台线程致 `quit()` 不退出（`call wait_to_finish()` + NavigationServer RID leak），headless 须处理清理

**额外发现（plan/spec 修正点）**:
- **判据方法错误**：`navigation_mesh.get_vertices_count()` 双版本 `Nonexistent function` → 改 `get_vertices().size() > 0`（spec §6/§9/§11/§14 + plan Task 3/6 全改）
- **NavigationRegion3D 须入树**：未入树 bake 报 "root needs inside the SceneTree"（但函数仍立即返回，不影响核实项 0）

- 核实项 6（client 超时 + response 匹配）: `EditorConnection.ts:152` `requestTimeoutMs=30000`（**30s**），`pending=Map<number>` 按 id 匹配（乱序 OK ✅）。**⚠️ client 30s < GD/TS clamp 600s 矛盾 §7 时间轴**——editor 路径 nav bake 受 client 30s 请求超时硬限制：bake > 30s 则 client 先 reject。plan Task 4/5 须处理（bake 专用 `requestTimeout` 调大 > bake 最长时间，或接受 30s 限制 bake 须 < 30s）
- 核实项 9（editor-method-map nav 登记）: ✅ `editor-method-map.ts:110-115` nav 5 method 全登记（无 transformArgs，bake 直达 `nav_commands.gd`）→ editor 路径不走 headless fallback，spec editor 侧主体（§3/§4/§6/§8）成立
- 核实项 10（do_method bake 联动）: 待 Task 3 实现确认（do_method 经 commit_action 同步执行已知，启动的 bake 是否触发 bake_finished 信号待验）

**决策: GO**（核实项 0 PASS，A-lite 架构成立）
- Task 3/6 用 **【fallback 信号方案】**（bake_finished 信号 + timer 竞速 + 循环内 `is_instance_valid` 守卫），非 is_baking 主方案
- 判据统一改 `get_vertices().size() > 0`
- headless（Task 6）须处理 bake 后台线程清理（quit 前确保 NavigationServer 不挂起）
- spec r5 修正: §6 fallback 升主方案 + 判据方法 + §9 headless 清理坑
