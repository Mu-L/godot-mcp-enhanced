// test/core/editor-connection-manager-recovery.test.ts
//
// A-3 (2026-08-14 finding :932, P0): 编辑器重启(secret 轮换)后重连链恢复集成测试。
// 链路: 初始连接成功 → editor 重启换 secret + 断连 → 自动重连 auth 失败(旧 secret)
//   → [A-3 修复] fire reconnectExhausted → Manager.handleStall 降级(conn=null)
//   → manage_tools(reconnect) 的 getEditor() 返回 null → 走 rebuild()(重读 secret)
//   → 新连接(新 secret)成功。
// 修复前断点: auth 失败不 fire exhaustion → handleStall 不跑 → conn 残留非 null
//   → manage_tools 只会 ec.connect()(旧 secret)永远失败 → authFailureCount 累计 → lockout。
//
// 本文件用真 EditorConnection + 真 WebSocketServer(仅 mock editor-auth 的文件读取),
// 与 mock 层测试(editor-connection-manager.test.ts)互补。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';

vi.mock('../../src/core/editor-auth.js', () => ({
  waitForEditorSecret: vi.fn(),
}));

import { waitForEditorSecret } from '../../src/core/editor-auth.js';
import { EditorConnectionManager } from '../../src/core/EditorConnectionManager.js';
import type { EditorConnectionHost } from '../../src/core/EditorConnectionManager.js';
import { buildReconnectEditor } from '../../src/tools/manage-tools.js';

const PROJECT = 'D:/proj/fixture';

/** 服务端当前 secret(模拟编辑器重启换密钥:改此变量即可)。 */
let serverSecret = 'old-secret';

function makeHost(): EditorConnectionHost & {
  onConnected: ReturnType<typeof vi.fn>;
  onDegrade: ReturnType<typeof vi.fn>;
} {
  const hm = {
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    onStateChange: vi.fn(),
    setState: vi.fn(),
    reset: vi.fn(),
  };
  return {
    dispatcher: {
      getHealthMonitor: vi.fn(() => hm),
      setEditorExecutor: vi.fn(),
      markEditorFallback: vi.fn(),
      degradeToHeadless: vi.fn(),
      setConnectionMode: vi.fn(),
    },
    sendLoggingMessage: vi.fn(() => undefined),
    onConnected: vi.fn(),
    onDegrade: vi.fn(),
  } satisfies EditorConnectionHost;
}

describe('EditorConnectionManager A-3: secret 轮换后重连链恢复(集成)', () => {
  let wss: WebSocketServer;
  let port: number;
  let connectionCount: number;
  let mgr: EditorConnectionManager | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    // establish 的重连参数从 env 读(EditorConnectionManager.readPositiveIntEnv),
    // 设快退避让"close → 重连 → auth 失败 → fire exhaustion"链在测试窗口内完成。
    process.env.GODOT_MCP_EDITOR_RECONNECT_INTERVAL = '50';
    process.env.GODOT_MCP_EDITOR_RECONNECT_MAX_INTERVAL = '100';
    serverSecret = 'old-secret';
    connectionCount = 0;
    // secret "文件"内容跟随服务器当前值 —— 模拟 editor plugin 重启时已写入新 secret
    vi.mocked(waitForEditorSecret).mockImplementation(async () => serverSecret);
    wss = new WebSocketServer({ port: 0 });
    port = wss.address().port;
    wss.on('connection', (ws) => {
      connectionCount++;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          if (msg.params.secret === serverSecret) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
          } else {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Auth failed' } }));
          }
        } else if (msg.method === 'editor_get_project_path') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { project_path: PROJECT } }));
        } else {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        }
      });
    });
  });

  afterEach(() => {
    delete process.env.GODOT_MCP_EDITOR_RECONNECT_INTERVAL;
    delete process.env.GODOT_MCP_EDITOR_RECONNECT_MAX_INTERVAL;
    // 清残留连接,防挂起的 reconnectTimer 泄漏到后续测试
    mgr?.close();
    mgr = null;
    wss.close();
  });

  it('secret 轮换 → auth 失败降级(conn=null) → rebuild() 重读 secret 恢复连接', { timeout: 15_000 }, async () => {
    const host = makeHost();
    mgr = new EditorConnectionManager(host, { port, projectPath: PROJECT, noFallback: false });

    // 初始连接成功(旧 secret)
    const init = await mgr.init();
    expect(init.connected).toBe(true);
    expect(connectionCount).toBe(1);
    expect(mgr.getConn()).not.toBeNull();

    // 模拟编辑器重启: secret 轮换 + 断开现有连接
    serverSecret = 'new-secret';
    for (const client of wss.clients) client.close();

    // 自动重连链: close → scheduleReconnect(50~150ms) → connect → auth 失败(旧 secret)
    // → [A-3 修复] fire exhaustion → handleStall 降级。轮询等链路完成(而非固定 sleep)。
    await vi.waitFor(() => {
      // A-3 核心 1: handleStall 已跑(conn=null),rebuild 路径可达。
      // 修复前: exhaustion 不 fire → conn 残留非 null → manage_tools(reconnect) 走
      // ec.connect()(旧 secret)永远失败并累计 authFailureCount → lockout,链死。
      expect(mgr!.getConn()).toBeNull();
    }, { timeout: 5_000, interval: 100 });
    expect(host.onDegrade).toHaveBeenCalled();
    // IMP-8 不变量: auth 失败后自动重连链止步(1 初始 + 1 次 auth 失败尝试)
    expect(connectionCount).toBe(2);

    // A-3 核心 2: rebuild() 重读 secret(mock 第 2 次被调,返回 new-secret)→ 新连接成功
    const r = await mgr.rebuild();
    expect(r.connected).toBe(true);
    expect(waitForEditorSecret).toHaveBeenCalledTimes(2);
    expect(connectionCount).toBe(3);
    expect(mgr.getConn()?.isConnected()).toBe(true);
  });

  it('manage_tools(reconnect) 链: conn=null 后 buildReconnectEditor 走 rebuild 恢复(新 secret)', { timeout: 15_000 }, async () => {
    const host = makeHost();
    mgr = new EditorConnectionManager(host, { port, projectPath: PROJECT, noFallback: false });

    const init = await mgr.init();
    expect(init.connected).toBe(true);

    // 编辑器重启换 secret + 断连 → auth 失败 → fire exhaustion → handleStall → conn=null
    serverSecret = 'new-secret';
    for (const client of wss.clients) client.close();
    await vi.waitFor(() => {
      expect(mgr!.getConn()).toBeNull();
    }, { timeout: 5_000, interval: 100 });

    // GodotServer 的实际接线方式(GodotServer.ts:239-241): getEditor=editorMgr.getConn,
    // rebuild=editorMgr.rebuild。conn=null → 走 rebuild() 分支(重读 secret)而非 ec.connect()。
    const reconnect = buildReconnectEditor(
      () => mgr!.getConn(),
      () => mgr!.rebuild(),
    );
    const result = await reconnect();
    expect(result.connected).toBe(true);
    expect(mgr.getConn()?.isConnected()).toBe(true);
    expect(waitForEditorSecret).toHaveBeenCalledTimes(2); // secret 被重读
  });
});
