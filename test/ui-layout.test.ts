import { describe, it, expect } from 'vitest';
import { genUiBuildLayoutScript, genSpacerLines } from '../src/tools/ui/ui-layout.js';

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
  });

  it('rect 节点父为容器时发 warning 且生成运行时跳过守卫', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'HBoxContainer', name: 'Row', layout: { direction: 'row' as const },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 0, y: 0, w: 50, h: 50 } }],
    });
    expect(s).toContain('rect will be skipped');
    expect(s).toContain('get_parent() is Container');
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
  });

  it('自定义 viewport 参与求解(参数链透传)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', rect: { x: 400, y: 0, w: 200, h: 100 } }],
    }, { w: 1000, h: 800 });
    expect(s).toContain('node.anchor_left = 0.4');
  });
});
