@tool
class_name McpTestRunner
extends RefCounted

## Lightweight test runner for McpTestSuite. Discovers test_* methods on
## suite instances, runs them, and collects structured results.
##
## Source: ported from godot-ai (test_runner.gd).
## Enhanced variant (P2-12): run_suite accepts an optional `yield_cb`
## (Callable). When valid, it is awaited after each test so the editor
## main loop can tick heartbeat + drain packets between tests — preventing
## WebSocket keepalive starvation on long suites (phase 2 hard gate).
## Empty/invalid yield_cb = phase-1 sync path (headless / unit-test fixtures).
## This mirrors nav_bake_mesh's async coroutine pattern (websocket_server.gd
## routes test_run through `await`, EditorToolExecutor wraps it in
## startOperation/endOperation) — simpler than godot-ai's drain-and-reject
## because enhanced's keepalive is server-side (heartbeat.gd), serviced
## automatically when the main loop runs.
##
## Keeps the leak-cleanup helpers (`_free_mcp_test_nodes_recursive`,
## `_cleanup_leaked_nodes`) because editor suites create scene nodes that
## would otherwise bake into the edited .tscn (issue #19).

const ScriptErrorCapture := preload("res://addons/godot_mcp_server/testing/script_error_capture.gd")

var _results: Array[Dictionary] = []
var _last_run_ms: int = 0
var _script_error_capture: ScriptErrorCapture = null
var _capture_registered := false


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and _capture_registered and _script_error_capture != null:
		OS.remove_logger(_script_error_capture)
		_capture_registered = false


## Run a single suite synchronously. `test_filter` / `exclude_test_filter`
## are substring filters (empty = no filter). `ctx` is passed to
## suite_setup as a deep copy so suites cannot mutate shared state.
func run_suite(
	suite: McpTestSuite,
	test_filter: String = "",
	exclude_test_filter: String = "",
	ctx: Dictionary = {},
	yield_cb: Callable = Callable(),
) -> Dictionary:
	_results.clear()
	var start := Time.get_ticks_msec()

	var owns_capture := not _capture_registered
	if owns_capture:
		_register_capture()

	## Snapshot scene children before the suite so we can clean up leaks.
	var scene_root := _edited_scene_root()
	var before_children: Array[Node] = []
	if scene_root != null:
		before_children = _get_children_snapshot(scene_root)

	suite._reset_suite_state()
	suite.suite_setup(ctx.duplicate(true))

	if suite._suite_failed:
		_results.append({
			"suite": suite.suite_name(),
			"test": "<suite_setup>",
			"passed": false,
			"message": "suite_setup() failed: %s (subsequent tests not run)" % suite._suite_failed_message,
			"assertion_count": 0,
		})
	elif suite._suite_skipped:
		_results.append({
			"suite": suite.suite_name(),
			"test": "<suite_setup>",
			"passed": true,
			"skipped": true,
			"message": "suite_setup() skipped: %s" % suite._suite_skipped_reason,
			"assertion_count": 0,
		})
	else:
		await _run_suite_tests(suite, test_filter, exclude_test_filter, yield_cb)

	## Suite epilogue runs on EVERY path, including fail_setup/skip_suite:
	## the suite has begun, so its teardown and leak cleanup must not skip.
	suite.suite_teardown()
	suite._free_tracked()

	if scene_root != null and scene_root.is_inside_tree():
		_cleanup_leaked_nodes(scene_root, before_children)

	_last_run_ms = Time.get_ticks_msec() - start
	if owns_capture:
		_unregister_capture()
	return get_results(false)


## Per-test loop. P2-12 phase 2: yield_cb (when valid) is awaited after each
## test so the editor main loop can tick heartbeat + poll packets between
## tests, preventing WebSocket keepalive starvation on long suites.
## Empty/invalid yield_cb = phase-1 sync path (compat for headless/unit tests).
func _run_suite_tests(
	suite: McpTestSuite,
	test_filter: String,
	exclude_test_filter: String,
	yield_cb: Callable = Callable(),
) -> void:
	var name := suite.suite_name()
	var methods := _get_test_methods(suite)
	var exclusions := _parse_exclusions(exclude_test_filter)

	for method_name in methods:
		if not test_filter.is_empty() and method_name.find(test_filter) == -1:
			continue
		if _matches_any_exclusion(method_name, exclusions):
			_results.append({
				"suite": name,
				"test": method_name,
				"passed": true,
				"skipped": true,
				"message": "Excluded by exclude_test_name filter",
				"assertion_count": 0,
				"duration_ms": 0,
			})
			continue

		var test_start := Time.get_ticks_msec()
		var entry := _run_one_test(suite, name, method_name)
		entry["duration_ms"] = Time.get_ticks_msec() - test_start
		_results.append(entry)
		## P2-12 phase 2: let the editor main loop run between tests so
		## heartbeat.tick() fires + pending packets drain. No-op when yield_cb
		## is empty (headless / unit-test fixtures keep phase-1 sync behavior).
		if yield_cb.is_valid():
			await yield_cb.call()


## Execute one test method and return its result entry (not yet appended;
## the caller stamps `duration_ms`).
func _run_one_test(suite: McpTestSuite, name: String, method_name: String) -> Dictionary:
	suite._reset()
	_begin_script_error_capture()
	suite.setup()
	suite.call(method_name)
	suite.teardown()
	var script_errors := suite._unexpected_script_errors(_end_script_error_capture())
	suite._free_tracked()

	## Issue #19 defence: free any `_McpTest*` nodes the test created, even
	## nested ones. Runs after every test, not just at suite boundaries.
	var scene_root_for_cleanup := _edited_scene_root()
	if scene_root_for_cleanup != null and scene_root_for_cleanup.is_inside_tree():
		_free_mcp_test_nodes_recursive(scene_root_for_cleanup)

	if not script_errors.is_empty():
		var abort_message := "Aborted by SCRIPT ERROR: %s" % "; ".join(script_errors)
		if suite._failed:
			abort_message += " (after assertion failure: %s)" % suite._message
		return {
			"suite": name,
			"test": method_name,
			"passed": false,
			"message": abort_message,
			"assertion_count": suite._assertion_count,
		}

	## A failed assertion always wins over a later skip(): a test that
	## fails and then hits a skip-guard must report the failure.
	if suite._skipped and not suite._failed:
		return {
			"suite": name,
			"test": method_name,
			"passed": true,
			"skipped": true,
			"message": suite._skip_reason,
			"assertion_count": 0,
		}

	var passed := not suite._failed
	var msg := suite._message

	## Warn about zero-assertion tests (likely silently skipped logic).
	if passed and suite._assertion_count == 0:
		passed = false
		msg = "Test completed with 0 assertions (likely skipped its logic)"

	return {
		"suite": name,
		"test": method_name,
		"passed": passed,
		"message": msg,
		"assertion_count": suite._assertion_count,
	}


func get_results(verbose: bool = false) -> Dictionary:
	var passed := 0
	var failed := 0
	var skipped := 0
	var failures: Array[Dictionary] = []
	var suites_seen := {}
	for r in _results:
		suites_seen[r.suite] = true
		if r.get("skipped", false):
			skipped += 1
		elif r.passed:
			passed += 1
		else:
			failed += 1
			failures.append(r)

	var result := {
		"passed": passed,
		"failed": failed,
		"skipped": skipped,
		"total": _results.size(),
		"duration_ms": _last_run_ms,
		"suites_run": suites_seen.keys(),
		"suite_count": suites_seen.size(),
	}

	if not failures.is_empty():
		result["failures"] = failures

	if verbose:
		result["results"] = _results

	return result


func clear() -> void:
	_results.clear()
	_last_run_ms = 0


# ----- discovery -----

## Returns { "suites": Array, "errors": Array[String] }.
## Scans `dir_paths` for `test_*.gd`, loads each with CACHE_MODE_IGNORE so
## a broken file doesn't block discovery of the rest. Sorts by suite_name()
## for deterministic order.
##
## `dir_paths` defaults to project-side `res://tests/` and addon-side
## `res://addons/godot_mcp_server/testing/suites/`.
static func discover_suites(
	dir_paths: Array = ["res://tests", "res://addons/godot_mcp_server/testing/suites"]
) -> Dictionary:
	var suites := []
	var errors: Array[String] = []
	for base_path in dir_paths:
		var base := str(base_path)
		var dir := DirAccess.open(base)
		if dir == null:
			## Missing directory is not an error (project may have no res://tests/).
			continue
		dir.list_dir_begin()
		var file_name := dir.get_next()
		while not file_name.is_empty():
			if file_name.begins_with("test_") and file_name.ends_with(".gd"):
				var path := base + "/" + file_name
				var script = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
				if script == null:
					errors.append("%s (load failed — check for parse errors)" % file_name)
				elif script.can_instantiate():
					var instance = script.new()
					if instance is McpTestSuite:
						suites.append(instance)
					else:
						errors.append("%s (not a McpTestSuite subclass)" % file_name)
				else:
					errors.append("%s (cannot instantiate — abstract or broken)" % file_name)
			file_name = dir.get_next()
	## Sort by suite name for deterministic order.
	suites.sort_custom(func(a, b) -> bool:
		return a.suite_name() < b.suite_name()
	)
	return {"suites": suites, "errors": errors}


# ----- script error capture -----

func _register_capture() -> void:
	if _capture_registered:
		return
	if _script_error_capture == null:
		_script_error_capture = ScriptErrorCapture.new()
	if _script_error_capture == null:
		return
	OS.add_logger(_script_error_capture)
	_capture_registered = true


func _unregister_capture() -> void:
	if not _capture_registered:
		return
	if _script_error_capture == null:
		_capture_registered = false
		return
	OS.remove_logger(_script_error_capture)
	_capture_registered = false


func _begin_script_error_capture() -> void:
	if _script_error_capture != null and _capture_registered:
		_script_error_capture.begin_capture()


func _end_script_error_capture() -> PackedStringArray:
	if _script_error_capture == null or not _capture_registered:
		return PackedStringArray()
	return _script_error_capture.end_capture()


# ----- helpers -----

static func _edited_scene_root() -> Node:
	if not Engine.is_editor_hint():
		return null
	return EditorInterface.get_edited_scene_root()


func _get_test_methods(obj: Object) -> Array[String]:
	var methods: Array[String] = []
	for m in obj.get_method_list():
		var name: String = m.get("name", "")
		if name.begins_with("test_"):
			methods.append(name)
	methods.sort()
	return methods


func _get_children_snapshot(node: Node) -> Array[Node]:
	var children: Array[Node] = []
	for child in node.get_children():
		children.append(child)
	return children


## Remove any nodes in scene_root that weren't present before the suite ran.
## NOTE: bypasses EditorUndoRedoManager by design — the test runner owns
## these leaks and clears them unconditionally.
func _cleanup_leaked_nodes(scene_root: Node, before: Array[Node]) -> void:
	var before_set := {}
	for n in before:
		before_set[n] = true
	for child in scene_root.get_children():
		if not before_set.has(child):
			scene_root.remove_child(child)
			child.queue_free()


## Recursively free every node whose name starts with `_McpTest`, anywhere
## in the scene. Walk breadth-first so we collect victims before mutating.
##
## P3-BLOCKING-FIX-B (2026-08-01 全天审查根治方案): 命名前缀匹配 + meta opt-out 双保险。
## 方案 A（改名 _UndoTestArena）治标；方案 B 让清理函数识别 `_mcp_test_persistent` meta
## 跳过 suite 级 fixture，未来新 suite 用 _McpTest* 前缀命名 + 设 persistent meta 也不会被误清。
## 语义区分：_mcp_test_owned = "runner 可管理"（测试节点+fixture 都设）；
## _mcp_test_persistent = "跨测试保留"（仅 suite fixture 设，suite_teardown 负责释放）。
func _free_mcp_test_nodes_recursive(root: Node) -> void:
	var victims: Array[Node] = []
	var queue: Array[Node] = [root]
	while not queue.is_empty():
		var node: Node = queue.pop_back()
		for child in node.get_children():
			## 命名碰 _McpTest 前缀 + 未标 persistent → 收为 victim（每测试临时节点）
			## 命名碰前缀但标 persistent → suite fixture，跳过（suite_teardown 释放）
			## 不碰前缀 → 继续递归进子树（防嵌套 _McpTest* 漏清）
			if str(child.name).begins_with("_McpTest") and not child.has_meta("_mcp_test_persistent"):
				victims.append(child)
			else:
				queue.append(child)
	for v in victims:
		if v.get_parent() != null:
			v.get_parent().remove_child(v)
		v.queue_free()


static func _parse_exclusions(filter: String) -> Array[String]:
	var out: Array[String] = []
	if filter.is_empty():
		return out
	for part in filter.split(","):
		var trimmed := part.strip_edges()
		if not trimmed.is_empty():
			out.append(trimmed)
	return out


static func _matches_any_exclusion(method_name: String, exclusions: Array[String]) -> bool:
	for ex in exclusions:
		if method_name.find(ex) != -1:
			return true
	return false
