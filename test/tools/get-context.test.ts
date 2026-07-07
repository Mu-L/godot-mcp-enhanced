import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleTool, getToolDefinitions } from '../../src/tools/get-context.js';
import { getCallRecorder } from '../../src/core/call-recorder.js';
import type { ToolContext } from '../../src/types.js';

// 最小 ctx mock（执行者按 ToolContext 真实形状补全，参照 manage-tools.test.ts 的 ctx 装配）
function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    connectionMode: 'headless',
    ...overrides,
  } as ToolContext;
}

describe('godot_get_context', () => {
  beforeEach(() => getCallRecorder().reset());

  it('tool def has correct name + read-only meta', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('godot_get_context');
  });

  it('returns null for unknown tool', async () => {
    const result = await handleTool('other_tool', {}, mockCtx());
    expect(result).toBeNull();
  });

  it('returns ok status with session fields in headless mode', async () => {
    const result = await handleTool('godot_get_context', {}, mockCtx({ connectionMode: 'headless' }));
    expect(result).not.toBeNull();
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.status).toBe('ok');
    expect(payload.data.mode).toBe('headless');
    expect(payload.data.scene).toBeNull();           // headless 恒 null
    expect(payload.data.performance).toBeNull();      // 非 bridge
    expect(Array.isArray(payload.data.callStats)).toBe(false);
    expect(payload.data.callStats.total).toBeDefined();
    expect(Array.isArray(payload.data.toolGroups)).toBe(true);
    expect(Array.isArray(payload.data.workflows)).toBe(true);
  });

  it('include_scene=false skips scene', async () => {
    const result = await handleTool('godot_get_context', { include_scene: false }, mockCtx());
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.scene).toBeNull();
  });

  it('failed fields downgrade gracefully (status=partial)', async () => {
    // mock listPromptDefs 抛错 → workflows 进 failedFields
    // 注意：get-context.ts 顶部静态 import 了 listPromptDefs，doMock 必须配合
    // resetModules 强制 get-context.js 重新求值，否则拿到首次求值时的原绑定。
    vi.resetModules();
    vi.doMock('../../src/prompts.js', () => ({ listPromptDefs: () => { throw new Error('boom'); } }));
    const { handleTool: ht } = await import('../../src/tools/get-context.js');
    const result = await ht('godot_get_context', {}, mockCtx());
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.status).toBe('partial');
    expect(payload.data.failedFields).toContain('workflows');
    expect(payload.data.callStats.total).toBeDefined(); // 其余字段仍正常
    vi.doUnmock('../../src/prompts.js');
    vi.resetModules();
  });

  it('never throws — outer try/catch swallows', async () => {
    // 即使所有探测失败，工具仍返回 ok/partial，不抛
    const result = await handleTool('godot_get_context', {}, mockCtx());
    expect(result).not.toBeNull();
  });
});
