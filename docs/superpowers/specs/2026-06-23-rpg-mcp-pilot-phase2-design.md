---
date: 2026-06-23
project: rpg-mcp-pilot Phase 2
type: design-spec
phase: 2 (战斗)
status: draft
前置: docs/superpowers/specs/2026-06-23-rpg-mcp-pilot-phase1-design.md (骨架已完成)
---

# rpg-mcp-pilot Phase 2 设计:骨架级回合制战斗

## 1. 背景与目标

承接 Phase 1 骨架(`D:/GitHub/rpg-mcp-pilot`,Godot 4.6;rpg-mcp-pilot 仓库 verify commits `8cce203` 假设A+B / `767d96e` 假设C / `a5a651a` Phase1 完成——F5 实证落盘,非仅 spec approved):autoload GameEvents/GameManager + class_name PlayerData(hp/mp/gold/level/pos)+ 主菜单→探索→玩家顶视角移动已就位;假设 A(autoload 全局名)/B(class_name 全局类)/C(autoload 跨场景数据存活)F5 实证通过。

**Phase 2 目标**:加回合制战斗系统(7 大业务之 1),验证战斗循环 + GameState.COMBAT + 探索↔战斗场景切换。

**非目标(YAGNI)**:物品系统、状态效果(中毒等)、多敌人(同场 1 敌人)、技能树、掉落。留后续 Phase 或扩展。

## 2. 数据层

### 新建
- **`rpg/data/enemy_database.gd`**(`class_name EnemyDatabase`):静态 `static func get_enemy(id: String) -> Dictionary`。2 敌人:
  - `slime`:{hp:20, attack:5, defense:1, exp:10, gold:5, name:"史莱姆"}
  - `goblin`:{hp:35, attack:8, defense:2, exp:20, gold:12, name:"哥布林"}
- **`rpg/data/skill_database.gd`**(`class_name SkillDatabase`):静态 `static func get_skill(id: String) -> Dictionary`。1 技能:
  - `fireball`:{mana_cost:8, multiplier:2.0, name:"火球"}（magic_attack 10 × 2.0 = 20 > 普攻 15,拉开数值使技能有存在价值;原 1.5 使火球≡普攻无意义,I1）

### 扩展 `player_data.gd`
- `+attack: int = 15`、`+defense: int = 8`、`+magic_attack: int = 10`、`+learned_skills: PackedStringArray = ["attack", "fireball"]`
- `+func add_experience(amount: int) -> bool`:经验累积,升级(level+1, max_hp+10/attack+3 等),返回是否升级

## 3. 逻辑层

- **`rpg/combat/battler.gd`**(`class_name Battler extends RefCounted`):战斗单位 `hp/max_hp/attack/defense/name` + `func take_damage(amount: int) -> int`(扣血返回实际值)。玩家 Battler 从 PlayerData 构建,敌人从 enemy_database 构建。
- **`rpg/combat/damage_calculator.gd`**(`class_name DamageCalculator`):
  - `static func physical(atk: int, def: int) -> int` = `maxi(1, atk - def)`
  - `static func magic(magic_atk: int, def: int, multiplier: float) -> int` = `maxi(1, int(magic_atk * multiplier) - def)`
- **`rpg/combat/combat_ai.gd`**(`class_name CombatAI`):`static func choose_action() -> String`("attack" 70% / "defend" 30%)
- **`rpg/combat/combat_engine.gd`**(`class_name CombatEngine extends RefCounted`,纯逻辑,由 combat_ui 持实例):持 `player_battler`/`enemy_battler`,回合流程/行动执行/胜负判定/奖励结算。

## 4. 回合流程

- **玩家先手**(骨架不做速度判定)
- 玩家选【攻击/技能/防御/逃跑】→ 执行 → 敌人 AI 行动 → 检查胜负 → 下一回合
- **玩家防御**:本回合玩家受伤减半(`player_defending` flag,敌人行动后重置)
- **敌人防御**(C1):combat_ai 返回 "defend" 时,玩家本回合对其伤害减半(`enemy_defending` flag,玩家行动后重置)——与玩家防御对称,避免死行动
- **逃跑**(C2):`randf() < 0.6` 成功 → `combat_finished("fled", {})`;**失败** → 视为玩家已行动 → 敌人照常 AI 行动 → 查玩家死亡 → 下一回合

## 5. 胜负 + 奖励 + 出口回写(C3)

**`player_battler` 是战斗期临时投影**(从 PlayerData 构建),出口回写后丢弃(下场战斗 new 新的)。

| 出口 | 触发 | HP/MP 回写 PlayerData | 奖励 | 场景切换 |
|------|------|----------------------|------|----------|
| `won` | 敌人 HP≤0 | `current_hp/mp = player_battler.hp/mp`(战斗终局残血) | `+exp`(升级)+ `+gold` | 回探索 |
| `lost` | 玩家 HP≤0 | `current_hp/mp = max_hp/max_mp`(**恢复,避免死锁**) | 无 | 回主菜单 |
| `fled` | 逃跑成功 | `current_hp/mp = player_battler.hp/mp`(**带战斗损伤脱战**) | 无 | 回探索 |

## 6. UI 层(`scenes/combat_scene.tscn` + `rpg/combat/ui/combat_ui.gd`)

- **combat_scene.tscn** root `Control`,脚本 `rpg/combat/ui/combat_ui.gd`(UI 交互 + `new CombatEngine()` 持逻辑实例)
- 玩家面板:HP/MP `ProgressBar` + level `Label`
- 敌人:名 `Label` + HP `ProgressBar`
- 行动菜单:攻击/技能/防御/逃跑 4 个 `Button`
- 战斗日志:`RichTextLabel`(显示每回合行动结果)

## 7. 集成

### GameEvents 加信号
- `combat_encountered(enemy_id: String)`
- `combat_finished(result: String, rewards: Dictionary)`
- `combat_log(message: String)`

### GameManager 扩展
- `GameState +COMBAT`
- `+var current_enemy_id: String`(场景切换间暂存)
- `_ready` 监听 `combat_encountered` → `current_enemy_id = enemy_id` + `change_state(COMBAT)` + `change_scene_to_file("res://scenes/combat_scene.tscn")`
- 监听 `combat_finished` → 按 result 回 exploration(won/fled)或 main_menu(lost)

### 遇敌触发(`player_controller.gd` 扩展)
- `_physics_process` 移动时:`if velocity != Vector2.ZERO and randf() < 0.02` → `GameEvents.combat_encountered.emit("slime" if randf()<0.5 else "goblin")`
- emit 后 GameManager 切战斗场景,player_controller 随 exploration 释放

## 8. 验证(全 F5,headless 仅 smoke)

- `run_project`(4.6.2):探索移动→(概率)遇敌→combat_scene→攻击/技能/防御/逃跑→胜/负→结算→回探索/主菜单
- `click_button`(攻击/技能)模拟战斗 UI(Task 7 经验:button_path 可能空但 emit 工作)
- `game_query` 验 player_data current_hp/gold/level 变化

## 9. 验收标准

1. 探索移动概率遇敌(2%/帧),切 combat_scene
2. 攻击:敌 HP 减 `max(1, atk-def)`,combat_log 显示
3. 技能(火球):MP-8,敌 HP 减 `int(magic_attack*2.0)-def`(=20-def > 普攻 15-def,MP 换额外伤害)
4. 防御(玩家+敌人对称):玩家防御时受伤减半;敌人防御(combat_ai 30%)时玩家对其伤害减半
5. 逃跑:60% 成功回探索(fled,带战斗损伤 HP);失败则敌人照常行动,回合继续
6. 胜:`add_experience` + 金币,升级则属性增,回探索
7. 败:HP/MP 恢复,回主菜单
8. 4.6.2 F5 `errors: []`(无 not declared,autoload/class_name 跨文件引用正常)

## 10. 风险

| 风险 | 缓解 |
|------|------|
| autoload/class_name 跨文件引用 | Phase 1 已验证正常,直接用(不用 preload 解耦) |
| MCP edit_node 资源属性不落盘 | 直接 Write .tscn(Phase 1 经验) |
| combat_scene 切换需传 enemy_id | GameManager.current_enemy_id 暂存,combat_scene _ready 读 |
| bridge click_button button_path 空 | Task 7 经验:emit 仍工作,非致命 |
| PlayerData Battler 同步(战斗后回写) | 胜/结算时 player_data.current_hp = player_battler.hp 等回写 |

## 11. 实施顺序(高层,详细留 writing-plans)

1. 数据:enemy_database/skill_database + PlayerData 扩展(attack/defense/magic_attack/learned_skills/add_experience)
2. 逻辑:battler/damage_calculator/combat_ai
3. UI:combat_scene.tscn + combat_ui.gd + combat_engine(回合流程)
4. 集成:GameEvents +combat 信号 + GameManager COMBAT/current_enemy_id + player_controller 遇敌
5. F5 验证 + click_button/game_query
