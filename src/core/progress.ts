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
