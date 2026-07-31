import { expect } from 'vitest';
import {
  TOOL_NAMES as ANIM_TOOL_NAMES,
  getToolDefinitions as getAnimDefs,
  genAnimationBlend,
} from '../src/tools/animation/animation-ops.js';
import {
  TOOL_NAMES as TRACK_TOOL_NAMES,
  getToolDefinitions as getTrackDefs,
  genAnimationTrackAdd,
  genAnimationTrackRemove,
  genAnimationKeyframeAdd,
  genAnimationKeyframeRemove,
  genAnimationKeyframeUpdate,
  genAnimationCurve,
} from '../src/tools/animation/animation-track.js';
import {
  ACTIONS as ANIMTREE_ACTIONS,
  getToolDefinitions as getAnimtreeDefs,
  genStateSetPosition,
  genStateSetBlend,
} from '../src/tools/animtree.js';

// ─── animation-ops TOOL_NAMES ────────────────────────────────────────────

describe('animation-ops TOOL_NAMES', () => {
  it('contains 1 tool name (animation)', () => {
    expect(ANIM_TOOL_NAMES.length).toBe(1);
  });
  it('includes animation', () => {
    expect(ANIM_TOOL_NAMES).toContain('animation');
  });

});

// ─── animation-track TOOL_NAMES ──────────────────────────────────────────

describe('animation-track TOOL_NAMES', () => {
  it('contains 3 tool names', () => {
    expect(TRACK_TOOL_NAMES.length).toBe(1);
  });
  it('includes animation_track', () => {
    expect(TRACK_TOOL_NAMES).toContain('animation_track');
  });


});

// ─── getToolDefinitions (animation-ops) ───────────────────────────────────

describe('animation-ops getToolDefinitions', () => {
  it('returns 2 tool definitions', () => {
    const defs = getAnimDefs();
    expect(defs.length).toBe(1);
  });
  it('each definition has inputSchema with required fields', () => {
    const defs = getAnimDefs();
    for (const def of defs) {
      expect(def.inputSchema).toBeTruthy();
      expect(def.inputSchema.required).toBeTruthy();
    }
  });
});

// ─── getToolDefinitions (animation-track) ─────────────────────────────────

describe('animation-track getToolDefinitions', () => {
  it('returns 3 tool definitions', () => {
    const defs = getTrackDefs();
    expect(defs.length).toBe(1);
  });
  it('animation_track has action enum with add_track and remove_track', () => {
    const defs = getTrackDefs();
    const track = defs.find(d => d.name === 'animation_track');
    expect(track).toBeTruthy();
    const actionEnum = track.inputSchema.properties.action.enum;
    expect(actionEnum).toContain('add_track');
    expect(actionEnum).toContain('remove_track');
  });
  it('animation_track has keyframe actions', () => {
    const defs = getTrackDefs();
    const kf = defs.find(d => d.name === 'animation_track');
    expect(kf).toBeTruthy();
    const actionEnum = kf.inputSchema.properties.action.enum;
    expect(actionEnum).toContain('add_track');
    expect(actionEnum).toContain('remove_track');
    expect(actionEnum).toContain('update_keyframe');
  });
});

// ─── genAnimationTrackAdd ────────────────────────────────────────────────

describe('genAnimationTrackAdd', () => {
  it('generates GDScript with add_track call (value type)', () => {
    const script = genAnimationTrackAdd('/root/Player/AnimPlayer', 'walk', 'value', 'Sprite2D:frame', undefined);
    expect(script).toContain('_anim.add_track(0');
    expect(script).toContain('track_set_path');
    expect(script).toContain('Sprite2D:frame');
  });
  it('generates GDScript with insert_at position', () => {
    const script = genAnimationTrackAdd('/root/A', 'idle', 'position_3d', 'Player', 2);
    expect(script).toContain('_anim.add_track(1, 2)');
  });
  it('generates GDScript without track_path when undefined', () => {
    const script = genAnimationTrackAdd('/root/A', 'idle', 'bezier', undefined, undefined);
    expect(script).toContain('_anim.add_track(6)');
    expect(script.includes('track_set_path')).toBeFalsy();
  });
});

// ─── genAnimationTrackRemove ─────────────────────────────────────────────

describe('genAnimationTrackRemove', () => {
  it('generates GDScript with remove_track call', () => {
    const script = genAnimationTrackRemove('/root/Player/AnimPlayer', 'walk', 0);
    expect(script).toContain('_anim.remove_track(0)');
    expect(script).toContain('removed_track');
  });
});

// ─── genAnimationKeyframeAdd ─────────────────────────────────────────────

describe('genAnimationKeyframeAdd', () => {
  it('generates GDScript with track_insert_key for value type', () => {
    const script = genAnimationKeyframeAdd('/root/A', 'walk', 0, 0.5, 42, undefined);
    expect(script).toContain('track_insert_key');
    expect(script).toContain('42');
  });
  it('includes transition value when provided', () => {
    const script = genAnimationKeyframeAdd('/root/A', 'walk', 0, 0.0, 0, 0.5);
    expect(script).toContain('0.5');
  });
  it('handles Vector3 values for position_3d tracks', () => {
    const script = genAnimationKeyframeAdd('/root/A', 'walk', 0, 0.0, [1, 2, 3], undefined);
    expect(script).toContain('Vector3(1, 2, 3)');
  });
});

// ─── genAnimationKeyframeRemove ──────────────────────────────────────────

describe('genAnimationKeyframeRemove', () => {
  it('generates GDScript with track_remove_key', () => {
    const script = genAnimationKeyframeRemove('/root/A', 'walk', 0, 1);
    expect(script).toContain('track_remove_key(0, 1)');
    expect(script).toContain('removed_keyframe');
  });
});

// ─── genAnimationKeyframeUpdate ──────────────────────────────────────────

describe('genAnimationKeyframeUpdate', () => {
  it('generates GDScript with track_set_key_value', () => {
    const script = genAnimationKeyframeUpdate('/root/A', 'walk', 0, 0, 100, undefined);
    expect(script).toContain('track_set_key_value');
    expect(script).toContain('100');
  });
  it('includes transition update when provided', () => {
    const script = genAnimationKeyframeUpdate('/root/A', 'walk', 0, 0, undefined, 0.8);
    expect(script).toContain('track_set_key_transition(0, 0, 0.8)');
  });
  it('includes both value and transition', () => {
    const script = genAnimationKeyframeUpdate('/root/A', 'walk', 0, 0, 50, 0.3);
    expect(script).toContain('track_set_key_value');
    expect(script).toContain('track_set_key_transition');
  });
});

// ─── genAnimationCurve ───────────────────────────────────────────────────

describe('genAnimationCurve', () => {
  it('generates GDScript with in_handle and out_handle', () => {
    const script = genAnimationCurve('/root/A', 'walk', 0, 0, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 });
    expect(script).toContain('track_set_key_in_handle');
    expect(script).toContain('track_set_key_out_handle');
    expect(script).toContain('Vector2(0.1, 0.5)');
    expect(script).toContain('Vector2(0.9, 0.5)');
  });
  it('generates GDScript with only in_handle', () => {
    const script = genAnimationCurve('/root/A', 'walk', 0, 0, { x: 0.2, y: 0.3 }, undefined);
    expect(script).toContain('track_set_key_in_handle');
    expect(script.includes('track_set_key_out_handle')).toBeFalsy();
  });
  it('generates GDScript with only out_handle', () => {
    const script = genAnimationCurve('/root/A', 'walk', 0, 0, undefined, { x: 0.8, y: 0.7 });
    expect(script.includes('track_set_key_in_handle')).toBeFalsy();
    expect(script).toContain('track_set_key_out_handle');
  });
});

// ─── genAnimationBlend ───────────────────────────────────────────────────

describe('genAnimationBlend', () => {
  it('generates GDScript with play call including blend time and speed', () => {
    const script = genAnimationBlend('/root/Player/AnimPlayer', 'run', 0.3, 1.5);
    expect(script).toContain('_ap.play("run", 0.3, 1.5, false)');
    expect(script).toContain('blend_time');
    expect(script).toContain('speed');
  });
  it('uses default speed 1.0', () => {
    const script = genAnimationBlend('/root/A', 'idle', 0.5, 1.0);
    // speed=1.0 字符串化为 "1"（参考 :195 `1.5` → "1.5"），定位 _ap.play 第 3 参 speed 的实际值
    expect(script).toContain('_ap.play("idle", 0.5, 1, false)');
  });
});

// ─── animtree ACTIONS ─────────────────────────────────────────────────

describe('animtree ACTIONS (with P2 addition)', () => {
  it('contains 6 actions (5 original + animtree_state_edit)', () => {
    expect(ANIMTREE_ACTIONS.length).toBe(6);
  });
  it('includes animtree_state_edit', () => {
    expect(ANIMTREE_ACTIONS).toContain('animtree_state_edit');
  });
});

// ─── animtree getToolDefinitions ──────────────────────────────────────────

describe('animtree getToolDefinitions', () => {
  it('returns 1 definition named animtree', () => {
    const defs = getAnimtreeDefs();
    expect(defs.length).toBe(1);
    expect(defs[0].name).toBe('animtree');
  });
  it('action enum includes animtree_state_edit', () => {
    const defs = getAnimtreeDefs();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('animtree_state_edit');
  });
});

// ─── genStateSetPosition ─────────────────────────────────────────────────

describe('genStateSetPosition', () => {
  it('generates GDScript with set_node_position', () => {
    const script = genStateSetPosition('/root/Tree', 'idle', 100, 200);
    expect(script).toContain('set_node_position');
    expect(script).toContain('Vector2(100, 200)');
    expect(script).toContain('has_node("idle")');
  });
});

// ─── genStateSetBlend ────────────────────────────────────────────────────

describe('genStateSetBlend', () => {
  it('generates GDScript with set for numeric value', () => {
    const script = genStateSetBlend('/root/Tree', 'blend/amount', '0.5');
    expect(script).toContain('_tree.set("blend/amount", 0.5)');
  });
  it('generates GDScript with set for Vector2 value', () => {
    const script = genStateSetBlend('/root/Tree', 'blend/pos', 'Vector2(1, 2)');
    expect(script).toContain('Vector2(1, 2)');
  });
});
