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
  for (const [id, r] of registry) {
    if (isTerminal(r) && Date.now() - Date.parse(r.lastUpdatedAt) > r.ttl) registry.delete(id);
  }
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
