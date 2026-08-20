class_name GameConfigBreakout
extends Resource
## 打砖块调参资源(tuning-src/breakout.csv → csv_to_resources 重导 → 重启生效)。

@export var paddle_width: float = 120.0
@export var ball_speed: float = 6.0
@export var brick_rows: int = 4
@export var brick_cols: int = 10
@export var lives: int = 3
