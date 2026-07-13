# Capability Matrix

> 自动生成，勿手改。由 `npm run build-matrix` 产出，漂移检测见 `npm run diff-matrix`。

## 概览
- 工具总数：33
- securityLevel：danger-api 8 / guarded 14 / safe 11
- risk：read 102 / write 79 / destructive 7 / process 12
- L2 覆盖：covered 0 / partial 0 / none 33
> 注：标 read 但实际启进程/有副作用(项目有意信任不确认): `validation.run_and_verify`, `validation.verify_delivery`

## danger-api 工具（L2 安全回归优先）
- `godot_get_context` (core)
- `manage_tools` (core)
- `project` (core)
- `runtime` (core)
- `scene` (core)
- `script` (core)
- `ui` (ui)
- `validation` (core)

## 覆盖缺口（L2=none）
- `android` (unknown)
- `animation` (animation)
- `animation_track` (animation)
- `animtree` (animation)
- `asset` (unknown)
- `audio` (audio)
- `cpp` (code)
- `csv_to_resources` (unknown)
- `docs` (code)
- `editor` (editor)
- `game` (bridge)
- `godot_advanced_tool` (dynamic)
- `godot_get_context` (core)
- `godot_list_dynamic_routes` (dynamic)
- `godot_list_instances` (multi_instance)
- `godot_select_instance` (multi_instance)
- `load_skill` (code)
- `manage_tools` (core)
- `material` (visual)
- `nav` (navigation)
- `particles` (visual)
- `physics` (physics)
- `profiler` (profiler)
- `project` (core)
- `runtime` (core)
- `scene` (core)
- `screenshot` (visual)
- `script` (core)
- `signal` (signal)
- `tilemap` (tilemap)
- `ui` (ui)
- `validation` (core)
- `workflow` (profiler)

## gdScriptImpl 说明
- editor 侧：addons/godot_mcp_server/commands/*_commands.gd 按 group 匹配
- headless 侧：恒为 exists=false（GDScript 由 gdscript-executor 运行时生成，无静态 1:1 文件）
- editor 侧：按工具命令精确路由（EDITOR_COMMAND_ROUTING，源 command_handler.gd handle() 路由表）