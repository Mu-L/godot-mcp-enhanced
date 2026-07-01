import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { parseCsv, generateImportScript, writeTmpCsv } from '../../src/tools/data-import.js';

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

describe('generateImportScript (CRITICAL-1 注入防护)', () => {
  it('4 参数经 gdEscape 嵌入', () => {
    const s = generateImportScript({ classPath: 'res://r.gd', outputDir: 'res://out', filenameCol: 'id', csvTmpPath: 'tmp.csv' });
    expect(s).toContain('res://r.gd');
    expect(s).toContain('load(');
    expect(s).toContain('FileAccess');
    expect(s).toContain('get_csv_line');
    expect(s).toContain('ResourceSaver.save');
  });
  it('恶意 classPath 不能逃逸闭串', () => {
    const evil = 'x")\nprint("injected")\n#';
    const s = generateImportScript({ classPath: evil, outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    expect(s).not.toContain('print("injected")'); // gdEscape 转义
  });
  it('CSV 行数据零嵌入脚本(数据走 FileAccess)', () => {
    // generateImportScript 不接 CSV 内容参数,只接 csvTmpPath
    const s = generateImportScript({ classPath: 'r', outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    expect(s).not.toContain('row_data'); // 无 CSV 值嵌入
  });
});

describe('writeTmpCsv', () => {
  it('写 CSV 到临时文件,返回可读路径', () => {
    const p = writeTmpCsv('id,name\n1,a\n');
    try {
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf8')).toBe('id,name\n1,a\n');
      expect(p.endsWith('.csv')).toBe(true);
    } finally {
      try { rmSync(p); } catch { /* 已删 */ }
    }
  });

  it('每次调用生成不同文件名', () => {
    const a = writeTmpCsv('x\n1\n');
    const b = writeTmpCsv('x\n1\n');
    try {
      expect(a).not.toBe(b);
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
    } finally {
      try { rmSync(a); } catch { /* */ }
      try { rmSync(b); } catch { /* */ }
    }
  });
});
