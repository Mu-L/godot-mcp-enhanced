import { describe, it, expect } from 'vitest';
import { TOOL_GROUPS, getGroupForTool } from '../src/core/tool-registry.js';

// 批次 D Task 1：D1 asset/android TOOL_GROUPS 补组（消除 isToolAllowed 恒 false 游离）
describe('D1 asset/android TOOL_GROUPS 补组（消除游离）', () => {
  it('TOOL_GROUPS 含 asset 与 android 组', () => {
    expect(TOOL_GROUPS.asset, 'asset 组缺失').toBeDefined();
    expect(TOOL_GROUPS.android, 'android 组缺失').toBeDefined();
    expect(TOOL_GROUPS.asset.tools).toContain('asset');
    expect(TOOL_GROUPS.android.tools).toContain('android');
  });

  it('getGroupForTool(asset/android) 返组名（toolToGroup reverse map 自动含）', () => {
    expect(getGroupForTool('asset')).toBe('asset');
    expect(getGroupForTool('android')).toBe('android');
  });

  it('asset requires editor（操作场景节点）；android requires []（spawn godot headless export，无 editor 连接）', () => {
    // android.ts:212 deploy = spawnGodot(--headless --export-*) + ctx.findGodot()，无 EditorConnection，
    // 故 requires:[] 对齐 dynamic/blender/multi_instance（process 类无连接依赖）。
    expect(TOOL_GROUPS.asset.requires).toContain('editor');
    expect(TOOL_GROUPS.android.requires).toEqual([]);
  });
});
