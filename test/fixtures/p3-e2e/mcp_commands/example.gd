extends Node
## P3-3 (2026-09-11) e2e fixture:项目本地命令目录示例(regiellis mcp_commands 模式)。
## bridge _ready 扫描 res://mcp_commands/*.gd 注册 get_commands() 声明的命令面;
## 非 custom. 前缀的键在注册时跳过(负向用例:bad.name 供 e2e 验证不可达)。

func get_commands() -> Dictionary:
	return {
		"custom.ping": _ping,
		"custom.echo": _echo,
		"custom.check_state": _check_state,
		"bad.name": _ping,
	}


func _ping(_params: Dictionary) -> Dictionary:
	return {"pong": true}


func _echo(params: Dictionary) -> Dictionary:
	return {"message": str(params.get("message", ""))}


func _check_state(_params: Dictionary) -> Dictionary:
	var main := get_tree().root.get_node_or_null("Main")
	if main == null:
		return {"error": {"code": -1, "message": "Main not found"}}
	return main.call("get_check_state")
