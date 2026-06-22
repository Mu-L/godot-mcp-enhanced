import { describe, it, expect } from 'vitest';
import { WEIGHTS, HARD_FAILOUTS, PASS_LINE, NA_SCORE } from '../../src/scoring/dimensions.js';

describe('dimensions config', () => {
  it('6 维权重之和 = 1', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 1000) / 1000).toBe(1);
  });

  it('pass 线 = 75', () => {
    expect(PASS_LINE).toBe(75);
  });

  it('硬否决覆盖 security(60)/ integration(80)/ gdscript(60)', () => {
    expect(HARD_FAILOUTS.security).toBe(60);
    expect(HARD_FAILOUTS.integration).toBe(80);
    expect(HARD_FAILOUTS.gdscript).toBe(60);
  });

  it('NA_SCORE = -1(表示未采集)', () => {
    expect(NA_SCORE).toBe(-1);
  });
});
