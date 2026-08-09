import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deriveSkillFromWorkflow, buildAllSkills, WORKFLOW_TO_SKILL, HANDWRITTEN_SKILLS } from '../../src/skills/skill-builder.js';
import { DETAILED_RULE_TEMPLATES } from '../../src/tools/rule-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('skill-builder 派生逻辑', () => {
  it('WORKFLOW_TO_SKILL 3 个映射正确', () => {
    expect(Object.keys(WORKFLOW_TO_SKILL)).toHaveLength(3);
    expect(WORKFLOW_TO_SKILL['godot-mcp-workflow-bridge-e2e.md']).toBe('godot-mcp-bridge-e2e');
    expect(WORKFLOW_TO_SKILL['godot-mcp-workflow-verify.md']).toBe('godot-mcp-verify-loop');
    expect(WORKFLOW_TO_SKILL['godot-mcp-workflow-safe-edit.md']).toBe('godot-mcp-safe-edit');
  });

  it('deriveSkillFromWorkflow 剥 rule frontmatter + 剃版本行 + 包 SKILL frontmatter（description 带引号，无 H1）', () => {
    const tpl = DETAILED_RULE_TEMPLATES['godot-mcp-workflow-bridge-e2e.md']!;
    const skill = deriveSkillFromWorkflow(tpl, 'godot-mcp-bridge-e2e');
    // 剥 rule frontmatter（不含 alwaysApply）
    expect(skill).not.toContain('alwaysApply');
    // 剃版本引用行
    expect(skill).not.toContain('> 适用于');
    expect(skill).not.toContain('{{MCP_VERSION}}');
    // 包 SKILL frontmatter（name + description 带双引号开头）
    expect(skill.startsWith('---\nname: godot-mcp-bridge-e2e\ndescription: "')).toBe(true);
    // 正文从 ## 起（H2）；无独立 H1——用行首锚定 \n#\s+\S，避免误匹配 ## 内的 "#"+空格
    expect(skill).toContain('\n## ');
    expect(skill).not.toMatch(/\n#\s+\S/);  // 无独立 H1（\n 后单 # + 空格 + 非空白；## 的 # 后是 # 非空格，不匹配）
    // description 含触发短语
    expect(skill).toContain('—— 当你');
  });

  it('description 含内嵌双引号时正确派生（行尾锚定回溯保护，spec §8）', () => {
    // description 值内含 " 对（如术语引用）。正则 ^description:\s*"([\s\S]*?)"\s*$ 的 \s*$ 行尾锚定
    // 迫使引擎回溯到行内最后一个 " —— 单行约定下内嵌引号被完整保留，不提前截断
    const tpl = [
      '---',
      'description: "bridge e2e "运行时" 验证 —— 当你需要验证时使用"',
      'alwaysApply: false',
      '---',
      '',
      '## 概述',
      '正文',
    ].join('\n');
    const skill = deriveSkillFromWorkflow(tpl, 'test-embed-quote');
    const expectedDesc = 'bridge e2e "运行时" 验证 —— 当你需要验证时使用';
    expect(skill).toBe(`---\nname: test-embed-quote\ndescription: "${expectedDesc}"\n---\n\n## 概述\n正文`);
  });

  it('deriveSkillFromWorkflow 缺 frontmatter / description / ## 时 throw', () => {
    expect(() => deriveSkillFromWorkflow('no frontmatter here', 'x')).toThrow();              // 缺 frontmatter
    expect(() => deriveSkillFromWorkflow('---\nalwaysApply: false\n---\n\n## h2', 'x')).toThrow();  // 缺 description
    expect(() => deriveSkillFromWorkflow('---\ndescription: "d"\n---\n\nno h2 here', 'x')).toThrow(); // 缺 ##
  });

  it('buildAllSkills 返回 6 个 entry（3 派生 + 3 手写），frontmatter 合法', () => {
    const skills = buildAllSkills();
    expect(skills.size).toBe(6);
    expect(skills.has('godot-mcp-bridge-e2e')).toBe(true);
    expect(skills.has('godot-mcp-verify-loop')).toBe(true);
    expect(skills.has('godot-mcp-safe-edit')).toBe(true);
    // Tier2-1 手写 skill
    expect(skills.has('godot-router')).toBe(true);
    expect(skills.has('screenshot-verify')).toBe(true);
    expect(skills.has('godot-tween-taste')).toBe(true);
    for (const [name, content] of skills) {
      expect(content.startsWith(`---\nname: ${name}\ndescription: "`)).toBe(true);
      expect(content).toContain('—— 当你');
    }
  });
});

// Tier2-1: 手写 skill（路由器/原语/advisor，非派生）
describe('手写 skill（Tier2-1）', () => {
  it('HANDWRITTEN_SKILLS 含 3 个新 skill', () => {
    expect(HANDWRITTEN_SKILLS.size).toBe(3);
    expect(HANDWRITTEN_SKILLS.has('godot-router')).toBe(true);
    expect(HANDWRITTEN_SKILLS.has('screenshot-verify')).toBe(true);
    expect(HANDWRITTEN_SKILLS.has('godot-tween-taste')).toBe(true);
  });

  it('每个手写 skill frontmatter 合法（name + description + —— 当你 + H2 正文）', () => {
    for (const [name, content] of HANDWRITTEN_SKILLS) {
      expect(content.startsWith(`---\nname: ${name}\ndescription: "`)).toBe(true);
      expect(content).toContain('—— 当你');
      expect(content).toContain('\n## ');
      expect(content).not.toMatch(/\n#\s+\S/);  // 无独立 H1
    }
  });
});

// DRY 一致性（防忘记重跑 build:skills）：磁盘 SKILL.md == buildAllSkills() 派生结果
describe('SKILL.md DRY 一致性（磁盘 == 派生）', () => {
  it('6 个 SKILL.md 磁盘内容 == buildAllSkills() 结果（字符串严格相等）', () => {
    const skills = buildAllSkills();
    for (const [name, expected] of skills) {
      const diskPath = join(__dirname, '..', '..', '.claude', 'skills', name, 'SKILL.md');
      const disk = readFileSync(diskPath, 'utf-8');
      expect(disk).toBe(expected);  // 严格相等；wrapper 不加 trailing newline 保证此断言稳定
    }
  });
});
