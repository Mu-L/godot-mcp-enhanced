# Capability Matrix

> 自动生成，勿手改。由 `npm run build-matrix` 产出，漂移检测见 `npm run diff-matrix`。

## 概览
- 工具总数：28
- securityLevel：danger-api 5 / guarded 3 / safe 20
- L2 覆盖：covered 0 / partial 0 / none 28

## danger-api 工具（L2 安全回归优先）
- `project` (core)
- `runtime` (core)
- `scene` (core)
- `script` (core)
- `validation` (core)

## 覆盖缺口（L2=none）
- `animation` (animation)
- `animation_track` (animation)
- `animtree` (animation)
- `audio` (audio)
- `docs` (code)
- `editor` (editor)
- `game` (bridge)
- `godot_advanced_tool` (dynamic)
- `godot_list_dynamic_routes` (dynamic)
- `godot_list_instances` (multi_instance)
- `godot_select_instance` (multi_instance)
- `load_skill` (code)
- `manage_tools` (unknown)
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
- editor 侧：粗粒度探测（DEFAULT_GROUP_COMMANDS 键粒度），core/visual/profiler 等组当前 exists=false，M1 后续完善；不影响 drift 检测（Task 7 靠契约 diff）