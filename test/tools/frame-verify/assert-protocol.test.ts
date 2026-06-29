import { describe, it, expect } from 'vitest';
import { parseAsserts } from '../../../src/tools/frame-verify/assert-protocol.js';

describe('parseAsserts', () => {
  it('counts PASS and FAIL lines', () => {
    const stdout = 'some log\nASSERT PASS: player moving\nASSERT FAIL: speed too low: 3.2\nASSERT PASS: hp full\n';
    const r = parseAsserts(stdout);
    expect(r.passCount).toBe(2);
    expect(r.failCount).toBe(1);
    expect(r.fails).toEqual(['speed too low: 3.2']);
    expect(r.passed).toBe(false);
  });

  it('passed when only PASS lines and no FAIL', () => {
    const r = parseAsserts('ASSERT PASS: a\nASSERT PASS: b\n');
    expect(r.passed).toBe(true);
    expect(r.passCount).toBe(2);
    expect(r.failCount).toBe(0);
  });

  it('not passed when no ASSERT lines at all (no evidence)', () => {
    const r = parseAsserts('just some output, no asserts');
    expect(r.passCount).toBe(0);
    expect(r.failCount).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('captures full FAIL description after the prefix', () => {
    const r = parseAsserts('ASSERT FAIL: pos=(1,2) vel=(0,0) expected moving\n');
    expect(r.fails).toEqual(['pos=(1,2) vel=(0,0) expected moving']);
  });

  it('handles CRLF line endings', () => {
    const r = parseAsserts('ASSERT PASS: ok\r\nASSERT FAIL: bad\r\n');
    expect(r.passCount).toBe(1);
    expect(r.failCount).toBe(1);
  });
});
