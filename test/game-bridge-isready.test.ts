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

import { isBridgeReady, setBridgeProjectDir, _testBridgeCacheState } from '../src/tools/game-bridge.js';

/** 模拟 bridge 立即 auth 成功的 socket。 */
function authSuccessSocket(): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn();
  (sock as any).destroy = vi.fn();
  queueMicrotask(() => sock.emit('data', Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n')));
  return sock;
}
/** 永不发 auth 成功(卡住,触发 timeout)。 */
function stuckSocket(): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn();
  (sock as any).destroy = vi.fn();
  return sock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockReturnValue(true);
  mockRead.mockReturnValue('test-secret');
  setBridgeProjectDir('/known-project'); // 预设模块 _projectDir,用于零接触断言
});

describe('isBridgeReady', () => {
  it('auth 成功 → ready=true,且模块缓存零接触', async () => {
    const before = _testBridgeCacheState();
    mockCreate.mockReturnValue(authSuccessSocket());
    const r = await isBridgeReady('/other-project', 1000);
    expect(r.ready).toBe(true);
    expect(_testBridgeCacheState()).toEqual(before); // _projectDir 仍 /known-project,_cachedSecret/_socket 未变
  });

  it('secret 不存在 → ready=false, reason 含 secret not found', async () => {
    mockExists.mockReturnValue(false);
    const r = await isBridgeReady('/p', 100);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('secret not found');
  });

  it('auth 一直不成功 → ready=false, reason 含 did not succeed', async () => {
    mockCreate.mockReturnValue(stuckSocket());
    const r = await isBridgeReady('/p', 300);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('did not succeed');
  });

  it('进程已 killed → 立即短路,不等 timeout', async () => {
    const proc = { killed: true } as any;
    const r = await isBridgeReady('/p', 5000, { proc });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('process exited during probe');
  });

  it('isCancelled=true 且 bridge 不可用 → process exited(不误判 ready)', async () => {
    mockCreate.mockReturnValue(stuckSocket());
    const r = await isBridgeReady('/p', 5000, { isCancelled: () => true });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('process exited during probe');
  });

  it('isCancelled=true 但 bridge 仍可用(多 godot/ctx 被另一 proc 覆盖)→ ready,不误报 process exited', async () => {
    mockCreate.mockReturnValue(authSuccessSocket());
    const r = await isBridgeReady('/p', 5000, { isCancelled: () => true });
    expect(r.ready).toBe(true);
  });
});
