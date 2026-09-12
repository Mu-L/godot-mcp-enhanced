/**
 * MCP Progress 通知 — 与 logger 同构的两件套（sender + clientReady）。
 *
 * 区别于 logger（sendLoggingMessage 无 token 广播，可模块级注入）：
 * progress 必须带 progressToken 路由到特定请求（per-request），
 * 故 token 经 createProgressEmitter 闭包捕获，随 request 透传（见 spec §4.3 四层参数链）。
 *
 * 失败安全：progress 是观测层，绝不影响主流程（guard + fire-and-forget）。
 */
import type { Server } from "@modelcontextprotocol/server";

export type ProgressToken = string | number;
export type ProgressEmitter = (progress: number, total: number, message?: string) => void;

let _progressSender: Server | null = null;
let _progressClientReady = false;

/** 注入 MCP Server 实例（GodotServer 构造时调）；null 清除（close/测试隔离） */
export function setProgressSender(server: Server | null): void {
  _progressSender = server;
}

/** 标记 client 是否已完成 initialize（oninitialized 时设 true）；未就绪不发，避免 SDK 握手前报错 */
export function setProgressClientReady(ready: boolean): void {
  _progressClientReady = ready;
}

/**
 * 创建 per-request progress emitter。token 闭包捕获，并发安全（C-CONC-1）。
 * guard: _progressSender + _progressClientReady。失败静默。
 */
export function createProgressEmitter(token: ProgressToken): ProgressEmitter {
  return (progress: number, total: number, message?: string): void => {
    if (!_progressSender || !_progressClientReady) return;
    try {
      const p = _progressSender.notification({
        method: 'notifications/progress',
        params: { progressToken: token, progress, total, message },
      });
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => {});
      }
    } catch {
      // 同步 throw 静默——progress 是观测层，绝不影响主流程
    }
  };
}

/** 测试隔离 / 干净关闭：重置模块状态 */
export function resetProgressSender(): void {
  _progressSender = null;
  _progressClientReady = false;
}

/**
 * 心跳保活(2026-09-11 P1 批,来源 BuildersGate server.py:789-844 的取消经济学):
 * MCP 客户端对"无响应无进度"的调用按 idle 上限(常见 1800s)杀,但 server 侧线程照样
 * 跑完——钱照扣、文件照写、结果没处送("白花钱的取消")。心跳不是让慢工具变快,是让
 * 慢工具别变成静默损失:每 20s 发一次 progress notification 证明请求活着。
 * 首个 tick 在 20s 时——20s 内完成的工具零消息、零开销。
 * 无 progressToken(客户端未带 _meta.progressToken)时不发:progress 必须按 token
 * 路由到特定请求,无 token 无法投递(协议约束,非实现选择)。
 * message 明示 heartbeat 语义,防客户端误读为业务进度。
 */
export async function withToolHeartbeat<T>(
  emitter: ((progress: number, total: number, message?: string) => void) | undefined,
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!emitter) return fn();
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    emitter(elapsedSec, 0, `${toolName}: still working (${elapsedSec}s) — heartbeat, not progress`);
  }, 20_000);
  // N-6(审查):unref 防"长工具永不 settle + server close"时 interval 吊住 event loop
  // (vitest fake timers 无 unref,防御式探测)
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
