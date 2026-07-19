extends Node

var _undo_manager: Node
var _plugin: EditorPlugin

const ALLOWED_NODE_TYPES: Array = [
	"Node3D", "MeshInstance3D", "StaticBody3D", "RigidBody3D",
	"CharacterBody3D", "Camera3D", "Light3D", "DirectionalLight3D",
	"OmniLight3D", "SpotLight3D", "CollisionShape3D", "RayCast3D",
	"Area3D", "Marker3D", "PathFollow3D", "VisibleOnScreenNotifier3D",
	"Node", "Node2D", "Sprite2D", "AnimatedSprite2D",
	"CollisionShape2D", "Area2D", "RigidBody2D", "CharacterBody2D",
	"AudioStreamPlayer", "AudioStreamPlayer2D", "AudioStreamPlayer3D",
	"AnimationPlayer", "AnimationTree", "Timer",
]

func setup(plugin: EditorPlugin, undo_manager: Node) -> void:
	_undo_manager = undo_manager
	_plugin = plugin

# I-06: null-safe EditorInterface accessor
# 4.7: EditorInterface 不再作为 Engine singleton 注册,改用 EditorPlugin.get_editor_interface()。
func _get_ei() -> EditorInterface:
	if _plugin == null:
		push_error("[MCP] EditorPlugin not available")
		return null
	return _plugin.get_editor_interface()

func handle_add_node(params: Dictionary, request_id: int) -> Dictionary:
	var ei := _get_ei()
	if ei == null: return {"error": {"code": -32000, "message": "EditorInterface not available"}}
	var root = ei.get_edited_scene_root()
	if not root:
		return {"error": {"code": -32003, "message": "No scene loaded"}}

	var node_type: String = params.get("node_type", "Node")
	var node_name: String = params.get("node_name", "NewNode")
	var parent_path: String = params.get("parent_node_path", "")

	# I-5: node_name 字符白名单(与 TS 端 addNode 的 ^[A-Za-z0-9_]+$ 对齐),防特殊字符/换行污染 .tscn 节点名属性。
	var _name_re := RegEx.create_from_string("^[A-Za-z0-9_]+$")
	if node_name.is_empty() or not _name_re.search(node_name):
		return {"error": {"code": -32004, "message": "Invalid node name: %s" % node_name}}

	if not _is_allowed_node_type(node_type):
		return {"error": {"code": -32004, "message": "Blocked node type: %s" % node_type}}

	var parent_node: Node = root
	if not parent_path.is_empty():
		# I-5: 复用 CommandHelpers.has_path_traversal(与 scene_commands/ui_commands 防御深度对齐)。
		# Godot get_node_or_null 受场景树结构限制无法逃出 root,但显式拒绝 .. 段与项目防御一致。
		if CommandHelpers.has_path_traversal(parent_path):
			return {"error": {"code": -32002, "message": "Invalid parent path (traversal): %s" % parent_path}}
		parent_node = root.get_node_or_null(parent_path)  # IMP-1: null-safe; get_node() pushes error on missing path
		if not parent_node:
			return {"error": {"code": -32002, "message": "Parent not found: %s" % parent_path}}

	var cls = ClassDB.instantiate(node_type)
	if not cls:
		return {"error": {"code": -32000, "message": "Cannot instantiate: %s" % node_type}}
	cls.name = node_name

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Add Node %s (req:%d)" % [node_name, request_id],
			[
				{"type": "method", "target": parent_node, "method": "add_child", "args": [cls]},
				{"type": "method", "target": cls, "method": "set_owner", "args": [root]},
				{"type": "reference", "value": cls}
			],
			[
				{"type": "method", "target": parent_node, "method": "remove_child", "args": [cls]}
			]
		)
	else:
		parent_node.add_child(cls)
		cls.owner = root
	return {"result": {"node_path": str(cls.get_path()), "status": "created"}}


# editor 内存删除节点（UndoRedo，do=remove_child / undo=add_child+set_owner+reference）。
# 不 queue_free —— reference 让 UndoRedo 管理生命周期，undo 可恢复。
# 与 add_node 对称：scene 工具 remove_node 经 editor-method-map 走此处（不再 -32601 回退 headless 文件操作）。
func handle_remove_node(params: Dictionary, request_id: int) -> Dictionary:
	var ei := _get_ei()
	if ei == null:
		return {"error": {"code": -32000, "message": "EditorInterface not available"}}
	var root = ei.get_edited_scene_root()
	if not root:
		return {"error": {"code": -32003, "message": "No scene loaded"}}

	var node_path: String = params.get("node_path", "")
	if node_path.is_empty():
		return {"error": {"code": -32004, "message": "node_path is required"}}
	if CommandHelpers.has_path_traversal(node_path):
		return {"error": {"code": -32002, "message": "Invalid node path (traversal): %s" % node_path}}

	# 健壮：get_node_or_null 从 root 起解析相对路径。兼容用户传完整场景路径
	# ("GameplayIsland/Props/Tree") 或相对根路径 ("Props/Tree")，strip 根名前缀。
	var root_name := str(root.name)
	if node_path == root_name or node_path == "/root/" + root_name:
		return {"error": {"code": -32002, "message": "Cannot remove scene root: %s" % node_path}}
	if node_path.begins_with(root_name + "/"):
		node_path = node_path.substr(root_name.length() + 1)

	var target: Node = root.get_node_or_null(node_path)
	if not target:
		return {"error": {"code": -32002, "message": "Node not found: %s" % node_path}}
	var parent_node: Node = target.get_parent()
	if parent_node == null:
		return {"error": {"code": -32002, "message": "Node has no parent (orphan): %s" % node_path}}

	var owner_node: Node = target.owner
	var node_name: String = target.name
	var removed_path: String = str(target.get_path())

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Remove Node %s (req:%d)" % [node_name, request_id],
			[
				{"type": "method", "target": parent_node, "method": "remove_child", "args": [target]}
			],
			[
				{"type": "method", "target": parent_node, "method": "add_child", "args": [target]},
				{"type": "method", "target": target, "method": "set_owner", "args": [owner_node if owner_node else root]},
				{"type": "reference", "value": target}
			]
		)
	else:
		parent_node.remove_child(target)
	return {"result": {"node_path": removed_path, "name": node_name, "status": "removed"}}


# editor 内存改节点属性（UndoRedo per-property undo：do=set new / undo=set old）。
# editor-method-map 登记 edit_node 后，editor 连接时 scene 工具 edit_node 路由到此处（不再 spawnGodot 改盘）。
# properties coerce 失败累计进返回值（非阻塞，对齐 headless edit_node）。节点找不到返 -32002。
# old_val 预读：node.get(key)；只读 property 预读 null 时 undo 会 set(key,null)——务实接受（name/class 等
# 只读多在 BLOCKED_PROPERTIES 已拒），未来加 PROPERTY_USAGE_READ_ONLY 检查记 follow-up。
func handle_edit_node(params: Dictionary, request_id: int) -> Dictionary:
	var ei := _get_ei()
	if ei == null:
		return {"error": {"code": -32000, "message": "EditorInterface not available"}}
	var root = ei.get_edited_scene_root()
	if not root:
		return {"error": {"code": -32003, "message": "No scene loaded"}}
	var node_path: String = params.get("node_path", "")
	if node_path.is_empty():
		return {"error": {"code": -32004, "message": "node_path is required"}}
	if CommandHelpers.has_path_traversal(node_path):
		return {"error": {"code": -32002, "message": "Invalid node path (traversal): %s" % node_path}}
	var node: Node = CommandHelpers.find_node(root, node_path)
	if not node:
		return {"error": {"code": -32002, "message": "Node not found: %s" % node_path}}
	var properties: Dictionary = params.get("properties", {})
	if properties.is_empty():
		return {"error": {"code": -32004, "message": "properties is required (non-empty)"}}

	var do_ops: Array = []
	var undo_ops: Array = []
	var failed: Array = []
	for key in properties:
		var r := CommandHelpers.coerce_property_value(node, String(key), properties[key])
		if not r["ok"]:
			failed.append({"key": String(key), "error": String(r["error"])})
			continue
		var coerced: Variant = r["value"]
		var old_val: Variant = node.get(String(key))
		# op 显式 type:"method"（对齐 handle_add_node:66），method:"set" 经 undo_manager.gd:55 callv spread
		do_ops.append({"type": "method", "target": node, "method": "set", "args": [String(key), coerced]})
		undo_ops.append({"type": "method", "target": node, "method": "set", "args": [String(key), old_val]})

	if do_ops.is_empty():
		# 全 property coerce 失败：不注册 undo，返失败列表
		return {"result": {"node_path": str(node.get_path()), "updated": 0, "failed": failed}}

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Edit Node %s (req:%d)" % [str(node.get_path()), request_id], do_ops, undo_ops)
	else:
		for op in do_ops:
			op["target"].set(op["args"][0], op["args"][1])
	return {"result": {"node_path": str(node.get_path()), "updated": do_ops.size(), "failed": failed}}


func _is_allowed_node_type(node_type: String) -> bool:
	# I-4: 严格白名单——仅允许 ALLOWED_NODE_TYPES 精确匹配,不再用 is_parent_class 兜底。
	# 原兜底放行任意 Node 子类(含第三方 addon 的 class_name 脚本),实例化时触发其 _ready()/_init()
	# 执行任意 GDScript。需自定义类型请改用 execute_gdscript 或编辑器手动操作。
	return node_type in ALLOWED_NODE_TYPES
