import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_NAMES,
  getToolDefinitions,
  genCollisionOverlayScript,
  genCreate3DScript,
} from '../build/tools/node-3d-ops.js';

// ─── TOOL_NAMES ─────────────────────────────────────────────────────────────

describe('node-3d-ops TOOL_NAMES', () => {
  it('contains exactly 2 tool names', () => {
    assert.strictEqual(TOOL_NAMES.length, 2);
  });
  it('includes collision_overlay', () => {
    assert.ok(TOOL_NAMES.includes('collision_overlay'));
  });
  it('includes node_create_3d', () => {
    assert.ok(TOOL_NAMES.includes('node_create_3d'));
  });
});

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('node-3d-ops getToolDefinitions', () => {
  it('returns 2 tool definitions', () => {
    const defs = getToolDefinitions();
    assert.strictEqual(defs.length, 2);
  });
  it('each definition has a name from TOOL_NAMES', () => {
    const defs = getToolDefinitions();
    const names = defs.map(d => d.name);
    for (const tn of TOOL_NAMES) {
      assert.ok(names.includes(tn), `missing tool definition for ${tn}`);
    }
  });
});

// ─── genCollisionOverlayScript ──────────────────────────────────────────────

describe('genCollisionOverlayScript', () => {
  it('generates overlay script', () => {
    const script = genCollisionOverlayScript('/root/Level');
    assert.ok(script.includes('CollisionShape3D'));
    assert.ok(script.includes('_MCP_CollisionOverlay'));
    assert.ok(script.includes('StandardMaterial3D'));
  });
  it('includes color override when provided', () => {
    const script = genCollisionOverlayScript('/root/Level', '1,0,0,0.5');
    assert.ok(script.includes('Color(1,0,0,0.5)'));
  });
  it('uses auto-detection when no color override', () => {
    const script = genCollisionOverlayScript('/root/Level');
    assert.ok(script.includes('StaticBody3D'));
    assert.ok(script.includes('CharacterBody3D'));
  });
});

// ─── genCreate3DScript ──────────────────────────────────────────────────────

describe('genCreate3DScript', () => {
  it('creates node with position', () => {
    const script = genCreate3DScript('MeshInstance3D', 'MyMesh', '/root/Scene', {x:1,y:2,z:3});
    assert.ok(script.includes('MeshInstance3D.new()'));
    assert.ok(script.includes('MyMesh'));
    assert.ok(script.includes('position = Vector3(1, 2, 3)'));
  });
  it('creates node with scale', () => {
    const script = genCreate3DScript('Camera3D', 'MainCam', '/root/Scene', undefined, undefined, {x:2,y:2,z:2});
    assert.ok(script.includes('Camera3D.new()'));
    assert.ok(script.includes('scale = Vector3(2, 2, 2)'));
    assert.ok(!script.includes('position ='));
  });
  it('sets custom properties', () => {
    const script = genCreate3DScript('OmniLight3D', 'Light1', '/root/Scene', undefined, undefined, undefined, { light_energy: 2.5, light_color: '"red"' });
    assert.ok(script.includes('light_energy'));
    assert.ok(script.includes('2.5'));
  });
  it('rejects invalid property names', () => {
    assert.throws(() => genCreate3DScript('Node3D', 'X', '/root', undefined, undefined, undefined, { 'a;b': 1 }), { message: /Invalid property name/ });
    assert.throws(() => genCreate3DScript('Node3D', 'X', '/root', undefined, undefined, undefined, { '1bad': 1 }), { message: /Invalid property name/ });
  });
  it('accepts valid property names', () => {
    const script = genCreate3DScript('Node3D', 'X', '/root', undefined, undefined, undefined, { _private: 1, camelCase: 2 });
    assert.ok(script.includes('_private'));
    assert.ok(script.includes('camelCase'));
  });
});
