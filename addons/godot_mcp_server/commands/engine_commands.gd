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
	# 属性
	var props: Array = ClassDB.class_get_property_list(class_name_, no_inherit)
	var prop_out: Array = []
	for p in props:
		# 过滤 metadata 级别 property(只有 name+usage 无 type 的)
		if p is Dictionary and p.has("name") and p.has("type"):
			prop_out.append({"name": p["name"], "type": _type_name(int(p["type"])), "class_name": String(p.get("class_name", ""))})
	info["properties"] = prop_out
	info["property_count"] = prop_out.size()
	# 方法
	var methods: Array = ClassDB.class_get_method_list(class_name_, no_inherit)
	var method_out: Array = []
	for m in methods:
		if m is Dictionary and m.has("name"):
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
			signal_out.append(s["name"])
	info["signals"] = signal_out
	# 枚举
	var enums: Array = ClassDB.class_get_enum_list(class_name_, no_inherit)
	var enum_out: Array = []
	for e in enums:
		enum_out.append(e)
	info["enums"] = enum_out
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
	for cls in all_classes:
		if cls.to_lower().contains(query_lower):
			matches.append({"name": cls, "parent": ClassDB.get_parent_class(cls)})
			if matches.size() >= SEARCH_LIMIT:
				break
	return {"result": {"matches": matches, "count": matches.size(), "truncated": matches.size() >= SEARCH_LIMIT, "query": query}}


# 返回类的继承链(从本类到 Object)。
func handle_get_inheritance(params: Dictionary) -> Dictionary:
	var class_name_: String = params.get("class", "")
	if class_name_ == "":
		return {"error": {"code": -32602, "message": "class is required"}}
	if not ClassDB.class_exists(class_name_):
		return {"error": {"code": -32604, "message": "Class '%s' does not exist in ClassDB." % class_name_}}
	var chain: Array = [class_name_]
	var current: String = class_name_
	for i in 100:  # 防御性上限
		var parent: String = ClassDB.get_parent_class(current)
		if parent == "" or parent == current:
			break
		chain.append(parent)
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
