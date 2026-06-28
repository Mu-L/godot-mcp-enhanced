// game-bridge.test.ts — 合并自原 game-bridge-error.test.ts + game-bridge-isready.test.ts
//
// 合并原因:规避 vitest 4.1.x 在 Linux 平台的 vi.mock 内置模块跨文件隔离失效(PR #14 调查)。
// 全仓仅原这两个文件 vi.mock('net'),Linux 全量运行时同 fork 内两个 net mock 互相影子化,
// 致 game-bridge-error 的 mockCreate 实际未接管生产 net.createConnection → beforeEach
// vi.clearAllMocks() 清空那个接错的实现 → createConnection() 返回 undefined →
// game-bridge.ts:150 sock.on('data') TypeError → :739 catch 兜底 textResult(无 isError)
// → T-2/N-1 断言拿 undefined 而败。合并后同 fork 内仅一个 net mock,消除碰撞触发条件。
// 本地 Windows 4.1.7/4.1.9 双版本 2852 全过(CI Linux 4.1.7 才败:平台敏感,版本无关)。
//
// 覆盖(全部断言逐字保留自两原文件,共 23 个):
// - T-2 (2026-06-24 审查): bridge 返回 error 必须 isError=true,否则 MCP 客户端误判成功吞错
//   (覆盖 bridgeAction :479 + game_query 内联 :596 两条 error 路径;守护 :625 errorResult 不被回退)
// - N-1: sendToBridge once 监听器不泄漏
// - T-1 / I-1 / I-2: game 节点路径 /root/ 前置校验 + wait_for_property property/value 校验
// - isBridgeReady: 零接触探测(auth 成功 / secret 缺失 / auth 超时 / 进程 killed / isCancelled)

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

import { handleTool, setBridgeProjectDir, isBridgeReady, _testBridgeCacheState } from '../src/tools/game-bridge.js';

// ===== helpers =====

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

/** isBridgeReady:模拟 bridge 立即 auth 成功的 socket。 */
function authSuccessSocket(): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn();
  (sock as any).destroy = vi.fn();
  queueMicrotask(() => sock.emit('data', Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n')));
  return sock;
}
/** isBridgeReady:永不发 auth 成功(卡住,触发 timeout)。 */
function stuckSocket(): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn();
  (sock as any).destroy = vi.fn();
  return sock;
}

// ===== error paths + 路径校验(原 game-bridge-error)=====

describe('game-bridge error & path validation', () => {
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

  describe('739: catch 兜底非 ECONNREFUSED → isError=true (issue #15 遗留)', () => {
    it('bridge 连接 error(非 ECONNREFUSED) → catch 兜底 opsErrorResult(isError=true, BRIDGE_ERROR)', async () => {
      // sock 连接后 emit 非 ECONNREFUSED 错误 → _doConnect :193 reject('Bridge connection error: ...')
      // → bridgeAction reject → handleTool catch(:732) → msg 非 ECONNREFUSED → :739 opsErrorResult
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn();
        (sock as any).destroy = vi.fn();
        queueMicrotask(() => {
          if (typeof cb === 'function') cb();  // connectListener 触发 auth write
          sock.emit('error', new Error('connection reset'));  // 非 ECONNREFUSED
        });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(result).not.toBeNull();
      expect(result!.isError).toBe(true);
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_ERROR');
      expect(parsed.error).toContain('connection reset');
    });

    it('ECONNREFUSED → BRIDGE_NOT_CONNECTED + suggestion(端到端,游戏未运行语义)', async () => {
      // emit 带 code 的 ECONNREFUSED → _doConnect :195 按 err.code 分流 → BridgeNotConnectedError
      // → 外层 catch :733 instanceof → opsErrorResult(BRIDGE_NOT_CONNECTED, suggestion)
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn();
        (sock as any).destroy = vi.fn();
        queueMicrotask(() => {
          if (typeof cb === 'function') cb();
          const e = new Error('connect ECONNREFUSED 127.0.0.1:9081') as NodeJS.ErrnoException;
          e.code = 'ECONNREFUSED';
          sock.emit('error', e);
        });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(result).not.toBeNull();
      expect(result!.isError).toBe(true);
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
      expect(parsed.error).toContain('Cannot connect to MCP Bridge');
      expect(parsed.error).not.toContain('ECONNREFUSED');  // 不泄露原始错误码给用户
      expect(parsed.suggestion).toBeTruthy();
    });
  });

  describe('Bridge 超时分层: NOT_CONNECTED 其余路径', () => {
    it('secret not found → BRIDGE_NOT_CONNECTED(bridge 未装/未跑)', async () => {
      // readFileSync 抛错 → readBridgeSecret 返回 null → _doConnect :155 throw BridgeNotConnectedError
      mockRead.mockImplementation(() => { throw new Error('ENOENT'); });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(result).not.toBeNull();
      expect(result!.isError).toBe(true);
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
      expect(parsed.suggestion).toBeTruthy();
    });

    it('auth timeout → BRIDGE_NOT_CONNECTED(bridge 接受 TCP 不响应认证)', async () => {
      // bridge 接受连接但不回 auth → _doConnect auth timer → BridgeNotConnectedError
      mockRead.mockReturnValue('test-secret');
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn();  // 接受 auth write 不回
        (sock as any).destroy = vi.fn();
        queueMicrotask(() => { if (typeof cb === 'function') cb(); });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping', timeout: 1000 }, ctx);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
    }, 5000);
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

    it('click_button 仅 text(空 path) → 不因 path 校验报错(审查#3 回归守护)', async () => {
      setupBridgeSocket('result');
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'click_button', text: 'Start' }, ctx);
      expect(result.isError).not.toBe(true);
    });
  });

  describe('I-2: wait_for_property property/value 校验', () => {
    it('wait_for_property 缺 property → isError=true', async () => {
      setupBridgeSocket('result');
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', {
        action: 'game_wait', method: 'wait_for_property',
        params: { path: '/root/Player' },  // 缺 property
        timeout: 100, interval_ms: 100,
      }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('property');
    });

    it('wait_for_property 缺 value → isError=true', async () => {
      setupBridgeSocket('result');
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', {
        action: 'game_wait', method: 'wait_for_property',
        params: { path: '/root/Player', property: 'health' },  // 缺 value
        timeout: 100, interval_ms: 100,
      }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('value');
    });

    it('wait_for_node 不需 property(回归守护)', async () => {
      setupBridgeSocket('result');
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', {
        action: 'game_wait', method: 'wait_for_node',
        params: { path: '/root/Player' },
        timeout: 100, interval_ms: 100,
      }, ctx);
      expect(result.isError).not.toBe(true);
    });
  });
});

// ===== isBridgeReady 零接触探测(原 game-bridge-isready)=====

describe('isBridgeReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue('test-secret');
    setBridgeProjectDir('/known-project'); // 预设模块 _projectDir,用于零接触断言
  });

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
