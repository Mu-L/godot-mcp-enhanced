# M3c gdscript 维度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gdscript 维度从 na 变真实值——Godot 4.6.3 项目级 `--import` 检查 addon 编译,errors 归零硬否决,warnings 渐进扣分,接入 score.json/score:gate/CI。

**Architecture:** 三层(对齐 security 维度):`collectGdscript` 纯函数(解析 report.json→三态 DimensionResult)/ `check-gdscript.ts` 执行层(Godot import→产出 report.json)/ CI step 编排。抽共享 `runGodotHeadless` helper(spawn+forceKillTree+累积 stdio→`{exitCode,stdout,stderr}`),`runImport` 与 check-gdscript 共用,禁止重写 spawn。

**Tech Stack:** TypeScript, Vitest, Godot 4.6.3 headless, GitHub Actions。

## Global Constraints

- **Godot 版本固定 4.6.3**(CI 安装版本,不 4.7——addon 用 4.6 API,4.7 编译失败是已知兼容问题,M3c 检目标版本)
- **check-gdscript.ts 必须是 TS**(src/scoring/,享类型;编译到 build/scoring/check-gdscript.js;CI 跑 build 版)
- **禁止重写 spawn**:check-gdscript 复用 `runGodotHeadless`,继承 `forceKillTree` 防 CI Godot 卡住留僵尸
- **GODOT_PATH 缺失不静默**(IMPORTANT-9b):`process.stderr.write` 告警(非 `console.warn`——vitest 捕获 console.* 不透传),产出 `incomplete:true` report(非静默跳过)
- **单测 inline 造数据**(对齐 security.test.ts 模式):`writeReport` helper + `__tmp__/` 临时目录,不引入 fixture 文件
- **status 80/60 复制**(不抽 `gradeStatus`):coverage 现状 60/40 vs integration/security 80/60 有意不一致,参数化抽取是独立重构
- **WARN_PENALTY 初始占位 `2`**(Task 7 基线校准;`export const WARN_PENALTY = 2;` 代码编译需已定义)
- **errors 归零不梯度**(errors≥1→score=0,布尔硬否决;梯度制造虚假精度)
- 引用文件用绝对路径(CLAUDE.md 规则)

---

## Task 1: collectGdscript 纯函数 + GdscriptReport interface + dimensions 配置

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\gdscript.ts`
- Create: `D:\GitHub\godot-mcp-enhanced\test\scoring\gdscript.test.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\types.ts`(末尾加 `GdscriptReport`)
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\dimensions.ts`(`HARD_FAILOUTS.gdscript=60` + `WARN_PENALTY`)
- Modify: `D:\GitHub\godot-mcp-enhanced\test\scoring\dimensions.test.ts`(加 gdscript 硬否决断言)

**Interfaces:**
- Produces: `collectGdscript(reportPath: string): DimensionResult`;`GdscriptReport` interface;`WARN_PENALTY` const(供 Task 2 generate-score 与 Task 5 check-gdscript 共享)

- [ ] **Step 1: 写失败测试** `test/scoring/gdscript.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { collectGdscript } from '../../src/scoring/collectors/gdscript.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_gdscript__');
const REPORT = resolve(TMP, 'gdscript-report.json');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function writeReport(data: object): void {
  writeFileSync(REPORT, JSON.stringify(data));
}

describe('collectGdscript', () => {
  it('0 errors 0 warnings → 100, pass', () => {
    writeReport({ errors: 0, warnings: 0, files: 19, details: [], detailsTotal: 0 });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(100);
    expect(r.status).toBe('pass');
  });

  it('0 errors 10 warnings(×2) → 100-20=80, pass', () => {
    writeReport({ errors: 0, warnings: 10, files: 19, details: [], detailsTotal: 10 });
    expect(collectGdscript(REPORT).score).toBe(80);
  });

  it('0 errors 20 warnings → 60, warn(边界)', () => {
    writeReport({ errors: 0, warnings: 20, files: 19, details: [], detailsTotal: 20 });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(60);
    expect(r.status).toBe('warn');
  });

  it('0 errors 21 warnings → 58, fail(<60 硬否决)', () => {
    writeReport({ errors: 0, warnings: 21, files: 19, details: [], detailsTotal: 21 });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(58);
    expect(r.status).toBe('fail');
  });

  it('1 error → score=0(归零硬否决), fail', () => {
    writeReport({ errors: 1, warnings: 0, files: 19, details: ['cmd.gd:1 Parse Error'], detailsTotal: 1 });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(0);
    expect(r.status).toBe('fail');
  });

  it('3 errors + 5 warnings → score=0(errors 归零优先于 warnings 渐进)', () => {
    writeReport({ errors: 3, warnings: 5, files: 19, details: [], detailsTotal: 8 });
    expect(collectGdscript(REPORT).score).toBe(0);
  });

  it('incomplete:true 优先于 errors → score=0 fail(检查不完整则 errors 不可信)', () => {
    writeReport({ errors: 3, warnings: 0, files: 5, details: [], detailsTotal: 3, incomplete: true, reason: 'files 不足' });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(0);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('检查不完整');
    expect((r.raw as { incomplete: boolean }).incomplete).toBe(true);
  });

  it('扣分 clamp 0(60 warnings ×2=120)', () => {
    writeReport({ errors: 0, warnings: 60, files: 19, details: [], detailsTotal: 60 });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(0);
    expect(r.status).toBe('fail');
  });

  it('raw.detailsTotal = errors + warnings(非 details.length)', () => {
    writeReport({ errors: 2, warnings: 3, files: 19, details: ['a', 'b'], detailsTotal: 5 });
    expect(collectGdscript(REPORT).raw).toMatchObject({ errors: 2, warnings: 3, files: 19, detailsTotal: 5 });
  });

  it('文件不存在 → na', () => {
    const r = collectGdscript(resolve(TMP, 'nope.json'));
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('json 解析失败 → na', () => {
    writeFileSync(REPORT, '{不是合法 json');
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('缺 errors/warnings 字段 → na', () => {
    writeReport({ files: 19, details: [] });
    const r = collectGdscript(REPORT);
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/gdscript.test.ts`
Expected: FAIL(`collectGdscript` 未定义 / 模块找不到)

- [ ] **Step 3: 加 GdscriptReport interface** `src/scoring/types.ts`(末尾追加)

```ts
/** check-gdscript 产出 / collectGdscript 消费的共享契约(TS 两侧锁字段) */
export interface GdscriptReport {
  errors: number;
  warnings: number;
  files: number;         // 检查的 .gd 文件数(断言用)
  details: string[];     // 全部问题明细(errors 优先),≤20 条
  detailsTotal: number;  // = errors + warnings(独立计数,不受截断影响)
  incomplete?: boolean;  // check-gdscript 断言失败(setup 坏) → collector score=0
  reason?: string;
}
```

- [ ] **Step 4: 加 HARD_FAILOUTS.gdscript + WARN_PENALTY** `src/scoring/dimensions.ts`

把 `HARD_FAILOUTS` 改为(加 `gdscript: 60`):
```ts
export const HARD_FAILOUTS: Partial<Record<DimensionName, number>> = {
  security: 60,
  integration: 80,
  gdscript: 60,
};
```
文件末尾追加:
```ts
/** warnings 渐进扣分系数(初始占位 2,Task 7 基线校准) */
export const WARN_PENALTY = 2;
```

- [ ] **Step 5: 实现 collectGdscript** `src/scoring/collectors/gdscript.ts`

```ts
import { readFileSync, existsSync } from 'fs';
import type { DimensionResult, DimensionStatus, GdscriptReport } from '../types.js';
import { WEIGHTS, NA_SCORE, WARN_PENALTY } from '../dimensions.js';

/**
 * 解析 check-gdscript 产出的 report.json。三态:
 *  - report 不存在/坏 JSON/缺字段 → na(环境降级,不卡 gate)
 *  - incomplete(check-gdscript 断言失败) → score=0(<60 硬否决卡 gate),优先于 errors
 *  - 正常 → errors 归零硬否决 / warnings×WARN_PENALTY 渐进
 * errors 归零(布尔:有错 addon 不可用);梯度制造虚假精度,errors 数量在 raw 保留诊断。
 */
export function collectGdscript(reportPath: string): DimensionResult {
  if (!existsSync(reportPath)) {
    return { score: NA_SCORE, weight: WEIGHTS.gdscript, status: 'na',
             detail: `报告不存在: ${reportPath}` };
  }
  let report: GdscriptReport;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (e) {
    return { score: NA_SCORE, weight: WEIGHTS.gdscript, status: 'na',
             detail: `报告解析失败: ${(e as Error).message}` };
  }

  // incomplete 优先于 errors/warnings:检查不完整则 errors 不可信
  if (report.incomplete) {
    return { score: 0, weight: WEIGHTS.gdscript, status: 'fail',
             detail: `检查不完整: ${report.reason ?? 'setup 失败'}`,
             raw: { errors: 0, warnings: 0, files: report.files ?? 0,
                    details: [], detailsTotal: 0, incomplete: true } };
  }

  if (typeof report.errors !== 'number' || typeof report.warnings !== 'number') {
    return { score: NA_SCORE, weight: WEIGHTS.gdscript, status: 'na',
             detail: '报告缺 errors/warnings 字段' };
  }

  const { errors, warnings } = report;
  const score = errors >= 1 ? 0 : Math.max(0, 100 - warnings * WARN_PENALTY);
  // 80/60,与 security/integration 一致;集中抽取待 N+1 collector
  const status: DimensionStatus = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.gdscript, status,
           raw: { errors, warnings, files: report.files ?? 0,
                  details: report.details ?? [], detailsTotal: errors + warnings } };
}
```

- [ ] **Step 6: 更新 dimensions.test.ts 硬否决断言**

`test/scoring/dimensions.test.ts` 的"硬否决覆盖"测试改为:
```ts
  it('硬否决覆盖 security(60)/ integration(80)/ gdscript(60)', () => {
    expect(HARD_FAILOUTS.security).toBe(60);
    expect(HARD_FAILOUTS.integration).toBe(80);
    expect(HARD_FAILOUTS.gdscript).toBe(60);
  });
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run test/scoring/gdscript.test.ts test/scoring/dimensions.test.ts`
Expected: PASS(全部)

- [ ] **Step 8: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced add src/scoring/collectors/gdscript.ts test/scoring/gdscript.test.ts src/scoring/types.ts src/scoring/dimensions.ts test/scoring/dimensions.test.ts
git -C D:/GitHub/godot-mcp-enhanced commit -m "feat(scoring): collectGdscript 纯函数 + GdscriptReport 契约(M3c Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: generate-score + cli 接 gdscriptReportPath

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts`(opts 加 `gdscriptReportPath`,接 `collectGdscript`)
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`(默认命令加路径)
- Modify: `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts`(加 gdscript 维度测试)

**Interfaces:**
- Consumes: `collectGdscript`(Task 1)
- Produces: `generateScore` 接受 `gdscriptReportPath`,gdscript 维度从 na 变真值(供 Task 3 渲染、Task 6 CI)

- [ ] **Step 1: 写失败测试** 追加到 `test/scoring/generate-score.test.ts` 的 describe 块内

```ts
  it('有 gdscript report → gdscript 维度有值,incomplete→fail', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const GD = resolve(TMP, 'gd.json');
    writeFileSync(GD, JSON.stringify({ errors: 0, warnings: 5, files: 19, details: [], detailsTotal: 5 }));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, gdscriptReportPath: GD });
    expect(s.dimensions.gdscript.score).toBe(90); // 100-5*2
    expect(s.dimensions.gdscript.status).toBe('pass');
    expect(s.unverified).not.toContain('gdscript');
  });

  it('gdscript report incomplete → gdscript score=0 fail(hardFail)', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const GD = resolve(TMP, 'gd.json');
    writeFileSync(GD, JSON.stringify({ errors: 0, warnings: 0, files: 0, details: [], detailsTotal: 0, incomplete: true, reason: 'GODOT_PATH 缺失' }));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, gdscriptReportPath: GD });
    expect(s.dimensions.gdscript.score).toBe(0);
    expect(s.hardFails.some(h => h.dimension === 'gdscript')).toBe(true);
    expect(s.pass).toBe(false);
  });

  it('gdscript report 缺失 → gdscript 维度 na', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, gdscriptReportPath: resolve(TMP, 'nope.json') });
    expect(s.dimensions.gdscript.status).toBe('na');
    expect(s.unverified).toContain('gdscript');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/generate-score.test.ts -t gdscript`
Expected: FAIL(`gdscriptReportPath` 选项不存在)

- [ ] **Step 3: generate-score.ts 接入**

`GenerateScoreOptions` 加字段(在 `auditJsonPath` 后):
```ts
  /** check-gdscript 产出路径;缺失→gdscript 维度 na */
  gdscriptReportPath?: string;
```
import 行加(文件顶部 collectors import 区):
```ts
import { collectGdscript } from './collectors/gdscript.js';
```
`generateScore` 内,把 `gdscript: na('gdscript')` 改为独立变量(对齐 integration/security 模式):
```ts
  const gdscript = opts.gdscriptReportPath ? collectGdscript(opts.gdscriptReportPath) : na('gdscript');
  const dims: Record<DimensionName, DimensionResult> = {
    integration,
    coverage,
    security,
    flaky: na('flaky'),
    performance: na('performance'),
    gdscript,
  };
```
文件头注释更新:`M1 coverage + M2 integration + M3a security + M3c gdscript 有值`。

- [ ] **Step 4: cli.ts 默认命令加路径**

`src/scoring/cli.ts` else 分支(默认 score 命令),在 `auditJsonPath` 后加:
```ts
    const gdscriptReportPath = resolve(process.cwd(), 'coverage/gdscript-report.json');
```
`generateScore` 调用改为:
```ts
    const score = generateScore({ lcovPath, outPath, e2eReportPath, auditJsonPath, gdscriptReportPath });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/scoring/generate-score.test.ts`
Expected: PASS(全部,含新 gdscript 3 条 + 现有)

- [ ] **Step 6: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced add src/scoring/generate-score.ts src/scoring/cli.ts test/scoring/generate-score.test.ts
git -C D:/GitHub/godot-mcp-enhanced commit -m "feat(scoring): generate-score/cli 接 gdscriptReportPath(M3c Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: report.ts dimMetric 加 gdscript case

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts`(`dimMetric` switch 加 gdscript case)
- Modify: `D:\GitHub\godot-mcp-enhanced\test\scoring\report.test.ts`(加 gdscript 有值渲染测试)

**Interfaces:**
- Consumes: gdscript 维度 DimensionResult.raw(`{errors,warnings,...}`,Task 1/2)
- Produces: score-report.md / pr-comment 的 gdscript 行显示 "X err / Y warn"

- [ ] **Step 1: 写失败测试** 追加到 `test/scoring/report.test.ts` describe 块内

```ts
  it('gdscript 有值时关键指标显示 err/warn 计数', () => {
    const md = renderScoreReport(makeScore({
      dimensions: {
        ...makeScore().dimensions,
        gdscript: { score: 90, weight: 0.1, status: 'pass',
                    raw: { errors: 0, warnings: 5, files: 19, details: [], detailsTotal: 5 } },
      },
      unverified: ['flaky', 'performance'],
    }));
    expect(md).toContain('0 err / 5 warn');
  });

  it('gdscript incomplete(score=0)仍显示 0 err / 0 warn', () => {
    const md = renderScoreReport(makeScore({
      dimensions: {
        ...makeScore().dimensions,
        gdscript: { score: 0, weight: 0.1, status: 'fail',
                    raw: { errors: 0, warnings: 0, files: 5, details: [], detailsTotal: 0, incomplete: true } },
      },
      unverified: ['flaky', 'performance'],
    }));
    expect(md).toContain('0 err / 0 warn');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/report.test.ts -t gdscript`
Expected: FAIL(md 不含 "err / warn")

- [ ] **Step 3: report.ts dimMetric 加 case**

`src/scoring/report.ts` 的 `dimMetric` switch,`security` case 后、`default` 前加:
```ts
    case 'gdscript':
      return `${raw.errors ?? 0} err / ${raw.warnings ?? 0} warn`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/report.test.ts`
Expected: PASS(全部)

- [ ] **Step 5: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced add src/scoring/report.ts test/scoring/report.test.ts
git -C D:/GitHub/godot-mcp-enhanced commit -m "feat(scoring): report dimMetric gdscript case(M3c Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: runGodotHeadless 共享 helper + 重构 runImport

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\core\godot-spawn.ts`(`runGodotHeadless`)
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\import-check.ts`(`runImport` 改用它,行为不变)

**Interfaces:**
- Produces: `runGodotHeadless(args: string[], godotPath: string, timeoutMs?: number): Promise<{exitCode: number|null, stdout: string, stderr: string}>`(供 Task 5 check-gdscript 用;runImport 重构后行为不变)

- [ ] **Step 1: 实现 runGodotHeadless** `src/core/godot-spawn.ts`

```ts
import { spawn } from 'child_process';
import { forceKillTree } from './process-state.js';
import { buildSafeEnv } from '../helpers.js';

export interface GodotRunResult {
  exitCode: number | null;  // null = 超时被杀
  stdout: string;
  stderr: string;
}

/**
 * spawn Godot headless + 累积 stdio + 超时 forceKillTree 杀进程树,返回 {exitCode,stdout,stderr}。
 * 不做成败判断(exitCode 任值都 resolve),供 runImport(套 code 判断)与 check-gdscript(任意 exit 解析 stderr)共用。
 * 超时 → resolve {exitCode: null}(调用方自行判断);spawn 失败 → reject。
 * 禁止在调用方重写 spawn——继承 forceKillTree 防 CI Godot 卡住留僵尸。
 */
export function runGodotHeadless(
  args: string[],
  godotPath: string,
  timeoutMs: number = 60_000,
): Promise<GodotRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(godotPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: buildSafeEnv() });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    proc.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));
    const timer = setTimeout(() => {
      forceKillTree(proc);
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Godot spawn failed: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}
```

- [ ] **Step 2: 重构 runImport 用 runGodotHeadless** `src/tools/import-check.ts`

替换 `runImport` 函数体(100-158 行整个函数)为:
```ts
export async function runImport(
  projectPath: string,
  godotPath: string,
  timeoutMs: number = 60_000,
): Promise<void> {
  const result = await runGodotHeadless(
    ['--headless', '--import', '--path', projectPath], godotPath, timeoutMs,
  );
  if (result.exitCode === null) {
    throw new Error(
      `Import warmup timed out after ${timeoutMs}ms for ${projectPath}. ` +
      `stdout: ${result.stdout.slice(-500) || '(empty)'}; stderr: ${result.stderr.slice(-500) || '(empty)'}`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Import warmup exited with code ${result.exitCode} for ${projectPath}. ` +
      `stdout: ${result.stdout.slice(-500) || '(empty)'}; stderr: ${result.stderr.slice(-500) || '(empty)'}`,
    );
  }
  // code === 0: 更新缓存
  const latestMtime = scanLatestMtime(projectPath);
  _lastCheckedAssetMtime = latestMtime || Date.now();
  _lastCheckedProject = projectPath;
  getLogger().info('import-check', `Import warmup completed for ${projectPath}`);
}
```
顶部 import 改为(去掉 `spawn`,加 `runGodotHeadless`):
```ts
import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { runGodotHeadless } from '../core/godot-spawn.js';
import { getLogger } from '../core/logger.js';
```
(删掉 `import { spawn } from 'child_process';` 和 `import { forceKillTree } from '../core/process-state.js';` 和 `import { buildSafeEnv } from '../helpers.js';`——已挪进 godot-spawn.ts)

- [ ] **Step 3: 跑 import-check 现有测试确认行为不变**

Run: `npx vitest run test/import-check.test.ts`
Expected: PASS(全部现有测试,含 forceKillTree 超时杀进程树验证——runGodotHeadless 继承了该机制)

- [ ] **Step 4: tsc 确认类型**

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 5: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced add src/core/godot-spawn.ts src/tools/import-check.ts
git -C D:/GitHub/godot-mcp-enhanced commit -m "refactor(scoring): 抽 runGodotHeadless 共享 helper,runImport 复用(M3c Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: check-gdscript.ts 执行层 + 检查项目 + 接入脚本

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\check-gdscript.ts`(执行层 + 可单测纯函数)
- Create: `D:\GitHub\godot-mcp-enhanced\test\scoring\check-gdscript.test.ts`(纯函数单测 + hasGodot-gated integration)
- Create: `D:\GitHub\godot-mcp-enhanced\test\fixtures\gdscript-check\project.godot`(用 Godot 4.6.3 生成模板 + [editor_plugins])
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json`(`check:gdscript` script)
- Modify: `D:\GitHub\godot-mcp-enhanced\.gitignore`(`test/fixtures/gdscript-check/addons/`)

**Interfaces:**
- Consumes: `runGodotHeadless`(Task 4)、`GdscriptReport`(Task 1)、源 `addons/godot_mcp_server/`
- Produces: `coverage/gdscript-report.json`(供 cli 默认命令读,Task 2)

- [ ] **Step 1: 写纯函数失败测试** `test/scoring/check-gdscript.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseGdscriptOutput, extractClassNames } from '../../src/scoring/check-gdscript.js';

describe('parseGdscriptOutput', () => {
  it('SCRIPT ERROR 行计入 errors', () => {
    const r = parseGdscriptOutput('SCRIPT ERROR: res://a.gd:1: "x" was not found');
    expect(r.errors).toBe(1);
    expect(r.warnings).toBe(0);
    expect(r.details[0]).toContain('SCRIPT ERROR');
  });

  it('Parse Error 行计入 errors', () => {
    const r = parseGdscriptOutput('res://a.gd:42 - Parse Error: Unexpected token');
    expect(r.errors).toBe(1);
  });

  it('WARNING 行计入 warnings(不计 errors)', () => {
    const r = parseGdscriptOutput('WARNING: "x" is never used');
    expect(r.warnings).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('errors 优先排前 details,≤20 条截断', () => {
    const lines = [
      'WARNING: w1', 'WARNING: w2',
      ...Array.from({ length: 25 }, (_, i) => `SCRIPT ERROR: e${i}`),
    ].join('\n');
    const r = parseGdscriptOutput(lines);
    expect(r.errors).toBe(25);
    expect(r.warnings).toBe(2);
    expect(r.details.length).toBe(20);
    expect(r.details[0]).toContain('SCRIPT ERROR'); // errors 优先
  });

  it('未知行不计数不崩(保留诊断)', () => {
    const r = parseGdscriptOutput('some random godot banner\n  at scope\n');
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it('detailsTotal = errors + warnings', () => {
    const r = parseGdscriptOutput('SCRIPT ERROR: e1\nWARNING: w1\nWARNING: w2');
    expect(r.detailsTotal).toBe(3);
  });
});

describe('extractClassNames', () => {
  it('从 class_name 声明提取类名', () => {
    const names = extractClassNames([
      'D:\\addons\\godot_mcp_server\\commands\\command_helpers.gd',
    ], { 'D:\\addons\\godot_mcp_server\\commands\\command_helpers.gd': '@tool\nclass_name CommandHelpers\nextends RefCounted\n' });
    expect(names).toEqual(['CommandHelpers']);
  });

  it('无 class_name 的脚本不返回', () => {
    const names = extractClassNames(['a.gd'], { 'a.gd': 'extends Node\nvar x = 1\n' });
    expect(names).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/check-gdscript.test.ts`
Expected: FAIL(模块未定义)

- [ ] **Step 3: 实现 check-gdscript.ts(纯函数 + main)** `src/scoring/check-gdscript.ts`

```ts
import { existsSync, readdirSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { runGodotHeadless } from '../core/godot-spawn.js';
import type { GdscriptReport } from './types.js';

// ===== 可单测纯函数 =====

const RE_ERROR = /^(?:SCRIPT ERROR:|.*-\s*(?:Parse|Compile) Error:)/;
const RE_WARN = /^(?:WARNING:|.*-\s*Warning:)/;
const MAX_DETAILS = 20;

/** 解析 Godot stdout+stderr → errors/warnings/details。未知行不计数不崩。 */
export function parseGdscriptOutput(combined: string): { errors: number; warnings: number; details: string[]; detailsTotal: number } {
  const errorLines: string[] = [];
  const warnLines: string[] = [];
  for (const line of combined.split('\n')) {
    if (RE_ERROR.test(line)) errorLines.push(line.trim());
    else if (RE_WARN.test(line)) warnLines.push(line.trim());
  }
  const errors = errorLines.length;
  const warnings = warnLines.length;
  const details = [...errorLines, ...warnLines].slice(0, MAX_DETAILS);
  return { errors, warnings, details, detailsTotal: errors + warnings };
}

/** 从源 .gd 文本(传入文件内容 map,避免 IO)提取 class_name 列表 */
export function extractClassNames(files: string[], contents: Record<string, string>): string[] {
  const names: string[] = [];
  for (const f of files) {
    const m = contents[f]?.match(/^\s*class_name\s+(\w+)/m);
    if (m) names.push(m[1]);
  }
  return names;
}

/** 递归 glob .gd */
function listGd(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...listGd(p));
    else if (e.name.endsWith('.gd')) out.push(p);
  }
  return out;
}

// ===== main(IO 层) =====

const SRC_ADDON = resolve(process.cwd(), 'addons', 'godot_mcp_server');
const CHECK_PROJECT = resolve(process.cwd(), 'test', 'fixtures', 'gdscript-check');
const CHECK_ADDON = resolve(CHECK_PROJECT, 'addons', 'godot_mcp_server');
const REPORT_OUT = resolve(process.cwd(), 'coverage', 'gdscript-report.json');

function writeReport(r: GdscriptReport): void {
  mkdirSync(dirname(REPORT_OUT), { recursive: true });
  writeFileSync(REPORT_OUT, JSON.stringify(r, null, 2) + '\n', 'utf8');
  process.stdout.write(`gdscript report → ${REPORT_OUT} (errors=${r.errors} warnings=${r.warnings}${r.incomplete ? ' INCOMPLETE' : ''})\n`);
}

async function main(): Promise<void> {
  const godotPath = process.env.GODOT_PATH || '';

  // ① GODOT_PATH 缺失 → incomplete + stderr 告警(IMPORTANT-9b,非静默跳过)
  if (!godotPath || !existsSync(godotPath)) {
    process.stderr.write(
      `[M3c] GODOT_PATH 缺失或不存在 (${godotPath}) — gdscript 检查未执行,产出 incomplete report。\n` +
      `  设置 GODOT_PATH 启用。未设时 gdscript 维度会硬否决(非静默跳过,防 CI 假绿)。\n`,
    );
    writeReport({ errors: 0, warnings: 0, files: 0, details: [], detailsTotal: 0,
                  incomplete: true, reason: `GODOT_PATH 缺失: ${godotPath}` });
    return;
  }

  const srcFiles = listGd(SRC_ADDON);
  const expected = srcFiles.length;

  // ② 复制 addon 进检查项目(每次新拷最新源)
  mkdirSync(CHECK_ADDON, { recursive: true });
  for (const f of srcFiles) {
    const dst = resolve(CHECK_ADDON + f.slice(SRC_ADDON.length));
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(f, dst);
  }

  // ③ runGodotHeadless --import(复用 helper,继承 forceKillTree)
  let result;
  try {
    result = await runGodotHeadless(['--headless', '--import', '--path', CHECK_PROJECT], godotPath, 120_000);
  } catch (e) {
    writeReport({ errors: 0, warnings: 0, files: expected, details: [], detailsTotal: 0,
                  incomplete: true, reason: `spawn 失败: ${(e as Error).message}` });
    return;
  }

  // ④ 解析 stdout+stderr(部分版本错误走 stdout)
  const parsed = parseGdscriptOutput(result.stdout + '\n' + result.stderr);

  // ⑤ false negative 断言:setup 坏 → incomplete(不产出虚假 0/0)
  // files 断言
  const checkFiles = listGd(CHECK_ADDON);
  if (checkFiles.length !== expected) {
    writeReport({ ...parsed, files: checkFiles.length, incomplete: true,
                  reason: `files 断言失败: 检查项目 ${checkFiles.length} ≠ 源 ${expected}` });
    return;
  }
  // class cache 断言(全部源 class_name 在 cache;当前仅 CommandHelpers)
  const srcContents: Record<string, string> = {};
  for (const f of srcFiles) srcContents[f] = readFileSync(f, 'utf8');
  const srcClassNames = extractClassNames(srcFiles, srcContents);
  if (srcClassNames.length > 0) {
    let cache = '';
    try { cache = readFileSync(resolve(CHECK_PROJECT, '.godot', 'global_script_class_cache.cfg'), 'utf8'); } catch { /* 未生成 */ }
    const missing = srcClassNames.filter(n => !cache.includes(n));
    if (missing.length > 0) {
      writeReport({ ...parsed, files: expected, incomplete: true,
                    reason: `class cache 缺: ${missing.join(', ')}(plugin 未加载?)` });
      return;
    }
  }

  // ⑥ 正常产出
  writeReport({ ...parsed, files: expected });
}

// 仅当直接执行(非 import)时跑 main
const entry = typeof require !== 'undefined' && require.main && require.main.filename;
if (entry && entry === __filename) {
  main().catch(e => { process.stderr.write(`check-gdscript 失败: ${(e as Error).stack ?? e}\n`); process.exit(1); });
}
```

**注**:ESM 判断"直接执行"用 `import.meta.url` → 转路径比对 process.argv[1]。上面的 `require.main` 是 CJS 写法,ESM 项目(type: module)需改成:
```ts
import { fileURLToPath } from 'url';
const entry = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && resolve(process.argv[1]) === entry;
if (invoked) {
  main().catch(e => { process.stderr.write(`check-gdscript 失败: ${(e as Error).stack ?? e}\n`); process.exit(1); });
}
```
(执行者按 ESM 版实现,对齐 `cli.ts:10-13` 的 `invoked` 模式)

- [ ] **Step 4: 跑纯函数测试确认通过**

Run: `npx vitest run test/scoring/check-gdscript.test.ts`
Expected: PASS(parseGdscriptOutput + extractClassNames 全部)

- [ ] **Step 5: 生成检查项目 project.godot(R5:用 Godot 生成模板)**

在 `test/fixtures/gdscript-check/` 下用 Godot 4.6.3 生成空项目作模板(保证 features 段完整含渲染器):
```bash
# 本地有 Godot 时,生成空项目模板(一次性)
"$GODOT_PATH" --headless --path test/fixtures/gdscript-check --editor --quit-after 1 2>/dev/null || true
```
然后**手动编辑** `test/fixtures/gdscript-check/project.godot`,确保含:
```ini
[editor_plugins]
enabled=PackedStringArray("godot_mcp_server")
```
(config/features 段保留 Godot 生成的完整内容——含 "4.6"、渲染器等;不手写仅 "4.6" 防 Godot 抱怨)

- [ ] **Step 6: package.json 加 script + .gitignore 加排除**

`package.json` 的 scripts 区(`score:pr-comment` 后)加:
```json
    "check:gdscript": "node build/scoring/check-gdscript.js",
```
`.gitignore` 末尾加:
```gitignore
# M3c: gdscript 检查项目运行时复制的 addon(保留 project.godot 源)
test/fixtures/gdscript-check/addons/
```

- [ ] **Step 7: 本地 hasGodot integration 测试(手动验证)**

有 Godot 时:`GODOT_PATH=<4.6.3 路径> npm run build && GODOT_PATH=<...> npm run check:gdscript`,确认产出 `coverage/gdscript-report.json`(errors=0, addon 4.6 干净基线——若 errors>0 说明 addon 有现存编译错,需先修,记录到 Task 7)。
无 Godot 时:跳过(靠 CI 验;本地确认 GODOT_PATH 缺失产出 incomplete)。

- [ ] **Step 8: Commit**

```bash
git -C D:/GitHub/godot-mcp-enhanced add src/scoring/check-gdscript.ts test/scoring/check-gdscript.test.ts test/fixtures/gdscript-check/project.godot package.json .gitignore
git -C D:/GitHub/godot-mcp-enhanced commit -m "feat(scoring): check-gdscript 执行层 + 检查项目(M3c Task 5)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: CI check job 接入 Godot + check-gdscript step

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`(check job 加 Godot 安装 + check-gdscript step)

**Interfaces:**
- Consumes: `check:gdscript` script(Task 5)、e2e-godot 的 Godot 安装脚本(ci.yml:75-83)
- Produces: CI check job 产出 `coverage/gdscript-report.json`,score step 读它,gdscript 维度真实出分

- [ ] **Step 1: 改 ci.yml check job**

在 `.github/workflows/ci.yml` check job 的 `npm audit` step**之前**插入 Godot 安装 + check-gdscript step(check job 与 e2e-godot job 独立,环境不共享,需在 check job 内复制安装脚本):

```yaml
      - name: Install Godot 4.6.3 (M3c, job-isolated)
        run: |
          set -e
          curl -L --fail -o /tmp/godot.zip \
            https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_linux.x86_64.zip
          mkdir -p /tmp/godot-bin
          unzip -o /tmp/godot.zip -d /tmp/godot-bin
          chmod +x /tmp/godot-bin/Godot_v4.6.3-stable_linux.x86_64
          echo "GODOT_PATH=/tmp/godot-bin/Godot_v4.6.3-stable_linux.x86_64" >> "$GITHUB_ENV"
      - name: Check gdscript (M3c, non-blocking)
        run: npm run check:gdscript
        continue-on-error: true
        env:
          GODOT_PATH: ${{ env.GODOT_PATH }}
```
(插入位置:`npm run build` / `npx vitest run --coverage` 之后,`npm audit` 之前——确保 check-gdscript 用 build 版 + 在 score step 前产出 report)

- [ ] **Step 2: 本地验证 yml 语法**

Run(本地有 yamllint 或 node 解析):`node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')"` + 肉眼检查缩进(YAML 2 空格,step 在 check job 的 steps 列表内)。

- [ ] **Step 3: Commit(本地无法跑 CI,靠 push 后 CI 验)**

```bash
git -C D:/GitHub/godot-mcp-enhanced add .github/workflows/ci.yml
git -C D:/GitHub/godot-mcp-enhanced commit -m "ci(scoring): check job 装 Godot + check-gdscript step(M3c Task 6)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 端到端基线验证 + WARN_PENALTY 校准 + final verification

**Files:**
- Modify(如需校准):`D:\GitHub\godot-mcp-enhanced\src\scoring\dimensions.ts`(`WARN_PENALTY` 值)

**目的**:验证 addon 4.6 编译基线干净(硬否决不卡自己)+ 反推 WARN_PENALTY + final 全套绿。

- [ ] **Step 1: 本地真实 Godot 跑 check-gdscript,量基线**

Run(本地有 Godot 4.6.3):
```bash
npm run build
GODOT_PATH=<本地 4.6.3 路径> npm run check:gdscript
cat coverage/gdscript-report.json
```
Expected:`errors: 0`(addon 4.6 编译干净)。记录 `warnings` 实际数 W。

- [ ] **Step 2: 反推 WARN_PENALTY**

按"容忍多少 warning 才卡"产品决策定系数:`WARN_PENALTY = (100 - 60) / 容忍 warning 数`(阈值 60)。
- W = 0(干净):收紧——`WARN_PENALTY = 10`(1 warning 显著扣);容忍上限 = "几 warning 到 fail" 按 `100/WARN_PENALTY` 算。
- W > 0:`WARN_PENALTY` 使当前 W 落在 pass/warn 区(不误伤),如 `WARN_PENALTY = max(2, (100-80)/W)` 附近。

更新 `src/scoring/dimensions.ts`:`export const WARN_PENALTY = <校准值>;`(去掉"占位"注释,改为校准值 + 注释说明依据)。

- [ ] **Step 3: 若 errors > 0(addon 有现存编译错)**

addon 4.6 基线脏 → 硬否决会卡自己。**先修 addon 编译错**(独立于 M3c 的 addon 修复),回归 Task 1 基线直到 errors=0。记录修复到 spec 校准段。

- [ ] **Step 4: 同步更新 gdscript.test.ts 的 warnings 边界用例**

`test/scoring/gdscript.test.ts` 的 "10 warnings→80" / "20→60" / "21→58" 用例基于 WARN_PENALTY=2。校准后(如 =10)改为对应新边界(如 2 warnings→80,6→40 fail)。保持测试与系数一致。

- [ ] **Step 5: final verification**

Run:
```bash
npx tsc --noEmit
npm run lint
npx vitest run
```
Expected:tsc 0 error / eslint 0 / vitest 全绿(含 M3c 新测试)。

- [ ] **Step 6: 本地 score 端到端**

Run:
```bash
GODOT_PATH=<...> npm run check:gdscript
npm run score
npm run score:gate
cat coverage/score.json | node -e "process.stdin.resume();"
```
确认 score.json 的 `dimensions.gdscript` 从 na 变真实值,`unverified` 不含 gdscript。score:gate 在 addon 干净时过。

- [ ] **Step 7: Commit 校准**

```bash
git -C D:/GitHub/godot-mcp-enhanced add src/scoring/dimensions.ts test/scoring/gdscript.test.ts
git -C D:/GitHub/godot-mcp-enhanced commit -m "fix(scoring): WARN_PENALTY 基线校准(M3c Task 7)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review(plan 写完后自查,已执行)

**1. Spec coverage**:
- collectGdscript 三态 + 曲线 + incomplete 优先 → Task 1 ✓
- GdscriptReport interface → Task 1 ✓
- generate-score/cli 接 gdscriptReportPath → Task 2 ✓
- report.ts dimMetric gdscript case → Task 3 ✓
- runGodotHeadless 共享 helper + runImport 重构 → Task 4 ✓
- check-gdscript.ts(GODOT_PATH 防假绿/复制 addon/import/解析/false negative 断言)→ Task 5 ✓
- project.godot 用 Godot 模板(R5)→ Task 5 Step 5 ✓
- package.json + .gitignore → Task 5 Step 6 ✓
- CI check job 装 Godot + check-gdscript step → Task 6 ✓
- Task 0 基线 + WARN_PENALTY 反推 → Task 7 ✓
- WARN_PENALTY 占位值(R4)→ Task 1 Step 4(`=2`)+ Task 7 校准 ✓
- incomplete raw 诚实标记(R6)→ Task 1 collectGdscript incomplete 分支 `raw.incomplete:true` ✓
- stderr 贴版本(R2)→ Task 5 parseGdscriptOutput 单测(命中案例)+ 真实 Godot integration(Task 5 Step 7 / Task 7 Step 1 真实 stderr)✓
- 运行时缺陷边界(R1)→ spec 已声明,plan 不涉及(非 M3c 实现)✓

**2. Placeholder scan**:WARN_PENALTY 标"占位 2"(Task 1)+ Task 7 校准——是设计意图(依赖基线),非缺失。无 TBD/TODO/未定义引用。check-gdscript.ts ESM invoked 写法给了两种版本(执行者按 ESM 实现),非 placeholder。

**3. Type consistency**:`GdscriptReport` interface(Task 1 types.ts)字段 = collectGdscript 消费(Task 1)+ check-gdscript 产出(Task 5 `writeReport({...errors,warnings,files,details,detailsTotal,incomplete,reason})`)+ report.ts dimMetric 读 `raw.errors/raw.warnings`(Task 3)+ check-gdscript.test parseGdscriptOutput 返回 `{errors,warnings,details,detailsTotal}`(子集,main 补 files/incomplete)。字段名一致。`runGodotHeadless` 签名(Task 4)→ check-gdscript 调用(Task 5 `runGodotHeadless(args, godotPath, 120_000)`)一致。`WARN_PENALTY` import 路径(dimensions.js)在 gdscript.ts/Task 1 一致。

无问题,plan 可执行。
