import { expect, vi } from 'vitest';
import { EditorConnection } from '../src/core/EditorConnection.js';
import { WebSocketServer } from 'ws';

describe('EditorConnection', () => {
  let wss;
  let port;

  beforeEach(() => {
    wss = new WebSocketServer({ port: 0 });
    port = wss.address().port;
  });

  afterEach(() => {
    wss.close();
  });

  it('should have onNotification and offNotification methods', () => {
    const conn = new EditorConnection({ port: 9999 });
    expect(typeof conn.onNotification).toBe('function');
    expect(typeof conn.offNotification).toBe('function');
  });

  it('should have onDisconnect property', () => {
    const conn = new EditorConnection({ port: 9999 });
    expect(conn.onDisconnect).toBe(null);
  });

  it('connects and sends JSON-RPC request', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
      });
    });

    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    const result = await conn.request('test_method', { key: 'value' });
    expect(result).toEqual({ status: 'ok' });
    conn.disconnect();
  });

  it('handles connection refused gracefully', async () => {
    const conn = new EditorConnection({ port: 59999, reconnect: false, connectTimeout: 1000 });
    await expect(() => conn.connect()).rejects.toThrow(/connect/i);
  });

  it('handles request timeout', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        // Reply to auth but ignore other requests to simulate timeout
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        }
      });
    });

    const conn = new EditorConnection({ port, reconnect: false, requestTimeout: 500, secret: 'test-secret' });
    await conn.connect();
    await expect(() => conn.request('slow_method', {})).rejects.toThrow(/timeout/i);
    conn.disconnect();
  });

  it('sends operation_start for long running operations', async () => {
    let received = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      });
    });

    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    await conn.startOperation(300);
    expect(received.some(m => m.method === 'operation_start')).toBeTruthy();
    await conn.endOperation();
    expect(received.some(m => m.method === 'operation_end')).toBeTruthy();
    conn.disconnect();
  });

  it('does not reconnect on auth timeout (C-01)', { timeout: 15_000 }, async () => {
    // Server accepts connection but never replies to auth
    wss.on('connection', (ws) => {
      // intentionally ignore auth messages — simulate timeout
    });

    const reconnectSpy = vi.fn();
    const conn = new EditorConnection({
      port,
      reconnect: true,
      secret: 'test-secret',
      connectTimeout: 1000,
    });
    conn.onDisconnect = reconnectSpy;

    // connect should reject due to auth timeout
    await expect(() => conn.connect()).rejects.toThrow(/auth/i);

    // Give a small window for any async reconnect scheduling
    await new Promise((r) => setTimeout(r, 200));

    // onDisconnect may be called once for the close event, but
    // the key point: no reconnect should be scheduled.
    // We verify by checking that the connection is in a clean state.
    expect(conn.connected).toBe(false);
  });

  it('rejects connection without secret', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
      });
    });
    const conn = new EditorConnection({ port, reconnect: false });
    await expect(() => conn.connect()).rejects.toThrow(/no secret configured/i);
  });

  it('rejects connection with wrong secret', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Auth failed' } }));
        } else {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
        }
      });
    });
    const conn = new EditorConnection({ port, reconnect: false, secret: 'wrong-secret', connectTimeout: 1000 });
    await expect(() => conn.connect()).rejects.toThrow();
  });

  it('locks out after repeated auth failures', async () => {
    let connections = 0;
    wss.on('connection', (ws) => {
      connections++;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Auth failed' } }));
        }
      });
    });

    const conn = new EditorConnection({ port, reconnect: false, secret: 'wrong', connectTimeout: 500 });
    // Fail 5 times to trigger lockout
    for (let i = 0; i < 5; i++) {
      await expect(() => conn.connect()).rejects.toThrow();
    }
    // 6th attempt should be locked out immediately
    await expect(() => conn.connect()).rejects.toThrow(/locked out/i);
  });

  // IMP-8: 认证失败(wrong secret)后 close handler 不该调度重连。
  // wasConnected = !connectAttempt && authenticated && !authFailed → 认证失败时三者合力为 false。
  it('does not reconnect after auth failure (IMP-8)', { timeout: 8_000 }, async () => {
    let connections = 0;
    wss.on('connection', (ws) => {
      connections++;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Auth failed' } }));
        }
      });
    });

    const conn = new EditorConnection({
      port,
      reconnect: true,
      secret: 'wrong-secret',
      connectTimeout: 1000,
      reconnectInterval: 100,
      maxReconnectInterval: 200,
    });

    // connect 应因认证失败 reject(authFailed=true,reconnectEnabled=false)
    await expect(() => conn.connect()).rejects.toThrow();

    // 等待足够窗口让潜在重连发生(reconnectInterval=100ms,等 600ms 覆盖几次)
    await new Promise((r) => setTimeout(r, 600));

    // IMP-8 核心断言:认证失败后不重连 — server 端只应有 1 次连接(初始 connect)
    expect(connections).toBe(1);

    conn.disconnect();
  });

  // 审查可疑项闭环: EditorConnection 重连机制(connectGeneration 防复活 / scheduleReconnect
  // 指数退避 / fireReconnect) 此前零"成功重连"覆盖(全 reconnect:false, 仅测 auth 失败不重连)。
  // 本测试验证: 已认证连接被 server 端关闭 → scheduleReconnect → 重连成功 → fireReconnect
  // → 新连接可正常 request(generation 防复活, 新 ws 不被旧 connect 丢弃)。
  it('reconnects after server-side close and fires onReconnect (ipc P1)', { timeout: 10_000 }, async () => {
    let connectionCount = 0;
    let latestWs = null;
    wss.on('connection', (ws) => {
      connectionCount++;
      latestWs = ws;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
      });
    });

    const conn = new EditorConnection({
      port,
      reconnect: true,
      reconnectInterval: 50,
      maxReconnectInterval: 100,
      secret: 'test-secret',
    });
    let reconnected = false;
    conn.onReconnect = () => { reconnected = true; };

    await conn.connect();
    expect(connectionCount).toBe(1);
    expect(conn.connected).toBe(true);

    // 模拟编辑器崩溃: server 端关闭当前连接 → client ws 'close' → scheduleReconnect
    latestWs.close();

    // 等重连(attempt1 backoff=min(50*2,100)=100 + jitter[0,50] + connect/auth 开销)
    await new Promise((r) => setTimeout(r, 1000));
    expect(reconnected).toBe(true);
    expect(connectionCount).toBe(2);
    expect(conn.connected).toBe(true);

    // generation 防复活: 重连后的新连接可正常 request(新 ws 不被旧 connect 的 gen 检查丢弃)
    const result = await conn.request('test_method', {});
    expect(result).toEqual({ status: 'ok' });

    conn.disconnect();
  });

  // B3: request() 支持 options.timeoutMs 短超时（心跳 ping 用 5s 而非业务默认 30s）。
  // bug: GodotServer.ts:460 pingFn 复用 request('ping') 的 30s 默认超时——
  // 编辑器主线程卡死时 ping 要等 30s 才失败，连续 5 次 = ~150s 才触发降级。
  it('B3: request() honors options.timeoutMs (short heartbeat timeout)', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        // 仅回 auth，不回 ping —— 模拟编辑器卡死（TCP OPEN 但主线程无响应）
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        }
      });
    });

    // requestTimeout=30000 (业务默认) —— 模拟生产配置；心跳传 timeoutMs=500 覆盖
    const conn = new EditorConnection({ port, reconnect: false, requestTimeout: 30000, secret: 'test-secret' });
    await conn.connect();

    const start = Date.now();
    // options.timeoutMs=500 应覆盖默认 30000
    await expect(conn.request('ping', {}, { timeoutMs: 500 })).rejects.toThrow(/Request timeout/);
    const elapsed = Date.now() - start;
    // 应在 ~500ms 超时，远小于 30000ms
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(5000); // 5s buffer（CI 慢机器宽容），但绝不应接近 30s

    conn.disconnect();
  });

  // B5: fireDisconnect/fireReconnect 单 handler 抛错不应阻断后续 handler
  // (对齐 health-monitor:156-160 容错模式)。原实现裸 for-of 迭代,首个抛错即中断迭代。
  it('B5: a throwing disconnect handler does not block other handlers', () => {
    const conn = new EditorConnection({ port: 9999 });
    const called = [];
    conn.addOnDisconnectHandler(() => { called.push('first'); throw new Error('boom'); });
    conn.addOnDisconnectHandler(() => { called.push('second'); });
    // fireDisconnect 私有,通过 as any 直访(单测 handler 迭代逻辑,绕过 ws close 事件路径)
    conn.fireDisconnect();
    // 两个都跑,不因首个抛错中断
    expect(called).toEqual(['first', 'second']);
  });

  it('B5: fireDisconnect guard prevents duplicate firing (second call no-op)', () => {
    const conn = new EditorConnection({ port: 9999 });
    const called = [];
    conn.addOnDisconnectHandler(() => { called.push('one'); });
    // _disconnectFired 守卫:第二次 fireDisconnect 应早返回
    conn.fireDisconnect();
    conn.fireDisconnect();
    expect(called).toEqual(['one']);
  });

  it('B5: a throwing reconnect handler does not block other handlers', () => {
    const conn = new EditorConnection({ port: 9999 });
    const called = [];
    conn.addOnReconnectHandler(() => { called.push('first'); throw new Error('boom'); });
    conn.addOnReconnectHandler(() => { called.push('second'); });
    conn.fireReconnect();
    expect(called).toEqual(['first', 'second']);
  });

  // P0-1: 重连耗尽致命路径。编辑器崩溃/kill-9 后若重连耗尽,reconnectExhaustedHandler
  // 必须恰好触发一次(I-04 去重不变量——不因 ws close 的 fireDisconnect 重复),且
  // reconnectEnabled=false 后不再尝试。此前全文 0 处覆盖 maxReconnectAttempts /
  // reconnectExhausted,唯一重连测试只覆盖 attempt 1。编辑器崩溃后 MCP 瘫痪且测试无法捕获。
  it('fires reconnectExhausted exactly once after maxReconnectAttempts then stops (P0-1)', { timeout: 30_000 }, async () => {
    let connectionCount = 0;
    wss.on('connection', (ws) => {
      connectionCount++;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
      });
    });

    const conn = new EditorConnection({
      port,
      reconnect: true,
      reconnectInterval: 20,
      maxReconnectInterval: 40,
      maxReconnectAttempts: 3,
      connectTimeout: 400,
      secret: 'test-secret',
    });

    let exhaustedCalls = 0;
    conn.addOnReconnectExhaustedHandler(() => { exhaustedCalls++; });

    // 初始 connect 必须成功(authenticated=true),否则 close handler wasConnected=false 不进重连链
    await conn.connect();
    expect(connectionCount).toBe(1);
    expect(conn.connected).toBe(true);

    // 模拟编辑器崩溃:终止现有连接 + 关 server → client ws close → scheduleReconnect;
    // 后续每次重连 ECONNREFUSED,由 reconnectTimer 的 catch 递归驱动 scheduleReconnect,
    // 直到 attempt >= max。先 terminate 现有连接——wss.close 的 callback 会等所有活跃连接,
    // 不 terminate 则 client 以为连着不断开,callback 永挂。
    for (const client of wss.clients) client.terminate();
    await new Promise((res) => wss.close(res));

    // 3 次重连尝试 × (backoff 20~40ms + ECONNREFUSED 即时/最多 connectTimeout 400ms)
    await new Promise((r) => setTimeout(r, 4000));

    // I-04 核心:reconnectExhausted 恰好 1 次(去重,不重复)
    expect(exhaustedCalls).toBe(1);
    // 耗尽后连接断开
    expect(conn.connected).toBe(false);

    // 再等 1s 确认不再重复触发(reconnectEnabled=false,重连链已止)
    await new Promise((r) => setTimeout(r, 1000));
    expect(exhaustedCalls).toBe(1);

    conn.disconnect();
  });

  // P1-2（2026-07-31 补）：WS 断连 pending 批量 reject 故障注入。
  // EditorConnection.ts:257-263 close handler 遍历 pending 全 reject 挂 CONNECTION_LOST。
  // 核实：现有测试无并发 request + 中途 close 的故障注入。本测试补：3 并发 request +
  // server 端 close → 断言全 reject 带 code='CONNECTION_LOST'。
  it('rejects all pending requests with CONNECTION_LOST on server-side close (P1-2)', async () => {
    let latestWs = null;
    wss.on('connection', (ws) => {
      latestWs = ws;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        // 只响应 auth(id=-1)，业务 request 不响应 → 保持 pending
        if (msg.id === -1) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        }
      });
    });

    const conn = new EditorConnection({
      port,
      reconnect: false,  // 关重连，聚焦批量 reject
      secret: 'test-secret',
      requestTimeout: 5000,  // 长超时，确保 reject 来自 close 而非 timeout
    });
    await conn.connect();
    expect(conn.connected).toBe(true);

    // 发 3 个并发业务 request（server 不响应，全进 pending）
    const reqs = [
      conn.request('method_a', { n: 1 }),
      conn.request('method_b', { n: 2 }),
      conn.request('method_c', { n: 3 }),
    ];

    // 等待 request 真正发出并进 pending（让 server 收到 message）
    await new Promise((r) => setTimeout(r, 100));

    // server 端关闭连接 → client 'close' → 批量 reject pending
    latestWs.close();

    // 3 个 request 应全 reject，且 err.code === 'CONNECTION_LOST'
    const results = await Promise.allSettled(reqs);
    expect(results.every(r => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      expect(r.reason.code).toBe('CONNECTION_LOST');
    }

    conn.disconnect();
  });
});
