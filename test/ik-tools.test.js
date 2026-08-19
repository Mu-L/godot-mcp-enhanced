import { expect } from 'vitest';
import {
  getToolDefinitions,
  TOOL_META,
  genIkCreateScript,
  genIkGetScript,
  genIkSetScript,
  genListBonesScript,
} from '../src/tools/ik-tools.js';

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('ik-tools getToolDefinitions', () => {
  it('returns 1 merged tool definition', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
  });
  it('tool is named "ik"', () => {
    const defs = getToolDefinitions();
    expect(defs[0].name).toBe('ik');
  });
  it('action enum contains all 4 actions', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('ik_modifier_create');
    expect(actionEnum).toContain('ik_modifier_get');
    expect(actionEnum).toContain('ik_modifier_set');
    expect(actionEnum).toContain('ik_list_bones');
  });
  it('definition has inputSchema with required fields', () => {
    const defs = getToolDefinitions();
    expect(defs[0].inputSchema).toBeTruthy();
    expect(defs[0].inputSchema.required).toContain('action');
  });
});

// ─── TOOL_META ──────────────────────────────────────────────────────────────

describe('ik-tools TOOL_META', () => {
  it('has exactly 1 entry', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
  });
  it('has entry for "ik"', () => {
    expect(TOOL_META.ik).toBeDefined();
  });
  it('ik is non-readonly and non-long-running', () => {
    expect(TOOL_META.ik.readonly).toBe(false);
    expect(TOOL_META.ik.long_running).toBe(false);
  });
});

// ─── genIkCreateScript ──────────────────────────────────────────────────────

describe('genIkCreateScript', () => {
  it('generates valid GDScript with type and name', () => {
    const script = genIkCreateScript('TwoBoneIK3D', 'RightArmIK', 'root/Player/Skeleton3D');
    expect(script).toContain('TwoBoneIK3D.new()');
    expect(script).toContain('RightArmIK');
    expect(script).toContain('root/Player/Skeleton3D');
  });
  it('includes position when provided', () => {
    const script = genIkCreateScript('TwoBoneIK3D', 'IK', 'root', { x: 1, y: 2, z: 3 });
    expect(script).toContain('Vector3(1, 2, 3)');
  });
  it('includes bone_name and target_nodepath', () => {
    const script = genIkCreateScript('TwoBoneIK3D', 'IK', 'root', undefined, 'RightArm', 'root/Target');
    expect(script).toContain('RightArm');
    expect(script).toContain('root/Target');
    expect(script).toContain('NodePath');
  });
});

// ─── genIkGetScript ─────────────────────────────────────────────────────────

describe('genIkGetScript', () => {
  it('contains node path and property reads', () => {
    const script = genIkGetScript('root/Player/IK');
    expect(script).toContain('root/Player/IK');
    expect(script).toContain('ik_node.active');
    expect(script).toContain('ik_node.influence');
    expect(script).toContain('bone_name');
    expect(script).toContain('target_nodepath');
  });
});

// ─── genIkSetScript ─────────────────────────────────────────────────────────

describe('genIkSetScript', () => {
  it('sets active and influence', () => {
    const script = genIkSetScript('root/IK', { active: true, influence: 0.5 });
    expect(script).toContain('ik_node.active = true');
    expect(script).toContain('ik_node.influence = 0.5');
  });
  it('sets bone_name and magnet_position', () => {
    const script = genIkSetScript('root/IK', {
      bone_name: 'RightArm',
      magnet_position: { x: 0.1, y: 0.2, z: 0.3 },
    });
    expect(script).toContain('RightArm');
    expect(script).toContain('Vector3(0.1, 0.2, 0.3)');
  });
  it('sets target_nodepath as literal (含 % 不双写)', () => {
    // I-1a 回归:NodePath(...) 是纯字面量构造(同构 animtree anim_player),gdEscape 双写 %% 属误伤
    const script = genIkSetScript('root/IK', { target_nodepath: 'root/Target%A' });
    expect(script).toContain('NodePath("root/Target%A")');
    expect(script).not.toContain('Target%%A');
  });
});

// ─── genListBonesScript ─────────────────────────────────────────────────────

describe('genListBonesScript', () => {
  it('contains Skeleton3D check and bone iteration', () => {
    const script = genListBonesScript('root/Player/Skeleton3D');
    expect(script).toContain('Skeleton3D');
    expect(script).toContain('get_bone_count');
    expect(script).toContain('get_bone_name');
    expect(script).toContain('get_bone_rest');
  });
  it('includes limit when provided', () => {
    const script = genListBonesScript('root/Skeleton3D', 10);
    expect(script).toContain('10');
  });
});
