import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../src/tools/data-import.js';

describe('parseCsv 前置校验', () => {
  it('空文本 → ok:false', () => {
    expect(parseCsv('').ok).toBe(false);
  });
  it('单行 header → ok:true + headers', () => {
    const r = parseCsv('id,name,damage\n');
    expect(r.ok).toBe(true);
    expect(r.headers).toEqual(['id', 'name', 'damage']);
  });
  it('CRLF → 正确切 header', () => {
    expect(parseCsv('a,b\r\nc,d\r\n').headers).toEqual(['a', 'b']);
  });
  it('引号内逗号不拆 header', () => {
    expect(parseCsv('"a,b",c\n').headers).toEqual(['a,b', 'c']);
  });
});
