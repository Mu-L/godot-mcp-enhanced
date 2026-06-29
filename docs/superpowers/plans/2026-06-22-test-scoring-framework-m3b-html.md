# M3b-HTML HTML 报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第三种渲染 `renderScoreHtml` → 自包含 HTML 报告(静态 + 轻量内联 CSS),接入 cli `score:html` 子命令 + CI artifact。砍趋势。

**Architecture:** 对齐现有渲染层纯函数模式(`renderScoreReport`/`renderPrComment`)。`renderScoreHtml(score): string` 纯函数(无 IO)→ cli `html` 子命令写 `coverage/score-report.html` → CI upload artifact。DRY:抽 `dimMetric`+`round1` 到 `metric.ts`(report.ts + html.ts 共用)+ `loadScore` helper(cli gate/pr-comment/html 3 处共用)。

**Tech Stack:** TypeScript(ESM), Vitest, GitHub Actions。

## Global Constraints

- **实施位置**:`m3c-gdscript` worktree(`fix/review-verification` 分支)——M3b-HTML 依赖 M3c scoring 代码(`src/scoring` 全套),master 主树**无 `src/scoring`**。所有文件路径用 worktree 前缀 `D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript/`,git 用 `git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript`。
- **HTML 转义硬约束**(项目踩过 `gdscript-template-injection` 模板插值未转义 + `escapeTscnValue` 漏 `[` 两类坑,有据):
  - `escapeHtml` 全字符集 `& < > " '` 五个,**`&` 必须先转**(顺序 `& → < → > → " → '`,否则 `&lt;` 二次转义 `&amp;lt;`)
  - **所有字符串插值都过 escapeHtml**(hardFails.reason / generatedAt / godotVersion / DimensionName / detail / dimMetric 返回值 / d.status 文本节点)
  - **数字直接插值**(total/score/weight/actual/threshold),不进文本节点无注入风险
  - **status 白名单映射 class**(`STATUS_CLASS` Record + 固定 `'status-unknown'` fallback)——**不把 `d.status` 原值拼进 class 属性**(防 `class="status-${d.status}"` 属性逃逸注入:异常 status `fail"><img onerror=...>` → onerror 执行 JS)。d.status 作**文本节点**仍过 escapeHtml(双保险)
  - `escapeHtml` **只接 string**(数字/undefined 不传,否则 `.replace` 抛)
- **DRY**:`dimMetric` + `round1` 抽 `src/scoring/metric.ts`(**不塞 `dimensions.ts`**——那是权重/阈值/哨兵配置);`loadScore(scorePath): ScoreJson` helper(cli gate/pr-comment/html 3 处),cli 用 `try/catch` 接 throw → `console.error` + `process.exit(1)`
- **单文件自包含**:内联 `<style>`、`<!DOCTYPE html>` 开头、**无外部 CSS/JS/图片**(artifact 下载离线可看,无相对路径断裂/CDN 风险)
- **ESM**:`package.json type:module`,import 用 `.js` 扩展
- **砍趋势**:**不预留**任何趋势钩子(纯当前报告);趋势 milestone 自己加 `<canvas>`/`<svg>`
- 状态色:pass `#16a34a` / warn `#ca8a04` / fail `#dc2626` / na `#71717a`

---

## Task 1: 抽 metric.ts(dimMetric + round1),report.ts 复用

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\metric.ts`
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\test\scoring\metric.test.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\report.ts`(删本地 round1/dimMetric,import metric.ts)

**Interfaces:**
- Produces: `round1(n: number): number`;`dimMetric(name: DimensionName, d: DimensionResult): string`(供 Task 2 html.ts 用)

- [ ] **Step 1: 写失败测试** `test/scoring/metric.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { round1, dimMetric } from '../../src/scoring/metric.js';
import type { DimensionResult } from '../../src/scoring/types.js';

function dim(score: number, status: DimensionResult['status'], raw?: Record<string, number>): DimensionResult {
  return { score, weight: 0.1, status, raw };
}

describe('metric', () => {
  it('round1 保留一位小数', () => {
    expect(round1(70.154)).toBe(70.2);
    expect(round1(70)).toBe(70);
  });

  it('dimMetric integration → ran/passed', () => {
    expect(dimMetric('integration', dim(90, 'pass', { passed: 44, ran: 45 }))).toBe('44/45 passed');
  });

  it('dimMetric coverage → pct(round1) + hit/found', () => {
    expect(dimMetric('coverage', dim(70.2, 'pass', { hit: 7945, found: 11325, pct: 70.154 }))).toBe('70.2% (7945/11325)');
  });

  it('dimMetric security → high+critical / deduction', () => {
    expect(dimMetric('security', dim(80, 'pass', { high: 2, critical: 0, deduction: 20 }))).toBe('2 high/critical (-20)');
  });

  it('dimMetric gdscript → err/warn', () => {
    expect(dimMetric('gdscript', dim(90, 'pass', { errors: 0, warnings: 5 }))).toBe('0 err / 5 warn');
  });

  it('dimMetric flaky/performance → —(无 case)', () => {
    expect(dimMetric('flaky', dim(-1, 'na'))).toBe('未接入');
    expect(dimMetric('performance', dim(80, 'pass', { x: 1 }))).toBe('—');
  });

  it('dimMetric na 维(score=-1 或 status=na)→ 未接入', () => {
    expect(dimMetric('coverage', dim(-1, 'na'))).toBe('未接入');
  });

  it('dimMetric raw 缺失 → —', () => {
    expect(dimMetric('security', dim(80, 'pass'))).toBe('—');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/metric.test.ts`
Expected: FAIL(`metric.js` 模块找不到)

- [ ] **Step 3: 实现 metric.ts**(从 report.ts:11-32 原样抽取)

```ts
import type { DimensionName, DimensionResult } from './types.js';
import { NA_SCORE } from './dimensions.js';

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 按维度从 raw 提取"关键指标";na 维返回"未接入",raw 缺失返回 "—" */
export function dimMetric(name: DimensionName, d: DimensionResult): string {
  if (d.score === NA_SCORE || d.status === 'na') return '未接入';
  const raw = d.raw as Record<string, number> | undefined;
  if (!raw) return '—';
  switch (name) {
    case 'integration':
      return `${raw.passed ?? 0}/${raw.ran ?? 0} passed`;
    case 'coverage':
      return `${round1(raw.pct ?? 0)}% (${raw.hit ?? 0}/${raw.found ?? 0})`;
    case 'security':
      return `${(raw.high ?? 0) + (raw.critical ?? 0)} high/critical (-${raw.deduction ?? 0})`;
    case 'gdscript':
      return `${raw.errors ?? 0} err / ${raw.warnings ?? 0} warn`;
    default:
      return '—';
  }
}
```

- [ ] **Step 4: report.ts 删本地 + import metric.ts**

`src/scoring/report.ts` 顶部 import 改为(删 DimensionName/DimensionResult 因 dimMetric 挪走后不再直接标注;加 metric import):
```ts
import type { ScoreJson } from './types.js';
import { NA_SCORE, DIM_ORDER } from './dimensions.js';
import { dimMetric } from './metric.js';
```
删除 `function round1`(:11-13)和 `function dimMetric`(:15-32 整段)。保留 STATUS_BADGE / renderScoreReport(renderScoreReport 用 `dimMetric(name, d)` 不变)。

- [ ] **Step 5: 跑测试确认通过 + report 现有测试不回归**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/metric.test.ts test/scoring/report.test.ts`
Expected: PASS(metric 8 + report 现有全绿,行为不变)

- [ ] **Step 6: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/metric.ts test/scoring/metric.test.ts src/scoring/report.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "refactor(scoring): 抽 metric.ts(dimMetric+round1),report 复用(M3b-HTML Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: html.ts(renderScoreHtml + escapeHtml + STATUS_CLASS)

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\html.ts`
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\test\scoring\html.test.ts`

**Interfaces:**
- Consumes: `dimMetric` from `./metric.js`(Task 1)
- Produces: `renderScoreHtml(score: ScoreJson): string`;`escapeHtml(s: string): string`(供 Task 3 cli 用)

- [ ] **Step 1: 写失败测试** `test/scoring/html.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { renderScoreHtml, escapeHtml } from '../../src/scoring/html.js';
import type { ScoreJson } from '../../src/scoring/types.js';

function makeScore(over: Partial<ScoreJson> = {}): ScoreJson {
  return {
    total: 85.8, pass: true, partial: true,
    generatedAt: '2026-06-22T03:00:00.000Z',
    dimensions: {
      integration: { score: 100, weight: 0.3, status: 'pass', raw: { passed: 44, ran: 45 } },
      coverage: { score: 70.2, weight: 0.2, status: 'pass', raw: { hit: 7945, found: 11325, pct: 70.154 } },
      security: { score: 80, weight: 0.2, status: 'pass', raw: { high: 2, critical: 0, deduction: 20 } },
      flaky: { score: -1, weight: 0.1, status: 'na' },
      performance: { score: -1, weight: 0.1, status: 'na' },
      gdscript: { score: 90, weight: 0.1, status: 'pass', raw: { errors: 0, warnings: 5 } },
    },
    unverified: ['flaky', 'performance'],
    hardFails: [],
    ...over,
  };
}

describe('escapeHtml', () => {
  it('五字符各转', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('& 先转(防 &lt; 二次转义 &amp;lt;)', () => {
    expect(escapeHtml('<')).toBe('&lt;');           // 非 &amp;lt;
    expect(escapeHtml('&')).toBe('&amp;');          // 单独 & → &amp;
  });

  it('混合串全转义无二次', () => {
    expect(escapeHtml('a < b & c > d "e" \'f\'')).toBe('a &lt; b &amp; c &gt; d &quot;e&quot; &#39;f&#39;');
  });

  it('空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('renderScoreHtml', () => {
  it('自包含:DOCTYPE 开头 + 内联 <style>', () => {
    const html = renderScoreHtml(makeScore());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
  });

  it('头部含总分 + PASS 徽章 + generatedAt', () => {
    const html = renderScoreHtml(makeScore());
    expect(html).toContain('85.8');
    expect(html).toContain('PASS');
    expect(html).toContain('2026-06-22T03:00:00.000Z');
  });

  it('fail 时 FAIL 徽章', () => {
    const html = renderScoreHtml(makeScore({ total: 50, pass: false }));
    expect(html).toContain('FAIL');
  });

  it('维度表含 6 维 + gdscript 关键指标', () => {
    const html = renderScoreHtml(makeScore());
    for (const name of ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('0 err / 5 warn');
  });

  it('status 白名单映射 class(pass/warn/fail/na)', () => {
    const html = renderScoreHtml(makeScore());
    expect(html).toContain('status-pass');
    expect(html).toContain('status-na');
  });

  it('HTML 转义(XSS 防护):detail 含 <script> → &lt;script&gt;', () => {
    const html = renderScoreHtml(makeScore({
      dimensions: { ...makeScore().dimensions,
        gdscript: { score: 0, weight: 0.1, status: 'fail', raw: { errors: 1, warnings: 0, detailsTotal: 1, details: ['cmd.gd:1 <script>alert(1)</script>'] } } },
      hardFails: [{ dimension: 'gdscript', reason: 'errors>0', threshold: 60, actual: 0 }],
    }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');   // 不含原始未转义
  });

  it('status 异常值(属性注入防护)→ status-unknown,不含原 " </ <', () => {
    const html = renderScoreHtml(makeScore({
      dimensions: { ...makeScore().dimensions,
        gdscript: { score: 90, weight: 0.1, status: 'fail"><img src=x onerror=alert(1)>' as never, raw: { errors: 0, warnings: 0 } } },
    }));
    expect(html).toContain('status-unknown');      // 白名单 fallback
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('& 顺序锁:generatedAt 含 & → &amp;(不二次)', () => {
    const html = renderScoreHtml(makeScore({ generatedAt: 'a&b' }));
    expect(html).toContain('a&amp;b');
    expect(html).not.toContain('a&amp;amp;');
  });

  it('硬否决/未验证渲染', () => {
    const html = renderScoreHtml(makeScore());
    expect(html).toContain('硬否决');
    expect(html).toContain('未验证');
    expect(html).toContain('flaky, performance');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/html.test.ts`
Expected: FAIL(`html.js` 模块找不到)

- [ ] **Step 3: 实现 html.ts**

```ts
import type { ScoreJson } from './types.js';
import { NA_SCORE, DIM_ORDER } from './dimensions.js';
import { dimMetric } from './metric.js';

/** status → class 白名单(防 class 属性逃逸注入:不把 d.status 原值拼进属性) */
const STATUS_CLASS: Record<string, string> = {
  pass: 'status-pass', warn: 'status-warn', fail: 'status-fail', na: 'status-na',
};

/**
 * HTML 转义:全字符集 & < > " ',& 必须先转(防 &lt; 二次转义 &amp;lt;)。
 * 只接 string——数字(total/score)直接插值不传此函数。
 * 历史依据:项目踩过 gdscript-template-injection(模板插值未转义)+ escapeTscnValue 漏 [(escape 漏字符)。
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')   // 必须先
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; max-width: 60rem; }
.total { font-size: 2rem; font-weight: bold; }
.badge { padding: 0.2rem 0.6rem; border-radius: 4px; color: #fff; font-size: 1rem; }
.status-pass { background: #16a34a; }
.status-warn { background: #ca8a04; }
.status-fail { background: #dc2626; }
.status-na, .status-unknown { background: #71717a; }
table { border-collapse: collapse; margin: 1rem 0; }
th, td { border: 1px solid #d4d4d4; padding: 0.4rem 0.8rem; text-align: left; }
.status-cell { font-weight: bold; color: #fff; }
h2 { margin-top: 1.5rem; }
`;

/** 渲染 score.json → 自包含 HTML(静态 + 内联 CSS,无外部依赖)。所有字符串插值过 escapeHtml;status 白名单映射 class。 */
export function renderScoreHtml(score: ScoreJson): string {
  const overall = score.pass ? 'PASS' : 'FAIL';
  const overallClass = score.pass ? 'status-pass' : 'status-fail';
  const total = Object.keys(score.dimensions).length;
  const verified = total - score.unverified.length;
  const partialTag = score.partial ? ` (partial: ${verified}/${total} 维已验证)` : '';

  const rows = DIM_ORDER.map(name => {
    const d = score.dimensions[name];
    const scoreCell = d.score === NA_SCORE ? '—' : String(d.score);
    const cls = STATUS_CLASS[d.status] ?? 'status-unknown';   // 白名单,不拼原 status
    return `      <tr><td>${escapeHtml(name)}</td><td>${scoreCell}</td><td>${d.weight}</td>` +
           `<td class="status-cell ${cls}">${escapeHtml(d.status)}</td><td>${escapeHtml(dimMetric(name, d))}</td></tr>`;
  }).join('\n');

  const hardFailsHtml = score.hardFails.length === 0
    ? '    <p>(无)</p>'
    : '    <ul>\n' + score.hardFails.map(hf =>
        `      <li>${escapeHtml(hf.dimension)}: ${escapeHtml(hf.reason)} (${hf.actual} &lt; ${hf.threshold})</li>`
      ).join('\n') + '\n    </ul>';

  const unverifiedHtml = score.unverified.length === 0
    ? '    <p>(无)</p>'
    : `    <p>${escapeHtml(score.unverified.join(', '))} — M3c-e 接入</p>`;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>质量评分报告</title>
  <style>${CSS}</style>
</head>
<body>
  <h1>质量评分报告</h1>
  <div class="total">${score.total} / 100 <span class="badge ${overallClass}">${overall}</span></div>
  <p>${escapeHtml(score.generatedAt)}${partialTag}</p>
  <h2>维度明细</h2>
  <table>
    <thead><tr><th>维度</th><th>分数</th><th>权重</th><th>状态</th><th>关键指标</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <h2>硬否决</h2>
${hardFailsHtml}
  <h2>未验证维度</h2>
${unverifiedHtml}
</body>
</html>`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/html.test.ts`
Expected: PASS(escapeHtml 4 + renderScoreHtml 9 = 13)

- [ ] **Step 5: tsc 确认类型**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript exec tsc -- --noEmit`
Expected: 0 error

- [ ] **Step 6: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/html.ts test/scoring/html.test.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "feat(scoring): renderScoreHtml + escapeHtml(全字符集+&先转+status白名单)(M3b-HTML Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: cli.ts 抽 loadScore helper + html 子命令

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\cli.ts`(抽 loadScore + gate/pr-comment 复用 + 加 html 子命令)
- Test: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\test\scoring\cli-gate.test.ts`(现有绿,loadScore 行为不变)

**Interfaces:**
- Consumes: `renderScoreHtml` from `./html.js`(Task 2)
- Produces: `score:html` 子命令(node build/scoring/cli.js html → 写 coverage/score-report.html)

- [ ] **Step 1: 改 cli.ts**

`src/scoring/cli.ts` 顶部 import 加(在 renderPrComment 后):
```ts
import { renderScoreHtml } from './html.js';
```
在 `if (invoked)` **之前**加 `loadScore` helper(throw 版,cli 各分支 try/catch 接):
```ts
/** 读 score.json + 结构守卫(失败 throw,cli 用 try/catch 接 → console.error + exit)。gate/pr-comment/html 3 处共用。 */
function loadScore(scorePath: string): ScoreJson {
  if (!existsSync(scorePath)) throw new Error('score.json 不存在,先跑 npm run score');
  let score: ScoreJson;
  try {
    score = JSON.parse(readFileSync(scorePath, 'utf8'));
  } catch {
    throw new Error('score.json 解析失败,重新跑 npm run score');
  }
  if (!score || typeof score.total !== 'number' || !Array.isArray(score.hardFails)) {
    throw new Error('score.json 结构异常(total/hardFails 缺失或类型错),重新跑 npm run score');
  }
  return score;
}
```
gate 分支(:15-38)改为用 loadScore:
```ts
  if (cmd === 'gate') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    let score: ScoreJson;
    try {
      score = loadScore(scorePath);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const { passed, reasons } = evaluateGate(score);
    if (!passed) {
      console.error('质量门禁未过:\n' + reasons.join('\n'));
      process.exit(1);
    }
    process.stdout.write(`质量门禁通过: total=${score.total}\n`);
  } else if (cmd === 'pr-comment') {
```
pr-comment 分支(:39-58)同样改为 loadScore(删本地读+守卫,用 try/catch 接 loadScore):
```ts
  } else if (cmd === 'pr-comment') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    let score: ScoreJson;
    try {
      score = loadScore(scorePath);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const outPath = resolve(process.cwd(), 'coverage/pr-comment.md');
    writeFileSync(outPath, renderPrComment(score), 'utf8');
    process.stdout.write(`PR comment 写入: ${outPath}\n`);
  } else if (cmd === 'html') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    let score: ScoreJson;
    try {
      score = loadScore(scorePath);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const outPath = resolve(process.cwd(), 'coverage/score-report.html');
    writeFileSync(outPath, renderScoreHtml(score), 'utf8');
    process.stdout.write(`HTML 报告写入: ${outPath}\n`);
  } else {
```
(默认 score 分支 :59-69 不变)

- [ ] **Step 2: 跑 cli-gate 现有测试确认行为不变**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/cli-gate.test.ts`
Expected: PASS(loadScore 抽取后 gate 行为不变)

- [ ] **Step 3: tsc 确认类型**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript exec tsc -- --noEmit`
Expected: 0 error

- [ ] **Step 4: 本地端到端(可选,有 score.json 时)**

Run(若有 coverage/score.json):
```bash
npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run build
node D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript/build/scoring/cli.js html
```
Expected:`coverage/score-report.html` 生成,`<!DOCTYPE html>` 开头。无 score.json 时验 throw→exit 1。

- [ ] **Step 5: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/cli.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "feat(scoring): cli 抽 loadScore + html 子命令(M3b-HTML Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: package.json score:html + CI 接入

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\package.json`(加 score:html script)
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\.github\workflows\ci.yml`(check job 加 score:html step + upload artifact)

**Interfaces:**
- Consumes: `html` 子命令(Task 3)
- Produces: CI 上传 `score-report.html` artifact

- [ ] **Step 1: package.json 加 script**

`package.json` scripts 区(`score:pr-comment` 后)加:
```json
    "score:html": "node build/scoring/cli.js html",
```

- [ ] **Step 2: ci.yml check job 加 score:html step + upload artifact**

`.github/workflows/ci.yml` check job,在 `Score pr-comment` step **之后**、`Sticky PR comment` step **之前**加(对齐 pr-comment 的 continue-on-error 模式):
```yaml
      - name: Score html (M3b-HTML)
        if: always()
        continue-on-error: true
        run: npm run score:html
```
在 `Upload score.json` step(:50-56)**之后**加 upload html artifact(对齐 score-json 模式):
```yaml
      - name: Upload score-report.html
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: score-report-html
          path: coverage/score-report.html
          if-no-files-found: warn
```

- [ ] **Step 3: tsc + lint 确认**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript exec tsc -- --noEmit && npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run lint`
Expected: tsc 0 / eslint 0

- [ ] **Step 4: 全套测试 final verify**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run`
Expected: 全绿(含 metric/html 新测试 + 现有 report/cli-gate 不回归)

- [ ] **Step 5: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add package.json .github/workflows/ci.yml
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "ci(scoring): score:html script + CI upload artifact(M3b-HTML Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review(plan 写完后自查,已执行)

**1. Spec coverage**:
- renderScoreHtml 纯函数 + 自包含 HTML + 内联 CSS → Task 2 ✓
- escapeHtml 硬约束(全字符集 + 全插值 + & 先转 + 只接 string) → Task 2 + Global Constraints ✓
- status 白名单 STATUS_CLASS + 固定 status-unknown fallback(防属性注入,R1) → Task 2 ✓
- dimMetric 抽 metric.ts(含 round1,不塞 dimensions.ts) → Task 1 ✓
- loadScore helper(cli gate/pr-comment/html 3 处 DRY)+ cli try/catch 接 throw → Task 3 ✓
- cli html 子命令 → Task 3 ✓
- package.json score:html + CI upload artifact → Task 4 ✓
- 砍趋势(不预留钩子) → Global Constraints ✓
- 实施依赖 m3c-gdscript worktree → Global Constraints ✓
- R2(历史教训):Task 2 escapeHtml 注释含 gdscript-template-injection + escapeTscnValue ✓
- R3(混合串测试):Task 2 escapeHtml "混合串全转义无二次" 用例 ✓
- R4(趋势不预留):Global Constraints "不预留任何趋势钩子" ✓
- R5(loadScore cli try/catch):Task 3 cli try/catch 接 throw → console.error + exit ✓
- R6(escapeHtml 只接 string):Global Constraints + Task 2 escapeHtml 签名 `s: string` + 注释 ✓

**2. Placeholder scan**:无 TBD/TODO。所有代码块完整(metric.ts/html.ts/loadScore/cli 改动/ci.yml step)。escapeHtml 顺序明确。status 白名单代码完整。

**3. Type consistency**:`dimMetric(name: DimensionName, d: DimensionResult): string`(Task 1 metric.ts)→ html.ts 调用同名同参 ✓;`escapeHtml(s: string): string`(Task 2)→ html.ts 内 + 测试一致 ✓;`renderScoreHtml(score: ScoreJson): string`(Task 2)→ cli.ts Task 3 调用一致 ✓;`loadScore(scorePath: string): ScoreJson`(Task 3)→ gate/pr-comment/html 3 分支调用一致 ✓;`round1` metric.ts 自含(dimMetric 内用)report.ts 不再直接用 ✓。

无问题,plan 可执行。
