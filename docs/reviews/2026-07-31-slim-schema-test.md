# 第三方审查：P2-12 slimSchema 直接单测

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查对象：单个 commit `f31c95a test(core): P2-12 补 slimSchema 直接单测（N-2 缺口）`
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 总体判定

**SHIPPED WITH NITS**

该 commit（`f31c95a`）确实填补了审查 N-2 的缺口：新增的 `test/core/module-loader-slim.test.ts` 经 registry 查询 API 取 def，**真走 `registerAllModules` 包装链路**（非 barrel 直 import），6 个用例覆盖 slimSchema 的全部主要分支，断言具体非恒真。无 Blocking。1 个覆盖盲点（边界分支未覆盖）+ 1 个常量同步风险，均为非阻塞 nit。

---

## 逐维度结论（带 file:line 证据）

### 1. 设计正确性 — 成立

**测试确实走 slimSchema 包装链路，非假路径。** 经逐跳核实：
- `registerAllModules`（`src/core/module-loader.ts:229-241`）对每个 `ALL_MODULES` 元素构造 `wrappedMod`，其 `getToolDefinitions`（:237）为 `() => slimSchema(injectTags(originalGetDefs.call(mod)))`，再 `registerModule(wrappedMod)`（:239）。
- `registerModule`（`src/core/tool-registry.ts:39-70`）把 `wrappedMod` push 进 `modules` 数组（:41）。
- `getToolDefinition`（`src/core/tool-registry.ts:123-128`）遍历 `modules` 调 `m.getToolDefinitions()`（:125）—— 命中的就是 wrapped 版，**slim 真在链路生效**。✓

**各断言点对应 slimSchema 真实分支：**
- 用例 1（removeProps 移除）→ `module-loader.ts:209-214` newProperties 构造分支 ✓
- 用例 2（descHint 追加）→ `:220` `description: def.description + config.descHint` ✓
- 用例 3（阈值反向验证）→ `:196` `if (Buffer.byteLength(...) < SLIM_THRESHOLD_BYTES) return def` ✓
- 用例 4（required 引用未删）→ 对应 review N-2 安全点 ✓
- 用例 5（!config 分支）→ `:194` `if (!config) return def` ✓

**用例 4「required 引用未被删」真验证了 N-2 安全点。** ui 顶层 `required: ['action']`（`src/tools/ui/index.ts:201`），`SLIM_CONFIG.ui.removeProps`（`module-loader.ts:178-182`）删的是 theme_action/tree/ops 等 13 项，**与 `['action']` 无交集**。测试断言 `schema.required.toEqual(['action'])` + `properties` 仍有 `action`，确实验证了"不会产 required 引用已删 prop 的非法 schema"。✓

### 2. 测试质量（防假绿）— 成立

**断言具体，非恒真。** 逐条静态推断对实现的依赖：
- 用例 1：`not.toContain('theme_action')` 等 —— 若 slim 不删 prop，barrel 与 registry props 一致，theme_action 仍在 → RED。依赖成立。✓
- 用例 2：`toContain('专属参数(additionalProperties)')` —— 该子串仅出现在 `SLIM_CONFIG.ui.descHint`（`module-loader.ts:183`），原始 ui description（`src/tools/ui/index.ts:23`）不含。若 slim 不追加 → RED。✓
- 用例 3：`schemaBytes < 8000` —— committed `docs/capability-matrix.json` 记录 ui slim 后 schemaBytes=3560；原始（含 tree/ops/theme_* 13 个深嵌套 prop）显然 > 8000 才会触发 slim。若 slim 失效 → schema 反弹 > 8000 → RED。✓
- 用例 5：`scene.description.not.toContain('专属参数...')` —— scene 不在 SLIM_CONFIG，走 `!config` 分支原样返回，description 无 hint。若误把 scene 加入 SLIM_CONFIG → RED。✓

**路径隔离用例（用例 6）真证明「直 import barrel 绕过 slim」。** `test/ui-tools.test.js:3` 确实直 import `getToolDefinitions` from `../../src/tools/ui-tools.js`（barrel），不经 registerAllModules。用例 6 同时取 registry 版与 barrel 版，断言 `barrelProps.length > registryProps.length` + `barrelProps 含 theme_action` + `registryProps 不含 theme_action`。三重对照，若 slim 未生效两路 props 相等 → RED。这是上一审查批文 memory 教训的直接验证，设计扎实。✓

**作者声明的非假绿验证（调高阈值→4 用例 RED；清空 removeProps→用例1 RED）** —— 审查者无法实测复现命令，但静态推断成立：上述依赖分析显示各用例确实耦合对应分支。

### 3. 覆盖完整性 — 主分支全覆盖，1 边界分支遗漏（nit N-1）

slimSchema 分支清单 vs 测试覆盖：

| 行 | 分支 | 覆盖 |
|---|---|---|
| :194 | `!config return def` | ✓ 用例 5（scene） |
| :196 | `< SLIM_THRESHOLD_BYTES return def` | ✓ 用例 3 反向（ui 超阈值触发） |
| :205 | `!inputSchema?.properties return def` | ✗ 未覆盖（防御性，properties 必存在） |
| :216 | `if (removed.length === 0) return def` | ✗ **未覆盖**（nit N-1） |
| :218-222 | 真正 slim（删 prop + 追 hint） | ✓ 用例 1/2/4 |

**N-1（覆盖盲点）：`:216` `if (removed.length === 0) return def` 未覆盖。** 该分支语义为"配了 SLIM_CONFIG + 超阈值 + 有 properties，但 removeProps 与实际 properties 无交集"。当前 `SLIM_CONFIG.ui.removeProps` 与 ui 实际 props 完全匹配，故此分支在现有配置下为不可达防御码。可接受（防御性 dead path），但若追求分支覆盖率 100% 需构造 mock。非阻塞。

**常量硬编码同步风险（nit N-2）：** 测试 `:16` `const SLIM_THRESHOLD_BYTES = 8000` 是本地常量，**非 import**。核实 `module-loader.ts` —— `SLIM_THRESHOLD_BYTES`/`SLIM_CONFIG`/`slimSchema` **均未 export**（grep 无 `export` 前缀）。因此测试无法 import 真常量，只能硬编码。若实现侧改阈值（如 6000），测试用例 3 仍用旧值 8000，可能出现"实现阈值变了但测试仍绿"的漂移。当前阈值稳定（P2-11 刚定），风险低。建议后续 export 该常量供测试 import，或加注释明确同步义务。

### 4. 仓库级约束独立核查 — 未违反

- **`.claude/rules/godot-mcp-*.md` 与 `src/tools/rule-templates.ts` 独立副本同步**：本 commit 为纯测试新增，无规则改动。grep `.claude/rules/godot-mcp-ui.md` 仍含 `tree`/`ops` 参数文档，与本 commit 无关。✓
- **`docs/capability-matrix.{json,md}` 生成产物**：本 commit 无工具清单变更（仅加测试），无需重建。capability-matrix.json ui description 已含 descHint（P2-11 已同步）。✓
- **`build/` 编译产物**：本 commit 仅加 `test/` 文件，不动 `src/`。`build/core/module-loader.js` 仍为 P2-11 编译产物，未被本 commit 手改。✓
- **AGENTS.md「完成前强制检查」三件套**：**未能实测**（无 Bash 工具，无法跑 `npm run lint`/`npm run build`/`npm test`）。静态层面：新测试文件语法/模式（vitest describe/it/expect）与同目录 `module-loader-hints.test.ts`/`module-loader-tags.test.ts` 一致，TypeScript strict 应可通过。

### 5. TS-GD 一致性 — 跳过

本 commit 无 `.gd` 改动。✓

### 6. 验证完整性

- **commit message 声明「npm test 294 文件 4319 passed（+6）」**：静态数学一致 —— 新增 1 文件 6 用例（用例 1-5 + 路径隔离用例 6），4319 = 4313 + 6（与上一审查批文的 4313 baseline 衔接）。✓ 但**未能实测**复跑确认。
- **门禁命令类声明（lint 0 / build 0）**：**未能实测**，需有 Bash 的 agent 复跑。

---

## Blocking Issues

无。

---

## Nits（非阻塞）

**N-1（覆盖盲点）：`src/core/module-loader.ts:216` `if (removed.length === 0) return def` 边界分支未覆盖。**
- 语义：配了 SLIM_CONFIG + 超阈值 + 有 properties，但 removeProps 与实际 properties 无交集。
- 现状：当前配置下不可达（SLIM_CONFIG.ui.removeProps 与 ui 实际 props 完全匹配），属防御性 dead path。
- 建议（可选）：若追求 100% 分支覆盖，可加一个用例 mock 一个"配置了 removeProps 但 prop 不存在"的场景；或显式标注该分支为防御码不测。

**N-2（常量同步风险）：`test/core/module-loader-slim.test.ts:16` 硬编码 `SLIM_THRESHOLD_BYTES = 8000`，非 import。**
- 根因：`module-loader.ts` 未 export `SLIM_THRESHOLD_BYTES`/`SLIM_CONFIG`/`slimSchema`（grep 确认无 export 前缀）。
- 风险：若实现侧改阈值，测试用例 3 不随之更新 → 漂移。
- 建议（可选）：在 `module-loader.ts` export 该常量（`export const SLIM_THRESHOLD_BYTES = 8000`），测试 import 使用；或测试内加注释「与 module-loader.ts:170 同步，改一处须改两处」。

---

## 值得进 memory 的工程教训

- **测试覆盖「链路 pass」须从 registry 查询 API 取 def，而非直 import barrel**：本 commit 正是落实上一批文（`docs/reviews/2026-07-31-coverage-batch.md` memory）的教训 —— `registerAllModules` 链路加的 pass（injectTags/slimSchema）只有经 registry 查询才看得到，直 import barrel 读的是原始 def，slim 回归无捕获。`test/core/module-loader-slim.test.ts` 用例 6 还专门做了路径隔离断言（双取对照），可作为后续 module-loader pass 测试的范式。

- **未 export 的实现常量被测试硬编码 → 同步漂移风险**：`SLIM_THRESHOLD_BYTES` 未 export，测试只能硬编码 8000。这类「魔法数双写」在没有 import 约束时，仅靠注释维护同步义务，易漂移。教训：实现侧的关键阈值/配置若会被测试引用，应 export 而非保持模块私有，让 TypeScript 成为同步守卫。

---

## 相关文件（绝对路径）

- `D:\GitHub\godot-mcp-enhanced\test\core\module-loader-slim.test.ts`（审查对象，新增）
- `D:\GitHub\godot-mcp-enhanced\src\core\module-loader.ts:163-241`（slimSchema + SLIM_CONFIG + registerAllModules）
- `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts:39-70, 123-133`（registerModule 存储 + getToolDefinition 查询）
- `D:\GitHub\godot-mcp-enhanced\src\tools\ui\index.ts:19-205`（ui 原始 def，required:['action']）
- `D:\GitHub\godot-mcp-enhanced\test\ui-tools.test.js:3`（barrel 直 import，绕过 slim 的旧测试路径）
- `D:\GitHub\godot-mcp-enhanced\docs\reviews\2026-07-31-coverage-batch.md:114-115`（N-2 缺口原始记录）
- `D:\GitHub\godot-mcp-enhanced\docs\capability-matrix.json`（ui slim 后 descBytes 647 / schemaBytes 3560）
- `D:\GitHub\godot-mcp-enhanced\AGENTS.md`（完成前强制检查三件套，未能实测）

## 诚实声明

审查者无 Bash 工具，**未能实测**：`git show f31c95a --stat`（确认改动文件清单）、`npm run lint`、`npm run build`、`npm test`（294 文件 / 4319 passed / +6 数学一致但未复跑）。所有结论基于直接 read 源码 + grep committed 工作树内容。涉及命令执行的门禁类声明（lint 0 / build 0 / test pass 计数）由主 agent 复跑确认（见下）。

---

## 主 agent 门禁复跑确认（2026-07-31）

主 agent（有 Bash）已实测复跑三件套，补充审查者未能实测维度：

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误） | `npm run build` |
| Vitest | ✅ **294 文件 / 4319 用例 passed**（24 skipped，+6 用例 +1 文件） | `npm test` |
| 非假绿验证 | ✅ 调高阈值×10^6 → 4 用例 RED；清空 removeProps → 用例 1 RED；还原后 6/6 绿 | `npx vitest run test/core/module-loader-slim.test.ts` |

审查者所有静态推断与主 agent 实测结果一致，无出入。
