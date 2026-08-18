// pixel-verify 纯函数单测(spec 2026-08-17-prototype-stylebox-loop-design.md §5,PR-3 Task 1):
// 采样点 clamp 数学 / PNG 像素读取(构造 PNG 精确断言)/ RGB 距离 / bg 目标收集(半透明 skip)。
// 不含 capture 编排(Task 2)与 handler 接线(Task 3)。
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  computeSamplePoints, pixelAt, rgbDistance, collectBgTargets,
  CENTER_TOL, CORNER_TOL,
} from '../src/tools/ui/pixel-verify.js';
import type { PrototypeGeometry } from '../src/tools/ui/prototype-import.js';

describe('computeSamplePoints(spec §5 内缩 clamp)', () => {
  // rect 100x60 @(10,20),radius 8 + border 2 → inset=min(10, 60/2-2=28)=10
  it('常规:borderRadius+border 宽度决定内缩', () => {
    const pts = computeSamplePoints({ x: 10, y: 20, w: 100, h: 60 }, 8, 2);
    expect(pts).toHaveLength(5);
    const by = Object.fromEntries(pts.map(p => [p.id, p]));
    expect(by.center).toEqual({ id: 'center', x: 60, y: 50 });
    expect(by.tl).toEqual({ id: 'tl', x: 20, y: 30 });
    expect(by.tr).toEqual({ id: 'tr', x: 100, y: 30 });
    expect(by.br).toEqual({ id: 'br', x: 100, y: 70 });
    expect(by.bl).toEqual({ id: 'bl', x: 20, y: 70 });
  });

  it('clamp 上界:borderRadius 超过短边一半时被 短边/2−2 钳制', () => {
    // rect 40x20,radius 30 → min(30, 20/2-2=8)=8;角点仍 rect 内
    const pts = computeSamplePoints({ x: 0, y: 0, w: 40, h: 20 }, 30, 0);
    const by = Object.fromEntries(pts.map(p => [p.id, p]));
    expect(by.tl).toEqual({ id: 'tl', x: 8, y: 8 });
    expect(by.br).toEqual({ id: 'br', x: 32, y: 12 });
  });

  it('clamp 下界:短边 <4 时 短边/2−2 为负,回落 0(角点=角,仍在图内)', () => {
    const pts = computeSamplePoints({ x: 5, y: 5, w: 3, h: 2 }, 0, 0);
    const by = Object.fromEntries(pts.map(p => [p.id, p]));
    expect(by.tl).toEqual({ id: 'tl', x: 5, y: 5 });
    expect(by.br).toEqual({ id: 'br', x: 8, y: 7 });
  });

  it('坐标 round 到整数(奇数宽高中心)', () => {
    const pts = computeSamplePoints({ x: 0, y: 0, w: 101, h: 61 }, 0, 0);
    expect(pts.find(p => p.id === 'center')).toEqual({ id: 'center', x: 50, y: 30 });
  });
});

describe('pixelAt(构造 PNG 精确读值)', () => {
  function solidPng(w: number, h: number, rgb: [number, number, number]): PNG {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      png.data[i * 4] = rgb[0]; png.data[i * 4 + 1] = rgb[1];
      png.data[i * 4 + 2] = rgb[2]; png.data[i * 4 + 3] = 255;
    }
    return png;
  }

  it('读回构造色值(红底)', () => {
    const png = solidPng(4, 4, [255, 0, 0]);
    expect(pixelAt(png, 0, 0)).toEqual([255, 0, 0]);
    expect(pixelAt(png, 3, 3)).toEqual([255, 0, 0]);
  });

  it('越界返回 null(x/y 负、≥尺寸)', () => {
    const png = solidPng(4, 4, [0, 0, 255]);
    expect(pixelAt(png, -1, 0)).toBeNull();
    expect(pixelAt(png, 0, -1)).toBeNull();
    expect(pixelAt(png, 4, 0)).toBeNull();
    expect(pixelAt(png, 0, 4)).toBeNull();
  });
});

describe('rgbDistance', () => {
  it('0-255 空间欧氏距离', () => {
    expect(rgbDistance([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(rgbDistance([255, 0, 0], [0, 0, 0])).toBeCloseTo(255, 5);
    expect(rgbDistance([255, 255, 0], [0, 0, 0])).toBeCloseTo(Math.sqrt(2) * 255, 5);
  });
});

describe('collectBgTargets(spec §5 「每 bg 节点」)', () => {
  const geo: PrototypeGeometry = {
    viewport: { w: 800, h: 600 },
    nodes: [
      { name: 'Card', rect: { x: 0, y: 0, w: 200, h: 80 }, bg: '#1a1f2e', borderRadius: 8, border: { width: 2, color: '#3ddc84' } },
      { name: 'HpBar', rect: { x: 10, y: 90, w: 120, h: 16 }, bg: '#222222' },
      { name: 'Plain', rect: { x: 10, y: 120, w: 50, h: 20 } },                        // 无 bg → 不采样
      { name: 'Ghost', rect: { x: 10, y: 150, w: 50, h: 20 }, bg: [10, 20, 30, 0.5] }, // 半透明 → skipped
      { name: 'Corners', rect: { x: 10, y: 180, w: 60, h: 60 }, bg: '#ff0000', borderRadius: { tl: 4, tr: 6, br: 10, bl: 2 } },
    ],
  };

  it('收集 bg 节点,hex 目标转 0-255,fill-only 不进(仅 bg 语义)', () => {
    const { targets, skipped } = collectBgTargets(geo);
    expect(targets.map(t => t.name)).toEqual(['Card', 'HpBar', 'Corners']);
    expect(targets[0]!.target).toEqual([0x1a, 0x1f, 0x2e]);
    expect(targets[0]!.borderRadius).toBe(8);
    expect(targets[0]!.borderWidth).toBe(2);
    expect(targets[1]!.borderWidth).toBe(0);
    expect(skipped).toEqual([{ name: 'Ghost', reason: expect.stringContaining('alpha') }]);
  });

  it('per-corner borderRadius 取四角 max(保守内缩)', () => {
    const { targets } = collectBgTargets(geo);
    expect(targets.find(t => t.name === 'Corners')!.borderRadius).toBe(10);
  });

  it('数组色 [r,g,b] 0-255 与 [r,g,b,a] 0-1 两种 ProtoColor 格式都归一', () => {
    const g2: PrototypeGeometry = {
      viewport: { w: 100, h: 100 },
      nodes: [
        { name: 'A', rect: { x: 0, y: 0, w: 10, h: 10 }, bg: [26, 31, 46] },
        { name: 'B', rect: { x: 0, y: 20, w: 10, h: 10 }, bg: [0.1, 0.2, 1.0, 1.0] },
      ],
    };
    const { targets } = collectBgTargets(g2);
    expect(targets[0]!.target).toEqual([26, 31, 46]);
    expect(targets[1]!.target).toEqual([26, 51, 255]);
  });
});

describe('容差常量(Task 4 集成校准锚点)', () => {
  it('中心严格、角点宽松(spec §5)', () => {
    expect(CENTER_TOL).toBeLessThan(CORNER_TOL);
  });
});
