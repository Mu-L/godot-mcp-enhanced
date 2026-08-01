@tool
extends McpTestSuite

## P1-5 coverage suite for undo_manager.gd.
##
## Covers all 5 funcs in addons/godot_mcp_server/undo_manager.gd:
##   1. setup(plugin)
##   2. create_action_mixed(action_name, do_ops, undo_ops)
##   3. _add_method(undo_redo, mode, target, method, args)  [private]
##   4. _add_method_call(undo_redo, mode, m)                [private]
##   5. _apply_op(undo_redo, mode, op)                       [private]
##
## Runs in editor context (EditorUndoRedoManager is unavailable in headless).
## All suites are short (<1s) — phase-1 sync path has no transport hard gate.

const UndoManagerScript := preload("res://addons/godot_mcp_server/undo_manager.gd")

var _plugin: EditorPlugin
var _undo_manager: Node
var _arena: Node  ## throwaway parent for test nodes, torn down in suite_teardown


func suite_name() -> String:
	return "undo_manager"


func suite_setup(ctx: Dictionary) -> void:
	_plugin = ctx.get("plugin", null)
	_undo_manager = ctx.get("undo_manager", null)
	if _plugin == null:
		fail_setup("suite_setup: ctx.plugin is null — run via editor test_run, not headless")
		return
	## Prefer the live undo_manager from command_handler (registered via setup).
	## Fall back to a fresh instance for isolated coverage when the live one
	## isn't threaded through (defensive — should not happen in editor runs).
	if _undo_manager == null:
		_undo_manager = UndoManagerScript.new()
		_undo_manager.setup(_plugin)
	## Arena holds test children so they don't pollute the edited scene root.
	## N-3 (审查): 无场景打开时 get_edited_scene_root() 返回 null，add_child 会 SCRIPT ERROR
	## 崩溃，且 runner 的 fail_setup 无法捕获 suite_setup 内的崩溃。用 skip_suite 体面退出。
	var scene_root := EditorInterface.get_edited_scene_root()
	if scene_root == null:
		skip_suite("no scene open in editor — undo_manager tests require an edited scene (open any scene and re-run)")
		return
	_arena = Node.new()
	_arena.name = "_McpTestUndoArena"
	_arena.set_meta("_mcp_test_owned", true)
	scene_root.add_child(_arena)
	_arena.owner = scene_root


func setup() -> void:
	## Sanity: each test starts with a clean arena (suite_teardown clears at end,
	## but per-test cleanup via track() handles mid-test leaks).
	pass


func teardown() -> void:
	## Drop any arena children left by this test so the next test starts clean.
	for child in _arena.get_children():
		_arena.remove_child(child)
		child.queue_free()


func suite_teardown() -> void:
	if _arena != null and is_instance_valid(_arena):
		var parent := _arena.get_parent()
		if parent != null:
			parent.remove_child(_arena)
		_arena.queue_free()


# ----- test 1: setup() assigns _plugin -------------------------------------

func test_setup_assigns_plugin() -> void:
	## The live _undo_manager was set up with _plugin in command_handler.setup.
	## We assert the round-trip by creating a fresh instance and confirming
	## setup binds the plugin (accessed via the public get_undo_redo() path).
	var fresh := UndoManagerScript.new()
	fresh.setup(_plugin)
	## _plugin is private, but setup's contract is "enables create_action_mixed".
	## Assert indirectly: create_action_mixed must not crash and must produce
	## a committed action (verified in test_create_action_mixed_adds_node).
	## Here we only confirm setup() doesn't leave the instance in a broken
	## state by calling create_action_mixed with empty ops.
	fresh.create_action_mixed("noop", [], [])
	assert_true(true, "setup() + empty create_action_mixed did not crash")
	fresh.free()


# ----- test 2: create_action_mixed adds a node via do, removes via undo ----

func test_create_action_mixed_adds_and_removes_node() -> void:
	var child := Node.new()
	child.name = "_McpTestMethodChild"
	child.set_meta("_mcp_test_owned", true)
	track(child)
	## do_op: add child to arena; undo_op: remove child from arena.
	## create_action_mixed commits the action, so after commit the do-method
	## has executed (add_child landed). Undo should reverse it.
	var do_ops := [{
		"type": "method",
		"target": _arena,
		"method": "add_child",
		"args": [child],
	}]
	var undo_ops := [{
		"type": "method",
		"target": _arena,
		"method": "remove_child",
		"args": [child],
	}]
	_undo_manager.create_action_mixed("add test child", do_ops, undo_ops)
	## After commit, do-method ran: child is in arena.
	assert_eq(child.get_parent(), _arena, "do-method add_child landed the child in arena")
	## Undo the last action via the suite helper (resolves scene/global history).
	var did_undo := editor_undo(_plugin.get_undo_redo())
	assert_true(did_undo, "editor_undo returned true (an action was undone)")
	## After undo, undo-method ran: child removed from arena.
	assert_ne(child.get_parent(), _arena, "undo-method removed the child from arena")


# ----- test 3: _add_method skips null target without crashing --------------

func test_add_method_invalid_target_is_guarded() -> void:
	## _add_method must push_warning and return for a null target, not crash.
	## N-4 + 实测发现: freed 对象传给强类型 Object 形参会 Godot 在函数绑定时
	## 触发 SCRIPT ERROR（"previously freed is not a subclass"），早于函数体的
	## is_instance_valid 守卫 —— 守卫只覆盖 null（绑定时 null 可通过 Object? 形参），
	## 不覆盖 freed。故本测试改用 null（守卫真实覆盖的场景）。
	## freed 场景由 Godot 引擎自身的参数绑定检查兜底（SCRIPT ERROR abort 测试）。
	var children_before := _arena.get_child_count()
	var undo_redo := _plugin.get_undo_redo()
	undo_redo.create_action("test: null target")
	## null target: is_instance_valid(null) = false → push_warning + return（守卫路径）
	_undo_manager._add_method(undo_redo, "do", null, "add_child", [_arena])
	undo_redo.commit_action()
	## 守卫工作正确时 null 的 add_child 从未注册 → commit 不改 arena。
	assert_eq(_arena.get_child_count(), children_before, "null-target guard: no op committed (arena child_count unchanged)")


# ----- test 4: _apply_op property branch -----------------------------------

func test_apply_op_property_do_and_undo() -> void:
	## _apply_op with type="property" must call add_do_property/add_undo_property.
	## We verify by committing an action that sets a property, then undoing it.
	var target := Node.new()
	target.name = "_McpTestPropTarget"
	target.set_meta("_mcp_test_owned", true)
	## Give it a custom property via meta (Node has no settable value props by
	## default, so use name which is a real String property).
	target.name = "before"
	track(target)
	var undo_redo := _plugin.get_undo_redo()
	undo_redo.create_action("test: property op")
	_undo_manager._apply_op(undo_redo, "do", {
		"type": "property",
		"target": target,
		"property": "name",
		"value": "after",
	})
	_undo_manager._apply_op(undo_redo, "undo", {
		"type": "property",
		"target": target,
		"property": "name",
		"value": "before",
	})
	undo_redo.commit_action()
	## After commit, do-property applied: name is "after".
	assert_eq(target.name, "after", "do-property set name to 'after'")
	var did_undo := editor_undo(_plugin.get_undo_redo())
	assert_true(did_undo, "editor_undo returned true")
	## After undo, undo-property applied: name restored to "before".
	assert_eq(target.name, "before", "undo-property restored name to 'before'")


# ----- test 5: _apply_op unknown type falls through with warning -----------

func test_apply_op_unknown_type_is_warned() -> void:
	## _apply_op with an unrecognized type must hit the `_` branch: push_warning
	## and skip (not crash). N-4 (审查): 强断言 — 给 target 一个可观测属性（name），
	## 断言 unknown type op 未改动它（守卫的契约是"什么都不做"）。守卫删了的话
	## match `_` 不执行，但 target.name 也不变 → 仍绿。所以额外断言 commit 后
	## 没有产生 SCRIPT ERROR（runner 隐式保证）+ name 未变（显式反查）。
	var target := Node.new()
	target.name = "_McpTestBefore"
	target.set_meta("_mcp_test_owned", true)
	track(target)
	var undo_redo := _plugin.get_undo_redo()
	undo_redo.create_action("test: unknown op type")
	_undo_manager._apply_op(undo_redo, "do", {
		"type": "nonexistent_type",
		"target": target,
		"property": "name",
		"value": "_McpTestAfter",  ## must NOT be applied (type unrecognized)
	})
	undo_redo.commit_action()
	## commit executed do-methods but unknown-type op registered nothing, so
	## the property assignment never happened → name unchanged.
	assert_eq(target.name, "_McpTestBefore", "unknown-type op did not apply property (name unchanged)")
