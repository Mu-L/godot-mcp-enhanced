import { expect, it, describe, vi } from 'vitest';
import {
  ACTIONS,
  getToolDefinitions,
  TOOL_META,
  handleTool,
  genStateSetPosition,
  genStateSetBlend,
} from '../src/tools/animtree.js';

// F-6: mock executeGdscript 以验证 handler→generator 路由(原 bug 下此路径是死代码)
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn().mockResolvedValue({
    success: true, compile_success: true, run_success: true,
    outputs: [{ value: '{"ok": true}' }], raw_output: '', run_error: '', errors: [],
    duration_ms: 1,
  }),
}));

const fakeCtx = { findGodot: async () => '/fake/godot' };

// ─── ACTIONS ──────────────────────────────────────────────────────────────

describe('animtree ACTIONS', () => {
  it('contains 6 actions', () => {
    expect(ACTIONS.length).toBe(6);
  });
  const expected = [
    'animtree_create',
    'animtree_add_state',
    'animtree_add_transition',
    'animtree_set_blend',
    'animtree_play',
    'animtree_state_edit',
  ];
  for (const name of expected) {
    it(`includes ${name}`, () => {
      expect(ACTIONS).toContain(name);
    });
  }
});

// ─── getToolDefinitions ──────────────────────────────────────────────────────

describe('animtree getToolDefinitions', () => {
  it('returns non-empty array', () => {
    const defs = getToolDefinitions();
    expect(Array.isArray(defs)).toBeTruthy();
    expect(defs.length).toBeGreaterThan(0);
  });
  it('returns 1 definition named animtree', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
    expect(defs[0].name).toBe('animtree');
  });
  it('action enum contains all ACTIONS', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    for (const a of ACTIONS) {
      expect(actionEnum).toContain(a);
    }
  });
  it('definition has name and inputSchema', () => {
    const def = getToolDefinitions()[0];
    expect(def.name).toBeTruthy();
    expect(def.inputSchema).toBeTruthy();
    expect(def.inputSchema.type).toBe('object');
  });
});

// ─── TOOL_META ───────────────────────────────────────────────────────────────

describe('animtree TOOL_META', () => {
  it('has exactly 1 entry for animtree', () => {
    expect('animtree' in TOOL_META).toBeTruthy();
    expect(Object.keys(TOOL_META).length).toBe(1);
  });
  it('animtree is non-readonly and non-long-running', () => {
    expect(TOOL_META['animtree'].readonly).toBe(false);
    expect(TOOL_META['animtree'].long_running).toBe(false);
  });
});

// ─── handleTool ──────────────────────────────────────────────────────────────

describe('animtree handleTool', () => {
  it('returns null for unknown tool', async () => {
    const result = await handleTool('unknown_tool', {}, fakeCtx);
    expect(result).toBe(null);
  });

  it('returns null for unrelated tool name', async () => {
    const result = await handleTool('run_project', {}, fakeCtx);
    expect(result).toBe(null);
  });

  it('animtree_create rejects missing name', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_create',
      project_path: '/fake/project',
      animation_player_path: 'root/AP',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBeTruthy();
  });

  it('animtree_create rejects missing animation_player_path', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_create',
      project_path: '/fake/project',
      name: 'MyTree',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('animtree_add_state rejects missing state_name', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_add_state',
      project_path: '/fake/project',
      node_path: 'root/Tree',
      animation: 'idle',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('animtree_play rejects missing state_name', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_play',
      project_path: '/fake/project',
      node_path: 'root/Tree',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('animtree_set_blend rejects missing parameter_name', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_set_blend',
      project_path: '/fake/project',
      node_path: 'root/Tree',
      value: 0.5,
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('animtree_state_edit rejects missing sub_action', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_state_edit',
      project_path: '/fake/project',
      node_path: 'root/Tree',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/sub_action/);
  });

  // F-6 正向测试:验证 set_position/set_blend 路由可达(原 bug 下整条 action 死代码)
  it('animtree_state_edit set_position routes to generator (F-6 fix)', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_state_edit',
      sub_action: 'set_position',
      project_path: '/fake/project',
      node_path: 'root/Tree',
      state_name: 'idle',
      position: { x: 10, y: 20 },
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('animtree_state_edit set_blend routes to generator (F-6 fix)', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_state_edit',
      sub_action: 'set_blend',
      project_path: '/fake/project',
      node_path: 'root/Tree',
      parameter_name: 'blend',
      value: 0.5,
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('animtree_state_edit rejects invalid sub_action', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_state_edit',
      sub_action: 'bogus',
      project_path: '/fake/project',
      node_path: 'root/Tree',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/set_position.*set_blend/);
  });

  it('animtree_add_transition rejects missing from_state', async () => {
    const result = await handleTool('animtree', {
      action: 'animtree_add_transition',
      project_path: '/fake/project',
      node_path: 'root/Tree',
      to_state: 'run',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });
});

// ─── genStateSetPosition ─────────────────────────────────────────────────────

describe('genStateSetPosition', () => {
  it('generates script with state name and position', () => {
    const script = genStateSetPosition('root/Tree', 'idle', 10, 20);
    expect(script).toContain('idle');
    expect(script).toContain('Vector2(10, 20)');
    expect(script).toContain('set_node_position');
  });
});

// ─── genStateSetBlend ────────────────────────────────────────────────────────

describe('genStateSetBlend', () => {
  it('generates script with parameter name and value', () => {
    const script = genStateSetBlend('root/Tree', 'blend_amount', '0.5');
    expect(script).toContain('blend_amount');
    expect(script).toContain('0.5');
  });
});
