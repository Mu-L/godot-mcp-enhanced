# E-99 弱断言精确化 实现计划（报告4 P2-7）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 576 条机械可转的 `expect(RECV.includes(LIT)).toBeTruthy()` 升级为 `expect(RECV).toContain(LIT)`，并对鉴权维度 ~5-6 条语义弱断言做 delete-red 验证的强化，门禁上限/注释基线对齐实测。

**Architecture:** Stream A 用一次性括号感知 codemod（贪婪切分 + receiver 正向白名单守卫）批量转换，行为等价性靠全量 suite 绿 + gate 跌数 773±5 双验；Stream B 手工逐条强化 + delete-red；最后下调 `check-test-quality.mjs` 上限并补 CHANGELOG。

**Tech Stack:** Node 24 / vitest / 纯 JS codemod（不入仓）。

## Global Constraints

- 守卫切分**必须贪婪** `^([\s\S]*)\.includes\(([\s\S]*)\)$`（非贪婪会让 4 条复合布尔误转，safe 576→580）。
- RECV 白名单 `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$`；matcher ∈ {`.toBeTruthy()`, `.toBe(true)`}。
- 排除集（守卫须跳过，diff 须确认未转）：`test/instance-scene.test.js:45,97,123,158`（复合 `||`）、`test/code-templates.test.js:102,106,127,131`（`tpl.generate({})` 函数调用）、`test/tool-registry.test.js:45,57` + `test/gdscript-lint.test.js:105`（negation `!x`）。
- inline on master，不 push；本项目惯例。
- 基线 gate 弱计数 = **1349**（实测，非注释 :207 的 1347）。

---

## File Structure

- **Create（一次性，不入仓）**: `scripts/_codemod-e99-includes.mjs` — Stream A 转换脚本，跑完即删。
- **Modify（Stream A）**: `test/**/*.test.{js,ts}` 中 576+45 处断言（codemod 自动）。
- **Modify（Stream B）**: `test/guard.test.js`、`test/game-bridge.test.js`、`test/game-bridge.test.ts` 各 1-3 处。
- **Modify（门禁）**: `scripts/check-test-quality.mjs`（上限 + 注释）、`CHANGELOG.md`。

---

## Task 1: Stream A — codemod 机械转换（576 + 45）

**Files:**
- Create: `scripts/_codemod-e99-includes.mjs`（不入仓，跑完删）
- Modify: `test/**/*.test.{js,ts}`

**Interfaces:**
- Consumes: gate 基线 1349（`scripts/check-test-quality.mjs` 运行值）
- Produces: gate 弱计数 → 773±5（供 Task 3 据实下调上限）

- [ ] **Step 1: 写 codemod 脚本**

创建 `scripts/_codemod-e99-includes.mjs`，完整内容：

```js
#!/usr/bin/env node
// 一次性 codemod（E-99）：expect(RECV.includes(LIT)).{toBeTruthy|toBe(true)} → expect(RECV).toContain(LIT)
// 守卫：贪婪切分 + RECV 白名单（拒复合||/函数调用/negation）。不入仓，跑完即删。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const SAFE_RECV = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$/;
const SPLIT = /^([\s\S]*)\.includes\(([\s\S]*)\)$/; // 贪婪（必须）

function matchArg(line, openParenIdx) {
  let depth = 1, j = openParenIdx + 1, inStr = false, q = null;
  for (; j < line.length; j++) {
    const c = line[j];
    if (inStr) { if (c === q && line[j - 1] !== '\\') inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return { arg: line.slice(openParenIdx + 1, j), closeEnd: j }; }
  }
  return null;
}
function walk(d, o = []) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p, o); else o.push(p); } return o; }

let convTruthy = 0, convToBeTrue = 0, files = 0;
const skips = [];
for (const f of walk('test').filter(x => /\.test\.(ts|js)$/.test(x))) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  let changed = false;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li], pos = 0;
    while (true) {
      const ei = line.indexOf('expect(', pos);
      if (ei === -1) break;
      const m = matchArg(line, ei + 6);
      if (!m) { pos = ei + 7; continue; }
      const rest = line.slice(m.closeEnd + 1);
      let matcher = null, mEnd = m.closeEnd + 1;
      if (/^\.toBeTruthy\(\)/.test(rest)) { matcher = 'truthy'; mEnd += 13; }
      else if (/^\.toBe\(true\)/.test(rest)) { matcher = 'tobetrue'; mEnd += 11; }
      if (!matcher) { pos = m.closeEnd + 1; continue; }
      const sp = m.arg.trim().match(SPLIT);
      if (!sp) { pos = mEnd; continue; }
      const recv = sp[1].trim();
      if (!SAFE_RECV.test(recv)) {
        if (DRY && skips.length < 40) skips.push(`${f}:${li + 1} SKIP recv="${recv.slice(0, 40)}"`);
        pos = mEnd; continue;
      }
      const repl = `expect(${recv}).toContain(${sp[2]})`;
      line = line.slice(0, ei) + repl + line.slice(mEnd);
      pos = ei + repl.length;
      if (matcher === 'truthy') convTruthy++; else convToBeTrue++;
      changed = true;
    }
    lines[li] = line;
  }
  if (changed && !DRY) { writeFileSync(f, lines.join('\n'), 'utf8'); files++; }
}
console.log('conv toBeTruthy:', convTruthy, '(期望 576)');
console.log('conv toBe(true):', convToBeTrue, '(期望 45)');
console.log('files written:', files);
if (DRY) { console.log('\n排除样本:'); for (const s of skips) console.log(' ', s); }
```

- [ ] **Step 2: dry-run，核对计数 + 排除集**

Run: `node scripts/_codemod-e99-includes.mjs --dry-run`
Expected:
- `conv toBeTruthy: 576`（**若 580 = 守卫误用非贪婪/白名单漏 `!`，必查，勿进 Step 3**）
- `conv toBe(true): 45`
- 排除样本含：`instance-scene.test.js:45/97/123/158`、`code-templates.test.js:102/106/127/131`、`tool-registry.test.js:45/57`、`gdscript-lint.test.js:105`

- [ ] **Step 3: 应用 codemod**

Run: `node scripts/_codemod-e99-includes.mjs`
Expected: `conv toBeTruthy: 576` / `conv toBe(true): 45` / `files written: <N>`

- [ ] **Step 4: 全量 suite 绿（行为等价铁证）**

Run: `npm test`
Expected: `4279 passed | 24 skipped | 0 failed`（与基线一致；任何红 = codemod 错转，定位回退）

- [ ] **Step 5: gate 跌数复核 + 排除集 diff 抽查**

Run: `node scripts/check-test-quality.mjs`
Expected: `检测器③ 弱断言 <count> ≤ 上限 1400`，其中 `<count>` 落 **768-778**（1349 − 576 = 773 ± 5；若 764 区间 = 非贪婪误用）。

Run（排除集未被转换的 spot check）:
```bash
grep -n "includes" test/instance-scene.test.js test/code-templates.test.js
```
Expected: 8 处排除样本仍是 `expect(...).toBeTruthy()`（**未**变 `toContain`）。

- [ ] **Step 6: 删 codemod（不入仓）+ 提交 Stream A**

```bash
rm scripts/_codemod-e99-includes.mjs
git add test/
git commit -m "refactor(test): E-99 机械转 safe includes→toContain（576+45，报告4 :99）

括号感知 codemod（贪婪切分+receiver 白名单）转 576 includes-truthy + 45 includes-tobeTrue
→ toContain。守卫排除 4 复合布尔||/4 函数调用 tpl.generate({})/3 negation !x。
全量 4279 绿（行为等价）；gate 弱计数 1349→773。

Co-Authored-By: Claude <noreply@anthropic.com>"
```
Expected: commit 成功；`git status` 干净（codemod 已删，不入仓）。

---

## Task 2: Stream B — 鉴权语义强化（~5-6 条，delete-red）

**Files:**
- Modify: `test/guard.test.js`、`test/game-bridge.test.js`、`test/game-bridge.test.ts`

**Interfaces:**
- Consumes: Task 1 后的 test 文件状态
- Produces: gate 弱计数 → ~767-768

**Triage 结论（读实际目标后）**：guard/game-bridge 多数 `expect(result).toBeTruthy()` 是字段访问前的**合法存在性前置**（spec §5.2 规则③，保留，不强化）。真正强化 = 绑定 schema 形状/类型者，共 5 处：

- [ ] **Step 1: game-bridge.test.js L38-39（inputSchema 形状绑定）**

读 `test/game-bridge.test.js:37-41`。现状：
```js
  it('tool has required inputSchema', () => {
    expect(tools[0].inputSchema).toBeTruthy();
    expect(tools[0].inputSchema.properties).toBeTruthy();
    expect(tools[0].inputSchema.required).toContain('action');
  });
```
改为（绑定 schema 形状，弱→具体）：
```js
  it('tool has required inputSchema', () => {
    expect(tools[0].inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
    expect(tools[0].inputSchema.properties).toEqual(expect.any(Object));
    expect(tools[0].inputSchema.required).toContain('action');
  });
```

delete-red：临时改 `src/tools/game-bridge.ts` 的 tool 定义 inputSchema 为 `{}`（删 type/properties）→ Run `npx vitest run test/game-bridge.test.js -t "required inputSchema"` → 期望新断言 **FAIL**（旧 toBeTruthy 会 PASS=假绿，证明强化有效）→ 还原 src → 再跑确认 PASS。

- [ ] **Step 2: game-bridge.test.ts L187、L201（suggestion 类型绑定）**

读 `test/game-bridge.test.ts:184-188、198-202`。两处 `expect(parsed.suggestion).toBeTruthy();` 改为：
```js
      expect(parsed.suggestion).toEqual(expect.any(String));
      expect(parsed.suggestion.length).toBeGreaterThan(0);
```
（两处同样改）

delete-red：临时改 `src/tools/game-bridge.ts` BRIDGE_NOT_CONNECTED 错误构造，令 suggestion 为 `undefined` → Run `npx vitest run test/game-bridge.test.ts` → 期望对应 it **FAIL**（旧 toBeTruthy 对 undefined 会 FAIL，但对空串 `''` 会 PASS=假绿；新断言 `length>0` 抓空串）→ 改 suggestion 为 `''`（truthy 边界）再跑，确认新断言红而旧会绿 → 还原。

- [ ] **Step 3: guard.test.js L181（compound 拆分，诊断升级）**

读 `test/guard.test.js:180-181`。现状：
```js
    const token = createPendingToken('scene', { action: 'remove_node', node_path: '/root/Player' });
    expect(typeof token === 'string' && token.length > 10).toBeTruthy();
```
改为：
```js
    const token = createPendingToken('scene', { action: 'remove_node', node_path: '/root/Player' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
```
（注：此条为诊断清晰度升级——旧 compound 与新拆分都捕短 token，delete-red 不显差异，不强求 delete-red，价值在失败信息可读性。）

- [ ] **Step 4: 全量 suite 绿**

Run: `npm test`
Expected: `4279 passed | 0 failed`（强化为 1:1 替换/拆分，测试数不增减）

- [ ] **Step 5: gate 复核 + 提交 Stream B**

Run: `node scripts/check-test-quality.mjs`
Expected: 弱计数 ≈ **767-768**（Task 1 的 773 − ~5）。

```bash
git add test/guard.test.js test/game-bridge.test.js test/game-bridge.test.ts
git commit -m "test(guard,game-bridge): E-99 鉴权维度语义强化（5 条，delete-red）

guard L38-39 inputSchema 形状绑定 / game-bridge.ts L187,201 suggestion 类型+非空绑定 /
guard L181 token compound 拆分。余 toBeTruthy 为字段访问前存在性前置（§5.2 规则③ 保留）。
shape/类型绑定经 delete-red 证明绑真实行为（旧 toBeTruthy 对空串/缺字段假绿）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 门禁上限 + 注释基线 + CHANGELOG

**Files:**
- Modify: `scripts/check-test-quality.mjs`、`CHANGELOG.md`

**Interfaces:**
- Consumes: Task 2 后 gate 实测值（~767-768）
- Produces: 门禁对齐，本批闭环

- [ ] **Step 1: 读 Task 2 后实测 gate 值**

Run: `node scripts/check-test-quality.mjs`
记下 `<final_count>`（期望 ~767-768）。

- [ ] **Step 2: 下调上限 + 对齐注释**

读 `scripts/check-test-quality.mjs:204-211`。现状：
```js
/**
 * 基线 2026-07-30 实测 1347（.test.js 1163 + .test.ts 184）。
 * 阈值：基线 + ~4% 容差 = 1400。粗 grep 含合理用法，作"防恶化上限"非"消除目标"。
 * 改善后下调上限（注释说明新基线）。
 */
const WEAK_ASSERTION_LIMIT = 1400;
```
改为（`<final_count>` 用 Step 1 实测值代入；上限 = 实测 + ~5%）：
```js
/**
 * 基线 2026-07-30 实测 <final_count>（E-99 后：机械转 576 includes→toContain + 鉴权强化 ~5）。
 * 阈值：基线 + ~5% 容差 = <上限>。粗 grep 含合理用法（字段访问前存在性前置等），作"防恶化上限"非"消除目标"。
 */
const WEAK_ASSERTION_LIMIT = <上限>;  // <final_count> 的 ceil 到 10 + 5%
```
（例：final=768 → 上限 = 810）

- [ ] **Step 3: CHANGELOG test-quality 段**

读 `CHANGELOG.md` `[Unreleased]` 下首个 `### Fixed — Test Quality` 段（:101 已建）。其下追加：
```markdown
- E-99 弱断言精确化：机械转 576 条 `includes().toBeTruthy()` → `toContain`（codemod 贪婪切分 + receiver 白名单守卫）+ 鉴权维度 5 条语义强化（delete-red）。gate 弱计数 1349 → ~768，上限 1400 → ~810。
```

- [ ] **Step 4: gate PASS + tsc/eslint + 提交**

Run: `node scripts/check-test-quality.mjs` → 期望 PASS（`<final_count> ≤ <上限>`）。
Run: `npx tsc --noEmit` → 0。
Run: `npm run lint`（或 `npx eslint scripts/check-test-quality.mjs`）→ 0。

```bash
git add scripts/check-test-quality.mjs CHANGELOG.md
git commit -m "chore(test): E-99 门禁上限 1400→~810 + 注释基线对齐 + CHANGELOG

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: KB 闭环**

- `D:\workspace\Obsidian\GodotMCP\项目待办.md` :99 标 `[x]`，附关闭说明（机械 576 + 鉴权 5 + 守卫切分陷阱）。
- 写开发日志 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-30 E-99 弱断言精确化.md`（含四方交叉验证 + 贪婪/非贪婪切分 BLOCKING 陷阱，沉淀反假绿方法论）。

---

## 验收（全 plan 完成后）

| 项 | 标准 |
|---|---|
| gate 弱计数 | ~767-768 |
| `npm test` | 4279 passed / 0 failed |
| tsc / eslint | 0 |
| Stream A 排除集 | 8 处样本未转（diff 确认）|
| Stream B delete-red | shape/类型绑定经「破坏→红→还原→绿」 |
| 门禁上限 | 1400 → ~810（实测代入）|
| commits | 3（A 机械 / B 语义 / 门禁+CHANGELOG）|
