# Spec A — edit_node 持久化 + 资源属性类型识别设计

**日期**：2026-07-18
**范围**：反馈 ①②③（edit_node 不落盘 / edit_node 资源属性错误 / batch_add_nodes 资源属性错误）+ editor 模式版本撕裂修复
**审查**：`D:\workspace\review\.claude\reviews\2026-07-18-edit-node-persist-design-eng-review.md`（5 处修正已吸收：CRITICAL recall + 3 IMPORTANT + 2 ADVISORY）

## 背景与统一根因

07-18 源码核实 3 条反馈，**同根因**：edit_node / add_node / batch_add_nodes 三处对资源类型属性（Texture2D / Font / AudioStream / PackedScene 等）都走"字面赋值字符串"——`node.texture = "res://x.png"` 或 `set("texture", "res://x.png")`。Godot 不会把 String 隐式转成 Resource，属性值停在字符串（或静默不赋值），节点"成功创建/编辑"但资源属性错。

- **① edit_node 额外不落盘**：`src/tools/scene/index.ts:347-372` 走 `executeGdscript`，脚本末尾仅 `_mcp_output("edited")`，无 pack+save。
- **② edit_node 资源属性**：`src/tools/scene/helpers.ts:36 gdScriptSetLine` 生成 `node.key = "res://..."` 字面赋值。
- **③ batch_add_nodes 资源属性**：`src/scripts/godot_operations.gd:375-379` `_is_safe_value` 把 String 当合法值 → `set("texture","res://x")` 字面赋值（**非"忽略"，是错误类型赋值** — 审查 IMPORTANT 措辞修正）。
- **add_node 同病**：`godot_operations.gd:304-306` 同样 `new_node.set(property, value)` 字面赋值。
- **附带（审查 IMPORTANT）**：batch 真正静默在 `failed_count`（:392-395）只 `log_error` 但 exit code 仍 0，TS 侧 `index.ts:329` `exitCode !== 0` 抓不到部分节点失败。

## 范围边界

**含**：edit_node 迁移持久化、GD 资源识别 helper（edit_node / add_node / batch 共用）、instance 安全回归防护、batch 失败结构化、editor-method-map 补 edit_node/batch（修复版本撕裂）。

**不含**：
- `src/tools/scene/scene-instance.ts` 的 `_try_set` 迁移（:67/152 仍用 `gdScriptSetLine`，记 follow-up defect，避免 scope 蔓延）。
- `gdScriptSetLine` 不删（scene-instance.ts 两处仍用）。
- edit_node `save` 参数（YAGNI，本 spec 直接自动落盘；若后续需“仅内存”再加）。
- helper 仅覆盖资源识别（TYPE_OBJECT + res:// String → load）；NodePath 等其他类型转换留 follow-up，避免实现者以为全覆盖。

**②超时分桶（审查 ADVISORY）**：edit_node 资源属性"30s 超时"根因未举证——Godot 把 String 赋给 Resource 通常静默/push_error，不必然 30s 超时；30s timeout（`index.ts:361`）更可能被 autoload 加载或 scene instantiate 慢操作触发。Task 0 先分桶定位（超时 vs 静默失败），若超时另因单独追，不混入资源识别。

## 修复方案

### 1. GD 资源识别 helper（核心，GD 侧共用载体）

`src/scripts/godot_operations.gd` 新增 `_set_property_with_coerce(node, key, value) -> bool`：

```gdscript
func _set_property_with_coerce(node: Node, key: String, value: Variant) -> bool:
    # 安全面：外层 _is_safe_property 已过滤 BLOCKED_PROPERTIES（含 instance，见 §4）
    var prop_info: Dictionary = _find_property_info(node, key)  # get_property_list 查 type+hint
    if prop_info.is_empty():
        log_error("Property not found: %s on %s" % [key, node.get_class()])
        return false
    var t: int = prop_info["type"]
    var coerced: Variant = value
    if t == TYPE_OBJECT and value is String and value.begins_with("res://"):
        coerced = load(_sanitize_res_path(value))   # :618 已有 sanitize，防 ../ 穿越 + null byte
        if coerced == null:
            log_error("Failed to load resource: %s" % value)
            return false
    elif t == TYPE_OBJECT and not (coerced is Object):
        log_error("Type mismatch: property %s expects Object, got %s" % [key, str(coerced)])
        return false   # 非静默 — 解决 ③ silently fail
    node.set(key, coerced)
    return true
```

`_find_property_info` 用 `node.get_property_list()` 找属性的 `type` + `hint` + `hint_string`（TYPE_OBJECT + PROPERTY_HINT_RESOURCE_TYPE 判 Resource 子类）。

**共用载体**：`godot_operations.gd`（headless）与 `addons/godot_mcp_server/command_handler.gd`（editor）共用同一 GD helper。TS 侧 `scene-instance.ts _try_set` 不动（独立 follow-up）。

### 2. edit_node 迁移到 godot_operations.gd（持久化）

新增 `edit_node(params)`：`_sanitize_res_path` → `load` scene → instantiate → `find_node`（get_node_or_null）→ 循环 `_set_property_with_coerce` → **复用 add_node pack+save 尾段（:311-322 `PackedScene.pack` + `ResourceSaver.save` + free），不复用 owner 赋值**（add_node :309 `new_node.owner = scene_root` 是给**新节点**设归属；edit_node 改的是**已存在节点**，照搬会把 owner 非本场景的节点——如 instance 进来的子节点——错误提升、被 pack 进主场景）。

`src/tools/scene/index.ts:347-372` edit_node case 从 `executeGdscript` 改 `spawnGodot` 调 `ctx.opsScript` 的 edit_node（对齐 batch_add_nodes :316-345 调用模式）。

### 3. add_node / batch_add_nodes 改用 helper

- `godot_operations.gd:304-306` add_node 的 `new_node.set(property, ...)` → `_set_property_with_coerce(new_node, property, ...)`，累计失败计数。
- `godot_operations.gd:375-379` batch_add_nodes 同改。

### 4. instance 安全回归防护（审查 IMPORTANT）

`_BLOCKED_PROPERTIES`（:598-603）**加 `instance`**，注释引 I-2：

```gdscript
const BLOCKED_PROPERTIES := [
    "script", "owner", "process_mode", ..., "instance",
    # I-2: instance 可注入 ExtResource 实例化恶意场景 _ready，与 script 同级危险
]
```

**双保险**：`_set_property_with_coerce` 内对 `instance` 显式拒绝（即使漏加黑名单也不 load）。理由：迁移后若 helper 对 Resource 子类 + res:// load，instance（PackedScene 是 Resource 子类）会命中 load 分支 → `instance:"res://malicious.tscn"` → load + 实例化恶意 _ready = I-2 严防的场景重新打开。

### 5. batch 失败结构化（审查 IMPORTANT）

`godot_operations.gd` batch_add_nodes：`failed_count > 0` 时 `quit(1)` 或 stdout 输出结构化失败列表（节点名 + 失败原因），TS `index.ts:329` 据此报错。不再 exit 0 静默。

### 6. editor 版本撕裂修复（审查 ADVISORY 重定位）

`src/core/editor-method-map.ts` 补 `scene.edit_node → edit_node` / `scene.batch_add_nodes → batch_add_nodes`（参照 add_node 既有登记，plan 核实 :65-72）。

`addons/godot_mcp_server/command_handler.gd` + scene commands 加 editor 分支：`EditorInterface.edited_scene_root` 找节点 → 复用同一 GD `_set_property_with_coerce` → undo_manager（可 undo）。

**定位为"修复 editor 模式版本撕裂"**（非新增功能）：当前 editor 用户调 edit_node，headless 子进程改盘上 .tscn，编辑器内存仍是旧场景 → GUI save 覆盖回旧版 → edit_node 静默丢失（与 add_node 的 `checkEditorSceneSave` 守卫 :155-158 防的同形态，但 edit_node/batch 无此守卫）。补全后 edit_node/batch 也应受 `checkEditorSceneSave` 守卫保护（headless 兜底路径）。

## 安全

- `_sanitize_res_path`（:618 已有）防 `../` 穿越 / null byte / 反斜杠 / 百分号解码。helper load 前必 sanitize。
- TS 侧 edit_node/batch_add_nodes 入口对资源类属性值前置 `sanitizeResPath`（与 load_sprite :244 一致）。
- instance 入 BLOCKED + helper 双保险（I-2）。
- 对齐 RCE 复合链 spec（`docs/superpowers/specs/2026-07-12-rce-compound-chain-fix-design.md`）同类入口加固。

## autoload 退化验证（审查 IMPORTANT）

edit_node 当前 `load_autoloads=true`（index.ts:360-361），迁移到 spawnGodot 后 headless 子进程 autoload 行为不同。风险：目标节点是 class_name 脚本节点 + 自定义属性时，headless `get_property_list` 可能查不到（[[autoload-classname-headless-pitfall]]）。

- Task 验证：对比迁移前后 `load_autoloads=true/false` 同一 edit_node 调用；覆盖 class_name 脚本节点 + 自定义属性场景。
- **退路**：若退化，edit_node 仍走 executeGdscript，仅把资源识别 helper 注入 script（不迁移 spawnGodot）。spec 保留此退路。

## breaking change

edit_node 从"不落盘（只改内存）"变"自动落盘"。但"不落盘"是 bug 非 feature。CHANGELOG 标注（行为变化 + 迁移指引）。

## 验收标准

1. `edit_node {texture:"res://x.png"}` 后读 .tscn 验证 `texture = ExtResource(N)`（非字符串）+ 落盘成功。
2. `edit_node {instance:"res://x.tscn"}` 返 blocked 警告（不 load）— 安全回归防线。
3. edit_node 对 class_name 脚本节点的自定义属性在 headless 下能 set（autoload 退化验证；若退化走退路）。
4. batch_add_nodes 部分失败时 TS 侧收到错误（exitCode≠0 或结构化失败列表），不再静默。
5. editor 模式 edit_node 不再走 headless spawn（editor-method-map 拦截走 command_handler，不版本撕裂）。
6. `load(value)` 前必有 `_sanitize_res_path`，`../` 被拒（单测）。
7. add_node / batch_add_nodes 资源属性同样正确 load（非字面字符串）。
8. edit_node 对 instance 子节点改属性不改变 owner（owner 保持原值，不错误提升进主场景）。

## 测试

- **headless GD 单测**：`_set_property_with_coerce` 各类型分派（Resource+res:// / String / 类型不匹配 / instance 拒绝 / sanitize 拒绝 `../`）。
- **vitest**：edit_node 资源属性（texture/font/audio_stream）+ 持久化（save 后 grep .tscn ExtResource）+ 数值属性回归；batch 资源绑定 + 部分失败结构化。
- **editor**：editor-method-map 登记测试 + command_handler edit_node/batch editor 分支（active 场景改 + undo）。
- **defects.ts**：登记新 detect（`edit-node-resource-literal-coerce` / `batch-failed-silent-exit` / `instance-property-blocked`）baseline 防复发。

## 行号说明

本 spec 行号基于 2026-07-18 审查 + 核实（`godot_operations.gd:304-322/375-379/598-603` 已亲验；其余如 `index.ts:347-372/329`、`helpers.ts:36`、`command_handler.gd` editor 分支、`GodotServer.ts` 等来自审查文档）。plan 阶段 Step 0 全部重新 grep/读核实。
