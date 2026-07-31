// src/core/health-monitor.ts
//
// Connection health monitor with state machine, sliding-window statistics,
// and optional heartbeat probing.

import { getLogger } from './logger.js';
import { isFeatureEnabled } from './feature-flags.js';
import { RingBuffer } from './ring-buffer.js';
import type { ConnectionState } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthMonitorOptions {
  heartbeatIntervalMs?: number;   // default 30000
  probeIntervalMs?: number;       // default 60000 (used while reconnecting)
  maxConsecutiveFailures?: number; // default 5
  degradedThreshold?: number;     // default 3 (failures in recent window)
  sampleWindowSize?: number;      // default 100
  errorHistorySize?: number;      // default 20
}

export interface ErrorRecord {
  time: number;
  scope?: string;
  type: string;
  message: string;
  retriable: boolean;
}

export interface HealthStats {
  state: ConnectionState;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  consecutiveFails: number;
  avgResponseMs: number;
  baselineResponseMs: number;
  recentFailures: number;       // failures in the last 10 samples
  lastError: ErrorRecord | null;
  errors: ErrorRecord[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULTS: Required<HealthMonitorOptions> = {
  heartbeatIntervalMs: 30_000,
  probeIntervalMs: 60_000,
  maxConsecutiveFailures: 5,
  degradedThreshold: 3,
  sampleWindowSize: 100,
  errorHistorySize: 20,
};

const RECENT_WINDOW = 10;
const BASELINE_SAMPLE_COUNT = 10;

// ─── HealthMonitor ────────────────────────────────────────────────────────────

export class HealthMonitor {
  private readonly opts: Required<HealthMonitorOptions>;
  private state: ConnectionState = 'connected';

  // Counters
  private totalRequests = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private consecutiveFails = 0;
  // B1: 仅心跳类失败驱动 reconnecting；工具失败(TOOL_ERROR)贡献 degraded 统计不驱动状态机
  private consecutiveHeartbeatFails = 0;

  // H-02: Sliding windows using RingBuffer (O(1) push, no Array.shift)
  private responseTimes!: RingBuffer<number>;
  private recentSuccessFlags!: RingBuffer<boolean>;
  private errors!: RingBuffer<ErrorRecord>;

  // Baseline (average of first BASELINE_SAMPLE_COUNT successful response times)
  private baselineResponseMs = 0;
  private baselineSamples: number[] = [];
  private baselineEstablished = false;

  private lastError: ErrorRecord | null = null;

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private pingFn: (() => Promise<boolean>) | null = null;
  private disposed = false;

  // 2026-07-12 P0 控制回路：状态变化监听器（fire-and-forget，try/catch 包裹不影响状态机）
  private stateChangeListener: ((from: ConnectionState, to: ConnectionState) => void | Promise<void>) | null = null;

  constructor(opts: HealthMonitorOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    // H-02: Initialize RingBuffers with actual opts (may override DEFAULTS)
    this.responseTimes = new RingBuffer<number>(this.opts.sampleWindowSize);
    this.recentSuccessFlags = new RingBuffer<boolean>(this.opts.sampleWindowSize);
    this.errors = new RingBuffer<ErrorRecord>(this.opts.errorHistorySize);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Record a successful tool call. */
  recordSuccess(responseTimeMs: number): void {
    this.totalRequests++;
    this.totalSuccesses++;
    this.consecutiveFails = 0;
    this.consecutiveHeartbeatFails = 0;

    this.responseTimes.push(responseTimeMs);

    this.pushRecentFlag(true);

    // Baseline collection
    if (!this.baselineEstablished) {
      this.baselineSamples.push(responseTimeMs);
      if (this.baselineSamples.length >= BASELINE_SAMPLE_COUNT) {
        this.baselineResponseMs = avg(this.baselineSamples);
        this.baselineEstablished = true;
        getLogger().info('health', `Baseline established: ${this.baselineResponseMs.toFixed(1)}ms`);
      }
    }

    this.evaluateState();
  }

  /** Record a failed tool call. */
  recordFailure(errorType: string, message: string, scope?: string): void {
    this.totalRequests++;
    this.totalFailures++;
    this.consecutiveFails++;
    // B1: 只有 heartbeat 类失败驱动 reconnecting 阈值。工具失败(TOOL_ERROR)仍
    // 贡献 totalFailures / recentFailures(degraded 统计)，但不推动状态机到 reconnecting。
    if (errorType === 'heartbeat') {
      this.consecutiveHeartbeatFails++;
    }

    this.pushRecentFlag(false);

    const record: ErrorRecord = {
      time: Date.now(),
      scope,
      type: errorType,
      message,
      retriable: isRetriable(errorType),
    };
    this.errors.push(record);
    this.lastError = record;

    this.evaluateState();
  }

  /** Get current connection state. */
  getState(): ConnectionState {
    return this.state;
  }

  /** Manually set connection state. */
  setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      const from = this.state;
      getLogger().info('health', `State changed: ${from} → ${newState}`);
      this.state = newState;
      // 2026-07-12 P0 控制回路：状态变化通知外部消费者（GodotServer 接线降级动作）。
      // fire-and-forget + try/catch——监听器异常不破坏 HealthMonitor 状态机。
      try {
        this.stateChangeListener?.(from, newState);
      } catch (err) {
        getLogger().warn('health', `State change listener threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Reset state to 'connected' and clear failure counters.
   * B-T5: Called when the underlying transport confirms recovery (e.g. EditorConnection
   * reconnect success after refused/offline) — avoids stale consecutiveHeartbeatFails
   * re-tripping 'reconnecting' on the next ping, and skips the up-to-probeIntervalMs
   * window during which B-T3 half-open HOL precheck would block all editor tools.
   */
  reset(): void {
    this.consecutiveFails = 0;
    this.consecutiveHeartbeatFails = 0;
    if (this.state !== 'connected') {
      this.setState('connected');
    }
  }

  /** Register a state-change listener. 2026-07-12 P0: 控制回路接线点。
   *  触发时机：setState 实际改变状态时（from !== to）。
   *  签名 (from, to)：消费者可区分升级（connected→degraded）与降级（degraded→connected）。 */
  onStateChange(listener: (from: ConnectionState, to: ConnectionState) => void | Promise<void>): void {
    this.stateChangeListener = listener;
  }

  /** Get a snapshot of all health statistics. */
  getStats(): HealthStats {
    const recentFlags = this.recentSuccessFlags.sliceLast(RECENT_WINDOW);
    const recentFailures = recentFlags.filter(f => !f).length;
    const rtArr = this.responseTimes.toArray();

    return {
      state: this.state,
      totalRequests: this.totalRequests,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      consecutiveFails: this.consecutiveFails,
      avgResponseMs: rtArr.length > 0
        ? avg(rtArr)
        : 0,
      baselineResponseMs: this.baselineResponseMs,
      recentFailures,
      lastError: this.lastError,
      errors: this.errors.toArray(),
    };
  }

  /** Start periodic heartbeat using the provided ping function. */
  startHeartbeat(pingFn: () => Promise<boolean>): void {
    this.stopHeartbeat();
    this.pingFn = pingFn;
    this.disposed = false;
    this.scheduleNext();
  }

  /** Stop the heartbeat timer. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.disposed = true;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private pushRecentFlag(success: boolean): void {
    this.recentSuccessFlags.push(success);
  }

  private evaluateState(): void {
    if (!isFeatureEnabled('HEALTH_MONITOR')) return;
    if (this.state === 'disconnected') return; // only manual

    // Check reconnecting threshold
    // B1: 仅 heartbeat 类失败（consecutiveHeartbeatFails）驱动 reconnecting。
    // 工具失败(TOOL_ERROR) 不推动状态机到 reconnecting（避免编辑器误降级）。
    if (this.consecutiveHeartbeatFails >= this.opts.maxConsecutiveFailures) {
      if (this.state !== 'reconnecting') {
        this.setState('reconnecting');
      }
      return;
    }

    // Check degraded
    const recentFlags = this.recentSuccessFlags.sliceLast(RECENT_WINDOW);
    const recentFailures = recentFlags.filter(f => !f).length;

    if (this.state === 'connected') {
      if (recentFailures >= this.opts.degradedThreshold) {
        this.setState('degraded');
        return;
      }
      // Also degrade if response time is > 2x baseline
      if (this.baselineEstablished && this.responseTimes.length >= RECENT_WINDOW) {
        const recentAvg = avg(this.responseTimes.sliceLast(RECENT_WINDOW));
        if (recentAvg > this.baselineResponseMs * 2) {
          this.setState('degraded');
          return;
        }
      }
    }

    if (this.state === 'degraded') {
      // Recover if recent failures < 2 AND response time < 1.5x baseline
      if (recentFailures < 2) {
        if (!this.baselineEstablished || this.responseTimes.length < RECENT_WINDOW) {
          this.setState('connected');
          return;
        }
        const recentAvg = avg(this.responseTimes.sliceLast(RECENT_WINDOW));
        if (recentAvg < this.baselineResponseMs * 1.5) {
          this.setState('connected');
          return;
        }
      }
    }
  }

  private scheduleNext(): void {
    if (this.disposed || !this.pingFn) return;

    const interval = this.state === 'reconnecting'
      ? this.opts.probeIntervalMs
      : this.opts.heartbeatIntervalMs;

    this.heartbeatTimer = setTimeout(async () => {
      if (this.disposed || !this.pingFn) return;
      try {
        const ok = await this.pingFn();
        if (ok) {
          // Heartbeat success: restore state without polluting response-time stats
          this.totalRequests++;
          this.totalSuccesses++;
          this.consecutiveFails = 0;
          this.consecutiveHeartbeatFails = 0;
          this.pushRecentFlag(true);
          if (this.state !== 'connected') this.setState('connected');
        } else {
          this.recordFailure('heartbeat', 'Ping returned false', 'heartbeat');
        }
      } catch (err) {
        this.recordFailure(
          'heartbeat',
          err instanceof Error ? err.message : String(err),
          'heartbeat',
        );
      }
      this.scheduleNext();
    }, interval);
    // A-1: unref so the heartbeat timer doesn't keep the process alive (consistent with EditorConnection/gdscript-executor)
    this.heartbeatTimer?.unref();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const RETRIABLE_TYPES = new Set(['timeout', 'connection_reset', 'heartbeat', 'ECONNREFUSED', 'ECONNRESET']);

function isRetriable(errorType: string): boolean {
  return RETRIABLE_TYPES.has(errorType);
}
