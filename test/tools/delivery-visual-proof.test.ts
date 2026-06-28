import { describe, it, expect } from 'vitest';
import { parseAsserts } from '../../src/tools/frame-verify/assert-protocol.js';

// visual_proof 维度的核心是 ASSERT 协议聚合 —— 直接测 parseAsserts 的聚合语义。
// 此契约锁定 verify_delivery 的 visual_proof 维度如何消费 parseAsserts 输出。
describe('verify_delivery visual_proof ASSERT 聚合', () => {
  it('clean stdout with PASS → assert_summary.passed true → visual_proof passed', () => {
    const s = parseAsserts('ASSERT PASS: player moving\nASSERT PASS: hp ok\n');
    expect(s.passed).toBe(true);
    expect(s.failCount).toBe(0);
    expect(s.passCount).toBe(2);
  });

  it('any ASSERT FAIL → visual_proof not passed', () => {
    const s = parseAsserts('ASSERT PASS: a\nASSERT FAIL: b\n');
    expect(s.passed).toBe(false);
    expect(s.fails).toContain('b');
  });

  it('no ASSERT evidence → not passed (no proof)', () => {
    const s = parseAsserts('random log lines\n');
    expect(s.passed).toBe(false);
    expect(s.passCount).toBe(0);
    expect(s.failCount).toBe(0);
  });

  it('multiple FAIL → all captured in fails[]', () => {
    const s = parseAsserts('ASSERT FAIL: x\nASSERT FAIL: y\n');
    expect(s.passed).toBe(false);
    expect(s.failCount).toBe(2);
    expect(s.fails).toEqual(['x', 'y']);
  });
});
