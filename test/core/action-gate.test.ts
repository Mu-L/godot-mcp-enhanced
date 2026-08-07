// test/core/action-gate.test.ts — P0-3 Action Gate
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isActionGated,
  isActionAllowed,
  resolveEnabledGroups,
  getGateStatus,
} from '../../src/core/action-gate.js';

describe('action-gate (P0-3)', () => {
  const origEnv = process.env.GODOT_MCP_PRIVILEGED_GROUPS;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.GODOT_MCP_PRIVILEGED_GROUPS;
    else process.env.GODOT_MCP_PRIVILEGED_GROUPS = origEnv;
  });

  describe('isActionGated', () => {
    it('gates script.execute_gdscript (not runtime — toolName 必须与 tool-registry 承载工具一致)', () => {
      // 2026-08-06 审查 P0：原 'runtime.execute_gdscript' key 永不命中（execute_gdscript 实属 script 工具）
      expect(isActionGated('script', 'execute_gdscript')).toBe(true);
      expect(isActionGated('runtime', 'execute_gdscript')).toBe(false);
    });

    it('gates blender.execute_bpy', () => {
      expect(isActionGated('blender', 'execute_bpy')).toBe(true);
    });

    it('does NOT gate script.edit_script (over-blocking 验证)', () => {
      expect(isActionGated('script', 'edit_script')).toBe(false);
    });

    it('does NOT gate unknown tool/action', () => {
      expect(isActionGated('scene', 'add_node')).toBe(false);
      expect(isActionGated('unknown', 'unknown')).toBe(false);
    });
  });

  describe('isActionAllowed — 默认（无 env）', () => {
    beforeEach(() => delete process.env.GODOT_MCP_PRIVILEGED_GROUPS);

    it('blocks gated action when no groups enabled', () => {
      expect(isActionAllowed('script', 'execute_gdscript', [])).toBe(false);
    });

    it('allows non-gated action regardless of groups', () => {
      expect(isActionAllowed('script', 'edit_script', [])).toBe(true);
      expect(isActionAllowed('scene', 'add_node', [])).toBe(true);
    });
  });

  describe('isActionAllowed — opt-in code-execution', () => {
    it('allows gated action when code-execution enabled', () => {
      expect(isActionAllowed('script', 'execute_gdscript', ['code-execution'])).toBe(true);
      expect(isActionAllowed('blender', 'execute_bpy', ['code-execution'])).toBe(true);
    });
  });

  describe('isActionAllowed — opt-in all', () => {
    it('allows all gated actions when "all" enabled', () => {
      expect(isActionAllowed('script', 'execute_gdscript', ['all'])).toBe(true);
      expect(isActionAllowed('blender', 'execute_bpy', ['all'])).toBe(true);
    });
  });

  describe('resolveEnabledGroups', () => {
    it('returns empty array when env not set', () => {
      delete process.env.GODOT_MCP_PRIVILEGED_GROUPS;
      expect(resolveEnabledGroups()).toEqual([]);
    });

    it('parses single group from env', () => {
      process.env.GODOT_MCP_PRIVILEGED_GROUPS = 'code-execution';
      expect(resolveEnabledGroups()).toEqual(['code-execution']);
    });

    it('parses multiple comma-separated groups', () => {
      process.env.GODOT_MCP_PRIVILEGED_GROUPS = 'code-execution, future-group';
      expect(resolveEnabledGroups()).toEqual(['code-execution', 'future-group']);
    });

    it('returns all groups for "all"', () => {
      process.env.GODOT_MCP_PRIVILEGED_GROUPS = 'all';
      const result = resolveEnabledGroups();
      expect(result).toContain('all');
      expect(result).toContain('code-execution');
    });
  });

  describe('getGateStatus', () => {
    it('returns gate status with enabled=false by default', () => {
      delete process.env.GODOT_MCP_PRIVILEGED_GROUPS;
      const status = getGateStatus();
      expect(status['code-execution']).toBeDefined();
      expect(status['code-execution'].enabled).toBe(false);
      expect(status['code-execution'].actions).toContain('script.execute_gdscript');
      expect(status['code-execution'].source).toContain('default');
    });

    it('returns gate status with enabled=true when env set', () => {
      process.env.GODOT_MCP_PRIVILEGED_GROUPS = 'code-execution';
      const status = getGateStatus();
      expect(status['code-execution'].enabled).toBe(true);
      expect(status['code-execution'].source).toContain('env');
    });
  });
});
