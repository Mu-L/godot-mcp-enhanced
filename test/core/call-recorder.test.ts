import { describe, it, expect, beforeEach } from 'vitest';
import { getCallRecorder, extractErrorMessage } from '../../src/core/call-recorder.js';
import type { ToolResult } from '../../src/types.js';

describe('CallRecorder', () => {
  beforeEach(() => getCallRecorder().reset());

  it('singleton returns same instance', () => {
    expect(getCallRecorder()).toBe(getCallRecorder());
  });

  it('record accumulates totals', () => {
    const r = getCallRecorder();
    r.record('add_node', true, 10);
    r.record('add_node', true, 20);
    r.record('edit_script', false, 30, 'TOOL_ERROR', 'parse error');
    const stats = r.getStats();
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(2);
    expect(stats.fail).toBe(1);
  });

  it('topTools sorted by count desc', () => {
    const r = getCallRecorder();
    r.record('a', true, 1);
    r.record('b', true, 1); r.record('b', true, 1);
    r.record('c', true, 1); r.record('c', true, 1); r.record('c', false, 1, 'E');
    const { topTools } = r.getStats();
    expect(topTools[0]).toEqual({ name: 'c', n: 3, fail: 1 });
    expect(topTools[1]).toEqual({ name: 'b', n: 2, fail: 0 });
  });

  it('recentErrors only captures failures', () => {
    const r = getCallRecorder();
    r.record('a', true, 1);
    r.record('b', false, 2, 'TOOL_ERROR', 'boom');
    const { recentErrors } = r.getStats();
    expect(recentErrors).toHaveLength(1);
    expect(recentErrors[0]).toMatchObject({ tool: 'b', type: 'TOOL_ERROR', msg: 'boom', ms: 2 });
  });

  it('getRecent returns last n records', () => {
    const r = getCallRecorder();
    for (let i = 0; i < 60; i++) r.record(`t${i}`, true, i);
    const recent = r.getRecent(5);
    expect(recent).toHaveLength(5);
    expect(recent[4].tool).toBe('t59');
  });

  it('reset clears all', () => {
    const r = getCallRecorder();
    r.record('a', true, 1);
    r.reset();
    expect(r.getStats().total).toBe(0);
    expect(r.getRecent(10)).toHaveLength(0);
  });
});

describe('extractErrorMessage', () => {
  it('extracts first text content truncated to 200', () => {
    const long = 'x'.repeat(300);
    const result: ToolResult = { content: [{ type: 'text', text: long }] } as ToolResult;
    expect(extractErrorMessage(result)).toHaveLength(200);
  });

  it('returns empty when no text content', () => {
    const result: ToolResult = { content: [] } as ToolResult;
    expect(extractErrorMessage(result)).toBe('');
  });
});
