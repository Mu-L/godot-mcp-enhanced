import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolResult } from '../../src/types.js';
import { HealthMonitor } from '../../src/core/health-monitor.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Advance fake timers by ms and flush microtask queue. */
async function tick(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  // Let the async heartbeat callback resolve
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// ─── Statistics recording ─────────────────────────────────────────────────────

describe('HealthMonitor — statistics recording', () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    monitor = new HealthMonitor();
  });

  it('records successes and failures in stats', () => {
    monitor.recordSuccess(50);
    monitor.recordSuccess(100);
    monitor.recordFailure('timeout', 'timed out');

    const stats = monitor.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.totalSuccesses).toBe(2);
    expect(stats.totalFailures).toBe(1);
    expect(stats.consecutiveFails).toBe(1);
    expect(stats.avgResponseMs).toBeCloseTo(75);
  });

  it('resets consecutiveFails on success', () => {
    monitor.recordFailure('timeout', 'err');
    monitor.recordFailure('timeout', 'err');
    expect(monitor.getStats().consecutiveFails).toBe(2);

    monitor.recordSuccess(50);
    expect(monitor.getStats().consecutiveFails).toBe(0);
  });

  it('tracks error history up to limit', () => {
    for (let i = 0; i < 25; i++) {
      monitor.recordFailure('timeout', `err-${i}`);
    }
    const stats = monitor.getStats();
    // Default errorHistorySize is 20
    expect(stats.errors).toHaveLength(20);
    expect(stats.errors[0].message).toBe('err-5'); // first 5 dropped
    expect(stats.errors[19].message).toBe('err-24');
    expect(stats.lastError!.message).toBe('err-24');
  });

  it('marks retriable error types', () => {
    monitor.recordFailure('timeout', 't');
    expect(monitor.getStats().errors[0].retriable).toBe(true);

    monitor.recordFailure('unknown_error', 'u');
    const errors = monitor.getStats().errors;
    expect(errors[errors.length - 1].retriable).toBe(false);
  });

  it('stores scope on errors', () => {
    monitor.recordFailure('timeout', 't', 'editor');
    expect(monitor.getStats().errors[0].scope).toBe('editor');
  });
});

// ─── Baseline ─────────────────────────────────────────────────────────────────

describe('HealthMonitor — baseline', () => {
  it('establishes baseline after 10 successful requests', () => {
    const monitor = new HealthMonitor();
    for (let i = 0; i < 10; i++) {
      monitor.recordSuccess(100 + i * 10); // 100..190ms
    }
    const stats = monitor.getStats();
    expect(stats.baselineResponseMs).toBeCloseTo(145); // avg(100..190)
  });

  it('does not establish baseline with fewer than 10 successes', () => {
    const monitor = new HealthMonitor();
    for (let i = 0; i < 9; i++) monitor.recordSuccess(100);
    expect(monitor.getStats().baselineResponseMs).toBe(0);
  });
});

// ─── State machine ────────────────────────────────────────────────────────────

describe('HealthMonitor — state transitions', () => {
  it('starts in connected state', () => {
    const monitor = new HealthMonitor();
    expect(monitor.getState()).toBe('connected');
  });

  it('transitions to degraded when recent failures exceed threshold', () => {
    const monitor = new HealthMonitor({ degradedThreshold: 3 });
    // Need 3 failures in recent 10
    for (let i = 0; i < 3; i++) {
      monitor.recordFailure('timeout', 'err');
    }
    expect(monitor.getState()).toBe('degraded');
  });

  it('transitions connected→reconnecting on max consecutive failures', () => {
    // B1: 仅 heartbeat 类失败驱动 reconnecting（旧实现用 'timeout' errorType
    // 走旧 bug 路径——consecutiveFails 无差别累加；B1 修复后须用 'heartbeat'）
    const monitor = new HealthMonitor({ maxConsecutiveFailures: 3 });
    for (let i = 0; i < 3; i++) {
      monitor.recordFailure('heartbeat', 'err');
    }
    expect(monitor.getState()).toBe('reconnecting');
  });

  it('recovers from degraded to connected', () => {
    const monitor = new HealthMonitor({ degradedThreshold: 3 });

    // Degrade: 3 failures
    for (let i = 0; i < 3; i++) monitor.recordFailure('timeout', 'err');
    expect(monitor.getState()).toBe('degraded');

    // Establish baseline so recovery can check response time
    for (let i = 0; i < 10; i++) monitor.recordSuccess(100);
    // Fill recent window with successes (< 2 failures)
    for (let i = 0; i < 5; i++) monitor.recordSuccess(100);

    expect(monitor.getState()).toBe('connected');
  });

  it('does not auto-transition from disconnected', () => {
    const monitor = new HealthMonitor();
    monitor.setState('disconnected');

    // Even successes should not change state
    for (let i = 0; i < 20; i++) monitor.recordSuccess(50);
    expect(monitor.getState()).toBe('disconnected');
  });

  it('allows manual setState', () => {
    const monitor = new HealthMonitor();
    monitor.setState('degraded');
    expect(monitor.getState()).toBe('degraded');
    monitor.setState('reconnecting');
    expect(monitor.getState()).toBe('reconnecting');
  });

  it('transitions to degraded on high response time (> 2x baseline)', () => {
    const monitor = new HealthMonitor({ degradedThreshold: 5 }); // high threshold so failure count doesn't trigger
    // Establish baseline at ~100ms
    for (let i = 0; i < 10; i++) monitor.recordSuccess(100);
    expect(monitor.getState()).toBe('connected');

    // Now send 10 slow requests (> 2x baseline = 200ms)
    for (let i = 0; i < 12; i++) monitor.recordSuccess(300);
    expect(monitor.getState()).toBe('degraded');
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe('HealthMonitor — heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls pingFn at heartbeatIntervalMs', async () => {
    const monitor = new HealthMonitor({ heartbeatIntervalMs: 5000 });
    const pingFn = vi.fn().mockResolvedValue(true);

    monitor.startHeartbeat(pingFn);
    expect(pingFn).not.toHaveBeenCalled();

    await tick(5000);
    expect(pingFn).toHaveBeenCalledTimes(1);

    await tick(5000);
    expect(pingFn).toHaveBeenCalledTimes(2);

    monitor.stopHeartbeat();
  });

  it('records success on successful ping', async () => {
    const monitor = new HealthMonitor({ heartbeatIntervalMs: 100 });
    const pingFn = vi.fn().mockResolvedValue(true);

    monitor.startHeartbeat(pingFn);
    await tick(100);

    const stats = monitor.getStats();
    expect(stats.totalSuccesses).toBeGreaterThanOrEqual(1);
    monitor.stopHeartbeat();
  });

  it('records failure on failed ping', async () => {
    const monitor = new HealthMonitor({ heartbeatIntervalMs: 100 });
    const pingFn = vi.fn().mockResolvedValue(false);

    monitor.startHeartbeat(pingFn);
    await tick(100);

    const stats = monitor.getStats();
    expect(stats.totalFailures).toBeGreaterThanOrEqual(1);
    monitor.stopHeartbeat();
  });

  it('records failure on ping exception', async () => {
    const monitor = new HealthMonitor({ heartbeatIntervalMs: 100 });
    const pingFn = vi.fn().mockRejectedValue(new Error('network error'));

    monitor.startHeartbeat(pingFn);
    await tick(100);

    const stats = monitor.getStats();
    expect(stats.totalFailures).toBeGreaterThanOrEqual(1);
    expect(stats.lastError!.type).toBe('heartbeat');
    monitor.stopHeartbeat();
  });

  it('stops heartbeat on stopHeartbeat()', async () => {
    const monitor = new HealthMonitor({ heartbeatIntervalMs: 100 });
    const pingFn = vi.fn().mockResolvedValue(true);

    monitor.startHeartbeat(pingFn);
    await tick(100);
    expect(pingFn).toHaveBeenCalledTimes(1);

    monitor.stopHeartbeat();
    await tick(200);
    expect(pingFn).toHaveBeenCalledTimes(1); // no more calls
  });

  it('uses probeIntervalMs when reconnecting', async () => {
    const monitor = new HealthMonitor({
      heartbeatIntervalMs: 100,
      probeIntervalMs: 300,
      maxConsecutiveFailures: 2,
    });
    const pingFn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    monitor.startHeartbeat(pingFn);

    // First ping fails
    await tick(100);
    expect(pingFn).toHaveBeenCalledTimes(1);

    // Second ping fails — state becomes reconnecting
    await tick(100);
    expect(pingFn).toHaveBeenCalledTimes(2);
    expect(monitor.getState()).toBe('reconnecting');

    // Next ping should be after probeIntervalMs (300), not heartbeat (100)
    await tick(100);
    expect(pingFn).toHaveBeenCalledTimes(2); // not yet

    await tick(200); // total 300ms since last ping
    expect(pingFn).toHaveBeenCalledTimes(3);

    monitor.stopHeartbeat();
  });
});

// ─── Sliding window ───────────────────────────────────────────────────────────

describe('HealthMonitor — sliding window', () => {
  it('limits response time samples to sampleWindowSize', () => {
    const monitor = new HealthMonitor({ sampleWindowSize: 5 });
    for (let i = 0; i < 10; i++) monitor.recordSuccess(i * 10);
    const stats = monitor.getStats();
    // avg of last 5: (50+60+70+80+90)/5 = 70
    expect(stats.avgResponseMs).toBeCloseTo(70);
  });
});

// ─── 控制回路（2026-07-12 进程通信 P0 修复）──────────────────────────────────
// HealthMonitor 原为纯仪表盘：状态变化仅 setState 打日志改字段，无外部通知。
// 编辑器卡死（TCP OPEN 但主线程阻塞）时心跳 ping 永不回包 → 进 reconnecting
// 但无降级动作 → 系统瘫痪至 OS TCP keepalive(~2h)。修复：加 onStateChange 回调。

describe('HealthMonitor — onStateChange control loop (P0 fix)', () => {
  it('invokes listener when state changes via setState', () => {
    const monitor = new HealthMonitor();
    const transitions: Array<{ from: string; to: string }> = [];
    monitor.onStateChange((from, to) => { transitions.push({ from, to }); });

    monitor.setState('reconnecting');
    expect(transitions).toEqual([{ from: 'connected', to: 'reconnecting' }]);
  });

  it('passes from/to so consumer can distinguish upgrade vs downgrade', () => {
    const monitor = new HealthMonitor();
    const calls: string[] = [];
    monitor.onStateChange((from, to) => { calls.push(`${from}->${to}`); });

    monitor.setState('degraded');
    monitor.setState('reconnecting');
    monitor.setState('connected');

    expect(calls).toEqual(['connected->degraded', 'degraded->reconnecting', 'reconnecting->connected']);
  });

  it('does NOT invoke listener when state stays the same (no-op setState)', () => {
    const monitor = new HealthMonitor();
    let callCount = 0;
    monitor.onStateChange(() => { callCount++; });

    monitor.setState('connected'); // no change (already connected)
    expect(callCount).toBe(0);
  });

  it('listener throw does not corrupt state machine (try/catch guard)', () => {
    const monitor = new HealthMonitor();
    const throwing = vi.fn(() => { throw new Error('listener boom'); });
    monitor.onStateChange(throwing);

    monitor.setState('reconnecting'); // listener throws but state still changes
    expect(monitor.getState()).toBe('reconnecting');

    // subsequent setState still works (state machine not corrupted)
    monitor.setState('connected');
    expect(monitor.getState()).toBe('connected');
  });

  it('triggers onStateChange when heartbeat pushes state to reconnecting', async () => {
    vi.useFakeTimers();
    const monitor = new HealthMonitor({ heartbeatIntervalMs: 100, maxConsecutiveFailures: 2 });
    const transitions: string[] = [];
    monitor.onStateChange((_f, to) => { transitions.push(to); });
    monitor.startHeartbeat(async () => false); // always fail

    await tick(100); // 1st fail
    await tick(100); // 2nd fail → reconnecting (maxConsecutiveFailures=2)

    expect(monitor.getState()).toBe('reconnecting');
    expect(transitions).toContain('reconnecting');

    monitor.stopHeartbeat();
    vi.useRealTimers();
  });
});

// ─── B1 修复（批次 B 可靠性）──────────────────────────────────────────────────
// bug: health-monitor.ts:126 consecutiveFails 无差别累加（不查 errorType）→
// 工具失败(TOOL_ERROR) 也驱动 state → reconnecting，触发编辑器误降级。
// 修复：新增 consecutiveHeartbeatFails，仅 heartbeat 类失败驱动 reconnecting。

describe('HealthMonitor — B1 errorType 分流', () => {
  it('B1: tool errors do not drive reconnecting; only heartbeat failures do', () => {
    const hm = new HealthMonitor({ maxConsecutiveFailures: 5, degradedThreshold: 3 });
    hm.setState('connected');
    // 模拟 5 次工具失败（ToolDispatcher 传 TOOL_ERROR）
    for (let i = 0; i < 5; i++) {
      hm.recordFailure('TOOL_ERROR', `tool fail ${i}`);
    }
    expect(hm.getState()).not.toBe('reconnecting'); // TOOL_ERROR 不进 reconnecting
    // T1-M1 (final review): 正向断言 TOOL_ERROR 贡献 degraded
    //（recentFailures=5 ≥ degradedThreshold=3 → degraded，仅不进 reconnecting）
    expect(hm.getState()).toBe('degraded');
    // 5 次心跳失败才进 reconnecting
    for (let i = 0; i < 5; i++) {
      hm.recordFailure('heartbeat', `ping false ${i}`);
    }
    expect(hm.getState()).toBe('reconnecting');
  });
});

// ─── B-T5 修复（批次 B 可靠性，最复杂状态机）──────────────────────────────────
// bug: pingFn catch 毯式 `() => false` 丢 err.code,两种失败(REQUEST_TIMEOUT 主线程卡死 /
// NOT_CONNECTED+CONNECTION_LOST 编辑器下线)都 recordFailure → reconnecting → 旧 onStateChange
// 无差别调 handleEditorStall → disconnect() 杀 EditorConnection 自动重连(reconnectEnabled=false)。
// 修复:catch 保留 err.code(GodotServer.ts)+ onStateChange 分流(REQUEST_TIMEOUT 降级,其他不抢占)
// + 重连成功复位 hm connected(本测试验证 reset() 是这条链的关键节点)。
//
// 状态机链完整性(refused→重连成功→复位→恢复;耗尽→降级兜底):
//   editor 下线 → ping NOT_CONNECTED ×N → hm reconnecting → onStateChange 不降级
//   → EditorConnection 自动重连 20 次退避 → 成功 → addOnReconnectHandler 触发 hm.reset()
//   → state=connected + 清计数 → tools 流通;若 20 次失败 → reconnectExhausted → handleEditorStall。

describe('HealthMonitor — B-T5 reset() 状态机链', () => {
  it('B-T5a: reset() 复位 reconnecting→connected 并清 consecutiveHeartbeatFails', () => {
    const hm = new HealthMonitor({ maxConsecutiveFailures: 3 });
    hm.setState('connected');
    // 3 次 heartbeat 失败进 reconnecting(模拟 ping NOT_CONNECTED ×3)
    for (let i = 0; i < 3; i++) hm.recordFailure('heartbeat', `down ${i}`);
    expect(hm.getState()).toBe('reconnecting');

    // 反向断言:无 reset 时单次 heartbeat 失败立即再触发 reconnecting(consecutiveHeartbeatFails=4 ≥ 3)
    hm.reset();
    expect(hm.getState()).toBe('connected');
    // 关键:reset 后 consecutiveHeartbeatFails 清零——单次失败不会立即卡回 reconnecting
    // (可能进 degraded 因为 recentSuccessFlags 含历史 false 标记,但 reconnecting 阈值不再触发)
    hm.recordFailure('heartbeat', 'first ping after reconnect');
    expect(hm.getState()).not.toBe('reconnecting'); // 1 < 3, 不再卡 reconnecting
  });

  it('B-T5b: reset() 触发 onStateChange(connected),监听器据 to=connected 不降级', () => {
    const hm = new HealthMonitor({ maxConsecutiveFailures: 2 });
    const transitions: string[] = [];
    hm.onStateChange((_f, to) => { transitions.push(to); });
    hm.setState('connected');
    for (let i = 0; i < 2; i++) hm.recordFailure('heartbeat', `down ${i}`);
    expect(hm.getState()).toBe('reconnecting');
    expect(transitions).toContain('reconnecting');

    // EditorConnection 自动重连成功 → 触发 hm.reset()
    transitions.length = 0;
    hm.reset();

    expect(hm.getState()).toBe('connected');
    expect(transitions).toEqual(['connected']); // 'reconnecting' → 'connected'
    // GodotServer onStateChange 仅在 to==='reconnecting' 时考虑降级;
    // 'connected' 转换不会触发降级——复位语义正确,链完整性保证。
  });

  it('B-T5c: reset() 在 connected 态是 no-op(不重复触发 onStateChange)', () => {
    const hm = new HealthMonitor();
    let callCount = 0;
    hm.onStateChange(() => { callCount++; });
    hm.setState('connected');
    // 已 connected,reset 不应触发监听器
    hm.reset();
    expect(callCount).toBe(0);
    expect(hm.getState()).toBe('connected');
  });
});
