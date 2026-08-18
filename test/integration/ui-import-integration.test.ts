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
// PR-1 Task 4 追加(StyleBox 通道端到端验收,spec 2026-08-17-prototype-stylebox-loop-design.md):
//   4. css-card fixture(样式三件套场景)→ .tscn StyleBoxFlat sub_resource + 四类槽位 +
//      draw_center=false + modulate 通道已删 + layout_verify 全绿;
//   5. Label normal 槽引擎实测(spec §10.3/N-1):override 后 get_theme_stylebox 读回
//      StyleBoxFlat(bg_color 一致)——badge 映射(Label text+bg 一比一)的引擎事实前提;
//   6. ProgressBar 三组合钳制实测(spec §10.4 开放问题 4):bg-only / fill-only / bg+fill
//      在 h=16(< 默认主题最小高 27)下的 dh 实测数据固化断言。
// PR-2 Task 6 追加(verify 层集成验收,spec 2026-08-17-prototype-stylebox-loop-design.md §4):
//   2v2. 用例 2 追加 flow_verify 断言(消解 B-2:3 按钮 target=输入视口 rect,x 精确,
//        y/h 实测固化——HTML align 语义 vs Godot fill 的固有偏差如实暴露,不伪装全绿);
//   4v2. 用例 4 追加 style_verify 全绿断言(「生成快照全绿≠引擎行为」的数字防线:
//        measure 脚本 get_theme_stylebox 读回 override 生效值逐字段 diff);
//   6v2. 用例 6 追加三组合 style_verify(端到端验证 override 真设上 + 期望清单只含产出槽);
//   7. 新增:手写树 styleboxes + genUiMeasureScript 无期望清单(第 4 参 undefined)
//      → override 并集读回(has_theme_stylebox_override 右侧,spec §4.1 I-B)。
// 模式复用 test/integration/ui-layout-integration.test.ts:临时项目 project.godot 1280x720
// + main.tscn 根 Control 固定 offsets(勿 full_rect——headless Window 实际尺寸不反映 project
// 设置,上轮 2496 教训);重载验证走 genUiMeasureScript 直调(executor 层,不经 handler)。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeGdscriptTrusted } from '../../src/gdscript-executor.js';
import { genUiImportSingleScript } from '../../src/tools/ui/ui-import-single.js';
import { genUiMeasureScript } from '../../src/tools/ui/ui-measure.js';
import { handleTool } from '../../src/tools/ui/index.js';
import type { ToolContext, ToolResult } from '../../src/types.js';
import type { UiNodeSpec } from '../../src/tools/ui/types.js';

const GODOT = process.env.GODOT_PATH;
const run = !!GODOT && process.platform === 'win32';

// fixture 仓库路径(ESM 无 __dirname,经 import.meta.url 定位)
const RTS_FIXTURE = fileURLToPath(new URL('../fixtures/prototype-geometry/rts-hud.json', import.meta.url));
const CARD_FIXTURE = fileURLToPath(new URL('../fixtures/prototype-geometry/css-card.json', import.meta.url));

// 集成耗时记录:两次 spawn 首版实测 ~6s(历史基线,spec §6 决策依据);PR-4 起单 spawn 合成,importElapsedMs 为单 spawn 耗时
let importElapsedMs = 0;

/** 临时 Godot 项目:project.godot + 根 Control 固定 offsets(尺寸须与 geometry viewport
 * 一致——锚点求解产比例 anchor,viewport≠scene 根尺寸时整树被拉伸,layout diff 全偏)。
 * (PR-4 起模块级:末尾篡改磁盘 describe 块与首个 describe 块共用。) */
function mkProject(prefix: string, w = 1280, h = 720): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(d, 'project.godot'),
    `config_version=5\n\n[display]\nwindow/size/viewport_width=${w}\nwindow/size/viewport_height=${h}\n`);
  // 根 Control 固定 offsets(合成根 _PrototypeRoot rect=viewport 的求解基准;勿 full_rect
  // ——headless Window 实际尺寸不反映 project 设置,上轮 2496 教训)
  writeFileSync(join(d, 'main.tscn'),
    `[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = ${w}.0\noffset_bottom = ${h}.0\n`);
  return d;
}

describe.skipIf(!run)('ui_import_prototype 集成验收(真跑 Godot)', () => {
  let dir: string;      // RTS 项目(geometry_path 链路)
  let dirFlow: string;  // mini-flow 项目(inline geometry 链路)
  let dirCard: string;  // css-card 项目(StyleBox 通道验收)

  beforeAll(() => {
    dir = mkProject('ui-import-rts-');
    dirFlow = mkProject('ui-import-flow-');
    // css-card viewport 800x600 → 项目尺寸同建(否则整树锚点拉伸,diff 全偏)
    dirCard = mkProject('ui-import-card-', 800, 600);
    // fixture 拷入临时项目子目录(经 geometry_path 相对路径读入,走 res:// 剥离+白名单链)
    mkdirSync(join(dir, 'proto'), { recursive: true });
    copyFileSync(RTS_FIXTURE, join(dir, 'proto', 'rts-hud.json'));
    mkdirSync(join(dirCard, 'proto'), { recursive: true });
    copyFileSync(CARD_FIXTURE, join(dirCard, 'proto', 'css-card.json'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirFlow, { recursive: true, force: true });
    rmSync(dirCard, { recursive: true, force: true });
    // eslint-disable-next-line no-console -- 集成耗时是 spec 开放问题 3 的决策数据,随测试输出留档
    console.log(`[ui-import-integration] RTS 一次调用(PR-4 单 spawn 合成:build+persist+reload+measure)实测耗时: ${importElapsedMs}ms(两次 spawn 历史基线 ~6s)`);
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

    // PR-4 耗时回归绊线:单 spawn 合成后应显著低于两次 spawn 基线(~6s);上限 10s
    // (>3x 余量,CI 2 核 runner 安全)。数值留档进 CHANGELOG 0.32.4 段。
    expect(importElapsedMs).toBeLessThan(10_000);

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
    // 硬下限,h<27 被 clamp,实测原型 h=16 落地 27 且与 HpText 重叠 5px)。
    // PR-1 联动(2026-08-17 Task 4 后再修):HpBar 带 bg+fill(StyleBox 双槽 override),
    // 规则 7 经三组合实测(全组合被钳:无 override/bg-only/fill-only/bg+fill →
    // 27/23/27/23)恢复为无条件预警(h<27 一律警)——HpBar h=27 恰不触警(27<27 为
    // false),本 fixture 仍不产该 warning,dh=0 全绿。注意:override 只降不除钳制
    // ——h<23 仍会被钳到 23(三组合实测见下方用例)。
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

    // I-1(final review 端到端证据):HpBar 为显式 ProgressBar 无 bg——旧实现对一切无 text
    // 节点设 self_modulate alpha 0(HP 条不可见而 layout diff 不查 visible,验收假绿);
    // 修复后自带视觉控件(ProgressBar/Button/显式 type)豁免,落盘场景 HpBar 段应无 self_modulate。
    const sceneText = readFileSync(join(dir, 'main.tscn'), 'utf-8');
    const hpBarSeg = sceneText.split('[node name="HpBar"')[1]?.split('\n[node')[0] ?? '';
    expect(hpBarSeg, `HpBar 落盘段被设透明壳: ${hpBarSeg}`).not.toContain('self_modulate');

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
        flow_verify: Array<{
          path: string;
          target: { x: number; y: number; w: number; h: number };
          actual: { x: number; y: number; w: number; h: number } | null;
          delta: { dx: number; dy: number; dw: number; dh: number };
          ok: boolean;
        }>;
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

    // ── PR-2 flow_verify(spec §4.2,消解 B-2 盲区):flow 直接子层数字清单 ──
    const fv = parsed.data.flow_verify;
    // eslint-disable-next-line no-console -- flow_verify 实测校准数据(spec §10.5 开放问题决策输入),随测试输出留档
    console.log(`[flow_verify 实测] ${JSON.stringify(fv)}`);
    expect(fv).toHaveLength(3);
    expect(fv.map(e => e.path)).toEqual([
      '_PrototypeRoot/Holder/Holder_Flow/BtnA',
      '_PrototypeRoot/Holder/Holder_Flow/BtnB',
      '_PrototypeRoot/Holder/Holder_Flow/BtnC',
    ]);
    // target = 输入视口 rect(期望语义:space-between 三按钮 100/268/436,垂直居中 y=104,72x32)
    expect(fv[0]!.target).toEqual({ x: 100, y: 104, w: 72, h: 32 });
    expect(fv[1]!.target).toEqual({ x: 268, y: 104, w: 72, h: 32 });
    expect(fv[2]!.target).toEqual({ x: 436, y: 104, w: 72, h: 32 });
    // actual 直接对比(global rect vs 视口绝对,不做父相对换算)
    expect(fv.every(e => e.actual !== null)).toBe(true);
    // x 方向精确(dx≈0——space-between 排布与输入一致,与下方重载 gap 96 断言同源)
    for (const e of fv) {
      expect(Math.abs(e.delta.dx), `${e.path} dx=${e.delta.dx}`).toBeLessThanOrEqual(2);
    }
    // ── y/h 实测固化(校准循环:首跑观察 → 固化,Godot 4.6.3 headless,2026-08-18)──
    // HTML flex 默认 align-items:stretch 但按钮输入 h=32 < 容器 40(Godot HBox 子垂直
    // size_flags 默认 FILL → 拉伸):实测落地 h=39(容器 40 下 FILL 未拉满 1px,引擎实测
    // 行为)且 y 顶到容器顶(实测 y=100.0000076,1e-5 级 float 残差)——三按钮一致
    // dy=-4 / dh=+7 / dx=0 / dw=0。系统性固有偏差,flow_verify 如实暴露(spec §4.2
    // 偏差即价值),ok=false(tolerance=2)不伪装全绿;修正属原型侧(给 flow 子节点与
    // 容器等高的 rect)或后续翻译规则(垂直 size_flags 映射),不属本层。
    for (const e of fv) {
      expect(Math.round(e.delta.dy), `${e.path} dy=${e.delta.dy}`).toBe(-4);
      expect(Math.round(e.delta.dh), `${e.path} dh=${e.delta.dh}`).toBe(7);
      expect(Math.round(e.delta.dw), `${e.path} dw=${e.delta.dw}`).toBe(0);
      expect(e.ok, `${e.path} 超容差(tolerance=2)应如实红`).toBe(false);
    }
    // 抽查 BtnA 实测 rect 精确值(h=39 为 FILL 拉伸落地值;x 精确;y 有 1e-5 级残差用容差)
    expect(fv[0]!.actual!.w).toBe(72);
    expect(fv[0]!.actual!.h).toBe(39);
    expect(fv[0]!.actual!.x).toBe(100);
    expect(Math.abs(fv[0]!.actual!.y - 100)).toBeLessThanOrEqual(0.01);

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

  // ─── 用例 4:css-card 样式三件套 → .tscn StyleBoxFlat(PR-1 端到端验收) ──────

  it('css-card: 样式三件套 → .tscn StyleBoxFlat sub_resource + draw_center=false + 全绿', { timeout: 90000 }, async () => {
    // fixture 校准留痕(spec §7 方法论:本 fixture 无程序化真值,跑红→修绿即期望值来源):
    //   - Title(h=28,fontSize18)/TagChip(h=22,fontSize12):首跑实测 dh=0——Label normal
    //     槽 override 为空 margin StyleBoxFlat(minimum [0,0]),不顶开 Label 最小高,
    //     brief 预设的「可能需调大 rect.h」未发生,fixture 未动;
    //   - HpBar:首跑 h=20 → 实测落地 27(dh=7)——ProgressBar 27px 固有最小高(stylebox
    //     override 不消除,见三组合用例),按校准循环 fixture h=20→27(y=290 不动,
    //     底边 317 < 父 BorderOnly 底 340,包含关系不变)。
    const result = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dirCard,
      scene_path: 'res://main.tscn',
      geometry_path: 'proto/css-card.json',
    }, createCtx());
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result)) as {
      data: {
        layout_verify: { diff: Array<{ ok: boolean; path: string; delta: unknown }> };
        style_verify: Array<{
          path: string; slot: string; field: string;
          target: number | number[] | string | null;
          actual: number | number[] | string | null;
          delta: number | number[] | null; ok: boolean;
        }>;
      };
    };
    const bad = parsed.data.layout_verify.diff.filter(d => !d.ok);
    expect(bad, `不绿 diff: ${JSON.stringify(bad)}`).toEqual([]);

    // ── PR-2 style_verify(spec §4.1):override 全部落盘生效的数字防线 ──
    // 「生成快照全绿≠引擎行为」:sub_resource 落盘文本正确 ≠ add_theme_stylebox_override
    // 后 get_theme_stylebox 读回值正确——此处对引擎读回的生效值逐字段 diff。
    const sv = parsed.data.style_verify;
    // eslint-disable-next-line no-console -- style_verify 条数实测校准数据,随测试输出留档
    console.log(`[style_verify 实测] 共 ${sv.length} 条: ${sv.map(e => `${e.path}:${e.slot}/${e.field}`).join(', ')}`);
    const badStyle = sv.filter(e => !e.ok);
    expect(badStyle, `不绿 style_verify: ${JSON.stringify(badStyle)}`).toEqual([]);
    // 条目计数护栏(fixture 变更须同步,照用例 1 的 23 节点护栏先例):
    //   CardBg 10(bg_color1+corner4+border_width4+border_color1)
    //   + Title 5(bg_color1+corner4)+ TagChip 5(同构;Title/TagChip 几何包含于
    //     CardBg → 树内挂 _PrototypeRoot/CardBg/ 下,path 含父链)
    //   + BorderOnly 9(corner4+border_width4+border_color1,无 bg→无 bg_color 条目,
    //     draw_center 永不比对)
    //   + HpBar 2(几何包含于 BorderOnly → 挂 _PrototypeRoot/BorderOnly/ 下;
    //     background/fill 各 bg_color1)= 31。
    // 计数勘误留痕:plan/brief 原文 34 与任务修正 33 均笔误——34 把 CardBg 误算 11;
    // 33 修了 CardBg 却把 Title/TagChip 误算 6(Label badge 只有 bg_color+corner_radius
    // 两个显式字段 → 1+4=5,fixture 无 border)。按 2026-08-18 真跑实测 31 固化。
    expect(sv).toHaveLength(31);
    // 抽查 CardBg/panel bg_color:target = #1a1f2e 归一 [26/255,31/255,46/255,1],
    // delta 分量 ≤0.002(Color float32 序列化漂移,STYLE_COLOR_TOL 同款)
    const cardBg = sv.find(e => e.path === '_PrototypeRoot/CardBg' && e.slot === 'panel' && e.field === 'bg_color')!;
    expect(cardBg, 'CardBg/panel bg_color 条目缺失').toBeDefined();
    expect(cardBg.target).toEqual([26 / 255, 31 / 255, 46 / 255, 1]);
    for (const d of cardBg.delta as number[]) {
      expect(Math.abs(d), `CardBg bg_color delta 分量超容差: ${JSON.stringify(cardBg)}`).toBeLessThanOrEqual(0.002);
    }
    // 抽查 corner_radius_top_left(target 12)与 border_width_left(target 2)精确匹配
    const ctl = sv.find(e => e.path === '_PrototypeRoot/CardBg' && e.field === 'corner_radius_top_left')!;
    expect(ctl.target).toBe(12);
    expect(ctl.actual).toBe(12);
    expect(ctl.ok).toBe(true);
    const bwl = sv.find(e => e.path === '_PrototypeRoot/CardBg' && e.field === 'border_width_left')!;
    expect(bwl.target).toBe(2);
    expect(bwl.actual).toBe(2);
    expect(bwl.ok).toBe(true);
    // BorderOnly(无 bg)不产 bg_color 条目(box 无 bg_color 字段即不比对)
    expect(sv.some(e => e.path.endsWith('/BorderOnly') && e.field === 'bg_color')).toBe(false);
    // HpBar(几何包含于 BorderOnly → 树内非顶层,用 endsWith)有 background+fill 两槽各 1 条 bg_color
    const hpBg = sv.filter(e => e.path.endsWith('/HpBar') && e.field === 'bg_color');
    expect(hpBg.map(e => e.slot).sort()).toEqual(['background', 'fill']);
    expect(hpBg.every(e => e.ok)).toBe(true);

    const sceneText = readFileSync(join(dirCard, 'main.tscn'), 'utf-8');
    // bg+radius+border → StyleBoxFlat sub_resource 落盘。
    // 落盘属性名是 theme_override_styles/<slot>(Godot 4.7 序列化名;spec/brief 原文
    // theme_override_styleboxes/ 系误写,且 node.set 该路径 pack 丢 override——生成器
    // 已改 add_theme_stylebox_override API,见 ui-layout.ts genStyleboxLines 注释)。
    expect(sceneText).toContain('[sub_resource type="StyleBoxFlat"');
    expect(sceneText).toContain('theme_override_styles/panel');
    // Label badge:Title/TagChip 走 normal 槽
    expect(sceneText).toContain('theme_override_styles/normal');
    // border 无 bg → draw_center=false(CSS 透明底)
    expect(sceneText).toMatch(/draw_center = false/);
    // ProgressBar 双槽
    expect(sceneText).toContain('theme_override_styles/background');
    expect(sceneText).toContain('theme_override_styles/fill');
    // modulate 近似通道已删:全场景无翻译器产出的 modulate 行(self_modulate 透明壳除外)
    expect(sceneText).not.toMatch(/^\s*modulate = /m);
  });

  // ─── 用例 5:Label normal 槽 headless 引擎实测(spec §10.3/N-1) ─────────────

  it('Label normal stylebox 槽引擎实测:override 后 get_theme_stylebox 读回 StyleBoxFlat', { timeout: 60000 }, async () => {
    // spec §10.3 开放问题:Label 主题 normal 槽是否真能 override/读回(引擎事实)——
    // badge 映射(§3.4:Label text+bg 一比一,无需外包 Panel)的前提。实测 consumption
    // 照 measureFromDisk 同款:outputs.find(key) → JSON.parse(value 字符串)。
    // Color 是 float32 存储,JSON 序列化 0.2 → 0.2000000029…,断言用容差不做全等。
    // code 缩进必须 tab:executor 注入的 _mcp_output/_mcp_done helper 用 tab,GDScript
    // 文件级缩进混用(前 tab 后空格)是 Parse Error(首跑实测)。
    const res = await executeGdscriptTrusted({
      godotPath: GODOT!,
      projectPath: dirCard,
      code: `
extends SceneTree
func _initialize():
\tvar l := Label.new()
\tvar sb := StyleBoxFlat.new()
\tsb.bg_color = Color(0.2, 0.3, 0.4, 1.0)
\tl.add_theme_stylebox_override("normal", sb)
\tvar got = l.get_theme_stylebox("normal")
\tvar flat := got is StyleBoxFlat
\tvar bg := [0.0, 0.0, 0.0, 0.0]
\tif flat:
\t\tvar f := got as StyleBoxFlat
\t\tbg = [f.bg_color.r, f.bg_color.g, f.bg_color.b, f.bg_color.a]
\t_mcp_output("label_normal", JSON.stringify({"is_flat": flat, "bg": bg}))
\t_mcp_done()
`,
      timeout: 30,
    });
    expect(res.compile_success, res.compile_error).toBe(true);
    expect(res.run_success, res.run_error).toBe(true);
    const out = JSON.parse(String(res.outputs.find(o => o.key === 'label_normal')!.value)) as {
      is_flat: boolean; bg: number[];
    };
    expect(out.is_flat, `get_theme_stylebox("normal") 非 StyleBoxFlat: ${JSON.stringify(out)}`).toBe(true);
    expect(Math.abs(out.bg[0]! - 0.2)).toBeLessThan(0.002);
    expect(Math.abs(out.bg[1]! - 0.3)).toBeLessThan(0.002);
    expect(Math.abs(out.bg[2]! - 0.4)).toBeLessThan(0.002);
    expect(Math.abs(out.bg[3]! - 1.0)).toBeLessThan(0.002);
  });

  // ─── 用例 6:ProgressBar 三组合钳制实测(spec §10.4 开放问题 4) ────────────

  it('ProgressBar 三组合(h=16)钳制实测:bg-only / fill-only / bg+fill', { timeout: 240000 }, async () => {
    // 规则 7 修正(spec §3.5 I-3):ProgressBar minimum_size 取 background+fill 两槽
    // stylebox 最小尺寸的最大值;实测四组合钳制 27/23/27/23 已落 warning 文案与规则
    // 文件(规则 7 无条件预警),本用例固化三组合 h=16(< 默认主题 27)数值(spec
    // 开放问题 4 的决策输入)。
    // 首跑校准循环:先 console.log 观察 dh 再固化为断言——本 fixture 无程序化真值,
    // 跑红→修绿的实测记录就是期望值来源(不伪装有真值)。
    interface HpDiff { dh: number; actualH: number; sceneText: string; styleVerify: Array<{ path: string; slot: string; field: string; target: number | number[] | string | null; ok: boolean }> }
    const runCombo = async (key: string, extra: Record<string, unknown>): Promise<HpDiff> => {
      // 每组合独立临时项目(同项目重复 import 会叠加多个 _PrototypeRoot)
      const d = mkProject(`ui-import-pb-${key.replace('+', '-')}-`);
      try {
        const result = await handleTool('ui', {
          action: 'ui_import_prototype',
          project_path: d,
          scene_path: 'res://main.tscn',
          geometry: {
            // viewport 对齐项目 1280x720(锚点求解产比例 anchor,viewport≠项目尺寸时
            // 整树被拉伸,dh 变成「拉伸+钳制」混合值,测不出纯钳制数据——首跑实测教训)
            viewport: { w: 1280, h: 720 },
            nodes: [{ name: 'HpBar', rect: { x: 20, y: 40, w: 280, h: 16 }, type: 'ProgressBar', value: 0.5, ...extra }],
          },
        }, createCtx());
        expect(result).not.toBeNull();
        expect(result!.isError).toBeFalsy();
        const parsed = JSON.parse(textOf(result)) as {
          data: {
            layout_verify: { diff: Array<{ path: string; delta: { dh: number }; actual: { h: number } | null }> };
            style_verify: Array<{ path: string; slot: string; field: string; target: number | number[] | string | null; ok: boolean }>;
          };
        };
        const hp = parsed.data.layout_verify.diff.find(e => e.path.endsWith('/HpBar'));
        expect(hp, 'HpBar 未进 layout_verify diff').toBeDefined();
        // eslint-disable-next-line no-console -- 三组合实测数据是 spec 开放问题 4 的决策记录,随测试输出留档
        console.log(`[pb-combo:${key}] target h=16 → actual h=${hp!.actual?.h}(dh=${hp!.delta.dh}), style_verify=${JSON.stringify(parsed.data.style_verify)}`);
        return { dh: hp!.delta.dh, actualH: hp!.actual?.h ?? -1, sceneText: readFileSync(join(d, 'main.tscn'), 'utf-8'), styleVerify: parsed.data.style_verify };
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    };

    const bgOnly = await runCombo('bg-only', { bg: '#223022' });
    const fillOnly = await runCombo('fill-only', { fill: '#3ddc84' });
    const bgFill = await runCombo('bg+fill', { bg: '#223022', fill: '#3ddc84' });

    // ── 实测固化断言(Godot_v4.7.1-stable_win64 headless,2026-08-17 StyleBox 通道修复后)──
    // spec §10.4 开放问题 4 的实测答案(校准循环二轮:前任 +11 数据系 set() 属性名 bug
    // 期 override 未生效的无效值,修复后 override 真实落盘,重测):
    //   bg-only   h=16 → actual 23(dh=+7) —— background 槽被空 StyleBoxFlat override,
    //                                     默认主题 background stylebox 的 margin 不再顶开,最小高 23;
    //   fill-only h=16 → actual 27(dh=+11)—— background 保留默认主题 stylebox,27 照旧;
    //   bg+fill   h=16 → actual 23(dh=+7) —— 与 bg-only 相同(决定最小高的是 background 槽)。
    // 结论:① override 确实改变钳制值(spec §3.5 I-3 方向成立,但数值非其推断);
    // ② 「bg+fill 双 override 钳制消失」不成立——h=16 仍被钳到 23(23px 是 override 后
    // 的新下限;fill-only 场景 27 来自默认主题 background stylebox);
    // ③ 规则 7「有 override 不预警」下 bg-only/bg+fill 的 h<23 条静默被钳——该决策点
    // 已于 2026-08-17 裁定落地:恢复无条件预警(h<27 一律警,文案分档 27/23/27/23)。
    // 分组固化:bg-only 与 bg+fill 同组(background 槽 override → 最小高 23);
    // fill-only 独组(background 默认主题 → 27)。
    for (const [name, r, dh, actualH] of [
      ['bg-only', bgOnly, 7, 23], ['fill-only', fillOnly, 11, 27], ['bg+fill', bgFill, 7, 23],
    ] as const) {
      expect(Math.round(r.dh), `${name} dh 实测后固化(见上方校准注释)`).toBe(dh);
      expect(r.actualH, `${name} actual h 实测后固化`).toBe(actualH);
    }
    // fill-only 形态(Task 2 审查遗留项):background 槽无 override(翻译器仅 bg/border
    // 才产主槽 override)且钳制仍发生(dh=11>0)——与「bg 缺省时默认主题 27px 下限照常
    // 生效」的预期相符;与 bg-only/bg+fill 对照:override background 才降低下限(23)。
    // (落盘断言用 theme_override_styles/ 序列化名,见用例 4 注释)
    expect(fillOnly.sceneText).toContain('theme_override_styles/fill');
    expect(fillOnly.sceneText, 'fill-only 不应产 background 槽 override').not.toContain('theme_override_styles/background');
    expect(bgOnly.sceneText).toContain('theme_override_styles/background');
    expect(bgFill.sceneText).toContain('theme_override_styles/background');
    expect(bgFill.sceneText).toContain('theme_override_styles/fill');
    // 对照语义固化:background 槽被 override 的两组合钳制值相同(23px 新下限)
    expect(bgOnly.dh).toBe(bgFill.dh);

    // ── PR-2 style_verify 三组合断言(端到端验证 override 真设上 + 期望清单只含产出槽)──
    // 读回值来自 measure 的 get_theme_stylebox 生效值——落盘文本断言(上方 toContain)
    // 之外的引擎行为防线;颜色 target 为 #223022/#3ddc84 归一值,float32 漂移由
    // diffStyles 容差(0.002)吸收,此处断言 ok 与 target 精确值。
    // bg-only:仅 background 槽 1 条绿(bg 槽 override 产出;fill 无输入不产出)
    expect(bgOnly.styleVerify).toHaveLength(1);
    const bgOnlyBg = bgOnly.styleVerify[0]!;
    expect(bgOnlyBg.slot).toBe('background');
    expect(bgOnlyBg.field).toBe('bg_color');
    expect(bgOnlyBg.target).toEqual([34 / 255, 48 / 255, 34 / 255, 1]);
    expect(bgOnlyBg.ok).toBe(true);
    // fill-only:恰好 fill 槽 1 条绿——同时验证「期望清单只含产出槽」(fill-only 翻译
    // 不产 background override,style_expect 不含它,style_verify 也不冒出默认主题读回)
    expect(fillOnly.styleVerify).toHaveLength(1);
    const fillOnlyFill = fillOnly.styleVerify[0]!;
    expect(fillOnlyFill.slot).toBe('fill');
    expect(fillOnlyFill.field).toBe('bg_color');
    expect(fillOnlyFill.target).toEqual([61 / 255, 220 / 255, 132 / 255, 1]);
    expect(fillOnlyFill.ok).toBe(true);
    // bg+fill:两条(background+fill)全绿
    expect(bgFill.styleVerify).toHaveLength(2);
    expect(bgFill.styleVerify.map(e => e.slot).sort()).toEqual(['background', 'fill']);
    expect(bgFill.styleVerify.every(e => e.field === 'bg_color' && e.ok)).toBe(true);
  });

  // ─── 用例 7:手写树 override 并集读回(spec §4.1 I-B 并集右侧) ──────────────

  it('手写树 styleboxes + 无期望清单 measure:override 槽仍被读回(flat=true)', { timeout: 90000 }, async () => {
    // spec §4.1 I-B 并集条件右侧:期望清单(左侧)缺省时,has_theme_stylebox_override
    // 非空的节点也被按需读回——手写树场景(ui_build_layout 直接带 styleboxes,不经
    // ui_import_prototype 翻译)无人产期望清单,若无并集右侧则 override 完全不可见。
    const d = mkProject('ui-import-manual-');
    try {
      const built = await handleTool('ui', {
        action: 'ui_build_layout',
        project_path: d,
        scene_path: 'res://main.tscn',
        persist: true,
        tree: {
          type: 'Panel', name: 'Root', rect: { x: 0, y: 0, w: 400, h: 300 },
          children: [{
            type: 'Panel', name: 'Card', rect: { x: 10, y: 10, w: 200, h: 100 },
            styleboxes: [{ slot: 'panel', box: { bg_color: [0.1, 0.2, 0.3, 1], corner_radius: 6 } }],
          }],
        },
      }, createCtx());
      expect(built).not.toBeNull();
      expect(built!.isError).toBeFalsy();
      const builtData = JSON.parse(textOf(built)) as { data?: { persist?: { saved?: boolean } } };
      expect(builtData.data?.persist?.saved, 'ui_build_layout persist 落盘失败').toBe(true);

      // genUiMeasureScript 第 4 参 undefined(executor 层直调):无期望清单注入
      // (脚本 _style_expect 恒空字典),读回判定只剩 override 非空并集右侧
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        code: genUiMeasureScript(join(d, 'main.tscn'), undefined, 16),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      const m = JSON.parse(String(res.outputs.find(o => o.key === 'measure')!.value)) as {
        nodes: Array<{
          path: string;
          styles?: Array<{
            slot: string; flat: boolean;
            bg_color?: [number, number, number, number];
            corner_radius?: { tl: number; tr: number; br: number; bl: number };
          }>;
        }>;
      };
      const card = m.nodes.find(n => n.path === 'Root/Card');
      expect(card, 'measure 缺 Root/Card').toBeDefined();
      const cardStyles = card!.styles ?? [];
      // eslint-disable-next-line no-console -- 手写树并集读回实测数据,随测试输出留档
      console.log(`[manual-tree styles 实测] Root/Card = ${JSON.stringify(cardStyles)}`);
      const panel = cardStyles.find(s => s.slot === 'panel');
      expect(panel, `Root/Card styles 应含 override 槽 panel: ${JSON.stringify(cardStyles)}`).toBeDefined();
      expect(panel!.flat, 'panel 槽读回应为 StyleBoxFlat').toBe(true);
      // Color float32 漂移用容差(与集成用例 5 同款断言方式)
      expect(Math.abs(panel!.bg_color![0] - 0.1)).toBeLessThan(0.002);
      expect(Math.abs(panel!.bg_color![1] - 0.2)).toBeLessThan(0.002);
      expect(Math.abs(panel!.bg_color![2] - 0.3)).toBeLessThan(0.002);
      expect(Math.abs(panel!.bg_color![3] - 1.0)).toBeLessThan(0.002);
      expect(panel!.corner_radius!.tl).toBe(6);
      // 无 override 的 Root 不被读(并集语义:无期望清单时仅 override 非空节点读回,
      // Root 只建树无 styleboxes → styles 字段不产出)
      const root = m.nodes.find(n => n.path === 'Root');
      expect(root, 'measure 缺 Root').toBeDefined();
      expect(root!.styles, 'Root 无 override 不应有 styles 读回').toBeUndefined();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ─── PR-4:reload CACHE_MODE_IGNORE 断言(spec §6 验收:篡改磁盘,防 reload 假绿)───
// 注入方式沿 buildThenMeasure 先例:call_deferred("_measure_go") 替换为 _tamper_go
// (写盘篡改后调真 _measure_go)——被测 reload+measure 逻辑零改动。若 reload 回退为裸
// load,同进程二载命中 ResourceCache 里 build 前 load 的原场景(1280x720 无子树),
// 篡改内容(100x50)测不到 → 断言红;只有真读磁盘才绿。
describe.skipIf(!run)('PR-4 单 spawn 合成与篡改磁盘断言(真跑 Godot)', () => {
  const TREE: UiNodeSpec = { type: 'Panel', name: 'P', rect: { x: 10, y: 10, w: 200, h: 100 }, children: [] };

  function withTamperHook(script: string, sceneAbs: string, tamperedTscn: string): string {
    // GD 字符串字面量:JSON.stringify 产出的转义(\" 与 \n)恰为 GDScript 同款转义;
    // 路径统一正斜杠(Windows Godot 兼容,且免反斜杠转义问题)
    const gd = `func _tamper_go() -> void:
\tvar _f := FileAccess.open("${sceneAbs.replace(/\\/g, '/')}", FileAccess.WRITE)
\t_f.store_string(${JSON.stringify(tamperedTscn)})
\t_f.close()
\t_measure_go()
`;
    const hooked = script.replace('call_deferred("_measure_go")', 'call_deferred("_tamper_go")');
    expect(hooked).not.toBe(script); // 锚点命中护栏:注入失败即测试红
    return hooked + gd;
  }

  it('单 spawn 合成:build→persist→reload→measure 一次进程完成,P 节点 rect 正确', { timeout: 90000 }, async () => {
    const d = mkProject('ui-import-single-');
    try {
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        code: genUiImportSingleScript(join(d, 'main.tscn'), 'root', TREE, { w: 1280, h: 720 }, undefined),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      expect(res.outputs.some(o => o.key === 'error')).toBe(false);
      const persist = res.outputs.find(o => o.key === 'persist');
      expect(persist).toBeTruthy();
      expect(JSON.parse(String(persist!.value)).saved).toBe(true);
      const measure = JSON.parse(String(res.outputs.find(o => o.key === 'measure')!.value)) as {
        nodes: Array<{ path: string; rect: { x: number; y: number; w: number; h: number } }>;
      };
      const p = measure.nodes.find(n => n.path === 'P');
      expect(p).toBeTruthy();
      expect(Math.abs(p!.rect.x - 10)).toBeLessThanOrEqual(1);
      expect(Math.abs(p!.rect.w - 200)).toBeLessThanOrEqual(1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('篡改磁盘(换 Hacked 100x50 场景)→ reload 测出篡改内容,证明绕过 ResourceCache', { timeout: 90000 }, async () => {
    const d = mkProject('ui-import-tamper-');
    try {
      const script = genUiImportSingleScript(join(d, 'main.tscn'), 'root', TREE, { w: 1280, h: 720 }, undefined);
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        code: withTamperHook(script, join(d, 'main.tscn'),
          '[gd_scene format=3]\n\n[node name="Hacked" type="Control"]\noffset_right = 100.0\noffset_bottom = 50.0\n'),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      expect(res.outputs.some(o => o.key === 'error')).toBe(false);
      const measure = JSON.parse(String(res.outputs.find(o => o.key === 'measure')!.value)) as {
        nodes: Array<{ path: string; rect: { w: number; h: number } }>;
      };
      const rootEntry = measure.nodes.find(n => n.path === '.');
      expect(rootEntry).toBeTruthy();
      expect(Math.abs(rootEntry!.rect.w - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(rootEntry!.rect.h - 50)).toBeLessThanOrEqual(1);
      expect(measure.nodes.some(n => n.path.includes('P'))).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('篡改磁盘(非场景资源)→ reload 失败错误内嵌恢复语义「build 已持久化,可重跑」', { timeout: 90000 }, async () => {
    const d = mkProject('ui-import-tamper-err-');
    try {
      const script = genUiImportSingleScript(join(d, 'main.tscn'), 'root', TREE, { w: 1280, h: 720 }, undefined);
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        // brief Step 2 注记裁决(2026-08-18 实测):纯垃圾文本使 ResourceLoader 产出
        // "ERROR: res://main.tscn:1 - Parse Error: Expected '['." 进 stderr → executor 判
        // compile_success=false(脚本未获机会跑);换合法但非场景资源走模板
        // not (_rl is PackedScene) 分支,同一错误输出同一断言。
        code: withTamperHook(script, join(d, 'main.tscn'), '[gd_resource type="Resource" format=3]\n\n[resource]\n'),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      const errEntry = res.outputs.find(o => o.key === 'error');
      expect(errEntry).toBeTruthy();
      expect(String(errEntry!.value)).toContain('Scene reload failed (post-persist)');
      expect(String(errEntry!.value)).toContain('已持久化');
      expect(String(errEntry!.value)).toContain('ui_measure_layout');
      // 测量中止:无 measure 输出(build 已持久化在磁盘,可重跑 ui_measure_layout 补测量)
      expect(res.outputs.some(o => o.key === 'measure')).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
