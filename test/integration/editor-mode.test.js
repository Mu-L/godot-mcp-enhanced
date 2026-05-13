import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { EditorConnection } from '../../build/core/EditorConnection.js';
import { EditorToolExecutor } from '../../build/core/EditorToolExecutor.js';
import { ReadOnlyGuard } from '../../build/core/ReadOnlyGuard.js';
import { registerTools } from '../../build/core/tool-registry.js';

describe('Editor mode integration', () => {
  let wss;
  let port;

  beforeEach(() => {
    registerTools([
      { name: 'read_scene', readonly: true, long_running: false },
      { name: 'add_node', readonly: false, long_running: false },
    ]);
    wss = new WebSocketServer({ port: 0 });
    port = wss.address().port;
  });

  afterEach(() => { wss.close(); });

  it('full flow: connect, call tool, guard readonly, disconnect', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { node_path: 'root/Player' } }));
      });
    });

    const conn = new EditorConnection({ port, reconnect: false });
    await conn.connect();
    assert.ok(conn.isConnected());

    const executor = new EditorToolExecutor(conn);
    const result = await executor.execute('add_node', { project_path: '/test', node_type: 'Sprite2D', node_name: 'Player' });
    assert.ok(!result.isError);

    const guard = new ReadOnlyGuard(true);
    assert.equal(guard.check('add_node').blocked, true);
    assert.equal(guard.check('read_scene').blocked, false);

    conn.disconnect();
    assert.ok(!conn.isConnected());
  });

  it('handles concurrent requests with unique IDs', async () => {
    const received = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        received.push(msg.id);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
      });
    });

    const conn = new EditorConnection({ port, reconnect: false });
    await conn.connect();
    const executor = new EditorToolExecutor(conn);
    const results = await Promise.all([
      executor.execute('read_scene', {}),
      executor.execute('add_node', {}),
    ]);
    assert.equal(results.length, 2);
    assert.equal(new Set(received).size, 2);
    conn.disconnect();
  });
});
