// src/telemetry/collector.ts
// fire-and-forget 收集内核。阶段 0：endpoint 默认空 = 零外传，仅队列骨架。
// disabled 或 endpoint 空 → record 立即 return（零开销）。queue 满丢新。消费永不传播。
import { isTelemetryEnabled } from './config.js';

export const QUEUE_MAXSIZE = 500;

const ENDPOINT = process.env.GODOT_MCP_TELEMETRY_ENDPOINT ?? '';  // 默认空=不发

export interface TelemetryEvent {
  tool: string;
  success: boolean;
  duration_ms: number;
  error_category?: string;
  project_hash?: string;
}

const queue: TelemetryEvent[] = [];
let flushScheduled = false;

/** fire-and-forget 入口。disabled / endpoint 空 → 立即 return（零开销）。 */
export function record(event: TelemetryEvent): void {
  if (!isTelemetryEnabled()) return;
  if (ENDPOINT === '') return;  // 阶段 0：endpoint 空 = 零外传
  if (queue.length >= QUEUE_MAXSIZE) return;  // 满丢新（保业务关键旧事件）
  queue.push(event);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const t = setTimeout(() => { flush(); }, 0);
  t.unref?.();  // 不保活 event loop（daemon-less）
}

function flush(): void {
  flushScheduled = false;
  if (queue.length === 0 || ENDPOINT === '') return;
  const batch = queue.splice(0, queue.length);
  sendBatch(batch).catch(() => { /* 永不传播 */ });
}

/** 阶段 1 接入点：endpoint 默认空时不会被调。阶段 1 在此实现 fetch（trustEnv=false + try/catch）。 */
async function sendBatch(_batch: TelemetryEvent[]): Promise<void> {
  // 阶段 0 stub。保留签名供阶段 1 + 测试 mock。
}

// 测试钩子（仅测试用，下划线前缀）
export function _resetForTest(): void {
  queue.length = 0;
  flushScheduled = false;
}
export function _queueLengthForTest(): number {
  return queue.length;
}
