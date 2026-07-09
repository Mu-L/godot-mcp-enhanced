/**
 * MCP Elicitation 接线 —— server 注入 + createElicitFn。
 *
 * ⚠️ 与 logger/progress 的关键区别（实现者注意，勿照搬两件套）：
 * - **不带 clientReady gate**：elicitInput 是 request/response（client 必已 initialize
 *   才到达 middleware），非 fire-and-forget notification（logger/progress 的 clientReady
 *   是防 notification 握手前崩，elicit 无此问题）。
 * - **不需四层参数链**：requestedSchema/message 是 per-call 参数（middleware 局部构造），
 *   _elicitServer 只读共享，elicitInput 按 request id 路由 → 天然并发安全。
 *   "与 logger/progress 同构"仅指 server 注入模式（模块级 set + null 清理）。
 *
 * 失败安全：client 不支持 / decline / cancel / throw → 返回 null（middleware fallback MISSING_PARAM）。
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface RequestedSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

export type ElicitFn = (
  requestedSchema: RequestedSchema,
  message: string,
) => Promise<Record<string, unknown> | null>;

let _elicitServer: Server | null = null;

/** 注入 MCP Server 实例（GodotServer 构造时调）；null 清除（close/测试隔离） */
export function setElicitServer(server: Server | null): void {
  _elicitServer = server;
}

/**
 * 创建 elicitFn 实现。闭包捕获模块级 _elicitServer（只读共享）。
 * 返回 Record<string, unknown>（非 string）——SDK 按 requestedSchema.type 返回对应类型，
 * number/boolean param 不窄化。
 */
export function createElicitFn(): ElicitFn {
  return async (requestedSchema, message) => {
    if (!_elicitServer) return null;
    const caps = _elicitServer.getClientCapabilities();
    if (!caps?.elicitation) return null;
    try {
      // RequestedSchema 故意宽松（properties: Record<string,unknown>，供 middleware 构造任意
      // JSON schema 片段）；SDK 边界要求 PrimitiveSchemaDefinition map，此处按 SDK 参数类型收窄。
      const result = await _elicitServer.elicitInput({
        mode: 'form',
        message,
        requestedSchema,
      } as Parameters<Server['elicitInput']>[0]);
      if (result.action === 'accept' && result.content) {
        return result.content as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/** 测试隔离 / 干净关闭：重置模块状态 */
export function resetElicitServer(): void {
  _elicitServer = null;
}
