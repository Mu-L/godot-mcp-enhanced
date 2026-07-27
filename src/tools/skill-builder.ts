// src/tools/skill-builder.ts
// 从 rule-templates.ts 的 workflow 模板派生 Claude Code SKILL.md（仓库自身开发用）
// 单一内容源 = DETAILED_RULE_TEMPLATES 的 3 个 workflow 模板；改 workflow 只改 rule-templates.ts
// 然后跑 npm run build:skills 重生成 .claude/skills/<name>/SKILL.md

import { DETAILED_RULE_TEMPLATES } from './rule-templates.js';

/** workflow 模板 key → skill name 映射（去 workflow- 中缀，verify 特例 -loop） */
export const WORKFLOW_TO_SKILL: Record<string, string> = {
  'godot-mcp-workflow-bridge-e2e.md': 'godot-mcp-bridge-e2e',
  'godot-mcp-workflow-verify.md': 'godot-mcp-verify-loop',
  'godot-mcp-workflow-safe-edit.md': 'godot-mcp-safe-edit',
};

/**
 * 从单个 workflow 模板派生 SKILL.md 内容（纯函数）。
 *
 * 派生规则：
 * 1. 剥 rule frontmatter（首部 ---\n...\n---\n，含 description + alwaysApply）
 * 2. 提取 description 引号内纯文本（rule-templates.ts 的 description 形如 description: "..."）
 * 3. 剃到首个 ## 标题前的所有内容（版本引用行 > 适用于 ... {{MCP_VERSION}}+ + 紧随空行）
 * 4. 组装 SKILL.md：---\nname: <skillName>\ndescription: "<纯文本>"\n---\n\n<正文从 ## 起>
 *    （description 重新包双引号；正文不加 H1，从 rule 的 H2 起）
 */
export function deriveSkillFromWorkflow(tpl: string, skillName: string): string {
  // 1. 剥 rule frontmatter
  const fmMatch = tpl.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) throw new Error('skill-builder: workflow 模板缺 rule frontmatter (---...---)');
  const frontmatter = fmMatch[1]!;
  const afterFm = tpl.slice(fmMatch[0].length);

  // 2. 提取 description 引号内纯文本
  const descMatch = frontmatter.match(/^description:\s*"([\s\S]*?)"\s*$/m);
  if (!descMatch) throw new Error('skill-builder: workflow frontmatter 缺 description (带引号)');
  const description = descMatch[1];

  // 3. 剃到首个 ## 前（版本引用行 + 空行）
  const h2Idx = afterFm.search(/^##\s/m);
  if (h2Idx === -1) throw new Error('skill-builder: workflow 模板缺 ## 标题');
  const body = afterFm.slice(h2Idx);

  // 4. 组装（description 重新包引号，不加 H1）
  return `---\nname: ${skillName}\ndescription: "${description}"\n---\n\n${body}`;
}

/** 遍历 WORKFLOW_TO_SKILL，对 DETAILED_RULE_TEMPLATES 的 3 个 workflow 模板派生。返回 skill name → SKILL.md 内容。 */
export function buildAllSkills(): Map<string, string> {
  const result = new Map<string, string>();
  for (const [workflowKey, skillName] of Object.entries(WORKFLOW_TO_SKILL)) {
    const tpl = DETAILED_RULE_TEMPLATES[workflowKey];
    if (!tpl) throw new Error(`skill-builder: DETAILED_RULE_TEMPLATES 缺 workflow 模板 ${workflowKey}`);
    result.set(skillName, deriveSkillFromWorkflow(tpl, skillName));
  }
  return result;
}
