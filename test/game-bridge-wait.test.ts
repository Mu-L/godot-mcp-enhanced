// test/game-bridge-wait.test.ts
// CRITICAL-3 regression tests: pollWaitCondition must actually poll within the
// timeout window instead of returning a single snapshot. probe/sleep are both
// injected so no real socket or timer is involved.
import { describe, it, expect } from 'vitest';
import { pollWaitCondition } from '../src/tools/game-bridge.js';
import type { BridgeResponse } from '../src/tools/game-bridge.js';

// A no-op sleep keeps tests instant and deterministic — we drive all timing
// via the returned probe call sequence rather than wall-clock waiting.
const noSleep = async (): Promise<void> => { /* deterministic: no real delay */ };

describe('pollWaitCondition (CRITICAL-3 fix)', () => {
  it('polls wait_for_node until exists becomes true', async () => {
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      return { id: 1, result: { exists: calls >= 3, path: 'root/Player' } };
    };

    const out = await pollWaitCondition('wait_for_node', probe, 10000, 200, noSleep);

    expect(calls).toBe(3);
    expect(out.wait_completed).toBe(true);
    expect(out.exists).toBe(true);
    expect(out.path).toBe('root/Player');
    expect(out.timed_out).toBeUndefined();
    expect(typeof out.elapsed_ms).toBe('number');
  });

  it('全仓审查: probe reject(网络超时/断连)不烧掉等待预算——窗口内继续轮询,恢复后可满足', async () => {
    // 游戏 main 线程卡顿超过单次探测超时(interval×2)时 probe throw
    // BridgeTimeoutError——修复前异常上传播立即失败;修复后视为本轮不可用继续轮询。
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      if (calls <= 2) {
        throw new Error('Bridge request timed out after 400ms');
      }
      return { id: 1, result: { exists: true, path: 'root/Player' } };
    };

    const out = await pollWaitCondition('wait_for_node', probe, 10000, 200, noSleep);

    expect(calls).toBe(3);  // 前 2 次 throw 后继续,第 3 次成功
    expect(out.wait_completed).toBe(true);
    expect(out.exists).toBe(true);
  });

  it('全仓审查: probe 持续 reject 到预算耗尽 → 走正常 timed_out 路径(而非异常上传播)', async () => {
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      throw new Error('Bridge request timed out after 400ms');
    };

    const out = await pollWaitCondition('wait_for_node', probe, 0, 200, noSleep);

    expect(calls).toBe(1);  // totalMs=0:首轮 probe 后预算即尽
    expect(out.wait_completed).toBe(false);
    expect(out.timed_out).toBe(true);
  });

  it('polls wait_for_property until match becomes true', async () => {
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      return {
        id: 1,
        result: { match: calls >= 2, property: 'health', current: 100, expected: 100 },
      };
    };

    const out = await pollWaitCondition('wait_for_property', probe, 5000, 100, noSleep);

    expect(calls).toBe(2);
    expect(out.wait_completed).toBe(true);
    expect(out.match).toBe(true);
    expect(out.property).toBe('health');
    expect(out.timed_out).toBeUndefined();
  });

  it('returns timed_out when condition never holds within budget', async () => {
    let calls = 0;
    // Always false. With totalMs=0 the very first probe runs, condition fails,
    // and elapsed (>=0) immediately meets the budget → single probe + timeout.
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      return { id: 1, result: { exists: false, path: 'root/Enemy' } };
    };

    const out = await pollWaitCondition('wait_for_node', probe, 0, 200, noSleep);

    expect(calls).toBe(1);
    expect(out.wait_completed).toBe(false);
    expect(out.timed_out).toBe(true);
    expect(out.exists).toBe(false);
    expect(typeof out.elapsed_ms).toBe('number');
  });

  it('aborts immediately on Bridge error without further polling', async () => {
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      return { id: 1, error: { code: -1, message: 'Node not found: root/Missing' } };
    };

    const out = await pollWaitCondition('wait_for_node', probe, 10000, 200, noSleep);

    expect(calls).toBe(1);
    expect(out.wait_completed).toBe(false);
    expect(out.timed_out).toBeUndefined();
    expect(out.error).toEqual({ code: -1, message: 'Node not found: root/Missing' });
  });

  it('does not treat a missing result field as satisfied', async () => {
    // Bridge returning an empty/odd result must not be misread as "satisfied".
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      return { id: 1, result: {} };
    };

    const out = await pollWaitCondition('wait_for_node', probe, 0, 200, noSleep);

    expect(calls).toBe(1);
    expect(out.wait_completed).toBe(false);
    expect(out.timed_out).toBe(true);
  });

  it('succeeds on first probe when condition already holds', async () => {
    let calls = 0;
    const probe = async (): Promise<BridgeResponse> => {
      calls++;
      return { id: 1, result: { exists: true, path: 'root/Ready' } };
    };

    const out = await pollWaitCondition('wait_for_node', probe, 10000, 200, noSleep);

    expect(calls).toBe(1);
    expect(out.wait_completed).toBe(true);
  });
});
