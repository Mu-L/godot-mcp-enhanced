extends Node2D
## 贪吃蛇主逻辑——模板四件套之「可玩 demo」。
## 确定性:食物位置用全局 RNG(randi_range),playtest.seed 可锁;固定帧步进
## (initial_speed_frames 物理帧/格),自写移动逻辑零引擎物理依赖。
## 输入:运行时注册方向 action(2048 模板同款);cfg 动态字段访问(零编辑器预打开)。

const CELL := 28
const GAP := 2
const ORIGIN := Vector2(40, 40)
const BG_COLOR := Color(0.08, 0.10, 0.12)
const SNAKE_COLOR := Color(0.35, 0.85, 0.42)
const HEAD_COLOR := Color(0.55, 0.95, 0.60)
const FOOD_COLOR := Color(0.92, 0.36, 0.36)

# ── probe 属性(qa 断言面,勿改名) ────────────────────────────────────────────
var score := 0
var length := 3
var game_over := false
var steps_moved := 0
var direction := 'right'

var _body: Array[Vector2i] = []     # [0]=头;网格坐标 (col,row)
var _food := Vector2i(-1, -1)
var _n := 20
var _speed_frames := 8
var _initial_length := 3
var _wrap := false
var _frame := 0
var _pending: Array[String] = []    # 转向缓冲(逐格生效,GDD Edge Cases)
var _bg: ColorRect
var _snake_rects: Array[ColorRect] = []
var _food_rect: ColorRect
var _hud: Label

func _ready() -> void:
	_register_move_actions()
	var cfg: Resource = load('res://tuning/snake.tres')
	if cfg != null:
		_n = clampi(int(cfg.get('grid_size')), 4, 64)
		_speed_frames = clampi(int(cfg.get('initial_speed_frames')), 1, 60)
		_initial_length = clampi(int(cfg.get('initial_length')), 1, _n)
		_wrap = bool(cfg.get('wrap_edges'))
	length = _initial_length
	var mid := _n / 2
	for i in length:
		_body.append(Vector2i(mid - i, mid))
	_build_ui()
	_spawn_food()
	_refresh()

func _register_move_actions() -> void:
	var keys := { 'move_left': KEY_LEFT, 'move_right': KEY_RIGHT, 'move_up': KEY_UP, 'move_down': KEY_DOWN }
	for action in keys:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		var ev := InputEventKey.new()
		ev.physical_keycode = keys[action]
		InputMap.action_add_event(action, ev)

func _build_ui() -> void:
	var board := _n * (CELL + GAP) + GAP
	_bg = ColorRect.new()
	_bg.color = BG_COLOR
	_bg.size = Vector2(board, board)
	_bg.position = ORIGIN
	add_child(_bg)
	_food_rect = ColorRect.new()
	_food_rect.color = FOOD_COLOR
	_food_rect.size = Vector2(CELL, CELL)
	add_child(_food_rect)
	_hud = Label.new()
	_hud.position = ORIGIN + Vector2(board + 24, 8)
	_hud.add_theme_font_size_override('font_size', 24)
	add_child(_hud)

func _physics_process(_delta: float) -> void:
	if game_over:
		return
	_collect_turns()
	_frame += 1
	if _frame % _speed_frames != 0:
		return
	_apply_pending_turn()
	var head: Vector2i = _body[0]
	var nxt := head + _dir_vec()
	if _wrap:
		nxt = Vector2i(posmod(nxt.x, _n), posmod(nxt.y, _n))
	elif nxt.x < 0 or nxt.y < 0 or nxt.x >= _n or nxt.y >= _n:
		game_over = true
		_refresh()
		return
	# 撞自身(尾巴即将移出的那一格不算,吃食物时除外——经典规则)
	var will_grow := nxt == _food
	var check_body := _body if will_grow else _body.slice(0, _body.size() - 1)
	if check_body.has(nxt):
		game_over = true
		_refresh()
		return
	_body.push_front(nxt)
	if will_grow:
		score += 1
		length = _body.size()
		_spawn_food()
	else:
		_body.pop_back()
	steps_moved += 1
	_refresh()

func _collect_turns() -> void:
	for action in ['move_left', 'move_right', 'move_up', 'move_down']:
		if Input.is_action_just_pressed(action):
			_pending.append(action.substr(5))

## 逐格生效一次转向;禁止 180° 回头(GDD Rules #3,被忽略的输入不消耗)。
func _apply_pending_turn() -> void:
	while not _pending.is_empty():
		var want: String = _pending.pop_front()
		if want != direction and want != _opposite(direction):
			direction = want
			return

func _opposite(d: String) -> String:
	return { 'left': 'right', 'right': 'left', 'up': 'down', 'down': 'up' }[d]

func _dir_vec() -> Vector2i:
	match direction:
		'left': return Vector2i(-1, 0)
		'right': return Vector2i(1, 0)
		'up': return Vector2i(0, -1)
		'down': return Vector2i(0, 1)
	return Vector2i(1, 0)

func _spawn_food() -> void:
	var empties: Array[Vector2i] = []
	var occupied := {}
	for seg in _body:
		occupied[seg] = true
	for r in _n:
		for c in _n:
			var cell := Vector2i(c, r)
			if not occupied.has(cell):
				empties.append(cell)
	if empties.is_empty():
		return
	_food = empties[randi_range(0, empties.size() - 1)]

func _refresh() -> void:
	while _snake_rects.size() < _body.size():
		var rect := ColorRect.new()
		rect.size = Vector2(CELL, CELL)
		add_child(rect)
		_snake_rects.append(rect)
	for i in _snake_rects.size():
		var rect: ColorRect = _snake_rects[i]
		if i < _body.size():
			rect.visible = true
			rect.color = HEAD_COLOR if i == 0 else SNAKE_COLOR
			rect.position = ORIGIN + Vector2(GAP + _body[i].x * (CELL + GAP), GAP + _body[i].y * (CELL + GAP))
		else:
			rect.visible = false
	_food_rect.position = ORIGIN + Vector2(GAP + _food.x * (CELL + GAP), GAP + _food.y * (CELL + GAP))
	_hud.text = 'score %d\nlength %d\nsteps %d%s' % [score, length, steps_moved, '\nGAME OVER' if game_over else '']
