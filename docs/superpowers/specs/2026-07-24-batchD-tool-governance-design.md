---
date: 2026-07-24
type: spec
status: revised
systems:
  - "[[批次D工具治理]]"
---

# 2026-07-24 批次 D 工具治理设计（asset/android 游离）

> 适用于 godot-mcp-enhanced v0.23.0+（批次 A 安全 + B 可靠性 + C 正确性之后）。
>
> **行号锚点声明**：本文 `文件:行号` 为 2026-07-24 核查快照，会漂移；实现/plan 一律以 grep 实际行号为准。
>
> **r1 修订（eng-review 后）**：原拟 D2（find_node 内置 traversal）经核实为范畴错误复活（批次 A A11 已否决），**D2 撤销**转 follow-up（见末段）。批次 D 收窄为 D1 单 finding。

## 背景

2026-07-22 三层架构综合审查 P1 ⑥（asset+android 工具游离），归批次 D 工具治理。

## Finding 清单（1 条；D2 撤销）

| # | 位置 | finding | 严重度 |
|---|------|---------|--------|
| D1 | `src/core/tool-registry.ts:166-193`（TOOL_GROUPS）+ `:244`（ALWAYS_ALLOWED） | asset/android 在 module-loader 注册（`module-loader.ts:57,71,75`）但不在 TOOL_GROUPS 也不在 ALWAYS_ALLOWED → `isToolAllowed('asset'/'android')` 恒 false；主分发 `executeToolCall → dispatchTool` 全程不查 isToolAllowed。发现层（tools/list）隐藏但执行层可达（ReadOnlyGuard 兜底非 RCE，但工具游离 + profile 不强制） | IMPORTANT |

## 设计：D1 — TOOL_GROUPS 补 asset/android 组（TS）

**★ plan 期决策（已定）**：方案 (a) TOOL_GROUPS 补组（非方案 (b) executeToolCall 查 isToolAllowed——破坏 advanced-proxy delegateCall 逃生舱，不修）。

`tool-registry.ts` TOOL_GROUPS（:166-193）补 2 组：
```typescript
asset:   { description: '资源操作（asset-forge）', tools: ['asset'], requires: ['editor'] },
android: { description: 'Android deploy', tools: ['android'], requires: [] },
```
- **asset requires ['editor']**：asset 工具操作场景节点（create/path/batch/undo/save/list_shapes/list_materials），editor 连接态。
- **android requires []**：deploy=spawn `godot --export-android`（process 类重操作），无 editor/bridge/headless 连接依赖（对齐 `dynamic`/`blender`/`multi_instance` 的 `requires: []`）。**plan 阶段实测** android export 是否需 editor（若 export 配置依赖编辑器，改 requires:['editor']）。

**效果（自动派生，无需额外接线）**：
- `getGroupForTool('asset'/'android')` 返组名（`toolToGroup` reverse map 从 TOOL_GROUPS 构建，自动含）
- `isToolAllowed('asset'/'android')`：非 ALWAYS_ALLOWED，但 `activeGroups` 含该组时 true
- `full` 模式 tools/list（`Object.keys(TOOL_GROUPS)`）广告 asset/android
- profile 过滤一致：full 含，lite/slim 按组排除

**不修 `executeToolCall`/`dispatchTool`**（方案 a， ReadOnlyGuard 仍是安全边界）。

**eng-review 核实的 3 小瑕疵（plan 顺手处理）**：
1. isToolAllowed 调用点行号：spec 引用以 grep 实测为准（`getFilteredTools` 在 `ToolDispatcher.ts`，行号漂移）。
2. `getFilteredTools` 过滤有 `isFeatureEnabled('TOOL_GROUPS')` flag 前置——plan 核实 flag 对新组无特殊影响。
3. android requires 待实测（见上）。

**验证**：
- `expect(getGroupForTool('asset')).toBeDefined()` + `expect(getGroupForTool('android')).toBeDefined()`
- full 模式 `getFilteredTools` 含 asset/android tool
- `isToolAllowed('asset', full activeGroups) === true`

## defects detect + CHANGELOG

`test/regression/defects.ts` 加 1 条 FIXED detect：
- `asset-android-tool-orphan`（D1）：查 TOOL_GROUPS 含 asset/android（`getGroupForTool` 返非 undefined，或 TOOL_GROUPS 字面含 `'asset'`/`'android'` key）

`defects-fixed.test.ts` 计数 93→94。CHANGELOG 批次 D 段（D1）。

## 不修 / 排除

- **asset_factory load traversal**：批次 A A5 已修（`asset_factory.gd:131`）。
- **path_generator strip root**：批次 C C5 已修（内联 strip）。
- **executeToolCall 查 isToolAllowed**（D1 方案 b）：破坏 advanced-proxy delegateCall 逃生舱，不修。
- **D2 find_node 内置 traversal**：**撤销**（见下）。

## D2 撤销说明（r1 修订，eng-review + memory 核实）

原拟 D2（`command_helpers.find_node` 内置 `has_path_traversal`）经 eng-review + memory 核实为**范畴错误复活**，撤销：

- **has_path_traversal 是 resource 范畴**：`command_helpers.gd:46` 注释明说「Check for path traversal (`..` segments) in a **resource path**」，C-1/IMP-2-CONSISTENCY 对齐 `godot_operations._sanitize_res_path`（res:// 资源路径 `..` 防护）。
- **find_node 是场景树范畴**：find_node 出口 `root.get_node_or_null(p)`（:43）纯场景树。NodePath `..` 是 Godot 合法父引用（`../Sibling`），非 fs traversal。
- **memory [[nodepath-traversal-category-error]] 否决**（2026-07-22 批次 A A11）：find_node 内置 has_path_traversal 是范畴错误，find_node 唯一出口 get_node_or_null 纯场景树零 fs 数据流。**D2 正是此建议复活**。
- **node_commands:51 注释张力**：注释承认「get_node_or_null 受场景树结构限制无法逃出 root」（即 `..` 不能逃出 root 子树），但「显式拒绝 .. 段与项目防御一致」（项目选择拒 `..`）。这是项目方防御选择（非 fs traversal 防护），与 memory 立场（范畴错误）相反——历史痕迹，需统一（见 follow-up）。

**裁决**：路径 C（D1 先行，D2 搁置）。D2 本质是 API 治理决策（是否禁 NodePath `..`），不该混在「纯 bug 修复」批次悄悄落地；未统一 memory vs node_commands:51 立场前实施有复活已否决建议的风险。

## Follow-up（D2 转，独立 spec；非批次 D 范畴）

NodePath `..` 策略统一决策：
1. **统一立场**：node_commands:51 注释（项目拒 `..`）vs memory（范畴错误）——需项目方拍板。
2. **若对齐 memory（推荐）**：撤销既存 8 处节点路径前置的 has_path_traversal（node_commands:52/108/161/231 + scene:32/100 + ui:387 + asset_placer:154/203——范畴错误），保留 3 处 res:// load 检查（asset_commands:112 / asset_factory:131 / command_helpers:203）。撤销后 `..` 走 get_node_or_null（受 root 子树限制，`../Sibling` 合法父引用生效）。
3. **若项目选择禁 `..`**：走 schema pattern（NodePath 参数正则拒 `..`）+ 文档契约（非 find_node 内置 has_path_traversal，避免范畴混淆 + 单一实现陷阱）。
4. **既存 8 处 DEFECT**：当前返 -32002 traversal error；撤销是行为变化（`..` 从拒变允许父引用），需测试跟进。

## 验收标准

1. **D1 修复**：TOOL_GROUPS 含 asset/android 组 + getGroupForTool 返组名 + isToolAllowed 一致 + full tools/list 广告。
2. **TDD**：D1 RED（getGroupForTool('asset'/'android') undefined）→ fix → GREEN。
3. **回归门禁**：`tsc --noEmit` exit 0；全量 vitest 无新 failed（4 T11 pre-existing 不变）；lint 0err；build 0。
4. **defects detect**：D1 登记 defects.ts FIXED（93→94）。
5. **CHANGELOG**：批次 D 段（D1）。
