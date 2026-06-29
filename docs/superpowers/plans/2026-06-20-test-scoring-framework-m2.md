# 测试评分框架 M2(integration 维度接入)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐 task 执行。Steps 用 checkbox(`- [ ]`)跟踪。

**Goal:** 给评分层接入 integration 维度——`collectors/integration.ts` 解析 vitest `--reporter=json` 产出,算真实集成通过率进 score;CI `e2e-godot` job 产出 json + 上传 artifact。M2 **不动 e2e-full 测试本身**,非阻断,CI 保持并行不变慢,合并分留 M3 dashboard。

**Architecture:** 复用 M1 的 collectors 模式。`integration.ts` = 有副作用采集器(读 json 文件),纯解析逻辑可单测(mock json)。`generate-score.ts` 加可选 `e2eReportPath`,`cli.ts` 默认指向 `coverage/e2e-report.json`。通过率 = `passed/(passed+failed)`,**排除 pending(skip)**——skip 不是验证也不是失败。

**Tech Stack:** TypeScript 5.3 · Vitest 4.1.7(已验证 `--reporter=json --outputFile` 可用)· 纯 Node `fs`(零新依赖)。

**关联:** M1 已建 `src/scoring/` 骨架(types/dimensions/aggregate/coverage/generate-score/cli),本计划只**加一个 collector + 接入 + CI 接线**。

## Global Constraints

- `type: "module"`(ESM),所有内部 import 必须带 `.js` 扩展名
- 测试文件放 `test/scoring/*.test.ts`,被现有 vitest `include` 自动拾取,无需改 config
- `src/scoring/**/*.ts` 自动纳入 coverage 统计,新文件不得拉低现有 thresholds(60/51/69/61)
- 路径引用一律绝对(项目 CLAUDE.md 全局规则)
- commit message conventional + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`

## 现状校正(执行者必读)

- **M1 已落地**(fix/review-verification 分支,commit `c18effa`):`src/scoring/` 含 6 维类型/权重/聚合/coverage collector/generate-score/cli;`npm run score` 跑通,产出 `coverage/score.json`
- **e2e-full 已存在**:`test/e2e-full-tool-verification.test.ts`(46 测试,12 describe),通过 tool-registry 直接调 handleTool,`describe.skipIf(!hasGodot)` 隐式分层
- **ci.yml `e2e-godot` job** 已装 Godot 4.6.3 跑 e2e-full(无 continue-on-error,已是 gate)
- **vitest `--reporter=json --outputFile`** 在 v4.1.7 已实测可用,字段:`numTotalTests/numPassedTests/numFailedTests/numPendingTests/numTodoTests`
- **integration 权重 0.30,硬否决线 80**(M1 dimensions.ts 已配)

## integration 评分语义(本计划实现)

- **通过率 = `numPassedTests / (numPassedTests + numFailedTests) * 100`**——排除 `numPendingTests`(skip),因 skip 非"验证通过"也非"失败"
- **`passed+failed == 0`(全 skip,如本地无 Godot)→ `na`**(无真实集成数据,不虚高分)
- status 分级:`>=80 pass` / `[60,80) warn` / `<60 fail`(对齐硬否决线 80)
- 文件缺失/json 解析失败 → `na`

## File Structure

| 文件 | 职责 | 副作用 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\integration.ts` | `collectIntegration(jsonPath)`:解析 vitest json → DimensionResult | 读文件 |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts` | **改**:加 `e2eReportPath?` 选项,接入 collectIntegration | 读写文件 |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts` | **改**:默认 `e2eReportPath=coverage/e2e-report.json` | — |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\integration.test.ts` | meta-test:integration collector 全行为(mock json) | 临时文件 |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts` | **改**:加 integration 接入用例(不改现有 3 个) | 临时文件 |
| `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` | **改**:e2e-godot job 加 `--reporter=json --outputFile` + 上传 artifact | — |
| `D:\GitHub\godot-mcp-enhanced\docs\scoring.md` | **改**:integration 数据源标 done(M2) | — |

---

## Task 1: integration collector + meta-test

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\integration.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scoring\integration.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\scoring\integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { collectIntegration } from '../../src/scoring/collectors/integration.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_e2e__');
const JSON_PATH = resolve(TMP, 'e2e-report.json');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

/** 写一个最小合法 vitest json(reporter=json)结构,覆盖指定计数字段 */
function writeReport(fields: Record<string, number>): void {
  writeFileSync(JSON_PATH, JSON.stringify({
    numTotalTestSuites: 1, numPassedTestSuites: 0, numFailedTestSuites: 0,
    numPendingTestSuites: 0, startTime: 0, success: true, testResults: [],
    numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    ...fields,
  }));
}

describe('collectIntegration', () => {
  it('全通过 → score=100, status=pass', () => {
    writeReport({ numTotalTests: 40, numPassedTests: 40, numFailedTests: 0, numPendingTests: 0 });
    const r = collectIntegration(JSON_PATH);
    expect(r.score).toBe(100);
    expect(r.status).toBe('pass');
    expect(r.raw).toMatchObject({ passed: 40, failed: 0, ran: 40 });
  });

  it('部分失败 → 通过率 = passed/(passed+failed),排除 pending', () => {
    // 40 passed, 10 failed, 5 skip → 40/50 = 80
    writeReport({ numTotalTests: 55, numPassedTests: 40, numFailedTests: 10, numPendingTests: 5 });
    const r = collectIntegration(JSON_PATH);
    expect(r.score).toBe(80);
    expect(r.status).toBe('pass');
    expect(r.raw).toMatchObject({ passed: 40, failed: 10, pending: 5, ran: 50 });
  });

  it('[60,80) → status=warn', () => {
    // 35 passed, 15 failed → 70
    writeReport({ numTotalTests: 50, numPassedTests: 35, numFailedTests: 15, numPendingTests: 0 });
    const r = collectIntegration(JSON_PATH);
    expect(r.score).toBe(70);
    expect(r.status).toBe('warn');
  });

  it('低通过率(<60)→ status=fail', () => {
    // 20 passed, 30 failed → 40
    writeReport({ numTotalTests: 50, numPassedTests: 20, numFailedTests: 30, numPendingTests: 0 });
    const r = collectIntegration(JSON_PATH);
    expect(r.score).toBe(40);
    expect(r.status).toBe('fail');
  });

  it('全 skip(passed+failed==0,如本地无 Godot)→ na,不虚高分', () => {
    writeReport({ numTotalTests: 46, numPassedTests: 0, numFailedTests: 0, numPendingTests: 46 });
    const r = collectIntegration(JSON_PATH);
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('文件不存在 → na', () => {
    const r = collectIntegration(resolve(TMP, 'nope.json'));
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('json 解析失败 → na', () => {
    writeFileSync(JSON_PATH, '{不是合法 json');
    const r = collectIntegration(JSON_PATH);
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/integration.test.ts`
Expected: FAIL(`Cannot find module '../../src/scoring/collectors/integration.js'`)

- [ ] **Step 3: 写 integration.ts**

创建 `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\integration.ts`:

```ts
import { readFileSync, existsSync } from 'fs';
import type { DimensionResult } from '../types.js';
import { WEIGHTS, NA_SCORE } from '../dimensions.js';

/** vitest --reporter=json 产出的计数字段(只取需要的) */
interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
}

/**
 * 解析 vitest --reporter=json 产出,算真实集成通过率。
 * 通过率 = passed/(passed+failed)*100 —— 排除 pending(skip),因 skip 非"验证通过"也非"失败"。
 * passed+failed==0(全 skip,如本地无 Godot)→ na(无真实集成数据,不虚高分)。
 * 状态分级:>=80 pass,[60,80) warn,<60 fail(对齐 integration 硬否决线 80)。
 */
export function collectIntegration(jsonPath: string): DimensionResult {
  if (!existsSync(jsonPath)) {
    return { score: NA_SCORE, weight: WEIGHTS.integration, status: 'na', detail: `e2e json 不存在: ${jsonPath}` };
  }
  let report: VitestJsonReport;
  try {
    report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return { score: NA_SCORE, weight: WEIGHTS.integration, status: 'na', detail: `e2e json 解析失败: ${(e as Error).message}` };
  }
  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  const pending = report.numPendingTests ?? 0;
  const total = report.numTotalTests ?? (passed + failed + pending);
  const ran = passed + failed;
  if (ran === 0) {
    return {
      score: NA_SCORE, weight: WEIGHTS.integration, status: 'na',
      detail: 'e2e 全部 skip(无 Godot?),无真实集成数据',
      raw: { passed, failed, pending, total },
    };
  }
  const pct = (passed / ran) * 100;
  const score = Math.round(pct * 10) / 10;
  const status: DimensionResult['status'] = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.integration, status, raw: { passed, failed, pending, total, ran } };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/integration.test.ts`
Expected: PASS(7 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿,无错误

```bash
git add src/scoring/collectors/integration.ts test/scoring/integration.test.ts
git commit -m "feat(scoring): integration 采集器解析 vitest json(M2 Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: generate-score 接入 integration + cli 默认路径

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts`(只加新用例,不改现有 3 个)

- [ ] **Step 1: 改 generate-score.ts(加 e2eReportPath + 接入)**

在 `GenerateScoreOptions` 加可选字段,`generateScore` 内 integration 用 `collectIntegration` 替换 `na('integration')`:

```ts
import { writeFileSync } from 'fs';
import type { DimensionName, DimensionResult, ScoreJson } from './types.js';
import { computeScore } from './aggregate.js';
import { collectCoverage } from './collectors/coverage.js';
import { collectIntegration } from './collectors/integration.js';
import { WEIGHTS, NA_SCORE } from './dimensions.js';

export interface GenerateScoreOptions {
  lcovPath: string;
  outPath: string;
  godotVersion?: string;
  /** vitest --reporter=json 产出路径;缺失→integration 维度 na */
  e2eReportPath?: string;
}

/** n/a 维度占位(权重保留,供 aggregate 重分配) */
function na(name: DimensionName): DimensionResult {
  return { score: NA_SCORE, weight: WEIGHTS[name], status: 'na' };
}

/**
 * 组装 6 维(M1 coverage + M2 integration 有值),聚合,写 score.json。
 * 返回 ScoreJson。后续里程碑只需替换对应 na() 为真实采集器结果。
 */
export function generateScore(opts: GenerateScoreOptions): ScoreJson {
  const coverage = collectCoverage(opts.lcovPath);
  const integration = opts.e2eReportPath ? collectIntegration(opts.e2eReportPath) : na('integration');
  const dims: Record<DimensionName, DimensionResult> = {
    integration,
    coverage,
    security: na('security'),
    flaky: na('flaky'),
    performance: na('performance'),
    gdscript: na('gdscript'),
  };
  const score = computeScore(dims, {
    godotVersion: opts.godotVersion,
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(opts.outPath, JSON.stringify(score, null, 2) + '\n', 'utf8');
  return score;
}
```

- [ ] **Step 2: 改 cli.ts(默认 e2eReportPath)**

```ts
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { generateScore } from './generate-score.js';

// CLI 入口:node build/scoring/cli.js
const entry = fileURLToPath(import.meta.url);
const arg1 = process.argv[1];
const invoked = arg1 !== undefined && resolve(arg1) === entry;
if (invoked) {
  const lcovPath = resolve(process.cwd(), 'coverage/lcov.info');
  const outPath = resolve(process.cwd(), 'coverage/score.json');
  const e2eReportPath = resolve(process.cwd(), 'coverage/e2e-report.json');
  const score = generateScore({ lcovPath, outPath, e2eReportPath });
  process.stdout.write(
    `score: ${score.total} pass=${score.pass} partial=${score.partial} unverified=${score.unverified.length} → ${outPath}\n`,
  );
}
```

- [ ] **Step 3: 在 generate-score.test.ts 末尾(最后一个 it 后,Closing `});` 前)追加新用例**

```ts
  it('有 e2e json → integration 维度有值,通过率 = passed/(passed+failed)', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n')); // coverage 100
    const E2E = resolve(TMP, 'e2e.json');
    writeFileSync(E2E, JSON.stringify({
      numTotalTests: 40, numPassedTests: 36, numFailedTests: 4, numPendingTests: 0,
    })); // integration 36/40 = 90
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, e2eReportPath: E2E });
    expect(s.dimensions.integration.score).toBe(90);
    expect(s.dimensions.integration.status).toBe('pass');
    expect(s.unverified).not.toContain('integration');
    expect(s.unverified).not.toContain('coverage');
    // 仍 partial(security/flaky/performance/gdscript 4 维 na)
    expect(s.partial).toBe(true);
    expect(s.unverified).toHaveLength(4);
  });
```

> 注:现有 3 个用例不传 `e2eReportPath` → integration 保持 `na`,行为不变(不需改它们)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/generate-score.test.ts`
Expected: PASS(原 3 + 新 1 = 4 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/scoring/generate-score.ts src/scoring/cli.ts test/scoring/generate-score.test.ts
git commit -m "feat(scoring): generate-score 接入 integration 维度(M2 Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: CI e2e-godot job 产出 json + 上传 artifact

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`(仅 `e2e-godot` job 的 Run E2E step + 新增 upload step)

- [ ] **Step 1: 改 e2e-godot job 的 Run E2E step**

把现有:
```yaml
      - name: Run E2E (real Godot integration)
        run: npx vitest run test/e2e-full-tool-verification.test.ts
```
改为:
```yaml
      - name: Run E2E (real Godot integration)
        run: npx vitest run test/e2e-full-tool-verification.test.ts --reporter=json --outputFile=coverage/e2e-report.json
      - name: Upload e2e-report.json
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-report
          path: coverage/e2e-report.json
          if-no-files-found: warn
```

> `if: always()` 确保即使 E2E 有失败用例(json 仍会生成)也上传 artifact,供本地/M3 dashboard 取用。
> stdout 会是 json 格式(CI 日志可读性下降,但 `numPassedTests/success` 可见);如需可读日志,M3 可加 `--reporter=default` 多 reporter。
> **check job 不动**:它的 score 仍 coverage-only(integration n/a)。合并分留 M3 dashboard。

- [ ] **Step 2: 本地不验证 CI(CI 改动靠 push 后 GitHub Actions 验证)**

Run: `npx tsc --noEmit`(仅确认无语法连带;ci.yml 不经 tsc)

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(scoring): e2e-godot job 产出 json + 上传 artifact(M2 Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 文档更新 + 本地手验(有 integration 的合并分)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\docs\scoring.md`

- [ ] **Step 1: 改 docs/scoring.md 的 6 维表**

把 integration 行的"M2"改为"**done**",数据源改为"test/e2e-full(vitest json)"。

- [ ] **Step 2: 本地手验(生成 e2e json → npm run score → 看 integration 有值)**

Run:
```bash
npx tsc
npx vitest run test/e2e-full-tool-verification.test.ts --reporter=json --outputFile=coverage/e2e-report.json
npm run score
```
Expected:
- 末行 `score: <num> pass=<bool> partial=true unverified=4`(本地无 Godot 时 e2e 大量 skip → integration na → unverified 仍含 integration,这正常;**若有 Godot**,integration 维度 status=pass/warn,score.json 的 integration.score 为 0-100)
- 检查 `coverage/score.json`:`dimensions.integration` 有 raw(passed/failed/ran)或 status=na(本地无 Godot 时)
- 若本地有 Godot:total 含 integration 权重,unverified 应不含 integration

- [ ] **Step 3: 跑全量 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add docs/scoring.md
git commit -m "docs(scoring): integration 维度 done(M2 Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**:
- ✅ integration collector(解析 vitest json,通过率排除 skip)→ Task 1
- ✅ generate-score 接入 + cli 默认路径 → Task 2
- ✅ CI e2e-godot 产出 json + artifact → Task 3
- ✅ 文档 + 手验 → Task 4
- ⏭️ L1/L2/L3 重构 + @gpu 标记 + CI 合并汇总 job = 明确标 M2b/M3,YAGNI

**2. 现状风险**:
- 本地无 Godot → e2e json 全 skip → integration na(Task 4 Step 2 已说明预期,非 bug)
- CI check job 的 score 仍 coverage-only(方案 1 设计,合并留 M3)
- `--reporter=json` 使 e2e-godot job 的 stdout 变 json(可读性降,Task 3 已注)

**3. 类型一致性**:
- `collectIntegration(jsonPath): DimensionResult` 在 Task 1 定义、Task 2 消费,一致 ✅
- `GenerateScoreOptions.e2eReportPath?: string` 可选,现有用例不传→integration na,行为不变 ✅
- integration 权重 0.30/硬否决 80 复用 M1 dimensions.ts,不改 ✅

**4. 测试隔离**:integration.test.ts 用 `test/scoring/__tmp_e2e__/`(独立 TMP,与 coverage.test.ts 的 `__tmp_lcov__`、generate-score 的 `__tmp_gen__` 不冲突)✅

无问题,plan 可执行。

---

## 后续里程碑(本计划范围外)

- **M2b(可选)**:重构 e2e-full 为 L1/L2/L3 分层文件 + `@gpu` 标记(screenshot 等需 GPU 的 CI headless 跳过报"未验证")+ 分层评分。e2e-full 现有 `skipIf(!hasGodot)` 已隐式分层,显式重构非紧急。
- **M1.5 security 维度**:npm audit 或 AgentShield → `collectors/security.ts`
- **M3 全维 + dashboard**:flaky(重跑矩阵,治 M1 收尾发现的 Windows flaky)+ performance(profiler 基准)+ gdscript(GUT);dashboard 跨 artifact 合并 coverage(M1)+integration(M2)+其余维度。

各里程碑落地前各自再走一轮 brainstorming + 本计划格式(现状会再变)。
