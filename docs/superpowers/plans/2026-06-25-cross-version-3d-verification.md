# 跨版本 3D 验证 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本计划适配说明**：这是验证任务（调用 MCP 工具操作 Godot → 校验输出 → 填矩阵），不是 vitest TDD。因此「测试步骤」=「MCP 工具调用 + 输出校验 + 记入矩阵」，「commit」=「`save_scene`/`write_script` 落盘 + 矩阵记录」。GDScript 完整给出，MCP 调用给 action + 关键参数，每个任务有明确验证 gate。

**Goal:** 用 MCP 工具从零构建一个可玩的 3D 硬币收集游戏 + 6 项子系统探针 + Bridge 全套，在 4 个 Godot 版本（4.5.1/4.6.2/4.6.3/4.7）下端到端验证 godot-mcp-enhanced 的功能与业务可用性，产出兼容矩阵。

**Architecture:** 单项目 `D:\workspace\projects\mcp-verify-3d`（无 autoload 互引，规避 Godot #89399）。先在 4.6.3 打通全链路建绿色基线，再用方案 C（切 `.godot/mcp-godot.json` + 清缓存）跨 4 版本循环，每版本重跑主干+探针+Bridge 填矩阵。Editor 模式跳过（4.7 插件不兼容）。

**Tech Stack:** Godot 4.5.1/4.6.2/4.6.3/4.7（`D:\godot\Godot_v4.X.Y-stable_win64.exe`）、godot-mcp-enhanced v0.18.2 MCP 工具、GDScript。

## Global Constraints

（每个任务的隐含前提，从 spec 第 8 节逐条搬入）

- **Godot 二进制**：4.5.1=`D:\godot\Godot_v4.5.1-stable_win64.exe`；4.6.2=`D:\godot\Godot_v4.6.2-stable_win64.exe`；4.6.3=`D:\godot\Godot_v4.6.3-stable_win64.exe`；4.7=`D:\godot\Godot_v4.7-stable_win64.exe`。
- **项目路径**：`D:\workspace\projects\mcp-verify-3d`（独立 Godot 项目，不属于 enhanced 仓库）。
- **无 autoload**：项目不注册任何 autoload，计分走 group `coins_collector` + 信号（规避 #89399）。
- **输入键对齐（C1）**：player.gd 读 `ui_left/right/up/down`（Godot 4 默认绑方向键）；Bridge 必须发方向键（LEFT/RIGHT/UP/DOWN），**绝不发 WASD**。
- **Area3D layer/mask（A1）**：Player（CharacterBody3D）与 Coin（Area3D）保持默认 `collision_layer=1 / collision_mask=1`，不得改动，否则 `body_entered` 不触发、计分链断。
- **探针判据卫生（C2）**：所有探针判据 = `_mcp_output` 明确返回预期值；material/animation/nav 额外「逐字段一致」；遇 null-root 错误（命中 `gdscript-gen-null-root-deref`）标 ⏭️+DEFECT 名，**不填 ❌**。
- **绿色基线 gate**：4.6.3 全链路（主干+探针+Bridge）全绿前，不启动跨版本循环。
- **版本顺序**：跨版本循环按 4.5.1 → 4.6.2 → 4.6.3 → 4.7（旧→新）。
- **Editor 模式跳过**：矩阵 Editor 行统一标「⏭️ 4.7 插件不兼容 · enhanced 待办」。
- **不修 enhanced 代码**：本次只验证。发现的 enhanced 缺陷记矩阵 + 补 defects.md，不就地修。

## File Structure

**被测游戏项目**（`D:\workspace\projects\mcp-verify-3d\`）：
- `project.godot` — 项目配置（renderer=forward_plus，无 autoload）
- `.godot/mcp-godot.json` — 版本切换器（每版本改 `godot_path`）
- `Main.tscn` — 主场景（Node3D root：Camera3D/Light/Ground/Player/Coins/Coin/UI/ScoreLabel）
- `player.gd` / `coin.gd` / `main.gd` — 业务脚本
- `recordings/recording_*.json` — Bridge 录制产物

**产出物**（Obsidian，不在 git）：
- `D:\workspace\Obsidian\godot-mcp-enhanced\系统文档\跨版本验证矩阵-2026-06-25.md`
- `D:\workspace\Obsidian\godot-mcp-enhanced\开发日志\2026-06-25 跨版本验证 3D 干净靶子.md`

**矩阵表格结构**（每个 cell：✅/❌/⏭️ + 备注）：

| 步骤 | 4.5.1 | 4.6.2 | 4.6.3 | 4.7 |
|------|-------|-------|-------|-----|

行分组：① 主干 14 步 ② 子系统探针 6 项 ③ Bridge 9 步 ④ Editor（跳过）。

---

### Task 1: 建项目 + 4.6.3 基线 godot_path

**Files:**
- Create: `D:\workspace\projects\mcp-verify-3d\project.godot`（由工具生成）
- Create: `D:\workspace\projects\mcp-verify-3d\.godot\mcp-godot.json`

**验证 gate:** 项目目录存在 + project.godot 含 `[renderer]` forward_plus + `get_godot_version` 返回 4.6.3。

- [ ] **Step 1: 建项目**

MCP 调用：`project(action="create_project", project_path="D:/workspace/projects/mcp-verify-3d", project_name="mcp-verify-3d", renderer="forward_plus", template="", hooks=false, claude_md=false, ci=false)`

- [ ] **Step 2: 写 4.6.3 godot_path 覆盖**

写文件 `D:\workspace\projects\mcp-verify-3d\.godot\mcp-godot.json`（手动 Write，内容如下）：

```json
{"godot_path": "D:\\godot\\Godot_v4.6.3-stable_win64.exe"}
```

- [ ] **Step 3: 验证版本绑定生效**

MCP 调用：`runtime(action="get_godot_version", project_path="D:/workspace/projects/mcp-verify-3d")`
Expected: 返回 `4.6.3.stable.*`（证明项目级 godot_path 覆盖 env）。

- [ ] **Step 4: 记矩阵**

在矩阵「建项目」行 4.6.3 列记 ✅。其余 3 版本列待 Task 8 循环。

---

### Task 2: 主干场景骨架（create_scene + add_node）

**Files:**
- Create/Modify: `D:\workspace\projects\mcp-verify-3d\Main.tscn`

**Consumes:** Task 1 的项目。
**验证 gate:** `read_scene` 读回 Main 含 Camera3D/DirectionalLight3D/UI/ScoreLabel/Coins，无 Ground/Player/Coin（Task 3 加）。

- [ ] **Step 1: 建空主场景**

MCP：`scene(action="create_scene", project_path="D:/workspace/projects/mcp-verify-3d", scene_path="res://Main.tscn", root_node_type="Node3D", root_node_name="Main")`

- [ ] **Step 2: add_node 加 Camera3D**

MCP：`scene(action="add_node", project_path="...", scene_path="res://Main.tscn", parent_node_path="Main", node_type="Camera3D", node_name="Camera3D", properties={"position":"(0, 10, 10)","rotation_degrees":"(-55, 0, 0)"})`

- [ ] **Step 3: add_node 加 DirectionalLight3D**

MCP：`scene(action="add_node", ..., node_type="DirectionalLight3D", node_name="DirectionalLight3D", properties={"rotation_degrees":"(-45, -30, 0)"})`

- [ ] **Step 4: add_node 加 UI(CanvasLayer) + ScoreLabel**

MCP：先 `add_node(node_type="CanvasLayer", node_name="UI", parent="Main")`；再 `add_node(node_type="Label", node_name="ScoreLabel", parent="Main/UI", properties={"text":"分数: 0","position":"(10, 10)"})`。

- [ ] **Step 5: add_node 加 Coins 容器**

MCP：`add_node(node_type="Node", node_name="Coins", parent="Main")`

- [ ] **Step 6: save_scene 持久化**

MCP：`scene(action="save_scene", project_path="...", scene_path="res://Main.tscn")`

- [ ] **Step 7: read_scene 验证**

MCP：`scene(action="read_scene", scene_path="D:/workspace/projects/mcp-verify-3d/Main.tscn", summary_only=true)`
Expected: children 含 Camera3D/DirectionalLight3D/UI/Coins。

- [ ] **Step 8: 记矩阵**

矩阵「create_scene」「add_node」「save_scene」「read_scene」行 4.6.3 列记 ✅（若任一失败记 ❌ + 错误摘要）。

---

### Task 3: 主干复杂节点 + 业务脚本（execute_gdscript + write_script）

**Files:**
- Modify: `D:\workspace\projects\mcp-verify-3d\Main.tscn`（加 Ground/Player/Coin）
- Create: `player.gd` / `coin.gd` / `main.gd`

**Consumes:** Task 2 的 Main.tscn。
**验证 gate:** `validate_scripts` 3 脚本 0 error + read_scene 含 Ground/Player/Coins/Coin + main.gd/coin.gd/player.gd 挂载正确。

- [ ] **Step 1: write_script player.gd**

MCP：`script(action="write_script", project_path="...", script_path="res://player.gd", content=<下述>)`

```gdscript
extends CharacterBody3D

const SPEED := 5.0

func _physics_process(_delta: float) -> void:
    var input_dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
    var direction := Vector3(input_dir.x, 0.0, input_dir.y)
    velocity = direction * SPEED
    move_and_slide()
```

- [ ] **Step 2: write_script coin.gd**

```gdscript
extends Area3D

func _ready() -> void:
    body_entered.connect(_on_body_entered)

func _on_body_entered(_body: Node) -> void:
    get_tree().call_group("coins_collector", "_on_coin_collected")
    queue_free()
```

- [ ] **Step 3: write_script main.gd**

```gdscript
extends Node3D

var score: int = 0

@onready var _label: Label = $UI/ScoreLabel

func _ready() -> void:
    add_to_group("coins_collector")
    _label.text = "分数: 0"

func _on_coin_collected() -> void:
    score += 1
    _label.text = "分数: %d" % score
```

- [ ] **Step 4: execute_gdscript 建 Ground/Player/Coin（带 mesh+collision 资源）**

MCP：`script(action="execute_gdscript", project_path="...", code=<下述完整类脚本>)`。用完整类模式（手写 extends SceneTree）操作 PackedScene：

```gdscript
extends SceneTree

func _init():
    var path := "res://Main.tscn"
    var packed := load(path) as PackedScene
    var scene := packed.instantiate()
    # Ground
    var ground := StaticBody3D.new()
    ground.name = "Ground"
    var gm := MeshInstance3D.new()
    var gmesh := BoxMesh.new(); gmesh.size = Vector3(20, 1, 20); gm.mesh = gmesh
    ground.add_child(gm); gm.owner = ground
    var gc := CollisionShape3D.new()
    var gshape := BoxShape3D.new(); gshape.size = Vector3(20, 1, 20); gc.shape = gshape
    gc.position.y = -0.5
    ground.add_child(gc); gc.owner = ground
    scene.add_child(ground); ground.owner = scene
    # Player（挂 player.gd）
    var player := CharacterBody3D.new()
    player.name = "Player"; player.position = Vector3(0, 1, 0)
    player.set_script(load("res://player.gd"))
    var pm := MeshInstance3D.new(); pm.mesh = CapsuleMesh.new()
    player.add_child(pm); pm.owner = player
    var pc := CollisionShape3D.new(); pc.shape = CapsuleShape3D.new()
    player.add_child(pc); pc.owner = player
    scene.add_child(player); player.owner = scene
    # Coin（挂 coin.gd，layer/mask 保持默认 1/1）
    var coins := scene.get_node("Coins")
    var coin := Area3D.new()
    coin.name = "Coin"; coin.position = Vector3(2, 0.5, 2)
    coin.set_script(load("res://coin.gd"))
    var cm := MeshInstance3D.new(); var cmesh := CylinderMesh.new(); cmesh.height = 0.2; cmesh.radius = 0.3; cm.mesh = cmesh
    coin.add_child(cm); cm.owner = coin
    var cc := CollisionShape3D.new(); var cshape := CylinderShape3D.new(); cshape.radius = 0.3; cshape.height = 0.2; cc.shape = cshape
    coin.add_child(cc); cc.owner = coin
    coins.add_child(coin); coin.owner = scene
    # Main 挂 main.gd
    scene.set_script(load("res://main.gd"))
    # pack & save
    var new_packed := PackedScene.new()
    var err := new_packed.pack(scene)
    ResourceSaver.save(new_packed, path)
    print("pack_error=", err, " children=", scene.get_child_count())
    _mcp_output("pack_error", err)
    _mcp_output("ground", scene.has_node("Ground"))
    _mcp_output("player", scene.has_node("Player"))
    _mcp_output("coin", scene.has_node("Coins/Coin"))
    _mcp_done()
```

> **备选（若 execute_gdscript 被 gdscript-gen-null-root-deref 命中静默无输出）**：改用 `scene(action="read_scene")` + 直接编辑 .tscn 文本补节点；或 Task 记 ⏭️+DEFECT 名，主干 Ground/Player/Coin 用 add_node 建壳节点（无 shape，游戏仍可跑但不碰撞——退化但仍验证工具链）。

- [ ] **Step 4.5: edit_script(search_and_replace) 改 player.gd**

MCP：`script(action="edit_script", project_path="...", script_path="res://player.gd", search_and_replace={"search":"const SPEED := 5.0","replace":"const SPEED := 6.0"})` → `read_script` 确认已改成 6.0 → 再 `search_and_replace` 改回 `5.0` → `read_script` 确认还原。
判据：search_and_replace 免确认直接执行（CRLF 安全 + 行号偏移鲁棒），改后内容逐字符合预期。矩阵「edit_script」行记 ✅。

- [ ] **Step 5: validate_scripts 3 脚本**

MCP：`validation(action="validate_scripts", project_path="...", scripts=["res://player.gd","res://coin.gd","res://main.gd"])`
Expected: 0 error。若 validate_scripts headless load 返回 null（已知工具限制，见 core 规则），记 ⚠️ + 备注，不阻断。

- [ ] **Step 6: read_scene 验证节点齐全**

MCP：`read_scene(summary_only=true)`
Expected: 含 Ground/Player/Coins/Coin。

- [ ] **Step 7: 记矩阵**

矩阵「write_script」「execute_gdscript」「validate_scripts」行 4.6.3 列记 ✅/⚠️。

---

### Task 4: 主干业务闭环验证（run_and_verify + screenshot + 运行时工具）

**Files:** 不新增（运行时工具不持久化）。
**Consumes:** Task 3 的完整场景。
**验证 gate:** `run_and_verify` 无脚本/场景错误 + screenshot 非 BLANK + 运行时工具调用成功。

- [ ] **Step 0.5: validate_project（静态检查 + 记盲区）**

MCP：`validation(action="validate_project", project_path="...", check_resources=true, check_scripts=true, check_scenes=true)`
Expected: 0 issue（静态检查）。**盲区**：validate_project 不实例化 autoload、不真正启动，检测不到运行时启动失败——能否启动必须以 Step 1 `run_and_verify` 为准（见 core 规则）。矩阵「validate_project」行记 ✅ + 备注盲区。

- [ ] **Step 1: run_and_verify（核心 gate）**

MCP：`validation(action="run_and_verify", project_path="...", scene="res://Main.tscn", timeout=20)`
Expected: 无 GDScript parse error、无场景错误、无 #89399 式 autoload 失败。若启动错误，记 ❌ + 错误摘要（这是 4.6.3 基线，必须绿，否则停下排查）。

- [ ] **Step 2: screenshot（3D headless 应正常）**

MCP：`screenshot(action="capture", project_path="...", scene="res://Main.tscn", output_path="D:/workspace/projects/mcp-verify-3d/baseline-4.6.3.png")`
Expected: 非 BLANK_DETECTED。若 BLANK，记 ⚠️（3D 通常不空白；若空白按 core 规则用 Bridge take_screenshot 替代）。

- [ ] **Step 3: 运行时工具批验证（headless 一次性 execute_gdscript）**

MCP：`execute_gdscript(code=<下述>)`，验证 signal/particles/ui/audio/physics 五个运行时工具的调用通道（注意：这些是独立工具调用，此处用 execute_gdscript 模拟其运行时存在性；实际工具调用见各自行）：

分别调用（每条独立 MCP 调用）：
- `signal(action="signal_connect", source_path="root/Coins/Coin", signal_name="body_entered", target_path="root", method_name="_on_coin_collected")` — 验证信号连接通道
- `particles(action="particles_create", node_type="GPUParticles3D", name="CoinFX", parent="root/Coins/Coin")` — 粒子节点
- `ui(action="ui_build_layout", project_path="...", scene_path="res://Main.tscn", parent_path="root/UI", tree={...一个 Label...})` — UI 布局
- `audio(action="audio_play", node_path="root/Main", stream_path="res://beep.wav")` — 音频（若无 wav 文件，调用应优雅报错，记调用通道 OK）
- `physics(action="raycast", from={0,5,0}, to={0,-5,0})` — raycast 命中 Ground

Expected: 每个调用返回 status:ok（或预期的优雅错误，如缺音频文件）。运行时工具不持久化是预期行为。

- [ ] **Step 4: 记矩阵**

矩阵「run_and_verify」「screenshot」「signal_connect」「particles_create」「ui_build_layout」「audio_play」「physics_raycast」行 4.6.3 列记结果。

---

### Task 5: 子系统探针（4.6.3 基线，6 项）

**Files:** 不新增（探针在临时场景/headless 跑）。
**验证 gate:** 每个探针 `_mcp_output` 明确返回预期值；material/animation/nav 逐字段一致；遇 null-root 标 ⏭️+DEFECT。

- [ ] **Step 1: tilemap 探针**

MCP（需临时 2D 场景）：先 `create_scene(scene_path="res://probe_2d.tscn", root_node_type="Node2D")` + `add_node(node_type="TileMapLayer", name="TileMap", parent="Node2D")` + `save_scene`；然后：
- `tilemap(action="tilemap_set_cell", node_path="root/Node2D/TileMap", coords={0,0}, source_id=1, atlas_coords={0,0})`
- `tilemap(action="tilemap_read", node_path="root/Node2D/TileMap")`
判据：读回 (0,0) 的 cell 与写入一致（逐字段）。

- [ ] **Step 2: animation 探针**

MCP：`animation(action="create", node_path="root/Player", animation_name="probe", library_name="", length=1.0)` → `animation_track(action="add_track", node_path="root/Player", animation_name="probe", track_type="value", track_path="Player:position")` → `add_keyframe(time=0, value={0,1,0})` → `get_keyframes`。
判据：track_type 读回 = `value`（防 `as` 回落成 0）；关键帧 time/value 逐字段一致。

- [ ] **Step 3: animtree 探针**

MCP：`animtree(action="animtree_create", name="AnimTree", parent="root", animation_player_path="root/Player")` → `animtree_add_state(state_name="Idle")` → `animtree_add_transition(from_state="Start", to_state="Idle")`。
判据：`_mcp_output` 返回状态/转换创建成功。

- [ ] **Step 4: nav 探针**

MCP：`nav(action="create_region", name="NavRegion", parent="root")` → `create_agent(name="NavAgent", parent="root", target_position={0,0,0})` → `query_path(start_pos={0,0,0}, end_pos={2,0,2})`。
判据：region/agent `_mcp_output` 返回存在；query_path 返回路径点列表（可能为空若无烘焙网格——记 ⚠️ + 备注，不强制非空）。**注意：nav 工具是 gdscript-gen-null-root-deref 复发点（defects 记 nav:54/104/201），若静默无输出标 ⏭️+DEFECT 名。**

- [ ] **Step 5: material 探针**

MCP：`material(action="create", node_path="root/Player", material_type="StandardMaterial3D")` → `material(action="set_params", node_path="root/Player", params={"albedo_color":[1,0,0,1]})` → `material(action="shader_write", node_path="root/Player", code="shader_type spatial;\nvoid fragment(){ALBEDO=vec3(1.0);}")` → `material(action="read", node_path="root/Player")`。
判据：albedo_color 读回 = [1,0,0,1]（逐字段）；shader code 读回与传入一致（防 `as string` 透传 undefined 成空）。

- [ ] **Step 6: profiler 探针**

MCP：`profiler(action="snapshot")` + `profiler(action="get_active_processes")`。
判据：`_mcp_output` 返回 FPS/进程列表（非 null/空对象）。

- [ ] **Step 7: 记矩阵**

矩阵探针 6 行 4.6.3 列记结果（✅/❌/⏭️+DEFECT）。

---

### Task 6: Bridge 全套（4.6.3 基线，需游戏运行）

**Files:** `recordings/recording_*.json`（录制产物）。
**Consumes:** Task 3-4 的可运行游戏。
**验证 gate:** Bridge 9 步通过（install→ping→查询→输入→等待→监控→信号→UI发现→录制）。**前置：Bridge 密钥权限循环预案**——若 secret 只读致启动失败，设 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true` 或 `icacls .godot/mcp_bridge_9081.secret /grant "%USERNAME%:(W)"`。

- [ ] **Step 1: game_bridge_install**

MCP：`game(action="game_bridge_install", project_path="...")`

- [ ] **Step 2: run_project（启动游戏）**

MCP：`runtime(action="run_project", project_path="...", wait_for_bridge=true, bridge_timeout=15)`

- [ ] **Step 3: ping 连通**

MCP：`game(action="game_query", method="ping")` → Expected `Bridge connected`。

- [ ] **Step 4: 查询**

MCP：`game_query(method="get_tree")` + `game_query(method="find_nodes", params={"pattern":"Player"})` + `game_query(method="get_node_properties", params={"path":"/root/Main/Player","properties":["position"]})` + `game_query(method="take_screenshot", params={"path":"user://bridge.png"})`。
判据：找到 Player；截图非空。

- [ ] **Step 5: 输入（方向键，C1）**

MCP：`game(action="game_input", method="send_key", params={"key":"Right","pressed":true})` → 短暂后 `send_key(key="Right",pressed=false)` → `game_input(method="send_key", params={"key":"Right","pressed":true})`（重复几次推动 Player 向硬币）。
**绝不发 W/A/S/D**（C1：player 读 ui_* 只响应方向键）。

- [ ] **Step 6: 等待分数变化**

MCP：`game(action="game_wait", method="wait_for_property", params={"path":"/root/Main","property":"score","value":1}, timeout=15000)`。
判据：Player 推到硬币 → score=1 → wait 返回。**若超时**：检查是否误发了 WASD（C1）或 layer/mask 被改（A1）。

- [ ] **Step 7: 监控**

MCP：`game(action="monitor_start", node_path="root/Main/Player", properties=["position"], interval_frames=10)` → 输入几步 → `monitor_poll` → `monitor_stop`。
判据：samples 含 position 时间线。

- [ ] **Step 8: 信号**

MCP：`game(action="watch_start", node_path="root/Main/Coins/Coin", signal_name="body_entered", max_events=10)` → 操控 Player 碰硬币 → `watch_poll` → `watch_stop`。
判据：events 含 body_entered 事件。

- [ ] **Step 9: UI 发现**

MCP：`game(action="find_ui_elements", type="Label", visible_only=true)` + `game(action="click_button", text="...")`（若无按钮，find_ui_elements 验证找到 ScoreLabel 即可，click_button 记 N/A）。

- [ ] **Step 10: 录制**

MCP：`runtime(action="recording_start")` → `game_input` 方向键几步 → `runtime(action="recording_stop")` 取 events_json → `runtime(action="recording_save", events_json=<...>)` → `runtime(action="recording_play", events_json=<...>, speed=1.0)`。
判据：events_played > 0。

- [ ] **Step 11: stop_project**

MCP：`runtime(action="stop_project")`

- [ ] **Step 12: 记矩阵**

矩阵 Bridge 9 行 4.6.3 列记结果。

---

### Task 7: 绿色基线 gate 验收（4.6.3）

**验证 gate:** Task 1-6 在 4.6.3 全绿（主干 14 + 探针 6 + Bridge 9 = 29 项，允许 ⚠️ 但不允许未排查的 ❌）。

- [ ] **Step 1: 逐行核对矩阵 4.6.3 列**

确认 29 项均有结果（✅/⚠️/⏭️+DEFECT）。任何 ❌ 必须先排查（是 enhanced 缺陷→标 DEFECT 转为 ⏭️；是游戏 bug→修游戏；是工具用法错→改正重跑）。

- [ ] **Step 2: gate 决策**

4.6.3 全绿 → 进入 Task 8 跨版本循环。否则停下修，不跨版本。

---

### Task 8: 跨版本循环（方案 C，4 版本参数化）

**循环体（每个版本执行一遍）：**

- [ ] **a. 切 godot_path** — Write `.godot/mcp-godot.json` 设该版本路径
- [ ] **b. 清缓存（保留 mcp-godot.json）** — 删 `.godot/imported/` + `.godot/global_script_class_cache.cfg`（Bash: `rm -rf .godot/imported .godot/global_script_class_cache.cfg`）
- [ ] **c. 验证版本** — `get_godot_version` 返回该版本
- [ ] **d. 重跑主干** — Task 2-4（场景已建，重跑 run_and_verify + screenshot + 运行时工具；脚本/场景不必重建，除非该版本缓存重建后失效）
- [ ] **e. 重跑探针** — Task 5 全部 6 项
- [ ] **f. 重跑 Bridge** — Task 6 全部（需 run_project）
- [ ] **g. 填矩阵该版本列**

**4 版本参数表：**

| 版本 | godot_path | 矩阵列 | 特别注意 |
|------|-----------|--------|---------|
| 4.5.1 | `D:\godot\Godot_v4.5.1-stable_win64.exe` | 第 1 列 | 最旧，API 缺失可能多 |
| 4.6.2 | `D:\godot\Godot_v4.6.2-stable_win64.exe` | 第 2 列 | env 声明版本 |
| 4.6.3 | 已在 Task 1-7 完成 | 第 3 列 | 复核（基线），仅 d/e/f 重跑 |
| 4.7 | `D:\godot\Godot_v4.7-stable_win64.exe` | 第 4 列 | MCP 默认引擎；editor 插件不兼容（已跳过） |

- [ ] **执行 4.5.1**（循环体 a-g）
- [ ] **执行 4.6.2**（循环体 a-g）
- [ ] **执行 4.6.3 复核**（循环体 d/e/f，验证基线可复现）
- [ ] **执行 4.7**（循环体 a-g）

> 任何版本遇 ❌：先按 C2 判据区分（null-root → ⏭️+DEFECT；as 静默回落 → 标注）；真业务失败才记 ❌ + 三分类归因（Task 9）。

---

### Task 9: 汇总矩阵 + 三分类归因

**Files:** `D:\workspace\Obsidian\godot-mcp-enhanced\系统文档\跨版本验证矩阵-2026-06-25.md`

- [ ] **Step 1: 落盘矩阵 md**

写文件，含：标题 + properties(frontmatter date/project/status) + 4 列矩阵表（主干 14 + 探针 6 + Bridge 9 + Editor 跳过行）+ 「结论与已知限制」段。

- [ ] **Step 2: 三分类归因**

矩阵所有 ❌/⏭️ 项归因：① enhanced 缺陷（标 DEFECT 名）② Godot 上游（如 #89399）③ 环境（端口/密钥/路径）。新发现补 `DEFECT.project.godot-mcp-enhanced.*` 条目到 `D:\workspace\review\.claude\knowledge\defects.md`。

- [ ] **Step 3: 结论段**

总结：哪些工具 4 版本全绿、哪些有版本差异、Editor 模式状态（跳过+原因）、两条 open DEFECT 对验证的影响。

---

### Task 10: 开发日志 + memory 更新

**Files:**
- `D:\workspace\Obsidian\godot-mcp-enhanced\开发日志\2026-06-25 跨版本验证 3D 干净靶子.md`
- `C:\Users\wgt\.claude\projects\D--GitHub-godot-mcp-enhanced\memory\`（如有新发现）

- [ ] **Step 1: 写开发日志**

Obsidian 语法：properties(date/project/status) + callouts（[!summary] 今日工作 / [!check] 修改文件 / [!bug]+[!tip] 问题与解决 / [!todo] 待办）。内容：验证过程、矩阵要点、发现的 DEFECT、Editor 跳过原因。

- [ ] **Step 2: 更新 memory**

若有新发现（如某版本某工具的新缺陷、Bridge 跨版本差异），写 memory 文件 + 更新 `MEMORY.md` 索引。若无新发现，跳过。

- [ ] **Step 3: 验收清单核对**

对照 spec §10 验收标准逐条打勾：项目 4 版本 run_and_verify 通过、主干 14×4 记入、探针 6×4 记入、Bridge 9×4 记入、❌ 三分类归因、Editor 行标注、绿色基线 gate、矩阵+日志落盘。

---

## Self-Review

**1. Spec 覆盖：**
- §4.1 游戏逻辑 → Task 3（3 脚本完整 + group/信号）✅
- §4.2 主干 14 工具 → Task 1-4（create_project/create_scene+add_node+save_scene/write_script/edit_script/execute_gdscript/validate_scripts/validate_project/run_and_verify/screenshot/particles/ui/signal/audio/physics）✅
  - 注：`edit_script`(search_and_replace) 在 Task 3 未单独列步骤——补：Task 3 Step 4 后用 edit_script 改 player.gd 一行（如 SPEED 5→6）验证 search_and_replace，再改回。**这是遗漏，已识别，执行时补。**
  - `validate_project` 在 Task 4 未单列——补：Task 4 Step 1 前加 validate_project 调用，记其盲区。
- §5 探针 6 项 → Task 5 ✅
- §6 Bridge 9 步 → Task 6 ✅
- §7 方案 C 跨版本 → Task 8 ✅
- §8 已知障碍 → Global Constraints + 各 Task 注意事项 ✅
- §10 验收 → Task 7（基线 gate）+ Task 9（归因）+ Task 10 Step 3 ✅

**2. 占位符扫描：** 无 TBD/TODO。GDScript 完整。MCP 调用 action+参数完整。备选方案明确写出（非"适当处理"）。✅

**3. 类型/命名一致性：** player.gd 读 `ui_*` ↔ Task 6 Bridge 发方向键（C1 对齐）✅；group 名 `coins_collector` 在 coin.gd/main.gd 一致 ✅；节点路径 `/root/Main/...`（Bridge 用绝对路径）与场景树一致 ✅。

**识别的 2 个遗漏（已 inline 修复）：**
1. `edit_script`(search_and_replace) 验证步骤 → 已补 Task 3 Step 4.5（改 SPEED 再改回）
2. `validate_project` 验证步骤 → 已补 Task 4 Step 0.5（记盲区）
