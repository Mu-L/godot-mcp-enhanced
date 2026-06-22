# M3d performance 维度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** performance 维度从 na 变真值——全套 vitest wall-clock 时间,绝对阈值分段线性,无硬否决。

**Architecture:** 对齐现有 collector 模式(collectSecurity/collectGdscript 纯函数)。`collectPerformance(reportPath)` 解析 vitest json → 全套 wall-clock(`max(testResults[].endTime) - min(testResults[].startTime)`,非 Σ duration)→ 绝对阈值分段线性 → DimensionResult。generate-score/cli 接入 + metric.ts dimMetric(dimMetric shared,M3b-HTML 抽的)+ CI vitest 多 reporter 产 json。

**Tech Stack:** TypeScript(ESM), Vitest, GitHub Actions。

## Global Constraints

- **实施位置**:`m3c-gdscript` worktree(`fix/review-verification` 分支)——M3d 依赖现有 scoring 代码(`src/scoring`),master 主树无。所有文件路径用 worktree 前缀 `D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript/`,git 用 `git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript`。
- **wall-clock 算法(IMPORTANT-1)**:`collectPerformance` 用 `max(testResults[].endTime) - min(testResults[].startTime)`——**非** Σ `assertionResults[].duration`(后者 per-test CPU 和,并行重叠 ≈2× wall-clock,不稳定)。单位 **ms**(per-file startTime/endTime 是 ms 时间戳),展示 /1000 = s
- **分段线性(IMPORTANT-2)**:`≤T_PASS_MS → 100`;`T_PASS_MS < ms ≤ T_WARN_MS → 线性 100→60`;`ms > T_WARN_MS → 线性 60→0 clamp`。≤ 闭区间。status pass 边界(score=80)落 `T_PASS_MS + 0.5×(T_WARN_MS − T_PASS_MS)`
- **软扣分意图(ADVISORY 2)**:warn→fail 段(60→0,跨度 T_WARN_MS)退化比 pass→warn 段(100→60,跨度 T_WARN_MS−T_PASS_MS)宽——测试越慢扣分越缓,反映"测试慢是质量问题但非致命"
- **无 HARD_FAILOUT**(测试慢软扣分,`HARD_FAILOUTS` 不加 performance)
- **status 80/60 第4处复制**(coverage 60/40 有意分化;integration/security/gdscript/performance 80/60)——M3d 照抄,plan 留 TODO 抽 `statusFromScore` helper(N+1)
- **CI vitest 多 reporter(IMPORTANT)**:`vitest run --coverage --reporter=default --reporter=json --outputFile=coverage/test-report.json`——单 `--reporter=json` 吞默认控制台 reporter(实测控制台只剩 "JSON report written",无 Test Files/Duration 摘要),开发者看测试失败需下 artifact;多 reporter 保留人读摘要 + 产 json
- **T_PASS_MS/T_WARN_MS 占位 90000/180000**(Task 5 校准 `round(W×1.5)`/`round(W×3)`,W=基线 wall-clock;同 WARN_PENALTY 占位模式)
- **ESM**:`type:module`,import 用 `.js` 扩展
- **metric.ts shared**(M3b-HTML 抽的 dimMetric,report.ts + html.ts 共用,Task 3 加 performance case 自动生效)

---

## Task 1: collectPerformance 纯函数 + PerformanceReport 契约 + dimensions 配置

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\collectors\performance.ts`
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\test\scoring\performance.test.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\types.ts`(末尾加 `PerformanceReport`)
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\dimensions.ts`(加 `T_PASS_MS`/`T_WARN_MS`)

**Interfaces:**
- Produces: `collectPerformance(reportPath: string): DimensionResult`;`PerformanceReport` interface;`T_PASS_MS`/`T_WARN_MS` 常量(供 Task 2 generate-score 与 Task 4 CI 用)

- [ ] **Step 1: 写失败测试** `test/scoring/performance.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { collectPerformance } from '../../src/scoring/collectors/performance.js';
import { T_PASS_MS, T_WARN_MS } from '../../src/scoring/dimensions.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_perf__');
const REPORT = resolve(TMP, 'test-report.json');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

/** 造 vitest json:files 数组每个含 startTime/endTime(ms 时间戳) */
function writeVitestJson(files: { start: number; end: number }[]): void {
  writeFileSync(REPORT, JSON.stringify({
    numTotalTests: 100, numPassedTests: 100, startTime: 0,
    testResults: files.map(f => ({ name: 'a.test.ts', startTime: f.start, endTime: f.end, status: 'passed', assertionResults: [] })),
  }));
}

describe('collectPerformance', () => {
  it('wall-clock = max(endTime) - min(startTime)(串行)', () => {
    writeVitestJson([{ start: 1000, end: 5000 }, { start: 5000, end: 9000 }]); // 串行:9000-1000=8000
    const r = collectPerformance(REPORT);
    expect((r.raw as { wallclockMs: number }).wallclockMs).toBe(8000);
  });

  it('wall-clock 并行取最早开始到最晚结束(非 Σ per-file diff)——ADVISORY 3 锚定算法意图', () => {
    // 两文件并行重叠:start 都 1000,end 都 5000(并行 4s)。Σ per-file diff = 4000+4000=8000(错),max-min = 4000(对)
    writeVitestJson([{ start: 1000, end: 5000 }, { start: 1000, end: 5000 }]);
    const r = collectPerformance(REPORT);
    expect((r.raw as { wallclockMs: number }).wallclockMs).toBe(4000); // max(5000)-min(1000),非 8000
  });

  it(`曲线 ≤T_PASS_MS(${T_PASS_MS}ms)→ 100 pass`, () => {
    writeVitestJson([{ start: 0, end: 60000 }]);
    const r = collectPerformance(REPORT);
    expect(r.score).toBe(100);
    expect(r.status).toBe('pass');
  });

  it('曲线 =T_PASS_MS 边界 → 100 pass(≤闭区间)', () => {
    writeVitestJson([{ start: 0, end: T_PASS_MS }]);
    expect(collectPerformance(REPORT).score).toBe(100);
  });

  it(`曲线 T_PASS+0.5×间距(${T_PASS_MS + 0.5 * (T_WARN_MS - T_PASS_MS)}ms)→ 80 pass 边界`, () => {
    const ms = T_PASS_MS + 0.5 * (T_WARN_MS - T_PASS_MS);
    writeVitestJson([{ start: 0, end: ms }]);
    const r = collectPerformance(REPORT);
    expect(r.score).toBe(80);
    expect(r.status).toBe('pass');
  });

  it('曲线 =T_WARN_MS 边界 → 60 warn', () => {
    writeVitestJson([{ start: 0, end: T_WARN_MS }]);
    const r = collectPerformance(REPORT);
    expect(r.score).toBe(60);
    expect(r.status).toBe('warn');
  });

  it('曲线 >T_WARN_MS → <60 fail(线性 60→0)', () => {
    writeVitestJson([{ start: 0, end: T_WARN_MS + 0.75 * T_WARN_MS }]); // 60 - 0.75×60 = 15
    const r = collectPerformance(REPORT);
    expect(r.score).toBe(15);
    expect(r.status).toBe('fail');
  });

  it('曲线 极端超时 → 0 fail clamp', () => {
    writeVitestJson([{ start: 0, end: T_WARN_MS * 10 }]);
    const r = collectPerformance(REPORT);
    expect(r.score).toBe(0);
    expect(r.status).toBe('fail');
  });

  it('raw 回填 wallclockMs + testResults', () => {
    writeVitestJson([{ start: 0, end: 5000 }, { start: 1000, end: 6000 }]);
    expect(collectPerformance(REPORT).raw).toMatchObject({ wallclockMs: 6000, testResults: 2 });
  });

  it('文件不存在 → na', () => {
    const r = collectPerformance(resolve(TMP, 'nope.json'));
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('json 解析失败 → na', () => {
    writeFileSync(REPORT, '{不是合法 json');
    expect(collectPerformance(REPORT).status).toBe('na');
  });

  it('无 testResults → na', () => {
    writeFileSync(REPORT, JSON.stringify({ numTotalTests: 0 }));
    expect(collectPerformance(REPORT).status).toBe('na');
  });

  it('testResults 缺 startTime/endTime → na', () => {
    writeFileSync(REPORT, JSON.stringify({ testResults: [{ name: 'a' }] }));
    expect(collectPerformance(REPORT).status).toBe('na');
  });

  it('wall-clock 负值(endTime<startTime)→ na', () => {
    writeVitestJson([{ start: 5000, end: 1000 }]);
    expect(collectPerformance(REPORT).status).toBe('na');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/performance.test.ts`
Expected: FAIL(`performance.js` 模块找不到 / `T_PASS_MS` 未导出)

- [ ] **Step 3: 加 PerformanceReport interface** `src/scoring/types.ts`(末尾追加)

```ts
/** collectPerformance 产出 / 消费的共享契约(单位 ms 锁死,wallclockMs 是 score 唯一输入) */
export interface PerformanceReport {
  wallclockMs: number;     // 全套 wall-clock = max(testResults[].endTime) - min(testResults[].startTime)
  testResults: number;     // testResults 文件数(诊断)
}
```

- [ ] **Step 4: 加 T_PASS_MS/T_WARN_MS** `src/scoring/dimensions.ts`(末尾追加)

```ts
/** performance 绝对阈值(占位 90000/180000,Task 5 基线校准 round(W×1.5)/round(W×3)) */
export const T_PASS_MS = 90000;
export const T_WARN_MS = 180000;
```

- [ ] **Step 5: 实现 collectPerformance** `src/scoring/collectors/performance.ts`

```ts
import { readFileSync, existsSync } from 'fs';
import type { DimensionResult, DimensionStatus } from '../types.js';
import { WEIGHTS, NA_SCORE, T_PASS_MS, T_WARN_MS } from '../dimensions.js';

/**
 * 分段线性:≤T_PASS→100;T_PASS<≤T_WARN→线性100→60;>T_WARN→线性60→0 clamp。单位 ms。
 * warn→fail 段(60→0,跨度 T_WARN)退化比 pass→warn 段(100→60,跨度 T_WARN−T_PASS)宽——
 * 测试越慢扣分越缓,反映"测试慢是质量问题但非致命"(软扣分意图,ADVISORY 2)。
 */
function perfScore(ms: number): number {
  if (ms <= T_PASS_MS) return 100;
  if (ms <= T_WARN_MS) return 100 - (ms - T_PASS_MS) / (T_WARN_MS - T_PASS_MS) * 40;
  return Math.max(0, 60 - (ms - T_WARN_MS) / T_WARN_MS * 60);
}

/** 解析 vitest json → 全套 wall-clock(max endTime - min startTime,非 Σ duration)→ 绝对阈值分段线性。文件缺失/无字段/负值 → na。 */
export function collectPerformance(reportPath: string): DimensionResult {
  if (!existsSync(reportPath))
    return { score: NA_SCORE, weight: WEIGHTS.performance, status: 'na', detail: `报告不存在: ${reportPath}` };
  let report: { testResults?: { startTime?: number; endTime?: number }[] };
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
  catch (e) { return { score: NA_SCORE, weight: WEIGHTS.performance, status: 'na', detail: `解析失败: ${(e as Error).message}` }; }
  const files = report.testResults;
  if (!Array.isArray(files) || files.length === 0)
    return { score: NA_SCORE, weight: WEIGHTS.performance, status: 'na', detail: '无 testResults' };
  const starts = files.map(t => t.startTime).filter((x): x is number => typeof x === 'number');
  const ends = files.map(t => t.endTime).filter((x): x is number => typeof x === 'number');
  if (starts.length === 0 || ends.length === 0)
    return { score: NA_SCORE, weight: WEIGHTS.performance, status: 'na', detail: 'testResults 缺 startTime/endTime' };
  const wallclockMs = Math.max(...ends) - Math.min(...starts);
  if (wallclockMs < 0)
    return { score: NA_SCORE, weight: WEIGHTS.performance, status: 'na', detail: `wall-clock 负值: ${wallclockMs}` };
  const score = perfScore(wallclockMs);
  // 80/60 复制第4处(coverage 60/40 有意分化;integration/security/gdscript/performance 80/60);集中抽取 statusFromScore 待 N+1
  const status: DimensionStatus = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.performance, status, raw: { wallclockMs, testResults: files.length } };
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/performance.test.ts`
Expected: PASS(全部)

- [ ] **Step 7: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/collectors/performance.ts test/scoring/performance.test.ts src/scoring/types.ts src/scoring/dimensions.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "feat(scoring): collectPerformance 纯函数 + PerformanceReport 契约(M3d Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: generate-score + cli 接 performanceReportPath

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\generate-score.ts`(opts 加 `performanceReportPath`,接 `collectPerformance`)
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\cli.ts`(默认命令加路径)
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\test\scoring\generate-score.test.ts`(加 performance 测试)

**Interfaces:**
- Consumes: `collectPerformance`(Task 1)
- Produces: `generateScore` 接 `performanceReportPath`,performance 维度从 na 变真值

- [ ] **Step 1: 写失败测试** 追加到 `test/scoring/generate-score.test.ts` describe 块内

```ts
  it('有 performance report → performance 维度有值', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const PERF = resolve(TMP, 'perf.json');
    writeFileSync(PERF, JSON.stringify({
      numTotalTests: 10, numPassedTests: 10, startTime: 0,
      testResults: [{ name: 'a.test.ts', startTime: 0, endTime: 5000, status: 'passed', assertionResults: [] }],
    }));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, performanceReportPath: PERF });
    expect(s.dimensions.performance.score).toBe(100); // 5s ≤ T_PASS_MS
    expect(s.dimensions.performance.status).toBe('pass');
    expect(s.unverified).not.toContain('performance');
  });

  it('performance report 缺失 → performance 维度 na', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, performanceReportPath: resolve(TMP, 'nope.json') });
    expect(s.dimensions.performance.status).toBe('na');
    expect(s.unverified).toContain('performance');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/generate-score.test.ts -t performance`
Expected: FAIL(`performanceReportPath` 选项不存在)

- [ ] **Step 3: generate-score.ts 接入**

`GenerateScoreOptions` 加字段(在 `gdscriptReportPath` 后):
```ts
  /** vitest --reporter=json 全套产出;缺失→performance 维度 na */
  performanceReportPath?: string;
```
import 行加(`collectGdscript` 后):
```ts
import { collectPerformance } from './collectors/performance.js';
```
`generateScore` 内,`gdscript` 行后加:
```ts
  const performance = opts.performanceReportPath ? collectPerformance(opts.performanceReportPath) : na('performance');
```
dims 字典 `performance: na('performance')` 改为 `performance,`(独立变量 shorthand)。文件头注释更新:`M1 coverage + M2 integration + M3a security + M3c gdscript + M3d performance 有值`。

- [ ] **Step 4: cli.ts 默认命令加路径**

`src/scoring/cli.ts` 默认 score 分支(else),`gdscriptReportPath` 行后加:
```ts
    const performanceReportPath = resolve(process.cwd(), 'coverage/test-report.json');
```
`generateScore` 调用改为:
```ts
    const score = generateScore({ lcovPath, outPath, e2eReportPath, auditJsonPath, gdscriptReportPath, performanceReportPath });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/generate-score.test.ts`
Expected: PASS(全部,含新 performance 2 条)

- [ ] **Step 6: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/generate-score.ts src/scoring/cli.ts test/scoring/generate-score.test.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "feat(scoring): generate-score/cli 接 performanceReportPath(M3d Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: metric.ts dimMetric 加 performance case(report/html shared 自动)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\metric.ts`(switch 加 performance case)
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\test\scoring\metric.test.ts`(加 performance case 测试)

**Interfaces:**
- Consumes: performance 维度 DimensionResult.raw(`{wallclockMs, testResults}`,Task 1/2)
- Produces: report.ts + html.ts 的 performance 行显示 "Xs"(shared metric.ts,M3b-HTML 已抽)

- [ ] **Step 1: 写失败测试** 追加到 `test/scoring/metric.test.ts`

```ts
  it('dimMetric performance → wallclockMs/1000 s', () => {
    expect(dimMetric('performance', dim(100, 'pass', { wallclockMs: 52909, testResults: 170 }))).toBe('52.9s');
  });
```
(注:`dim` helper 在 metric.test.ts 已定义,Task 1 of M3b-HTML)

- [ ] **Step 2: 跑测试确认失败**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/metric.test.ts -t performance`
Expected: FAIL(performance case 走 default → '—')

- [ ] **Step 3: metric.ts 加 case**

`src/scoring/metric.ts` 的 `dimMetric` switch,`gdscript` case 后、`default` 前加:
```ts
    case 'performance':
      return `${round1((raw.wallclockMs ?? 0) / 1000)}s`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/metric.test.ts test/scoring/report.test.ts`
Expected: PASS(metric 新 case + report 现有不回归)

- [ ] **Step 5: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/metric.ts test/scoring/metric.test.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "feat(scoring): metric dimMetric performance case(M3d Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: CI vitest 多 reporter 产 test-report.json(IMPORTANT)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\.github\workflows\ci.yml`(check job `vitest run --coverage` 加多 reporter)

**Interfaces:**
- Consumes: `collectPerformance` 读 `coverage/test-report.json`(Task 1)
- Produces: CI check job 产出 `coverage/test-report.json`,score step 读它,performance 维度真实出分

- [ ] **Step 1: 改 ci.yml check job**

`.github/workflows/ci.yml` check job 的 `npx vitest run --coverage` step(`ci.yml:28` 附近)改为加多 reporter:
```yaml
      - run: npx vitest run --coverage --reporter=default --reporter=json --outputFile=coverage/test-report.json
```
**关键(IMPORTANT)**:`--reporter=default` 保留人读控制台摘要(Test Files/Tests/Duration),`--reporter=json --outputFile` 产 json。**单 `--reporter=json` 会吞 default**(实测控制台只剩 "JSON report written",开发者看失败需下 artifact);多 reporter 双全。

- [ ] **Step 2: 本地验证多 reporter(控制台有摘要 + 产 json)**

Run:
```bash
cd D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript
npx vitest run --reporter=default --reporter=json --outputFile=coverage/test-report.json 2>&1 | grep -E "Test Files|Duration|JSON report written" | head
```
Expected:输出含 `Test Files ... passed`(default 摘要)+ `Duration ...s` + `JSON report written`(json 产)。**三项都有** = 多 reporter 成立(对照单 reporter 只 "JSON report written")。

- [ ] **Step 3: tsc + lint 确认**

Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript exec tsc -- --noEmit && npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run lint`
Expected: tsc 0 / eslint 0

- [ ] **Step 4: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add .github/workflows/ci.yml
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "ci(scoring): vitest 多 reporter 产 test-report.json(default+json,M3d Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Task 0 基线校准 + final verify

**Files:**
- Modify(校准):`D:\GitHub\godot-mcp-enhanced\.claude\worktrees\m3c-gdscript\src\scoring\dimensions.ts`(`T_PASS_MS`/`T_WARN_MS` 校准值)

**目的**:基于真实 wall-clock 基线校准 `T_PASS_MS`/`T_WARN_MS`(ADVISORY 1 规则)+ final 全套绿。

- [ ] **Step 1: 量本地 wall-clock 基线**

Run:
```bash
cd D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript
node -e "const r=require('./coverage/test-report.json');const f=r.testResults;const w=Math.max(...f.map(t=>t.endTime))-Math.min(...f.map(t=>t.startTime));console.log('wallclockMs='+w)"
```
Expected:`wallclockMs=52909`(Task 0 实测,~52.9s;若重跑略波动属正常)。记 W_local。

- [ ] **Step 2: 按 ADVISORY 1 规则校准**

规则:`T_PASS_MS = round(W × 1.5)`、`T_WARN_MS = round(W × 3)`(W = 当前基线 wall-clock)。本地 W_local=52909:
- `T_PASS_MS = round(52909 × 1.5) = 79364 → 79000`(整数化)
- `T_WARN_MS = round(52909 × 3) = 158727 → 159000`

更新 `src/scoring/dimensions.ts`(替换占位 90000/180000):
```ts
export const T_PASS_MS = 79000;   // round(52909 × 1.5),Task 5 本地基线校准;CI 校准 follow-up(见 Step 4)
export const T_WARN_MS = 159000;  // round(52909 × 3)
```

- [ ] **Step 3: 同步 performance.test.ts 边界(用常量,不改测试)**

`performance.test.ts` 已用 `T_PASS_MS`/`T_WARN_MS` 常量(Task 1 Step 1),校准常量后测试自动适配边界值(无需改测试代码)。跑确认:
Run: `npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run test/scoring/performance.test.ts`
Expected: PASS(全部,常量改后边界自动重算)

- [ ] **Step 4: final verification**

Run:
```bash
npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript exec tsc -- --noEmit
npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run lint
npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run vitest -- run
```
Expected:tsc 0 / eslint 0 / vitest 全绿(含 performance/metric 新测试 + 现有不回归)。

- [ ] **Step 5: 本地 score 端到端(可选)**

Run:
```bash
npm --prefix D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript run build
node D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript/build/scoring/cli.js
```
(默认 score 命令读 `coverage/test-report.json` 若存在)。确认 score.json 的 `dimensions.performance` 从 na 变真值,`unverified` 不含 performance。

- [ ] **Step 6: Commit 校准**

```bash
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript add src/scoring/dimensions.ts
git -C D:/GitHub/godot-mcp-enhanced/.claude/worktrees/m3c-gdscript commit -m "fix(scoring): T_PASS_MS/T_WARN_MS 本地基线校准(M3d Task 5)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

**CI 校准 follow-up**(本地 ≠ CI runner 性能):CI 首跑后读 `coverage/test-report.json` 的 wallclockMs(W_ci),按 `round(W_ci × 1.5)`/`round(W_ci × 3)` 重算回填(若 W_ci 与本地 52909 差异大)。

---

## Self-Review(plan 写完后自查,已执行)

**1. Spec coverage**:
- collectPerformance(max-min wall-clock + 分段线性 + na 守卫)→ Task 1 ✓
- PerformanceReport interface(单位 ms 锁死)→ Task 1 ✓
- generate-score/cli 接 performanceReportPath(接入点 :42 + cli 默认路径)→ Task 2 ✓
- metric.ts dimMetric performance case(report/html shared 自动)→ Task 3 ✓
- CI vitest 多 reporter(IMPORTANT,default+json)→ Task 4 ✓
- T_PASS_MS/T_WARN_MS 占位 + Task 0 校准(ADVISORY 1 规则 round(W×1.5)/round(W×3))→ Task 1 + Task 5 ✓
- 无 HARD_FAILOUT → Global Constraints(不进 HARD_FAILOUTS)✓
- status 80/60 第4处复制(plan TODO statusFromScore)→ Task 1 注释 ✓
- IMPORTANT-1(max-min 非 Σ)→ Task 1 算法 + 测试(并行 max-min≠Σ ADVISORY 3)✓
- IMPORTANT-2(分段公式 + ≤边界 + 样例表)→ Task 1 perfScore + 测试曲线 ✓
- ADVISORY 2(软扣分意图 warn→fail 退化宽)→ Task 1 perfScore 注释 ✓
- ADVISORY 3(并行 max-min≠Σ 测试)→ Task 1 测试"并行取最早开始到最晚结束"用例 ✓

**2. Placeholder scan**:T_PASS_MS/T_WARN_MS 占位 90000/180000(Task 1)+ Task 5 校准 79000/159000——设计意图(依赖基线),非缺失。所有代码块完整(collectPerformance/perfScore/generate-score 改动/cli/metric/ci.yml/dimensions)。无 TBD。

**3. Type consistency**:`collectPerformance(reportPath: string): DimensionResult`(Task 1)→ generate-score(Task 2)调用同签名 ✓;`PerformanceReport.wallclockMs: number`(Task 1 types.ts)→ collectPerformance raw 回填 + metric.ts dimMetric 读 `raw.wallclockMs`(Task 3)一致 ✓;`T_PASS_MS`/`T_WARN_MS`(Task 1 dimensions.ts)→ collectPerformance + performance.test.ts import(Task 1)一致 ✓;`dimMetric(name, d)`(metric.ts)Task 3 加 performance case 签名不变 ✓。

无问题,plan 可执行。
