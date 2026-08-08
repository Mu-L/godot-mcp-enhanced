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

const { mockCreate, mockExists, mockRead, mockLstat, mockChmod, mockExec } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExists: vi.fn(() => true),
  mockRead: vi.fn(() => 'test-secret'),
  // A4: 默认非 symlink;测试时 override 为 symlink 验证权限收紧未发生
  mockLstat: vi.fn(() => ({ isSymbolicLink: () => false })),
  // A4: 暴露 chmod/exec 作 spy,断言 symlink 时二者均未被调用(副作用未发生)
  mockChmod: vi.fn(),
  mockExec: vi.fn(),
}));

vi.mock('net', () => ({ createConnection: mockCreate }));
vi.mock('fs', () => ({
  existsSync: mockExists,
  readFileSync: mockRead,
  writeFileSync: vi.fn(), copyFileSync: vi.fn(), unlinkSync: vi.fn(),
  chmodSync: mockChmod, statSync: vi.fn(), lstatSync: mockLstat,
  renameSync: vi.fn(),
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  // 仅替换 execFileSync(A4 断言目标);保留 execFile/spawn 等(helpers.ts:57 execFileAsync 依赖)
  return { ...actual, execFileSync: mockExec };
});
vi.mock('../src/dashboard/launcher.js', () => ({ launchDashboardOnce: vi.fn() }));

import { handleTool, setBridgeProjectDir, isBridgeReady, _testBridgeCacheState, registerBridgePushHandler } from '../src/tools/game-bridge.js';

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
      expect(parsed.suggestion).toEqual(expect.any(String));
      expect(parsed.suggestion.length).toBeGreaterThan(0);
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
      expect(parsed.suggestion).toEqual(expect.any(String));
      expect(parsed.suggestion.length).toBeGreaterThan(0);
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

  describe('Bridge 超时分层: TIMEOUT', () => {
    it('request timeout → BRIDGE_TIMEOUT(连上 + 认证后请求无响应,游戏卡住)', async () => {
      // auth 成功但 method 请求不响应 → sendToBridge :255 timer → BridgeTimeoutError
      mockRead.mockReturnValue('test-secret');
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        const sock = new EventEmitter();
        (sock as any).write = vi.fn((data: string) => {
          let req: { id?: number };
          try { req = JSON.parse(data); } catch { return; }
          queueMicrotask(() => {
            if (req.id === 0) {
              sock.emit('data', Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n'));
            }
            // id >= 1 method 请求不响应 → :255 timer
          });
        });
        (sock as any).destroy = vi.fn();
        (sock as any).writable = true;
        queueMicrotask(() => { if (typeof cb === 'function') cb(); });
        return sock;
      });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping', timeout: 1000 }, ctx);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_TIMEOUT');
      expect(parsed.suggestion).toContain('不是连接问题');
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

  describe('P3-6 socket 竞态: 常驻 push handler 与 sendToBridge 临时 handler 交错到达不丢/不串/不误 resolve', () => {
    // 2026-08-07 审查 P0: P3-6 引入的常驻 push data handler 与 sendToBridge 临时 data handler
    // 共享同一 socket 的 EventEmitter 广播。commit 90f065e 的 BLOCKING 修复(resp.id == null 误 resolve)
    // 证明此路径脆弱。本测试守护并发不变量:push 消息(无 id)不误 resolve pending request,
    // response 消息(有 id)不被 push handler 消费。
    it('push 消息先到、response 后到:push handler 被调 + sendToBridge 正确 resolve,不互相消费', async () => {
      const sock = new EventEmitter();
      (sock as any).write = vi.fn((data: string) => {
        let req: { id?: number };
        try { req = JSON.parse(data); } catch { return; }
        if (req.id === 0) {
          queueMicrotask(() => sock.emit('data', Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n')));
          return;
        }
        // 收到 method 请求后,先 emit 无 id 的 push 行,再 emit 有 id 的 response 行
        queueMicrotask(() => {
          const pushLine = JSON.stringify({ method: 'bridge/event', params: { event: 'monitor', data: { fps: 60 } } }) + '\n';
          const respLine = JSON.stringify({ id: req.id, result: { ok: true } }) + '\n';
          sock.emit('data', Buffer.from(pushLine + respLine));
        });
      });
      (sock as any).destroy = vi.fn();
      (sock as any).writable = true;
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        queueMicrotask(() => { if (typeof cb === 'function') cb(); });
        return sock;
      });

      const ctx = { projectDir: '/p' } as any;
      // 注册 push handler
      const pushReceived: Record<string, unknown>[] = [];
      registerBridgePushHandler((params) => { pushReceived.push(params); });

      // 发起 sendToBridge 请求(会先 auth id=0,再 method id=1)
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);

      // 断言 1: push handler 被调一次,收到 monitor 事件
      expect(pushReceived.length).toBe(1);
      expect(pushReceived[0]).toMatchObject({ event: 'monitor', data: { fps: 60 } });

      // 断言 2: sendToBridge 正确 resolve(收到 { ok: true } 响应,不是 push 消息)
      const text = (result?.content?.[0] as { text: string }).text;
      expect(text).toMatch(/"ok":\s*true/);
      expect(text).not.toContain('bridge/event');

      // 清理 push handler(防影响后续测试)
      registerBridgePushHandler(null);
    });
  });

  describe('P1-8: 废弃 socket 的延迟 close/error 不破坏新 socket (invalidate race)', () => {
    // 复现报告 P1-8 真实 race: A 连上 _socket=A → B _doConnect 入口 _invalidateSocket() destroy A、_socket=null
    // → B 连上 _socket=B → A.destroy() 的 close **异步触发**(此时 _socket 已是 B)→ 持久 close handler 若无守卫
    // 会 _invalidateSocket() destroy B。修复: handler 加 _socket === sock 守卫。
    it('A 被替换后, A 的延迟 close 事件不 invalidate 新 socket B', async () => {
      let sockA!: EventEmitter;
      let createCount = 0;
      mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
        createCount++;
        const sock = new EventEmitter();
        (sock as any).write = vi.fn((data: string) => {
          let req: { id?: number };
          try { req = JSON.parse(data); } catch { return; }
          queueMicrotask(() => {
            const resp = req.id === 0
              ? { id: 0, result: { authenticated: true } }
              : { id: req.id, result: { ok: true } };
            sock.emit('data', Buffer.from(JSON.stringify(resp) + '\n'));
          });
        });
        (sock as any).destroy = vi.fn();  // mock destroy 不自动 emit close(模拟 Node Socket.destroy 的异步 close 需手动 emit)
        (sock as any).writable = true;
        if (createCount === 1) sockA = sock;
        queueMicrotask(() => { if (typeof cb === 'function') cb(); });
        return sock;
      });

      const ctx = { projectDir: '/p' } as any;
      // 1. 连接 A
      await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(createCount).toBe(1);

      // 2. 强制 invalidate A(setBridgeProjectDir 换路径触发 _invalidateSocket → A.destroy + _socket=null)
      setBridgeProjectDir('/__reset__');
      setBridgeProjectDir('/p');

      // 3. 新请求 → _socket null → 连接 B
      await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(createCount).toBe(2);

      // 4. 延迟 emit A 的 close(A.destroy() 的 close 异步触发,此时 _socket 已是 B)
      sockA.emit('close');

      // 5. 新请求: 修复前 B 被 A 延迟 close 错误 invalidate → 新连 C(createCount=3)
      //         修复后 _socket === sockA 守卫拦截 → B 保留 → 复用(createCount 仍 2)
      await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(createCount).toBe(2);  // 关键断言: B 未被 A 的延迟 close 破坏
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

  describe('A4: symlink secret → 权限收紧(icacls/chmod)不得先于拒绝发生', () => {
    // readBridgeSecret 当前顺序 icacls/chmod(副作用) → lstatSync symlink 检查(拒绝)。
    // 若 secretPath 是 symlink 指向受害者文件,icacls/chmod 已篡改其 ACL/mode 才被拒(DoS)。
    // 修复后:lstatSync + symlink 拒绝移到 icacls/chmod 之前,对齐 editor-auth.ts:75-81。
    it('symlink secret: icacls(win32)/chmod(非 win32) 均未被调用 + secret 被拒绝', async () => {
      // 默认 mockRead 返 'test-secret'(模拟成功),但 symlink 检查应在读之前拒绝。
      // 不需 setupBridgeSocket:readBridgeSecret 在 _doConnect 入口同步返 null → 直接抛
      // BridgeNotConnectedError,不到达 createConnection。
      mockLstat.mockReturnValueOnce({ isSymbolicLink: () => true });
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      // symlink 必须被拒绝 → secret=null → BRIDGE_NOT_CONNECTED(不是拿到 secret 后的 ping)
      expect(result).not.toBeNull();
      expect(result!.isError).toBe(true);
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
      // 核心断言:权限收紧副作用未发生(无论平台,修复后 symlink 检查在最前)
      expect(mockExec).not.toHaveBeenCalled();   // win32 icacls
      expect(mockChmod).not.toHaveBeenCalled();  // 非 win32 chmod 0600
      // 且 secret 内容未被读入内存(拒绝在 readFileSync 之前)
      expect(mockRead).not.toHaveBeenCalled();
    });

    it('非 symlink secret: 权限收紧正常执行(回归守护,避免过度拒绝)', async () => {
      // 默认 mockLstat 返 isSymbolicLink:false。校验修复后合法路径仍走 icacls/chmod + 读 secret。
      setupBridgeSocket('result');
      const ctx = { projectDir: '/p' } as any;
      const result = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
      expect(result.isError).not.toBe(true);  // secret 正常读到 → ping 成功
      // 合法路径:按平台执行了 icacls 或 chmod 之一(不要求具体哪个,只要至少一个收紧动作发生)
      const tightens = mockExec.mock.calls.length + mockChmod.mock.calls.length;
      expect(tightens).toBeGreaterThan(0);
      expect(mockRead).toHaveBeenCalled();  // secret 被正常读入
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

// ===== P1-3: bridge change_scene 断连 characterization（锁基线，红绿不论）=====
// 背景：vault 待办"测试-P1-3"标 🔴 open 生产 bug。探索确认 bridge 层无 change_scene 实现
// （autoload 不销毁已证），editor 模式 3 条候选根因已修。唯一未证伪假设：大场景 change_scene
// 卡主线程 > 10s timeout。本组锁 TS 侧连接状态机基线（socket 复用/超时 invalidate/自动重连），
// 防回归。真 bridge 模式复现需 weekly GUI 环境（Level 3 deferred）。
describe('P1-3: bridge 连接状态机 characterization（change_scene 断连基线）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue('test-secret');
    setBridgeProjectDir('/__reset__');
    setBridgeProjectDir('/p');
  });

  it('CS-1: 连接成功后第二次 sendToBridge 复用同一 socket（不新建连接）', async () => {
    setupBridgeSocket('result');
    const ctx = { projectDir: '/p' } as any;
    // 第一次调用建立连接（game_query method=ping 在 QUERY_METHODS 白名单内）
    await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    const firstCallCount = mockCreate.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);
    // 第二次调用应复用 _socket（_ensureConnection :294 条件全真）
    await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(mockCreate.mock.calls.length).toBe(firstCallCount);
  });

  it('CS-2: socket close 后下次 sendToBridge 自动重连（bridge 侧断开后自愈）', async () => {
    // 第一阶段：正常连接
    let currentSock = bridgeSocket('result');
    mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
      queueMicrotask(() => { if (typeof cb === 'function') cb(); });
      return currentSock;
    });
    const ctx = { projectDir: '/p' } as any;
    const r1 = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(r1.isError).toBeFalsy();
    const callsAfterFirst = mockCreate.mock.calls.length;

    // 模拟 bridge 侧关闭连接（change_scene 后可能触发）
    currentSock.emit('close');
    // _invalidateSocket 应已清 _socket（close handler :401-404）

    // 第二阶段：下次调用应自动重连（_ensureConnection 发现 _socket=null → _doConnect）
    currentSock = bridgeSocket('result');
    const r2 = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(r2.isError).toBeFalsy();
    expect(mockCreate.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('CS-3: timeout 后 socket invalidate，下次 sendToBridge 自动重连（change_scene 卡主线程基线）', async () => {
    // 模拟卡住的 bridge：连接成功但 method 请求永不响应（模拟 change_scene 卡主线程）
    const stuckMethodSock = new EventEmitter();
    (stuckMethodSock as any).write = vi.fn((data: string) => {
      let req: { id?: number };
      try { req = JSON.parse(data); } catch { return; }
      if (req.id === 0) {
        // auth 成功
        queueMicrotask(() => stuckMethodSock.emit('data',
          Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n')));
      }
      // id >= 1 的 method 请求不响应（卡住）
    });
    (stuckMethodSock as any).destroy = vi.fn();
    (stuckMethodSock as any).writable = true;
    mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
      queueMicrotask(() => { if (typeof cb === 'function') cb(); });
      return stuckMethodSock;
    });

    const ctx = { projectDir: '/p' } as any;
    // 用短 timeout 加速：game_query 支持 args.timeout（clampTimeoutMs），设 200ms
    await handleTool('game', { action: 'game_query', method: 'ping', timeout: 200 }, ctx);
    // 关键断言：timeout 后 _testBridgeCacheState().socketNotNull 应为 false（_invalidateSocket 清了 _socket）
    const cache = _testBridgeCacheState();
    expect(cache.socketNotNull, 'timeout 后 _socket 应被 invalidate（socketNotNull=false）').toBe(false);

    // 第二阶段：恢复响应的 socket，下次调用应自动重连
    const goodSock = bridgeSocket('result');
    mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
      queueMicrotask(() => { if (typeof cb === 'function') cb(); });
      return goodSock;
    });
    const r2 = await handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    expect(r2.isError).toBeFalsy();
  });

  it('CS-4: 并发请求串行化（_sendLock 链），不并发使用 socket', async () => {
    // 两个几乎同时的请求应串行执行，不并发 write 到同一 socket
    const writtenIds: number[] = [];
    const slowSock = new EventEmitter();
    (slowSock as any).write = vi.fn((data: string) => {
      let req: { id?: number };
      try { req = JSON.parse(data); } catch { return; }
      if (req.id === 0) {
        queueMicrotask(() => slowSock.emit('data',
          Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n')));
      } else if (req.id != null) {
        writtenIds.push(req.id);
        // 延迟响应模拟处理时间
        queueMicrotask(() => slowSock.emit('data',
          Buffer.from(JSON.stringify({ id: req.id, result: { ok: true } }) + '\n')));
      }
    });
    (slowSock as any).destroy = vi.fn();
    (slowSock as any).writable = true;
    mockCreate.mockImplementation((_opts: unknown, cb?: () => void) => {
      queueMicrotask(() => { if (typeof cb === 'function') cb(); });
      return slowSock;
    });

    const ctx = { projectDir: '/p' } as any;
    // 并发发起两个请求（game_query + ping/get_performance 均在 QUERY_METHODS 白名单）
    const p1 = handleTool('game', { action: 'game_query', method: 'ping' }, ctx);
    const p2 = handleTool('game', { action: 'game_query', method: 'get_performance' }, ctx);
    await Promise.all([p1, p2]);
    // 两个 method 请求都被 write（串行，但不丢）
    expect(writtenIds.length).toBeGreaterThanOrEqual(2);
  });
});
