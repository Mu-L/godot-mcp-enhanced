// Task 3: edit_node 迁移 godot_operations.gd 持久化 — 单元测试
// 覆盖：
//   1. 成功路径：spawnGodot 返 exitCode=0 + stdout 含 "edited successfully" → 工具返成功
//   2. 失败路径：spawnGodot 返 exitCode=1 → errorResult（不再走 executeGdscript 30s 超时）
//   3. BLOCKED_PROPS（script） → 返 ⚠️ 警告
//   4. 关键断言：edit_node 不再调 executeGdscript（迁移核心验证）
//
// Mock 策略参照 test/android.test.ts 的 vi.hoisted + vi.mock 模式。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSpawnGodot, mockExecuteGdscript, mockExists } = vi.hoisted(() => ({
  mockSpawnGodot: vi.fn(),
  mockExecuteGdscript: vi.fn(),
  mockExists: vi.fn(() => true),
}));

// Mock spawnGodot（edit_node 新路径）
vi.mock('../../src/tools/spawn-helper.js', () => ({ spawnGodot: mockSpawnGodot }));

// Mock executeGdscript（edit_node 旧路径，不应再被调）
vi.mock('../../src/gdscript-executor.js', () => ({
  executeGdscript: mockExecuteGdscript,
  parseMcpMarkers: vi.fn((raw: string) => ({
    parsed: null,
    logLines: raw.split('\n').map((l) => l.trim()).filter(Boolean),
  })),
}));

// fs.existsSync 让 requireScenePath/early guards 通过
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockExists };
});

import { handleTool } from '../../src/tools/scene.js';
import { spawnGodot } from '../../src/tools/spawn-helper.js';
import { executeGdscript } from '../../src/gdscript-executor.js';
import { createToolContext, createTempProject, registerCleanup } from '../helpers/tool-context.js';
import { MINIMAL_PROJECT } from '../helpers/fixtures.js';

describe('edit_node 迁移 godot_operations.gd（Task 3）', () => {
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

  it('Case 1: spawnGodot exitCode=0 + stdout "edited successfully" → 工具返成功（非 errorResult）', async () => {
    mockSpawnGodot.mockResolvedValue({
      stdout: "Node 'root/Root/MovableNode' edited successfully",
      stderr: '',
      output: '',
      exitCode: 0,
      timedOut: false,
    });

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: { position: [100, 200] },
    }, ctx);

    expect(result.isError).toBeFalsy();
    const text = result.content?.[0]?.text ?? '';
    expect(text).toContain('edited successfully');
    // 关键断言：spawnGodot 被调用，第一个参数是 godot 路径
    expect(spawnGodot).toHaveBeenCalledTimes(1);
    const callArgs = (spawnGodot as any).mock.calls[0];
    // 第三个 argv 元素应是 'edit_node'（--headless / --path / --script / edit_node / json）
    expect(callArgs[1]).toEqual(expect.arrayContaining(['--script', 'edit_node']));
    // JSON 参数应含 scene_path/node_path/properties
    const jsonArg = callArgs[1].find((a: string) => a.startsWith('{'));
    const parsed = JSON.parse(jsonArg);
    expect(parsed).toHaveProperty('scene_path');
    expect(parsed).toHaveProperty('node_path');
    expect(parsed).toHaveProperty('properties');
  });

  it('Case 2: spawnGodot exitCode=1 → errorResult（不再走 executeGdscript 30s 超时路径）', async () => {
    mockSpawnGodot.mockResolvedValue({
      stdout: '',
      stderr: 'boom',
      output: '',
      exitCode: 1,
      timedOut: false,
    });

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: { position: [1, 2] },
    }, ctx);

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toMatch(/exit code 1/);
  });

  it('Case 3: properties 含 script（BLOCKED_PROPS）→ GD 侧拒绝 exit 1 透传 error(审查 M-2: 不可达警告分支已删)', async () => {
    // 审查 M-2(2026-09-03): 原 TS 前置收集 BLOCKED_PROPS + 成功路径 ⚠️ 警告分支不可达(blocked 在
    // GD 侧 _is_safe_property 拒 → failed → exit 1 → error 路径先返回),已删——本 Case 改锚定真实
    // 行为:mock 对齐真实通道(log_error 走 stderr,原 mock 把成功 stdout 配 blocked 场景不真实)。
    mockSpawnGodot.mockResolvedValue({
      stdout: '',
      stderr: 'ERROR: Blocked property: script\nERROR: Note: successful property changes are already persisted (1 failed); query_scene_tree before retrying to avoid duplicates.',
      output: '',
      exitCode: 1,
      timedOut: false,
    });

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: { script: 'res://scripts/main.gd', position: [1, 2] },
    }, ctx);

    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? '';
    expect(text).toMatch(/exit code 1/);
    expect(text, 'I-A: stderr 详情拼进错误文本').toContain('Blocked property: script');
    expect(text, 'Minor-1: 部分失败重试防重复提示').toContain('already persisted');
    // spawnGodot 仍被调(TS 不剥离 properties,GD _is_safe_property 过滤——双层防御语义不变)
    expect(spawnGodot).toHaveBeenCalledTimes(1);
  });

  it('Case 4（核心迁移断言）: edit_node 不再调 executeGdscript', async () => {
    mockSpawnGodot.mockResolvedValue({
      stdout: "Node 'root/Root/MovableNode' edited successfully",
      stderr: '',
      output: '',
      exitCode: 0,
      timedOut: false,
    });

    await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: { position: [1, 2] },
    }, ctx);

    // 迁移核心：edit_node 不应再调 executeGdscript（旧 30s 超时路径已废弃）
    expect(executeGdscript).not.toHaveBeenCalled();
  });

  it('Case 5: spawnGodot SPAWN_FAILED → errorResult 含 SPAWN_FAILED', async () => {
    mockSpawnGodot.mockResolvedValue({
      stdout: 'SPAWN_FAILED: ENOENT godot',
      stderr: '',
      output: '',
      exitCode: -1,
      timedOut: false,
    });

    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: { position: [1, 2] },
    }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text ?? '').toContain('SPAWN_FAILED');
  });

  it('Case 6: 空 properties → INVALID_PARAMS（spawnGodot 不应被调）', async () => {
    const result = await handleTool('scene', {
      project_path: dirRef.path!,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/MovableNode',
      properties: {},
    }, ctx);

    const text = result.content?.[0]?.text ?? '';
    expect(text).toMatch(/INVALID_PARAMS|properties.*non-empty/);
    expect(spawnGodot).not.toHaveBeenCalled();
  });
});
