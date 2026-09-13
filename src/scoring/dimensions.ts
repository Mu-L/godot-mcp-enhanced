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
 * performance 绝对阈值,ADVISORY 1 规则 round(W×1.5)/round(W×3)。
 * 二次校准(2026-09-13,CI 校准 follow-up 兑现):初版 W=42685ms 为 0.32.11 时代
 * 本地基线(171 文件/2849 测试);P0-P10 批后体量翻倍(436 文件/6392 测试 + L2 e2e
 * 全家桶),CI 实测 W_ci=130131ms(--maxWorkers=2 受限口径,score.json performance.raw)
 * 超旧 T_WARN 致维度 fail——按预留的 CI 回填路径换 W_ci 口径,本地实测 73510ms
 * (全核)同线 100 分。wall-clock 增长是覆盖增强的代价而非质量退化。
 */
export const T_PASS_MS = 195197;  // round(130131 × 1.5)
export const T_WARN_MS = 390394;  // round(130131 × 3)
