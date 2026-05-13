@tool
extends EditorPlugin

var websocket_server: Node
var status_panel: Control

func _enter_tree() -> void:
	websocket_server = preload("websocket_server.gd").new()
	websocket_server.name = "MCPServer"
	websocket_server.setup(self)
	add_child(websocket_server)

	var panel_scene = preload("ui/status_panel.tscn")
	status_panel = panel_scene.instantiate()
	add_control_to_bottom_panel(status_panel, "MCP")

func _exit_tree() -> void:
	if websocket_server:
		websocket_server.queue_free()
	if status_panel:
		remove_control_from_bottom_panel(status_panel)
		status_panel.queue_free()

func get_plugin() -> EditorPlugin:
	return self
