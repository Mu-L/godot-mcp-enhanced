import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { generateScore } from './generate-score.js';

// CLI 入口:node build/scoring/cli.js
const entry = fileURLToPath(import.meta.url);
const arg1 = process.argv[1];
const invoked = arg1 !== undefined && resolve(arg1) === entry;
if (invoked) {
  const lcovPath = resolve(process.cwd(), 'coverage/lcov.info');
  const outPath = resolve(process.cwd(), 'coverage/score.json');
  const e2eReportPath = resolve(process.cwd(), 'coverage/e2e-report.json');
  const auditJsonPath = resolve(process.cwd(), 'coverage/audit.json');
  const score = generateScore({ lcovPath, outPath, e2eReportPath, auditJsonPath });
  process.stdout.write(
    `score: ${score.total} pass=${score.pass} partial=${score.partial} unverified=${score.unverified.length} → ${outPath}\n`,
  );
}
