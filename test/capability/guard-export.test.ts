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
