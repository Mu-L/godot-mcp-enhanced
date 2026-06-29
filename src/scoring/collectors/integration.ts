import { readFileSync, existsSync } from 'fs';
import type { DimensionResult } from '../types.js';
import { WEIGHTS, NA_SCORE } from '../dimensions.js';

/** vitest --reporter=json 产出的计数字段(只取需要的) */
interface VitestJsonReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
}

/**
 * 解析 vitest --reporter=json 产出,算真实集成通过率。
 * 通过率 = passed/(passed+failed)*100 —— 排除 pending(skip),因 skip 非"验证通过"也非"失败"。
 * passed+failed==0(全 skip,如本地无 Godot)→ na(无真实集成数据,不虚高分)。
 * 状态分级:>=80 pass,[60,80) warn,<60 fail(对齐 integration 硬否决线 80)。
 */
export function collectIntegration(jsonPath: string): DimensionResult {
  if (!existsSync(jsonPath)) {
    return { score: NA_SCORE, weight: WEIGHTS.integration, status: 'na', detail: `e2e json 不存在: ${jsonPath}` };
  }
  let report: VitestJsonReport;
  try {
    report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return { score: NA_SCORE, weight: WEIGHTS.integration, status: 'na', detail: `e2e json 解析失败: ${(e as Error).message}` };
  }
  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  const pending = report.numPendingTests ?? 0;
  const total = report.numTotalTests ?? (passed + failed + pending);
  const ran = passed + failed;
  if (ran === 0) {
    return {
      score: NA_SCORE, weight: WEIGHTS.integration, status: 'na',
      detail: 'e2e 全部 skip(无 Godot?),无真实集成数据',
      raw: { passed, failed, pending, total },
    };
  }
  const pct = (passed / ran) * 100;
  const score = Math.round(pct * 10) / 10;
  const status: DimensionResult['status'] = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.integration, status, raw: { passed, failed, pending, total, ran } };
}
