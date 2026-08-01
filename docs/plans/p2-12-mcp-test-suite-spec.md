# P2-12 一期 McpTestSuite 移植 spec（待审批）

> **status**: draft（2026-08-01）
> **来源**: vault `enhanced-测试框架-PR计划.md`（2026-07-28 draft，5 BLOCKING）+ 任务看板一期描述（2026-07-31，editor 路线，心跳 no-op）
> **本 spec 目的**: 两条路线的精确 diff/风险/工作量对比，供用户拍板

---

## 0. 核查发现（plan draft 与现状的偏差）

plan draft（07-28）写"5 个 BLOCKING"是基于 4 天前的仓库状态。本次核查发现 **3 个新事实**，影响 spec 准确性：

### 0.1 enhanced 已有 test_commands.gd（plan 未提）

`addons/godot_mcp_server/commands/test_commands.gd` 已存在，注册于 `command_handler.gd:35-37`，已有 case `"test_assert"`（`command_handler.gd:125-126`）。

**当前能力**（`handle_test_assert`）：4 种 assertion_type —— `node_exists` / `property_equals` / `signal_connected` / `node_count`，全部**单条即时断言**（非套件框架），无生命周期/无发现/无批量。

**含义**：一期不是"新建 test_commands.gd"，是**扩展它**（加 `handle_test_run` / `handle_test_manage` 两个 case）。

### 0.2 enhanced 已有 run_tests 工具（B-1 已指出，但底层是 GUT）

`src/tools/runtime.ts:294-365` 已有 `run_tests` action —— 封装 `godot --headless --script addons/gut/gut_cmdln.gd`，120s 超时，跑项目侧 GUT 套件。

**关键区别**：
- `run_tests` = 跑**项目自己的 GUT 测试**（项目须装 GUT addon）
- `test_run`（一期新增）= 跑 **McpTestSuite 套件**（自带框架，AI 写 `extends McpTestSuite`）

两者共存（B-1 正确），不冲突。`run_tests` 测项目代码，`test_run` 测 enhanced 自己的 addon 逻辑（如 P1-5 undo_manager）。

### 0.3 editor-method-map.ts 无 test_run 映射

`src/core/editor-method-map.ts` 当前只登记 export_*（line 91 注释），无 `test_run` / `test_manage`。一期需补登记（若走 editor 路线）。

### 0.4 godot-ai test_handler.gd 心跳机制（一期要降级的）

`test_handler.gd:69-72` + `test_runner.gd:165-263`（`run_suites_serviced`）实现 transport 防饥饿：
- `_connection.service_transport_during_exclusive_run` 在 between-test checkpoint 服务 WS keepalive
- `deadline_ticks_ms` = server 预算 - 10s margin，超时 abort 返 partial results
- 依赖 `McpConnection.exclusive_run_checkpoint`（godot-ai 私有）

enhanced 的 editor WS 走 `EditorConnection.ts`（`src/core/EditorConnection.ts`），**无等价 checkpoint 机制**。一期"心跳 no-op 降级"= 不移植 `run_suites_serviced`，只移植同步路径 `run_suite` / `_run_suite_tests` / `_run_one_test`。

---

## 1. 目标与约束（一期）

### 1.1 必须达成

- **G1**：能在 enhanced addon 里跑 `extends McpTestSuite` 的 GDScript 套件
- **G2**：能测 P1-5 的 `undo_manager.gd` 5 个方法（一期核心目标，关闭 P1-5）
- **G3**：结果结构化回流 TS 侧（passed/failed/skipped/total/failures）
- **G4**：lint/build/test 全绿，validate_scripts 通过

### 1.2 显式不做（一期边界）

- **不做 transport 防饥饿 hard gate**（二期）—— 一期只能跑短 suite（<30s）
- **不做 dev_loop / verify_delivery 集成**（plan draft PR-5，二期）
- **不做测试卫生 lint L026-L031**（plan draft PR-4，二期）

### 1.3 P1-5 的 5 个方法（核查后精确清单）

`addons/godot_mcp_server/undo_manager.gd` 的 5 个 func：

| 方法 | 形参 | editor 依赖 |
|---|---|---|
| `setup(plugin: EditorPlugin)` | EditorPlugin | 直接 |
| `create_action_mixed(action_name, do_ops, undo_ops)` | 无 editor 类型 | **间接**（内部须创建 EditorUndoRedoManager） |
| `_add_method(undo_redo: EditorUndoRedoManager, ...)` | EditorUndoRedoManager | 直接 |
| `_add_method_call(undo_redo: EditorUndoRedoManager, ...)` | EditorUndoRedoManager | 直接 |
| `_apply_op(undo_redo: EditorUndoRedoManager, ...)` | EditorUndoRedoManager | 直接 |

任务看板说"5 方法全部 headless 被拒"——**部分准确**：`create_action_mixed` 形参无 editor 类型，但它内部必须拿 EditorUndoRedoManager（由 `setup(plugin)` 时 plugin 提供），间接依赖。一期测试**必须在 editor 上下文跑**。

---

## 2. 两条路线对比

### 路线 A：Editor 路线（任务看板原方向）

**文件位置**：`addons/godot_mcp_server/testing/`（editor addon 内）

**执行入口**：editor WS → `command_handler.gd:104 handle()` 加 case → `test_commands.gd` 新 handler

**移植范围**（从 godot-ai）：
- `test_suite.gd`（330 行）→ `addons/.../testing/mcp_test_suite.gd`，几乎原样（去 godot-ai 专属 McpLogBuffer/McpScenePath 依赖）
- `script_error_capture.gd`（49 行）→ 原样
- `test_runner.gd`（441 行）→ **大幅瘦身**：只留 `run_suite` + `_run_suite_tests` + `_run_one_test` + `get_results` + 发现逻辑（~150 行），丢 `run_suites_serviced` / `_checkpoint` / `McpConnection` 依赖
- `test_handler.gd`（309 行）→ **不移植**，逻辑合并进 enhanced 的 `test_commands.gd`

**新增**：
- `test_commands.gd` 加 `handle_test_run` / `handle_test_manage`（仿 godot-ai test_handler 的 run_tests/get_test_results）
- `command_handler.gd` match 加两 case
- `src/tools/testing.ts`（新工具文件）注册 `test_run` / `test_manage` 工具
- `src/core/editor-method-map.ts` 登记 `test_run` / `test_manage`
- `test/e2e-editor-test-suite.test.ts`（TS 侧 e2e）
- `addons/.../testing/test_undo_manager.gd`（P1-5 套件，覆盖 5 分支）

**对 P1-5**：✅ 能测（editor 上下文，EditorUndoRedoManager 可用）

**风险**：
- ⚠️ **无 hard gate**：长 suite 会饿死 editor WS keepalive。缓解：文档明确"一期 suite <30s"，二期补 checkpoint
- ⚠️ test_runner.gd 瘦身后行为漂移（丢掉 leak cleanup `_free_mcp_test_nodes_recursive` / `_cleanup_leaked_nodes` 会让测试垃圾残留）—— 需保留这两函数（只丢 serviced 路径）

**工作量估算**：~3-5 天（任务看板原估）
- GD 侧：mcp_test_suite.gd（~280 行改写）+ test_runner.gd（~200 行瘦身）+ script_error_capture.gd（49 行原样）+ test_undo_manager.gd（新写 ~150 行）= ~680 行
- TS 侧：testing.ts（~200 行）+ editor-method-map（~5 行）+ e2e 测试（~150 行）= ~355 行
- 文档：testing.md + AGENTS.md 测试卫生段

### 路线 B：Headless 路线（原始 plan draft）

**文件位置**：`src/scripts/`（headless 资源，打包进 build/scripts/）

**执行入口**：`execute_gdscript` 或独立 spawn（仿 `run_tests` 的 `godot --headless --script`）

**移植范围**：
- 同路线 A 的 test_suite.gd + script_error_capture.gd，但 **test_suite.gd 必须去 editor 依赖**（`EditorInterface.get_edited_scene_root()` / `_add_control` / `_remove_control` / `editor_undo`/`editor_redo` 全删或 no-op）—— 这会让 suite 框架失去测 editor 操作的能力
- test_runner.gd 瘦身更多（`_edited_scene_root()` / `_cleanup_leaked_nodes` / `_free_mcp_test_nodes_recursive` 全删，headless 无 editor scene）

**对 P1-5**：❌ **测不了**（EditorUndoRedoManager 在 headless 编译期/运行期均不可用，任务看板实验已确认）

**价值**：通用 GDScript 逻辑测试框架（纯函数、autoload 行为、场景加载断言）

**风险**：
- ⚠️ test_suite.gd 去 editor 依赖后与 godot-ai 原版 API 漂移（AI 学了 godot-ai 文档在 enhanced 用会失败）
- ⚠️ P1-5 无法关闭，任务看板的"一期完成关闭 P1-5"承诺破裂

**工作量估算**：~3-4 天（比 A 少 test_undo_manager.gd，但多 editor 依赖剥离）

### 路线 C：两期都做

一期 headless（B）+ 二期 editor（A 的 undo 部分）。工作量翻倍（~6-9 天），但一期价值早兑现且不碰 hard gate 风险。

---

## 3. 精确 diff 清单（按路线）

### 路线 A diff（editor）

**新增文件**（6）：
| 文件 | 行数估算 | 内容 |
|---|---|---|
| `addons/godot_mcp_server/testing/mcp_test_suite.gd` | ~280 | 抄 godot-ai test_suite.gd，去 McpLogBuffer/McpScenePath |
| `addons/godot_mcp_server/testing/mcp_test_runner.gd` | ~200 | 抄 godot-ai 同步路径，去 serviced/checkpoint |
| `addons/godot_mcp_server/testing/script_error_capture.gd` | ~49 | 原样 |
| `addons/godot_mcp_server/testing/test_undo_manager.gd` | ~150 | P1-5 套件（5 测试覆盖 5 方法） |
| `src/tools/testing.ts` | ~200 | test_run + test_manage 工具 |
| `test/e2e-editor-test-suite.test.ts` | ~150 | TS e2e |

**修改文件**（5）：
| 文件 | 改动 |
|---|---|
| `addons/godot_mcp_server/commands/test_commands.gd` | 加 `handle_test_run` / `handle_test_manage` + setup 持有 _runner |
| `addons/godot_mcp_server/command_handler.gd` | match 加 `"test_run"` / `"test_manage"` case（复用 _test_commands） |
| `src/core/editor-method-map.ts` | MAP 加 test_run / test_manage 映射 |
| `src/tools/index.ts`（或 tool-registry 等价物） | 注册 testing.ts 工具 |
| `docs/capability-matrix`（生成） | `npm run build-matrix` 重建 |

**分发命令**（AGENTS.md 强制）：`npm run build`（同步 .gd 到 build/scripts/ —— 但 addons/ 不走 build/scripts/，是直接分发，需核实）

### 路线 B diff（headless）

**新增文件**（5）：
| 文件 | 行数 | 内容 |
|---|---|---|
| `src/scripts/mcp_test_suite.gd` | ~200 | 去所有 editor 依赖版 |
| `src/scripts/mcp_test_runner.gd` | ~150 | 同步路径 + extends SceneTree 包装 |
| `src/scripts/script_error_capture.gd` | ~49 | 原样 |
| `src/tools/testing.ts` | ~200 | test_run（spawn headless）+ test_manage |
| `test/testing.test.ts` | ~150 | TS 单测 |

**修改文件**（2）：
| 文件 | 改动 |
|---|---|
| `src/tools/index.ts` | 注册 testing.ts |
| `docs/capability-matrix` | build-matrix 重建 |

**P1-5 不关闭**，test_undo_manager.gd 不写（headless 测不了）。

---

## 4. 关键技术决策（实现时需确认）

### D1：test_commands.gd 如何持有 runner 实例

godot-ai 的 test_handler 在 `_init` 创建 `_runner: McpTestRunner`。enhanced 的 test_commands.gd 当前是 `extends Node` + `setup(plugin)`。需在 setup 里加 `_runner = preload("testing/mcp_test_runner.gd").new()`。

### D2：suite 发现路径

godot-ai 扫 `res://tests/`。enhanced 一期建议扫 `res://tests/`（项目侧）或 `addons/godot_mcp_server/testing/suites/`（自带）？**建议前者**（AI 写的套件放项目，自带套件如 test_undo_manager 放 addon 内但发现路径包含它）。

### D3：ctx 传什么给 suite_setup

godot-ai 传 `{undo_redo, log_buffer, dispatcher}`。enhanced 一期最少传 `{undo_redo: _undo_manager, plugin: _plugin}`（test_undo_manager.gd 需要）。

### D4：headless 限制标注

路线 A 的 test_run 工具描述需注明"editor-only，长 suite <30s（二期补 hard gate）"。

---

## 5. 验证策略

### 5.1 GD 侧验证（两路线都需要）

- `validate_scripts` 触发 Godot 完整编译（AGENTS.md 强制）
- 对每个 .gd 用 `execute_gdscript` + `load()` 验证（memory `Godot MCP verification blind spot` 教训）

### 5.2 TS 侧验证

- `npm run lint` + `npm run build` + `npm test` 全绿（AGENTS.md 完成前强制）
- 新增 e2e 测试覆盖 test_run round-trip

### 5.3 P1-5 验证（仅路线 A）

- `test_undo_manager.gd` 5 测试覆盖 5 方法
- 在 editor 模式跑 `test_run(suite="undo_manager")` 全绿

---

## 6. 风险登记

| 风险 | 路线 | 严重度 | 缓解 |
|---|---|---|---|
| 长 suite 饿死 WS keepalive | A | 高 | 文档 + 工具描述 + 二期 hard gate |
| test_runner 瘦身行为漂移 | A | 中 | 保留 leak cleanup 函数 |
| headless 版 API 与 godot-ai 漂移 | B | 中 | 文档明确 enhanced 变体 |
| P1-5 不关闭 | B | 高 | 任务看板承诺破裂 |
| addons/ 分发机制未核实 | A/B | 中 | 实现前核实 build 流程 |

---

## 7. 待用户决策

见 AskUserQuestion（spec 产出后用户选路线）。
