extends Node2D

# v0.20.0 全工具验证靶子 — 2D 主场景脚本(带信号定义,供 signal/audio L2 watch 正路径)
signal action_pressed(value: int)

func _ready() -> void:
	pass

func do_action(v: int) -> void:
	action_pressed.emit(v)
