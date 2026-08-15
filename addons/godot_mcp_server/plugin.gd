@tool
extends EditorPlugin

var websocket_server: Node
var status_panel: Control
# CMP-7 (2026-08-08): editor instance registry(对齐 headless 多实例 discovery)
var instance_registry: Node
# CMP-14 (2026-08-09): debugger bridge(EditorDebuggerPlugin 子类,Phase 2/3 调试器集成)
var _debugger_bridge: EditorDebuggerPlugin

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

	# CMP-14: 注册 debugger bridge(EditorDebuggerPlugin 子类)
	# 让 _setup_session/_has_capture/_capture 虚方法生效,拿 EditorDebuggerSession 引用
	_debugger_bridge = preload("debug/debugger_bridge.gd").new()
	add_debugger_plugin(_debugger_bridge)

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
	# CMP-14: 注销 debugger bridge(对称移除)
	# B1 (2026-08-11 审查): EditorDebuggerPlugin extends RefCounted(非 Node)——不需手动 free
	# (check:gdscript 实测 free() 报 "Attempted to free a RefCounted object"),引用归零自动释放。
	# 但持久化面板(ScriptEditorDebugger)的信号连接持有绑定了 bridge 的 Callable(引用计数),
	# 不断开则 bridge 永不释放 + reload 后残留连接致消息双重处理。dispose() 断全部已登记信号。
	if _debugger_bridge != null:
		remove_debugger_plugin(_debugger_bridge)
		if _debugger_bridge.has_method("dispose"):
			_debugger_bridge.call("dispose")
		_debugger_bridge = null
	if status_panel and is_instance_valid(status_panel):
		remove_control_from_bottom_panel(status_panel)
		status_panel.queue_free()
	status_panel = null

func get_plugin() -> EditorPlugin:
	return self
