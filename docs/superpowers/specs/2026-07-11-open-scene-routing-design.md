# 2026-07-11 open_scene MCP 死映射修复 — 设计

## 背景

scene 工具的 `open_scene` 是"死映射"：`editor-method-map` 登记了 `scene.open_scene → open_scene`，但 scene 工具的 TS 入口（`ACTIONS` enum + `handleTool` switch + `actionRisks`）未接 → 传 `action=open_scene` 在协议层被 enum 拒绝 / 落 switch `default` 返 `UNKNOWN_ACTION`，无法触发 editor 转发。反馈库 🔴 open（`D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md:139`）。

GD 端**全就绪**：
- `addons\godot_mcp_server\command_handler.gd:106` 路由分支 → `scene_commands.handle_open_scene`
- `addons\godot_mcp_server\commands\scene_commands.gd:26` `handle_open_scene`：校验 scene_path（res:// 前缀 + 路径遍历防护）→ `EditorInterface.open_scene_from_path(path)`，无 EI 返 `-32000`
- `src\core\editor-method-map.ts:62` 映射 + `src\capability\static-grep.ts:68` drift check + `test\core\editor-method-map.test.ts:75` 测试

## 方案（已批准：A）

TS `case 'open_scene'` 返 `opsErrorResult('EDITOR_ONLY', …)`。

**理由**：open_scene 语义是"在编辑器把场景打开为活动场景"（`EditorInterface.open_scene_from_path`）。dispatch 流程：
- **editor 模式**：`ToolDispatcher` 优先走 `resolveEditorMethod('scene', {action:'open_scene'})` 命中 → 转发 `command_handler` `handle_open_scene`（**不进 TS case**）
- **headless 模式**（无 editor 连接）：落 TS `case 'open_scene'` → 返 `EDITOR_ONLY`（headless 无 EditorInterface，无"活动场景"概念，与 asset 写工具惯例一致，见 `asset-ops.ts:171` / `test-framework.ts:79`）

弃选：B（不加 case 依赖 default `UNKNOWN_ACTION`，错误信息不如 EDITOR_ONLY 清晰）/ C（headless 实现"加载场景到 SceneTree"，语义混乱非 open_scene 本义）。

## 改动（3 处纯 TS）

1. `src\tools\scene\helpers.ts` `ACTIONS` 加 `'open_scene'`
2. `src\tools\scene\index.ts` `handleTool` switch 加 `case 'open_scene'`：返 `opsErrorResult('EDITOR_ONLY', 'open_scene requires editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin.')`
3. `src\tools\scene\index.ts` `TOOL_META.actionRisks` 加 `open_scene: 'write'`（切活动场景，非破坏性）

## 验证

- **单测**：`editor-method-map.test.ts` 已有 `scene.open_scene → open_scene`（无需改）；新增 scene 工具测试 `open_scene` headless 返 `EDITOR_ONLY`
- **editor E2E**（反馈原场景）：editor 模式 `scene open_scene` 切活动场景（Boot → gameplay_island）
- **门禁**：`tsc --noEmit` + `vitest run` + `check:gdscript`（GD 端无改动，drift check 已含 open_scene）

## 范围

只接 `open_scene`。审查 `editor-method-map` 的 scene 映射（`add_node`/`remove_node`/`instance_scene`/`set_instance_property`/`open_scene`/`save_scene`）vs `ACTIONS`，**仅 open_scene 缺**，其余均已接。
