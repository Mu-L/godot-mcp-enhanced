# 第三方审查：P2-13 N-3/N-4 流程清理

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查对象：`fa44286 docs(changelog): P2-13 登记 coverage batch [Unreleased] + N-3 docstring 精度` + `d9e5d83 docs(review): P2-12 slimSchema 单测第三方审查报告`
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 总体判定

**SHIPPED WITH NITS**

两个 commit 的核心声明经静态实测全部成立：N-3 docstring 精度修复准确（旧行号引用错误经 grep 实测确认，改述后的契约声明经 `parseGdscriptResult` 源码验证）；N-4 CHANGELOG `[Unreleased]` 完整无遗漏、无张冠李戴、无误列 merge commit。无 Blocking。2 个非阻塞 nit（一处措辞漂移、一处验证完整性诚实声明），其中 nit N-1 已由主 agent 在审查后顺手修复（`mock-results.test.ts:6` 措辞同步）。

---

## 逐维度结论（带 file:line 证据）

### 1. N-3 docstring 精度（核心）— 修复准确

**原 N-3 指控成立（独立复核）。** 旧 docstring 引用的 `:1008/:1021/:1044/:1116` 行号经实测 `src/gdscript-executor.ts`：

| 行号 | 真实内容（实测） | 工厂对应 kind | 指控是否成立 |
|---|---|---|---|
| `:1008` | `return { ..., compile_error: 'GDScript execution is disabled (ALLOW_EXECUTE_GDSCRIPT=false)' ...}` — **kill-switch**（`gdscript-executor.ts:1006-1009`） | 工厂**无** `kill-switch` kind | ✓ 成立（kill-switch 误列） |
| `:1020-1024` | sandbox violation `return`（`Sandbox violation: code contains dangerous patterns...`） | `kind:'sandbox'` | 行号略偏（return 从 :1020 起，body :1021-1023），语义对齐 ✓ |
| `:1043-1044` | `Godot binary not found: ${godotPath}` | `kind:'binary'` | ✓ 对齐 |
| `:1115-1127` | `Failed to write temp script: ${err}` — **write-temp-failed**（非 compile） | 旧 docstring `:68` 标 `:1116` 为 compile 分支 | ✓ 成立（`:1116` 是 write-temp-failed 非 compile） |

证据：`D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:1006-1009`（kill-switch）、`:1019-1025`（sandbox）、`:1042-1045`（binary）、`:1113-1127`（write-temp）。原 coverage-batch 审查 `D:\GitHub\godot-mcp-enhanced\docs\reviews\2026-07-31-coverage-batch.md:117`（N-3 条目）记录的指控与本次独立复核一致。

**改后 docstring 准确。** `test/helpers/mock-results.js:50-53`：
- `:50` "对齐 ExecuteGdscriptResult（src/gdscript-executor.ts）的字段形态" — 准确（接口在 `gdscript-executor.ts:449-466`）。
- `:51` "下游 parseGdscriptResult（src/tools/shared/errors.ts）只看字段形态不看 executor 内部行号" — **契约声明经实测成立**：`src/tools/shared/errors.ts:50-55` parseGdscriptResult 只查 `result.compile_success` → 报 `compile_error`；`!result.run_success` → 报 `run_error`。零行号引用。✓
- `:53` "行号易漂移，不引" — 设计原则正确。

**4 个 case 注释对应真实字段形态（实测）：**
- `:71` `compile`："compile_success:false + compile_error" — 实际 case（:72）返回 `{...base}`（base.compile_success=false）+ compile_error。✓
- `:74` `run`："compile_success:true + run_success:false + run_error" — 实际 case（:75）显式设 `compile_success: true, run_success: false, run_error`。✓ **真与 compile 不同**。
- `:77` `sandbox`："字段形态同 compile" — 实际 case（:78）返回 `{...base}`（compile_success=false），形态与 compile 同。✓
- `:80` `binary`："字段形态同 compile" — 实际 case（:81）返回 `{...base}`（compile_success=false），形态与 compile 同。✓

compile/sandbox/binary 三者字段形态真相同；run 真不同。修复准确。

### 2. N-4 CHANGELOG 完整性 — 完整无遗漏

**commit 清单完整性（逐条对 reflog）：** `.git/logs/HEAD:2080-2091` 揭示 coverage-batch 真实 commit 链：

| CHANGELOG 登记 | reflog 实测 commit message | 一致 |
|---|---|---|
| P2-8 + P1-2 `20b20c8`（:13） | `test(coverage): P2-8 health-monitor 状态恢复断言 + P1-2 WS 断连批量 reject 故障注入` | ✓ |
| P2-9 `196485e`（:14） | `test(connection): P2-9 补 resetReconnectState 直接单测` | ✓ |
| P2-10 `641738d`（:15） | `test(scene): P2-10 补场景树并发竞争真测试` | ✓ |
| P1-4 `d7f5347`（:16） | `test(scene): P1-4 补 scene 操作状态反查断言` | ✓ |
| P1-3 `1010860`+`125239d`（:17） | `refactor(test): P1-3 阶段 A` + `test(mock-factory): P1-3 阶段 B` | ✓（两 commit 都对） |
| P2-11 `bbca356`（:18） | `feat(schema): P2-11 ui schema 瘦身消除 check-token-budget WARN` | ✓ |
| N-1 `2985d1b`（:19） | `fix(capability): N-1 修复 build-matrix TOP5 spread 字符串乱码 + 审查文档` | ✓ |
| P2-12 `f31c95a`（:20） | `test(core): P2-12 补 slimSchema 直接单测（N-2 缺口）` | ✓ |

9 个实质 commit 全登记，无遗漏、无张冠李戴。

**抽查条目描述与 commit message 事实一致性：**
- :19 N-1 描述"预存 bug，P2-11 重跑 build-matrix 时再生产" — commit message 含"N-1 修复 build-matrix TOP5"，与 `docs/reviews/2026-07-31-coverage-batch.md:79,110-112` 记录的"非 P2-11 引入（预存），但 P2-11 重跑 build-matrix 时再生产了乱码"一致。✓
- :17 P1-3 描述"四 kind 经 parseGdscriptResult 真路径，非 mock 自证" — 与 `coverage-batch.md:60` 审查核实"测的是 parseGdscriptResult 的真失败契约"一致。✓
- :20 P2-12 描述"经 registry 查询 API 取 def（非直 import barrel）" — 与 P2-12 审查 `slim-schema-test.md:21-23` 核实一致。✓

**merge commit 处理：** reflog `:2090` 显示 `b924d23` 是 `pull origin master: Fast-forward`（合并/快进），CHANGELOG `[Unreleased]` 段**未**单列 `b924d23`。✓ 正确排除。

**本 commit（N-3）归类：** CHANGELOG `:22-24` 在 `### Fixed — N-3/N-4 流程清理（本 commit）` 单独段登记 N-3，未混入 P2-8..P2-12 批次。逻辑自洽（fa44286 本身是登记 batch 的 commit）。✓

### 3. 仓库级约束独立核查

- **AGENTS.md「完成前强制检查」三件套**（`AGENTS.md:262-270` lint/build/test）：commit 声称全绿。**无 Bash，未能实测复跑**。但 P2-12 审查文档 `slim-schema-test.md:125-136` 已有主 agent 复跑确认（294 文件 / 4319 passed，+6 用例），fa44286 commit message 声称"294 文件 4319 passed / particles + helpers 102 全绿"与之衔接自洽（fa44286 不增删测试，数学一致）。静态层面：本 commit 仅改 docstring/注释，不影响测试断言（见下），故 test 计数不变是合理推断。
- **文件范围核查：** fa44286 应只改 `test/helpers/mock-results.js`（docstring）+ `CHANGELOG.md` + `docs/reviews/`。d9e5d83 应纯文档落盘。本次审查范围内文件均未越界（未触及 `.claude/rules/`、`rule-templates.ts`、`build/`、`capability-matrix`、`addons/`）。✓
- **mock-results.js 改动范围：** 仅 docstring（:48-55）+ 4 case 注释（:71/74/77/80）。**base 对象（:58-68）+ switch case 返回值（:72/75/78/81）未变** — 与 coverage-batch 审查 `coverage-batch.md:44-46`（审查 fa44286 前的版本）记录的 kind→字段形态映射完全一致。✓ 工厂行为逻辑零改动，纯文档精度修复。

### 4. TS-GD 一致性 — 跳过

两 commit 无 `.gd` 改动。✓

### 5. 验证完整性

- **commit message 声明"npm test 294 文件 4319 passed / particles + helpers 102 全绿"**：**未能独立实测复跑**（无 Bash）。但 P2-12 审查文档 `slim-schema-test.md:133` 主 agent 已确认 294 文件 / 4319 passed。fa44286 仅改注释/文档，测试集合不变 → 计数不变是静态可推。✓（间接背书）
- **静态层面工厂行为不变：** switch case 返回值逐行对照 P2-12 审查前置版本（`coverage-batch.md:44-46`）字段形态映射完全一致，compile/sandbox/binary 共享 base（compile_success=false），run 单独设 compile_success=true。✓

---

## Blocking Issues

无。

---

## Nits（非阻塞）

**N-1（措辞漂移，跨文件不一致）：** `D:\GitHub\godot-mcp-enhanced\test\helpers\mock-results.test.ts:6` 仍写 "对齐 src/gdscript-executor.ts 真实失败分支"。这是 P1-3 阶段 B（`125239d`）留下的旧措辞，不在 fa44286 改动范围内（fa44286 只改 `mock-results.js`，未改 `mock-results.test.ts`），但与新 `mock-results.js:53` "非 executor 具体 early-return（行号易漂移，不引）" 的设计原则措辞略张力。**实际无害**：测试文件这句是高层语义描述（未引具体行号），断言的是字段形态（`compile_success`/`run_success` 等）而非行号。**已由主 agent 在审查后顺手统一**为"对齐 ExecuteGdscriptResult 的字段形态，见 mock-results.js docstring"。

**N-2（验证完整性诚实声明）：** fa44286 commit message 声称"npm test 294 文件 4319 passed"，但 P2-13 本身无独立审查报告落盘（d9e5d83 落的是 P2-12 的 slim-schema-test 审查，不是 P2-13 的 N-3/N-4 审查）。**本次审查即填补此空缺**（本文件）。

---

## 值得进 memory 的工程教训

- **测试工厂 docstring 引用生产代码具体行号是反模式**：`mock-results.js` 旧 docstring 引用 `gdscript-executor.ts:1008/1021/1044/1116`，但这些行号：(a) 易随生产代码改动漂移；(b) 把无关分支（kill-switch `:1008`）误列入工厂 kind 清单；(c) 把 write-temp-failed（`:1116`）误标为 compile。正确做法是引用"字段形态契约"（如 `ExecuteGdscriptResult` 接口 + 下游 `parseGdscriptResult` 的字段判据），因下游消费者只看字段不看行号。教训：测试 mock 工厂的 docstring 应描述"对齐哪个接口的字段形态"，而非"对齐生产代码第几行的 early-return"。

---

## 相关文件（绝对路径）

- `D:\GitHub\godot-mcp-enhanced\test\helpers\mock-results.js`（fa44286 审查对象：:48-55 docstring + :71/74/77/80 case 注释，工厂逻辑 :58-68 base + :72/75/78/81 case 返回值未变）
- `D:\GitHub\godot-mcp-enhanced\test\helpers\mock-results.test.ts:6`（nit N-1：旧措辞，**已同步**）
- `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts`（旧行号实测：:1006-1009 kill-switch / :1019-1025 sandbox / :1042-1045 binary / :1113-1127 write-temp；接口 :449-466）
- `D:\GitHub\godot-mcp-enhanced\src\tools\shared\errors.ts:44-55`（parseGdscriptResult 契约，只看字段不看行号）
- `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md:7-24`（[Unreleased] 段，9 commit 全登记，无 b924d23 merge）
- `D:\GitHub\godot-mcp-enhanced\docs\reviews\2026-07-31-coverage-batch.md:117`（N-3 原始指控记录）
- `D:\GitHub\godot-mcp-enhanced\docs\reviews\2026-07-31-slim-schema-test.md:125-136`（主 agent 门禁复跑确认，背书 fa44286 测试计数声明）

## 诚实声明

审查者无 Bash 工具，**未能实测**：`git show fa44286` / `git show d9e5d83`（确认 diff 文件清单与改动行）、`npm run lint`、`npm run build`、`npm test`（294 文件 / 4319 passed 复跑）。所有结论基于：直接 read committed 工作树源码 + grep `.git/logs/HEAD` reflog（确认 commit 链与 merge 性质）+ 交叉对照 P2-12 审查文档（`coverage-batch.md` + `slim-schema-test.md`）已落盘的核实记录。门禁类声明（lint 0 / build 0 / test 计数）由 P2-12 审查文档 `slim-schema-test.md:125-136` 中主 agent 已实测的记录间接背书（fa44286 不增删测试，计数衔接自洽）。落盘由主 agent 代为执行。

---

## 主 agent 门禁复跑确认（2026-07-31）

主 agent（有 Bash）已实测复跑三件套，补充审查者未能实测维度：

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误） | `npm run build` |
| Vitest | ✅ **294 文件 / 4319 用例 passed**（24 skipped，与 P2-12 基线一致，无回归） | `npm test` |
| particles + helpers 工厂消费者 | ✅ 102 用例全绿（docstring 改动未破坏工厂行为） | `npx vitest run test/particles.test.js test/helpers` |

审查者所有静态推断与主 agent 实测结果一致，无出入。
