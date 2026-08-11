// 2026-08-11 P0-1: runtime_assert 4 action 行为测试
// 审查发现 assertNodeState/assertSceneStructure/assertScreenText/assertPerf 的 mismatch
// 计算零覆盖(仅 screenshot_diff 有 3 测试)。删掉 mismatch 逻辑不会让任何测试红 = 接线零验证
// (wiring-zero-verification-test-gap 教训复发)。本文件为 4 action 各补 happy/mismatch/error
// 路径,对齐 runtime-assert-screenshot-diff.test.ts 的 sendToBridge mock 范式。
//
// mock 策略:sendToBridge per-test mockResolvedValue,覆盖 4 action 的 bridge 调用:
//   node_state→get_node_properties / scene_structure→get_tree /
//   screen_text→find_ui_elements / perf→get_performance
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn(),
  setBridgeProjectDir: vi.fn(),
}));

import { sendToBridge } from '../src/tools/game-bridge.js';
import { handleTool } from '../src/tools/runtime-assert.js';

const mockedBridge = vi.mocked(sendToBridge);

/** handleTool 返回的 ToolResult.content[0].text 解析为对象。 */
function parse(result: unknown): Record<string, unknown> {
  const r = result as { content: Array<{ text: string }> };
  return JSON.parse(r.content[0]!.text);
}

beforeEach(() => mockedBridge.mockReset());

// ── node_state ──────────────────────────────────────────────────────────────

describe('runtime-assert node_state (P0-1)', () => {
  it('happy: 所有属性匹配 → passed:true', async () => {
    mockedBridge.mockResolvedValue({ result: { health: 100, name: 'Player' } });
    const r = await handleTool('runtime_assert', { action: 'node_state', path: '/root/Player', expect: { health: 100, name: 'Player' } }, {} as never);
    const p = parse(r);
    expect(p.success).toBe(true);
    expect(p.passed).toBe(true);
    expect(p.action).toBe('node_state');
    expect((p.details as Record<string, unknown>).properties_checked).toBe(2);
  });

  it('mismatch: 数值超容差 + 对象不等 → passed:false + mismatch', async () => {
    mockedBridge.mockResolvedValue({ result: { health: 50, position: { x: 1 } } });
    const r = await handleTool('runtime_assert', { action: 'node_state', path: '/root/Player', expect: { health: 100, position: { x: 0 } }, tolerance: 5 }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(false);
    expect((p.mismatch as Record<string, unknown>).health).toEqual({ expected: 100, actual: 50 });
    expect((p.mismatch as Record<string, unknown>).position).toEqual({ expected: { x: 0 }, actual: { x: 1 } });
  });

  it('error: bridge 返回 error → success:false + BRIDGE_ERROR', async () => {
    mockedBridge.mockResolvedValue({ error: { message: 'connection refused' } });
    const r = await handleTool('runtime_assert', { action: 'node_state', path: '/root/Player', expect: { health: 100 } }, {} as never);
    const p = parse(r);
    expect(p.success).toBe(false);
    expect(p.error_code).toBe('BRIDGE_ERROR');
  });

  it('error: 缺 path/expect → INVALID_PARAMS', async () => {
    const r = await handleTool('runtime_assert', { action: 'node_state' }, {} as never);
    const p = parse(r);
    expect(p.success).toBe(false);
    expect(p.error_code).toBe('INVALID_PARAMS');
  });
});

// ── scene_structure ─────────────────────────────────────────────────────────

describe('runtime-assert scene_structure (P0-1)', () => {
  it('happy: 期望存在的节点在树中 → passed:true', async () => {
    mockedBridge.mockResolvedValue({ result: { nodes: [{ path: '/root/Main/Player' }, { path: '/root/Main/Enemy' }] } });
    const r = await handleTool('runtime_assert', { action: 'scene_structure', nodes: [{ path: '/root/Main/Player' }] }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(true);
    expect((p.details as Record<string, unknown>).nodes_checked).toBe(1);
  });

  it('happy: 期望缺席的节点不在树中 → passed:true', async () => {
    mockedBridge.mockResolvedValue({ result: { nodes: [{ path: '/root/Main/Player' }] } });
    const r = await handleTool('runtime_assert', { action: 'scene_structure', nodes: [{ path: '/root/Main/Boss', absent: true }] }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(true);
  });

  it('mismatch: 期望存在但实际 absent → passed:false', async () => {
    mockedBridge.mockResolvedValue({ result: { nodes: [{ path: '/root/Main/Player' }] } });
    const r = await handleTool('runtime_assert', { action: 'scene_structure', nodes: [{ path: '/root/Main/Boss' }] }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(false);
    expect((p.mismatch as Record<string, unknown>)['/root/Main/Boss']).toEqual({ expected: 'present', actual: 'absent' });
  });

  it('error: 缺 nodes → INVALID_PARAMS', async () => {
    const r = await handleTool('runtime_assert', { action: 'scene_structure' }, {} as never);
    const p = parse(r);
    expect(p.success).toBe(false);
    expect(p.error_code).toBe('INVALID_PARAMS');
  });
});

// ── screen_text ─────────────────────────────────────────────────────────────

describe('runtime-assert screen_text (P0-1)', () => {
  it('happy: present=true 且文本找到 → passed:true', async () => {
    mockedBridge.mockResolvedValue({ result: [{ name: 'Label', text: 'Game Over' }] });
    const r = await handleTool('runtime_assert', { action: 'screen_text', text: 'Game Over' }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(true);
    expect((p.details as Record<string, unknown>).found).toBe(true);
  });

  it('happy: present=false 且文本未找到 → passed:true', async () => {
    mockedBridge.mockResolvedValue({ result: [{ name: 'Label', text: 'Hello' }] });
    const r = await handleTool('runtime_assert', { action: 'screen_text', text: 'Game Over', present: false }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(true);
    expect((p.details as Record<string, unknown>).found).toBe(false);
  });

  it('mismatch: present=true 但未找到 → passed:false', async () => {
    mockedBridge.mockResolvedValue({ result: [{ name: 'Label', text: 'Hello' }] });
    const r = await handleTool('runtime_assert', { action: 'screen_text', text: 'Game Over' }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(false);
    expect((p.mismatch as Record<string, unknown>).text).toEqual({ expected: 'present', actual: 'absent' });
  });

  it('error: 缺 text → INVALID_PARAMS', async () => {
    const r = await handleTool('runtime_assert', { action: 'screen_text' }, {} as never);
    const p = parse(r);
    expect(p.success).toBe(false);
    expect(p.error_code).toBe('INVALID_PARAMS');
  });
});

// ── perf ────────────────────────────────────────────────────────────────────

describe('runtime-assert perf (P0-1)', () => {
  it('happy: 指标在容差内 → passed:true', async () => {
    mockedBridge.mockResolvedValue({ result: { fps: 60, memory_mb: 100 } });
    const r = await handleTool('runtime_assert', { action: 'perf', baseline: { fps: 60, memory_mb: 100 } }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(true);
    expect((p.details as Record<string, unknown>).metrics_checked).toBe(2);
  });

  it('mismatch: 指标超默认 10% 容差 → passed:false (ratio=0.5)', async () => {
    mockedBridge.mockResolvedValue({ result: { fps: 30 } });
    const r = await handleTool('runtime_assert', { action: 'perf', baseline: { fps: 60 } }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(false);
    expect((p.mismatch as Record<string, unknown>).fps).toEqual({ expected: 60, actual: 30 });
  });

  it('mismatch: 指标缺失(actualVal 非 number)→ passed:false + actual=missing', async () => {
    mockedBridge.mockResolvedValue({ result: { fps: 60 } });
    const r = await handleTool('runtime_assert', { action: 'perf', baseline: { fps: 60, memory_mb: 100 } }, {} as never);
    const p = parse(r);
    expect(p.passed).toBe(false);
    expect((p.mismatch as Record<string, unknown>).memory_mb).toEqual({ expected: 100, actual: 'missing' });
  });

  it('error: 缺 baseline → INVALID_PARAMS', async () => {
    const r = await handleTool('runtime_assert', { action: 'perf' }, {} as never);
    const p = parse(r);
    expect(p.success).toBe(false);
    expect(p.error_code).toBe('INVALID_PARAMS');
  });
});
