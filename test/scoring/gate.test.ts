import { describe, it, expect } from 'vitest';
import { evaluateGate } from '../../src/scoring/gate.js';
import { PASS_LINE } from '../../src/scoring/dimensions.js';
import type { ScoreJson } from '../../src/scoring/types.js';

/** 构造 ScoreJson fixture(只覆盖 gate 关心的字段) */
function makeScore(over: Partial<ScoreJson>): ScoreJson {
  return {
    total: 85.8,
    pass: true,
    partial: true,
    generatedAt: '2026-06-21T02:06:03.000Z',
    dimensions: {} as ScoreJson['dimensions'],
    unverified: [],
    hardFails: [],
    ...over,
  };
}

describe('evaluateGate', () => {
  it('total ≥ PASS_LINE 且无 hardFails → passed, 无 reason', () => {
    const r = evaluateGate(makeScore({ total: 85.8 }));
    expect(r.passed).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('total < PASS_LINE(纯总分不足)→ passed=false, reason 含 pass 线', () => {
    const r = evaluateGate(makeScore({ total: 60 }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual([`总分 60 < ${PASS_LINE}(pass 线)`]);
  });

  it('total≥线但有 hardFails(纯硬否决)→ passed=false, reason 含维度', () => {
    const r = evaluateGate(makeScore({
      total: 90,
      hardFails: [{ dimension: 'security', reason: '低于硬否决线', threshold: 60, actual: 40 }],
    }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual(['硬否决 security: 低于硬否决线(40 < 60)']);
  });

  it('total<线 + hardFails(两者皆有)→ 两条 reason', () => {
    const r = evaluateGate(makeScore({
      total: 50,
      hardFails: [{ dimension: 'integration', reason: '低于硬否决线', threshold: 80, actual: 70 }],
    }));
    expect(r.passed).toBe(false);
    expect(r.reasons).toEqual([
      `总分 50 < ${PASS_LINE}(pass 线)`,
      '硬否决 integration: 低于硬否决线(70 < 80)',
    ]);
  });

  it('partial(unverified 非空)不影响 passed', () => {
    const r = evaluateGate(makeScore({
      total: 85.8,
      unverified: ['flaky', 'performance', 'gdscript'],
    }));
    expect(r.passed).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('evaluateGate.passed 与 score.pass 字段语义一致(防 aggregate.pass / evaluateGate 双真相源漂移)', () => {
    // aggregate.pass = (total≥PASS_LINE && hardFails 空);evaluateGate.passed 同语义
    expect(evaluateGate(makeScore({ total: 85.8, pass: true })).passed).toBe(true);
    expect(evaluateGate(makeScore({ total: 50, pass: false })).passed).toBe(false);
    expect(evaluateGate(makeScore({
      total: 90, pass: false,
      hardFails: [{ dimension: 'security', reason: 'r', threshold: 60, actual: 40 }],
    })).passed).toBe(false);
  });
});
