import type { ScoreJson } from './types.js';
import { NA_SCORE, DIM_ORDER } from './dimensions.js';
import { dimMetric } from './metric.js';

const STATUS_BADGE: Record<string, string> = {
  pass: '✅ pass',
  warn: '⚠️ warn',
  fail: '❌ fail',
  na: '⊘ na',
};

/** 转义 markdown 表格/行内代码元字符,防采集内容破坏表格结构或注入代码块(A2,对齐 html.ts escapeHtml)。 */
function escapeMarkdown(s: unknown): string {
  return String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

/**
 * 渲染 score.json → 人读 markdown。
 * 头部时间取自 score.generatedAt(不重复 new Date(),保证与 score 时间一致)。
 * 容错:未知 status 显示原值;raw 缺失显示 "—"。
 * 所有外部插值经 escapeMarkdown 转义,防 | 破坏表格、` 注入代码块(A2)。
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
    lines.push(`| ${escapeMarkdown(name)} | ${escapeMarkdown(scoreCell)} | ${escapeMarkdown(d.weight)} | ${escapeMarkdown(STATUS_BADGE[d.status] ?? d.status)} | ${escapeMarkdown(dimMetric(name, d))} |`);
  }
  lines.push('');
  lines.push('## 硬否决');
  if (score.hardFails.length === 0) {
    lines.push('(无)');
  } else {
    for (const hf of score.hardFails) {
      lines.push(`- ${escapeMarkdown(hf.dimension)}: ${escapeMarkdown(hf.reason)}(${hf.actual} < ${hf.threshold})`);
    }
  }
  lines.push('');
  lines.push('## 未验证维度');
  if (score.unverified.length === 0) {
    lines.push('(无)');
  } else {
    lines.push(score.unverified.map(escapeMarkdown).join(', ') + ' — M3c-e 接入');
  }
  lines.push('');
  return lines.join('\n');
}
