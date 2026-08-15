extends Area2D

signal hit

func _exit_tree() -> void:
	area.clear_shapes.disconnect(_on_clear)

func _on_body(_b: Node) -> void:
	hit.emit()

func _on_clear() -> void:
	pass
