# rpg-mcp-pilot Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 骨架(`D:/GitHub/rpg-mcp-pilot`)加骨架级回合制战斗(单敌人/攻击+火球+防御+逃跑/简单AI/经验金币奖励/探索↔战斗场景切换)。

**Architecture:** 数据层(enemy/skill database + PlayerData 扩展)→ 逻辑层(battler/damage_calculator/combat_ai/combat_engine)→ UI 层(combat_scene)→ 集成层(GameEvents combat 信号 + GameManager COMBAT + player_controller 遇敌)。autoload/class_name 直接引用(Phase 1 验证正常)。

**Tech Stack:** Godot 4.6, GDScript, MCP godot 工具(write_script/create_scene/run_project/run_and_verify/game_query/click_button)。

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-23-rpg-mcp-pilot-phase2-design.md`(独立 reviewer+主审交叉+核查通过,C1-C3+I1+A4 已修)

## Global Constraints

- **位置**:`D:/GitHub/rpg-mcp-pilot`(Phase 1 已建)
- **Godot 4.6.2 路径**:`D:\Godot\Godot_v4.6.2-stable_win64.exe`
- **autoload/class_name 直接引用**(Phase 1 验证正常,不用 preload 解耦)
- **MCP edit_node 资源属性不落盘** → 直接 Write .tscn(Phase 1 经验)
- **验证判据**:全程 F5(`run_project` 真实运行);headless `run_and_verify` 仅 smoke,autoload/class_name "not declared" 假阳性不计失败
- **战斗 UI 用 click_button**(bridge send_key 受 physical/keycode 限制,Phase 1 Task7 经验)
- **learned_skills = ["fireball"]**(不含 "attack",普攻非技能,I2)
- **combat_finished 幂等**(`_ended` flag)+ **回合短路**(胜负后不再行动,I5)
- **升级 current_hp/mp 回满**(I6)
- **遇敌防重复**(emit 后 `_encountered` flag,避免切场景前同帧多次 emit)
- **current_enemy_id 空值守卫**(I4)
- **int 截断向下**(`int()` 向下取整,Advisory)
- **无 unit test 框架**(YAGNI),用「验收驱动」:每 task smoke + T6 F5 全链

---

### Task 1: 数据层(enemy/skill database + PlayerData 扩展)

**Files:**
- Create: `rpg/data/enemy_database.gd`
- Create: `rpg/data/skill_database.gd`
- Modify: `rpg/autoload/player_data.gd`

**Interfaces:**
- Produces: `EnemyDatabase.get_enemy(id)->Dictionary` / `EnemyDatabase.random_id()->String`;`SkillDatabase.get_skill(id)->Dictionary`;`PlayerData` +`attack/defense/magic_attack/learned_skills/add_experience(amount)->bool`

- [ ] **Step 1: write_script enemy_database.gd**

`write_script` `script_path`: `rpg/data/enemy_database.gd`,`content`:
```gdscript
class_name EnemyDatabase
extends RefCounted

static func get_enemy(id: String) -> Dictionary:
	match id:
		"slime":
			return {"id": "slime", "name": "史莱姆", "max_hp": 20, "attack": 5, "defense": 1, "exp": 10, "gold": 5}
		"goblin":
			return {"id": "goblin", "name": "哥布林", "max_hp": 35, "attack": 8, "defense": 2, "exp": 20, "gold": 12}
		_:
			return get_enemy("slime")

static func random_id() -> String:
	return "slime" if randf() < 0.5 else "goblin"
```

- [ ] **Step 2: write_script skill_database.gd**

`write_script` `script_path`: `rpg/data/skill_database.gd`,`content`:
```gdscript
class_name SkillDatabase
extends RefCounted

static func get_skill(id: String) -> Dictionary:
	match id:
		"fireball":
			return {"id": "fireball", "name": "火球", "mana_cost": 8, "multiplier": 2.0}
		_:
			return {}
```

- [ ] **Step 3: Write player_data.gd(扩展战斗属性 + add_experience)**

Write 工具覆盖 `D:/GitHub/rpg-mcp-pilot/rpg/autoload/player_data.gd`:
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
var attack: int = 15
var defense: int = 8
var magic_attack: int = 10
var learned_skills: PackedStringArray = PackedStringArray(["fireball"])

func add_experience(amount: int) -> bool:
	# 骨架:每 50 经验升 1 级;I6 升级 current_hp/mp 回满
	var exp_left := amount
	var leveled_up := false
	while exp_left >= 50:
		exp_left -= 50
		level += 1
		max_hp += 10
		attack += 3
		defense += 1
		max_mp += 5
		magic_attack += 2
		leveled_up = true
	if leveled_up:
		current_hp = max_hp
		current_mp = max_mp
	return leveled_up
```

- [ ] **Step 4: smoke + commit**

`run_and_verify`(4.6.2)smoke(autoload 假阳性不计)。`git -C /d/GitHub/rpg-mcp-pilot add -A && git commit -m "feat(phase2): enemy/skill database + PlayerData combat attrs"`。

---

### Task 2: 逻辑层(battler + damage_calculator + combat_ai)

**Files:**
- Create: `rpg/combat/battler.gd`、`rpg/combat/damage_calculator.gd`、`rpg/combat/combat_ai.gd`

**Interfaces:**
- Consumes: `PlayerData`(Task 1)、`EnemyDatabase.get_enemy`(Task 1)
- Produces: `Battler`(name/max_hp/hp/attack/defense + take_damage + from_player/from_enemy static 构造);`DamageCalculator.physical/magic` static;`CombatAI.choose_action` static

- [ ] **Step 1: write_script battler.gd**

`write_script` `script_path`: `rpg/combat/battler.gd`:
```gdscript
class_name Battler
extends RefCounted

var battler_name: String = ""
var max_hp: int = 1
var hp: int = 1
var attack: int = 0
var defense: int = 0

func take_damage(amount: int) -> int:
	var actual := maxi(0, amount)
	hp = maxi(0, hp - actual)
	return actual

static func from_player(p: PlayerData) -> Battler:
	var b := Battler.new()
	b.battler_name = "勇者"
	b.max_hp = p.max_hp
	b.hp = p.current_hp
	b.attack = p.attack
	b.defense = p.defense
	return b

static func from_enemy(data: Dictionary) -> Battler:
	var b := Battler.new()
	b.battler_name = data.get("name", "敌人")
	b.max_hp = int(data.get("max_hp", 1))
	b.hp = b.max_hp
	b.attack = int(data.get("attack", 0))
	b.defense = int(data.get("defense", 0))
	return b
```
注:用 `battler_name` 不用 `name`(避免 shadow Node.name warning)。

- [ ] **Step 2: write_script damage_calculator.gd**

`write_script` `script_path`: `rpg/combat/damage_calculator.gd`:
```gdscript
class_name DamageCalculator
extends RefCounted

static func physical(atk: int, def: int) -> int:
	return maxi(1, atk - def)

static func magic(magic_atk: int, def: int, multiplier: float) -> int:
	return maxi(1, int(magic_atk * multiplier) - def)
```

- [ ] **Step 3: write_script combat_ai.gd**

`write_script` `script_path`: `rpg/combat/combat_ai.gd`:
```gdscript
class_name CombatAI
extends RefCounted

static func choose_action() -> String:
	return "attack" if randf() < 0.7 else "defend"
```

- [ ] **Step 4: smoke + commit**

`run_and_verify`(4.6.2)。`git commit -m "feat(phase2): battler + damage_calculator + combat_ai"`。

---

### Task 3: combat_engine(回合流程 + 出口回写)

**Files:**
- Create: `rpg/combat/combat_engine.gd`

**Interfaces:**
- Consumes: `Battler`/`DamageCalculator`/`CombatAI`/`EnemyDatabase`/`SkillDatabase`/`PlayerData`(Task 1-2)
- Produces: `CombatEngine`(RefCounted;`setup(p_data, enemy_id)`、`player_attack/player_skill/player_defend/player_flee`;信号 `action_resolved(log)`、`combat_ended(result, rewards)`)

- [ ] **Step 1: write_script combat_engine.gd**

`write_script` `script_path`: `rpg/combat/combat_engine.gd`:
```gdscript
class_name CombatEngine
extends RefCounted

signal action_resolved(log_msg: String)
signal combat_ended(result: String, rewards: Dictionary)

var player: Battler
var enemy: Battler
var player_data: PlayerData
var enemy_data: Dictionary
var player_defending: bool = false
var enemy_defending: bool = false
var _ended: bool = false  # I5 幂等

func setup(p_data: PlayerData, enemy_id: String) -> void:
	player_data = p_data
	enemy_data = EnemyDatabase.get_enemy(enemy_id)
	player = Battler.from_player(p_data)
	enemy = Battler.from_enemy(enemy_data)
	player_defending = false
	enemy_defending = false
	_ended = false

func player_attack() -> void:
	if _ended: return
	var raw := DamageCalculator.physical(player.attack, enemy.defense)
	var dmg := raw / 2 if enemy_defending else raw  # C1 敌人防御减半
	enemy.take_damage(dmg)
	action_resolved.emit("你攻击 %s,造成 %d 伤害" % [enemy.battler_name, dmg])
	_reset_flags()
	_after_player_action()

func player_skill(skill_id: String) -> void:
	if _ended: return
	var skill := SkillDatabase.get_skill(skill_id)
	if skill.is_empty():
		action_resolved.emit("未知技能")
		return
	var cost := int(skill.get("mana_cost", 0))
	if player_data.current_mp < cost:
		action_resolved.emit("MP 不足,无法施放 %s" % skill.get("name", ""))
		return
	player_data.current_mp -= cost
	var raw := DamageCalculator.magic(player_data.magic_attack, enemy.defense, float(skill.get("multiplier", 1.0)))
	var dmg := raw / 2 if enemy_defending else raw
	enemy.take_damage(dmg)
	action_resolved.emit("你施放 %s,造成 %d 伤害" % [skill.get("name", ""), dmg])
	_reset_flags()
	_after_player_action()

func player_defend() -> void:
	if _ended: return
	player_defending = true
	action_resolved.emit("你进入防御,本回合受伤减半")
	_enemy_turn()

func player_flee() -> void:
	if _ended: return
	if randf() < 0.6:
		_end("fled", {})
	else:
		action_resolved.emit("逃跑失败!")
		_enemy_turn()  # C2 失败则敌人照常行动

func _after_player_action() -> void:
	if enemy.hp <= 0:
		_end("won", {"exp": int(enemy_data.get("exp", 0)), "gold": int(enemy_data.get("gold", 0))})
		return
	_enemy_turn()

func _enemy_turn() -> void:
	if _ended: return
	var action := CombatAI.choose_action()
	if action == "defend":
		enemy_defending = true
		action_resolved.emit("%s 进入防御" % enemy.battler_name)
		_reset_flags()
		return
	var raw := DamageCalculator.physical(enemy.attack, player.defense)
	var dmg := raw / 2 if player_defending else raw
	player.take_damage(dmg)
	action_resolved.emit("%s 攻击你,造成 %d 伤害" % [enemy.battler_name, dmg])
	_reset_flags()
	if player.hp <= 0:
		_end("lost", {})

func _reset_flags() -> void:
	player_defending = false
	enemy_defending = false

func _end(result: String, rewards: Dictionary) -> void:
	if _ended: return  # I5 幂等
	_ended = true
	match result:  # C3 出口回写
		"won":
			player_data.current_hp = player.hp
			player_data.add_experience(int(rewards.get("exp", 0)))
			player_data.gold += int(rewards.get("gold", 0))
		"lost":
			player_data.current_hp = player_data.max_hp
			player_data.current_mp = player_data.max_mp
		"fled":
			player_data.current_hp = player.hp
	combat_ended.emit(result, rewards)
```

- [ ] **Step 2: smoke + commit**

`run_and_verify`(4.6.2)。`git commit -m "feat(phase2): combat_engine 回合流程+出口回写(C1-C3/I5)"`。

---

### Task 4: combat_scene UI

**Files:**
- Create: `rpg/combat/ui/combat_ui.gd`
- Create: `scenes/combat_scene.tscn`

**Interfaces:**
- Consumes: `CombatEngine`(Task 3)、`GameManager.current_enemy_id`(Task 5,空值守卫 I4)
- Produces: `scenes/combat_scene.tscn`(GameManager 切场景目标)

- [ ] **Step 1: write_script combat_ui.gd**

`write_script` `script_path`: `rpg/combat/ui/combat_ui.gd`:
```gdscript
extends Control

var engine: CombatEngine = null

@onready var player_hp_bar: ProgressBar = $PlayerPanel/HPBar
@onready var player_mp_bar: ProgressBar = $PlayerPanel/MPBar
@onready var level_label: Label = $PlayerPanel/LevelLabel
@onready var enemy_name_label: Label = $EnemyPanel/NameLabel
@onready var enemy_hp_bar: ProgressBar = $EnemyPanel/HPBar
@onready var log_label: RichTextLabel = $LogLabel
@onready var attack_btn: Button = $ActionMenu/AttackBtn
@onready var skill_btn: Button = $ActionMenu/SkillBtn
@onready var defend_btn: Button = $ActionMenu/DefendBtn
@onready var flee_btn: Button = $ActionMenu/FleeBtn

func _ready() -> void:
	# I4 空值守卫:用 get() 防 current_enemy_id 属性未加(Task5 前烟测安全)
	var enemy_id = GameManager.get("current_enemy_id")
	if not enemy_id:
		enemy_id = EnemyDatabase.random_id()
	engine = CombatEngine.new()
	engine.setup(GameManager.player_data, enemy_id)
	engine.action_resolved.connect(_on_action_resolved)
	engine.combat_ended.connect(_on_combat_ended)
	attack_btn.pressed.connect(_on_attack)
	skill_btn.pressed.connect(_on_skill)
	defend_btn.pressed.connect(_on_defend)
	flee_btn.pressed.connect(_on_flee)
	_refresh()

func _on_attack() -> void:
	engine.player_attack()
	_refresh()

func _on_skill() -> void:
	engine.player_skill("fireball")
	_refresh()

func _on_defend() -> void:
	engine.player_defend()
	_refresh()

func _on_flee() -> void:
	engine.player_flee()
	_refresh()

func _on_action_resolved(log_msg: String) -> void:
	log_label.append_text(log_msg + "\n")

func _on_combat_ended(result: String, _rewards: Dictionary) -> void:
	log_label.append_text("战斗结束: %s\n" % result)
	await get_tree().create_timer(1.5).timeout
	GameEvents.combat_finished.emit(result, _rewards)

func _refresh() -> void:
	var pd := GameManager.player_data
	player_hp_bar.max_value = pd.max_hp
	player_hp_bar.value = engine.player.hp
	player_mp_bar.max_value = pd.max_mp
	player_mp_bar.value = pd.current_mp
	level_label.text = "Lv.%d" % pd.level
	enemy_name_label.text = engine.enemy.battler_name
	enemy_hp_bar.max_value = engine.enemy.max_hp
	enemy_hp_bar.value = engine.enemy.hp
```

- [ ] **Step 2: Write combat_scene.tscn**

Write `D:/GitHub/rpg-mcp-pilot/scenes/combat_scene.tscn`(MCP edit_node 资源属性不落盘,直接 Write):
```
[gd_scene format=3 load_steps=4]

[ext_resource type="Script" path="res://rpg/combat/ui/combat_ui.gd" id="1_combat_ui"]

[node name="CombatScene" type="Control"]
script = ExtResource("1_combat_ui")
offset_right = 1280.0
offset_bottom = 720.0

[node name="PlayerPanel" type="Panel" parent="."]
offset_left = 40.0
offset_top = 40.0
offset_right = 400.0
offset_bottom = 160.0

[node name="LevelLabel" type="Label" parent="PlayerPanel"]
offset_left = 10.0
offset_top = 10.0
offset_right = 200.0
offset_bottom = 35.0
text = "Lv.1"

[node name="HPBar" type="ProgressBar" parent="PlayerPanel"]
offset_left = 10.0
offset_top = 40.0
offset_right = 310.0
offset_bottom = 70.0
max_value = 100.0
value = 100.0

[node name="MPBar" type="ProgressBar" parent="PlayerPanel"]
offset_left = 10.0
offset_top = 80.0
offset_right = 310.0
offset_bottom = 110.0
max_value = 30.0
value = 30.0

[node name="EnemyPanel" type="Panel" parent="."]
offset_left = 840.0
offset_top = 40.0
offset_right = 1240.0
offset_bottom = 160.0

[node name="NameLabel" type="Label" parent="EnemyPanel"]
offset_left = 10.0
offset_top = 10.0
offset_right = 390.0
offset_bottom = 35.0
text = "敌人"

[node name="HPBar" type="ProgressBar" parent="EnemyPanel"]
offset_left = 10.0
offset_top = 50.0
offset_right = 310.0
offset_bottom = 80.0

[node name="LogLabel" type="RichTextLabel" parent="."]
offset_left = 40.0
offset_top = 400.0
offset_right = 1240.0
offset_bottom = 560.0
text = ""

[node name="ActionMenu" type="HBoxContainer" parent="."]
offset_left = 40.0
offset_top = 600.0
offset_right = 1240.0
offset_bottom = 680.0

[node name="AttackBtn" type="Button" parent="ActionMenu"]
text = "攻击"

[node name="SkillBtn" type="Button" parent="ActionMenu"]
text = "技能(火球)"

[node name="DefendBtn" type="Button" parent="ActionMenu"]
text = "防御"

[node name="FleeBtn" type="Button" parent="ActionMenu"]
text = "逃跑"
```

- [ ] **Step 3: smoke + commit**

`run_and_verify`(4.6.2)。`git commit -m "feat(phase2): combat_scene UI (player/enemy panel + action menu + log)"`。

---

### Task 5: 集成(GameEvents 信号 + GameManager COMBAT + player_controller 遇敌)

**Files:**
- Modify: `rpg/autoload/game_events.gd`、`rpg/autoload/game_manager.gd`、`rpg/world/player/player_controller.gd`

**Interfaces:**
- Consumes: Task 1-4 全部
- Produces: 探索移动遇敌 → 切 combat_scene → 结算回探索/主菜单 闭环

- [ ] **Step 1: Write game_events.gd(加 combat 信号)**

Write 覆盖 `rpg/autoload/game_events.gd`:
```gdscript
extends Node

signal scene_change_requested(scene_path: String)
signal player_moved(position: Vector2)
signal combat_encountered(enemy_id: String)
signal combat_finished(result: String, rewards: Dictionary)
signal combat_log(message: String)
```

- [ ] **Step 2: Write game_manager.gd(加 COMBAT 状态 + current_enemy_id + 监听)**

Write 覆盖 `rpg/autoload/game_manager.gd`:
```gdscript
extends Node

enum GameState { MENU, EXPLORING, COMBAT }

var current_state: GameState = GameState.MENU
var player_data: PlayerData = null
var current_enemy_id: String = ""  # 场景切换间暂存

func _ready() -> void:
	player_data = PlayerData.new()
	GameEvents.player_moved.connect(_on_player_moved)
	GameEvents.scene_change_requested.connect(_on_scene_change_requested)
	GameEvents.combat_encountered.connect(_on_combat_encountered)
	GameEvents.combat_finished.connect(_on_combat_finished)

func _on_player_moved(position: Vector2) -> void:
	player_data.pos = position

func _on_scene_change_requested(scene_path: String) -> void:
	change_state(GameState.EXPLORING)
	get_tree().change_scene_to_file(scene_path)

func _on_combat_encountered(enemy_id: String) -> void:
	current_enemy_id = enemy_id
	change_state(GameState.COMBAT)
	get_tree().change_scene_to_file("res://scenes/combat_scene.tscn")

func _on_combat_finished(result: String, _rewards: Dictionary) -> void:
	current_enemy_id = ""
	match result:
		"lost":
			change_state(GameState.MENU)
			get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
		_:
			change_state(GameState.EXPLORING)
			get_tree().change_scene_to_file("res://scenes/exploration.tscn")

func change_state(new_state: GameState) -> void:
	current_state = new_state
```

- [ ] **Step 3: Write player_controller.gd(加随机遇敌 + 防重复)**

Write 覆盖 `rpg/world/player/player_controller.gd`:
```gdscript
extends CharacterBody2D

const SPEED := 200.0
const ENCOUNTER_RATE := 0.02  # 每移动帧 2% 遇敌

var _encountered: bool = false  # 防同场景重复 emit

func _physics_process(_delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	velocity = direction * SPEED
	move_and_slide()
	if velocity != Vector2.ZERO:
		GameEvents.player_moved.emit(global_position)
		if not _encountered and randf() < ENCOUNTER_RATE:
			_encountered = true
			GameEvents.combat_encountered.emit(EnemyDatabase.random_id())
```

- [ ] **Step 4: smoke + commit**

`run_and_verify`(4.6.2)。`git commit -m "feat(phase2): 集成 combat 信号 + GameManager COMBAT + player 随机遇敌"`。

---

### Task 6: F5 全链验证

**Files:** 无(运行时验证)

**验收(全 F5)**:
1. 探索移动 → 概率遇敌 → 切 combat_scene
2. 攻击:敌 HP 减 `max(1, atk-def)`,日志显示
3. 火球:MP-8,敌 HP 减 `int(magic_attack*2.0)-def`(=20-def > 普攻)
4. 防御(玩家+敌人对称):受伤/对其伤害减半
5. 逃跑:60% 成功(fled 带损伤回探索)/失败敌人行动
6. 胜:+exp(升级回满)+gold,回探索;败:HP/MP 恢复,回主菜单
7. 4.6.2 `errors: []`

- [ ] **Step 1: run_project 真实运行 + click_button 战斗**

`run_project`(4.6.2, timeout 15)。移动(人工/bridge 受限)→ 遇敌 → combat_scene。
`game_query` `click_button`(text "攻击"/"技能(火球)"/"防御"/"逃跑")模拟战斗 UI。
`get_debug_output`:errors 应无 "not declared"(假设 A/B 跨文件引用正常)。

- [ ] **Step 2: game_query 验 HP/MP/经验/金币变化**

`game_query` `get_node_properties` `/root/GameManager` `player_data.current_hp/gold/level` → 战斗前后变化验证出口回写(C3)。

- [ ] **Step 3: stop_project + commit**

`stop_project`。`git commit --allow-empty -m "verify(phase2): 战斗全链 F5 通过(遇敌→行动→结算→回探索/主菜单)"`。

---

## Phase 2 完成判据

1. 探索移动概率遇敌,切 combat_scene
2. 攻击/火球/防御/逃跑 全行动可执行 + 数值正确(火球 20-def > 普攻 15-def,I1)
3. 敌人 AI(70% 攻击/30% 防御,C1 敌人防御减伤)
4. 逃跑失败敌人照常行动(C2)
5. 三出口回写正确:won 残血+奖励/lost 恢复/fled 带损伤(C3)
6. combat_finished 幂等 + 回合短路(I5)
7. 4.6.2 F5 `errors: []`

完成后进入 Phase 3(对话),独立 spec。
