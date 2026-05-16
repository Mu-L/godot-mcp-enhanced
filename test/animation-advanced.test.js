import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_NAMES as ANIM_TOOL_NAMES,
  getToolDefinitions as getAnimDefs,
  genAnimationBlend,
} from '../build/tools/animation-ops.js';
import {
  TOOL_NAMES as TRACK_TOOL_NAMES,
  getToolDefinitions as getTrackDefs,
  genAnimationTrackAdd,
  genAnimationTrackRemove,
  genAnimationKeyframeAdd,
  genAnimationKeyframeRemove,
  genAnimationKeyframeUpdate,
  genAnimationCurve,
} from '../build/tools/animation-track.js';
import {
  TOOL_NAMES as ANIMTREE_TOOL_NAMES,
  getToolDefinitions as getAnimtreeDefs,
  genStateSetPosition,
  genStateSetBlend,
} from '../build/tools/animtree.js';

// ─── animation-ops TOOL_NAMES ────────────────────────────────────────────

describe('animation-ops TOOL_NAMES', () => {
  it('contains 2 tool names (animation + animation_blend)', () => {
    assert.strictEqual(ANIM_TOOL_NAMES.length, 2);
  });
  it('includes animation', () => {
    assert.ok(ANIM_TOOL_NAMES.includes('animation'));
  });
  it('includes animation_blend', () => {
    assert.ok(ANIM_TOOL_NAMES.includes('animation_blend'));
  });
});

// ─── animation-track TOOL_NAMES ──────────────────────────────────────────

describe('animation-track TOOL_NAMES', () => {
  it('contains 3 tool names', () => {
    assert.strictEqual(TRACK_TOOL_NAMES.length, 3);
  });
  it('includes animation_track', () => {
    assert.ok(TRACK_TOOL_NAMES.includes('animation_track'));
  });
  it('includes animation_keyframe', () => {
    assert.ok(TRACK_TOOL_NAMES.includes('animation_keyframe'));
  });
  it('includes animation_curve', () => {
    assert.ok(TRACK_TOOL_NAMES.includes('animation_curve'));
  });
});

// ─── getToolDefinitions (animation-ops) ───────────────────────────────────

describe('animation-ops getToolDefinitions', () => {
  it('returns 2 tool definitions', () => {
    const defs = getAnimDefs();
    assert.strictEqual(defs.length, 2);
  });
  it('each definition has inputSchema with required fields', () => {
    const defs = getAnimDefs();
    for (const def of defs) {
      assert.ok(def.inputSchema, `${def.name} missing inputSchema`);
      assert.ok(def.inputSchema.required, `${def.name} missing required`);
    }
  });
});

// ─── getToolDefinitions (animation-track) ─────────────────────────────────

describe('animation-track getToolDefinitions', () => {
  it('returns 3 tool definitions', () => {
    const defs = getTrackDefs();
    assert.strictEqual(defs.length, 3);
  });
  it('animation_track has action enum with add and remove', () => {
    const defs = getTrackDefs();
    const track = defs.find(d => d.name === 'animation_track');
    assert.ok(track);
    const actionEnum = track.inputSchema.properties.action.enum;
    assert.ok(actionEnum.includes('add'));
    assert.ok(actionEnum.includes('remove'));
  });
  it('animation_keyframe has action enum with add, remove, update', () => {
    const defs = getTrackDefs();
    const kf = defs.find(d => d.name === 'animation_keyframe');
    assert.ok(kf);
    const actionEnum = kf.inputSchema.properties.action.enum;
    assert.ok(actionEnum.includes('add'));
    assert.ok(actionEnum.includes('remove'));
    assert.ok(actionEnum.includes('update'));
  });
});

// ─── genAnimationTrackAdd ────────────────────────────────────────────────

describe('genAnimationTrackAdd', () => {
  it('generates GDScript with add_track call (value type)', () => {
    const script = genAnimationTrackAdd('/root/Player/AnimPlayer', 'walk', 'value', 'Sprite2D:frame', undefined);
    assert.ok(script.includes('_anim.add_track(0'));
    assert.ok(script.includes('track_set_path'));
    assert.ok(script.includes('Sprite2D:frame'));
  });
  it('generates GDScript with insert_at position', () => {
    const script = genAnimationTrackAdd('/root/A', 'idle', 'position_3d', 'Player', 2);
    assert.ok(script.includes('_anim.add_track(1, 2)'));
  });
  it('generates GDScript without track_path when undefined', () => {
    const script = genAnimationTrackAdd('/root/A', 'idle', 'bezier', undefined, undefined);
    assert.ok(script.includes('_anim.add_track(6)'));
    assert.ok(!script.includes('track_set_path'));
  });
});

// ─── genAnimationTrackRemove ─────────────────────────────────────────────

describe('genAnimationTrackRemove', () => {
  it('generates GDScript with remove_track call', () => {
    const script = genAnimationTrackRemove('/root/Player/AnimPlayer', 'walk', 0);
    assert.ok(script.includes('_anim.remove_track(0)'));
    assert.ok(script.includes('removed_track'));
  });
});

// ─── genAnimationKeyframeAdd ─────────────────────────────────────────────

describe('genAnimationKeyframeAdd', () => {
  it('generates GDScript with track_insert_key for value type', () => {
    const script = genAnimationKeyframeAdd('/root/A', 'walk', 0, 0.5, 42, undefined);
    assert.ok(script.includes('track_insert_key'));
    assert.ok(script.includes('42'));
  });
  it('includes transition value when provided', () => {
    const script = genAnimationKeyframeAdd('/root/A', 'walk', 0, 0.0, 0, 0.5);
    assert.ok(script.includes('0.5'));
  });
  it('handles Vector3 values for position_3d tracks', () => {
    const script = genAnimationKeyframeAdd('/root/A', 'walk', 0, 0.0, [1, 2, 3], undefined);
    assert.ok(script.includes('Vector3(1, 2, 3)'));
  });
});

// ─── genAnimationKeyframeRemove ──────────────────────────────────────────

describe('genAnimationKeyframeRemove', () => {
  it('generates GDScript with track_remove_key', () => {
    const script = genAnimationKeyframeRemove('/root/A', 'walk', 0, 1);
    assert.ok(script.includes('track_remove_key(0, 1)'));
    assert.ok(script.includes('removed_keyframe'));
  });
});

// ─── genAnimationKeyframeUpdate ──────────────────────────────────────────

describe('genAnimationKeyframeUpdate', () => {
  it('generates GDScript with track_set_key_value', () => {
    const script = genAnimationKeyframeUpdate('/root/A', 'walk', 0, 0, 100, undefined);
    assert.ok(script.includes('track_set_key_value'));
    assert.ok(script.includes('100'));
  });
  it('includes transition update when provided', () => {
    const script = genAnimationKeyframeUpdate('/root/A', 'walk', 0, 0, undefined, 0.8);
    assert.ok(script.includes('track_set_key_transition(0, 0, 0.8)'));
  });
  it('includes both value and transition', () => {
    const script = genAnimationKeyframeUpdate('/root/A', 'walk', 0, 0, 50, 0.3);
    assert.ok(script.includes('track_set_key_value'));
    assert.ok(script.includes('track_set_key_transition'));
  });
});

// ─── genAnimationCurve ───────────────────────────────────────────────────

describe('genAnimationCurve', () => {
  it('generates GDScript with in_handle and out_handle', () => {
    const script = genAnimationCurve('/root/A', 'walk', 0, 0, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 });
    assert.ok(script.includes('track_set_key_in_handle'));
    assert.ok(script.includes('track_set_key_out_handle'));
    assert.ok(script.includes('Vector2(0.1, 0.5)'));
    assert.ok(script.includes('Vector2(0.9, 0.5)'));
  });
  it('generates GDScript with only in_handle', () => {
    const script = genAnimationCurve('/root/A', 'walk', 0, 0, { x: 0.2, y: 0.3 }, undefined);
    assert.ok(script.includes('track_set_key_in_handle'));
    assert.ok(!script.includes('track_set_key_out_handle'));
  });
  it('generates GDScript with only out_handle', () => {
    const script = genAnimationCurve('/root/A', 'walk', 0, 0, undefined, { x: 0.8, y: 0.7 });
    assert.ok(!script.includes('track_set_key_in_handle'));
    assert.ok(script.includes('track_set_key_out_handle'));
  });
});

// ─── genAnimationBlend ───────────────────────────────────────────────────

describe('genAnimationBlend', () => {
  it('generates GDScript with play call including blend time and speed', () => {
    const script = genAnimationBlend('/root/Player/AnimPlayer', 'run', 0.3, 1.5);
    assert.ok(script.includes('_ap.play("run", 0.3, 1.5, false)'));
    assert.ok(script.includes('blend_time'));
    assert.ok(script.includes('speed'));
  });
  it('uses default speed 1.0', () => {
    const script = genAnimationBlend('/root/A', 'idle', 0.5, 1.0);
    assert.ok(script.includes('1'));
  });
});

// ─── animtree TOOL_NAMES ─────────────────────────────────────────────────

describe('animtree TOOL_NAMES (with P2 addition)', () => {
  it('contains 6 tool names (5 original + animtree_state_edit)', () => {
    assert.strictEqual(ANIMTREE_TOOL_NAMES.length, 6);
  });
  it('includes animtree_state_edit', () => {
    assert.ok(ANIMTREE_TOOL_NAMES.includes('animtree_state_edit'));
  });
});

// ─── animtree getToolDefinitions ──────────────────────────────────────────

describe('animtree getToolDefinitions', () => {
  it('returns 6 tool definitions', () => {
    const defs = getAnimtreeDefs();
    assert.strictEqual(defs.length, 6);
  });
  it('animtree_state_edit definition exists with correct actions', () => {
    const defs = getAnimtreeDefs();
    const edit = defs.find(d => d.name === 'animtree_state_edit');
    assert.ok(edit);
    const actionEnum = edit.inputSchema.properties.action.enum;
    assert.ok(actionEnum.includes('set_position'));
    assert.ok(actionEnum.includes('set_blend'));
  });
});

// ─── genStateSetPosition ─────────────────────────────────────────────────

describe('genStateSetPosition', () => {
  it('generates GDScript with set_node_position', () => {
    const script = genStateSetPosition('/root/Tree', 'idle', 100, 200);
    assert.ok(script.includes('set_node_position'));
    assert.ok(script.includes('Vector2(100, 200)'));
    assert.ok(script.includes('has_node("idle")'));
  });
});

// ─── genStateSetBlend ────────────────────────────────────────────────────

describe('genStateSetBlend', () => {
  it('generates GDScript with set for numeric value', () => {
    const script = genStateSetBlend('/root/Tree', 'blend/amount', '0.5');
    assert.ok(script.includes('_tree.set("blend/amount", 0.5)'));
  });
  it('generates GDScript with set for Vector2 value', () => {
    const script = genStateSetBlend('/root/Tree', 'blend/pos', 'Vector2(1, 2)');
    assert.ok(script.includes('Vector2(1, 2)'));
  });
});
