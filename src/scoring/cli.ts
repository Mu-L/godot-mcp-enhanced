import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { generateScore } from './generate-score.js';
import { evaluateGate } from './gate.js';
import { renderPrComment } from './pr-comment.js';
import type { ScoreJson } from './types.js';

// CLI 入口:node build/scoring/cli.js [gate]
const entry = fileURLToPath(import.meta.url);
const arg1 = process.argv[1];
const invoked = arg1 !== undefined && resolve(arg1) === entry;
if (invoked) {
  const cmd = process.argv[2];
  if (cmd === 'gate') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    if (!existsSync(scorePath)) {
      console.error('score.json 不存在,先跑 npm run score');
      process.exit(1);
    }
    let score: ScoreJson;
    try {
      score = JSON.parse(readFileSync(scorePath, 'utf8'));
    } catch {
      console.error('score.json 解析失败,重新跑 npm run score');
      process.exit(1);
    }
    // 结构守卫:防止合法 JSON 但结构异常(如 hardFails: null)
    if (!score || typeof score.total !== 'number' || !Array.isArray(score.hardFails)) {
      console.error('score.json 结构异常(total/hardFails 缺失或类型错),重新跑 npm run score');
      process.exit(1);
    }
    const { passed, reasons } = evaluateGate(score);
    if (!passed) {
      console.error('质量门禁未过:\n' + reasons.join('\n'));
      process.exit(1);
    }
    process.stdout.write(`质量门禁通过: total=${score.total}\n`);
  } else if (cmd === 'pr-comment') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    if (!existsSync(scorePath)) {
      console.error('score.json 不存在,先跑 npm run score');
      process.exit(1);
    }
    let score: ScoreJson;
    try {
      score = JSON.parse(readFileSync(scorePath, 'utf8'));
    } catch {
      console.error('score.json 解析失败,重新跑 npm run score');
      process.exit(1);
    }
    if (!score || typeof score.total !== 'number' || !Array.isArray(score.hardFails)) {
      console.error('score.json 结构异常(total/hardFails 缺失或类型错),重新跑 npm run score');
      process.exit(1);
    }
    const outPath = resolve(process.cwd(), 'coverage/pr-comment.md');
    writeFileSync(outPath, renderPrComment(score), 'utf8');
    process.stdout.write(`PR comment 写入: ${outPath}\n`);
  } else {
    const lcovPath = resolve(process.cwd(), 'coverage/lcov.info');
    const outPath = resolve(process.cwd(), 'coverage/score.json');
    const e2eReportPath = resolve(process.cwd(), 'coverage/e2e-report.json');
    const auditJsonPath = resolve(process.cwd(), 'coverage/audit.json');
    const gdscriptReportPath = resolve(process.cwd(), 'coverage/gdscript-report.json');
    const score = generateScore({ lcovPath, outPath, e2eReportPath, auditJsonPath, gdscriptReportPath });
    process.stdout.write(
      `score: ${score.total} pass=${score.pass} partial=${score.partial} unverified=${score.unverified.length} → ${outPath}\n`,
    );
  }
}
