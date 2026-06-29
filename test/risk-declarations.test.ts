import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../src/core/module-loader.js';
import { getActionRisk } from '../src/core/tool-registry.js';

registerAllModules();

describe('scene actionRisks', () => {
  const cases: Record<string, 'read'|'write'|'destructive'|'process'> = {
    read_scene: 'read', query_scene_tree: 'read', inspect_node: 'read', health_check: 'read',
    create_scene: 'write', quick_scene: 'write', add_node: 'write', batch_add_nodes: 'write',
    edit_node: 'write', save_scene: 'write', load_sprite: 'write', instance_scene: 'write',
    set_instance_property: 'write', detach_instance: 'write', create_3d_node: 'write', commit: 'write',
    remove_node: 'destructive', merge_scene: 'destructive',
  };
  for (const [action, risk] of Object.entries(cases)) {
    it(`scene.${action} → ${risk}`, () => expect(getActionRisk('scene', action)).toBe(risk));
  }
});

describe('script actionRisks', () => {
  const cases = {
    read_script: 'read', write_script: 'write', edit_script: 'write',
    generate_test: 'write', create_test_scene: 'write',
    execute_gdscript: 'process', project_replace: 'destructive',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`script.${action} → ${risk}`, () => expect(getActionRisk('script', action)).toBe(risk));
  }
});

describe('animation actionRisks', () => {
  const cases = {
    list_players: 'read', get_info: 'read', get_details: 'read', get_keyframes: 'read',
    play: 'read', stop: 'read', seek: 'read', blend: 'read',
    ik_modifier_get: 'read', ik_list_bones: 'read',
    create: 'write', update_props: 'write', add_track: 'write', add_keyframe: 'write',
    update_keyframe: 'write', ik_modifier_create: 'write', ik_modifier_set: 'write',
    delete: 'destructive', remove_track: 'destructive', remove_keyframe: 'destructive',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`animation.${action} → ${risk}`, () => expect(getActionRisk('animation', action)).toBe(risk));
  }
});

describe('tilemap actionRisks', () => {
  const cases = {
    tilemap_read: 'read', tilemap_copy: 'read',
    tilemap_set_cell: 'write', tilemap_erase_cell: 'write', tilemap_fill_rect: 'write',
    tilemap_paste: 'write', tilemap_set_transform: 'write',
    tilemap_clear: 'destructive',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`tilemap.${action} → ${risk}`, () => expect(getActionRisk('tilemap', action)).toBe(risk));
  }
});
