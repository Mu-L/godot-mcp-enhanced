// ui_measure_layout:headless 整树 computed rect 测量。
// 执行链路(spec B-1 选型):executor 链(executeGdscriptTrusted),full-class extends
// SceneTree 脚本——gdscript-executor 对此类脚本走 injectHelpers 且不自动追加 _mcp_done,
// 因此可先 process_frame 等布局稳定再输出(随机 marker 由 executor replaceAll 注入)。
// 注意:SCENE_TREE_HEADER 的 _mcp_done() 已含 quit(0)(gdscript-templates.ts:138-141,
// 带 Engine.get_main_loop() 守卫),_emit 不再显式 quit,避免重复。
// maxDepth clamp 1-64;NaN/Infinity 回落默认 16,防生成 `depth > NaN` 非法 GDScript。
// PR-2(spec §4.1):styleExpect 期望清单(path→slots)内嵌为 JSON 字符串 + GD 侧
// parse(name 是任意字符串,禁裸拼 GD 字面量);读回判定 = 期望清单 ∪ has_theme_stylebox_override
// (I-B 拍板:并集左侧是期望——「override 没设上」的节点 has_override=false 也必须被读到,
// 以默认主题数值 diff 暴露;右侧补手写树/手动 override 场景)。

import { gdEscape, SCENE_TREE_HEADER } from '../shared.js';

export function genUiMeasureScript(
  scenePath: string,
  nodePath: string | undefined,
  maxDepth: number,
  styleExpect?: ReadonlyArray<{ path: string; slots: readonly string[] }>,
): string {
  const sp = gdEscape(scenePath);
  const np = nodePath ? gdEscape(nodePath) : '';
  const depth = Math.max(1, Math.min(64, Math.floor(Number.isFinite(maxDepth) ? maxDepth : 16)));
  // 修正(brief 运行期 Parse Error,2026-08-18 真跑 Godot 实测):brief 原文把
  // `var _style_expect: Dictionary = {}` 注入 _initialize() 函数体内——GDScript 函数
  // 局部变量不跨函数,_walk() 引用即 "Identifier not declared"(res://measure:185)。
  // 最小修正:声明上移 class body 顶层(缺省空字典,_walk 的 .get(path, []) 恒安全),
  // _initialize() 内只做 parse 赋值(styleInit 仅在期望清单非空时注入)。
  // 声明位置必须在 `var _frames := 0` 之后:ui-layout-integration 的 buildThenMeasure
  // 以 'var _frames := 0' 为截取锚点拼接 build+measure 单进程脚本,锚点之前的新增声明
  // 会被截掉 → 拼接产物 _walk 引用未声明标识符。
  const styleInit = styleExpect && styleExpect.length > 0
    ? `\tvar _se_parsed = JSON.parse_string("${gdEscape(JSON.stringify(Object.fromEntries(styleExpect.map(e => [e.path, [...e.slots]]))))}")\n\t_style_expect = _se_parsed if typeof(_se_parsed) == TYPE_DICTIONARY else _style_expect\n`
    : '';
  return `${SCENE_TREE_HEADER}

var _frames := 0
var _stable_count := 0
var _last_snapshot := ""
var _target: Node = null
var _count := 0
const _all_slots := ["panel", "normal", "background", "fill", "hover", "pressed", "disabled"]
var _style_expect: Dictionary = {}

func _initialize():
${styleInit}\tif not _mcp_load_scene("${sp}"):
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
\t\t# PR-2:style 按需读回(期望清单 ∪ override 非空;spec §4.1)
\t\tvar _slots: Array = []
\t\tfor s in _style_expect.get(entry["path"], []):
\t\t\t_slots.append(str(s))
\t\tfor s in _all_slots:
\t\t\tif c.has_theme_stylebox_override(s) and not _slots.has(s):
\t\t\t\t_slots.append(s)
\t\tif _slots.size() > 0:
\t\t\tvar _styles: Array = []
\t\t\tfor s in _slots:
\t\t\t\tvar _sb = c.get_theme_stylebox(s)
\t\t\t\tvar _e := {"slot": s}
\t\t\t\tif _sb is StyleBoxFlat:
\t\t\t\t\tvar _f := _sb as StyleBoxFlat
\t\t\t\t\t_e["flat"] = true
\t\t\t\t\t_e["bg_color"] = [_f.bg_color.r, _f.bg_color.g, _f.bg_color.b, _f.bg_color.a]
\t\t\t\t\t_e["corner_radius"] = {"tl": _f.corner_radius_top_left, "tr": _f.corner_radius_top_right, "br": _f.corner_radius_bottom_right, "bl": _f.corner_radius_bottom_left}
\t\t\t\t\t_e["border_width"] = {"left": _f.border_width_left, "top": _f.border_width_top, "right": _f.border_width_right, "bottom": _f.border_width_bottom}
\t\t\t\t\t_e["border_color"] = [_f.border_color.r, _f.border_color.g, _f.border_color.b, _f.border_color.a]
\t\t\t\telse:
\t\t\t\t\t_e["flat"] = false
\t\t\t\t\t_e["type"] = _sb.get_class()
\t\t\t\t_styles.append(_e)
\t\t\tentry["styles"] = _styles
\t\tnodes.append(entry)
\t\t_count += 1
\tfor ch in n.get_children():
\t\t_walk(ch, depth + 1, nodes)
`;
}
