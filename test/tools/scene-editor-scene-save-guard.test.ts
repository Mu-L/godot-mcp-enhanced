// Task 6: index.ts edit_node/batch headless fallback 路径加 checkEditorSceneSave 守卫
// （spec editor-version-tear §6）。覆盖：
//   1. edit_node: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 spawnGodot（finally 自动 release slot）
//   2. batch_add_nodes: 场景在 editor 打开 → 返 EDITOR_SCENE_OPEN, 不走 spawnGodot（手动 release slot）
//
// Mock 策略对齐 test/tools/scene-edit-node.test.ts 的 vi.hoisted + vi.mock + createToolContext 模式。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSpawnGodot, mockExists } = vi.hoisted(() => ({
  mockSpawnGodot: vi.fn(),
  mockExists: vi.fn(() => true),
}));

// Mock spawnGodot（不应被调:守卫前置阻断）
vi.mock('../../src/tools/spawn-helper.js', () => ({ spawnGodot: mockSpawnGodot }));

// fs.exists let requireScenePath/early guards 通过
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockExists };
});

import { handleTool } from '../../src/tools/scene.js';
import { spawnGodot } from '../../src/tools/spawn-helper.js';
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
