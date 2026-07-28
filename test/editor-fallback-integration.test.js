import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';

// ─── Mock MCP SDK (must be before GodotServer import) ────────────────────────
const mockSetRequestHandler = vi.fn();
const mockSetNotificationHandler = vi.fn();
const mockServerClose = vi.fn().mockResolvedValue(undefined);
const mockServerConnect = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(function (_, options) {
    this._instructions = options?.instructions;
    this.setRequestHandler = mockSetRequestHandler;
    this.setNotificationHandler = mockSetNotificationHandler;
    this.connect = mockServerConnect;
    this.close = mockServerClose;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  ListResourcesRequestSchema: 'ListResourcesRequestSchema',
  ListResourceTemplatesRequestSchema: 'ListResourceTemplatesRequestSchema',
  ReadResourceRequestSchema: 'ReadResourceRequestSchema',
  ListPromptsRequestSchema: 'ListPromptsRequestSchema',
  GetPromptRequestSchema: 'GetPromptRequestSchema',
  RootsListChangedNotificationSchema: 'RootsListChangedNotificationSchema',
  CompleteRequestSchema: 'CompleteRequestSchema',
}));

// ─── Mock fs (避 detectProjectPath / FileStateStore 副作用) ──────────────────
const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: mockExistsSync };
});

// ─── Mock editor-auth (返测试 secret，避真实文件/网络) ────────────────────────
const { mockWaitForEditorSecret } = vi.hoisted(() => ({
  mockWaitForEditorSecret: vi.fn().mockResolvedValue('test-secret'),
}));
vi.mock('../src/core/editor-auth.js', () => ({
  waitForEditorSecret: (...args) => mockWaitForEditorSecret(...args),
}));

// ─── Mock process-state (避真实进程管理) ─────────────────────────────────────
vi.mock('../src/core/process-state.js', () => ({
  getRunningProcess: vi.fn().mockReturnValue(null),
  setRunningProcess: vi.fn(),
  getOutputBuffer: vi.fn().mockReturnValue([]),
  setOutputBuffer: vi.fn(),
  getProcessStartTime: vi.fn().mockReturnValue(0),
  setProcessStartTime: vi.fn(),
  getProjectDir: vi.fn().mockReturnValue(''),
  setProjectDir: vi.fn(),
  killProcess: vi.fn().mockResolvedValue(undefined),
}));

// ─── 不 mock EditorConnection / EditorToolExecutor / HealthMonitor ───────────
// 真实接线是本集成测试的核心价值（现有 godot-server.test.js 用 mock 绕过真实重连）。
import { GodotServer } from '../src/GodotServer.js';

// ─── SUT ──────────────────────────────────────────────────────────────────────

// P0-1: EditorConnection 重连致命路径端到端零覆盖。
// editor-connection.test.js:305 已覆盖 EditorConnection 自身 reconnectExhausted（单元）；
// godot-server.test.js:198 用 mock EditorConnection 手动触发 handler（绕过真实重连）。
// 本文件补真实 ws 重连耗尽 / 半开心跳 → GodotServer.handleEditorStall → headless 降级接线。
describe('editor fallback end-to-end (P0-1)', () => {
  let wss;
  let port;
  let server;
  const envKeys = [
    'GODOT_EDITOR_PORT',
    'GODOT_MCP_EDITOR_RECONNECT_ATTEMPTS',
    'GODOT_MCP_EDITOR_RECONNECT_INTERVAL',
    'GODOT_MCP_EDITOR_RECONNECT_MAX_INTERVAL',
  ];
  const savedEnv = {};

  beforeEach(() => {
    wss = new WebSocketServer({ port: 0 });
    port = wss.address().port;
    for (const k of envKeys) savedEnv[k] = process.env[k];
    process.env.GODOT_EDITOR_PORT = String(port);
    // 低重连参数（GodotServer.establishEditorConnection 从 env 读，默认 20×backoff 不可测）
    process.env.GODOT_MCP_EDITOR_RECONNECT_ATTEMPTS = '3';
    process.env.GODOT_MCP_EDITOR_RECONNECT_INTERVAL = '20';
    process.env.GODOT_MCP_EDITOR_RECONNECT_MAX_INTERVAL = '40';
    // existsSync=true 让 resolveProjectPath() 返回非 null，触发 waitForEditorSecret 流程
    // （对齐 godot-server.test.js:212；false 会导致 run() 跳过 secret 直接降级 headless）
    mockExistsSync.mockReturnValue(true);
    mockWaitForEditorSecret.mockResolvedValue('test-secret');
    mockSetRequestHandler.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    try { if (server) await server.close(); } catch { /* best-effort */ }
    server = undefined;
    try { if (wss) await new Promise((res) => { wss.close(() => res()); }); } catch { /* may already be closed */ }
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  // ── Path A: reconnectExhausted 端到端降级 ─────────────────────────────────
  it('degrades to headless after real reconnect exhaustion (path A)', { timeout: 30_000 }, async () => {
    // WSS 回应所有 message（含 auth + 重连尝试期间的 ping）—— 初始 connect 成功的关键
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
      });
    });

    server = new GodotServer('/fake/ops.gd', { connectionMode: 'editor' });
    await server.run();
    // 先例 godot-server.test.js:220 —— 连接成功后 connectionMode='editor'
    expect(server.connectionMode).toBe('editor');

    // 模拟编辑器崩溃:terminate 现有连接 + 关 server → 后续重连 ECONNREFUSED
    // (参照 editor-connection.test.js:337-338：不 terminate 则 client 以为连着不触发 close)
    for (const client of wss.clients) client.terminate();
    await new Promise((res) => wss.close(res));

    // 3 次重连尝试 × (backoff 20~40ms + ECONNREFUSED 即时)
    await new Promise((r) => setTimeout(r, 4000));

    // 降级断言（先例 godot-server.test.js:228-229）
    expect(server.connectionMode).toBe('headless');
    expect(server.editorConn).toBeNull();
  });

  // ── Path B: 半开心跳降级接线（onStateChange → handleEditorStall）──────────
  // 注：真实半开 ping-timeout 端到端（ping 不响应 → 5s timeout × 5 → reconnecting）
  // 在 fakeTimers + 真实 ws 下不稳定（request 超时虽是 setTimeout 受控，但心跳 async 链
  // + 真实 I/O 事件不被 fake timer 推进），且生产心跳参数硬编码（heartbeatIntervalMs=15000 /
  // maxConsecutiveFailures=5 / pingTimeout=5000）不可 env 注入。降级为接线断言：
  // 直接驱动 health-monitor 进 'reconnecting'，触发 GodotServer.ts:468-473 的
  // onStateChange 回调 → handleEditorStall（此前零覆盖的真实降级接线）。
  it('degrades to headless when health-monitor enters reconnecting (path B wiring)', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
      });
    });

    server = new GodotServer('/fake/ops.gd', { connectionMode: 'editor' });
    await server.run();
    expect(server.connectionMode).toBe('editor');

    // establishEditorConnection 连接成功后 hm 复位为 'connected'（GodotServer.ts:479）
    const hm = server.dispatcher.getHealthMonitor();
    expect(hm.getState()).toBe('connected');

    // 模拟心跳检测到卡死：hm 进 'reconnecting' → onStateChange(:468) → handleEditorStall(:471)
    hm.setState('reconnecting');
    // onStateChange listener 同步触发 handleEditorStall；flush 兜底异步 listener
    await new Promise((r) => setTimeout(r, 50));

    expect(server.connectionMode).toBe('headless');
    expect(server.editorConn).toBeNull();
  });
});
