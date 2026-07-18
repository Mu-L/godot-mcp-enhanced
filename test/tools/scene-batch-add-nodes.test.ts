// Task 5: batch_add_nodes failed_count>0 → quit(1) 非静默 — 单元测试
// 覆盖：
//   1. 部分失败：spawnGodot 返 exitCode=1 + stdout "Failed to add N nodes" → errorResult
//      （验证 GD 侧 quit(1) 后 TS index.ts:329 exitCode!=0 分支抓到部分失败，不再静默）
//   2. 全部成功：spawnGodot 返 exitCode=0 → 非 errorResult（对照组，确认 happy path 不退化）
//
// Mock 策略参照 test/tools/scene-edit-node.test.ts 的 vi.hoisted + vi.mock 模式。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSpawnGodot, mockExists } = vi.hoisted(() => ({
  mockSpawnGodot: vi.fn(),
  mockExists: vi.fn(() => true),
}));

// Mock spawnGodot（batch_add_nodes 路径）
vi.mock('../../src/tools/spawn-helper.js', () => ({ spawnGodot: mockSpawnGodot }));

// fs.existsSync 让 requireScenePath/early guards 通过
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockExists };
});

import { handleTool } from '../../src/tools/scene.js';
import { createToolContext, createTempProject, registerCleanup } from '../helpers/tool-context.js';
import { MINIMAL_PROJECT } from '../helpers/fixtures.js';

describe('batch_add_nodes failed_count>0 非静默（Task 5）', () => {
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

  it('Case 1: spawnGodot exitCode=1 + stdout "Failed to add N nodes" → errorResult（不再 exit 0 静默成功）', async () => {
    // GD 侧 failed_count>0 → log_error + scene_root.free() + quit(1) + return
    // TS scene/index.ts:329 if (exitCode !== 0) return errorResult(...)
    mockSpawnGodot.mockResolvedValue({
      stdout: 'Failed to add 1 nodes\nBatch add completed: 1/2 nodes added to res://scenes/main.tscn',
      stderr: '',
      output: '',
      exitCode: 1,
      timedOut: false,
    });

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'batch_add_nodes',
      scene_path: 'res://scenes/main.tscn',
      nodes: [
        { node_type: 'Node2D', node_name: 'GoodNode' },
        { node_type: 'Node2D', node_name: 'BadNode' },
      ],
    }, ctx);

    // 关键断言：exitCode=1 → errorResult（GD quit(1) 修了静默成功）
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toMatch(/exit code 1/);
    expect(text).toMatch(/Failed to add/);
  });

  it('Case 2: spawnGodot exitCode=0 + 全部成功 → 非 errorResult（对照组，happy path 不退化）', async () => {
    mockSpawnGodot.mockResolvedValue({
      stdout: 'Batch add completed: 2/2 nodes added to res://scenes/main.tscn',
      stderr: '',
      output: '',
      exitCode: 0,
      timedOut: false,
    });

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'batch_add_nodes',
      scene_path: 'res://scenes/main.tscn',
      nodes: [
        { node_type: 'Node2D', node_name: 'NodeA' },
        { node_type: 'Node2D', node_name: 'NodeB' },
      ],
    }, ctx);

    expect(result.isError).toBeFalsy();
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('2/2 nodes added');
  });
});
