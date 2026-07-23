// src/core/EditorConnection.ts
import WebSocket from 'ws';
import { getLogger } from './logger.js';
import { getErrorMessage } from '../types.js';

// I-01: Auth uses a dedicated id outside the normal requestId sequence to avoid conflicts.
// The plugin expects id=-1 for auth handshake (negative IDs are never used by normal requests).
const AUTH_REQUEST_ID = -1;
const MAX_INBOUND_MESSAGE_SIZE = 1048576; // 1MB
const MAX_AUTH_FAILURES = 5;
const AUTH_LOCKOUT_MS = 300_000; // 5 minutes

interface EditorConnectionOptions {
  port: number;
  host?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  connectTimeout?: number;
  requestTimeout?: number;
  maxReconnectAttempts?: number;
  secret?: string;
  authTimeout?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class EditorConnection {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private reconnectEnabled = true;
  private connectAttempt = false;
  private connectGeneration = 0;  // ipc P1-4: 防 disconnect 后进行中的 connect() 复活已断开连接

  private disconnectHandlers = new Set<() => void>();
  private reconnectHandlers = new Set<() => void>();
  /** I-04: Handlers called specifically when reconnect attempts are exhausted (not on normal disconnect). */
  private reconnectExhaustedHandlers = new Set<() => void>();

  /** Track dropped notify() calls so callers can detect stale scene-tree state */
  private _droppedNotifications = 0;

  /** Guard against duplicate fireDisconnect() calls */
  private _disconnectFired = false;

  /**
   * Backward-compatible setter: converts a direct assignment like
   * `conn.onDisconnect = fn` into the multicast Set pattern.
   */
  get onDisconnect(): (() => void) | null {
    const first = this.disconnectHandlers.values().next().value;
    return first ?? null;
  }
  set onDisconnect(fn: (() => void) | null) {
    this.disconnectHandlers.clear();
    if (fn) this.disconnectHandlers.add(fn);
  }

  get onReconnect(): (() => void) | null {
    const first = this.reconnectHandlers.values().next().value;
    return first ?? null;
  }
  set onReconnect(fn: (() => void) | null) {
    this.reconnectHandlers.clear();
    if (fn) this.reconnectHandlers.add(fn);
  }

  /** Add a handler invoked when the editor disconnects. */
  addOnDisconnectHandler(handler: () => void): void {
    this.disconnectHandlers.add(handler);
  }
  /** Remove a previously added disconnect handler. */
  removeOnDisconnectHandler(handler: () => void): void {
    this.disconnectHandlers.delete(handler);
  }

  /** Add a handler invoked when the editor reconnects. */
  addOnReconnectHandler(handler: () => void): void {
    this.reconnectHandlers.add(handler);
  }
  /** Remove a previously added reconnect handler. */
  removeOnReconnectHandler(handler: () => void): void {
    this.reconnectHandlers.delete(handler);
  }

  /** I-04: Add a handler invoked when reconnect attempts are exhausted (distinct from normal disconnect). */
  addOnReconnectExhaustedHandler(handler: () => void): void {
    this.reconnectExhaustedHandlers.add(handler);
  }
  removeOnReconnectExhaustedHandler(handler: () => void): void {
    this.reconnectExhaustedHandlers.delete(handler);
  }

  private fireDisconnect(): void {
    if (this._disconnectFired) return;
    this._disconnectFired = true;
    // B5: 单 handler 抛错不阻断后续 handler / scheduleReconnect（对齐 health-monitor:156-160 容错模式）
    for (const handler of this.disconnectHandlers) {
      try {
        handler();
      } catch (err) {
        getLogger().warn('editor', `disconnect handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private fireReconnect(): void {
    // B5: 同 fireDisconnect 容错模式,单 handler 抛错不阻断后续
    for (const handler of this.reconnectHandlers) {
      try {
        handler();
      } catch (err) {
        getLogger().warn('editor', `reconnect handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private readonly host: string;
  private readonly shouldReconnect: boolean;
  private readonly reconnectBaseMs: number;
  private readonly maxReconnectMs: number;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly authTimeoutMs: number;
  private reconnectAttempt = 0;
  private readonly maxReconnectAttempts: number;
  private readonly editorSecret: string | null;
  private authenticated = false;
  private authFailureCount = 0;
  private authFailed = false;  // IMP-8 (2026-06-26 review): 显式认证失败标志,加固 close handler wasConnected 判断(防 connectAttempt 边缘误判)
  private authLockoutUntil = 0;

  constructor(private readonly options: EditorConnectionOptions) {
    this.host = options.host ?? '127.0.0.1';
    // Reject non-localhost hosts — WebSocket auth is plaintext (no TLS)
    if (this.host !== '127.0.0.1' && this.host !== 'localhost' && this.host !== '::1') {
      throw new Error(`Editor WebSocket only supports localhost connections for security (got: ${this.host})`);
    }
    this.shouldReconnect = options.reconnect ?? true;
    this.reconnectEnabled = this.shouldReconnect;
    this.reconnectBaseMs = options.reconnectInterval ?? 1000;
    this.maxReconnectMs = options.maxReconnectInterval ?? 60000;
    this.connectTimeoutMs = options.connectTimeout ?? 10000;
    this.requestTimeoutMs = options.requestTimeout ?? 30000;
    this.authTimeoutMs = options.authTimeout ?? 10000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 20;
    this.editorSecret = options.secret ?? null;
  }

  async connect(): Promise<void> {
    const gen = ++this.connectGeneration;  // ipc P1-4: 本轮 connect 的 generation
    // C-06: Clean up stale WebSocket before creating new one
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
      }
      this.ws = null;
    }
    return new Promise((resolve, reject) => {
      const url = `ws://${this.host}:${this.options.port}`;
      this.connectAttempt = true;
      let settled = false; // I-05: Guard against double reject/resolve
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        ws.removeAllListeners();
        ws.terminate();
        reject(new Error(`Connection timeout to ${url}`));
      }, this.connectTimeoutMs);

      const ws = new WebSocket(url);
      ws.on('open', async () => {
        if (settled) return; clearTimeout(timer);
        // ipc P1-4: disconnect/supersede 期间 connect 完成时 gen 过期 -> 丢弃 ws 防复活, reject 让 connect Promise 不永挂
        if (gen !== this.connectGeneration) { ws.removeAllListeners(); ws.terminate(); if (!settled) { settled = true; reject(new Error('Connection superseded by disconnect/reconnect')); } return; }
        this.ws = ws;
        this.connected = true;
        this.connectAttempt = false;
        this._disconnectFired = false;
        // C-3: Reset reconnectEnabled on successful connection
        this.reconnectEnabled = this.shouldReconnect;
        this.setupMessageHandler();
        if (this.editorSecret) {
          // Check auth lockout
          if (Date.now() < this.authLockoutUntil) {
            const remaining = Math.ceil((this.authLockoutUntil - Date.now()) / 1000);
            this.connected = false;
            this.ws = null;
            ws.removeAllListeners();
            ws.terminate();
            if (!settled) { settled = true; reject(new Error(`Auth locked out: too many failures. Retry in ${remaining}s`)); }
            return;
          }
          // Reset failure counter if lockout has expired
          if (this.authFailureCount >= MAX_AUTH_FAILURES && Date.now() >= this.authLockoutUntil) {
            this.authFailureCount = 0;
            this.authLockoutUntil = 0;
          }
          try {
            await this.performAuth();
            this.authFailureCount = 0; // Reset on success
          this.authFailed = false;
          } catch (authErr) {
            this.authFailureCount++;
            if (this.authFailureCount >= MAX_AUTH_FAILURES) {
              this.authLockoutUntil = Date.now() + AUTH_LOCKOUT_MS;
              getLogger().error('auth', `Locked out for ${AUTH_LOCKOUT_MS / 1000}s after ${MAX_AUTH_FAILURES} failures`);
            }
            this.connected = false;
            this.authenticated = false;  // 阶段1b 守卫1: 重置认证状态(performAuth reject/timeout/catch 三路径都经此 catch),防残留 true 致 close handler wasConnected(:243)误判
            // I-04: Prevent reconnect loop after auth failure.
            // connectAttempt was set to false in 'open' handler (line ~163),
            // so close handler sees wasConnected=true and would call scheduleReconnect.
            // Setting reconnectEnabled=false blocks that cycle.
            this.reconnectEnabled = false;
            this.authFailed = true;  // IMP-8: 显式标记,close handler 据此跳过重连
            this.ws = null;
            ws.removeAllListeners();
            ws.terminate();
            if (!settled) { settled = true; reject(authErr); }
            return;
          }
        } else {
          // No secret configured — reject connection for security
          this.connected = false;
          this.ws = null;
          ws.removeAllListeners();
          ws.terminate();
          if (!settled) { settled = true; reject(new Error('Editor auth required but no secret configured. Install the editor plugin.')); }
          return;
        }
        const isReconnect = this.reconnectAttempt > 0;
        this.reconnectAttempt = 0;
        if (isReconnect) {
          this.fireReconnect();
        }
        if (!settled) { settled = true; resolve(); }
      });

      ws.on('error', (err) => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        reject(new Error(`Connection failed: ${err.message}`));
      });

      ws.on('close', () => {
        this.connected = false;
        this.ws = null;
        // Reject all pending requests — they will never receive a response
        // B4: 挂 err.code='CONNECTION_LOST' 供 Executor 分流(do_not_retry),不依赖字符串匹配
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(Object.assign(new Error('Connection lost'), { code: 'CONNECTION_LOST' }));
        }
        this.pending.clear();
        // Don't clear notificationHandlers — they need to survive reconnect
        // C-02: Only reconnect if we were fully authenticated — don't reconnect on auth failure
        const wasConnected = !this.connectAttempt && this.authenticated && !this.authFailed;  // IMP-8: authFailed 时不算 wasConnected,防重连
        this.fireDisconnect();
        if (wasConnected && this.reconnectEnabled) this.scheduleReconnect();
        this.connectAttempt = false;
      });
    });
  }

  private setupMessageHandler(): void {
    if (!this.ws) return;
    this.ws.on('message', (data: WebSocket.Data) => {
      const raw = typeof data === 'string' ? data : data.toString();
      try {
        if (Buffer.byteLength(raw, 'utf8') > MAX_INBOUND_MESSAGE_SIZE) {
          getLogger().warn('editor', 'Inbound message exceeds size limit, discarding');
          return;
        }
        const msg = JSON.parse(raw);
        // A-12: Validate msg.id is a number before using as pending lookup key
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!;
          clearTimeout(pending.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            // I-01: Preserve structured error info (code, data) from editor plugin
            const err = new Error(msg.error.message || 'JSON-RPC error') as Error & { code?: unknown; data?: unknown };
            if (msg.error.code !== undefined) err.code = msg.error.code;
            if (msg.error.data !== undefined) err.data = msg.error.data;
            pending.reject(err);
          } else {
            pending.resolve(msg.result);
          }
        } else if (msg.method && msg.id == null) {
          const handlers = this.notificationHandlers.get(msg.method);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg.params);
            }
          }
        }
      } catch (err) {
        const snippet = typeof raw === 'string' ? raw.substring(0, 200) : '(unavailable)';
        getLogger().warn('editor', `parse WebSocket message: ${getErrorMessage(err)} raw: ${snippet}`);
        // Attempt to extract id from malformed JSON and reject the pending request
        const idMatch = raw.match(/"id"\s*:\s*(\d+)/);
        if (idMatch) {
          const badId = Number(idMatch[1]);
          const pending = this.pending.get(badId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(badId);
            // B4: 挂 err.code='PARSE_ERROR' 供 Executor 分流(do_not_retry),覆盖原字符串匹配漏项
            pending.reject(Object.assign(new Error(`JSON parse error in editor response: ${getErrorMessage(err)}`), { code: 'PARSE_ERROR' }));
          }
        }
      }
    });
  }

  request(
    method: string,
    params: Record<string, unknown> = {},
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        // B4: 挂 err.code='NOT_CONNECTED' 供 Executor 分流(do_not_retry)
        reject(Object.assign(new Error('Not connected'), { code: 'NOT_CONNECTED' }));
        return;
      }
      // Increment and wrap (ID 0 is reserved/skipped to avoid falsy confusion).
      // Wrapping at MAX_SAFE_INTEGER is safe — in practice unreachable (would need
      // ~9 quadrillion requests). The modulo ensures we never overflow.
      let candidate = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
      if (candidate === 0) candidate = 1;
      let attempts = 0;
      while (this.pending.has(candidate) && attempts < 1000) {
        candidate = (candidate + 1) % Number.MAX_SAFE_INTEGER;
        if (candidate === 0) candidate = 1;
        attempts++;
      }
      if (attempts >= 1000) {
        // A-03: 附加当前 pending 数量信息帮助调试
        reject(new Error(`No available request IDs — too many pending requests (pending.size=${this.pending.size})`));
        return;
      }
      const id = this.requestId = candidate;
      // B3: 心跳等活性检测传独立短超时(options.timeoutMs),默认回退业务 requestTimeoutMs(30s)。
      // 差异化理由:心跳 ping 失败目的是"快速发现卡死",业务请求用长超时是"容忍慢操作"。
      const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // B4: 挂 err.code='REQUEST_TIMEOUT' 供 Executor 分流(do_not_retry)
        reject(Object.assign(new Error(`Request timeout: ${method}`), { code: 'REQUEST_TIMEOUT' }));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      try {
        this.ws.send(msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Send failed: ${(e as Error).message}`));
      }
    });
  }

  /**
   * Send a fire-and-forget notification to the editor plugin.
   *
   * NOTE: This is currently unused but retained as a future-facing API.
   * When adopting it for critical state changes (e.g. scene-tree mutations),
   * consider using request() instead to guarantee delivery, or check
   * droppedNotifications > 0 after a batch of notify calls and trigger
   * a full scene-tree refresh if any were lost.
   */
  notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.ws || !this.connected) throw new Error('Not connected');
    try {
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    } catch (err) {
      this._droppedNotifications++;
      getLogger().error('editor', `notify send failed (method=${method}, dropped=${this._droppedNotifications}): ${err}`);
    }
  }

  /** Number of notify() calls that failed to send since last check */
  get droppedNotifications(): number {
    return this._droppedNotifications;
  }

  /** Reset the dropped notification counter (call after consuming the value) */
  resetDroppedNotifications(): void {
    this._droppedNotifications = 0;
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set());
    }
    this.notificationHandlers.get(method)!.add(handler);
  }

  offNotification(method: string, handler?: (params: unknown) => void): void {
    if (!this.notificationHandlers.has(method)) return;
    if (handler) {
      this.notificationHandlers.get(method)!.delete(handler);
    } else {
      this.notificationHandlers.delete(method);
    }
  }

  async startOperation(timeoutSec: number): Promise<unknown> {
    return this.request('operation_start', { timeout: Math.min(timeoutSec, 600) });
  }

  async endOperation(): Promise<unknown> {
    return this.request('operation_end', {});
  }

  private performAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.editorSecret) {
        reject(new Error('Cannot authenticate: not connected or no secret'));
        return;
      }
      let settled = false;
      const authTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pending.delete(AUTH_REQUEST_ID);
        this.connectAttempt = true; // Prevent close handler from scheduling reconnect
        reject(new Error('Auth handshake timeout'));
        this.ws?.close();
      }, this.authTimeoutMs);

      // I-01: Use id=-1 for auth (negative IDs never conflict with normal requests)
      this.pending.set(AUTH_REQUEST_ID, {
        resolve: (_result: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(authTimeout);
          this.authenticated = true;
          resolve();
        },
        reject: (err: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(authTimeout);
          reject(err);
        },
        timer: authTimeout,
      });

      try {
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: AUTH_REQUEST_ID,
          method: 'auth',
          params: { secret: this.editorSecret },
        }));
      } catch (e) {
        clearTimeout(authTimeout);
        this.pending.delete(AUTH_REQUEST_ID);
        reject(new Error(`Auth send failed: ${(e as Error).message}`));
      }
    });
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled) return;  // D2: disconnect()/exhaust 后不再重连(catch 分支调本方法时也要拦)
    if (this.reconnectTimer) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      getLogger().error('editor', `Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      this.reconnectEnabled = false;
      // I-04: Fire dedicated exhaustion handlers instead of relying on fireDisconnect dedup.
      // This ensures consumers (e.g. GodotServer) always get notified when reconnect is exhausted,
      // regardless of whether fireDisconnect was already called by ws.on('close').
      for (const handler of this.reconnectExhaustedHandlers) handler();
      return;
    }
    const base = Math.min(
      this.reconnectBaseMs * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectMs,
    );
    // D2: 加 jitter 防多实例同时重连风暴(thundering herd)
    const delay = base + Math.floor(Math.random() * this.reconnectBaseMs);
    this.reconnectAttempt++;
    getLogger().warn('editor', `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        getLogger().info('editor', 'Reconnected');
      } catch (err) {
        getLogger().warn('editor', `reconnect failed: ${getErrorMessage(err)}`);
        // Re-schedule next attempt so the reconnect chain doesn't break
        this.scheduleReconnect();
      }
    }, delay);
    // F-7: unref 长生命周期重连定时器,避免阻止 Node 优雅退出(与 gdscript-executor _cleanupTimer.unref() 一致)
    this.reconnectTimer?.unref();
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.connectGeneration++;  // ipc P1-4: 让进行中的 connect() 过期(open 检查 gen 不等 -> 丢弃)
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners('close');
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      // B4: 挂 err.code='DISCONNECTED' 供 Executor 分流(do_not_retry),覆盖原字符串匹配漏项
      pending.reject(Object.assign(new Error('Disconnected'), { code: 'DISCONNECTED' }));
    }
    this.pending.clear();
    this.notificationHandlers.clear();
    // IM-5: clear handler Sets so closures (holding GodotServer refs) can be GC'd
    this.disconnectHandlers.clear();
    this.reconnectHandlers.clear();
    this.reconnectExhaustedHandlers.clear();
  }

  /**
   * Reset reconnect state so that a subsequent `connect()` can re-enable
   * reconnection. This is useful after max-reconnect-attempts was reached
   * and you want to retry later.
   */
  resetReconnectState(): void {
    this.reconnectAttempt = 0;
    this.reconnectEnabled = this.shouldReconnect;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 手动触发重连：重置耗尽状态(reconnectEnabled/attempt)并启动后台重连循环。
   * 用于 manage_tools(reconnect) 在 connect 一次性失败后,让编辑器恢复时自动连上,
   * 避免用户须反复手动调 reconnect 或重启 MCP 服务端(反馈 reconnecting 卡死)。
   */
  requestReconnect(): void {
    this.resetReconnectState();
    if (!this.connected && !this.reconnectTimer) {
      this.scheduleReconnect();
    }
  }

  /**
   * B8: 连接活性语义说明。
   * 仅反映 ws 'open'/'close' 事件后的 connected flag, 非TCP 实时活性——
   * TCP 半开(对端 accept 不响应不 close)时此方法仍返回 true。
   * 实时活性检测见 HealthMonitor 心跳(health-monitor.ts startHeartbeat + ping)。
   */
  isConnected(): boolean {
    return this.connected;
  }
}
