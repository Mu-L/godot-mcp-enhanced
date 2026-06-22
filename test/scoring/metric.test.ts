import { describe, it, expect } from 'vitest';
import { round1, dimMetric } from '../../src/scoring/metric.js';
import type { DimensionResult } from '../../src/scoring/types.js';

function dim(score: number, status: DimensionResult['status'], raw?: Record<string, number>): DimensionResult {
  return { score, weight: 0.1, status, raw };
}

describe('metric', () => {
  it('round1 保留一位小数', () => {
    expect(round1(70.154)).toBe(70.2);
    expect(round1(70)).toBe(70);
  });

  it('dimMetric integration → ran/passed', () => {
    expect(dimMetric('integration', dim(90, 'pass', { passed: 44, ran: 45 }))).toBe('44/45 passed');
  });

  it('dimMetric coverage → pct(round1) + hit/found', () => {
    expect(dimMetric('coverage', dim(70.2, 'pass', { hit: 7945, found: 11325, pct: 70.154 }))).toBe('70.2% (7945/11325)');
  });

  it('dimMetric security → high+critical / deduction', () => {
    expect(dimMetric('security', dim(80, 'pass', { high: 2, critical: 0, deduction: 20 }))).toBe('2 high/critical (-20)');
  });

  it('dimMetric gdscript → err/warn', () => {
    expect(dimMetric('gdscript', dim(90, 'pass', { errors: 0, warnings: 5 }))).toBe('0 err / 5 warn');
  });

  it('dimMetric flaky/performance → —(无 case)', () => {
    expect(dimMetric('flaky', dim(-1, 'na'))).toBe('未接入');
    expect(dimMetric('performance', dim(80, 'pass', { x: 1 }))).toBe('—');
  });

  it('dimMetric na 维(score=-1 或 status=na)→ 未接入', () => {
    expect(dimMetric('coverage', dim(-1, 'na'))).toBe('未接入');
  });

  it('dimMetric raw 缺失 → —', () => {
    expect(dimMetric('security', dim(80, 'pass'))).toBe('—');
  });
});
