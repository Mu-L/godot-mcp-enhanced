// TileSet 碰撞 op(tileset_physics_layer_add / tile_collision_set)handler 级安全校验(2026-08-19)。
// 两 op 经 ResourceSaver 写 .tres → tileset_path 是新增写盘参数,必须过项目内校验
// (memory: file-path-args-whitelist-blindspot——dispatcher 只校验根级字段,新增写路径必过
// resolveWithinRoot + 负向测试)。分层:
//   1. generateCommitScript 层浅校验(validateCommitOperations):res:// 前缀 + 明文 .. 段
//   2. handler 层纵深校验(resolveWithinRoot):URL 编码/symlink 等绕过浅校验的形态
// Mock 策略对齐 test/tools/scene-editor-scene-save-guard.test.ts(vi.hoisted + vi.mock + createToolContext)。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecuteGdscript, mockExists } = vi.hoisted(() => ({
  mockExecuteGdscript: vi.fn(),
  mockExists: vi.fn(() => true),
}));

vi.mock('../../src/gdscript-executor.js', () => ({ executeGdscript: mockExecuteGdscript }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockExists };
});

import { handleTool } from '../../src/tools/scene.js';
import { executeGdscript } from '../../src/gdscript-executor.js';
import { createToolContext, createTempProject, registerCleanup } from '../helpers/tool-context.js';
import { MINIMAL_PROJECT } from '../helpers/fixtures.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('scene commit tileset ops: tileset_path 项目内校验', () => {
  const dirRef: { path: string | null } = { path: null };
  let ctx: ReturnType<typeof createToolContext>;

  registerCleanup(dirRef);

  const execResult = (raw: string) => ({
    success: true, compile_success: true, compile_error: '',
    errors: [] as unknown[], run_success: true, run_error: '',
    outputs: [] as unknown[], raw_output: raw, duration_ms: 1, autoload_detected: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
    ctx.findGodot = async () => 'godot';
    mockExists.mockReturnValue(true);
  });

  const commitArgs = (operations: unknown[]): Record<string, unknown> => ({
    project_path: dirRef.path!,
    action: 'commit',
    scene_path: 'res://scenes/main.tscn',
    operations,
  });

  it('tileset_path 非 res:// 绝对路径 → INVALID_PARAMS(浅校验层拦截),不走 executeGdscript', async () => {
    const result = await handleTool('scene', commitArgs([
      { op: 'tileset_physics_layer_add', tileset_path: 'C:/Windows/evil.tres' },
    ]), ctx);

    const text = result.content?.[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toContain('res://');
    expect(executeGdscript).not.toHaveBeenCalled();
  });

  it('tileset_path URL 编码穿越(%2e%2e,文件存在)→ handler 层 resolveWithinRoot 兜底拦截', async () => {
    // validateCommitOperations 浅校验只查明文 '..' 段,%2e%2e 编码形态能过浅校验;
    // 构造字面名 '%2e%2e/outside.tres' 的真实文件(existsSync 通过 → 进 realpath 校验),
    // resolveWithinRoot 的 iterativeDecode 解码出 '..' 段后拒绝(删掉 handler 校验此测试即红)。
    mkdirSync(join(dirRef.path!, '%2e%2e'));
    writeFileSync(join(dirRef.path!, '%2e%2e', 'outside.tres'), '');

    const result = await handleTool('scene', commitArgs([
      { op: 'tileset_physics_layer_add', tileset_path: 'res://%2e%2e/outside.tres' },
    ]), ctx);

    const text = result.content?.[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toContain('escapes project root');
    expect(executeGdscript).not.toHaveBeenCalled();
  });

  it('tile_collision_set tileset_path 同样过校验(穿越拒绝)', async () => {
    const result = await handleTool('scene', commitArgs([
      { op: 'tile_collision_set', tileset_path: 'res://../evil.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
    ]), ctx);

    const text = result.content?.[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(text).toContain('INVALID_PARAMS');
    expect(executeGdscript).not.toHaveBeenCalled();
  });

  it('合法 res:// tileset_path(文件尚不存在)→ 校验放行透传,由 GD 侧 resource not found 守卫兜底', async () => {
    // existsSync 对目标 .tres 返回 false(其余路径保持 true 供 requireScenePath 等守卫)
    mockExists.mockImplementation((f: unknown) => !String(f).replace(/\\/g, '/').includes('assets/tiles.tres'));
    mockExecuteGdscript.mockResolvedValue(execResult(
      'COMMIT_RESULT: {"success":true,"saved":true,"results":[{"op":"tileset_physics_layer_add","ok":true,"layer_id":0}]}',
    ));

    const result = await handleTool('scene', commitArgs([
      { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres', collision_layer: 1 },
    ]), ctx);

    // executeGdscript 收到的脚本含碰撞 op 生成代码(端到端透传)
    expect(executeGdscript).toHaveBeenCalledTimes(1);
    const passedCode: string = mockExecuteGdscript.mock.calls[0]![0]?.code ?? '';
    expect(passedCode).toContain('add_physics_layer()');
    expect(passedCode).toContain('set_physics_layer_collision_layer(');
    expect(result.isError).toBeFalsy();
  });

  it('已存在的项目内 .tres → realpath 校验通过,正常透传', async () => {
    mkdirSync(join(dirRef.path!, 'assets'), { recursive: true });
    writeFileSync(join(dirRef.path!, 'assets', 'tiles.tres'), '');
    mockExecuteGdscript.mockResolvedValue(execResult(
      'COMMIT_RESULT: {"success":true,"saved":true,"results":[]}',
    ));

    const result = await handleTool('scene', commitArgs([
      { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' },
    ]), ctx);

    expect(executeGdscript).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
  });
});
