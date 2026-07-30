import { expect, it, describe } from 'vitest';
import {
  getToolDefinitions,
  TOOL_META,
  handleTool,
  genNavQueryScript,
  genCreateRegionScript,
  genCreateAgentScript,
  genCreateLinkScript,
} from '../src/tools/navigation.js';

const fakeCtx = { findGodot: async () => '/fake/godot' };

// ─── getToolDefinitions ──────────────────────────────────────────────────────

describe('navigation getToolDefinitions', () => {
  it('returns non-empty array', () => {
    const defs = getToolDefinitions();
    expect(Array.isArray(defs)).toBeTruthy();
    expect(defs.length).toBeGreaterThan(0);
  });
  it('returns 1 merged definition named "nav"', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
    expect(defs[0].name).toBe('nav');
  });
  it('action enum contains all 6 actions', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('create_region');
    expect(actionEnum).toContain('bake_mesh');
    expect(actionEnum).toContain('create_agent');
    expect(actionEnum).toContain('set_params');
    expect(actionEnum).toContain('create_link');
    expect(actionEnum).toContain('query_path');
  });
  it('definition has name and inputSchema', () => {
    const def = getToolDefinitions()[0];
    expect(def.name).toBeTruthy();
    expect(def.inputSchema).toBeTruthy();
    expect(def.inputSchema.type).toBe('object');
  });
});

// ─── TOOL_META ───────────────────────────────────────────────────────────────

describe('navigation TOOL_META', () => {
  it('has exactly 1 entry for "nav"', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
    expect(TOOL_META.nav).toBeDefined();
  });
  it('nav is non-readonly and non-long-running', () => {
    expect(TOOL_META.nav.readonly).toBe(false);
    expect(TOOL_META.nav.long_running).toBe(false);
  });
});

// ─── handleTool ──────────────────────────────────────────────────────────────

describe('navigation handleTool', () => {
  it('returns null for unknown tool', async () => {
    const result = await handleTool('unknown_tool', {}, fakeCtx);
    expect(result).toBe(null);
  });

  it('returns null for unrelated tool name', async () => {
    const result = await handleTool('run_project', {}, fakeCtx);
    expect(result).toBe(null);
  });

  it('create_region action rejects missing name', async () => {
    const result = await handleTool('nav', {
      project_path: '/fake/project',
      action: 'create_region',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('create_region action rejects unsafe name with "/" (IMP-5 fix)', async () => {
    // IMP-5 (2026-06-26 review): nodeName 须 isSafeIdentifier,防 / 破坏 NodePath 语义
    const result = await handleTool('nav', {
      project_path: '/fake/project',
      action: 'create_region',
      name: 'bad/name',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('set_params action rejects missing params', async () => {
    const result = await handleTool('nav', {
      project_path: '/fake/project',
      action: 'set_params',
      node_path: 'root/Agent',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('set_params action rejects empty params object', async () => {
    const result = await handleTool('nav', {
      project_path: '/fake/project',
      action: 'set_params',
      node_path: 'root/Agent',
      params: {},
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('create_link action rejects missing name', async () => {
    const result = await handleTool('nav', {
      project_path: '/fake/project',
      action: 'create_link',
      start_position: { x: 0, y: 0, z: 0 },
      end_position: { x: 1, y: 0, z: 1 },
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });

  it('create_agent action rejects missing name', async () => {
    const result = await handleTool('nav', {
      project_path: '/fake/project',
      action: 'create_agent',
    }, fakeCtx);
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
  });
});

// ─── genNavQueryScript (pure function, no mock needed) ───────────────────────

describe('genNavQueryScript', () => {
  it('generates script with NavigationServer3D calls', () => {
    const script = genNavQueryScript(
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    );
    expect(script).toContain('NavigationServer3D');
    expect(script).toContain('map_get_path');
  });

  it('includes start_pos coordinates', () => {
    const script = genNavQueryScript(
      { x: 10, y: 20, z: 30 },
      { x: 40, y: 50, z: 60 },
    );
    expect(script).toContain('Vector3(10, 20, 30)');
    expect(script).toContain('Vector3(40, 50, 60)');
  });

  it('includes default map resolution when no region', () => {
    const script = genNavQueryScript(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    );
    expect(script).toContain('NavigationServer3D.get_maps()');
  });

  it('includes region lookup when navigationRegion is provided', () => {
    const script = genNavQueryScript(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      'root/Level/NavRegion',
    );
    expect(script).toContain('root/Level/NavRegion');
    expect(script).toContain('region_get_map');
  });

  it('outputs path data and length', () => {
    const script = genNavQueryScript(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    );
    expect(script).toContain('_mcp_output("path"');
    expect(script).toContain('_mcp_output("path_length"');
  });

  it('handles zero coordinates', () => {
    const script = genNavQueryScript(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    expect(script).toContain('Vector3(0, 0, 0)');
  });
});

// ─── null root guard (defect: gdscript-gen-null-root-deref 回归) ──────────────
// _mcp_get_root() 可返回 null(gdscript-executor.ts:829)。set_owner 前必须判空,
// 与 gdscript-templates.ts 既定模式(_mcp_load_scene 等)一致,不裸链 set_owner(_mcp_get_root())。

describe('gen scripts — _mcp_get_root() null guard before set_owner', () => {
  it('genCreateRegionScript 判空 root(不裸链 set_owner(_mcp_get_root()))', () => {
    const script = genCreateRegionScript('NavReg', 'root', { x: 0, y: 0, z: 0 }, false);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script.includes('set_owner(_mcp_get_root())')).toBe(false);
  });

  it('genCreateAgentScript 判空 root', () => {
    const script = genCreateAgentScript('Agent', 'root', { x: 0, y: 0, z: 0 }, 0.5, 1.0, false);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script.includes('set_owner(_mcp_get_root())')).toBe(false);
  });

  it('genCreateLinkScript 判空 root', () => {
    const script = genCreateLinkScript('Link', 'root', { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, true);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script.includes('set_owner(_mcp_get_root())')).toBe(false);
  });
});
