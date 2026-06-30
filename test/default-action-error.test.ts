// default-action-error.test.ts — 问题 1:工具 default action 须返回 UNKNOWN_ACTION error(非 null)
// 修复前:11 工具 default return null → 经 ToolDispatcher 兜底 HANDLER_NULL(不明确)+ 测试 callTool 假绿。
// 修复后:工具自报 UNKNOWN_ACTION(明确 + 一致)。
// 选代表工具(animtree/project/script)验证模式,11 工具同模式修复。
import { describe, it, expect } from 'vitest';
import { handleTool as animtreeHandle } from '../src/tools/animtree.js';
import { handleTool as projectHandle } from '../src/tools/project.js';
import { handleTool as scriptHandle } from '../src/tools/script.js';

const fakeCtx = { findGodot: async () => '/fake/godot' } as any;

describe('default action 返回 UNKNOWN_ACTION error(非 null)', () => {
  it('animtree: unknown action → error(非 null)', async () => {
    const r = await animtreeHandle('animtree', { action: 'totally_unknown_action', project_path: '/fake' }, fakeCtx);
    expect(r).not.toBe(null);
    expect(r?.isError).toBe(true);
  });

  it('project: unknown action → error(非 null)', async () => {
    const r = await projectHandle('project', { action: 'totally_unknown_action', project_path: '/fake' }, fakeCtx);
    expect(r).not.toBe(null);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('UNKNOWN_ACTION');
  });

  it('script: unknown action → error(非 null)', async () => {
    const r = await scriptHandle('script', { action: 'totally_unknown_action', project_path: '/fake' }, fakeCtx);
    expect(r).not.toBe(null);
    expect(r?.isError).toBe(true);
    expect(r?.content[0].text).toContain('UNKNOWN_ACTION');
  });
});
