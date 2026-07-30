extends Node

var _plugin: EditorPlugin
var _undo_manager: Node

func setup(plugin: EditorPlugin, undo_manager: Node = null) -> void:
	_plugin = plugin
	_undo_manager = undo_manager


func cleanup() -> void:
	# 阶段5(:649): 统一 cleanup 接口(与 incomplete-cleanup-command-nodes fix 一致)。本模块无信号/定时器,释放引用助 GC。
	_plugin = null
	_undo_manager = null

func handle_animtree_create(params: Dictionary, request_id: int) -> Dictionary:
	var root = CommandHelpers.get_edited_scene_root(_plugin)
	if root == null:
		return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

	var node_name: String = params.get("name", "AnimationTree")
	var parent_path: String = params.get("parent", "")
	var parent_node: Node = CommandHelpers.find_node(root, parent_path) if parent_path != "" else root
	if parent_node == null:
		return {"error": {"code": -32002, "message": "Parent not found: " + parent_path}}

	var anim_player_path: String = params.get("animation_player_path", "")
	if anim_player_path == "":
		return {"error": {"code": -32004, "message": "animation_player_path is required"}}

	var tree_root_type: String = params.get("tree_root_type", "AnimationNodeStateMachine")

	var tree = AnimationTree.new()
	tree.name = node_name
	tree.anim_player = NodePath(anim_player_path)

	var root_node
	match tree_root_type:
		"AnimationNodeStateMachine":
			root_node = AnimationNodeStateMachine.new()
		"AnimationNodeBlendTree":
			root_node = AnimationNodeBlendTree.new()
		"AnimationNodeBlendSpace2D":
			root_node = AnimationNodeBlendSpace2D.new()
		_:
			root_node = AnimationNodeStateMachine.new()
			tree_root_type = "AnimationNodeStateMachine"

	tree.tree_root = root_node
	tree.active = true

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Create AnimationTree (req:%d)" % request_id,
			[
				{"type": "method", "target": parent_node, "method": "add_child", "args": [tree]},
				{"type": "method", "target": tree, "method": "set_owner", "args": [root]},
				{"type": "reference", "value": tree}
			],
			[
				{"type": "method", "target": parent_node, "method": "remove_child", "args": [tree]}
			]
		)
	else:
		parent_node.add_child(tree)
		tree.owner = root

	return {"result": {"node_path": str(tree.get_path()), "root_type": tree_root_type, "status": "created"}}

func handle_animtree_add_state(params: Dictionary) -> Dictionary:
	var root = CommandHelpers.get_edited_scene_root(_plugin)
	if root == null:
		return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

	var node_path: String = params.get("node_path", "")
	var tree = CommandHelpers.find_node(root, node_path)
	if tree == null:
		return {"error": {"code": -32002, "message": "AnimationTree not found: " + node_path}}
	if not (tree is AnimationTree):
		return {"error": {"code": -32004, "message": "Node is not an AnimationTree: " + node_path}}

	var sm: AnimationNodeStateMachine = tree.tree_root
	if sm == null or not (sm is AnimationNodeStateMachine):
		return {"error": {"code": -32004, "message": "Tree root is not an AnimationNodeStateMachine"}}

	var state_name: String = params.get("state_name", "")
	var animation: String = params.get("animation", "")
	if state_name == "" or animation == "":
		return {"error": {"code": -32004, "message": "state_name and animation are required"}}

	var anim_node = AnimationNodeAnimation.new()
	anim_node.animation = animation

	# C10: add_state 建 undo action（do=add_node / undo=remove_node），Ctrl+Z 撤销前撤 create。
	# position 一并入 add_node 第三参（API 默认 Vector2.ZERO，非 Dictionary 时用 ZERO）。
	# 注：anim_node 是 Resource（AnimationNode），由 sm 持有引用，不需要 reference op。
	var pos = params.get("position")
	var pos_vec: Vector2 = Vector2.ZERO
	if pos != null and pos is Dictionary:
		pos_vec = Vector2(float(pos.get("x", 0.0)), float(pos.get("y", 0.0)))

	if _undo_manager != null:
		_undo_manager.create_action_mixed("AnimTree Add State %s" % state_name,
			[{"type": "method", "target": sm, "method": "add_node", "args": [state_name, anim_node, pos_vec]}],
			[{"type": "method", "target": sm, "method": "remove_node", "args": [state_name]}])
	else:
		sm.add_node(state_name, anim_node, pos_vec)

	return {"result": {"state": state_name, "animation": animation, "status": "added"}}

func handle_animtree_add_transition(params: Dictionary) -> Dictionary:
	var root = CommandHelpers.get_edited_scene_root(_plugin)
	if root == null:
		return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

	var node_path: String = params.get("node_path", "")
	var tree = CommandHelpers.find_node(root, node_path)
	if tree == null:
		return {"error": {"code": -32002, "message": "AnimationTree not found: " + node_path}}
	if not (tree is AnimationTree):
		return {"error": {"code": -32004, "message": "Node is not an AnimationTree: " + node_path}}

	var sm: AnimationNodeStateMachine = tree.tree_root
	if sm == null or not (sm is AnimationNodeStateMachine):
		return {"error": {"code": -32004, "message": "Tree root is not an AnimationNodeStateMachine"}}

	var from_state: String = params.get("from_state", "")
	var to_state: String = params.get("to_state", "")
	if from_state == "" or to_state == "":
		return {"error": {"code": -32004, "message": "from_state and to_state are required"}}

	var transition = AnimationNodeStateMachineTransition.new()
	transition.xfade_time = float(params.get("xfade_time", 0.0))

	var conditions = params.get("conditions", [])
	if conditions != null and conditions is Array:
		for cond in conditions:
			# F5(2026-07-29 报告5): conditions 元素须为 Dictionary，否则 cond.get() SCRIPT ERROR 中断 transition。
			if not (cond is Dictionary):
				continue
			var cond_name: String = str(cond.get("name", ""))
			var cond_value = cond.get("value")
			if cond_name != "":
				transition.add_condition(cond_name, cond_value)

	# C10: add_transition 建 undo action（do=add_transition / undo=remove_transition by from/to）。
	# AnimationNodeStateMachine.remove_transition(StringName from, StringName to) 直接按状态名删。
	# transition 是 Resource，由 sm 持有引用，不需要 reference op。
	if _undo_manager != null:
		_undo_manager.create_action_mixed("AnimTree Add Transition %s->%s" % [from_state, to_state],
			[{"type": "method", "target": sm, "method": "add_transition", "args": [from_state, to_state, transition]}],
			[{"type": "method", "target": sm, "method": "remove_transition", "args": [from_state, to_state]}])
	else:
		sm.add_transition(from_state, to_state, transition)

	return {"result": {"from": from_state, "to": to_state, "xfade": transition.xfade_time, "status": "transition_added"}}

func handle_animtree_set_blend(params: Dictionary) -> Dictionary:
	var root = CommandHelpers.get_edited_scene_root(_plugin)
	if root == null:
		return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

	var node_path: String = params.get("node_path", "")
	var tree = CommandHelpers.find_node(root, node_path)
	if tree == null:
		return {"error": {"code": -32002, "message": "AnimationTree not found: " + node_path}}
	if not (tree is AnimationTree):
		return {"error": {"code": -32004, "message": "Node is not an AnimationTree: " + node_path}}

	var param_name: String = params.get("parameter_name", "")
	if param_name == "":
		return {"error": {"code": -32004, "message": "parameter_name is required"}}
	if not param_name.begins_with("parameters/"):
		return {"error": {"code": -32004, "message": "parameter_name must start with parameters/"}}

	var value = params.get("value")
	if value == null:
		return {"error": {"code": -32004, "message": "value is required"}}

	# C10: set_blend 建 undo action（do=set param=new / undo=set param=old）。
	# param_name 是 parameters/xxx 动态属性（非 PROPERTY_USAGE_READ_ONLY，null 旧值合法）。
	# 用 property op（add_do_property / add_undo_property）而非 method op，对齐 set_instance_property 模式。
	var new_val: Variant
	if value is Dictionary:
		new_val = Vector2(float(value.get("x", 0.0)), float(value.get("y", 0.0)))
	else:
		new_val = float(value)

	if _undo_manager != null:
		var old_val: Variant = tree.get(param_name)
		_undo_manager.create_action_mixed("AnimTree Set Blend %s" % param_name,
			[{"type": "property", "target": tree, "property": param_name, "value": new_val}],
			[{"type": "property", "target": tree, "property": param_name, "value": old_val}])
	else:
		tree.set(param_name, new_val)

	return {"result": {"parameter": param_name, "status": "blend_set"}}

func handle_animtree_play(params: Dictionary) -> Dictionary:
	var root = CommandHelpers.get_edited_scene_root(_plugin)
	if root == null:
		return {"error": {"code": -32003, "message": "No scene currently open in editor"}}

	var node_path: String = params.get("node_path", "")
	var tree = CommandHelpers.find_node(root, node_path)
	if tree == null:
		return {"error": {"code": -32002, "message": "AnimationTree not found: " + node_path}}
	if not (tree is AnimationTree):
		return {"error": {"code": -32004, "message": "Node is not an AnimationTree: " + node_path}}

	var state_name: String = params.get("state_name", "")
	if state_name == "":
		return {"error": {"code": -32004, "message": "state_name is required"}}

	var playback = tree.get("parameters/playback")
	if playback == null:
		return {"error": {"code": -32004, "message": "Playback not available. Ensure tree_root is AnimationNodeStateMachine."}}

	playback.travel(state_name)

	return {"result": {"state": state_name, "status": "playing"}}
