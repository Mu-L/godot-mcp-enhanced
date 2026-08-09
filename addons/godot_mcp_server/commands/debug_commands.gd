extends Node

# CMP-3 (2026-08-08): debug 组 Phase 1 — 断点管理(editor-only)
# 提供 set/clear/list breakpoint 三个同步 action。
# AI 能预置断点,用户 F5 运行后命中——从无到有的质变。
#
# 断点走 CodeEdit gutter 路径(竞品 regiellis/godot-mcp-go 验证可行):
# - 不走底层 breakpoint debugger message(只 arm game,不可见/跨 run 丢失)
# - 走 CodeEdit.set_line_as_breakpoint → 进入 editor breakpoint map
#   → 现行 game 命中 + 下次 run 同步 + gutter 可见 + Breakpoints 列表可见
#
# 设计决策(Phase 1 简化):
# - 只对当前活跃 tab 的脚本操作(get_current_script,非 get_open_scripts 全集);Phase 1 纯同步不切 tab
# - 不调 open_script_open_file_edit(避免异步等帧复杂度;Phase 1 纯同步)
# - 脚本未打开 → 报错提示 AI 先用 editor 工具打开或让用户手动打开
# - 行号 1-based(AI 友好)→ CodeEdit 0-based 内部转换
# - path 必须是 res:// 开头

var _plugin: EditorPlugin


func setup(plugin: EditorPlugin, _undo_manager: Node = null) -> void:
	_plugin = plugin


func cleanup() -> void:
	_plugin = null


# CMP-16-A (2026-08-08): param docs metadata。
func get_command_docs() -> Dictionary:
	return {
		"debug_set_breakpoint": {
			"description": "在指定脚本行设置断点(走 CodeEdit gutter,进入 editor breakpoint map)。脚本须在编辑器中打开且是当前活跃 tab。",
			"params": [
				CommandHelpers.doc_param("path", "String", true, "res:// 路径的 .gd 脚本"),
				CommandHelpers.doc_param("line", "int", true, "1-based 行号"),
			],
		},
		"debug_clear_breakpoint": {
			"description": "清除指定脚本行的断点。脚本须在编辑器中打开且是当前活跃 tab。",
			"params": [
				CommandHelpers.doc_param("path", "String", true, "res:// 路径的 .gd 脚本"),
				CommandHelpers.doc_param("line", "int", true, "1-based 行号"),
			],
		},
		"debug_list_breakpoints": {
			"description": "列出当前活跃 tab 脚本的断点(Phase 1 只查当前 tab)。",
			"params": [
				CommandHelpers.doc_param("path", "String", false, "可选:只列指定脚本(留空=当前活跃 tab)"),
			],
		},
	}


# ─── Breakpoint management ────────────────────────────────────────────────────

func handle_set_breakpoint(params: Dictionary) -> Dictionary:
	var path: String = params.get("path", "")
	var line: int = int(params.get("line", 0))
	if path == "":
		return {"error": {"code": -32602, "message": "path is required (res:// path to .gd script)"}}
	if line < 1:
		return {"error": {"code": -32602, "message": "line is required (1-based line number)"}}
	if not path.begins_with("res://"):
		return {"error": {"code": -32602, "message": "path must be a res:// path, got: %s" % path}}
	return _toggle_breakpoint(path, line, true)


func handle_clear_breakpoint(params: Dictionary) -> Dictionary:
	var path: String = params.get("path", "")
	var line: int = int(params.get("line", 0))
	if path == "":
		return {"error": {"code": -32602, "message": "path is required (res:// path to .gd script)"}}
	if line < 1:
		return {"error": {"code": -32602, "message": "line is required (1-based line number)"}}
	if not path.begins_with("res://"):
		return {"error": {"code": -32602, "message": "path must be a res:// path, got: %s" % path}}
	return _toggle_breakpoint(path, line, false)


func handle_list_breakpoints(params: Dictionary) -> Dictionary:
	var filter_path: String = params.get("path", "")
	var script_editor: ScriptEditor = EditorInterface.get_script_editor()
	var result: Array = []
	# Phase 1:只查当前活跃 tab 的断点(get_breakpointed_lines 只在当前 CodeEdit 可用)
	var current_script: Resource = script_editor.get_current_script()
	if current_script != null and current_script is Script:
		var res_path: String = current_script.resource_path
		if filter_path == "" or res_path == filter_path:
			var ce_result: Dictionary = _get_current_code_edit(script_editor)
			var code_edit: CodeEdit = ce_result.get("code_edit", null)
			if code_edit != null:
				var bp_lines: PackedInt32Array = code_edit.get_breakpointed_lines()
				if not bp_lines.is_empty():
					# CodeEdit 行号 0-based → 转 1-based(AI 友好)
					var lines_1based: Array = []
					for bp_line in bp_lines:
						lines_1based.append(bp_line + 1)
					result.append({"path": res_path, "lines": lines_1based})
	return {"result": {"breakpoints": result, "count": result.size(), "scope": "current_tab", "note": "Only lists breakpoints for the currently active script tab. Open the script in the editor to list its breakpoints."}}


# ─── Internal helpers ────────────────────────────────────────────────────────

# toggle 断点的核心:找到已打开的脚本 → 拿 CodeEdit → set_line_as_breakpoint → 二次校验
# Phase 1 只对当前活跃 tab 操作(避免异步切换 tab 复杂度)
func _toggle_breakpoint(path: String, line: int, enabled: bool) -> Dictionary:
	var script_editor: ScriptEditor = EditorInterface.get_script_editor()
	# 校验脚本在 editor 中打开(且是当前 tab)
	var current_script: Resource = script_editor.get_current_script()
	if current_script == null or not current_script is Script:
		return {"error": {"code": -32004, "message": "No script open in editor. Open %s first (it must be the active tab)." % path}}
	if current_script.resource_path != path:
		return {"error": {"code": -32004, "message": "Script %s is not the active tab. Switch to it in the editor first (currently active: %s)." % [path, current_script.resource_path]}}
	# 拿 CodeEdit
	# GD-R7: _get_current_code_edit 返回 Dictionary 含 reason,错误信息区分版本不兼容/布局异常/无 tab
	var ce_result: Dictionary = _get_current_code_edit(script_editor)
	var code_edit: CodeEdit = ce_result.get("code_edit", null)
	if code_edit == null:
		return {"error": {"code": -32003, "message": "Could not get CodeEdit: %s" % ce_result.get("reason", "unknown error")}}
	# 行号 1-based(AI)→ 0-based(CodeEdit 内部)
	var line_0based: int = line - 1
	if line_0based < 0 or line_0based >= code_edit.get_line_count():
		return {"error": {"code": -32602, "message": "Line %d is out of range (script has %d lines)" % [line, code_edit.get_line_count()]}}
	# toggle gutter breakpoint
	code_edit.set_line_as_breakpoint(line_0based, enabled)
	# 二次校验:gutter 是否真的接受了变更
	var actual: bool = code_edit.is_line_breakpointed(line_0based)
	if actual != enabled:
		return {"error": {"code": -32003, "message": "Breakpoint gutter did not take the change (line %d of %s)" % [line, path]}}
	return {"result": {
		"path": path,
		"line": line,
		"enabled": enabled,
		"visible_in_editor": true,
		"note": "Breakpoint is in the editor's breakpoint map: visible in gutter, live for a running game, and kept for the next run.",
	}}


# 从当前活跃 editor 拿 CodeEdit(ScriptEditorBase.get_base_editor)
# GD-R7 (2026-08-08): 返回 Dictionary 含 code_edit + reason,区分"版本不兼容"vs"布局异常"vs"无活跃 tab"
func _get_current_code_edit(script_editor: ScriptEditor) -> Dictionary:
	var editor = script_editor.get_current_editor()
	if editor == null:
		return {"code_edit": null, "reason": "No active script editor tab — open a script first"}
	if not editor.has_method("get_base_editor"):
		return {"code_edit": null, "reason": "Editor version unsupported: ScriptEditorBase lacks get_base_editor method (possible Godot version incompatibility)"}
	var base = editor.call("get_base_editor")
	if base is CodeEdit:
		return {"code_edit": base as CodeEdit, "reason": ""}
	return {"code_edit": null, "reason": "Active editor's base is not a CodeEdit (got %s) — internal layout may have changed" % ("" if base == null else base.get_class())}
