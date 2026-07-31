#!/usr/bin/env -S godot --headless --script
extends SceneTree

var debug_mode = false

# ── Inline safe-value check (mirrors safe_values.gd, used when running outside project context) ──
# C-03: Keep in sync with src/scripts/safe_values.gd — that is the canonical source.
const _SAFE_MAX_DEPTH := 10

func _is_safe_value(val: Variant, depth: int = 0) -> bool:
	if depth > _SAFE_MAX_DEPTH:
		return false
	if val == null:
		return true
	if val is bool or val is int or val is float or val is String or val is StringName:
		return true
	if val is Vector2 or val is Vector2i or val is Vector3 or val is Vector3i:
		return true
	if val is Color or val is Rect2 or val is Rect2i:
		return true
	if val is Transform2D or val is Transform3D or val is Basis or val is Quaternion:
		return true
	if val is Plane or val is AABB:
		return true
	if val is PackedByteArray or val is PackedInt32Array or val is PackedInt64Array:
		return true
	if val is PackedFloat32Array or val is PackedFloat64Array or val is PackedStringArray:
		return true
	if val is PackedVector2Array or val is PackedVector3Array or val is PackedColorArray:
		return true
	if val is Array:
		for item in val:
			if not _is_safe_value(item, depth + 1):
				return false
		return true
	if val is Dictionary:
		for key in val:
			if not _is_safe_value(key, depth + 1):
				return false
			if not _is_safe_value(val[key], depth + 1):
				return false
		return true
	return false

# ── 资源属性类型识别 helper（Spec A §1）────────────────────────────────────
# JSON 无法表达 Resource 实例，res:// String 路径 → sanitize + load 成 Resource 再 set；
# 类型不匹配报错非静默（解决 batch silently fail）。
# 仅覆盖 TYPE_OBJECT + res://（NodePath / Array 数学类型留 follow-up，不退化现状）。
func _get_property_type(obj: Object, key: String) -> int:
	for p in obj.get_property_list():
		if String(p.get("name", "")) == key:
			return int(p.get("type", TYPE_NIL))
	return -1

func _set_property_with_coerce(node: Node, key: String, value: Variant) -> bool:
	# 双保险：instance 即使漏加 _BLOCKED_PROPERTIES 也拒
	# I-2: instance 可注入 ExtResource 实例化恶意场景 _ready，与 script 同级危险
	if key == "instance":
		log_error("Blocked 'instance' property (I-2 security)")
		return false
	var prop_type := _get_property_type(node, key)
	if prop_type == -1:
		log_error("Property not found: %s on %s" % [key, node.get_class()])
		return false
	var coerced: Variant = value
	if prop_type == TYPE_OBJECT:
		if value is String and value.begins_with("res://"):
			coerced = load(_sanitize_res_path(value))
			if coerced == null:
				log_error("Failed to load resource for %s: %s" % [key, value])
				return false
		elif value is String:
			# Resource 属性传非 res:// String → 报错非静默（解决 batch silently fail）
			log_error("Property %s expects Resource, got plain String '%s' (use res:// path)" % [key, value])
			return false
	node.set(key, coerced)
	return true

func _init():
	var args = OS.get_cmdline_args()
	debug_mode = "--debug-godot" in args

	var script_index = args.find("--script")
	if script_index == -1:
		log_error("Could not find --script argument")
		quit(1)
		return
	var operation_index = script_index + 2
	var params_index = script_index + 3

	if args.size() <= params_index:
		log_error("Usage: godot --headless --script godot_operations.gd <operation> <json_params>")
		quit(1)
		return
	log_debug("All arguments: " + str(args))
	var operation = args[operation_index]
	var params_json = args[params_index]

	log_info("Operation: " + operation)
	log_debug("Params JSON: " + params_json)

	var json = JSON.new()
	var error = json.parse(params_json)
	var params = null

	if error == OK:
		params = json.get_data()
	else:
		log_error("Failed to parse JSON parameters: " + params_json)
		log_error("JSON Error: " + json.get_error_message() + " at line " + str(json.get_error_line()))
		quit(1)
		return
	if not params:
		log_error("Failed to parse JSON parameters: " + params_json)
		quit(1)
		return
	log_info("Executing operation: " + operation)

	# B7: 进程启动清 res:// 残留 *.tmp.{tres,tscn,res}(超时 kill 落在 save 中途的半截文件)
	_clean_atomic_tmp()

	match operation:
		"create_scene":
			create_scene(params)
		"add_node":
			add_node(params)
		"edit_node":
			edit_node(params)
		"batch_add_nodes":
			batch_add_nodes(params)
		"load_sprite":
			load_sprite(params)
		"export_mesh_library":
			export_mesh_library(params)
		"save_scene":
			save_scene(params)
		"get_uid":
			get_uid(params)
		"resave_resources":
			resave_resources(params)
		_:
			log_error("Unknown operation: " + operation)
			cleanup_and_quit([], 1)

	call_deferred("quit")
	return
# ─── Logging helpers ──────────────────────────────────────────────────────────

func log_debug(message: String) -> void:
	if debug_mode:
		print("[DEBUG] " + message)

func log_info(message: String) -> void:
	print("[INFO] " + message)

func log_error(message: String) -> void:
	printerr("[ERROR] " + message)

func cleanup_and_quit(nodes: Array, exit_code: int = 0) -> void:
	for node in nodes:
		if is_instance_valid(node):
			node.free()
	quit(exit_code)
	return

# ─── Class helpers ────────────────────────────────────────────────────────────

func get_script_by_name(name_of_class: String):
	if ResourceLoader.exists(name_of_class, "Script"):
		var script = load(name_of_class) as Script
		if script:
			return script
		log_error("Failed to load script from path: " + name_of_class)
		return null

	var global_classes = ProjectSettings.get_global_class_list()
	for global_class in global_classes:
		if global_class["class"] == name_of_class:
			var script = load(global_class["path"]) as Script
			if script:
				return script
			log_error("Failed to load script from registry path: " + global_class["path"])
			return null

	log_error("Could not find script for class: " + name_of_class)
	return null

# headless instantiate_class 类型白名单(合并 node_commands ALLOWED_NODE_TYPES +
# ui_commands ALLOWED_CONTROL_TYPES + 裸 Control, 移除裸 Node)。
# 对齐 editor node_commands.gd ALLOWED_NODE_TYPES + ui_commands.gd ALLOWED_CONTROL_TYPES
# 纯白名单精神(I-4 / IMPORTANT-14)。移除 "Node" 堵 extends Node 恶意脚本 _ready RCE:
# Node 自身是 Node 的父类 → is_parent_class("Node","Node")=true → base_type="Node" 通过
# → script.new() 触发 _ready OS.execute RCE(不经 execute_gdscript 沙箱)。
# 须与 addons/.../commands/node_commands.gd + ui_commands.gd 三处白名单同步(defects detect 守护)。
const ALLOWED_HEADLESS_TYPES: Array = [
	"Node3D", "MeshInstance3D", "StaticBody3D", "RigidBody3D",
	"CharacterBody3D", "Camera3D", "Light3D", "DirectionalLight3D",
	"OmniLight3D", "SpotLight3D", "CollisionShape3D", "RayCast3D",
	"Area3D", "Marker3D", "PathFollow3D", "VisibleOnScreenNotifier3D",
	"Node2D", "Sprite2D", "AnimatedSprite2D",
	"CollisionShape2D", "Area2D", "RigidBody2D", "CharacterBody2D",
	"AudioStreamPlayer", "AudioStreamPlayer2D", "AudioStreamPlayer3D",
	"AnimationPlayer", "AnimationTree", "Timer",
	"Control",
	"Button", "Label", "Panel", "LineEdit", "TextEdit", "RichTextLabel",
	"LinkButton", "HSlider", "VSlider", "CheckBox", "CheckButton",
	"OptionButton", "SpinBox", "ProgressBar", "TextureRect", "ColorPickerButton",
	"TabContainer", "Tree", "ItemList", "MarginContainer", "HBoxContainer",
	"VBoxContainer", "GridContainer", "CenterContainer", "ScrollContainer",
	"PanelContainer", "HSplitContainer", "VSplitContainer", "NinePatchRect",
]

func _is_headless_allowed(type_name: String) -> bool:
	return type_name in ALLOWED_HEADLESS_TYPES

func instantiate_class(name_of_class: String):
	if name_of_class.is_empty():
		log_error("Cannot instantiate class: name is empty")
		return null

	# I-S3: 深层纵深——即便白名单,仍阻危险引擎类前缀(白名单已不含,此为防御网)。
	var blocked_prefixes := ["File", "Thread", "Mutex", "Semaphore", "OS", "IP", "StreamPeer", "TCP", "UDP", "HTTP", "TLS", "Crypto", "Hash", "RegEx", "XML", "JSONParser", "ResourceLoader", "ResourceSaver", "PackedData", "TranslationServer", "PhysicsServer", "RenderingServer", "AudioServer", "NavigationServer", "DisplayServer"]
	for prefix in blocked_prefixes:
		if name_of_class.begins_with(prefix):
			log_error(String("Class %s is blocked for security reasons") % name_of_class)
			return null
	if ClassDB.class_exists(name_of_class):
		# P1 RCE 修复(对齐 editor I-4 / IMPORTANT-14):纯白名单 ∈ 检查,不再用
		# is_parent_class("Node") 兜底。is_parent_class("Node","Node")=true →
		# extends Node 恶意类绕过 → instantiate 跑 _ready RCE。白名单移除裸 Node,
		# 仅允许具体可实例化类型 + Node2D/Node3D/Control 基础类。
		if not _is_headless_allowed(name_of_class):
			log_error(String("Refused: %s is not in the headless allowed types whitelist") % name_of_class)
			return null
		if not ClassDB.can_instantiate(name_of_class):
			log_error("Class exists but cannot be instantiated: " + name_of_class)
			return null
		var result = ClassDB.instantiate(name_of_class)
		if result == null:
			log_error("ClassDB.instantiate() returned null for class: " + name_of_class)
		return result

	var script = get_script_by_name(name_of_class)
	if script is GDScript:
		# P1 RCE 修复:script 分支同样用白名单——检查脚本 extends 的 base_type ∈ 白名单。
		# extends Node2D 合法自定义脚本 base_type="Node2D" ∈ 允许;
		# extends Node 恶意脚本 base_type="Node" ∉ 允许(白名单移除裸 Node)→ 拒绝, 堵 _ready RCE。
		var base_type: String = script.get_instance_base_type()
		if base_type.is_empty() or not _is_headless_allowed(base_type):
			log_error(String("Refused: script class %s base type %s not in headless whitelist") % [name_of_class, base_type])
			return null
		return script.new()

	log_error("Failed to get script for class: " + name_of_class)
	return null

# ─── Scene operations ─────────────────────────────────────────────────────────

func create_scene(params):
	log_info("Creating scene: " + params.scene_path)

	var full_scene_path = _sanitize_res_path(params.scene_path)

	var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)
	var scene_dir_res = full_scene_path.get_base_dir()
	var scene_dir_abs = absolute_scene_path.get_base_dir()

	log_debug("Scene path: " + full_scene_path)
	log_debug("Absolute path: " + absolute_scene_path)

	var root_node_type = "Node2D"
	if params.has("root_node_type"):
		root_node_type = params.root_node_type

	var scene_root = instantiate_class(root_node_type)
	if not scene_root:
		log_error("Failed to instantiate node of type: " + root_node_type)
		quit(1)
		return

	# C-03: apply root_node_name after successful instantiation (was dead code after return)
	if params.has("root_node_name") and params.root_node_name != "":
		scene_root.name = params.root_node_name
	else:
		scene_root.name = "root"

	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)

	if result != OK:
		log_error("Failed to pack scene: " + str(result))
		cleanup_and_quit([scene_root], 1)
		return

	# Ensure directory exists
	var scene_dir_relative = scene_dir_res.substr(6)
	if not scene_dir_relative.is_empty():
		var dir = DirAccess.open("res://")
		if dir == null:
			var make_dir_error = DirAccess.make_dir_recursive_absolute(scene_dir_abs)
			if make_dir_error != OK:
				log_error("Failed to create directory: " + scene_dir_abs)
				cleanup_and_quit([scene_root], 1)
				return
		else:
			if not dir.dir_exists(scene_dir_relative):
				var make_dir_error = dir.make_dir_recursive(scene_dir_relative)
				if make_dir_error != OK:
					log_error("Failed to create directory: " + scene_dir_relative + ", error: " + str(make_dir_error))
					cleanup_and_quit([scene_root], 1)
					return

	var save_error = _save_atomic(packed_scene, full_scene_path)
	scene_root.free()
	if save_error == OK:
		print("Scene created successfully at: " + params.scene_path)
	else:
		log_error("Failed to save scene. Error: " + str(save_error))
		quit(1)
		return
func add_node(params):
	log_info("Adding node to scene: " + params.scene_path)

	var full_scene_path = _sanitize_res_path(params.scene_path)

	var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)

	if not FileAccess.file_exists(absolute_scene_path):
		log_error("Scene file does not exist: " + absolute_scene_path)
		quit(1)
		return
	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()

	var parent_path = "root"
	if params.has("parent_node_path"):
		parent_path = params.parent_node_path

	var parent = scene_root
	if parent_path == "root" or parent_path == scene_root.name:
		parent = scene_root
	elif parent_path.begins_with("root/"):
		parent = scene_root.get_node_or_null(parent_path.substr(5))
		if not parent:
			log_error("Parent node not found: " + parent_path)
			cleanup_and_quit([scene_root], 1)
			return
	else:
		parent = scene_root.get_node_or_null(parent_path)
		if not parent:
			log_error("Parent node not found: " + parent_path)
			cleanup_and_quit([scene_root], 1)
			return

	var new_node = instantiate_class(params.node_type)
	if not new_node:
		log_error("Failed to instantiate node of type: " + params.node_type)
		cleanup_and_quit([scene_root], 1)
		return
	new_node.name = params.node_name

	if params.has("properties"):
		var properties = params.properties
		for property in properties:
			if _is_safe_property(property):
				if not _set_property_with_coerce(new_node, property, properties[property]):
					log_error("Failed to set property %s on new node" % property)

	parent.add_child(new_node)
	new_node.owner = scene_root

	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)

	if result == OK:
		var save_error = _save_atomic(packed_scene, absolute_scene_path)
		if save_error == OK:
			print("Node '%s' of type '%s' added successfully" % [params.node_name, params.node_type])
		else:
			log_error("Failed to save scene: " + str(save_error))
	else:
		log_error("Failed to pack scene: " + str(result))
	scene_root.free()


func edit_node(params):
	log_info("Editing node in scene: " + params.scene_path)
	var full_scene_path = _sanitize_res_path(params.scene_path)
	var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)
	if not FileAccess.file_exists(absolute_scene_path):
		log_error("Scene file does not exist: " + absolute_scene_path)
		quit(1)
		return
	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()
	# node_path 规范化：TS 侧 normalizeNodePath 传 "/root/Root/X" 格式，
	# scene_root 是 instantiate 出来的 PackedScene 根，未挂 SceneTree，绝对路径找不到。
	# 复用 add_node parent_path 规范化逻辑：剥 "/root/" / "root/" 前缀，转相对路径。
	var node_path = params.node_path
	if node_path.begins_with("/root/"):
		node_path = node_path.substr(6)
	elif node_path.begins_with("root/"):
		node_path = node_path.substr(5)
	elif node_path.begins_with("/"):
		node_path = node_path.substr(1)
	var node = scene_root.get_node_or_null(node_path)
	if node == null:
		log_error("Node not found: " + params.node_path)
		cleanup_and_quit([scene_root], 1)
		return
	var failed = 0
	if params.has("properties"):
		for key in params.properties:
			if not _is_safe_property(key):
				log_error("Blocked property: " + key)
				failed += 1
				continue
			if not _set_property_with_coerce(node, key, params.properties[key]):
				failed += 1
	# 持久化：复用 add_node pack+save 尾段，不复用 owner 赋值
	# (add_node new_node.owner=scene_root 是给新节点设归属；edit_node 改已存在节点，
	#  照搬会把 owner 非本场景的节点如 instance 子节点错误提升、被 pack 进主场景)
	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)
	if result == OK:
		var save_error = _save_atomic(packed_scene, absolute_scene_path)
		if save_error == OK:
			print("Node '%s' edited successfully" % params.node_path)
		else:
			log_error("Failed to save scene: " + str(save_error))
			scene_root.free()
			quit(1)
			return
	else:
		log_error("Failed to pack scene: " + str(result))
		scene_root.free()
		quit(1)
		return
	scene_root.free()
	if failed > 0:
		quit(1)


func batch_add_nodes(params):
	log_info("Batch adding nodes to scene: " + params.scene_path)

	var full_scene_path = _sanitize_res_path(params.scene_path)

	var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)

	if not FileAccess.file_exists(absolute_scene_path):
		log_error("Scene file does not exist: " + absolute_scene_path)
		quit(1)
		return
	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()
	var nodes = params.nodes
	var added_count = 0
	var failed_count = 0

	for node_def in nodes:
		var parent_path = "root"
		if node_def.has("parent_node_path"):
			parent_path = node_def.parent_node_path

		var parent = scene_root
		if parent_path == "root" or parent_path == scene_root.name:
			parent = scene_root
		elif parent_path.begins_with("root/"):
			parent = scene_root.get_node_or_null(parent_path.substr(5))
			if not parent:
				log_error("Parent node not found: " + parent_path + " for node: " + node_def.node_name)
				failed_count += 1
				continue
		else:
			parent = scene_root.get_node_or_null(parent_path)
			if not parent:
				log_error("Parent node not found: " + parent_path + " for node: " + node_def.node_name)
				failed_count += 1
				continue

		var new_node = instantiate_class(node_def.node_type)
		if not new_node:
			log_error("Failed to instantiate: " + node_def.node_type)
			failed_count += 1
			continue

		new_node.name = node_def.node_name

		if node_def.has("properties"):
			var properties = node_def.properties
			for property in properties:
				if _is_safe_property(property):
					if not _set_property_with_coerce(new_node, property, properties[property]):
						log_error("Failed to set property %s on %s" % [property, node_def.node_name])

		parent.add_child(new_node)
		new_node.owner = scene_root
		added_count += 1

	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)

	if result == OK:
		var save_error = _save_atomic(packed_scene, absolute_scene_path)
		if save_error == OK:
			print("Batch add completed: %d/%d nodes added to %s" % [added_count, nodes.size(), params.scene_path])
			if failed_count > 0:
				log_error("Failed to add %d nodes" % failed_count)
				for node_def in nodes:
					log_debug("  - node: %s (%s) parent: %s" % [node_def.get("node_name", "?"), node_def.get("node_type", "?"), node_def.get("parent_node_path", "root")])
				# 修真静默：failed_count>0 时 quit(1)，TS scene/index.ts:329 exitCode!=0 才抓得到
				scene_root.free()
				quit(1)
				return
		else:
			log_error("Failed to save scene: " + str(save_error))
	else:
		log_error("Failed to pack scene: " + str(result))
	scene_root.free()


func load_sprite(params):
	log_info("Loading sprite into scene: " + params.scene_path)

	var full_scene_path = _sanitize_res_path(params.scene_path)

	if not FileAccess.file_exists(full_scene_path):
		log_error("Scene file does not exist: " + full_scene_path)
		quit(1)
		return
	var full_texture_path = _sanitize_res_path(params.texture_path)

	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()

	var node_path = params.node_path
	if node_path.begins_with("root/"):
		node_path = node_path.substr(5)

	var sprite_node = null
	if node_path == "":
		sprite_node = scene_root
	else:
		sprite_node = scene_root.get_node_or_null(node_path)

	if not sprite_node:
		log_error("Node not found: " + params.node_path)
		cleanup_and_quit([scene_root], 1)
		return

	if not (sprite_node is Sprite2D or sprite_node is Sprite3D or sprite_node is TextureRect):
		log_error("Node is not a sprite-compatible type: " + sprite_node.get_class())
		cleanup_and_quit([scene_root], 1)
		return

	var texture = load(full_texture_path)
	if not texture:
		if not FileAccess.file_exists(full_texture_path):
			log_error("Texture file not found: " + full_texture_path)
		else:
			log_error("Failed to load texture: " + full_texture_path)
			log_error("Headless mode cannot import textures. Run the editor first to generate .import cache.")
		cleanup_and_quit([scene_root], 1)
		return

	if sprite_node is Sprite2D or sprite_node is Sprite3D:
		sprite_node.texture = texture
	elif sprite_node is TextureRect:
		sprite_node.texture = texture

	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)

	if result == OK:
		var error = _save_atomic(packed_scene, full_scene_path)
		if error == OK:
			print("Sprite loaded successfully with texture: " + full_texture_path)
		else:
			log_error("Failed to save scene: " + str(error))
	else:
		log_error("Failed to pack scene: " + str(result))
	scene_root.free()


func export_mesh_library(params):
	log_info("Exporting MeshLibrary from scene: " + params.scene_path)

	var full_scene_path = _sanitize_res_path(params.scene_path)

	var full_output_path = _sanitize_res_path(params.output_path)

	if not FileAccess.file_exists(full_scene_path):
		log_error("Scene file does not exist: " + full_scene_path)
		quit(1)
		return
	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()
	var mesh_library = MeshLibrary.new()

	var mesh_item_names = params.mesh_item_names if params.has("mesh_item_names") else []
	var use_specific_items = mesh_item_names.size() > 0
	var item_id = 0

	for child in scene_root.get_children():
		if use_specific_items and not (child.name in mesh_item_names):
			continue

		var mesh_instance = null
		if child is MeshInstance3D:
			mesh_instance = child
		else:
			for descendant in child.get_children():
				if descendant is MeshInstance3D:
					mesh_instance = descendant
					break

		if mesh_instance and mesh_instance.mesh:
			mesh_library.create_item(item_id)
			mesh_library.set_item_name(item_id, child.name)
			mesh_library.set_item_mesh(item_id, mesh_instance.mesh)

			for collision_child in child.get_children():
				if collision_child is CollisionShape3D and collision_child.shape:
					mesh_library.set_item_shapes(item_id, [collision_child.shape])
					break

			if mesh_instance.mesh:
				mesh_library.set_item_preview(item_id, mesh_instance.mesh)

			item_id += 1

	# Create directory if needed
	var dir = DirAccess.open("res://")
	if dir == null:
		log_error("Failed to open res:// directory")
		cleanup_and_quit([scene_root], 1)
		return

	var output_dir = full_output_path.get_base_dir()
	if output_dir != "res://" and not dir.dir_exists(output_dir.substr(6)):
		var error = dir.make_dir_recursive(output_dir.substr(6))
		if error != OK:
			log_error("Failed to create directory: " + output_dir + ", error: " + str(error))
			cleanup_and_quit([scene_root], 1)
			return

	if item_id > 0:
		var error = _save_atomic(mesh_library, full_output_path)
		if error == OK:
			print("MeshLibrary exported successfully with %d items to: %s" % [item_id, full_output_path])
		else:
			log_error("Failed to save MeshLibrary: " + str(error))
	else:
		log_error("No valid meshes found in the scene")
	scene_root.free()


func save_scene(params):
	log_info("Saving scene: " + params.scene_path)

	var full_scene_path = _sanitize_res_path(params.scene_path)

	if not FileAccess.file_exists(full_scene_path):
		log_error("Scene file does not exist: " + full_scene_path)
		quit(1)
		return
	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()

	var save_path = _sanitize_res_path(params.new_path) if params.has("new_path") else full_scene_path

	# Create directory if needed
	if params.has("new_path"):
		var dir = DirAccess.open("res://")
		if dir == null:
			log_error("Failed to open res:// directory")
			cleanup_and_quit([scene_root], 1)
			return

		var scene_dir = save_path.get_base_dir()
		if scene_dir != "res://" and not dir.dir_exists(scene_dir.substr(6)):
			var error = dir.make_dir_recursive(scene_dir.substr(6))
			if error != OK:
				log_error("Failed to create directory: " + scene_dir + ", error: " + str(error))
				cleanup_and_quit([scene_root], 1)
				return

	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)

	if result == OK:
		var error = _save_atomic(packed_scene, save_path)
		if error == OK:
			print("Scene saved successfully to: " + save_path)
		else:
			log_error("Failed to save scene: " + str(error))
	else:
		log_error("Failed to pack scene: " + str(result))
	scene_root.free()



# ─── Security helpers ───────────────────────────────────────────────────────

const BLOCKED_PROPERTIES := [
	"script", "owner", "process_mode", "process_priority", "process_input",
	"process_unhandled_input", "process_unhandled_key_input", "process_internal",
	"physics_process_mode", "physics_interpolation_mode", "name", "meta",
	"input_event", "ready", "tree_entered", "tree_exited", "tree_exiting",
	"instance",  # I-2: instance 可注入 ExtResource 实例化恶意场景 _ready，与 script 同级危险
]

func _is_safe_property(prop_name: String) -> bool:
	if prop_name.begins_with("_"):
		return false
	if prop_name in BLOCKED_PROPERTIES:
		return false
	if "." in prop_name and prop_name.split(".")[0] in BLOCKED_PROPERTIES:
		return false
	return true





func _sanitize_res_path(path: String) -> String:
	# Null byte check
	if path.find(char(0)) != -1:
		return "res://"
	# Normalize backslashes to forward slashes
	var normalized_path = path.replace("\\", "/")
	# Percent-decode (handles %2e%2e → ..)
	# I-08: wrap uri_decode to handle invalid URI encodings gracefully
	var decoded: String = normalized_path
	if normalized_path.find("%") != -1:
		var test: String = normalized_path.uri_decode()
		if test != null:
			decoded = test
	normalized_path = decoded
	# Ensure res:// prefix
	var full = normalized_path if normalized_path.begins_with("res://") else "res://" + normalized_path
	var parts = full.substr(6).split("/")
	var result_parts = []
	for part in parts:
		# Explicitly reject traversal segments
		if part == ".." or part == ".":
			continue
		if not part.is_empty():
			result_parts.append(part)
	return "res://" + "/".join(result_parts)

# ─── File helpers ─────────────────────────────────────────────────────────────

func find_files(path: String, extension: String, depth: int = 0) -> Array:
	var files = []
	if depth > 10:
		return files
	var dir = DirAccess.open(path)

	if dir:
		dir.list_dir_begin()
		var file_name = dir.get_next()

		while file_name != "":
			if dir.current_is_dir() and not file_name.begins_with("."):
				files.append_array(find_files(path + file_name + "/", extension, depth + 1))
			elif file_name.ends_with(extension):
				files.append(path + file_name)
			file_name = dir.get_next()

	return files


func get_uid(params):
	if not params.has("file_path"):
		log_error("File path is required")
		quit(1)
		return
	var file_path = _sanitize_res_path(params.file_path)

	log_info("Getting UID for file: " + file_path)

	var absolute_path = ProjectSettings.globalize_path(file_path)

	if not FileAccess.file_exists(file_path):
		log_error("File does not exist: " + file_path)
		quit(1)
		return
	var uid_path = file_path + ".uid"
	var f = FileAccess.open(uid_path, FileAccess.READ)

	if f:
		var uid_content = f.get_as_text()
		f.close()
		var result = {
			"file": file_path,
			"absolutePath": absolute_path,
			"uid": uid_content.strip_edges(),
			"exists": true
		}
		print(JSON.stringify(result))
	else:
		var result = {
			"file": file_path,
			"absolutePath": absolute_path,
			"exists": false,
			"message": "UID file does not exist for this file. Use resave_resources to generate UIDs."
		}
		print(JSON.stringify(result))


func resave_resources(params):
	log_info("Resaving all resources to update UID references...")

	var project_path = "res://"
	if params.has("project_path"):
		project_path = _sanitize_res_path(params.project_path)
		if not project_path.ends_with("/"):
			project_path += "/"

	var scenes = find_files(project_path, ".tscn")
	var success_count = 0
	var error_count = 0

	for scene_path in scenes:
		var scene = load(scene_path)
		if scene:
			var error = _save_atomic(scene, scene_path)
			if error == OK:
				success_count += 1
			else:
				error_count += 1
				log_error("Failed to save: " + scene_path + ", error: " + str(error))
		else:
			error_count += 1
			log_error("Failed to load: " + scene_path)

	# Process scripts/shaders
	var scripts = find_files(project_path, ".gd") + find_files(project_path, ".shader") + find_files(project_path, ".gdshader")
	var missing_uids = 0
	var generated_uids = 0

	for script_path in scripts:
		var uid_path = script_path + ".uid"
		var f = FileAccess.open(uid_path, FileAccess.READ)
		if not f:
			missing_uids += 1
			var res = load(script_path)
			if res:
				# B7 例外: 此处 resave 旨在触发 .uid 边车生成(须在原路径 script_path),
				# 原子化(_save_atomic 写 .tmp.<ext>)会令 .uid 边车落到 tmp 路径→rename 后孤儿→目的失败。
				# 脚本/shader resave 快,半截损坏下次 load 即暴露; .uid 语义优先, 不原子化。
				var error = ResourceSaver.save(res, script_path)
				if error == OK:
					generated_uids += 1
				else:
					log_error("Failed to generate UID for: " + script_path)
			else:
				log_error("Failed to load resource: " + script_path)

	print("Resave complete: %d scenes saved, %d errors, %d UIDs generated" % [success_count, error_count, generated_uids])

# B7: 原子化资源写——tmp+rename 防超时 kill 落在 save 中途产半截损坏 .tres/.tscn 阻塞项目加载。
# tmp 必须以目标扩展名结尾(ResourceSaver 按扩展名分派 saver, 裸 .tmp 返回 err 15)。
# 对齐 data-import.ts:188 已验证范例 + memory resourcesaver-extension-dispatch。
func _save_atomic(res, full_path: String) -> int:
	var ext := full_path.get_extension()  # tres/res/tscn/gd/shader/gdshader
	var tmp := full_path + ".tmp." + ext
	# B7: 写前清同路径旧 tmp(防上次同路径 crash 残留阻塞本次 save)
	if FileAccess.file_exists(tmp):
		DirAccess.remove_absolute(tmp)
	var save_err: int = ResourceSaver.save(res, tmp)
	if save_err != OK:
		DirAccess.remove_absolute(tmp)  # save 失败清半截 tmp
		return save_err
	var rename_err: int = DirAccess.rename_absolute(tmp, full_path)
	if rename_err != OK:
		DirAccess.remove_absolute(tmp)  # rename 失败清 tmp
		return rename_err
	return OK


# B7 启动清理: 扫 res:// 残留 *.tmp.{tres,tscn,res}(_save_atomic 超时 kill 半截产物)。
# 对齐 plan「★关键约束」+ data-import.ts:188 clean_dir 模式; 每进程早跑一次。
# .godot/ 导入缓存被 find_files 的 "." 前缀跳过排除。
func _clean_atomic_tmp() -> void:
	var removed := 0
	for ext in [".tmp.tres", ".tmp.tscn", ".tmp.res"]:
		var stale := find_files("res://", ext)
		for tmp_path in stale:
			if DirAccess.remove_absolute(tmp_path) == OK:
				removed += 1
			else:
				log_error("Failed to remove stale atomic tmp: " + tmp_path)
	if removed > 0:
		log_info("Cleaned %d stale atomic tmp file(s)" % removed)
