import { describe, it, expect } from 'vitest';
import { isGuardedTool, requiresConfirmation } from '../../src/guard.js';
import { registerAllModules } from '../../src/core/module-loader.js';
import { getActionRisks } from '../../src/core/tool-registry.js';

// 注册所有模块的 actionRisks，供 isGuardedTool/requiresConfirmation 派生判定
registerAllModules();

describe('guard exports for capability matrix', () => {
  it('known guarded tools declare actionRisks with non-read levels', () => {
    // 核验基线：scene/script/runtime 的 actionRisks 已声明且含非 read 级别
    expect(getActionRisks('scene')?.remove_node).not.toBe('read');
    expect(getActionRisks('script')?.execute_gdscript).not.toBe('read');
    expect(getActionRisks('runtime')?.run_project).not.toBe('read');
  });

  it('isGuardedTool returns true for any tool with non-read action risk, false otherwise', () => {
    expect(isGuardedTool('scene')).toBe(true);
    expect(isGuardedTool('script')).toBe(true);
    expect(isGuardedTool('__nonexistent__')).toBe(false);
    // 只读工具无 actionRisks 或全 read
    expect(isGuardedTool('docs')).toBe(false);
  });

  it('requiresConfirmation still works unchanged (regression)', () => {
    expect(requiresConfirmation('scene', { action: 'remove_node' })).toBe(true);
    expect(requiresConfirmation('scene', { action: 'read_scene' })).toBe(false);
    expect(requiresConfirmation('docs', { action: 'get_class_info' })).toBe(false);
  });
});

describe('animation_track / animtree confirm gate (P0-2)', () => {
  // P0-2（批次 E commit 4bcb35a + 2026-08-10 续）：animation_track 的破坏性操作 + animtree 的
  // 写操作必须触发确认门（原全标 read 绕过确认是 bug）。
  it('animation_track destructive actions require confirmation, safe actions do not', () => {
    expect(requiresConfirmation('animation_track', { action: 'remove_track' })).toBe(true);
    expect(requiresConfirmation('animation_track', { action: 'remove_keyframe' })).toBe(true);
    expect(requiresConfirmation('animation_track', { action: 'update_keyframe' })).toBe(true);
    // 非破坏仍不确认
    expect(requiresConfirmation('animation_track', { action: 'add_track' })).toBe(false);
    expect(requiresConfirmation('animation_track', { action: 'add_keyframe' })).toBe(false);
  });

  it('animtree write actions require confirmation, play does not', () => {
    expect(requiresConfirmation('animtree', { action: 'animtree_create' })).toBe(true);
    expect(requiresConfirmation('animtree', { action: 'animtree_add_state' })).toBe(true);
    expect(requiresConfirmation('animtree', { action: 'animtree_add_transition' })).toBe(true);
    expect(requiresConfirmation('animtree', { action: 'animtree_set_blend' })).toBe(true);
    expect(requiresConfirmation('animtree', { action: 'animtree_state_edit' })).toBe(true);
    // play 运行时触发，不确认（对齐 animation-ops play=read）
    expect(requiresConfirmation('animtree', { action: 'animtree_play' })).toBe(false);
  });
});
