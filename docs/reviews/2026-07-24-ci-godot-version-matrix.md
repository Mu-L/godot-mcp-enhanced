# CI Godot 版本矩阵第三方审查报告

**日期**：2026-07-27（补审查，实现于 2026-07-24）
**审查对象**：CI 增加 Godot 4.6.3 + 4.7.1 多版本编译门禁 + E2E + drift CI gate + generatedAt 噪音移除
**审查者**：独立 code-reviewer 子 agent（隔离视角）+ 主 agent 复核 N-1/N-2
**审查范围**：spec / plan / CI workflow / drift gate 实现 / capability-matrix 副作用

## 审查对象 commit 清单

| commit | 说明 |
|--------|------|
| `a1b3a38` | docs(spec): CI Godot 版本矩阵设计 |
| `407861d` | docs(spec): CI 矩阵 r1 修订（eng-review CRITICAL-1 + 2 IMPORTANT） |
| `1f5312a` | docs(plan): CI Godot 版本矩阵实施计划（4 task） |
| `45f980b` | ci(matrix): Godot 4.6.3+4.7.1 多版本编译门禁 + E2E |
| `93c4e24` | chore(capability): M2 证伪订正 + drift CI gate + 移除 generatedAt 噪音 |

---

## 总体判定

**SHIPPED WITH NITS**（已交付，5 处文档/小优化 Nits，无 Blocking）

核心功能（godot-matrix 双版本编译门禁 + E2E、gdscript-only gate、drift CI gate、generatedAt 噪音移除）均已按 spec/plan 落地且代码核实正确；drift gate 与 generatedAt 移除的副作用分析准确。无法核实的是 GitHub Actions 真实运行日志（CI 异步执行证据不可本地复核）。

---

## A. CI 配置正确性 — ✅ 全部成立

| spec/plan 声明 | 实测 | 证据 |
|----------------|------|------|
| matrix 4.6.3 + 4.7.1 在 workflow | ✅ | `.github/workflows/ci.yml:108-121` |
| E2E 真在多版本跑（非只编译） | ✅ | `ci.yml:144-147`，三测试文件均存在 |
| Godot 版本 URL 用 matrix 变量注入 | ✅ | `ci.yml:133,136,137`（非硬编码） |
| fail-fast: false 落实 | ✅ | `ci.yml:113` |
| download URL 外部核实有效 | ✅ | 4.7.1-stable release 36 asset，#19 即 `Godot_v4.7.1-stable_linux.x86_64.zip` |
| check job 去 continue-on-error | ✅ | `ci.yml:55-58`（其余 score 步骤仍保留各自 continue-on-error，符合 spec 语义） |

---

## B. eng-review 修订落实 — ✅ 真做了（非直接合并）

| 修订项 | 实测 | 证据 |
|--------|------|------|
| CRITICAL-1（blocking 真伪） | ✅ 结论成立 | `src\scoring\check-gdscript.ts:124-126`（正常路径 writeReport 后 return，无 exit）+ `:133`（仅 catch 路径 exit(1)） |
| IMPORTANT-1（R1 风险面） | ✅ | godot-matrix E2E 含 data-import-integration（`ci.yml:145`），正是 spec 预判的 csv 类 4.7 运行时差异风险面 |
| IMPORTANT-2（版本一致性） | ⚠️ 描述模糊 | 描述略模糊但实质约束（URL 验证）已在 plan Task 1 落实（见 N-4） |
| M2 证伪（commit 93c4e24） | ✅ 真证伪 | `docs\superpowers\specs\2026-06-21-scoring-m3b-dashboard-design.md:31-40` 真证伪了「verify_delivery 读 score.json 门禁」的范畴错误假设 |

---

## C. drift CI gate — ✅ 部分有效（范围明示见 N-1）

| 维度 | 结论 |
|------|------|
| 是什么 | `ci.yml:28-31` 的 `Check capability matrix drift` step，跑 diff-matrix.js |
| 防的 drift | `build\capability\diff-matrix.js:17-40` 查 4 维（added/removed/requiredParams/securityLevelDowngrades），读 HEAD 基线 vs 实时提取 |
| 是否真能拦住 | **部分**。能拦工具增删/requiredParams 契约变更/安全降级；**不能拦** inputSchema 内部字段（除 requiredParams）、description、size 变更 |
| CHANGELOG.md:178 笼统称「drift CI gate」 | ⚠️ 范围宽于实现（见 N-1，主 agent 复核确认） |
| generatedAt 移除对 drift gate 影响 | ✅ 无（gate 本就不读此字段），价值是消除 build-matrix 后无意义 git diff |

---

## D. 文档同步 — ⚠️ 两处缺口（N-1、N-2）

| 维度 | 实测 | 结论 |
|------|------|------|
| generatedAt 真移除 | `build-matrix.ts:70` 现 `{ tools: caps }`，`capability-matrix.json:1` 确认无 | ✅ |
| 移除安全 | build-matrix 写、diff-matrix 不读此字段；src/scoring/ 的 generatedAt 是 score.json 字段无关 | ✅ |
| **README 未同步 CI 矩阵覆盖** | README.md:509-541 多版本段只讲用户配置，未提贡献者 CI 覆盖 | 🔴 **N-2**（主 agent 复核确认） |
| **spec 引用 defects.md:1518-1527 不可追溯** | grep 全仓 `windows-godot47-toolchain-failures` 仅 spec/plan 自身命中 | 🔴 **N-3** |

---

## E. 验证完整性 — ✅ plan 4 task 大部分有据，CI 真跑无法核实

| 验证项 | 实测 |
|--------|------|
| plan Task 1/2（URL 验证 + ci.yml 重构 + 本地 gate 模拟） | ✅ 经代码核实完成 |
| plan Task 3/4（CI 真 matrix 跑 + 注入 SCRIPT Error 验 gate） | ⚠️ **无法核实**（CI 日志不可见） |
| 多版本 CI 是否真在 GitHub Actions 跑过 | ⚠️ **无法核实**。结构上 matrix 必产出两实例，但是否真绿过不可核实。spec 验收#6 允许 4.7.1 首跑红→修至绿 |
| spec r1 eng-review 真做了 | ✅ CRITICAL-1 反直觉结论 + M2 证伪均经代码核实为真 |

---

## Blocking Issues

**无。** 核心功能均正确落地，URL 经外部核实有效，gate 逻辑经源码核实正确，generatedAt 移除无副作用。

---

## Nits

### N-1（confidence 85，主 agent 复核确认）：drift gate 范围描述宽于实现

- **证据**：`CHANGELOG.md:178` 笼统称「drift CI gate」；`build\capability\diff-matrix.js:13-16` 实际只查 4 维（added/removed/requiredParams/securityLevelDowngrades）
- **影响**：用户/维护者读 CHANGELOG 以为 gate 全字段守护，实际只查契约关键字段。inputSchema 内部字段（除 requiredParams）、description、size 变更 gate 不拦
- **修复方向**：CHANGELOG.md:178 补「仅查契约 4 维：工具增删/requiredParams/安全降级」

### N-2（confidence 85，主 agent 复核确认）：README 未同步 CI 矩阵覆盖范围

- **证据**：`README.md:509-541` 多版本段只讲用户配置（如何设 GODOT_PATH），未提贡献者 CI 已覆盖 4.6.3+4.7.1 双版本编译+E2E
- **影响**：贡献者不知道 CI 已有多版本守护，可能误以为要手动测多版本
- **修复方向**：README CONTRIBUTING 段或单独 CONTRIBUTING.md 补「CI 自动跑 4.6.3+4.7.1 双版本编译门禁+E2E」

### N-3（confidence 80）：spec 引用 defects.md 不可追溯

- **证据**：`docs\superpowers\specs\2026-07-24-ci-godot-version-matrix-design.md:123` 引用 `defects.md:1518-1527`，grep 全仓 `windows-godot47-toolchain-failures` 仅 spec/plan 自身命中
- **影响**：审查者无法追溯缺陷来源
- **修复方向**：补完整路径或移除不可追溯引用

### N-4（confidence 80）：spec IMPORTANT-2 描述模糊

- **证据**：`design.md:4` 列 IMPORTANT-2 但无独立段落展开
- **影响**：审查者无法判断 IMPORTANT-2 具体是什么约束
- **修复方向**：明确展开或从修订清单移除

### N-5（advisory）：4.6.3 编译跑两次

- **证据**：spec `design.md:59` 已自述有意（check job + godot-matrix job 都跑 4.6.3 的 check:gdscript）
- **影响**：CI 时间增加
- **修复方向**：可接受（spec 已自述）；CI 时间敏感时 matrix 4.6.3 可跳过 check:gdscript 保留 E2E

---

## 值得记忆的工程教训（→ 待主 agent 集中登记）

1. **退出码不等于 blocking**：check:gdscript 正常 exit 0 即使 errors>0，真 blocking 在下游消费 report 的 gate
2. **多版本编译门禁核心价值在 E2E 不在编译**：Windows 4.7 修复 ≠ Linux CI 干净，版本×平台是正交风险面
3. **drift gate 范围必须明示**：只查契约关键字段比全字段比对稳健，但范围必须在文档写清避免错觉（本 PR 的反面教训）
4. **generatedAt 类时间戳不该进 committed json 快照**：无意义 git diff 污染 PR review
5. **eng-review 价值在反直觉结论**：CRITICAL-1「exit 0 即使 errors>0」只能靠读源码得出，纸面 review 会漏

---

## 相关文件（绝对路径）

- CI workflow：`D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`（godot-matrix job `:108-154`，drift gate `:28-31`）
- gate 逻辑源：`D:\GitHub\godot-mcp-enhanced\src\scoring\check-gdscript.ts:124-126,133`
- generatedAt 移除：`D:\GitHub\godot-mcp-enhanced\src\capability\build-matrix.ts:69-70`
- drift gate 实现：`D:\GitHub\godot-mcp-enhanced\build\capability\diff-matrix.js:17-40`（4 维范围 `:13-16`）
- gdscript gate：`D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\gdscript.ts:47`（errors>=1→score=0）+ `dimensions.ts:17`（gate 60）
- spec/plan：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-24-ci-godot-version-matrix-design.md` / `plans\2026-07-24-ci-godot-version-matrix.md`
- M2 证伪：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-21-scoring-m3b-dashboard-design.md:31-40`
- 文档缺口：`D:\GitHub\godot-mcp-enhanced\CHANGELOG.md:178`、`README.md:509-541`

---

## 审查者署名

- **独立审查**：code-reviewer 子 agent（agent_88c3f43f，已完成）
- **复核**：主 agent（grep 复核 N-1 drift gate 范围 + N-2 README 缺口均成立）
- **限制声明**：GitHub Actions 真实运行日志无法核实（CI 异步执行，本地不可见）；URL 有效性经 GitHub API 外部核实
