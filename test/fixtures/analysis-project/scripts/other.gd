extends Node
# 文本引用 fixture：preload 引用 main.gd（impact_check script_path 的 text_refs 用例）

const MainScript = preload("res://scripts/main.gd")

func _ready() -> void:
	var m = MainScript.new()
	print(m)
