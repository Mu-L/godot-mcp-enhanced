import { readFileSync, existsSync } from 'fs';
import type { DimensionResult } from '../types.js';
import { WEIGHTS, NA_SCORE } from '../dimensions.js';

/**
 * 解析 lcov.info,按 DA: 行(line data)算语句命中率。
 * 状态分级:>=60 pass,[40,60) warn,<40 fail。
 * 文件缺失或无 DA 行 → na。
 */
export function collectCoverage(lcovPath: string): DimensionResult {
  if (!existsSync(lcovPath)) {
    return {
      score: NA_SCORE,
      weight: WEIGHTS.coverage,
      status: 'na',
      detail: `lcov 不存在: ${lcovPath}`,
    };
  }
  const text = readFileSync(lcovPath, 'utf8');
  let found = 0;
  let hit = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('DA:')) {
      const parts = line.slice(3).split(',');
      found++;
      if (Number(parts[1]) > 0) hit++;
    }
  }
  if (found === 0) {
    return {
      score: NA_SCORE,
      weight: WEIGHTS.coverage,
      status: 'na',
      detail: 'lcov 无 DA 行',
    };
  }
  const pct = (hit / found) * 100;
  const score = Math.round(pct * 10) / 10;
  const status: DimensionResult['status'] = score >= 60 ? 'pass' : score >= 40 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.coverage, status, raw: { hit, found, pct } };
}
