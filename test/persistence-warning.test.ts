// C5 fix 回归测试：appendRuntimePersistWarning 必须不可变追加独立 content 元素，
// 不能 mutate content[0].text（parseGdscriptResult 返回 content[0] 是 JSON 字符串，
// 末尾追加 "\n⚠ ..." 会破坏 JSON.parse 消费契约——MCP 客户端用 JSON.parse(result.content[0].text)）。
//
// 防假绿：5 工具（audio/particles/signal/tilemap/animation）handleTool 成功路径必须：
//   1. content[0].text 仍是合法 JSON（JSON.parse 成功，且不含 ⚠）
//   2. content[1] 是独立 warning text（含 ⚠ + action 名）

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolResult } from '../src/types.js';

vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => ({
    success: true,
    compile_success: true,
    compile_error: '',
    errors: [],
    run_success: true,
    run_error: '',
    outputs: [{ key: 'result', value: '{"ok":true}' }],
    raw_output: '',
    duration_ms: 100,
  })),
}));

import { appendRuntimePersistWarning } from '../src/tools/shared/persistence-warning.js';
import { handleTool as audioHandle } from '../src/tools/audio-ops.js';
import { handleTool as particlesHandle } from '../src/tools/particles.js';
import { handleTool as signalHandle } from '../src/tools/signal-ops.js';
import { handleTool as tilemapHandle } from '../src/tools/tilemap-ops.js';
import { handleTool as animationHandle } from '../src/tools/animation/animation-ops.js';
import { handleTool as node3dHandle } from '../src/tools/node-3d-ops.js';
import { handleTool as physicsHandle } from '../src/tools/physics-ops.js';

function createMockCtx() {
  return {
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn(async () => '/fake/godot'),
    runningProcess: null,
    setRunningProcess: vi.fn(),
    outputBuffer: [],
    setOutputBuffer: vi.fn(),
    processStartTime: 0,
    setProcessStartTime: vi.fn(),
    projectDir: '/fake/project',
    setProjectDir: vi.fn(),
    parseGodotConfig: vi.fn(() => ({})),
  };
}

// ─── helper 单元测试 ─────────────────────────────────────────────────────────

describe('appendRuntimePersistWarning 不可变契约', () => {
  it('content[0] 不被 mutate（原 JSON 字符串仍可 JSON.parse）', () => {
    const original = '{"success":true,"data":{"ok":1}}';
    const input: ToolResult = {
      content: [{ type: 'text', text: original }],
    } as ToolResult;
    const out = appendRuntimePersistWarning(input, 'audio_play');
    // 原对象不被 mutate
    expect(input.content[0].text).toBe(original);
    expect(input.content.length).toBe(1);
    // 输出 content[0] 仍是合法 JSON
    expect(() => JSON.parse(out.content[0].text)).not.toThrow();
    expect(JSON.parse(out.content[0].text).success).toBe(true);
    // 输出追加了 content[1] warning
    expect(out.content.length).toBe(2);
    expect(out.content[1].type).toBe('text');
    expect(out.content[1].text).toContain('⚠');
    expect(out.content[1].text).toContain('audio_play');
  });

  it('isError=true 时不追加 warning（错误结果保持原样）', () => {
    const input: ToolResult = {
      isError: true,
      content: [{ type: 'text', text: '{"error":"FAILED"}' }],
    } as ToolResult;
    const out = appendRuntimePersistWarning(input, 'audio_play');
    expect(out.content.length).toBe(1);
    expect(out.content[0].text).toBe('{"error":"FAILED"}');
  });

  it('复用场景：连续两次调同一输入，原 content[0] 不被破坏（不可变关键）', () => {
    const original = '{"success":true}';
    const base: ToolResult = {
      content: [{ type: 'text', text: original }],
    } as ToolResult;
    const out1 = appendRuntimePersistWarning(base, 'particles_create');
    const out2 = appendRuntimePersistWarning(base, 'signal_connect');
    // base 对象始终未被 mutate
    expect(base.content[0].text).toBe(original);
    expect(base.content.length).toBe(1);
    // 两次输出各自独立
    expect(out1.content[1].text).toContain('particles_create');
    expect(out2.content[1].text).toContain('signal_connect');
    expect(out1).not.toBe(out2);
    expect(out1.content[0].text).toBe(original);
  });
});

// ─── 5 工具端到端 JSON.parse 契约 ────────────────────────────────────────────

describe('5 工具 handleTool 成功路径：content[0] 仍是合法 JSON + content[1] 是 warning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const cases = [
    {
      label: 'audio audio_play',
      handle: audioHandle,
      toolName: 'audio',
      args: { action: 'audio_play', project_path: '/fake/p', node_path: 'root/Audio', stream_path: 'res://sounds/bg.ogg' },
      expectAction: 'audio_play',
    },
    {
      label: 'particles particles_create',
      handle: particlesHandle,
      toolName: 'particles',
      args: { action: 'particles_create', project_path: '/fake/p', node_type: 'GPUParticles3D', name: 'Fire' },
      expectAction: 'particles_create',
    },
    {
      label: 'signal signal_connect',
      handle: signalHandle,
      toolName: 'signal',
      args: {
        action: 'signal_connect', project_path: '/fake/p',
        source_path: 'root/A', signal_name: 'hit', target_path: 'root/B', method_name: 'on_hit',
      },
      expectAction: 'signal_connect',
    },
    {
      label: 'tilemap tilemap_read',
      handle: tilemapHandle,
      toolName: 'tilemap',
      args: { action: 'tilemap_read', project_path: '/fake/p', node_path: 'root/Map' },
      expectAction: 'tilemap_read',
    },
    {
      label: 'animation list_players',
      handle: animationHandle,
      toolName: 'animation',
      args: { action: 'list_players', project_path: '/fake/p' },
      expectAction: 'animation_list_players',
    },
  ];

  for (const c of cases) {
    it(`${c.label}: content[0] 可 JSON.parse，content[1] 含 ⚠ + ${c.expectAction}`, async () => {
      const result = await c.handle(c.toolName, c.args, createMockCtx() as any);
      expect(result).not.toBeNull();
      expect(result!.isError).toBeFalsy();
      // 关键断言 1：content[0].text 必须是合法 JSON
      expect(typeof result!.content[0].text).toBe('string');
      const parsed = JSON.parse(result!.content[0].text); // 抛 SyntaxError 即测试失败
      expect(parsed).toBeTruthy();
      // 关键断言 2：content[0].text 不含 warning 标记（未被 mutate）
      expect(result!.content[0].text).not.toContain('⚠');
      expect(result!.content[0].text).not.toContain(c.expectAction);
      // 关键断言 3：content[1] 是独立 warning text
      expect(result!.content.length).toBeGreaterThanOrEqual(2);
      const warning = result!.content.find(
        (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
      );
      expect(warning).toBeDefined();
      expect(warning!.text).toContain(c.expectAction);
    });
  }
});

// ─── follow-up Task 1: node-3d 包装 ──────────────────────────────────────────

describe('follow-up: node-3d node_create_3d 包装', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('node_create_3d: content[0] 可 JSON.parse + content[1] 含 ⚠ + node_create_3d', async () => {
    const result = await node3dHandle(
      'node_create_3d',
      { project_path: '/fake/p', type: 'Node3D', name: 'TestNode' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    // content[0] 仍是合法 JSON，未被 mutate
    expect(() => JSON.parse(result!.content[0].text)).not.toThrow();
    expect(result!.content[0].text).not.toContain('⚠');
    // content[1] 是独立 warning
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('node_create_3d');
  });
});

// ─── follow-up Task 2: physics 包装 ──────────────────────────────────────────

describe('follow-up: physics collision_overlay 包装 + 只读 action 不加', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('physics collision_overlay（创造运行时节点树）: content[1] 含 ⚠ + physics_collision_overlay', async () => {
    const result = await physicsHandle(
      'physics',
      { project_path: '/fake/p', action: 'collision_overlay', parent_path: 'root' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    expect(() => JSON.parse(result!.content[0].text)).not.toThrow();
    expect(result!.content[0].text).not.toContain('⚠');
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('physics_collision_overlay');
  });

  // 反向（A3：只读 action 每 Set ≥2，防误加 Set 漏抓）
  it('physics raycast（只读）: 返回不含 ⚠', async () => {
    const result = await physicsHandle(
      'physics',
      { project_path: '/fake/p', action: 'raycast', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: -1, z: 0 } },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });

  it('physics query_spatial（只读）: 返回不含 ⚠', async () => {
    const result = await physicsHandle(
      'physics',
      { project_path: '/fake/p', action: 'query_spatial', center: { x: 0, y: 0, z: 0 } },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });
});
