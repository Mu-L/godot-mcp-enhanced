#!/usr/bin/env node
// scripts/check-rules-content-sync.mjs
// 2026-08-07 审查 P2: rules↔rule-templates 内容 drift CI 守门
//
// AGENTS.md「独立副本同步约束」声明 .claude/rules/godot-mcp-*.md 与
// src/tools/rule-templates.ts 的 DETAILED_RULE_TEMPLATES 是两份独立副本（非生成关系），
// 改动时必须手动同步。现有 check-rules-version-bump.mjs 只校验 version bump，
// 不校验内容一致性——drift 静默放过（源于 2026-07-27 get_node_layout PR 教训）。
//
// 本脚本对每个 key 做 normalize（去版本号 + 压缩空白）后 diff。
//
// 模式：
//   默认（advisory）= drift 时 exit 0 + stderr WARN（不阻断 CI，因历史 drift 待统一同步）
//   STRICT=1        = drift 时 exit 1（阻断 CI，用于新 drift 防护，待历史 drift 清零后启用）
//
// 用法：node scripts/check-rules-content-sync.mjs
// 退出码：advisory 模式恒 0 / STRICT 模式 0=一致 1=drift

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// 动态 import rule-templates.ts 编译产物（build/tools/rule-templates.js）
// 若 build 不存在则提示先 npm run build
const templatesPath = join(repoRoot, 'build', 'tools', 'rule-templates.js');
if (!existsSync(templatesPath)) {
  console.error('[check-rules-content-sync] build/tools/rule-templates.js 不存在，请先 npm run build');
  process.exit(1);
}
const { DETAILED_RULE_TEMPLATES } = await import(pathToFileURL(templatesPath).href);

const rulesDir = join(repoRoot, '.claude', 'rules');

/** normalize：去版本号差异（template 占位 vs rules 真值）+ 压缩空白 + trim，让 diff 只看内容 */
function normalize(s) {
  return s
    // template 端：{{MCP_VERSION}} → VERSION
    .replace(/\{\{MCP_VERSION\}\}/g, 'VERSION')
    // rules 端：v0.X.Y / vX.Y.Z / 0.X.Y → VERSION（对齐 template 的 VERSION 占位）
    .replace(/\bv?\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\b/g, 'VERSION')
    .replace(/\s+/g, ' ')
    .trim();
}

let driftCount = 0;

for (const [filename, templateContent] of Object.entries(DETAILED_RULE_TEMPLATES)) {
  const rulesPath = join(rulesDir, filename);
  if (!existsSync(rulesPath)) {
    console.warn(`[check-rules-content-sync] WARN: .claude/rules/${filename} 不存在（template 有但 rules 缺，可能尚未分发）`);
    continue;
  }
  const rulesContent = readFileSync(rulesPath, 'utf-8');
  const a = normalize(templateContent);
  const b = normalize(rulesContent);
  if (a !== b) {
    driftCount++;
    // 找首个差异位置辅助定位
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    const ctx = 40;
    console.error(`[check-rules-content-sync] DRIFT: ${filename}`);
    console.error(`  template  (rule-templates.ts): ...${a.slice(Math.max(0, i - ctx), i + ctx)}...`);
    console.error(`  rules     (.claude/rules/):     ...${b.slice(Math.max(0, i - ctx), i + ctx)}...`);
    console.error(`  首个差异位置（normalize 后）：char ${i}`);
    console.error(`  修复：同步两处内容（AGENTS.md「独立副本同步约束」），或确认差异是预期的（如 template 用占位、rules 用真值）`);
  }
}

if (driftCount > 0) {
  const mode = process.env.STRICT === '1' ? 'STRICT' : 'advisory';
  console.error(`[check-rules-content-sync] ${mode}: ${driftCount} 个文件 drift 检出（历史 drift 待统一同步，advisory 不阻断；STRICT=1 阻断）`);
  if (process.env.STRICT === '1') process.exit(1);
} else {
  console.log('[check-rules-content-sync] OK: 所有 DETAILED_RULE_TEMPLATES 与 .claude/rules/ 内容一致');
}
