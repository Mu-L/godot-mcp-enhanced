import { describe, it, expect, vi, beforeEach } from 'vitest';
import { genUiBuildLayoutScript, genSpacerLines } from '../src/tools/ui/ui-layout.js';
import { mockSuccessResult } from './helpers/mock-results.js';

const SUCCESS_RESULT = mockSuccessResult({
  outputs: [{ key: 'layout_built', value: '{"parent":"root"}' }],
});

vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => SUCCESS_RESULT),
  executeGdscriptTrusted: vi.fn(async () => SUCCESS_RESULT),
}));

import { handleTool as uiHandle } from '../src/tools/ui/index.js';

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

const TREE = (justify: string) => ({
  type: 'HBoxContainer', name: 'Row',
  layout: { direction: 'row' as const, justify: justify as 'space-between', gap: 0 },
  children: [
    { type: 'Button', name: 'A', properties: { text: 'A' } },
    { type: 'Button', name: 'B', properties: { text: 'B' } },
    { type: 'Button', name: 'C', properties: { text: 'C' } },
  ],
});

describe('justify space-* spacer 注入', () => {
  it('space-between 注入 N-1 个等比 spacer 且不再写 alignment 近似', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-between'));
    expect(s).toContain('_spacer_0');
    expect(s).toContain('_spacer_1');
    expect(s.match(/_spacer_\d/g)).toHaveLength(2);
    expect(s).toContain('node.size_flags_stretch_ratio = 1');
    expect(s).not.toMatch(/node\.alignment = 0/); // 旧近似(space-between→BEGIN)已移除
  });

  it('space-around 注入 2N 个 0.5 比例 spacer', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-around'));
    expect(s.match(/_spacer_\d/g)).toHaveLength(6); // 2N = 6
    expect(s).toContain('node.size_flags_stretch_ratio = 0.5');
  });

  it('space-evenly 注入 N+1 个等比 spacer', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-evenly'));
    expect(s.match(/_spacer_\d/g)).toHaveLength(4); // N+1 = 4
  });

  it('flex-start/center/flex-end 仍走 alignment,不注入 spacer', () => {
    for (const j of ['flex-start', 'center', 'flex-end']) {
      const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE(j));
      expect(s).not.toContain('_spacer_');
      expect(s).toMatch(/node\.alignment = \d/);
    }
  });

  it('spacer 节点带 SIZE_EXPAND 与 MOUSE_FILTER_IGNORE', () => {
    const s = genSpacerLines('_spacer_0', 0.5, true, '\t', 'root', '_saved_0');
    expect(s).toContain('node.size_flags_horizontal = Control.SIZE_EXPAND');
    expect(s).toContain('node.mouse_filter = Control.MOUSE_FILTER_IGNORE');
  });

  it('justify space-* 与子节点 flex.grow 并存时发 warning', () => {
    const tree = { ...TREE('space-between'), children: [
      { type: 'Button', name: 'A', flex: { grow: 1 } },
      { type: 'Button', name: 'B' },
    ] };
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', tree);
    expect(s).toContain('grow');
    expect(s).toContain('_mcp_output("warnings"');
  });
});

describe('ui_build_layout rect 支持', () => {
  // 注:求解语义为比例锚点(锚点承载 x/pw,offset=round 残差),故整数 rect 下 offset 恒为 0
  // (40/1280=0.03125 精确可表示);brief 草稿断言 offset_left=x 系笔误,已按 anchor-solver 单测语义修正。
  it('带 rect 的节点生成显式 anchors+offsets 赋值', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', rect: { x: 40, y: 30, w: 120, h: 48 } }],
    });
    expect(s).toContain('node.anchor_left = 0.03125');
    expect(s).toContain('node.offset_left = 0');
    expect(s).toContain('get_parent() is Container');
    // 守卫时序:rect 赋值必须在 add_child 之后(get_parent() 才有效,守卫真实判定)
    expect(s.indexOf('node.anchor_left = 0.03125')).toBeGreaterThan(s.indexOf('_saved_0.add_child(node)'));
  });

  it('rect 节点父为容器时发 warning 且生成运行时跳过守卫', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'HBoxContainer', name: 'Row', layout: { direction: 'row' as const },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 0, y: 0, w: 50, h: 50 } }],
    });
    expect(s).toContain('rect will be skipped');
    expect(s).toContain('get_parent() is Container');
    // 容器子路径(layout 分支递归)同样在 add_child 之后赋值,守卫对两条路径都真实生效
    expect(s.indexOf('node.anchor_left = 0')).toBeGreaterThan(s.indexOf('_saved_0.add_child(node)'));
  });

  it('rect 优先于 anchor_preset(同时提供时)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', anchor_preset: 'center', rect: { x: 10, y: 10, w: 20, h: 20 } }],
    });
    expect(s).toContain('node.anchor_left = 0.0078125');
    expect(s).not.toContain('set_anchors_preset');
  });

  it('根节点带 rect(父未知)也生成运行时守卫且不发 warning', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P', rect: { x: 0, y: 0, w: 1280, h: 720 },
    });
    expect(s).toContain('get_parent() is Container');
    expect(s).not.toContain('_mcp_output("warnings"');
    expect(s.indexOf('node.anchor_left = 0')).toBeGreaterThan(s.indexOf('parent.add_child(node)'));
  });

  it('自定义 viewport 参与求解(参数链透传)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', rect: { x: 400, y: 0, w: 200, h: 100 } }],
    }, { w: 1000, h: 800 });
    expect(s).toContain('node.anchor_left = 0.4');
  });
});

describe('ui_build_layout persist', () => {
  // 注:brief 原文 persist 写第 4 参,但第 4 参已被 viewport 占据(上方测试在用),
  // 按需以实际签名为准:persist 落第 5 参,默认 false。
  const tree = { type: 'VBoxContainer', name: 'Col', layout: { direction: 'column' as const }, children: [] };

  it('persist=true 生成 pack→tmp→rename 原子写块', () => {
    const s = genUiBuildLayoutScript('res://scenes/main.tscn', 'root', tree, undefined, true);
    expect(s).toContain('PackedScene.new()');
    expect(s).toContain('ResourceSaver.save(packed, _tmp)');
    expect(s).toContain('DirAccess.rename_absolute(_tmp, _full)');
    expect(s).toContain('DirAccess.remove_absolute(_tmp)');
    expect(s).toContain('_mcp_output("persist"');
  });

  it('默认不持久化(无 ResourceSaver)', () => {
    const s = genUiBuildLayoutScript('res://scenes/main.tscn', 'root', tree);
    expect(s).not.toContain('ResourceSaver');
  });

  it('persist=true: persist 块在 build 完成后、layout_built 输出之前', () => {
    const s = genUiBuildLayoutScript('res://scenes/main.tscn', 'root', tree, undefined, true);
    expect(s.indexOf('ResourceSaver.save')).toBeGreaterThan(s.indexOf('node.owner = root'));
    expect(s.indexOf('ResourceSaver.save')).toBeLessThan(s.indexOf('_mcp_output("layout_built"'));
  });
});

describe('ui_build_layout persist 与运行时丢失 warning 合并', () => {
  const tree = { type: 'VBoxContainer', name: 'Col', layout: { direction: 'column' as const }, children: [] };

  beforeEach(() => { vi.clearAllMocks(); });

  it('persist=true: 不 append 运行时丢失 warning(已原子写落盘)', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', action: 'ui_build_layout', scene_path: 'res://scene.tscn', parent_path: 'root', tree, persist: true },
      createMockCtx() as never,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const allText = (result!.content as Array<{ type: string; text?: string }>)
      .map(el => (el.type === 'text' ? el.text ?? '' : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  it('persist 未传: 仍 append 运行时丢失 warning(行为不变)', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', action: 'ui_build_layout', scene_path: 'res://scene.tscn', parent_path: 'root', tree },
      createMockCtx() as never,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const warning = (result!.content as Array<{ type: string; text?: string }>)
      .find((el, i) => i > 0 && el.type === 'text' && (el.text ?? '').includes('⚠'));
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('ui_build_layout');
  });
});
