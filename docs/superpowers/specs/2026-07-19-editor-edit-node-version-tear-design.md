# Spec — editor edit_node/batch_add_nodes 版本撕裂修复设计

**日期**：2026-07-19
**范围**：spec A §6 拆出的独立 spec——editor 模式 edit_node / batch_add_nodes / add_node(properties) 版本撕裂修复
**前置**：spec A（edit_node 持久化 + 资源识别）已闭环 commit `f35a3ef`..`d3461b7`（master 不 push，领先 origin 27）
**审查**：本 spec 经口头 design review，3 处调整已吸收（路由事实修正 / 名字校验对齐 / 技术债显式化），见各节「调整」标注

## 背景与根因

spec A 修复了 **headless 侧** edit_node / add_node / batch_add_nodes 的资源属性识别 + 持久化（`_set_property_with_coerce` + pack+save）。但 **editor 模式**（Godot 编辑器运行 + 插件 WebSocket 连接）下，这三个 action 的版本撕裂未修，且三处路由现状**不同**，须分别看清：

**① edit_node / batch_add_nodes —— 根本没接 editor-method-map**
`D:\GitHub\godot-mcp-enhanced\src\tools\scene\index.ts:325`(batch) / `:363`(edit_node) 的 TS 入口**无条件 `spawnGodot`** 改盘上 .tscn，**与 editor 连接状态无关**。editor-method-map.ts 的 `scene` 表（`:65-72`）只登记了 add_node / remove_node / instance_scene / set_instance_property / open_scene / save_scene，**没有 edit_node / batch_add_nodes**。后果：editor 连接时 edit_node/batch 仍走 headless 子进程改盘 → 编辑器内存仍是旧场景 → 用户 GUI Ctrl+S 覆盖回旧版 → edit_node/batch 静默丢失（版本撕裂）。

**② add_node —— 已登记但不处理 properties**
add_node 已登记 editor-method-map，editor 连接时 `ToolDispatcher` 路由到 `handle_add_node`。但 `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\node_commands.gd:29-77` 的 `handle_add_node` **不处理 properties 参数**（`:36-38` 只取 node_type / node_name / parent_node_path 三字段，`create_action_mixed` do_ops `:66-68` 只有 add_child / set_owner / reference）。editor 模式 add_node 带 properties 被丢弃（headless 路径已用 `_set_property_with_coerce` 修，editor 路径未修）。

**③ 迁移先例**
`handle_remove_node`（`node_commands.gd:82` 注释）白纸黑字："经 editor-method-map 走此处（不再 -32601 回退 headless 文件操作）"——add_node/remove_node 这一族的既定迁移模式。edit_node/batch_add_nodes 是同族但漏接。

> **调整 1（路由事实修正）**：早期 design 草稿把 edit_node/batch 现状笼统说成"-32601 fallback→headless"，不准确。add_node 是"已登记、editor 连接时走 handler"；edit_node/batch 是"压根没登记、TS 入口无条件 spawnGodot"。登记 edit_node/batch 后，TS 入口的 spawnGodot 才退化为"editor 未连接时的 headless fallback"。

## 范围边界

**含**：
1. `editor-method-map.ts` 登记 `scene.edit_node` / `scene.batch_add_nodes`
2. `command_handler.gd` `match method` 加 `"edit_node"` / `"batch_add_nodes"` 分支
3. `node_commands.gd` 新增 `handle_edit_node` / `handle_batch_add_nodes` + 改 `handle_add_node` 补 properties
4. `command_helpers.gd` 新增 `coerce_property_value` 统一 helper + `BLOCKED_PROPERTIES`
5. `index.ts` edit_node(`:347`) / batch_add_nodes(`:316`) case 补 `checkEditorSceneSave` 守卫
6. `defects.ts` 登记 editor 版 detect baseline

**不含**：
- `index.ts:323` batch_add_nodes 名字黑名单 `/[\]["/:\\]/` 历史遗留不改（与 `handle_add_node:41` 白名单不一致，记 follow-up defect；本 spec editor handler 统一对齐白名单先例）
- `scene-instance.ts` `_try_set` 迁移（spec A 已记 follow-up）
- editor handler 自动 `save_scene`（YAGNI；对齐 add_node / remove_node 改内存不 save 惯例，落盘交给 editor 工作流）
- headless 侧改动（spec A 已闭环；本 spec 仅 editor 侧 + TS 守卫）

## 修复方案

### 1. `coerce_property_value` 统一 helper（command_helpers.gd）

`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\command_helpers.gd` 新增（`class_name CommandHelpers` 静态方法）：

```gdscript
const BLOCKED_PROPERTIES := [
    "script", "owner", "process_mode", "process_priority", "process_input",
    "process_unhandled_input", "process_unhandled_key_input", "process_internal",
    "physics_process_mode", "physics_interpolation_mode", "name", "meta",
    "input_event", "ready", "tree_entered", "tree_exited", "tree_exiting",
    "instance",  # I-2: instance 可注入 ExtResource 实例化恶意场景 _ready
]

# 统一 property coerce：BLOCKED 过滤 + 资源识别 + Array 数学 coerce + 类型校验。
# 关键：只 coerce 不 set（返 coerced value），set 由 handler 经 undo 系统 do_op 执行——
# editor 要 per-property undo（do=set new / undo=set old），helper 内置 set 会重复执行。
static func coerce_property_value(obj: Object, prop: String, val: Variant) -> Dictionary:
    # 返 {"ok": bool, "value": Variant, "error": String}
    # 1. prop ∈ BLOCKED_PROPERTIES（含 instance）→ ok:false
    # 2. get_property_list 查不到 prop → ok:false
    # 3. 查属性 type 分支（严格对齐 headless _set_property_with_coerce 语义，消除 editor/headless 撕裂）：
    #    TYPE_OBJECT: val is String + res:// → has_path_traversal 校验 → load（失败 ok:false）；
    #                 val is String + 非 res:// → ok:false（非静默，修反馈 ③ 同根因）；
    #                 val 非 String → 透传（JSON 无法表达 Resource 实例，非 String 值交 Godot set 处理，与 headless 一致）
    #    非 TYPE_OBJECT: val is Array → coerce_value_for_property（:140 数学类型 coerce）；非 Array 透传
    # 4. ok:true, value: coerced（或透传 val）
```

> **已知技术债（调整 3）**：`coerce_property_value`（editor, command_helpers.gd）与 `_set_property_with_coerce`（headless, godot_operations.gd）逻辑高度重复（instance 拒绝 + TYPE_OBJECT+res:// load + 非 res:// 报错），仅 set 归属不同（editor 不 set 留 undo 系统；headless 内置 set 因无 per-property undo、走整场景 pack+save）。GDScript 无跨文件/跨进程 import 机制（headless 是独立 SceneTree 进程，editor addon 是编辑器内 class_name），无法共享实现。靠 `defects.ts` 双向 detect 防两份漂移。未来若有公共 GD 库机制可合并。这是刻意的不对称，非疏漏。

### 2. `handle_edit_node`（node_commands.gd 新增）

`EditorInterface.edited_scene_root` → `CommandHelpers.find_node(root, node_path)`（复用现有 `:29`）→ 遍历 properties 调 `coerce_property_value` → 成功的收集 do_op `{method:"set", target:node, args:[key, coerced]}` + undo_op `{method:"set", target:node, args:[key, old_val]}`（old_val = `node.get(key)` 预读）→ `create_action_mixed` 一次注册。失败的 property 累计进返回值（非阻塞，对齐 headless edit_node 行为）。节点找不到返 `-32002`。

> **undo 策略边界（实现注意，留 plan 细化）**：per-property undo 在 `node_commands.gd` 无先例（add/remove 是节点级 undo）。`create_action_mixed` 的 op 格式（`{type:"method", target, method, args}`）支持 set property op 技术可行（Godot `Object.set`），但需 plan 核实 `create_action_mixed` 签名（`_undo_manager` 类型 + 是否 EditorUndoRedoManager 包装）+ old_val 预读失败 fallback（只读 property / `get` 返 null）——预读失败的 property 跳过 undo 注册、只做 do，或整 property 跳过，plan 定。

### 3. `handle_batch_add_nodes`（node_commands.gd 新增）

**预校验全部 node** → 任一失败返结构化错误，**editor 内存零改**：
- node_type ∈ `_is_allowed_node_type` 白名单（对齐 `handle_add_node:45` 先例，禁 class_name 脚本节点）
- node_name 匹配 `^[A-Za-z0-9_]+$` 白名单（对齐 `handle_add_node:41` 先例）
- parent 存在（`CommandHelpers.find_node` + `has_path_traversal`）

全过则 `create_action_mixed` 批量：每 node 的 do_ops = `[add_child, set_owner, ...set properties]` + `reference`，undo_ops = `[remove_child]`（节点移除时 properties 随之消失，无需逐 property 还原）。properties 失败累计进返回值（非阻塞）。

> **调整 2（校验对齐）**：editor batch handler 名字校验统一用白名单 `^[A-Za-z0-9_]+$`（对齐 handle_add_node 先例）。`index.ts:323` 的黑名单 `/[\]["/:\\]/` 是历史遗留，本 spec 不改。editor（白名单）vs headless 前置（黑名单）的名字校验严格度不一致记 follow-up defect——但本 spec 不引入新不一致（editor handler 内部统一白名单）。

### 4. `handle_add_node` 补 properties（node_commands.gd 改现有）

在现有 `create_action_mixed`（`:63-73`）的 do_ops 里、`reference` 前，插入每个 property 的 `{method:"set", target:cls, args:[key, coerced]}`（coerced 经 `coerce_property_value`）。undo_ops 不变（remove_child 整节点，properties 随节点消失）。properties 失败累计进返回值。node_type 白名单 + 名字校验保持现有。

### 5. editor-method-map 登记 + command_handler 分支

- `D:\GitHub\godot-mcp-enhanced\src\core\editor-method-map.ts` `scene` 表加：
  ```ts
  edit_node: { method: 'edit_node' },
  batch_add_nodes: { method: 'batch_add_nodes' },
  ```
  对齐现有 `add_node`/`remove_node` 登记形式。登记后 editor 连接时 `ToolDispatcher` 路由到 editor handler。
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd` `match method`（`:105`）加：
  ```gdscript
  "edit_node":
      return _node_commands.handle_edit_node(params, request_id)
  "batch_add_nodes":
      return _node_commands.handle_batch_add_nodes(params, request_id)
  ```
  对齐 `:114-117` add_node/remove_node 分支。

### 6. index.ts checkEditorSceneSave 守卫

`D:\GitHub\godot-mcp-enhanced\src\tools\scene\index.ts` `edit_node`(`:347`) / `batch_add_nodes`(`:316`) case 在 `spawnGodot` 前加 `checkEditorSceneSave(absPath)`，对齐 `add_node`(`:155-158`)。

> 这是 **headless fallback 路径**防线：登记 editor-method-map 后，editor 连接时 edit_node/batch 走 editor handler（不改盘，守卫不触发）；editor 未连接时 fallback headless spawnGodot，守卫防盘改覆盖 editor 内存。两条路径互补。

## 安全

- **instance 三保险**：TS `BLOCKED_PROPS` 前置警告（edit_node/batch/add_node case 已有）+ `coerce_property_value` 拒绝 + `BLOCKED_PROPERTIES` 列表。I-2 对齐 headless + spec A。
- **res:// 路径**：`coerce_property_value` load 前经 `CommandHelpers.has_path_traversal`（`:49`，段级 `..` 阻断，对齐 headless `_sanitize_res_path`）。
- **node_type 严白名单**：batch 预校验用 `_is_allowed_node_type`（`:132`，精确匹配 ALLOWED_NODE_TYPES，禁 class_name 脚本节点实例化触发 _ready）。
- **非 res:// String 拒绝**：TYPE_OBJECT 属性传非 res:// String → ok:false（非静默，对齐 headless 修反馈 ③ 的非静默策略）。

## 验收标准

1. editor 连接时 `edit_node {texture:"res://x.png"}` 路由到 `handle_edit_node`（不走 spawnGodot），edited_scene_root 内存场景 texture 属性正确 load 成 Resource（非字符串）。
2. editor edit_node 后 undo（Ctrl+Z 或 undo 工具）能还原 property 旧值。
3. editor `edit_node {instance:"res://x.tscn"}` 返 blocked（instance 三保险）。
4. editor `batch_add_nodes` 预校验失败（node_type 非白名单 / parent 找不到 / 名字非法）返结构化错误，editor 内存零改。
5. editor `batch_add_nodes` 全过批量 add + properties 正确 set + undo 还原（remove_child 各节点）。
6. editor `add_node` 带 properties 时 properties 正确 set（不再被丢弃）。
7. editor 未连接时 edit_node/batch fallback headless spawnGodot，`checkEditorSceneSave` 守卫防覆盖 editor 内存（若该场景在编辑器打开）。
8. editor handler 改内存不自动 save（对齐 add_node/remove_node），落盘由 Ctrl+S / save_scene 负责。
9. `coerce_property_value` load 前必经 `has_path_traversal`，`../` 被拒。
10. editor（白名单）与 headless（黑名单）名字校验不一致记 follow-up defect（本 spec 不改 index.ts）。

## 测试分层（对齐 spec A 务实分层）

- **vitest**：
  - editor-method-map 登记 edit_node/batch_add_nodes（扩 `D:\GitHub\godot-mcp-enhanced\test\core\editor-method-map.test.ts`）
  - index.ts edit_node/batch case 守卫接线（mock `checkEditorSceneSave`，扩 scene 工具测试）
- **check:gdscript**：`handle_edit_node` / `handle_batch_add_nodes` / `handle_add_node`(改) / `coerce_property_value` + `BLOCKED_PROPERTIES` 编译通过（4.7 + 4.6.2）
- **defects.ts detect**（editor 版 baseline 防复发）：
  - editor `coerce_property_value` 存在 + instance 拒绝分支
  - `handle_edit_node` / `handle_batch_add_nodes` 存在
  - editor-method-map 含 edit_node / batch_add_nodes 登记
  - index.ts edit_node/batch case 含 checkEditorSceneSave 守卫
  - headless 侧 detect（spec A 已加 `resource-prop-coerce-helper` 等）保留，双向防两份 helper 漂移
- **行为集成**（手动 / L2，需 editor 环境）：editor 打开场景 → edit_node 改资源属性 → 内存场景生效 + undo 还原 + 不走 headless spawn。记 defects.ts 注释作手动验收点（GD 行为测试基础设施薄弱，务实分层）

## 行号说明

本 spec 行号基于 2026-07-19 核实（`node_commands.gd:29-77/82-129`、`command_handler.gd:105-117`、`command_helpers.gd:49/58/140`、`editor-method-map.ts:57-72`、`index.ts:316/323/347/363/155-158` 已亲验）。plan 阶段 Step 0 全部重新 grep/读核实。
