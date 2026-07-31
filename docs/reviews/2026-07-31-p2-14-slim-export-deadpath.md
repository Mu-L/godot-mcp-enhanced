# 第三方审查：P2-14 export slim 符号 + dead path 测试

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查对象：`ea3c39b refactor(core): P2-14 export slim 符号消除硬编码 + 补 :216 dead path 测试`
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 总体判定

**SHIPPED**

commit `ea3c39b` 的两项声明经静态实测均成立：N-2 漂移风险（硬编码常量）通过 export + import 真常量消除；N-1 dead path（`:216`）通过构造 fake def 直接调 `slimSchema` 真覆盖，断言具体非假绿，作者声明的非假绿验证静态推断成立。无 Blocking，无值得修的 nit。export 改动最小（仅加 `export` 关键字，未改语义），未引入意外耦合（grep 全仓确认消费者只有实现 + 测试 + build/.d.ts）。

---

## 逐维度结论（带 file:line 证据）

### 1. 设计正确性（export 改动）— 成立

**三个符号真加了 export，且未破坏 registerAllModules 链路。**
- `src/core/module-loader.ts:170` `export const SLIM_THRESHOLD_BYTES = 8000` ✓
- `src/core/module-loader.ts:172` `export const SLIM_CONFIG: Record<...>` ✓
- `src/core/module-loader.ts:191` `export function slimSchema(defs: Tool[]): Tool[]` ✓
- `registerAllModules`（:229-241）链路未动：:237 仍是 `() => slimSchema(injectTags(originalGetDefs.call(mod)))`，slimSchema 作为内部函数被包装调用，export 不改变调用语义 ✓

**export 未引入意外耦合。** grep 全仓 `SLIM_THRESHOLD_BYTES`/`SLIM_CONFIG`/`slimSchema`（限定 `.ts`）：
- `SLIM_THRESHOLD_BYTES`：src 定义(:170) + 内部用(:196) + test import(:11)/断言(:40,46,47,99,100) + build/.d.ts(:9) —— 无其他消费者 ✓
- `SLIM_CONFIG`：src 定义(:172) + 内部用(:193) + test 注释/用例 + build/.d.ts —— 无其他消费者 ✓
- `slimSchema`：src 定义(:191) + 包装(:237) + test import/调用(:11,113) + build/.d.ts —— 无其他消费者 ✓

三个符号的消费者恰好是「实现内部 + 测试 + build 声明」，export 是为测试 import 服务的最小必要暴露，无意外耦合。

### 2. N-2 漂移消除（测试改 import）— 成立

**硬编码常量真删除，改为 import 真常量。**
- 旧版（P2-12 审查 `docs/reviews/2026-07-31-slim-schema-test.md:93` 记录）`const SLIM_THRESHOLD_BYTES = 8000` 是本地常量。
- 新版 `test/core/module-loader-slim.test.ts:11` `import { registerAllModules, slimSchema, SLIM_THRESHOLD_BYTES } from '../../src/core/module-loader.js'` —— 真 import 实现侧常量 ✓
- grep `test/` 下 `const SLIM_THRESHOLD_BYTES` / `SLIM_THRESHOLD_BYTES = 8000` 均 0 命中，本地硬编码真删除 ✓
- import 指向实现侧常量（非另建本地常量）：`:11` 的 import 源是 `module-loader.js`，即 `module-loader.ts:170` 的真常量 ✓

**若实现改阈值，测试随之更新。** 用例 3（:40-48）`schemaBytes < SLIM_THRESHOLD_BYTES` 现用的是 import 的真常量；dead path 用例（:100）`'x'.repeat(SLIM_THRESHOLD_BYTES)` 也用 import 的真常量。实现侧 `module-loader.ts:170` 改阈值（如 6000），两处自动跟随，漂移风险消除 ✓

### 3. N-1 dead path 测试质量（防假绿）— 成立

**fakeDef 真能触发 :216，三条件逐条满足：**
- (a) `name: 'ui'`（:102）命中 `SLIM_CONFIG['ui']`（module-loader.ts:172-185）→ `config` 非空，过 :194 `!config` ✓
- (b) `padding = 'x'.repeat(SLIM_THRESHOLD_BYTES)`（:100）= 8000 字符，作为 `someUnrelatedProp.description`（:108）。stringify 后该 description 值占 8000 字节，加 JSON 封装（`"description":"` + `","type":"string"`）+ action 字段 + 顶层结构，总字节远 > 8000 → 过 :196 `< SLIM_THRESHOLD_BYTES` ✓
- (c) `properties = { action, someUnrelatedProp }`（:106-109）。`removeProps`（module-loader.ts:178-182）含 `theme_action/theme_path/params/theme_create_action/source_node_path/save_path/theme_node_path/item_type/prop_name/theme_type/value/tree/ops`，`action` 与 `someUnrelatedProp` 均不在其中 → `removed = []` → 命中 :216 `if (removed.length === 0) return def` ✓

**断言具体，真能区分 :216 与 :218。**
- `description.toBe('fake')`（:116）：:216 原样返回 def，description 不追加 descHint，保持 'fake'。若误走 :218，description = 'fake' + descHint → `toBe('fake')` 失败 → RED ✓
- `properties.toEqual(['action', 'someUnrelatedProp'])`（:120）：:216 不删 prop，保持原样。若走 :218 会构造 newProperties → 不一致 → RED ✓

**作者声明的非假绿验证静态推断成立。** 把 `someUnrelatedProp` 改名 `theme_action`：`theme_action` 在 removeProps（module-loader.ts:179）→ `removed = ['theme_action']` → `removed.length === 1` → 跳过 :216 → 走 :218-222 → `description = 'fake' + descHint` → :116 `toBe('fake')` 失败 → RED。作者声明静态可复现 ✓

**padding 字节数静态推断。** SLIM_THRESHOLD_BYTES=8000，padding 8000 个 'x'。stringify 后仅 description 字符串值就 8000 字节，加 `"description":"` 前缀(14B) + `","type":"string"` 等封装 + action prop + 顶层 `{...}` → 总 > 8000。过阈值判断成立。略贴边（不是数量级裕度），但因 JSON 封装必然多几十字节，安全。可接受。

### 4. 仓库级约束独立核查 — 未违反

- **export 改动文件范围**：仅 `src/core/module-loader.ts`（加 3 个 `export`）+ `test/core/module-loader-slim.test.ts`（改 import + 加 dead path describe）。grep 无其他 src 文件改动迹象 ✓
- **build/ 编译产物同步**：`build/core/module-loader.d.ts:9-18` 已含三个 export 声明（`export declare const SLIM_THRESHOLD_BYTES = 8000` / `export declare const SLIM_CONFIG` / `export declare function slimSchema`），说明 `npm run build` 已跑过、产物同步 ✓（注：仅核对 `.d.ts`，`.js` 产物未逐行核对，但 `.d.ts` 是 `.ts` 编译产物，足以证明 export 进了编译输出）
- **capability-matrix 同步**：本 commit 无工具清单变更（纯 export + 测试），无需 `npm run build-matrix` ✓
- **rule-templates / .claude/rules 同步**：本 commit 无规则改动，未触发独立副本同步约束 ✓
- **AGENTS.md「完成前强制检查」三件套（lint/build/test）**：**未能实测**（无 Bash 工具）。静态层面：export 改动是 TS 合法语法，不引入类型错误；测试文件模式与同目录 `module-loader-hints.test.ts`/`module-loader-tags.test.ts` 一致。

### 5. TS-GD 一致性 — 跳过

本 commit 无 `.gd` 改动 ✓

### 6. 验证完整性

- **commit message 声明「npm test 294 文件 4320 passed（+1 dead path）」**：静态数学一致 —— P2-12 baseline 4319（见 `docs/reviews/2026-07-31-slim-schema-test.md:133` 主 agent 复跑确认）+ 1 新用例 = 4320 ✓ 但**未能实测**复跑
- **非假绿验证声明**：静态推断成立（见维度 3），**未能实测**复跑
- **lint 0 / build 0**：**未能实测**，需有 Bash 的 agent 复跑

---

## Blocking Issues

无。

---

## Nits

无值得修的 nit。

唯一可观察的轻微点（非 nit，仅记录）：dead path 用例的 padding `'x'.repeat(SLIM_THRESHOLD_BYTES)` 刚好等于阈值而非显著超出，靠 JSON 封装的几十字节余量过 `< SLIM_THRESHOLD_BYTES` 判断。语义正确但裕度小。若未来有人把 padding 改成 `'x'.repeat(SLIM_THRESHOLD_BYTES - 100)` 之类会更稳，但当前实现已足够（余量来自 JSON 封装必然存在），不构成需修项。

---

## 值得进 memory 的工程教训

- **「实现侧常量被测试引用时应 export 而非硬编码」教训已闭环**：P2-12 审查（`docs/reviews/2026-07-31-slim-schema-test.md:104`）登记的「未 export 的实现常量被测试硬编码 → 同步漂移风险，仅靠注释维护同步义务」教训，P2-14 通过 export 三符号 + import 真常量闭环。TypeScript 的 import 绑定成为同步守卫，实现侧改阈值测试自动跟随。该模式可作为后续「测试需引用实现侧魔法数」的标准做法：能 export 就别硬编码。

- **「防御性 dead path 的测试构造范式」**：`:216` 这类「当前配置下不可达但语义合法」的防御码，用 fake def 直接调被测函数（绕过 registerAllModules 整条链）构造触发条件，是低成本覆盖 dead path 的范式。关键在构造同时满足「前序条件全过 + 目标分支条件命中」的输入（本案：name 命中 SLIM_CONFIG + padding 超阈值 + properties 与 removeProps 无交集），并断言能区分目标分支与相邻分支（本案：`description.toBe('fake')` 区分 :216 原样返回 vs :218 追加 hint）。

---

## 相关文件（绝对路径）

- `D:\GitHub\godot-mcp-enhanced\src\core\module-loader.ts:170,172,191,216,229-241`（export 改动 + dead path 目标 + registerAllModules 链路）
- `D:\GitHub\godot-mcp-enhanced\test\core\module-loader-slim.test.ts:11,93-122`（import 真常量 + dead path 测试）
- `D:\GitHub\godot-mcp-enhanced\build\core\module-loader.d.ts:9-18`（编译产物已含 export，证明 build 同步）
- `D:\GitHub\godot-mcp-enhanced\docs\reviews\2026-07-31-slim-schema-test.md:55,58,88-96`（N-1 dead path + N-2 硬编码常量原始记录，本案闭环对象）

## 诚实声明

审查者无 Bash 工具，**未能实测**：`git show ea3c39b --stat`（确认改动文件清单）、`git show ea3c39b`（确认 diff 内容）、`npm run lint`、`npm run build`、`npm test`（294 文件 / 4320 passed）、非假绿验证复跑。所有结论基于直接 read 已 commit 的工作树源码 + grep 静态分析 + 上一轮审查（`docs/reviews/2026-07-31-slim-schema-test.md`）的主 agent 复跑 baseline 衔接。落盘由主 agent 代为执行。

---

## 主 agent 门禁复跑确认（2026-07-31）

主 agent（有 Bash）已实测复跑三件套，补充审查者未能实测维度：

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误，build/ 同步含 export） | `npm run build` |
| Vitest | ✅ **294 文件 / 4320 用例 passed**（24 skipped，+1 dead path 用例） | `npm test` |
| 非假绿验证 | ✅ fakeDef prop 改名 theme_action（命中 removeProps）→ dead path 用例 `toBe('fake')` 转 RED；还原后 7/7 绿 | `npx vitest run test/core/module-loader-slim.test.ts` |

审查者所有静态推断与主 agent 实测结果一致，无出入。
