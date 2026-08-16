#!/usr/bin/env node
// scripts/check-rules-content-sync.mjs
// 2026-08-07 审查 P2 建立;2026-08-16 原型翻译层审查遗留③升级:
// .claude/rules/godot-mcp-*.md 与 src/tools/rule-templates.ts 的 DETAILED_RULE_TEMPLATES
// 是两份独立副本(非生成关系,见 rule-templates.ts 头注释),check-rules-version-bump.mjs
// 只校验版本 bump 不校验内容——内容 drift 静默放过(2026-07-27 get_node_layout PR
// 第三方审查才发现 B-1 BLOCKING drift 的根因)。本脚本机械归一化 diff 堵此盲区。
//
// 2026-08-16 升级(历史 drift 已清零,本批启用 STRICT):
// 1. 归一化收紧:旧版把全文所有 semver 抹成 VERSION(会掩盖 Godot 4.6/4.7 等真实版本
//    差异)+压缩全部空白(diff 粒度退化)。现改为:CRLF→LF + 仅锚定版本行
//    "godot-mcp-enhanced v0.17.0+"(文件侧)↔"godot-mcp-enhanced {{MCP_VERSION}}+"(模板侧)
//    互抹(支持两段版本号如 v0.19),其余内容逐字比对。
// 2. 双向对账:模板键↔.claude/rules/godot-mcp-*.md 文件名双向(旧版只查单向且 WARN 不计)。
// 3. 差异定位改行级(旧版压缩后 char 定位难读)。
//
// 模式:
//   默认(advisory) = drift 时 exit 0 + stderr WARN(本地快速查)
//   STRICT=1        = drift 时 exit 1(CI 阻断,2026-08-16 起接入,新 drift 防护)
//
// 用法: node scripts/check-rules-content-sync.mjs(需先 npm run build)
// 退出码: advisory 恒 0 / STRICT 0=一致 1=drift 或 build 产物不可加载

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// 动态 import rule-templates.ts 编译产物(build/tools/rule-templates.js)
const templatesPath = join(repoRoot, 'build', 'tools', 'rule-templates.js');
if (!existsSync(templatesPath)) {
  console.error('[check-rules-content-sync] build/tools/rule-templates.js 不存在，请先 npm run build');
  process.exit(1);
}
const { DETAILED_RULE_TEMPLATES } = await import(pathToFileURL(templatesPath).href);

const rulesDir = join(repoRoot, '.claude', 'rules');

/**
 * normalize:CRLF→LF + 版本行互抹(锚定 "godot-mcp-enhanced " 前缀,支持 v0.19 两段式与
 * pre-release/build 后缀;不触碰 Godot 4.x 等其他版本号),其余逐字保留。
 */
function normalize(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/godot-mcp-enhanced v[\d.]+(?:[-+][\w.+-]*)?/g, 'godot-mcp-enhanced VER')
    .replace(/godot-mcp-enhanced \{\{MCP_VERSION\}\}(?:\+)?/g, 'godot-mcp-enhanced VER');
}

/** 行级首个差异描述(两侧已 normalize)。 */
function lineDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  let i = 0;
  while (i < al.length && i < bl.length && al[i] === bl[i]) i++;
  return `首个差异在第 ${i + 1} 行\n    模板: ${JSON.stringify(al[i] ?? '(EOF)')}\n    文件: ${JSON.stringify(bl[i] ?? '(EOF)')}`;
}

const templateKeys = Object.keys(DETAILED_RULE_TEMPLATES);
const ruleFiles = readdirSync(rulesDir).filter(f => /^godot-mcp-[^/]*\.md$/.test(f));

const problems = [];
for (const filename of templateKeys) {
  const rulesPath = join(rulesDir, filename);
  if (!existsSync(rulesPath)) {
    problems.push(`模板有而 .claude/rules/ 缺文件: ${filename}`);
    continue;
  }
  const a = normalize(DETAILED_RULE_TEMPLATES[filename]);
  const b = normalize(readFileSync(rulesPath, 'utf8'));
  if (a !== b) problems.push(`${filename} 内容不一致(归一化后): ${lineDiff(a, b)}`);
}
for (const f of ruleFiles) {
  if (!templateKeys.includes(f)) problems.push(`.claude/rules/ 有而模板缺键: ${f}`);
}

if (problems.length > 0) {
  const mode = process.env.STRICT === '1' ? 'STRICT' : 'advisory';
  console.error(`[check-rules-content-sync] ${mode}: ${problems.length} 处不一致:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('  修复：双向同步两处内容(AGENTS.md「独立副本同步约束」)；归一化仅抹版本行，其余须逐字一致');
  if (process.env.STRICT === '1') process.exit(1);
} else {
  console.log(`[check-rules-content-sync] OK: ${templateKeys.length} 个模板与 .claude/rules/ 双向对账一致(归一化: 换行/版本行)`);
}
