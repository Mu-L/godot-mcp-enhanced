# D2 follow-up NodePath `..` 策略统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（inline，用户选；撤 6 处小改动无需子代理驱动）。Steps 用 checkbox（`- [ ]`）跟踪。

**Goal:** 撤 6 处节点路径范畴 `has_path_traversal` 前置（node_commands×4 + asset_placer×2），对齐 memory [[nodepath-traversal-category-error]] 范畴错误判断；保留 6 处资源范畴前置。

**Architecture:** 纯删除 + 注释更新 + 1 defects detect。撤后 `..` 直接进 find_node→get_node_or_null（SceneTree root 子树限制兜底，`..` 不能逃逸 fs）。保留资源范畴 6 处（res:// load/save 真 fs traversal）。

**Tech Stack:** GDScript（addons）+ TypeScript（defects.ts）+ Markdown（CHANGELOG/memory）。

## Global Constraints

- 4.7.1 + 4.6.2 双版本 `--headless --import` 真编译门禁（check:gdscript 正则假绿不可信）。
- Godot 二进制：`D:\Godot\`（4.7.1 + 4.6.2）。
- GDScript 字面 tab 缩进（内置 Edit + 字面 tab，或 MCP edit_script search_and_replace）。
- defects.ts FIXED detect 计数硬断言（`detect() === 0` 防复发）。
- master 本地不 push（用户惯例）。
- defects-fixed 计数当前 94 → 95。

---

### Task 1: 撤 6 处节点路径范畴前置 + 更新注释

**Files:**
- Modify: `addons/godot_mcp_server/commands/node_commands.gd`（:50-53 / :108-109 / :161-162 / :231-232）
- Modify: `addons/godot_mcp_server/commands/asset/asset_placer.gd`（:150 / :154-155 / :203-204）

**Interfaces:** 无新接口（纯删除 + 注释）。

**Produces:** node_commands + asset_placer 的节点路径参数不再前置 has_path_traversal；`..` 直接进 get_node_or_null 解析。

- [ ] **Step 1: 撤 node_commands.gd handle_add_node 前置（:50-53）+ 换注释**

old:
```gdscript
	if not parent_path.is_empty():
		# I-5: 复用 CommandHelpers.has_path_traversal(与 scene_commands/ui_commands 防御深度对齐)。
		# Godot get_node_or_null 受场景树结构限制无法逃出 root,但显式拒绝 .. 段与项目防御一致。
		if CommandHelpers.has_path_traversal(parent_path):
			return {"error": {"code": -32002, "message": "Invalid parent path (traversal): %s" % parent_path}}
		# F1 (2026-07-20): 复用 CommandHelpers.find_node（识别 "root"/root_name/"root/" 前缀），
```
new:
```gdscript
	if not parent_path.is_empty():
		# 范畴错误修正（D2 follow-up 2026-07-24）：节点路径用 find_node→get_node_or_null 解析，受 SceneTree
		# root 子树限制无法逃逸 fs；.. 是合法父引用（root/A/../B 等价 root/B）。撤 has_path_traversal 前置
		# （resource 范畴检查误用于 scene tree），对齐 memory nodepath-traversal-category-error + 批次 A A11 否决。
		# F1 (2026-07-20): 复用 CommandHelpers.find_node（识别 "root"/root_name/"root/" 前缀），
```

- [ ] **Step 2: 撤 node_commands.gd handle_edit_node + handle_remove_node 前置（:108-109 / :161-162，两块相同 → replace_all）**

old（edit 与 remove 两处完全相同）:
```gdscript
		return {"error": {"code": -32004, "message": "node_path is required"}}
	if CommandHelpers.has_path_traversal(node_path):
		return {"error": {"code": -32002, "message": "Invalid node path (traversal): %s" % node_path}}
```
new:
```gdscript
		return {"error": {"code": -32004, "message": "node_path is required"}}
```
（Edit `replace_all: true`，一次改 edit + remove 两处）

- [ ] **Step 3: 撤 node_commands.gd handle_batch_add_nodes 前置（:231-232）**

old:
```gdscript
			return {"error": {"code": -32004, "message": "nodes[%d].node_type blocked: %s. Control 类（TextureRect/Button 等）请用 ui_create_control 工具" % [i, node_type]}}
		if CommandHelpers.has_path_traversal(parent_path):
			return {"error": {"code": -32002, "message": "nodes[%d].parent traversal: %s" % [i, parent_path]}}
```
new:
```gdscript
			return {"error": {"code": -32004, "message": "nodes[%d].node_type blocked: %s. Control 类（TextureRect/Button 等）请用 ui_create_control 工具" % [i, node_type]}}
```

- [ ] **Step 4: 撤 asset_placer.gd resolve_parent 前置（:150 / :154-155）+ 换注释**

old:
```gdscript
# resolve_parent：绝对路径剥首段（若=root.name）+ 相对路径都吃；无效返 null
# 复用 CommandHelpers.has_path_traversal（对齐 node_commands.gd:52 防御深度）
static func resolve_parent(root: Node, parent_path: String) -> Node:
	if parent_path.is_empty():
		return root
	if CommandHelpers.has_path_traversal(parent_path):
		return null
	if parent_path.begins_with("/"):
```
new:
```gdscript
# resolve_parent：绝对路径剥首段（若=root.name）+ 相对路径都吃；无效返 null
# 范畴错误修正（D2 follow-up 2026-07-24）：节点路径用 get_node_or_null 解析受 SceneTree root 子树限制，
# .. 是合法父引用，撤 has_path_traversal 前置（resource 范畴误用），对齐 memory nodepath-traversal-category-error。
static func resolve_parent(root: Node, parent_path: String) -> Node:
	if parent_path.is_empty():
		return root
	if parent_path.begins_with("/"):
```

- [ ] **Step 5: 撤 asset_placer.gd _validate_item 前置（:203-204）**

old:
```gdscript
	if parent_path != "":
		if CommandHelpers.has_path_traversal(parent_path):
			return {"code": "INVALID_PARAMS", "message": "parent 路径含遍历（..）: %s" % parent_path}
		if resolve_parent(root, parent_path) == null:
			return {"code": "INVALID_PARAMS", "message": "parent 未找到: %s" % parent_path}
```
new:
```gdscript
	if parent_path != "":
		if resolve_parent(root, parent_path) == null:
			return {"code": "INVALID_PARAMS", "message": "parent 未找到: %s" % parent_path}
```

- [ ] **Step 6: check:gdscript 编译验证**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0

- [ ] **Step 7: --import 双版本真编译**

Run: `D:/Godot/godot-4.7.1.exe --headless --import --path test/fixtures/gdscript-check` + `D:/Godot/godot-4.6.2.exe --headless --import --path test/fixtures/gdscript-check`
Expected: 无 Parse/Script Error
> 注：实现时确认 fixture 路径与既有批次编译验证一致；Godot 二进制实际文件名以 D:\Godot\ 为准。

- [ ] **Step 8: grep 实测撤干净**

Run: `grep -c "CommandHelpers.has_path_traversal" addons/godot_mcp_server/commands/node_commands.gd addons/godot_mcp_server/commands/asset/asset_placer.gd`
Expected: 两文件均 `0`

- [ ] **Step 9: commit**

```bash
git add addons/godot_mcp_server/commands/node_commands.gd addons/godot_mcp_server/commands/asset/asset_placer.gd
git commit -m "fix(D2): 撤 6 处节点路径范畴 has_path_traversal 前置——范畴错误修正（对齐 memory nodepath-traversal-category-error）"
```

---

### Task 2: defects detect + 计数 + CHANGELOG + memory + 全门禁

**Files:**
- Modify: `test/regression/defects.ts`（加 nodepath-traversal-category-error FIXED detect + 计数头注 94→95）
- Modify: `test/regression/defects-fixed.test.ts`（计数断言 94→95）
- Modify: `CHANGELOG.md`（D2 follow-up 段）
- Modify: `C:\Users\wgt\.claude\projects\D--GitHub-godot-mcp-enhanced\memory\nodepath-traversal-category-error.md`（补实测分类，不入 git 仓库）

**Interfaces:**
- Consumes: Task 1 的撤前置结果（node_commands + asset_placer 的 has_path_traversal = 0）
- Produces: defects detect `nodepath-traversal-category-error`（防 6 处前置复发）

- [ ] **Step 1: 加 defects detect**

在 defects.ts `FIXED_DEFECTS` 数组末尾加（参照既有 countMatchesInFile 先例，如 `csv-tmp-clean-output-dir-only`；实现时读 defects.ts 顶部确认 helper 签名）:
```typescript
{
  key: 'nodepath-traversal-category-error',
  severity: 'IMPORTANT',
  dimension: 'correctness',
  status: 'fixed',
  detect: () =>
    countMatchesInFile('addons/godot_mcp_server/commands/node_commands.gd', /CommandHelpers\.has_path_traversal/) +
    countMatchesInFile('addons/godot_mcp_server/commands/asset/asset_placer.gd', /CommandHelpers\.has_path_traversal/),
},
```
> detect 返回 0 = 两文件节点路径范畴撤干净。资源范畴 6 处（command_helpers/scene/ui/asset_commands/asset_factory）不计。

- [ ] **Step 2: 计数 94→95**

- defects.ts 头注「94 FIXED」→「95 FIXED」
- `defects-fixed.test.ts:113` `expect(FIXED_DEFECTS.length).toBe(94)` → `.toBe(95)`
- `defects-fixed.test.ts:115` `new Set(keys).size` 断言 94→95
- `defects-fixed.test.ts:20` it 名「80 条」不动（批次 D 已 defer，历史停更）

- [ ] **Step 3: CHANGELOG D2 follow-up 段**

在 CHANGELOG D2 段后追加:
```markdown
### D2 follow-up：NodePath `..` 策略统一（2026-07-24）

撤 6 处节点路径范畴 `has_path_traversal` 前置（node_commands×4 + asset_placer×2）——范畴错误修正：`..` 是合法父引用（`root/A/../B` 等价 `root/B`），get_node_or_null 受 SceneTree root 子树限制无法逃逸 fs。保留 6 处资源范畴前置（res:// load/save 真 fs traversal）。对齐 memory `nodepath-traversal-category-error` + 批次 A A11 否决先例。defects detect `nodepath-traversal-category-error` 防复发。
```

- [ ] **Step 4: memory 补实测分类**

在 `nodepath-traversal-category-error.md` 正文末尾补一段:
```markdown

**D2 follow-up 闭环（2026-07-24）**：撤 6 处节点路径范畴 `has_path_traversal` 前置（node_commands:52/108/161/231 + asset_placer:154/203），保留 6 处资源范畴（res:// load/save：command_helpers:203 / ui_commands:387 / asset_commands:112 / asset_factory:131 / scene_commands:32,100）。先前「8/9 处节点路径」分类（批次 D spec）误把 resource scope 的 scene/ui 算入，实测节点路径 6 + 资源 6 = 12。
```

- [ ] **Step 5: 全门禁**

- `npm run build` exit 0
- `npx tsc --noEmit` exit 0
- `npm run lint` 0 errors
- `npm run check:gdscript` 0-0
- `--import` 4.7.1 + 4.6.2 真编译
- `npm test` 全量 passed（4 T11 pre-existing 不计）
- `npm test defects-fixed` 95/95 + `nodepath-traversal-category-error` detect === 0

- [ ] **Step 6: commit**

```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts CHANGELOG.md
git commit -m "test(D2): nodepath-traversal-category-error defect detect + 计数 95 + CHANGELOG"
```
（memory 文件在 `.claude/` 不入 git 仓库，Write 单独保存）

---

## 验收

- 6 处节点路径前置撤干净（node_commands + asset_placer grep `CommandHelpers.has_path_traversal` = 0）
- 6 处资源范畴前置保留（command_helpers/scene/ui/asset_commands/asset_factory grep = 6）
- defects-fixed 95/95，`nodepath-traversal-category-error` detect === 0
- 全门禁绿
- master 本地领先 origin（不 push）
