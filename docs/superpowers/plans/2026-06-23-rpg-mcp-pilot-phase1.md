# rpg-mcp-pilot Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 MCP 工具从零自建 Godot 4.6 RPG 骨架(rpg-mcp-pilot),实证「正常项目 autoload 全局名 + class_name 全局类引用正常」(换掉 defect-sandbox 的 A 类异常环境)。

**Architecture:** 2 autoload(GameEvents 事件总线 / GameManager 状态+流程+持有 PlayerData)+ 1 class_name 全局类(PlayerData)+ 3 场景(主菜单入口 / 玩家 / 探索)。场景切换统一由 GameManager 监听 `scene_change_requested` 处理。玩家移动 emit `player_moved` → GameManager 同步 `player_data.pos`(验证 autoload 跨场景数据存活)。

**Tech Stack:** Godot 4.6, GDScript, MCP godot 工具(create_project / write_script / write_config / create_scene / add_node / instance_scene / save_scene / run_project / run_and_verify / game_bridge)。

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-23-rpg-mcp-pilot-phase1-design.md`(approved)

## Global Constraints

- **位置**:`D:\GitHub\rpg-mcp-pilot`(D:/GitHub 下,enhanced 同级,避开沙盒;原 D:/workspace/projects 被 MCP 白名单阻塞改此)
- **Godot 版本**:4.6.2 主验,路径 `D:\Godot\Godot_v4.6.2-stable_win64.exe`;4.7 抽验(执行时 `ls D:\Godot\` 取 `Godot_v4.7*.exe` 路径);4.5.1/4.6.3 可选
- **渲染器**:`gl_compatibility`
- **版本控制**:`git init` + `.gitignore`(排 `.godot/`、`.import/`)
- **验证判据(铁律)**:全程**真实运行**(`run_project` GUI / 人工 F5)作判据。`run_and_verify`(headless)**仅作 smoke**——对 autoload/class_name "Identifier not declared" 报假阳性(memory `autoload-classname-headless-pitfall.md`),headless 出现此类错误**不卡**,以真实运行为准
- **autoload 注册**:MCP 无专门注册工具,用 `write_config(key="autoload/<Name>", value="*res://<path>")`;Task 1 首步实测格式,回退手编 `project.godot`
- **bridge 分离**:核心验证(假设 A/B/C)严格先于 `game_bridge_install`(bridge 会注册 MCPBridge autoload,污染判读)
- **exploration 底图**:`ColorRect` 占位,无 TileMap/TileSet
- **无 unit test 框架**:Phase 1 骨架不引入测试框架(YAGNI),用「验收驱动」替代 TDD——每 task 定义可 F5/MCP 查询的验收条件

---

### Task 1: 项目初始化 + autoload 注册手段实测

**Files:**
- Create: `D:\GitHub\rpg-mcp-pilot\project.godot`(via create_project)
- Create: `D:\GitHub\rpg-mcp-pilot\.gitignore`
- Create: `D:\GitHub\rpg-mcp-pilot\rpg\autoload\probe.gd`(探针,Task 2 删)

**Interfaces:**
- Produces: 可运行的空 4.6 项目 + **确认的 autoload 注册手段**(write_config 是否支持 [autoload] 段,供 Task 2 用)

- [ ] **Step 1: create_project**

调用 `mcp__godot__project` `create_project`:
- `project_path`: `D:/GitHub/rpg-mcp-pilot`
- `project_name`: `RPG MCP Pilot`
- `renderer`: `gl_compatibility`
- `godot_version`: `4.6`
- `hooks`: false, `claude_md`: false(测试项目不要 enhanced 的 .claude 配置)

预期:目录创建 + `project.godot` 生成。

- [ ] **Step 2: git init + .gitignore**

Bash:
```
cd /d/workspace/projects/rpg-mcp-pilot && git init
```

Write `.gitignore`:
```
.godot/
.import/
```

- [ ] **Step 3: 写探针 autoload 脚本**

调用 `mcp__godot__script` `write_script`:
- `project_path`: `D:/GitHub/rpg-mcp-pilot`
- `script_path`: `rpg/autoload/probe.gd`
- `content`:
```gdscript
extends Node

func _ready() -> void:
    print("[Probe] autoload registered OK")
```

- [ ] **Step 4: 实测 write_config 注册 autoload(关键)**

调用 `mcp__godot__project` `write_config`:
- `project_path`: `D:/GitHub/rpg-mcp-pilot`
- `key`: `autoload/Probe`
- `value`: `*res://rpg/autoload/probe.gd`

- [ ] **Step 5: 读回 project.godot 核对 [autoload] 段格式**

调用 `mcp__godot__project` `read_project_config`,核对 [autoload] 段应含:
```
[autoload]
Probe="*res://rpg/autoload/probe.gd"
```
**判定**:`*` singleton 前缀在 + section 正确 → write_config 手段确认,Task 2 沿用。若格式错(如缺 `*` 或进错 section)→ **回退**:用 Write 工具直接编辑 `project.godot` 追加上述 [autoload] 段,记录回退事实。

- [ ] **Step 6: smoke(run_and_verify, autoload 假阳性预期不卡)**

调用 `mcp__godot__validation` `run_and_verify`:
- `project_path`: `D:/GitHub/rpg-mcp-pilot`
- `godot_path`: `D:\Godot\Godot_v4.6.2-stable_win64.exe`

预期:可能报 Probe 相关 "not declared" 假阳性(pitfall),**不计为失败**;只看有无致命语法错(应无)。

- [ ] **Step 7: commit**

```
cd /d/workspace/projects/rpg-mcp-pilot && git add -A && git commit -m "feat: init rpg-mcp-pilot 4.6 project + verify autoload registration via write_config"
```

---

### Task 2: 三核心脚本 + 注册 autoload(假设 A/B 载体)

**Files:**
- Create: `rpg/autoload/game_events.gd`
- Create: `rpg/autoload/game_manager.gd`
- Create: `rpg/autoload/player_data.gd`
- Modify: `project.godot`([autoload] 段:删 Probe,加 GameEvents/GameManager)

**Interfaces:**
- Consumes: Task 1 确认的 write_config 注册手段
- Produces:
  - `GameEvents`(autoload):信号 `scene_change_requested(scene_path: String)`、`player_moved(position: Vector2)`
  - `GameManager`(autoload):`var current_state: GameState`、`var player_data: PlayerData`、`func change_state(new_state: GameState)`、监听上述两信号
  - `PlayerData`(class_name 全局类,非 autoload):属性 `level/max_hp/current_hp/max_mp/current_mp/pos: Vector2/gold`

- [ ] **Step 1: 写 game_events.gd**

`write_script` `script_path`: `rpg/autoload/game_events.gd`,`content`:
```gdscript
extends Node

signal scene_change_requested(scene_path: String)
signal player_moved(position: Vector2)
```

- [ ] **Step 2: 写 player_data.gd(假设 B 载体)**

`write_script` `script_path`: `rpg/autoload/player_data.gd`,`content`:
```gdscript
class_name PlayerData
extends RefCounted

var level: int = 1
var max_hp: int = 100
var current_hp: int = 100
var max_mp: int = 30
var current_mp: int = 30
var pos: Vector2 = Vector2.ZERO
var gold: int = 50
```

- [ ] **Step 3: 写 game_manager.gd(假设 A+B 活体验证载体)**

`write_script` `script_path`: `rpg/autoload/game_manager.gd`,`content`:
```gdscript
extends Node

enum GameState { MENU, EXPLORING }

var current_state: GameState = GameState.MENU
var player_data: PlayerData = null

func _ready() -> void:
	player_data = PlayerData.new()
	GameEvents.player_moved.connect(_on_player_moved)
	GameEvents.scene_change_requested.connect(_on_scene_change_requested)

func _on_player_moved(position: Vector2) -> void:
	player_data.pos = position

func _on_scene_change_requested(scene_path: String) -> void:
	change_state(GameState.EXPLORING)
	get_tree().change_scene_to_file(scene_path)

func change_state(new_state: GameState) -> void:
	current_state = new_state
```

**注**:此脚本直接引用 `GameEvents`(autoload 全局名 = 假设 A)+ `PlayerData`(class_name 全局类 = 假设 B)。正常项目 F5 编译期应均可见。Task 6 真实运行验。

- [ ] **Step 4: 注册 GameEvents/GameManager autoload**

`write_config` 两次(沿用 Task 1 确认的手段):
- `key`: `autoload/GameEvents`, `value`: `*res://rpg/autoload/game_events.gd`
- `key`: `autoload/GameManager`, `value`: `*res://rpg/autoload/game_manager.gd`

- [ ] **Step 5: 删 Probe(手编 project.godot)**

write_config 无删除能力,用 Edit 工具编辑 `project.godot`,从 [autoload] 段删 `Probe="*res://rpg/autoload/probe.gd"` 行。同时 `rm rpg/autoload/probe.gd`。

- [ ] **Step 6: 核对 [autoload] 段**

`read_project_config` 确认:
```
[autoload]
GameEvents="*res://rpg/autoload/game_events.gd"
GameManager="*res://rpg/autoload/game_manager.gd"
```

- [ ] **Step 7: smoke(假阳性预期不卡)**

`run_and_verify`(4.6.2 路径)。预期 headless 可能报 GameEvents/GameManager/PlayerData "not declared" 假阳性——**不计失败**(pitfall)。只看无致命语法错。

- [ ] **Step 8: commit**

```
git add -A && git commit -m "feat: GameEvents/GameManager autoload + PlayerData class_name (假设A/B载体)"
```

---

### Task 3: Player 场景 + 顶视角 8 方向移动

**Files:**
- Create: `rpg/world/player/player_controller.gd`
- Create: `scenes/player.tscn`

**Interfaces:**
- Consumes: `GameEvents.player_moved`(Task 2)
- Produces: `scenes/player.tscn`(CharacterBody2D "Player",被 exploration 实例化)

- [ ] **Step 1: 写 player_controller.gd**

`write_script` `script_path`: `rpg/world/player/player_controller.gd`,`content`:
```gdscript
extends CharacterBody2D

const SPEED := 200.0

func _physics_process(_delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	velocity = direction * SPEED
	move_and_slide()
	if velocity != Vector2.ZERO:
		GameEvents.player_moved.emit(global_position)
```

- [ ] **Step 2: create_scene player.tscn**

`mcp__godot__scene` `create_scene`:
- `project_path`: `D:/GitHub/rpg-mcp-pilot`
- `scene_path`: `scenes/player.tscn`
- `root_node_type`: `CharacterBody2D`
- `root_node_name`: `Player`

- [ ] **Step 3: 设 Player 脚本**

`edit_node`(`node_path`: `Player`,`properties`: `{"script": "res://rpg/world/player/player_controller.gd"}`)。

- [ ] **Step 4: add Sprite2D + 用默认 icon 作纹理**

`add_node`(`node_type`: `Sprite2D`,`node_name`: `Sprite`,`parent_node_path`: `Player`)。
`edit_node`(`node_path`: `Player/Sprite`,`properties`: `{"texture": "res://icon.svg"}`)—— `create_project` 默认生成 `res://icon.svg`,作玩家可见占位(便于 Task 6 人工观察移动)。

- [ ] **Step 5: add Camera2D + 开跟随**

`add_node`(`node_type`: `Camera2D`,`node_name`: `Camera`,`parent_node_path`: `Player`)。
`edit_node`(`node_path`: `Player/Camera`,`properties`: `{"position_smoothing_enabled": true}`)。

- [ ] **Step 6: save_scene**

`save_scene`(`scene_path`: `scenes/player.tscn`)。

- [ ] **Step 7: smoke + commit**

`run_and_verify`(4.6.2)。`git add -A && git commit -m "feat: player scene + top-down 8-dir movement"`。

---

### Task 4: 主菜单场景 + 脚本

**Files:**
- Create: `rpg/ui/menus/main_menu.gd`
- Create: `scenes/main_menu.tscn`

**Interfaces:**
- Consumes: `GameEvents.scene_change_requested`(Task 2)
- Produces: `scenes/main_menu.tscn`(入口,新游戏→emit 信号)

- [ ] **Step 1: 写 main_menu.gd**

`write_script` `script_path`: `rpg/ui/menus/main_menu.gd`,`content`:
```gdscript
extends Control

func _ready() -> void:
	$NewGameButton.pressed.connect(_on_new_game_pressed)
	$QuitButton.pressed.connect(_on_quit_pressed)

func _on_new_game_pressed() -> void:
	GameEvents.scene_change_requested.emit("res://scenes/exploration.tscn")

func _on_quit_pressed() -> void:
	get_tree().quit()
```

- [ ] **Step 2: create_scene main_menu.tscn**

`create_scene`(`scene_path`: `scenes/main_menu.tscn`,`root_node_type`: `Control`,`root_node_name`: `MainMenu`)。

- [ ] **Step 3: 设脚本 + add Label/Buttons**

`edit_node`(`node_path`: `MainMenu`,`properties`: `{"script": "res://rpg/ui/menus/main_menu.gd"}`)。
`add_node` `Label` `Title`(`properties`: `{"text": "RPG MCP Pilot"}`)。
`add_node` `Button` `NewGameButton`(`properties`: `{"text": "新游戏"}`)。
`add_node` `Button` `QuitButton`(`properties`: `{"text": "退出"}`)。

- [ ] **Step 4: save_scene + smoke + commit**

`save_scene`。`run_and_verify`(4.6.2)。`git commit -m "feat: main_menu scene + new_game signal"`。

---

### Task 5: 探索场景(ColorRect 底图 + Player 实例)

**Files:**
- Create: `scenes/exploration.tscn`

**Interfaces:**
- Consumes: `scenes/player.tscn`(Task 3)
- Produces: `scenes/exploration.tscn`(主菜单切换目标)

- [ ] **Step 1: create_scene exploration.tscn**

`create_scene`(`scene_path`: `scenes/exploration.tscn`,`root_node_type`: `Node2D`,`root_node_name`: `Exploration`)。

- [ ] **Step 2: add ColorRect 占位底图**

`add_node` `ColorRect` `Background`(`parent_node_path`: `Exploration`,`properties`: `{"color": [0.1, 0.2, 0.15, 1], "anchors": "full_rect"}`)。注:anchors 用 `edit_node` 后续设 preset `full_rect`。

- [ ] **Step 3: instance player**

`mcp__godot__scene` `instance_scene`(`instance_path`: `res://scenes/player.tscn`,`parent_node_path`: `Exploration`,`node_name`: `Player`)。
`edit_node`(`node_path`: `Exploration/Player`,`properties`: `{"position": {"x": 640, "y": 360}}`)。

- [ ] **Step 4: save_scene + smoke + commit**

`save_scene`。`run_and_verify`(4.6.2)。`git commit -m "feat: exploration scene (ColorRect bg + player instance)"`。

---

### Task 6: 设入口 + 假设 A/B 核心 F5 验证(裸项目,无 bridge)

**Files:**
- Modify: `project.godot`(`application/run/main_scene`)

**Interfaces:**
- Consumes: Task 2/3/4/5 全部产物
- Produces: 假设 A(autoload 全局名可见)+ 假设 B(class_name 全局类可见)的实证;主菜单→探索→移动人工跑通

**验收条件**:
- 假设 A:真实运行启动日志**无** `GameEvents` / `GameManager` "not declared"
- 假设 B:启动日志**无** `PlayerData` "not declared"
- (人工)点新游戏→切探索→方向键移动→Camera 跟随

- [ ] **Step 1: 设 main_scene**

`write_config`(`key`: `application/run/main_scene`,`value`: `res://scenes/main_menu.tscn`)。

- [ ] **Step 2: 真实运行 + 读启动日志(假设 A/B 判据)**

`mcp__godot__runtime` `run_project`:
- `project_path`: `D:/GitHub/rpg-mcp-pilot`
- `godot_path`: `D:\Godot\Godot_v4.6.2-stable_win64.exe`
- `timeout`: 15

`get_debug_output` 读输出。**判定**:
- 日志无 `GameEvents`/`GameManager`/`PlayerData` "not declared" → 假设 A/B **通过**(正常项目 autoload 全局名 + class_name 全局类可见,换载体假设成立)
- 若出现上述 "not declared" → 假设动摇,触发「换载体是否成立」根本复核(回到 brainstorming)

- [ ] **Step 3: 人工跑核心流程**

GUI 运行中,人工操作:点「新游戏」→ 观察切到探索场景 → 按方向键 → 观察玩家 8 方向移动 + Camera 跟随。观察切场景后游戏不崩(autoload 未销毁的初步证据,假设 C1)。

- [ ] **Step 4: stop_project + commit**

`mcp__godot__runtime` `stop_project`。
`git commit -m "verify: 假设A(autoload全局名)+假设B(class_name全局类) F5实证通过"`。

---

### Task 7: bridge 附加验证(交互自动化 + 假设 C)

**Files:**
- 无新文件(仅运行时验证)

**Interfaces:**
- Consumes: Task 6(项目已 F5 跑通)
- Produces: 假设 C 实证(`player_data.pos` 跨场景 + 移动同步)+ 渲染截图

**验收条件(假设 C 可执行判据)**:移动前 `GameManager.player_data.pos = pos₀`,移动后 `pos₁`,`pos₁ ≠ pos₀` 且 `pos₁ ≈ Player.position`。

- [ ] **Step 1: 装 bridge**

`mcp__godot__game` `game_bridge_install`(`project_path`: `D:/GitHub/rpg-mcp-pilot`)。

- [ ] **Step 2: 运行项目 + ping**

`run_project`(4.6.2 路径,`timeout`: 30)。
`mcp__godot__game` `game_query`(`method`: `ping`)预期 `status: ok`(Bridge 连接)。

- [ ] **Step 3: 模拟点新游戏 + 切场景**

`game_input`(`method`: `send_mouse_click`,`params`: `{"x": 640, "y": 400, "button": "left", "pressed": true}`)+ 同坐标 `pressed: false`(新游戏按钮估算坐标,若不中用 `find_ui_elements` 取 NewGameButton 实际 rect)。
`game_wait`(`method`: `wait_for_node`,`params`: `{"path": "/root/Exploration"}`)。

- [ ] **Step 4: 验假设 C —— pos 同步**

`game_query`(`method`: `get_node_properties`,`params`: `{"path": "/root/GameManager", "properties": ["player_data.pos"]}`)→ 记 `pos₀`。
`game_input`(`method`: `send_key`,`params`: `{"key": "Key_D", "pressed": true}`)等几帧后 `pressed: false`(向右移动)。
`game_query` 同属性 → 记 `pos₁`。
`game_query`(`method`: `get_node_properties`,`params`: `{"path": "/root/Exploration/Player", "properties": ["global_position"]}`)→ Player 实际位置。
**判定**:`pos₁.x > pos₀.x`(移动生效)+ `pos₁ ≈ Player.global_position`(同步链路对)= 假设 C 通过。

- [ ] **Step 5: 截图渲染验证**

`game_query`(`method`: `take_screenshot`,`params`: `{"path": "user://phase1_explore.png"}`)。补 Task 6 人工观察的渲染证据(bridge 运行时截图,非 headless,2D 正常)。

- [ ] **Step 6: stop_project + commit**

`stop_project`。`git commit -m "verify: 假设C(autoload跨场景+pos同步) bridge实证 + 渲染截图"`。

---

### Task 8: 4 版本验证(主验 4.6.2 + 抽验 4.7)

**Files:** 无

- [ ] **Step 1: 确认 4.6.2 已全验证**

Task 6/7 已在 4.6.2 完成假设 A/B/C 验证。本 step 仅复核记录:4.6.2 主验 PASS。

- [ ] **Step 2: 取 4.7 路径**

Bash `ls /d/Godot/ | grep -i '4.7'` 取 `Godot_v4.7*.exe` 绝对路径。

- [ ] **Step 3: 4.7 抽验 run_project**

`run_project`(`godot_path`: 4.7 路径,`timeout`: 15) + `get_debug_output`。
**判定**:启动无版本兼容错(尤其 `gl_compatibility` 相关)。Phase 1 全用 4.0+ 稳定 API(`Input.get_vector`/`move_and_slide`/`Camera2D`/`change_scene_to_file`),预期通过。若 4.7 报 gl_compatibility 默认值问题——**以实测为准**(memory `websearch-stale-on-fresh-release`),记录实际行为。

- [ ] **Step 4: (可选)4.5.1 / 4.6.3**

时间允许则同上抽验,价值低(4.6.2 已盖 4.6 系)。

- [ ] **Step 5: commit 验证记录**

`git commit -m "verify: 4.6.2主验+4.7抽验 通过(Phase 1 骨架跨版本)" --allow-empty`。

---

## Phase 1 完成判据(汇总)

1. 项目 F5(4.6.2)启动零 "not declared"(假设 A/B)
2. 主菜单→新游戏→探索场景切换正常
3. 玩家 8 方向移动 + Camera 跟随
4. 假设 A:autoload 全局名(GameEvents/GameManager)可见 ✅
5. 假设 B:class_name 全局类(PlayerData,载体=GameManager var+new)可见 ✅
6. 假设 C:`player_data.pos` 跨场景 + 移动同步(pos₀→pos₁≠且≈Player.position)✅
7. 4.6.2 主验 + 4.7 抽验通过

完成后进入 Phase 2(战斗),独立 spec。
