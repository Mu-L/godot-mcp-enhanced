import { describe, it, expect } from 'vitest';
import { DETAILED_RULE_TEMPLATES } from '../../src/tools/rule-templates.js';

const WORKFLOW_KEYS = [
  'godot-mcp-workflow-bridge-e2e.md',
  'godot-mcp-workflow-verify.md',
  'godot-mcp-workflow-safe-edit.md',
] as const;

describe('DETAILED_RULE_TEMPLATES 含 3 个 workflow 文档', () => {
  it('3 个 workflow 键存在且非空', () => {
    for (const key of WORKFLOW_KEYS) {
      expect(DETAILED_RULE_TEMPLATES[key]).toBeTruthy();
      expect(DETAILED_RULE_TEMPLATES[key]!.length).toBeGreaterThan(300);
    }
  });

  it('3 个 workflow 有 frontmatter（description + alwaysApply:false）', () => {
    for (const key of WORKFLOW_KEYS) {
      const tpl = DETAILED_RULE_TEMPLATES[key]!;
      expect(tpl.startsWith('---\n')).toBe(true);
      expect(tpl).toContain('description:');
      expect(tpl).toContain('alwaysApply: false');
    }
  });

  it('3 个 workflow 含 {{MCP_VERSION}} 占位符 + checklist（- [ ]）', () => {
    for (const key of WORKFLOW_KEYS) {
      const tpl = DETAILED_RULE_TEMPLATES[key]!;
      expect(tpl).toContain('{{MCP_VERSION}}');
      expect(tpl).toContain('- [ ]');
    }
  });
});
