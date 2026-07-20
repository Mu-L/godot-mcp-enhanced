# Spec — editor 路由 follow-up 修复（F1+F3+F2）

**日期**：2026-07-20
**范围**：A 档 editor 路由验证（`835c780` 打通）发现的 3 个 follow-up：F1（真 bug，add_node parent "root" editor 路由失效）+ F3（错误信息优化，白名单缺 Control 提示）+ F2（文档，editor 路由操作活动场景）。F1 修代码，F3 改错误信息，F2 改 rule 文档。
**前置**：enhanced master `f75ce95`（A 档 spec）+ editor 路由 7 commit（`e51d124`..`1d08a16`）+ build 重建含 editor-method-map 登记。A 档 editor 验证通过（edit_node 30s 超时修复，2 判据铁证）。来源 `docs/review-2026-07-20-editor-routing-followup.md`。

## 背景（源码核实）

A 档 editor 路由打通后首次端到端用 add_node/edit_node，连踩 3 个 follow-up：

- **F1（真 bug）**：`handle_add_node:54` 用 `root.get_node_or_null(parent_path)`，传默认 `"root"` → root 不是自己的子节点 → `Parent not found: root`。editor/headless 不一致：headless（`godot_operations.gd:316`）明确识别 `parent_path == "root"` 为场景根。
- **F2（设计差异）**：`node_commands.gd:32` `ei.get_edited_scene_root()` 取编辑器活动场景根，`scene_path` 参数 editor handler 全程未参与定位。editor 活动场景 ≠ scene_path 时操作错场景。editor 本质只能操作活动场景内存（EditorInterface 限制），改逻辑不可行。
- **F3（by design）**：`ALLOWED_NODE_TYPES:6-15` I-4 严格白名单不含 Control 子类（TextureRect 等 block），Control 走 `ui_create_control`（`ui_commands.gd:14`）。错误信息未提示替代方案。

## F1 影响范围核实（关键）

`CommandHelpers.find_node`（`command_helpers.gd:30-43`）**已识别 "root"**：

```gdscript
if path == "" or path == "root":
    return root
# + strip "root/" / root.name + "/" 前缀，识别 root.name 本身
```

- `handle_edit_node:160` 用 find_node → ✅ 无 F1
- `handle_batch_add_nodes:224` 用 find_node → ✅ 无 F1
- `handle_add_node:54` 用 get_node_or_null（**漏用 find_node**）→ ❌ F1 仅此处

反馈 F1 只踩 add_node 印证此范围。

## 方案

### F1（方案 A，复用 find_node）

`node_commands.gd handle_add_node:48-56` 改：

```gdscript
var parent_node: Node = root
if not parent_path.is_empty():
    if CommandHelpers.has_path_traversal(parent_path):
        return {"error": {"code": -32002, "message": "Invalid parent path (traversal): %s" % parent_path}}
    parent_node = CommandHelpers.find_node(root, parent_path)  # 原 root.get_node_or_null → find_node（识别 "root"/root_name）
    if not parent_node:
        return {"error": {"code": -32002, "message": "Parent not found: %s" % parent_path}}
```

一行核心改动（get_node_or_null → find_node），复用 helper，与 edit_node/batch 完全一致，对齐 headless。保留 has_path_traversal 检查（防御深度）。

**否决 B/C**：B（内联识别）重复 find_node 逻辑；C（TS 默认 "root"→""）破坏 headless。

### F3（错误信息）

`node_commands.gd:46`（add_node）+ `:221`（batch）：

```
"Blocked node type: %s. Control 类（TextureRect/Button 等）请用 ui_create_control 工具"
```

纯字符串，零行为变化。

### F2（rule 文档）

`.claude/rules/godot-mcp-editor.md` 加一段（常见陷阱）：

> editor 路由 add_node/edit_node/batch_add_nodes/remove_node 操作**编辑器活动场景**（`ei.get_edited_scene_root()`），`scene_path` 仅 headless 生效。editor 模式操作非活动场景须先 `open_scene` 切换活动场景。

不改代码逻辑（editor 本质操作活动场景）。

## 验证

1. `npm run check:gdscript`（4.7 + 4.6.2 编译，errors=0 warnings=0）
2. `npm run build` 重建
3. cp 同步 enhanced addon → CardGame2（非 .uid）
4. 用户 editor 端到端：
   - `add_node parent=root node_type=Sprite2D` → 成功（修前 `Parent not found: root`）
   - `add_node node_type=TextureRect` → 错误信息含"Control 类请用 ui_create_control"

## 不含

- F2 代码逻辑改动（editor 本质操作活动场景，改不了）
- F1 方案 B/C
- headless 路径（已识别 "root"，无需改）
- edit_node/batch（已用 find_node，无 F1）
- batch_add_nodes 资源绑定验证（A 档遗留，独立）
- headless edit_node 落盘验证（A 档遗留，独立）

## 协作分工

- code + 文档 + build + cp：我（enhanced session）
- CardGame2 editor 端到端验证：用户配合（重启编辑器 + 跑 add_node）
