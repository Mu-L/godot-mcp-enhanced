class_name GameConfig2048
extends Resource
## 2048 调参资源(tuning/2048.csv → csv_to_resources 重导 → 重启生效)。

@export var grid_size: int = 4
@export var win_value: int = 2048
@export var two_probability: float = 0.9  ## 出 2 的概率(1-x 出 4)
@export var start_tiles: int = 2
