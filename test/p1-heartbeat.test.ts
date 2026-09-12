import { describe, it, expect, vi, afterEach } from 'vitest';
import { withToolHeartbeat } from '../src/core/progress.js';
import { readFileSync } from 'node:fs';

/**
 * P1(2026-09-11)心跳保活 — 单元(fake timers)+ 接线契约。
 * 来源:BuildersGate 取消经济学(客户端按 idle 杀无进度调用,server 线程照样跑完扣钱)。
 * 心跳 = 每 20s 一次 progress notification 证明请求活着;20s 内完成的工具零消息。
 */

describe('P1 心跳: withToolHeartbeat 单元', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('HB-a: 无 progressToken(emitter undefined)时直通,零开销', async () => {
    const fn = vi.fn(async () => 'done');
    const r = await withToolHeartbeat(undefined, 'tool', fn);
    expect(r).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('HB-b: 快速完成的工具不发任何心跳(首个 tick 在 20s)', async () => {
    vi.useFakeTimers();
    const emitter = vi.fn();
    await withToolHeartbeat(emitter, 'tool', async () => 'fast');
    vi.advanceTimersByTime(60_000); // fn 已 settle,timer 已清——不应再发
    expect(emitter).not.toHaveBeenCalled();
  });

  it('HB-c: 慢工具每 20s 发心跳,message 明示 heartbeat 语义;settle 后停止', async () => {
    vi.useFakeTimers();
    const emitter = vi.fn();
    let resolveFn!: (v: string) => void;
    const p = withToolHeartbeat(emitter, 'export_build', () => new Promise<string>(res => { resolveFn = res; }));
    vi.advanceTimersByTime(20_000);
    vi.advanceTimersByTime(20_000);
    expect(emitter, '40s 时已发 2 次').toHaveBeenCalledTimes(2);
    const first = emitter.mock.calls[0]!;
    expect(first[2]).toContain('export_build');
    expect(first[2]).toContain('heartbeat, not progress');
    expect(first[0], 'progress 参数为已耗时秒').toBe(20);
    resolveFn('ok');
    expect(await p).toBe('ok');
    const count = emitter.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    expect(emitter.mock.calls.length, 'settle 后 timer 已清').toBe(count);
  });

  it('HB-d: fn 抛异常时 finally 清 timer,异常透传', async () => {
    vi.useFakeTimers();
    const emitter = vi.fn();
    const p = withToolHeartbeat(emitter, 'tool', async () => { throw new Error('boom'); });
    await expect(p).rejects.toThrow('boom');
    const count = emitter.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    expect(emitter.mock.calls.length).toBe(count);
  });
});

describe('P1 心跳: dispatcher 接线契约', () => {
  it('HB-e: ToolDispatcher 主执行路径包心跳', () => {
    const ts = readFileSync('src/core/ToolDispatcher.ts', 'utf8');
    expect(ts.includes('withToolHeartbeat(progressEmitter, name,'), '主路径接线').toBe(true);
    expect(ts.includes("from './progress.js'"), 'import 存在').toBe(true);
  });
});
