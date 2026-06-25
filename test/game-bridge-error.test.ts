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
  (sock as any).writable = true;  // 模拟已连接 Socket.writable → _ensureConnection :207 复用 _socket(复现 N-1 once 累积)
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
  // setBridgeProjectDir 同路径时直接 return(:228)不清状态,先用不同路径强制 _invalidateSocket,
  // 再设回 '/p'。确保每个测试 _socket 缓存清空(跨测试 _socket 复用会污染,如 N-1 累积测试)。
  setBridgeProjectDir('/__reset__');
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

describe('N-1: sendToBridge once 监听器不泄漏', () => {
  it('多次成功调用后 error/close listener 不累积(只留 _doConnect 持久监听)', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    for (let i = 0; i < 12; i++) {
      await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    }
    const sock = mockCreate.mock.results[0].value;
    // _doConnect :169-170 注册持久 close/error 各 1。sendToBridge 每次 once error/close,
    // 成功 resolve 后(修复)移除。修复前:12 次累积 → listenerCount 13,触发 MaxListenersExceededWarning(默认 10)。
    expect(sock.listenerCount('error')).toBeLessThan(5);
    expect(sock.listenerCount('close')).toBeLessThan(5);
  });
});

describe('T-1: game path /root/ 前置校验', () => {
  it('game_write set_node_property path 非 /root/ → isError=true + 提示 /root/', async () => {
    setupBridgeSocket('result');  // 修复前会走到 sendToBridge(避免 throw),修复后 path 校验提前 return
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'game_write', method: 'set_node_property',
      params: { path: 'Player', property: 'position', value: { x: 1 } },
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('/root/');
  });

  it('game_write path 合法(/root/Player) → 不因 path 报错', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'game_write', method: 'set_node_property',
      params: { path: '/root/Player', property: 'position', value: { x: 1 } },
    }, ctx);
    expect(result.isError).not.toBe(true);
  });

  it('game_wait wait_for_node path 非 /root/ → isError=true', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'game_wait', method: 'wait_for_node',
      params: { path: 'Player' }, timeout: 100, interval_ms: 100,
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('/root/');
  });

  it('game_query ping 无 path → 不校验(回归守护)', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(result.isError).not.toBe(true);
  });
});

describe('I-1: bridgeAction 节点路径校验 (monitor/watch/click_button)', () => {
  it('monitor_start node_path 非 /root/ → isError=true', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'monitor_start', node_path: 'Player', properties: ['position'],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('/root/');
  });

  it('click_button path 非 /root/ → isError=true', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'click_button', path: 'UI/Button',
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('/root/');
  });

  it('monitor_start node_path 合法(/root/Player) → 不因 path 报错', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'monitor_start', node_path: '/root/Player', properties: ['position'],
    }, ctx);
    expect(result.isError).not.toBe(true);
  });

  it('find_ui_elements pattern 无节点路径 → 不校验(回归守护)', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    const result = await handleTool('game', {
      action: 'find_ui_elements', type: 'Button', pattern: 'Start',
    }, ctx);
    expect(result.isError).not.toBe(true);
  });
});
