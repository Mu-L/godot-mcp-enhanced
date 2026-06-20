import { writeFileSync } from 'fs';
import type { DimensionName, DimensionResult, ScoreJson } from './types.js';
import { computeScore } from './aggregate.js';
import { collectCoverage } from './collectors/coverage.js';
import { WEIGHTS, NA_SCORE } from './dimensions.js';

export interface GenerateScoreOptions {
  lcovPath: string;
  outPath: string;
  godotVersion?: string;
}

/** n/a 维度占位(权重保留,供 aggregate 重分配) */
function na(name: DimensionName): DimensionResult {
  return { score: NA_SCORE, weight: WEIGHTS[name], status: 'na' };
}

/**
 * 组装 6 维(M1 仅 coverage 有值),聚合,写 score.json。
 * 返回 ScoreJson。后续里程碑只需替换对应 na() 为真实采集器结果。
 * 无 CLI 入口(见 cli.ts),自身可单测(临时目录写 score.json 断言)。
 */
export function generateScore(opts: GenerateScoreOptions): ScoreJson {
  const coverage = collectCoverage(opts.lcovPath);
  const dims: Record<DimensionName, DimensionResult> = {
    integration: na('integration'),
    coverage,
    security: na('security'),
    flaky: na('flaky'),
    performance: na('performance'),
    gdscript: na('gdscript'),
  };
  const score = computeScore(dims, {
    godotVersion: opts.godotVersion,
    generatedAt: new Date().toISOString(),
  });
  writeFileSync(opts.outPath, JSON.stringify(score, null, 2) + '\n', 'utf8');
  return score;
}
