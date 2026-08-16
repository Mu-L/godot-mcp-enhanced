import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeGdscriptTrusted } from '../../src/gdscript-executor.js';
import { genUiBuildLayoutScript } from '../../src/tools/ui/ui-layout.js';
import { genUiMeasureScript } from '../../src/tools/ui/ui-measure.js';

const GODOT = process.env.GODOT_PATH;
const run = !!GODOT && process.platform === 'win32';

describe.skipIf(!run)('justify space-* 真实布局数值断言(GODOT_PATH)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ui-justify-'));
    writeFileSync(join(dir, 'project.godot'),
      'config_version=5\n\n[display]\n\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n');
    // Control 根 300x100,锚点无关(直接 offsets)
    writeFileSync(join(dir, 'main.tscn'),
      '[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 300.0\noffset_bottom = 100.0\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function runScript(dir: string, code: string) {
    const res = await executeGdscriptTrusted({
      godotPath: GODOT!, projectPath: dir, code, timeout: 30, loadAutoloads: false,
    });
    expect(res.compile_success, res.compile_error).toBe(true);
    expect(res.run_success, res.run_error).toBe(true);
    return res.outputs;
  }

  // 通用"build 后等 3 帧收集按钮 x/w"的 full-class 脚本。
  // 截掉末尾 layout_built 输出 + _mcp_done(),换为 call_deferred 启动测量:
  // _initialize 不再同步结束,等 3 帧布局稳定后由 _on_frame 输出并 _mcp_done() 退出。
  function buildThenCollect(dir: string, justify: string): string {
    const tree = {
      type: 'HBoxContainer', name: 'Row',
      layout: { direction: 'row', justify, gap: 0 },
      children: [
        { type: 'Button', name: 'A' }, { type: 'Button', name: 'B' }, { type: 'Button', name: 'C' },
      ],
    };
    const buildBlock = genUiBuildLayoutScript(join(dir, 'main.tscn'), 'root', tree)
      .replace(/\t_mcp_output\("layout_built"[\s\S]*?\t_mcp_done\(\)\n$/, '\tcall_deferred("_deferred_measure")\n');
    return `${buildBlock}
var _frames := 0

func _deferred_measure() -> void:
\tprocess_frame.connect(_on_frame)

func _on_frame() -> void:
\t_frames += 1
\tif _frames < 3:
\t\treturn
\tprocess_frame.disconnect(_on_frame)
\tvar _btns: Array = []
\tfor n in ["Row/A", "Row/B", "Row/C"]:
\t\tvar c := _mcp_scene_instance.get_node(n) as Control
\t\t_btns.append({"x": c.global_position.x, "w": c.size.x})
\t_mcp_output("btns", JSON.stringify(_btns))
\t_mcp_done()
`;
  }

  it('space-between: 首尾贴边,相邻间距方差为 0', async () => {
    const outs = await runScript(dir, buildThenCollect(dir, 'space-between'));
    const btns = JSON.parse(String(outs.find(o => o.key === 'btns')!.value)) as Array<{ x: number; w: number }>;
    const xs = btns.map(b => b.x), ws = btns.map(b => b.w);
    const gaps = [xs[1]! - (xs[0]! + ws[0]!), xs[2]! - (xs[1]! + ws[1]!)];
    expect(xs[0]).toBeCloseTo(0, 0);                    // 首贴边
    expect(xs[2]! + ws[2]!).toBeCloseTo(300, 0);        // 尾贴边
    expect(Math.abs(gaps[0]! - gaps[1]!)).toBeLessThanOrEqual(1); // 间距相等
  });

  it('space-around: 边距 = 相邻间距之半', async () => {
    const outs = await runScript(dir, buildThenCollect(dir, 'space-around'));
    const btns = JSON.parse(String(outs.find(o => o.key === 'btns')!.value)) as Array<{ x: number; w: number }>;
    const xs = btns.map(b => b.x), ws = btns.map(b => b.w);
    const margin = xs[0]!;
    const gap = xs[1]! - (xs[0]! + ws[0]!);
    expect(Math.abs(margin * 2 - gap)).toBeLessThanOrEqual(1);
  });

  it('space-evenly: 全部相邻间距(含首尾)相等', async () => {
    const outs = await runScript(dir, buildThenCollect(dir, 'space-evenly'));
    const btns = JSON.parse(String(outs.find(o => o.key === 'btns')!.value)) as Array<{ x: number; w: number }>;
    const xs = btns.map(b => b.x), ws = btns.map(b => b.w);
    const g1 = xs[0]!;
    const g2 = xs[1]! - (xs[0]! + ws[0]!);
    const g3 = 300 - (xs[2]! + ws[2]!);
    const spread = Math.max(g1, g2, g3) - Math.min(g1, g2, g3);
    expect(spread).toBeLessThanOrEqual(1);
  });

  // ui_measure_layout 集成:build 是运行时节点(进程退出即丢),测量须同进程。
  // 拼接采用 Task 1 buildThenCollect 同构(授权调整):brief 原始拼接会把
  // SCENE_TREE_HEADER 的函数重复定义两遍且 call_deferred 落在类体顶层(非法 GDScript)。
  // 这里:build 尾部 layout_built+_mcp_done 换成 call_deferred 启动测量;再拼
  // genUiMeasureScript 输出剥离 header 与 _initialize 后的测量核心(变量+5 函数,
  // 直接复用生成物保真实性),尾部补 _measure_go 引导函数——函数零重复定义。
  function buildThenMeasure(d: string): string {
    const tree = {
      type: 'VBoxContainer', name: 'Col',
      layout: { direction: 'column', gap: 10 },
      children: [
        { type: 'Button', name: 'B1' }, { type: 'Button', name: 'B2' }, { type: 'Button', name: 'B3' },
      ],
    };
    const buildBlock = genUiBuildLayoutScript(join(d, 'main.tscn'), 'root', tree)
      .replace(/\t_mcp_output\("layout_built"[\s\S]*?\t_mcp_done\(\)\n$/, '\tcall_deferred("_measure_go")\n');
    const full = genUiMeasureScript(join(d, 'main.tscn'), undefined, 16);
    const measureCore = full
      .slice(full.indexOf('var _frames := 0'))
      .replace(/\nfunc _initialize\(\):[\s\S]*?(?=\nfunc _on_measure_frame)/, '\n');
    return `${buildBlock}${measureCore}
func _measure_go() -> void:
\t_target = _mcp_scene_instance
\tprocess_frame.connect(_on_measure_frame)
`;
  }

  it('ui_measure_layout: VBox 三按钮 rect 顺序与 separation 数值正确', async () => {
    const outs = await runScript(dir, buildThenMeasure(dir));
    const measure = JSON.parse(String(outs.find(o => o.key === 'measure')!.value)) as {
      stable_after_frames: number;
      nodes: Array<{ path: string; type: string; rect: { x: number; y: number; w: number; h: number } }>;
    };
    expect(measure.stable_after_frames).toBeGreaterThanOrEqual(2);
    expect(measure.stable_after_frames).toBeLessThanOrEqual(5);
    const btns = measure.nodes.filter(n => /Col\/B\d/.test(n.path));
    expect(btns).toHaveLength(3);
    expect(btns.map(n => n.type)).toEqual(['Button', 'Button', 'Button']);
    expect(btns[0]!.rect.y).toBeLessThan(btns[1]!.rect.y);
    expect(btns[1]!.rect.y).toBeLessThan(btns[2]!.rect.y);
    const gap1 = btns[1]!.rect.y - (btns[0]!.rect.y + btns[0]!.rect.h);
    const gap2 = btns[2]!.rect.y - (btns[1]!.rect.y + btns[1]!.rect.h);
    expect(Math.abs(gap1 - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap2 - 10)).toBeLessThanOrEqual(1);
  });

  it('ui_measure_layout: 场景不存在 → error 输出', async () => {
    const outs = await runScript(dir, genUiMeasureScript(join(dir, 'nope.tscn'), undefined, 16));
    expect(outs.some(o => o.key === 'error')).toBe(true);
  });
});
