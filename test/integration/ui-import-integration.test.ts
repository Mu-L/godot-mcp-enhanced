// test/integration/ui-import-integration.test.ts
// Task 3 集成验收(spec docs/superpowers/specs/2026-08-16-prototype-import-design.md §验收):
// 真跑 Godot(handler 级直调 handleTool('ui', …, ctx stub findGodot)),三用例:
//   1. RTS HUD fixture(test/fixtures/prototype-geometry/rts-hud.json,上轮 chrome-devtools
//      实测 DOM 产出)经 geometry_path 一次调用 → layout_verify 全绿 + verify_coverage +
//      persist saved:true + 独立重载 measure 验证 .tscn 节点与 rect;
//   2. mini-flow(3 按钮 space-between)→ targets < total 覆盖率语义 + HBox 存在 +
//      重载 measure 按钮间距 = (408-216)/2 = 96 ±2px;
//   3. 负向:geometry_path '../' 逃逸 → INVALID_PARAMS(集成层再验;path-utils 段级 '..'
//      拒绝独立于 UNRESTRICTED,test/setup.js 的旁路不豁免本用例)。
// 模式复用 test/integration/ui-layout-integration.test.ts:临时项目 project.godot 1280x720
// + main.tscn 根 Control 固定 offsets(勿 full_rect——headless Window 实际尺寸不反映 project
// 设置,上轮 2496 教训);重载验证走 genUiMeasureScript 直调(executor 层,不经 handler)。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeGdscriptTrusted } from '../../src/gdscript-executor.js';
import { genUiMeasureScript } from '../../src/tools/ui/ui-measure.js';
import { handleTool } from '../../src/tools/ui/index.js';
import type { ToolContext, ToolResult } from '../../src/types.js';

const GODOT = process.env.GODOT_PATH;
const run = !!GODOT && process.platform === 'win32';

// fixture 仓库路径(ESM 无 __dirname,经 import.meta.url 定位)
const RTS_FIXTURE = fileURLToPath(new URL('../fixtures/prototype-geometry/rts-hud.json', import.meta.url));

// 集成耗时记录(spec 开放问题 3:两次 spawn 首版方案实测数据,供单 spawn 优化决策)
let importElapsedMs = 0;

describe.skipIf(!run)('ui_import_prototype 集成验收(真跑 Godot)', () => {
  let dir: string;      // RTS 项目(geometry_path 链路)
  let dirFlow: string;  // mini-flow 项目(inline geometry 链路)

  beforeAll(() => {
    const mkProject = (prefix: string): string => {
      const d = mkdtempSync(join(tmpdir(), prefix));
      writeFileSync(join(d, 'project.godot'),
        'config_version=5\n\n[display]\n\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n');
      // 根 Control 固定 offsets 1280x720(合成根 _PrototypeRoot rect=viewport 的求解基准)
      writeFileSync(join(d, 'main.tscn'),
        '[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 1280.0\noffset_bottom = 720.0\n');
      return d;
    };
    dir = mkProject('ui-import-rts-');
    dirFlow = mkProject('ui-import-flow-');
    // fixture 拷入临时项目子目录(经 geometry_path 相对路径读入,走 res:// 剥离+白名单链)
    mkdirSync(join(dir, 'proto'), { recursive: true });
    copyFileSync(RTS_FIXTURE, join(dir, 'proto', 'rts-hud.json'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirFlow, { recursive: true, force: true });
    // eslint-disable-next-line no-console -- 集成耗时是 spec 开放问题 3 的决策数据,随测试输出留档
    console.log(`[ui-import-integration] RTS 一次调用(handler 内 build+measure 两次 spawn)实测耗时: ${importElapsedMs}ms`);
  });

  /** 集成链路只消费 ctx.findGodot();其余为 handler 不触达的 no-op stub。 */
  function createCtx(): ToolContext {
    return {
      opsScript: '/fake/ops.gd',
      findGodot: async () => GODOT!,
      runningProcess: null, setRunningProcess: () => {},
      outputBuffer: [], setOutputBuffer: () => {},
      processStartTime: 0, setProcessStartTime: () => {},
      projectDir: dir, setProjectDir: () => {},
      parseGodotConfig: () => ({}),
    } as unknown as ToolContext;
  }

  function textOf(result: ToolResult | null, index = 0): string {
    const el = result?.content?.[index];
    if (!el || el.type !== 'text') throw new Error(`content[${index}] is not text`);
    return el.text;
  }

  /** 独立 spawn 跑 measure(executor 层直调,验证落盘 .tscn,不经 handler)。 */
  async function measureFromDisk(d: string) {
    const res = await executeGdscriptTrusted({
      godotPath: GODOT!, projectPath: d, code: genUiMeasureScript(join(d, 'main.tscn'), 'root', 16),
      timeout: 30, loadAutoloads: false,
    });
    expect(res.compile_success, res.compile_error).toBe(true);
    expect(res.run_success, res.run_error).toBe(true);
    return JSON.parse(String(res.outputs.find(o => o.key === 'measure')!.value)) as {
      stable_after_frames: number;
      viewport: { w: number; h: number };
      nodes: Array<{ path: string; type: string; rect: { x: number; y: number; w: number; h: number } }>;
    };
  }

  // ─── 用例 1:RTS HUD fixture 一次调用全绿 ────────────────────────────────────

  it('RTS HUD(23 节点)geometry_path 一次调用:verify 全绿 + coverage + persist + 重载验证', { timeout: 90000 }, async () => {
    // fixture 逐字拷贝的防漂移护栏:23 节点数与本用例的 coverage 断言联动
    const fixture = JSON.parse(readFileSync(join(dir, 'proto', 'rts-hud.json'), 'utf-8')) as { nodes: unknown[] };
    expect(fixture.nodes).toHaveLength(23);

    const t0 = Date.now();
    const result = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dir,
      scene_path: 'res://main.tscn',
      geometry_path: 'proto/rts-hud.json',
    }, createCtx());
    importElapsedMs = Date.now() - t0;

    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result)) as {
      data: {
        build_warnings: string[];
        measure: { stable_after_frames: number; stalled: boolean; viewport: { w: number; h: number } };
        verify_coverage: { targets: number; total_nodes: number };
        layout_verify: {
          targets: unknown[];
          diff: Array<{ path: string; ok: boolean; delta: { dx: number; dy: number; dw: number; dh: number } }>;
          overlaps: unknown[];
          out_of_bounds: unknown[];
          viewport: { w: number; h: number };
        };
        persist: { saved: boolean };
      };
    };

    // layout_verify 全部 ok(spec 语义:rect 覆盖内)。
    // fixture 校准留痕(2026-08-16 裁定):HpBar 原型 y=606/h=16 按引擎下限校准为
    // y=599/h=27——Godot 4.7 默认主题 ProgressBar stylebox 最小高 27px(Control.minimum_size
    // 硬下限,h<27 被 clamp,实测原型 h=16 落地 27 且与 HpText 重叠 5px);翻译器规则 7
    // 同族已加预警(will be clamped)。校准后 23/23 全绿、无重叠、无越界。
    expect(parsed.data.layout_verify.diff).toHaveLength(parsed.data.layout_verify.targets.length);
    const bad = parsed.data.layout_verify.diff.filter(d => !d.ok);
    expect(bad, `不绿 diff: ${JSON.stringify(bad)}`).toEqual([]);
    expect(parsed.data.layout_verify.overlaps).toEqual([]);
    expect(parsed.data.layout_verify.out_of_bounds).toEqual([]);

    // verify_coverage:实现契约含合成根 _PrototypeRoot(_note:"无 flow 时 = 输入节点数+1";
    // brief 写 23 为不含根口径,Task 2 mock 测试先例同含根——按实现契约断言 24,报告记录偏差)
    expect(parsed.data.verify_coverage.total_nodes).toBe(23);
    expect(parsed.data.verify_coverage.targets).toBe(24);

    // persist saved:true(B-1 固定持久化;落盘失败会进 build_warnings,一并护栏)
    expect(parsed.data.persist.saved).toBe(true);
    expect(parsed.data.build_warnings.join('\n')).not.toContain('persist 落盘失败');

    // measure 头部字段(headless 下 root Window 尺寸 = project 设置,C1-6 实测)
    expect(parsed.data.measure.stalled).toBe(false);
    expect(Math.abs(parsed.data.measure.viewport.w - 1280)).toBeLessThanOrEqual(1);
    expect(Math.abs(parsed.data.measure.viewport.h - 720)).toBeLessThanOrEqual(1);

    // 独立重载 measure(executor 层):.tscn 含全部关键节点,抽查 rect 视口坐标。
    // fixture 建树:Bg 为全屏面板 → HUD 顶层节点均挂 _PrototypeRoot/Bg 下。
    const m = await measureFromDisk(dir);
    const paths = m.nodes.map(n => n.path);
    for (const p of ['_PrototypeRoot', '_PrototypeRoot/Bg', '_PrototypeRoot/Bg/TopBar',
      '_PrototypeRoot/Bg/Minimap', '_PrototypeRoot/Bg/Minimap/MinimapTag', '_PrototypeRoot/Bg/CmdPanel',
      '_PrototypeRoot/Bg/CmdPanel/BtnAttack', '_PrototypeRoot/Bg/CmdPanel/BtnRetreat',
      '_PrototypeRoot/Bg/UnitPanel', '_PrototypeRoot/Bg/UnitPanel/UnitName',
      '_PrototypeRoot/Bg/UnitPanel/HpBar', '_PrototypeRoot/Bg/UnitPanel/HpText',
      '_PrototypeRoot/Bg/UnitPanel/StatText']) {
      expect(paths, `重载 measure 缺节点 ${p}`).toContain(p);
    }
    const topBar = m.nodes.find(n => n.path === '_PrototypeRoot/Bg/TopBar')!;
    expect(Math.abs(topBar.rect.x - 0)).toBeLessThanOrEqual(2);
    expect(Math.abs(topBar.rect.w - 1280)).toBeLessThanOrEqual(2);
    expect(Math.abs(topBar.rect.h - 56)).toBeLessThanOrEqual(2);
    const btnAttack = m.nodes.find(n => n.path === '_PrototypeRoot/Bg/CmdPanel/BtnAttack')!;
    expect(Math.abs(btnAttack.rect.x - 656)).toBeLessThanOrEqual(2);
    expect(Math.abs(btnAttack.rect.y - 568)).toBeLessThanOrEqual(2);
    expect(Math.abs(btnAttack.rect.w - 72)).toBeLessThanOrEqual(2);
    expect(Math.abs(btnAttack.rect.h - 36)).toBeLessThanOrEqual(2);
  });

  // ─── 用例 2:mini-flow 覆盖率语义 + space-between 间距 ───────────────────────

  it('mini-flow(3 按钮 space-between):targets < total、HBox 存在、重载间距 96±2px', { timeout: 90000 }, async () => {
    // 控制器裁定 fixture:Holder 透明壳(rect 100,100,408,40,无显式 type→Panel)+
    // 3 按钮 72x32 各自视口坐标(space-between 落位:100 / 268 / 436,垂直居中 y=104)。
    // inline geometry(用例 1 走 geometry_path,本用例顺带覆盖另一输入通道)。
    const result = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dirFlow,
      scene_path: 'res://main.tscn',
      geometry: {
        viewport: { w: 1280, h: 720 },
        nodes: [
          { name: 'Holder', rect: { x: 100, y: 100, w: 408, h: 40 }, flow: 'row', justify: 'space-between' },
          { name: 'BtnA', rect: { x: 100, y: 104, w: 72, h: 32 }, type: 'Button', text: 'A', interactive: true },
          { name: 'BtnB', rect: { x: 268, y: 104, w: 72, h: 32 }, type: 'Button', text: 'B', interactive: true },
          { name: 'BtnC', rect: { x: 436, y: 104, w: 72, h: 32 }, type: 'Button', text: 'C', interactive: true },
        ],
      },
    }, createCtx());

    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result)) as {
      data: {
        tree: { children: Array<{ name: string; type: string; children?: Array<{ type: string; name: string; anchor_preset?: string }> }> };
        verify_coverage: { targets: number; total_nodes: number };
        layout_verify: { diff: Array<{ ok: boolean }> };
        persist: { saved: boolean };
      };
    };

    // 覆盖率语义:flow 直接子节点丢 rect → targets(根+Holder=2)< total(4 输入)
    expect(parsed.data.verify_coverage.total_nodes).toBe(4);
    expect(parsed.data.verify_coverage.targets).toBeLessThan(parsed.data.verify_coverage.total_nodes);
    expect(parsed.data.verify_coverage.targets).toBe(2);

    // HBox 存在:Holder(Panel 壳)下插 Holder_Flow(HBoxContainer, full_rect)
    const holder = parsed.data.tree.children.find(c => c.name === 'Holder')!;
    expect(holder.type).toBe('Panel');
    expect(holder.children).toHaveLength(1);
    expect(holder.children![0]!.type).toBe('HBoxContainer');
    expect(holder.children![0]!.anchor_preset).toBe('full_rect');

    // 覆盖内的节点(根+Holder)diff 全绿
    expect(parsed.data.layout_verify.diff.every(d => d.ok)).toBe(true);
    expect(parsed.data.persist.saved).toBe(true);

    // 独立重载 measure:按钮间距 = (408 - 3*72) / 2 = 96 ±2px(容器排布,与输入视口坐标无关)
    const m = await measureFromDisk(dirFlow);
    const btn = (p: string) => {
      const n = m.nodes.find(x => x.path === `_PrototypeRoot/Holder/Holder_Flow/${p}`);
      expect(n, `重载 measure 缺按钮 ${p}`).toBeDefined();
      return n!;
    };
    const a = btn('BtnA'), b = btn('BtnB'), c = btn('BtnC');
    const gap1 = b.rect.x - (a.rect.x + a.rect.w);
    const gap2 = c.rect.x - (b.rect.x + b.rect.w);
    expect(Math.abs(gap1 - 96), `gap1=${gap1}`).toBeLessThanOrEqual(2);
    expect(Math.abs(gap2 - 96), `gap2=${gap2}`).toBeLessThanOrEqual(2);
    // 首尾贴边(measure rect 为 global 坐标:Holder 视口 x=100,宽 408 → 尾 508)
    expect(Math.abs(a.rect.x - 100), `a.x=${a.rect.x}`).toBeLessThanOrEqual(2);
    expect(Math.abs(c.rect.x + c.rect.w - 508), `c.tail=${c.rect.x + c.rect.w}`).toBeLessThanOrEqual(2);
  });

  // ─── 用例 3:负向——geometry_path 逃逸 ──────────────────────────────────────

  it('geometry_path "../" 逃逸 → INVALID_PARAMS', async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dir,
      scene_path: 'res://main.tscn',
      geometry_path: '../outside/evil.json',
    }, createCtx());
    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toMatch(/traversal|越权|非法|geometry_path 非法/);
  });
});
