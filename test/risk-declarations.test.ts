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

describe('material actionRisks', () => {
  const cases = {
    read: 'read', shader_read: 'read', shader_list_templates: 'read',
    set_params: 'write', create: 'write', save: 'write', load: 'write',
    shader_write: 'write', shader_load_file: 'write', shader_save_file: 'write', shader_apply_template: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`material.${action} → ${risk}`, () => expect(getActionRisk('material', action)).toBe(risk));
  }
});

describe('particles actionRisks', () => {
  const cases = {
    particles_create: 'write', particles_set_emission: 'write', particles_set_process: 'write',
    particles_load_preset: 'write', particles_set_material: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`particles.${action} → ${risk}`, () => expect(getActionRisk('particles', action)).toBe(risk));
  }
});

describe('signal actionRisks', () => {
  const cases = {
    signal_connect: 'read', signal_disconnect: 'read', signal_list: 'read', signal_emit: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`signal.${action} → ${risk}`, () => expect(getActionRisk('signal', action)).toBe(risk));
  }
});

describe('nav actionRisks', () => {
  const cases = {
    query_path: 'read', create_region: 'write', bake_mesh: 'write',
    create_agent: 'write', set_params: 'write', create_link: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`nav.${action} → ${risk}`, () => expect(getActionRisk('nav', action)).toBe(risk));
  }
});

describe('audio actionRisks', () => {
  const cases = {
    audio_play: 'read', audio_stop: 'read', audio_query: 'read', audio_set_param: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`audio.${action} → ${risk}`, () => expect(getActionRisk('audio', action)).toBe(risk));
  }
});

describe('ui actionRisks', () => {
  const cases = {
    ui_get_layout: 'read', ui_create_control: 'write', ui_set_layout: 'write',
    ui_anchor_preset: 'write', ui_set_theme: 'write', ui_container_add: 'write',
    ui_draw_recipe: 'write', ui_build_layout: 'write', theme_create: 'write', theme_set_property: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`ui.${action} → ${risk}`, () => expect(getActionRisk('ui', action)).toBe(risk));
  }
});

describe('physics actionRisks', () => {
  const cases = {
    raycast: 'read', body_info: 'read', diagnose: 'read', query_spatial: 'read', collision_overlay: 'write',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`physics.${action} → ${risk}`, () => expect(getActionRisk('physics', action)).toBe(risk));
  }
});
