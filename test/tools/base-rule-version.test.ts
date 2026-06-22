import { describe, it, expect } from 'vitest';
import { GODOT_MCP_RULES } from '../../src/tools/claudemd-builder.js';

describe('GODOT_MCP_RULES 版本占位符', () => {
  it('包含 {{MCP_VERSION}} 占位符（供 setup_project_rules 插值）', () => {
    expect(GODOT_MCP_RULES).toContain('{{MCP_VERSION}}');
  });
});
