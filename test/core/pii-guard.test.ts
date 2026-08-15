// PII 护栏(G2 收尾)测试:验证 editor/middleware 路径的 catch 不外泄 err.message。
// GDScript 报错常含绝对路径/项目名 = PII,headless 主路径已有 classifyError 护栏
// (ToolDispatcher.ts),本测试覆盖本轮扩展到的 EditorToolExecutor + middleware 兜底。
import { describe, it, expect, vi } from 'vitest';

// mock logger(避免真实文件 IO + 测试隔离;debug/error 调用应为 no-op)
vi.mock('../../src/core/logger.js', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { EditorToolExecutor } from '../../src/core/EditorToolExecutor.js';
import { executeMiddleware } from '../../src/core/middleware.js';
import type { EditorConnection } from '../../src/core/EditorConnection.js';
import type { DispatchContext, HandlerResult } from '../../src/types.js';

/** 构造一个 conn.request 总 reject 给定错误的 stub EditorConnection。 */
function makeConn(rejectErr: unknown): EditorConnection {
  return {
    request: vi.fn().mockRejectedValue(rejectErr),
    onNotification: vi.fn(),
    offNotification: vi.fn(),
    addOnDisconnectHandler: vi.fn(),
    addOnReconnectHandler: vi.fn(),
  } as unknown as EditorConnection;
}

describe('PII 护栏(G2 收尾): editor/middleware catch 不外泄 err.message', () => {
  it('EditorToolExecutor 主 catch(非连接错误): 响应不含 err.message 的 PII 路径/项目名', async () => {
    const pii = 'res://SecretProj/scenes/main.gd:42 - Parse Error: undefined var';
    const executor = new EditorToolExecutor(makeConn(new Error(pii)));
    const result = await executor.execute('add_node', { node_path: 'root', node_type: 'Node', node_name: 'X' });
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).not.toContain('SecretProj');
    expect(text).not.toContain('main.gd');
    expect(text).not.toContain('Parse Error');
  });

  it('EditorToolExecutor sync_start catch: 响应不含 PII', async () => {
    const pii = 'res://Hidden/internal_path.gd:5 fail';
    const executor = new EditorToolExecutor(makeConn(new Error(pii)));
    const result = await executor.execute('editor', { action: 'sync_start' });
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).not.toContain('Hidden');
    expect(text).not.toContain('internal_path');
  });

  it('EditorToolExecutor 连接错误(回归): 保留连接语义 + editor_disconnected/do_not_retry 标志', async () => {
    // 连接错误 message 是连接语义(非 PII),允许外传;关键是降级标志不被 PII 修复破坏
    const err = Object.assign(new Error('Disconnected from editor'), { code: 'NOT_CONNECTED' });
    const executor = new EditorToolExecutor(makeConn(err));
    const result = await executor.execute('add_node', { node_path: 'root', node_type: 'Node', node_name: 'X' });
    const parsed = JSON.parse((result.content?.[0] as { text?: string } | undefined)?.text ?? '{}');
    expect(result.isError).toBe(true);
    expect(parsed.editor_disconnected).toBe(true);
    expect(parsed.do_not_retry).toBe(true);
  });

  it('middleware executeTool 兜底 catch: 响应不含 err.message PII', async () => {
    const pii = 'res://bar/TopSecret/fail.gd:1';
    const ctx: DispatchContext = {
      toolName: 'script',
      args: {},
      startTime: 0,
      phase: 'before',
      traceId: 't1',
    };
    const throwFn = async (): Promise<HandlerResult> => { throw new Error(pii); };
    const result = await executeMiddleware([], ctx, throwFn);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).not.toContain('TopSecret');
    expect(text).not.toContain('res://bar');
  });
});
