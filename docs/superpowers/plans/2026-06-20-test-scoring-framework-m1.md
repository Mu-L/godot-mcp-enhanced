# 测试评分框架 M1(评分纯函数骨架)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐 task 执行。Steps 用 checkbox(`- [ ]`)跟踪。

**Goal:** 给 godot-mcp-enhanced 建立评分聚合层——纯函数把多维原始指标聚合成单一 `score.json`(0–100 + pass/fail + 硬否决),M1 先接 coverage 维度,其余维度留 `n/a` 但框架支持 6 维。

**Architecture:** 严格两层分离——`src/scoring/collectors/` 是有副作用的采集器(读文件/跑命令),`src/scoring/` 根目录是纯函数(吃标准化数据吐分数)。纯函数可单测(meta-test:评分系统自身被测)。`score.json` 作为 PR gate / dashboard / 发版的单一事实源。

**Tech Stack:** TypeScript 5.3 · Vitest 4.1(globals + coverage-v8)· fast-check 4.8(meta-test 属性测试,已在 devDeps)· 纯 Node `fs`(零新依赖)

## Global Constraints

- Node ≥ 18(engines);CI 跑 Node 22/24
- `type: "module"`(ESM),所有内部 import 必须带 `.js` 扩展名(项目惯例,见 `src/core/module-loader.ts`)
- 测试文件放 `test/scoring/*.test.ts`,被现有 vitest `include: ['test/**/*.test.{js,ts}']` 自动拾取,**无需改 vitest.config.ts**
- `src/scoring/**/*.ts` 自动纳入 coverage 统计(`include: ['src/**/*.ts']`),故 scoring 代码自身必须被 meta-test 覆盖
- coverage 现有 thresholds:statements 60 / branches 51 / functions 69 / lines 61——新文件不得拉低
- 路径引用一律绝对(项目 CLAUDE.md 全局规则),本计划 Files 块已用绝对路径

## 现状校正(关键背景,执行者必读)

执行前须知晓项目已有的基础设施(避免重复造轮子):

- **CI 已装真实 Godot 4.6.3 跑 E2E**:`D:\GitHub\godot-ai-kit\enhanced\.github\workflows\ci.yml` 的 `e2e-godot` job,跑 `test\e2e-full-tool-verification.test.ts`
- **真实集成测试已存在**:`D:\GitHub\godot-ai-kit\enhanced\test\e2e-full-tool-verification.test.ts`,通过 `tool-registry` 直接调 `handleTool`,`GODOT_PATH` 默认空(IMPORTANT-9b,防静默假绿)
- **coverage 已生成 lcov**:CI 跑 `npx vitest run --coverage` 产出 `coverage\lcov.info`,上传 codecov
- **dashboard 已有 TUI**:`D:\GitHub\godot-ai-kit\enhanced\src\dashboard\`(M1 不接,M3 再接 score.json)

**M1 不碰这些**。M1 只新建 `src\scoring\`,纯增量,零修改现有文件(除末尾 Task 5 给 ci.yml 加一个非阻断 step)。

## 6 维评分模型(本计划实现的配置值)

| 维度 | 权重 | M1 状态 | 硬否决线 |
|---|---|---|---|
| integration(真实集成) | 0.30 | `n/a`(M2 接 e2e-full) | < 80 直接 fail |
| coverage(单元覆盖) | 0.20 | **M1 接 lcov** | — |
| security(安全扫描) | 0.20 | `n/a`(M1.5 接 npm audit/AgentShield) | < 60 直接 fail |
| flaky(重跑稳定) | 0.10 | `n/a`(M3) | — |
| performance(性能基准) | 0.10 | `n/a`(M3) | — |
| gdscript(GUT 插件) | 0.10 | `n/a`(M3) | — |

- **pass 线 = 75**;`n/a` 维度的权重按比例重分配给有值维度(M1 实测时 coverage 独占 100% 权重)
- 任一硬否决触发 → `pass = false`,不看总分

## File Structure

| 文件 | 职责 | 副作用 |
|---|---|---|
| `D:\GitHub\godot-ai-kit\enhanced\src\scoring\types.ts` | 类型定义:DimensionName / DimensionResult / ScoreJson / HardFail | 无(纯类型) |
| `D:\GitHub\godot-ai-kit\enhanced\src\scoring\dimensions.ts` | 6 维权重 + 硬否决阈值 + pass 线配置 | 无(纯常量) |
| `D:\GitHub\godot-ai-kit\enhanced\src\scoring\aggregate.ts` | `computeScore()` 纯函数:权重重分配 + 总分 + 硬否决 | 无(纯函数) |
| `D:\GitHub\godot-ai-kit\enhanced\src\scoring\collectors\coverage.ts` | `collectCoverage(lcovPath)`:解析 lcov → DimensionResult | 读文件 |
| `D:\GitHub\godot-ai-kit\enhanced\src\scoring\generate-score.ts` | 组装 6 维(5 个 n/a + coverage)→ computeScore → 写 score.json | 读写文件 |
| `D:\GitHub\godot-ai-kit\enhanced\src\scoring\cli.ts` | CLI 入口:main 检测 + 调 generateScore | 读 lcov/写 score.json |
| `D:\GitHub\godot-ai-kit\enhanced\test\scoring\aggregate.test.ts` | meta-test:aggregate 纯函数全行为 | 无 |
| `D:\GitHub\godot-ai-kit\enhanced\test\scoring\coverage.test.ts` | coverage 采集器单测(含 mock lcov) | 无 |
| `D:\GitHub\godot-ai-kit\enhanced\test\scoring\generate-score.test.ts` | 入口集成测(临时目录写 score.json 断言) | 临时文件 |
| `D:\GitHub\godot-ai-kit\enhanced\coverage\score.json` | 产物:CI 生成的评分快照 | 运行时产物 |

---

## Task 1: 类型与维度配置

**Files:**
- Create: `D:\GitHub\godot-ai-kit\enhanced\src\scoring\types.ts`
- Create: `D:\GitHub\godot-ai-kit\enhanced\src\scoring\dimensions.ts`
- Test: `D:\GitHub\godot-ai-kit\enhanced\test\scoring\dimensions.test.ts`

**Interfaces:**
- Produces: `DimensionName`(6 维字面量联合)、`DimensionResult`(`{score, weight, status, raw?, detail?}`)、`ScoreJson`、`HardFail`;`WEIGHTS`、`HARD_FAILOUTS`、`PASS_LINE`、`NA_SCORE`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-ai-kit\enhanced\test\scoring\dimensions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WEIGHTS, HARD_FAILOUTS, PASS_LINE, NA_SCORE } from '../../src/scoring/dimensions.js';

describe('dimensions config', () => {
  it('6 维权重之和 = 1', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000) / 1000).toBe(1);
  });

  it('pass 线 = 75', () => {
    expect(PASS_LINE).toBe(75);
  });

  it('硬否决覆盖 security(60)与 integration(80)', () => {
    expect(HARD_FAILOUTS.security).toBe(60);
    expect(HARD_FAILOUTS.integration).toBe(80);
  });

  it('NA_SCORE = -1(表示未采集)', () => {
    expect(NA_SCORE).toBe(-1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/dimensions.test.ts`
Expected: FAIL,`Failed to load url ../../src/scoring/dimensions.js`(文件不存在)

- [ ] **Step 3: 写 types.ts**

创建 `D:\GitHub\godot-ai-kit\enhanced\src\scoring\types.ts`:

```ts
/** 6 个评分维度 */
export type DimensionName =
  | 'integration'
  | 'coverage'
  | 'security'
  | 'flaky'
  | 'performance'
  | 'gdscript';

export type DimensionStatus = 'pass' | 'warn' | 'fail' | 'na';

/** 单维度标准化结果(采集器产出,评分函数消费) */
export interface DimensionResult {
  /** 0-100;NA_SCORE(-1)表示未采集 */
  score: number;
  /** 该维度权重(0-1),来自 WEIGHTS */
  weight: number;
  status: DimensionStatus;
  /** 原始指标,采集器自行填充 */
  raw?: unknown;
  detail?: string;
}

/** 硬否决记录:某维度低于红线,无视总分直接 fail */
export interface HardFail {
  dimension: DimensionName;
  reason: string;
  threshold: number;
  actual: number;
}

/** 评分产物——PR gate / dashboard / 发版的单一事实源 */
export interface ScoreJson {
  total: number;          // 0-100,一位小数
  pass: boolean;          // total>=PASS_LINE 且无硬否决
  partial: boolean;       // 存在 n/a 维度
  godotVersion?: string;
  generatedAt: string;    // ISO 时间
  dimensions: Record<DimensionName, DimensionResult>;
  unverified: DimensionName[];   // score===NA_SCORE 的维度
  hardFails: HardFail[];
}
```

- [ ] **Step 4: 写 dimensions.ts**

创建 `D:\GitHub\godot-ai-kit\enhanced\src\scoring\dimensions.ts`:

```ts
import type { DimensionName } from './types.js';

/** 维度权重,加总 = 1。改动须同步更新 test/scoring/dimensions.test.ts */
export const WEIGHTS: Record<DimensionName, number> = {
  integration: 0.30,
  coverage: 0.20,
  security: 0.20,
  flaky: 0.10,
  performance: 0.10,
  gdscript: 0.10,
};

/** 硬否决线:维度低于此值直接 fail,不看总分 */
export const HARD_FAILOUTS: Partial<Record<DimensionName, number>> = {
  security: 60,
  integration: 80,
};

/** 总分 pass 线 */
export const PASS_LINE = 75;

/** 未采集哨兵值 */
export const NA_SCORE = -1;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/scoring/dimensions.test.ts`
Expected: PASS(4 个 it 全绿)

- [ ] **Step 6: 跑全量确认未破坏现有测试**

Run: `npx vitest run`
Expected: 现有全绿 + 新增 4 个 pass,无新增 fail

- [ ] **Step 7: 类型检查 + 提交**

Run: `npx tsc --noEmit`
Expected: 无错误

```bash
git add src/scoring/types.ts src/scoring/dimensions.ts test/scoring/dimensions.test.ts
git commit -m "feat(scoring): 评分维度类型与权重配置(M1 Task 1)"
```

---

## Task 2: 聚合纯函数 computeScore(meta-test 核心)

**Files:**
- Create: `D:\GitHub\godot-ai-kit\enhanced\src\scoring\aggregate.ts`
- Test: `D:\GitHub\godot-ai-kit\enhanced\test\scoring\aggregate.test.ts`

**Interfaces:**
- Consumes: `DimensionName`、`DimensionResult`、`ScoreJson`、`HardFail`(Task 1);`WEIGHTS`、`HARD_FAILOUTS`、`PASS_LINE`、`NA_SCORE`(Task 1)
- Produces: `computeScore(dims, meta): ScoreJson`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-ai-kit\enhanced\test\scoring\aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeScore } from '../../src/scoring/aggregate.js';
import type { DimensionName, DimensionResult } from '../../src/scoring/types.js';
import { WEIGHTS, NA_SCORE } from '../../src/scoring/dimensions.js';

const NA: DimensionResult = { score: NA_SCORE, weight: 0, status: 'na' };

/** 构造全部 6 维,score 覆盖给定值,其余 n/a */
function only(dim: DimensionName, score: number, status: DimensionResult['status'] = 'pass'): Record<DimensionName, DimensionResult> {
  const d: Record<DimensionName, DimensionResult> = {
    integration: { ...NA, weight: WEIGHTS.integration },
    coverage: { ...NA, weight: WEIGHTS.coverage },
    security: { ...NA, weight: WEIGHTS.security },
    flaky: { ...NA, weight: WEIGHTS.flaky },
    performance: { ...NA, weight: WEIGHTS.performance },
    gdscript: { ...NA, weight: WEIGHTS.gdscript },
  };
  d[dim] = { score, weight: WEIGHTS[dim], status };
  return d;
}

describe('computeScore', () => {
  it('单一维度有值时,权重重分配使其独占 100% → total = 该维度分', () => {
    const s = computeScore(only('coverage', 80), { generatedAt: '2026-06-20T00:00:00Z' });
    expect(s.total).toBe(80);
    expect(s.unverified).not.toContain('coverage');
    expect(s.partial).toBe(true);
  });

  it('pass 线:total=75 → pass;total=74 → fail', () => {
    const ok = computeScore(only('coverage', 75), { generatedAt: 't' });
    const no = computeScore(only('coverage', 74), { generatedAt: 't' });
    expect(ok.pass).toBe(true);
    expect(no.pass).toBe(false);
  });

  it('硬否决:security=50(< 60)→ pass=false 且 hardFails 记录', () => {
    const s = computeScore(only('security', 50, 'fail'), { generatedAt: 't' });
    expect(s.pass).toBe(false);
    expect(s.hardFails).toHaveLength(1);
    expect(s.hardFails[0].dimension).toBe('security');
    expect(s.hardFails[0].actual).toBe(50);
  });

  it('硬否决:即使总分高,security 低仍 fail', () => {
    // coverage=100 + security=50,权重各 0.2(重分配后各占 0.5)→ total=75,
    // 但 security<60 触发硬否决
    const dims = only('coverage', 100);
    dims.security = { score: 50, weight: WEIGHTS.security, status: 'fail' };
    const s = computeScore(dims, { generatedAt: 't' });
    expect(s.total).toBeGreaterThanOrEqual(75);
    expect(s.pass).toBe(false);
    expect(s.hardFails.some(h => h.dimension === 'security')).toBe(true);
  });

  it('integration 硬否决线 = 80', () => {
    const s = computeScore(only('integration', 79, 'warn'), { generatedAt: 't' });
    expect(s.hardFails.some(h => h.dimension === 'integration')).toBe(true);
    expect(s.pass).toBe(false);
  });

  it('全 n/a → total=0, pass=false, unverified 全 6 维', () => {
    const dims: Record<DimensionName, DimensionResult> = {
      integration: { ...NA, weight: WEIGHTS.integration },
      coverage: { ...NA, weight: WEIGHTS.coverage },
      security: { ...NA, weight: WEIGHTS.security },
      flaky: { ...NA, weight: WEIGHTS.flaky },
      performance: { ...NA, weight: WEIGHTS.performance },
      gdscript: { ...NA, weight: WEIGHTS.gdscript },
    };
    const s = computeScore(dims, { generatedAt: 't' });
    expect(s.total).toBe(0);
    expect(s.pass).toBe(false);
    expect(s.unverified).toHaveLength(6);
  });

  it('total 保留一位小数', () => {
    // coverage=85,独占 → 85.0
    const s = computeScore(only('coverage', 85), { generatedAt: 't' });
    expect(s.total).toBe(85);
    // 非整数场景:coverage=100 + security=33,各 0.2 重分配各 0.5 → 66.5
    const dims = only('coverage', 100);
    dims.security = { score: 33, weight: WEIGHTS.security, status: 'warn' };
    const s2 = computeScore(dims, { generatedAt: 't' });
    expect(s2.total).toBe(66.5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/aggregate.test.ts`
Expected: FAIL(模块未找到)

- [ ] **Step 3: 写 aggregate.ts**

创建 `D:\GitHub\godot-ai-kit\enhanced\src\scoring\aggregate.ts`:

```ts
import type { DimensionName, DimensionResult, ScoreJson, HardFail } from './types.js';
import { WEIGHTS, HARD_FAILOUTS, PASS_LINE, NA_SCORE } from './dimensions.js';

/**
 * 纯函数:把 6 维标准化结果聚合成 ScoreJson。
 * - n/a 维度的权重按比例重分配给有值维度
 * - 任一硬否决维度低于红线 → pass=false(无视总分)
 * - total 保留一位小数
 * 无 IO,可单测。
 */
export function computeScore(
  dims: Record<DimensionName, DimensionResult>,
  meta: { godotVersion?: string; generatedAt: string },
): ScoreJson {
  const all = Object.keys(dims) as DimensionName[];
  const active = all.filter(k => dims[k].score !== NA_SCORE);
  const unverified = all.filter(k => dims[k].score === NA_SCORE);

  // 权重重分配:n/a 的权重补给有值维度
  const activeWeightSum = active.reduce((s, k) => s + WEIGHTS[k], 0);
  const total = activeWeightSum > 0
    ? active.reduce((s, k) => s + dims[k].score * (WEIGHTS[k] / activeWeightSum), 0)
    : 0;

  // 硬否决检测
  const hardFails: HardFail[] = [];
  for (const k of active) {
    const threshold = HARD_FAILOUTS[k];
    if (threshold !== undefined && dims[k].score < threshold) {
      hardFails.push({
        dimension: k,
        reason: `${k} 得分 ${dims[k].score} 低于硬否决线 ${threshold}`,
        threshold,
        actual: dims[k].score,
      });
    }
  }

  const pass = hardFails.length === 0 && total >= PASS_LINE;

  return {
    total: Math.round(total * 10) / 10,
    pass,
    partial: unverified.length > 0,
    godotVersion: meta.godotVersion,
    generatedAt: meta.generatedAt,
    dimensions: dims,
    unverified,
    hardFails,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/aggregate.test.ts`
Expected: PASS(7 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿,无类型错误

```bash
git add src/scoring/aggregate.ts test/scoring/aggregate.test.ts
git commit -m "feat(scoring): computeScore 纯函数 + 硬否决 + 权重重分配(M1 Task 2)"
```

---

## Task 3: coverage 采集器(对接现有 lcov)

**Files:**
- Create: `D:\GitHub\godot-ai-kit\enhanced\src\scoring\collectors\coverage.ts`
- Test: `D:\GitHub\godot-ai-kit\enhanced\test\scoring\coverage.test.ts`

**Interfaces:**
- Consumes: `DimensionResult`(Task 1)、`WEIGHTS`、`NA_SCORE`(Task 1)
- Produces: `collectCoverage(lcovPath: string): DimensionResult`——解析 lcov `DA:` 行算语句命中率

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-ai-kit\enhanced\test\scoring\coverage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { collectCoverage } from '../../src/scoring/collectors/coverage.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_lcov__');
const LCOV = resolve(TMP, 'lcov.info');

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('collectCoverage', () => {
  it('解析 lcov DA 行:命中/总数 → 百分比', () => {
    // 4 行,2 行命中 → 50%
    writeFileSync(LCOV, [
      'TN:',
      'SF:src/foo.ts',
      'DA:1,3',
      'DA:2,0',
      'DA:3,5',
      'DA:4,0',
      'LF:4',
      'LH:2',
      'end_of_record',
    ].join('\n'));
    const r = collectCoverage(LCOV);
    expect(r.score).toBe(50);
    expect(r.status).toBe('warn');   // 50 ∈ [40,60) → warn
    expect(r.raw).toMatchObject({ hit: 2, found: 4 });
  });

  it('100% 覆盖 → score=100, status=pass', () => {
    writeFileSync(LCOV, ['SF:src/bar.ts', 'DA:1,1', 'DA:2,2', 'end_of_record'].join('\n'));
    const r = collectCoverage(LCOV);
    expect(r.score).toBe(100);
    expect(r.status).toBe('pass');
  });

  it('低覆盖(< 40)→ status=fail', () => {
    writeFileSync(LCOV, ['SF:x', 'DA:1,0', 'DA:2,0', 'DA:3,1', 'DA:4,0', 'DA:5,0', 'end_of_record'].join('\n'));
    const r = collectCoverage(LCOV);
    expect(r.score).toBe(20);
    expect(r.status).toBe('fail');
  });

  it('文件不存在 → status=na, score=-1', () => {
    const r = collectCoverage(resolve(TMP, 'nope.info'));
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('无 DA 行 → na', () => {
    writeFileSync(LCOV, ['SF:empty.ts', 'end_of_record'].join('\n'));
    const r = collectCoverage(LCOV);
    expect(r.status).toBe('na');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/coverage.test.ts`
Expected: FAIL(模块未找到)

- [ ] **Step 3: 写 coverage.ts**

创建 `D:\GitHub\godot-ai-kit\enhanced\src\scoring\collectors\coverage.ts`:

```ts
import { readFileSync, existsSync } from 'fs';
import type { DimensionResult } from '../types.js';
import { WEIGHTS, NA_SCORE } from '../dimensions.js';

/**
 * 解析 lcov.info,按 DA: 行(line data)算语句命中率。
 * 状态分级:>=60 pass,[40,60) warn,<40 fail。
 * 文件缺失或无 DA 行 → na。
 */
export function collectCoverage(lcovPath: string): DimensionResult {
  if (!existsSync(lcovPath)) {
    return {
      score: NA_SCORE,
      weight: WEIGHTS.coverage,
      status: 'na',
      detail: `lcov 不存在: ${lcovPath}`,
    };
  }
  const text = readFileSync(lcovPath, 'utf8');
  let found = 0;
  let hit = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('DA:')) {
      const parts = line.slice(3).split(',');
      found++;
      if (Number(parts[1]) > 0) hit++;
    }
  }
  if (found === 0) {
    return {
      score: NA_SCORE,
      weight: WEIGHTS.coverage,
      status: 'na',
      detail: 'lcov 无 DA 行',
    };
  }
  const pct = (hit / found) * 100;
  const score = Math.round(pct * 10) / 10;
  const status: DimensionResult['status'] = score >= 60 ? 'pass' : score >= 40 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.coverage, status, raw: { hit, found, pct } };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/coverage.test.ts`
Expected: PASS(5 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿,无错误

```bash
git add src/scoring/collectors/coverage.ts test/scoring/coverage.test.ts
git commit -m "feat(scoring): coverage 采集器解析 lcov(M1 Task 3)"
```

---

## Task 4: 评分入口 generate-score(写 score.json)+ CLI

**Files:**
- Create: `D:\GitHub\godot-ai-kit\enhanced\src\scoring\generate-score.ts`
- Create: `D:\GitHub\godot-ai-kit\enhanced\src\scoring\cli.ts`
- Test: `D:\GitHub\godot-ai-kit\enhanced\test\scoring\generate-score.test.ts`

**Interfaces:**
- Consumes: `collectCoverage`(Task 3)、`computeScore`(Task 2)、`WEIGHTS`、`NA_SCORE`、`DimensionResult`、`DimensionName`
- Produces: `generateScore({ lcovPath, outPath, godotVersion? }): ScoreJson`(副作用:写 outPath);`cli.ts` 做 main 检测 + 读 `coverage/lcov.info` → 写 `coverage/score.json`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-ai-kit\enhanced\test\scoring\generate-score.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { generateScore } from '../../src/scoring/generate-score.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_gen__');
const LCOV = resolve(TMP, 'lcov.info');
const OUT = resolve(TMP, 'score.json');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('generateScore', () => {
  it('读 lcov → 写 score.json,coverage 维度有值,其余 5 维 n/a', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, godotVersion: '4.6' });
    expect(s.total).toBe(100);
    expect(s.pass).toBe(true);
    expect(s.partial).toBe(true);
    expect(s.dimensions.coverage.status).toBe('pass');
    expect(s.dimensions.security.status).toBe('na');
    expect(s.unverified).toHaveLength(5);
    expect(s.unverified).not.toContain('coverage');

    // 文件落地
    expect(existsSync(OUT)).toBe(true);
    const onDisk = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(onDisk.total).toBe(100);
    expect(onDisk.godotVersion).toBe('4.6');
  });

  it('lcov 缺失 → coverage 也 n/a,total=0,pass=false', () => {
    const s = generateScore({ lcovPath: resolve(TMP, 'nope.info'), outPath: OUT });
    expect(s.total).toBe(0);
    expect(s.pass).toBe(false);
    expect(s.unverified).toHaveLength(6);
  });

  it('生成的 JSON 含 generatedAt(ISO 字符串)', () => {
    writeFileSync(LCOV, ['SF:x', 'DA:1,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT });
    expect(() => new Date(s.generatedAt).toISOString()).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/generate-score.test.ts`
Expected: FAIL(模块未找到)

- [ ] **Step 3: 写 generate-score.ts**

创建 `D:\GitHub\godot-ai-kit\enhanced\src\scoring\generate-score.ts`:

```ts
import { writeFileSync } from 'fs';
import type { DimensionName, DimensionResult, ScoreJson } from './types.js';
import { computeScore } from './aggregate.js';
import { collectCoverage } from './collectors/coverage.js';
import { WEIGHTS, NA_SCORE } from './dimensions.js';

export interface GenerateScoreOptions {
  lcovPath: string;
  outPath: string;
  godotVersion?: string;
}

/** n/a 维度占位(权重保留,供 aggregate 重分配) */
function na(name: DimensionName): DimensionResult {
  return { score: NA_SCORE, weight: WEIGHTS[name], status: 'na' };
}

/**
 * 组装 6 维(M1 仅 coverage 有值),聚合,写 score.json。
 * 返回 ScoreJson。后续里程碑只需替换对应 na() 为真实采集器结果。
 */
export function generateScore(opts: GenerateScoreOptions): ScoreJson {
  const coverage = collectCoverage(opts.lcovPath);
  const dims: Record<DimensionName, DimensionResult> = {
    integration: na('integration'),
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

> 移除 CLI 块:generate-score.ts 保持纯导出(无 main 检测/无 require),CLI 入口独立到 cli.ts。

创建 `D:\GitHub\godot-ai-kit\enhanced\src\scoring\cli.ts`(CLI 入口,隔离 main 检测,顶层 import 替代 ESM 非法的 require):

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
  const score = generateScore({ lcovPath, outPath });
  process.stdout.write(
    `score: ${score.total} pass=${score.pass} partial=${score.partial} unverified=${score.unverified.length} → ${outPath}\n`,
  );
}
```

> 注:`fileURLToPath` + `resolve(argv)` 比对是 ESM 下可靠的 main 检测,替代脆弱的 `import.meta.url.endsWith`;顶层 `import` 替代 ESM 非法的 `require('path')`。cli.ts 不纳入单测,仅手动/CI 触发。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/generate-score.test.ts`
Expected: PASS(3 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿(require 已移除,改顶层 import + fileURLToPath,无 ESM 报错风险)

```bash
git add src/scoring/generate-score.ts test/scoring/generate-score.test.ts
git commit -m "feat(scoring): generate-score 入口 + score.json 产物(M1 Task 4)"
```

---

## Task 5: npm script + CI 集成(非阻断)+ 文档

**Files:**
- Modify: `D:\GitHub\godot-ai-kit\enhanced\package.json`(scripts 段加 `score`)
- Modify: `D:\GitHub\godot-ai-kit\enhanced\.github\workflows\ci.yml`(check job 加非阻断 step)
- Create: `D:\GitHub\godot-ai-kit\enhanced\docs\scoring.md`(评分层说明)

**Interfaces:** 无新导出;仅接线。

- [ ] **Step 1: package.json 加 script**

在 `D:\GitHub\godot-ai-kit\enhanced\package.json` 的 `"scripts"` 内,`"test:coverage"` 之后加:

```json
    "score": "node build/scoring/cli.js",
```

(放在 `"test:coverage": "vitest run --coverage",` 与 `"test:integration"` 之间)

- [ ] **Step 2: 本地手验 score 链路**

Run:
```bash
npx tsc
npx vitest run --coverage
npm run score
```
Expected: 末行输出 `score: <num> pass=<bool> partial=true unverified=5 → ...coverage\score.json`,且 `coverage\score.json` 存在、JSON 合法、coverage 维度 status=pass/warn(非 na)

- [ ] **Step 3: ci.yml 加非阻断 step**

在 `D:\GitHub\godot-ai-kit\enhanced\.github\workflows\ci.yml` 的 `check` job 内,`npx vitest run --coverage` 之后、`codecov` step 之前插入:

```yaml
      - name: Generate score.json (M1, non-blocking)
        run: |
          npm run build
          npm run score || true
        continue-on-error: true
      - name: Upload score.json
        uses: actions/upload-artifact@v4
        with:
          name: score-json
          path: coverage/score.json
          if-no-files-found: warn
```

> **M1 不阻断 CI**:`|| true` + `continue-on-error: true`。score 仅作产物上传,PR gate 阻断留给 M2(全维度就绪后)。

- [ ] **Step 4: 写 docs/scoring.md**

创建 `D:\GitHub\godot-ai-kit\enhanced\docs\scoring.md`:

```markdown
# 评分层(Scoring)

把多维质量指标聚合成单一 `coverage/score.json`,作为 PR gate / dashboard / 发版就绪度的单一事实源。

## 6 维模型

| 维度 | 权重 | 数据源 | 硬否决 |
|---|---|---|---|
| integration | 0.30 | test/e2e-full(M2) | < 80 |
| coverage | 0.20 | coverage/lcov.info | — |
| security | 0.20 | npm audit/AgentShield(M1.5) | < 60 |
| flaky | 0.10 | 重跑矩阵(M3) | — |
| performance | 0.10 | profiler 基准(M3) | — |
| gdscript | 0.10 | GUT(M3) | — |

pass 线 = 75。n/a 维度权重按比例重分配给有值维度。

## 运行

    npm run score

读 `coverage/lcov.info`,写 `coverage/score.json`。

## 架构约束

- `src/scoring/` 根 = 纯函数(可单测),`src/scoring/collectors/` = 有副作用采集器
- meta-test:`test/scoring/aggregate.test.ts` 验证评分系统自身(硬否决、权重重分配、pass 线)
- 新维度接入:实现 `collectors/<name>.ts` 返回 DimensionResult,在 generate-score.ts 用它替换对应 `na()`
```

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit && npm run score`
Expected: 全绿,score.json 生成

```bash
git add package.json .github/workflows/ci.yml docs/scoring.md
git commit -m "feat(scoring): npm score 脚本 + CI 非阻断产物 + 文档(M1 Task 5)"
```

---

## Self-Review(执行前自查清单)

**1. Spec 覆盖**:
- ✅ 6 维类型/权重/阈值 → Task 1
- ✅ 聚合 + 硬否决 + 权重重分配 → Task 2
- ✅ coverage 数据源(对接现有 lcov)→ Task 3
- ✅ score.json 产物 + CLI → Task 4
- ✅ 接线(npm script + CI + 文档)→ Task 5
- ⏭️ integration/security/flaky/performance/gdscript 维度 = 明确标 M1.5/M2/M3,本计划范围外(YAGNI)

**2. Placeholder 扫描**:无 TBD/TODO;所有 step 含完整代码或精确命令。

**3. 类型一致性**:
- `DimensionResult.score` 全程 number;`NA_SCORE = -1` 在 types/dimensions/aggregate/collectors/generate-test 一致 ✅
- `computeScore` 签名 `(dims, meta)` 在 Task 2 定义、Task 4 消费,一致 ✅
- `collectCoverage(lcovPath): DimensionResult` 在 Task 3 定义、Task 4 消费,一致 ✅
- `WEIGHTS` 键集 = `DimensionName` 6 值,Task 1 测试断言加总=1 ✅

**4. 现状风险**:
- ~~`require('path')`/`import.meta.url` main 检测脆弱~~ → 已修(v3):CLI 拆到 cli.ts 用 `fileURLToPath` 比对 + 顶层 import,generate-score.ts 纯导出
- coverage thresholds 60/51/69/61:新增 scoring 文件被 meta-test 覆盖,预计 >90%,不拉低 ✅
- ci.yml 改动用 `continue-on-error` + `|| true`,不阻断现有 CI ✅

---

## 后续里程碑(重新定义,本计划范围外)

基于现状校正,M2/M3 已不是"从零搭建",而是"接已有基础设施":

- **M1.5 security 维度**:定数据源(npm audit JSON 或 AgentShield)→ `collectors/security.ts` → 替换 `na('security')`。决策点:用哪个扫描器。
- **M2 integration 维度**:e2e-full 已是 ci.yml `e2e-godot` job 的阻断 gate(无 continue-on-error)。M2 **不是从无到有加 gate**,而是把 e2e 结果**数值化**进 score.json:加 vitest `--reporter=json` 产出 → `collectors/integration.ts` 解析通过率 → 接入 score(score.fail 作第二道 gate)。同步拆分 L1/L2/L3 + `@gpu` 标记(现有单文件 e2e-full 重构为分层)。
- **M3 全维**:flaky(重跑 3 次)、performance(对接 profiler 基准)、gdscript(GUT 跑 addons/);dashboard 已有,接 score.json 显示趋势。

各里程碑落地前各自再走一轮 brainstorming + 本计划格式(现状会再变)。
