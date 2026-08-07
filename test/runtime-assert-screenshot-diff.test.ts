// 2026-08-06 审查 P0/P1：runtime_assert screenshot_diff 占位返 NOT_IMPLEMENTED（非假阳性 pass）
// 锁定 known-limitation 行为，防回归到 success:true 假阳性占位。
//
// 背景：screenshot_diff 当前未实现真实相似度对比（需 frame-verify/gdscripts.ts referenceSimScript，
// 依赖 GDScript 执行器，超当前 scope）。2026-08-06 修复前返 pass()（success:true）致 agent 假阳性。
// 现改返 { success: false, error_code: 'NOT_IMPLEMENTED' }。
//
// 注：bridge action 走 mock，不真起 Godot。通过 handleTool 公开入口测（真实调用路径）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// runtime-assert 依赖 game-bridge 的 sendToBridge，需 mock
vi.mock('../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn().mockResolvedValue({ result: { image: 'base64-mock-screenshot-data' } }),
  setBridgeProjectDir: vi.fn(),
}));

import { handleTool } from '../src/tools/runtime-assert.js';

describe('runtime-assert screenshot_diff (P1 known-limitation, 2026-08-06 审查)', () => {
  const origPriv = process.env.GODOT_MCP_PRIVILEGED_GROUPS;
  beforeEach(() => { delete process.env.GODOT_MCP_PRIVILEGED_GROUPS; });
  afterEach(() => {
    if (origPriv === undefined) delete process.env.GODOT_MCP_PRIVILEGED_GROUPS;
    else process.env.GODOT_MCP_PRIVILEGED_GROUPS = origPriv;
  });

  it('reference 缺失 → INVALID_PARAMS', async () => {
    const result = await handleTool('runtime_assert', { action: 'screenshot_diff' }, {} as never);
    expect(result).not.toBeNull();
    const parsed = JSON.parse((result!.content[0] as { text: string }).text);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  it('截图成功后返 NOT_IMPLEMENTED（非 success:true 假阳性 pass）', async () => {
    // 注：P1 修复后即使截图成功，也不做相似度对比，返 NOT_IMPLEMENTED 让 agent 显式感知
    const result = await handleTool('runtime_assert', {
      action: 'screenshot_diff',
      reference: '/tmp/ref.png',
      threshold: 0.9,
    }, {} as never);
    expect(result).not.toBeNull();
    const parsed = JSON.parse((result!.content[0] as { text: string }).text);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('NOT_IMPLEMENTED');
    expect(parsed.screenshot_captured).toBe(true); // 截图本身成功
    // 确保不再返假阳性 pass
    expect(parsed.passed).not.toBe(true);
  });

  it('NOT_IMPLEMENTED 消息提示 P1 待实现', async () => {
    const result = await handleTool('runtime_assert', {
      action: 'screenshot_diff',
      reference: '/tmp/ref.png',
    }, {} as never);
    expect(result).not.toBeNull();
    const parsed = JSON.parse((result!.content[0] as { text: string }).text);
    expect(parsed.error).toMatch(/not implemented|Stage 0 placeholder/i);
  });
});
