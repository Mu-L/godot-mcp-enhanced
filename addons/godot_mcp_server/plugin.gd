@tool
extends EditorPlugin

var websocket_server: Node
var status_panel: Control
# CMP-7 (2026-08-08): editor instance registry(对齐 headless 多实例 discovery)
var instance_registry: Node

func _enter_tree() -> void:
	websocket_server = preload("websocket_server.gd").new()
	websocket_server.name = "MCPServer"
	websocket_server.setup(self)
	add_child(websocket_server)

	var panel_scene = preload("ui/status_panel.tscn")
	status_panel = panel_scene.instantiate()
	add_control_to_bottom_panel(status_panel, "MCP")
	websocket_server.set_panel(status_panel)

	# CMP-7: editor instance registry 写入(让 InstanceManager 发现 editor 实例)
	instance_registry = preload("instance_registry.gd").new()
	instance_registry.setup(self)
	add_child(instance_registry)

func _exit_tree() -> void:
	if websocket_server and is_instance_valid(websocket_server):
		websocket_server.set_process(false)
		var handler = websocket_server.get_node_or_null("command_handler")
		if handler and is_instance_valid(handler) and handler.has_method("cleanup"):
			handler.cleanup()
		websocket_server.queue_free()
	websocket_server = null
	# CMP-7: instance_registry._exit_tree 删自己的 JSON(queue_free 触发 _exit_tree)
	if instance_registry and is_instance_valid(instance_registry):
		instance_registry.queue_free()
	instance_registry = null
	if status_panel and is_instance_valid(status_panel):
		remove_control_from_bottom_panel(status_panel)
		status_panel.queue_free()
	status_panel = null

func get_plugin() -> EditorPlugin:
	return self
