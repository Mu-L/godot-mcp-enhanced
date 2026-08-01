# P2-12 一期 McpTestSuite 移植 — 独立第三方审查

> **审查者**：code-reviewer subagent（隔离视角，所有声明 grep/read 实测）
> **日期**：2026-08-01
> **分支**：`feat/p2-12-mcp-test-suite`
> **路线**：A（editor）
> **判定**：**SHIPPED WITH NITS**（无 Blocking Issue）

## ⚠️ 工具限制声明

审查 agent 无 Write/Edit/Bash 工具，结论基于**静态代码核查**（grep/read）。运行时命令（lint/build/test/validate_scripts）由 coordinator 复核。审查报告原文由 coordinator 落盘本文件。

---

## 总体判定：SHIPPED WITH NITS

P2-12 一期核心目标（G1-G4）全部达成：能在 enhanced addon 跑 `extends McpTestSuite` 套件 / 测 undo_manager 5 方法 / 结果结构化回流 / 设计正确性全 PASS。仓库级约束（独立副本同步、capability-matrix 重建、version-sync A 类、editor-method-map 登记）独立核查通过。**无 Blocking Issue**。5 处 Nit + 1 条值得进 memory 的工程教训。

---

## 逐维度结论（带 file:line 证据）

### 维度 1：设计正确性 — PASS

- **latch-on-first-failure**（`mcp_test_suite.gd:208-214` assert_true）：`_assertion_count += 1` 始终累加，紧接 `if _failed: return`，失败后不覆盖 `_message`。✓ 8 个 assert_* 全用同一模式。
- **零断言护栏**（`mcp_test_runner.gd:169-171`）：`if passed and suite._assertion_count == 0: passed = false`。✓
- **SCRIPT ERROR 优先级**（`mcp_test_runner.gd:141-179`）：① script_errors 非空 → failed（141，先于 skip/fail）→ SCRIPT ERROR 最高；② `if suite._skipped and not suite._failed`（155）→ fail 优先于 skip；③ 零断言护栏仅在 `passed` 时触发。**顺序 SCRIPT ERROR > fail > skip > zero-assertion**。✓
- **leak cleanup**（`mcp_test_runner.gd:327-352`）：`_cleanup_leaked_nodes`（snapshot diff）+ `_free_mcp_test_nodes_recursive`（BFS `_McpTest*` 前缀）均保留。`run_suite`（85 suite 级）+ `_run_one_test`（137-139 per-test 级）双调用。✓
- **latch 捕获生命周期**（`mcp_test_runner.gd:46-90`）：`_register_capture()` / `_begin_script_error_capture()` / `_end_script_error_capture()` / `_notification(PREDELETE)` 兜底 `OS.remove_logger`。✓ 无 logger 泄漏。

### 维度 2：TS-GD 一致性 — PASS

- **editor-method-map testing 族**（`src/core/editor-method-map.ts:102-105`）：`testing: { run: {method:'test_run'}, manage: {method:'test_manage'} }`。`command_handler.gd:129-132` match 分支存在。✓
- **EditorToolExecutor 路由**（`src/core/EditorToolExecutor.ts:89-91`）：`resolveEditorMethod('testing',{action:'run'})` → `{method:'test_run'}` → `conn.request('test_run', ...)` → GD `handle_test_run`。✓
- **EDITOR_ONLY 拒绝模式**（`src/tools/testing.ts:97-101`）：与 `test-framework.ts:78-80` 逐字一致。✓
- **ctx 线程链**：`command_handler.gd:18-21` → `:35-37` setup 传 undo_manager → `test_commands.gd:9-12` 存储 → `:90-93` 建 ctx → `:108` run_suite(ctx) → `mcp_test_runner.gd:57` suite_setup(ctx.duplicate) → `test_undo_manager.gd:27-29` 取用。✓ 全链不断。

### 维度 3：测试质量 — PASS（修复后）

- **testing.test.ts**（9 用例）：TOOL_NAMES / 工具定义 / action enum / description 警告 / required / TOOL_META / handleTool 路由（null + INVALID_PARAMS + INVALID_ACTION + run/manage EDITOR_ONLY）。✓
- **editor-method-map.test.ts testing 族**（4 用例）：run→test_run / manage→test_manage / 未登记返 null / **drift 检测**（read command_handler.gd 断言含 `"test_run":` / `"test_manage":`）。✓
- **test_undo_manager.gd 5 测试**（N-4 修复后）：test_create_action_mixed 强断言（child 落地 + undo 移除）/ test_apply_op_property 强断言（name after/before）/ test_setup 中等 / test_add_method freed 守卫（N-4 改为 child_count 反查）/ test_apply_op_unknown（N-4 改为 name 未变反查）。✓ 非假绿。

### 维度 4：部署同步 — PASS

- **build-matrix**：`docs/capability-matrix.json` 含 testing，36 工具 / 205 action。✓
- **独立副本同步**：`rule-templates.ts:24` + `godot-mcp-core.md:10` 均 36/205。✓
- **version-sync A 类**：package.json / manifest.json / plugin.cfg / 使用指南.md 均 0.25.2。✓
- **README/en/distribution/migration 同步**：均 36。✓
- **check:budget**：testing 1485B < warn。✓
- **N-1 修复**：`docs/使用指南-Warp.md:22,23,145` 残留 35→36 已修（CI 盲区，check-tool-count 不覆盖此文件）。

### 维度 5：仓库级约束独立核查 — PASS

- **独立副本同步约束**：两份副本均改。✓
- **改动工具清单后**：build-matrix 已跑。✓
- **完成前强制检查**：lint/build/test coordinator 实测全绿（见下）。
- **memory `Godot MCP verification blind spot`**：validate_scripts 0 error（coordinator 实测）；headless load() 对 class_name 限制已认知（非 bug，editor 模式 resolve 正常）。
- **spec §改动面清单完整性**：spec 漏列 static-grep.ts / module-loader.ts / 独立副本 / version-sync 文件（N-2，流程教训，实现未漏改）。

---

## Blocking Issues

**无。**

---

## Nits（全部已处理）

### Nit 1：`docs/使用指南-Warp.md` 残留 35 工具（CI 盲区）— ✅ 已修

`docs/使用指南-Warp.md:22,23,145` 残留 "35 个工具"，check-tool-count.mjs RULES 不覆盖此文件 → CI 静默放过。**已修**：3 处 35→36。line 166 是 v0.19.1 历史快照保留正确。

### Nit 2：spec §改动面清单不完整（流程教训）— 记 memory

`docs/plans/p2-12-mcp-test-suite-spec.md:140-158` 列 6 新增 + 5 修改，实际 ~12 修改文件。漏列 static-grep.ts / module-loader.ts / 独立副本 / version-sync / editor-method-map.test.ts / CHANGELOG / README/distribution/migration。与 AGENTS.md:298 记载的 2026-07-27 get_node_layout 教训同型。**实现未漏改**（仅 spec 文档不完整）。教训已记 memory。

### Nit 3：`test_undo_manager.gd:suite_setup` 对 null scene 无守卫 — ✅ 已修

`test_undo_manager.gd:43-44` 直接 `EditorInterface.get_edited_scene_root().add_child(_arena)`，无场景打开时 null deref SCRIPT ERROR，runner 的 fail_setup 不捕获 suite_setup 内崩溃。**已修**：suite_setup 头加 `var scene_root := EditorInterface.get_edited_scene_root(); if scene_root == null: skip_suite("no scene open..."); return`。

### Nit 4：两处弱哨兵断言 — ✅ 已修

- `test_add_method_invalid_target_is_guarded`：原 `assert_true(true)`。**已改**：断言 `_arena.get_child_count()` 在 commit 前后不变（守卫确实没落地 op）。
- `test_apply_op_unknown_type_is_warned`：原 `assert_true(is_instance_valid(target))`。**已改**：给 target 设 name="_McpTestBefore"，断言 commit 后 name 仍 "_McpTestBefore"（unknown type 确实没应用 property）。

### Nit 5：`handle_test_manage` 跨多 suite 仅返最后一个 suite — ✅ 已修

`mcp_test_runner.gd:43` 每 run_suite 头 `_results.clear()`，多 suite 跑完只存最后一个。`test_commands.gd:137` handle_test_manage 调 runner.get_results() 误导。**已修**：test_commands 加 `_last_combined_results` 成员缓存 handle_test_run 的聚合快照，handle_test_manage 返回它（非 runner 内部 _results）。

---

## 值得进 memory 的工程教训

### `findEditorCommandForTool(toolName)` 与 merged tool 命名错配 — capability-matrix `editor.exists` 字段系统性失真

- **证据**：`src/capability/extract.ts:51` 调 `findEditorCommandForTool(tool.name)`，tool.name 是顶层工具名（'testing'/'asset'/'scene'）；但 `EDITOR_COMMAND_ROUTING`（`static-grep.ts:66-137`）以**扁平 method 名**（test_run/asset_create/add_node）为 key。故 `findEditorCommandForTool('testing')` → `ROUTING['testing']` = undefined → `gdScriptImpl.editor.exists = false`。
- **实测**：capability-matrix.json:4210-4213 testing 工具 `editor.exists=false`（实际 command_handler.gd:129-132 有分支）；validation、asset、scene、animation_track、particles、nav、animtree、ui 全族 merged tool 均 editor.exists=false。
- **性质**：**非 P2-12 回归**（sibling 一致，是 extract.ts 设计缺陷）。capability-matrix 的 `editor.exists` 字段对全部 merged tool 系统性失真，不能用作"editor 侧有无 GD 实现"的判据。
- **建议**：extract.ts:51 应改为遍历 ROUTING 找以工具名前缀匹配，或经 editor-method-map MAP 反查 toolName → method 集合再判 exists。本期不改（非 P2-12 范围）。

---

## 验证完整性（coordinator 实测）

| 命令 | 结果 |
|---|---|
| `npm run lint` | ✅ 0 警告 |
| `npm run build` | ✅ 0 错误 |
| `npm test` | ✅ 4377 passed / 0 failed |
| `npm run check:tool-count` | ✅ 20/20 一致 |
| `npm run check:budget` | ✅ 0 warning |
| `npm run check:test-quality` | ✅ PASS |
| `validate_scripts`（6 .gd） | ✅ 0 error |
| preload load()（框架逻辑） | ✅ 断言/捕获通过 |
| 本地 editor `test_run(suite="undo_manager")` | ⏳ 待本地实测（CI 不跑 editor 套件）|

---

## 相关文件清单

**新增**（6）：
- `addons/godot_mcp_server/testing/mcp_test_suite.gd`
- `addons/godot_mcp_server/testing/mcp_test_runner.gd`
- `addons/godot_mcp_server/testing/script_error_capture.gd`
- `addons/godot_mcp_server/testing/suites/test_undo_manager.gd`
- `src/tools/testing.ts`
- `test/testing.test.ts`

**修改（关键）**：
- `addons/godot_mcp_server/commands/test_commands.gd`
- `addons/godot_mcp_server/command_handler.gd`
- `src/core/editor-method-map.ts`
- `src/core/module-loader.ts`
- `src/capability/static-grep.ts`
- `test/core/editor-method-map.test.ts`
- `src/tools/rule-templates.ts` + `.claude/rules/godot-mcp-core.md`（独立副本）

**Nit 涉及**：
- `docs/使用指南-Warp.md`（Nit 1：已修）
- `docs/plans/p2-12-mcp-test-suite-spec.md`（Nit 2：流程教训）
- `src/capability/extract.ts:51`（memory 教训：命名错配）
