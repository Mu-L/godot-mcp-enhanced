# Spec — CardGame2 addon 整目录同步（A 档）

**日期**：2026-07-19
**范围**：A 档——把 enhanced 仓库已修复的 addon 同步到 CardGame2，让第 3/4 类限制（edit_node 资源落盘 / editor 路由登记）在 CardGame2 真正生效 + 验证 + 反馈文档回标
**前置**：enhanced master 已含 spec A（headless 持久化，`69fcd2e`/`f35a3ef`/`9378134`）+ 07-19 editor edit_node 版本撕裂修复（`835c780`/`64b18d9`/`c24db3f`/`c926748`/`1d08a16`/`0dfc29d`），build 07-19 01:05 最新

## 背景

核实发现 CardGame2 项目内 addon（`D:\workspace\projects\CardGame2\addons\godot_mcp_server`）**全面脱节**，不只缺 07-18~07-19 的 editor edit_node 改动：

- **13 个 .gd/.cfg 文件 differ**（command_handler/node_commands/command_helpers + nav/particle/recording/scene/sync/heartbeat/editor_guards/undo_manager/websocket_server/plugin.cfg）
- **enhanced 独有 `commands/asset/` 整目录**（asset 建模族，CardGame2 完全没有）
- **CardGame2 独有 19 个**：经带内容 diff 确认**全是 .uid**（Godot 编辑器生成的元数据），**无任何本地功能脚本改动** → 可安全整目录覆盖
- 落后到 **2026-07-06 P1-7 RCE 审查之前**：缺 `force=false` 文本资源写守卫（**当前安全暴露**）+ asset 建模族 + scene vector3 coerce（`8cbac21`）+ particle request_id + editor_get_scene_stats 等
- plugin.cfg `0.20.0` vs enhanced `0.23.0`

## 硬约束（决定方案无折中）

enhanced `command_handler.gd` 含 `_asset_commands = preload("commands/asset/asset_commands.gd").new()`——**依赖 `commands/asset/` 目录**。而 editor edit_node 路由分支就在 `command_handler.gd` 里。故「只 cp 核心 3 个文件」**不可行**：cp 了 command_handler.gd 却不带 asset 目录，preload 失败插件加载崩。**补 editor edit_node 必须连带 asset 目录 → 只能整目录同步**。

## 方案

整目录 cp：`enhanced/addons/godot_mcp_server/.` → `CardGame2/addons/godot_mcp_server/`

- 13 个 .gd/.cfg 覆盖
- `commands/asset/` 整目录新增
- **.uid 不动**：enhanced addon 无 .uid（gitignore），CardGame2 现有 .uid 保留，编辑器 reload 时校准/为新增 .gd 生成
- plugin.cfg `0.20.0` → `0.23.0`（对齐 MCP server build 07-19，消除版本漂移）

## 同步方式决策

**cp 一次性**（vs symlink / 同步脚本）。理由：A 档目标是验证已修复限制在 CardGame2 生效，最小路径；symlink（Windows mklink 坑：.uid 冲突/管理员/多项目逐建）与同步脚本（需维护 + 项目清单）是独立工作流改进（对应反馈 🟡「项目内 addons 拷贝脱节」），范围更大，不混入 A 档。

## CardGame2 受益

- ✅ 第 4 类 editor edit_node / batch_add_nodes / add_node(properties) 路由（**当前痛点**，今天 hero_detail_content.tscn 版本撕裂根因）
- ✅ **P1-7 RCE 守卫**（`force=false`，07-06 安全修复，消除当前暴露）
- ✅ asset 建模族、scene vector3 coerce、particle request_id、editor_get_scene_stats 等
- 第 3 类 headless edit_node 资源落盘不依赖 addon 同步（走 enhanced `godot_operations.gd`），随 build 已生效，仅待验证

## 验证（同步 + 重启编辑器后）

1. **editor 路由**（第 4 类）：editor 模式 `edit_node {texture:"res://x.png"}` → 路由到 `handle_edit_node`（不走 headless spawnGodot）+ 内存场景 texture load 成 Resource + 不超时 + undo 还原。**用专门测试场景，不碰 hero_detail_content.tscn**（用户正在改）。
2. **headless 落盘**（第 3 类）：headless 模式 `edit_node` 改 texture → .tscn 落 `ExtResource(...)`（非字面字符串）。确认 `godot_operations.gd` 加载路径。
3. RCE 守卫在位（可选抽查）。

## 反馈文档回标（验证通过后）

`D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md`：
- scene 三条（edit_node 30s 超时 / edit_node+save_scene 不持久化 / batch_add_nodes 不绑资源）→ 🟢 + commit `69fcd2e`/`f35a3ef`/`9378134`
- editor 路由登记（edit_node/batch_add_nodes editor-method-map）→ 🟢 + commit `835c780`/`64b18d9`/`c24db3f`/`1d08a16`/`0dfc29d`
- 🟡「项目内 addons 拷贝脱节」补注：本次整目录同步落地，symlink/脚本根治留独立工作流改进

## 不含

- symlink / 同步脚本机制（独立工作流改进，对应反馈 🟡）
- B 档（引擎硬限制 DX：手动 Ctrl+S / headless 截图空白）
- C 档（设计权衡 DX：运行时不持久化提示 / call_method 白名单配置引导）
- enhanced 仓库代码改动（已完成，本 spec 仅同步 + 验证 + 回标）

## 协作分工

- **cp + 反馈回标**：我（enhanced session）
- **CardGame2 编辑器重启 + 验证操作**：用户配合（或确认 mcp__godot 当前连 CardGame2 由我跑）
