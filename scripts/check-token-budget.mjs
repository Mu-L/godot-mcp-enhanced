#!/usr/bin/env node
// scripts/check-token-budget.mjs
// MCP 工具 description/inputSchema 体积门禁（warn-only 基线）。
// 读 docs/capability-matrix.json（build-matrix 产出的 committed 快照，非实时），
// 按分层阈值 warn（提醒）/ error（exit 1）。size 不进 diff-matrix drift，由本脚本独立把关。
//
// 用法：node scripts/check-token-budget.mjs
// 退出码：0=无 error（可能有 warn），1=有 error

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THRESHOLDS = {
  perToolDesc:   { warn: 800,        error: 2000 },
  perToolSchema: { warn: 6000,       error: 12000 },
  perToolTotal:  { warn: 7000,       error: 14000 },
  totalSum:      { warn: 80 * 1024,  error: 120 * 1024 },
};

/** @typedef {{name:string,size:{descBytes:number,schemaBytes:number,totalBytes:number}}} CapLike */

/**
 * @param {CapLike[]} caps
 * @returns {{warnings:string[],errors:string[],sum:number}} */
export function checkBudget(caps) {
  const warnings = [];
  const errors = [];
  let sum = 0;

  const checkDim = (cap, bytes, dim, label) => {
    const t = THRESHOLDS[dim];
    if (bytes >= t.error) errors.push(`${cap.name} ${label} ${bytes}B ≥ error ${t.error}B`);
    else if (bytes >= t.warn) warnings.push(`${cap.name} ${label} ${bytes}B ≥ warn ${t.warn}B`);
  };

  for (const cap of caps) {
    const s = cap.size;
    sum += s.totalBytes;
    checkDim(cap, s.descBytes, 'perToolDesc', 'desc');
    checkDim(cap, s.schemaBytes, 'perToolSchema', 'schema');
    checkDim(cap, s.totalBytes, 'perToolTotal', 'total');
  }

  if (sum >= THRESHOLDS.totalSum.error) errors.push(`total ${sum}B ≥ error ${THRESHOLDS.totalSum.error}B`);
  else if (sum >= THRESHOLDS.totalSum.warn) warnings.push(`total ${sum}B ≥ warn ${THRESHOLDS.totalSum.warn}B`);

  return { warnings, errors, sum };
}

function main() {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const matrixPath = join(projectRoot, 'docs', 'capability-matrix.json');
  const { tools } = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const { warnings, errors, sum } = checkBudget(tools);

  // 体积报告（始终打印）
  const top5 = [...tools].sort((a, b) => b.size.totalBytes - a.size.totalBytes).slice(0, 5);
  console.log('[token-budget] 总量 %dB (~%d tokens)', sum, Math.round(sum / 4));
  console.log('[token-budget] TOP5:');
  for (const t of top5) {
    console.log('  %s: desc %dB / schema %dB / total %dB', t.name, t.size.descBytes, t.size.schemaBytes, t.size.totalBytes);
  }

  for (const w of warnings) console.warn('[token-budget] WARN: ' + w);
  for (const e of errors) console.error('[token-budget] ERROR: ' + e);

  if (errors.length > 0) {
    console.error(`[token-budget] %d error(s), %d warning(s) — 阻塞`, errors.length, warnings.length);
    process.exit(1);
  }
  console.log('[token-budget] %d warning(s), 0 error — 通过', warnings.length);
}

main();
