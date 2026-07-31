extends Node

var _frames := 0

func _ready() -> void:
	print("[WAIT_NODE] ready")

func _process(_delta: float) -> void:
	_frames += 1
	if _frames % 60 == 0:
		print("[WAIT_NODE] heartbeat frame=", _frames)
