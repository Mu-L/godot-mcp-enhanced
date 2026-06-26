import { describe, it, expect } from 'vitest';
import { GUARDED, isGuardedTool, requiresConfirmation } from '../../src/guard.js';

describe('guard exports for capability matrix', () => {
  it('GUARDED is exported with known guarded tools', () => {
    // 核验基线：guard.ts:52-68 注册了 scene/script/animation/tilemap/game/runtime
    expect(GUARDED['scene']).toBeInstanceOf(Set);
    expect(GUARDED['script']).toBeInstanceOf(Set);
    expect(GUARDED['runtime']).toBeInstanceOf(Set);
  });

  it('isGuardedTool returns true for any tool with guard config, false otherwise', () => {
    expect(isGuardedTool('scene')).toBe(true);     // Set 配置
    expect(isGuardedTool('script')).toBe(true);
    expect(isGuardedTool('__nonexistent__')).toBe(false);
    // 只读工具不在 GUARDED
    expect(isGuardedTool('docs')).toBe(false);
  });

  it('requiresConfirmation still works unchanged (regression)', () => {
    expect(requiresConfirmation('scene', { action: 'remove_node' })).toBe(true);
    expect(requiresConfirmation('scene', { action: 'read_scene' })).toBe(false);
    expect(requiresConfirmation('docs', { action: 'get_class_info' })).toBe(false);
  });
});
