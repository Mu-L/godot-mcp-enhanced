# 批次 D-P2（addons GDScript）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐 task 执行。Steps 用 checkbox（`- [ ]`）跟踪。

**Goal:** 修复报告5 的 4 条 P2 finding（F1 网格细分 DoS / F2 nav+ui undo / F3 animation ki 越界 / F4 websocket outbound buffer），每条补 defects.ts detect 防复发。

**Architecture:** 全部改 `addons/godot_mcp_server/` 下 editor 插件 .gd（F2 抽 `_record_prop` 到 `command_helpers.gd` 共享）。TDD 模式 = 在 `test/regression/defects.ts` 加 detect 闭包（RED，detect≠0）→ 修 .gd → detect 转 0（GREEN）→ `check:gdscript` 编译 → editor 端到端实测 → commit。

**Tech Stack:** GDScript（Godot 4.6.3 + 4.7.1，editor `@tool` 插件）· TypeScript（defects.ts detect 闭包，vitest 跑 `defects-fixed.test.ts`）· `defects-fixed.test.ts` 硬断言 `detect() === 0`

## Global Constraints

- **执行仓库**：`D:\GitHub\godot-mcp-enhanced`（本地工作仓库；非 `godot-ai-kit/enhanced` 子模块副本）
- **master 不 push**：push 须 AskUserQuestion 显式确认（惯例 `[[user-prefers-local-ahead-no-push]]`）
- **每修一条补 defects.ts detect**：项目惯例（`[[plan-baseline-verify-grep]]`）。detect 闭包用 `readSrc(path)` + regex，返 0=已修复 / >0=复发
- **detect 计数同步**（关键）：`test/regression/defects.ts:2` 头注 + `test/regression/defects-fixed.test.ts:142`（`expect(FIXED_DEFECTS.length).toBe(N)`）+ `:144`（无重名 `toBe(N)`）三处计数。当前 FIXED 基线 = **117**。每加 1 条 detect，三处 N 均 +1（117→118→…）。不同步则 `defects-fixed.test.ts` 红
- **.gd 改后编译**：`npm run check:gdscript`（0 err / 0 warn，4.6.3+4.7.1 真编译，`check-gdscript.ts` 内部 `runGodotHeadless`，非 `--check-only` 假绿）
- **.gd 改后 editor 实测**：cp 同步项目内 `addons/`（若涉及 editor 路由）+ 重启编辑器端到端实测
- **禁用内置 Edit 改 .gd**：只用 enhanced `edit_script`（`search_and_replace` 模式，CRLF 安全）。本 plan 在 enhanced 仓库本地执行，无 MCP 时可径直改文件 + `check:gdscript` 验证
- 路径引用一律绝对（项目 CLAUDE.md 全局规则）

## F2 实测细化（plan 阶段代码勘察结论，偏离 spec「照搬 _record_prop」）

- `theme_create`（ui_commands.gd:347-380）只 `Theme.new()` + 可选 save 文件，**不赋给任何节点 `ctrl.theme`**（:380 返回，无赋值）→ **不需 undo**（报告5 误判），本 plan 排除，仅在 Task 4 加注释说明
- `_record_prop` 是 **property op**（do=set new / undo=set old=`target.get(prop)`），适用 nav/layout 属性赋值；但 `set_theme` 的 set_params（`theme.set(key)` 循环）与 `theme_set_property`（`set_color` 等）是 **method op**，`_record_prop` 不适用，Task 4 另写 method op + 取旧值
- `_record_prop` 抽到 `command_helpers.gd`（static），nav_commands / ui_commands 复用（DRY）

---

## Task 1: F1 网格细分参数 clampi 上限

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\custom_meshes.gd:16,56,136,137,169,202`
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\path_generator.gd`（sample 入口）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts`（加 detect）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects-fixed.test.ts:142,144`（计数 117→118）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:2`（头注 117→118）

**Interfaces:** 无跨 task 依赖。

- [ ] **Step 1: 写 detect 闭包（RED）**

在 `defects.ts` `FIXED_DEFECTS` 数组末尾（`:1345` `]` 前）加：

```typescript
  { key: 'custom-mesh-segments-no-upper-cap', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    // P2(2026-07-29 报告5 F1): custom_meshes 细分参数 max(int(...),N) 只取下限不取上限 → 认证客户端传超大值
    // 在 @tool 编辑器主线程同步建顶点 → 卡死/OOM。fix: 改 clampi(int(...),N,CAP)。path_generator sample count 同理加上限。
    // detect: custom_meshes 含裸 max(int(params.get 且无 clampi 覆盖 = 复发。
    detect: () => {
      const cm = readSrc('addons/godot_mcp_server/commands/asset/custom_meshes.gd');
      const bareMax = (cm.match(/max\(int\(params\.get/g) || []).length;
      const clampi = (cm.match(/clampi\(int\(params\.get/g) || []).length;
      const pg = readSrc('addons/godot_mcp_server/commands/asset/path_generator.gd');
      const pathCountCap = /count\s*>\s*\d{4,}|count exceeds maximum/i.test(pg);
      return (bareMax === 0 && clampi >= 6 && pathCountCap) ? 0 : 1;
    } },
```

- [ ] **Step 2: 跑 detect 确认失败**

Run: `cd /d/GitHub/godot-mcp-enhanced && npx vitest run test/regression/defects-fixed.test.ts -t custom-mesh-segments`
Expected: FAIL（`detect 命中 1`——bareMax 当前 6、clampi 0）

- [ ] **Step 3: 改 custom_meshes.gd 6 处 clampi**

`:16`（make_cone）：`var segments: int = max(int(params.get("segments", 24)), 3)` → `var segments: int = clampi(int(params.get("segments", 24)), 3, 128)`
`:56`（make_tube）：同上 → `clampi(int(params.get("segments", 24)), 3, 128)`
`:136`（make_torus ms）：`var ms: int = max(int(params.get("major_segments", 32)), 3)` → `var ms: int = clampi(int(params.get("major_segments", 32)), 3, 128)`
`:137`（make_torus ns）：`var ns: int = max(int(params.get("minor_segments", 16)), 3)` → `var ns: int = clampi(int(params.get("minor_segments", 16)), 3, 128)`

在 make_torus 函数体 `:137` 后加注释（torus 顶点约束说明）：

```gdscript
	# F1(2026-07-29): ms/ns 各 ≤128 隐含 ms×ns ≤ 16384，顶点 ≈ 9.8 万 < 20 万上限，无需额外乘积守卫。
```

`:169`（make_stairs）：`var steps: int = max(int(params.get("steps", 5)), 1)` → `var steps: int = clampi(int(params.get("steps", 5)), 1, 200)`
`:202`（make_fence）：`var posts: int = max(int(params.get("posts", 4)), 1)` → `var posts: int = clampi(int(params.get("posts", 4)), 1, 200)`

- [ ] **Step 4: 改 path_generator.gd count 上限**

在 `sample` 函数（`:51` 起）入口参数校验处（spacing/count early-return 之前，count 取值后）加：

```gdscript
	# F1(2026-07-29): count 采样数上限防 OOM（每采样点实例化一个节点）。
	if count is int and count > 10000:
		return []
```

（`sample` 返空 Array，调用方 `handle_path` 已处理空 points → PARENT_NOT_FOUND；若需结构化错误，plan 执行时确认 sample 签名返回 Array 还是 Dictionary，按现状对齐。）

- [ ] **Step 5: 跑 detect 确认通过 + 计数同步**

同步计数：`defects.ts:2` 头注 `117` → `118`（+1 detect）；`defects-fixed.test.ts:142` `.toBe(117)` → `.toBe(118)`；`:144` `.toBe(117)` → `.toBe(118)`。

Run: `npx vitest run test/regression/defects-fixed.test.ts -t custom-mesh-segments`
Expected: PASS（detect===0）

- [ ] **Step 6: check:gdscript 编译 + editor 实测**

Run: `npm run check:gdscript`
Expected: 0 err / 0 warn

Editor 实测：`asset_create torus{major_segments:1000000,minor_segments:1000000}` → clamp 到 128/128 快速完成不卡死。

- [ ] **Step 7: commit**

```bash
git add addons/godot_mcp_server/commands/asset/custom_meshes.gd addons/godot_mcp_server/commands/asset/path_generator.gd test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "fix(security): F1 custom_meshes+path_generator 细分参数 clampi 上限防 OOM（D-P2 Task1）"
```

---

## Task 2: F2-nav nav_set_params undo（含 _record_prop helper 引入）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\command_helpers.gd`（加 static `_record_prop`）
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\nav_commands.gd:238-288`（handle_nav_set_params）
- Modify: defects.ts / defects-fixed.test.ts（加 detect + 计数 118→119）

**Interfaces:**
- Produces: `CommandHelpers._record_prop(do_ops: Array, undo_ops: Array, target: Object, prop: String, new_val) -> void`（Task 3/4 复用）

- [ ] **Step 1: 写 detect 闭包（RED）**

```typescript
  { key: 'nav-set-params-no-undo', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // P2(2026-07-29 报告5 F2): handle_nav_set_params 直接赋值改 NavigationAgent3D 属性未走 create_action_mixed → Ctrl+Z 不撤销。
    // fix: 10 属性改 CommandHelpers._record_prop 聚合 property op 进 create_action_mixed。detect: 函数内无 create_action_mixed = 复发。
    detect: () => {
      const nav = readSrc('addons/godot_mcp_server/commands/nav_commands.gd');
      const fn = nav.slice(nav.indexOf('func handle_nav_set_params'));
      const body = fn.slice(0, fn.indexOf('\nfunc ', 1));
      return /create_action_mixed/.test(body) ? 0 : 1;
    } },
```

计数同步：defects.ts:2 + defects-fixed.test.ts:142/:144 `118` → `119`。

Run: `npx vitest run test/regression/defects-fixed.test.ts -t nav-set-params`
Expected: FAIL（detect 命中 1）

- [ ] **Step 2: 在 command_helpers.gd 加 _record_prop（static）**

在 `command_helpers.gd` 末尾（或 coerce_property_value 附近）加：

```gdscript
# F2(2026-07-29): property op undo 记录 helper（对齐 particle_commands.gd:19，抽到共享层供 nav/ui 复用）。
# do=set new_val / undo=set old=target.get(prop)。append 进 do_ops/undo_ops，由 create_action_mixed commit。
static func _record_prop(do_ops: Array, undo_ops: Array, target: Object, prop: String, new_val) -> void:
	undo_ops.append({"type": "property", "target": target, "property": prop, "value": target.get(prop)})
	do_ops.append({"type": "property", "target": target, "property": prop, "value": new_val})
```

- [ ] **Step 3: 重写 handle_nav_set_params（:238-288）**

把 `:254-286`（`var agent` 到 10 个属性 if 块 + return）替换为：

```gdscript
	var agent: NavigationAgent3D = node
	var do_ops: Array = []
	var undo_ops: Array = []
	var updated = []

	if raw_params.has("path_desired_distance"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "path_desired_distance", float(raw_params["path_desired_distance"]))
		updated.append("path_desired_distance")
	if raw_params.has("target_desired_distance"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "target_desired_distance", float(raw_params["target_desired_distance"]))
		updated.append("target_desired_distance")
	if raw_params.has("radius"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "radius", float(raw_params["radius"]))
		updated.append("radius")
	if raw_params.has("height"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "height", float(raw_params["height"]))
		updated.append("height")
	if raw_params.has("max_speed"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "max_speed", float(raw_params["max_speed"]))
		updated.append("max_speed")
	if raw_params.has("avoidance_enabled"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "avoidance_enabled", raw_params["avoidance_enabled"])
		updated.append("avoidance_enabled")
	if raw_params.has("neighbor_distance"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "neighbor_distance", float(raw_params["neighbor_distance"]))
		updated.append("neighbor_distance")
	if raw_params.has("max_neighbors"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "max_neighbors", int(raw_params["max_neighbors"]))
		updated.append("max_neighbors")
	if raw_params.has("time_horizon_agents"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "time_horizon_agents", float(raw_params["time_horizon_agents"]))
		updated.append("time_horizon_agents")
	if raw_params.has("time_horizon_obstacles"):
		CommandHelpers._record_prop(do_ops, undo_ops, agent, "time_horizon_obstacles", float(raw_params["time_horizon_obstacles"]))
		updated.append("time_horizon_obstacles")

	if do_ops.is_empty():
		return {"error": {"code": -32004, "message": "no valid nav params to set"}}

	if _undo_manager != null:
		_undo_manager.create_action_mixed("Set NavAgent Params", do_ops, undo_ops)
	else:
		for op in do_ops:
			op["target"].set(op["property"], op["value"])
	return {"result": {"node": node_path, "updated": updated, "status": "params_set"}}
```

- [ ] **Step 4: 跑 detect 通过 + check:gdscript + editor 实测**

Run: `npx vitest run test/regression/defects-fixed.test.ts -t nav-set-params` → PASS
Run: `npm run check:gdscript` → 0/0
Editor 实测：`nav_set_params` 改 radius → Ctrl+Z 真回滚。

- [ ] **Step 5: commit**

```bash
git add addons/godot_mcp_server/commands/command_helpers.gd addons/godot_mcp_server/commands/nav_commands.gd test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "fix(correctness): F2-nav nav_set_params 补 _record_prop undo（D-P2 Task2）"
```

---

## Task 3: F2-ui-control ui_set_layout + ui_anchor_preset undo

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\ui_commands.gd:85-151`（handle_ui_set_layout）
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\ui_commands.gd:185-222`（handle_ui_anchor_preset）
- Modify: defects.ts / defects-fixed.test.ts（加 detect + 计数 119→120）

**Interfaces:**
- Consumes: `CommandHelpers._record_prop`（Task 2）

- [ ] **Step 1: 写 detect 闭包（RED）**

```typescript
  { key: 'ui-layout-anchor-no-undo', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // P2(2026-07-29 报告5 F2): ui_set_layout/ui_anchor_preset 直接赋值未走 create_action_mixed → Ctrl+Z 不撤销。
    // fix: property op 聚合进 create_action_mixed。detect: 两函数内均无 create_action_mixed = 复发。
    detect: () => {
      const ui = readSrc('addons/godot_mcp_server/commands/ui_commands.gd');
      const hasUndo = (fnName: string) => {
        const fn = ui.slice(ui.indexOf('func ' + fnName));
        const body = fn.slice(0, fn.indexOf('\nfunc ', 1));
        return /create_action_mixed/.test(body);
      };
      return (hasUndo('handle_ui_set_layout') && hasUndo('handle_ui_anchor_preset')) ? 0 : 1;
    } },
```

计数同步：`119` → `120`。
Run: `npx vitest run test/regression/defects-fixed.test.ts -t ui-layout-anchor` → Expected FAIL

- [ ] **Step 2: 重写 handle_ui_set_layout（:97-149，ctrl 取值后到 return 前）**

把 `:99-149`（anchors/offsets/min_size/custom_minimum_size/grow_direction 块 + return）替换为（在 `var ctrl: Control = node` 后）：

```gdscript
	var do_ops: Array = []
	var undo_ops: Array = []

	var anchors = params.get("anchors")
	if anchors != null and anchors is Dictionary:
		if anchors.has("left"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "anchor_left", float(anchors["left"]))
		if anchors.has("right"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "anchor_right", float(anchors["right"]))
		if anchors.has("top"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "anchor_top", float(anchors["top"]))
		if anchors.has("bottom"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "anchor_bottom", float(anchors["bottom"]))

	var offsets = params.get("offsets")
	if offsets != null and offsets is Dictionary:
		if offsets.has("left"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "offset_left", float(offsets["left"]))
		if offsets.has("right"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "offset_right", float(offsets["right"]))
		if offsets.has("top"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "offset_top", float(offsets["top"]))
		if offsets.has("bottom"):
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "offset_bottom", float(offsets["bottom"]))

	var custom_minimum_size = params.get("custom_minimum_size")
	if custom_minimum_size != null and custom_minimum_size is Dictionary:
		var cx = float(custom_minimum_size.get("x", ctrl.custom_minimum_size.x))
		var cy = float(custom_minimum_size.get("y", ctrl.custom_minimum_size.y))
		CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "custom_minimum_size", Vector2(cx, cy))
	else:
		var min_size = params.get("min_size")
		if min_size != null and min_size is Dictionary:
			var nx = float(min_size.get("x", ctrl.custom_minimum_size.x))
			var ny = float(min_size.get("y", ctrl.custom_minimum_size.y))
			CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "custom_minimum_size", Vector2(nx, ny))

	var grow_direction: String = params.get("grow_direction", "")
	if grow_direction != "":
		match grow_direction:
			"both":
				CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "grow_horizontal", Control.GROW_DIRECTION_BOTH)
				CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "grow_vertical", Control.GROW_DIRECTION_BOTH)
			"up":
				CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "grow_vertical", Control.GROW_DIRECTION_BEGIN)
			"down":
				CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "grow_vertical", Control.GROW_DIRECTION_END)
			"left":
				CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "grow_horizontal", Control.GROW_DIRECTION_BEGIN)
			"right":
				CommandHelpers._record_prop(do_ops, undo_ops, ctrl, "grow_horizontal", Control.GROW_DIRECTION_END)
			_:
				return {"error": {"code": -32004, "message": "Invalid grow_direction: " + grow_direction}}

	if do_ops.is_empty():
		return {"error": {"code": -32004, "message": "no layout params to set"}}

	if _undo_manager != null:
		_undo_manager.create_action_mixed("UI Set Layout", do_ops, undo_ops)
	else:
		for op in do_ops:
			op["target"].set(op["property"], op["value"])
	return {"result": {"node": node_path, "status": "layout_set"}}
```

- [ ] **Step 3: 重写 handle_ui_anchor_preset（:219-222，preset 校验后到 return）**

把 `:219-222`（`var ctrl` + set_anchors_preset + return）替换为：

```gdscript
	var ctrl: Control = node
	# anchor preset 改 anchor_left/right/top/bottom 四属性；记旧值供 undo
	var do_ops: Array = [
		{"type": "method", "target": ctrl, "method": "set_anchors_preset", "args": [preset_map[preset]]},
	]
	var undo_ops: Array = [
		{"type": "property", "target": ctrl, "property": "anchor_left", "value": ctrl.anchor_left},
		{"type": "property", "target": ctrl, "property": "anchor_right", "value": ctrl.anchor_right},
		{"type": "property", "target": ctrl, "property": "anchor_top", "value": ctrl.anchor_top},
		{"type": "property", "target": ctrl, "property": "anchor_bottom", "value": ctrl.anchor_bottom},
	]
	if _undo_manager != null:
		_undo_manager.create_action_mixed("UI Anchor Preset", do_ops, undo_ops)
	else:
		ctrl.set_anchors_preset(preset_map[preset])
	return {"result": {"node": node_path, "preset": preset, "status": "preset_applied"}}
```

- [ ] **Step 4: detect 通过 + check:gdscript + editor 实测**

Run: `npx vitest run test/regression/defects-fixed.test.ts -t ui-layout-anchor` → PASS
Run: `npm run check:gdscript` → 0/0
Editor 实测：`ui_set_layout` 改 anchors → Ctrl+Z 回滚；`ui_anchor_preset` → Ctrl+Z 回滚。

- [ ] **Step 5: commit**

```bash
git add addons/godot_mcp_server/commands/ui_commands.gd test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "fix(correctness): F2-ui ui_set_layout+anchor_preset 补 undo（D-P2 Task3）"
```

---

## Task 4: F2-ui-theme set_theme + theme_set_property undo（method op）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\ui_commands.gd:226-288`（handle_ui_set_theme）
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\ui_commands.gd:347-380`（handle_theme_create，仅加注释）
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\ui_commands.gd:404+`（handle_theme_set_property）
- Modify: defects.ts / defects-fixed.test.ts（加 detect + 计数 120→121）

**Interfaces:**
- Consumes: `CommandHelpers._record_prop`（Task 2，property op 用）+ method op 手写

- [ ] **Step 1: 写 detect 闭包（RED）**

```typescript
  { key: 'ui-theme-no-undo', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // P2(2026-07-29 报告5 F2): set_theme(create/load/set_params) + theme_set_property 改 theme 未走 create_action_mixed → Ctrl+Z 不撤销。
    // theme_create 不改节点（只新建+save），排除。detect: set_theme/theme_set_property 内均无 create_action_mixed = 复发。
    detect: () => {
      const ui = readSrc('addons/godot_mcp_server/commands/ui_commands.gd');
      const hasUndo = (fnName: string) => {
        const fn = ui.slice(ui.indexOf('func ' + fnName));
        const body = fn.slice(0, fn.indexOf('\nfunc ', 1));
        return /create_action_mixed/.test(body);
      };
      return (hasUndo('handle_ui_set_theme') && hasUndo('handle_theme_set_property')) ? 0 : 1;
    } },
```

计数同步：`120` → `121`。
Run: `npx vitest run test/regression/defects-fixed.test.ts -t ui-theme-no-undo` → Expected FAIL

- [ ] **Step 2: theme_create 加排除注释（:347 函数前）**

在 `func handle_theme_create` 前加注释：

```gdscript
# F2(2026-07-29): theme_create 只 Theme.new()+可选 save 文件，不赋给节点 ctrl.theme（不改场景树持久属性），
# 故不需 undo（Ctrl+Z 无意义）。报告5 F2 列其为误判，本批排除。
```

- [ ] **Step 3: handle_ui_set_theme create/load 补 undo（property op）+ set_params（method op）**

`"create"` 分支（:242-244）改为：

```gdscript
		"create":
			var new_theme = Theme.new()
			if _undo_manager != null:
				_undo_manager.create_action_mixed("UI Theme Create",
					[{"type": "property", "target": ctrl, "property": "theme", "value": new_theme}],
					[{"type": "property", "target": ctrl, "property": "theme", "value": ctrl.theme}])
			else:
				ctrl.theme = new_theme
```

`"set_params"` 分支（:245-262）`theme.set(key, val)` 改为聚合 method op（在 for 循环内累积 do/undo_ops，循环后一次 create_action_mixed）：

```gdscript
		"set_params":
			var theme = ctrl.theme
			if theme == null:
				return {"error": {"code": -32004, "message": "Node has no theme assigned"}}
			var p = params.get("params")
			if p != null and p is Dictionary:
				var t_do: Array = []
				var t_undo: Array = []
				for key in p:
					if not key is String:
						continue
					if ":" in key or "/" in key:
						continue
					var val = p[key]
					if val is Object:
						continue
					if not _theme_has_property(theme, String(key)):
						continue
					t_undo.append({"type": "method", "target": theme, "method": "set", "args": [String(key), theme.get(key)]})
					t_do.append({"type": "method", "target": theme, "method": "set", "args": [String(key), val]})
				if not t_do.is_empty() and _undo_manager != null:
					_undo_manager.create_action_mixed("UI Theme Set Params", t_do, t_undo)
				else:
					for op in t_do:
						op["target"].callv("set", op["args"])
```

`"load"` 分支（:275-284）`ctrl.theme = res` 改为：

```gdscript
		"load":
			var load_path: String = params.get("theme_path", "")
			if load_path == "":
				return {"error": {"code": -32004, "message": "theme_path is required for load action"}}
			if not _validate_resource_path(load_path):
				return {"error": {"code": -32004, "message": "theme_path must start with res:// or user://: " + load_path}}
			var res = load(load_path)
			if res == null:
				return {"error": {"code": -32000, "message": "Failed to load theme from: " + load_path}}
			if _undo_manager != null:
				_undo_manager.create_action_mixed("UI Theme Load",
					[{"type": "property", "target": ctrl, "property": "theme", "value": res}],
					[{"type": "property", "target": ctrl, "property": "theme", "value": ctrl.theme}])
			else:
				ctrl.theme = res
```

（`"save"` 分支不改——文件写不进 undo 栈。）

- [ ] **Step 4: handle_theme_set_property 补 undo（method op + 旧值）**

在各 `theme.set_xxx(...)` 前累积 do/undo method op（取旧值：`theme.get_color(prop, type)` 等）。在 `var value = params.get("value")`（:423）后初始化 `var t_do: Array = []` / `var t_undo: Array = []`，各分支改写（示例 color/default_font；constant/stylebox 同理）：

```gdscript
	match item_type:
		"default_font":
			var font_path: String = str(value)
			if not _validate_resource_path(font_path):
				return {"error": {"code": -32004, "message": "font path must start with res:// or user://: " + font_path}}
			var font = load(font_path)
			if font == null:
				return {"error": {"code": -32004, "message": "Failed to load font: " + font_path}}
			t_do.append({"type": "method", "target": theme, "method": "set_default_font", "args": [font]})
			t_undo.append({"type": "method", "target": theme, "method": "set_default_font", "args": [theme.get_default_font()]})
		"color":
			var c = value
			if c is Array and c.size() >= 3:
				var a = float(c[3]) if c.size() >= 4 else 1.0
				var new_col = Color(float(c[0]), float(c[1]), float(c[2]), a)
				t_do.append({"type": "method", "target": theme, "method": "set_color", "args": [prop_name, theme_type, new_col]})
				t_undo.append({"type": "method", "target": theme, "method": "set_color", "args": [prop_name, theme_type, theme.get_color(prop_name, theme_type)]})
			else:
				return {"error": {"code": -32004, "message": "Color value must be array [r, g, b] or [r, g, b, a]"}}
		"constant":
			t_do.append({"type": "method", "target": theme, "method": "set_constant", "args": [prop_name, theme_type, int(value)]})
			t_undo.append({"type": "method", "target": theme, "method": "set_constant", "args": [prop_name, theme_type, theme.get_constant(prop_name, theme_type)]})
		"stylebox":
			# stylebox 分支保持现有资源路径校验逻辑，t_do/t_undo 追加 set_stylebox + theme.get_stylebox 旧值
			# （执行时按现有 :444-460 stylebox 分支结构，对称追加 method op）
			pass
		_:
			return {"error": {"code": -32004, "message": "Invalid item_type: " + item_type}}
	if not t_do.is_empty():
		if _undo_manager != null:
			_undo_manager.create_action_mixed("UI Theme Set Property", t_do, t_undo)
		else:
			for op in t_do:
				op["target"].callv(op["method"], op["args"])
	return {"result": {"theme_node": theme_node_path, "item_type": item_type, "name": prop_name, "status": "property_set"}}
```

> 注：stylebox 分支（:444+）执行时保持其资源路径校验，对称追加 `set_stylebox` method op + `theme.get_stylebox(prop_name, theme_type)` 旧值。返回结构按当前文件 `:460+` 返回点对齐。

- [ ] **Step 5: detect 通过 + check:gdscript + editor 实测**

Run: `npx vitest run test/regression/defects-fixed.test.ts -t ui-theme-no-undo` → PASS
Run: `npm run check:gdscript` → 0/0
Editor 实测：`ui_set_theme action=create` → Ctrl+Z 回滚（theme 清空）；`theme_set_property color` → Ctrl+Z 回滚旧色。

- [ ] **Step 6: commit**

```bash
git add addons/godot_mcp_server/commands/ui_commands.gd test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "fix(correctness): F2-ui-theme set_theme+theme_set_property 补 undo（method op，theme_create 排除）（D-P2 Task4）"
```

---

## Task 5: F3 animation keyframe_index 边界守卫

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\animation_commands.gd:186,206,269`
- Modify: defects.ts / defects-fixed.test.ts（加 detect + 计数 121→122）

**Interfaces:** 无。

- [ ] **Step 1: 写 detect 闭包（RED）**

```typescript
  { key: 'animation-keyframe-index-no-bound', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // P2(2026-07-29 报告5 F3): remove/update/curve 三分支 ki=int(keyframe_index) 后无 track_get_key_count 守卫 →
    // 越界 ki 假成功。fix: ki 守卫返 -32004。detect: 三分支均无 ki key_count 守卫 = 复发。
    detect: () => {
      const a = readSrc('addons/godot_mcp_server/commands/animation_commands.gd');
      const guards = (a.match(/ki\s*<\s*0\s*or\s*ki\s*>=\s*anim\.track_get_key_count/g) || []).length;
      return guards >= 3 ? 0 : 1;
    } },
```

计数同步：`121` → `122`。
Run: `npx vitest run test/regression/defects-fixed.test.ts -t animation-keyframe-index` → Expected FAIL（guards 0）

- [ ] **Step 2: 三分支加 ki 守卫**

`:186`（remove）、`:206`（update）、`:269`（curve）每处 `var ki = int(keyframe_index)` 后加：

```gdscript
		if ki < 0 or ki >= anim.track_get_key_count(ti):
			return {"error": {"code": -32004, "message": "keyframe_index out of range"}}
```

- [ ] **Step 3: detect 通过 + check:gdscript + editor 实测**

Run: `npx vitest run test/regression/defects-fixed.test.ts -t animation-keyframe-index` → PASS（guards 3）
Run: `npm run check:gdscript` → 0/0
Editor 实测：`animation_keyframe_remove keyframe_index=999` → 返 -32004 而非假成功。

- [ ] **Step 4: commit**

```bash
git add addons/godot_mcp_server/commands/animation_commands.gd test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "fix(correctness): F3 animation keyframe_index 三分支边界守卫（D-P2 Task5）"
```

---

## Task 6: F4 websocket outbound buffer

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:231`
- Modify: defects.ts / defects-fixed.test.ts（加 detect + 计数 122→123）

**Interfaces:** 无。

- [ ] **Step 1: 写 detect 闭包（RED）**

```typescript
  { key: 'websocket-outbound-no-buffer-limit', status: 'fixed', severity: 'IMPORTANT', dimension: 'Reliability',
    // P2(2026-07-29 报告5 F4): ws_peer 只 set_inbound_buffer_size 无 set_outbound_buffer_size →
    // sync 风暴/慢消费者 outbound 无界增长 OOM。fix: set_outbound_buffer_size(4MB)。
    // detect: websocket_server.gd 无 set_outbound_buffer_size = 复发（CI 新增，Obsidian defects.md 同步回标）。
    detect: () => {
      return /set_outbound_buffer_size/.test(readSrc('addons/godot_mcp_server/websocket_server.gd')) ? 0 : 1;
    } },
```

计数同步：`122` → `123`。
Run: `npx vitest run test/regression/defects-fixed.test.ts -t websocket-outbound` → Expected FAIL

- [ ] **Step 2: 加 set_outbound_buffer_size**

`:231`（`ws_peer.set_inbound_buffer_size(MAX_MESSAGE_SIZE)`）后加一行：

```gdscript
	ws_peer.set_outbound_buffer_size(4 * 1024 * 1024)  # F4(2026-07-29): 4MB outbound 上限防慢消费者堆积 OOM
```

（**不**加 push_warning——`send_mcp_notification`:393-397 已有；**不**加 close peer——本地 ≤5 认证 peer，push_warning 足够。）

- [ ] **Step 3: detect 通过 + check:gdscript + editor 实测**

Run: `npx vitest run test/regression/defects-fixed.test.ts -t websocket-outbound` → PASS
Run: `npm run check:gdscript` → 0/0
Obsidian `D:\workspace\Obsidian\GodotMCP\项目待办.md` / defects.md：回标 `websocket-outbound-no-buffer-limit` open→fixed。

- [ ] **Step 4: commit**

```bash
git add addons/godot_mcp_server/websocket_server.gd test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "fix(reliability): F4 websocket set_outbound_buffer_size 防 OOM（D-P2 Task6）"
```

---

## Task 7: D-P2 批次验收门禁汇总

**Files:** 无新改（验证 only）

- [ ] **Step 1: 全量门禁**

```bash
cd /d/GitHub/godot-mcp-enhanced
npx tsc --noEmit                      # 0 错误
npm run lint                          # 0 errors（warnings 确认非本次引入）
npm run check:gdscript                # 0 err / 0 warn（4.6.3 + 4.7.1）
npx vitest run                        # 全量 passed（4 pre-existing T11 elicitation 确认非回归）
npx vitest run test/regression/defects-fixed.test.ts   # 全绿，length===123
```

- [ ] **Step 2: 确认计数一致性**

Run: `grep -c "key:" test/regression/defects.ts`（应增 6：4 新 detect + 注释/open 不变）
Run: `node -e "import('./test/regression/defects.js').then(m=>console.log(m.FIXED_DEFECTS.length))"` → 123
确认 defects.ts:2 头注 / defects-fixed.test.ts:142/:144 均为 123。

- [ ] **Step 3: cp 同步项目内 addons + editor 端到端实测**

把改过的 `addons/godot_mcp_server/commands/{command_helpers,nav_commands,ui_commands,animation_commands,asset/custom_meshes,asset/path_generator}.gd` + `websocket_server.gd` cp 到使用 enhanced 的项目内 addons（若该测试项目存在），重启编辑器，跑：F1 超大 torus 不卡死 / F2 nav+ui Ctrl+Z 回滚 / F3 越界 ki 返 -32004 / F4 多 peer 不 OOM。

- [ ] **Step 4: 更新 progress.md + 项目待办**

在 `.superpowers/sdd/progress.md` 加 D-P2 章节（baseline `e2e87c2`，6 commit，各 finding 闭环 + 门禁结果）。
`项目待办.md` 回标报告5 F1-F4。

- [ ] **Step 5: requesting-code-review（final 用 opus）**

D-P2 全 6 commit 走 `superpowers:requesting-code-review`，final review opus，0C/0I 后开 D-ADV。

---

## Self-Review

**1. Spec 覆盖**：F1（Task1）/F2-nav（Task2）/F2-ui-control（Task3）/F2-ui-theme（Task4）/F3（Task5）/F4（Task6）+ 验收（Task7）= spec D-P2 全 4 条 finding 覆盖。F2 拆 3 子 task 对应实测复杂度。theme_create 排除（实测不改节点，注释说明）。

**2. Placeholder 扫描**：Task4 stylebox 分支标「执行时按现有结构对称追加」——这是唯一带执行判断的点（stylebox 资源路径校验逻辑复杂，执行时读 :444-460 对称追加 method op）；其余 step 均含完整代码/命令。detect 计数用动态规则（每 task +1，基线 117）。

**3. 类型一致性**：`CommandHelpers._record_prop(do_ops, undo_ops, target, prop, new_val)` 在 Task2 定义、Task3/4 消费，签名一致。method op 结构 `{type:"method", target, method, args}` 与 property op `{type:"property", target, property, value}` 全程一致，create_action_mixed 两类 op 均支持（particle_commands 已证）。

**4. 风险**：① F2-nav `create_action_mixed` 的 action_name 无 request_id（handle_nav_set_params 签名无 request_id 参数），用固定串 "Set NavAgent Params"——不影响 undo 功能，仅 action label。② path_generator sample 返 [] vs 结构化错误：plan Step4 按返空对齐（调用方已处理空），执行时确认 sample 返回类型。③ theme method op 旧值 `theme.get_color(prop, type)` 未设时返默认色——undo 后归默认（非完美还原），ADVISORY 级可接受，Task4 注明。
