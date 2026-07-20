# editor 路由 follow-up 修复（F1+F3+F2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 A 档 editor 路由验证发现的 3 个 follow-up——F1（add_node parent "root" editor 路由失效，真 bug）+ F3（白名单 block Control 类错误信息补 ui_create_control 提示）+ F2（rule 文档注明 editor 路由操作活动场景）。

**Architecture:** F1 在 `node_commands.gd handle_add_node` 改用 `CommandHelpers.find_node`（已识别 "root"，对齐 edit_node/batch/headless），一行核心改动复用 helper；F3 改 add_node/batch 两处错误信息字符串（batch 保留 `nodes[%d]` index 前缀）；F2 在 editor.md 常见陷阱段加一条。F1 实施后登记 defect `add-node-editor-root-routing`（defects.ts FIXED，闭环 defects.md:192 duplication-across-layers 最后一个漏用 find_node 的 handler）。

**Tech Stack:** GDScript（addons/godot_mcp_server）、TypeScript（defects.ts detect）、Markdown（.claude/rules）。验证用 `check:gdscript`（4.7+4.6.2 编译）+ vitest（defects 回归）+ editor 端到端（用户 CardGame2）。

## Global Constraints

- **行号基线**：`addons/godot_mcp_server/commands/node_commands.gd` 当前 HEAD `a71863e`，F1 改动块 `:48-56`、F3 add_node `:45-46`、F3 batch `:220-221`。GDScript 用 **tab 缩进**（编辑必须保留 tab，不能用空格）。
- **编辑工具**：`.gd` 文件**禁用 Claude 内置 Edit**（tab 缩进匹配率低），改用 MCP `edit_script` search_and_replace 或手工 Write 整段。本 plan 假设执行者用 `edit_script`（CRLF 安全、行号鲁棒）。
- **defects.ts 计数**：FIXED_DEFECTS 当前 60 条，F1 登记 +1 → 61。头注 line 2 同步更新。
- **不 push**：用户惯例，commit 到 master 不 push origin（prior 多次确认）。
- **CardGame2 addon 同步**：cp 整目录 enhanced → CardGame2，**非 .uid 覆盖**（CardGame2 独有 .uid 保留）。
- **reviewer ADVISORY 纳入**：F3 batch 错误信息保留 `nodes[%d]` index 前缀；验证补 batch TextureRect 用例。

---

## File Structure

- **Modify** `addons/godot_mcp_server/commands/node_commands.gd` — F1（handle_add_node `:54` get_node_or_null → find_node）+ F3（`:46` add_node 错误信息、`:221` batch 错误信息）
- **Modify** `test/regression/defects.ts` — 登记 defect `add-node-editor-root-routing`（FIXED，detect 查 get_node_or_null 消除）+ 头注计数 60→61
- **Modify** `.claude/rules/godot-mcp-editor.md` — F2 常见陷阱段加一条（editor 路由操作活动场景）
- **No new files**

---

### Task 1: F1 — handle_add_node 改用 find_node + 登记 defect

**Files:**
- Modify: `addons/godot_mcp_server/commands/node_commands.gd:48-56`（handle_add_node parent 解析）
- Modify: `test/regression/defects.ts`（FIXED_DEFECTS 加条目 + 头注 line 2 计数）

**Interfaces:**
- Consumes: `CommandHelpers.find_node(root, parent_path)` 已存在（`command_helpers.gd:29-43`，识别 "root"/root_name/"root/" 前缀）
- Produces: handle_add_node parent 解析与 edit_node/batch 一致；defect detect 谓词 `countMatchesInFile('addons/.../node_commands.gd', /root\.get_node_or_null\(parent_path\)/)`

- [ ] **Step 1: 用 edit_script 改 handle_add_node parent 解析**

用 MCP `edit_script`（search_and_replace 模式，CRLF 安全）。old：

```gdscript
	var parent_node: Node = root
	if not parent_path.is_empty():
		# I-5: 复用 CommandHelpers.has_path_traversal(与 scene_commands/ui_commands 防御深度对齐)。
		# Godot get_node_or_null 受场景树结构限制无法逃出 root,但显式拒绝 .. 段与项目防御一致。
		if CommandHelpers.has_path_traversal(parent_path):
			return {"error": {"code": -32002, "message": "Invalid parent path (traversal): %s" % parent_path}}
		parent_node = root.get_node_or_null(parent_path)  # IMP-1: null-safe; get_node() pushes error on missing path
		if not parent_node:
			return {"error": {"code": -32002, "message": "Parent not found: %s" % parent_path}}
```

new（保留 tab 缩进 + has_path_traversal 检查 + I-5 注释，只换 get_node_or_null → find_node 并补 F1 注释）：

```gdscript
	var parent_node: Node = root
	if not parent_path.is_empty():
		# I-5: 复用 CommandHelpers.has_path_traversal(与 scene_commands/ui_commands 防御深度对齐)。
		# Godot get_node_or_null 受场景树结构限制无法逃出 root,但显式拒绝 .. 段与项目防御一致。
		if CommandHelpers.has_path_traversal(parent_path):
			return {"error": {"code": -32002, "message": "Invalid parent path (traversal): %s" % parent_path}}
		# F1 (2026-07-20): 复用 CommandHelpers.find_node（识别 "root"/root_name/"root/" 前缀），
		# 对齐 handle_edit_node / handle_batch_add_nodes / headless godot_operations.gd:316。
		# 原 root.get_node_or_null 不识别 "root"（root 不是自己的子节点）→ editor 路由 add_node parent="root" 失效。
		parent_node = CommandHelpers.find_node(root, parent_path)
		if not parent_node:
			return {"error": {"code": -32002, "message": "Parent not found: %s" % parent_path}}
```

- [ ] **Step 2: check:gdscript 编译验证（GD 守卫）**

Run: `npm run check:gdscript`
Expected: `errors=0 warnings=0`（4.7 + 4.6.2 --import 全量编译）。若 warnings≠0，排查 tab 缩进 / find_node 签名。

- [ ] **Step 3: 登记 defect add-node-editor-root-routing（defects.ts）**

在 `test/regression/defects.ts` FIXED_DEFECTS 数组末尾（最后一条后）加：

```ts
  { key: 'add-node-editor-root-routing', status: 'fixed', severity: 'IMPORTANT', dimension: 'EditorRouting',
    detect: () => {
      // F1 (2026-07-20): handle_add_node parent 解析改用 CommandHelpers.find_node（识别 "root"），
      // 对齐 edit_node/batch/headless godot_operations.gd:316。复发：handle_add_node 仍用 root.get_node_or_null(parent_path)。
      // 注：handle_remove_node:116 用 get_node_or_null(node_path) 非 parent_path，不匹配，不影响。
      return countMatchesInFile('addons/godot_mcp_server/commands/node_commands.gd', /root\.get_node_or_null\(parent_path\)/);
    } },
```

头注 line 2 计数更新：`FIXED_DEFECTS 60 条` → `FIXED_DEFECTS 61 条`，并在括号描述末尾加 `+ 2026-07-20 editor 路由 add_node parent root 失效×1`。

- [ ] **Step 4: 跑 defects 回归测试（确认 detect=0 + 计数 61）**

Run: `npx vitest run test/regression/`
Expected: 全绿，新 defect `add-node-editor-root-routing` detect=0（find_node 在位，get_node_or_null(parent_path) 消除）。若 defects-fixed 计数断言失败，核对头注计数与数组实际长度。

- [ ] **Step 5: commit F1 + defect**

```bash
git add addons/godot_mcp_server/commands/node_commands.gd test/regression/defects.ts
git commit -m "fix(editor-routing): handle_add_node 改用 CommandHelpers.find_node 识别 parent root（F1）" -m "对齐 handle_edit_node/handle_batch_add_nodes/headless godot_operations.gd:316。原 root.get_node_or_null 不识别 root（root 不是自己的子节点）致 editor 路由 add_node parent=root 失效。登记 defect add-node-editor-root-routing FIXED（defects.ts 60→61），闭环 defects.md duplication-across-layers 最后一个漏用 find_node 的 handler。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: F3 — 错误信息补 Control 类提示（add_node + batch）

**Files:**
- Modify: `addons/godot_mcp_server/commands/node_commands.gd:46`（add_node）+ `:221`（batch，保留 `nodes[%d]` index 前缀）

**Interfaces:**
- 无新接口，纯字符串改动

- [ ] **Step 1: edit_script 改 add_node 错误信息（:46）**

old:
```gdscript
	if not _is_allowed_node_type(node_type):
		return {"error": {"code": -32004, "message": "Blocked node type: %s" % node_type}}
```

new:
```gdscript
	if not _is_allowed_node_type(node_type):
		return {"error": {"code": -32004, "message": "Blocked node type: %s. Control 类（TextureRect/Button 等）请用 ui_create_control 工具" % node_type}}
```

- [ ] **Step 2: edit_script 改 batch 错误信息（:221，保留 nodes[%d] index 前缀）**

old:
```gdscript
		if not _is_allowed_node_type(node_type):
			return {"error": {"code": -32004, "message": "nodes[%d].node_type blocked: %s" % [i, node_type]}}
```

new（保留 `nodes[%d]` index 前缀，补 Control 提示——reviewer ADVISORY：照搬 add_node 会丢 index 语义，100 节点批量无法定位错误）:
```gdscript
		if not _is_allowed_node_type(node_type):
			return {"error": {"code": -32004, "message": "nodes[%d].node_type blocked: %s. Control 类（TextureRect/Button 等）请用 ui_create_control 工具" % [i, node_type]}}
```

- [ ] **Step 3: check:gdscript 编译验证**

Run: `npm run check:gdscript`
Expected: `errors=0 warnings=0`。

- [ ] **Step 4: commit F3**

```bash
git add addons/godot_mcp_server/commands/node_commands.gd
git commit -m "feat(editor-routing): add_node/batch 白名单 block 错误信息补 Control→ui_create_control 提示（F3）" -m "add_node :46 + batch :221（保留 nodes[%d] index 前缀）。纯字符串零行为变化。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: F2 — editor.md 文档注明 editor 路由操作活动场景

**Files:**
- Modify: `.claude/rules/godot-mcp-editor.md:97`（常见陷阱段末尾加一条）

- [ ] **Step 1: Edit editor.md 常见陷阱段加一条**

在 `godot-mcp-editor.md` 常见陷阱段最后一条（`editor 模式 WebSocket 端口 9090-9094`，line 97）后追加：

```markdown
- **editor 路由操作活动场景（2026-07-20）**：`add_node`/`edit_node`/`batch_add_nodes`/`remove_node` 的 editor 路由（editor-method-map 登记后 editor 连接时走 `handle_*`）操作**编辑器活动场景**（`ei.get_edited_scene_root()`），`scene_path` 参数仅 headless 生效。editor 模式操作非活动场景须先 `open_scene` 切换活动场景。editor/headless 语义差异：headless 按 scene_path 加载磁盘场景改盘，editor 改内存活动场景（不落盘，须 save_scene 持久化）。
```

- [ ] **Step 2: commit F2**

```bash
git add .claude/rules/godot-mcp-editor.md
git commit -m "docs(editor-rule): 注明 editor 路由操作活动场景 scene_path 仅 headless 生效（F2）" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 全量门禁 + build + cp 同步 CardGame2

**Files:**
- 无源码改动，验证 + build 产物 + 跨项目同步

- [ ] **Step 1: 全量门禁（tsc + lint + check:gdscript + vitest）**

Run:
```bash
npx tsc --noEmit && npm run lint && npm run check:gdscript && npx vitest run
```
Expected: tsc exit 0 / lint 0 errors（既有 warning 非本次可接受）/ check:gdscript errors=0 warnings=0 / vitest 全绿（含新 defect detect=0）。失败则回 Task 1-3 修。

- [ ] **Step 2: build 重建**

Run: `npm run build`
Expected: exit 0，`build/` 产物刷新（含 node_commands.gd 同步到 build/scripts/）。

- [ ] **Step 3: 确认 build 含 F1 改动**

Run: `grep -c "find_node(root, parent_path)" build/scripts/node_commands.gd`
Expected: `1`（F1 改动进 build）。若 0，排查 build/scripts 是否从 src/scripts 拷贝（package.json build 脚本含 .gd 拷贝）。

- [ ] **Step 4: cp 同步 enhanced addon → CardGame2（非 .uid）**

```bash
cp -r D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/. D:/workspace/projects/CardGame2/addons/godot_mcp_server/
```

验证 diff（应仅 .uid 差异）：
```bash
diff -rq D:/GitHub/godot-mcp-enhanced/addons/godot_mcp_server/ D:/workspace/projects/CardGame2/addons/godot_mcp_server/ | grep -v "\.uid"
```
Expected: 空（非 .uid 差异 0）。

- [ ] **Step 5: commit 门禁通过状态（如有 drift fix）**

通常 Task 1-3 已 commit 全部源码改动，本步无新 commit。若门禁发现 drift（如 matrix/version-sync）需修，单独 commit。

---

### Task 5: 用户 editor 端到端验证（协作，非 commit task）

**前提**：用户在注册了 mcp__godot 的 Claude Code session，CardGame2 编辑器重启（加载新 addon）+ editor 模式 connected。

- [ ] **Step 1: 用户重启 CardGame2 编辑器 + 打开测试场景**

用户操作：重启编辑器（加载 F1/F3 改动）→ 打开 `res://scenes/_mcp_test_en.tscn`（A 档验证用的测试场景，或新建）。

- [ ] **Step 2: 验证 F1（add_node parent=root 成功）**

```
scene add_node scene_path=res://scenes/_mcp_test_en.tscn parent_node_path=root node_type=Sprite2D node_name=F1Test
```
Expected: `{status:"created", node_path:".../root/F1Test"}`（修前 `Parent not found: root`）。

- [ ] **Step 3: 验证 F3 add_node（TextureRect 错误信息含 ui_create_control）**

```
scene add_node scene_path=res://scenes/_mcp_test_en.tscn node_type=TextureRect node_name=T
```
Expected: `{error:{code:-32004, message:"Blocked node type: TextureRect. Control 类（TextureRect/Button 等）请用 ui_create_control 工具"}}`。

- [ ] **Step 4: 验证 F3 batch（TextureRect 错误信息含 index + ui_create_control）**

```
scene batch_add_nodes scene_path=res://scenes/_mcp_test_en.tscn nodes=[{node_type:TextureRect,node_name:T}]
```
Expected: `{error:{code:-32004, message:"nodes[0].node_type blocked: TextureRect. Control 类（...）请用 ui_create_control 工具"}}`（含 `nodes[0]` index 前缀）。

- [ ] **Step 5: 用户反馈结果**

把 3 步返回 JSON 贴回，验证通过则进 Task 6 回标；失败照贴定位。

---

### Task 6: 验证通过后回标反馈文档 + 项目待办

**Files:**
- Modify: `D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md`（scene 分区 372 条 F1/F2/F3 → 🟢）
- Modify: `D:\workspace\Obsidian\GodotMCP\项目待办.md`（A 档 follow-up 段）

- [ ] **Step 1: 回标反馈文档 F1/F2/F3 条目（scene 分区 372 条）**

把 372 条状态 `🟡 open` → `🟢 fixed` + commit hash（F1/F3 代码 + F2 文档），补注"2026-07-20 用户 CardGame2 editor 端到端验证通过"。F2 注"editor 本质操作活动场景，改文档非代码"。

- [ ] **Step 2: 更新项目待办 A 档 follow-up 段**

A 档段补注"F1+F3+F2 已修 + 用户验证通过 + defect add-node-editor-root-routing FIXED"。

- [ ] **Step 3: 回标 review 文档（可选）**

`docs/review-2026-07-20-editor-routing-followup.md` 末尾状态段补注 F1/F2/F3 🟢 + commit。

---

## Self-Review

**Spec coverage**：
- spec §F1（handle_add_node find_node）→ Task 1 ✅
- spec §F3（add_node + batch 错误信息）→ Task 2 ✅（含 reviewer ADVISORY batch index 前缀）
- spec §F2（editor.md 文档）→ Task 3 ✅
- spec 验证（check:gdscript + build + cp + editor 端到端）→ Task 4-5 ✅（含 reviewer 建议 batch 用例）
- reviewer defect 登记 → Task 1 Step 3 ✅

**Placeholder 扫描**：无 TBD/TODO；每步含完整代码 + 命令 + 预期。

**Type/signature 一致**：`CommandHelpers.find_node(root, parent_path)` 签名全 plan 一致（`command_helpers.gd:29` `static func find_node(root: Node, path: String) -> Node`）；defect key `add-node-editor-root-routing` 全 plan 一致；node_commands.gd 行号 `:46/:221/:54` 基线 `a71863e`。

**TDD 调整说明**：GDScript addon editor handler 在 enhanced 仓库无 unit test 框架（未装 GUT），Task 1 用 defect detect（修复前 =1 失败 / 修复后 =0 通过）作为防复发回归 + check:gdscript 编译守卫 + vitest defects-fixed 回归，近似 TDD；行为最终验证靠 Task 5 editor 端到端。诚实不造 GD unit test（YAGNI）。
