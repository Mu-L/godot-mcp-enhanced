// Task 4 (layout-diff): expect_tree 逐节点 diff/重叠/越界。
// 纯函数测试逐字来自 brief Step 1;附加:容差边界(<=)、'.' 根 artifact 负向、
// handler 注入链路(mock executor: INVALID_PARAMS / layout_verify 注入 / 错误结果不注入)。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flattenTargets, diffLayout, detectOverlaps, detectOutOfBounds } from '../src/tools/ui/layout-diff.js';
import type { MeasuredNode } from '../src/tools/ui/layout-diff.js';
import type { UiNodeSpec } from '../src/tools/ui/types.js';
import type { ExecuteGdscriptResult } from '../src/gdscript-executor.js';

const n = (path: string, x: number, y: number, w: number, h: number): MeasuredNode =>
  ({ path, type: 'Control', rect: { x, y, w, h } });

describe('flattenTargets', () => {
  it('递归收集带 rect 节点,路径为名称链', () => {
    const t = flattenTargets({
      type: 'Panel', name: 'P',
      children: [
        { type: 'Button', name: 'A', rect: { x: 0, y: 0, w: 10, h: 10 } },
        { type: 'VBoxContainer', name: 'Col', layout: { direction: 'column' },
          children: [{ type: 'Button', name: 'B', rect: { x: 5, y: 5, w: 8, h: 8 } }] },
      ],
    });
    expect(t).toEqual([
      { path: 'P/A', rect: { x: 0, y: 0, w: 10, h: 10 } },
      { path: 'P/Col/B', rect: { x: 5, y: 5, w: 8, h: 8 } },
    ]);
  });

  it('无 rect 的节点不产出条目', () => {
    expect(flattenTargets({ type: 'Label', name: 'L' })).toEqual([]);
  });

  it('同构对照:measure 整场景(path=get_path_to 名称链)与 build 树(挂场景根下)路径一致', () => {
    // ui_build_layout 建树 P{A, Col{B}} 挂 root 下 → ui_measure_layout(不带 node_path)
    // 输出 nodes path: 'P' / 'P/A' / 'P/Col/B'(_target=场景根,get_path_to 不含根名)。
    // expect_tree 传 build 的同一棵树 → flattenTargets 计根名后恰为 'P/A' / 'P/Col/B'。
    // C1 父相对语义:父 P 在非原点 (500,300),子 target 为相对父的 rect → diff 仍全绿。
    const tree: UiNodeSpec = {
      type: 'Panel', name: 'P',
      children: [
        { type: 'Button', name: 'A', rect: { x: 0, y: 0, w: 10, h: 10 } },
        { type: 'VBoxContainer', name: 'Col',
          children: [{ type: 'Button', name: 'B', rect: { x: 0, y: 0, w: 5, h: 5 } }] },
      ],
    };
    const measured: MeasuredNode[] = [
      n('P', 500, 300, 100, 100),
      n('P/A', 500, 300, 10, 10),
      n('P/Col', 500, 300, 50, 50),
      n('P/Col/B', 500, 300, 5, 5),
    ];
    const d = diffLayout(measured, flattenTargets(tree), 2);
    expect(d.map(e => e.path)).toEqual(['P/A', 'P/Col/B']);
    expect(d.every(e => e.ok)).toBe(true);
  });
});

describe('diffLayout(C1 父相对坐标语义)', () => {
  // target 语义 = 相对父左上角(与生成侧一致);actual = 子 global − 父 global,与 target 同构。
  it('同父两子各自相对位置正确(父在非原点也不误报)', () => {
    const targets = [
      { path: 'P/A', rect: { x: 50, y: 30, w: 120, h: 48 } },
      { path: 'P/B', rect: { x: 300, y: 0, w: 100, h: 48 } },
    ];
    const measured = [
      n('P', 100, 50, 600, 400),
      n('P/A', 150, 80, 120, 48),   // global 150,80 = 父 100,50 + 相对 50,30
      n('P/B', 400, 50, 100, 48),
    ];
    const d = diffLayout(measured, targets, 2);
    expect(d).toHaveLength(2);
    expect(d.every(e => e.ok)).toBe(true);
    expect(d[0]!.actual).toEqual({ x: 50, y: 30, w: 120, h: 48 });
    expect(d[1]!.actual).toEqual({ x: 300, y: 0, w: 100, h: 48 });
  });

  it('父相对换算后超容差 → ok:false,delta 为父相对差', () => {
    const targets = [{ path: 'P/A', rect: { x: 50, y: 30, w: 120, h: 48 } }];
    // 子 global y=90,父 y=50 → 父相对 y=40 vs target 30 → dy=10(旧语义误算 90-30=60)
    const d = diffLayout([n('P', 100, 50, 600, 400), n('P/A', 150, 90, 120, 48)], targets, 2);
    expect(d[0]!.ok).toBe(false);
    expect(d[0]!.delta.dy).toBe(10);
    expect(d[0]!.delta.dx).toBe(0);
  });

  it('根级 target(无父段)以视口原点为参照:measured global 直接比', () => {
    const targets = [{ path: 'P', rect: { x: 100, y: 50, w: 600, h: 400 } }];
    const ok = diffLayout([n('P', 100, 50, 600, 400)], targets, 2);
    expect(ok[0]!.ok).toBe(true);
    const off = diffLayout([n('P', 120, 50, 600, 400)], targets, 2);
    expect(off[0]!.ok).toBe(false);
    expect(off[0]!.delta.dx).toBe(20);
  });

  it('父不在测量集 → delta NaN 不 ok(缺失语义)', () => {
    const targets = [{ path: 'P/A', rect: { x: 50, y: 30, w: 120, h: 48 } }];
    const d = diffLayout([n('P/A', 150, 80, 120, 48)], targets, 2); // 父 'P' 未测
    expect(d[0]!.ok).toBe(false);
    expect(Number.isNaN(d[0]!.delta.dx)).toBe(true);
    expect(Number.isNaN(d[0]!.delta.dy)).toBe(true);
  });

  it('measure 缺失的目标节点 → delta 标记 NaN 不 ok', () => {
    const d = diffLayout([n('Z', 0, 0, 1, 1)], [{ path: 'A', rect: { x: 0, y: 24, w: 100, h: 48 } }], 2);
    expect(d).toHaveLength(1);
    expect(d[0]!.ok).toBe(false);
    expect(Number.isNaN(d[0]!.delta.dx)).toBe(true);
  });

  it('delta 恰等于容差 2 → ok:true(容差为 <= 语义)', () => {
    const targets = [{ path: 'P/A', rect: { x: 0, y: 24, w: 100, h: 48 } }];
    const d = diffLayout([n('P', 0, 0, 100, 100), n('P/A', 2, 26, 100, 50)], targets, 2);
    expect(d[0]!.ok).toBe(true);
  });

  it('默认容差为 2(不传 tolerancePx)', () => {
    const targets = [{ path: 'P/A', rect: { x: 0, y: 24, w: 100, h: 48 } }];
    const within = diffLayout([n('P', 0, 0, 100, 100), n('P/A', 0, 26, 100, 48)], targets);
    expect(within[0]!.ok).toBe(true);
    const beyond = diffLayout([n('P', 0, 0, 100, 100), n('P/A', 0, 27, 100, 48)], targets);
    expect(beyond[0]!.ok).toBe(false);
  });
});

describe('detectOverlaps(仅同父兄弟)', () => {
  it('兄弟相交 → 报告;不同父不相交不报(负向)', () => {
    const ms = [
      n('P/A', 0, 0, 50, 50), n('P/B', 25, 0, 50, 50),      // 同父相交
      n('Q/A', 0, 0, 50, 50), n('R/B', 25, 0, 50, 50),      // 不同父,不比较
    ];
    const ov = detectOverlaps(ms);
    expect(ov).toHaveLength(1);
    expect(ov[0]!.a).toBe('P/A');
    expect(ov[0]!.b).toBe('P/B');
  });

  it('重叠 ≤1px 不报(阈值 >1px,负向:不误报)', () => {
    const ov = detectOverlaps([n('P/A', 0, 0, 50, 50), n('P/B', 50, 0, 50, 50)]);
    expect(ov).toEqual([]);
  });

  it('measure 根节点 path "." 与一级子不比较(负向:get_path_to artifact 不误报)', () => {
    // 整场景 measure 时 _target.get_path_to(自身) = ".",场景根与一级子 'P' 落进同一
    // parent='' 组,父包子的正常包含不是兄弟重叠 → 必须不报。
    const ov = detectOverlaps([
      n('.', 0, 0, 200, 200),
      n('P', 10, 10, 100, 100),
      n('Q', 120, 10, 60, 60),
    ]);
    expect(ov).toEqual([]);
  });
});

describe('detectOutOfBounds', () => {
  it('子超出父 → 溢出量;子在父内 → 不报(负向)', () => {
    const ms = [
      n('P', 0, 0, 100, 100),
      n('P/In', 10, 10, 50, 50),          // 在内
      n('P/Out', 80, 80, 50, 50),         // 右下溢出 30,30
    ];
    const oob = detectOutOfBounds(ms);
    expect(oob).toHaveLength(1);
    expect(oob[0]!.path).toBe('P/Out');
    expect(oob[0]!.overflow.w).toBe(30);
    expect(oob[0]!.overflow.h).toBe(30);
  });

  it('溢出 ≤1px 不报(阈值 >1px,负向)且父缺失/根节点跳过', () => {
    expect(detectOutOfBounds([
      n('P', 0, 0, 100, 100),
      n('P/Edge', 0, 0, 101, 100),        // 右溢 1px,不报
    ])).toEqual([]);
    // 一级子 'P' 的父(场景根 '.')不在 measured 键中(键 '.' ≠ parentOf('P')='')→ 跳过
    expect(detectOutOfBounds([n('.', 0, 0, 50, 50), n('P', 0, 0, 100, 100)])).toEqual([]);
  });
});

// ─── handler 注入链路(mock executor)────────────────────────────────────

vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscriptTrusted: vi.fn(),
}));

import { executeGdscriptTrusted } from '../src/gdscript-executor.js';
import { handleTool } from '../src/tools/ui/index.js';

const mockedExec = vi.mocked(executeGdscriptTrusted);

function okResult(measurePayload: unknown): ExecuteGdscriptResult {
  return {
    success: true, compile_success: true, compile_error: '', errors: [],
    run_success: true, run_error: '',
    outputs: [{ key: 'measure', value: JSON.stringify(measurePayload) }],
    raw_output: '', duration_ms: 1,
  };
}

const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };

beforeEach(() => {
  mockedExec.mockReset();
});

describe('ui_measure_layout expect_tree(handler 集成)', () => {
  it('expect_tree 缺 name → INVALID_PARAMS,不触 executor', async () => {
    const r = await handleTool('ui', {
      action: 'ui_measure_layout', project_path: '/fake/p',
      scene_path: 'res://scenes/main.tscn',
      expect_tree: { type: 'Panel' },
    }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0]).toMatchObject({ type: 'text' });
    expect((r.content[0] as { text: string }).text).toContain('INVALID_PARAMS');
    expect((r.content[0] as { text: string }).text).toContain('expect_tree');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('提供 expect_tree → data.layout_verify 注入 diff/overlaps/out_of_bounds/viewport,measure 数据保留', async () => {
    mockedExec.mockResolvedValue(okResult({
      stable_after_frames: 3,
      stalled: false,
      viewport: { w: 1280, h: 720 },
      nodes: [
        { path: '.', type: 'Control', rect: { x: 0, y: 0, w: 1280, h: 720 } },
        { path: 'P', type: 'Panel', rect: { x: 0, y: 0, w: 200, h: 200 } },
        { path: 'P/A', type: 'Button', rect: { x: 0, y: 40, w: 100, h: 48 } },
        { path: 'P/B', type: 'Button', rect: { x: 0, y: 0, w: 120, h: 48 } },
      ],
    }));
    const r = await handleTool('ui', {
      action: 'ui_measure_layout', project_path: '/fake/p',
      scene_path: 'res://scenes/main.tscn',
      expect_tree: {
        type: 'Panel', name: 'P',
        children: [
          { type: 'Button', name: 'A', rect: { x: 0, y: 24, w: 100, h: 48 } },
          { type: 'Button', name: 'B', rect: { x: 0, y: 0, w: 100, h: 48 } },
        ],
      },
    }, ctx);
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse((r.content[0] as { text: string }).text) as {
      success: boolean;
      data: {
        measure?: { nodes?: unknown[] };
        layout_verify?: {
          targets: Array<{ path: string }>;
          diff: Array<{ path: string; ok: boolean; delta: { dy: number; dw: number } }>;
          overlaps: Array<{ a: string; b: string }>;
          out_of_bounds: Array<{ path: string }>;
          viewport?: { w: number; h: number };
        };
      };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.measure?.nodes).toHaveLength(4);   // 原 measure 输出保留
    const lv = parsed.data.layout_verify!;
    expect(lv.targets.map(t => t.path)).toEqual(['P/A', 'P/B']);
    // C1 父相对语义:P/A actual = (0,40)−(0,0) → dy=16;P/B dw=20
    const a = lv.diff.find(e => e.path === 'P/A')!;
    expect(a.ok).toBe(false);                              // 父相对 y 40 vs 24,dy=16 超容差
    expect(a.delta.dy).toBe(16);
    const b = lv.diff.find(e => e.path === 'P/B')!;
    expect(b.ok).toBe(false);                              // w 120 vs 100,dw=20 超容差
    expect(b.delta.dw).toBe(20);
    expect(lv.viewport).toEqual({ w: 1280, h: 720 });      // 根级参照系透传
    expect(lv.overlaps).toEqual([{ a: 'P/A', b: 'P/B', overlap: { x: 0, y: 40, w: 100, h: 8 } }]); // A(y40-88)与 B(y0-48)同父重叠
    expect(lv.out_of_bounds).toEqual([]);                  // 均在 P 内
  });

  it('measure 输出异常(执行失败)→ 原样返回错误,不注入 layout_verify', async () => {
    mockedExec.mockResolvedValue({
      ...okResult(null),
      run_success: false, run_error: 'boom', outputs: [],
    });
    const r = await handleTool('ui', {
      action: 'ui_measure_layout', project_path: '/fake/p',
      scene_path: 'res://scenes/main.tscn',
      expect_tree: { type: 'Panel', name: 'P' },
    }, ctx);
    expect(r.isError).toBe(true);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain('boom');
    expect(text).not.toContain('layout_verify');
  });

  it('不提供 expect_tree → 行为与 Task 3 一致,无 layout_verify 键', async () => {
    mockedExec.mockResolvedValue(okResult({ stable_after_frames: 2, nodes: [] }));
    const r = await handleTool('ui', {
      action: 'ui_measure_layout', project_path: '/fake/p',
      scene_path: 'res://scenes/main.tscn',
    }, ctx);
    expect(r.isError).toBeFalsy();
    expect((r.content[0] as { text: string }).text).not.toContain('layout_verify');
  });
});
