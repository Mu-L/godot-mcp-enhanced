## debugger_bridge.gd — CMP-14 (2026-08-09) Phase 2/3 调试器桥
##
## 对标竞品 regiellis/godot-mcp-go 的 services/debugger_bridge.gd。
## extends EditorDebuggerPlugin,在 plugin.gd _enter_tree 经 add_debugger_plugin 注册。
## 持有 EditorDebuggerSession,hook 调试器面板信号,按图标找按钮。
##
## 核心职责:
## - _setup_session:会话创建时缓存 session 引用 + 连 breaked/continued/stopped 信号
## - _has_capture/_capture:拦截游戏→编辑器的调试器消息(stack_dump/stack_frame_vars/
##   stack_frame_var/evaluation_return),攒进 _states[session_id]
## - current_break:返回当前 breaked 的 state(含 frames/vars/selected_frame/at 时间戳)
## - settle:轮询等栈/变量落地(700ms,stack_landed 判据:frames 非空且 vars.size>=expected)
## - press:按图标找按钮(DebugContinue/Pause/DebugNext/DebugStep)+ emit pressed
##   (step/resume/pause 唯一可行路;send_message("step") 需 breaking thread id 设不了)
## - select_frame:找面板 Tree 按 metadata 定位帧 + select(0)
## - synced_selection:从 Tree.get_selected() 回读真实选中帧(防用户手点)
## - ensure_connected:遍历 base_control 找 ScriptEditorDebugger 面板 + 连信号
##
## 架构要点(竞品验证):
## - 栈/变量不主动 send_message 请求——编辑器在 break 时自动发 get_stack_dump + 选 frame 0
## - step/resume/pause 走按钮 emit pressed(非 wire message,因 thread id 设不了)
## - 多实例 run 按 panel.get_instance_id() 索引,不串数据
extends EditorDebuggerPlugin

# 超时常量(对标竞品有界轮询)
const SETTLE_MS := 700          # 栈/变量落地等待
const STEP_WAIT_MS := 2000      # step 后等新断点
const RESUME_WATCH_MS := 1000   # resume 后等新断点
const PAUSE_WATCH_MS := 1000    # pause 后等 is_breaked

# 变量截断(防撑爆消息上限)
const VARS_CAP := 100

# step/resume/pause 按钮图标名 → EditorIcons theme icon 名(对标竞品 ICONS 映射)
const ICON_NAMES := {
	"resume": "DebugContinue",
	"pause": "Pause",
	"over": "DebugNext",
	"into": "DebugStep",
}

# 变量类型码 → 可读名(Godot Variant.Type,用于 stack_frame_var data[1] 渲染)
const VAR_KINDS := {
	0: "nil", 1: "bool", 2: "int", 3: "float", 4: "String",
	5: "Vector2", 6: "Vector2i", 7: "Rect2", 8: "Rect2i",
	9: "Vector3", 10: "Vector3i", 11: "Transform2D",
	12: "Vector4", 13: "Vector4i", 14: "Plane", 15: "Quaternion",
	16: "AABB", 17: "Basis", 18: "Transform3D", 19: "Projection",
	20: "Color", 21: "StringName", 22: "NodePath", 23: "RID",
	24: "Object", 25: "Callable", 26: "Signal",
	27: "Dictionary", 28: "Array", 29: "PackedByteArray",
	30: "PackedInt32Array", 31: "PackedInt64Array",
	32: "PackedFloat32Array", 33: "PackedFloat64Array",
	34: "PackedStringArray", 35: "PackedVector2Array",
	36: "PackedVector3Array", 37: "PackedColorArray",
	38: "PackedVector4Array",
}

# 每个 session 的状态:按 session_id 索引
# {session_id: {
#   breaked: bool, reason: String, can_debug: bool, at: int(msec 时间戳),
#   frames: Array[{frame, file, line, function}],
#   has_stackdump: bool, expected_vars: int, vars: Array[{name, kind, value}],
#   selected_frame: int, panel: ScriptEditorDebugger(私有类)
# }}
var _states: Dictionary = {}

# 已连接信号的面板 instance id 集合(防重复连)
var _hooked_panels: Dictionary = {}


# ─── EditorDebuggerPlugin 虚方法重写 ──────────────────────────────────────────

func _setup_session(session_id: int) -> void:
	# 会话创建时触发。获取 session 引用并连信号。
	# session 本身经 get_session(session_id) 按需取(不长期持有,防 session 失效后访问)。
	var session: EditorDebuggerSession = get_session(session_id)
	if session == null:
		return
	# 连 breaked/continued/stopped 信号更新 _states
	if not session.is_connected("breaked", Callable(self, "_on_session_breaked").bind(session_id)):
		session.connect("breaked", Callable(self, "_on_session_breaked").bind(session_id))
	if not session.is_connected("continued", Callable(self, "_on_session_continued").bind(session_id)):
		session.connect("continued", Callable(self, "_on_session_continued").bind(session_id))
	if not session.is_connected("stopped", Callable(self, "_on_session_stopped").bind(session_id)):
		session.connect("stopped", Callable(self, "_on_session_stopped").bind(session_id))


func _has_capture(capture: String) -> bool:
	# 声明接收的消息前缀(游戏→编辑器方向)
	return capture in ["stack_dump", "stack_frame_vars", "stack_frame_var", "evaluation_return", "debug_enter", "debug_exit"]


func _capture(message: String, data: Array, session_id: int) -> bool:
	# 拦截游戏→编辑器的调试器消息,攒进 _states
	# 返回 true 表示已处理(不再传给其他 capture)
	if not _states.has(session_id):
		_states[session_id] = _new_state()
	var state: Dictionary = _states[session_id]

	match message:
		"stack_dump":
			# data = Array of frame dicts {file, line, function, ...}
			state["frames"] = []
			for i in range(data.size()):
				var frame_info = data[i]
				if frame_info is Dictionary:
					state["frames"].append({
						"frame": i,
						"file": str(frame_info.get("file", "")),
						"line": int(frame_info.get("line", 0)),
						"function": str(frame_info.get("function", "")),
					})
			state["has_stackdump"] = true
			state["selected_frame"] = 0
			state["expected_vars"] = 0
			state["vars"] = []
			return true
		"stack_frame_vars":
			# data[0] = num_vars(该帧变量数,后续 stack_frame_var 逐个到)
			if data.size() > 0:
				state["expected_vars"] = int(data[0])
				state["vars"] = []
			return true
		"stack_frame_var":
			# data = [name, kind_int, ?, value_variant](对标竞品 data[3] 是值)
			if data.size() >= 4:
				var kind_code: int = int(data[1]) if data.size() > 1 else -1
				state["vars"].append({
					"name": str(data[0]),
					"kind": VAR_KINDS.get(kind_code, "unknown"),
					"value": _render_value(data[3]),
				})
			return true
		"evaluation_return":
			# 表达式求值结果:data = [expression, value_variant](或类似)
			state["eval_result"] = _render_value(data[data.size() - 1]) if data.size() > 0 else null
			state["eval_received"] = true
			return true
		"debug_enter":
			# 进入断点(游戏暂停)
			state["breaked"] = true
			state["at"] = Time.get_ticks_msec()
			state["reason"] = str(data[0]) if data.size() > 0 else ""
			state["can_debug"] = bool(data[1]) if data.size() > 1 else true
			state["has_stackdump"] = false
			state["frames"] = []
			state["vars"] = []
			return true
		"debug_exit":
			# 退出断点(继续运行)
			state["breaked"] = false
			return true
	return false


# ─── 信号回调 ──────────────────────────────────────────────────────────────────

func _on_session_breaked(can_debug: bool, session_id: int) -> void:
	# session.breaked 信号(与 _capture debug_enter 互补,用于面板层面感知)
	if not _states.has(session_id):
		_states[session_id] = _new_state()
	_states[session_id]["breaked"] = true
	_states[session_id]["can_debug"] = can_debug
	_states[session_id]["at"] = Time.get_ticks_msec()


func _on_session_continued(session_id: int) -> void:
	if _states.has(session_id):
		_states[session_id]["breaked"] = false


func _on_session_stopped(session_id: int) -> void:
	# 游戏停止,清该 session 状态
	_states.erase(session_id)


# ─── 状态查询 ──────────────────────────────────────────────────────────────────

func _new_state() -> Dictionary:
	return {
		"breaked": false, "reason": "", "can_debug": false, "at": 0,
		"frames": [], "has_stackdump": false,
		"expected_vars": 0, "vars": [],
		"selected_frame": 0,
		"eval_result": null, "eval_received": false,
	}


func current_break() -> Dictionary:
	# 返回当前 breaked==true 的 state(多 session 取第一个;空则返 {})
	for sid in _states:
		var state: Dictionary = _states[sid]
		if state.get("breaked", false):
			return state
	return {}


func active_sessions() -> Array:
	# 返回活跃 session 列表 [[session_id, EditorDebuggerSession], ...]
	var result: Array = []
	for sid in _states:
		var session: EditorDebuggerSession = get_session(sid)
		if session != null and is_instance_valid(session):
			result.append([sid, session])
	return result


# ─── settle:轮询等栈/变量落地 ──────────────────────────────────────────────────

func stack_landed(state: Dictionary) -> bool:
	# 栈/变量是否已落地(对标竞品 stack_landed 判据)
	# 无脚本栈的断点(has_stackdump=false)立即算完成
	if not state.get("has_stackdump", false):
		return true
	# 有栈则要 frames 非空且 vars 够数
	var frames: Array = state.get("frames", [])
	var expected: int = int(state.get("expected_vars", 0))
	var vars: Array = state.get("vars", [])
	return frames.size() > 0 and vars.size() >= expected


func settle(state: Dictionary, timeout_ms: int = SETTLE_MS) -> Dictionary:
	# 轮询等栈/变量落地(对标竞品 settle,默认 700ms)
	var deadline := Time.get_ticks_msec() + timeout_ms
	while Time.get_ticks_msec() < deadline:
		if stack_landed(state):
			return state
		if not EditorInterface.is_playing_scene():
			return state  # 游戏结束,不等
		await Engine.get_main_loop().process_frame
	return state  # 超时返当前状态


# ─── press:按图标找按钮(step/resume/pause 唯一可行路) ─────────────────────────

func _find_debugger_panels() -> Array:
	# 遍历 base_control 找所有 ScriptEditorDebugger 面板(私有类,只能 walk control tree)
	# 对标竞品 ensure_connected 的面板发现逻辑
	var base: Control = EditorInterface.get_base_control()
	if base == null:
		return []
	var panels: Array = []
	var stack: Array = [base]
	while stack.size() > 0:
		var node: Node = stack.pop_back()
		if node == null:
			continue
		if node is Panel or node is Control:
			var cls: String = node.get_class()
			# ScriptEditorDebugger 是私有类,get_class() 可能返 "ScriptEditorDebugger" 或父类
			# 用 has_method 辅助判断(它有 send_message 等调试器特有方法)
			if cls == "ScriptEditorDebugger" or (node.has_method("send_message") and node.has_method("get_stack_trace")):
				panels.append(node)
		for child in node.get_children():
			stack.append(child)
	return panels


func press(action: String, panel: Node = null) -> Dictionary:
	# 按图标找调试器面板按钮 + emit pressed(对标竞品 press)
	# action: resume/pause/over/into
	# 返回 {ok: bool, why: String}
	# 关键:不能用 send_message("step")(需 breaking thread id,send_message 设不了;
	# 硬发会断脚本而非 step)。走按钮 emit pressed 是唯一可行路(竞品验证)。
	var icon_name: String = ICON_NAMES.get(action, "")
	if icon_name == "":
		return {"ok": false, "why": "unknown action: %s" % action}
	var base: Control = EditorInterface.get_base_control()
	if base == null:
		return {"ok": false, "why": "EditorInterface.get_base_control() returned null"}
	var target_icon = base.get_theme_icon(icon_name, "EditorIcons")
	# 在指定 panel 或全局递归找 icon 匹配的 Button
	var search_root: Node = panel if panel != null else base
	var button: Button = _find_button_by_icon(search_root, target_icon)
	if button == null:
		return {"ok": false, "why": "debugger %s button not found (icon: %s)" % [action, icon_name]}
	if button.disabled:
		return {"ok": false, "why": "the debugger's %s button is disabled right now (engine reports this action is not legal here)" % action}
	button.emit_signal("pressed")
	return {"ok": true, "why": ""}


func _find_button_by_icon(node: Node, target_icon: Texture2D) -> Button:
	# 递归找 icon 匹配的 Button(对标竞品 buttons() 遍历)
	# 用 button.icon == target_icon 匹配(不能用 tooltip,tooltip 本地化)
	var stack: Array = [node]
	while stack.size() > 0:
		var current: Node = stack.pop_back()
		if current == null:
			continue
		if current is Button:
			var btn: Button = current as Button
			if btn.icon != null and btn.icon == target_icon:
				return btn
		for child in current.get_children():
			stack.append(child)
	return null


# ─── select_frame:切栈帧 + synced_selection ────────────────────────────────────

func select_frame(state: Dictionary, index: int) -> Dictionary:
	# 找面板 Tree 按 metadata 定位帧 + select(0),触发编辑器自动拉该帧变量
	# 对标竞品 select_frame
	# 返回 {ok: bool, why: String}
	var panels := _find_debugger_panels()
	if panels.is_empty():
		return {"ok": false, "why": "no debugger panel found"}
	for panel in panels:
		var tree: Tree = _find_stack_tree(panel)
		if tree == null:
			continue
		var item: TreeItem = tree.get_root()
		while item != null:
			var meta = item.get_metadata(0)
			if meta is Dictionary and int(meta.get("frame", -1)) == index:
				item.select(0)
				state["selected_frame"] = index
				state["expected_vars"] = 0
				state["vars"] = []
				return {"ok": true, "why": ""}
			item = item.get_next()
	return {"ok": false, "why": "frame %d not found in stack tree" % index}


func synced_selection(state: Dictionary) -> int:
	# 从 Tree.get_selected() 回读真实选中帧(防用户手点)
	# 对标竞品 synced_selection
	var panels := _find_debugger_panels()
	for panel in panels:
		var tree: Tree = _find_stack_tree(panel)
		if tree == null:
			continue
		var selected: TreeItem = tree.get_selected()
		if selected != null:
			var meta = selected.get_metadata(0)
			if meta is Dictionary:
				var frame_idx: int = int(meta.get("frame", state.get("selected_frame", 0)))
				state["selected_frame"] = frame_idx
				return frame_idx
	return int(state.get("selected_frame", 0))


func _find_stack_tree(panel: Node) -> Tree:
	# 在调试器面板内找显示调用栈的 Tree
	# ScriptEditorDebugger 的栈 Tree 通常含 "Stack" 或 class==Tree
	var stack: Array = [panel]
	while stack.size() > 0:
		var node: Node = stack.pop_back()
		if node == null:
			continue
		if node is Tree:
			return node as Tree
		for child in node.get_children():
			stack.append(child)
	return null


# ─── ensure_connected:面板发现 + 信号连接 ──────────────────────────────────────

func ensure_connected() -> Dictionary:
	# 遍历 base_control 找 ScriptEditorDebugger 面板 + 连信号
	# 返回 {found: bool, hooked: bool, panels: Array}
	# 对标竞品 ensure_connected(诚实区分"无面板"vs"有面板无信号")
	var panels := _find_debugger_panels()
	if panels.is_empty():
		return {"found": false, "hooked": false, "panels": []}
	for panel in panels:
		var pid: int = panel.get_instance_id()
		if not _hooked_panels.has(pid):
			# 连面板级信号(stack_dump/stack_frame_vars/stack_frame_var 是面板信号)
			# 注:ScriptEditorDebugger 面板本身 emit 这些信号(非 session)
			if panel.has_signal("stack_dump"):
				panel.connect("stack_dump", Callable(self, "_on_panel_stack_dump").bind(panel))
			if panel.has_signal("stack_frame_vars"):
				panel.connect("stack_frame_vars", Callable(self, "_on_panel_stack_frame_vars").bind(panel))
			if panel.has_signal("stack_frame_var"):
				panel.connect("stack_frame_var", Callable(self, "_on_panel_stack_frame_var").bind(panel))
			_hooked_panels[pid] = true
	return {"found": true, "hooked": _hooked_panels.size() > 0, "panels": panels}


# 面板级信号回调(与 _capture 互补,面板直接 emit 的信号走这里)
func _on_panel_stack_dump(stack: Array, panel: Node) -> void:
	# 面板 emit stack_dump 信号时,更新对应 session state
	var pid: int = panel.get_instance_id()
	for sid in _states:
		var state: Dictionary = _states[sid]
		state["frames"] = []
		for i in range(stack.size()):
			var frame_info = stack[i]
			if frame_info is Dictionary:
				state["frames"].append({
					"frame": i,
					"file": str(frame_info.get("file", "")),
					"line": int(frame_info.get("line", 0)),
					"function": str(frame_info.get("function", "")),
				})
		state["has_stackdump"] = true
		state["selected_frame"] = 0
		break  # 只更新第一个 session


func _on_panel_stack_frame_vars(num_vars: int, panel: Node) -> void:
	for sid in _states:
		_states[sid]["expected_vars"] = num_vars
		_states[sid]["vars"] = []
		break


func _on_panel_stack_frame_var(name: String, _type: int, value: Variant, panel: Node) -> void:
	for sid in _states:
		var state: Dictionary = _states[sid]
		state["vars"].append({
			"name": name,
			"kind": VAR_KINDS.get(_type, "unknown"),
			"value": _render_value(value),
		})
		break


# ─── _await_new_break:操作后等新断点(对标竞品) ───────────────────────────────

func await_new_break(after_msec: int, timeout_ms: int) -> Dictionary:
	# step/resume 后轮询等新断点(at 时间戳 > 操作前)
	# 超时不当错误:游戏继续跑是真实结果
	var deadline := Time.get_ticks_msec() + timeout_ms
	while Time.get_ticks_msec() < deadline:
		var state: Dictionary = current_break()
		if not state.is_empty() and int(state.get("at", 0)) > after_msec:
			return state
		if not EditorInterface.is_playing_scene():
			return {}  # 游戏结束,非超时
		await Engine.get_main_loop().process_frame
	return {}  # 超时(游戏继续跑)


# ─── 辅助:渲染变量值(JSON 可序列化) ──────────────────────────────────────────

func _render_value(val: Variant) -> Variant:
	# 把调试器返回的 Variant 渲染成 JSON 可序列化值
	# 对象类型只回 id stub(调试器不传对象本身)
	if val == null:
		return null
	if val is bool or val is int or val is float or val is String:
		return val
	if val is Vector2:
		return {"x": val.x, "y": val.y}
	if val is Vector3:
		return {"x": val.x, "y": val.y, "z": val.z}
	if val is Color:
		return {"r": val.r, "g": val.g, "b": val.b, "a": val.a}
	if val is Array:
		var out: Array = []
		for i in range(mini(val.size(), 50)):  # 截断防撑爆
			out.append(_render_value(val[i]))
		return out
	if val is Dictionary:
		var dout: Dictionary = {}
		var count := 0
		for k in val:
			if count >= 50:
				break
			dout[str(k)] = _render_value(val[k])
			count += 1
		return dout
	if val is Object:
		return {"type": val.get_class(), "instance_id": val.get_instance_id()}
	return str(val)
