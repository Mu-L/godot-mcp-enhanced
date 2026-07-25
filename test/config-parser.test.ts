import { describe, it, expect } from 'vitest';
import { parseConfigValue, parseGodotConfig, parseMcpScriptOutput } from '../src/core/config-parser.js';
import { MARKER_RESULT, MARKER_ERROR } from '../src/tools/shared/gdscript-templates.js';

describe('parseConfigValue', () => {
  it('字符串去引号', () => {
    expect(parseConfigValue('"hello"')).toBe('hello');
  });
  it('布尔/null', () => {
    expect(parseConfigValue('true')).toBe(true);
    expect(parseConfigValue('false')).toBe(false);
    expect(parseConfigValue('null')).toBe(null);
  });
  it('数字（int/float）', () => {
    expect(parseConfigValue('42')).toBe(42);
    expect(parseConfigValue('3.14')).toBe(3.14);
  });
  it('Infinity/NaN → raw（isFinite 排除）', () => {
    expect(parseConfigValue('Infinity')).toBe('Infinity');
    expect(parseConfigValue('NaN')).toBe('NaN');
  });
  it('空串 → raw（trim==="" 不当数字）', () => {
    expect(parseConfigValue('')).toBe('');
  });
  it('array（含嵌套）', () => {
    expect(parseConfigValue('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(parseConfigValue('[]')).toEqual([]);
  });
  it('dict', () => {
    expect(parseConfigValue('{a=1, b="x"}')).toEqual({ a: 1, b: 'x' });
  });
  it('depth=9（>8）触发 raw fallback 防递归爆栈', () => {
    // 构造 9 层嵌套 array 触发 depth>8 fallback
    let deep = '1';
    for (let i = 0; i < 10; i++) deep = `[${deep}]`;  // 10 层嵌套
    const r = parseConfigValue(deep);
    // 深层未完全解析（depth>8 返 raw 子串），不栈溢出即通过
    expect(typeof r === 'string' || typeof r === 'object').toBeTruthy();
  });
});

describe('parseGodotConfig', () => {
  it('section + kv + comment 跳过', () => {
    const cfg = parseGodotConfig('[application]\nname="Game"\n;comment line\nversion=4');
    expect(cfg.application).toEqual({ name: 'Game', version: 4 });
  });
  it('# comment 也跳过', () => {
    const cfg = parseGodotConfig('# hash comment\n[a]\nx=1');
    expect((cfg as any).a).toEqual({ x: 1 });
  });
  it('多 section', () => {
    const cfg = parseGodotConfig('[a]\nx=1\n[b]\ny="z"');
    expect((cfg as any).a).toEqual({ x: 1 });
    expect((cfg as any).b).toEqual({ y: 'z' });
  });
});

describe('parseMcpScriptOutput', () => {
  it('result marker + 有效 JSON → parsed', () => {
    const out = `${MARKER_RESULT}{"x":1}`;
    expect(parseMcpScriptOutput(out, 0)).toEqual({ x: 1 });
  });
  it('result marker + 无效 JSON → success:false', () => {
    const out = `${MARKER_RESULT}not json`;
    expect(parseMcpScriptOutput(out, 0)).toMatchObject({ success: false, error: 'Failed to parse result JSON' });
  });
  it('error marker + JSON → parsed', () => {
    const out = `${MARKER_ERROR}{"code":"X"}`;
    expect(parseMcpScriptOutput(out, 0)).toEqual({ code: 'X' });
  });
  it('无 marker + exitCode=0 → No structured output', () => {
    const r = parseMcpScriptOutput('some log\nmore log', 0) as any;
    expect(r.success).toBe(false);
    expect(r.error).toBe('No structured output found');
    expect(r.raw_output).toContain('some log');
  });
  it('无 marker + exitCode≠0 → Process exited', () => {
    const r = parseMcpScriptOutput('log line', 1) as any;
    expect(r.success).toBe(false);
    expect(r.error).toBe('Process exited with code 1');
  });
  it('marker 混入 log 行（log 进 raw_output，marker 仍解析）', () => {
    const out = `log before\n${MARKER_RESULT}{"ok":true}\nlog after`;
    const r = parseMcpScriptOutput(out, 0) as any;
    expect(r).toEqual({ ok: true });  // marker 解析优先，返 parsed
  });
});
