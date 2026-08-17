// test/qa-task-view.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { toWireTask, toTaskPayload, assertTaskWire } from '../src/tools/qa/task-view.js';
import { registerRun, finishRun, getRun, clearRegistry } from '../src/tools/qa/registry.js';

beforeEach(() => clearRegistry());

describe('task-view: RunRecord → wire Task', () => {
  it('working 记录 → 五字段 + statusMessage(step N/M: current),ttl 为秒', () => {
    registerRun('r1', 's', 'D:/p', 5);
    const rec = getRun('r1')!;
    rec.progress = { step: 2, total: 5, current: 'input(send_key)' };
    const t = toWireTask(rec);
    expect(t.taskId).toBe('r1');
    expect(t.status).toBe('working');
    expect(t.statusMessage).toBe('step 2/5: input(send_key)');
    expect(t.ttl).toBe(Math.round(rec.ttl / 1000));   // ms→s
    expect(t.createdAt).toBe(rec.createdAt);
    assertTaskWire(t);   // SDK TaskSchema 校验通过
  });

  it('终态记录 → status 直映,无 statusMessage;assertTaskWire 过', () => {
    registerRun('r2', 's', 'D:/p', 1);
    finishRun('r2', 'cancelled');
    const t = toWireTask(getRun('r2')!);
    expect(t.status).toBe('cancelled');
    expect(t.statusMessage).toBeUndefined();
    assertTaskWire(t);
  });

  it('toTaskPayload:终态返回 run_id/summary/report_paths(+error);working 抛', () => {
    registerRun('r3', 's', 'D:/p', 1);
    expect(() => toTaskPayload(getRun('r3')!)).toThrow(/not terminal/);
    finishRun('r3', 'failed', { summary: { status: 'FAILED' } } as never, { json_path: 'j', md_path: 'm' }, 'boom');
    const p = toTaskPayload(getRun('r3')!);
    expect(p.run_id).toBe('r3');
    expect(p.error).toBe('boom');
    expect(p.report_paths).toEqual({ json_path: 'j', md_path: 'm' });
  });
});
