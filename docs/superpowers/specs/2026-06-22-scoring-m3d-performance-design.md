# M3d: Scoring performance 维度(测试套件 wall-clock)

- **里程碑**: scoring M3d
- **前置**: M3b 报告+门禁 + M3b-PR + M3c gdscript + M3b-HTML(渲染层 metric.ts shared)
- **范围**: performance 维度从 na 变真值——全套 vitest wall-clock 时间,绝对阈值分段线性,**无硬否决**
- **范围决策**: 测试时间(非 bundle/Godot 性能),绝对阈值(非相对回归——后者需历史快照基建留趋势 milestone)
- **实施顺序依赖**: M3d 在 `m3c-gdscript` worktree(同 M3c/M3b-HTML,`fix/review-verification` 分支,master 主树无 src/scoring)

## 背景

performance 维度现状 `dimensions.ts` 权重 0.10,`generate-score.ts:42` `na('performance')` 占位。spec :96 "未接入 M3d"。M3d 补:全套测试 wall-clock 时间作质量信号(CI 慢/反馈慢)。

## IMPORTANT-1 已验证(vitest json 字段确定性,Task 0 实测)

vitest 4.1.7 `--reporter=json` 产出(`coverage/test-report.json`)实测:
- 顶层有 `startTime`(ms 时间戳),**无 `endTime`/`totalTime`**
- `testResults[]`(per-file)有 `startTime` + `endTime`(ms),**无 `duration`**
- `assertionResults[].duration`(per-test,ms)
- **全套 wall-clock = `max(testResults[].endTime) - min(testResults[].startTime)`**(ms,并行文件最早开始到最晚结束)
- 实测:全套 wall-clock **52909ms(52.9s)**,与 vitest 输出 wall-clock ~48s 吻合(worktree 环境波动)
- **不用** Σ `assertionResults[].duration`(per-test CPU 和 93599ms ≈ 2× wall-clock,并行重叠,随并行度不稳定)
- 单位:**ms**(per-file startTime/endTime 是 ms 时间戳),展示 /1000 = s

## 方案

| 维度 | 选 |
|------|-----|
| 衡量 | 测试时间(全套 wall-clock) |
| 数据源 | 全套 vitest json(check job `vitest run --coverage` 加 `--reporter=json --outputFile=coverage/test-report.json`,复用现有 vitest 零新依赖) |
| 阈值 | 绝对 T_PASS/T_WARN 分段线性(Task 0 校准),非相对回归(留趋势 milestone) |
| 硬否决 | 无(测试慢软扣分,非致命——`HARD_FAILOUTS` 不加 performance) |

## 核心设计

### `PerformanceReport` interface(`types.ts`,锁单位 ms)

```ts
export interface PerformanceReport {
  wallclockMs: number;     // 全套 wall-clock = max(testResults[].endTime) - min(testResults[].startTime)
  testResults: number;     // testResults 文件数(诊断)
}
```
`wallclockMs` 是 score 唯一输入,单位 ms 锁死(单位错全线错)。collector 不产出 incomplete(performance 无"setup 坏"语义,数据不全直接 na)。

### `collectPerformance(reportPath): DimensionResult`(`src/scoring/collectors/performance.ts`,纯函数)

```ts
import { readFileSync, existsSync } from 'fs';
import type { DimensionResult, DimensionStatus } from '../types.js';
import { WEIGHTS, NA_SCORE, T_PASS_MS, T_WARN_MS } from '../dimensions.js';

/** 分段线性:≤T_PASS→100;T_PASS<≤T_WARN→线性100→60;>T_WARN→线性60→0 clamp。单位 ms。 */
function perfScore(ms: number): number {
  if (ms <= T_PASS_MS) return 100;
  if (ms <= T_WARN_MS) return 100 - (ms - T_PASS_MS) / (T_WARN_MS - T_PASS_MS) * 40;
  return Math.max(0, 60 - (ms - T_WARN_MS) / T_WARN_MS * 60);
}

/** 解析 vitest json → 全套 wall-clock(max endTime - min startTime)→ 绝对阈值分段线性。文件缺失/无字段 → na。 */
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

### 分段公式 + 边界 + 样例表(IMPORTANT-2)

`T_PASS_MS`/`T_WARN_MS` Task 0 校准(占位 **90000/180000**,基于本地基线 52.9s × 1.7/3.4 宽 buffer;CI runner 性能不同,Task 0 用 CI 基线 ×1.3~1.5/×3 回填——见 Task 0 段)。

**边界归属(≤ 闭区间)**:
- `ms ≤ T_PASS_MS` → 100
- `T_PASS_MS < ms ≤ T_WARN_MS` → 线性 100→60
- `ms > T_WARN_MS` → 线性 60→0,clamp 0

**样例表(T_PASS=90000, T_WARN=180000)**:

| wallclockMs | wall-clock | score | status | 公式段 |
|---|---|---|---|---|
| 60000 | 60s | 100 | pass | ≤T_PASS |
| 90000 | 90s | 100 | pass | ≤T_PASS 边界 |
| 135000 | 135s | 80 | pass | T_PASS+0.5×(T_WARN−T_PASS)→ **status pass 边界(score=80)** |
| 180000 | 180s | 60 | warn | ≤T_WARN 边界 |
| 225000 | 225s | 45 | fail | >T_WARN(60→0 线性) |
| 360000 | 360s | 0 | fail | clamp 0 |

**status pass 边界(score=80)落 `ms = T_PASS + 0.5×(T_WARN − T_PASS) = 135000ms`**——T_PASS/T_WARN 间距直接决定 pass 区宽度(IMPORTANT-2 隐含绑定,spec 显式)。

### 接入(对齐 gdscript 模式)

- **generate-score.ts:42** `performance: na('performance')` → `const performance = opts.performanceReportPath ? collectPerformance(opts.performanceReportPath) : na('performance')`(`GenerateScoreOptions` 加 `performanceReportPath?`)
- **cli.ts** 默认命令加 `performanceReportPath = resolve(cwd, 'coverage/test-report.json')`(对齐 gdscript 默认路径约定)
- **CI check job**(ci.yml:28 `vitest run --coverage`)加 `--reporter=json --outputFile=coverage/test-report.json`(保留 `--coverage`;退出码不变/顺序 score 前/`coverage/` 已 gitignore/na 兜底)
- **dimensions.ts** 加 `T_PASS_MS`/`T_WARN_MS` 常量(占位 90000/180000,Task 0 校准——同 WARN_PENALTY 占位模式)

### DRY: metric.ts dimMetric 加 performance case(M3b-HTML 抽的 shared)

`metric.ts` switch 加:
```ts
case 'performance':
  return `${round1(raw.wallclockMs / 1000)}s`;
```
report.ts + html.ts 自动生效(M3b-HTML shared metric.ts,零改渲染层)。

### status 80/60 第4处复制

performance 抄 80/60 是第4处(coverage 60/40 有意分化;integration/security/gdscript/performance 80/60)。`gdscript.ts:40` 注释"集中抽取待 N+1 collector"指 performance。M3d 范围克制**照抄**,plan 留 TODO 下次抽 `statusFromScore` helper(N+1 时机)。

## Task 0 基线校准

本地 worktree wall-clock 52.9s(实测)。CI runner 性能不同(IMPORTANT-1 建议 T_pass ×1.3~1.5、T_warn ×3 buffer)。Task 0:
- CI 首跑读 `coverage/test-report.json` 的 wallclockMs(基线 W_ci)
- `T_PASS_MS = round(W_ci × 1.5)`(或固定 90000 取宽,留 pass buffer)
- `T_WARN_MS = round(W_ci × 3)`(或固定 180000)
- 回填 `dimensions.ts` + 同步 `performance.test.ts` 样例表边界

## 测试(`test/scoring/performance.test.ts`,inline 造数据对齐 gdscript.test.ts)

- **wall-clock 算法**:造 vitest json fixture(testResults 含 startTime/endTime 多文件)→ max-min(并行文件最早开始到最晚结束)
- **曲线**(T_PASS=90000/T_WARN=180000):60000→100 pass / 90000→100 pass 边界 / 135000→80 pass / 180000→60 warn 边界 / 225000→45 fail / 360000→0 fail clamp
- **na**:文件缺失/坏 JSON/无 testResults/缺 startTime/endTime/wall-clock 负值
- **raw 回填**(wallclockMs/testResults)
- **单位 ms**:造 ms 值,验 raw.wallclockMs(ms)+ dimMetric `/1000` 展示 s

## 非目标(不在 M3d)

- ❌ 相对回归(比上次慢 N%,需历史快照基建,留趋势 milestone)
- ❌ bundle/build 大小 / Godot 运行性能(方案选测试时间)
- ❌ HARD_FAILOUT(测试慢软扣分)
- ❌ `statusFromScore` helper 抽取(第4处复制,M3d 照抄,留 N+1)

## 后续里程碑

- **趋势图 milestone**(独立):历史 score 快照基建 + 相对回归 + HTML 趋势
- **M3e flaky**(最后一个维度,接入后 6/6 维 partial 不再卡门禁)
