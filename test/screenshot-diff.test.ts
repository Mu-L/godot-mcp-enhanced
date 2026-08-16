// test/screenshot-diff.test.ts
// Task 4: screenshot(action=diff) 像素级双图对比。
// 纯 TS 测试(pngjs 合成图 + 入库历史校准图),零 Godot 依赖。
//
// 裁定要点:
// - threshold 语义:per-pixel sqrt(Δr²+Δg²+Δb²) / (√3×255),默认 0.12;**恰好等于阈值不计差(严格大于)**。
// - diff 图:差异像素染纯红 (255,0,0),其余保留 a 图原色;仅当提供 diff_path 时写出。
// - bbox:diff 像素包围盒;无差异 → null。
// - **忽略 alpha 只比 RGB**(pngjs 解码为 RGBA,比较维度仅 RGB 三通道)。
// - 路径策略:沿用 screenshot 工具现有链(analyze 的 image_path 读取链 + capture 的 output_path 写出链)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PNG } from 'pngjs';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffPngBuffers } from '../src/tools/screenshot-detail.js';
import { handleTool, TOOL_META } from '../src/tools/screenshot.js';
import { isolatePathEnv } from './helpers/path-isolation.js';

// ─── 合成图工具 ─────────────────────────────────────────────────────────────

/** 生成全黑 RGB(0,0,0) 的 PNG,可指定若干像素覆盖为灰度值。 */
function makePng(
  width: number,
  height: number,
  overrides: Array<{ x: number; y: number; gray: number }> = [],
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const idx = i << 2;
    png.data[idx] = 0;
    png.data[idx + 1] = 0;
    png.data[idx + 2] = 0;
    png.data[idx + 3] = 255;
  }
  for (const o of overrides) {
    const idx = (width * o.y + o.x) << 2;
    png.data[idx] = o.gray;
    png.data[idx + 1] = o.gray;
    png.data[idx + 2] = o.gray;
    png.data[idx + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** 生成 100x100 全黑图 + 已知区域 [10,20)x[10,35) 共 250 像素改为灰度 gray。 */
function makePairWith250DiffPixels(gray: number): { a: Buffer; b: Buffer } {
  const a = makePng(100, 100);
  const overrides: Array<{ x: number; y: number; gray: number }> = [];
  for (let y = 10; y < 35; y++) {
    for (let x = 10; x < 20; x++) overrides.push({ x, y, gray });
  }
  expect(overrides.length).toBe(250); // 守卫:确实是 250 像素
  return { a, b: makePng(100, 100, overrides) };
}

/**
 * 与实现同款公式构造"恰好等于阈值"的 threshold(位级一致,避免浮点 1ulp 漂移)。
 * 灰度扰动 d → ratio = sqrt(3*d²) / (sqrt(3)*255) = d/255。
 */
function thresholdForGray(d: number): number {
  return Math.sqrt(3 * d * d) / (Math.sqrt(3) * 255);
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn(async () => '/usr/bin/godot'),
    runningProcess: null, setRunningProcess: vi.fn(),
    outputBuffer: [], setOutputBuffer: vi.fn(),
    processStartTime: 0, setProcessStartTime: vi.fn(),
    projectDir: '', setProjectDir: vi.fn(),
    parseGodotConfig: vi.fn(() => ({})),
    ...overrides,
  } as any;
}

// ─── 纯函数 diffPngBuffers ──────────────────────────────────────────────────

describe('diffPngBuffers 纯函数', () => {
  it('同图 → diff_pixels=0, diff_ratio=0, bbox=null', () => {
    const { a } = makePairWith250DiffPixels(32);
    const r = diffPngBuffers(a, a, 0.12);
    expect(r.width).toBe(100);
    expect(r.height).toBe(100);
    expect(r.diffPixels).toBe(0);
    expect(r.diffRatio).toBe(0);
    expect(r.bbox).toBeNull();
  });

  it('100x100 改 250 像素(默认 threshold 0.12)→ diff_pixels=250, diff_ratio=0.025, bbox 覆盖改动区', () => {
    // 灰度扰动 32 → ratio = 32/255 ≈ 0.1255 > 0.12 → 计差
    const { a, b } = makePairWith250DiffPixels(32);
    const r = diffPngBuffers(a, b, 0.12);
    expect(r.diffPixels).toBe(250);
    expect(r.diffRatio).toBeCloseTo(250 / 10000, 10);
    expect(r.bbox).toEqual({ x: 10, y: 10, width: 10, height: 25 }); // x∈[10,20) y∈[10,35)
  });

  it('threshold 边界:恰好等于阈值的扰动不计差(严格大于才计)', () => {
    // d=64 → ratio = 64/255;threshold 用同款公式构造 → 位级恰好等于 → 不计
    const eq = makePairWith250DiffPixels(64);
    expect(diffPngBuffers(eq.a, eq.b, thresholdForGray(64)).diffPixels).toBe(0);
    // d=65 → ratio = 65/255 严格大于 64/255 阈值 → 计 250
    const gt = makePairWith250DiffPixels(65);
    expect(diffPngBuffers(gt.a, gt.b, thresholdForGray(64)).diffPixels).toBe(250);
  });

  it('threshold 大于扰动 → 不计差;极小 threshold → 任何非零差都计', () => {
    const { a, b } = makePairWith250DiffPixels(1); // ratio = 1/255 ≈ 0.0039
    expect(diffPngBuffers(a, b, 0.5).diffPixels).toBe(0);
    expect(diffPngBuffers(a, b, 0).diffPixels).toBe(250);
  });

  it('忽略 alpha:RGB 相同 alpha 全不同 → 0 差', () => {
    const pngA = new PNG({ width: 10, height: 10 });
    const pngB = new PNG({ width: 10, height: 10 });
    for (let i = 0; i < 100; i++) {
      const idx = i << 2;
      pngA.data[idx] = pngB.data[idx] = 50;
      pngA.data[idx + 1] = pngB.data[idx + 1] = 100;
      pngA.data[idx + 2] = pngB.data[idx + 2] = 150;
      pngA.data[idx + 3] = 255;
      pngB.data[idx + 3] = 0; // alpha 全不同
    }
    const r = diffPngBuffers(PNG.sync.write(pngA), PNG.sync.write(pngB), 0.12);
    expect(r.diffPixels).toBe(0);
    expect(r.bbox).toBeNull();
  });

  it('diff 图数据:差异像素纯红 (255,0,0),其余保留 a 图原色(含 alpha)', () => {
    const { a, b } = makePairWith250DiffPixels(32);
    const r = diffPngBuffers(a, b, 0.12);
    const outPng = PNG.sync.read(PNG.sync.write(Object.assign(new PNG({ width: 100, height: 100 }), { data: r.diffImageData })));
    // 差异像素 (10,10) → 纯红
    const diffIdx = (100 * 10 + 10) << 2;
    expect([outPng.data[diffIdx], outPng.data[diffIdx + 1], outPng.data[diffIdx + 2]]).toEqual([255, 0, 0]);
    // 非差异像素 (0,0) → 保留 a 图原色(全黑, alpha 255)
    const keepIdx = 0;
    expect([outPng.data[keepIdx], outPng.data[keepIdx + 1], outPng.data[keepIdx + 2], outPng.data[keepIdx + 3]]).toEqual([0, 0, 0, 255]);
  });

  it('尺寸不一致 → throw', () => {
    const a = makePng(50, 50);
    const b = makePng(60, 60);
    expect(() => diffPngBuffers(a, b, 0.12)).toThrow(/dimensions mismatch/i);
  });
});

// ─── handleTool action=diff 集成 ────────────────────────────────────────────

describe('screenshot action=diff(handleTool 集成)', () => {
  let allowedDir: string;
  let outsideDir: string;
  let restore: () => void = () => {};

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'diff-allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'diff-outside-'));
    // 白名单模式:清 UNRESTRICTED + ALLOWED=allowedDir(allowOutside=true 但限 roots)
    restore = isolatePathEnv({ allowed: [allowedDir] });
  });

  afterEach(() => {
    restore();
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('同图 → diff_ratio===0, bbox=null(structuredContent)', async () => {
    const { a } = makePairWith250DiffPixels(32);
    writeFileSync(join(allowedDir, 'a.png'), a);
    writeFileSync(join(allowedDir, 'b.png'), a);
    const r = await handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(allowedDir, 'b.png'),
    }, makeCtx());
    expect(r).not.toBeNull();
    const sc = r!.structuredContent as Record<string, unknown>;
    expect(sc.action).toBe('screenshot_diff');
    expect(sc.diff_ratio).toBe(0);
    expect(sc.diff_pixels).toBe(0);
    expect(sc.bbox).toBeNull();
    expect(sc.width).toBe(100);
    expect(sc.height).toBe(100);
    expect(sc.threshold).toBe(0.12);
  });

  it('改 250 像素 → diff_pixels===250, bbox 正确', async () => {
    const { a, b } = makePairWith250DiffPixels(32);
    writeFileSync(join(allowedDir, 'a.png'), a);
    writeFileSync(join(allowedDir, 'b.png'), b);
    const r = await handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(allowedDir, 'b.png'),
    }, makeCtx());
    const sc = r!.structuredContent as Record<string, unknown>;
    expect(sc.diff_pixels).toBe(250);
    expect(sc.diff_ratio).toBeCloseTo(0.025, 10);
    expect(sc.bbox).toEqual({ x: 10, y: 10, width: 10, height: 25 });
  });

  it('提供 diff_path → 写出红染差异图并返回绝对路径', async () => {
    const { a, b } = makePairWith250DiffPixels(32);
    writeFileSync(join(allowedDir, 'a.png'), a);
    writeFileSync(join(allowedDir, 'b.png'), b);
    const diffOut = join(allowedDir, 'diff.png');
    const r = await handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(allowedDir, 'b.png'),
      diff_path: diffOut,
    }, makeCtx());
    const sc = r!.structuredContent as Record<string, unknown>;
    expect(sc.diff_path).toBe(diffOut);
    expect(existsSync(diffOut)).toBe(true);
    const outPng = PNG.sync.read(readFileSync(diffOut));
    expect(outPng.width).toBe(100);
    expect(outPng.height).toBe(100);
    const diffIdx = (100 * 10 + 10) << 2;
    expect([outPng.data[diffIdx], outPng.data[diffIdx + 1], outPng.data[diffIdx + 2]]).toEqual([255, 0, 0]);
    expect([outPng.data[0], outPng.data[1], outPng.data[2]]).toEqual([0, 0, 0]); // 其余保留 a 原色
  });

  it('尺寸不一致 → INVALID_PARAMS', async () => {
    writeFileSync(join(allowedDir, 'a.png'), makePng(50, 50));
    writeFileSync(join(allowedDir, 'b.png'), makePng(60, 60));
    const r = await handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(allowedDir, 'b.png'),
    }, makeCtx());
    const text = (r!.content as Array<{ text?: string }>)[0]!.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
    expect(String(parsed.error)).toMatch(/dimensions mismatch/i);
  });

  it('路径逃逸(image_b 白名单外)→ 拒绝(沿用 analyze 先例 throw)', async () => {
    writeFileSync(join(outsideDir, 'secret.png'), makePng(10, 10));
    writeFileSync(join(allowedDir, 'a.png'), makePng(10, 10));
    const result = handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(outsideDir, 'secret.png'),
    }, makeCtx());
    await expect(result).rejects.toThrow(/outside allowed project roots/);
  });

  it('threshold 非法(负数 / >1 / NaN)→ INVALID_PARAMS', async () => {
    writeFileSync(join(allowedDir, 'a.png'), makePng(10, 10));
    writeFileSync(join(allowedDir, 'b.png'), makePng(10, 10));
    for (const t of [-0.1, 1.5, NaN]) {
      const r = await handleTool('screenshot', {
        action: 'diff',
        image_a: join(allowedDir, 'a.png'),
        image_b: join(allowedDir, 'b.png'),
        threshold: t,
      }, makeCtx());
      const text = (r!.content as Array<{ text?: string }>)[0]!.text ?? '';
      expect(JSON.parse(text).error_code).toBe('INVALID_PARAMS');
    }
  });

  // Minor-2(final review):threshold 显式 null == 落默认 0.12(旧行为 Number(null)=0 全像素计差)
  it('threshold: null → 落默认 0.12(非 0)', async () => {
    const { a, b } = makePairWith250DiffPixels(32);
    writeFileSync(join(allowedDir, 'a.png'), a);
    writeFileSync(join(allowedDir, 'b.png'), b);
    const r = await handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(allowedDir, 'b.png'),
      threshold: null,
    }, makeCtx());
    const sc = r!.structuredContent as Record<string, unknown>;
    expect(sc.threshold).toBe(0.12);
    expect(sc.diff_pixels).toBe(250); // ratio 32/255≈0.1255 > 0.12 计差;若误为 0 同样 250,靠 threshold 字段防回归
  });

  it('缺 image_a/image_b → INVALID_PARAMS;图片不存在 → INVALID_PARAMS', async () => {
    const r1 = await handleTool('screenshot', { action: 'diff' }, makeCtx());
    const text1 = (r1!.content as Array<{ text?: string }>)[0]!.text ?? '';
    expect(JSON.parse(text1).error_code).toBe('INVALID_PARAMS');

    writeFileSync(join(allowedDir, 'a.png'), makePng(10, 10));
    const r2 = await handleTool('screenshot', {
      action: 'diff',
      image_a: join(allowedDir, 'a.png'),
      image_b: join(allowedDir, 'missing.png'),
    }, makeCtx());
    const text2 = (r2!.content as Array<{ text?: string }>)[0]!.text ?? '';
    expect(JSON.parse(text2).error_code).toBe('INVALID_PARAMS');
  });
});

describe('screenshot action=diff 非 allowOutside 模式(默认 deny-by-default)', () => {
  let allowedDir: string;
  let restore: () => void = () => {};

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'diff-default-'));
    // 默认模式:无 ALLOWED(cwd 回落为 root)
    restore = isolatePathEnv({ allowed: [], cwd: allowedDir });
  });

  afterEach(() => {
    restore();
    rmSync(allowedDir, { recursive: true, force: true });
  });

  it('相对路径 + project_path → 正常比对;无 project_path → INVALID_PARAMS', async () => {
    const { a } = makePairWith250DiffPixels(32);
    writeFileSync(join(allowedDir, 'a.png'), a);
    const r = await handleTool('screenshot', {
      action: 'diff',
      project_path: allowedDir,
      image_a: 'a.png',
      image_b: 'a.png',
    }, makeCtx());
    const sc = r!.structuredContent as Record<string, unknown>;
    expect(sc.diff_ratio).toBe(0);

    const r2 = await handleTool('screenshot', {
      action: 'diff',
      image_a: 'a.png',
      image_b: 'a.png',
    }, makeCtx());
    const text2 = (r2!.content as Array<{ text?: string }>)[0]!.text ?? '';
    expect(JSON.parse(text2).error_code).toBe('INVALID_PARAMS');
  });
});

// ─── TOOL_META 登记 ─────────────────────────────────────────────────────────

describe('TOOL_META: screenshot diff 风险等级', () => {
  it('diff 登记为 read(只读比对;diff_path 写出是显式参数)', () => {
    expect(TOOL_META.screenshot!.actionRisks.diff).toBe('read');
  });
});

// ─── 历史图对校准(test/fixtures/visual,入库素材,1280x720)────────────────

describe('历史图对校准(web-prototype vs godot-hud, RTS demo)', () => {
  const fixtureDir = join(process.cwd(), 'test', 'fixtures', 'visual');

  // 校准数据(2026-08-16 实测,threshold=0.12,实测命令:vitest 临时用例跑 diffPngBuffers):
  //   web-prototype.png vs godot-hud.png → diff_pixels=162408 / 921600(1280x720)
  //   → diff_ratio=0.17622395833333335(≈0.1762),bbox=全图 {0,0,1280,720}
  //   断言 loose(diff_ratio < 0.6):两图为不同渲染器的同布局 UI,布局骨架相似但像素级
  //   存在字体/抗锯齿/色板差异,0.176 属"结构相似像素不同"区间;阈值 0.6 防未来渲染
  //   微调导致校准测试脆断,不代表产品验收线。
  it('同图自比 → diff_ratio===0', async () => {
    const p = join(fixtureDir, 'web-prototype.png');
    const restore = isolatePathEnv({ allowed: [fixtureDir] });
    try {
      const r = await handleTool('screenshot', {
        action: 'diff',
        image_a: p,
        image_b: p,
      }, makeCtx());
      const sc = r!.structuredContent as Record<string, unknown>;
      expect(sc.diff_ratio).toBe(0);
      expect(sc.diff_pixels).toBe(0);
      expect(sc.bbox).toBeNull();
    } finally {
      restore();
    }
  });

  it('web-prototype vs godot-hud → loose 断言 diff_ratio < 0.6(数值见注释校准记录)', async () => {
    const restore = isolatePathEnv({ allowed: [fixtureDir] });
    try {
      const r = await handleTool('screenshot', {
        action: 'diff',
        image_a: join(fixtureDir, 'web-prototype.png'),
        image_b: join(fixtureDir, 'godot-hud.png'),
      }, makeCtx());
      const sc = r!.structuredContent as Record<string, unknown>;
      expect(sc.width).toBe(1280);
      expect(sc.height).toBe(720);
      expect(sc.diff_ratio as number).toBeGreaterThan(0);
      expect(sc.diff_ratio as number).toBeLessThan(0.6);
    } finally {
      restore();
    }
  });

  // I-3(final review 补证据):坏图可区分性——程序化合成"下半部内容消失"坏图
  // (读 godot-hud.png,y>360 像素置纯黑,模拟 modulate 级联内容消失),断言坏图对
  // diff_ratio 显著大于好图对(基线),证明 threshold=0.12 的 diff 能区分"布局对但有
  // 像素底噪"与"内容级消失"两种形态。
  // 实测校准(2026-08-16,threshold=0.12):goodRatio=0.176224,badRatio=0.479714,
  // bad/good≈2.72(>1.5 断言线);坏图对 0.4797 > 0.4 也成立(规则文档"坏图 > 0.4"
  // 的实测支撑,数值以本注释为准)。
  it('合成坏图(下半部消失)对 goodRatio 的 ratio 显著更高:bad > good * 1.5', async () => {
    const badDir = mkdtempSync(join(tmpdir(), 'diff-bad-synth-'));
    const restore = isolatePathEnv({ allowed: [fixtureDir, badDir] });
    try {
      // pngjs 程序化合成:godot-hud 下半(y>360)置纯黑
      const hud = PNG.sync.read(readFileSync(join(fixtureDir, 'godot-hud.png')));
      for (let y = 361; y < hud.height; y++) {
        for (let x = 0; x < hud.width; x++) {
          const idx = (hud.width * y + x) << 2;
          hud.data[idx] = 0;
          hud.data[idx + 1] = 0;
          hud.data[idx + 2] = 0;
        }
      }
      const badPath = join(badDir, 'godot-hud-bad.png');
      writeFileSync(badPath, PNG.sync.write(hud));

      const rGood = await handleTool('screenshot', {
        action: 'diff',
        image_a: join(fixtureDir, 'web-prototype.png'),
        image_b: join(fixtureDir, 'godot-hud.png'),
      }, makeCtx());
      const rBad = await handleTool('screenshot', {
        action: 'diff',
        image_a: join(fixtureDir, 'web-prototype.png'),
        image_b: badPath,
      }, makeCtx());
      const goodRatio = (rGood.structuredContent as Record<string, unknown>).diff_ratio as number;
      const badRatio = (rBad.structuredContent as Record<string, unknown>).diff_ratio as number;
      // 基线对齐既有校准记录(0.1762,防 fixture 被替换后断言静默漂移)
      expect(goodRatio).toBeCloseTo(0.176224, 3);
      // 坏图可区分性:显著高于基线(实测 ≈2.72 倍)
      expect(badRatio, `badRatio=${badRatio} goodRatio=${goodRatio}`).toBeGreaterThan(goodRatio * 1.5);
      // 0.4 实测成立(0.4797),保留为绝对下限的次级护栏
      expect(badRatio).toBeGreaterThan(0.4);
    } finally {
      restore();
      rmSync(badDir, { recursive: true, force: true });
    }
  });
});
