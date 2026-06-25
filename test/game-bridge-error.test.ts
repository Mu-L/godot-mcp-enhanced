// T-2 (2026-06-24 审查): bridge 返回 error 时必须 isError=true,否则 MCP 客户端误判成功吞掉错误。
// 覆盖两条 error 路径:bridgeAction(:479,monitor/watch/find_ui/click_button) + game_query 内联(:596)。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { mockCreate, mockExists, mockRead } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExists: vi.fn(() => true),
  mockRead: vi.fn(() => 'test-secret'),
}));

vi.mock('net', () => ({ createConnection: mockCreate }));
vi.mock('fs', () => ({
  existsSync: mockExists,
  readFileSync: mockRead,
  writeFileSync: vi.fn(), copyFileSync: vi.fn(), unlinkSync: vi.fn(),
  chmodSync: vi.fn(), statSync: vi.fn(), lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
  renameSync: vi.fn(),
}));
vi.mock('../src/dashboard/launcher.js', () => ({ launchDashboardOnce: vi.fn() }));

import { handleTool, setBridgeProjectDir } from '../src/tools/game-bridge.js';

/** mock socket:auth 请求(id=0)回 authenticated:true;method 请求(id≥1)按 kind 回 error/result。
 *  对应 game-bridge.ts :140 createConnection connectListener + :141 auth id=0 + :246 method id≥1。 */
function bridgeSocket(kind: 'error' | 'result'): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn((data: string) => {
    let req: { id?: number };
    try { req = JSON.parse(data); } catch { return; }
    queueMicrotask(() => {
      const resp = req.id === 0
        ? { id: 0, result: { authenticated: true } }
        : (kind === 'error'
          ? { id: req.id, error: { code: -32001, message: 'Invalid key' } }
          : { id: req.id, result: { ok: true, data: 'pong' } });
      sock.emit('data', Buffer.from(JSON.stringify(resp) + '\n'));
    });
  });
  (sock as any).destroy = vi.fn();
  return sock;
}

/** createConnection(opts, connectListener):返回 mock sock 并触发 connectListener(模拟连接建立,
 *  否则 _doConnect :141 的 auth write 永不执行→timeout)。 */
function setupBridgeSocket(kind: 'error' | 'result'): void {
  mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
    const sock = bridgeSocket(kind);
    queueMicrotask(() => { if (typeof cb === 'function') cb(); });
    return sock;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockReturnValue(true);
  mockRead.mockReturnValue('test-secret');
  // setBridgeProjectDir 内部调 _invalidateSocket(:233),清上个测试的 _socket 缓存 + 设 _projectDir
  setBridgeProjectDir('/p');
});

describe('T-2: bridge error → isError=true (不误判成功)', () => {
  it('monitor_poll (bridgeAction 路径): bridge 返回 error → isError=true', async () => {
    setupBridgeSocket('error');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', { action: 'monitor_poll' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('find_ui_elements (bridgeAction 路径): bridge 返回 error → isError=true', async () => {
    setupBridgeSocket('error');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', { action: 'find_ui_elements', type: 'Button' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('game_query (内联路径 :596): bridge 返回 error → isError=true', async () => {
    setupBridgeSocket('error');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('bridge 成功 (result) → isError 不为 true (回归守护)', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(result.isError).not.toBe(true);
  });
});
