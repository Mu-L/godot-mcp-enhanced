import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeGdscriptTrusted } from '../../src/gdscript-executor.js';
import { genUiBuildLayoutScript } from '../../src/tools/ui/ui-layout.js';

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
});
