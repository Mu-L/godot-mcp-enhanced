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
