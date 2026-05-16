import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_NAMES,
  getToolDefinitions,
  genSignalConnectScript,
  genSignalDisconnectScript,
  genSignalEmitScript,
  genSignalListScript,
} from '../build/tools/signal-ops.js';

// ─── TOOL_NAMES ─────────────────────────────────────────────────────────────

describe('TOOL_NAMES', () => {
  it('contains exactly 4 signal tool names', () => {
    assert.strictEqual(TOOL_NAMES.length, 4);
  });
  it('includes signal_connect', () => {
    assert.ok(TOOL_NAMES.includes('signal_connect'));
  });
  it('includes signal_disconnect', () => {
    assert.ok(TOOL_NAMES.includes('signal_disconnect'));
  });
  it('includes signal_emit', () => {
    assert.ok(TOOL_NAMES.includes('signal_emit'));
  });
  it('includes signal_list', () => {
    assert.ok(TOOL_NAMES.includes('signal_list'));
  });
});

// ─── genSignalConnectScript ─────────────────────────────────────────────────

describe('genSignalConnectScript', () => {
  it('generates GDScript with connect call', () => {
    const script = genSignalConnectScript('/root/Player', 'hit', '/root/UI', 'on_hit');
    assert.ok(script.includes('source.connect("hit"'));
    assert.ok(script.includes('Callable(target, "on_hit")'));
    assert.ok(script.includes('_mcp_get_node'));
  });
  it('includes flags when provided', () => {
    const script = genSignalConnectScript('/root/A', 'sig', '/root/B', 'fn', 4);
    assert.ok(script.includes('4)'));
  });
});

// ─── genSignalDisconnectScript ──────────────────────────────────────────────

describe('genSignalDisconnectScript', () => {
  it('generates GDScript with disconnect call', () => {
    const script = genSignalDisconnectScript('/root/Player', 'hit', '/root/UI', 'on_hit');
    assert.ok(script.includes('source.disconnect("hit"'));
    assert.ok(script.includes('Callable(target, "on_hit")'));
    assert.ok(script.includes('_mcp_output("disconnected"'));
  });
});

// ─── genSignalEmitScript ───────────────────────────────────────────────────

describe('genSignalEmitScript', () => {
  it('generates GDScript with emit_signal call (no args)', () => {
    const script = genSignalEmitScript('/root/Player', 'died');
    assert.ok(script.includes('source.emit_signal("died")'));
    assert.ok(script.includes('_mcp_output("emitted"'));
  });
  it('serializes string args', () => {
    const script = genSignalEmitScript('/root/Player', 'msg', ['hello']);
    assert.ok(script.includes('"hello"'));
  });
  it('serializes number args', () => {
    const script = genSignalEmitScript('/root/Player', 'damage', [42]);
    assert.ok(script.includes('42'));
  });
  it('serializes boolean args', () => {
    const script = genSignalEmitScript('/root/Player', 'toggle', [true]);
    assert.ok(script.includes('true'));
  });
  it('serializes null args', () => {
    const script = genSignalEmitScript('/root/Player', 'reset', [null]);
    assert.ok(script.includes('null'));
  });
  it('throws on unsupported arg types', () => {
    assert.throws(() => genSignalEmitScript('/root/A', 'sig', [{}]), /basic types/);
  });
});

// ─── genSignalListScript ───────────────────────────────────────────────────

describe('genSignalListScript', () => {
  it('generates GDScript with get_signal_list call', () => {
    const script = genSignalListScript('/root/Player');
    assert.ok(script.includes('node.get_signal_list()'));
    assert.ok(script.includes('_mcp_output("signals"'));
    assert.ok(script.includes('_mcp_get_node'));
  });
});

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('getToolDefinitions', () => {
  it('returns 4 tool definitions', () => {
    const defs = getToolDefinitions();
    assert.strictEqual(defs.length, 4);
  });
  it('each definition has a name from TOOL_NAMES', () => {
    const defs = getToolDefinitions();
    const names = defs.map(d => d.name);
    for (const tn of TOOL_NAMES) {
      assert.ok(names.includes(tn), `missing tool definition for ${tn}`);
    }
  });
  it('each definition has inputSchema with required fields', () => {
    const defs = getToolDefinitions();
    for (const def of defs) {
      assert.ok(def.inputSchema, `${def.name} missing inputSchema`);
      assert.ok(def.inputSchema.required, `${def.name} missing required fields`);
    }
  });
});
