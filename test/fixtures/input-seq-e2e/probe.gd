# H1 (2026-08-20) send_input_sequence e2e 探针:运行时注册 action "jump"(避免手写
# project.godot [input] 序列化),每物理帧记录首次读到 pressed 的全局帧号与累计帧数。
# get_probe_state 走 bridge call_method 只读白名单(get_*)。
extends Node2D

var first_seen_frame := -1
var first_seen_action := ""
var frames_run := 0
var press_count := 0

func _ready() -> void:
	if not InputMap.has_action("jump"):
		InputMap.add_action("jump")
	var ev := InputEventKey.new()
	ev.physical_keycode = KEY_SPACE
	InputMap.action_add_event("jump", ev)

func _physics_process(_delta: float) -> void:
	frames_run += 1
	if first_seen_frame == -1 and Input.is_action_just_pressed("jump"):
		first_seen_frame = Engine.get_process_frames()
		first_seen_action = "jump"
	if Input.is_action_just_pressed("jump"):
		press_count += 1

func get_probe_state() -> Dictionary:
	return {
		"first_seen_frame": first_seen_frame,
		"first_seen_action": first_seen_action,
		"frames_run": frames_run,
		"press_count": press_count,
		"action_pressed": Input.is_action_pressed("jump"),
	}
