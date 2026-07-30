import { expect } from 'vitest';
import {
  getToolDefinitions,
  TOOL_META,
  genRaycastScript,
  genBodyInfoScript,
  genDiagnosePhysicsScript,
  genQuerySpatialScript,
  genCollisionOverlayScript,
  handleTool,
} from '../src/tools/physics-ops.js';

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('physics-ops getToolDefinitions', () => {
  it('returns 1 merged tool definition', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
  });
  it('tool is named "physics"', () => {
    const defs = getToolDefinitions();
    expect(defs[0].name).toBe('physics');
  });
  it('action enum contains all 5 actions', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('raycast');
    expect(actionEnum).toContain('body_info');
    expect(actionEnum).toContain('diagnose');
    expect(actionEnum).toContain('query_spatial');
    expect(actionEnum).toContain('collision_overlay');
  });
});

// ─── TOOL_META ──────────────────────────────────────────────────────────────

describe('physics-ops TOOL_META', () => {
  it('has exactly 1 entry for "physics"', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
    expect(TOOL_META.physics).toBeDefined();
  });
  it('physics is readonly and non-long-running', () => {
    expect(TOOL_META.physics.readonly).toBe(true);
    expect(TOOL_META.physics.long_running).toBe(false);
  });
});

// ─── genRaycastScript ───────────────────────────────────────────────────────

describe('genRaycastScript', () => {
  it('contains PhysicsRayQueryParameters3D.create', () => {
    const script = genRaycastScript({x:0,y:0,z:0}, {x:10,y:0,z:0});
    expect(script).toContain('PhysicsRayQueryParameters3D.create');
    expect(script).toContain('Vector3(0, 0, 0)');
    expect(script).toContain('Vector3(10, 0, 0)');
    expect(script).toContain('root.get_world_3d()');
  });
  it('includes collision_mask when provided', () => {
    const script = genRaycastScript({x:0,y:0,z:0}, {x:10,y:0,z:0}, 0b111);
    expect(script).toContain('collision_mask = 7');
  });
  it('includes exclude logic when paths provided', () => {
    const script = genRaycastScript({x:0,y:0,z:0}, {x:10,y:0,z:0}, undefined, ['/root/Wall', '/root/Floor']);
    expect(script).toContain('exclude');
    expect(script).toContain('/root/Wall');
    expect(script).toContain('/root/Floor');
  });
});

// ─── genBodyInfoScript ──────────────────────────────────────────────────────

describe('genBodyInfoScript', () => {
  it('contains CollisionShape3D scan', () => {
    const script = genBodyInfoScript('/root/Player');
    expect(script).toContain('CollisionShape3D');
    expect(script).toContain('_mcp_get_node("/root/Player")');
    expect(script).toContain('has_collision');
  });
  it('contains collision_layer and collision_mask', () => {
    const script = genBodyInfoScript('/root/Player');
    expect(script).toContain('collision_layer');
    expect(script).toContain('collision_mask');
  });
});

// ─── genDiagnosePhysicsScript ───────────────────────────────────────────────

describe('genDiagnosePhysicsScript', () => {
  it('contains move_and_collide', () => {
    const script = genDiagnosePhysicsScript('/root/Player');
    expect(script).toContain('move_and_collide');
    expect(script).toContain('ConcavePolygonShape3D');
  });
  it('contains velocity and position info', () => {
    const script = genDiagnosePhysicsScript('/root/Player');
    expect(script).toContain('velocity');
    expect(script).toContain('position');
  });
});

// ─── genQuerySpatialScript ──────────────────────────────────────────────────

describe('genQuerySpatialScript', () => {
  it('contains intersect_shape', () => {
    const script = genQuerySpatialScript({x:0,y:0,z:0}, 10);
    expect(script).toContain('intersect_shape');
    expect(script).toContain('SphereShape3D');
    expect(script).toContain('radius = 10');
  });
  it('includes collision_mask when provided', () => {
    const script = genQuerySpatialScript({x:0,y:0,z:0}, 10, 0xFF);
    expect(script).toContain('collision_mask');
  });
});

// ─── genCollisionOverlayScript ──────────────────────────────────────────────

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

describe('physics-ops R3-fix 项2+3', () => {
  it('项2: raycast exclude 块用 _mcp_get_node(headless 兼容)', () => {
    const script = genRaycastScript({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, undefined, ['root/Foo']);
    expect(script).toContain('_mcp_get_node(ep)');
    expect(script).not.toMatch(/[^_]get_node\(ep\)/);  // 裸 get_node 不残留
  });
  it('项3: color_override "5." 被拒(正则收紧, RGBA 非负)', async () => {
    const ctx = { findGodot: async () => '/fake/godot' };
    const r = await handleTool('physics', { action: 'collision_overlay', parent_path: 'root', color_override: '5.,0,0', project_path: '.' }, ctx);
    expect(r.isError).toBe(true);
    // 修复前: "5." 通过旧正则 → 走 spawnGodot('/fake/godot') ENOENT(消息 godot 相关, 无 color_override)
    // 修复后: :418 正则拒绝 → INVALID_VECTOR color_override 消息
    expect(JSON.stringify(r)).toMatch(/color_override|INVALID_VECTOR/i);
  });
});
