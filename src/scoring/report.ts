import type { ScoreJson, DimensionName, DimensionResult } from './types.js';
import { NA_SCORE, DIM_ORDER } from './dimensions.js';

const STATUS_BADGE: Record<string, string> = {
  pass: '✅ pass',
  warn: '⚠️ warn',
  fail: '❌ fail',
  na: '⊘ na',
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 按维度从 raw 提取"关键指标";na 维返回"未接入",raw 缺失返回 "—" */
function dimMetric(name: DimensionName, d: DimensionResult): string {
  if (d.score === NA_SCORE || d.status === 'na') return '未接入';
  const raw = d.raw as Record<string, number> | undefined;
  if (!raw) return '—';
  switch (name) {
    case 'integration':
      return `${raw.passed ?? 0}/${raw.ran ?? 0} passed`;
    case 'coverage':
      return `${round1(raw.pct ?? 0)}% (${raw.hit ?? 0}/${raw.found ?? 0})`;
    case 'security':
      return `${(raw.high ?? 0) + (raw.critical ?? 0)} high/critical (-${raw.deduction ?? 0})`;
    case 'gdscript':
      return `${raw.errors ?? 0} err / ${raw.warnings ?? 0} warn`;
    default:
      return '—';
  }
}

/**
 * 渲染 score.json → 人读 markdown。
 * 头部时间取自 score.generatedAt(不重复 new Date(),保证与 score 时间一致)。
 * 容错:未知 status 显示原值;raw 缺失显示 "—"。
 */
export function renderScoreReport(score: ScoreJson): string {
  const overall = score.pass ? '✅ PASS' : '❌ FAIL';
  const total = Object.keys(score.dimensions).length;
  const verified = total - score.unverified.length;
  const lines: string[] = [];
  lines.push('# 质量评分报告');
  lines.push('');
  lines.push(`**总分 ${score.total} / 100**  ${overall}  (partial: ${verified}/${total} 维已验证)  · ${score.generatedAt}`);
  lines.push('');
  lines.push('## 维度明细');
  lines.push('');
  lines.push('| 维度 | 分数 | 权重 | 状态 | 关键指标 |');
  lines.push('|---|---|---|---|---|');
  for (const name of DIM_ORDER) {
    const d = score.dimensions[name];
    const scoreCell = d.score === NA_SCORE ? '—' : String(d.score);
    lines.push(`| ${name} | ${scoreCell} | ${d.weight} | ${STATUS_BADGE[d.status] ?? d.status} | ${dimMetric(name, d)} |`);
  }
  lines.push('');
  lines.push('## 硬否决');
  if (score.hardFails.length === 0) {
    lines.push('(无)');
  } else {
    for (const hf of score.hardFails) {
      lines.push(`- ${hf.dimension}: ${hf.reason}(${hf.actual} < ${hf.threshold})`);
    }
  }
  lines.push('');
  lines.push('## 未验证维度');
  if (score.unverified.length === 0) {
    lines.push('(无)');
  } else {
    lines.push(score.unverified.join(', ') + ' — M3c-e 接入');
  }
  lines.push('');
  return lines.join('\n');
}
