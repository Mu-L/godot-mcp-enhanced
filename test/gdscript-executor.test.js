import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test marker parsing logic inline (parseMcpMarkers is not exported)
const MARKER_RESULT = '___MCP_RESULT___';
const MARKER_ERROR = '___MCP_ERROR___';

function parseMcpMarkers(raw) {
  const lines = raw.split('\n');
  const logLines = [];
  let parsed = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(MARKER_RESULT)) {
      try { parsed = JSON.parse(trimmed.substring(MARKER_RESULT.length)); }
      catch { parsed = { success: false, error: 'Failed to parse result JSON' }; }
    } else if (trimmed.startsWith(MARKER_ERROR)) {
      try { parsed = JSON.parse(trimmed.substring(MARKER_ERROR.length)); }
      catch { parsed = { success: false, error: 'Failed to parse error JSON' }; }
    } else {
      logLines.push(trimmed);
    }
  }

  return { parsed, logLines };
}

describe('parseMcpMarkers', () => {
  it('parses result marker with outputs', () => {
    const raw = `Hello world
${MARKER_RESULT}{"success":true,"outputs":[{"key":"x","value":"42"}]}`;
    const { parsed, logLines } = parseMcpMarkers(raw);
    assert.deepStrictEqual(parsed, { success: true, outputs: [{ key: 'x', value: '42' }] });
    assert.deepStrictEqual(logLines, ['Hello world']);
  });

  it('parses error marker', () => {
    const raw = `${MARKER_ERROR}{"success":false,"error":"compile failed"}`;
    const { parsed } = parseMcpMarkers(raw);
    assert.deepStrictEqual(parsed, { success: false, error: 'compile failed' });
  });

  it('returns null when no marker found', () => {
    const raw = 'Just some output\nNo markers here';
    const { parsed, logLines } = parseMcpMarkers(raw);
    assert.strictEqual(parsed, null);
    assert.strictEqual(logLines.length, 2);
  });

  it('handles malformed JSON in marker', () => {
    const raw = `${MARKER_RESULT}{broken json}`;
    const { parsed } = parseMcpMarkers(raw);
    assert.strictEqual(parsed.success, false);
  });
});

describe('wrapSnippet code detection', () => {
  it('detects full class with extends', () => {
    const code = 'extends SceneTree\n\nfunc _initialize():\n\tprint("hi")';
    assert.ok(/^\s*extends\s+/m.test(code));
  });

  it('snippet without extends is not full class', () => {
    const code = 'var x = 1\nprint(x)';
    assert.ok(!/^\s*extends\s+/m.test(code));
  });
});
