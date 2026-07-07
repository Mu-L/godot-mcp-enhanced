// test/core/get-context-registration.test.ts
import { describe, it, expect } from 'vitest';
import {
  TOOL_GROUPS,
  ALWAYS_ALLOWED,
  NO_PROJECT_PATH_TOOLS,
  getGroupForTool,
  isToolAllowed,
  skipProjectPath,
} from '../../src/core/tool-registry.js';

describe('godot_get_context registration', () => {
  it('belongs to core group via core.tools', () => {
    expect(getGroupForTool('godot_get_context')).toBe('core');
    expect(TOOL_GROUPS.core.tools).toContain('godot_get_context');
  });

  it('is always allowed', () => {
    expect(ALWAYS_ALLOWED.has('godot_get_context')).toBe(true);
    expect(isToolAllowed('godot_get_context')).toBe(true);
  });

  it('skips project_path requirement', () => {
    expect(NO_PROJECT_PATH_TOOLS.has('godot_get_context')).toBe(true);
    expect(skipProjectPath('godot_get_context')).toBe(true);
  });
});
