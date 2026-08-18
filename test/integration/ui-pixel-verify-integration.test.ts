// test/integration/ui-pixel-verify-integration.test.ts
// PR-3 集成验收(spec 2026-08-17-prototype-stylebox-loop-design.md §5/§7):
// 真跑 Godot 窗口模式(会短暂弹窗——Windows headless=dummy renderer 截图空白,窗口模式
// 是唯一可靠渲染路径,spec §5 实测前提)。三用例:
//   1. css-card:ui_import_prototype 建场 → ui_pixel_verify 同图全绿(逐 bg 节点 5 采样点);
//   2. 容差校准(§10.2):首跑若阈值不过,记录实际 distance 分布 → 校准常量 → 复跑全绿,
//      校准过程在本文件注释如实留档(不静默调阈值);
//   3. 负向:geometry_path '../' 逃逸 → INVALID_PARAMS(集成层白名单,沿 import 用例 3 先例)。
// coverage 决策:pixel-verify.ts 不进 coverage exclude——纯函数(Task 1)跨平台单测覆盖,
// 编排 mock 单测(Task 2)覆盖分支,与 game-bridge「Linux CI 完全无法跑其测试」的排除理由
// 不同;本集成文件 Windows-only skip 照 ui-import-integration.test.ts:40 先例(const run = !!GODOT && win32,describe.skipIf)。
//
// ⚠️ 2026-08-18 首跑校准结论(§10.2 取证,Task 4 上报 BLOCKED,详见
// .superpowers/sdd/task-4-report.md;用例 1 暂 it.skip,解除前置见下方注释):
//   A. 零色彩偏移 + 零底噪:CardBg 5/5、Title 角 4/4、TagChip 角 4/4 共 13 采样点
//      distance=0.0(精确匹配)——CENTER_TOL=20 / CORNER_TOL=60 维持初值,无需校准;
//      spec §10.2 担忧的 linear/sRGB 系统偏差实测不存在(Godot 2D canvas 不做转换,
//      pixel-verify.ts 头注释预期获实测确认)。
//   B. F1(BLOCKING,capture 层):screenshot_capture.gd _detect_blank_image 的
//      step = w*h/100 = 4800 = 6×800 → 采样点全落在 x=0 单列(css-card 内容 x≥40 全被
//      漏采)→ 100% uniform > 95% → BLANK_DETECTED 误报,ui_pixel_verify 返回
//      ok:false「像素截图为空白」——Windows 窗口模式有真实渲染也被拦(PNG 实测含
//      CardBg #1a1f2e 精确色)。800x600/1000x500 等 w*h/100 为 w 整数倍的视口必中招。
//   C. F2(采样语义):HpBar(ProgressBar bg+fill+value=0.72)5/5 红,与阈值无关:
//      center d=289.6(Godot 4 show_percentage 默认 true,「72%」文字画在 bar 中心)、
//      tl d=199.8(fill #3ddc84 覆盖左缘)、tr/br/bl d=65.7(inset=0 角点踩 rect
//      半开区间外的未覆盖像素格,读到清屏灰 (76,76,76))。
//   D. F3(采样语义):Title center d=47.9 / TagChip center d=48.5——Label 文字水平
//      居中排版,采样中心点踩文字抗锯齿像素(文字色与 bg 按 t≈0.15-0.22 混合)。
//   E. F4(采样数学):inset=0(无 radius/border)时 tr/br/bl 角点 = rect 右/下边界
//      精确值,落在 rect 覆盖区([x,x+w)×[y,y+h))之外一像素格——tl 在内、其余三角
//      在外的不对称。CardBg/Title/TagChip 因 inset>0 不触发;HpBar 触发(65.7 红)。
//   按校准纪律(§10.2):F2/F3/F4 是采样语义问题,禁止用大阈值掩盖(48→可盖但毁掉
//   「中心严格」语义;290/200 无论何容差都盖不住),上报控制器裁决。修复选项矩阵
//   见 task-4-report.md(F1 修 screenshot_capture.gd 采样退化或 pixel-verify 改用
//   PNG 实际内容判空白;F2 或 skip 带 fill 的 ProgressBar bg 或翻译层关
//   show_percentage;F3 或采样点避开 Label 文字区;F4 或角点坐标 -1 内缩)。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTool } from '../../src/tools/ui/index.js';
import type { ToolContext, ToolResult } from '../../src/types.js';

const GODOT = process.env.GODOT_PATH;
const run = !!GODOT && process.platform === 'win32';
const CARD_FIXTURE = fileURLToPath(new URL('../fixtures/prototype-geometry/css-card.json', import.meta.url));

describe.skipIf(!run)('ui_pixel_verify 集成验收(真跑 Godot 窗口模式)', () => {
  let dir: string;

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
  const textOf = (r: ToolResult | null): string => {
    const el = r?.content?.[0];
    if (!el || el.type !== 'text') throw new Error('content[0] is not text');
    return el.text;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ui-pixel-verify-'));
    // css-card viewport 800x600 → 项目尺寸同建(anchor 拉伸防线,同 import 集成先例)
    writeFileSync(join(dir, 'project.godot'),
      `config_version=5\n\n[display]\nwindow/size/viewport_width=800\nwindow/size/viewport_height=600\n`);
    writeFileSync(join(dir, 'main.tscn'),
      `[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 800.0\noffset_bottom = 600.0\n`);
    mkdirSync(join(dir, 'proto'), { recursive: true });
    copyFileSync(CARD_FIXTURE, join(dir, 'proto', 'css-card.json'));
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  // 解除 it.skip 前置(2026-08-18 首跑取证):
  //   1. F1 修复(BLANK step 退化误报)——否则本用例死在「像素截图为空白」,到不了断言;
  //   2. F2/F3/F4 裁决落地(采样语义三处,任一方案使 css-card 全绿);
  //   3. 裁决若改 CENTER_TOL/CORNER_TOL,同步 test/pixel-verify.test.ts 容差边界用例
  //      的 [20,0,0]/[60,0,0] 断言值(前序审查遗留衔接 1)。
  it.skip('css-card:import 建场(前置绿)→ ui_pixel_verify 同图全绿', { timeout: 180_000 }, async () => {
    const imported = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dir, scene_path: 'main.tscn', geometry_path: 'proto/css-card.json',
    }, createCtx());
    const imp = JSON.parse(textOf(imported)) as {
      success: boolean; data?: { layout_verify?: { diff?: Array<{ ok: boolean }> }; style_verify?: Array<{ ok: boolean }> };
    };
    // 终验前置(spec §5):几何 + style 全绿才跑 pixel_verify——前置不绿时如实失败,
    // 不绕过前置直接像素验证(那会掩盖几何错位的采样错位)。
    // (import 前置链路已由 ui-import-integration.test.ts 用例 4 同 fixture 验收全绿。)
    expect(imp.success, JSON.stringify(imp)).toBe(true);
    expect(imp.data?.layout_verify?.diff?.every(d => d.ok)).toBe(true);
    expect(imp.data?.style_verify?.every(s => s.ok)).toBe(true);

    const result = await handleTool('ui', {
      action: 'ui_pixel_verify',
      project_path: dir, scene_path: 'main.tscn', geometry_path: 'proto/css-card.json',
    }, createCtx());
    const out = JSON.parse(textOf(result)) as {
      success: boolean;
      data?: { pixel_verify?: { nodes: Array<{ name: string; ok: boolean; samples: Array<{ id: string; distance: number | null }> }>; pass: number; fail: number; image: { width: number; height: number } } };
      error?: string;
    };
    expect(out.error).toBeUndefined();
    const pv = out.data?.pixel_verify;
    expect(pv, JSON.stringify(out)).toBeDefined();
    // 采样节点数 = fixture 中带 bg 的节点数(实测:CardBg/Title/TagChip/HpBar = 4,
    // Desc/BorderOnly 无 bg 不进,skipped 空——fixture 全不透明)
    expect(pv!.nodes.map(n => n.name)).toEqual(['CardBg', 'Title', 'TagChip', 'HpBar']);
    expect(pv!.fail).toBe(0);
    expect(pv!.pass).toBe(4);
    expect(pv!.nodes.every(n => n.ok)).toBe(true);
  });

  it('geometry_path ../ 逃逸 → INVALID_PARAMS(集成层路径白名单)', { timeout: 30_000 }, async () => {
    const result = await handleTool('ui', {
      action: 'ui_pixel_verify',
      project_path: dir, scene_path: 'main.tscn', geometry_path: '../escape.json',
    }, createCtx());
    expect(textOf(result)).toContain('INVALID_PARAMS');
  });
});
