// src/capability/build-matrix.ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { registerAllModules } from '../core/module-loader.js';
import { extractCapabilities } from './extract.js';
import type { ToolCapability } from './schema.js';

function buildMarkdown(caps: ToolCapability[]): string {
  const total = caps.length;
  const byLevel = { 'danger-api': 0, 'guarded': 0, 'safe': 0 };
  const byL2 = { covered: 0, partial: 0, none: 0 };
  for (const c of caps) { byLevel[c.securityLevel]++; byL2[c.verification.l2]++; }
  // risk 四级聚合（全工具 actionRisks 计数汇总）
  const riskTotals = { read: 0, write: 0, destructive: 0, process: 0 };
  for (const c of caps) for (const [k, v] of Object.entries(c.riskDistribution ?? {})) {
    riskTotals[k as keyof typeof riskTotals] += v;
  }
  // trusted-nonread：标 read 但实际启进程/有副作用（项目有意信任不确认）
  const trustedList = caps.flatMap(c => (c.trustedNonRead ?? []).map(a => `\`${c.name}.${a}\``));
  const dangerTools = caps.filter(c => c.securityLevel === 'danger-api').map(c => `- \`${c.name}\` (${c.group})`).join('\n');
  const lines = [
    `# Capability Matrix`,
    ``,
    `> 自动生成，勿手改。由 \`npm run build-matrix\` 产出，漂移检测见 \`npm run diff-matrix\`。`,
    ``,
    `## 概览`,
    `- 工具总数：${total}`,
    `- securityLevel：danger-api ${byLevel['danger-api']} / guarded ${byLevel['guarded']} / safe ${byLevel['safe']}`,
    `- risk：read ${riskTotals.read} / write ${riskTotals.write} / destructive ${riskTotals.destructive} / process ${riskTotals.process}`,
    `- L2 覆盖：covered ${byL2.covered} / partial ${byL2.partial} / none ${byL2.none}`,
    ...(trustedList.length > 0 ? [`> 注：标 read 但实际启进程/有副作用(项目有意信任不确认): ${trustedList.join(', ')}`] : []),
    ``,
    `## danger-api 工具（L2 安全回归优先）`,
    dangerTools || '（无）',
    ``,
    `## 覆盖缺口（L2=none）`,
    ...caps.filter(c => c.verification.l2 === 'none').slice(0, 50).map(c => `- \`${c.name}\` (${c.group})`),
    ``,
    `## gdScriptImpl 说明`,
    `- editor 侧：addons/godot_mcp_server/commands/*_commands.gd 按 group 匹配`,
    `- headless 侧：恒为 exists=false（GDScript 由 gdscript-executor 运行时生成，无静态 1:1 文件）`,
    `- editor 侧局限：粗粒度探测（DEFAULT_GROUP_COMMANDS 键粒度），core/visual/profiler 等组当前 exists=false，M1 后续完善；不影响 drift 检测（Task 7 靠契约 diff）`,
  ];
  return lines.join('\n');
}

function main(): void {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  registerAllModules();
  const caps = extractCapabilities(projectRoot);
  caps.sort((a, b) => a.name.localeCompare(b.name));

  const docsDir = join(projectRoot, 'docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, 'capability-matrix.json'), JSON.stringify({ generatedAt: new Date().toISOString(), tools: caps }, null, 2));
  writeFileSync(join(docsDir, 'capability-matrix.md'), buildMarkdown(caps));
  console.log(`[build-matrix] ${caps.length} tools → docs/capability-matrix.{json,md}`);
}

main();
