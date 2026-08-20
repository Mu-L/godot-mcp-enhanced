extends Node2D
## 打砖块主逻辑——模板四件套之「可玩 demo」。
## 自写 AABB 物理(零引擎物理节点):球恒速向量步进,帧级确定——同 seed 同输入
## ⇒ 轨迹完全可复现(GDD AC-2)。发球角/无重叠重发用全局 RNG(playtest.seed 可锁)。
## 输入:运行时注册左右 action(2048/snake 同款);cfg 动态字段访问。

const W := 960.0
const H := 640.0
const ORIGIN := Vector2(40, 40)
const BG_COLOR := Color(0.06, 0.07, 0.09)
const PADDLE_COLOR := Color(0.42, 0.62, 0.95)
const BALL_COLOR := Color(0.95, 0.95, 0.85)
const BRICK_COLORS := [
	Color(0.92, 0.38, 0.38), Color(0.94, 0.60, 0.32), Color(0.92, 0.82, 0.32), Color(0.50, 0.85, 0.45),
]
const GAP_BORDER := 8.0
const PADDLE_H := 14.0
const PADDLE_Y := 580.0
const BALL_R := 7.0
const BRICK_TOP := 70.0
const BRICK_W := 84.0
const BRICK_H := 24.0
const BRICK_GAP := 4.0
const PADDLE_SPEED := 10.0   # px/物理帧

# ── probe 属性(qa 断言面,勿改名) ────────────────────────────────────────────
var score := 0
var lives := 3
var bricks_left := 0
var game_over := false
var won := false
var frames_simulated := 0

var _paddle_width := 120.0
var _ball_speed := 6.0
var _rows := 4
var _cols := 10
var _paddle_x := W / 2.0
var _ball_pos := Vector2.ZERO
var _ball_vel := Vector2.ZERO
var _bricks: Array[Rect2] = []
var _brick_alive: Array[bool] = []
var _paddle_rect: ColorRect
var _ball_rect: ColorRect
var _brick_rects: Array[ColorRect] = []
var _hud: Label

func _ready() -> void:
	_register_actions()
	var cfg: Resource = load('res://tuning/breakout.tres')
	if cfg != null:
		_paddle_width = clampf(float(cfg.get('paddle_width')), 40.0, 600.0)
		_ball_speed = clampf(float(cfg.get('ball_speed')), 2.0, 20.0)
		_rows = clampi(int(cfg.get('brick_rows')), 0, 12)
		_cols = clampi(int(cfg.get('brick_cols')), 1, 20)
		lives = clampi(int(cfg.get('lives')), 1, 9)
	_build_ui()
	_reset_bricks()
	_serve()
	_refresh()

func _register_actions() -> void:
	for pair in [['move_left', KEY_LEFT], ['move_right', KEY_RIGHT]]:
		var action: String = pair[0]
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		var ev := InputEventKey.new()
		ev.physical_keycode = pair[1]
		InputMap.action_add_event(action, ev)

func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = BG_COLOR
	bg.size = Vector2(W + GAP_BORDER * 2, H + GAP_BORDER * 2)
	bg.position = ORIGIN - Vector2(GAP_BORDER, GAP_BORDER)
	add_child(bg)
	_paddle_rect = ColorRect.new()
	_paddle_rect.color = PADDLE_COLOR
	_paddle_rect.size = Vector2(_paddle_width, PADDLE_H)
	add_child(_paddle_rect)
	_ball_rect = ColorRect.new()
	_ball_rect.color = BALL_COLOR
	_ball_rect.size = Vector2(BALL_R * 2, BALL_R * 2)
	add_child(_ball_rect)
	_hud = Label.new()
	_hud.position = ORIGIN + Vector2(W + 24, 8)
	_hud.add_theme_font_size_override('font_size', 24)
	add_child(_hud)

func _reset_bricks() -> void:
	_bricks.clear()
	_brick_alive.clear()
	for r in _brick_rects.size():
		_brick_rects[r].queue_free()
	_brick_rects.clear()
	bricks_left = 0
	if _rows == 0:
		won = true
		game_over = true
		return
	var total_w := _cols * BRICK_W + (_cols - 1) * BRICK_GAP
	var x0 := (W - total_w) / 2.0
	for r in _rows:
		for c in _cols:
			var rect := Rect2(ORIGIN.x + x0 + c * (BRICK_W + BRICK_GAP), ORIGIN.y + BRICK_TOP + r * (BRICK_H + BRICK_GAP), BRICK_W, BRICK_H)
			_bricks.append(rect)
			_brick_alive.append(true)
			var visual := ColorRect.new()
			visual.color = BRICK_COLORS[r % BRICK_COLORS.size()]
			visual.size = Vector2(BRICK_W, BRICK_H)
			add_child(visual)
			_brick_rects.append(visual)
	bricks_left = _bricks.size()

## 发球:挡板上方,与竖直 ±30°..±60° 随机角(避开纯水平/纯垂直,GDD Formulas)。
func _serve() -> void:
	_ball_pos = Vector2(_paddle_x, PADDLE_Y - BALL_R - 2.0)
	var angle_deg := randf_range(30.0, 60.0)
	if randf() < 0.5:
		angle_deg = -angle_deg
	var rad := deg_to_rad(angle_deg)
	_ball_vel = Vector2(sin(rad) * _ball_speed, -cos(rad) * _ball_speed)

func _physics_process(_delta: float) -> void:
	if game_over:
		return
	frames_simulated += 1
	# 挡板:持续按住移动
	var move := 0
	if Input.is_action_pressed('move_left'):
		move -= 1
	if Input.is_action_pressed('move_right'):
		move += 1
	_paddle_x = clampf(_paddle_x + move * PADDLE_SPEED, _paddle_width / 2.0, W - _paddle_width / 2.0)
	# 球步进(帧级恒速)
	_ball_pos += _ball_vel
	# 墙反弹(上/左/右;下=失球)
	if _ball_pos.y - BALL_R < ORIGIN.y:
		_ball_pos.y = ORIGIN.y + BALL_R
		_ball_vel.y = absf(_ball_vel.y)
	if _ball_pos.x - BALL_R < ORIGIN.x:
		_ball_pos.x = ORIGIN.x + BALL_R
		_ball_vel.x = absf(_ball_vel.x)
	if _ball_pos.x + BALL_R > ORIGIN.x + W:
		_ball_pos.x = ORIGIN.x + W - BALL_R
		_ball_vel.x = -absf(_ball_vel.x)
	# 挡板反弹(命中偏移决定水平分量,GDD Formulas)
	var paddle_rect := Rect2(ORIGIN.x + _paddle_x - _paddle_width / 2.0, ORIGIN.y + PADDLE_Y, _paddle_width, PADDLE_H)
	if _ball_vel.y > 0 and paddle_rect.grow(BALL_R).has_point(_ball_pos):
		var hit_offset := clampf((_ball_pos.x - _paddle_x) / (_paddle_width / 2.0), -1.0, 1.0)
		var vx := hit_offset * _ball_speed * 0.8
		var vy := -sqrt(maxf(_ball_speed * _ball_speed - vx * vx, 0.25))
		_ball_vel = Vector2(vx, vy)
		_ball_pos.y = ORIGIN.y + PADDLE_Y - BALL_R - 0.1
	# 砖块碰撞(单帧最多一块,GDD Edge Cases)
	var ball_aabb := Rect2(_ball_pos.x - BALL_R, _ball_pos.y - BALL_R, BALL_R * 2, BALL_R * 2)
	for i in _bricks.size():
		if not _brick_alive[i]:
			continue
		var brick: Rect2 = _bricks[i]
		if not brick.intersects(ball_aabb):
			continue
		_brick_alive[i] = false
		bricks_left -= 1
		score += 1
		_brick_rects[i].visible = false
		# 反弹面:取穿透最小的轴
		var overlap_x := minf(brick.end.x - ball_aabb.position.x, ball_aabb.end.x - brick.position.x)
		var overlap_y := minf(brick.end.y - ball_aabb.position.y, ball_aabb.end.y - brick.position.y)
		if overlap_x < overlap_y:
			_ball_vel.x = -_ball_vel.x
		else:
			_ball_vel.y = -_ball_vel.y
		break
	# 失球/胜利
	if _ball_pos.y - BALL_R > ORIGIN.y + H:
		lives -= 1
		if lives <= 0:
			game_over = true
		else:
			_serve()
	if bricks_left == 0 and not game_over:
		won = true
		game_over = true
	_refresh()

func _refresh() -> void:
	_paddle_rect.position = Vector2(ORIGIN.x + _paddle_x - _paddle_width / 2.0, ORIGIN.y + PADDLE_Y)
	_ball_rect.position = _ball_pos - Vector2(BALL_R, BALL_R)
	_ball_rect.visible = not game_over
	_hud.text = 'score %d\nlives %d\nbricks %d%s' % [score, lives, bricks_left, '\nYOU WIN!' if won else ('\nGAME OVER' if game_over else '')]
