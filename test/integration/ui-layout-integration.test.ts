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
  let dirRect: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ui-justify-'));
    writeFileSync(join(dir, 'project.godot'),
      'config_version=5\n\n[display]\n\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n');
    // Control 根 300x100,锚点无关(直接 offsets)
    writeFileSync(join(dir, 'main.tscn'),
      '[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 300.0\noffset_bottom = 100.0\n');
    // C1-6 fixture:根 Control 固定尺寸 1280x720(anchors 0 + offsets,同上方 justify
    // fixture 的 300x100 模式,不随 headless Window 实际尺寸缩放——headless --script 下
    // Window 实际尺寸不反映 project 设置,实测 2496x?;full_rect 根会让根 rect 的
    // viewport 基准与运行时父尺寸脱节)。固定 1280x720 = viewport → 根级 rect(以
    // viewport 求解)落地后 global 与视口系一致,嵌套 rect 断言方可成立。
    dirRect = mkdtempSync(join(tmpdir(), 'ui-rect-'));
    writeFileSync(join(dirRect, 'project.godot'),
      'config_version=5\n\n[display]\n\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n');
    writeFileSync(join(dirRect, 'main.tscn'),
      '[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 1280.0\noffset_bottom = 720.0\n');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirRect, { recursive: true, force: true });
  });

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

  // C1-6 嵌套 rect 验收(final-review 验收 1):根 Panel rect 相对 viewport(1280x720)求解,
  // 子 Button rect 相对父 rect(600x400)求解——落地后 Button global = Panel 原点 + 相对偏移,
  // anchors 值 = 相对偏移/父尺寸。build 与 measure 同进程(运行时节点退出即丢),复用
  // buildThenMeasure 拼接模式(build 尾换 call_deferred + 剥离 measure 核心)。
  function buildThenMeasureRect(d: string): string {
    const tree = {
      type: 'Panel', name: 'P', rect: { x: 100, y: 50, w: 600, h: 400 },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 50, y: 30, w: 120, h: 48 } }],
    };
    const buildBlock = genUiBuildLayoutScript(join(d, 'main.tscn'), 'root', tree, { w: 1280, h: 720 })
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

  interface MeasureOutput {
    stable_after_frames: number;
    stalled: boolean;
    viewport: { w: number; h: number };
    nodes: Array<{
      path: string;
      rect: { x: number; y: number; w: number; h: number };
      anchors?: { left: number; top: number };
    }>;
  }

  it('嵌套 rect: Panel(100,50,600,400) 内 Button 相对 (50,30),global (150,80),anchors 相对父尺寸', async () => {
    const outs = await runScript(dirRect, buildThenMeasureRect(dirRect));
    const measure = JSON.parse(String(outs.find(o => o.key === 'measure')!.value)) as MeasureOutput;
    // M-b: viewport 输出(headless 下 root Window 尺寸 = project 设置)
    expect(Math.abs(measure.viewport.w - 1280)).toBeLessThanOrEqual(1);
    expect(Math.abs(measure.viewport.h - 720)).toBeLessThanOrEqual(1);
    // M-a: 本场景布局立刻稳定 → stalled 为 false
    expect(measure.stalled).toBe(false);
    const p = measure.nodes.find(n => n.path === 'P');
    const btn = measure.nodes.find(n => n.path === 'P/Btn');
    expect(p).toBeDefined();
    expect(btn).toBeDefined();
    // 根 rect 相对 viewport 原点(global 即视口系),容差 2px
    expect(Math.abs(p!.rect.x - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(p!.rect.y - 50)).toBeLessThanOrEqual(2);
    expect(Math.abs(p!.rect.w - 600)).toBeLessThanOrEqual(2);
    expect(Math.abs(p!.rect.h - 400)).toBeLessThanOrEqual(2);
    // 子 global = 父原点(100,50) + 相对偏移(50,30) = (150,80),size 精确,容差 2px
    expect(Math.abs(btn!.rect.x - 150)).toBeLessThanOrEqual(2);
    expect(Math.abs(btn!.rect.y - 80)).toBeLessThanOrEqual(2);
    expect(Math.abs(btn!.rect.w - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(btn!.rect.h - 48)).toBeLessThanOrEqual(2);
    // anchors 语义:Button 锚点按父尺寸(600x400)而非 viewport 求解
    expect(btn!.anchors!.left).toBeCloseTo(50 / 600, 5);
    expect(btn!.anchors!.top).toBeCloseTo(30 / 400, 5);
    // 根 Panel 锚点按 viewport(1280x720)求解
    expect(p!.anchors!.left).toBeCloseTo(100 / 1280, 5);
    expect(p!.anchors!.top).toBeCloseTo(50 / 720, 5);
  });

  // Task 5 persist:build 后原子写落盘,独立进程重载 measure 验证(节点+separation 都已持久化)。
  // 注:此测试会写盘 main.tscn,故放在 describe 末尾,避免污染前序测试的干净 fixture。
  it('persist=true:节点写入 .tscn,重载 measure 结果一致', async () => {
    const build = genUiBuildLayoutScript(join(dir, 'main.tscn'), 'root', {
      type: 'VBoxContainer', name: 'Saved', layout: { direction: 'column', gap: 8 },
      children: [{ type: 'Button', name: 'OK' }, { type: 'Button', name: 'Cancel' }],
    }, undefined, true);
    const outs = await runScript(dir, build);
    expect(outs.some(o => o.key === 'persist')).toBe(true);
    expect(outs.some(o => o.key === 'layout_built')).toBe(true); // persist 后 layout_built 输出仍在
    const saved = JSON.parse(String(outs.find(o => o.key === 'persist')!.value));
    expect(saved.saved).toBe(true);
    // 重载独立 measure
    const measure = genUiMeasureScript(join(dir, 'main.tscn'), undefined, 16);
    const outs2 = await runScript(dir, measure);
    const m = JSON.parse(String(outs2.find(o => o.key === 'measure')!.value)) as {
      nodes: Array<{ path: string; rect: { x: number; y: number; w: number; h: number } }>;
    };
    const paths = m.nodes.map(x => x.path);
    expect(paths).toContain('Saved');
    expect(paths).toContain('Saved/OK');
    expect(paths).toContain('Saved/Cancel');
    const ok = m.nodes.find(x => x.path === 'Saved/OK')!;
    const cancel = m.nodes.find(x => x.path === 'Saved/Cancel')!;
    const gap = cancel.rect.y - (ok.rect.y + ok.rect.h);
    expect(Math.abs(gap - 8)).toBeLessThanOrEqual(1);
  });
});
