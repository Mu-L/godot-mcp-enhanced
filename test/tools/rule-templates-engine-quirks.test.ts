import { describe, it, expect } from 'vitest';
import { DETAILED_RULE_TEMPLATES } from '../../src/tools/rule-templates.js';

describe('DETAILED_RULE_TEMPLATES 含 engine-quirks', () => {
  it('engine-quirks 键存在且非空', () => {
    expect(DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']).toBeTruthy();
    expect(DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']!.length).toBeGreaterThan(500);
  });

  it('engine-quirks 有 yaml frontmatter（description/alwaysApply）', () => {
    const tpl = DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']!;
    expect(tpl.startsWith('---\n')).toBe(true);
    expect(tpl).toContain('description:');
    expect(tpl).toContain('alwaysApply:');
  });

  it('engine-quirks 含 {{MCP_VERSION}} 占位符', () => {
    expect(DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']!).toContain('{{MCP_VERSION}}');
  });

  it('6 个详细模板键齐全', () => {
    const keys = Object.keys(DETAILED_RULE_TEMPLATES).sort();
    expect(keys).toEqual([
      'godot-mcp-bridge.md',
      'godot-mcp-core.md',
      'godot-mcp-editor.md',
      'godot-mcp-engine-quirks.md',
      'godot-mcp-recording.md',
      'godot-mcp-ui.md',
    ]);
  });
});
