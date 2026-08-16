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
