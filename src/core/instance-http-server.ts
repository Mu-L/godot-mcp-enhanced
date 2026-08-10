// src/core/instance-http-server.ts
/**
 * MULTI_INSTANCE 接收端 HTTP server（2026-08-10 行225：补全 verifyApiToken 闭环）。
 *
 * 此前 MULTI_INSTANCE 是「发送端 only」——sendToInstance / dynamicSender 用 fetch POST +
 * buildAuthHeaders(HMAC 签名)发请求到 127.0.0.1:<port>/api/<tool>，但 TS server 从不启动
 * HTTP 接收端，verifyApiToken 零生产调用。本模块补全接收端：
 *
 *   POST /api/<toolName>  →  verifyApiToken(instanceId, token)  →  dispatcher.handleCall
 *   ↑ HMAC 签名验证失败 = 401        ↑ 复用 GodotServer 同一个 ToolDispatcher
 *
 * 安全模型：
 * - 仅 127.0.0.1（localhost，对齐 instance-api-auth.ts 的安全模型）
 * - HMAC 签名含 instance.id + timestamp + nonce，防重放（verifyApiToken 内置）
 * - toolName 严格校验 ^[a-zA-Z_][a-zA-Z0-9_]*$（防路径注入，对齐 sendToInstance 同款校验）
 * - 仅 POST（GET/其他方法 405）
 *
 * 限制（srvCtx=undefined 的代价）：
 * - confirm_and_execute 双轮 MRTR 交互失效（多实例转发场景不需要 MRTR，可接受）
 * - logLevel / per-request log 失效（普通工具不受影响）
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyApiToken } from './instance-api-auth.js';
import type { ToolDispatcher } from './ToolDispatcher.js';
import type { HandlerResult } from '../types.js';
import { getLogger } from './logger.js';

/** toolName 合法字符集（对齐 GodotServer.ts sendToInstance 的校验，防路径注入）。 */
const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface InstanceHttpServerOptions {
  /** 监听端口。 */
  port: number;
  /** 本实例 id（verifyApiToken 用此 id 验签）。 */
  instanceId: string;
  /** 工具调度器（复用 GodotServer 的 dispatcher）。 */
  dispatcher: ToolDispatcher;
}

export class InstanceHttpServer {
  private server: http.Server | null = null;
  private readonly opts: InstanceHttpServerOptions;

  constructor(opts: InstanceHttpServerOptions) {
    this.opts = opts;
  }

  /** 启动 HTTP server 监听 127.0.0.1:<port>。 */
  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        reject(err);
      };
      this.server!.once('error', onError);
      this.server!.listen(this.opts.port, '127.0.0.1', () => {
        this.server!.removeListener('error', onError);
        getLogger().info('instance-http', `HTTP receiver listening on 127.0.0.1:${this.opts.port} (instance ${this.opts.instanceId})`);
        resolve();
      });
    });
  }

  /** 停止 HTTP server。best-effort，不 throw。 */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  /** 是否正在监听。 */
  isListening(): boolean {
    return this.server?.listening ?? false;
  }

  /** 核心请求处理：验签 → 解析 → 转发 dispatcher。 */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // ① 仅 POST
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
        return;
      }

      // ② 解析 /api/<toolName>
      const url = req.url ?? '';
      const match = url.match(/^\/api\/(.+)$/);
      if (!match) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use POST /api/<toolName>.' }));
        return;
      }
      const toolName = decodeURIComponent(match[1]!);
      if (!TOOL_NAME_RE.test(toolName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid tool name: ${toolName}` }));
        return;
      }

      // ③ 验签：提取 Authorization: Bearer <token>
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid Authorization header. Expected: Bearer <token>' }));
        return;
      }
      const token = authHeader.slice('Bearer '.length);
      if (!verifyApiToken(this.opts.instanceId, token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication failed: invalid or expired token.' }));
        return;
      }

      // ④ 解析 body JSON
      const body = await this.readBody(req);
      let args: Record<string, unknown>;
      try {
        args = body.length > 0 ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
        return;
      }

      // ⑤ 转发到 dispatcher（srvCtx=undefined，普通工具不受影响）
      const result: HandlerResult = await this.opts.dispatcher.handleCall({
        params: { name: toolName, arguments: args },
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      getLogger().warn('instance-http', `Request handler error: ${err instanceof Error ? err.message : err}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
  }

  /** 读取请求 body（有上限防内存耗尽）。 */
  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let totalLen = 0;
    const MAX_BODY = 10 * 1024 * 1024; // 10MB
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      totalLen += buf.length;
      if (totalLen > MAX_BODY) {
        throw new Error('Request body too large (max 10MB)');
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
}
