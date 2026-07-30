import { expect } from 'vitest';
import {
  getToolDefinitions,
  TOOL_META,
  genSignalConnectScript,
  genSignalDisconnectScript,
  genSignalEmitScript,
  genSignalListScript,
} from '../src/tools/signal-ops.js';

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('signal-ops getToolDefinitions', () => {
  it('returns 1 merged tool definition', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
  });
  it('tool is named "signal"', () => {
    const defs = getToolDefinitions();
    expect(defs[0].name).toBe('signal');
  });
  it('action enum contains all 4 actions', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('signal_connect');
    expect(actionEnum).toContain('signal_disconnect');
    expect(actionEnum).toContain('signal_emit');
    expect(actionEnum).toContain('signal_list');
  });
  it('definition has inputSchema with required fields', () => {
    const defs = getToolDefinitions();
    expect(defs[0].inputSchema).toBeTruthy();
    expect(defs[0].inputSchema.required).toContain('action');
  });
});

// ─── TOOL_META ──────────────────────────────────────────────────────────────

describe('signal-ops TOOL_META', () => {
  it('has exactly 1 entry for "signal"', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
    expect(TOOL_META.signal).toBeDefined();
  });
  it('signal is non-readonly and non-long-running', () => {
    expect(TOOL_META.signal.readonly).toBe(false);
    expect(TOOL_META.signal.long_running).toBe(false);
  });
});

// ─── genSignalConnectScript ─────────────────────────────────────────────────

describe('genSignalConnectScript', () => {
  it('generates GDScript with connect call', () => {
    const script = genSignalConnectScript('/root/Player', 'hit', '/root/UI', 'on_hit');
    expect(script).toContain('source.connect("hit"');
    expect(script).toContain('Callable(target, "on_hit")');
    expect(script).toContain('_mcp_get_node');
  });
  it('includes flags when provided', () => {
    const script = genSignalConnectScript('/root/A', 'sig', '/root/B', 'fn', 4);
    expect(script).toContain('4)');
  });
});

// ─── genSignalDisconnectScript ──────────────────────────────────────────────

describe('genSignalDisconnectScript', () => {
  it('generates GDScript with disconnect call', () => {
    const script = genSignalDisconnectScript('/root/Player', 'hit', '/root/UI', 'on_hit');
    expect(script).toContain('source.disconnect("hit"');
    expect(script).toContain('Callable(target, "on_hit")');
    expect(script).toContain('_mcp_output("disconnected"');
  });
});

// ─── genSignalEmitScript ───────────────────────────────────────────────────

describe('genSignalEmitScript', () => {
  it('generates GDScript with emit_signal call (no args)', () => {
    const script = genSignalEmitScript('/root/Player', 'died');
    expect(script).toContain('source.emit_signal("died")');
    expect(script).toContain('_mcp_output("emitted"');
  });
  it('serializes string args', () => {
    const script = genSignalEmitScript('/root/Player', 'msg', ['hello']);
    expect(script).toContain('"hello"');
  });
  it('serializes number args', () => {
    const script = genSignalEmitScript('/root/Player', 'damage', [42]);
    expect(script).toContain('42');
  });
  it('serializes boolean args', () => {
    const script = genSignalEmitScript('/root/Player', 'toggle', [true]);
    expect(script).toContain('source.emit_signal("toggle", true)');
  });
  it('serializes null args', () => {
    const script = genSignalEmitScript('/root/Player', 'reset', [null]);
    expect(script).toContain('source.emit_signal("reset", null)');
  });
  it('throws on unsupported arg types', () => {
    expect(() => genSignalEmitScript('/root/A', 'sig', [{}])).toThrow(/basic types/);
  });
});

// ─── genSignalListScript ───────────────────────────────────────────────────

describe('genSignalListScript', () => {
  it('generates GDScript with get_signal_list call', () => {
    const script = genSignalListScript('/root/Player');
    expect(script).toContain('node.get_signal_list()');
    expect(script).toContain('_mcp_output("signals"');
    expect(script).toContain('_mcp_get_node');
  });
});
