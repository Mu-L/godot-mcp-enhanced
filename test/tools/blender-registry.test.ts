import { describe, it, expect } from 'vitest';
import { isToolAllowed, getGroupForTool, getAllToolDefinitions } from '../../src/core/tool-registry.js';
import { registerAllModules } from '../../src/module-loader.js';

// 触发注册：module-loader 仅定义 registerAllModules，不会在 import 时自动执行，
// 需显式调用（与 test/capability/guard-export.test.ts 等 17 个测试同模式）。
registerAllModules();

describe('blender tool registration', () => {
  it('blender is in TOOL_GROUPS under "blender" group', () => {
    expect(getGroupForTool('blender')).toBe('blender');
  });
  it('blender tool is allowed when blender group active', () => {
    expect(isToolAllowed('blender')).toBe(true);
  });
  it('blender tool definition registered with execute_bpy action', () => {
    const def = getAllToolDefinitions().find(t => t.name === 'blender');
    expect(def).toBeTruthy();
    expect((def!.inputSchema as any).properties.action.enum).toEqual(['execute_bpy']);
  });
});
