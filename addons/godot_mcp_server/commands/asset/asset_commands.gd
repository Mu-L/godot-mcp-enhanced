@tool
extends Node

var _plugin: EditorPlugin
var _undo_manager: Node

func setup(plugin: EditorPlugin, undo_manager: Node) -> void:
	_plugin = plugin
	_undo_manager = undo_manager

# 占位返回，后续 task 替换为真实实现
func _stub(action: String) -> Dictionary:
	return {"error": {"code": -32601, "message": "asset_%s not implemented" % action}}

func handle_create(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("create")

func handle_path(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("path")

func handle_batch(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("batch")

func handle_undo(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("undo")

func handle_save(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("save")
