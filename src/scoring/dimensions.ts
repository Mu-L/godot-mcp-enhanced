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
  gdscript: 60,
};

/** 总分 pass 线 */
export const PASS_LINE = 75;

/** 未采集哨兵值 */
export const NA_SCORE = -1;

/** 维度渲染顺序(所有渲染器共用,避免 report/pr-comment 双真相源) */
export const DIM_ORDER: DimensionName[] = ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript'];

/** warnings 渐进扣分系数(初始占位 2,Task 7 基线校准) */
export const WARN_PENALTY = 2;

/**
 * performance 绝对阈值,Task 5 本地基线校准(ADVISORY 1 规则 round(W×1.5)/round(W×3))。
 * W = 42685 ms(coverage/test-report.json wall-clock = max(endTime) - min(startTime))。
 *
 * 本地 ≠ CI runner 性能:CI 首跑后读 coverage/test-report.json 的 W_ci,若与本地差异大,
 * 按 round(W_ci×1.5)/round(W_ci×3) 重算回填(CI 校准 follow-up)。
 */
export const T_PASS_MS = 64028;   // round(42685 × 1.5)
export const T_WARN_MS = 128055;  // round(42685 × 3)
