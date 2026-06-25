---
date: 2026-06-23
project: godot-mcp-enhanced / rpg-mcp-pilot
type: design-spec
phase: 1 (骨架)
status: approved
---

# rpg-mcp-pilot Phase 1 设计:RPG 骨架(MCP 自建 + autoload 正常验证)

## 1. 背景与目标

承接 `D:\workspace\projects\godot-test-project` 缺陷沙盒 A 类 autoload 异常(根因未明,F5 真阻断启动)的**换载体决定**(见 memory `godot-test-project-defect-sandbox.md`)。

**本 Phase 目标**:用 MCP 工具从零自建一个 Godot 4.6 RPG 项目,搭起**可运行的骨架**,并实证核心假设:**正常项目里 autoload 全局名引用正常**(沙盒环境异常,正常环境无此问题)。

**非目标**:战斗/对话/任务/商店/宿屋/存档等业务系统留 Phase 2–7,本 Phase 不做。

**Phase 划分**:7 大业务系统过大,decompose 为多 Phase,每 Phase 独立 spec→plan→实施。Phase 1 = 骨架(autoload + 主菜单 + 探索 + 玩家移动)。

## 2. 项目设置

| 项 | 值 |
|----|----|
| 位置 | `D:\GitHub\rpg-mcp-pilot`(D:/GitHub 下,enhanced 同级,避开沙盒;原 D:/workspace/projects 被 MCP 白名单阻塞改此) |
| Godot 版本 | 4.6(`create_project` godot_version=4.6) |
| 渲染器 | `gl_compatibility`(2D 友好 + 跨版本稳) |
| 版本控制 | `git init` + `.gitignore`(排 `.godot/`、`.import/`) |

## 3. 核心验证假设(显式分列,独立判读)

换载体的根本假设是"正常项目 autoload 全局名可见"。Phase 1 把它拆成**两个独立的可见性验收点**,F5 分别判读,避免一条失败连累另一条的诊断:

- **假设 A(autoload 全局名可见)**:`GameEvents` / `GameManager` 在业务脚本里**直接全局名引用**,F5 编译期可见、运行时可调。
- **假设 B(class_name 全局类可见)**:`PlayerData`(`class_name PlayerData extends RefCounted`,非 autoload,由 GameManager 持有)在业务脚本里引用,F5 编译期可见。
- **假设 C(autoload 跨场景不销毁)**:场景切换后 `GameManager` / `GameEvents` 常驻 root,`GameManager.player_data.pos` 仍可读写。这是 autoload 存在的语义,与"普通节点随场景销毁"的关键区分。

若假设 A 失败而 B 通过 → autoload 注册机制问题;若 B 失败而 A 通过 → class_name 全局类注册问题。分开判读,不混。

## 4. autoload 注册手段(工具链关键步)

grep enhanced 源码确认:**MCP 无"注册 autoload"写入工具**——仅有 `parseAutoloadNames`/`detectAutoloadUsage`/`error-analyzer`(autoload 假阳性过滤)等读取/检测逻辑。

手段:
1. **优先** `write_config(key="autoload/GameEvents", value="*res://rpg/autoload/game_events.gd")` 写 [autoload] 段(GameManager 同理)。
2. **实施首步实测**:确认 `write_config` 写入格式正确——尤其 `*` singleton 前缀 + section 解析(`autoload/Name` → section `[autoload]` + key `Name`)。读回 `project.godot` 核对 [autoload] 段条目。
3. **回退**:若 `write_config` 不支持 [autoload] 段或格式错,直接编辑 `project.godot` 追加:
   ```
   [autoload]
   GameEvents="*res://rpg/autoload/game_events.gd"
   GameManager="*res://rpg/autoload/game_manager.gd"
   ```

## 5. 架构

### autoload(2 个,刻意保持精简)
- **GameEvents**:事件总线。信号 `scene_change_requested(scene_path: String)`、`player_moved(position: Vector2)`。
- **GameManager**:游戏状态 `enum GameState { MENU, EXPLORING }` + 流程控制(`change_state`、`request_scene_change`)+ 持有 `var player_data: PlayerData` + **监听 `GameEvents.player_moved` 同步 `player_data.pos`**。

### 全局类(1 个)
- **PlayerData**(`class_name PlayerData extends RefCounted`):基础属性 `level`/`max_hp`/`current_hp`/`max_mp`/`current_mp`/`pos: Vector2`/`gold`。战斗属性(attack/defense/skills)留 Phase 2。`hp`/`mp`/`gold` **刻意预埋**:扩假设 B 多类型覆盖(`pos:Vector2`/`level:int`/`hp:int` 等不同类型属性引用都 F5 可见,比单属性更有说服力)+ Phase 2 战斗直接复用。`_ready` 时由 GameManager `PlayerData.new()` 创建。`pos` 是玩家位置缓存,用于验证假设 C:**玩家移动脚本**同步 `position` → `GameEvents.player_moved.emit(position)` → **GameManager 监听**更新 `player_data.pos`;切场景后读 `GameManager.player_data.pos` 仍有值,证明 autoload 数据跨场景存活。

## 6. 场景结构

| 场景 | 内容 | 入口 |
|------|------|------|
| `main_menu.tscn` | 标题 Label + 「新游戏」Button + 「退出」Button | **main_scene** |
| `player.tscn` | `CharacterBody2D` + `Sprite2D`(占位色块)+ `Camera2D` + 移动脚本 | 被 exploration 实例化 |
| `exploration.tscn` | `ColorRect` 占位底图(无 TileMap/TileSet;玩家顶视角自由移动不依赖地面碰撞)+ Player 实例 | 主菜单切换目标 |

**切换链**(场景切换统一由 GameManager autoload 负责,职责集中):主菜单「新游戏」Button `pressed` → 主菜单脚本 `GameEvents.scene_change_requested.emit("res://scenes/exploration.tscn")` → **GameManager 监听该信号** → `get_tree().change_scene_to_file(path)` + `change_state(EXPLORING)`。

## 7. 玩家移动

- **顶视角 8 方向**(非横版):`var dir = Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down"); velocity = dir * speed; move_and_slide()`。
- 选顶视角理由:`Input.get_vector` 天然 8 方向 + 归一化,移动逻辑最薄;横版需叠加重力/跳跃/落地/动画状态机,是 Phase 2 的量。顶视角下 CharacterBody2D 退化成纯移动容器,验证"autoload + 场景切换 + 移动"链最干净。
- Camera2D `position_smoothing_enabled` 跟随玩家。

## 8. 验证顺序(bridge 与核心分离)

`game_bridge_install` 会注册 MCPBridge autoload,污染"autoload 正常"判读。两步严格分离:

1. **裸项目 F5 跑核心流程**(不装 bridge):主菜单 → 新游戏 → 探索 → 玩家 8 方向移动。完成验收 1–6。
2. **再装 bridge** 做 `game_input`(模拟移动键)+ `game_query`(查 `GameManager.player_data.pos` / 玩家节点 position)。附加运行时验证,不混入核心假设判读。

## 9. 验收标准(Phase 1)

1. 项目 F5 启动**零错误**(目标版本 4.6.2)。
2. 主菜单显示,「新游戏」切换到探索场景正常。
3. 玩家 8 方向移动,Camera2D 跟随。
4. **假设 A**:autoload 全局名引用正常(GameEvents/GameManager 在业务脚本直接引用,F5 无 "not declared")。
5. **假设 B**:class_name 全局类引用正常。**验证载体** = `GameManager.gd` 的 `var player_data: PlayerData` 类型注解 + `_ready()` 的 `PlayerData.new()`(两处引用 PlayerData 全局类名,F5 编译期可见即通过)。
6. **假设 C**:autoload 生命周期——切到探索后 GameManager/GameEvents 不销毁。**可执行判据**:移动前 `player_data.pos = pos₀`,移动后 `pos₁`,`pos₁ ≠ pos₀` 且 `pos₁ ≈ Player.position`(证明 玩家移动 → `player_moved` → GameManager 同步 pos 链路生效,且 autoload 数据跨场景存活)。

## 10. 4 版本验证

- **主验**:4.6.2(目标版本,全面验证)。
- **抽验**:4.7。Phase 1 全用 4.0+ 稳定 API(`Input.get_vector`/`move_and_slide`/`Camera2D`/`change_scene_to_file`),跨版本低风险;4.7 `gl_compatibility` 默认值若有变动,**以实测为准**(留意 memory `websearch-stale-on-fresh-release`,4.7 文案易踩坑)。
- **可选**:4.5.1 / 4.6.3(时间允许,价值低——4.6.2 已盖 4.6 系)。

## 11. 风险

| 风险 | 缓解 |
|------|------|
| autoload 新项目是否真正常(假设 A) | Phase 1 核心就是验证它,F5 早验,失败即触发"换载体是否成立"的根本复核 |
| `write_config` 不支持 [autoload] 段 | 实施首步实测,回退手编 project.godot(§4) |
| bridge autoload 污染判读 | 核心验证(§8.1)严格先于 bridge 安装(§8.2) |
| MCP 工具链 4.6 打通 | `create_scene`/`add_node`/`write_script`/`save_scene`/`run_and_verify` 已 ×4 版本验证(当前项目 memory `godot-test-project-status.md` 有据);本 Phase **判据用 F5 不用 run_and_verify**(memory `autoload-classname-headless-pitfall.md`) |

## 12. 实施顺序(高层,详细留 writing-plans)

1. `create_project`(4.6, gl_compatibility)→ `git init` + `.gitignore`
2. 实测 `write_config` 写 [autoload] 段(确定注册手段,§4)
3. `write_script`:`game_events.gd` / `game_manager.gd` / `player_data.gd`
4. `write_config` 注册 GameEvents / GameManager autoload
5. `create_scene` + `add_node` + `save_scene`:main_menu / player / exploration
6. 连信号:「新游戏」pressed → `scene_change_requested` → 切场景 + `change_state`
7. F5 裸项目跑核心流程 + 验收 1–6(§8.1)
8. 装 bridge + `game_input`/`game_query` 附加验证(§8.2)
9. 4.6.2 主验 + 4.7 抽验(§10)

## 13. 后续 Phase(本 spec 不含)

Phase 2 战斗 → Phase 3 对话 → Phase 4 任务 → Phase 5 商店 → Phase 6 宿屋 → Phase 7 存档。每 Phase 独立 spec,在 Phase 1 骨架(autoload 正常 + 场景切换 + 移动)立住后展开。
