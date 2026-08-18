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
// ⚠️ 2026-08-18 首跑校准结论(§10.2 取证,详见 .superpowers/sdd/task-4-report.md):
//   A. 零色彩偏移 + 零底噪:CardBg 5/5、Title 角 4/4、TagChip 角 4/4 共 13 采样点
//      distance=0.0(精确匹配)——CENTER_TOL=20 / CORNER_TOL=60 维持初值,无需校准;
//      spec §10.2 担忧的 linear/sRGB 系统偏差实测不存在(Godot 2D canvas 不做转换,
//      pixel-verify.ts 头注释预期获实测确认)。
//   B-F. F1-F4 四项缺陷(详见 task-4-report.md §2.4/§6)已于同日按控制器裁决修复落地:
//      F1 BLANK 误报 → TS 侧双条件拦截(stdout BLANK_DETECTED 且 PNG 8x8 网格均匀才拦,
//        不动 screenshot_capture.gd);
//      F2 HpBar 5/5 红 → collectBgTargets skip ProgressBar 系 bg(本用例 HpBar 进
//        skipped,采样节点 4→3:CardBg/Title/TagChip,pass=3);
//      F3 Label 文字居中 center 红 → 带 text 节点 skipCenter(Title/TagChip 各 4 采样点);
//      F4 角点半开区间 → computeSamplePoints 右/下分量 x+w-1-inset / y+h-1-inset。
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

  // 2026-08-18 F1-F4 修复落地后解除 skip(原取证期 it.skip 留档见 git 历史 235487b):
  // HpBar(ProgressBar)按 F2 裁决进 skipped → 采样节点 = CardBg/Title/TagChip 共 3,
  // Title/TagChip 带 text 按 F3 裁决各 4 采样点(无 center)。
  it('css-card:import 建场(前置绿)→ ui_pixel_verify 同图全绿', { timeout: 180_000 }, async () => {
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
      data?: { pixel_verify?: {
        nodes: Array<{ name: string; ok: boolean; samples: Array<{ id: string; distance: number | null }> }>;
        pass: number; fail: number;
        skipped: Array<{ name: string; reason: string }>;
        image: { width: number; height: number };
      } };
      error?: string;
    };
    expect(out.error).toBeUndefined();
    const pv = out.data?.pixel_verify;
    expect(pv, JSON.stringify(out)).toBeDefined();
    // 采样节点 = fixture 中带 bg 且不触发 skip 的节点(F2 后:CardBg/Title/TagChip;
    // HpBar 为 ProgressBar → skipped;Desc/BorderOnly 无 bg 不进)
    expect(pv!.nodes.map(n => n.name)).toEqual(['CardBg', 'Title', 'TagChip']);
    expect(pv!.fail).toBe(0);
    expect(pv!.pass).toBe(3);
    expect(pv!.nodes.every(n => n.ok)).toBe(true);
    // F2:HpBar 进 skipped,reason 指向 style_verify
    expect(pv!.skipped.map(s => s.name)).toEqual(['HpBar']);
    expect(pv!.skipped[0]!.reason).toContain('ProgressBar');
    // F3:带 text 的 Title/TagChip 各 4 采样点(无 center);CardBg 无 text 全 5 点
    const title = pv!.nodes.find(n => n.name === 'Title')!;
    const tagChip = pv!.nodes.find(n => n.name === 'TagChip')!;
    const cardBg = pv!.nodes.find(n => n.name === 'CardBg')!;
    expect(title.samples.map(s => s.id)).toEqual(['tl', 'tr', 'br', 'bl']);
    expect(tagChip.samples.map(s => s.id)).toEqual(['tl', 'tr', 'br', 'bl']);
    expect(cardBg.samples).toHaveLength(5);
  });

  it('geometry_path ../ 逃逸 → INVALID_PARAMS(集成层路径白名单)', { timeout: 30_000 }, async () => {
    const result = await handleTool('ui', {
      action: 'ui_pixel_verify',
      project_path: dir, scene_path: 'main.tscn', geometry_path: '../escape.json',
    }, createCtx());
    expect(textOf(result)).toContain('INVALID_PARAMS');
  });
});
