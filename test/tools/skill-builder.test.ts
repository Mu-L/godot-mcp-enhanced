import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deriveSkillFromWorkflow, buildAllSkills, WORKFLOW_TO_SKILL } from '../../src/tools/skill-builder.js';
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

  it('deriveSkillFromWorkflow 缺 frontmatter / description / ## 时 throw', () => {
    expect(() => deriveSkillFromWorkflow('no frontmatter here', 'x')).toThrow();              // 缺 frontmatter
    expect(() => deriveSkillFromWorkflow('---\nalwaysApply: false\n---\n\n## h2', 'x')).toThrow();  // 缺 description
    expect(() => deriveSkillFromWorkflow('---\ndescription: "d"\n---\n\nno h2 here', 'x')).toThrow(); // 缺 ##
  });

  it('buildAllSkills 返回 3 个 entry，frontmatter 合法', () => {
    const skills = buildAllSkills();
    expect(skills.size).toBe(3);
    expect(skills.has('godot-mcp-bridge-e2e')).toBe(true);
    expect(skills.has('godot-mcp-verify-loop')).toBe(true);
    expect(skills.has('godot-mcp-safe-edit')).toBe(true);
    for (const [name, content] of skills) {
      expect(content.startsWith(`---\nname: ${name}\ndescription: "`)).toBe(true);
      expect(content).toContain('—— 当你');
      expect(content).not.toContain('alwaysApply');
    }
  });
});

// DRY 一致性（防忘记重跑 build:skills）：磁盘 SKILL.md == buildAllSkills() 派生结果
describe('SKILL.md DRY 一致性（磁盘 == 派生）', () => {
  it('3 个 SKILL.md 磁盘内容 == buildAllSkills() 派生结果（字符串严格相等）', () => {
    const skills = buildAllSkills();
    for (const [name, expected] of skills) {
      const diskPath = join(__dirname, '..', '..', '.claude', 'skills', name, 'SKILL.md');
      const disk = readFileSync(diskPath, 'utf-8');
      expect(disk).toBe(expected);  // 严格相等；wrapper 不加 trailing newline 保证此断言稳定
    }
  });
});
