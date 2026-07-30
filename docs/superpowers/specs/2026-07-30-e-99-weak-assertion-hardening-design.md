# E-99 弱断言精确化 设计（报告4 P2-7）

> **状态**：待审
> **日期**：2026-07-30
> **范围**：`test/**/*.test.{js,ts}` 弱断言精确化（机械转换 + 鉴权语义强化）
> **基线方法**：括号/引言感知解析器 + 严格 receiver 正向白名单，与 `check-test-quality.mjs` gate 运行结果（1349）四方交叉自洽

---

## 一、背景与动机

`scripts/check-test-quality.mjs` 检测器③对弱断言（`toBeTruthy`/`toBeDefined`/`not.toBeNull`）设「防恶化上限 1400」，注释 `:207` 记基线 1347。门禁是**防恶化**非**消除目标**，但弱断言是假绿高发区（:100 G7b/G8、P1-10 UNKNOWN_ACTION 假绿均源于 `expect(...).toBeTruthy()` 类松散断言未绑定真实行为）。

本批（报告4 P2-7）目标：在「不破坏行为」前提下，把**可机械等价转换**的弱断言升级为诊断更好的惯用形式（`toContain`），并对**鉴权/安全维度**的语义弱断言做真反假绿强化（delete-red 验证）。同时把过时的基线注释与上限对齐到实测。

## 二、基线（四方交叉验证定稿）

检测器③ gate 运行 = **1349**（注释 `:207` 写 1347，旧值，差 2，本批对齐）。toBeTruthy 1021 / toBeDefined 194 / not.toBeNull 134。

**toBeTruthy(1021) 细分**（严格 receiver 正则 `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$` 判定）：

| 子类 | 数 | 样本 | 处置 |
|---|---|---|---|
| safe `RECV.includes(LIT)` | **576** | `expect(script.includes('ClassDB.instantiate("Button")')).toBeTruthy()` | **Stream A 转 toContain** |
| `!RECV.includes(LIT)` | 3 | `test/tool-registry.test.js:45,57`、`test/gdscript-lint.test.js:105` | 跳过（negation 批，应 →`.not.toContain`）|
| `!bool` | 74 | `expect(!result.hasErrors).toBeTruthy()` | 跳过（negation 批）|
| compound `\|\|` / nested `.some(.includes)` | 8 | `test/instance-scene.test.js:45,97,123,158`（`a.includes(x)\|\|b.includes(y)`） | 跳过（转了丢 `\|\|` 另一支）|
| plain result/bool | 360 | `expect(result).toBeTruthy()` | **不在本批**（工具结果维度，后续批）|

**其他**：`toBe(true)` safe includes = **45**（gate 中性，`toBe(true)` 不在 gate 口径）；toBeDefined 194、not.toBeNull 134（合法存在性检查居多，不在本批机械转换）。

> **验证历程**：初版启发式分类器（贪婪正则）报 includes-truthy=587、漏 toBe(true)；独立第二解析器（非贪婪）报 583（含 4 条复合布尔）；严格 receiver 正向白名单收敛到 **576**（排除 3 条 `!includes` 误归类 + 4 条复合布尔 + 嵌套）。分歧样本均定位到具体行，且分歧本身即 codemod 守卫的需求来源。

## 三、范围

### 做
- **Stream A（机械转换，降 gate 弱计数 576）**：safe includes-truthy → `toContain`，全 576 条（无任意截断，含长尾小文件）。
- **Stream A 卫生转换（gate 中性 45）**：safe includes-`toBe(true)` → `toContain`（诊断升级，gate 计数不变；同一 codemod 顺手做）。
- **Stream B（鉴权/安全语义强化，~30 条）**：见 §五。
- **门禁对齐**：`check-test-quality.mjs` 上限 1400 → ~780；注释 `:207` 基线对齐到新实测。
- **CHANGELOG**：`### Fixed — Test Quality` 段（对齐 :101 惯例）。

### 不做（留后续批）
- negation 77 条（74 bool + 3 includes）。
- compound/nested includes 8 条。
- plain toBeTruthy 工具结果维度 360 条（最大头，非鉴权，单独批）。
- toBeDefined 194 / not.toBeNull 134 的合法存在性检查。

## 四、Stream A — 机械转换（codemod 辅助）

576 条靠手工 Edit 不可行（`test/ui-tools.test.js` 单文件 213 条、字面量各异，`replace_all` 不适用）。用一次性 codemod 脚本（不入仓，其「测试」= diff 审查 + 全量 suite 绿 + gate 跌数核对）。

### 4.1 转换规则
- `expect(RECV.includes(LIT)).toBeTruthy()` → `expect(RECV).toContain(LIT)`
- `expect(RECV.includes(LIT)).toBe(true)` → `expect(RECV).toContain(LIT)`
- 保留原行缩进、末尾 `;`、行尾注释。LIT 原样回填（括号/引言感知提取，因其常含 `)` 与嵌套引号，如 `'node.set("text", "Click Me")'`）。

### 4.2 守卫（spec 写死，正向白名单）
仅当同时满足才转换：
1. expect-arg 整体匹配 `^<RECV>\.includes\(<LIT>\)$`；
2. **RECV 匹配** `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$`（标识符链 + `.成员` + `[下标]`，拒 `!`/`(`/`=>`/`||`/`&&`/空格）；
3. matcher ∈ {`.toBeTruthy()`, `.toBe(true)`}。

此正向白名单一次拦住：复合布尔（4）、嵌套 `.some`（4）、反转 `!includes`（3）——共 11 条不转。**不依赖黑名单子句**（黑名单漏 `!` 前缀会让 `!ro.includes(...)` 转坏）。

### 4.3 验证
- **全量 `npm test` 绿**：行为等价的铁证（任何错转会让对应测试红）。
- **gate 复核**：转换后期望 `1349 − 576 = 773 ± 5`（45 条 toBe(true) 转换 gate 中性，不计入跌数）。
- **diff 抽查**：确认每条转换接收方确为字符串变量（`toContain` 对字符串=子串、对数组=成员；此处接收方均为字符串文本）。

## 五、Stream B — 鉴权/安全语义强化（手工 + delete-red）

### 5.1 文件集（triage 后只转「松散结果检查应绑定具体值」的，预计 ~30 条）
`test/guard.test.js`、`test/game-bridge.test.{js,ts}`、`test/game-bridge-monitor.test.js`、`test/game-bridge-ui-discover.test.js`、`test/game-bridge-signal-watch.test.js`、`test/editor-connection.test.js`、`test/editor-auth.test.js`、`test/core/instance-api-auth.test.ts`、`test/security-path-traversal-task2.test.ts`、`test/readonly-guard.test.js`。

### 5.2 方法
逐条读工具实际返回 → 绑定具体值（`toBe('specific')` / `toMatch(/pattern/)` / `toContain('msg')`）。合法「存在性检查」（如 `expect(def).toBeDefined()` 验证工具注册）保留。

### 5.3 验证（delete-red，:100 教训，不可省）
每条强化后，临时破坏底层行为（改返回值/短路 guard），确认**新断言变红**（证明绑定真实行为，非假强化）；还原后全量绿。鉴权维度是假绿高发区，此验证是本 stream 的核心交付。

## 六、验收标准

| 项 | 标准 |
|---|---|
| Stream A 后 gate 弱计数 | 773 ± 5（1349 − 576）|
| Stream B 后 gate 弱计数 | ~743（再 − ~30）|
| 全量 `npm test` | 4279 passed 基线（Stream A 行为等价，不增不减）|
| Stream B delete-red | 每条强化经「破坏→红→还原→绿」双向证 |
| 门禁上限 | `WEAK_ASSERTION_LIMIT` 1400 → 据实下调（~780），注释 `:207` 基线对齐 |
| tsc / eslint | 0 |

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| codemod 误转（复合/嵌套/反转）| 正向白名单守卫（§4.2）+ 全量 suite 绿兜底 |
| LITERAL 提取破括号/引号 | 括号/引言感知提取（复用解析器 matchArg 逻辑）|
| Stream B 过度收紧致假红 | 从实际返回推 expected，不臆测；delete-red 双向证 |
| codemod 脚本正确性 | 一次性脚本，验证 = diff 审查 + suite 绿 + 跌数核对（三重）|

## 八、提交策略
建议 3 提交：① Stream A 机械转换（codemod 产物，suite 绿）；② Stream B 鉴权语义强化（delete-red 验证）；③ 门禁上限 + 注释基线 + CHANGELOG。inline on master（本项目惯例，不 push）。

## 九、KB 交付
项目待办:99 ✅ + 开发日志（含四方交叉验证历程，沉淀为反假绿方法论）。
