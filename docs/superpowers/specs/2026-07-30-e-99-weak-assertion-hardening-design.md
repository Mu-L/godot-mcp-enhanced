# E-99 弱断言精确化 设计（报告4 P2-7）

> **状态**：待审（v3，吸收审查 BLOCKING 守卫漏洞 + 排除构成更正）
> **日期**：2026-07-30
> **范围**：`test/**/*.test.{js,ts}` 弱断言精确化（机械转换 + 鉴权语义强化）
> **基线方法**：括号/引言感知解析器 + 严格 receiver 正向白名单，与 `check-test-quality.mjs` gate 运行结果（1349）四方交叉自洽

---

## 一、背景与动机

`scripts/check-test-quality.mjs` 检测器③对弱断言（`toBeTruthy`/`toBeDefined`/`not.toBeNull`）设「防恶化上限 1400」，注释 `:207` 记基线 1347。门禁是**防恶化**非**消除目标**，但弱断言是假绿高发区（:100 G7b/G8、P1-10 UNKNOWN_ACTION 假绿均源于 `expect(...).toBeTruthy()` 类松散断言未绑定真实行为）。

本批（报告4 P2-7）目标：在「不破坏行为」前提下，把**可机械等价转换**的弱断言升级为诊断更好的惯用形式（`toContain`），并对**鉴权/安全维度**的语义弱断言做真反假绿强化（delete-red 验证）。同时把过时的基线注释与上限对齐到实测。

## 二、基线（四方交叉验证定稿）

检测器③ gate 运行 = **1349**（注释 `:207` 写 1347，旧值，差 2，本批对齐）。toBeTruthy 1021 / toBeDefined 194 / not.toBeNull 134。

**toBeTruthy(1021) 细分**（贪婪切分 + 严格 receiver 白名单 `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$` 判定）：

| 子类 | 数 | 样本 | 处置 |
|---|---|---|---|
| safe `RECV.includes(LIT)` | **576** | `expect(script.includes('ClassDB.instantiate("Button")')).toBeTruthy()` | **Stream A 转 toContain** |
| `!RECV.includes(LIT)` | 3 | `test/tool-registry.test.js:45,57`、`test/gdscript-lint.test.js:105` | 跳过（negation 批，应 →`.not.toContain`）|
| `!bool` | 74 | `expect(!result.hasErrors).toBeTruthy()` | 跳过（negation 批）|
| 复合 `\|\|` / 函数调用 receiver | 8 | 4 条 instance-scene 复合布尔（`:45,97,123,158`，`a.includes(x)\|\|b.includes(y)`）+ 4 条 code-templates 函数调用（`:102,106,127,131`，`tpl.generate({}).includes(...)`）| 跳过（复合转了丢 `\|\|` 另一支；函数调用 receiver 非标识符链）|
| plain result/bool | 360 | `expect(result).toBeTruthy()`（含 2 条尾部非 `)` 的伪复合，anchored 匹配天然排除）| **不在本批**（工具结果维度，后续批）|

**其他**：`toBe(true)` safe includes = **45**（gate 中性，`toBe(true)` 不在 gate 口径）；toBeDefined 194、not.toBeNull 134（合法存在性检查居多，不在本批机械转换）。

> **注**：576 为**全仓**计数，已含 `test/readonly-guard.test.js:26`（`result.message.includes('read-only')`）。故该条归 Stream A（codemod 自动转）、不入 B，A 计数不另加（非 577）。
>
> **验证历程**：初版启发式分类器（贪婪正则）报 includes-truthy=587、漏 toBe(true)；独立第二解析器（非贪婪）报 583（含 4 条复合布尔）；严格 receiver 正向白名单收敛到 **576**。排除构成实测为：**4 条 instance-scene 复合布尔 `||` + 4 条 code-templates 函数调用 `tpl.generate({})` + 3 条 negation `!x`**（无 `.some` 形态——前版「嵌套 `.some`」系误述）。分歧样本均定位到具体行，且分歧本身即 codemod 守卫的需求来源。

## 三、范围

### 做
- **Stream A（机械转换，降 gate 弱计数 576）**：safe includes-truthy → `toContain`，全 576 条（无任意截断，含长尾小文件，含 readonly-guard:26）。
- **Stream A 卫生转换（gate 中性 45）**：safe includes-`toBe(true)` → `toContain`（诊断升级，gate 计数不变；同一 codemod 顺手做）。
- **Stream B（鉴权/安全语义强化，~12-14 条）**：见 §五。
- **门禁对齐**：`check-test-quality.mjs` 上限 1400 → ~800；注释 `:207` 基线对齐到新实测。
- **CHANGELOG**：`### Fixed — Test Quality` 段（对齐 :101 惯例）。

### 不做（留后续批）
- negation 77 条（74 bool + 3 includes）。
- 复合 `||` / 函数调用 receiver includes 8+ 条。
- plain toBeTruthy 工具结果维度 360 条（最大头，非鉴权，单独批）。
- toBeDefined 194 / not.toBeNull 134 的合法存在性检查。

## 四、Stream A — 机械转换（codemod 辅助）

576 条靠手工 Edit 不可行（`test/ui-tools.test.js` 单文件 213 条、字面量各异，`replace_all` 不适用）。用一次性 codemod 脚本（不入仓，其「测试」= diff 审查 + 全量 suite 绿 + gate 跌数核对）。

### 4.1 转换规则
- `expect(RECV.includes(LIT)).toBeTruthy()` → `expect(RECV).toContain(LIT)`
- `expect(RECV.includes(LIT)).toBe(true)` → `expect(RECV).toContain(LIT)`
- 保留原行缩进、末尾 `;`、行尾注释。LIT 原样回填（括号/引言感知提取，因其常含 `)` 与嵌套引号，如 `'node.set("text", "Click Me")'`）。

### 4.2 守卫（spec 写死，正向白名单 + 显式贪婪切分）

仅当同时满足才转换：

1. **expect-arg 用贪婪正则切分**：arg（trim 后）必须整体匹配 `^([\s\S]*)\.includes\(([\s\S]*)\)$`，RECV=组1、LIT=组2。**必须贪婪**（`[\s\S]*`）——非贪婪 `(.*?)` 会把 `a.includes(x) || b.includes(y)` 的 RECV 误切成 `a`（合法标识符链），使复合布尔通过白名单被错转、丢 `||` 另一支（行为破坏）。实测：贪婪切 safe=576，非贪婪切 safe=580（多出的 4 条即 instance-scene 复合布尔误纳）。anchored `^...$` 同时排除尾部非 `)` 的伪复合。
2. **RECV（组1 trim）匹配白名单** `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$`（标识符链 + `.成员` + `[下标]`，拒 `!`/`(`/`=>`/`||`/`&&`/空格）。此条排除：复合布尔（RECV 含 `||`）、函数调用 receiver（`tpl.generate({})` 含 `(`）、negation（`!ro` 含 `!`）。
3. matcher ∈ {`.toBeTruthy()`, `.toBe(true)`}。

> **守卫不依赖黑名单子句**：用「RECV 必须是纯标识符链」这一正向条件，一次拦住复合/函数调用/反转三类，比 `/\(|=>|\|\||&&/` 黑名单多 cover `!` 前缀（黑名单漏 `!` 会让 `!ro.includes(...)` 转坏）。

### 4.3 验证
- **全量 `npm test` 绿**：行为等价的铁证（任何错转会让对应测试红）。
- **gate 复核**：转换后期望 `1349 − 576 = 773 ± 5`（45 条 toBe(true) 转换 gate 中性，不计入跌数）。**若实测跌到 580 区间（769）= 守卫用了非贪婪切，必查**。
- **diff 抽查**：确认每条转换接收方确为字符串变量（`toContain` 对字符串=子串、对数组=成员；此处接收方均为字符串文本）；确认 instance-scene:45/97/123/158、code-templates:102/106/127/131 等**未被转换**（守卫排除集）。

## 五、Stream B — 鉴权/安全语义强化（手工 + delete-red）

### 5.1 文件集与实测分布（B 集弱断言合计 55，经括号感知实测）
55 条分布：**safe includes-truthy 1**（readonly-guard:26，归 A，不入 B）、**plain toBeTruthy 16**（强化池，但含 editor-connection:79/81 两条嵌套 `.some` 需排除）、**toBeDefined 31 + not.toBeNull 7**（多为合法存在性，保留）。

**B 真正强化目标 ≈ 12-14 条**（16 plainTruthy − 2 嵌套 `.some` − triage 排除的合法存在性）。实际目标文件：
- `test/guard.test.js`（plainTruthy 5）
- `test/game-bridge.test.js`（plainTruthy 7）
- `test/game-bridge.test.ts`（plainTruthy 2）

其余文件弱断言均为 `toBeDefined`/`not.toBeNull` 合法存在性，**不入 B**：
- monitor(10)/ui-discover(9)/signal-watch(7) = 26 条 `toBeDefined`（验证工具注册/返回结构）
- editor-auth(1)/instance-api-auth(1)/security-path-traversal(2) = 4 条 `toBeDefined`
- game-bridge.test.ts 的 6 条 `not.toBeNull`（result 非空前置）
- **`editor-connection.test.js`**：仅 2 条嵌套 `.some(m=>m.method===...)`，排除后 0 条，**整文件移出 B**。

### 5.2 方法 + triage 分流规则
逐条读工具实际返回 → 绑定具体值（`toBe('specific')` / `toMatch(/pattern/)` / `toContain('msg')`）。

**分流规则（实测样本归纳）**：
- **强化**：松散结果检查 `expect(result).toBeTruthy()` / `expect(x.suggestion).toBeTruthy()` → 绑定 `content[0].text` 具体值或 `suggestion` 模式。
- **保留**：① 验证工具注册 `expect(def).toBeDefined()`；② 验证返回结构有字段 `expect(x.inputSchema).toBeDefined()`；③ `expect(result).not.toBeNull()` 作后续字段访问的存在性前置。
- **排除**：嵌套 `.some(m=>...)`（editor-connection:79/81，非松散结果检查，形态不符）；复合布尔 `expect(typeof x==='string' && ...)`（guard:181，强化会裂为多断言，triage 个案定）。

### 5.3 验证（delete-red，:100 教训，不可省）
每条强化后，临时破坏底层行为（改返回值/短路 guard），确认**新断言变红**（证明绑定真实行为，非假强化）；还原后全量绿。鉴权维度是假绿高发区，此验证是本 stream 的核心交付。

## 六、验收标准

| 项 | 标准 |
|---|---|
| Stream A 后 gate 弱计数 | 773 ± 5（1349 − 576）；若落 769 区间 = 守卫误用非贪婪切，必查 |
| Stream B 后 gate 弱计数 | ~759-761（再 − ~12-14）|
| 全量 `npm test` | 4279 passed 基线（Stream A 行为等价；Stream B 1:1 强化不增减测试数）|
| Stream B delete-red | 每条强化经「破坏→红→还原→绿」双向证 |
| 门禁上限 | `WEAK_ASSERTION_LIMIT` 1400 → 据实下调（~800，新基线 ~760 + 5% 容差），注释 `:207` 基线对齐 |
| tsc / eslint | 0 |

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| codemod 切分误用非贪婪 → 复合布尔错转 | §4.2 显式指定贪婪切分 + 验收跌数复核（773 非 769）|
| codemod 误转（函数调用/反转 receiver）| 正向白名单（§4.2 条2）+ 全量 suite 绿兜底 |
| LITERAL 提取破括号/引号 | 括号/引言感知提取（复用解析器 matchArg 逻辑）|
| Stream B 过度收紧致假红 | 从实际返回推 expected，不臆测；delete-red 双向证 |
| Stream B 目标数高估 | 已实测上界 14（非初估 30），triage 规则（§5.2）显式分流 |
| codemod 脚本正确性 | 一次性脚本，验证 = diff 审查 + suite 绿 + 跌数核对（三重）|

## 八、提交策略
建议 3 提交：① Stream A 机械转换（codemod 产物，suite 绿）；② Stream B 鉴权语义强化（delete-red 验证）；③ 门禁上限 + 注释基线 + CHANGELOG。inline on master（本项目惯例，不 push）。

## 九、KB 交付
项目待办:99 ✅ + 开发日志（含四方交叉验证 + 守卫切分陷阱历程，沉淀为反假绿方法论）。
