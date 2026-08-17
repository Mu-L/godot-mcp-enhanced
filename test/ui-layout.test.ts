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
  // 注:求解语义为比例锚点(锚点承载 x/pw,offset=round 残差),故整除 rect 下 offset 恒为 0;
  // C1 修正后基准为**父尺寸**:根相对 viewport,子相对父 rect.w/h(不再恒用 viewport)。
  it('子 rect 相对父 rect 尺寸求解(父 600x400,子 x=150 → anchor 0.25)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P', rect: { x: 0, y: 0, w: 600, h: 400 },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 150, y: 200, w: 300, h: 100 } }],
    });
    expect(s).toContain('node.anchor_left = 0.25');   // 150/600(父 rect.w,非 1280)
    expect(s).toContain('node.anchor_top = 0.5');     // 200/400
    expect(s).toContain('node.anchor_right = 0.75');  // 450/600
    expect(s).toContain('node.offset_left = 0');
    expect(s).toContain('get_parent() is Container');
    // 守卫时序:rect 赋值必须在 add_child 之后(get_parent() 才有效,守卫真实判定)
    expect(s.indexOf('node.anchor_left = 0.25')).toBeGreaterThan(s.indexOf('_saved_0.add_child(node)'));
  });

  it('父节点无 rect(非根)→ 降级 viewport 求解并推 unknown warning', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', rect: { x: 40, y: 30, w: 120, h: 48 } }],
    });
    expect(s).toContain("parent's size is unknown");
    expect(s).toContain('node.anchor_left = 0.03125'); // 40/1280(viewport 兜底)
  });

  it('rect 节点父为容器时发 skipped warning 且不再叠加 unknown warning', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'HBoxContainer', name: 'Row', layout: { direction: 'row' as const },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 0, y: 0, w: 50, h: 50 } }],
    });
    expect(s).toContain('rect will be skipped');
    expect(s).not.toContain("parent's size is unknown"); // 容器父已有 skipped warning,不双告警
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

  it('根节点带 rect 相对 viewport 求解,生成运行时守卫且不发 unknown warning', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P', rect: { x: 0, y: 0, w: 1280, h: 720 },
    });
    expect(s).toContain('get_parent() is Container');
    expect(s).not.toContain('_mcp_output("warnings"');
    expect(s.indexOf('node.anchor_left = 0')).toBeGreaterThan(s.indexOf('parent.add_child(node)'));
  });

  it('viewport 参数作为根 rect 求解基准,子仍相对父 rect(参数链透传)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P', rect: { x: 400, y: 0, w: 200, h: 100 },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 100, y: 0, w: 100, h: 50 } }],
    }, { w: 1000, h: 800 });
    expect(s).toContain('node.anchor_left = 0.4');  // 根: 400/1000(viewport 参数)
    expect(s).toContain('node.anchor_left = 0.5');  // 子: 100/200(父 rect.w)
  });

  it('handler: viewport 非正数 → INVALID_PARAMS,不触 executor', async () => {
    const result = await uiHandle('ui', {
      project_path: '/fake/p', action: 'ui_build_layout', scene_path: 'res://scene.tscn',
      parent_path: 'root', tree: { type: 'Panel', name: 'P' }, viewport: { w: 0, h: 720 },
    }, createMockCtx() as never);
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    expect((result!.content[0] as { text: string }).text).toContain('INVALID_PARAMS');
    expect((result!.content[0] as { text: string }).text).toContain('viewport');
  });
});

describe('wrap/grid + space-* warning 一致性(I1)', () => {
  it('wrap + space-between: 不推 injected-spacer warning,只推 ignored-when-wrap,且无 spacer 注入', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'HBoxContainer', name: 'Flow',
      layout: { direction: 'row' as const, wrap: 'wrap' as const, justify: 'space-between' as const },
      children: [{ type: 'Button', name: 'A' }, { type: 'Button', name: 'B' }],
    });
    expect(s).not.toContain('implemented via injected spacer');  // validate 层不再误报
    expect(s).not.toContain('implemented by injecting');          // gen 层 wrap 分支也不推
    expect(s).toContain('ignored when wrap');
    expect(s).not.toContain('_spacer_');
  });

  it('grid + space-between: 不推 injected-spacer warning,只推 ignored-for-grid', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'GridContainer', name: 'G',
      layout: { direction: 'grid' as const, columns: 2, justify: 'space-between' as const },
      children: [{ type: 'Button', name: 'A' }, { type: 'Button', name: 'B' }],
    });
    expect(s).not.toContain('implemented via injected spacer');
    expect(s).toContain('ignored for grid');
  });

  it('nowrap + space-between: 保留 injected-spacer warning(行为不回退)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-between'));
    expect(s).toContain('implemented via injected spacer');
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

// ─── PR-1 Task 1: styleboxes 类型层校验 ────────────────────────────────────

describe('validateUiNodeSpec styleboxes 校验(PR-1)', () => {
  // 走公共入口间接触发 validateUiNodeSpec(其非导出,经 genUiBuildLayoutScript 调用);
  // 实际签名 (scenePath, parentPath, tree, viewport?, persist?)——spec 落 tree 位(第 3 参)。
  const call = (spec: unknown) =>
    genUiBuildLayoutScript('res://scenes/t.tscn', 'root', spec as never, { w: 1280, h: 720 });

  // 裁定(Task-1 brief Step 5):StyleBoxFlat.new() 构造块属 Task 3,本任务第 1 例仅断言
  // 校验通过不 throw;Task 3 完成后保留此形式,无需改回断言 StyleBoxFlat.new()。
  it('合法 styleboxes(panel 槽 + bg_color + corner_radius 对象)通过', () => {
    expect(() => call({
      type: 'Panel', name: 'Card', rect: { x: 0, y: 0, w: 100, h: 50 },
      styleboxes: [{ slot: 'panel', box: { bg_color: [0.1, 0.12, 0.18, 1], corner_radius: { tl: 8, br: 4 } } }],
    })).not.toThrow();
  });

  it('slot 白名单外 → throw(INVALID_PARAMS)', () => {
    expect(() => call({
      type: 'Panel', name: 'X', rect: { x: 0, y: 0, w: 10, h: 10 },
      styleboxes: [{ slot: 'focus', box: { bg_color: [1, 0, 0, 1] } }],
    })).toThrow(/styleboxes slot "focus" is not whitelisted/);
  });

  it('corner_radius 负值 → throw', () => {
    expect(() => call({
      type: 'Panel', name: 'X', rect: { x: 0, y: 0, w: 10, h: 10 },
      styleboxes: [{ slot: 'panel', box: { corner_radius: -1 } }],
    })).toThrow(/corner_radius must be non-negative/);
  });

  it('border_width 非有限数 → throw', () => {
    expect(() => call({
      type: 'Button', name: 'B', rect: { x: 0, y: 0, w: 10, h: 10 },
      styleboxes: [{ slot: 'normal', box: { border_width: Number.POSITIVE_INFINITY } }],
    })).toThrow(/border_width must be a non-negative finite number/);
  });
});
