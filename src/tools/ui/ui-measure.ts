// ui_measure_layout:headless 整树 computed rect 测量。
// 执行链路(spec B-1 选型):executor 链(executeGdscriptTrusted),full-class extends
// SceneTree 脚本——gdscript-executor 对此类脚本走 injectHelpers 且不自动追加 _mcp_done,
// 因此可先 process_frame 等布局稳定再输出(随机 marker 由 executor replaceAll 注入)。
// 注意:SCENE_TREE_HEADER 的 _mcp_done() 已含 quit(0)(gdscript-templates.ts:138-141,
// 带 Engine.get_main_loop() 守卫),_emit 不再显式 quit,避免重复。
// maxDepth clamp 1-64;NaN/Infinity 回落默认 16,防生成 `depth > NaN` 非法 GDScript。

import { gdEscape, SCENE_TREE_HEADER } from '../shared.js';

export function genUiMeasureScript(scenePath: string, nodePath: string | undefined, maxDepth: number): string {
  const sp = gdEscape(scenePath);
  const np = nodePath ? gdEscape(nodePath) : '';
  const depth = Math.max(1, Math.min(64, Math.floor(Number.isFinite(maxDepth) ? maxDepth : 16)));
  return `${SCENE_TREE_HEADER}

var _frames := 0
var _stable_count := 0
var _last_snapshot := ""
var _target: Node = null
var _count := 0

func _initialize():
\tif not _mcp_load_scene("${sp}"):
\t\t_mcp_done()
\t\treturn
\t_target = _mcp_scene_instance
${np ? `\tif "${np}" != "":
\t\tvar _n = _mcp_get_scene_node("${np}")
\t\tif _n == null:
\t\t\t_mcp_output("error", "Node not found: ${np}")
\t\t\t_mcp_done()
\t\t\treturn
\t\t_target = _n` : ''}
\tprocess_frame.connect(_on_measure_frame)

func _on_measure_frame() -> void:
\t_frames += 1
\tvar snap := _snapshot()
\tif snap == _last_snapshot:
\t\t_stable_count += 1
\telse:
\t\t_stable_count = 0
\t\t_last_snapshot = snap
\tif _stable_count >= 2 or _frames >= 5:
\t\tprocess_frame.disconnect(_on_measure_frame)
\t\t_emit()

func _snapshot() -> String:
\tvar parts: Array = []
\t_snap_walk(_target, 0, parts)
\treturn ";".join(parts)

func _snap_walk(n: Node, depth: int, parts: Array) -> void:
\tif depth > ${depth} or _count >= 2000:
\t\treturn
\tif n is Control:
\t\tvar c := n as Control
\t\tparts.append("%d,%d,%d,%d" % [int(c.global_position.x), int(c.global_position.y), int(c.size.x), int(c.size.y)])
\t\t_count += 1
\tfor ch in n.get_children():
\t\t_snap_walk(ch, depth + 1, parts)

func _emit() -> void:
\tvar nodes: Array = []
\t_count = 0
\t_walk(_target, 0, nodes)
\t# C1(M-a/M-b): stalled = 5 帧上限内未达到 2 帧稳定快照;viewport 作为 layout_verify
\t# 根级 rect 的参照系。注意用 content_scale_size 而非 Window.size / get_visible_rect()——
\t# headless --script 模式下 Window 实际尺寸不反映 project 设置(实测 100x100/2496x?),
\t# content_scale_size 才是 display/window/size 的直接映射(实测 1280x720)。
\tvar _vp := root.content_scale_size
\t_mcp_output("measure", JSON.stringify({
\t\t"stable_after_frames": _frames,
\t\t"stalled": _frames >= 5 and _stable_count < 2,
\t\t"viewport": {"w": _vp.x, "h": _vp.y},
\t\t"nodes": nodes}))
\t_mcp_done()

func _walk(n: Node, depth: int, nodes: Array) -> void:
\tif depth > ${depth} or _count >= 2000:
\t\treturn
\tif n is Control:
\t\tvar c := n as Control
\t\tvar entry := {
\t\t\t"path": str(_target.get_path_to(n)),
\t\t\t"type": n.get_class(),
\t\t\t"rect": {"x": c.global_position.x, "y": c.global_position.y, "w": c.size.x, "h": c.size.y},
\t\t\t"anchors": {"left": c.anchor_left, "right": c.anchor_right, "top": c.anchor_top, "bottom": c.anchor_bottom},
\t\t\t"offsets": {"left": c.offset_left, "right": c.offset_right, "top": c.offset_top, "bottom": c.offset_bottom},
\t\t\t"visible": c.is_visible_in_tree(),
\t\t}
\t\tif "text" in n:
\t\t\tentry["text"] = str(n.get("text"))
\t\tnodes.append(entry)
\t\t_count += 1
\tfor ch in n.get_children():
\t\t_walk(ch, depth + 1, nodes)
`;
}
