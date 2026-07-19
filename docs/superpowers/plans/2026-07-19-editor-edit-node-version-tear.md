# editor edit_node/batch_add_nodes 版本撕裂修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** editor 模式下 edit_node / batch_add_nodes / add_node(properties) 路由到 editor 内存 handler（带 UndoRedo），消除"headless 子进程改盘 vs editor 内存旧场景"的版本撕裂；editor 未连接时 fallback headless 路径加 checkEditorSceneSave 守卫防覆盖。

**Architecture:** `command_helpers.gd` 加 `coerce_property_value` 统一 helper（只 coerce 不 set，返 `{ok,value,error}`——与 headless `_set_property_with_coerce` 内置 set 刻意不对称，因 editor 要 per-property undo）；`node_commands.gd` 新增 `handle_edit_node` / `handle_batch_add_nodes` + 改 `handle_add_node` 补 properties，全部走 `_undo_manager.create_action_mixed`（op 显式 `type:"method"`，method:"set" 经 `undo_manager.gd:55 callv` spread 避历史 vararg 坑）；`editor-method-map.ts` 登记 edit_node/batch_add_nodes 打通 editor 路由；`command_handler.gd` match 加两分支；`index.ts` edit_node/batch case 的 headless fallback 路径加 `checkEditorSceneSave` 守卫（对齐 add_node:155-158）。

**Tech Stack:** GDScript 4.7（addons/godot_mcp_server/，editor addon）、TypeScript（src/core/editor-method-map.ts、src/tools/scene/index.ts）、vitest、defects.ts CI 门禁、check:gdscript

## Global Constraints

- Godot 4.7 API（`EditorInterface.get_edited_scene_root` / `ClassDB.instantiate` / `Object.get_property_list` / `load` / `UndoRedo`）
- **行号基于 2026-07-19 核实，每个 Task Step 1 前必须 re-grep/读确认**（代码可能漂移）：`node_commands.gd:29-129`、`command_handler.gd:104-117`、`command_helpers.gd:49/140/169`、`editor-method-map.ts:65-72`、`index.ts:145-158/316-345/347-375`、`undo_manager.gd:35-95`
- **前置 spec A 已闭环**（`f35a3ef`..`d3461b7`，headless 侧 `_set_property_with_coerce` + edit_node 持久化 + instance 入 `_BLOCKED_PROPERTIES`）；本 plan 仅 editor 侧 + TS 守卫，**不动 headless 代码**
- **op dict 显式带 `type` 字段**（对齐 `node_commands.gd:66` 先例，不靠 `undo_manager.gd:66` 的缺省 "method" 兜底）
- **coerce_property_value 与 headless `_set_property_with_coerce` 逻辑重复是已知技术债**（GDScript 无跨 addon/进程 import，靠 defects.ts 双向 detect 防漂移）
- **不自动 save_scene**（对齐 handle_add_node/remove_node 改内存不 save 惯例，落盘交 Ctrl+S / save_scene 工具）
- **不改 index.ts:323 batch 名字黑名单**（历史遗留；editor handler 统一白名单 `^[A-Za-z0-9_]+$`，editor 白/head 黑不一致记 follow-up defect）
- 本地 commit **不 push**（项目惯例，用户显式确认才 push）
- commit message 结尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`

## 测试分层（GD 测试基础设施现状，对齐 spec A plan）

项目 GD 行为测试基础设施薄弱，务实分层：
- **GD 编译层**：`npm run check:gdscript`（验证语法编译 4.7 + 4.6.2，不验证行为）
- **TS 逻辑层**：vitest（editor-method-map 登记、index.ts 守卫接线 mock checkEditorSceneSave）
- **静态 detect 层**：`test/regression/defects.ts` grep detect（CI 门禁防复发，editor 版 baseline）
- **行为集成层**（手动 / L2，需 editor 环境）：editor 打开场景 → edit_node 改资源属性 → 内存生效 + undo 还原 + 不走 spawnGodot。记 defects.ts 注释作手动验收点

---

## Task 1: `coerce_property_value` + `BLOCKED_PROPERTIES`（command_helpers.gd）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\command_helpers.gd`（`coerce_value_for_property` 函数 :169 `return val` 之后、`_count_number_components` :174 之前插入 const + 静态方法）
- Test: `npm run check:gdscript` + `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts` 登记 detect

**Interfaces:**
- Produces: `CommandHelpers.coerce_property_value(obj: Object, prop: String, val: Variant) -> Dictionary`（返 `{"ok": bool, "value": Variant, "error": String}`，ok=true 时 value 是 coerce 后值，ok=false 时 value=null + error 填原因）；`CommandHelpers.BLOCKED_PROPERTIES`（Array[String]）。Task 2/3/4 消费。
- Consumes: `CommandHelpers.has_path_traversal`(:49)、`CommandHelpers.coerce_value_for_property`(:140)

- [ ] **Step 1: re-grep 确认插入点 + 现有签名**

Run: `grep -n "static func coerce_value_for_property\|static func _count_number_components\|static func has_path_traversal" "D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/commands/command_helpers.gd"`
Expected: 三行行号（约 140 / 174 / 49），确认 `coerce_property_value` 插在 :169 与 :174 之间。

- [ ] **Step 2: 加 BLOCKED_PROPERTIES + coerce_property_value**

在 `coerce_value_for_property` 函数结尾（`return val`，约 :169）之后插入：

```gdscript


## editor 侧 BLOCKED_PROPERTIES —— 对齐 headless godot_operations.gd BLOCKED_PROPERTIES + TS BLOCKED_PROPS。
## instance 额外在 coerce_property_value 内双保险拒绝（I-2: 可注入 ExtResource 实例化恶意场景 _ready）。
const BLOCKED_PROPERTIES := [
	"script", "owner", "process_mode", "process_priority", "process_input",
	"process_unhandled_input", "process_unhandled_key_input", "process_internal",
	"physics_process_mode", "physics_interpolation_mode", "name", "meta",
	"input_event", "ready", "tree_entered", "tree_exited", "tree_exiting",
	"instance",  # I-2: instance 可注入 ExtResource 实例化恶意场景 _ready，与 script 同级危险
]


## 统一 property coerce（editor 侧）。关键不对称：只 coerce 不 set（返 {"ok","value","error"}），
## set 由 handler 经 undo 系统 do_op 执行——editor 要 per-property undo（do=set new / undo=set old），
## helper 内置 set 会与 do_op 重复执行。与 headless _set_property_with_coerce（godot_operations.gd，
## 内置 set 因 headless 无 per-property undo、走整场景 pack+save）刻意不对称。靠 defects.ts 双向 detect 防漂移。
static func coerce_property_value(obj: Object, prop: String, val: Variant) -> Dictionary:
	# 1. BLOCKED 过滤 + instance 双保险（即使漏加 BLOCKED_PROPERTIES 也拒）
	if prop in BLOCKED_PROPERTIES or prop == "instance":
		return {"ok": false, "value": null, "error": "Blocked property: %s" % prop}
	# 2. 属性存在性 + 取声明类型
	var prop_type := -1
	for p in obj.get_property_list():
		if String(p.get("name", "")) == prop:
			prop_type = int(p.get("type", TYPE_NIL))
			break
	if prop_type == -1:
		return {"ok": false, "value": null, "error": "Property not found: %s on %s" % [prop, obj.get_class()]}
	# 3. 类型分支（严格对齐 headless _set_property_with_coerce 语义，消除 editor/headless 撕裂）
	var coerced: Variant = val
	if prop_type == TYPE_OBJECT:
		if val is String and val.begins_with("res://"):
			if has_path_traversal(val):
				return {"ok": false, "value": null, "error": "Path traversal blocked: %s" % val}
			coerced = load(val)
			if coerced == null:
				return {"ok": false, "value": null, "error": "Failed to load resource: %s" % val}
		elif val is String:
			# Resource 属性传非 res:// String → 非静默拒绝（对齐 headless，修 batch silently fail 同根因）
			return {"ok": false, "value": null, "error": "Property %s expects Resource, got plain String '%s' (use res:// path)" % [prop, val]}
		# val 非 String → 透传（JSON 无法表达 Resource 实例，交 Godot set 处理，与 headless 一致）
	else:
		# 非 TYPE_OBJECT：Array 走数学类型 coerce（Vector2/3/Color...），非 Array 透传
		coerced = coerce_value_for_property(obj, prop, val)
	return {"ok": true, "value": coerced, "error": ""}
```

- [ ] **Step 3: check:gdscript 验证编译**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0（const + helper 编译通过，4.7 + 4.6.2）

- [ ] **Step 4: defects.ts 登记 editor 侧 detect**

在 `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts` 的 FIXED 段（`export const FIXED_DEFECTS` 或同名数组，参照 spec A 已加的 `resource-prop-coerce-helper`/`instance-property-blocked-gd` 项格式）加：

```ts
  // spec editor-version-tear §1: editor 侧 coerce_property_value 统一 helper（只 coerce 不 set，
  // 与 headless _set_property_with_coerce 刻意不对称——editor 要 per-property undo）。
  // detect: command_helpers.gd 含 coerce_property_value 定义 + instance 双保险分支。
  { key: 'editor-coerce-property-value', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const f = readSrc('addons/godot_mcp_server/commands/command_helpers.gd');
      const hasDef = /static func coerce_property_value\(obj: Object, prop: String, val: Variant\) -> Dictionary:/.test(f);
      const hasInstanceGuard = /prop in BLOCKED_PROPERTIES or prop == "instance"/.test(f);
      return hasDef && hasInstanceGuard ? 0 : 1;
    } },
```

- [ ] **Step 5: 跑 defects 确认 detect=0**

Run: `npx vitest run test/regression`（或项目既定 defects 跑法，参照 spec A）
Expected: `editor-coerce-property-value` detect=0（通过）

- [ ] **Step 6: commit**

```bash
git add addons/godot_mcp_server/commands/command_helpers.gd test/regression/defects.ts
git commit -m "feat(gd): editor coerce_property_value helper（只 coerce 不 set，对齐 headless 语义）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `handle_edit_node`（node_commands.gd 新增）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\node_commands.gd`（`handle_remove_node` 函数结尾 :129 `return ...` 之后、`_is_allowed_node_type` :132 之前插入新 handler）
- Test: `npm run check:gdscript` + defects.ts detect

**Interfaces:**
- Consumes: Task 1 `CommandHelpers.coerce_property_value`、`CommandHelpers.find_node`(:29)、`CommandHelpers.has_path_traversal`(:49)；node_commands.gd 现有 `_get_ei()`（handle_add_node:30 已用）、`_undo_manager`（:63 已用）
- Produces: `handle_edit_node(params: Dictionary, request_id: int) -> Dictionary`（返 `{"result": {node_path, updated, failed}}` 或 `{"error": {code, message}}`）。Task 5 command_handler 分支调用。

- [ ] **Step 1: re-grep 确认 node_commands.gd 现有成员可用**

Run: `grep -n "func _get_ei\|var _undo_manager\|func handle_remove_node\|func _is_allowed_node_type" "D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/commands/node_commands.gd"`
Expected: 四个定义都存在（`_get_ei`/`_undo_manager` 复用 handle_add_node/handle_remove_node 先例）。若 `_get_ei` 在基类，grep 整个 addons 确认。

- [ ] **Step 2: 加 handle_edit_node 函数**

在 `handle_remove_node` 函数结尾（:129 `return {"result": ...}` 之后）插入：

```gdscript


# editor 内存改节点属性（UndoRedo per-property undo：do=set new / undo=set old）。
# editor-method-map 登记 edit_node 后，editor 连接时 scene 工具 edit_node 路由到此处（不再 spawnGodot 改盘）。
# properties coerce 失败累计进返回值（非阻塞，对齐 headless edit_node）。节点找不到返 -32002。
# old_val 预读：node.get(key)；只读 property 预读 null 时 undo 会 set(key,null)——务实接受（name/class 等
# 只读多在 BLOCKED_PROPERTIES 已拒），未来加 PROPERTY_USAGE_READ_ONLY 检查记 follow-up。
func handle_edit_node(params: Dictionary, request_id: int) -> Dictionary:
	var ei := _get_ei()
	if ei == null:
		return {"error": {"code": -32000, "message": "EditorInterface not available"}}
	var root = ei.get_edited_scene_root()
	if not root:
		return {"error": {"code": -32003, "message": "No scene loaded"}}
	var node_path: String = params.get("node_path", "")
	if node_path.is_empty():
		return {"error": {"code": -32004, "message": "node_path is required"}}
	if CommandHelpers.has_path_traversal(node_path):
		return {"error": {"code": -32002, "message": "Invalid node path (traversal): %s" % node_path}}
	var node: Node = CommandHelpers.find_node(root, node_path)
	if not node:
		return {"error": {"code": -32002, "message": "Node not found: %s" % node_path}}
	var properties: Dictionary = params.get("properties", {})
	if properties.is_empty():
		return {"error": {"code": -32004, "message": "properties is required (non-empty)"}}

	var do_ops: Array = []
	var undo_ops: Array = []
	var failed: Array = []
	for key in properties:
		var r := CommandHelpers.coerce_property_value(node, String(key), properties[key])
		if not r["ok"]:
			failed.append({"key": String(key), "error": String(r["error"])})
			continue
		var coerced: Variant = r["value"]
		var old_val: Variant = node.get(String(key))
		# op 显式 type:"method"（对齐 handle_add_node:66），method:"set" 经 undo_manager.gd:55 callv spread
		do_ops.append({"type": "method", "target": node, "method": "set", "args": [String(key), coerced]})
		undo_ops.append({"type": "method", "target": node, "method": "set", "args": [String(key), old_val]})

	if do_ops.is_empty():
		# 全 property coerce 失败：不注册 undo，返失败列表
		return {"result": {"node_path": str(node.get_path()), "updated": 0, "failed": failed}}

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Edit Node %s (req:%d)" % [str(node.get_path()), request_id], do_ops, undo_ops)
	else:
		for op in do_ops:
			op["target"].set(op["args"][0], op["args"][1])
	return {"result": {"node_path": str(node.get_path()), "updated": do_ops.size(), "failed": failed}}
```

- [ ] **Step 3: check:gdscript 验证编译**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0（handler 编译通过；此时 handler 未接路由，编译不依赖 Task 5）

- [ ] **Step 4: defects.ts 登记 detect**

FIXED 段加：

```ts
  // spec editor-version-tear §2: editor handle_edit_node（per-property undo，do=set new / undo=set old）。
  // detect: node_commands.gd 含 handle_edit_node 定义 + create_action_mixed 调用。
  { key: 'editor-handle-edit-node', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const f = readSrc('addons/godot_mcp_server/commands/node_commands.gd');
      const hasDef = /func handle_edit_node\(params: Dictionary, request_id: int\) -> Dictionary:/.test(f);
      const hasUndo = /_undo_manager\.create_action_mixed\([\s\S]*?method": "set"/.test(f);
      return hasDef && hasUndo ? 0 : 1;
    } },
```

- [ ] **Step 5: commit**

```bash
git add addons/godot_mcp_server/commands/node_commands.gd test/regression/defects.ts
git commit -m "feat(gd): editor handle_edit_node（per-property undo，editor 内存改属性）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: `handle_batch_add_nodes`（node_commands.gd 新增）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\node_commands.gd`（Task 2 加的 `handle_edit_node` 之后插入）
- Test: `npm run check:gdscript` + defects.ts detect

**Interfaces:**
- Consumes: Task 1 `CommandHelpers.coerce_property_value`、`CommandHelpers.find_node`、`CommandHelpers.has_path_traversal`；node_commands.gd 现有 `_get_ei()`、`_undo_manager`、`_is_allowed_node_type`(:132)、`ALLOWED_NODE_TYPES`
- Produces: `handle_batch_add_nodes(params: Dictionary, request_id: int) -> Dictionary`（返 `{"result": {added, failed}}` 或 `{"error": {code, message}}`）。Task 5 command_handler 分支调用。

- [ ] **Step 1: re-grep 确认 ALLOWED_NODE_TYPES + _is_allowed_node_type**

Run: `grep -n "ALLOWED_NODE_TYPES\|func _is_allowed_node_type" "D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/commands/node_commands.gd"`
Expected: 两者存在（handle_add_node:45 已用 `_is_allowed_node_type`）。

- [ ] **Step 2: 加 handle_batch_add_nodes 函数**

在 Task 2 加的 `handle_edit_node` 函数结尾之后插入：

```gdscript


# editor 内存批量加节点（UndoRedo，do=add_child+set_owner+set properties / undo=remove_child 各节点）。
# 预校验全部 node → 任一失败返结构化错误，editor 内存零改。
# editor-method-map 登记后 editor 连接时 scene 工具 batch_add_nodes 路由到此处。
# 名字校验统一白名单 ^[A-Za-z0-9_]+$（对齐 handle_add_node:41，非 index.ts:323 黑名单）。
func handle_batch_add_nodes(params: Dictionary, request_id: int) -> Dictionary:
	var ei := _get_ei()
	if ei == null:
		return {"error": {"code": -32000, "message": "EditorInterface not available"}}
	var root = ei.get_edited_scene_root()
	if not root:
		return {"error": {"code": -32003, "message": "No scene loaded"}}
	var nodes: Array = params.get("nodes", [])
	if nodes.is_empty():
		return {"error": {"code": -32004, "message": "nodes must be a non-empty array"}}
	if nodes.size() > 100:
		return {"error": {"code": -32004, "message": "Too many nodes (%d). Maximum: 100" % nodes.size()}}

	var _name_re := RegEx.create_from_string("^[A-Za-z0-9_]+$")
	# 预校验全部 node（零内存改）
	var validated: Array = []
	for i in range(nodes.size()):
		var n: Dictionary = nodes[i]
		var node_type: String = String(n.get("node_type", "Node"))
		var node_name: String = String(n.get("node_name", "NewNode"))
		var parent_path: String = String(n.get("parent_node_path", ""))
		if node_name.is_empty() or not _name_re.search(node_name):
			return {"error": {"code": -32004, "message": "nodes[%d].node_name invalid: %s" % [i, node_name]}}
		if not _is_allowed_node_type(node_type):
			return {"error": {"code": -32004, "message": "nodes[%d].node_type blocked: %s" % [i, node_type]}}
		if CommandHelpers.has_path_traversal(parent_path):
			return {"error": {"code": -32002, "message": "nodes[%d].parent traversal: %s" % [i, parent_path]}}
		var parent_node: Node = root if parent_path.is_empty() else CommandHelpers.find_node(root, parent_path)
		if not parent_node:
			return {"error": {"code": -32002, "message": "nodes[%d].parent not found: %s" % [i, parent_path]}}
		var cls = ClassDB.instantiate(node_type)
		if not cls:
			return {"error": {"code": -32000, "message": "nodes[%d].cannot instantiate: %s" % [i, node_type]}}
		cls.name = node_name
		validated.append({"cls": cls, "parent": parent_node, "name": node_name, "properties": n.get("properties", {})})

	# 全过 → 批量 create_action_mixed
	var do_ops: Array = []
	var undo_ops: Array = []
	var failed: Array = []
	for v in validated:
		var cls: Node = v["cls"]
		var parent_node: Node = v["parent"]
		var props: Dictionary = v["properties"]
		do_ops.append({"type": "method", "target": parent_node, "method": "add_child", "args": [cls]})
		do_ops.append({"type": "method", "target": cls, "method": "set_owner", "args": [root]})
		for key in props:
			var r := CommandHelpers.coerce_property_value(cls, String(key), props[key])
			if not r["ok"]:
				failed.append({"node": String(v["name"]), "key": String(key), "error": String(r["error"])})
				continue
			do_ops.append({"type": "method", "target": cls, "method": "set", "args": [String(key), r["value"]]})
		do_ops.append({"type": "reference", "value": cls})
		undo_ops.append({"type": "method", "target": parent_node, "method": "remove_child", "args": [cls]})

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Batch Add %d Nodes (req:%d)" % [validated.size(), request_id], do_ops, undo_ops)
	else:
		for op in do_ops:
			if String(op.get("type", "method")) == "method":
				op["target"].callv(op["method"], op["args"])
	return {"result": {"added": validated.size(), "failed": failed}}
```

- [ ] **Step 3: check:gdscript 验证编译**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0

- [ ] **Step 4: defects.ts 登记 detect**

FIXED 段加：

```ts
  // spec editor-version-tear §3: editor handle_batch_add_nodes（预校验零内存改 + 批量 UndoRedo）。
  // detect: node_commands.gd 含 handle_batch_add_nodes 定义 + 白名单 ^[A-Za-z0-9_]+$（非 index.ts 黑名单）。
  { key: 'editor-handle-batch-add-nodes', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const f = readSrc('addons/godot_mcp_server/commands/node_commands.gd');
      const hasDef = /func handle_batch_add_nodes\(params: Dictionary, request_id: int\) -> Dictionary:/.test(f);
      const hasWhitelist = /func handle_batch_add_nodes[\s\S]{0,800}\^\[A-Za-z0-9_\]\+\$/.test(f);
      return hasDef && hasWhitelist ? 0 : 1;
    } },
```

  并在 OPEN 段（`export const OPEN_DEFECTS`，参照 :648+ 现有 open baseline 项格式）加 follow-up baseline（**验收标准 10**）：

```ts
  // spec editor-version-tear 验收 10 follow-up: editor batch handler 名字校验白名单 ^[A-Za-z0-9_]+$
  // （对齐 handle_add_node:41）vs index.ts:323 headless 前置黑名单（"node_name contains invalid
  // characters" 错误路径）严格度不一致。本 spec 不统一（editor handler 内部已统一白名单，不引入新不一致）。
  // baseline=1 防恶化：黑名单错误路径仍在=detect=1=baseline 过；未来统一应人工转 fixed。
  { key: 'editor-batch-name-whitelist-headless-blacklist-mismatch', status: 'open', severity: 'ADVISORY',
    dimension: 'Maintainability', baseline: 1,
    detect: () => {
      const f = readSrc('src/tools/scene/index.ts');
      const batchBody = f.slice(f.indexOf("case 'batch_add_nodes'"), f.indexOf("case 'edit_node'"));
      return batchBody.includes("node_name contains invalid characters") ? 1 : 0;
    } },
```

- [ ] **Step 5: commit**

```bash
git add addons/godot_mcp_server/commands/node_commands.gd test/regression/defects.ts
git commit -m "feat(gd): editor handle_batch_add_nodes（预校验 + 批量 UndoRedo）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: `handle_add_node` 补 properties（node_commands.gd 改现有）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\node_commands.gd:58-77`（`handle_add_node` 的 instantiate + create_action_mixed 段）
- Test: `npm run check:gdscript` + defects.ts detect

**Interfaces:**
- Consumes: Task 1 `CommandHelpers.coerce_property_value`；handle_add_node 现有 `cls`/`parent_node`/`root`/`_undo_manager`/`node_name`/`request_id`
- Produces: `handle_add_node` 返回值增加 `failed` 字段（properties coerce 失败列表）

- [ ] **Step 1: re-grep 确认 handle_add_node 现状（行号可能因 Task 2/3 插入而后移）**

Run: `grep -n "func handle_add_node" "D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/commands/node_commands.gd"`
Expected: 行号（原 :29，Task 2/3 后可能后移；以实际为准）。读该函数全貌确认 do_ops 结构仍为 add_child/set_owner/reference。

- [ ] **Step 2: 改 handle_add_node 补 properties**

把 `handle_add_node` 中 `var cls = ClassDB.instantiate(node_type)` 到 `return {"result": ...}` 这段（原 :58-77）替换为：

```gdscript
	var cls = ClassDB.instantiate(node_type)
	if not cls:
		return {"error": {"code": -32000, "message": "Cannot instantiate: %s" % node_type}}
	cls.name = node_name

	# properties coerce → prop_do_ops（undo 不需逐 property：remove_child 整节点 properties 随之消失）
	var properties: Dictionary = params.get("properties", {})
	var failed: Array = []
	var prop_do_ops: Array = []
	for key in properties:
		var r := CommandHelpers.coerce_property_value(cls, String(key), properties[key])
		if not r["ok"]:
			failed.append({"key": String(key), "error": String(r["error"])})
			continue
		prop_do_ops.append({"type": "method", "target": cls, "method": "set", "args": [String(key), r["value"]]})

	if _undo_manager != null:
		var do_ops: Array = [
			{"type": "method", "target": parent_node, "method": "add_child", "args": [cls]},
			{"type": "method", "target": cls, "method": "set_owner", "args": [root]},
		]
		do_ops.append_array(prop_do_ops)
		do_ops.append({"type": "reference", "value": cls})
		_undo_manager.create_action_mixed("Add Node %s (req:%d)" % [node_name, request_id], do_ops,
			[{"type": "method", "target": parent_node, "method": "remove_child", "args": [cls]}])
	else:
		parent_node.add_child(cls)
		cls.owner = root
		for op in prop_do_ops:
			op["target"].set(op["args"][0], op["args"][1])
	return {"result": {"node_path": str(cls.get_path()), "status": "created", "failed": failed}}
```

- [ ] **Step 3: check:gdscript 验证编译**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0

- [ ] **Step 4: defects.ts 登记 detect**

FIXED 段加：

```ts
  // spec editor-version-tear §4: editor handle_add_node 补 properties（原 :36-38 只取 3 字段，properties 被丢弃）。
  // detect: handle_add_node 函数体含 coerce_property_value 调用 + prop_do_ops。
  { key: 'editor-add-node-properties', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const f = readSrc('addons/godot_mcp_server/commands/node_commands.gd');
      const fnBody = f.slice(f.indexOf('func handle_add_node'), f.indexOf('func handle_remove_node'));
      return /CommandHelpers\.coerce_property_value/.test(fnBody) && /prop_do_ops/.test(fnBody) ? 0 : 1;
    } },
```

- [ ] **Step 5: commit**

```bash
git add addons/godot_mcp_server/commands/node_commands.gd test/regression/defects.ts
git commit -m "feat(gd): editor handle_add_node 补 properties（不再丢弃，coerce 经 helper）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: editor-method-map 登记 + command_handler 分支（打通路由）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\editor-method-map.ts:65-72`（scene 表）
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd:104-117`（match method）
- Test: `D:\GitHub\godot-mcp-enhanced\test\core\editor-method-map.test.ts`（vitest）+ check:gdscript + defects.ts detect

**Interfaces:**
- Consumes: Task 2/3 的 `handle_edit_node` / `handle_batch_add_nodes`
- Produces: editor 连接时 scene 工具 edit_node/batch_add_nodes 经 ToolDispatcher → command_handler → node_commands handler 的完整路由

- [ ] **Step 1: 写失败测试 — editor-method-map 登记（vitest TDD）**

在 `D:\GitHub\godot-mcp-enhanced\test\core\editor-method-map.test.ts` 加（参照现有 scene 域断言格式）：

```ts
import { describe, it, expect } from 'vitest';
import { EDITOR_METHOD_MAP } from '../../src/core/editor-method-map';

describe('editor-method-map scene (editor-version-tear)', () => {
  it('registers edit_node under scene domain', () => {
    expect(EDITOR_METHOD_MAP.scene.edit_node).toEqual({ method: 'edit_node' });
  });
  it('registers batch_add_nodes under scene domain', () => {
    expect(EDITOR_METHOD_MAP.scene.batch_add_nodes).toEqual({ method: 'batch_add_nodes' });
  });
});
```

（若文件已有 `describe('editor-method-map'...)` 块，把两个 it 追加进去，勿重复 import。`EDITOR_METHOD_MAP` 导出名以文件实际导出为准——Step 1 前 grep 确认。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/core/editor-method-map.test.ts`
Expected: FAIL（`scene.edit_node` / `scene.batch_add_nodes` 为 undefined）

- [ ] **Step 3: editor-method-map.ts scene 表加登记**

re-grep 确认 scene 表位置：`grep -n "add_node: { method" "D:/GitHub/godot-mcp-enhanced/src/core/editor-method-map.ts"`

在 scene 表（:65-72）的 `add_node` 行后加：

```ts
    edit_node: { method: 'edit_node' },
    batch_add_nodes: { method: 'batch_add_nodes' },
```

使 scene 表变为：

```ts
  scene: {
    add_node: { method: 'add_node' },
    edit_node: { method: 'edit_node' },
    batch_add_nodes: { method: 'batch_add_nodes' },
    remove_node: { method: 'remove_node' },
    instance_scene: { method: 'instance_scene' },
    set_instance_property: { method: 'set_instance_property' },
    open_scene: { method: 'open_scene' },
    save_scene: { method: 'save_scene' },
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/editor-method-map.test.ts`
Expected: PASS

- [ ] **Step 5: command_handler.gd match 加分支**

re-grep 确认：`grep -n '"remove_node":' "D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/command_handler.gd"`

在 `"remove_node":` 分支（约 :116-117）之后加：

```gdscript
		"edit_node":
			return _node_commands.handle_edit_node(params, request_id)
		"batch_add_nodes":
			return _node_commands.handle_batch_add_nodes(params, request_id)
```

- [ ] **Step 6: check:gdscript 验证编译（handler 此时被路由引用）**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0（command_handler 引用 Task 2/3 的 handler，编译通过）

- [ ] **Step 7: defects.ts 登记 detect**

FIXED 段加：

```ts
  // spec editor-version-tear §5: editor-method-map 登记 edit_node/batch_add_nodes 打通 editor 路由
  // （此前 edit_node/batch 在 index.ts 无条件 spawnGodot 改盘，editor 内存版本撕裂）。
  // detect: editor-method-map.ts scene 表含 edit_node + batch_add_nodes 登记。
  { key: 'editor-method-map-edit-batch', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const f = readSrc('src/core/editor-method-map.ts');
      const sceneBlock = f.slice(f.indexOf('scene:'), f.indexOf('}', f.indexOf('scene:')));
      return /edit_node: \{ method: 'edit_node' \}/.test(sceneBlock)
        && /batch_add_nodes: \{ method: 'batch_add_nodes' \}/.test(sceneBlock) ? 0 : 1;
    } },
```

- [ ] **Step 8: commit**

```bash
git add src/core/editor-method-map.ts addons/godot_mcp_server/command_handler.gd test/core/editor-method-map.test.ts test/regression/defects.ts
git commit -m "feat(scene): editor-method-map 登记 edit_node/batch + command_handler 分支（打通 editor 路由）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: index.ts checkEditorSceneSave 守卫（headless fallback 路径防线）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\scene\index.ts:316-345`（batch_add_nodes case）+ `:347-375`（edit_node case）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\scene\index.test.ts`（vitest mock checkEditorSceneSave）+ defects.ts detect

**Interfaces:**
- Consumes: `ctx.checkEditorSceneSave`（add_node:155-158 已用）、`resolveWithinRoot`、`existsSync`、`opsErrorResult`
- Produces: edit_node/batch case 在 editor 未连接 fallback headless spawnGodot 前，若该场景在 editor 打开则返 `EDITOR_SCENE_OPEN` 阻断（防盘改覆盖 editor 内存）

**关键差异**：edit_node case 有 `try/finally`（:350/:374，守卫 return 依赖 finally release slot，**不手动 release**）；batch case 无 try/finally（手动 `releaseShortRunningSlot()`）。两条 case 守卫写法不同，分别处理。

- [ ] **Step 1: re-grep 确认两条 case 结构 + checkEditorSceneSave 用法**

Run: `grep -n "case 'batch_add_nodes'\|case 'edit_node'\|checkEditorSceneSave\|resolveWithinRoot\|releaseShortRunningSlot" "D:/GitHub/godot-mcp-enhanced/src/tools/scene/index.ts"`
Expected: batch(:316)/edit_node(:347) case + checkEditorSceneSave(:155-156) + resolveWithinRoot(:148) 定位，确认 edit_node case 有 try/finally、batch 无。

- [ ] **Step 2: 写失败测试 — 守卫接线（vitest TDD）**

在 `D:\GitHub\godot-mcp-enhanced\test\tools\scene\index.test.ts`（路径以项目实际为准，参照现有 scene 工具测试 mock 模式）加：

```ts
import { describe, it, expect, vi } from 'vitest';

describe('scene edit_node/batch editor-scene-save guard (editor-version-tear)', () => {
  it('edit_node returns EDITOR_SCENE_OPEN when scene open in editor', async () => {
    const checkEditorSceneSave = vi.fn().mockResolvedValue({ blocked: true, message: 'open in editor' });
    const ctx: any = {
      checkEditorSceneSave,
      findGodot: vi.fn(),
      opsScript: '/fake/ops.gd',
      // 其余 ctx 字段按现有 scene 测试 fixture 补齐
    };
    const { default: sceneTool } = await import('../../src/tools/scene/index');
    const res = await sceneTool.run(
      { action: 'edit_node', scene_path: 'res://Main.tscn', node_path: 'Player', properties: { x: 1 } },
      ctx,
    );
    expect(checkEditorSceneSave).toHaveBeenCalled();
    expect(JSON.stringify(res)).toContain('EDITOR_SCENE_OPEN');
  });

  it('batch_add_nodes returns EDITOR_SCENE_OPEN when scene open in editor', async () => {
    const checkEditorSceneSave = vi.fn().mockResolvedValue({ blocked: true, message: 'open in editor' });
    const ctx: any = { checkEditorSceneSave, findGodot: vi.fn(), opsScript: '/fake/ops.gd' };
    const { default: sceneTool } = await import('../../src/tools/scene/index');
    const res = await sceneTool.run(
      { action: 'batch_add_nodes', scene_path: 'res://Main.tscn', nodes: [{ node_type: 'Node', node_name: 'N1' }] },
      ctx,
    );
    expect(checkEditorSceneSave).toHaveBeenCalled();
    expect(JSON.stringify(res)).toContain('EDITOR_SCENE_OPEN');
  });
});
```

（`sceneTool.run` 的实际调用签名 / action 字段名以现有 scene 测试为准——Step 2 前读 `test/tools/scene/` 下现有测试对齐 mock 结构。若项目用不同 fixture 工厂，套用其工厂。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/tools/scene/index.test.ts`
Expected: FAIL（守卫未加，checkEditorSceneSave 不被调用 / 不返 EDITOR_SCENE_OPEN）

- [ ] **Step 4: edit_node case 加守卫**

edit_node case（:347-375）在 `const scenePath = normalizeUserProjectPath(...)`（:352）之后、`const nodePath = ...`（:353）之前插入（try 块内，return 依赖 finally release）：

```ts
        const absPath = resolveWithinRoot(p, scenePath);
        if (!existsSync(absPath)) return opsErrorResult('FILE_NOT_FOUND', `Scene file not found: ${scenePath}`);
        if (ctx.checkEditorSceneSave) {
          const sceneGuard = await ctx.checkEditorSceneSave(absPath);
          if (sceneGuard.blocked) return opsErrorResult('EDITOR_SCENE_OPEN', sceneGuard.message ?? `Scene open in editor: ${absPath}`);
        }
```

- [ ] **Step 5: batch_add_nodes case 加守卫**

batch case（:316-345）在 node_type/name 校验 for 循环（:323）之后、`let godot`（:324）之前插入（无 try/finally，手动 release）：

```ts
      const absPath = resolveWithinRoot(p, scenePath);
      if (!existsSync(absPath)) { releaseShortRunningSlot(); return opsErrorResult('FILE_NOT_FOUND', `Scene file not found: ${scenePath}`); }
      if (ctx.checkEditorSceneSave) {
        const sceneGuard = await ctx.checkEditorSceneSave(absPath);
        if (sceneGuard.blocked) { releaseShortRunningSlot(); return opsErrorResult('EDITOR_SCENE_OPEN', sceneGuard.message ?? `Scene open in editor: ${absPath}`); }
      }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run test/tools/scene/index.test.ts`
Expected: PASS（两个 EDITOR_SCENE_OPEN 用例通过）

- [ ] **Step 7: defects.ts 登记 detect**

FIXED 段加：

```ts
  // spec editor-version-tear §6: index.ts edit_node/batch headless fallback 路径加 checkEditorSceneSave 守卫
  // （editor 未连接时 fallback spawnGodot 改盘，守卫防覆盖 editor 内存——editor 连接时走 handler 不触发）。
  // detect: index.ts edit_node case + batch case 各含 checkEditorSceneSave 调用。
  { key: 'editor-scene-save-guard-edit-batch', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const f = readSrc('src/tools/scene/index.ts');
      const editBody = f.slice(f.indexOf("case 'edit_node'"), f.indexOf("case 'remove_node'"));
      const batchBody = f.slice(f.indexOf("case 'batch_add_nodes'"), f.indexOf("case 'edit_node'"));
      return /ctx\.checkEditorSceneSave/.test(editBody) && /ctx\.checkEditorSceneSave/.test(batchBody) ? 0 : 1;
    } },
```

- [ ] **Step 8: commit**

```bash
git add src/tools/scene/index.ts test/tools/scene/index.test.ts test/regression/defects.ts
git commit -m "feat(scene): edit_node/batch headless fallback 加 checkEditorSceneSave 守卫

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 行为集成验收（手动 / L2，需 editor 环境，非 CI 强制）

完成 Task 1-6 + commit 后，需 editor 环境手动验收（GD 行为测试基础设施薄弱，务实分层）：

1. editor 打开 `res://Main.tscn`，editor 插件 WebSocket 已连接
2. 调 `edit_node {scene_path, node_path:"Player", properties:{modulate:"res://x.png" 或 color}}` → 验证 editor 内存场景属性立即变化（不 spawnGodot）+ Ctrl+Z 还原旧值
3. 调 `edit_node {..., properties:{instance:"res://x.tscn"}}` → 返 blocked（instance 三保险）
4. 调 `batch_add_nodes` 带 properties → 各节点 add + properties set + Ctrl+Z 各节点移除
5. 调 `batch_add_nodes` 带 1 个非法 node_type（如 class_name 脚本名）→ 返结构化错误 + editor 内存零改
6. 关闭 editor 连接，edit_node fallback headless，若该场景仍 editor 打开 → 返 EDITOR_SCENE_OPEN
7. 在 `test/regression/defects.ts` 对应 detect 项加注释记录验收日期 + 结果

## Self-Review（写计划后自查，已执行）

**Spec 覆盖**：spec §1→Task 1、§2→Task 2、§3→Task 3、§4→Task 4、§5→Task 5、§6→Task 6；验收标准 1-10 散见各 Task detect + 行为集成段。无遗漏。
**Placeholder 扫描**：各 Step 代码块完整，无 TBD/TODO；两处 vitest 测试标注"以项目实际 fixture/签名对齐"并给了 re-grep 确认步骤（非 placeholder，是务实对齐既有测试基础设施）。
**Type 一致性**：`coerce_property_value` 签名 Task 1 定义 → Task 2/3/4 调用一致（返 Dictionary，取 `["ok"]/["value"]/["error"]`）；`handle_edit_node`/`handle_batch_add_nodes` 签名 Task 2/3 定义 → Task 5 command_handler 调用一致；op dict `{"type":"method","target","method","args"}` 全 plan 统一。
