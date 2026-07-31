import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { mockSuccessResult } from './helpers/mock-results.js';

// A3 测试需要捕获 executeGdscript 收到的 GDScript 片段, 断言含持久化回写(owner+pack+save)。
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => mockSuccessResult({ duration_ms: 1 })),
}));

import * as scene from '../src/tools/scene.js';
import { executeGdscript } from '../src/gdscript-executor.js';
const mockExecuteGdscript = executeGdscript;

describe('instance_scene tool definition', () => {
  it('should be registered via action (handleTool returns non-null for scene+instance_scene)', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'instance_scene',
      scene_path: 'res://main.tscn',
      // instance_path intentionally missing to trigger early error return
    }, { opsScript: '' });
    expect(result !== null).toBeTruthy();
  });

  it('should have tool definition with correct schema', () => {
    const defs = scene.getToolDefinitions();
    const def = defs[0];
    expect(def.name).toBe('scene');
    expect(def.inputSchema.properties.action.enum).toContain('instance_scene');
    expect(def.inputSchema.required).toContain('action');
    expect(def.inputSchema.properties.instance_path).toBeTruthy();
  });

  it('should reject missing instance_path', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'instance_scene',
      scene_path: 'res://main.tscn',
    }, { opsScript: '' });
    expect(result).toBeTruthy();
    expect(result.content[0].text.includes('error') || result.content[0].text.includes('Error')).toBeTruthy();
  });

  it('should reject self-referencing instance_path', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'instance_scene',
      scene_path: 'res://scenes/main.tscn',
      instance_path: 'res://scenes/main.tscn',
    }, { opsScript: '' });
    expect(result).toBeTruthy();
    expect(result.content[0].text).toContain('CIRCULAR');
  });
});

describe('instance_scene TOOL_META', () => {
  it('scene tool should be marked as write tool', () => {
    const meta = scene.TOOL_META;
    expect(meta['scene']).toBeTruthy();
    expect(meta['scene'].readonly).toBe(false);
  });
});

describe('set_instance_property tool definition', () => {
  it('should be registered via action', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'set_instance_property',
      scene_path: 'res://main.tscn',
      // node_path intentionally missing to trigger early error return
    }, { opsScript: '' });
    expect(result !== null).toBeTruthy();
  });

  it('should have action in schema', () => {
    const defs = scene.getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('set_instance_property');
    expect(defs[0].inputSchema.required).toEqual(['action']);
  });

  it('should be marked as write tool', () => {
    expect(scene.TOOL_META['scene'].readonly).toBe(false);
  });

  it('should reject missing required params', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'set_instance_property',
      scene_path: 'res://main.tscn',
    }, { opsScript: '' });
    expect(result).toBeTruthy();
    expect(result.content[0].text.includes('MISSING_PARAM') || result.content[0].text.includes('error')).toBeTruthy();
  });

  it('should reject blocked property names', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'set_instance_property',
      scene_path: 'res://main.tscn',
      node_path: 'root/Player',
      property: 'script',
      value: 'test',
    }, { opsScript: '' });
    expect(result).toBeTruthy();
    expect(result.content[0].text).toContain('BLOCKED_PROP');
  });

  it('should reject invalid property names', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'set_instance_property',
      scene_path: 'res://main.tscn',
      node_path: 'root/Player',
      property: 'invalid-name!',
      value: 'test',
    }, { opsScript: '' });
    expect(result).toBeTruthy();
    expect(result.content[0].text.includes('INVALID_PARAM') || result.content[0].text.includes('Invalid property')).toBeTruthy();
  });
});

describe('detach_instance tool definition', () => {
  it('should be registered via action', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'detach_instance',
      scene_path: 'res://main.tscn',
    }, { opsScript: '' });
    expect(result !== null).toBeTruthy();
  });

  it('should have action in schema', () => {
    const defs = scene.getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('detach_instance');
    expect(defs[0].inputSchema.required).toEqual(['action']);
  });

  it('should be marked as write tool', () => {
    const meta = scene.TOOL_META;
    expect(meta['scene']).toBeTruthy();
    expect(meta['scene'].readonly).toBe(false);
    expect(meta['scene'].long_running).toBe(true);
  });

  it('should reject missing node_path', async () => {
    const result = await scene.handleTool('scene', {
      project_path: '/tmp/test',
      action: 'detach_instance',
      scene_path: 'res://main.tscn',
    }, { opsScript: '' });
    expect(result).toBeTruthy();
    expect(result.content[0].text.includes('MISSING_PARAM') || result.content[0].text.includes('node_path')).toBeTruthy();
  });
});

describe('instance_scene / set_instance_property persistence (A3)', () => {
  let proj;
  beforeEach(() => {
    mockExecuteGdscript.mockClear();
    proj = mkdtempSync(join(tmpdir(), 'inst-scene-'));
    writeFileSync(join(proj, 'project.godot'), '; test\n');
  });
  afterEach(() => { try { rmSync(proj, { recursive: true, force: true }); } catch { /* ignore */ } });

  function makeCtx() {
    return { opsScript: '/fake/ops.gd', findGodot: vi.fn(async () => '/fake/godot') };
  }

  // A3 (2026-07-13 enhanced-vs-godogen 对比测试核实): instance_scene 修复前只运行时
  // _parent.add_child(_inst, true) 就 _mcp_done(), 完全没有 owner + PackedScene.pack() +
  // ResourceSaver.save() 回写 .tscn。进程退出实例丢失, set_instance_property 的
  // target.owner==root 检查恒 false → NODE_NOT_INSTANCE。对齐 add_node(godot_operations.gd:308-321)
  // 与 scene-commit.ts:118 的 pack+save 模式。
  it('instance_scene: generated script persists via owner+pack+save', async () => {
    await scene.handleTool('scene', {
      project_path: proj,
      action: 'instance_scene',
      scene_path: 'res://main.tscn',
      instance_path: 'res://enemy.tscn',
      parent_node_path: 'root',
    }, makeCtx());
    expect(mockExecuteGdscript).toHaveBeenCalledTimes(1);
    const code = mockExecuteGdscript.mock.calls[0][0].code;
    expect(code).toContain('_inst.owner');
    expect(code).toContain('PackedScene');
    expect(code).toMatch(/\.pack\(/);
    expect(code).toContain('ResourceSaver.save');
  });

  it('set_instance_property: generated script persists via pack+save', async () => {
    await scene.handleTool('scene', {
      project_path: proj,
      action: 'set_instance_property',
      scene_path: 'res://main.tscn',
      node_path: 'root/Enemy',
      property: 'position',
      value: { x: 1, y: 2, z: 3 },
    }, makeCtx());
    expect(mockExecuteGdscript).toHaveBeenCalledTimes(1);
    const code = mockExecuteGdscript.mock.calls[0][0].code;
    expect(code).toContain('PackedScene');
    expect(code).toMatch(/\.pack\(/);
    expect(code).toContain('ResourceSaver.save');
  });
});
