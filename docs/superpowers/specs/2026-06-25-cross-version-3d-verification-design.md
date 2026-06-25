# 跨版本 3D 验证设计 · 全新干净靶子项目

> 日期：2026-06-25
> 项目：godot-mcp-enhanced v0.18.2
> 目标：用一个全新、无 autoload 互引的干净项目，以「真实构建一个 3D 小游戏 + 子系统专项探针」的实际工作内容，在 4 个本机 Godot 版本（4.5.1 / 4.6.2 / 4.6.3 / 4.7）下端到端验证 MCP 工具链的功能与业务可用性。

## 1. 背景与动机

2026-06-21 曾用现成的 `D:\workspace\projects\godot-test-project`（暗影传说 RPG Demo）做跨版本验证，结论：

- **MCP 工具链本身全部正常**（连通、跨版本 `godot_path` 切换、`write_script`、场景创建持久化、`run_and_verify` 全链路通过）。
- **但被测项目 4 个版本全部无法启动** —— 根因 Godot 上游 [#89399](https://github.com/godotengine/godot/issues/89399)：autoload 脚本互引全局名时编译期不可见，bootstrap 死锁。
- 因此**没能真正验证到「业务运行」**，只验证了「工具能调用」。

本次的核心改进：**新建一个干净项目**（无 autoload 互引），真正用 MCP 工具从零构建一个可玩的 3D 小游戏并跑起来，从而把验证从「工具能调用」推进到「端到端业务闭环」。同时用子系统探针补齐小游戏覆盖不到的工具能力。

## 2. 范围

### 2.1 包含

- **主干**：用 MCP 工具从零构建一个 3D 硬币收集小游戏（可玩、有计分、有特效）。
- **子系统探针**：对小游戏用不上的工具（tilemap / animation / animtree / nav / material（含 shader 写入）/ profiler）写最小探针，共 **6 项**（shader 并入 material 的判据，与 §5/§10 一致）。
- **Bridge 运行时验证**：游戏运行后，4 版本各跑一遍 Bridge 全套（查询/输入/等待/监控/信号/UI 发现/录制）。
- **跨版本**：4.5.1 / 4.6.2 / 4.6.3 / 4.7 全测（Headless 主干 + 子系统探针 + Bridge）。
- **产出**：兼容矩阵 + 可玩游戏 + 开发日志。

### 2.2 不包含（显式排除）

- **Editor 模式**（`launch_editor` / `editor_sync_*` / `editor_get_scene_tree` / forward 机制）：enhanced 自带 editor 插件在 4.7 下自身编译失败（`addons/godot_mcp_server/commands/command_helpers.gd` 用了 4.6 的 `Vector.from_string` 等已移除 API），是 enhanced 自身待办，不在本次验证范围内。矩阵中 Editor 行标注「跳过 · 4.7 插件不兼容 · enhanced 待办」。
- **3D 截图以外的渲染验证**：不做 2D CanvasItem 截图（headless 已知会空白）。
- **修 enhanced 代码**：本次是验证，不是改 enhanced。发现的真实缺陷记录到矩阵 + 日志，不就地修。

## 3. 总体架构

```
                 ┌──────────────────────────────────────────┐
                 │  干净靶子项目（全新，无 autoload 互引）     │
                 │  D:\workspace\projects\mcp-verify-3d       │
                 └──────────────────┬───────────────────────┘
                                    │
            ┌───────────────────────┴────────────────────────┐
            ▼                                                ▼
  ① 主干：3D 硬币收集游戏                        ② 子系统专项探针
  （端到端业务闭环）                             （小游戏用不上的能力）
            │                                                │
            └───────────────────────┬────────────────────────┘
                                    ▼  ×4 版本：4.5.1/4.6.2/4.6.3/4.7
                          每版本独立跑通 → 填兼容矩阵
                                    ▼  游戏能运行后
                          ③ Bridge 运行时验证 ×4 版本
```

双层结构：
- **主干**承担「真实业务」证明 —— 用一串真实工具调用从无到有做出可玩游戏。
- **探针**承担「广度」证明 —— 把主干没自然触达的工具各用一个最小调用覆盖。

两层都跑 4 个版本，结果汇入同一张兼容矩阵。

## 4. 主干：3D 硬币收集游戏

### 4.1 游戏设计

一个 Main 场景，结构简单到 4 版本都稳定：

```
Main (Node3D)
├─ Camera3D（俯视/斜视跟踪 Player）
├─ DirectionalLight3D
├─ Ground (StaticBody3D + BoxMesh + CollisionShape) ← 地面
├─ Player (CharacterBody3D + CapsuleMesh + CollisionShape) ← WASD 移动
├─ Coins (Node) ← N 个 Area3D 硬币，碰到 +1 分 + 粒子 + 音效 + 消失
└─ UI (CanvasLayer → Label "分数: 0")
```

**业务逻辑（3 个脚本，无 autoload、无互引 → 绝对绕开 #89399）：**

- `player.gd`（挂在 Player）：`CharacterBody3D`，`_physics_process` 用 `Input.get_vector("ui_left","ui_right","ui_up","ui_down")` 读方向，`move_and_slide`。用 `ui_*` 内置 action，无需配置 InputMap。
- `coin.gd`（挂在每个 Coin）：`Area3D`，`body_entered` 信号 → 调用 `get_tree().call_group("coins_collector","_on_coin_collected")` 通知 main → `queue_free()` 自己。信号链而非 autoload。
- `main.gd`（挂在 Main）：维护 `var score: int = 0`，`_on_coin_collected()` 加分并更新 Label 文本。加入 group `coins_collector`。

> 计分与通信全部走 group + 信号，**刻意不用 autoload**，确保 #89399 不可能复发。

### 4.2 主干工具覆盖映射

| 阶段 | 工具 | 验证什么 | 通过判据 |
|------|------|----------|----------|
| 建项目 | `create_project` | 从零生成干净 3D 项目 | project.godot 生成，renderer=forward_plus |
| 搭场景骨架 | `create_scene`+`add_node`+`save_scene` | 3D 场景树持久化到 .tscn | read_scene 能读回，节点齐全 |
| 写逻辑 | `write_script` | player.gd / coin.gd / main.gd | 文件落地，行数正确 |
| 改逻辑 | `edit_script`(search_and_replace) | CRLF 安全、行号偏移鲁棒 | 改后 read_script 内容符合预期 |
| 动态执行 | `execute_gdscript` | 运行时探针（生成硬币/查节点） | `_mcp_output` 返回预期值 |
| 语法检查 | `validate_scripts` | 逐文件 Godot 解析器检查 | 3 个脚本 0 error |
| 项目检查 | `validate_project` | 静态检查 | 0 issue（注：不实例化 autoload，不作为能否启动的判据） |
| **运行验证** | `run_and_verify` | 捕获真实启动错误 | 输出无脚本/场景错误（区别于 #89399 项目） |
| 截图 | `screenshot` | 3D headless 截图正常 | 非 BLANK，能看到场景 |
| 特效 | `particles_create` | 收集硬币粒子特效 | 节点创建成功（headless 不渲染但节点存在） |
| UI | `ui_build_layout` | 计分 Label（Flexbox→Container 翻译） | Label 节点落地 |
| 信号 | `signal_connect` | coin → main 的 collected 信号连接 | 连接成功，运行时触发 |
| 音频 | `audio_play` | 收集音效 | 播放调用成功（headless 无声但调用 OK） |
| 物理 | `physics_raycast` | Player 脚下地面检测 | raycast 命中 Ground |

> 注：`particles_create`/`ui_build_layout`/`signal_connect`/`audio_play`/`physics_raycast` 是运行时工具，headless 进程退出后不持久化。主干里仅验证「调用成功 + 节点/连接在运行时存在」，持久化的业务（场景/脚本）由 `save_scene`/`write_script` 负责。

## 5. 子系统专项探针

每个探针是一个最小的 `execute_gdscript` 片段或专门工具调用，在干净项目里跑，4 版本各一次：

| 子系统 | 探针动作 | 通过判据（收紧） |
|--------|----------|----------|
| `tilemap` | `tilemap_read` + `tilemap_set_cell` + `tilemap_fill_rect`（临时 2D 场景） | `_mcp_output` 返回值与写入逐字段一致 |
| `animation` | `animation`(list_players/get_keyframes) + `animation_track`(add_track/add_keyframe) | track_type 读回 = 传入值（防 `as` 静默回落成 0）；关键帧时间/值逐字段一致 |
| `animtree` | `animtree_create` + `animtree_add_state` + `animtree_add_transition` | 状态/转换节点 `_mcp_output` 明确返回创建成功 |
| `nav` | `nav_create_region` + `nav_create_agent` + `nav_query_path` | region/agent `_mcp_output` 返回路径非空且节点存在 |
| `material` | `material_read` + `material_set_params` + `material_shader_write` | 写入 params/code 读回与传入逐字段一致（防 `as string` 透传 undefined 成空串） |
| `profiler` | `profiler`(snapshot) + `profiler`(get_active_processes) | `_mcp_output` 返回 FPS/进程列表（非 null/空对象） |

> **探针判据卫生（承接 defects.md 两条 open DEFECT，见 §8）**：
> - 所有探针判据统一为「`_mcp_output` 明确返回预期值」，**不接受笼统「调用成功」** —— 后者无法识破 enhanced 缺陷导致的静默无输出。
> - 若探针返回 null-root 错误（`_mcp_get_root()`/`get_tree().root` 相关崩溃，命中 `DEFECT ... gdscript-gen-null-root-deref`），矩阵**不填 ❌，改填 ⏭️ 并标注 DEFECT 名**，避免污染「4.x 子系统不可用」的版本结论 —— 根因是 enhanced 代码生成缺陷，非版本业务问题。
> - `material`/`animation`/`nav` 三探针判据额外收紧为「写入值与传入值逐字段一致」，识破 `DEFECT ... ts-args-as-cast-no-validation`（`args.x as string` 裸断言静默回落默认值，当前 341 处）造成的假通过。

## 6. Bridge 运行时验证（每版本一套）

游戏 `run_project` 起来后，4 版本各跑一轮（Bridge 是 TCP 层，但为完整性全测）：

| 步骤 | 工具 / method | 验证什么 |
|------|---------------|----------|
| 安装 | `game_bridge_install` | autoload 注册、端口 9081 |
| 连通 | `game_query`(ping) | Bridge connected |
| 查询 | `game_query`(get_tree / find_nodes / get_node_properties / take_screenshot) | 找到 Player/Coins，截图非空 |
| 输入 | `game_input`(send_key: 方向键 LEFT/RIGHT/UP/DOWN) | Player 位置变化（方向键触发 ui_*，见下注） |
| 等待 | `game_wait`(wait_for_property: 分数变化) | 收集硬币后分数 +1 |
| 监控 | `monitor_start`→`monitor_poll`→`monitor_stop` | position 时间线采样 |
| 信号 | `watch_start`→`watch_poll`→`watch_stop` | collected 事件捕获 |
| UI 发现 | `find_ui_elements`(Label) + `click_button` | 找到计分 Label |
| 录制 | `recording_start`→输入→`recording_stop`→`recording_save`→`recording_play` | 事件录制与回放 |

> Bridge 密钥权限循环风险（S4 之前）：若遇到 secret 文件只读导致启动失败，按 `.claude/rules/godot-mcp-bridge.md` 处理（icacls 恢复写权限，或设 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`）。

> **输入键对齐（C1 修正）**：player.gd 读 `ui_left/right/up/down`，Godot 4 默认 InputMap 把这些 action 绑到**方向键**（KEY_LEFT/RIGHT/UP/DOWN），WASD **不在** ui_* 默认绑定里。故 Bridge 必须发**方向键**而非 WASD，否则 player 不响应 → `wait_for_property(分数)` 永远等不到 → Bridge 输入/等待两步在 4 版本上集体假失败，被误判为「Bridge 输入失效」。刻意不配 InputMap 以保持 §4.1 零配置简洁；如未来想用 WASD，则需 §4.1 改配 InputMap + Bridge 同步发 WASD。

## 7. 跨版本执行机制（方案 C）

**单项目 + 每版本清缓存。** 一个项目目录 `D:\workspace\projects\mcp-verify-3d`，维护一份游戏代码；切版本时：

1. **切 godot_path**：写 `D:\workspace\projects\mcp-verify-3d\.godot\mcp-godot.json`，设 `{"godot_path": "D:\\godot\\Godot_v4.X.Y-stable_win64.exe"}`（项目级覆盖，优先于 env，每项目独立缓存 —— 见 core 规则 M3）。
2. **清缓存（保留 mcp-godot.json）**：删 `.godot\imported\` 和 `.godot\global_script_class_cache.cfg`，**保留 `mcp-godot.json`**。避免 4.6↔4.7 缓存格式互踩。
3. **重跑该版本全套**：主干 + 探针 + Bridge。

> 清缓存脚本只删 imported 和全局类缓存两处，不动 `mcp-godot.json`，保证 godot_path 设置不被清掉。Godot 启动时自动重建被删的缓存。

**版本执行顺序**：4.5.1 → 4.6.2 → 4.6.3 → 4.7（从旧到新，便于发现「新版本才引入的回归」）。

## 8. 已知障碍与处理

| 障碍 | 处理 |
|------|------|
| 4.7 editor 插件自身编译失败 | Editor 模式整行跳过，矩阵标注「enhanced 待办」 |
| 4.6↔4.7 `.godot` 缓存格式互踩 | 方案 C：每版本切前清 imported + 全局类缓存 |
| 2D headless 截图空白 | 不适用（选了 3D；3D 截图正常） |
| #89399 autoload 死锁 | 全新项目，无 autoload、无互引，根本规避 |
| Bridge 密钥权限循环 | 见第 6 节注，按 bridge 规则处理 |
| MCP 默认引擎实测为 4.7 | 用 `.godot/mcp-godot.json` 项目级强制覆盖，不依赖 env |
| `validate_project` 盲区 | 不把它作为「能否启动」判据，必须用 `run_and_verify` |
| `gdscript-gen-null-root-deref`（enhanced CRITICAL, open, last-seen 2026-06-24） | §5 全部探针 + §4.2 `execute_gdscript` 在 headless 可能静默崩溃、`_mcp_output` 不返回（复发点 nav/workflow 未补守卫）；命中则矩阵标 ⏭️+DEFECT 名，**不填 ❌**，避免污染版本结论 |
| `ts-args-as-cast-no-validation`（enhanced IMPORTANT, open, 341 处） | §5 material/animation/nav 探针工具被 defects note 点名（`material-ops.ts`/`animation-track.ts:295`/`navigation.ts`）；判据收紧为「逐字段一致」识破 `args.x as string` 静默回落 |

## 9. 产出物

1. **兼容矩阵（核心产出）**：`D:\workspace\Obsidian\godot-mcp-enhanced\系统文档\跨版本验证矩阵-2026-06-25.md`
   - 行 = 工具/子系统/业务步骤，列 = 4 个版本，格 = ✅通过 / ❌失败（附错误摘要）/ ⏭️跳过（附原因）
   - 末尾「结论与已知限制」段
2. **可玩游戏**：`D:\workspace\projects\mcp-verify-3d\` —— 4 版本都能 run_and_verify 通过、能 Bridge 操控的小游戏
3. **开发日志**：`D:\workspace\Obsidian\godot-mcp-enhanced\开发日志\2026-06-25 跨版本验证 3D 干净靶子.md` —— 含 properties/callouts/过程记录

## 10. 验收标准

- [ ] `mcp-verify-3d` 项目存在且 4 版本都能 `run_and_verify` 无脚本/场景错误
- [ ] 主干 14 个工具步骤在 4 版本的结果全部记入矩阵
- [ ] 6 个子系统探针在 4 版本的结果全部记入矩阵
- [ ] Bridge 全套 9 步在 4 版本的结果全部记入矩阵
- [ ] 任何 ❌ 都附最小复现 + 错误摘要 + 初判（enhanced 缺陷 / Godot 上游 / 环境问题）
- [ ] Editor 模式行统一标注跳过原因
- [ ] **4.6.3 绿色基线 gate**：主干 + 探针 + Bridge 在切版本循环前已单独全绿（`run_and_verify` 无错 + 探针均 `_mcp_output` 返回预期值 + Bridge 9 步通过），作为跨版本循环的前置门槛
- [ ] 矩阵所有 ❌ 已**三分类归因**（enhanced 缺陷 / Godot 上游 / 环境），命中 open DEFECT 标注 DEFECT 名（⏭️），新发现已补 `DEFECT.project.godot-mcp-enhanced.*` 条目到 defects.md
- [ ] 兼容矩阵 + 开发日志落盘，路径符合第 9 节

## 11. 高层执行顺序

1. 建项目 `mcp-verify-3d`（`create_project`，forward_plus）
2. 主干构建：场景 → 脚本 → 信号/UI/粒子/音频/物理（单一版本 4.6.3 先打通端到端）
3. 在 4.6.3 上跑通子系统探针 + Bridge 全套（建立「绿色基线」）
4. 切版本循环：4.5.1 → 4.6.2 → 4.6.3 → 4.7，每版本清缓存 → 重跑主干 + 探针 + Bridge → 填矩阵
5. 汇总矩阵，写结论与已知限制
6. 写开发日志，更新 memory（如有新发现）

> 第 3 步先在单版本打通全链路，避免「4 版本并行踩同一批 setup bug」的浪费。绿色基线确立后再跨版本。
