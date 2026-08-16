extends Node2D
# analysis fixture：正向（代码连接/发射）+ 负向（注释/字符串内同名调用不得误报）

signal game_over

func _ready() -> void:
	game_over.connect(_on_game_over)
	self.pressed.connect(_on_button_pressed)
	# emit_signal("fake_in_comment")
	var s = "emit_signal(\"in_string\")"
	emit_signal("game_over")
	Sub.hit.connect(_on_sub_hit)

func _on_button_pressed() -> void:
	pass

func _on_game_over() -> void:
	pass

func _on_sub_hit() -> void:
	pass
