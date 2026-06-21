# 测试评分框架 M3b(报告 + 发版门禁)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 或 superpowers:subagent-driven-development 逐 task 执行。Steps 用 checkbox(`- [ ]`)跟踪。

**Goal:** 给评分层加"给人看"的渲染层 + "让 score 生效"的门禁——`report.ts` 把 score.json 渲染成人读 markdown,`gate.ts` 读 score.json 判定 pass/hardFails;`npm run score` 顺带产报告,`npm run score:gate` 未过门禁 exit 1,CI check job 接入 gate 阻断 PR。

**Architecture:** 2 个纯函数(`report.ts`/`gate.ts`,放 `src/scoring/` 根,可单测)+ 4 处接线(generate-score 写报告、cli gate 子命令、package.json score:gate、ci.yml check job)。天然 TDD:纯函数先写测试 → cli/ci 接线。**不嵌入 verify_delivery**(它是目标 Godot 项目工具 + deprecated,见 spec"设计纠正")。

**Tech Stack:** TypeScript 5.3 · Vitest 4.1.7 · 纯 Node `fs`/`child_process`(零新依赖)。

**关联:** spec `docs/superpowers/specs/2026-06-21-scoring-m3b-dashboard-design.md`(r2 已审确认)。前置 M1 coverage + M2 integration + M3a security 已接入(3/6 维有值,score.json 数据底座完整)。

## Global Constraints

- `type: "module"`(ESM),import 带 `.js`
- 测试放 `test/scoring/*.test.ts`,自动被 vitest 拾取
- `src/scoring/**/*.ts` 纳入 coverage,不得拉低 thresholds(60/51/69/61)
- 路径引用一律绝对;commit conventional + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`
- `report.ts`/`gate.ts` 是**纯函数**(输入→输出,无 IO),放 `src/scoring/` 根(非 collectors/)
- `PASS_LINE`/`HARD_FAILOUTS`/`NA_SCORE` 复用 `dimensions.ts`,不硬编码

## 现状校正(执行者必读)

- **score.json 只写不读**:M1-M3a 后除 `cli.ts` 写入外无消费方,`hardFails`/pass 线是死数据——本计划接入首个消费方
- **ci.yml:29-33 score 步骤现状**:`npm run score || true` + `continue-on-error: true`(双 non-blocking,`|| true` 吞 exit code)。本计划去 `|| true`(保留 continue-on-error),让 score 失败被 gate 抓到
- **cli.ts 现状**(18 行):`if (invoked)` 块直接 `generateScore(...)` + stdout 摘要;无子命令分支
- **PASS_LINE=75 / HARD_FAILOUTS** integration:80 / security:60(`dimensions.ts`,已配)
- **integration raw 含 `ran`**(`= passed + failed`,排除 pending/skip);report 指标用 `ran` 不用含 skip的 `total`
- **score-report.md 是产物**:在 `coverage/` 下,已被 `.gitignore` 的 `coverage/` 覆盖(不 commit 报告本身)

## gate 评分语义(本计划实现)

- `evaluateGate(score)` 返回 `{ passed, reasons[] }`
- `passed = reasons.length === 0`(等价 total≥PASS_LINE 且无 hardFails)
- reason 两种:**总分不足**(`total < PASS_LINE`)+ **硬否决**(遍历 `hardFails`)
- **partial 不阻断**:`unverified`(na 维)只进报告,不影响 passed(M3c-e 接入前 3 维 na,否则永远卡门禁)

| 场景 | passed | reasons |
|---|---|---|
| total=85.8, 无 hardFails | true | [] |
| total=60 | false | [`总分 60 < 75(pass 线)`] |
| total=90, hardFails=[security 40<60] | false | [`硬否决 security: ...(40 < 60)`] |
| total=50, hardFails=[...] | false | [总分, 硬否决] 两条 |
| total=85.8, unverified=[3 维] | true | [](partial 不阻断) |

## File Structure

| 文件 | 职责 | 副作用 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\src\scoring\gate.ts` | `evaluateGate(score): GateResult`,纯门禁判定 | 无(纯函数) |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts` | `renderScoreReport(score): string`,score.json → markdown | 无(纯函数) |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts` | **改**:写 score.json 后顺带写 score-report.md | 读写文件 |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts` | **改**:加 `gate` 子命令分支 | 读文件 + exit |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\gate.test.ts` | evaluateGate 三种 reason 组合 + partial 不阻断 | 无 |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\report.test.ts` | renderScoreReport 各状态 + raw 字段提取 | 无 |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\cli-gate.test.ts` | spawn 子进程断言 exit code 三分支 | 临时文件 |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts` | **改**:加 score-report.md 生成用例 | 临时文件 |
| `D:\GitHub\godot-mcp-enhanced\package.json` | **改**:加 `score:gate` 脚本 | — |
| `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` | **改**:score 步骤去 `\|\| true`;加 gate 步骤 | — |
| `D:\GitHub\godot-mcp-enhanced\docs\scoring.md` | **改**:加"报告与门禁(M3b)"节 | — |

---

## Task 1: gate.ts(evaluateGate 纯函数)

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\gate.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scoring\gate.test.ts`

**Interfaces:**
- Consumes: `ScoreJson`(types.ts,M1)/ `PASS_LINE`(dimensions.ts,M1)
- Produces: `evaluateGate(score: ScoreJson): GateResult`,其中 `GateResult = { passed: boolean; reasons: string[] }`。Task 3 cli gate 子命令消费。

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\scoring\gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateGate } from '../../src/scoring/gate.js';
import { PASS_LINE } from '../../src/scoring/dimensions.js';
import type { ScoreJson } from '../../src/scoring/types.js';

/** 构造 ScoreJson fixture(只覆盖 gate 关心的字段) */
function makeScore(over: Partial<ScoreJson>): ScoreJson {
  return {
    total: 85.8,
    pass: true,
    partial: true,
    generatedAt: '2026-06-21T02:06:03.000Z',
    dimensions: {} as ScoreJson['dimensions'],
    unverified: [],
    hardFails: [],
    ...over,
  };
}

describe('evaluateGate', () => {
  it('total ≥ PASS_LINE 且无 hardFails → passed, 无 reason', () => {
    const r = evaluateGate(makeScore({ total: 85.8 }));
    expect(r.passed).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('total < PASS_LINE(纯总分不足)→ passed=false, reason 含 pass 线', () => {
    const r = evaluateGate(makeScore({ total: 60 }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual([`总分 60 < ${PASS_LINE}(pass 线)`]);
  });

  it('total≥线但有 hardFails(纯硬否决)→ passed=false, reason 含维度', () => {
    const r = evaluateGate(makeScore({
      total: 90,
      hardFails: [{ dimension: 'security', reason: '低于硬否决线', threshold: 60, actual: 40 }],
    }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual(['硬否决 security: 低于硬否决线(40 < 60)']);
  });

  it('total<线 + hardFails(两者皆有)→ 两条 reason', () => {
    const r = evaluateGate(makeScore({
      total: 50,
      hardFails: [{ dimension: 'integration', reason: '低于硬否决线', threshold: 80, actual: 70 }],
    }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual([
      `总分 50 < ${PASS_LINE}(pass 线)`,
      '硬否决 integration: 低于硬否决线(70 < 80)',
    ]);
  });

  it('partial(unverified 非空)不影响 passed', () => {
    const r = evaluateGate(makeScore({
      total: 85.8,
      unverified: ['flaky', 'performance', 'gdscript'],
    }));
    expect(r.passed).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/gate.test.ts`
Expected: FAIL(`Cannot find module '../../src/scoring/gate.js'`)

- [ ] **Step 3: 写 gate.ts**

创建 `D:\GitHub\godot-mcp-enhanced\src\scoring\gate.ts`:

```ts
import type { ScoreJson } from './types.js';
import { PASS_LINE } from './dimensions.js';

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

/**
 * 门禁判定:total≥PASS_LINE 且无硬否决 → passed。
 * 直接判 score.total < PASS_LINE(而非聚合 score.pass),以区分"总分不足"与"硬否决"两种 fail 原因。
 * partial(unverified/na 维)不影响 passed——只进报告,不阻断(M3c-e 接入前避免永远卡门禁)。
 */
export function evaluateGate(score: ScoreJson): GateResult {
  const reasons: string[] = [];
  if (score.total < PASS_LINE) reasons.push(`总分 ${score.total} < ${PASS_LINE}(pass 线)`);
  for (const hf of score.hardFails) {
    reasons.push(`硬否决 ${hf.dimension}: ${hf.reason}(${hf.actual} < ${hf.threshold})`);
  }
  return { passed: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/gate.test.ts`
Expected: PASS(5 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/scoring/gate.ts test/scoring/gate.test.ts
git commit -m "feat(scoring): gate 纯函数 evaluateGate(M3b Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: report.ts(renderScoreReport 纯函数)

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scoring\report.test.ts`

**Interfaces:**
- Consumes: `ScoreJson`/`DimensionName`/`DimensionResult`(types.ts)/ `NA_SCORE`(dimensions.ts)
- Produces: `renderScoreReport(score: ScoreJson): string`(markdown)。Task 3 generate-score 消费。

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\scoring\report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderScoreReport } from '../../src/scoring/report.js';
import type { ScoreJson } from '../../src/scoring/types.js';

/** 构造完整 3 维有值 + 3 维 na 的 fixture(对齐 score.json 实测结构) */
function makeScore(over: Partial<ScoreJson> = {}): ScoreJson {
  return {
    total: 85.8,
    pass: true,
    partial: true,
    generatedAt: '2026-06-21T02:06:03.000Z',
    dimensions: {
      integration: { score: 100, weight: 0.3, status: 'pass', raw: { passed: 45, failed: 0, pending: 0, total: 45, ran: 45 } },
      coverage: { score: 70.2, weight: 0.2, status: 'pass', raw: { hit: 7945, found: 11325, pct: 70.15452538631347 } },
      security: { score: 80, weight: 0.2, status: 'pass', raw: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2, deduction: 20 } },
      flaky: { score: -1, weight: 0.1, status: 'na' },
      performance: { score: -1, weight: 0.1, status: 'na' },
      gdscript: { score: -1, weight: 0.1, status: 'na' },
    },
    unverified: ['flaky', 'performance', 'gdscript'],
    hardFails: [],
    ...over,
  };
}

describe('renderScoreReport', () => {
  it('头部含总分 + PASS 徽章 + generatedAt', () => {
    const md = renderScoreReport(makeScore());
    expect(md).toContain('85.8');
    expect(md).toContain('PASS');
    expect(md).toContain('2026-06-21T02:06:03.000Z');
  });

  it('fail 时显示 FAIL 徽章', () => {
    const md = renderScoreReport(makeScore({ total: 50, pass: false }));
    expect(md).toContain('FAIL');
  });

  it('integration 关键指标用 ran(45/45 passed, 非 total)', () => {
    const md = renderScoreReport(makeScore());
    expect(md).toContain('45/45 passed');
  });

  it('coverage 指标含 pct(round1) + hit/found', () => {
    const md = renderScoreReport(makeScore());
    expect(md).toContain('70.2%');
    expect(md).toContain('7945/11325');
  });

  it('security 指标含 high 计数 + deduction', () => {
    const md = renderScoreReport(makeScore());
    expect(md).toContain('2 high/critical');
    expect(md).toContain('-20');
  });

  it('na 维显示"未接入"', () => {
    const md = renderScoreReport(makeScore());
    expect(md).toContain('未接入');
  });

  it('hardFails 非空时列出', () => {
    const md = renderScoreReport(makeScore({
      pass: false,
      hardFails: [{ dimension: 'security', reason: '低于硬否决线', threshold: 60, actual: 40 }],
    }));
    expect(md).toContain('硬否决');
    expect(md).toContain('security');
    expect(md).toContain('40 < 60');
  });

  it('未验证维度列出 + 标注 M3c-e', () => {
    const md = renderScoreReport(makeScore());
    expect(md).toContain('flaky');
    expect(md).toContain('M3c-e');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/report.test.ts`
Expected: FAIL(`Cannot find module '../../src/scoring/report.js'`)

- [ ] **Step 3: 写 report.ts**

创建 `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts`:

```ts
import type { ScoreJson, DimensionName, DimensionResult } from './types.js';
import { NA_SCORE } from './dimensions.js';

const STATUS_BADGE: Record<string, string> = {
  pass: '✅ pass',
  warn: '⚠️ warn',
  fail: '❌ fail',
  na: '⊘ na',
};

const DIM_ORDER: DimensionName[] = ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 按维度从 raw 提取"关键指标";na 维返回"未接入",raw 缺失返回 "—" */
function dimMetric(name: DimensionName, d: DimensionResult): string {
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
    default:
      return '—';
  }
}

/**
 * 渲染 score.json → 人读 markdown。
 * 头部时间取自 score.generatedAt(不重复 new Date(),保证与 score 时间一致)。
 * 容错:未知 status 显示原值;raw 缺失显示 "—"。
 */
export function renderScoreReport(score: ScoreJson): string {
  const overall = score.pass ? '✅ PASS' : '❌ FAIL';
  const total = Object.keys(score.dimensions).length;
  const verified = total - score.unverified.length;
  const lines: string[] = [];
  lines.push('# 质量评分报告');
  lines.push('');
  lines.push(`**总分 ${score.total} / 100**  ${overall}  (partial: ${verified}/${total} 维已验证)  · ${score.generatedAt}`);
  lines.push('');
  lines.push('## 维度明细');
  lines.push('');
  lines.push('| 维度 | 分数 | 权重 | 状态 | 关键指标 |');
  lines.push('|---|---|---|---|---|');
  for (const name of DIM_ORDER) {
    const d = score.dimensions[name];
    const scoreCell = d.score === NA_SCORE ? '—' : String(d.score);
    lines.push(`| ${name} | ${scoreCell} | ${d.weight} | ${STATUS_BADGE[d.status] ?? d.status} | ${dimMetric(name, d)} |`);
  }
  lines.push('');
  lines.push('## 硬否决');
  if (score.hardFails.length === 0) {
    lines.push('(无)');
  } else {
    for (const hf of score.hardFails) {
      lines.push(`- ${hf.dimension}: ${hf.reason}(${hf.actual} < ${hf.threshold})`);
    }
  }
  lines.push('');
  lines.push('## 未验证维度');
  if (score.unverified.length === 0) {
    lines.push('(无)');
  } else {
    lines.push(score.unverified.join(', ') + ' — M3c-e 接入');
  }
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/report.test.ts`
Expected: PASS(8 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/scoring/report.ts test/scoring/report.test.ts
git commit -m "feat(scoring): report 纯函数 renderScoreReport(M3b Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 接线层(generate-score 写报告 + cli gate 子命令 + score:gate 脚本)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts`(只加新用例)
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json`
- Create: `D:\GitHub\godot-mcp-enhanced\test\scoring\cli-gate.test.ts`

**Interfaces:**
- Consumes: `renderScoreReport`(Task 2)/ `evaluateGate`(Task 1)
- Produces: `npm run score` 产 score-report.md;`npm run score:gate` 读 score.json 判 exit code

- [ ] **Step 1: 改 generate-score.ts(import report + 写报告)**

在 import 段加 `import { renderScoreReport } from './report.js';`;在 `writeFileSync(opts.outPath, ...)` 之后追加写报告:

```ts
  writeFileSync(opts.outPath, JSON.stringify(score, null, 2) + '\n', 'utf8');
  const reportPath = opts.outPath.replace(/score\.json$/, 'score-report.md');
  writeFileSync(reportPath, renderScoreReport(score), 'utf8');
  return score;
```

(其余不变;报告路径从 outPath 派生,不新增 option)

- [ ] **Step 2: generate-score.test.ts 末尾追加 score-report.md 用例**

在现有 `describe` 内末尾加(复用现有 LCOV/OUT/TMP fixture;若该文件未 import `readFileSync`,在顶部 import 补上):

```ts
  it('写 score-report.md(M3b),内容含总分 + 标题', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT });
    const reportPath = OUT.replace('score.json', 'score-report.md');
    const md = readFileSync(reportPath, 'utf8');
    expect(md).toContain('质量评分报告');
    expect(md).toContain(String(s.total));
  });
```

- [ ] **Step 3: 跑 generate-score.test 确认通过**

Run: `npx vitest run test/scoring/generate-score.test.ts`
Expected: PASS(现有用例 + 新 score-report.md 用例全绿)

- [ ] **Step 4: 改 cli.ts(加 gate 子命令分支)**

完整替换 `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`:

```ts
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { generateScore } from './generate-score.js';
import { evaluateGate } from './gate.js';
import type { ScoreJson } from './types.js';

// CLI 入口:node build/scoring/cli.js [gate]
const entry = fileURLToPath(import.meta.url);
const arg1 = process.argv[1];
const invoked = arg1 !== undefined && resolve(arg1) === entry;
if (invoked) {
  const cmd = process.argv[2];
  if (cmd === 'gate') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    if (!existsSync(scorePath)) {
      console.error('score.json 不存在,先跑 npm run score');
      process.exit(1);
    }
    let score: ScoreJson;
    try {
      score = JSON.parse(readFileSync(scorePath, 'utf8'));
    } catch {
      console.error('score.json 解析失败,重新跑 npm run score');
      process.exit(1);
    }
    const { passed, reasons } = evaluateGate(score);
    if (!passed) {
      console.error('质量门禁未过:\n' + reasons.join('\n'));
      process.exit(1);
    }
    process.stdout.write(`质量门禁通过: total=${score.total}\n`);
  } else {
    const lcovPath = resolve(process.cwd(), 'coverage/lcov.info');
    const outPath = resolve(process.cwd(), 'coverage/score.json');
    const e2eReportPath = resolve(process.cwd(), 'coverage/e2e-report.json');
    const auditJsonPath = resolve(process.cwd(), 'coverage/audit.json');
    const score = generateScore({ lcovPath, outPath, e2eReportPath, auditJsonPath });
    process.stdout.write(
      `score: ${score.total} pass=${score.pass} partial=${score.partial} unverified=${score.unverified.length} → ${outPath}\n`,
    );
  }
}
```

- [ ] **Step 5: package.json 加 score:gate 脚本**

在 `"score": "node build/scoring/cli.js",` 之后加:

```json
    "score:gate": "node build/scoring/cli.js gate",
```

- [ ] **Step 6: 写 cli-gate.test.ts(spawn exit code 三分支)**

创建 `D:\GitHub\godot-mcp-enhanced\test\scoring\cli-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

// spawn 跑编译产物 build/scoring/cli.js(测试前须先 npm run build)
const CLI = resolve(process.cwd(), 'build', 'scoring', 'cli.js');
const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_gate__');

function runGate(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, 'gate'], { encoding: 'utf8', cwd });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('cli gate (exit code)', () => {
  it('score.json 不存在 → exit 1 + stderr 提示', () => {
    const dir = resolve(TMP, 'no_score');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('不存在');
  });

  it('score.json 损坏 → exit 1 + stderr 解析失败', () => {
    const dir = resolve(TMP, 'broken');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(resolve(dir, 'coverage'), { recursive: true });
    writeFileSync(resolve(dir, 'coverage/score.json'), '{不是合法 json');
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('解析失败');
  });

  it('score.json pass → exit 0 + stdout 通过', () => {
    const dir = resolve(TMP, 'ok');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(resolve(dir, 'coverage'), { recursive: true });
    writeFileSync(
      resolve(dir, 'coverage/score.json'),
      JSON.stringify({
        total: 85.8, pass: true, partial: true, generatedAt: 't',
        dimensions: {}, unverified: [], hardFails: [],
      }),
    );
    const r = runGate(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('通过');
  });
});
```

- [ ] **Step 7: build + 跑 cli-gate.test + 全量 + tsc + 提交**

Run: `npm run build && npx vitest run test/scoring/cli-gate.test.ts && npx vitest run && npx tsc --noEmit`

> 注意:cli-gate.test spawn `build/scoring/cli.js`,必须先 `npm run build` 产出编译文件,否则 spawn 报模块找不到。

```bash
git add src/scoring/generate-score.ts src/scoring/cli.ts test/scoring/generate-score.test.ts test/scoring/cli-gate.test.ts package.json
git commit -m "feat(scoring): generate-score 写报告 + cli gate 子命令 + score:gate(M3b Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: CI check job 接入 gate + 文档

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`(check job)
- Modify: `D:\GitHub\godot-mcp-enhanced\docs\scoring.md`

- [ ] **Step 1: ci.yml check job — score 步骤去 || true + 加 gate 步骤**

定位 check job 的 `Generate score.json` 步骤(ci.yml:29-33),改为:

```yaml
      - name: Generate score.json (M1, non-blocking)
        run: |
          npm run build
          npm run score
        continue-on-error: true
      - name: Score gate (M3b)
        run: npm run score:gate
```

> 改动:(1) `npm run score` 行尾去掉 `|| true`(保留 step 级 `continue-on-error: true`,让 score 失败仍继续到 gate,但不再吞 exit code);(2) 新增 gate 步骤,**不加** continue-on-error(gate 失败即 PR check 红 → 阻断合并)。机制:score 生成失败 → score.json 缺失 → gate exit 1 → 阻断,而非被 `|| true` 静默吞掉。

- [ ] **Step 2: Upload score.json 加 if: always()(gate 失败也上传供排查)**

定位 `Upload score.json` 步骤(ci.yml:34-39),加 `if: always()`:

```yaml
      - name: Upload score.json
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: score-json
          path: coverage/score.json
          if-no-files-found: warn
```

> 让 gate 失败时仍上传 score.json(及 score-report.md 同目录)供调试。

- [ ] **Step 3: docs/scoring.md 加"报告与门禁(M3b)"节**

在 `docs/scoring.md` 末尾(`## 架构约束` 之后)追加:

```markdown
## 报告与门禁(M3b)

- `npm run score` 顺带产 `coverage/score-report.md`(人读 markdown:总分/各维表格/硬否决/未验证)
- `npm run score:gate` 读 `coverage/score.json`,未过门禁(`total < 75` 或 `hardFails` 非空)→ exit 1
- CI check job 接入 gate,质量回归阻断 PR 合并
- partial(na 维)不阻断——只进报告,不影响门禁(M3c-e 接入前 3 维 na)
```

- [ ] **Step 4: 本地端到端手验**

Run:
```bash
npm run build
npm run score
npm run score:gate
```
Expected:
- `npm run score` 末行 `score: 85.8 pass=true partial=true unverified=3 → ...coverage/score.json`
- `coverage/score-report.md` 存在,含"质量评分报告"+ 总分 85.8 + 各维表格
- `npm run score:gate` 输出 `质量门禁通过: total=85.8`,exit 0

- [ ] **Step 5: 跑全量 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add .github/workflows/ci.yml docs/scoring.md
git commit -m "ci(scoring): check job 接入 score gate + 报告与门禁文档(M3b Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**:
- gate.ts(evaluateGate,三种 reason + partial)→ Task 1 ✓
- report.ts(renderScoreReport,各状态 + raw.ran/pct/security + generatedAt + 容错)→ Task 2 ✓
- generate-score 写报告 → Task 3 Step 1-3 ✓
- cli gate 子命令(exit code 三分支)→ Task 3 Step 4,6 ✓
- package.json score:gate → Task 3 Step 5 ✓
- ci.yml score 去||true + 加 gate → Task 4 Step 1 ✓
- docs/scoring.md → Task 4 Step 3 ✓
- cli exit code spawn 集成测试(测试 gap)→ Task 3 Step 6 ✓
- 验收标准 1-6 全覆盖 ✓

**2. Placeholder 扫描**:无 TBD/TODO;每步含完整代码;类型/函数名跨 task 一致 ✓

**3. 类型一致**:
- `evaluateGate(score: ScoreJson): GateResult` Task1 定义,Task3 cli 消费 ✓
- `GateResult = { passed: boolean; reasons: string[] }` ✓
- `renderScoreReport(score: ScoreJson): string` Task2 定义,Task3 generate-score 消费 ✓
- `PASS_LINE`/`NA_SCORE` 复用 dimensions.js,不硬编码 ✓
- integration raw.`ran`(非 total)与 collector integration.ts:33 一致 ✓

**4. 测试隔离**:
- gate.test.ts 无 IO(纯函数 fixture)✓
- report.test.ts 无 IO(纯函数 fixture)✓
- cli-gate.test.ts 用 `test/scoring/__tmp_gate__/`(独立,与 __tmp_audit__/__tmp_lcov__/__tmp_gen__ 不冲突)✓
- generate-score.test.ts 复用现有 __tmp_gen__ fixture ✓

**5. 现状风险**:
- cli-gate.test 依赖 `build/scoring/cli.js` → Step 7 先 `npm run build`(已在命令里)
- ci.yml gate 失败阻断 PR:enhanced 当前 total=85.8 pass,不会误伤;coverage/security 回归致 total<75 或 hardFails 才阻断(期望行为)
- score-report.md 不 commit(coverage/ gitignore)→ 仅本地/CI 产物 ✓

无问题,plan 可执行。

---

## 后续(本计划范围外)

- **M3b-PR**:CI 把 score-report.md 贴 PR comment + status check(依赖本 markdown 底座)
- **M3b-HTML**:HTML dashboard(趋势图需历史 score 快照基建)
- **M3c gdscript / M3d performance / M3e flaky**:各需独立 brainstorming(对象/数据源待定)
