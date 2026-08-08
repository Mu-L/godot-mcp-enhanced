## MCP Undo/Redo Manager — EditorUndoRedoManager 包装
##
## AI 触发的 mutation 经此 wrapper 接入 Godot 编辑器的 undo 栈，
## 用户 Ctrl+Z 可逐步撤销 AI 操作（UX 信任保障）。
##
## 接入 undo 的 handler（8 个）：
## - node_commands.gd（add_node/remove_node/edit_node 等 6 处）
## - ui_commands.gd（create_control/set_layout/set_theme 等 14 处）
## - animation_commands.gd（7 处）
## - asset/asset_placer.gd（place_one/place_batch 等 7 处，经 asset_commands.gd 间接调用）
## - particle_commands.gd（5 处）
## - nav_commands.gd（5 处）
## - animtree_commands.gd（4 处）
## - scene_commands.gd（instance_scene/set_instance_property 2 处）
##
## 不接入 undo 的 handler（含理由）：
## - export_commands.gd：落盘文件不可逆，无 undo 语义
## - recording_commands.gd：editor 路由已移除(GD-R10,原 editor 路径被禁用强制走 Bridge),与 editor-only UndoRedoManager 矛盾
## - sync_commands.gd：纯观察者（connect/disconnect 信号 + 只读序列化），无场景树 mutation
## - test_commands.gd：测试命令不产生场景 mutation（仅注入 undo_manager 到测试上下文）
## - scene_commands.gd open/save：场景级 open/save 不应被 Ctrl+Z 跨场景切换
##
extends Node

var _plugin: EditorPlugin

func setup(plugin: EditorPlugin) -> void:
	_plugin = plugin


## 创建混合 action（methods + properties + references）
## do_ops/undo_ops 中每个元素是 Dictionary，格式:
## {"type": "method", "target": Object, "method": String, "args": Array}
## {"type": "property", "target": Object, "property": String, "value": Variant}
## {"type": "reference", "value": Node}  # Issue 1: add_do_reference 仅限 Node
func create_action_mixed(action_name: String, do_ops: Array, undo_ops: Array) -> void:
	var undo_redo = _plugin.get_undo_redo()
	var label: String = "MCP: %s" % action_name
	undo_redo.create_action(label)
	for op in do_ops:
		_apply_op(undo_redo, "do", op)
	for op in undo_ops:
		_apply_op(undo_redo, "undo", op)
	undo_redo.commit_action()


func _add_method(undo_redo: EditorUndoRedoManager, mode: String, target: Object, method: String, args: Array) -> void:
	if not is_instance_valid(target):
		push_warning("undo_manager: invalid (freed/null) target for method '%s'" % method)
		return
	# EditorUndoRedoManager.add_do_method/add_undo_method 签名是 (Object, StringName, ...args)
	# vararg，不接受 Callable（UndoRedo 风格 add_do_method(cb) 会静默不注册 do_method
	# -> commit_action 执行空 do_ops -> add_child 从未调用 -> 节点不落地 bug）。
	# 用 callv 把 args 数组 spread 成 vararg 参数，确保 do_method 正确注册。
	var mname := "add_do_method" if mode == "do" else "add_undo_method"
	undo_redo.callv(mname, [target, method] + args)


func _add_method_call(undo_redo: EditorUndoRedoManager, mode: String, m: Dictionary) -> void:
	var args: Array = m.get("args", [])
	var target: Object = m.target
	var method: String = m.method
	_add_method(undo_redo, mode, target, method, args)


func _apply_op(undo_redo: EditorUndoRedoManager, mode: String, op: Dictionary) -> void:
	var op_type: String = op.get("type", "method")
	match op_type:
		"method":
			_add_method_call(undo_redo, mode, op)
		"property":
			var target: Object = op.target
			if not is_instance_valid(target):
				push_warning("undo_manager: invalid (freed/null) target for property '%s'" % str(op.get("property", "")))
				return
			var prop: String = str(op.get("property", ""))
			if prop.is_empty():
				push_warning("undo_manager: empty property name, skipping")
				return
			var val = op.value
			if mode == "do":
				undo_redo.add_do_property(target, prop, val)
			else:
				undo_redo.add_undo_property(target, prop, val)
		"reference":
			# Issue 1: add_do_reference/add_undo_reference 仅限 Node,不接受 Resource。
			# GD-R5 (2026-08-08): 显式化此约束——reference op 仅对 Node 有效
			# (Godot UndoRedo.add_do_reference 持有 Node 树引用,Resource 的 refcount 语义不同)。
			# Resource 的 undo 靠 add_do_method 调 ref/unref,非 reference op;调用方需自行处理。
			var val = op.value
			if val is Node and is_instance_valid(val):
				if mode == "do":
					undo_redo.add_do_reference(val)
				else:
					undo_redo.add_undo_reference(val)
			elif val is Resource:
				push_warning("undo_manager: reference op does not support Resource (got %s). Use add_do_method with ref/unref for Resource undo." % val.get_class())
			else:
				push_warning("undo_manager: reference skipped — value is %s, not valid Node" % ("" if val == null else val.get_class()))
		_:
			push_warning("undo_manager: unknown op type '%s', skipping" % op_type)
