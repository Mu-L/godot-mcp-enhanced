# scene/workflow 路径越权 defects detect 补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给已落地的两处路径越权防护（validation.ts run_and_verify scene / workflow.ts user:// 三处）补 defects.ts FIXED detect，使防护被误删时 CI 触发。

**Architecture:** 纯测试数据层改动。在 `test/regression/defects.ts` 的 FIXED_DEFECTS 数组末尾加两条 `detect()` 闭包（静态 grep 模式，对齐既有 99 条），同步 `defects-fixed.test.ts` 的硬计数断言。**生产代码零改动**——防护已存在于 src/。

**Tech Stack:** TypeScript, vitest, defects.ts 静态 grep detect 框架（readSrc/countMatchesInFile from detect-helpers.js）

**Spec:** `docs/superpowers/specs/2026-07-28-detect-scene-workflow-traversal-design.md`（r2，已通过审查 `D:\workspace\review\.claude\reviews\2026-07-28-detect-scene-workflow-traversal-spec-review.md`）

## Global Constraints

- 生产代码（src/、addons/）**零改动**。本 plan 只动 test/regression/ 与 Obsidian 文档。
- 两条 detect 必须 RED 验证（临时删防护确认 detect=1 触发），否则假绿。
- detect 风格对齐既有：`readSrc(...).match/includes` → 防护存在返 0、缺失返 1。
- commit message 遵循项目惯例（feat/refactor/test 前缀 + 中文描述 + Co-Authored-By trailer）。

---

## File Structure

| 文件 | 职责 | 改动 |
|---|---|---|
| `test/regression/defects.ts` | FIXED/OPEN detect 数据层 | FIXED 区末尾 +2 条 detect；:2 顶部计数注释 97→99 |
| `test/regression/defects-fixed.test.ts` | FIXED 硬断言门禁 | :113/:115 toBe(97)→99；:2 注释 94→99 |
| `docs/superpowers/specs/2026-07-28-detect-scene-workflow-traversal-design.md` | spec | §1/§2 行号统一成调用点（ADVISORY，可选） |
| `D:\workspace\Obsidian\GodotMCP\项目待办.md` | Obsidian 待办 | 勾 ① ② ③ checkbox + 计数校准（Task 2，不入 git） |

---

## Task 1: 补两条 defects FIXED detect + 计数同步 + GREEN/RED 验证

**Files:**
- Modify: `test/regression/defects.ts`（FIXED 区末尾 :1067 后 +2 条；:2 顶部注释）
- Modify: `test/regression/defects-fixed.test.ts:113,:115,:2`
- Test: `test/regression/defects-fixed.test.ts`

**Interfaces:**
- Consumes: `readSrc(path)` from `./detect-helpers.js`（已 import，defects.ts:9）
- Produces: 两条 FIXED detect 加入 `FIXED_DEFECTS` 导出数组，被 `defects-fixed.test.ts` 的 `it.each(FIXED_DEFECTS)` 自动消费

**前提事实（已 grep 实测）：**
- `validation.ts` 全文仅 `:549` 一处 `resolveWithinRoot(projectPath, normalized)`（窗口终点唯一）
- `workflow.ts` `hasTraversalSegments` 4 次：`:257` 定义 `(p: string)` + `:390(rawPath)`/`:515(rawReferencePath)`/`:584(rawFramesDir)` 三调用
- `defects.ts` FIXED 区在 `:1067`（`lint-missing-4-7-accessibility-breaking` 条目）后结束，`:1068` 是 OPEN 分节线
- `defects-fixed.test.ts:113/115` 是 `toBe(97)` 硬断言，`:2` 是文档注释

- [ ] **Step 1: 在 defects.ts FIXED 区末尾插入两条 detect**

定位 `test/regression/defects.ts`，在 `:1067` 行（`// 2026-06-28 lint-missing-4-7-accessibility-breaking 修复...detect=0 移 FIXED。`）之后、`:1068` OPEN 分节线（`// ═══...`）之前，插入：

```ts
  // ─── 2026-07-28 detect 补全（2026-07-22 安全/RCE 面审查 P1，防护已在批次 A/B 落地，补 detect 防复发）──
  { key: 'validation-run-and-verify-scene-traversal', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    // 2026-07-22 RCE面复审P1: validation.ts run_and_verify 的 args.scene 直接 push 进 godot CLI
    // 加载项目外场景执行节点脚本(无 GD _sanitize_res_path 兜底)。
    // fix: normalizeUserProjectPath + resolveWithinRoot(projectPath, normalized) 仅校验(validation.ts:549)。
    // 复发: 删 resolveWithinRoot 调用 → 窗口无终点 m=undefined → detect=1。
    detect: () => {
      const f = readSrc('src/tools/validation.ts');
      const m = f.match(/case 'run_and_verify'[\s\S]{0,1500}?\bresolveWithinRoot\(projectPath,\s*normalized\)/);
      return m ? 0 : 1;
    } },
  { key: 'workflow-user-protocol-traversal', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    // 2026-07-22 安全审查: workflow.ts 三处 user:// 放行不校验 .. 段(reference_path:515 / frames_dir:584 /
    // bridge.screenshot.path:390), GD Image.load/DirAccess/bridge take_screenshot 任意目录读/写。
    // fix: 三处调用均加 hasTraversalSegments。复发: 任一处调用删 → raw count<3 detect=1。
    // 注: :257 函数定义 hasTraversalSegments(p:) 不匹配 raw 前缀, 故不计数。
    detect: () => {
      const f = readSrc('src/tools/workflow.ts');
      return (f.match(/hasTraversalSegments\(raw\w+/g) || []).length >= 3 ? 0 : 1;
    } },
```

- [ ] **Step 2: 同步 defects.ts:2 顶部计数注释**

`test/regression/defects.ts:2` 把 `// FIXED_DEFECTS 97 条` 改为 `// FIXED_DEFECTS 99 条`，并在那一长串分源描述末尾（`...Bridge take_screenshot null-crash-swallow×1）。` 之前）追加 ` + 2026-07-28 scene/workflow traversal detect×2`。

- [ ] **Step 3: 同步 defects-fixed.test.ts 计数**

`test/regression/defects-fixed.test.ts`：
- `:2` `// FIXED_DEFECTS 94 条硬断言` → `// FIXED_DEFECTS 99 条硬断言`
- `:113` `expect(FIXED_DEFECTS.length).toBe(97);` → `expect(FIXED_DEFECTS.length).toBe(99);`
- `:115` `expect(new Set(keys).size, '存在重名 key').toBe(97);` → `expect(new Set(keys).size, '存在重名 key').toBe(99);`

- [ ] **Step 4: GREEN — 跑 defects-fixed.test 应全过**

Run: `npx vitest run test/regression/defects-fixed.test.ts`
Expected: PASS，两条新 detect `[CRITICAL] validation-run-and-verify-scene-traversal` 与 `[CRITICAL] workflow-user-protocol-traversal` 出现在 it.each 输出且通过，总计 FIXED 99 条全 `detect() === 0`。

- [ ] **Step 5: RED 验证 ① — 确认 detect ① 非假绿**

临时编辑 `src/tools/validation.ts:549`，把 `resolveWithinRoot(projectPath, normalized);  // 仅校验, throw if 越界` 整行注释掉（行首加 `//`）。
Run: `npx vitest run test/regression/defects-fixed.test.ts -t "validation-run-and-verify-scene-traversal"`
Expected: FAIL，`detect 命中 1（复发）`。
**还原**：去掉临时 `//`，恢复 `:549` 原样。

- [ ] **Step 6: RED 验证 ② — 确认 detect ② 非假绿**

临时编辑 `src/tools/workflow.ts:390`，把 `} else if (hasTraversalSegments(rawPath)) {` 改成 `} else if (false && hasTraversalSegments(rawPath)) {`（保留结构，让该调用不被 raw 正则匹配——更接近"逻辑删除"且语法不破）。注意：此临时改动会让 screenshot path 失去越权校验，仅本步骤期间。
Run: `npx vitest run test/regression/defects-fixed.test.ts -t "workflow-user-protocol-traversal"`
Expected: FAIL，`detect 命中 1（复发）`（raw 调用 count 3→2 < 3）。
**还原**：把 `:390` 改回 `} else if (hasTraversalSegments(rawPath)) {`。

- [ ] **Step 7: 全量回归 + tsc**

确认 Step 5/6 还原后工作树只剩 Task 1 的 test 改动。
Run: `npx vitest run` 
Expected: 全量 PASS（基线 vitest 全绿，4 pre-existing T11 elicitation 若仍 skip/fail 需对照基线确认非本次引入——本 plan 只动 test/regression 数据，不碰 ToolDispatcher，故 T11 状态不变）。
Run: `npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 8: 顺手统一 spec 行号（ADVISORY，可选）**

`docs/superpowers/specs/2026-07-28-detect-scene-workflow-traversal-design.md` §1/§2 表格的 `:514/:583/:388`（startsWith 行）统一成调用点 `:515/:584/:390`（hasTraversalSegments 行），与 §4 detect ② 注释一致。纯文档，不影响逻辑。

- [ ] **Step 9: Commit**

```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts docs/superpowers/specs/2026-07-28-detect-scene-workflow-traversal-design.md
git commit -m "test(regression): 补 scene/workflow 路径越权 defects detect（防复发）

2026-07-22 安全/RCE 面审查两条 P1 防护已在批次 A/B 落地,补 detect 防回归:
- validation-run-and-verify-scene-traversal: run_and_verify scene 越权
  (validation.ts:549 resolveWithinRoot 校验)
- workflow-user-protocol-traversal: user:// 三处穿越
  (workflow.ts:390/515/584 hasTraversalSegments)
FIXED 97→99, defects-fixed.test toBe(97)→99, RED 双向验证非假绿。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Obsidian 待办文档勾选 + 计数校准（文档，不入 git）

**Files:**
- Modify: `D:\workspace\Obsidian\GodotMCP\项目待办.md`（Obsidian vault，非 git 仓库）

**说明：** Obsidian 文档不在本 git 仓库，无 commit。本任务手工编辑。

- [ ] **Step 1: 勾选安全/RCE 面审查段相关 checkbox**

在 `D:\workspace\Obsidian\GodotMCP\项目待办.md`「安全/RCE 面专项审查」段：
- 复审 P1 `validation.ts run_and_verify scene 无 root 校验`（约 :117）checkbox `[ ]` → `[x]`，追加 `✅ 2026-07-28 防护已在 validation.ts:549（批次 A/B）+ defects detect 补全`
- 复审 P2 `workflow.ts batch_validate scripts`（:118）与本任务无关，**不动**
- P1 `workflow.ts reference_path`（:108）/ `frames_dir`（:109）/ P2 `bridge.screenshot.path`（:110）checkbox `[ ]` → `[x]`，追加 `✅ 2026-07-28 防护已在 workflow.ts:515/584/390（批次 A/B）+ defects detect 补全`

- [ ] **Step 2: 标注 ③ C4 nav bake 闭环**

三层架构审查段 `P2 nav_commands bake_result`（:133）或批次 C 段，标注 C4 已闭环：`✅ 2026-07-28 C4 nav bake async-dispatch SDD 闭环 @ eb439a9（已 push origin）`。

- [ ] **Step 3: 校准 defects 计数旧值**

待办内多处 `54 条 = 46 FIXED + 8 OPEN`（:73 等 07-10 旧值）改为实际 `108 条 = 99 FIXED + 9 OPEN`（在 Task 1 完成后）。至少更新「defect 待办」段顶部的 07-10 核实 callout（:72-78）。其余历史校准段（07-22 各批次）保留原值（历史快照，不改写历史）。

---

## Self-Review

**1. Spec coverage：**
- spec §4 detect ① ② → Task 1 Step 1 ✓
- spec §5 计数同步 → Task 1 Step 2/3 ✓
- spec §6 文档勾选 → Task 2 ✓
- spec §7 TDD GREEN/RED → Task 1 Step 4/5/6 ✓
- spec §8 YAGNI（不动 advisory 子项 / 不改 :20 it 名 / 不动 C4 实现）→ Global Constraints + 未列入任务 ✓
- spec §10 验收（detect 入库 / fixed.test PASS / RED 双向 / vitest 绿 tsc 0 / 待办勾选 / final review）→ Task 1 + Task 2 + 后续 final review ✓

**2. Placeholder scan：** 无 TBD/TODO。每步含完整代码或精确命令。RED 验证给出了具体的临时改动字符串与还原指令。

**3. Type consistency：** 两条 detect key 唯一（grep 确认 defects.ts 无 `validation-run-and-verify-scene-traversal` / `workflow-user-protocol-traversal`）；`readSrc` 签名一致；计数 99 在 defects.ts:2 / defects-fixed.test.ts:113/:115/:2 四处统一。

**风险确认：** Step 5/6 临时改 src/ 须严格还原，Step 7 前核对 `git diff --stat` 只剩 test/ + docs/ 改动。
