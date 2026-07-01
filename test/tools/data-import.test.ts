import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { parseCsv, generateImportScript, writeTmpCsv } from '../../src/tools/data-import.js';
import { injectHelpers } from '../../src/gdscript-executor.js';

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

describe('generateImportScript (CRITICAL-2 路径遍历防护)', () => {
  it('模板含 filename 白名单正则 + 段级拒 ..', () => {
    const s = generateImportScript({ classPath: 'r', outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    expect(s).toContain('^[A-Za-z0-9_.-]+$');
    // T6: 精确匹配段级拒 .. 逻辑(非宽泛 toContain('..'),后者注释/字符串含 .. 也满足)
    expect(s).toContain('seg == ".."');
    expect(s).toContain('has_dotdot');
  });
});

// T4 ADVISORY: 模板变量/函数名须匹配 gdscript-executor injectHelpers 检测的正则
// (_mcp_outputs/_mcp_done),否则 injectHelpers 会重复注入同名 helper(死代码 + 名字冲突)。
describe('generateImportScript (T4 命名统一 injectHelpers)', () => {
  it('模板用 _mcp_outputs/_mcp_done,injectHelpers 不重复注入', () => {
    const s = generateImportScript({ classPath: 'r', outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    // 模板不应再用旧名(会被 injectHelpers 视为缺失而重复注入)
    expect(s).not.toMatch(/\bvar\s+_outputs\b/);
    expect(s).not.toMatch(/\bfunc\s+_done\s*\(/);
    // 模板应直接用 executor 约定名
    expect(s).toMatch(/\bvar\s+_mcp_outputs\b/);
    expect(s).toMatch(/\bfunc\s+_mcp_done\s*\(/);
    // 经 injectHelpers 处理后,_mcp_outputs / _mcp_done 各只出现一次(无重复注入)
    const injected = injectHelpers(s);
    const countVar = (injected.match(/^\s*var\s+_mcp_outputs\b/gm) || []).length;
    const countDone = (injected.match(/^\s*func\s+_mcp_done\s*\(/gm) || []).length;
    expect(countVar).toBe(1);
    expect(countDone).toBe(1);
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
