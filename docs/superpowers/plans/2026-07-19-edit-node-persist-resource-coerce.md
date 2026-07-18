# edit_node 持久化 + 资源属性类型识别 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** edit_node 自动落盘 + edit_node/add_node/batch_add_nodes 资源属性正确 load（修反馈 ①②③），batch 部分失败不再静默。

**Architecture:** headless `godot_operations.gd` 加 `_set_property_with_coerce` helper（`get_property_list` 查属性类型 → TYPE_OBJECT + res:// String → sanitize+load；类型不匹配报错非静默）+ `edit_node` handler（load→find→coerce→pack+save，**不 owner**）；TS `scene/index.ts` edit_node case 从 `executeGdscript` 改 `spawnGodot`；instance 入 `_BLOCKED_PROPERTIES` + helper 双保险；batch `failed_count>0` quit(1)。

**Tech Stack:** GDScript 4.7（godot_operations.gd）、TypeScript（scene/index.ts）、vitest、defects.ts CI 门禁、check:gdscript

## Global Constraints

- Godot 4.7 API（`get_property_list` / `ClassDB` / `load` / `PackedScene.pack`）
- **行号基于 2026-07-18/19 核实，每个 Task 实施前必须 re-grep 确认**（代码可能漂移）
- **不删 `gdScriptSetLine`**（scene-instance.ts:67/152 仍用）
- **不含 editor handler**（spec §6 editor 版本撕裂修复独立 plan：editor-method-map 登记 + node_commands.gd editor handler + editor 测试，工作量等同独立 spec。本 plan 先解决 headless 核心 ①②③，editor 模式 edit_node 仍走 -32601 fallback headless 即用本 plan 修好的路径）
- **不含 Array 数学类型 coerce**（headless add_node/batch `position:[x,y,z]` 同病，登记 follow-up defect，不在本 plan；helper 对 Array 透传保持现状不退化）
- edit_node 自动落盘 = **breaking change**，CHANGELOG 标注
- 本地 commit **不 push**（项目惯例，用户显式确认才 push）
- 对齐 editor 侧 `addons/godot_mcp_server/commands/command_helpers.gd:140 coerce_value_for_property`（仅 Array 数学类型；本 plan 扩展资源识别，逻辑互补）

## 测试分层（GD 测试基础设施现状）

项目 GD 行为测试基础设施薄弱，务实分层：
- **GD 编译层**：`npm run check:gdscript`（验证语法编译，不验证行为）
- **TS 逻辑层**：vitest mock `spawnGodot` 验证 index.ts case 构造的参数 + 返回处理
- **静态 detect 层**：`test/regression/defects.ts` grep detect（CI 门禁防复发）
- **行为集成层**（手动或 L2）：真跑 edit_node 验证 .tscn ExtResource（需 Godot 环境）

---

## Task 1: `_set_property_with_coerce` + `_get_property_type` helper（GD 核心）

**Files:**
- Modify: `src/scripts/godot_operations.gd`（`_is_safe_value` 之后，约 :43-44 插入两个 helper）
- Test: `test/regression/defects.ts`（登记 detect）+ check:gdscript 编译

**Interfaces:**
- Produces: `_get_property_type(obj: Object, key: String) -> int`（返属性声明类型，未找到返 -1）；`_set_property_with_coerce(node: Node, key: String, value: Variant) -> bool`（成功 true/失败 false+log_error）。Task 3/4 消费。

- [ ] **Step 1: 加 helper 代码到 godot_operations.gd**（`_is_safe_value` 函数之后，`func _init()` 之前）

```gdscript
# ── 资源属性类型识别 helper（Spec A §1）────────────────────────────────────
# JSON 无法表达 Resource 实例，res:// String 路径 → sanitize + load 成 Resource 再 set；
# 类型不匹配报错非静默（解决 batch silently fail）。
# 仅覆盖 TYPE_OBJECT + res://（NodePath / Array 数学类型留 follow-up，不退化现状）。
func _get_property_type(obj: Object, key: String) -> int:
	for p in obj.get_property_list():
		if String(p.get("name", "")) == key:
			return int(p.get("type", TYPE_NIL))
	return -1

func _set_property_with_coerce(node: Node, key: String, value: Variant) -> bool:
	# 双保险：instance 即使漏加 _BLOCKED_PROPERTIES 也拒
	# I-2: instance 可注入 ExtResource 实例化恶意场景 _ready，与 script 同级危险
	if key == "instance":
		log_error("Blocked 'instance' property (I-2 security)")
		return false
	var prop_type := _get_property_type(node, key)
	if prop_type == -1:
		log_error("Property not found: %s on %s" % [key, node.get_class()])
		return false
	var coerced: Variant = value
	if prop_type == TYPE_OBJECT:
		if value is String and value.begins_with("res://"):
			coerced = load(_sanitize_res_path(value))
			if coerced == null:
				log_error("Failed to load resource for %s: %s" % [key, value])
				return false
		elif value is String:
			# Resource 属性传非 res:// String → 报错非静默（解决 batch silently fail）
			log_error("Property %s expects Resource, got plain String '%s' (use res:// path)" % [key, value])
			return false
	node.set(key, coerced)
	return true
```

- [ ] **Step 2: check:gdscript 验证编译**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0（helper 编译通过）

- [ ] **Step 3: defects.ts 登记 detect**（静态 grep 防 helper 被移除/退化）

在 `test/regression/defects.ts` 加 detect 项（参照现有 FIXED 项格式），detect 逻辑：grep `godot_operations.gd` 确认含 `_set_property_with_coerce` 且 edit_node/add_node/batch 调用它（具体 detect 代码 Task 6 统一写，本 Step 先记 detect 名 `resource-prop-coerce-helper`）。

- [ ] **Step 4: commit**

```bash
git add src/scripts/godot_operations.gd test/regression/defects.ts
git commit -m "feat(gd): _set_property_with_coerce 资源属性识别 helper（res://→load，不匹配报错）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `instance` 入 `_BLOCKED_PROPERTIES`

**Files:**
- Modify: `src/scripts/godot_operations.gd:598-603`（`BLOCKED_PROPERTIES` 数组）
- Test: defects.ts detect（确认 instance 在数组）

**Interfaces:**
- Consumes: Task 1 helper（双保险已在 helper 内，本 Task 是外层黑名单补充）

- [ ] **Step 1: 加 instance 到 BLOCKED_PROPERTIES**（:598-603）

```gdscript
const BLOCKED_PROPERTIES := [
	"script", "owner", "process_mode", "process_priority", "process_input",
	"process_unhandled_input", "process_unhandled_key_input", "process_internal",
	"physics_process_mode", "physics_interpolation_mode", "name", "meta",
	"input_event", "ready", "tree_entered", "tree_exited", "tree_exiting",
	"instance",  # I-2: instance 可注入 ExtResource 实例化恶意场景 _ready，与 script 同级危险
]
```

- [ ] **Step 2: 验证外层过滤生效**

Run: `npm run check:gdscript`
Expected: errors=0

- [ ] **Step 3: commit**

```bash
git add src/scripts/godot_operations.gd
git commit -m "security(gd): instance 入 _BLOCKED_PROPERTIES（I-2 安全回归防）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: edit_node 迁移 godot_operations.gd + index.ts 改 spawnGodot

**Files:**
- Modify: `src/scripts/godot_operations.gd`（add_node 之后，约 :323 插入 `edit_node` handler）
- Modify: `src/tools/scene/index.ts:347-372`（edit_node case 从 executeGdscript 改 spawnGodot）
- Test: `test/scene-tools.test.js` 或新 `test/tools/scene-edit-node.test.ts`（vitest mock spawnGodot）

**Interfaces:**
- Consumes: Task 1 `_set_property_with_coerce`；Task 2 instance 黑名单
- Produces: godot_operations.gd `edit_node(params)` handler；index.ts edit_node case 走 spawnGodot

- [ ] **Step 1: 加 edit_node handler 到 godot_operations.gd**（add_node 之后，batch_add_nodes 之前，约 :323）

```gdscript
func edit_node(params):
	log_info("Editing node in scene: " + params.scene_path)
	var full_scene_path = _sanitize_res_path(params.scene_path)
	var absolute_scene_path = ProjectSettings.globalize_path(full_scene_path)
	if not FileAccess.file_exists(absolute_scene_path):
		log_error("Scene file does not exist: " + absolute_scene_path)
		quit(1)
		return
	var scene = load(full_scene_path)
	if not scene:
		log_error("Failed to load scene: " + full_scene_path)
		quit(1)
		return
	var scene_root = scene.instantiate()
	var node = scene_root.get_node_or_null(params.node_path)
	if node == null:
		log_error("Node not found: " + params.node_path)
		cleanup_and_quit([scene_root], 1)
		return
	var failed = 0
	if params.has("properties"):
		for key in params.properties:
			if not _is_safe_property(key):
				log_error("Blocked property: " + key)
				failed += 1
				continue
			if not _set_property_with_coerce(node, key, params.properties[key]):
				failed += 1
	# 持久化：复用 add_node pack+save 尾段，不复用 owner 赋值
	# (add_node :309 new_node.owner=scene_root 是给新节点设归属；edit_node 改已存在节点，
	#  照搬会把 owner 非本场景的节点如 instance 子节点错误提升、被 pack 进主场景)
	var packed_scene = PackedScene.new()
	var result = packed_scene.pack(scene_root)
	if result == OK:
		var save_error = ResourceSaver.save(packed_scene, absolute_scene_path)
		if save_error == OK:
			print("Node '%s' edited successfully" % params.node_path)
		else:
			log_error("Failed to save scene: " + str(save_error))
			scene_root.free()
			quit(1)
			return
	else:
		log_error("Failed to pack scene: " + str(result))
		scene_root.free()
		quit(1)
		return
	scene_root.free()
	if failed > 0:
		quit(1)
```

- [ ] **Step 2: check:gdscript 验证编译**

Run: `npm run check:gdscript`
Expected: errors=0

- [ ] **Step 3: 改 index.ts edit_node case**（:347-372 整体替换）

```ts
    case 'edit_node': {
      const spErr = requireScenePath(args.scene_path); if (spErr) return spErr;
      if (!acquireShortRunningSlot()) return opsErrorResult('CONCURRENCY_LIMIT', 'too many concurrent headless operations (max 3). Please wait and retry.');
      try {
        const p = requireProjectPath(args);
        const scenePath = normalizeUserProjectPath(args.scene_path as string);
        const nodePath = normalizeNodePath(args.node_path as string);
        const properties = args.properties as Record<string, unknown>;
        if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) return opsErrorResult('INVALID_PARAMS', '"properties" must be a non-empty object.');
        // S1: BLOCKED_PROPS 前置警告（与 add_node/batch 一致，避免静默失败）
        const blockedKeys: string[] = [];
        for (const key of Object.keys(properties)) {
          if (BLOCKED_PROPS.has(key) && !blockedKeys.includes(key)) blockedKeys.push(key);
        }
        let godot: string;
        try { godot = await ctx.findGodot(); } catch (e) { releaseShortRunningSlot(); throw e; }
        const result = await spawnGodot(godot, ['--headless', '--path', p, '--script', ctx.opsScript, 'edit_node', JSON.stringify({ scene_path: scenePath, node_path: nodePath, properties })]);
        releaseShortRunningSlot();
        if (result.timedOut) return errorResult('edit_node timed out after 60s.');
        if (result.exitCode === -1 && result.stdout.startsWith('SPAWN_FAILED:')) return errorResult(result.stdout);
        if (result.exitCode !== 0) return errorResult(`edit_node failed (exit code ${result.exitCode}):\n${result.stdout}`);
        const out = result.stdout.trim() || `edit_node completed.`;
        if (blockedKeys.length > 0) {
          const hint = blockedKeys.includes('script') ? ' For scripts use quick_scene script_path or Write .tscn with [ext_resource].' : '';
          return { content: [{ type: 'text' as const, text: `⚠️ Blocked properties NOT applied (security policy): ${blockedKeys.join(', ')}.${hint}\n${out}` }] };
        }
        return { content: [{ type: 'text', text: out }] };
      } finally { releaseShortRunningSlot(); }
    }
```

注意：删掉旧 executeGdscript 拼脚本路径（含 `gdScriptSetLine`/`SCENE_TREE_HEADER`/`TRY_SET_HELPER`/`parseGdscriptResult` —— 这些 import 若仅 edit_node 用则一并清理，但 `gdScriptSetLine` 仍被 scene-instance.ts 用，**不删 import**，只删 edit_node case 内调用）。

- [ ] **Step 4: 写 vitest 测试**（mock spawnGodot 验证调用参数 + 返回处理，参照项目现有 spawnGodot mock 模式）

在 `test/scene-tools.test.js` 或新建 `test/tools/scene-edit-node.test.ts` 加 case：

```ts
// 伪代码（实施时套用项目现有 spawnGodot mock 模式）
// 1. edit_node 资源属性 → spawnGodot 被调，参数含 edit_node + properties
// 2. spawnGodot mock 返 exitCode=0 + stdout "edited successfully" → 工具返成功
// 3. spawnGodot mock 返 exitCode=1 → 工具返 errorResult（不再超时）
// 4. properties 含 script（BLOCKED）→ 返 ⚠️ 警告
// 断言核心：edit_node 不再走 executeGdscript（mock executeGdscript 不应被调）
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run test/scene-tools.test.js`（或新测试文件）
Expected: 新 case PASS

- [ ] **Step 6: 行为集成验收（手动或 L2，需 Godot 环境）**

跑真 edit_node `{texture:"res://<已知 png>"}` → grep .tscn 确认 `texture = ExtResource(N)`（非字符串）+ 落盘。若不便自动化，记入 defects.ts detect 的注释作为手动验收点。

- [ ] **Step 7: commit**

```bash
git add src/scripts/godot_operations.gd src/tools/scene/index.ts test/scene-tools.test.js
git commit -m "feat(scene): edit_node 迁移 godot_operations.gd 持久化 + 资源属性正确 load

- edit_node 从 executeGdscript 改 spawnGodot 调 opsScript edit_node
- godot_operations.gd edit_node handler: load→find→_set_property_with_coerce→pack+save
- 不复用 owner 赋值（改已存在节点，避免错误提升 instance 子节点）
- breaking: edit_node 现自动落盘（之前只改内存）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: add_node / batch_add_nodes set 改用 helper

**Files:**
- Modify: `src/scripts/godot_operations.gd:302-306`（add_node）+ `:375-379`（batch_add_nodes）

**Interfaces:**
- Consumes: Task 1 `_set_property_with_coerce`

- [ ] **Step 1: add_node set 改 helper**（:302-306）

原：
```gdscript
	if params.has("properties"):
		var properties = params.properties
		for property in properties:
			if _is_safe_property(property) and _is_safe_value(properties[property]):
				new_node.set(property, properties[property])
```
改为：
```gdscript
	if params.has("properties"):
		var properties = params.properties
		for property in properties:
			if _is_safe_property(property):
				if not _set_property_with_coerce(new_node, property, properties[property]):
					log_error("Failed to set property %s on new node" % property)
```

- [ ] **Step 2: batch_add_nodes set 改 helper**（:375-379）

原：
```gdscript
		if node_def.has("properties"):
			var properties = node_def.properties
			for property in properties:
				if _is_safe_property(property) and _is_safe_value(properties[property]):
					new_node.set(property, properties[property])
```
改为：
```gdscript
		if node_def.has("properties"):
			var properties = node_def.properties
			for property in properties:
				if _is_safe_property(property):
					if not _set_property_with_coerce(new_node, property, properties[property]):
						log_error("Failed to set property %s on %s" % [property, node_def.node_name])
```

- [ ] **Step 3: check:gdscript + 回归测试**

Run: `npm run check:gdscript && npx vitest run test/scene-tools.test.js`
Expected: errors=0 + 现有测试不退化（Array 数学类型仍 no-op，与本改动前一致——follow-up）

- [ ] **Step 4: commit**

```bash
git add src/scripts/godot_operations.gd
git commit -m "refactor(gd): add_node/batch_add_nodes set 改用 _set_property_with_coerce

资源属性（texture/font 等）正确 load 而非字面赋值字符串（修反馈 ③ 同根因）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: batch_add_nodes `failed_count > 0` quit(1) 结构化失败

**Files:**
- Modify: `src/scripts/godot_operations.gd:391-395`（batch pack+save 成功后的 failed_count 处理）

**Interfaces:**
- Consumes: 无新接口（改 exit code 行为）

- [ ] **Step 1: failed_count > 0 → quit(1)**（:391-395）

原：
```gdscript
		if save_error == OK:
			print("Batch add completed: %d/%d nodes added to %s" % [added_count, nodes.size(), params.scene_path])
			if failed_count > 0:
				log_error("Failed to add %d nodes" % failed_count)
				for node_def in nodes:
					log_debug("  - node: %s (%s) parent: %s" % [node_def.get("node_name", "?"), node_def.get("node_type", "?"), node_def.get("parent_node_path", "root")])
```
改为：
```gdscript
		if save_error == OK:
			print("Batch add completed: %d/%d nodes added to %s" % [added_count, nodes.size(), params.scene_path])
			if failed_count > 0:
				log_error("Failed to add %d nodes" % failed_count)
				for node_def in nodes:
					log_debug("  - node: %s (%s) parent: %s" % [node_def.get("node_name", "?"), node_def.get("node_type", "?"), node_def.get("parent_node_path", "root")])
				# 修真静默：failed_count>0 时 quit(1)，TS scene/index.ts:329 exitCode!=0 才抓得到
				scene_root.free()
				quit(1)
				return
```

- [ ] **Step 2: check:gdscript + vitest**

Run: `npm run check:gdscript && npx vitest run test/scene-tools.test.js`
Expected: errors=0

- [ ] **Step 3: 写 vitest 验证 batch 部分失败非静默**（mock spawnGodot 返 exitCode=1 时 TS 返 errorResult）

```ts
// mock spawnGodot 返 { exitCode: 1, stdout: "...Failed to add 1 nodes..." }
// 断言 batch_add_nodes 返 isError / 含错误文本（不再 exit 0 静默成功）
```

- [ ] **Step 4: commit**

```bash
git add src/scripts/godot_operations.gd test/scene-tools.test.js
git commit -m "fix(gd): batch_add_nodes failed_count>0 quit(1)（修真静默 exit 0）

TS index.ts:329 exitCode!=0 才能抓到部分节点失败，之前 exit 0 静默

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: defects.ts 登记 3 detect + CHANGELOG breaking 标注

**Files:**
- Modify: `test/regression/defects.ts`（登记 3 条 detect baseline）
- Modify: `CHANGELOG.md`（breaking 标注）

**Interfaces:**
- 无（文档 + CI 门禁）

- [ ] **Step 1: defects.ts 登记 3 detect**（参照现有 FIXED 项格式，detect=静态 grep）

3 条 detect：
1. `resource-prop-coerce-helper`：grep `godot_operations.gd` 含 `_set_property_with_coerce` 函数定义 + edit_node/add_node/batch 三处调用
2. `instance-property-blocked-gd`：grep `godot_operations.gd` `BLOCKED_PROPERTIES` 含 `"instance"`
3. `batch-failed-quit-nonzero`：grep `godot_operations.gd` batch_add_nodes `failed_count > 0` 块含 `quit(1)`

每条 status=FIXED + detect 命令 + 注释引 spec/反馈。更新 defects.ts 头部计数注释（+3）。

- [ ] **Step 2: 跑 defects 回归**

Run: `npx vitest run test/regression/defects.fixed.test.ts`（或 defects 相关测试）
Expected: 新 3 detect 全绿（命中修复后模式）

- [ ] **Step 3: CHANGELOG.md 加 breaking 条目**

在 CHANGELOG.md Unreleased/下一个版本节加：
```markdown
### BREAKING
- `scene edit_node` 现在自动落盘到 .tscn（之前仅改内存，需配合持久化操作）。迁移：直接调 edit_node 即落盘，无需再调 save_scene。
- `scene edit_node` / `batch_add_nodes` 资源属性（texture/font/audio_stream 等 `res://` 路径）现正确 load 成 Resource（之前字面赋值字符串致属性错）。
- `scene edit_node` 传 `instance` 属性现被 block（I-2 安全：防注入 ExtResource 实例化恶意场景）。
- `scene batch_add_nodes` 部分节点失败现返错误（之前 exit 0 静默）。
```

- [ ] **Step 4: 全量门禁**

Run: `npm run check:gdscript && npx vitest run && npm run build`
Expected: errors=0 + 全量绿 + build OK

- [ ] **Step 5: commit**

```bash
git add test/regression/defects.ts CHANGELOG.md
git commit -m "test(defects): 登记 3 detect + CHANGELOG breaking 标注

- resource-prop-coerce-helper / instance-property-blocked-gd / batch-failed-quit-nonzero
- CHANGELOG: edit_node 自动落盘 + 资源 load + instance block + batch 失败非静默

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 范围外（follow-up，不在本 plan）

- **spec §6 editor 版本撕裂修复**（editor-method-map 登记 edit_node/batch_add_nodes + node_commands.gd editor handler + editor 测试）→ 独立 plan
- **scene-instance.ts `_try_set` 迁移**到 helper（scene-instance.ts:67/152 仍用 gdScriptSetLine）→ 独立 defect
- **Array 数学类型 coerce**（headless add_node/batch `position:[x,y,z]` silent no-op，对齐 command_helpers.gd:140）→ 独立 defect
- **NodePath 等其他类型 coerce** → 独立 defect

## Self-Review

**Spec coverage**：spec A §1 helper → Task 1；§2 edit_node 持久化 → Task 3；§3 add_node/batch 改 helper → Task 4；§4 instance 安全 → Task 1（双保险）+ Task 2（黑名单）；§5 batch 失败结构化 → Task 5；§6 editor → 拆出（声明）；验收标准 1-8 → Task 3（1,2,8）+ Task 4（7）+ Task 5（4）+ check:gdscript（6 sanitize）；breaking → Task 6 CHANGELOG。覆盖完整。

**Placeholder scan**：测试步骤含"参照项目现有 spawnGodot mock 模式"——这是参照点（项目有现成 mock），非 placeholder（给了断言逻辑）。GD 行为集成验收标"手动或 L2"（基础设施限制，务实）。

**Type consistency**：`_set_property_with_coerce` 签名在 Task 1 定义、Task 3/4 消费一致（`node, key, value -> bool`）。`_get_property_type` Task 1 定义、Task 1 内 helper 调用一致。
