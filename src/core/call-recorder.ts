// src/core/call-recorder.ts
import { RingBuffer } from './ring-buffer.js';
import type { ToolResult } from '../types.js';

export interface CallRecord {
  tool: string;
  ok: boolean;
  ms: number;
  t: number; // 相对秒（从首次记录起 offset）
  errorType?: string;
  msg?: string;
}

export interface CallStats {
  total: number;
  success: number;
  fail: number;
  topTools: Array<{ name: string; n: number; fail: number }>;
  recentErrors: Array<{ tool: string; type: string; msg: string; ms: number }>;
}

const RECENT_LIMIT = 50;
const TOP_TOOLS = 10;
const RECENT_ERRORS = 5;
const MSG_TRUNCATE = 200;

/**
 * CallRecorder — 进程内工具调用记录器（模块级单例）。
 *
 * defect 标注：命中 module-level-mutable-state(open) 形态。同步操作无真实竞态，
 * 风险可接受；record/getStats 预留可选 instanceId 参数，为多实例 per-instance 扩展铺路（MVP 全局共享）。
 */
class CallRecorder {
  private recent: RingBuffer<CallRecord>;
  private recentErrors: RingBuffer<{ tool: string; type: string; msg: string; ms: number }>;
  private byTool = new Map<string, { n: number; fail: number }>();
  private total = 0;
  private success = 0;
  private fail = 0;
  private startTime = 0;

  constructor() {
    this.recent = new RingBuffer<CallRecord>(RECENT_LIMIT);
    this.recentErrors = new RingBuffer(RECENT_ERRORS);
  }

  record(tool: string, ok: boolean, ms: number, errorType?: string, msg?: string, _instanceId?: string): void {
    if (this.startTime === 0) this.startTime = Date.now();
    const t = Math.floor((Date.now() - this.startTime) / 1000);
    this.recent.push({ tool, ok, ms, t, errorType, msg });
    this.total++;
    if (ok) this.success++; else this.fail++;
    const entry = this.byTool.get(tool) ?? { n: 0, fail: 0 };
    entry.n++;
    if (!ok) entry.fail++;
    this.byTool.set(tool, entry);
    if (!ok && errorType) {
      this.recentErrors.push({ tool, type: errorType, msg: msg ?? '', ms });
    }
  }

  getRecent(n: number, _instanceId?: string): CallRecord[] {
    return this.recent.sliceLast(n);
  }

  getStats(_instanceId?: string): CallStats {
    const topTools = [...this.byTool.entries()]
      .map(([name, v]) => ({ name, n: v.n, fail: v.fail }))
      .sort((a, b) => b.n - a.n)
      .slice(0, TOP_TOOLS);
    return {
      total: this.total,
      success: this.success,
      fail: this.fail,
      topTools,
      recentErrors: this.recentErrors.toArray(),
    };
  }

  reset(): void {
    this.recent.clear();
    this.recentErrors.clear();
    this.byTool.clear();
    this.total = 0;
    this.success = 0;
    this.fail = 0;
    this.startTime = 0;
  }
}

let _instance: CallRecorder | null = null;
export function getCallRecorder(): CallRecorder {
  if (!_instance) _instance = new CallRecorder();
  return _instance;
}

/** 从工具 result 提取错误文本（截断 MSG_TRUNCATE 字符）。 */
export function extractErrorMessage(result: ToolResult): string {
  for (const c of result.content ?? []) {
    if (typeof (c as { text?: unknown }).text === 'string' && (c as { text: string }).text.length > 0) {
      return (c as { text: string }).text.slice(0, MSG_TRUNCATE);
    }
  }
  return '';
}
