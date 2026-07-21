# C5 follow-up：剩余运行时工具持久化提示

**日期**：2026-07-21
**承接**：2026-07-20 B/C 档 C5（已包装 audio/particles/signal/tilemap/animation 5 工具 + helper `runtimePersistWarning` / `appendRuntimePersistWarning`，commit `cee9477` + CRITICAL fix `92537b7`）
**范围**：C5 spec（`2026-07-20-bc-dx-improvements-design.md` line 63 / 93）明确留的 follow-up——给剩余运行时工具补"不持久化"提示。DX 提示/引导，非核心逻辑改动。

## 背景

C5 已建 helper（`src/tools/shared/persistence-warning.ts`）+ 包装 5 工具：在 `return` 处 `appendRuntimePersistWarning(parseGdscriptResult(...), action)`，成功时追加独立 `content[1]` warning，不可变（不破坏 `content[0]` 的 `JSON.parse` 消费契约）。

剩余 5 工具（node-3d / physics / navigation / material / recording）C5 因 YAGNI 留 follow-up。**核实发现这 5 工具 action 性质不统一**（创造运行时状态 / 纯查询 / 真持久化三类混合），不能机械套 C5 模式——否则会给持久化 action 加"会丢失"的错误提示，或漏掉真正创造运行时状态的 action。

**eng-review 修订**（2026-07-21 独立 reviewer 审 spec 后，用户拍板）：原稿三处误判已修正——
1. `physics collision_overlay` 原归"查询"→ 实为**创造运行时节点树**，改加提示；
2. `material load` / `shader_load_file` 原归"查询/加载"→ 实为**改运行时资源属性**，改加提示；
3. `recording start/stop/play` 原归"加提示"→ **C5 文案对录制语义错位**，整工具不包装。

## 核心决策（brainstorming + eng-review 确认）

**可复现判据**（区分加/不加，解决分类一致性）：
- **修改运行时节点树/资源属性**（headless 退出后该状态消失）→ **加提示**
- **只读数据返回，不改运行时状态** → 不加
- **真落盘**（`ResourceSaver` / `FileAccess WRITE`）→ 不加
- **C5 文案语义错位 + 无 .tscn 持久化误解风险** → 不加（recording 特例）

**Q1 决策**：查询类不加（查询不创造运行时状态，无"被持久化"误解风险，加是噪音）。

**actionRisks 标记 ≠ 加提示判据**（防误判）：`TOOL_META.actionRisks` 标 `'read'` 是"不加"的充分证据；但标 `'write'` **不能**直接等价于"加"——需进一步区分运行时修改（加）vs 真落盘（`material save` / `shader_save_file` 也标 `'write'` 但属落盘不加）。判据始终以"修改运行时节点树/资源属性"为准，actionRisks 仅作辅助佐证（如 collision_overlay 的 `write` 与 `genCollisionOverlayScript` 源码双证）。

## §1 范围：5 工具 action 分类（eng-review 修正后）

| 工具 | ✅ 加提示（修改运行时节点树/资源属性） | 🚫 持久化（不加） | ⏭️ 只读查询（不加） | ⏭️ 特例（不加） |
|---|---|---|---|---|
| **node-3d** `node_create_3d` | create（唯一 action） | — | — | — |
| **physics** | **collision_overlay** | — | raycast / body_info / diagnose / query_spatial | — |
| **navigation** | create_region / bake_mesh / create_agent / set_params / create_link | — | query_path | — |
| **material** | create / set_params / shader_write / shader_apply_template / **load** / **shader_load_file** | save / shader_save_file | read / shader_read / shader_list_templates | — |
| **recording** | —（**整工具不包装**） | recording_save | recording_load | **start / stop / play**（文案错位，见下） |

**关键修正依据**（源码核实，行号已 grep 实测）：
- `physics collision_overlay`：`genCollisionOverlayScript`（`physics-ops.ts:243`）创建 `Node3D.new()`（`:262`）+ `add_child`（`:264`）+ 每子 `MeshInstance3D.new()`（`:284`）/ `StandardMaterial3D.new()`（`:286`）→ 运行时可视化节点树；`TOOL_META.actionRisks`（`:458`）明确标 `collision_overlay: 'write'`（其余 4 action 标 `'read'`）。→ **加提示**。
- `material load`：`genMaterialLoadScript`（`material-ops.ts:364`）`:382 node.material = mat` → 改运行时 material 属性。→ **加提示**（与 `set_params` 同类）。
- `material shader_load_file`：`genShaderLoadFileScript`（`:472`）`:502 mat.shader = load(...)` → 改运行时 shader 引用。→ **加提示**（与 `shader_write` 同类）。
- `material save`（`ResourceSaver.save` 写 .tres，`:354`）/ `shader_save_file`（`FileAccess WRITE`，`:515`）/ `recording_save`（写 `res://recordings/*.json`，`recording.ts:114`）：真落盘 → 不加。
- `recording start/stop/play`：**不加**。理由：① C5 文案"持久化须 `add_node + save_scene` 写入 .tscn"对录制事件**语义错位**（录制不是场景节点，不能 `add_node`，加了误导用户"用 add_node 持久化录制"——做不到，录制该用 `recording_save` 存 JSON）；② recording 是输入录制/回放测试工具，无"被持久化到 .tscn"误解风险（C5 初衷）；③ 操作 bridge 内部录制状态，非 Godot 节点树/资源属性（按判据不属于"加"类）。

## §2 实现策略：方案 A（调用处 Set 过滤，helper 不改）

- **helper 公共 API 零改动**（已包装的 C5 5 工具不受影响）
- 每个多 action 工具定义 `PERSIST_HINT_ACTIONS = new Set([...])`，公共返回点条件包装
- `node-3d`（唯一创造 action）无条件包装
- `recording` 整工具不动

## §3 包装位置（精确到行 + 改法，行号已 grep 实测）

### node-3d（`src/tools/node-3d-ops.ts`）
- **活跃路径**：`scene/index.ts:438` → `handleCreate3dNode`（`node-3d-ops.ts:127`）；`tool-registry.ts:325` `GODOT_MCP_WARN_LEGACY` 模式 `node_create_3d` 也映射到同一 handler
- 改 `:166` 主返回点：
  ```ts
  return appendRuntimePersistWarning(
    parseGdscriptResult(result, [], errorMapper, {
      suggestion: 'Use query_scene_tree to list available nodes, or check the node path spelling.',
    }),
    'node_create_3d',
  );
  ```
- 导入 `appendRuntimePersistWarning` from `./shared.js`
- 模块壳 `@deprecated v0.18.0`，但 `handleCreate3dNode` 是活跃 core handler，包装覆盖所有活跃路径

### physics（`src/tools/physics-ops.ts`）— eng-review 改：从"不动"改 Set 过滤
- 改 `:442` 公共返回点：
  ```ts
  const r = parseGdscriptResult(result, [], errorMapper);
  return PHYSICS_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, `physics_${action}`) : r;
  ```
- `const PHYSICS_PERSIST_ACTIONS = new Set(['collision_overlay']);`
- raycast / body_info / diagnose / query_spatial（只读查询）不加

### navigation（`src/tools/navigation.ts`）
- 改 `:483` 公共返回点：
  ```ts
  const r = parseGdscriptResult(result, paramWarnings, errorMapper);
  return NAV_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, `nav_${action}`) : r;
  ```
- `const NAV_PERSIST_ACTIONS = new Set(['create_region', 'bake_mesh', 'create_agent', 'set_params', 'create_link']);`
- `query_path`（查询）不加

### material（`src/tools/material-ops.ts`）— eng-review 改：MAT set 扩展至 6 个
- 改 `:784` 公共返回点：
  ```ts
  const r = parseGdscriptResult(result, [], materialErrorMapper);
  return MAT_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, `material_${action}`) : r;
  ```
- `const MAT_PERSIST_ACTIONS = new Set(['create', 'set_params', 'shader_write', 'shader_apply_template', 'load', 'shader_load_file']);`（eng-review 加 `load` / `shader_load_file`）
- 不加：`save` / `shader_save_file`（持久化）+ `read` / `shader_read` / `shader_list_templates`（只读）
- `shader_list_templates` 在 `:651` 提前 inline 返回（不走 `:784`），不动
- material 用 `executeGdscriptTrusted`（`:776`，非 `executeGdscript`），包装在 `parseGdscriptResult` 之后，不受 executor 差异影响

### recording（`src/tools/recording.ts`）— eng-review 改：整工具不动
- **不包装**（原 `:216` / `:235` / `:410` 包装计划取消）。所有 action（start / stop / play / save / load / `:317` 空回放）保持原样
- 理由见 §1 recording 行（C5 文案错位 + 无 .tscn 误解风险 + 操作 bridge 状态非 Godot 节点树）

## §4 文案与 action 命名

- **复用 helper 现有文案**（`runtimePersistWarning` 不改）：`⚠ <action> 是运行时操作，headless 进程退出后丢失。持久化须 add_node + save_scene 写入 .tscn（运行时工具仅用于验证/测试）`
- **action 名统一 `<工具>_<动作>` 前缀**（与 C5 惯例一致）：
  - `node_create_3d`（action 值已含）
  - `physics_collision_overlay`（手动加 `physics_`）
  - `nav_create_region` 等（手动加 `nav_`）
  - `material_create` 等（手动加 `material_`）
  - recording 不包装，无需命名

## §5 测试（扩展 `test/persistence-warning.test.ts`）— eng-review 改

**正向断言**（加提示的 action，每工具 ≥2 防漏）：
- `node_create_3d`
- nav：`nav_create_region` + `nav_create_link`（2 个，含非主 action 防 Set 写漏）
- material：`material_create` + `material_load`（2 个，`load` 验证 eng-review 修正）
- physics：`physics_collision_overlay`（验证 eng-review 修正）
- 断言：`content[0].text` 可 `JSON.parse` + 不含 `⚠` + `content[1]` 含 `⚠` + action 名

**反向断言**（不加，防机械套模式回归——本 follow-up 核心测试）：
- `material save`（持久化）+ `material read` + `material shader_read`（只读）
- `recording_save`（持久化）+ `recording_load`（只读）+ `recording_start`（特例，整工具不包装）
- `physics raycast` + `physics query_spatial`（查询）
- `nav query_path`（查询，nav 唯一只读 action）
- 断言：返回 `content` 全部元素不含 `⚠`
- **反向每工具 ≥2**（与正向对称，A3）：physics 4 只读 action 测 2 个（raycast/query_spatial）、material 3 只读测 2 个（read/shader_read），防未来误把只读 action 加入 `*_PERSIST_ACTIONS` Set 时单测漏抓。nav/recording 因只读 action 数 < 2 按实际覆盖。

**mock 注意**：
- node-3d / nav / physics：mock `executeGdscript`（同 C5 现有 5 工具模式）
- material：mock `executeGdscriptTrusted`（注意与 `executeGdscript` 区分，mock 目标不同）
- recording 反向（start / save / load）：mock bridge client（参考现有 recording 测试模式；若 bridge mock 过重，plan 阶段可简化为验证 inline 返回点未包 helper）

**Minor4（顺带）**：`content[0].text` 类型收窄（`ToolResult.content` union → text 类型断言/guard）。`test/` 目录 excluded 不阻塞构建，但 follow-up 一并做。

## 不含（YAGNI）

- physics 除 `collision_overlay` 外不包装（只读查询）
- recording **整工具不包装**（C5 文案对录制语义错位，加了误导；无 .tscn 持久化误解风险）
- **ui_* 独立 follow-up**（eng-review I1）：core.md 列 `ui_*` 为运行时不持久化，但 ui action 9+（`ui_create_control` / `ui_build_layout` / `ui_container_add` / `ui_set_theme` 等）+ `ui_set_theme` 内嵌 `theme_action` 二级分发（set_params / create / save / load），三分类需独立梳理。本 spec 聚焦 C5 line 63 / 93 明列的 5 工具，ui 留独立 follow-up。
- 不改 helper 公共 API（方案 A）
- 不改 C5 已包装的 5 工具
- 不改工具描述里的 `NON_PERSIST`（已有，不动）——C5 只管返回结果提示

## 验证步骤

1. `npx tsc --noEmit`（类型绿）
2. `npx vitest run test/persistence-warning.test.ts`（正向 + 反向断言）
3. `npx vitest run`（全量回归：C5 已包装 5 工具 + follow-up，不破坏现有断言）
4. `grep` 确认 `material save` / `material read` / `recording_save` / `recording_start` / `physics raycast` / `nav query_path` 返回路径无 `appendRuntimePersistWarning` 调用（反向防回归）

## 风险与对策

- **material executor 差异**：用 `executeGdscriptTrusted` 非 `executeGdscript`，但包装在 `parseGdscriptResult` 后，不受影响。
- **现有测试断言同步**（C5 spec line 57 同类预警）：node-3d / nav / material / physics 现有测试若断言返回 `content` 结构或 length，包装成功路径后 `content` 多一个 warning 元素，可能需同步断言（验证步骤 3 全量回归会抓）。
- **deprecated 模块包装**：node-3d-ops 模块壳 `@deprecated`，但 `handleCreate3dNode` 活跃（scene + legacy 都走），包装在活跃 handler 而非死代码。
- **反向断言是本 follow-up 核心**：防"持久化 / 只读 / 特例 action 被误加提示"回归（C5 机械套模式的根本风险）。eng-review 抓到的 `collision_overlay` / `material load` 误判正是此类——反向断言锁定，未来加 action 或改分类时强制复核。
