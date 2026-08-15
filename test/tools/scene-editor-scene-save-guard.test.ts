// Task 6: index.ts edit_node/batch headless fallback 路径加 checkEditorSceneSave 守卫
// （spec editor-version-tear §6）。覆盖：
//   1. edit_node: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 spawnGodot（finally 自动 release slot）
//   2. batch_add_nodes: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 spawnGodot（手动 release slot）
//
// 批 F (2026-08-14) 追加 scene.commit（headless spawn 写盘路径）同款守卫 + 保存失败假成功：
//   F-1: commit: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 executeGdscript；守卫放行 → 正常执行
//   F-2: commit: 请求保存但写盘失败(saved:false,如 EACCES/ENOSPC) → 顶层 isError=true；
//       save=false 时 saved:false 是预期(未请求保存) → 不置 isError
//
// Mock 策略对齐 test/tools/scene-edit-node.test.ts 的 vi.hoisted + vi.mock + createToolContext 模式。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSpawnGodot, mockExecuteGdscript, mockExists } = vi.hoisted(() => ({
  mockSpawnGodot: vi.fn(),
  mockExecuteGdscript: vi.fn(),
  mockExists: vi.fn(() => true),
}));

// Mock spawnGodot（不应被调:守卫前置阻断）
vi.mock('../../src/tools/spawn-helper.js', () => ({ spawnGodot: mockSpawnGodot }));

// Mock executeGdscript（scene.commit 走此路径;守卫拦截场景不应被调）
vi.mock('../../src/gdscript-executor.js', () => ({ executeGdscript: mockExecuteGdscript }));

// fs.exists let requireScenePath/early guards 通过
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockExists };
});

import { handleTool } from '../../src/tools/scene.js';
import { spawnGodot } from '../../src/tools/spawn-helper.js';
import { executeGdscript } from '../../src/gdscript-executor.js';
import { createToolContext, createTempProject, registerCleanup } from '../helpers/tool-context.js';
import { MINIMAL_PROJECT } from '../helpers/fixtures.js';

describe('scene edit_node/batch editor-scene-save 守卫（Task 6, spec editor-version-tear §6）', () => {
  const dirRef: { path: string | null } = { path: null };
  let ctx: ReturnType<typeof createToolContext>;

  registerCleanup(dirRef);

  beforeEach(() => {
    vi.clearAllMocks();
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
    ctx.findGodot = async () => 'godot';
    mockExists.mockReturnValue(true);
  });

  it('edit_node: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 spawnGodot', async () => {
    const checkEditorSceneSave = vi.fn().mockResolvedValue({
      blocked: true,
      message: 'Scene open in editor: res://scenes/main.tscn',
    });
    (ctx as any).checkEditorSceneSave = checkEditorSceneSave;

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: { position: [1, 2] },
    }, ctx);

    // 守卫被调
    expect(checkEditorSceneSave).toHaveBeenCalledTimes(1);
    // 返 EDITOR_SCENE_OPEN
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('EDITOR_SCENE_OPEN');
    // 不走 spawnGodot（守卫前置阻断）
    expect(spawnGodot).not.toHaveBeenCalled();
    // 不返 happy path（isError 应为 true,errorResult 返的）
    expect(result.isError).toBe(true);
  });

  it('batch_add_nodes: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 spawnGodot', async () => {
    const checkEditorSceneSave = vi.fn().mockResolvedValue({
      blocked: true,
      message: 'Scene open in editor: res://scenes/main.tscn',
    });
    (ctx as any).checkEditorSceneSave = checkEditorSceneSave;

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'batch_add_nodes',
      scene_path: 'res://scenes/main.tscn',
      nodes: [{ node_type: 'Node2D', node_name: 'N1' }],
    }, ctx);

    // 守卫被调
    expect(checkEditorSceneSave).toHaveBeenCalledTimes(1);
    // 返 EDITOR_SCENE_OPEN
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('EDITOR_SCENE_OPEN');
    // 不走 spawnGodot（守卫前置阻断）
    expect(spawnGodot).not.toHaveBeenCalled();
    // 不返 happy path
    expect(result.isError).toBe(true);
  });
});

describe('scene commit editor-scene-save 守卫 + 保存失败假成功（批 F, 2026-08-14）', () => {
  const dirRef: { path: string | null } = { path: null };
  let ctx: ReturnType<typeof createToolContext>;

  registerCleanup(dirRef);

  /** executeGdscript 成功返回结构（raw 为 Godot stdout） */
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

  const commitArgs = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    project_path: dirRef.path!,
    action: 'commit',
    scene_path: 'res://scenes/main.tscn',
    operations: [{ op: 'node_property', path: 'Root', property: 'position', value: { x: 1, y: 2 } }],
    ...over,
  });

  it('F-1: commit 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 executeGdscript', async () => {
    const checkEditorSceneSave = vi.fn().mockResolvedValue({
      blocked: true,
      message: 'Scene open in editor: res://scenes/main.tscn',
    });
    (ctx as any).checkEditorSceneSave = checkEditorSceneSave;
    mockExecuteGdscript.mockResolvedValue(execResult('COMMIT_RESULT: {"success":true,"saved":true,"results":[]}'));

    const result = await handleTool('scene', commitArgs(), ctx);

    // 守卫被调
    expect(checkEditorSceneSave).toHaveBeenCalledTimes(1);
    // 返 EDITOR_SCENE_OPEN
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('EDITOR_SCENE_OPEN');
    // 不走 executeGdscript（守卫前置阻断,不 spawn headless 写盘）
    expect(executeGdscript).not.toHaveBeenCalled();
    // 不返 happy path
    expect(result.isError).toBe(true);
  });

  it('F-1: 编辑器未打开场景（守卫放行）→ commit 正常执行 executeGdscript', async () => {
    const checkEditorSceneSave = vi.fn().mockResolvedValue({ blocked: false });
    (ctx as any).checkEditorSceneSave = checkEditorSceneSave;
    mockExecuteGdscript.mockResolvedValue(execResult('COMMIT_RESULT: {"success":true,"saved":true,"results":[]}'));

    const result = await handleTool('scene', commitArgs(), ctx);

    // 守卫被调且放行
    expect(checkEditorSceneSave).toHaveBeenCalledTimes(1);
    // headless 写盘路径正常执行
    expect(executeGdscript).toHaveBeenCalledTimes(1);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('"saved": true');
    expect(result.isError).toBeFalsy();
  });

  it('F-2: 请求保存但写盘失败（saved:false,如 EACCES/ENOSPC）→ isError=true 且 success:false', async () => {
    // GDScript 侧 ResourceSaver.save/DirAccess.rename 失败 → err != OK → saved:false
    mockExecuteGdscript.mockResolvedValue(execResult(
      'COMMIT_RESULT: {"success":false,"saved":false,"results":[{"op":"node_property","path":"Root","ok":true}]}',
    ));

    const result = await handleTool('scene', commitArgs(), ctx);

    // 顶层不再假成功:isError 让 middleware/AI 把写盘失败当失败
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('"success": false');
    expect(text).toContain('"saved": false');
  });

  it('F-2: save=false 时 saved:false 是预期（未请求保存）→ 不置 isError', async () => {
    // 注意:此 mock 是 saveBlock(save=false) 正常完成形态 success:true——isError 条件是
    // success 驱动(批F fix),saved:false 单独不足以触发;若改成 saved 驱动该测试会暴露误报。
    mockExecuteGdscript.mockResolvedValue(execResult('COMMIT_RESULT: {"success":true,"saved":false,"results":[]}'));

    const result = await handleTool('scene', commitArgs({ save: false }), ctx);

    // 守卫条件是 commitResult?.success === false;未请求保存且正常完成不触发
    expect(result.isError).toBeFalsy();
  });

  it('F-2 fix: save=false + stopOnError 中止（stopBlock 真失败）→ isError=true', async () => {
    // corner(批F审查): stopOnError=true + op 失败中止时 GD 侧 stopBlock 输出
    // {"success": false, "saved": false, "error_count": N}——真失败,不因 save=false 被排除。
    mockExecuteGdscript.mockResolvedValue(execResult(
      'COMMIT_RESULT: {"success":false,"saved":false,"error_count":1,"results":[{"op":"node_property","path":"Root","ok":false,"error":"Node not found"}]}',
    ));

    const result = await handleTool('scene', commitArgs({ save: false }), ctx);

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('"success": false');
    expect(text).toContain('"error_count": 1');
  });

  it('F-2 回归: 保存成功（saved:true）→ 不置 isError', async () => {
    mockExecuteGdscript.mockResolvedValue(execResult('COMMIT_RESULT: {"success":true,"saved":true,"results":[]}'));

    const result = await handleTool('scene', commitArgs(), ctx);

    expect(result.isError).toBeFalsy();
  });
});
