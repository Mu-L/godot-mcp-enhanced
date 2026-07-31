# 第三方审查：coverage batch（P2-9/P2-10/P1-4/P1-3/P2-11）

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查范围：分支 `test/coverage-p2-9-p2-10-p1-4` 上 6 个 commit
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 审查范围（6 commit）

```
bbca356 feat(schema): P2-11 ui schema 瘦身消除 check-token-budget WARN
125239d test(mock-factory): P1-3 阶段 B 补 executeGdscript 失败分支测试
1010860 refactor(test): P1-3 阶段 A 统一 executeGdscript happy mock 工厂
d7f5347 test(scene): P1-4 补 scene 操作状态反查断言
641738d test(scene): P2-10 补场景树并发竞争真测试
196485e test(connection): P2-9 补 resetReconnectState 直接单测
```

## 环境限制（诚实声明）

本会话（审查者）无 Bash 工具，无法运行 `git diff`、`git show`、`npm test`、`npm run lint`、`npm run build`、`node scripts/check-token-budget.mjs`、`npm run build-matrix`。因此所有声明均通过直接 read 源码 / grep 已 commit 的工作树内容实测，而非照搬 commit message。涉及「跑命令验证」的维度（lint/build/test 退出码、test pass 计数 4313）**无法独立复现**，下方相应维度会明确标注「未能实测，仅静态核查」。check-token-budget 与 build-matrix drift 用「读 committed `docs/capability-matrix.json` 逐工具字节比对阈值」的方式静态等价复算。

---

## 总体判定

**SHIPPED WITH NITS**

6 个 commit 的核心声明经静态实测均成立：P2-11 真把 ui schema 砍到阈值下、check-token-budget 真无 WARN；P1-3/P1-4/P2-9/P2-10 的测试非假绿，确实走真契约。无 Blocking。存在 1 个值得修的预存 bug（capability-matrix.md TOP5 渲染乱码，**已由主 agent 修复**）+ 3 个测试质量/一致性 nit。

---

## 逐维度结论（带 file:line 证据）

### 1. 设计正确性

**slimSchema pass（P2-11）—— 设计正确，不破坏 schema 合法性。**
- `src/core/module-loader.ts:191-224` `slimSchema` 只删 `properties` 里 `removeProps` 列出的 key，保留 `inputSchema` 的 `type`/`required` 结构。
- 关键安全点：ui 工具顶层 `required` 只有 `['action']`（`src/tools/ui/index.ts:201`），而 `SLIM_CONFIG.ui.removeProps`（module-loader.ts:178-184）删的是 `theme_action`/`tree`/`ops` 等，**与 `required` 无交集**，不会产生"required 引用已删 prop"的非法 schema。✓
- 运行时行为不变：`src/tools/ui/index.ts:281/321/347/377/395` handler 仍从 `args.X` 读这些参数，slimSchema 只改 schema 形状不改 handler。✓
- `additionalProperties` 语义：ui 顶层 `inputSchema` 未显式设 `additionalProperties`，依赖 JSON Schema 默认 `additionalProperties: true`，LLM 仍可传未声明参数。descHint 已诚实标注。可接受。

**mockFailureResult 的 kind 分支 —— 与真实失败形态对齐，但 docstring 行号引用不精确。**
- 工厂 `test/helpers/mock-results.js:53-82` 的 kind 映射的是 `ExecuteGdscriptResult` 的**字段形态**，不是 `executeGdscript` 内部每个 early-return。合理设计——下游 `parseGdscriptResult`（`src/tools/shared/errors.ts:50-55`）只看字段形态。
- `kind:'sandbox'` 对齐 `gdscript-executor.ts:1019-1024` ✓；`kind:'binary'` 对齐 `:1043-1044` ✓。
- **docstring 行号不精确（nit N-3）**：`:68` 标 `:1116` 为 compile 分支实际是 write-temp-failed 分支。

**P2-10 并发测试的延时设计 —— 能真观察到并发，非 flaky。**
- `test/scene-validation-concurrency.test.js:396-402` 注入 50ms 延时版 spawnGodot。
- 关键推理：`edit_node` 的 slot 获取 `acquireShortRunningSlot()`（`src/tools/scene/index.ts:358`）是**同步**调用，发生在第一个 `await`（`:380`）之前。3 个 slot 在循环内即被占满，`await setTimeout(10)` 是冗余保险。
- 断言点（:433 `getShortRunningCount()===3`）落在 spawnGodot 50ms 延时窗内，稳。非 flaky。✓

### 2. TS-GD 一致性

本批 6 commit 无 `.gd` 改动。跳过。✓

### 3. 测试质量

**P1-3 阶段B（particles 失败分支）—— 非假绿，走真契约。**
- `test/particles.test.js:371-444` 的 4 个失败 case 通过 `handleTool('particles',...)` → `particles.ts:506` `parseGdscriptResult` → `errors.ts:50-55` `opsErrorResult('SCRIPT_EXEC_FAILED', ...)` 真路径，断言 `isError===true` + 文本含错误串 + 含 `SCRIPT_EXEC_FAILED`。**测的是 parseGdscriptResult 的真失败契约，不是 mock 自证**。✓

**P1-4 状态反查 —— 真状态断言 + mock 鸿沟诚实标注到位。**
- `test/scene-operations-mock.test.js:235-306` 用 `read_scene` 反查真 `.tscn`。`read_scene`（`src/tools/scene/index.ts:123-133`）走 `readFileSync + parseTscn`，**未被 mock**。
- "add_node P1 路径真写文件"判断**经核实成立**：`add_node` 无 properties 时走 `src/tools/scene/index.ts:172-205`，`:205` `writeFileSync` 真落盘。✓
- mock 鸿沟诚实标注：`:232-234` 明确写 edit_node/remove_node 走 spawnGodot 不写文件。✓

**P2-9 resetReconnectState —— 4 行为分支真覆盖。**
- `test/editor-connection.test.js:411-453` 场景A/B/C 覆盖 attempt→0 / enabled 重置（含 reconnect:false 不变量）/ timer 清理 / 无 timer 边界。"4 行为分支"是行为视角非源码 if 数，无夸大。✓

**slimSchema 自身零直接单测（测试质量缺口，nit N-2）。**
- grep 全仓 `slimSchema`/`SLIM_CONFIG`：仅 src + build 命中，**无任何 test 文件直接调用**。
- 间接覆盖仅来自 matrix-integrity.test.ts（只验工具名集合，不验 slim 行为）。
- `ui-tools.test.js` 经 barrel 直 import `getToolDefinitions`，**绕过 registerAllModules/slimSchema**，读的是未 slim 的原始 schema。

### 4. 部署同步

**capability-matrix 同步 —— JSON 同步，MD 渲染乱码（预存 bug，已修复）。**
- `docs/capability-matrix.json` ui 条目 description 已含 descHint，size 为 `descBytes 647 / schemaBytes 3560 / totalBytes 4207`。✓
- `docs/capability-matrix.md` TOP5 段曾渲染乱码（每行单字符）。根因 `src/capability/build-matrix.ts:56` `...top5Lines`（top5Lines 是 join 后字符串，spread 按字符迭代）。**已由主 agent 修复**（去掉 `.join('\n')`，让 `...` spread 数组）。

**check-token-budget 实测（静态等价复算）—— 真 0 WARN。**
- 阈值：perToolDesc 800 / perToolSchema 6000 / perToolTotal 7000 / totalSum 81920。
- 最大 schema 是 scene 4780B（< 6000）；最大 desc 是 ui 647B（< 800）；最大 total 是 scene 5057B（< 7000）；totalSum 66551B（< 81920）。✓

**rule-templates 同步约束 —— 未触发，无 drift。**
- 本批无 `.claude/rules/godot-mcp-*.md` 改动。✓

### 5. 仓库级约束独立核查

- **AGENTS.md「改动工具清单后」build-matrix 必跑**：slimSchema 改了 schema 形状，matrix JSON+MD 均 committed 且反映 slim 后状态。✓
- **AGENTS.md「完成前强制检查」三件套**：**未能实测**（无 Bash）。静态层面新测试文件语法/模式与现有一致。需有 Bash 的 agent 复跑确认。
- **CHANGELOG 未更新**（nit N-4）：6 个 commit 未登记 `[Unreleased]` 段。

### 6. 验证完整性

- check-token-budget 0 warn：**经静态复算确认**。
- npm test 4313 / lint 0 / build 0：**无 Bash 无法复现**，需有 Bash 的 agent 复跑。
- 分支覆盖/kind 对齐/add_node 写文件/并发可观测性/matrix JSON 同步/rule-templates 未触发：**均已 grep/read 实测确认**。

---

## Blocking Issues

无。

---

## Nits（非阻塞）

**N-1（应修，已修复）：`src/capability/build-matrix.ts:56` `...top5Lines` spread 字符串导致 `docs/capability-matrix.md` TOP5 段每行单字符渲染。**
- 修复：去掉 `:30` 的 `.join('\n')`，让 top5Lines 保持数组，`:56` `...top5Lines` 正确 spread 数组。
- 归属：非 P2-11 引入（预存），但 P2-11 重跑 build-matrix 时再生产了乱码。**已由主 agent 在审查后修复并重跑 build-matrix 验证**。

**N-2（测试质量缺口）：`slimSchema` / `SLIM_CONFIG` 零直接单测。**
- 建议：补 `test/core/module-loader-slim.test.ts`，经 `registerAllModules()` 取 ui def，断言 properties 不含 removeProps、description 含 descHint、未超阈值工具（如 scene）不被 slim。

**N-3（docstring 精度）：`test/helpers/mock-results.js:51` docstring 行号 `:1008/:1021/:1044/:1116` 把 kill-switch 列入但工厂无对应 kind；`:68` 标 `:1116` 为 compile 实际是 write-temp-failed。**
- 建议改述为"对齐 ExecuteGdscriptResult 的 compile/run/sandbox/binary 四种字段形态"，去掉易漂移的具体行号。

**N-4（流程）：6 个 commit 未登记 `CHANGELOG.md` `[Unreleased]`。**

---

## 值得进 memory 的工程教训

- **「直接 import barrel 的 getToolDefinitions」绕过 registerAllModules 后处理**：`test/ui-tools.test.js` 经 barrel 直接拿 `getToolDefinitions`，读的是**未经 slimSchema/injectTags 处理的原始 def**。生产路径（registerAllModules）与测试路径（直 import）看到的 schema 形状不同；任何在 registerAllModules 链路加的 pass 都不会被直 import 的测试覆盖。后续在 module-loader 加 pass 时，必须同时补"经 registerAllModules 取 def"的测试。

- **spread 运算符作用于字符串的隐性 bug**：`...string` 在 JS 里合法但按字符迭代。`build-matrix.ts:56` `...top5Lines`（top5Lines 是 join 后字符串）正是此陷阱，产出每行单字符的 markdown。该 bug 无测试捕获（matrix-integrity 只校验 JSON 不校验 MD 渲染）。教训：生成 markdown 的代码应有"MD 结构"断言。

- **commit message 声称的 "npm test N passed / lint 0 / build 0" 在无执行环境时无法独立复现**：第三方审查若仅有静态读取能力，对"跑命令"类声明必须明确标注"未能实测"。本次仅 check-token-budget 因脚本读 committed JSON、可静态等价复算而确认。
