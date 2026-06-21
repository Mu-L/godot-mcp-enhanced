import type { DimensionName } from './types.js';

/** 维度权重,加总 = 1。改动须同步更新 test/scoring/dimensions.test.ts */
export const WEIGHTS: Record<DimensionName, number> = {
  integration: 0.30,
  coverage: 0.20,
  security: 0.20,
  flaky: 0.10,
  performance: 0.10,
  gdscript: 0.10,
};

/** 硬否决线:维度低于此值直接 fail,不看总分 */
export const HARD_FAILOUTS: Partial<Record<DimensionName, number>> = {
  security: 60,
  integration: 80,
};

/** 总分 pass 线 */
export const PASS_LINE = 75;

/** 未采集哨兵值 */
export const NA_SCORE = -1;

/** 维度渲染顺序(所有渲染器共用,避免 report/pr-comment 双真相源) */
export const DIM_ORDER: DimensionName[] = ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript'];
