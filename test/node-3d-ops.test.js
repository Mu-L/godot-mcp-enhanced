import { expect } from 'vitest';
import {
  TOOL_NAMES,
  getToolDefinitions,
  TOOL_META,
  genCreate3DScript,
} from '../src/tools/node-3d-ops.js';
import {
  genCollisionOverlayScript,
} from '../src/tools/physics-ops.js';

// ─── TOOL_NAMES ─────────────────────────────────────────────────────────────

describe('node-3d-ops TOOL_NAMES', () => {
  it('contains exactly 1 tool name', () => {
    expect(TOOL_NAMES.length).toBe(1);
  });
  it('includes node_create_3d', () => {
    expect(TOOL_NAMES).toContain('node_create_3d');
  });
});

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('node-3d-ops getToolDefinitions', () => {
  it('returns 1 tool definition', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
  });
  it('definition name matches TOOL_NAMES', () => {
    const defs = getToolDefinitions();
    expect(defs[0].name).toBe('node_create_3d');
  });
});

// ─── TOOL_META ──────────────────────────────────────────────────────────────

describe('node-3d-ops TOOL_META', () => {
  it('has exactly 1 entry', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
  });
  it('has entry for node_create_3d', () => {
    expect(TOOL_META.node_create_3d).toBeDefined();
  });
  it('node_create_3d is non-readonly and non-long-running', () => {
    expect(TOOL_META.node_create_3d.readonly).toBe(false);
    expect(TOOL_META.node_create_3d.long_running).toBe(false);
  });
});

// ─── genCollisionOverlayScript (now in physics-ops) ─────────────────────────

describe('genCollisionOverlayScript', () => {
  it('generates overlay script', () => {
    const script = genCollisionOverlayScript('/root/Level');
    expect(script).toContain('CollisionShape3D');
    expect(script).toContain('_MCP_CollisionOverlay');
    expect(script).toContain('StandardMaterial3D');
  });
  it('includes color override when provided', () => {
    const script = genCollisionOverlayScript('/root/Level', '1,0,0,0.5');
    expect(script).toContain('Color(1,0,0,0.5)');
  });
  it('uses auto-detection when no color override', () => {
    const script = genCollisionOverlayScript('/root/Level');
    expect(script).toContain('StaticBody3D');
    expect(script).toContain('CharacterBody3D');
  });
});

// ─── genCreate3DScript ──────────────────────────────────────────────────────

describe('genCreate3DScript', () => {
  it('creates node with position', () => {
    const script = genCreate3DScript('MeshInstance3D', 'MyMesh', '/root/Scene', {x:1,y:2,z:3});
    expect(script).toContain('MeshInstance3D.new()');
    expect(script).toContain('MyMesh');
    expect(script).toContain('position = Vector3(1, 2, 3)');
  });
  it('creates node with scale', () => {
    const script = genCreate3DScript('Camera3D', 'MainCam', '/root/Scene', undefined, undefined, {x:2,y:2,z:2});
    expect(script).toContain('Camera3D.new()');
    expect(script).toContain('scale = Vector3(2, 2, 2)');
    expect(script.includes('position =')).toBeFalsy();
  });
  it('sets custom properties', () => {
    const script = genCreate3DScript('OmniLight3D', 'Light1', '/root/Scene', undefined, undefined, undefined, { light_energy: 2.5, light_color: '"red"' });
    expect(script).toContain('light_energy');
    expect(script).toContain('2.5');
  });
  it('rejects invalid property names', () => {
    expect(() => genCreate3DScript('Node3D', 'X', '/root', undefined, undefined, undefined, { 'a;b': 1 })).toThrow(/Invalid property name/);
    expect(() => genCreate3DScript('Node3D', 'X', '/root', undefined, undefined, undefined, { '1bad': 1 })).toThrow(/Invalid property name/);
  });
  it('accepts valid property names', () => {
    const script = genCreate3DScript('Node3D', 'X', '/root', undefined, undefined, undefined, { _private: 1, camelCase: 2 });
    expect(script).toContain('_private');
    expect(script).toContain('camelCase');
  });
});
