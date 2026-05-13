extends Node

const BASE_PORT := 9090
const MAX_PORT := 9094

var _server: TCPServer
var _peers: Array[WebSocketPeer] = []
var _heartbeat: Node
var _command_handler: Node
var _current_port: int = 0
var _request_counter: int = 0
var _plugin: EditorPlugin

func setup(plugin: EditorPlugin) -> void:
	_plugin = plugin

func _ready() -> void:
	_heartbeat = preload("heartbeat.gd").new()
	add_child(_heartbeat)
	_heartbeat.timeout_detected.connect(_on_heartbeat_timeout)

	_command_handler = preload("command_handler.gd").new()
	_command_handler.setup(_plugin)
	add_child(_command_handler)

	_start_server()

func _start_server() -> void:
	_server = TCPServer.new()
	for port in range(BASE_PORT, MAX_PORT + 1):
		if _server.listen(port) == OK:
			_current_port = port
			print("[MCP] Listening on port %d" % port)
			_update_panel("MCP: Listening on port %d" % port)
			return
	push_error("[MCP] All ports (%d-%d) occupied" % [BASE_PORT, MAX_PORT])

func _process(delta: float) -> void:
	if not _server: return

	if _server.is_connection_available():
		var tcp_peer = _server.take_connection()
		var ws_peer = WebSocketPeer.new()
		ws_peer.accept_stream(tcp_peer)
		_peers.append(ws_peer)
		print("[MCP] Client connected (total: %d)" % _peers.size())
		_update_panel("MCP: %d client(s) connected" % _peers.size())
		_send_session_sync(ws_peer)

	var to_remove: Array[int] = []
	for i in range(_peers.size()):
		var peer = _peers[i]
		peer.poll()
		match peer.get_ready_state():
			WebSocketPeer.STATE_OPEN:
				_heartbeat.tick(delta, peer)
				while peer.get_available_packet_count() > 0:
					var text = peer.get_packet().get_string_from_utf8()
					_handle_message(text, peer)
					_heartbeat.reset_activity()
			WebSocketPeer.STATE_CLOSED:
				to_remove.append(i)

	for i in to_remove:
		_peers.remove_at(i)
		print("[MCP] Client disconnected")

func _handle_message(text: String, peer: WebSocketPeer) -> void:
	var parsed = JSON.parse_string(text)
	if not parsed or not parsed.has("jsonrpc"):
		peer.send_text(JSON.stringify({"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid JSON-RPC"}}))
		return

	if parsed.get("method") == "operation_start":
		var timeout = parsed.get("params", {}).get("timeout", 300)
		_heartbeat.pause_for_operation(timeout)
		_update_panel("MCP: Operation in progress...")
		_get_panel().set_operation_active(true)
		peer.send_text(JSON.stringify({"jsonrpc": "2.0", "id": parsed.get("id"), "result": {}}))
		return

	if parsed.get("method") == "operation_end":
		_heartbeat.resume()
		_update_panel("MCP: %d client(s) connected" % _peers.size())
		_get_panel().set_operation_active(false)
		peer.send_text(JSON.stringify({"jsonrpc": "2.0", "id": parsed.get("id"), "result": {}}))
		return

	if parsed.get("method") == "request_sync":
		_send_session_sync(peer)
		return

	if parsed.get("method") == "ping":
		_heartbeat.reset_activity()
		return

	_request_counter += 1
	var response = _command_handler.handle(parsed.get("method", ""), parsed.get("params", {}), _request_counter)
	var reply = {"jsonrpc": "2.0", "id": parsed.get("id")}
	if response.has("error"):
		reply["error"] = response.error
	else:
		reply["result"] = response.result
	peer.send_text(JSON.stringify(reply))

func _send_session_sync(peer: WebSocketPeer) -> void:
	var open_scenes: Array = []
	if _plugin:
		var ei = _plugin.get_editor_interface()
		open_scenes = ei.get_open_scenes()
	peer.send_text(JSON.stringify({"method": "session_resync", "params": {"open_scenes": open_scenes}}))

func _on_heartbeat_timeout() -> void:
	push_warning("[MCP] Heartbeat timeout")
	_update_panel("MCP: Connection timeout!")

func cancel_current_operation() -> void:
	_heartbeat.resume()
	_update_panel("MCP: Operation cancelled")
	for peer in _peers:
		peer.send_text(JSON.stringify({"method": "operation_cancelled", "params": {}}))

func _update_panel(text: String) -> void:
	var panel = _get_panel()
	if panel: panel.update_status(text)

func _get_panel() -> Node:
	return get_node_or_null("../../../../../MCP")

func _exit_tree() -> void:
	if _server: _server.stop()
	for peer in _peers: peer.close()
	_peers.clear()
