extends Node

# CMP-4 (2026-08-08): engine 组 — 实时 ClassDB 内省(editor-only)
# 让 AI 发现运行中引擎的实际可用类/方法/属性/信号/枚举。
# 补静态 extension_api.json(4.7 快照,不含第三方 addon/自定义类/4.6/4.8 差异)的缺口。
#
# 走 editor 层直调 ClassDB(不经 gdscript-executor 沙箱——ClassDB 在沙箱里被列为危险模式)。
# 已有先例:node_commands.gd:60/237 ClassDB.instantiate, ui_commands.gd:45/357 同款。

var _plugin: EditorPlugin

# search 结果上限(防全量 1000+ 类 × 子串匹配返回过大)
const SEARCH_LIMIT := 100
# CMP-4-R1: class_info 单类成员上限(防 Node 400+ 方法序列化撑爆 1MB → send_text ERR_INVALID_DATA → -32010)
const MEMBER_LIMIT := 200


func setup(plugin: EditorPlugin, _undo_manager: Node = null) -> void:
	_plugin = plugin


func cleanup() -> void:
	_plugin = null


# ─── ClassDB 内省 ─────────────────────────────────────────────────────────────

# 查单个类的结构:属性/方法/信号/枚举/继承。
# no_inherit=true(默认)只看本类 own 成员;false 含继承链合并。
func handle_class_info(params: Dictionary) -> Dictionary:
	var class_name_: String = params.get("class", "")
	if class_name_ == "":
		return {"error": {"code": -32602, "message": "class is required (e.g. 'Node', 'Sprite2D', 'RigidBody3D')"}}
	if not ClassDB.class_exists(class_name_):
		return {"error": {"code": -32604, "message": "Class '%s' does not exist in ClassDB. Use engine.search to find available classes." % class_name_}}
	var no_inherit: bool = params.get("no_inherit", true)
	var info: Dictionary = {}
	info["name"] = class_name_
	info["parent"] = ClassDB.get_parent_class(class_name_)
	info["can_instantiate"] = ClassDB.can_instantiate(class_name_)
	# CMP-4-R1: 各类成员截断标志(任一类别超 MEMBER_LIMIT 则 truncated=true)
	var truncated := false
	# 属性
	var props: Array = ClassDB.class_get_property_list(class_name_, no_inherit)
	var prop_out: Array = []
	for p in props:
		# 过滤 metadata 级别 property(只有 name+usage 无 type 的)
		# CMP-4-R2: 过滤 PROPERTY_USAGE_INTERNAL(0x2) 属性(AI 不应见 internal,误当公开 API 调)
		if p is Dictionary and p.has("name") and p.has("type"):
			if int(p.get("usage", 0)) & PROPERTY_USAGE_INTERNAL:
				continue
			if prop_out.size() >= MEMBER_LIMIT:
				truncated = true
				break
			prop_out.append({"name": p["name"], "type": _type_name(int(p["type"])), "class_name": String(p.get("class_name", ""))})
	info["properties"] = prop_out
	info["property_count"] = prop_out.size()
	# 方法
	var methods: Array = ClassDB.class_get_method_list(class_name_, no_inherit)
	var method_out: Array = []
	for m in methods:
		if m is Dictionary and m.has("name"):
			if method_out.size() >= MEMBER_LIMIT:
				truncated = true
				break
			var args_out: Array = []
			if m.has("args"):
				for a in m["args"]:
					if a is Dictionary and a.has("name"):
						args_out.append({"name": a["name"], "type": _type_name(int(a.get("type", 0)))})
			method_out.append({"name": m["name"], "return_type": _type_name(int(m.get("return_type", 0))), "args": args_out})
	info["methods"] = method_out
	info["method_count"] = method_out.size()
	# 信号
	var signals: Array = ClassDB.class_get_signal_list(class_name_, no_inherit)
	var signal_out: Array = []
	for s in signals:
		if s is Dictionary and s.has("name"):
			if signal_out.size() >= MEMBER_LIMIT:
				truncated = true
				break
			signal_out.append(s["name"])
	info["signals"] = signal_out
	# 枚举
	# GD-R4 (2026-08-08): 补 enum constants(用 class_get_enum_constants),AI 可知枚举可选值。
	# 原 class_get_enum_list 只返枚举名(如 ["Button","Vector2.Axis"]),AI 无法知道常量/值。
	var enums: Array = ClassDB.class_get_enum_list(class_name_, no_inherit)
	var enum_out: Array = []
	const ENUM_CONSTANTS_LIMIT := 50  # 单 enum 常量上限(防巨型 enum 如 Key 撑爆)
	for e in enums:
		if enum_out.size() >= MEMBER_LIMIT:
			truncated = true
			break
		var constants: PackedStringArray = ClassDB.class_get_enum_constants(class_name_, e, no_inherit)
		var const_out: Array = []
		for c in constants:
			if const_out.size() >= ENUM_CONSTANTS_LIMIT:
				truncated = true
				break
			# class_get_integer_constant 拿值(供 AI 理解枚举值范围)
			const_out.append({"name": c, "value": ClassDB.class_get_integer_constant(class_name_, c)})
		enum_out.append({"name": e, "constants": const_out})
	info["enums"] = enum_out
	# CMP-4-R1: 截断时提示 AI 改用 no_inherit=true 只看本类成员(避免 1MB 撑爆)
	info["truncated"] = truncated
	if truncated:
		info["truncation_hint"] = "Output truncated at %d members per category. Use no_inherit=true to see only own members, or search for a specific class." % MEMBER_LIMIT
	return {"result": info}


# substring 匹配类名(不做全方法 sweep——1000+ 类 × property_list 是 O(N) 太慢)。
# AI 搜到类名后用 class_info 查具体成员。
func handle_search(params: Dictionary) -> Dictionary:
	var query: String = params.get("query", "")
	if query == "":
		return {"error": {"code": -32602, "message": "query is required (substring to match class names)"}}
	var query_lower := query.to_lower()
	var all_classes: PackedStringArray = ClassDB.get_class_list()
	var matches: Array = []
	# GD-R6 (2026-08-08): 先 collect 全部 matches 再字母序排序再截断(原按 ClassDB 注册序截断,
	# AI 搜 "Node" 拿到的结果跨 Godot 版本/addon 组合不可预测,字母序靠后的相关类可能被丢弃)。
	for cls in all_classes:
		if cls.to_lower().contains(query_lower):
			matches.append({"name": cls, "parent": ClassDB.get_parent_class(cls)})
	# 字母序排序(让 AI 看到可预测的、相关性更均匀的结果)
	matches.sort_custom(func(a, b): return a["name"] < b["name"])
	# 排序后截断到 SEARCH_LIMIT(用 flag 记录是否真因 limit 提前退出,避免恰好 == LIMIT 假阳性)
	var hit_limit := matches.size() > SEARCH_LIMIT
	if hit_limit:
		matches = matches.slice(0, SEARCH_LIMIT)
	return {"result": {"matches": matches, "count": matches.size(), "truncated": hit_limit, "query": query}}


# 返回类的继承链(从本类到 Object)。
func handle_get_inheritance(params: Dictionary) -> Dictionary:
	var class_name_: String = params.get("class", "")
	if class_name_ == "":
		return {"error": {"code": -32602, "message": "class is required"}}
	if not ClassDB.class_exists(class_name_):
		return {"error": {"code": -32604, "message": "Class '%s' does not exist in ClassDB." % class_name_}}
	var chain: Array = [class_name_]
	# CMP-4-R4: 用 visited Set 做完整环检测,破 A→B→A 互循环(原 parent==current 只破 A→A 自引用)
	var visited: Dictionary = {class_name_: true}
	var current: String = class_name_
	for i in 100:  # 防御性上限
		var parent: String = ClassDB.get_parent_class(current)
		if parent == "" or visited.has(parent):
			break
		chain.append(parent)
		visited[parent] = true
		current = parent
	return {"result": {"chain": chain, "depth": chain.size()}}


# ─── Helpers ─────────────────────────────────────────────────────────────────

# Variant.Type int → 可读名称（Godot 4.x Variant.Type 枚举值,经官方文档核实 4.4-4.7 一致）
func _type_name(type: int) -> String:
	# B-2 (2026-08-08 第三方审查): 补 Projection(19) + PackedVector4Array(38),
	# 修复 off-by-two（原表漏 Projection 致 19+ 全部错位）。
	match type:
		0: return "NIL"
		1: return "bool"
		2: return "int"
		3: return "float"
		4: return "String"
		5: return "Vector2"
		6: return "Vector2i"
		7: return "Rect2"
		8: return "Rect2i"
		9: return "Vector3"
		10: return "Vector3i"
		11: return "Transform2D"
		12: return "Vector4"
		13: return "Vector4i"
		14: return "Plane"
		15: return "Quaternion"
		16: return "AABB"
		17: return "Basis"
		18: return "Transform3D"
		19: return "Projection"
		20: return "Color"
		21: return "StringName"
		22: return "NodePath"
		23: return "RID"
		24: return "Object"
		25: return "Callable"
		26: return "Signal"
		27: return "Dictionary"
		28: return "Array"
		29: return "PackedByteArray"
		30: return "PackedInt32Array"
		31: return "PackedInt64Array"
		32: return "PackedFloat32Array"
		33: return "PackedFloat64Array"
		34: return "PackedStringArray"
		35: return "PackedVector2Array"
		36: return "PackedVector3Array"
		37: return "PackedColorArray"
		38: return "PackedVector4Array"
		_: return "type_%d" % type
