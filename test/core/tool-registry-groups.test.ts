// test/core/tool-registry-groups.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import {
  TOOL_GROUPS,
  PROFILES,
  expandGroups,
  resolveProfile,
  setActiveGroups,
  getActiveGroups,
  isToolAllowed,
  getGroupForTool,
  getToolDefinition,
} from '../../src/core/tool-registry.js';
import { registerAllModules } from '../../src/core/module-loader.js';

describe('TOOL_GROUPS enhanced', () => {
  it('each group has description, tools, requires, protected fields', () => {
    for (const [name, group] of Object.entries(TOOL_GROUPS)) {
      expect(group).toHaveProperty('description');
      expect(group).toHaveProperty('tools');
      expect(group).toHaveProperty('requires');
      expect(Array.isArray(group.requires)).toBe(true);
      if (name === 'core') {
        expect(group.protected).toBe(true);
      }
    }
  });

  it('core group is protected', () => {
    expect(TOOL_GROUPS.core.protected).toBe(true);
  });

  it('bridge group requires bridge connection', () => {
    expect(TOOL_GROUPS.bridge.requires).toContain('bridge');
  });

  it('recording group removed — merged into runtime (v0.18.0)', () => {
    expect(TOOL_GROUPS.recording).toBeUndefined();
  });

  it('ik group removed — merged into animation (v0.18.0)', () => {
    expect(TOOL_GROUPS.ik).toBeUndefined();
  });

  it('editor group requires editor connection', () => {
    expect(TOOL_GROUPS.editor.requires).toContain('editor');
  });

  it('dynamic group exists and has no connection requirements', () => {
    expect(TOOL_GROUPS.dynamic).toBeDefined();
    expect(TOOL_GROUPS.dynamic.tools).toContain('godot_advanced_tool');
    expect(TOOL_GROUPS.dynamic.requires).toEqual([]);
  });

  it('dynamic group is not protected', () => {
    expect(TOOL_GROUPS.dynamic.protected).toBeFalsy();
  });
});

describe('activeGroups management', () => {
  beforeEach(() => {
    // 重置为 full profile
    setActiveGroups(new Set(Object.keys(TOOL_GROUPS)));
  });

  it('getActiveGroups returns current active groups', () => {
    const groups = getActiveGroups();
    expect(groups.size).toBe(Object.keys(TOOL_GROUPS).length);
  });

  it('setActiveGroups updates active groups', () => {
    setActiveGroups(new Set(['core', 'animation']));
    const groups = getActiveGroups();
    expect(groups.has('core')).toBe(true);
    expect(groups.has('animation')).toBe(true);
    expect(groups.has('bridge')).toBe(false);
  });

  it('isToolAllowed returns true for tools in active groups', () => {
    setActiveGroups(new Set(['core', 'animation']));
    expect(isToolAllowed('animation')).toBe(true);
    expect(isToolAllowed('animtree')).toBe(true);
  });

  it('isToolAllowed returns false for tools in inactive groups', () => {
    setActiveGroups(new Set(['core']));
    expect(isToolAllowed('game')).toBe(false);
  });

  it('isToolAllowed always returns true for manage_tools', () => {
    setActiveGroups(new Set());
    expect(isToolAllowed('manage_tools')).toBe(true);
  });

  it('isToolAllowed always returns true for confirm_and_execute', () => {
    setActiveGroups(new Set());
    expect(isToolAllowed('confirm_and_execute')).toBe(true);
  });
});

describe('PROFILES with dynamic group', () => {
  it('full profile includes dynamic group', () => {
    const fullTools = resolveProfile('full');
    // full profile uses Object.keys(TOOL_GROUPS), so dynamic is included
    expect(PROFILES.full).toContain('dynamic');
  });

  it('bridge_dev profile includes dynamic group', () => {
    expect(PROFILES.bridge_dev).toContain('dynamic');
  });

  it('minimal profile does not include dynamic group', () => {
    expect(PROFILES.minimal).not.toContain('dynamic');
  });

  it('slim profile does not include dynamic group', () => {
    expect(PROFILES.slim).not.toContain('dynamic');
  });
});

describe('toolToGroup reverse mapping', () => {
  it('getGroupForTool returns group name for a tool', () => {
    expect(getGroupForTool('animation')).toBe('animation');
    expect(getGroupForTool('game')).toBe('bridge');
    expect(getGroupForTool('project')).toBe('core');
  });

  it('getGroupForTool returns undefined for unknown tool', () => {
    expect(getGroupForTool('nonexistent_tool')).toBeUndefined();
  });
});

describe('getToolDefinition', () => {
  beforeAll(() => {
    // 触发所有 ToolModule 的注册(scene/script 等进 modules)
    registerAllModules();
  });

  it('返已注册 tool 的 inputSchema;inline tool 返 undefined', () => {
    // scene/script 等经 registerModule 注册(registerAllModules 触发)
    const scene = getToolDefinition('scene');
    expect(scene).toBeDefined();
    expect(scene?.inputSchema).toBeDefined();
    expect(typeof scene?.inputSchema).toBe('object');

    // confirm_and_execute 经 registerInlineTool 只进 metaRegistry,不进 modules → 返 undefined
    // (ToolDispatcher.ts:95 在 setup 时注册;此处未调 setup 故 metaRegistry 中也没有,但行为一致)
    expect(getToolDefinition('confirm_and_execute')).toBeUndefined();
    // godot_advanced_tool 实为完整 ToolModule(advanced-proxy.ts 经 module-loader 注册),
    // 非 inline tool,故返回已定义(brief 假设其为 inline 有误,以代码实际行为为准)
    const advanced = getToolDefinition('godot_advanced_tool');
    expect(advanced).toBeDefined();
    expect(advanced?.name).toBe('godot_advanced_tool');
    // 未注册
    expect(getToolDefinition('nonexistent_tool_xyz')).toBeUndefined();
  });
});
