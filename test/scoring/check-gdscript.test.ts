import { describe, it, expect } from 'vitest';
import { parseGdscriptOutput, extractClassNames } from '../../src/scoring/check-gdscript.js';

describe('parseGdscriptOutput', () => {
  it('SCRIPT ERROR 行计入 errors', () => {
    const r = parseGdscriptOutput('SCRIPT ERROR: res://a.gd:1: "x" was not found');
    expect(r.errors).toBe(1);
    expect(r.warnings).toBe(0);
    expect(r.details[0]).toContain('SCRIPT ERROR');
  });

  it('Parse Error 行计入 errors', () => {
    const r = parseGdscriptOutput('res://a.gd:42 - Parse Error: Unexpected token');
    expect(r.errors).toBe(1);
  });

  it('WARNING 行计入 warnings(不计 errors)', () => {
    const r = parseGdscriptOutput('WARNING: "x" is never used');
    expect(r.warnings).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('errors 优先排前 details,≤20 条截断', () => {
    const lines = [
      'WARNING: w1', 'WARNING: w2',
      ...Array.from({ length: 25 }, (_, i) => `SCRIPT ERROR: e${i}`),
    ].join('\n');
    const r = parseGdscriptOutput(lines);
    expect(r.errors).toBe(25);
    expect(r.warnings).toBe(2);
    expect(r.details.length).toBe(20);
    expect(r.details[0]).toContain('SCRIPT ERROR'); // errors 优先
  });

  it('未知行不计数不崩(保留诊断)', () => {
    const r = parseGdscriptOutput('some random godot banner\n  at scope\n');
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
  });

  it('detailsTotal = errors + warnings', () => {
    const r = parseGdscriptOutput('SCRIPT ERROR: e1\nWARNING: w1\nWARNING: w2');
    expect(r.detailsTotal).toBe(3);
  });
});

describe('extractClassNames', () => {
  it('从 class_name 声明提取类名', () => {
    const names = extractClassNames([
      'D:\\addons\\godot_mcp_server\\commands\\command_helpers.gd',
    ], { 'D:\\addons\\godot_mcp_server\\commands\\command_helpers.gd': '@tool\nclass_name CommandHelpers\nextends RefCounted\n' });
    expect(names).toEqual(['CommandHelpers']);
  });

  it('无 class_name 的脚本不返回', () => {
    const names = extractClassNames(['a.gd'], { 'a.gd': 'extends Node\nvar x = 1\n' });
    expect(names).toEqual([]);
  });
});
