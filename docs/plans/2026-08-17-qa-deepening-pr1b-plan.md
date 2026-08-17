# PR-1b:QA 应用级异步长跑 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `qa run` 支持 `mode:'async'`(立即返回 run_id 后台执行),新增 `qa status`/`qa cancel`,run 注册表(SEP-1686 词汇,PR-2 的单一事实源),取消语义(步骤间检查 + teardown 照常 + `CANCELLED` 终态),close 优雅收尾;顺手修 `assertNodeState` 嵌套 shape 失真(PR-1a e2e 发现的既有缺陷)。

**Architecture:** 注册表 `src/tools/qa/registry.ts` 独立无依赖(仅 import report 类型),内存 Map + 惰性 TTL 清扫;`runQaSuite` 增加可选 `ctl` 控制对象(取消查询 + 进度回调),复用现有 `aborted` SKIPPED 机制实现取消;`index.ts` 层 mode 分流(async = 注册 → 后台 promise → 立即返;sync = 注册 → await → 终态,行为零变化);`GodotServer.close()` 用既有 `safeStep` 挂收尾。

**Tech Stack:** TypeScript(ES2022/strict/ESM,import 带 `.js`)+ Vitest。零新依赖。

**Spec:** `docs/plans/2026-08-17-qa-deepening-spec.md` §2(PR-1b)+ §0.5 约束 + §4/§5 验收。前置 PR-1a 已合并 master(604c654)。

## Global Constraints

- 工作目录 `D:\GitHub\godot-mcp-series\godot-mcp-enhanced`;分支 `feat/qa-async-run`(Task 1 建);Conventional Commits(type 英文前缀、subject 中文)。
- TypeScript:`strict` + `noUncheckedIndexedAccess`,禁 `any`;ESM import 带 `.js`;`npm run lint` 零警告。
- **默认零破坏**:`mode` 默认 `'sync'`,sync 行为与 CLI nightly 路径零变化(回归以 `test/qa-cli-nightly.test.ts` 全绿为准)。
- **并发约束(硬性)**:全局同一时刻仅 1 个 working run;第二个 run 请求(sync 或 async)→ `BUSY` 错误(附当前 run_id 与进度)。
- 取消语义:步骤间检查(单步不中断,step_timeout/suite_budget 兜底);取消后剩余步骤 `SKIPPED('cancelled by user')`;teardown 照常;`summary.status='CANCELLED'` 优先于 FAILED(半途报告);CANCELLED 报告不作 nightly 基线。
- `taskId = run_id`(单一标识);status 词汇 `working|completed|failed| cancelled`(SEP-1686);`done` promise 与 `cancelRequested` 为内部字段不出 wire。
- mock 带真实 shape(既有教训);每任务 TDD;全部完成后 `npm run build` + `npm test` + `npm run build-matrix` + `npm run check:budget` 全绿。

---

### Task 1:run 注册表 registry.ts

**Files:**
- Create: `src/tools/qa/registry.ts`
- Test: `test/qa-registry.test.ts`(新)

**Interfaces:**
- Consumes: `QaReport` type(`./report.js`)。
- Produces(后续任务全部依赖):
  ```ts
  export type QaRunStatus = 'working' | 'completed' | 'failed' | 'cancelled';
  export interface RunRecord {
    taskId: string; status: QaRunStatus; suite_name: string; project_path: string;
    createdAt: string; lastUpdatedAt: string; ttl: number;   // ms,终态保留时长(默认 3600_000)
    progress: { step: number; total: number; current?: string };
    cancelRequested: boolean;                                  // 内部字段,不出 wire
    done?: Promise<void>;                                      // 内部字段,close 收尾 await 用
    report?: QaReport;
    reportPaths?: { json_path: string; md_path: string };
  }
  export class QaBusyError extends Error { readonly currentRunId: string; ... }
  export function registerRun(runId, suiteName, projectPath, stepsTotal): RunRecord  // 已有 working → throw QaBusyError
  export function getRun(runId): RunRecord | undefined        // 惰性清扫过期终态
  export function listRuns(): RunRecord[]                     // 同上
  export function activeWorkingRun(): RunRecord | undefined
  export function requestCancel(runId): { ok: boolean; message?: string }  // 非 working → ok:false
  export function finishRun(runId, status: 'completed'|'failed'|'cancelled', report?, reportPaths?): void
  export function updateProgress(runId, step, total, current?): void
  export function clearRegistry(): void                       // 测试隔离/关闭
  ```

- [ ] **Step 1:写失败测试**

```ts
// test/qa-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRun, getRun, listRuns, activeWorkingRun, requestCancel,
  finishRun, updateProgress, clearRegistry, QaBusyError,
} from '../src/tools/qa/registry.js';

beforeEach(() => clearRegistry());

describe('qa run registry', () => {
  it('registerRun 创建 working 记录,progress 初始化', () => {
    const r = registerRun('run-1', 'suiteA', 'D:/proj', 5);
    expect(r.status).toBe('working');
    expect(r.taskId).toBe('run-1');
    expect(r.progress).toEqual({ step: 0, total: 5 });
    expect(r.cancelRequested).toBe(false);
    expect(r.ttl).toBeGreaterThan(0);
  });

  it('并发约束:已有 working 再注册 → QaBusyError 带当前 run_id', () => {
    registerRun('run-1', 'a', 'D:/p', 3);
    expect(() => registerRun('run-2', 'b', 'D:/p', 3)).toThrow(QaBusyError);
    try { registerRun('run-3', 'c', 'D:/p', 3); } catch (e) {
      expect((e as QaBusyError).currentRunId).toBe('run-1');
    }
  });

  it('终态后可再注册(working 互斥仅对 working)', () => {
    registerRun('run-1', 'a', 'D:/p', 1);
    finishRun('run-1', 'completed');
    const r2 = registerRun('run-2', 'a', 'D:/p', 1);
    expect(r2.status).toBe('working');
  });

  it('requestCancel:working → ok 且置位;终态 → ok:false 带原因', () => {
    registerRun('run-1', 'a', 'D:/p', 1);
    expect(requestCancel('run-1')).toEqual({ ok: true });
    expect(getRun('run-1')!.cancelRequested).toBe(true);
    finishRun('run-1', 'completed');
    const r = requestCancel('run-1');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('completed');
  });

  it('requestCancel 未知 run_id → ok:false', () => {
    const r = requestCancel('nope');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('不在运行注册表');
  });

  it('updateProgress 更新 step/total/current 与 lastUpdatedAt', () => {
    registerRun('run-1', 'a', 'D:/p', 4);
    updateProgress('run-1', 2, 4, 'input(send_key)');
    const r = getRun('run-1')!;
    expect(r.progress).toEqual({ step: 2, total: 4, current: 'input(send_key)' });
  });

  it('TTL 惰性清扫:终态超 ttl 后 getRun/listRuns 不再返回', () => {
    const r = registerRun('run-1', 'a', 'D:/p', 1);
    finishRun('run-1', 'failed');
    // 手动把 lastUpdatedAt 回拨到 ttl 之外
    (r as { lastUpdatedAt: string }).lastUpdatedAt = new Date(Date.now() - r.ttl - 1000).toISOString();
    expect(getRun('run-1')).toBeUndefined();
    expect(listRuns()).toHaveLength(0);
  });

  it('activeWorkingRun 返回 working 记录,终态后 undefined', () => {
    registerRun('run-1', 'a', 'D:/p', 1);
    expect(activeWorkingRun()?.taskId).toBe('run-1');
    finishRun('run-1', 'cancelled');
    expect(activeWorkingRun()).toBeUndefined();
  });

  it('finishRun 回填 report 与 reportPaths', () => {
    registerRun('run-1', 'a', 'D:/p', 1);
    finishRun('run-1', 'completed', { version: 1, run_id: 'run-1' } as never, { json_path: 'x.json', md_path: 'x.md' });
    const r = getRun('run-1')!;
    expect(r.report?.run_id).toBe('run-1');
    expect(r.reportPaths?.json_path).toBe('x.json');
  });
});
```

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-registry.test.ts
```
Expected: FAIL(模块不存在)。

- [ ] **Step 3:实现 src/tools/qa/registry.ts**

```ts
// src/tools/qa/registry.ts — QA run 注册表(PR-1b 应用级异步;PR-2 tasks 层的单一事实源)
//
// 词汇对齐 SEP-1686 task lifecycle:status = working|completed|failed|cancelled,
// taskId = 报告 run_id(单一标识)。内存 Map + 惰性 TTL 清扫(不起常驻 timer,
// get/list 时顺带清过期终态;server 重启即丢,status 查不到时引导读落盘报告)。
// 并发约束:全局同一时刻仅 1 个 working run(bridge 单连接 + watch/monitor 单订阅槽,
// 并行 run 必互踩)——registerRun 对 working 互斥,抛 QaBusyError。

import type { QaReport } from './report.js';

export type QaRunStatus = 'working' | 'completed' | 'failed' | 'cancelled';

export interface RunRecord {
  taskId: string;
  status: QaRunStatus;
  suite_name: string;
  project_path: string;
  createdAt: string;
  lastUpdatedAt: string;
  /** 终态保留时长(ms,默认 1h);透传 wire TaskStatusNotificationParams.ttl 时按目标单位换算 */
  ttl: number;
  progress: { step: number; total: number; current?: string };
  /** 内部字段,不出 wire */
  cancelRequested: boolean;
  /** 内部字段,不出 wire;close 收尾 await 用 */
  done?: Promise<void>;
  report?: QaReport;
  reportPaths?: { json_path: string; md_path: string };
}

const DEFAULT_TTL_MS = 3_600_000;
const registry = new Map<string, RunRecord>();

export class QaBusyError extends Error {
  readonly currentRunId: string;
  constructor(currentRunId: string) {
    super(`已有进行中的 QA run(${currentRunId});bridge 单连接约束下同时仅允许 1 个 run,先 qa status 轮询其完成或 qa cancel 取消`);
    this.name = 'QaBusyError';
    this.currentRunId = currentRunId;
  }
}

function isTerminal(r: RunRecord): boolean {
  return r.status !== 'working';
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, r] of registry) {
    if (isTerminal(r) && Date.now() - Date.parse(r.lastUpdatedAt) > r.ttl) registry.delete(id);
  }
  void now;
}

export function registerRun(runId: string, suiteName: string, projectPath: string, stepsTotal: number): RunRecord {
  const working = activeWorkingRun();
  if (working) throw new QaBusyError(working.taskId);
  const now = new Date().toISOString();
  const rec: RunRecord = {
    taskId: runId, status: 'working',
    suite_name: suiteName, project_path: projectPath,
    createdAt: now, lastUpdatedAt: now, ttl: DEFAULT_TTL_MS,
    progress: { step: 0, total: stepsTotal },
    cancelRequested: false,
  };
  registry.set(runId, rec);
  return rec;
}

export function getRun(runId: string): RunRecord | undefined {
  sweepExpired();
  return registry.get(runId);
}

export function listRuns(): RunRecord[] {
  sweepExpired();
  return [...registry.values()];
}

export function activeWorkingRun(): RunRecord | undefined {
  for (const r of registry.values()) if (r.status === 'working') return r;
  return undefined;
}

export function requestCancel(runId: string): { ok: boolean; message?: string } {
  const r = registry.get(runId);
  if (!r) return { ok: false, message: `run_id 不在运行注册表(server 可能已重启),尝试 qa report "${runId}" 读落盘报告` };
  if (r.status !== 'working') return { ok: false, message: `run 已终态(${r.status}),不可取消` };
  r.cancelRequested = true;
  r.lastUpdatedAt = new Date().toISOString();
  return { ok: true };
}

export function finishRun(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  report?: QaReport,
  reportPaths?: { json_path: string; md_path: string },
): void {
  const r = registry.get(runId);
  if (!r) return;
  r.status = status;
  r.lastUpdatedAt = new Date().toISOString();
  if (report) r.report = report;
  if (reportPaths) r.reportPaths = reportPaths;
}

export function updateProgress(runId: string, step: number, total: number, current?: string): void {
  const r = registry.get(runId);
  if (!r || r.status !== 'working') return;
  r.progress = current !== undefined ? { step, total, current } : { step, total };
  r.lastUpdatedAt = new Date().toISOString();
}

export function clearRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-registry.test.ts
```
Expected: 9 passed。

- [ ] **Step 5:Commit**

```bash
git checkout -b feat/qa-async-run   # 若分支已存在则跳过此行
git add src/tools/qa/registry.ts test/qa-registry.test.ts
git commit -m "feat(qa): run 注册表——SEP-1686 词汇,单 working 互斥(BUSY),TTL 惰性清扫"
```

---

### Task 2:runner 取消信号与进度钩子 + CANCELLED 终态

**Files:**
- Modify: `src/tools/qa/runner.ts`(`runQaSuite` 加 ctl 与 runId 参数;步骤循环取消检查;finalizeSummary CANCELLED)
- Modify: `src/tools/qa/report.ts`(summary.status 类型 + renderMarkdown)
- Test: `test/qa-runner.test.ts`

**Interfaces:**
- Produces(Task 4 依赖):
  ```ts
  export interface QaRunControl {
    cancelRequested(): boolean;
    onProgress?(step: number, total: number, current: string): void;
  }
  // runQaSuite 签名(在现有 4 参后追加 2 个可选参):
  export function runQaSuite(suite, projectPath, ctx, specSource, ctl?: QaRunControl, runIdOverride?: string): Promise<QaReport>
  ```
- `QaReport['summary']['status']` 扩为 `'PASSED' | 'FAILED' | 'CANCELLED'`。

- [ ] **Step 1:写失败测试(test/qa-runner.test.ts 追加;沿用 suite()/mock 惯例)**

```ts
describe('qa runner: 取消信号与 CANCELLED 终态(PR-1b)', () => {
  it('第 2 步后取消:剩余步骤 SKIPPED(cancelled by user),summary CANCELLED,前 2 步状态保留', async () => {
    let stepsExecuted = 0;
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'send_key') { stepsExecuted++; return { result: {} }; }
      return { result: {} };
    });
    const suite = suiteOf([
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
    ]);
    const ctl = { cancelRequested: () => stepsExecuted >= 2 };  // 第 3 步前生效
    const report = await runQaSuite(suite, PROJECT, makeCtx(), 'inline', ctl);
    expect(report.summary.status).toBe('CANCELLED');
    expect(report.steps[2]!.skip_reason).toBe('cancelled by user');
    expect(report.steps[0]!.status).toBe('PASSED');
    expect(report.steps[1]!.status).toBe('PASSED');
  });

  it('取消优先于 FAILED:取消前已有失败步骤,summary 仍 CANCELLED(半途报告不作基线)', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'get_node_properties') return { result: { health: 50 } };
      return { result: {} };
    });
    let first = true;
    const suite = suiteOf([
      { type: 'assert', assert: 'node_state', path: '/root/P', expect: { health: 999 } },  // FAILED
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
    ]);
    // continue_on_failure: true 让 FAILED 后继续,再取消
    const ctl = { cancelRequested: () => !first, };
    first = false; // 立即取消 → 等等,这样第 1 步前就取消了。
    // 改用计数:
    let executed = 0;
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      executed++;
      if (method === 'get_node_properties') return { result: { health: 50 } };
      return { result: {} };
    });
    const ctl2 = { cancelRequested: () => executed >= 1 };
    const report = await runQaSuite({ ...suiteOf([
      { type: 'assert', assert: 'node_state', path: '/root/P', expect: { health: 999 } },
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
    ]), options: { continue_on_failure: true } } as never, PROJECT, makeCtx(), 'inline', ctl2);
    expect(report.summary.status).toBe('CANCELLED');
    expect(report.summary.failed).toBe(1);
  });

  it('onProgress 回调随步骤推进上报(与 ctx.progress 同点位)', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ result: {} } as never);
    const calls: string[] = [];
    const suite = suiteOf([
      { type: 'input', method: 'send_key', params: { key: 'ui_accept' } },
      { type: 'sleep', ms: 100 },
    ]);
    await runQaSuite(suite, PROJECT, makeCtx(), 'inline', { cancelRequested: () => false, onProgress: (s, t, c) => calls.push(`${s}/${t}:${c}`) });
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('input');
  });

  it('runIdOverride:报告 run_id 用外部传入值(注册表 taskId 与报告一致)', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ result: {} } as never);
    const suite = suiteOf([{ type: 'sleep', ms: 100 }]);
    const report = await runQaSuite(suite, PROJECT, makeCtx(), 'inline', undefined, '20260817-120000-myid');
    expect(report.run_id).toBe('20260817-120000-myid');
  });

  it('renderMarkdown 显示 CANCELLED 结果行', async () => {
    const md = renderMarkdown({ /* 最小报告 */ version: 1, run_id: 'r', suite: { name: 's', project_path: 'p', started_at: '', spec_source: 'inline' }, options: {}, summary: { total: 1, passed: 0, failed: 0, errors: 0, skipped: 1, status: 'CANCELLED', duration_ms: 5 }, steps: [] });
    expect(md).toContain('CANCELLED');
  });
});
```

> 注:第 2 用例上方那段"立即取消"的草稿代码不要保留——以最终用例代码为准(实现者清理为单一连贯用例,保留 `executed` 计数版本)。若 `suiteOf` helper 不支持 options 覆盖,按现有 helper 惯例扩展或内联构造(走 parseQaSuite)。

- [ ] **Step 2:跑测试确认失败**

```bash
npx vitest run test/qa-runner.test.ts
```
Expected: 新 describe FAIL(ctl 参数不存在/状态无 CANCELLED)。

- [ ] **Step 3:实现**

3a. `src/tools/qa/runner.ts`:
- 类型与签名(在 RunState 附近):

```ts
/** 外部控制钩子(PR-1b):cancelRequested 步骤间轮询;onProgress 与 ctx.progress 同点位 */
export interface QaRunControl {
  cancelRequested(): boolean;
  onProgress?(step: number, total: number, current: string): void;
}
```

- `runQaSuite(suite, projectPath, ctx, specSource, ctl?: QaRunControl, runIdOverride?: string)`;`const runId = runIdOverride ?? makeRunId(suite.name);`
- 步骤循环内(现有 `if (aborted)` 检查之前、budget 检查之后)加:

```ts
        if (!aborted && ctl?.cancelRequested()) {
          aborted = 'cancelled by user';
          rec.skip_reason = 'cancelled by user';
          continue;
        }
```

- 现有 `ctx.progress?.(...)` 行后加 `ctl?.onProgress?.(i + 1, suite.steps.length, `${step.type}${step.label ? ` (${step.label})` : ''}`);`
- `finalizeSummary(report, startedMs, cancelled: boolean)`:status 计算改为

```ts
    status: cancelled ? 'CANCELLED' : (anyNotPassed || report.setup_error ? 'FAILED' : 'PASSED'),
```

调用点:`finalizeSummary(report, startedMs, aborted === 'cancelled by user')`。

3b. `src/tools/qa/report.ts`:
- `summary.status` 类型:`'PASSED' | 'FAILED' | 'CANCELLED'`;
- renderMarkdown 的 result 行已用 `${s.status}` 插值,无需改逻辑(类型放宽即可),但确认 `[!cancel]` 语义正确展示。

- [ ] **Step 4:跑测试确认通过**

```bash
npx vitest run test/qa-runner.test.ts test/qa-report.test.ts
```
Expected: 全 PASS(qa-report 旧用例不受类型扩展影响)。

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/runner.ts src/tools/qa/report.ts test/qa-runner.test.ts
git commit -m "feat(qa): runQaSuite 取消信号+进度钩子,CANCELLED 终态(取消优先于 FAILED)"
```

---

### Task 3:CANCELLED 报告不作 nightly 基线

**Files:**
- Modify: `src/tools/qa/report.ts`(`findPreviousReport` 跳过 CANCELLED)
- Test: `test/qa-report.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `summary.status` 含 `'CANCELLED'`。

- [ ] **Step 1:写失败测试**

```ts
describe('findPreviousReport 跳过 CANCELLED(PR-1b)', () => {
  it('CANCELLED 报告不作为基线候选,继续往前找', () => {
    // 用 GODOT_MCP_QA_REPORTS_DIR 指向临时目录,落 3 份报告:
    // old-PASSED(base 期望) → mid-CANCELLED(应被跳过) → new-PASSED(exclude)
    // findPreviousReport(new.run_id, 'suiteX') 应命中 old 而非 mid
    // (按现有 qa-report 测试的临时目录+写 JSON 文件惯例构造;run_id 需满足时间戳排序)
  });
});
```

> 实现者按 `test/qa-report.test.ts` 现有 findPreviousReport 用例的构造方式(env 重定向 + writeFileSync 落 3 份 JSON,run_id 用可排序时间戳如 `20260101-000001-x`)落实;断言命中 old。

- [ ] **Step 2:跑测试确认失败**(现状命中 mid-CANCELLED)

- [ ] **Step 3:实现——findPreviousReport 循环内加一条候选过滤**

```ts
    if (rep.summary?.status === 'CANCELLED') continue;  // 半途报告不作基线(PR-1b I-5)
```

(插在 `if (rep.suite?.name === suiteName) return rep;` 判定之前、碰撞校验之后;保持损坏候选跳过语义。)

- [ ] **Step 4:跑测试确认通过**(`npx vitest run test/qa-report.test.ts`)

- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/report.ts test/qa-report.test.ts
git commit -m "fix(qa): CANCELLED 报告不作 nightly 基线(半途报告防虚假 fixed)"
```

---

### Task 4:index.ts 接线——mode:async + status/cancel action

**Files:**
- Modify: `src/tools/qa/index.ts`(mode 参数、status/cancel action、BUSY、actionRisks)
- Modify: `test/risk-declarations.test.ts`(补 qa describe)
- Test: `test/qa-index.test.ts`

**Interfaces:**
- Consumes: Task 1 registry 全 API;Task 2 `runQaSuite(..., ctl?, runIdOverride?)` 与 `QaRunControl`。
- Produces: 工具接口(`mode: 'sync'|'async'` 默认 sync;action `status {run_id?}`;action `cancel {run_id}`);status→QaRunStatus 映射(`PASSED→completed;CANCELLED→cancelled;FAILED→failed`)。

- [ ] **Step 1:写失败测试(test/qa-index.test.ts 追加;沿用现有 handleTool 测试惯例,vi.mock runner 或用真 runner+mock bridge——按该文件现有模式)**

```ts
describe('qa run mode:async + status/cancel(PR-1b)', () => {
  it('async 立即返回 run_id/working/hint,后台完成后 status 见终态与报告路径', async () => {
    // mock sendToBridge 全成功 + sleep 步骤可控(或 monitor 类慢步骤);
    // res1 = handleTool run {mode:'async', spec:{...2 步...}, project_path}
    // expect res1.data.status === 'working' && res1.data.run_id && res1.data.hint 含 'qa status'
    // 轮询 handleTool status {run_id} 至终态(上限 10s)→ completed + report.json_path 存在
  });
  it('BUSY:async 进行中再发 async run → BUSY 错误带当前 run_id', async () => { /* 第一 run 卡在慢步骤(sendToBridge 挂起 promise),第二 run 请求 → error_code BUSY;完毕后 resolve 挂起 */ });
  it('sync 模式仍同步返回完整结果且入注册表(终态)', async () => { /* sync run → data.run_id;status {run_id} 立即终态 */ });
  it('status 不传 run_id → 列表含刚完成的 run', async () => { /* data.runs 数组含 run_id */ });
  it('status 未知 run_id → 可行动提示读 qa report', async () => { /* data.hint 含 'qa report' */ });
  it('cancel:working → ok;后台 run 以 CANCELLED 终态(SKIPPED cancelled by user)', async () => { /* 慢步骤中途 cancel → status 轮询至 cancelled;report.summary.status==='CANCELLED' */ });
  it('cancel 已终态 run → INVALID_PARAMS', async () => { /* error_code INVALID_PARAMS + message 含终态 */ });
});
```

(用例以行为断言落地,注释即验收标准;慢步骤用 `new Promise(r => setTimeout(r, 500))` 型 mock sendToBridge 实现,测完清理。)

- [ ] **Step 2:跑测试确认失败**

- [ ] **Step 3:实现——index.ts**

3a. `TOOL_META.actionRisks` 加:

```ts
      status: 'read' as const,
      cancel: 'process' as const,   // 干预运行中进程(置取消标志,teardown 收尾)
```

3b. action enum 扩 `['run', 'report', 'diff', 'status', 'cancel']`;schema 加字段:

```ts
        mode: { type: 'string', enum: ['sync', 'async'], description: 'run: sync=同步等完整结果(默认,行为不变);async=立即返回 run_id 后台执行(长套件防客户端超时),用 qa status 轮询、qa report 读结果、qa cancel 取消' },
        run_id: { type: 'string', description: 'status/cancel: 目标 run_id(status 省略=列出全部注册 run)' },
```

3c. `handleRun` 改造(核心分流,保留既有 spec 解析/project_path 校验不动):

```ts
  const mode = args.mode === 'async' ? 'async' : 'sync';
  const runId = makeRunId(suite.name);   // index 层生成,注册表与报告同一 id
  // BUSY 门:sync/async 一视同仁
  let record: RunRecord;
  try {
    record = registerRun(runId, suite.name, projectPath, suite.steps.length);
  } catch (busy) {
    if (busy instanceof QaBusyError) {
      const cur = activeWorkingRun();
      return opsErrorResult('BUSY', busy.message, { current_run_id: busy.currentRunId, progress: cur?.progress });
    }
    throw busy;
  }
  const ctl: QaRunControl = {
    cancelRequested: () => record.cancelRequested,
    onProgress: (step, total, current) => updateProgress(runId, step, total, current),
  };
  const exec = runQaSuite(suite, projectPath, ctx, specSource, ctl, runId)
    .then((report) => {
      const paths = writeReport(report);
      finishRun(runId, report.summary.status === 'PASSED' ? 'completed' : report.summary.status === 'CANCELLED' ? 'cancelled' : 'failed', report, paths);
      return { report, paths };
    });
  record.done = exec.then(() => undefined, () => undefined);

  if (mode === 'async') {
    return textResult(JSON.stringify({
      success: true,
      data: {
        run_id: runId, status: 'working',
        suite_name: suite.name, steps_total: suite.steps.length,
        hint: `qa status(run_id:"${runId}") 轮询进度;qa report(report_path:"${runId}") 读结果;qa cancel(run_id:"${runId}") 取消`,
      },
    }));
  }
  // sync:等完整结果(行为与 PR-1a 前一致,响应结构不变)
  const { report, paths } = await exec;
  // ...沿用现有 stepsCondensed 组装与返回(零变化)
```

> 注意:sync 分支若 exec reject(runQaSuite 理论不抛,teardown 全兜;但 writeReport 可能抛)——保持现有 try/catch 外壳,QaBusyError 之外异常照旧走 QA_ERROR;async 分支 exec 的 reject 已被 record.done 的 `.then(_,()=>{})` 吞掉并在终态前……不行:async 下若 writeReport 抛,finishRun 不被执行,record 永远 working → 死锁 BUSY。修正:exec 链加 `.catch(err => { finishRun(runId, 'failed'); throw err; })`,async 路径外层再 catch 返回 QA_ERROR。

3d. `status`/`cancel` action(新 case):

```ts
      case 'status': {
        const rid = typeof args.run_id === 'string' && args.run_id ? args.run_id : undefined;
        if (!rid) {
          return textResult(JSON.stringify({ success: true, data: { runs: listRuns().map(condenseRecord) } }));
        }
        const r = getRun(rid);
        if (!r) {
          return opsErrorResult('RUN_NOT_FOUND',
            `run_id "${rid}" 不在运行注册表(server 可能已重启或已过期)。尝试 qa report(report_path:"${rid}") 读落盘报告。`);
        }
        return textResult(JSON.stringify({ success: true, data: { run: condenseRecord(r) } }));
      }
      case 'cancel': {
        const rid = typeof args.run_id === 'string' && args.run_id ? args.run_id : '';
        if (!rid) return opsErrorResult('INVALID_PARAMS', 'cancel 需要 run_id');
        const r = requestCancel(rid);
        if (!r.ok) return opsErrorResult('INVALID_PARAMS', r.message ?? '取消失败');
        return textResult(JSON.stringify({ success: true, data: { run_id: rid, cancel_requested: true, note: '取消在当前步骤结束后生效,teardown 照常收尾' } }));
      }
```

`condenseRecord(r)`:taskId/status/suite_name/progress/createdAt/lastUpdatedAt + 终态附 reportPaths 与 summary 摘要(**不含** cancelRequested/done/report 全文)。

- [ ] **Step 4:risk-declarations 补 qa describe(照 cases 表惯例)**

```ts
describe('qa actionRisks', () => {
  const cases = { run: 'process', report: 'read', diff: 'read', status: 'read', cancel: 'process' } as const;
  for (const [a, r] of Object.entries(cases)) it(`qa.${a}→${r}`, () => expect(getActionRisk('qa', a)).toBe(r));
});
```

- [ ] **Step 5:跑测试确认通过**

```bash
npx vitest run test/qa-index.test.ts test/risk-declarations.test.ts test/qa-cli-nightly.test.ts
```
Expected: 全 PASS(nightly 回归 = CLI sync 零变化)。

- [ ] **Step 6:Commit**

```bash
git add src/tools/qa/index.ts test/qa-index.test.ts test/risk-declarations.test.ts
git commit -m "feat(qa): mode:async 后台执行 + status/cancel action + BUSY 互斥 + actionRisks"
```

---

### Task 5:GodotServer.close 优雅收尾进行中 run

**Files:**
- Modify: `src/GodotServer.ts`(close() 的 safeStep 序列加一项)
- Test: `test/qa-registry.test.ts` 或新 `test/qa-close-cleanup.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `activeWorkingRun/requestCancel`;RunRecord.done。
- 语义:优雅收尾(报告落 CANCELLED + 录制证据落盘);进程级兜底(killProcess)已有,不重复;等待上限 = 该 run 的 `suite_budget_ms` 近似(实现取 `record.ttl` 与 60s 取小——**修正:spec §2.4 说上限=suite_budget_ms;registry 无 budget,取 min(60_000, ttl)**,注释说明)。

- [ ] **Step 1:写失败测试(新文件,测 close 集成太重——测收尾函数本身)**

把收尾逻辑抽为 `src/tools/qa/registry.ts` 导出的独立函数(Task 1 之上追加,便于测试):

```ts
/** close 收尾:对 working run 置取消并等待 settle(上限 ms;超时放弃等——killProcess 兜底已有) */
export async function cancelAndAwaitWorkingRun(maxWaitMs = 60_000): Promise<{ cancelled: string | null; settled: boolean }> {
  const rec = activeWorkingRun();
  if (!rec) return { cancelled: null, settled: true };
  requestCancel(rec.taskId);
  try {
    await Promise.race([rec.done ?? Promise.resolve(), new Promise(r => setTimeout(r, maxWaitMs))]);
    return { cancelled: rec.taskId, settled: rec.status !== 'working' };
  } catch {
    return { cancelled: rec.taskId, settled: false };
  }
}
```

测试(mock record.done 挂起 promise 验证超时路径 + 立即 resolve 验证 settle 路径;`vi.useFakeTimers` 控时)。

- [ ] **Step 2:确认失败 → Step 3:实现(上述函数 + GodotServer 接线)**

`GodotServer.close()` 的 try 序列内(overrides 卸载之后、server.close 之前任一 best-effort 位)加:

```ts
      await safeStep('cancel running qa run', async () => {
        const { cancelled, settled } = await cancelAndAwaitWorkingRun();
        if (cancelled && !settled) getLogger().warn('godot-mcp', `qa run ${cancelled} 未在收尾窗口内 settle(进程级兜底兜住)`);
      });
```

(import 自 `./tools/qa/registry.js`。)

- [ ] **Step 4:跑测试确认通过 + Step 5:Commit**

```bash
npx vitest run test/qa-registry.test.ts
git add src/tools/qa/registry.ts src/GodotServer.ts test/qa-registry.test.ts
git commit -m "feat(qa): close 优雅收尾进行中 run(取消+await settle,killProcess 兜底已有)"
```

---

### Task 6:assertNodeState 嵌套 shape 修复(既有缺陷,PR-1a 登记)

**Files:**
- Modify: `src/tools/runtime-assert.ts`(assertNodeState 双 shape 兼容)
- Test: `test/runtime-assert-actions.test.ts`

**Interfaces:**
- 语义:真 bridge `get_node_properties` 返回 `{properties:{...}, node}`(嵌套);历史/单测形态为平铺。兼容双 shape,嵌套优先。

- [ ] **Step 1:写失败测试(追加用例)**

```ts
it('node_state 兼容真 bridge 嵌套 shape {properties:{...}, node}(PR-1a e2e 发现)', async () => {
  sendToBridge.mockResolvedValueOnce({ result: { properties: { health: 100 }, node: '/root/P' } });
  const r = await handleTool('runtime_assert', { action: 'node_state', path: '/root/P', expect: { health: 100 } }, {} as never);
  const p = JSON.parse((r!.content[0] as { text: string }).text);
  expect(p.passed).toBe(true);
});

it('嵌套 shape 属性不匹配 → FAILED mismatch actual 为真值(非 undefined)', async () => {
  sendToBridge.mockResolvedValueOnce({ result: { properties: { health: 50 }, node: '/root/P' } });
  const r = await handleTool('runtime_assert', { action: 'node_state', path: '/root/P', expect: { health: 100 } }, {} as never);
  const p = JSON.parse((r!.content[0] as { text: string }).text);
  expect(p.passed).toBe(false);
  expect(p.mismatch.health.actual).toBe(50);
});
```

- [ ] **Step 2:确认失败 → Step 3:实现**

```ts
  const raw = (resp.result ?? {}) as Record<string, unknown>;
  // 真 bridge 返回嵌套 {properties:{...}, node}(PR-1a e2e 实测);历史形态平铺。兼容双 shape,嵌套优先。
  const actual = (raw.properties !== undefined && raw.properties !== null && typeof raw.properties === 'object')
    ? raw.properties as Record<string, unknown>
    : raw;
```

(替换原 `const actual = (resp.result as Record<string, unknown>) ?? {};` 一行;文件头注释补一行 PR-1b 修复说明。)

- [ ] **Step 4:确认通过(`npx vitest run test/runtime-assert-actions.test.ts`,旧平铺用例不回归)**

- [ ] **Step 5:Commit**

```bash
git add src/tools/runtime-assert.ts test/runtime-assert-actions.test.ts
git commit -m "fix(assert): node_state 兼容真 bridge 嵌套 shape(properties 键优先,PR-1a e2e 登记缺陷)"
```

---

### Task 7:描述/schema 收口 + matrix + 全量门禁

**Files:**
- Modify: `src/tools/qa/index.ts`(description 收编 mode/status/cancel,保持 <600B)
- 产物: `docs/capability-matrix.{json,md}`

- [ ] **Step 1:qa-index.test.ts 长度断言确认仍 <600**(新 description 约 +80B:在现 407B 基础上把"步骤类型"行后追加一句 `;run 支持 async 后台执行(status/cancel 管理)`——实测字节为准,超了就再收敛别处)
- [ ] **Step 2:matrix 重建 + budget**:`npm run build && npm run build-matrix && npm run check:budget`,node 读 matrix 贴 qa 字节
- [ ] **Step 3:全量门禁**:`npm run lint && npm run build && npm test` 全绿贴数
- [ ] **Step 4:e2e 回归**:`GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-qa-assert-batch.test.ts test/e2e-full-tool-verification.test.ts`(sync 路径零回归)
- [ ] **Step 5:Commit**

```bash
git add src/tools/qa/index.ts docs/capability-matrix.json docs/capability-matrix.md
git commit -m "docs(qa): 描述收编 async/status/cancel + matrix 重建"
```

---

## Self-Review 记录

1. **Spec 覆盖**:§2.1 接口(Task 4)、§2.2 注册表+并发 BUSY(Task 1/4)、§2.3 取消语义+CANCELLED 周边交互(Task 2/3)、§2.4 close 收尾(Task 5)、§2.5 审计风险声明(Task 4 actionRisks+risk-declarations)、§2.6 改动面全对齐(含 build-matrix);CLI 零改动由 Task 4 Step 5 nightly 回归锁定;顺手项 assertNodeState(Task 6)。**无缺口**(monitor vacuous PASS 需 spec 层定义 min_samples,本批不做——语义变更另议,留 PR-2 前小 spec 增补)。
2. **占位符**:Task 4 Step 1 用例为行为注释骨架+验收标准(与 PR-1a 计划同风格,授权实现者按现有测试惯例落地具体断言);Task 3 Step 1 同(按现有 findPreviousReport 用例惯例)。其余步骤含完整代码。
3. **类型一致性**:`QaRunControl`(Task 2 定义,Task 4 消费)、`RunRecord`/registry API(Task 1 定义,Task 4/5 消费)、`cancelAndAwaitWorkingRun`(Task 5 定义于 registry)、status 映射三值(Task 4)。runIdOverride 参数名全链一致。
