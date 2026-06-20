import { describe, it, expect } from 'vitest';
import { computeScore } from '../../src/scoring/aggregate.js';
import type { DimensionName, DimensionResult } from '../../src/scoring/types.js';
import { WEIGHTS, NA_SCORE } from '../../src/scoring/dimensions.js';

const NA: DimensionResult = { score: NA_SCORE, weight: 0, status: 'na' };

/** 构造全部 6 维,score 覆盖给定值,其余 n/a */
function only(dim: DimensionName, score: number, status: DimensionResult['status'] = 'pass'): Record<DimensionName, DimensionResult> {
  const d: Record<DimensionName, DimensionResult> = {
    integration: { ...NA, weight: WEIGHTS.integration },
    coverage: { ...NA, weight: WEIGHTS.coverage },
    security: { ...NA, weight: WEIGHTS.security },
    flaky: { ...NA, weight: WEIGHTS.flaky },
    performance: { ...NA, weight: WEIGHTS.performance },
    gdscript: { ...NA, weight: WEIGHTS.gdscript },
  };
  d[dim] = { score, weight: WEIGHTS[dim], status };
  return d;
}

describe('computeScore', () => {
  it('单一维度有值时,权重重分配使其独占 100% → total = 该维度分', () => {
    const s = computeScore(only('coverage', 80), { generatedAt: '2026-06-20T00:00:00Z' });
    expect(s.total).toBe(80);
    expect(s.unverified).not.toContain('coverage');
    expect(s.partial).toBe(true);
  });

  it('pass 线:total=75 → pass;total=74 → fail', () => {
    const ok = computeScore(only('coverage', 75), { generatedAt: 't' });
    const no = computeScore(only('coverage', 74), { generatedAt: 't' });
    expect(ok.pass).toBe(true);
    expect(no.pass).toBe(false);
  });

  it('硬否决:security=50(< 60)→ pass=false 且 hardFails 记录', () => {
    const s = computeScore(only('security', 50, 'fail'), { generatedAt: 't' });
    expect(s.pass).toBe(false);
    expect(s.hardFails).toHaveLength(1);
    expect(s.hardFails[0].dimension).toBe('security');
    expect(s.hardFails[0].actual).toBe(50);
  });

  it('硬否决:即使总分高,security 低仍 fail', () => {
    // coverage=100 + security=50,权重各 0.2(重分配后各占 0.5)→ total=75,
    // 但 security<60 触发硬否决
    const dims = only('coverage', 100);
    dims.security = { score: 50, weight: WEIGHTS.security, status: 'fail' };
    const s = computeScore(dims, { generatedAt: 't' });
    expect(s.total).toBeGreaterThanOrEqual(75);
    expect(s.pass).toBe(false);
    expect(s.hardFails.some(h => h.dimension === 'security')).toBe(true);
  });

  it('integration 硬否决线 = 80', () => {
    const s = computeScore(only('integration', 79, 'warn'), { generatedAt: 't' });
    expect(s.hardFails.some(h => h.dimension === 'integration')).toBe(true);
    expect(s.pass).toBe(false);
  });

  it('全 n/a → total=0, pass=false, unverified 全 6 维', () => {
    const dims: Record<DimensionName, DimensionResult> = {
      integration: { ...NA, weight: WEIGHTS.integration },
      coverage: { ...NA, weight: WEIGHTS.coverage },
      security: { ...NA, weight: WEIGHTS.security },
      flaky: { ...NA, weight: WEIGHTS.flaky },
      performance: { ...NA, weight: WEIGHTS.performance },
      gdscript: { ...NA, weight: WEIGHTS.gdscript },
    };
    const s = computeScore(dims, { generatedAt: 't' });
    expect(s.total).toBe(0);
    expect(s.pass).toBe(false);
    expect(s.unverified).toHaveLength(6);
  });

  it('total 保留一位小数', () => {
    // coverage=85,独占 → 85.0
    const s = computeScore(only('coverage', 85), { generatedAt: 't' });
    expect(s.total).toBe(85);
    // 非整数场景:coverage=100 + security=33,各 0.2 重分配各 0.5 → 66.5
    const dims = only('coverage', 100);
    dims.security = { score: 33, weight: WEIGHTS.security, status: 'warn' };
    const s2 = computeScore(dims, { generatedAt: 't' });
    expect(s2.total).toBe(66.5);
  });
});
