import { writeFileSync } from 'fs';
import type { DimensionName, DimensionResult, ScoreJson } from './types.js';
import { computeScore } from './aggregate.js';
import { collectCoverage } from './collectors/coverage.js';
import { collectIntegration } from './collectors/integration.js';
import { WEIGHTS, NA_SCORE } from './dimensions.js';

export interface GenerateScoreOptions {
  lcovPath: string;
  outPath: string;
  godotVersion?: string;
  /** vitest --reporter=json 产出路径;缺失→integration 维度 na */
  e2eReportPath?: string;
}

/** n/a 维度占位(权重保留,供 aggregate 重分配) */
function na(name: DimensionName): DimensionResult {
  return { score: NA_SCORE, weight: WEIGHTS[name], status: 'na' };
}

/**
 * 组装 6 维(M1 coverage + M2 integration 有值),聚合,写 score.json。
 * 返回 ScoreJson。后续里程碑只需替换对应 na() 为真实采集器结果。
 */
export function generateScore(opts: GenerateScoreOptions): ScoreJson {
  const coverage = collectCoverage(opts.lcovPath);
  const integration = opts.e2eReportPath ? collectIntegration(opts.e2eReportPath) : na('integration');
  const dims: Record<DimensionName, DimensionResult> = {
    integration,
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
