# risk 字段化设计（借鉴 godot-devtool riskLevel）

- 日期：2026-06-29
- 状态：Drafted（待用户审阅）
- 关联：godot-devtool `src/server/routeRegistry.ts` riskLevel 四级（read/write/destructive/process，源码核实通过）

## 1. 背景与动机

### 1.1 现状

本项目工具的"需确认"信息集中硬编码在 `D:\GitHub\godot-mcp-enhanced\src\guard.ts:52-78` 的 `GUARDED` 表（工具级 key + action 级 `Set<string>`，~50 个 action 跨 16 个工具）。`requiresConfirmation(toolName, args)` 查这张表决定是否要求 confirm-token。

`ToolMeta`（`D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts:9-13`）当前只有工具级 `readonly: boolean` + `long_running: boolean`，无 action 级风险信息。

### 1.2 痛点

新增工具或给现有工具加 action 时，开发者必须**手动回 `guard.ts` 中央表登记**，否则该 action 不会被守。这是典型的"信息远离定义点"导致的漏标。项目历史教训直接印证：
- "GUARDED 扩须重生成 capability-matrix"
- "confirm-token 扩 workflow/validation/manage_tools 多处"

每次扩展都是手动多点同步，极易漏改。

### 1.3 借鉴来源

竞品 godot-devtool 每个 action 带 `riskLevel` 字段（四级 read/write/destructive/process，`routeRegistry.ts:8`）。本设计吸收其字段化思路，但**不照搬其 router-only 工具发现 / 共享 broker**——经核实，本项目只有 29 个工具、全量 schema ~10-15KB，那两个设计解决的痛点（900KB context、多 Agent 抢端口）在本项目不成立，属 YAGNI。

## 2. 目标与非目标

### 2.1 目标

1. 把 `GUARDED` 的 action 级信息迁移为 `ToolMeta.actionRisks`（action 级、就近声明在工具模块）
2. `guard.ts` 按 `actionRisks` 字段自动判定确认，**淘汰中央 GUARDED 表**
3. 根除"新增工具/改 action 漏标记"的痛点——risk 与 action 定义同处，由覆盖完整性测试 + 类型约束兜底
4. capability-matrix 自动派生 risk 信息，顺手根除"GUARDED 扩须重生成 matrix"的手动同步

### 2.2 非目标（YAGNI）

- 不做差异化确认 UX（destructive/process 不单独强确认/审计/二次确认）
- 不引入 router-only 工具发现、共享 broker（已论证痛点不成立）
- 不重新审视所有边界 action 的确认策略（迁移保持零行为改变，见 §4.1）

## 3. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 分级粒度 | 四级 read/write/destructive/process | 与 devtool 对齐；destructive（不可逆删除）与 process（启外部进程）语义清晰，区别于普通 write |
| risk 用途 | 纯元数据：matrix 展示 + 确认日志分级；确认行为统一"非 read 即 confirm-token" | 最小改动达成核心目标；差异化 UX 留作未来 |
| risk 载体 | action 级就近声明（淘汰中央表） | 唯一真正根除漏标的方案；类型可约束 |
| 迁移策略 | 彻底替换 GUARDED（删表，不保留 fallback） | 保留 fallback = 没真淘汰硬编码；由覆盖完整性测试兜底 |
| matrix 展示 | 加 risk 四级分布计数 | 纯展示，让风险面一目了然，成本低 |

## 4. 设计

### 4.1 迁移第一原则：确认行为零改变

risk 字段的语义 = **驱动确认的操作分类**（`risk !== 'read'` 即要求 confirm-token）。迁移严格复刻当前确认行为：

- 当前在 `GUARDED` **内**的 action → 标 `write` / `destructive` / `process`（按 §4.4 操作性质细分）
- 当前在 `GUARDED` **外**的 action → 标 `read`（忠实复刻项目既有的"不确认"决策）

> 边界说明：少数 action 语义上有副作用但项目有意不确认（如 `validation.run_and_verify` 实际启 Godot 进程，但项目信任 headless 验证故不守）。按零行为改变原则，这类标 `read`，忠实记录项目的信任决策。如未来要收紧，再单独评估——不在本次迁移范围。

此原则保证 `requiresConfirmation` 迁移前后行为完全一致，迁移风险降到最低。

### 4.2 数据模型变更（`tool-registry.ts`）

```ts
export type RiskLevel = 'read' | 'write' | 'destructive' | 'process';

export interface ToolMeta {
  name: string;
  readonly: boolean;        // 派生：所有 action 都是 read
  long_running: boolean;
  actionRisks?: Record<string, RiskLevel>;  // 新增：action → risk
}
```

`ToolModule.TOOL_META` 类型同步扩展，支持 `actionRisks`：

```ts
TOOL_META?: Record<string, {
  readonly?: boolean;
  long_running?: boolean;
  actionRisks?: Record<string, RiskLevel>;
}>;
```

`registerModule` 派生逻辑（`tool-registry.ts:32-54`）：
- 模块提供 `actionRisks` 时：若未显式给 `readonly`，自动派生 `readonly = Object.values(actionRisks).every(r => r === 'read')`。与现有 A-10 自动注册机制一脉相承（消除手动同步）
- 新增查询函数 `getActionRisks(toolName): Record<string, RiskLevel> | undefined` 和 `getActionRisk(toolName, action): RiskLevel | undefined`

### 4.3 guard.ts 改造（`guard.ts`）

- **删除** `GUARDED` 表（`guard.ts:52-78`）
- 新增 `getActionRisk(toolName, action, args): RiskLevel | undefined`：先查**动态 override**，再查静态 `actionRisks`
- `requiresConfirmation(toolName, args)` 改为：
  ```ts
  const action = (args?.action ?? args?.method) as string | undefined;
  if (action == null) return false;
  const risk = getActionRisk(toolName, action, args);
  return risk !== undefined && risk !== 'read';
  ```
- **动态豁免 escape hatch**（保留现有唯一一个 args-based 特例）：guard 内保留小函数 `dynamicRiskOverride(toolName, action, args): RiskLevel | null`，处理 `script.edit_script + search_and_replace` → 返回 `'read'`。它是"确认行为微调"，不是风险分级本身；集中一处，不影响主流程
- `isGuardedTool(toolName)`（`guard.ts:209-211`，给 capability matrix 用）改为从 `actionRisks` 派生：`Object.values(getActionRisks(toolName) ?? {}).some(r => r !== 'read')`

### 4.4 GUARDED → actionRisks 分级草案

按操作性质细分（GUARDED 内的 ~50 action）：

**process（启动外部进程）**
- `runtime`: `launch_editor`, `run_project`, `stop_project`, `run_tests`
- `script`: `execute_gdscript`
- `android`: `deploy`（启 adb 子进程）
- `workflow`: `dev_loop`（执行任意 GDScript）, `run_verify`（启 headless Godot）—— 注：`run_verify` 是 workflow 的 action（启 Godot 验证），与 `validation.run_and_verify` 不同，后者项目当前不确认故标 read
- `validation`: `export_build`（启 Godot export）, `assert`（执行 GDScript 断言）, `stress`（压力测试）

**destructive（不可逆删除/覆盖）**
- `scene`: `remove_node`, `merge_scene`
- `script`: `project_replace`（全项目批量替换）
- `tilemap`: `tilemap_clear`
- `animation`: `delete`, `remove_track`, `remove_keyframe`

**write（可逆修改）**
- `scene`: `create_scene`, `quick_scene`, `add_node`, `batch_add_nodes`, `edit_node`, `save_scene`, `load_sprite`, `instance_scene`, `set_instance_property`, `detach_instance`, `create_3d_node`, `commit`
- `script`: `write_script`, `edit_script`, `generate_test`, `create_test_scene`
- `animation`: `create`, `update_props`, `add_track`, `add_keyframe`, `update_keyframe`, `ik_modifier_create`, `ik_modifier_set`（删除类 `delete`/`remove_track`/`remove_keyframe` 归 destructive，见下）
- `tilemap`: `tilemap_set_cell`, `tilemap_erase_cell`, `tilemap_fill_rect`, `tilemap_paste`, `tilemap_set_transform`
- `game`: `game_bridge_install`, `game_bridge_uninstall`, `game_write`
- `material`: `set_params`, `create`, `save`, `load`, `shader_write`, `shader_load_file`, `shader_save_file`, `shader_apply_template`
- `particles`: `particles_create`, `particles_set_emission`, `particles_set_process`, `particles_load_preset`, `particles_set_material`
- `signal`: `signal_emit`
- `nav`: `create_region`, `bake_mesh`, `create_agent`, `set_params`, `create_link`
- `audio`: `audio_set_param`
- `ui`: `ui_create_control`, `ui_set_layout`, `ui_anchor_preset`, `ui_set_theme`, `ui_container_add`, `theme_create`, `theme_set_property`, `ui_draw_recipe`, `ui_build_layout`
- `physics`: `collision_overlay`
- `runtime`: `record_start`, `record_stop`, `record_play`, `record_save`（运行时录制控制 + 写文件，不启进程）
- `workflow`: `create_files`
- `manage_tools`: `activate`, `deactivate`

**read（GUARDED 外的所有 action）**
各工具的查询/读取/运行时短期控制 action，例如：`scene.read_scene/query_scene_tree/inspect_node/health_check`、`script.read_script`、`animation.list_players/get_info/get_details/get_keyframes/play/stop/seek/blend/ik_modifier_get/ik_list_bones`、`game` 全部查询/输入/等待/监控/信号/UI 发现 action、`material.read/shader_read/shader_list_templates`、`signal.signal_connect/signal_disconnect/signal_list`、`audio.audio_play/audio_stop/audio_query`、`ui.ui_get_layout`、`physics.raycast/body_info/diagnose/query_spatial`、`nav.query_path`、`runtime.get_debug_output/get_godot_version`、`android.list_devices/get_preset_info/logcat/check_template/get_godot_version`、`workflow.scene_snapshot/batch_validate/diff_scenes`、`validation.run_and_verify/analyze_error/validate_project/validate_scripts/import_resources/validate_gdd/chain_verify/verify_delivery/export_list_presets/export_get_preset`。

> 完整 read action 清单在实施时从各工具 `getToolDefinitions()` 的 action enum 提取，由 §6 覆盖完整性测试保障无遗漏。

### 4.5 capability-matrix 接入

- `extract.ts:25` 的 `guarded` 字段改为从 `actionRisks` 派生（`some(r !== 'read')`），不再调 `isGuardedTool` 的 GUARDED 版本（`isGuardedTool` 自身已改为派生 actionRisks，故 extract 调用点不变，只是底层实现变了）
- `securityLevel`（danger-api/guarded/safe）合成逻辑（`extract.ts:52` `classifySecurityLevel({ dangerApiHit, guarded })`）不变
- `build-matrix.ts` 概览新增 risk 四级分布计数：`- risk：read N / write N / destructive N / process N`（按 action 计数，跨所有工具的 action 汇总）
- 迁移后跑 `npm run diff-matrix` 验证 `securityLevel` 无意外降级/升级（`guarded` 派生源变了，需确认结果一致）

### 4.6 数据流

```
工具模块声明 TOOL_META.actionRisks（就近）
  → registerModule 写入 metaRegistry（actionRisks + 派生 readonly）
  → requiresConfirmation(tool, action, args)
       → getActionRisk: dynamicRiskOverride(豁免) → actionRisks[action]
       → risk !== 'read' 即确认
  → extract.ts 从 actionRisks 派生 guarded → securityLevel
  → build-matrix.ts 输出 matrix.{json,md}（含 risk 分布）
```

## 5. 错误处理

- **action 未声明 risk**（迁移漏标）：`getActionRisk` 返回 `undefined` → `requiresConfirmation` 返回 `false`（不确认）。这是**安全降级方向的反面**（漏标 write 会漏确认）。由 §6 覆盖完整性测试在 CI 阻断：任何 action 未声明 risk 即测试失败
- **动态豁免误判**：`dynamicRiskOverride` 仅匹配 `script.edit_script + search_and_replace` 严格条件（`typeof sr === 'object' && 'search' in sr`），与现有逻辑一致，专项测试覆盖
- **readonly 派生变化**：READ_ONLY_MODE 依赖 `readonly`。派生后 `readonly = 全 action 都是 read`，需核对所有工具与现状一致（§6 测试）

## 6. 测试与回归保障

1. **覆盖完整性测试（根除漏标的核心保障）**：遍历所有工具的所有 action（从 `getToolDefinitions()` 的 action enum 提取），断言每个 action 都在对应工具的 `actionRisks` 中声明。任何遗漏 → 测试失败。这是字段化防漏的硬约束
2. `guard.test.ts`：每个工具每个 action 的确认判定——read 不确认，write/destructive/process 确认；对照旧 GUARDED 行为零改变
3. search_and_replace 动态豁免专项测试
4. `readonly` 派生测试：READ_ONLY_MODE 工具集迁移前后一致
5. capability matrix integrity：`guarded` 派生正确，`securityLevel` 分布无意外漂移（`diff-matrix`）
6. 类型约束：`actionRisks` 的 key 约束为该工具 ACTIONS 常量的成员（`Record<typeof ACTIONS[number], RiskLevel>`），让漏标/拼错在编译期暴露——与 §6.1 运行期完整性测试互补，双保险

## 7. 影响面

**改动文件**：
- `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts`：`RiskLevel` 类型、`ToolMeta`/`ToolModule.TOOL_META` 扩展、`registerModule` 派生逻辑、新增 `getActionRisks`/`getActionRisk`
- `D:\GitHub\godot-mcp-enhanced\src\guard.ts`：删 `GUARDED`、`requiresConfirmation`/`isGuardedTool` 改造、新增 `getActionRisk`/`dynamicRiskOverride`
- ~16 个工具模块（`src/tools/*.ts`）：新增/补全 `TOOL_META.actionRisks`（部分模块当前无 TOOL_META，走 A-10 自动注册，需补上 actionRisks）
- `D:\GitHub\godot-mcp-enhanced\src\capability\extract.ts`：`guarded` 派生改 actionRisks（底层）
- `D:\GitHub\godot-mcp-enhanced\src\capability\build-matrix.ts`：概览加 risk 分布计数
- 测试：`guard.test.ts`、新增覆盖完整性测试、`matrix-integrity.test.ts`

**主要风险**：迁移漏标 → 某 write action 被误判 read → 漏确认。由 §6.1 覆盖完整性测试 + §6.2 行为对照测试双重兜底。

**向后兼容**：`requiresConfirmation` 对外签名不变；`isGuardedTool` 对外签名不变（实现变）；MCP 客户端无感知。
