import { expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { EditorToolExecutor } from '../src/core/EditorToolExecutor.js';
import { registerTools, clearRegistry } from '../src/core/tool-registry.js';
import { WebSocketServer } from 'ws';
import { EditorConnection } from '../src/core/EditorConnection.js';

describe('EditorToolExecutor existing tests (real WS)', () => {
  let wss;
  let port;

  beforeEach(() => {
    clearRegistry();
    registerTools([
      { name: 'add_node', readonly: false, long_running: false },
      { name: 'edit_node', readonly: false, long_running: false },
      { name: 'query_scene_tree', readonly: true, long_running: false },
      { name: 'editor_get_scene_tree', readonly: true, long_running: false },
    ]);
    wss = new WebSocketServer({ port: 0 });
    port = wss.address().port;
  });

  afterEach(() => {
    wss.close();
    clearRegistry();
  });

  it('forwards tool call as JSON-RPC and returns result', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { node_path: 'root/Player' } }));
      });
    });
    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    const executor = new EditorToolExecutor(conn);
    const result = await executor.execute('add_node', {
      project_path: '/test', scene_path: 'res://main.tscn',
      node_type: 'Sprite2D', node_name: 'Player',
    });
    expect(JSON.parse(result.content[0].text)).toEqual({ node_path: 'root/Player' });
    conn.disconnect();
  });

  it('handles JSON-RPC error from plugin', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        } else {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: 'Node not found' } }));
        }
      });
    });
    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    const executor = new EditorToolExecutor(conn);
    const result = await executor.execute('edit_node', { node_path: 'root/Missing' });
    expect(result.isError).toBe(true);
    conn.disconnect();
  });

  it('forwards write operation args as-is to plugin', async () => {
    let capturedParams = null;
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        } else {
          capturedParams = msg.params;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
        }
      });
    });
    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    const executor = new EditorToolExecutor(conn);
    await executor.execute('add_node', { project_path: '/test', node_type: 'Sprite2D', node_name: 'Player' });
    expect(capturedParams).toBeDefined();
    expect(capturedParams.project_path).toBe('/test');
    expect(capturedParams.node_type).toBe('Sprite2D');
    conn.disconnect();
  });

  it('forwards read-only operation args as-is to plugin', async () => {
    let capturedParams = null;
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        } else {
          capturedParams = msg.params;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
        }
      });
    });
    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    const executor = new EditorToolExecutor(conn);
    await executor.execute('query_scene_tree', { project_path: '/test', scene_path: 'res://main.tscn' });
    expect(capturedParams).toBeDefined();
    expect(capturedParams.scene_path).toBe('res://main.tscn');
    conn.disconnect();
  });

  it('forwards unknown tool args as-is to plugin', async () => {
    let capturedParams = null;
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'auth') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { status: 'ok' } }));
        } else {
          capturedParams = msg.params;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
        }
      });
    });
    const conn = new EditorConnection({ port, reconnect: false, secret: 'test-secret' });
    await conn.connect();
    const executor = new EditorToolExecutor(conn);
    await executor.execute('some_unknown_tool', { project_path: '/test' });
    expect(capturedParams).toBeDefined();
    expect(capturedParams.project_path).toBe('/test');
    conn.disconnect();
  });
});

// ─── Mock-based tests for sync/buffer/destroy logic ──────────────────────────

describe('EditorToolExecutor sync lifecycle (mocked conn)', () => {
  let mockConn;
  let executor;

  beforeEach(() => {
    clearRegistry();
    registerTools([
      { name: 'add_node', readonly: false, long_running: false },
    ]);
    mockConn = {
      request: vi.fn().mockResolvedValue({ status: 'ok' }),
      onNotification: vi.fn(),
      offNotification: vi.fn(),
      addOnDisconnectHandler: vi.fn(),
      addOnReconnectHandler: vi.fn(),
      removeOnDisconnectHandler: vi.fn(),
      removeOnReconnectHandler: vi.fn(),
    };
    executor = new EditorToolExecutor(mockConn);
  });

  afterEach(() => {
    clearRegistry();
  });

  // editor-method-map：(asset, create/path/batch/undo/save) → asset_* 扁平 method；
  // list_shapes 无映射 → fallback 工具名 'asset'；create 顶层 transform 并入 params。
  it('maps (asset, create) to asset_create and merges transform into params', async () => {
    await executor.execute('asset', { action: 'create', shape: 'box', position: [1, 2, 3], params: { size: [1, 1, 1] } });
    expect(mockConn.request).toHaveBeenCalledWith('asset_create', expect.objectContaining({
      params: expect.objectContaining({ size: [1, 1, 1], position: [1, 2, 3] }),
    }));
  });

  it('maps (asset, save) to asset_save method', async () => {
    await executor.execute('asset', { action: 'save', resource_path: 'res://x.tscn', node_path: '/root/M' });
    expect(mockConn.request).toHaveBeenCalledWith('asset_save', expect.objectContaining({ resource_path: 'res://x.tscn' }));
  });

  it('falls back to tool name when action has no mapping (list_shapes)', async () => {
    await executor.execute('asset', { action: 'list_shapes' });
    expect(mockConn.request).toHaveBeenCalledWith('asset', expect.objectContaining({ action: 'list_shapes' }));
  });

  it('does not override shape params when merging transform (params.position wins)', async () => {
    await executor.execute('asset', { action: 'create', shape: 'box', position: [9, 9, 9], params: { position: [1, 2, 3] } });
    expect(mockConn.request).toHaveBeenCalledWith('asset_create', expect.objectContaining({
      params: expect.objectContaining({ position: [1, 2, 3] }),
    }));
  });

  it('sync_start registers notification handler and sets active', async () => {
    const result = await executor.execute('editor', { action: 'sync_start' });
    expect(mockConn.onNotification).toHaveBeenCalledWith('scene_tree_changed', expect.any(Function));
    expect(result.isError).toBeFalsy();
  });

  it('duplicate sync_start returns SYNC_ALREADY_ACTIVE', async () => {
    await executor.execute('editor', { action: 'sync_start' });
    const result = await executor.execute('editor', { action: 'sync_start' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('SYNC_ALREADY_ACTIVE');
  });

  it('sync_stop without start returns SYNC_NOT_ACTIVE', async () => {
    const result = await executor.execute('editor', { action: 'sync_stop' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('SYNC_NOT_ACTIVE');
  });

  it('sync_stop returns buffered changes', async () => {
    await executor.execute('editor', { action: 'sync_start' });
    // Simulate tree changes by invoking the registered handler
    const handler = mockConn.onNotification.mock.calls[0][1];
    handler({ type: 'node_added', path: 'root/A', node_type: 'Node' });
    handler({ type: 'node_removed', path: 'root/B', node_type: 'Sprite2D' });

    const result = await executor.execute('editor', { action: 'sync_stop' });
    expect(mockConn.offNotification).toHaveBeenCalledWith('scene_tree_changed', expect.any(Function));
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.buffered_changes).toHaveLength(2);
    expect(parsed.buffered_changes[0].type).toBe('node_added');
    expect(parsed.buffered_changes[1].type).toBe('node_removed');
  });

  it('sync_stop with empty buffer returns empty changes', async () => {
    await executor.execute('editor', { action: 'sync_start' });
    const result = await executor.execute('editor', { action: 'sync_stop' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.buffered_changes).toHaveLength(0);
  });

  it('sync_start failure removes notification handler', async () => {
    mockConn.request.mockRejectedValueOnce(new Error('Plugin error'));
    const result = await executor.execute('editor', { action: 'sync_start' });
    expect(result.isError).toBe(true);
    expect(mockConn.offNotification).toHaveBeenCalledWith('scene_tree_changed', expect.any(Function));
    // Should not be active after failure
    const stopResult = await executor.execute('editor', { action: 'sync_stop' });
    expect(stopResult.isError).toBe(true);
  });

  it('sync_stop failure still returns buffered changes', async () => {
    await executor.execute('editor', { action: 'sync_start' });
    const handler = mockConn.onNotification.mock.calls[0][1];
    handler({ type: 'node_added', path: 'root/X', node_type: 'Node' });

    mockConn.request.mockRejectedValueOnce(new Error('Stop failed'));
    const result = await executor.execute('editor', { action: 'sync_stop' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.buffered_changes).toHaveLength(1);
    // G2 PII 护栏: warning 用 classifyError 的 safeMessage(原生 Error → 'Internal error'),
    // 不外泄 err.message;本测试核心是 buffered_changes 仍返回(上行断言)。
    expect(parsed.warning).toBe('Internal error');
  });
});

describe('EditorToolExecutor treeChangeRing (mocked conn)', () => {
  let mockConn;
  let executor;

  beforeEach(() => {
    clearRegistry();
    registerTools([
      { name: 'add_node', readonly: false, long_running: false },
    ]);
    mockConn = {
      request: vi.fn().mockResolvedValue({ status: 'ok' }),
      onNotification: vi.fn(),
      offNotification: vi.fn(),
      addOnDisconnectHandler: vi.fn(),
      addOnReconnectHandler: vi.fn(),
      removeOnDisconnectHandler: vi.fn(),
      removeOnReconnectHandler: vi.fn(),
    };
    executor = new EditorToolExecutor(mockConn);
  });

  afterEach(() => { clearRegistry(); });

  it('ignores tree changes with missing type', async () => {
    await executor.execute('editor', { action: 'sync_start' });
    const handler = mockConn.onNotification.mock.calls[0][1];
    handler({ path: 'root/A' }); // missing type
    handler(null); // null
    handler(42); // not object
    handler({ type: 'node_added', path: 'root/C', node_type: 'Node' }); // valid

    const result = await executor.execute('editor', { action: 'sync_stop' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.buffered_changes).toHaveLength(1);
  });

  it('disconnect handler clears ring buffer but preserves syncActive (D3)', async () => {
    // security P1#2 串行化后 sync_start 必先完成, syncActive=true 确定设置.
    await executor.execute('editor', { action: 'sync_start' });
    // Buffer a tree change into ring
    const handler = mockConn.onNotification.mock.calls[0][1];
    handler({ type: 'node_added', path: 'root/A', node_type: 'Node' });
    // Disconnect: D3 设计为清 ring buffer 但保留 syncActive (保留用户 sync 意图供重连 re-subscribe;
    // 清 syncActive 会致 handleSyncStop 误报 SYNC_NOT_ACTIVE).
    const disconnectHandler = mockConn.addOnDisconnectHandler.mock.calls[0][0];
    disconnectHandler();
    // sync_stop 正常返回 (syncActive 保留 → 非 NOT_ACTIVE), buffered_changes 空 (ring 被 disconnect 清)
    const result = await executor.execute('editor', { action: 'sync_stop' });
    const parsed = JSON.parse(result.content[0].text);
    expect(result.isError).toBeFalsy();
    expect(parsed.buffered_changes).toHaveLength(0);
  });

  it('reconnect handler re-registers notification if sync was active', async () => {
    await executor.execute('editor', { action: 'sync_start' });
    mockConn.onNotification.mockClear();

    const reconnectHandler = mockConn.addOnReconnectHandler.mock.calls[0][0];
    reconnectHandler();

    expect(mockConn.onNotification).toHaveBeenCalledWith('scene_tree_changed', expect.any(Function));
  });

  it('reconnect handler does not register if sync was not active', () => {
    mockConn.onNotification.mockClear();
    const reconnectHandler = mockConn.addOnReconnectHandler.mock.calls[0][0];
    reconnectHandler();
    expect(mockConn.onNotification).not.toHaveBeenCalled();
  });
});

describe('EditorToolExecutor execute branches (mocked conn)', () => {
  let mockConn;
  let executor;

  beforeEach(() => {
    clearRegistry();
    registerTools([
      { name: 'add_node', readonly: false, long_running: false },
    ]);
    mockConn = {
      request: vi.fn().mockResolvedValue({ nodes: [], root: 'Node3D' }),
      onNotification: vi.fn(),
      offNotification: vi.fn(),
      addOnDisconnectHandler: vi.fn(),
      addOnReconnectHandler: vi.fn(),
      removeOnDisconnectHandler: vi.fn(),
      removeOnReconnectHandler: vi.fn(),
    };
    executor = new EditorToolExecutor(mockConn);
  });

  afterEach(() => { clearRegistry(); });

  it('get_scene_tree action calls editor_get_scene_tree', async () => {
    const result = await executor.execute('editor', { action: 'get_scene_tree' });
    expect(mockConn.request).toHaveBeenCalledWith('editor_get_scene_tree', { action: 'get_scene_tree' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.root).toBe('Node3D');
  });

  it('get_scene_tree error returns error result', async () => {
    mockConn.request.mockRejectedValueOnce(Object.assign(new Error('Tree error'), { code: -32001 }));
    const result = await executor.execute('editor', { action: 'get_scene_tree' });
    expect(result.isError).toBe(true);
  });

  it('destroy removes disconnect and reconnect handlers', () => {
    executor.destroy();
    expect(mockConn.removeOnDisconnectHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(mockConn.removeOnReconnectHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unknown editor action forwards to plugin', async () => {
    const result = await executor.execute('editor', { action: 'custom_action', foo: 'bar' });
    expect(mockConn.request).toHaveBeenCalledWith('editor', { action: 'custom_action', foo: 'bar' });
    expect(result.isError).toBeFalsy();
  });

  it('non-editor tool forwards args as-is to plugin for writes', async () => {
    const result = await executor.execute('add_node', { project_path: '/test' });
    expect(mockConn.request).toHaveBeenCalledWith('add_node', { project_path: '/test' });
    expect(result.isError).toBeFalsy();
  });
});

// B4: 连接类错误结构化（err.code 判定 do_not_retry，覆盖原字符串匹配漏项 Disconnected/JSON parse error）
describe('EditorToolExecutor B4 connection-error structuring (mocked conn)', () => {
  let mockConn;
  let executor;

  beforeEach(() => {
    clearRegistry();
    registerTools([
      { name: 'add_node', readonly: false, long_running: false },
      { name: 'edit_node', readonly: false, long_running: false },
    ]);
    mockConn = {
      request: vi.fn(),
      onNotification: vi.fn(),
      offNotification: vi.fn(),
      addOnDisconnectHandler: vi.fn(),
      addOnReconnectHandler: vi.fn(),
      removeOnDisconnectHandler: vi.fn(),
      removeOnReconnectHandler: vi.fn(),
    };
    executor = new EditorToolExecutor(mockConn);
  });

  afterEach(() => { clearRegistry(); });

  it('B4: do_not_retry covers Disconnected + JSON parse error via err.code', async () => {
    // Case 1: DISCONNECTED code → do_not_retry=true + editor_disconnected=true
    mockConn.request.mockRejectedValueOnce(
      Object.assign(new Error('Disconnected'), { code: 'DISCONNECTED' }),
    );
    const res = await executor.execute('editor', { action: 'add_node' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.do_not_retry).toBe(true);
    expect(payload.editor_disconnected).toBe(true);
    expect(payload.error).toBe('Disconnected');

    // Case 2: PARSE_ERROR code → do_not_retry=true（原字符串匹配漏项）
    mockConn.request.mockRejectedValueOnce(
      Object.assign(new Error('JSON parse error in editor response: Unexpected token'), { code: 'PARSE_ERROR' }),
    );
    const res2 = await executor.execute('editor', { action: 'add_node' });
    const payload2 = JSON.parse(res2.content[0].text);
    expect(payload2.do_not_retry).toBe(true);
    expect(payload2.editor_disconnected).toBe(true);
  });

  it('B4: plugin structured error (non-connection code) preserves code/data WITHOUT do_not_retry', async () => {
    // 插件返回的 JSON-RPC 结构化错误（如 -32602 NODE_NOT_FOUND）须保留 code/data，
    // 且不挂 do_not_retry（插件错误可重试，与连接断开语义不同）
    mockConn.request.mockRejectedValueOnce(
      Object.assign(new Error('NODE_NOT_FOUND'), { code: -32602, data: { path: 'x' } }),
    );
    const res = await executor.execute('editor', { action: 'edit_node' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.code).toBe(-32602);
    expect(payload.data).toEqual({ path: 'x' });
    expect(payload.do_not_retry).toBeUndefined();
    expect(payload.editor_disconnected).toBeUndefined();
  });

  it('B4: CONNECTION_LOST / NOT_CONNECTED / REQUEST_TIMEOUT all map to do_not_retry', async () => {
    // 兜底回归：5 个连接 code 都须被识别（防后续重构漏登）
    for (const code of ['CONNECTION_LOST', 'NOT_CONNECTED', 'REQUEST_TIMEOUT']) {
      mockConn.request.mockRejectedValueOnce(
        Object.assign(new Error(`msg-${code}`), { code }),
      );
      const res = await executor.execute('editor', { action: 'add_node' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.do_not_retry, `code=${code}`).toBe(true);
      expect(payload.editor_disconnected, `code=${code}`).toBe(true);
      // 连接类 code 不保留为插件 code（避免误导客户端按插件错误处理）
      expect(payload.code, `code=${code}`).toBeUndefined();
    }
  });

  it('B4: legacy string-matching still works for messages without err.code (back-compat)', () => {
    // 旧路径（无 code 的 Error）仍按 message 字符串匹配判 do_not_retry；
    // 这保护外部代码 path 未挂 code 的回归。
    return (async () => {
      mockConn.request.mockRejectedValueOnce(new Error('Connection lost'));
      const res = await executor.execute('editor', { action: 'add_node' });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.do_not_retry).toBe(true);
      expect(payload.editor_disconnected).toBe(true);
    })();
  });

  // T2-M1 (final review): 字符串兜底分支必须守 errCode===undefined，
  // 否则插件结构化错误（带 number code 如 -32602）其 message 恰含连接子串（最现实 "Disconnected"，
  // 如 "Node Disconnected from parent"）会被误判连接错误 → code/data 被吞 + 反挂 do_not_retry+editor_disconnected。
  it('T2-M1: plugin structured error with "Disconnected" substring must NOT be flagged as connection error', async () => {
    mockConn.request.mockRejectedValueOnce(
      Object.assign(new Error('Node Disconnected from parent'), { code: -32602, data: { node: 'x' } }),
    );
    const res = await executor.execute('editor', { action: 'edit_node' });
    const payload = JSON.parse(res.content[0].text);
    // 结构化 code/data 须保留
    expect(payload.code).toBe(-32602);
    expect(payload.data).toEqual({ node: 'x' });
    // 连接类反挂字段不得出现（核心：修复前会误判）
    expect(payload.do_not_retry).toBeUndefined();
    expect(payload.editor_disconnected).toBeUndefined();
  });
});