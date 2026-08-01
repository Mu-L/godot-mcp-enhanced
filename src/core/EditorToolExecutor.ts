// src/core/EditorToolExecutor.ts
import type { EditorConnection } from './EditorConnection.js';
import type { ToolResult } from '../types.js';
import { resolveEditorMethod } from './editor-method-map.js';
import type { HealthMonitor } from './health-monitor.js';
import { opsErrorResult } from '../tools/shared.js';

export class EditorToolExecutor {
  private syncActive = false;
  // I-PERF-04: Circular buffer instead of Array (avoids O(n) shift)
  private treeChangeRing: Array<{ type: string; path: string; node_type: string } | null> = [];
  private treeChangeHead = 0; // next write position
  private treeChangeCount = 0;
  private static readonly MAX_BUFFER_SIZE = 10000;
  private readonly conn: EditorConnection;
  // B-T3: 半开 HOL 预检——_executeInner 入口据 healthMonitor.getState() === 'reconnecting'
  // 即时返 NOT_CONNECTED，跳过 30s conn.request 等待（串行 executeChain ×30s HOL 放大）。
  // 可选：未注入时不预检（向后兼容既有 new EditorToolExecutor(conn) 调用点）。
  private readonly healthMonitor?: HealthMonitor;
  // security P1#2: editor 工具串行化链(防并发 ws.send 致 undo 栈 LIFO 错乱)
  private executeChain: Promise<unknown> = Promise.resolve();

  /** Bound handlers stored so we can remove them on destroy. */
  private readonly _disconnectHandler = (): void => {
    // D3: 不清 syncActive — 保留用户 sync 意图。重连时 _reconnectHandler 据 syncActive
    // re-subscribe(自动恢复);清了会致重连不 re-subscribe(语义错乱)+ handleSyncStop 误报 SYNC_NOT_ACTIVE。
    this.treeChangeRing = [];
    this.treeChangeHead = 0;
    this.treeChangeCount = 0;
  };
  private readonly _reconnectHandler = (): void => {
    if (this.syncActive) {
      this.conn.onNotification('scene_tree_changed', this.handleTreeChange);
    }
  };

  constructor(conn: EditorConnection, healthMonitor?: HealthMonitor) {
    this.conn = conn;
    this.healthMonitor = healthMonitor;
    this.conn.addOnDisconnectHandler(this._disconnectHandler);
    this.conn.addOnReconnectHandler(this._reconnectHandler);
  }

  /** Remove all handlers from the connection. Call when discarding this executor. */
  destroy(): void {
    this.conn.removeOnDisconnectHandler(this._disconnectHandler);
    this.conn.removeOnReconnectHandler(this._reconnectHandler);
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    // security P1#2 fix: 串行化 editor 工具调用 - MCP SDK 异步并发派发多个 tools/call, 并发 ws.send 到达
    // GDScript 顺序不可靠, 致 undo 栈 LIFO 错乱(commit 顺序与逻辑依赖相反 -> undo 弹栈 target==null/undo 丢失).
    // Promise 链排队: 每个 execute 等前一个完成再发 request, 保证 commit_action 顺序确定.
    const run = this.executeChain.then(
      () => this._executeInner(toolName, args),
      () => this._executeInner(toolName, args),  // 前一个 reject 不阻塞下一个
    );
    this.executeChain = run.then(
      () => undefined,
      () => undefined,  // chain 不因单失败而 reject, 保持后续可调度
    );
    return run;
  }

  private async _executeInner(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    // B-T3: 半开 HOL 预检——TCP 半开时 conn.connected=true 但 editor 主线程卡死，
    // conn.request 挂满 30s（串行 executeChain ×30s HOL 放大）。
    // healthMonitor 心跳已检测到 reconnecting 时，入口即时返 NOT_CONNECTED 跳过等待。
    if (this.healthMonitor && this.healthMonitor.getState() === 'reconnecting') {
      return opsErrorResult(
        'NOT_CONNECTED',
        'Editor is reconnecting (half-open precheck). Retry shortly.',
      );
    }
    try {
      if (toolName === 'editor') {
        const action = args.action as string;
        if (action === 'sync_start') return this.handleSyncStart(args);
        if (action === 'sync_stop') return this.handleSyncStop(args);
        if (action === 'get_scene_tree') return this.handleGetSceneTree(args);
      }

      // Forward to plugin. The plugin-side handlers use undo_manager for
      // mutating operations (add_node, particles_create, etc.).
      // TODO: Future — add _use_undo flag for unified undo control across all handlers.

      // Default: forward to plugin. resolveEditorMethod 把 (tool,action) 映射到
      // command_handler 的扁平 method（asset→asset_create 等）；未命中 fallback 工具名。
      const entry = resolveEditorMethod(toolName, args);
      const method = entry?.method ?? toolName;
      const finalArgs = entry?.transformArgs ? entry.transformArgs(args) : args;

      // §7 A-lite: nav bake 长操作包 operation_start/end 暂停心跳（EditorConnection.ts:419-424 已有方法接线）。
      // 闭环 defects heartbeat-pause-timeout-disconnect（startOperation/endOperation 零生产调用）：
      // bake_mesh 挂起期心跳阻塞致 editor 误判断开；operation_start 通知 GD heartbeat.gd 暂停。
      // T_ts 对齐 §6 BAKE_WAIT_TIMEOUT_MS（110s 量级，clamp ≤600）。GD P1#3 hard timeout 兜底（heartbeat.gd:37-46）。
      // finalArgs.bake === true 严格等于依赖 nav 工具 schema 强制 bool（GD 侧 params.get("bake", false) 宽松，
      // 但 TS schema 校验在 GD 之前保证 bool 入参，故 === true 不会漏 truthy 非 bool 值）。
      const isNavBake = method === 'nav_bake_mesh'
        || (method === 'nav_create_region' && finalArgs.bake === true);
      const NAV_BAKE_OP_TIMEOUT_SEC = 110;  // < GD clamp 600，> §6 BAKE_WAIT_TIMEOUT_MS

      if (isNavBake) {
        // P2（设计权衡，固化审查 finding）：startOperation 只通知 GD 侧 heartbeat.gd 暂停
        // inactivity 检测；TS 侧 hm 心跳（GodotServer.ts:509）照常每 15s 发 ping。
        // 当前安全：nav bake 走 GD coroutine（websocket_server.gd:353 分流 handle_nav_async），
        // 不阻塞 GD 主循环 → TS ping 仍被即时响应，不误判降级。
        // 风险：若未来 editor 工具走同步阻塞主循环路径，TS ping 5s 超时×5≈75s 触发降级，
        // 而 NAV_BAKE_OP_TIMEOUT_SEC=110s > 75s 会误降级。届时需在此暂停/放宽 TS 侧 hm。
        await this.conn.startOperation(NAV_BAKE_OP_TIMEOUT_SEC);
        try {
          const result = await this.conn.request(method, finalArgs, { timeoutMs: NAV_BAKE_OP_TIMEOUT_SEC * 1000 });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } finally {
          // I-1 (C4 final review): endOperation 在连接异常态（client 30s REQUEST_TIMEOUT reject 后）
          // 可能自身 reject（NOT_CONNECTED 等），.catch 防其覆盖 try 抛出的原始错误（保 errCode 可观测性，
          // 下游 CONN_ERROR_CODES 判定正确）。
          await this.conn.endOperation().catch(() => {});
        }
      }

      const result = await this.conn.request(method, finalArgs);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const errCode = (err instanceof Error && 'code' in err)
        ? (err as Record<string, unknown>).code
        : undefined;
      const message = err instanceof Error ? err.message : 'Unknown error';
      // B4: 连接类错误结构化判定（覆盖原字符串匹配漏项 Disconnected / JSON parse error）
      // 5 个 code 由 EditorConnection reject 站点挂载;字符串兜底保护外部 path 未挂 code 的回归。
      // T2-M1 (final review): 字符串兜底必须守 errCode===undefined，否则插件结构化错误（带 number code 如
      // -32602）其 message 恰含连接子串（最现实 "Disconnected"，如 "Node Disconnected from parent"）会被
      // 误判连接错误 → code/data 被吞 + 反挂 do_not_retry+editor_disconnected。已挂 code（string 连接 code
      // 或 number 插件 code）走第一分支;无 code 的旧 Error 走字符串兜底;两路径互斥。
      const CONN_ERROR_CODES = new Set([
        'CONNECTION_LOST', 'NOT_CONNECTED', 'REQUEST_TIMEOUT', 'DISCONNECTED', 'PARSE_ERROR',
      ]);
      const isConnectionError =
        (typeof errCode === 'string' && CONN_ERROR_CODES.has(errCode)) ||
        (errCode === undefined && (
          message.includes('Connection lost') ||
          message.includes('Not connected') ||
          message.includes('Request timeout') ||
          message.includes('Disconnected') ||
          message.includes('JSON parse error')
        ));

      const errorPayload: Record<string, unknown> = { error: message };
      // I-12: 保留插件结构化 code/data（连接类错误除外——它们的 code 是本地连接语义非插件语义,
      // 暴露给客户端会被误解为插件 JSON-RPC code 触发错误处理逻辑）
      if (!isConnectionError && err instanceof Error && 'code' in err) {
        errorPayload.code = (err as Record<string, unknown>).code;
      }
      if (!isConnectionError && err instanceof Error && 'data' in err) {
        errorPayload.data = (err as Record<string, unknown>).data;
      }
      if (isConnectionError) {
        errorPayload.editor_disconnected = true;
        // ipc P0-1: 连接断开期间 in-flight 调用结果未知(编辑器侧可能已执行并入 undo 栈),
        // 客户端不应自动重试 — 否则重试命中新连接会重复执行(add_node 同名冲突 / undo 栈多一项)。
        errorPayload.do_not_retry = true;
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(errorPayload) }],
        isError: true,
      };
    }
  }

  private handleTreeChange = (params: unknown): void => {
    if (typeof params !== 'object' || params === null) return;
    const p = params as { type: string; path: string; node_type: string };
    if (typeof p.type !== 'string' || typeof p.path !== 'string') return;
    // I-PERF-04: O(1) ring buffer write instead of O(n) shift
    if (this.treeChangeCount < EditorToolExecutor.MAX_BUFFER_SIZE) {
      this.treeChangeRing.push(p);
      this.treeChangeCount++;
    } else {
      this.treeChangeRing[this.treeChangeHead] = p;
    }
    this.treeChangeHead = (this.treeChangeHead + 1) % EditorToolExecutor.MAX_BUFFER_SIZE;
  };

  /** Drain all buffered changes in insertion order and reset the ring. */
  private drainChanges(): Array<{ type: string; path: string; node_type: string }> {
    if (this.treeChangeCount === 0) return [];
    const result: Array<{ type: string; path: string; node_type: string }> = [];
    const size = this.treeChangeCount;
    // If ring hasn't wrapped, just slice; otherwise iterate from oldest
    if (size < EditorToolExecutor.MAX_BUFFER_SIZE) {
      for (let i = 0; i < size; i++) {
        result.push(this.treeChangeRing[i]!);
      }
    } else {
      // Oldest is at treeChangeHead (next write position wraps around)
      for (let i = 0; i < EditorToolExecutor.MAX_BUFFER_SIZE; i++) {
        const idx = (this.treeChangeHead + i) % EditorToolExecutor.MAX_BUFFER_SIZE;
        result.push(this.treeChangeRing[idx]!);
      }
    }
    this.treeChangeRing = [];
    this.treeChangeHead = 0;
    this.treeChangeCount = 0;
    return result;
  }

  private async handleSyncStart(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.syncActive) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SYNC_ALREADY_ACTIVE' }) }],
        isError: true,
      };
    }
    this.treeChangeRing = [];
    this.treeChangeHead = 0;
    this.treeChangeCount = 0;
    this.conn.onNotification('scene_tree_changed', this.handleTreeChange);
    try {
      const result = await this.conn.request('editor_sync_start', args);
      this.syncActive = true;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      this.conn.offNotification('scene_tree_changed', this.handleTreeChange);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  private async handleSyncStop(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.syncActive) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SYNC_NOT_ACTIVE' }) }],
        isError: true,
      };
    }
    this.conn.offNotification('scene_tree_changed', this.handleTreeChange);
    this.syncActive = false;
    const changes = this.drainChanges();
    try {
      const result = await this.conn.request('editor_sync_stop', args);
      const merged = typeof result === 'object' && result !== null
        ? { ...(result as Record<string, unknown>), buffered_changes: changes }
        : { result, buffered_changes: changes };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(merged) }],
      };
    } catch (err) {
      // 即使 request 失败（如已断连），仍然返回已缓冲的变更
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ warning: message, buffered_changes: changes }) }],
      };
    }
  }

  private async handleGetSceneTree(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.conn.request('editor_get_scene_tree', args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
}
