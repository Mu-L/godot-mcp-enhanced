@tool
extends McpTestSuite

## H-1 e2e-debug-tools 的 driver 套件(批 H 2026-08-15)。
##
## 职责:让 e2e vitest 进程(经 testing 工具 test_run)能驱动 editor 的
## play_custom_scene / stop_playing_scene —— 这两个 EditorInterface API 无对应
## MCP method,domain 工具无法触发;而 debug Phase 2/3(stack_trace/inspect_frame/
## evaluate)要求 is_playing_scene()==true 才有 await 窗口(互斥守卫验证依赖)。
## 故用套件跑在 editor 主循环内的能力代为按下"运行场景"。
##
## 用法(test_name 为子串过滤,见 mcp_test_runner.gd:_run_suite_tests):
##   test_run(suite=debug_driver, test_name=play) → 游戏启动并停在断点
##   ...(e2e 在 WS 层发 debug_stack_trace / debug_evaluate 等)
##   test_run(suite=debug_driver, test_name=stop) → 游戏停止,清场
##
## 注意:test_* 方法内禁止 await —— runner 的 _run_one_test 用 suite.call()
## fire-and-forget 调用,await 会让断言在测试登记后执行,结果错乱。
## play_custom_scene 同步发出(spawn 游戏是引擎内部异步),无需等帧。


func suite_name() -> String:
	return "debug_driver"


func suite_setup(ctx: Dictionary) -> void:
	if ctx.get("plugin", null) == null:
		fail_setup("debug_driver: ctx.plugin is null — run via editor test_run, not headless")
		return
	## play_custom_scene 不依赖当前打开的场景(直接指定 res:// 场景路径),
	## 无场景打开时也可运行 —— 不需要 undo_manager 套件那种 no-scene skip。


func test_play_and_break() -> void:
	## 启动断点目标场景。断点已由 e2e 在 play 之前经 debug_set_breakpoint 设置
	## (gutter 断点 "kept for the next run" —— play 时生效)。
	EditorInterface.play_custom_scene("res://scenes/debug/breakpoint_target.tscn")
	assert_true(
		EditorInterface.is_playing_scene(),
		"play_custom_scene 后 is_playing_scene 应为 true(游戏进程已 spawn)",
	)


func test_stop_playing() -> void:
	## e2e 收尾清场:停掉游戏进程(kill editor 前显式停,防游戏进程残留)。
	if EditorInterface.is_playing_scene():
		EditorInterface.stop_playing_scene()
	assert_true(
		not EditorInterface.is_playing_scene(),
		"stop_playing_scene 后 is_playing_scene 应为 false",
	)
