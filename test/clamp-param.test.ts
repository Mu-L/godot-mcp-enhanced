import { describe, it, expect } from 'vitest';
import { clampParam } from '../src/tools/shared/validation.js';
import { readFileSync } from 'fs';

describe('clampParam', () => {
  it('undefined → undefined（不 clamp）', () => {
    expect(clampParam(undefined, 0, 100, 'x', [])).toBeUndefined();
  });
  it('< min → min + warning', () => {
    const w: string[] = [];
    expect(clampParam(-5, 0, 100, 'vol', w)).toBe(0);
    expect(w).toContain('vol -5 clamped to 0');
  });
  it('> max → max + warning', () => {
    const w: string[] = [];
    expect(clampParam(200, 0, 100, 'pitch', w)).toBe(100);
    expect(w).toContain('pitch 200 clamped to 100');
  });
  it('范围内 → 原值，无 warning', () => {
    const w: string[] = [];
    expect(clampParam(50, 0, 100, 'x', w)).toBe(50);
    expect(w).toHaveLength(0);
  });
  it('边界值（==min / ==max）不 clamp', () => {
    expect(clampParam(0, 0, 100, 'x', [])).toBe(0);
    expect(clampParam(100, 0, 100, 'x', [])).toBe(100);
  });
});

describe('clampParam 6 调用点守卫（静态 grep）', () => {
  it('audio-ops.ts 有 2 调用点', () => {
    const src = readFileSync('src/tools/audio-ops.ts', 'utf-8');
    const matches = src.match(/clampParam\(/g) ?? [];
    expect(matches.length).toBe(2);   // :196 vol + :197 pitch
  });
  it('particles.ts 有 4 调用点', () => {
    const src = readFileSync('src/tools/particles.ts', 'utf-8');
    const matches = src.match(/clampParam\(/g) ?? [];
    expect(matches.length).toBe(4);   // :430,447,461,462
  });
});
