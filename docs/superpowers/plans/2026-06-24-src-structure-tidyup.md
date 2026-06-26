# src 目录结构整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `D:\GitHub\godot-mcp-enhanced\src` 根目录中散落的两个内聚文件族（tscn、animation）收进各自目录，并确立 `src/tools/` 的分组规则，降低导航成本——行为零变化。

**Architecture:** 纯文件移动 + import 路径迁移。利用"族内文件互相引用、移动后仍在同目录"这一性质，使**内部相对引用零改动**，只需修改跨目录消费者的 import 路径。所有移动用 `git mv` 保留历史。验证手段是 TypeScript 编译（路径全对）+ 全量测试（行为零回归），而非 TDD 失败测试——这是行为保持型重构。

**Tech Stack:** TypeScript（Node16 ESM，import 必须带 `.js` 后缀，无 path 别名）、Vitest、Git。

## Global Constraints

- **Node16 ESM 相对路径**：所有 import 是相对路径 + `.js` 后缀（见 `D:\GitHub\godot-mcp-enhanced\tsconfig.json`，`module: Node16`，无 `paths`）。没有"一处改全局"的别名层，必须逐处改相对路径。
- **行为零回归**：本计划不改任何逻辑，只移动文件 + 改 import 路径。验收硬指标：`npm run build` 通过 + `npm test` 全绿（与重构前基线一致）。
- **保留 Git 历史**：所有文件移动用 `git mv`，不用"删旧建新"。
- **保留文件名**：本计划只移动文件到新目录，**不改文件名**（如 `tscn-parser.ts` 移到 `src/tscn/` 后仍叫 `tscn-parser.ts`）。去前缀重命名是额外的 churn，列为可选 follow-up，不在本计划内。
- **保留 barrel**：`tscn-editor.ts` 是 barrel re-export（I-04 拆分时遗留），随族一起移动，消费者路径迁移到新位置，不保留根目录兼容 shim（保留 shim 会违背"清干净根目录"的初衷）。
- **不动测试文件位置**：只改测试文件里的 import 路径，不移动测试文件本身（test 目录组织是独立的另一回事）。
- **中文注释/commit**：遵循项目惯例（commit message 中文，参考 `git log`）。
- **绝对路径引用**：本计划文档内文件引用一律绝对路径；shell 命令内在仓库根执行时用相对路径以求可读。

## 分组规则（本计划确立并落地）

> 现有代码已隐含此规则，但未被一致执行（`scene/`、`ui/` 遵守，`animation-*` 违反）。本计划显式化并补齐。

**规则：当一个工具/子系统由 ≥2 个源文件实现时，建同名目录；单文件实现则平铺在 `src/tools/`。**

判定依据是"文件数 / 职责可分性"，**不是行数**。例：`script.ts`（1020 行）虽大但单文件单职责，不拆；`animation-ops.ts` + `animation-shared.ts` + `animation-track.ts` 三文件共实现动画工具，应建目录。

| 子系统 | 现状 | 规则判定 |
|--------|------|---------|
| scene | 目录 `scene/`（index/helpers/scene-instance/scene-merge）| ✅ 已合规 |
| ui | 目录 `ui/`（6 文件）| ✅ 已合规 |
| **tscn** | 5 文件散在 `src/` 根 | ❌ 应建 `src/tscn/`（Task 1）|
| **animation** | 3 文件散在 `src/tools/` | ❌ 应建 `src/tools/animation/`（Task 2）|
| **scene-commit** | 2 文件散在 `src/tools/` | ❌ 逻辑属 scene，并入 `src/tools/scene/`（Task 3）|
| script / validation / material-ops 等大文件 | 单文件平铺 | ✅ 合规（不拆）|

---

## Task 1: tscn 族收进 `src/tscn/`

**Files:**
- Move: `D:\GitHub\godot-mcp-enhanced\src\tscn-parser.ts` → `src\tscn\tscn-parser.ts`
- Move: `D:\GitHub\godot-mcp-enhanced\src\tscn-editor.ts` → `src\tscn\tscn-editor.ts`（barrel）
- Move: `D:\GitHub\godot-mcp-enhanced\src\tscn-editor-add.ts` → `src\tscn\tscn-editor-add.ts`
- Move: `D:\GitHub\godot-mcp-enhanced\src\tscn-editor-detach.ts` → `src\tscn\tscn-editor-detach.ts`
- Move: `D:\GitHub\godot-mcp-enhanced\src\tscn-editor-shared.ts` → `src\tscn\tscn-editor-shared.ts`
- Modify（src 消费者，5 处 import）: `src\resources.ts`、`src\tools\batch-tools.ts`、`src\tools\scene\index.ts`、`src\tools\scene\scene-instance.ts`
- Modify（test 消费者，8 文件）: `test\e2e-p1-p5.test.ts`、`test\scene-tools.test.js`、`test\tscn-editor-add-node.test.ts`、`test\tscn-editor.test.js`、`test\tscn-editor-shared.test.ts`、`test\tscn-parser.test.js`、`test\tscn-parser-instance.test.js`、`test\tscn-editor-batch.test.ts`

**Interfaces:** 不变。barrel `tscn-editor.ts` 对外导出签名（`addNode`/`addNodes`/`findInstanceNode`/`detachInstance` 等）和 `tscn-parser.ts` 的 `parseTscn`/`parseTscnSummary` 签名均不动；族内文件互相引用（add→shared、detach→shared、barrel→add/detach/shared）因同目录移动，**相对路径不变**。

- [ ] **Step 1: 移动 5 个文件到 `src/tscn/`**

```bash
mkdir -p src/tscn
git mv src/tscn-parser.ts          src/tscn/tscn-parser.ts
git mv src/tscn-editor.ts          src/tscn/tscn-editor.ts
git mv src/tscn-editor-add.ts      src/tscn/tscn-editor-add.ts
git mv src/tscn-editor-detach.ts   src/tscn/tscn-editor-detach.ts
git mv src/tscn-editor-shared.ts   src/tscn/tscn-editor-shared.ts
```

预期：`git status` 显示 5 个 rename。barrel（`tscn-editor.ts`）内部的 `./tscn-editor-shared.js`、`./tscn-editor-add.js`、`./tscn-editor-detach.js` 因仍在同目录，**无需改动**。

- [ ] **Step 2: 改 src 内 5 处消费者 import**

逐处把路径从 `tscn-xxx.js` 改为 `tscn/tscn-xxx.js`（仅插入 `tscn/` 段，文件名不变）：

| 文件:行 | 旧 | 新 |
|---------|----|----|
| `src\resources.ts:9` | `'./tscn-parser.js'` | `'./tscn/tscn-parser.js'` |
| `src\tools\batch-tools.ts:10` | `'../tscn-parser.js'` | `'../tscn/tscn-parser.js'` |
| `src\tools\scene\index.ts:9` | `'../../tscn-parser.js'` | `'../../tscn/tscn-parser.js'` |
| `src\tools\scene\index.ts:12` | `'../../tscn-editor.js'` | `'../../tscn/tscn-editor.js'` |
| `src\tools\scene\scene-instance.ts:7` | `'../../tscn-editor.js'` | `'../../tscn/tscn-editor.js'` |

- [ ] **Step 3: 改 test 内 8 个文件的 import**

每处把 `../src/tscn-xxx.js` 改为 `../src/tscn/tscn-xxx.js`：

| 文件:行 | 目标 |
|---------|------|
| `test\e2e-p1-p5.test.ts:17` | `../src/tscn/tscn-editor.js` |
| `test\scene-tools.test.js:70` | `../src/tscn/tscn-parser.js` |
| `test\tscn-editor-add-node.test.ts:2,3` | `../src/tscn/tscn-editor.js` |
| `test\tscn-editor.test.js:2` | `../src/tscn/tscn-editor.js` |
| `test\tscn-editor-shared.test.ts:2` | `../src/tscn/tscn-editor-shared.js` |
| `test\tscn-parser.test.js:3` | `../src/tscn/tscn-parser.js` |
| `test\tscn-parser-instance.test.js:2` | `../src/tscn/tscn-parser.js` |
| `test\tscn-editor-batch.test.ts:2,3` | `../src/tscn/tscn-editor.js` |

- [ ] **Step 4: 编译验证**

Run: `npm run build`
Expected: tsc 编译通过，无 "Cannot find module" 错误。

- [ ] **Step 5: 测试验证（回归保护）**

Run: `npx vitest run test/tscn-editor.test.js test/tscn-parser.test.js test/tscn-editor-add-node.test.ts test/tscn-editor-batch.test.ts test/tscn-editor-shared.test.ts test/tscn-parser-instance.test.js`
Expected: 全部通过（与重构前一致）。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(tscn): tscn 编辑器族收进 src/tscn/ 目录

将散在 src/ 根的 5 个 tscn 文件（parser/editor barrel/add/detach/shared）
收进 src/tscn/ 目录，清干净 src 根。族内互引同目录不变，仅迁移
5 处 src 消费者 + 8 处 test 消费者的 import 路径。行为零变化。"
```

---

## Task 2: animation 族收进 `src/tools/animation/`

**Files:**
- Move: `D:\GitHub\godot-mcp-enhanced\src\tools\animation-ops.ts` → `src\tools\animation\animation-ops.ts`
- Move: `D:\GitHub\godot-mcp-enhanced\src\tools\animation-shared.ts` → `src\tools\animation\animation-shared.ts`
- Move: `D:\GitHub\godot-mcp-enhanced\src\tools\animation-track.ts` → `src\tools\animation\animation-track.ts`
- Modify（src 消费者）: `src\core\module-loader.ts`（2 处）
- Modify（test 消费者）: `test\animation-advanced.test.js`、`test\animation-ops.test.js`、`test\animation-track.test.js`、`test\animation-shared.test.js`

**Interfaces:** 不变。三个文件对外导出（`TOOL_NAMES`/`getToolDefinitions`/`handleTool`/`TOOL_META` 等）签名不动；族内互引（ops→shared、ops→track、track→shared）同目录移动，**相对路径不变**。

- [ ] **Step 1: 移动 3 个文件到 `src/tools/animation/`**

```bash
mkdir -p src/tools/animation
git mv src/tools/animation-ops.ts    src/tools/animation/animation-ops.ts
git mv src/tools/animation-shared.ts src/tools/animation/animation-shared.ts
git mv src/tools/animation-track.ts  src/tools/animation/animation-track.ts
```

预期：`git status` 显示 3 个 rename。内部 `./animation-shared.js`、`./animation-track.js` 引用无需改动。

- [ ] **Step 2: 改 src 内 2 处消费者 import**

| 文件:行 | 旧 | 新 |
|---------|----|----|
| `src\core\module-loader.ts:26` | `'../tools/animation-ops.js'` | `'../tools/animation/animation-ops.js'` |
| `src\core\module-loader.ts:40` | `'../tools/animation-track.js'` | `'../tools/animation/animation-track.js'` |

- [ ] **Step 3: 改 test 内 4 个文件的 import**

每处把 `../src/tools/animation-xxx.js` 改为 `../src/tools/animation/animation-xxx.js`：

| 文件:行 | 目标 |
|---------|------|
| `test\animation-advanced.test.js:6` | `../src/tools/animation/animation-ops.js` |
| `test\animation-advanced.test.js:16` | `../src/tools/animation/animation-track.js` |
| `test\animation-ops.test.js:17` | `../src/tools/animation/animation-ops.js` |
| `test\animation-track.test.js:13` | `../src/tools/animation/animation-track.js` |
| `test\animation-shared.test.js:10` | `../src/tools/animation/animation-shared.js` |

- [ ] **Step 4: 编译验证**

Run: `npm run build`
Expected: 编译通过。

- [ ] **Step 5: 测试验证（回归保护）**

Run: `npx vitest run test/animation-ops.test.js test/animation-track.test.js test/animation-shared.test.js test/animation-advanced.test.js`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(animation): 动画族收进 src/tools/animation/ 目录

animation-ops/shared/track 三文件共实现动画工具,按分组规则建目录。
族内互引同目录不变,仅迁移 module-loader 2 处 + test 4 处 import。行为零变化。"
```

---

## Task 3: scene-commit 并入 `src/tools/scene/`（推荐方案）

> scene-commit（`scene-commit.ts` 生成脚本 + `scene-commit-tool.ts` 工具入口）逻辑上属于 scene 子系统，且 `scene/index.ts` 已 import 它。按分组规则，并入现有 `scene/` 目录比新建 `scene-commit/` 更内聚。

**Files:**
- Move: `D:\GitHub\godot-mcp-enhanced\src\tools\scene-commit.ts` → `src\tools\scene\scene-commit.ts`
- Move: `D:\GitHub\godot-mcp-enhanced\src\tools\scene-commit-tool.ts` → `src\tools\scene\scene-commit-tool.ts`
- Modify（src 消费者）: `src\tools\scene\index.ts`（1 处）
- Modify（test 消费者）: `test\e2e-p1-p5.test.ts`、`test\scene-commit-tool.test.ts`、`test\scene-commit.test.ts`

**Interfaces:** 不变。两文件对外导出签名不动；`scene-commit-tool.ts:9` 对 `./scene-commit.js` 的引用因同目录移动，**不变**。

- [ ] **Step 1: 移动 2 个文件到 `src/tools/scene/`**

```bash
git mv src/tools/scene-commit.ts      src/tools/scene/scene-commit.ts
git mv src/tools/scene-commit-tool.ts src/tools/scene/scene-commit-tool.ts
```

预期：`scene-commit-tool.ts:9` 的 `'./scene-commit.js'` 无需改动。

- [ ] **Step 2: 改 src 内 1 处消费者 import**

| 文件:行 | 旧 | 新 |
|---------|----|----|
| `src\tools\scene\index.ts:19` | `'../scene-commit-tool.js'` | `'./scene-commit-tool.js'` |

（从 tools/ 平铺迁入 scene/ 同目录，`../` 变 `./`）

- [ ] **Step 3: 改 test 内 3 个文件的 import**

每处把 `../src/tools/scene-commit` 改为 `../src/tools/scene/scene-commit`：

| 文件:行 | 目标 |
|---------|------|
| `test\e2e-p1-p5.test.ts:19` | `../src/tools/scene/scene-commit.js` |
| `test\e2e-p1-p5.test.ts:20` | `../src/tools/scene/scene-commit-tool.js` |
| `test\scene-commit-tool.test.ts:3,28` | `../src/tools/scene/scene-commit-tool.js` |
| `test\scene-commit.test.ts:3` | `../src/tools/scene/scene-commit.js` |

- [ ] **Step 4: 编译验证**

Run: `npm run build`
Expected: 编译通过。

- [ ] **Step 5: 测试验证（回归保护）**

Run: `npx vitest run test/scene-commit.test.ts test/scene-commit-tool.test.ts test/e2e-p1-p5.test.ts`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "refactor(scene): scene-commit 并入 src/tools/scene/ 目录

scene-commit/scene-commit-tool 逻辑属 scene 子系统,并入 scene/ 目录。
族内互引同目录不变,仅迁移 scene/index 1 处 + test 3 处 import。行为零变化。"
```

---

## Task 4: 分组规则文档化

> 防止未来再次混乱——把规则写进项目 CLAUDE.md，让后续贡献者（含 AI）有据可依。

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\CLAUDE.md`（在合适位置追加一节）

- [ ] **Step 1: 在 `CLAUDE.md` 追加"src 目录分组规则"小节**

在 `## MCP 子系统速查` 表格之后，追加：

```markdown
## src 目录分组规则

| 子系统形态 | 放置规则 |
|-----------|---------|
| 一个工具由 **≥2 个源文件**实现 | 建同名目录（如 `src/tools/scene/`、`src/tools/ui/`、`src/tools/animation/`）|
| **单文件**实现 | 平铺在父目录（如 `src/tools/script.ts`）|

判定依据是"文件数 / 职责可分性"，**不是行数**。大文件（如 `script.ts` ~1000 行）只要单文件单职责就不拆。新增工具时：先单文件起步，需要拆分时再升级为目录。
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: 记录 src 目录分组规则(≥2文件建目录,单文件平铺)"
```

---

## 全局回归验证（所有 Task 完成后）

- [ ] **Step A: 全量编译**

Run: `npm run build`
Expected: 无错误。

- [ ] **Step B: 全量测试**

Run: `npm test`
Expected: 全绿，与重构前基线一致（约 2670+ 测试）。

- [ ] **Step C: 结构确认**

Run: `ls src/*.ts`（应只剩入口与跨切面文件：`index.ts`、`GodotServer.ts`、`types.ts`、`helpers.ts`、`guard.ts`、`gdscript-executor.ts`、`godot-docs.ts`、`resources.ts`、`prompts.ts`、`screenshot.ts`、`error-analyzer.ts` 等，**不再有 `tscn-*`**）

Expected: `src/` 根不再出现 `tscn-*` 文件。

---

## 不做什么（YAGNI 边界）

- **不改文件名**：`tscn-parser.ts` 移到 `src/tscn/` 后保留原名（不改成 `parser.ts`）。去前缀是可选 follow-up，单独评估。
- **不动 `error-analyzer.ts`（374 行）和 `src/screenshot.ts`（265 行）**：前者是跨切面共享能力（被 `gdscript-executor.ts` + 多个工具引用，性质同 `helpers.ts`，留在根合理）；后者虽单消费者，但移动收益小、争议存，不在本轮。若后续要清根再单独处理。
- **不拆 `src/core/`**（28 文件）：再切 `core/connection/`、`core/security/` 是另一层判断，且团队已习惯现状，不在本轮。
- **不重命名 `src/scripts/`**（与根 `scripts/` 命名空间重复）：改名影响构建脚本（`package.json` 的 build 步骤硬编码 `src/scripts` → `build/scripts` 拷贝），收益不抵风险，不在本轮。
- **不移动测试文件**：只改测试 import 路径。
