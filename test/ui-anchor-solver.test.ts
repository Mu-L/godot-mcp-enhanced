import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { solveAnchors, CONTAINER_CONTROL_TYPES } from '../src/tools/ui/anchor-solver.js';

describe('solveAnchors', () => {
  it('全填充 rect → full_rect 型锚点(0,1,0,1)零偏移', () => {
    const r = solveAnchors({ w: 1280, h: 720 }, { x: 0, y: 0, w: 1280, h: 720 });
    expect(r.anchor_left).toBe(0); expect(r.anchor_right).toBe(1);
    expect(r.anchor_top).toBe(0); expect(r.anchor_bottom).toBe(1);
    expect(r.offset_left).toBe(0); expect(r.offset_right).toBe(0);
  });

  it('居中 rect → 0.5 比例锚点 + 整数偏移', () => {
    const r = solveAnchors({ w: 1000, h: 800 }, { x: 400, y: 350, w: 200, h: 100 });
    expect(r.anchor_left).toBe(0.4); expect(r.anchor_right).toBe(0.6);
    expect(Number.isInteger(r.offset_left)).toBe(true);
  });

  it('属性:任意合法 rect 反解后前向重放误差 ≤1px', () => {
    const rectArb = fc.integer({ min: 1, max: 2000 }).chain(pw =>
      fc.integer({ min: 1, max: 2000 }).chain(ph =>
        fc.integer({ min: 0, max: pw }).chain(x =>
          fc.integer({ min: 0, max: pw - x }).chain(w =>
            fc.integer({ min: 0, max: ph }).chain(y =>
              fc.integer({ min: 0, max: ph - y }).map(h => ({ pw, ph, x, y, w, h })))))));
    fc.assert(fc.property(rectArb, ({ pw, ph, x, y, w, h }) => {
      const r = solveAnchors({ w: pw, h: ph }, { x, y, w, h });
      const fx = r.anchor_left * pw + r.offset_left;
      const fw = (r.anchor_right * pw + r.offset_right) - fx;
      const fy = r.anchor_top * ph + r.offset_top;
      const fh = (r.anchor_bottom * ph + r.offset_bottom) - fy;
      expect(Math.abs(fx - x)).toBeLessThanOrEqual(1);
      expect(Math.abs(fw - w)).toBeLessThanOrEqual(1);
      expect(Math.abs(fy - y)).toBeLessThanOrEqual(1);
      expect(Math.abs(fh - h)).toBeLessThanOrEqual(1);
    }), { numRuns: 500 });
  });

  it('父尺寸非正数 → INVALID_PARAMS', () => {
    expect(() => solveAnchors({ w: 0, h: 100 }, { x: 0, y: 0, w: 10, h: 10 })).toThrow('INVALID_PARAMS');
  });
});

describe('CONTAINER_CONTROL_TYPES', () => {
  it('包含 BoxContainer 族与常用容器', () => {
    for (const t of ['HBoxContainer', 'VBoxContainer', 'GridContainer', 'MarginContainer']) {
      expect(CONTAINER_CONTROL_TYPES).toContain(t);
    }
  });
});
