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
