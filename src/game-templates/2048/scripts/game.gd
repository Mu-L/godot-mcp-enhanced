extends Node2D
## 2048 主逻辑——模板四件套之「可玩 demo」。
## 确定性:随机全用全局 RNG(randf/randi_range),playtest.seed 可锁。
## 输入:运行时注册方向 action(demo 探针同款模式)——bridge send_input_sequence
## 注入的 InputEventKey 设 physical_keycode,可触发 InputMap 物理键映射的 action。
## 类型:config 走动态字段访问(不写 class_name 静态引用)——零编辑器预打开的
## 新项目没有 global_script_class_cache,class_name 类型注解会 parse error。

const CELL := 96
const GAP := 8
const ORIGIN := Vector2(64, 64)
const BG_COLOR := Color(0.19, 0.17, 0.16)
const TILE_COLORS := {
	0: Color(0.36, 0.33, 0.31), 2: Color(0.93, 0.89, 0.85), 4: Color(0.93, 0.88, 0.78),
	8: Color(0.95, 0.69, 0.47), 16: Color(0.96, 0.58, 0.39), 32: Color(0.96, 0.48, 0.37),
	64: Color(0.96, 0.37, 0.27), 128: Color(0.93, 0.81, 0.45), 256: Color(0.93, 0.80, 0.38),
	512: Color(0.93, 0.78, 0.31), 1024: Color(0.93, 0.77, 0.25), 2048: Color(0.94, 0.85, 0.24),
}

# ── probe 属性(qa 断言面,勿改名) ────────────────────────────────────────────
var score := 0
var moves := 0
var empty_cells := 0
var game_over := false
var won := false

var _grid: Array[Array] = []      # grid[row][col] = 0 或 2 的幂
var _cells: Array[Array] = []     # ColorRect[row][col]
var _labels: Array[Array] = []    # Label[row][col]
var _score_label: Label
var _n := 4
var _win_value := 2048
var _two_probability := 0.9      # 出 2 的概率(1-x 出 4)
var _start_tiles := 2

func _ready() -> void:
	_register_move_actions()
	var cfg: Resource = load('res://tuning/2048.tres')
	if cfg != null:
		_n = clampi(int(cfg.get('grid_size')), 2, 16)
		_win_value = maxi(int(cfg.get('win_value')), 8)
		_two_probability = clampf(float(cfg.get('two_probability')), 0.1, 1.0)
		_start_tiles = clampi(int(cfg.get('start_tiles')), 1, _n * _n - 1)
	for r in _n:
		var row: Array[int] = []
		for c in _n:
			row.append(0)
		_grid.append(row)
		_cells.append([])
		_labels.append([])
	_build_ui()
	for i in _start_tiles:
		_spawn_tile()
	_refresh()

## 运行时注册方向 action(避免手写 project.godot [input] 序列化;demo 探针同款)。
func _register_move_actions() -> void:
	var keys := { 'move_left': KEY_LEFT, 'move_right': KEY_RIGHT, 'move_up': KEY_UP, 'move_down': KEY_DOWN }
	for action in keys:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		var ev := InputEventKey.new()
		ev.physical_keycode = keys[action]
		InputMap.action_add_event(action, ev)

func _build_ui() -> void:
	var board := _n * CELL + (_n + 1) * GAP
	var bg := ColorRect.new()
	bg.color = BG_COLOR
	bg.size = Vector2(board, board)
	bg.position = ORIGIN
	add_child(bg)
	for r in _n:
		for c in _n:
			var cell := ColorRect.new()
			cell.color = TILE_COLORS[0]
			cell.size = Vector2(CELL, CELL)
			cell.position = ORIGIN + Vector2(GAP + c * (CELL + GAP), GAP + r * (CELL + GAP))
			add_child(cell)
			_cells[r].append(cell)
			var label := Label.new()
			label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			label.add_theme_font_size_override('font_size', 34 if _n <= 4 else 24)
			label.size = Vector2(CELL, CELL)
			label.position = cell.position
			add_child(label)
			_labels[r].append(label)
	_score_label = Label.new()
	_score_label.position = ORIGIN + Vector2(board + 32, 8)
	_score_label.add_theme_font_size_override('font_size', 28)
	add_child(_score_label)

func _physics_process(_delta: float) -> void:
	if game_over:
		return
	if Input.is_action_just_pressed('move_left'):
		_try_move(Vector2i(-1, 0))
	elif Input.is_action_just_pressed('move_right'):
		_try_move(Vector2i(1, 0))
	elif Input.is_action_just_pressed('move_up'):
		_try_move(Vector2i(0, -1))
	elif Input.is_action_just_pressed('move_down'):
		_try_move(Vector2i(0, 1))

func _try_move(dir: Vector2i) -> void:
	var before := _snapshot()
	for i in _n:
		_slide_line(i, dir)
	if _snapshot() != before:
		_spawn_tile()
		moves += 1
		if not _can_move():
			game_over = true
	_refresh()

## 第 i 行(dir 横向)或列(dir 纵向)的坐标序列,k=0 为移动方向前缘。
func _line_coords(i: int, dir: Vector2i) -> Array[Vector2i]:
	var coords: Array[Vector2i] = []
	for k in _n:
		if dir.y == 0:
			coords.append(Vector2i((_n - 1 - k) if dir.x > 0 else k, i))
		else:
			coords.append(Vector2i(i, (_n - 1 - k) if dir.y > 0 else k))
	return coords

## 沿 dir 滑动:前缘对齐 + 相同值相邻合并一次(can_merge 防一移双并,GDD Rules #2)。
func _slide_line(i: int, dir: Vector2i) -> void:
	var coords := _line_coords(i, dir)
	var packed: Array[int] = []
	var can_merge := false
	for coord in coords:
		var v: int = _grid[coord.y][coord.x]
		if v == 0:
			continue
		if can_merge and packed[-1] == v:
			packed[-1] = v * 2
			score += v * 2
			if v * 2 >= _win_value:
				won = true
			can_merge = false
		else:
			packed.append(v)
			can_merge = true
	while packed.size() < _n:
		packed.append(0)
	for k in coords.size():
		var coord: Vector2i = coords[k]
		_grid[coord.y][coord.x] = packed[k]

func _spawn_tile() -> void:
	var empties: Array[Vector2i] = []
	for r in _n:
		for c in _n:
			if _grid[r][c] == 0:
				empties.append(Vector2i(c, r))
	if empties.is_empty():
		return
	var pos: Vector2i = empties[randi_range(0, empties.size() - 1)]
	_grid[pos.y][pos.x] = 2 if randf() < _two_probability else 4

func _can_move() -> bool:
	for r in _n:
		for c in _n:
			if _grid[r][c] == 0:
				return true
			if c + 1 < _n and _grid[r][c] == _grid[r][c + 1]:
				return true
			if r + 1 < _n and _grid[r][c] == _grid[r + 1][c]:
				return true
	return false

func _snapshot() -> Array[int]:
	var snap: Array[int] = []
	for r in _n:
		for c in _n:
			snap.append(_grid[r][c])
	return snap

func _refresh() -> void:
	empty_cells = 0
	for r in _n:
		for c in _n:
			var v: int = _grid[r][c]
			if v == 0:
				empty_cells += 1
			(_labels[r][c] as Label).text = str(v) if v > 0 else ''
			(_cells[r][c] as ColorRect).color = TILE_COLORS.get(v, TILE_COLORS[2048])
	var state := ''
	if won:
		state = '\nWON!'
	elif game_over:
		state = '\nGAME OVER'
	_score_label.text = 'score %d\nmoves %d%s' % [score, moves, state]
