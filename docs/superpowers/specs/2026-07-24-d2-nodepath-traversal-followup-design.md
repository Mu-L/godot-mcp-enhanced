# D2 follow-up：NodePath `..` 策略统一（撤节点路径范畴前置）

> 承接批次 D D2 撤销（范畴错误复活否决），独立 follow-up 统一 NodePath `..` 策略。superpowers brainstorming → writing-plans → inline executing 流程。

**日期**：2026-07-24
**项目**：godot-mcp-enhanced
**关联**：批次 D（D2 撤销）/ memory [[nodepath-traversal-category-error]] / 批次 A A11 否决先例

---

## 背景

批次 D D2 原拟在 `command_helpers.find_node` 内置 `has_path_traversal`，经 eng-review + memory 核实为**范畴错误复活**（批次 A A11 已否决同一建议），撤销转 follow-up。

`has_path_traversal`（`command_helpers.gd:49`）是 **resource 范畴**检查（对齐 `godot_operations._sanitize_res_path` 的 res:// 防护），语义是 **fs 路径穿越**。但当前有 **6 处误用于节点路径范畴**（scene tree）——`node_commands:51` 注释自承「get_node_or_null 受场景树结构限制无法逃出 root，但显式拒绝 `..` 段与项目防御一致」，即**知道范畴错误但有意防御性拒绝**。`find_node`（`command_helpers.gd:29-43`）唯一出口是 `root.get_node_or_null(p)`——纯场景树查找，返回 Node 不流入 load/DirAccess/FileAccess，零 fs 接触，自证范畴。

## 决策（用户拍板，方向 A）

**撤 6 处节点路径范畴前置，对齐 memory 范畴错误判断。**

理由：
1. `get_node_or_null` 受 SceneTree root 子树限制，`..` 不能逃逸到 fs（**无 traversal 风险**）。
2. 前置检查是**无效防御**——`get_node_or_null` 兜底已足够（解析失败返 null → 报「Parent/node not found」）。
3. 撤后 AI 可用合法 `../Sibling` 父引用（**功能增益**，如 `root/A/../B` 等价 `root/B`）。
4. **YAGNI**：移除无效防御，代码更诚实。
5. 对齐 memory [[nodepath-traversal-category-error]] 判断（批次 A A11 否决同一建议的延续）。

## 范围（grep 实测 2026-07-24，修正 memory「8 处」分类）

### 撤（6 处节点路径范畴，scene tree）

| 文件 | 行 | 函数 | 参数 |
|------|----|------|------|
| `node_commands.gd` | 52 | `handle_add_node` | parent_path |
| `node_commands.gd` | 108 | `handle_edit_node` | node_path |
| `node_commands.gd` | 161 | `handle_remove_node` | node_path |
| `node_commands.gd` | 231 | `handle_batch_add_nodes` | parent_path |
| `asset_placer.gd` | 154 | `resolve_parent` | parent_path |
| `asset_placer.gd` | 203 | `_validate_item` | parent_path |

### 保留（6 处资源范畴，res:// load/save，真 fs traversal）

- `command_helpers.gd:203`（coerce_property_value res:// load）
- `ui_commands.gd:387`（_validate_resource_path）
- `asset_commands.gd:112`（handle_save res_path）
- `asset_factory.gd:131`（material load）
- `scene_commands.gd:32`（scene_path res://，经本地 `_has_path_traversal` 包装 :22-23 转调）
- `scene_commands.gd:100`（instance_path res://，同上包装）

> **分类更正**：先前分析（批次 D spec）将 `scene:32/100` + `ui:387` 误归「节点路径」范畴（称「8/9 处节点路径」），实际这两处是 resource scope（res:// scene_path/instance_path/_validate_resource_path）。memory [[nodepath-traversal-category-error]] 正文只判范畴（NodePath `..` 是父引用非 fs 穿越）未给计数。实测节点路径范畴 **6 处**，资源范畴 **6 处**，合计 12 处。

## 实现

### 1. 撤 6 处前置（node_commands + asset_placer）

每处删除 `if CommandHelpers.has_path_traversal(...): return {...}` 块（含其上方的对齐注释行）。撤后 `..` 直接传入后续 `find_node` / `get_node_or_null` / `resolve_parent` 解析。

### 2. 更新注释

- **`node_commands.gd:50-51`**（I-5 注释）：从「复用 has_path_traversal + 显式拒绝 `..` 与项目防御一致」改为范畴错误修正说明——「节点路径用 get_node_or_null 解析，受 SceneTree root 子树限制无法逃逸 fs；`..` 是合法父引用（`root/A/../B` 等价 `root/B`）。撤 has_path_traversal 前置（resource 范畴检查误用于 scene tree），对齐 memory [[nodepath-traversal-category-error]]」。
- **`asset_placer.gd:150`**（resolve_parent 注释）：删「对齐 node_commands.gd:52 防御深度」，改为范畴错误说明（同上）。
- `_validate_item` 内 `# parent 校验（若提供）`（:200）注释保留——仍描述 parent 校验语义，非 traversal 专属。

### 3. defects.ts detect（防复发）

加 `nodepath-traversal-category-error` FIXED detect：
- `node_commands.gd` 中 `has_path_traversal` 调用计数 = 0
- `asset_placer.gd` 中 `has_path_traversal` 调用计数 = 0
- `command_helpers.gd:49` 定义 + resource scope 6 处（scene/ui/asset_commands/asset_factory/command_helpers:203）**不计**——这些是 resource 范畴合法使用

计数 detect 模式参照既有 `resource-prop-coerce-helper` / `csv-tmp-clean-output-dir-only` 等 countMatchesInFile 先例。

### 4. CHANGELOG + memory

- **CHANGELOG**：D2 follow-up 段（撤 6 处 + 范畴错误理由 + memory 分类更正）。
- **memory [[nodepath-traversal-category-error]]**：补入实测分类（6 节点路径范畴撤 + 6 资源范畴保留）+ D2 follow-up 闭环（撤 6 处，方向 A）。memory 原文只判范畴未计数，「8 处」出自批次 D spec 非本 memory，故无需更正 memory 计数。

## 不做（YAGNI）

- **不改 6 处资源范畴前置**（res:// 是真 fs traversal，必须保留）。
- **不给 nav/particle/animation/ui/scene-instance/test/animtree 等无前置调用点加前置**（方向 B 否决——工作量大 + 误拒合法父引用）。
- **不加 GD 行为测试**（get_node_or_null 兜底 + defects 静态 detect 已够；行为测试需 GD runtime mock 场景树，over-engineering）。如未来发现回归需求再补。

## 验收（门禁）

- `npm run build` exit 0
- `npx tsc --noEmit` exit 0
- `npm run lint` 0 errors
- `npm run check:gdscript` errors=0 warnings=0
- `godot --headless --import`（4.7.1 + 4.6.2 双版本真编译，因 check:gdscript 是正则假绿）
- `npm test` 全量 passed（4 个 T11 pre-existing 不计）
- `defects-fixed` 计数 +1（`nodepath-traversal-category-error`），全 FIXED detect === 0
- grep 实测：`node_commands.gd` + `asset_placer.gd` 的 `has_path_traversal` 调用 = 0

## 风险

- **低**：撤前置后 `..` 不被前置拒，但 `get_node_or_null` 兜底（null → 报「not found」）。无 fs 风险（场景树限制铁律）。
- **功能增益**：AI 可用 `../Sibling` 合法父引用。
- **防御降级**：理论（前置本就无效），实际零影响。
