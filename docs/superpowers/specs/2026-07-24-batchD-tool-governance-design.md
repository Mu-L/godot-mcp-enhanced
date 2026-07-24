---
date: 2026-07-24
type: spec
status: draft
systems:
  - "[[批次D工具治理]]"
---

# 2026-07-24 批次 D 工具治理设计（asset/android 游离 + find_node traversal 系统性）

> 适用于 godot-mcp-enhanced v0.23.0+（批次 A 安全 + B 可靠性 + C 正确性之后）。
>
> **行号锚点声明**：本文 `文件:行号` 为 2026-07-24 核查快照，会漂移；实现/plan 一律以 grep 实际行号为准。

## 背景

2026-07-22 三层架构综合审查 P1 ⑥（asset+android 工具游离）+ addons GDScript 审查 P2-6（find_node/load 调用点 traversal 检查不一致），归批次 D 工具治理。批次 A/B/C 已修 asset_factory load traversal（A5 `has_path_traversal` :131）+ path_generator strip root（C5 内联 strip），这两项排除。

**Architecture**：纯 bug 修复，不改工具签名/正常路径行为。2 条 finding（D1 TS + D2 GDScript），TDD（RED→fix→GREEN）。GDScript 改动须 `check:gdscript` + `godot --headless --import` 4.7+4.6.2 双版本真编译（批次 B/C 教训：check:gdscript 正则假绿）。

## Finding 清单（2 条）

| # | 位置 | finding | 严重度 |
|---|------|---------|--------|
| D1 | `src/core/tool-registry.ts:166-192`（TOOL_GROUPS） | asset/android 在 module-loader 注册（`module-loader.ts:57,71,75`）但不在 TOOL_GROUPS 也不在 ALWAYS_ALLOWED → `isToolAllowed('asset'/'android')` 恒 false；主分发 `executeToolCall → dispatchTool` 全程不查 isToolAllowed。发现层（tools/list）隐藏但执行层可达（ReadOnlyGuard 兜底非 RCE，但工具游离 + profile 不强制） | IMPORTANT |
| D2 | `addons/.../commands/command_helpers.gd:29-43`（find_node）+ ~34 调用点 | find_node 只 strip "root/" 前缀**不查 `..`**；animtree/animation/nav/particle/ui/test/scene 的 find_node 调用点无前置 has_path_traversal（node_commands/asset_placer 已显式前置）。实际 RCE 低（get_node_or_null 受 root 子树限制，`..` 通常返 null），但**纵深防御 + 一致性缺口** | ADVISORY |

## 设计（2 task 组）

### 组 1：D1 — TOOL_GROUPS 补 asset/android 组（TS）

**★ plan 期决策（已定）**：方案 (a) TOOL_GROUPS 补组（非方案 (b) executeToolCall 查 isToolAllowed——破坏 advanced-proxy delegateCall 逃生舱，不修）。

`tool-registry.ts` TOOL_GROUPS（:166-192）补 2 组：
```typescript
asset:   { description: '资源操作（asset-forge）', tools: ['asset'], requires: ['editor'] },
android: { description: 'Android deploy', tools: ['android'], requires: [] },
```
- **asset requires ['editor']**：asset 工具操作场景节点（create/path/batch/undo/save/list_shapes/list_materials），editor 连接态。
- **android requires []**：deploy=spawn `godot --export-android`（process 类重操作），无 editor/bridge/headless 连接依赖（对齐 `dynamic`/`blender`/`multi_instance` 的 `requires: []`）。

**效果（自动派生，无需额外接线）**：
- `getGroupForTool('asset'/'android')` 返组名（`toolToGroup` reverse map :237 从 TOOL_GROUPS 构建，自动含）
- `isToolAllowed('asset'/'android')`（:260-）：非 ALWAYS_ALLOWED（:244），但 `activeGroups` 含该组时 true
- `full` 模式 tools/list（:197 `Object.keys(TOOL_GROUPS)`）广告 asset/android
- profile 过滤（`getFilteredTools` :182 isToolAllowed）一致：full 含，lite/slim 按组排除

**不修 `executeToolCall`/`dispatchTool`**（方案 a， ReadOnlyGuard 仍是安全边界，工具注册一致性是发现层 + profile 层问题，非执行层强制）。

**验证**：
- `expect(getGroupForTool('asset')).toBeDefined()` + `expect(getGroupForTool('android')).toBeDefined()`
- full 模式 `getFilteredTools(activeGroups=full)` 含 asset/android tool
- isToolAllowed('asset', full activeGroups) === true

### 组 2：D2 — find_node 内置 has_path_traversal（GDScript）

**★ plan 期决策（已定）**：方案 (b) find_node 内置 traversal（非方案 (a) ~34 调用点逐个前置——重复代码 + 工作量大；审查报告推荐"单一实现"）。

`command_helpers.gd` find_node（:29-43）strip 前缀**前**加 traversal 检查：
```gdscript
## Find a node by path relative to root.
## Strips leading "root/" prefix and leading slashes.
## D2: 拒含 ".." 段的 traversal path（单一实现，所有调用自动防护，对齐 node_commands :51 注释
## "get_node_or_null 受场景树结构限制无法逃出 root，但显式拒绝 .. 段与项目防御一致"）。
static func find_node(root: Node, path: String) -> Node:
	if path == "" or path == "root":
		return root
	if has_path_traversal(path):   # D2: 拒 .. 段（在 strip 前缀前查，因 has_path_traversal 查原始 path）
		return null
	var p: String = path
	while p.begins_with("/"):
		p = p.substr(1)
	if p.begins_with("root/"):
		p = p.substr(5)
	if p.begins_with(root.name + "/"):
		p = p.substr(root.name.length() + 1)
	return root.get_node_or_null(p)
```

**效果**：所有 ~34 find_node 调用点自动拒 `..` traversal。node_commands（:52/108/161/231）+ asset_placer（:154/203）已显式前置 `has_path_traversal`（在 find_node 前 return error，不调 find_node，无双重检查）。

**find_node 调用点清单**（grep `CommandHelpers.find_node\|get_node_or_null` 核实，无前置 has_path_traversal 的，**plan 阶段逐点核实 null 处理**）：

| 文件 | 行号（2026-07-24 快照） | path 变量 | 调用数 |
|------|------------------------|-----------|--------|
| `animtree_commands.gd` | 23/75/116/160/201 | parent_path / node_path | 5 |
| `animation_commands.gd` | 18/124/252/317 | node_path | 4 |
| `nav_commands.gd` | 29/82/99/137/190 | parent_path / node_path | 5 |
| `particle_commands.gd` | 49/87/130/169/216 | parent_path / node_path | 5 |
| `ui_commands.gd` | 38/91/161/191/232/298/360/410 | parent_path / node_path / theme_node_path / source_path | 8 |
| `test_commands.gd` | 17/23/37/38/45 | path / src_path / tgt_path / parent_path | 5 |
| `scene_commands.gd` | 137/174 | parent_path / node_path | 2（待核实：:32/:100 已有 `_has_path_traversal`，:137/:174 是否在 handle 函数头已前置） |

**风险（D2 find_node null 处理）**：find_node 现 traversal 拒返 null。调用方原期望 null=找不到，需 `if node == null` 处理。**plan 阶段逐点核实 ~34 调用点的 null guard**（避免 find_node 返 null 后续崩）。已知多数调用方有 `if node == null: return {"error": NOT_FOUND}`，但需核实个别：
- `animtree_commands.gd:23` 三元 `CommandHelpers.find_node(root, parent_path) if parent_path != "" else root`——find_node 返 null 时 parent_node=null（需后续 if null 处理）
- 类似三元的（nav :29/:99/:190、particle :49、ui :38、test :45）——核实 null 处理

**行为变化边界**：find_node 现拒 `..`（返 null）。正常 path（无 `..`）不受影响。node_commands 注释 :51 已说"`..` 通常返 null"（get_node_or_null 受 root 子树限制），故 find_node 拒 `..` 与现状语义一致（显式拒而非依赖引擎子树限制）。若有调用方依赖 `..`（Godot 父节点引用合法语法），会 break——但 node_commands :51 注释明说项目防御一致策略是拒 `..`。

### 组 3：defects detect + CHANGELOG

`test/regression/defects.ts` 加 2 条 FIXED detect：
- `asset-android-tool-orphan`（D1）：查 TOOL_GROUPS 含 asset/android 组（`getGroupForTool` 返非 undefined）
- `find-node-no-traversal-guard`（D2）：查 command_helpers find_node 含 has_path_traversal 调用

`test/regression/defects-fixed.test.ts` 计数 93→95。CHANGELOG 批次 D 段。

## 不修 / 排除

- **asset_factory load traversal**：批次 A A5 已修（`asset_factory.gd:131` has_path_traversal）。
- **path_generator strip root**：批次 C C5 已修（内联 strip "root/"）。
- **executeToolCall 查 isToolAllowed**（D1 方案 b）：破坏 advanced-proxy delegateCall 逃生舱，D1 方案 a TOOL_GROUPS 补组够（发现层 + profile 一致）。
- **tool-registry 注释 "16" 过时**：次要，D1 补组后 17→19 组，注释顺手改（非独立 finding）。

## 验收标准

1. **D1 修复**：TOOL_GROUPS 含 asset/android 组 + getGroupForTool 返组名 + isToolAllowed 一致 + full tools/list 广告。
2. **D2 修复**：find_node 内置 has_path_traversal + ~34 调用点自动防护 + null 处理无崩（plan 逐点核实）。
3. **TDD**：每 finding RED（失败测试复现）→ fix → GREEN。字面量契约（find_node 含 has_path_traversal / TOOL_GROUPS 含 asset/android）+ 行为（getGroupForTool / find_node traversal 拒 null）。
4. **GDScript 编译门**：`check:gdscript` errors=0 warnings=0 **且** `godot --headless --import --path test/fixtures/gdscript-check` 4.7.1+4.6.2 双版本真编译过（check:gdscript 假绿，批次 B/C 教训）。
5. **回归门禁**：`tsc --noEmit` exit 0；全量 vitest 无新 failed（4 T11 pre-existing 不变）。
6. **defects detect**：D1/D2 登记 defects.ts FIXED（93→95）。
7. **CHANGELOG**：批次 D 段（工具治理）。

## 风险

1. **D2 find_node null 处理（最集中）**：~34 调用点 find_node 返 null（traversal）后是否崩。缓解：plan 阶段逐点核实 null guard，补个别缺失（尤其三元 `find_node(...) else root` 形式的 6 处：animtree:23/nav:29/99/190/particle:49/ui:38/test:45）。
2. **D2 行为变化**：find_node 现拒 `..`。正常 path 不受影响；依赖 `..`（父节点引用）的调用会 break。缓解：node_commands :51 注释已说项目策略拒 `..`（防御一致），find_node 内置落实该策略。grep 调用点无依赖 `..` 的合法用法（`..` 在 path 参数是 traversal 意图）。
3. **D1 android requires**：android deploy 需 Godot 可执行（findGodot），但 requires 是连接依赖（editor/bridge/headless）非 Godot 可执行。requires:[] 对齐 dynamic/blender（findGodot 是工具内部，非连接）。若 android 实际需 editor（export 配置），可改 requires:['editor']，但当前判断 deploy 是 process 类无连接依赖。
