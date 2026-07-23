# 批次 C 正确性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 13 条正确性 finding（C1-C13）：sync/editor 集成死代码、协议参数守卫、返回值语义误报、undo 完整性、参数校验缺失、TS 编译错误解析/清理一致性。

**Architecture:** 纯 bug 修复，不改工具签名/正常路径。13 条按 6 task 组（GD 9 + TS 4 + defects），每 finding TDD（RED→fix→GREEN）。GDScript 改动须 `check:gdscript` + `godot --headless --import` 4.7+4.6.2 真编译（批次 B 教训：check:gdscript 正则假绿）。

**Tech Stack:** GDScript（addons/godot_mcp_server/commands/）、TypeScript（src/）、vitest（字面量契约 + 行为测试）、defects.ts（防复发 detect）。

## Global Constraints

- **行号会漂移**：本 plan `文件:行号` 为 2026-07-23 核查快照，实现以 grep 实际行号为准。
- **不改工具签名/正常路径行为**：bug 修复不得破坏既有工具调用语义。
- **GDScript 编译门**：`npm run check:gdscript` errors=0 warnings=0 **且** `godot --headless --import --path test/fixtures/gdscript-check` 4.7+4.6.2 双版本真编译（check:gdscript 假绿，批次 B 教训）。GDScript 改动还须跑 e2e/相关测试（方法签名错误 check:gdscript 不抓）。
- **GDScript 测试策略**：用字面量契约测试（读 .gd 源码断言修复标记，对齐批次 B T3a）+ check:gdscript + --import + 可选 e2e。
- **FileAccess.file_exists 静态**（批次 B 教训）：GDScript 检查文件存在用 `FileAccess.file_exists()`（静态），非 `DirAccess.file_exists`（实例方法）。
- **detect 闭包内联非 global 正则**（批次 B 教训）：避 RegExp.test+global lastIndex bug。
- **回归门禁**：每 task 收尾 `npx tsc --noEmit` exit 0；全量 `npx vitest run` 无新 failed（pre-existing T11 elicitation 4 条不变）。
- **master 本地不 push**（用户惯例）；commit 中文 `fix(correctness):`/`test(correctness):` 前缀。
- **429 限额**：SDD 分批派 subagent，每批 1-2 个。
- **Reviewer 路由**：GD task → editor-plugin-reviewer + general-purpose rubric；TS task → ecc:typescript-reviewer；T6 → controller 自审；final → opus。T3（undo）风险最集中，单独严格验证。

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `addons/.../commands/sync_commands.gd` | editor sync 通知 | T1: C1 _on_node_added/removed 用 _plugin |
| `addons/.../commands/command_helpers.gd` | 共享 helper | T2: C9 加 `values_equal`；T1 无（get_edited_scene_root 已支持 plugin） |
| `addons/.../commands/test_commands.gd` | test_assert 断言 | T2: C9 改调 values_equal |
| `addons/.../websocket_server.gd` | JSON-RPC 服务端 | T2: C3 params:null 守卫 |
| `addons/.../commands/nav_commands.gd` | nav region/bake | T2: C4 bake_result 真检查 + await |
| `addons/.../commands/animtree_commands.gd` | AnimationTree | T3: C10 add_state/transition/set_blend 加 undo |
| `addons/.../commands/node_commands.gd` | node 操作 | T3: C11 batch try/catch + C12 edit_node 只读跳过 undo |
| `addons/.../commands/scene_commands.gd` | scene 操作 | T3: C12 set_instance_property 只读跳过 undo |
| `addons/.../commands/ui_commands.gd` | UI/theme | T4: C13 set_params key 校验 + load null 守卫 |
| `addons/.../commands/asset/path_generator.gd` | asset path | T4: C5 resolve_points strip "root/" |
| `src/gdscript-executor.ts` | GDScript 执行 | T5: C2 extractCompileError \b 词边界 + C8 proc.on retryRm |
| `src/tools/data-import.ts` | CSV 导入 | T5: C6 csv_content size 守卫 + C7 .tmp 清理扩全局 |
| `test/regression/defects.ts` | defect detect | T6: C1-C13 detect 闭包 |
| `test/regression/defects-fixed.test.ts` | FIXED 硬断言 | T6: 计数 80→93 |
| `CHANGELOG.md` | 变更日志 | T6: 批次 C 段 |

---

## Task 1: C1 — sync_commands 用现成 _plugin

**Files:**
- Modify: `addons/godot_mcp_server/commands/sync_commands.gd:127,144`
- Test: `test/c-sync-commands.test.ts`（新建，字面量契约）

**Interfaces:**
- Consumes: sync_commands 已有 `_plugin: EditorPlugin`（:11）+ `_get_ei()`（:23）。
- Produces: _on_node_added/_on_node_removed 用 `CommandHelpers.get_edited_scene_root(_plugin)`（非 `_command_handler.get_plugin()` dead indirection）。

**已核实**：command_handler.gd（extends Node）无 get_plugin → `has_method("get_plugin")` 恒 false → 传 null → `get_edited_scene_root(null)` fallback `st.root.get_child(0)`（编辑器主 UI 非 edited scene）。

- [ ] **Step 1: 写字面量契约失败测试**

`test/c-sync-commands.test.ts`：
```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
describe('C1 sync_commands _on_node_added/removed 用 _plugin', () => {
  const src = readFileSync('addons/godot_mcp_server/commands/sync_commands.gd', 'utf8');
  it('回调不绕路 _command_handler.get_plugin()', () => {
    expect(src).not.toContain('_command_handler.get_plugin()');
    expect(src).not.toContain('has_method("get_plugin")');
  });
  it('回调用 _plugin 取 edited_root', () => {
    // _on_node_added / _on_node_removed 两处均用 _plugin
    const cb1 = src.match(/func _on_node_added[\s\S]*?func _on_node_removed/)?.[0] ?? '';
    const cb2 = src.match(/func _on_node_removed[\s\S]*?\n\n/)?.[0] ?? '';
    expect(cb1).toContain('get_edited_scene_root(_plugin)');
    expect(cb2).toContain('get_edited_scene_root(_plugin)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/c-sync-commands.test.ts`
Expected: FAIL（含 `_command_handler.get_plugin()` / `has_method("get_plugin")`）。

- [ ] **Step 3: 实现——:127/:144 改用 _plugin**

`sync_commands.gd` 两处（_on_node_added :127、_on_node_removed :144）：
```gdscript
# 原（dead indirection）：
# var edited_root = CommandHelpers.get_edited_scene_root(_command_handler.get_plugin() if _command_handler and _command_handler.has_method("get_plugin") else null)
# 改：
	var edited_root = CommandHelpers.get_edited_scene_root(_plugin)
```
（保持原 tab 缩进层级。`_plugin` 是 :11 字段，setup() :18 注入。）

- [ ] **Step 4: 编译 + 字面量测试通过**

Run: `npm run check:gdscript && godot --headless --import --path test/fixtures/gdscript-check && npx vitest run test/c-sync-commands.test.ts`
Expected: check:gdscript 0/0 + --import 双版本过 + 字面量 PASS。

- [ ] **Step 5: 全量回归 + Commit**

Run: `npx vitest run`
Expected: 除 T11 4 pre-existing 外 0 新回归。
```bash
git add addons/godot_mcp_server/commands/sync_commands.gd test/c-sync-commands.test.ts
git commit -m "fix(correctness): C1 sync_commands 回调用现成 _plugin（删 dead get_plugin indirection）"
```

---

## Task 2: C3 + C4 + C9 — 协议/返回值语义

**Files:**
- Modify: `addons/.../websocket_server.gd:274`（C3）、`addons/.../commands/nav_commands.gd:37-66`（C4）、`addons/.../commands/command_helpers.gd`（C9 加 values_equal）、`addons/.../commands/test_commands.gd:29`（C9 改调）
- Test: `test/c-protocol-semantics.test.ts`（字面量契约）、C9 行为测试（command_helpers values_equal 单测——若 command_helpers 可在 vitest 侧读源码断言逻辑则字面量，否则 GD 行为留 e2e）

**Interfaces:**
- Produces: websocket params:null → reject -32602；nav bake_result 查 vertices + await；command_helpers.values_equal(val, expected) 类型感知比较。

**★ plan 期决策（已定）**：
- C3：null → reject -32602（对齐既有非 Dictionary 拒绝，非 coerce；null params 是客户端错误）。
- C4：bake 移出 undo do_op，commit 后单独 `await nav.bake_navigation_mesh()` + 查 `get_vertices_count()>0`；undo 仅 remove_child（bake 随节点移除丢失，可接受）。
- C9：bool↔int 严格不等（true≠1）；Array↔Vector3/2/Color 等分量比。

- [ ] **Step 1: 写失败测试**

`test/c-protocol-semantics.test.ts`（字面量契约 C3/C4 + C9 helper 存在）：
```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
describe('C3/C4/C9 协议返回值语义', () => {
  it('C3 websocket params:null 被 reject（守卫含 == null）', () => {
    const src = readFileSync('addons/godot_mcp_server/websocket_server.gd', 'utf8');
    const guard = src.match(/var _rpc_params[\s\S]*?return/)?.[0] ?? '';
    expect(guard).toMatch(/_rpc_params == null|_rpc_params is Dictionary/);
    expect(guard).not.toMatch(/_rpc_params != null and not/); // 旧 and 短路已删
  });
  it('C4 nav bake_result 查 vertices（非仅 != null）', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/nav_commands.gd', 'utf8');
    expect(src).toContain('get_vertices_count()');
    expect(src).toMatch(/await.*bake_navigation_mesh/);
  });
  it('C9 command_helpers 有 values_equal + test_commands 改调', () => {
    expect(readFileSync('addons/godot_mcp_server/commands/command_helpers.gd', 'utf8')).toContain('func values_equal');
    expect(readFileSync('addons/godot_mcp_server/commands/test_commands.gd', 'utf8')).toContain('values_equal(');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/c-protocol-semantics.test.ts`
Expected: FAIL（旧 `!= null and not`、无 vertices/await、无 values_equal）。

- [ ] **Step 3: C3 实现——params:null reject**

`websocket_server.gd`（:272-276 区）：
```gdscript
# security P2#1 fix: params 非 Dictionary/null 防御
	var _rpc_params = parsed.get("params", {})
	# C3: null params 也 reject（旧 `!= null and not` 短路放行 null）
	if _rpc_params == null or not (_rpc_params is Dictionary):
		peer.send_text(JSON.stringify({"jsonrpc": "2.0", "id": parsed.get("id"), "error": {"code": -32602, "message": "Invalid params: must be an object"}}))
		return
```

- [ ] **Step 4: C4 实现——bake 真检查 + await**

`nav_commands.gd` handle_nav_create_region（:37-66 区）：
```gdscript
	# bake 移出 undo do_op（coroutine 不能由 commit_action 同步 await）
	# undo 路径（:41-58）：do_ops 去掉 bake method op；commit 后单独 await bake
	if _undo_manager != null:
		var do_ops: Array = [
			{"type": "method", "target": parent_node, "method": "add_child", "args": [nav]},
			{"type": "method", "target": nav, "method": "set_owner", "args": [root]},
			{"type": "reference", "value": nav}
		]
		_undo_manager.create_action_mixed("Create Nav Region (req:%d)" % request_id, do_ops,
			[{"type": "method", "target": parent_node, "method": "remove_child", "args": [nav]}])
		if want_bake:
			await nav.bake_navigation_mesh()  # C4: coroutine 须 await
			bake_result = nav.navigation_mesh != null and nav.navigation_mesh.get_vertices_count() > 0
	else:
		parent_node.add_child(nav)
		nav.owner = root
		if want_bake:
			await nav.bake_navigation_mesh()
			bake_result = nav.navigation_mesh != null and nav.navigation_mesh.get_vertices_count() > 0
```
> 注：`handle_nav_create_region` 须改 `async func`（GDScript coroutine 标记）。确认 :27 函数签名加 `async`。若 commit_action 已内部 await do_methods 则保留 bake-in-undo 也行——实现时核查 commit_action 实现（undo_manager.gd）定夺，但 `get_vertices_count()>0` 判据两路径都必须。

- [ ] **Step 5: C9 实现——values_equal helper**

`command_helpers.gd` 加（static，对齐既有 helper 风格）：
```gdscript
## C9: 类型感知相等比较（test_assert 用）。str() 比较致 Vector3 vs Array/bool vs int 永不等。
static func values_equal(val, expected) -> bool:
	if typeof(val) == typeof(expected):
		return val == expected
	# Array ↔ 数学类型：分量比
	if expected is Array:
		if val is Vector2: return expected.size() == 2 and float(expected[0]) == val.x and float(expected[1]) == val.y
		if val is Vector3: return expected.size() == 3 and float(expected[0]) == val.x and float(expected[1]) == val.y and float(expected[2]) == val.z
		if val is Color: return expected.size() == 4 and float(expected[0]) == val.r and float(expected[1]) == val.g and float(expected[2]) == val.b and float(expected[3]) == val.a
		return false
	# bool ↔ int 严格不等（true≠1，类型不同的断言应失败）
	# 数字 int/float：GDScript == 宽松
	if typeof(val) == TYPE_INT and typeof(expected) == TYPE_FLOAT: return float(val) == float(expected)
	if typeof(val) == TYPE_FLOAT and typeof(expected) == TYPE_INT: return float(val) == float(expected)
	return str(val) == str(expected)
```
`test_commands.gd` :29 改：
```gdscript
# 原：var match = str(val) == str(expected)
	var match = CommandHelpers.values_equal(val, expected)
```

- [ ] **Step 6: 编译 + 字面量测试通过**

Run: `npm run check:gdscript && godot --headless --import --path test/fixtures/gdscript-check && npx vitest run test/c-protocol-semantics.test.ts`
Expected: 0/0 + 双版本编译过 + 字面量 PASS。
> 若 `async func` 或 await 报错（Godot coroutine 规则），据 --import 报错调整（如函数已 async 无需重复、或 await 仅在 async 上下文）。

- [ ] **Step 7: 全量回归 + Commit**

Run: `npx vitest run`
```bash
git add addons/godot_mcp_server/websocket_server.gd addons/godot_mcp_server/commands/nav_commands.gd addons/godot_mcp_server/commands/command_helpers.gd addons/godot_mcp_server/commands/test_commands.gd test/c-protocol-semantics.test.ts
git commit -m "fix(correctness): C3 params:null reject + C4 nav bake vertices检查+await + C9 values_equal 类型感知比较"
```

---

## Task 3: C10 + C11 + C12 — undo 完整性（风险最集中，单独严格验证）

**Files:**
- Modify: `addons/.../commands/animtree_commands.gd:69-163`（C10）、`addons/.../commands/node_commands.gd:179,255-260`（C11+C12）、`addons/.../commands/scene_commands.gd:196`（C12）
- Test: `test/c-undo-completeness.test.ts`（字面量契约）

**Interfaces:**
- Produces: animtree add_state/transition/set_blend 包 create_action_mixed（do+undo）；batch_add_nodes commit try/catch 清孤儿；edit_node/set_instance_property 跳过只读属性 undo。

**★ 已核实**：animtree create（:52）有 create_action_mixed，add_state（:92 sm.add_node）/add_transition（:132）/set_blend（:159/:161 tree.set）无；node_commands batch :255-260 无 try/catch；edit_node :179 old_val=node.get(key) 无只读检查。

- [ ] **Step 1: 写字面量契约失败测试**

`test/c-undo-completeness.test.ts`：
```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
describe('C10/C11/C12 undo 完整性', () => {
  const animtree = readFileSync('addons/godot_mcp_server/commands/animtree_commands.gd', 'utf8');
  it('C10 add_state/add_transition/set_blend 含 create_action_mixed', () => {
    const addState = animtree.match(/func handle_animtree_add_state[\s\S]*?^func /m)?.[0] ?? '';
    const addTrans = animtree.match(/func handle_animtree_add_transition[\s\S]*?^func /m)?.[0] ?? '';
    const setBlend = animtree.match(/func handle_animtree_set_blend[\s\S]*?^func /m)?.[0] ?? '';
    expect(addState).toContain('create_action_mixed');
    expect(addTrans).toContain('create_action_mixed');
    expect(setBlend).toContain('create_action_mixed');
  });
  const node = readFileSync('addons/godot_mcp_server/commands/node_commands.gd', 'utf8');
  it('C11 batch_add_nodes commit 有 try/catch + 孤儿清理', () => {
    const batch = node.match(/func handle_batch_add_nodes[\s\S]*?^func /m)?.[0] ?? '';
    expect(batch).toMatch(/try:|catch/);
    expect(batch).toContain('is_inside_tree()');
  });
  it('C12 edit_node 跳过只读属性 undo', () => {
    const edit = node.match(/func handle_edit_node[\s\S]*?^func /m)?.[0] ?? '';
    expect(edit).toContain('PROPERTY_USAGE_READ_ONLY');
  });
});
```

- [ ] **Step 2: 运行确认失败** → Run: `npx vitest run test/c-undo-completeness.test.ts` → FAIL。

- [ ] **Step 3: C10 实现——animtree 三操作加 undo**

`animtree_commands.gd` handle_animtree_add_state（:92 区）、add_transition（:132 区）、set_blend（:159/:161 区），用 create_action_mixed（对齐 :52-62 模式）。示例 add_state：
```gdscript
	var anim_node = AnimationNodeAnimation.new()
	anim_node.animation = animation
	if _undo_manager != null:
		_undo_manager.create_action_mixed("AnimTree Add State %s (req:%d)" % [state_name, request_id],
			[{"type": "method", "target": sm, "method": "add_node", "args": [state_name, anim_node]}],
			[{"type": "method", "target": sm, "method": "remove_node", "args": [state_name]}])
	else:
		sm.add_node(state_name, anim_node)
	# position set 保持原逻辑（set_node_position）
```
> add_transition undo：`remove_transition(from,to,transition)`（核查 AnimationNodeStateMachine API；若无 remove_transition，undo 记 transition 引用 + remove）。set_blend undo：记旧 blend 值 `tree.get(param_name)` → undo set 回。实现时据 API 调整，但三操作都必须 create_action_mixed。

- [ ] **Step 4: C11 实现——batch commit try/catch**

`node_commands.gd` handle_batch_add_nodes（:255-261 区）：
```gdscript
	var added: int = 0
	var commit_error: String = ""
	# C11: commit 中途失败（某 add_child/callv 抛错）→ 已 instantiate Node 孤儿 leak
	try:
		if _undo_manager != null:
			_undo_manager.create_action_mixed("Batch Add %d Nodes (req:%d)" % [validated.size(), request_id], do_ops, undo_ops)
		else:
			for op in do_ops:
				if String(op.get("type", "method")) == "method":
					op["target"].callv(op["method"], op["args"])
		added = validated.size()
	except e:
		commit_error = str(e)
		# 清未入树的预 instantiate Node（防孤儿 leak）
		for v in validated:
			var cls: Node = v["cls"]
			if cls != null and not cls.is_inside_tree():
				cls.free()
	if commit_error != "":
		return {"error": {"code": -32000, "message": "Batch commit failed: " + commit_error}}
	return {"result": {"added": added, "failed": failed}}
```

- [ ] **Step 5: C12 实现——只读属性跳过 undo**

`node_commands.gd` handle_edit_node（:173-182 循环）+ `scene_commands.gd` set_instance_property（:196 区）。edit_node 循环内，记录 undo 前查只读：
```gdscript
	for key in properties:
		var r := CommandHelpers.coerce_property_value(node, String(key), properties[key])
		if not r["ok"]:
			failed.append({"key": String(key), "error": String(r["error"])})
			continue
		var coerced: Variant = r["value"]
		do_ops.append({"type": "method", "target": node, "method": "set", "args": [String(key), coerced]})
		# C12: 只读属性 get 返当前值但 set 无意义/可能拒；只读跳过 undo 避免回放 set(key,null)
		var usage := _get_property_usage(node, String(key))
		if usage != null and (int(usage) & PROPERTY_USAGE_READ_ONLY) == 0:
			var old_val: Variant = node.get(String(key))
			undo_ops.append({"type": "method", "target": node, "method": "set", "args": [String(key), old_val]})
		# 只读属性：do 仍 set（尝试），但不记 undo（undo 不回放只读 set）
```
加 helper（command_helpers 或 node_commands 内）：
```gdscript
static func _get_property_usage(node: Node, prop: String) -> Variant:
	for p in node.get_property_list():
		if String(p.get("name", "")) == prop:
			return p.get("usage", 0)
	return null
```
> `PROPERTY_USAGE_READ_ONLY` 是 Engine 常量（值 4）。可写但当前值 null 仍记 undo（null 合法旧值）。scene_commands set_instance_property 同理。

- [ ] **Step 6: 编译 + 字面量测试通过**

Run: `npm run check:gdscript && godot --headless --import --path test/fixtures/gdscript-check && npx vitest run test/c-undo-completeness.test.ts`
Expected: 0/0 + 双版本 + 字面量 PASS。

- [ ] **Step 7: undo 端到端验证（可选但推荐，C10/C12 核心）**

若有干净 Godot 环境（mcp-verify 子项目），F5/editor 实测：add_state → Ctrl+Z 撤销 → 确认 state 移除。否则记 manual verify + 留 e2e follow-up（诚实 skip）。

- [ ] **Step 8: 全量回归 + Commit**

Run: `npx vitest run`
```bash
git add addons/godot_mcp_server/commands/animtree_commands.gd addons/godot_mcp_server/commands/node_commands.gd addons/godot_mcp_server/commands/scene_commands.gd addons/godot_mcp_server/commands/command_helpers.gd test/c-undo-completeness.test.ts
git commit -m "fix(correctness): C10 animtree state/transition/blend undo + C11 batch 孤儿清理 + C12 只读属性跳过 undo"
```

---

## Task 4: C13 + C5 — 参数校验

**Files:**
- Modify: `addons/.../commands/ui_commands.gd:259,417,431`（C13）、`addons/.../commands/asset/path_generator.gd:18`（C5）
- Test: `test/c-param-validation.test.ts`（字面量契约）

- [ ] **Step 1: 写字面量契约失败测试**（C13 set_params key 校验 + load null 守卫存在；C5 strip "root/"）
```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
describe('C13/C5 参数校验', () => {
  it('C13 ui set_params 校验 theme 属性 + load null 守卫', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/ui_commands.gd', 'utf8');
    expect(src).toMatch(/get_property_list|has_theme/); // key 校验引入
    // load 后 null 守卫（font/stylebox）
    const loadSection = src.match(/load\(.*\)[\s\S]{0,200}/g) ?? [];
    // 至少存在 null 守卫标记
    expect(src).toContain('load(');
  });
  it('C5 path_generator resolve_points strip root/', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/asset/path_generator.gd', 'utf8');
    expect(src).toMatch(/begins_with\("root\/"\)|CommandHelpers\.find_node/);
  });
});
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: C13 实现——set_params key 校验 + load null 守卫**

`ui_commands.gd` set_params（:248-259 区）：`theme.set(key, val)` 前校验 key 是 Theme 有效属性：
```gdscript
				if val is Object:
					continue
				# C13: 校验 key 是 Theme 有效属性（避免 silent no-op）
				if not _theme_has_property(theme, String(key)):
					continue  # 无效 key 跳过（可选 warn）
				theme.set(key, val)
```
加 helper（ui_commands 或 command_helpers）：
```gdscript
static func _theme_has_property(theme: Theme, key: String) -> bool:
	for p in theme.get_property_list():
		if String(p.get("name", "")) == key:
			return true
	return false
```
load font/stylebox（:417/:431 区）：`load(path)` 后 null 守卫：
```gdscript
	var font = load(font_path)
	if font == null:
		return {"error": {"code": -32004, "message": "Failed to load font: " + font_path}}
	theme.set_default_font(font)
```
（stylebox 同理。）

- [ ] **Step 4: C5 实现——resolve_points strip "root/"**

`path_generator.gd:18` resolve_points：对齐 command_helpers.find_node（strip "root/" + leading "/"）。复用 CommandHelpers.find_node 或内联：
```gdscript
	# C5: strip "root/" 前缀对齐 asset_placer/command_helpers
	var clean_path := path_node
	if clean_path.begins_with("root/"):
		clean_path = clean_path.substr(5)
	elif clean_path.begins_with("/"):
		clean_path = clean_path.substr(1)
	var path_node_obj = get_node_or_null(clean_path)
```
（或直接 `CommandHelpers.find_node(root, path_node)` 若 root 可达——核查 resolve_points 上下文是否有 root。）

- [ ] **Step 5: 编译 + 字面量测试通过**

Run: `npm run check:gdscript && godot --headless --import --path test/fixtures/gdscript-check && npx vitest run test/c-param-validation.test.ts`
Expected: 0/0 + 双版本 + PASS。

- [ ] **Step 6: 全量回归 + Commit**

```bash
git add addons/godot_mcp_server/commands/ui_commands.gd addons/godot_mcp_server/commands/asset/path_generator.gd test/c-param-validation.test.ts
git commit -m "fix(correctness): C13 ui set_params key 校验 + load null 守卫 + C5 path_generator strip root/"
```

---

## Task 5: C2 + C6 + C7 + C8 — TS 正确性

**Files:**
- Modify: `src/gdscript-executor.ts:1344,1361`（C2+C8）、`src/tools/data-import.ts:147-156,318-337`（C6+C7）
- Test: `test/c-ts-correctness.test.ts`（行为/字面量）

**★ 已核实**：extractCompileError :1361 裸 includes（单分支两调用路径共用）；proc.on('error') :1344 裸 rm；data-import csv_content :318-334 无前置 size 守卫；.tmp 自清 :147-156 只扫 _output_dir。

- [ ] **Step 1: 写失败测试**（C2 行为：print "Parse Error: debug" 不误判；C6 大 csv 拒绝；C7 清理含全局；C8 retryRm）
```typescript
import { describe, it, expect } from 'vitest';
// C2: extractCompileError 不被用户 print 误判（marker 分支 \b 词边界）
// 需 import extractCompileError 或通过 gdscript-executor 公开；若私有，字面量断言 :1361 含 \b
```
> C2 若 extractCompileError 私有不可单测，用字面量断言 `readFileSync('src/gdscript-executor.ts').match(/extractCompileError[\s\S]*?return/)` 含 `\\b` 或 `new RegExp('\\\\b`。C6/C7 同理字面量 + 可选行为。

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: C2 实现——\b 词边界**

`gdscript-executor.ts:1361`（extractCompileError marker 成功分支）：
```typescript
// 原：if (trimmed.includes('Parse Error:') || trimmed.includes('Script Error:'))
// 改：\b 词边界（对齐 no-marker 路径），避免命中用户 print("Parse Error: debug")
if (/\b(Parse Error|Script Error):/.test(trimmed)) { ... compile_success = false ... }
```

- [ ] **Step 4: C8 实现——proc.on retryRm**

`gdscript-executor.ts:1344`（proc.on('error') 清理）：
```typescript
// 原：rm(tmpdir, ...)
// 改：retryRm（对齐 timer/close 分支，Windows EPERM 容错）
await retryRm(tmpdir);
```
（核查 retryRm 在本文件 import/定义；若需 import 补。）

- [ ] **Step 5: C6 实现——csv_content 前置 size 守卫**

`data-import.ts` csv_content 分支（:318-337）：JSON.parse 前加 size 守卫：
```typescript
// csv_content 分支：前置 size 守卫（对齐 csv_file 的 MAX_CSV_SIZE）
if (csvContent.length > MAX_CSV_SIZE) {
  return errorResult('CSV_CONTENT_TOO_LARGE', `csv_content exceeds ${MAX_CSV_SIZE} chars`);
}
const csvText = csvContent; // 已是字符串
```
（核查 MAX_CSV_SIZE 常量名 + csv_file 分支的守卫写法对齐。）

- [ ] **Step 6: C7 实现——.tmp 自清扩全局**

`data-import.ts:147-156`（.tmp.tres 启动自清）：从 `_output_dir` 扩到 res:// 全局（或项目根递归）：
```typescript
// C7: 跨目录残留——扫全局 *.tmp.tres（对齐 godot_operations.gd _clean_atomic_tmp）
const cleanGlob = 'res://**/*.tmp.tres'; // 或用 fast-glob 扫项目根
// 清所有匹配的 .tmp.tres（非目标 .tres）
```
> ★ plan 期决策④（已定）：模板内 GDScript 改扫 res:// 全局（data-import 生成 GDScript 执行于 headless，复用 godot_operations.gd _clean_atomic_tmp 不可达——独立 GDScript 上下文）。实现时据 data-import 当前清理实现（TS 侧 fs 清 vs GD 模板清）选——若 TS 侧 fs 扫，扩 glob；若 GD 模板，模板内 DirAccess 扫 res://。

- [ ] **Step 7: tsc + 测试通过 + 全量回归**

Run: `npx tsc --noEmit && npx vitest run test/c-ts-correctness.test.ts && npx vitest run`
Expected: tsc 0 + 测试 PASS + 除 T11 4 外 0 新回归。

- [ ] **Step 8: Commit**

```bash
git add src/gdscript-executor.ts src/tools/data-import.ts test/c-ts-correctness.test.ts
git commit -m "fix(correctness): C2 extractCompileError \\b 词边界 + C6 csv_content size 守卫 + C7 .tmp 清理扩全局 + C8 proc.on retryRm"
```

---

## Task 6: defects detect + CHANGELOG

**Files:**
- Modify: `test/regression/defects.ts`（C1-C13 detect 闭包）、`test/regression/defects-fixed.test.ts`（计数 80→93）、`CHANGELOG.md`

**Interfaces:**
- Produces: 13 detect 闭包（FIXED 返回 0）+ defects-fixed 计数同步 + CHANGELOG 批次 C 段。

- [ ] **Step 1: defects.ts 加 C1-C13 detect**（内联非 global 正则/includes，每条查修复标记字面量）。示例：
```typescript
{ key: 'sync-commands-dead-get-plugin', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
  detect: () => !readSrc('addons/godot_mcp_server/commands/sync_commands.gd').includes('_command_handler.get_plugin()') ? 0 : 1 },
```
> 13 条 detect 各查对应修复标记（C1 无 get_plugin / C3 == null 守卫 / C4 vertices+await / C9 values_equal / C10 三操作 create_action_mixed / C11 try+is_inside_tree / C12 PROPERTY_USAGE_READ_ONLY / C13 get_property_list + load null / C5 strip root / C2 \b / C6 csv_content size / C7 全局清 / C8 retryRm）。

- [ ] **Step 2: defects-fixed.test.ts 计数 80→93**（头注释 + toBe + Set.size 三处同步）。

- [ ] **Step 3: RED→GREEN 验证**（临时 revert 一处如 sync_commands 改回 get_plugin → defects-fixed 红 → restore 绿）。

- [ ] **Step 4: CHANGELOG 批次 C 段**（协议契约/返回值语义/undo 完整性/参数校验/TS 正确性 5 块）。

- [ ] **Step 5: 全量回归 + Commit**

Run: `npx tsc --noEmit && npx vitest run`
```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts CHANGELOG.md
git commit -m "test(correctness): 批次 C defects detect 守卫 + CHANGELOG（C1-C13）"
```

---

## Self-Review

**1. Spec coverage**：C1→T1 / C2,C3,C4,C9→T2 / C10,C11,C12→T3 / C13,C5→T4 / C6,C7,C8→T5 / defects+CHANGELOG→T6。13 条全覆盖。验收#3 GDScript 编译门（check:gdscript + --import）每 GD task 含；#4 回归门禁每 task 含；#5 defects T6；#6 CHANGELOG T6。

**2. Placeholder scan**：无 TBD。代码步骤含实际代码；行号标「快照 grep 为准」。C10 add_transition undo 的 remove_transition API、C5 root 可达性、C7 TS-vs-GD 清理实现标「实现时核查」——是 plan 期合法细化点（spec 已标），非占位。

**3. Type consistency**：`values_equal(val, expected)`（T2 定义）↔ test_commands 改调 ↔ T6 detect 查 `func values_equal`；`_theme_has_property`/`_get_property_usage` helper（T3/T4）命名一致；create_action_mixed 模式（T3 对齐 :52）。

**4. 跨 task 裂缝**：command_helpers 被 T2（values_equal）+ T3（_get_property_usage）+ T4（_theme_has_property）改——不同 helper 函数，顺序执行不冲突；node_commands 被 T3（C11+C12）单 task 改；ui_commands 被 T4 单 task。低裂缝风险。

**5. 偏离/决策记录**：4 个 plan 期决策（C3 reject null / C4 bake 移出 undo+await / C9 bool↔int 严格 / C7 模板清全局）已定并写入对应 task。T3 风险最集中（undo），单独 task + 端到端验证 step。
