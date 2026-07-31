// A-12/A-13/A-14: scene_path 输入校验 + edit_node/remove_node 并发控制 + 回归测试
import { expect, it, beforeEach, afterEach, describe, vi } from 'vitest';
import { mockSuccessResult, mockSuccessSpawn } from './helpers/mock-results.js';

// Mock the executor — hoisted by Vitest
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(() => Promise.resolve(mockSuccessResult({
    outputs: [{ key: 'result', value: '{"ok":true}' }],
  }))),
  parseMcpMarkers: vi.fn((raw) => ({
    parsed: null,
    logLines: raw.split('\n').map((l) => l.trim()).filter(Boolean),
  })),
}));

// Task 3: edit_node 迁移 spawnGodot，mock 避免真 spawn
vi.mock('../src/tools/spawn-helper.js', () => ({
  spawnGodot: vi.fn(() => Promise.resolve(mockSuccessSpawn({
    stdout: "Node 'root/Root/SomeNode' edited successfully",
  }))),
}));

import * as scene from '../src/tools/scene.js';
import { createToolContext, createTempProject, registerCleanup } from './helpers/tool-context.js';
import { MINIMAL_PROJECT } from './helpers/fixtures.js';
import { resetState, getShortRunningCount, acquireShortRunningSlot, releaseShortRunningSlot } from '../src/core/process-state.js';
import { spawnGodot as mockSpawnGodot } from '../src/tools/spawn-helper.js';

describe('A-12: scene_path validation', () => {
  const dirRef = { path: null };
  let ctx;

  registerCleanup(dirRef);

  beforeEach(() => {
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
    ctx.findGodot = async () => 'godot';
  });

  // --- read_scene: missing scene_path ---
  it('read_scene — missing scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'read_scene',
    }, ctx);
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toContain('scene_path');
  });

  // --- read_scene: empty string scene_path ---
  it('read_scene — empty string scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'read_scene',
      scene_path: '',
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
  });

  // --- read_scene: non-string scene_path ---
  it('read_scene — numeric scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'read_scene',
      scene_path: 123,
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
  });

  // --- edit_node: missing scene_path ---
  it('edit_node — missing scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'edit_node',
      node_path: 'root/Root/SomeNode',
      properties: { position: [1, 2] },
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
    expect(result.content[0].text).toContain('scene_path');
  });

  // --- edit_node: null scene_path ---
  it('edit_node — null scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'edit_node',
      scene_path: null,
      node_path: 'root/Root/SomeNode',
      properties: { position: [1, 2] },
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
  });

  // --- remove_node: missing scene_path ---
  it('remove_node — missing scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'remove_node',
      node_path: 'root/Root/SomeNode',
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
    expect(result.content[0].text).toContain('scene_path');
  });

  // --- remove_node: empty string scene_path ---
  it('remove_node — empty string scene_path returns INVALID_PARAMS', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'remove_node',
      scene_path: '   ',
      node_path: 'root/Root/SomeNode',
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
  });
});

describe('A-13: edit_node/remove_node concurrency control', () => {
  const dirRef = { path: null };
  let ctx;

  registerCleanup(dirRef);

  beforeEach(() => {
    resetState();
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
    ctx.findGodot = async () => 'godot';
  });

  afterEach(() => {
    resetState();
  });

  // --- edit_node: slot acquired and released ---
  it('edit_node — acquires and releases slot on success', async () => {
    expect(getShortRunningCount()).toBe(0);
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/SomeNode',
      properties: { position: [1, 2] },
    }, ctx);
    // Slot should be released after completion
    expect(getShortRunningCount()).toBe(0);
    // Result should be successful (mock returns success)
    expect(result.isError).toBeFalsy();
  });

  // --- edit_node: slot released on validation error ---
  it('edit_node — releases slot when validation fails (no properties)', async () => {
    expect(getShortRunningCount()).toBe(0);
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/SomeNode',
      properties: {},
    }, ctx);
    // Slot should still be released even after validation error
    expect(getShortRunningCount()).toBe(0);
    expect(result.isError).toBe(true);
  });

  // --- edit_node: slot released on findGodot error ---
  it('edit_node — releases slot when findGodot throws', async () => {
    ctx.findGodot = async () => { throw new Error('Godot not found'); };
    expect(getShortRunningCount()).toBe(0);

    await expect(async () => {
      await scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'edit_node',
        scene_path: 'res://scenes/main.tscn',
        node_path: 'root/Root/SomeNode',
        properties: { position: [1, 2] },
      }, ctx);
    }).rejects.toThrow('Godot not found');

    expect(getShortRunningCount()).toBe(0);
  });

  // --- remove_node: slot acquired and released ---
  it('remove_node — acquires and releases slot on success', async () => {
    expect(getShortRunningCount()).toBe(0);
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'remove_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/SomeNode',
    }, ctx);
    expect(getShortRunningCount()).toBe(0);
    expect(result.isError).toBeFalsy();
  });

  // --- remove_node: slot released on findGodot error ---
  it('remove_node — releases slot when findGodot throws', async () => {
    ctx.findGodot = async () => { throw new Error('Godot not found'); };
    expect(getShortRunningCount()).toBe(0);

    await expect(async () => {
      await scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'remove_node',
        scene_path: 'res://scenes/main.tscn',
        node_path: 'root/Root/SomeNode',
      }, ctx);
    }).rejects.toThrow('Godot not found');

    expect(getShortRunningCount()).toBe(0);
  });

  // --- edit_node: blocked when slots exhausted ---
  it('edit_node — returns CONCURRENCY_LIMIT when all slots taken', async () => {
    // Fill all 3 slots
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    expect(getShortRunningCount()).toBe(3);

    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'edit_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/SomeNode',
      properties: { position: [1, 2] },
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('CONCURRENCY_LIMIT');

    // Clean up
    releaseShortRunningSlot();
    releaseShortRunningSlot();
    releaseShortRunningSlot();
  });

  // --- remove_node: blocked when slots exhausted ---
  it('remove_node — returns CONCURRENCY_LIMIT when all slots taken', async () => {
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    acquireShortRunningSlot();

    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'remove_node',
      scene_path: 'res://scenes/main.tscn',
      node_path: 'root/Root/SomeNode',
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('CONCURRENCY_LIMIT');

    releaseShortRunningSlot();
    releaseShortRunningSlot();
    releaseShortRunningSlot();
  });
});

describe('A-14: regression — findGodot failure releases slot (create_scene)', () => {
  const dirRef = { path: null };
  let ctx;

  registerCleanup(dirRef);

  beforeEach(() => {
    resetState();
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
  });

  afterEach(() => {
    resetState();
  });

  it('create_scene — findGodot failure releases slot', async () => {
    ctx.findGodot = async () => { throw new Error('No Godot binary'); };
    expect(getShortRunningCount()).toBe(0);

    await expect(async () => {
      await scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'create_scene',
        scene_path: 'res://scenes/test.tscn',
        root_node_type: 'Node2D',
      }, ctx);
    }).rejects.toThrow('No Godot binary');

    expect(getShortRunningCount()).toBe(0);
  });
});

// 2026-07-12 CRITICAL RCE 复合链修复：create_scene root_node_type 补字符校验
// 与 add_node/batch_add_nodes/quick_scene 的 ^[A-Za-z0-9_]+$ 对齐。
// 堵特殊字符注入（如 "Foo; rm -rf /" 透传到 godot_operations.gd）。
describe('RCE-chain fix: create_scene root_node_type validation', () => {
  const dirRef = { path: null };
  let ctx;

  registerCleanup(dirRef);

  beforeEach(() => {
    resetState();
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
    ctx.findGodot = async () => 'godot';
  });

  afterEach(() => {
    resetState();
  });

  it('rejects root_node_type with shell metacharacters (RCE injection)', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'create_scene',
      scene_path: 'res://scenes/test.tscn',
      root_node_type: 'Foo; rm -rf /',
    }, ctx);
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain('invalid characters');
    // slot 必须释放（校验失败不应泄漏）
    expect(getShortRunningCount()).toBe(0);
  });

  it('rejects root_node_type with path traversal', async () => {
    const result = await scene.handleTool('scene', {
      project_path: dirRef.path,
      action: 'create_scene',
      scene_path: 'res://scenes/test.tscn',
      root_node_type: '../etc/passwd',
    }, ctx);
    expect(result.content[0].text).toContain('invalid characters');
    expect(getShortRunningCount()).toBe(0);
  });

  it('accepts valid Node2D (regression — 合法值不受影响)', async () => {
    // 合法值会走 spawnGodot（mock 的 findGodot 返 'godot'，spawn 会失败但不影响校验测试）
    // 我们只验证校验通过（不返回 "invalid characters"）
    ctx.findGodot = async () => { throw new Error('spawn blocked in test'); };
    await expect(async () => {
      await scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'create_scene',
        scene_path: 'res://scenes/test.tscn',
        root_node_type: 'Node2D',
      }, ctx);
    }).rejects.toThrow('spawn blocked in test');
    expect(getShortRunningCount()).toBe(0);
  });

  it('accepts valid script class_name (PascalCase, regression)', async () => {
    ctx.findGodot = async () => { throw new Error('spawn blocked in test'); };
    await expect(async () => {
      await scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'create_scene',
        scene_path: 'res://scenes/test.tscn',
        root_node_type: 'MyCustomNode',
      }, ctx);
    }).rejects.toThrow('spawn blocked in test');
    expect(getShortRunningCount()).toBe(0);
  });
});

// P2-10（2026-07-31 补）：场景树并发竞争真测试。
// 看板指控：A-13 现有测试只断言 getShortRunningCount() 归 0（slot 计数），无 Promise.all 真并发
// 同场景竞争。现有 mock 的 spawnGodot 同步 resolve（:19-24），多个 edit_node 串行瞬间完成，
// 永远观察不到并发——即 slot 机制从未被真并发压力测试过。
//
// 本测试用 vi.mocked(spawnGodot).mockImplementation 注入延时版（50ms），发 Promise.all 3 个
// edit_node，在它们都 in-flight 时断言 getShortRunningCount()===3（证明真并发持 slot，非串行）。
// 再发第 4 个应被限流（CONCURRENCY_LIMIT），证明 MAX_SHORT_CONCURRENT=3 上限真生效。
//
// edit_node slot 持有窗：scene/index.ts:358 acquire → :381 await spawnGodot → :382 release。
// 延时让多个 spawnGodot 同时 pending → 多个 slot 同时被持有 → 真并发可观测。
describe('A-13b: edit_node 真并发竞争（P2-10）', () => {
  const dirRef = { path: null };
  let ctx;

  registerCleanup(dirRef);

  beforeEach(() => {
    resetState();
    dirRef.path = createTempProject(MINIMAL_PROJECT);
    ctx = createToolContext(dirRef.path);
    ctx.findGodot = async () => 'godot';
    // 延时版 spawnGodot：50ms 后才 resolve，让多个 edit_node 同时 in-flight 持 slot
    vi.mocked(mockSpawnGodot).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        stdout: "Node 'root/Root/SomeNode' edited successfully",
        stderr: '', output: '', exitCode: 0, timedOut: false,
      };
    });
  });

  afterEach(() => {
    // 还原为文件级 mock 的同步实现（默认 :19-24），避免污染其他 describe
    vi.mocked(mockSpawnGodot).mockImplementation(async () => ({
      stdout: "Node 'root/Root/SomeNode' edited successfully",
      stderr: '', output: '', exitCode: 0, timedOut: false,
    }));
    resetState();
  });

  it('3 个并发 edit_node → 同时持 slot（getShortRunningCount 峰值=3），全成功', async () => {
    expect(getShortRunningCount()).toBe(0);

    // 发 3 个并发 edit_node（不 await，让它们同时 in-flight）
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'edit_node',
        scene_path: 'res://scenes/main.tscn',
        node_path: 'root/Root/SomeNode',
        properties: { position: [i, 2] },
      }, ctx));
    }

    // 关键断言：3 个都 in-flight 时 slot 计数应为 3（真并发证据）。
    // 若 slot 机制是串行的（如误用 await 排队），此处会是 1 或 0。
    // 给一个 microtask 让 acquire 都执行完（spawnGodot 还在 50ms 延时内 pending）
    await new Promise((r) => setTimeout(r, 10));
    expect(getShortRunningCount(), '3 并发 in-flight 时应持 3 slot').toBe(3);

    // 等全部完成
    const results = await Promise.all(promises);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.isError, '并发 edit_node 不应失败').toBeFalsy();
    }
    // 完成后 slot 全释放
    expect(getShortRunningCount(), '完成后 slot 应全释放').toBe(0);
  });

  it('4 个并发 edit_node → 第 4 个被 CONCURRENCY_LIMIT 限流（MAX_SHORT_CONCURRENT=3）', async () => {
    expect(getShortRunningCount()).toBe(0);

    // 发 4 个并发 edit_node
    const promises = [];
    for (let i = 0; i < 4; i++) {
      promises.push(scene.handleTool('scene', {
        project_path: dirRef.path,
        action: 'edit_node',
        scene_path: 'res://scenes/main.tscn',
        node_path: 'root/Root/SomeNode',
        properties: { position: [i, 2] },
      }, ctx));
    }

    // 3 个 slot 被占后，第 4 个应立即被限流（acquireShortRunningSlot 返 false）
    await new Promise((r) => setTimeout(r, 10));
    expect(getShortRunningCount(), '前 3 个占满 slot，第 4 个被限流不入队').toBe(3);

    const results = await Promise.all(promises);

    // 前 3 个成功，第 4 个 CONCURRENCY_LIMIT（顺序不保证，按 isError + 文本分类）
    const successes = results.filter((r) => !r.isError);
    const limited = results.filter((r) => r.isError && r.content[0].text.includes('CONCURRENCY_LIMIT'));
    expect(successes.length, '前 3 个应成功').toBe(3);
    expect(limited.length, '第 4 个应被限流').toBe(1);

    expect(getShortRunningCount(), '完成后 slot 应全释放').toBe(0);
  });
});
