# E-P1 测试质量机械修复设计（报告4 P1 子批）

> 继承总 spec `docs/superpowers/specs/2026-07-29-审查修复批次设计.md` batch E（测试质量）。本子批只做 brainstorming 核实后确认的 **3 项机械改动**；P2 设计重项（env 隔离 / 质量门禁 / 弱断言 / mutation）另起 brainstorm。

## Goal

补齐报告4（测试覆盖缺口与可信度）P1 级测试工程治理的 3 个机械缺口，提升 CI 真覆盖 + 本地回归保真 + 清死代码。不含设计决策项（另起）。

## Architecture

3 个相互独立的机械改动，各自独立提交：
1. 删 0 引用死文件 `test/helpers/godot-mock.ts`。
2. `package.json` 加 `pretest` 钩子强制本地 `npm test` 先 build。
3. 2 个 hasGodot 功能 e2e 加进 ci.yml godot-matrix 白名单。

## brainstorming 核实结论（驱动范围决策）

报告4 E 批原文 8 项（扣 A0 已闭环的 :93 P0 韧性 e2e）。逐项源码核实：
- **:93 P0 韧性 e2e** → 已由 A0 闭环（`e2e-resilience-editor.test.ts` OPT_IN + `e2e-resilience-headless.test.ts` 已进 ci.yml:145 白名单）。扣除。
- **:94 鉴权 e2e 进 CI** → **原 finding 误判**：editor-auth.test.js / instance-api-auth.test.ts 是 platform/symlink skipIf（非 hasGodot），**已在 check job（ci.yml:45 `vitest run --exclude game-bridge`）跑**，不需进 godot-matrix 白名单。真 CI gap = 3 个 hasGodot 功能 e2e 文件未进 godot-matrix 白名单。**重定义**：核实后只 2 个有意义——`e2e-asset-tools`（skipIf !canRunE2E=hasGodot&&hasProject&&hasEditorFlag）+ `e2e-bridge-get-node-layout`（skipIf !hasGodot||!hasRealProject||!RUN）；`blender-integration` skipIf !hasBlender（CI 无 Blender，加了也 skip）→ **不加**。
- **:96 pretest build** → 属实：package.json 无 pretest，本地 `npm test` 不 build，21 测试 import build/ 跑旧码；CI ci.yml:27,129 有 build 不受影响。
- **:97 mock 死文件** → 属实：`test/helpers/godot-mock.ts` grep 全仓 0 引用（真实 mock 面是 23 个 vi.mock gdscript-executor 内联）。**注**：:97 原文第二部分「23 vi.mock 补 failure 变体」是大工程（非机械），**本子批不做**，另起。
- **:101 e2e-scene 缓存** → **多半非问题**：`test/e2e-scene/.godot` git ls-files 空（未入库）→ CI 每次全新无缓存过期；仅本地 .godot 残留（次要）。**defer**。
- **:95 env 隔离 / :98 质量门禁 / :99 弱断言 / :100 mutation** → 设计重，另起 brainstorm。

## 3 项设计

### 项 1（:97a）：删 godot-mock.ts 死文件
- **改**：删 `test/helpers/godot-mock.ts`（grep 已确认 0 引用）。
- **验证**：`tsc` 0（删文件不破坏 import，因 0 引用）；`vitest run` 全绿（无测试依赖它）。
- **防复发**：本批不加 defects detect（测试基建不进 defect 库，报告4 性质）；可加一个 `test/helpers/` 死文件 meta 检测属 :98 质量门禁（另起），本批不做。

### 项 2（:96）：pretest build
- **改**：`package.json` scripts 加 `"pretest": "npm run build"`（在 `"test"` 前）。
- **取舍**：每次 `npm test` 先 build（~数秒）防跑 build/ 旧码。`npm run test:watch` / `test:coverage` 等不触发 pretest（仅 `npm test`/`npm run test`）。开发者跑单文件 `npx vitest run <file>` 不受影响。
- **验证**：`npm test` 本地先 build 再测；CI 行为不变（已有 build step）。

### 项 3（:94 重定义）：2 hasGodot 功能 e2e 进 godot-matrix 白名单
- **改**：`.github/workflows/ci.yml:145` E2E 白名单命令追加 `test/e2e-asset-tools.test.ts test/e2e-bridge-get-node-layout.test.ts`（现有：e2e-full-tool-verification + e2e-p1-p5 + data-import-integration + e2e-resilience-headless）。
- **不加** blender-integration（需 Blender，CI 无，加了 skip）。
- **验证**：两文件 describe.skipIf 条件在 godot-matrix（GODOT_PATH 已设 + 真项目 fixture）下满足 → CI 真跑而非 skip；e2e-report JSON 含两文件结果。本地无 Godot 时 skipIf 静默跳过（不误报）。

## Global Constraints（继承总 spec）

- 工作仓库 `D:\GitHub\godot-mcp-enhanced`；master 本地 commit 不 push。
- 精确编辑，匹配既有风格。
- 每项独立 commit；TS/config 改后 `tsc`/门禁；CI 改动尽量可本地验证（godot-matrix 逻辑本地 vitest 验 skipIf 行为）。
- 核实驱动：本 spec 的范围决策全基于源码 grep 实测，非照抄 finding（[[plan-baseline-verify-grep]][[verify-implementation-by-source]]）。

## Defer 清单（另起 brainstorm / 排期）

- :95 路径测试 env 隔离四件套（策略：helper vs 逐个，哪些文件）
- :98 测试质量门禁（弱断言阈值 + mock/src drift 脚本 + 死文件检测）
- :99 弱断言强化 P2-7（抽样范围，排期）
- :100 mutation testing P2-8（Stryker vs 轻量，排期）
- :97b 23 个 vi.mock 补 failure 变体（大工程，非机械）
- :101 e2e-scene .godot 缓存（.godot 不入库，多半非问题）

## 验收（3 项后）

- `tsc` 0 / `eslint` 0 / `check:gdscript` 0-0 / `vitest` 全绿（删 godot-mock + pretest 不破坏现有测试）
- final review opus（整支）
- 项目待办.md 报告4 E 批段回标（:97a/:96/:94 重定义 [x] + defer 项标注）
- master 本地不 push

## Self-Review

- **Spec 覆盖**：3 项（:97a/:96/:94 重定义）有设计；defer 项明列。无遗漏。
- **占位符**：每项有精确改法 + 验证。无 TBD。
- **一致性**：:94 重定义基于核实（2 文件非 3，blender 需 Blender不加），与核实结论段一致。
- **范围**：3 项机械改动，单一 plan 可覆盖，不需拆分。
