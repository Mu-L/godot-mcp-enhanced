// test/core/editor-method-map.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveEditorMethod,
  mergeTransformIntoParams,
  ASSET_EDITOR_METHODS,
} from '../../src/core/editor-method-map.js';

describe('editor-method-map', () => {
  it('maps asset create/path/batch/undo/save to flat asset_* methods', () => {
    expect(resolveEditorMethod('asset', { action: 'create' })?.method).toBe('asset_create');
    expect(resolveEditorMethod('asset', { action: 'path' })?.method).toBe('asset_path');
    expect(resolveEditorMethod('asset', { action: 'batch' })?.method).toBe('asset_batch');
    expect(resolveEditorMethod('asset', { action: 'undo' })?.method).toBe('asset_undo');
    expect(resolveEditorMethod('asset', { action: 'save' })?.method).toBe('asset_save');
  });

  it('returns null for unmapped action or tool (caller falls back to tool name)', () => {
    expect(resolveEditorMethod('asset', { action: 'list_shapes' })).toBeNull();
    expect(resolveEditorMethod('ui', { action: 'set_layout' })).toBeNull();
    expect(resolveEditorMethod('asset', {})).toBeNull();
  });

  it('attach create transformArgs (mergeTransformIntoParams)', () => {
    expect(resolveEditorMethod('asset', { action: 'create' })?.transformArgs).toBe(mergeTransformIntoParams);
    // 其他写动作不带 transformArgs
    expect(resolveEditorMethod('asset', { action: 'save' })?.transformArgs).toBeUndefined();
  });

  it('mergeTransformIntoParams merges top-level position/rotation/scale into params', () => {
    const out = mergeTransformIntoParams({
      action: 'create',
      shape: 'box',
      position: [1, 2, 3],
      rotation: [0, 0, 1],
      params: { size: [1, 1, 1] },
    });
    expect(out.params).toMatchObject({ size: [1, 1, 1], position: [1, 2, 3], rotation: [0, 0, 1] });
  });

  it('mergeTransformIntoParams does not override existing params keys', () => {
    const out = mergeTransformIntoParams({ position: [9, 9, 9], params: { position: [1, 2, 3] } });
    expect(out.params.position).toEqual([1, 2, 3]);
  });

  it('mergeTransformIntoParams leaves args without transform untouched (no params key added spuriously)', () => {
    const out = mergeTransformIntoParams({ shape: 'box' });
    expect(out.params).toEqual({});
  });

  // 漂移检测：editor-method-map 的 asset method 须与 command_handler.gd 的 asset_* 分支一致
  it('asset editor methods match command_handler.gd asset_* branches (drift check)', () => {
    const gd = readFileSync(
      resolve(process.cwd(), 'addons/godot_mcp_server/command_handler.gd'),
      'utf8',
    );
    for (const method of ASSET_EDITOR_METHODS) {
      expect(gd, `command_handler.gd 缺少分支 "${method}":`).toContain(`"${method}":`);
    }
  });
});

describe('editor-method-map scene routing', () => {
  it('maps scene.add_node → add_node', () => {
    expect(resolveEditorMethod('scene', { action: 'add_node' })?.method).toBe('add_node');
  });
  it('maps scene.instance_scene → instance_scene', () => {
    expect(resolveEditorMethod('scene', { action: 'instance_scene' })?.method).toBe('instance_scene');
  });
  it('maps scene.set_instance_property → set_instance_property', () => {
    expect(resolveEditorMethod('scene', { action: 'set_instance_property' })?.method).toBe('set_instance_property');
  });
  it('maps scene.open_scene → open_scene', () => {
    expect(resolveEditorMethod('scene', { action: 'open_scene' })?.method).toBe('open_scene');
  });
  it('maps scene.save_scene → save_scene', () => {
    expect(resolveEditorMethod('scene', { action: 'save_scene' })?.method).toBe('save_scene');
  });
  it('maps scene.remove_node → remove_node', () => {
    expect(resolveEditorMethod('scene', { action: 'remove_node' })?.method).toBe('remove_node');
  });
  it('returns null for unregistered scene action (read_scene → headless fallback)', () => {
    expect(resolveEditorMethod('scene', { action: 'read_scene' })).toBeNull();
  });
});

// CRITICAL(2026-07-13 协议断链审查): animation_track 工具 TS action 是全名
// (add_track/add_keyframe/set_curve...),编码「子域+短动作」;GD 端按 method 分 handler
// (animation_track match add/remove;animation_keyframe match add/remove/update;animation_curve 无 action 分派)。
// 故需按 action 映射到不同 method,并用 transformArgs 把全名 action 转短名(add_track→add),
// 否则 editor 模式 method=animation_track 命中 GD :165 但 action match 只认 add/remove → -32004
// (非 -32601,不触发 headless 回退)→ animation_track editor 模式 6 action 全失效。
describe('editor-method-map animation_track routing', () => {
  it('maps add_track → animation_track method + action shortened to add', () => {
    const entry = resolveEditorMethod('animation_track', { action: 'add_track' });
    expect(entry?.method).toBe('animation_track');
    expect(entry?.transformArgs?.({ action: 'add_track', node_path: 'r/AP' })?.action).toBe('add');
  });
  it('maps remove_track → animation_track method + action shortened to remove', () => {
    const entry = resolveEditorMethod('animation_track', { action: 'remove_track' });
    expect(entry?.method).toBe('animation_track');
    expect(entry?.transformArgs?.({ action: 'remove_track' })?.action).toBe('remove');
  });
  it('maps add_keyframe → animation_keyframe method + action=add', () => {
    const entry = resolveEditorMethod('animation_track', { action: 'add_keyframe' });
    expect(entry?.method).toBe('animation_keyframe');
    expect(entry?.transformArgs?.({ action: 'add_keyframe' })?.action).toBe('add');
  });
  it('maps remove_keyframe → animation_keyframe method + action=remove', () => {
    const entry = resolveEditorMethod('animation_track', { action: 'remove_keyframe' });
    expect(entry?.method).toBe('animation_keyframe');
    expect(entry?.transformArgs?.({ action: 'remove_keyframe' })?.action).toBe('remove');
  });
  it('maps update_keyframe → animation_keyframe method + action=update', () => {
    const entry = resolveEditorMethod('animation_track', { action: 'update_keyframe' });
    expect(entry?.method).toBe('animation_keyframe');
    expect(entry?.transformArgs?.({ action: 'update_keyframe' })?.action).toBe('update');
  });
  it('maps set_curve → animation_curve method (no action transform; GD handle_animation_curve ignores action)', () => {
    const entry = resolveEditorMethod('animation_track', { action: 'set_curve' });
    expect(entry?.method).toBe('animation_curve');
    expect(entry?.transformArgs).toBeUndefined();
  });
  // 漂移检测：MAP 的 animation method 须与 command_handler.gd 分支一致
  it('animation editor methods match command_handler.gd branches (drift check)', () => {
    const gd = readFileSync(
      resolve(process.cwd(), 'addons/godot_mcp_server/command_handler.gd'),
      'utf8',
    );
    for (const method of ['animation_track', 'animation_keyframe', 'animation_curve']) {
      expect(gd, `command_handler.gd 缺少分支 "${method}":`).toContain(`"${method}":`);
    }
  });
});

// CRITICAL(2026-07-13 协议断链): export_* editor 模式死锁 — method fallback 'validation'
// → GD 无此 method -32601 → 回退 headless → test-framework 硬返 EDITOR_ONLY。登记后 editor
// 模式直走 GD export 分支。assert/stress 不登记(继续 headless,无死锁)。
describe('editor-method-map validation/export routing', () => {
  it('maps export_build → export_build method', () => {
    expect(resolveEditorMethod('validation', { action: 'export_build' })?.method).toBe('export_build');
  });
  it('maps export_list_presets / export_get_preset', () => {
    expect(resolveEditorMethod('validation', { action: 'export_list_presets' })?.method).toBe('export_list_presets');
    expect(resolveEditorMethod('validation', { action: 'export_get_preset' })?.method).toBe('export_get_preset');
  });
  it('assert/stress 未登记 → null (走 headless,无死锁)', () => {
    expect(resolveEditorMethod('validation', { action: 'assert' })).toBeNull();
    expect(resolveEditorMethod('validation', { action: 'stress' })).toBeNull();
  });
  it('export methods match command_handler.gd (drift check)', () => {
    const gd = readFileSync(resolve(process.cwd(), 'addons/godot_mcp_server/command_handler.gd'), 'utf8');
    for (const m of ['export_list_presets', 'export_get_preset', 'export_build']) {
      expect(gd, `command_handler.gd 缺少分支 "${m}":`).toContain(`"${m}":`);
    }
  });
});

// IMPORTANT(2026-07-13 协议断链): editor-method-map 漏 particles/nav/animtree/ui 族 →
// editor 模式 fallback toolName → -32601 → headless → GD 带 undo 分支成死代码,丢 editor 实时+undo。
// recording 不登记(GD editor 主动禁用 -32009,走 bridge)。headless-only action 不登记。
describe('editor-method-map runtime-tool routing (particles/nav/animtree/ui)', () => {
  it('particles: 5 action 1:1 同名', () => {
    for (const a of ['particles_create', 'particles_set_emission', 'particles_set_process', 'particles_load_preset', 'particles_set_material']) {
      expect(resolveEditorMethod('particles', { action: a })?.method).toBe(a);
    }
  });
  it('nav: action 加 nav_ 前缀映射; query_path 不登记(headless-only)', () => {
    expect(resolveEditorMethod('nav', { action: 'create_region' })?.method).toBe('nav_create_region');
    expect(resolveEditorMethod('nav', { action: 'bake_mesh' })?.method).toBe('nav_bake_mesh');
    expect(resolveEditorMethod('nav', { action: 'create_agent' })?.method).toBe('nav_create_agent');
    expect(resolveEditorMethod('nav', { action: 'set_params' })?.method).toBe('nav_set_params');
    expect(resolveEditorMethod('nav', { action: 'create_link' })?.method).toBe('nav_create_link');
    expect(resolveEditorMethod('nav', { action: 'query_path' })).toBeNull();
  });
  it('animtree: 5 action 同名; animtree_state_edit 不登记(headless-only)', () => {
    for (const a of ['animtree_create', 'animtree_add_state', 'animtree_add_transition', 'animtree_set_blend', 'animtree_play']) {
      expect(resolveEditorMethod('animtree', { action: a })?.method).toBe(a);
    }
    expect(resolveEditorMethod('animtree', { action: 'animtree_state_edit' })).toBeNull();
  });
  it('ui: 6 个 ui_*/theme_set_property 同名; ui_set_theme/theme_create 不登记(GD 聚合 action 契约不一致); draw_recipe/build_layout 不登记', () => {
    for (const a of ['ui_create_control', 'ui_set_layout', 'ui_get_layout', 'ui_anchor_preset', 'ui_container_add', 'theme_set_property']) {
      expect(resolveEditorMethod('ui', { action: a })?.method).toBe(a);
    }
    // ui_set_theme/theme_create: GD handler 读 action 做聚合子分派(create/set_params/save/load |
    // create/extract),与 TS 顶层 action 契约不一致 → 登记返 -32004 回归,故不登记
    expect(resolveEditorMethod('ui', { action: 'ui_set_theme' })).toBeNull();
    expect(resolveEditorMethod('ui', { action: 'theme_create' })).toBeNull();
    expect(resolveEditorMethod('ui', { action: 'ui_draw_recipe' })).toBeNull();
    expect(resolveEditorMethod('ui', { action: 'ui_build_layout' })).toBeNull();
  });
  it('recording 不登记(GD editor 禁用 -32009,走 bridge,登记会引入回归)', () => {
    expect(resolveEditorMethod('runtime', { action: 'record_start' })).toBeNull();
    expect(resolveEditorMethod('runtime', { action: 'record_play' })).toBeNull();
  });
  it('runtime-tool methods match command_handler.gd (drift check)', () => {
    const gd = readFileSync(resolve(process.cwd(), 'addons/godot_mcp_server/command_handler.gd'), 'utf8');
    for (const m of ['particles_create', 'particles_set_material', 'nav_create_region', 'nav_create_link', 'animtree_create', 'animtree_play', 'ui_create_control', 'theme_set_property']) {
      expect(gd, `command_handler.gd 缺少分支 "${m}":`).toContain(`"${m}":`);
    }
  });
});
