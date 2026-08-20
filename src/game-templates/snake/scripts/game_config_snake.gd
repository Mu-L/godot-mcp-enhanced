class_name GameConfigSnake
extends Resource
## 贪吃蛇调参资源(tuning/snake.csv → csv_to_resources 重导 → 重启生效)。

@export var grid_size: int = 20
@export var initial_speed_frames: int = 8
@export var initial_length: int = 3
@export var wrap_edges: bool = false
