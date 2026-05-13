extends Node

const PING_INTERVAL := 5.0
const INACTIVITY_TIMEOUT := 30.0

signal timeout_detected()

var _last_activity: float = 0.0
var _ping_timer: float = 0.0
var _is_paused: bool = false
var _operation_timeout: float = 0.0
var _operation_timer: float = 0.0

func reset_activity() -> void:
	_last_activity = 0.0

func tick(delta: float, peer: WebSocketPeer) -> void:
	if _is_paused:
		_operation_timer += delta
		if _operation_timer > _operation_timeout:
			_is_paused = false
			emit_signal("timeout_detected")
		return

	_last_activity += delta
	_ping_timer += delta

	if _last_activity > INACTIVITY_TIMEOUT:
		emit_signal("timeout_detected")
		return

	if _ping_timer >= PING_INTERVAL:
		_ping_timer = 0.0
		peer.send_text(JSON.stringify({"jsonrpc": "2.0", "method": "ping", "params": {}}))

func pause_for_operation(timeout_sec: float) -> void:
	_is_paused = true
	_operation_timeout = min(timeout_sec, 600.0)
	_operation_timer = 0.0

func resume() -> void:
	_is_paused = false
	_last_activity = 0.0
	_ping_timer = 0.0
