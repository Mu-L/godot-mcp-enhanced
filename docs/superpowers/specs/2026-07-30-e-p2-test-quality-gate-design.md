# E-P2 测试质量门禁设计（报告4 :98）

> 继承总 spec `docs/superpowers/specs/2026-07-29-审查修复批次设计.md` batch E（测试质量）。报告4 :98（P2 测试质量门禁）独立子批。:95/:97b/:99/:100 另起。

## Goal

新增 CI 测试质量门禁脚本，三检测器一次性守护测试套件自身可信度，防恶化：① 死文件（test/ 引用=0）② mock/src 导出 drift（mock 了 src 已删/改名的导出）③ 弱断言占比上限。建立后自动捕获未来：新增死代码、src 重构致 mock 脱节、弱断言增长。

## Architecture

一个 Node ESM 脚本 `scripts/check-test-quality.mjs`（对齐既有门禁先例 `build/scoring/check-gdscript.js` / `build/capability/diff-matrix.js`：独立 node 脚本 + exit 0/1 + package.json script + ci.yml step）。三个独立检测器，任一 fail 则脚本 exit 1。

## brainstorming 核实（驱动设计，非照抄报告4 旧数据）

- **死文件**：test/ 下非 `*.test.*` 文件共 6 个（helpers/ 3 + regression/ 2 + setup.js），node 脚本实测引用：`integration-setup.js` **0 引用（死）**、fixtures.js 7、tool-context.js 9、defects.ts 2、detect-helpers.ts 2、setup.js 0 code-refs 但 **1 config-ref**（vitest.config.ts:7 `setupFiles:['test/setup.js']`，靠配置引入非 import）。死文件检测器（含 config 引用查询）能立刻抓 integration-setup.js，且不误判 setup.js。
- **drift 信号**：全仓 **123 处 src vi.mock**（去重 35 个 src 模块）。用**括号深度解析器**提取工厂对象顶层 key（非扁平正则——扁平正则会把 mock 返回值的嵌套字段 success/errors/outputs 误判为 drift，实测 37 处全误报），经 `export *` 递归追溯拿到 src 真实导出集，**当前 0 真 drift**。证据：gdscript-executor.ts 的 executeGdscript/scanGdscriptSandbox ∈ exports；logger mock 顶层只有 `getLogger`（info/debug 是其返回值嵌套字段，depth≥2 被自然忽略）；shared.ts 纯 `export *` 经追溯暴露 opsSuccess/COMMON_ERROR_CODES 等。脚本守护未来 src 删/改名致顶层 mock key 脱节（测试调 mock 值假绿）。
- **弱断言**：粗 grep `(\.toBeTruthy\(\)|\.toBeDefined\(\)|\.not\.toBeNull\(\))` 于 test/**/*.test.{ts,js}，实测 **1347**（.test.js 贡献 1163 = 980+110+73；.test.ts 贡献 184 = 39+84+61）。toBeTruthy 占多数。粗 grep 会含合理用法（result 存在检查）——**接受**，作"防恶化上限"非"消除目标"。

## 三检测器设计

### 检测器 1：死文件
- 扫 `test/**/*.{js,ts}`，排除 `*.test.*`（测试入口，由 vitest 跑，不查引用）。
- 对每个文件 basename（去 ext），查两类引用：
  1. **代码引用**：grep 其在所有 `test/`+`src/`+`scripts/` 文件的 import/require（`from ['"].*<basename>(\.js|\.ts)?['"]` 或 `require\(['"].*<basename>`）。
  2. **配置引用**：查 `vitest.config.ts`/`package.json`/`tsconfig.json` 是否含 basename（覆盖 `setupFiles`/glob 等非 import 引入方式，防 setup.js 误判）。
- **0 引用（代码 + 配置都 0）→ fail**（列出文件）。0 容忍。
- 已验：integration-setup.js 会被抓（code 0 + config 0）；setup.js 正确判 live（code 0 + config 1）。

### 检测器 2：mock/src 导出 drift（括号深度解析器）

⚠️ **不可用扁平正则**提取工厂 key。扁平 `([a-zA-Z_][a-zA-Z0-9_]*):` 会把 mock 返回值对象的嵌套字段误判为 drift（实测 37 处全误报）。必须做括号深度配对。

- **步骤 1 — 括号配对提取完整调用块**：从每个 `vi.mock(` 起，逐字符扫描计 `(`/`)` 深度（跳过字符串/模板字面量里的括号），到深度归零取出完整 `vi.mock(...)` 块。只保留 `<path>` 匹配 `[.]+/src/` 的（跳过 node 内建模块 fs/child_process/net 等的 mock）。
- **步骤 2 — 提取工厂对象顶层 key**：定位块内 `=>` 后第一个 `{`（工厂对象起始），进入后计深度。**只在 depth=1（工厂对象顶层）**识别 `标识符 + :` 模式作 key；depth≥2 的（如 `getLogger: () => ({ info: ... })` 里的 `info`）是返回值嵌套字段，自然忽略。排除关键字（if/for/return/true/false/null/case 等）。
- **步骤 3 — 溯源 src 导出集**：解析 `<path>` → `src/<name>.ts`，提取导出：
  - `^export (async )?(function|const|class|let|var) NAME`
  - `^export { a, b as c }` named re-export（取 as 前原名）
  - **`^export * from './x.js'` 递归追溯**（seen 集合防环）——关键，处理 `src/tools/shared.ts` 这类纯 re-export 文件（自身无 export，全部经 `export *` 从 shared/*.ts 聚合暴露 opsSuccess/COMMON_ERROR_CODES 等）。
- **drift = 顶层 mock key ∉ src 导出集**（mock 了 src 已删/改名的导出）→ fail（列出 mock key + src 文件）。0 容忍。
- **不抓**：src 新增导出 mock 未含（vi.mock 全替换，新导出 = undefined，测试调用会报错，非静默——非 drift 问题）；参数级签名 drift（需 TS 类型解析，超 :98 范畴，属 :97b）。
- 当前：123 处 src mock，顶层 key 全 ∈ src exports（含 export* 追溯），**0 drift**，脚本 exit 0。

### 检测器 3：弱断言占比上限（防恶化）
- grep `toBeTruthy|toBeDefined|not\.toBeNull`（test/**/*.test.*，粗 grep）。
- count > **上限 1400**（基线 2026-07-30 实测 1347 + 容差 53 ≈ 4%）→ fail（报 count + 上限）。
- **阈值策略：基线+容差防恶化**，不强制消除、不递减。接受粗 grep 含合理用法——捕获"增长趋势"即够。改善后下调上限（注释说明）。
- 精确"假绿"模式（includes 恒真 / length>0 不辨 isError / indexOf 命中定义）属 :97b 范畴，本脚本不深入。

## 集成

- `package.json` scripts 加 `"check:test-quality": "node scripts/check-test-quality.mjs"`（与 `check:gdscript` / `check:budget` 同列）。
- `.github/workflows/ci.yml` check job 加一步 `npm run check:test-quality`（对齐既有 `Check capability matrix drift` + check:gdscript step 位置，在 vitest 前）。
- 不进 `pretest`（质量门禁是 CI/显式跑，不该拖慢每次 `npm test`；开发者按需 `npm run check:test-quality`）。

## 顺带（死文件检测会抓的即时清理）

- 删 `test/helpers/integration-setup.js`（检测器 1 开发过程会抓到；plan 里作为首个 RED 验证 + 清理 commit）。

## Global Constraints（继承总 spec）

- 工作仓库 `D:\GitHub\godot-mcp-enhanced`；master 本地 commit 不 push。
- 脚本 Node ESM（`.mjs`，对齐 `scripts/check-token-budget.mjs`）；精确编辑匹配既有门禁脚本风格。
- TDD：先让脚本在当前代码上跑出预期（死文件抓 integration-setup / drift 0(括号深度解析 123 src mock) / 弱断言 ≤1400）→ 删 integration-setup 后死文件 0 → 集成 package.json + ci.yml。
- 核实驱动：阈值/基线全实测（[[plan-baseline-verify-grep]][[verify-implementation-by-source]]）。

## Defer 清单

- :97b 23 vi.mock 补 failure 变体（本批检测器2 抓"顶层导出名脱节"，:97b 抓"happy-path 绕过失败处理"及参数级签名 drift，互补，:97b 另起）
- :99 弱断言精确化（本脚本粗 grep 防恶化，精确"假绿"模式属 :97b/:99）
- :100 mutation testing（排期）
- :95 路径测试 env 隔离四件套（另起）

## 验收

- 脚本 `npm run check:test-quality` 在删 integration-setup 后 exit 0（死文件 0 / drift 0(123 src mock 全 pass) / 弱断言 1347≤1400）。
- `tsc` 0 / `eslint` 0（脚本在 scripts/，eslint src/ 不含，但脚本自身须 node 可跑）/ `vitest` 全绿。
- 故意制造 drift（临时改一个 mock key 为 src 不存在的）验证检测器 2 fail；故意加死文件验证检测器 1 fail；故意加弱断言超 1400 验证检测器 3 fail（本地一次性验证，不 commit）。
- ci.yml check job 含新 step（本地无法跑 CI，审查 step 接线正确）。
- final review opus（整支）。
- 项目待办.md 报告4 :98 回标。
- master 本地不 push。

## Self-Review

- **Spec 覆盖**：三检测器 + 集成 + 顺带清理全设计；defer 项明列。无遗漏。
- **占位符**：每检测器有精确实现（正则/路径解析/阈值 1400）。无 TBD。
- **一致性**：drift 定义（顶层 mock key ∉ src exports，括号深度解析）与核实段（123 src mock、0 真 drift）一致；检测器1 含 config 引用查询与核实段（setup.js config-ref=1 判 live）一致；弱断言上限 1400 与基线 1347（.test.js 1163 + .test.ts 184）一致。
- **范围**：单一脚本三检测器，一个 plan 可覆盖。死文件顺带清理 integration-setup 作为 TDD RED 验证，合理纳入。
- **边界**：明确不抓参数级签名 drift（:97b）+ 精确假绿模式（:97b/:99），避免 scope 蔓延。
