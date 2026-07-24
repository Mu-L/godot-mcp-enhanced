import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseCsv, generateImportScript, writeTmpCsv, handleTool } from '../../src/tools/data-import.js';
import { injectHelpers, executeGdscriptTrusted } from '../../src/gdscript-executor.js';
import type { ToolContext } from '../../src/types.js';

// P2-1 Task 2: mock executeGdscriptTrusted 测 timeout 透传。
// vi.mock + importOriginal 保留 injectHelpers 等真实 export(Task 1 / T4 命名测试依赖),
// 仅替换 executeGdscriptTrusted 为可控 mock(vitest 4 推荐模式,避免 vi.doMock 失效)。
vi.mock('../../src/gdscript-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/gdscript-executor.js')>();
  return {
    ...actual,
    executeGdscriptTrusted: vi.fn().mockResolvedValue({
      compile_success: true,
      run_success: true,
      outputs: [
        { key: 'generated', value: '[]' },
        { key: 'errors', value: '[]' },
        { key: 'stats', value: '{}' },
      ],
    }),
  };
});

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
  it('P3: 超 MAX_CSV_COLUMNS(1000)列 → ok:false', () => {
    // 防御纵深:F-7 字节上限锁 10MB,但仍允许超多列撑爆 headers 数组 + headers.includes O(N)。
    const manyCols = 'x,'.repeat(1000) + 'y\n'; // 1001 列
    const r = parseCsv(manyCols);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exceeds.*columns/i);
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

  it('P3: 超 MAX_CSV_BYTES → throw(不变量防御,防绕过 handleTool 的调用方)', () => {
    const big = 'x'.repeat(10 * 1024 * 1024 + 1);
    expect(() => writeTmpCsv(big)).toThrow(/exceeds.*bytes/i);
  });
});

// ─── F-5/F-6/F-8 守卫(2026-07-04 审查 IMPORTANT 修复,防复发)──────────────────
// GDSCRIPT_TEMPLATE 内的守卫代码经 generateImportScript 输出后 grep 断言存在。
// 修复前:模板缺这些守卫 → 断言红;修复后:绿。

describe('generateImportScript F-5/F-6/F-8 守卫(防复发)', () => {
  const s = () => generateImportScript({ classPath: 'r', outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });

  it('F-8: TYPE_FLOAT 加 is_finite 守卫(拒 inf/-inf/nan)', () => {
    // 修复前 is_valid_float 对 "inf"/"nan" 返回 true,float() 返回 INF/NAN,落盘损坏数值。
    // 修复后:float 后 is_finite 校验,非有限值返回 null → 命中 type convert failed error。
    expect(s()).toContain('TYPE_FLOAT');
    expect(s()).toMatch(/is_finite\s*\(/);
  });

  it('F-8 扩展(2026-07-05 复审 P1): TYPE_VECTOR2/TYPE_COLOR 同走 _safe_float 守卫', () => {
    // 修复前:仅 TYPE_FLOAT 守 is_finite,Vector2(float(p[0]), float(p[1])) / Color(float(c[0]), ...)
    // 对 "inf"/"nan" 产生 INF/NAN 分量落盘 .tres(ResourceSaver 不拒,F-5 救不了)→ 视觉损坏资源。
    // 修复后:抽 _safe_float helper(is_valid_float + is_finite),FLOAT/VECTOR2/COLOR 三分支共用。
    const out = s();
    expect(out).toContain('func _safe_float');
    expect(out).toContain('TYPE_VECTOR2');
    expect(out).toContain('TYPE_COLOR');
    // helper 内必须含 is_finite 守卫(精确匹配到下一个 func,避免注释过长截断)
    const m = out.match(/func _safe_float[\s\S]*?(?=\nfunc _type_convert)/);
    expect(m, '_safe_float helper 必须存在').not.toBeNull();
    expect(m![0]).toMatch(/is_finite/);
    // VECTOR2/COLOR 分支必须经 _safe_float(不再裸 float())。
    // lookahead 精确匹配下一个 case 头(\n+2TAB+TYPE_),避开注释里的 TYPE_COLOR=20。
    const v2 = out.match(/TYPE_VECTOR2:[\s\S]*?(?=\n\t\tTYPE_|\n\treturn null)/);
    const color = out.match(/TYPE_COLOR:[\s\S]*?(?=\n\t\tTYPE_|\n\treturn null)/);
    expect(v2, 'TYPE_VECTOR2 分支必须存在').not.toBeNull();
    expect(color, 'TYPE_COLOR 分支必须存在').not.toBeNull();
    expect(v2![0]).toMatch(/_safe_float/);
    expect(color![0]).toMatch(/_safe_float/);
    // 正向断言:VECTOR2/COLOR 分支用 _safe_float(p[/c[)
    expect(v2![0]).toMatch(/_safe_float\(p\[/);
    expect(color![0]).toMatch(/_safe_float\(c\[/);
    // 显式 float() cast(审查 I-3,2026-07-05):Vector2(float(fx), float(fy)) 消除 Variant→float
    // 隐式转换的 4.7 type system 收紧风险 + 严格 warning(Warnings as errors)编译失败。
    expect(v2![0]).toMatch(/Vector2\(float\(fx\),\s*float\(fy\)\)/);
    expect(color![0]).toMatch(/Color\(float\(cr\),\s*float\(cg\),\s*float\(cb\)\)/);
    // 反向断言:无裸 float(p[/c[(原始字符串直接 float,绕过 _safe_float 守卫)。
    // lookbehind 排除 _safe_ 前缀(避免 _safe_float(p[0]) 子串 float(p[ 误判)。
    expect(v2![0]).not.toMatch(/(?<!_safe_)float\(p\[/);
    expect(color![0]).not.toMatch(/(?<!_safe_)float\(c\[/);
    // Color.html 校验(审查 I-2):is_valid_html_color 守卫,失败 return null(防 #ZZZZZZ 静默归零谎报)
    expect(color![0]).toMatch(/is_valid_html_color/);
  });

  it('F-5: ResourceSaver.save 返回值被捕获(失败记 error + continue,不谎报 generated)', () => {
    // 修复前:save 返回值未捕获,失败仍 _generated.append → stats.generated 谎报。
    // 修复后:save_err != OK 记 error + _failed += 1 + continue,不 append。
    expect(s()).toMatch(/save_err/);
    expect(s()).toMatch(/save failed/);
  });

  it('F-6: make_dir_recursive_absolute 返回值被捕获(失败 early return)', () => {
    // 修复前:make_dir_recursive_absolute 返回 Error 未捕获,目录创建失败后续 save 全失败但谎报。
    // 修复后:mkdir_err != OK 记 error + early return(quit)。
    expect(s()).toMatch(/mkdir_err/);
    expect(s()).toMatch(/create output dir failed/);
  });
});

// ─── F-7 csv_content 字节上限(2026-07-04 审查 IMPORTANT,复发 tscn-parser-no-byte-limit 同构)──
// handleTool 在 csvContent 确定后、parseCsv 前校验 MAX_CSV_BYTES,超限 INVALID_PARAMS。
// 校验在 findGodot 前 early return → 不依赖真实 Godot,可纯单测。

describe('F-7 csv_content 字节上限', () => {
  it('csv_content 超 10MB → INVALID_PARAMS,不调 findGodot', async () => {
    // 构造 >10MB CSV:header + 大量定长行
    const header = 'id,name\n';
    const row = 'x,yy\n'; // 6 bytes/行
    const rowsNeeded = Math.ceil((10 * 1024 * 1024) / row.length) + 100;
    const big = header + row.repeat(rowsNeeded);
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(10 * 1024 * 1024);

    let findGodotCalled = false;
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: '/tmp/proj',
        class_path: 'res://r.gd',
        output_dir: 'res://out',
        filename_column: 'id',
        csv_content: big,
      },
      { findGodot: async () => { findGodotCalled = true; return 'godot'; } } as unknown as ToolContext,
    );
    expect(findGodotCalled, '字节校验应在 findGodot 前 early return').toBe(false);
    expect(r).not.toBeNull();
    const r2 = r as { content: { type: string; text: string }[]; isError?: boolean };
    const payload = JSON.parse(r2.content[0]!.text);
    expect(payload.error_code).toBe('INVALID_PARAMS');
    expect(String(payload.error)).toMatch(/exceeds.*bytes/i);
  }, 30000);

  it('csv_content 合法大小(<10MB)→ 字节校验放行,继续后续流程(到达 findGodot)', async () => {
    // 小 CSV 不应被字节校验误拒。findGodot 被调用即说明校验放行(后续 executeGdscript 会失败但不影响本断言)。
    // projectDir 给真实 tmpdir 让 resolveWithinRoot 不抛错,能走到 findGodot。
    const small = 'id,name\n1,a\n';
    let findGodotCalled = false;
    let byteLimitTriggered = false;
    try {
      const r = await handleTool(
        'csv_to_resources',
        {
          action: 'csv_to_resources',
          project_path: '/tmp/proj',
          class_path: 'res://r.gd',
          output_dir: 'out',
          filename_column: 'id',
          csv_content: small,
        },
        { findGodot: async () => { findGodotCalled = true; throw new Error('stop-after-guard'); }, projectDir: tmpdir() } as unknown as ToolContext,
      );
      if (r && (r as { isError?: boolean }).isError) {
        const payload = JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
        if (/exceeds.*bytes/i.test(String(payload.error))) byteLimitTriggered = true;
      }
    } catch {
      /* findGodot throw 后无 catch 会冒出,忽略 */
    }
    expect(byteLimitTriggered, '合法大小不应触发字节超限错误').toBe(false);
    expect(findGodotCalled, '合法大小应通过字节校验到达 findGodot').toBe(true);
  });

  it('P1-2(2026-07-05 复审): csv_path 指向 >10MB 文件 → INVALID_PARAMS,不调 findGodot', async () => {
    // 修复前:csv_path 分支 readFileSync 在 F-7 字节守卫前,2GB 文件先 OOM 守卫永远跑不到。
    // 修复后:csv_path 分支 statSync().size 预检,超 10MB early return。
    // projectDir 给真实 tmpdir + csv_path 写真实大文件在其下(走 resolveWithinRoot 沙箱)。
    const projDir = tmpdir();
    const header = 'id,name\n';
    const row = 'x,yy\n'; // 6 bytes/行
    const rowsNeeded = Math.ceil((10 * 1024 * 1024) / row.length) + 100;
    const big = header + row.repeat(rowsNeeded);
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(10 * 1024 * 1024);
    const csvAbs = join(projDir, `big-csv-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
    writeFileSync(csvAbs, big, 'utf8');
    try {
      let findGodotCalled = false;
      const r = await handleTool(
        'csv_to_resources',
        {
          action: 'csv_to_resources',
          project_path: projDir,
          class_path: 'res://r.gd',
          output_dir: 'out',
          filename_column: 'id',
          csv_path: csvAbs,
        },
        { findGodot: async () => { findGodotCalled = true; return 'godot'; }, projectDir: projDir } as unknown as ToolContext,
      );
      expect(findGodotCalled, 'csv_path 大文件应在 findGodot 前 early return').toBe(false);
      expect(r).not.toBeNull();
      const r2 = r as { content: { type: string; text: string }[]; isError?: boolean };
      const payload = JSON.parse(r2.content[0]!.text);
      expect(payload.error_code).toBe('INVALID_PARAMS');
      expect(String(payload.error)).toMatch(/exceeds.*bytes/i);
    } finally {
      try { rmSync(csvAbs); } catch { /* 已删 */ }
    }
  }, 30000);

  it('审查 I-1(2026-07-05): csv_path 指向不存在文件 → 精确 INVALID_PARAMS,非 TOOL_ERROR', async () => {
    // 修复前:statSync 抛 ENOENT → ToolDispatcher 通用 catch → TOOL_ERROR(错误码精度退化)。
    // 修复后:existsSync 短路 → 精确 INVALID_PARAMS(对齐 android.ts:162/180 惯例)。
    const projDir = tmpdir();
    let findGodotCalled = false;
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: projDir,
        class_path: 'res://r.gd',
        output_dir: 'out',
        filename_column: 'id',
        csv_path: join(projDir, `nonexistent-${Math.random().toString(36).slice(2)}.csv`),
      },
      { findGodot: async () => { findGodotCalled = true; return 'godot'; }, projectDir: projDir } as unknown as ToolContext,
    );
    expect(findGodotCalled, 'csv_path 不存在应在 findGodot 前 early return').toBe(false);
    expect(r).not.toBeNull();
    const r2 = r as { content: { type: string; text: string }[]; isError?: boolean };
    const payload = JSON.parse(r2.content[0]!.text);
    expect(payload.error_code).toBe('INVALID_PARAMS');
    expect(String(payload.error)).toMatch(/not found/i);
  });
});

describe('generateImportScript P2-1 原子提交 + .tmp 清理', () => {
  const script = generateImportScript({
    classPath: 'res://item.gd',
    outputDir: '/tmp/out',
    filenameCol: 'name',
    csvTmpPath: '/tmp/csv.tmp',
  });

  it('save 循环用 tmp_path 中转 + rename_absolute 原子提交', () => {
    // P2-1 fix: tmp_path 用 .tmp.tres 扩展名（ResourceSaver 拒 .tmp 后缀 err 15）
    expect(script).toMatch(/var\s+tmp_path\s*:\s*String\s*=\s*full_path\.get_basename\(\)\s*\+\s*"\.tmp\.tres"/);
    expect(script).toMatch(/ResourceSaver\.save\(\s*res\s*,\s*tmp_path\s*\)/);
    expect(script).toMatch(/DirAccess\.rename_absolute\(\s*tmp_path\s*,\s*full_path\s*\)/);
  });

  it('rename 失败时清 tmp + 记 error', () => {
    expect(script).toMatch(/DirAccess\.remove_absolute\(\s*tmp_path\s*\)/);
    expect(script).toMatch(/rename failed/);
  });

  it('脚本开头清上次 kill 留下的 .tmp.tres 残留（C7: 扫 res:// 全局,非仅 _output_dir）', () => {
    expect(script).toMatch(/\.tmp\.tres/);
    expect(script).toMatch(/_clean_tmp_global\("res:\/\/"\)/);
  });

  it('保留 full_path 作为最终路径 + _generated.append(full_path)', () => {
    expect(script).toMatch(/var\s+full_path\s*:\s*String\s*=\s*_output_dir/);
    expect(script).toMatch(/_generated\.append\(\s*full_path\s*\)/);
  });
});

// ─── P2-1 Task 2: handler timeout 可配(schema 加可选 timeout,handler args.timeout ?? 60)──
// mock executeGdscriptTrusted 拦截到 handleTool :351 调用,断言传入的 timeout 参数。
// makeValidArgs 构造合法 args 通过 :296 必填 + :338 parseCsv header 校验 + :344 resolveWithinRoot,
// 到达 :351 executeGdscript 调用。output_dir='out' 相对路径 + project_path=tmpdir() 沙箱放行。

describe('csv_to_resources timeout 可配 P2-1', () => {
  const makeValidArgs = (overrides: Record<string, unknown> = {}) => ({
    action: 'csv_to_resources',
    project_path: tmpdir(),
    class_path: 'res://r.gd',
    output_dir: 'out',
    filename_column: 'id',
    csv_content: 'id,name\n1,a\n',
    ...overrides,
  });

  const makeCtx = (): ToolContext =>
    ({ findGodot: async () => 'godot', projectDir: tmpdir() } as unknown as ToolContext);

  beforeEach(() => { vi.clearAllMocks(); });

  it('不传 timeout → executeGdscript 收到默认 60', async () => {
    await handleTool('csv_to_resources', makeValidArgs({}), makeCtx());
    expect(executeGdscriptTrusted).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60 }));
  });

  it('传 timeout=120 → executeGdscript 收到 120', async () => {
    await handleTool('csv_to_resources', makeValidArgs({ timeout: 120 }), makeCtx());
    expect(executeGdscriptTrusted).toHaveBeenCalledWith(expect.objectContaining({ timeout: 120 }));
  });
});

// ─── A1 (2026-07-23 安全): class_path 路径遍历 → RCE 防护 ──────────────────────
// RCE 链: classPath 仅类型断言(as string)→ generateImportScript → GDScript load() + Class.new()
// → 经 executeGdscriptTrusted 跳沙箱(gdscript-executor.ts:1012-1013)→ 加载项目外 evil.gd 实例化
// _init() = 任意代码执行。修复: classPath 补 resolveWithinRoot(root, normalizeUserProjectPath(...))
// 沙箱校验,对齐 outputDir :350 模式(defects.ts:55 gdscript-template-injection 复发实例)。
// 越界 throw 由 ToolDispatcher 统一捕获;handleTool async → rejects.toThrow。

describe('A1 class_path 路径遍历防护(堵 RCE)', () => {
  it('class_path 越权(.. 段)被 resolveWithinRoot 拦截', async () => {
    // 构造合法 csv_content + 合法 output_dir/filename_column,仅 class_path 越权
    const args = {
      action: 'csv_to_resources',
      project_path: tmpdir(),
      class_path: 'res://../../evil.gd',
      output_dir: 'out',
      filename_column: 'name',
      csv_content: 'name\na\n',
    };
    const ctx = { findGodot: async () => 'godot', projectDir: tmpdir() } as unknown as ToolContext;
    await expect(handleTool('csv_to_resources', args, ctx)).rejects.toThrow(/Path traversal/);
  });
});

// ─── I1 (2026-07-23 final review): A1 合法路径 → load() 收到 res:// 格式（非绝对）────
// 修复前(a2669b5): safeClassPath = resolveWithinRoot(...) → 绝对路径（如 D:\tmp\r.gd）
//   → generateImportScript → _class_path := "D:\tmp\r.gd" → load() 期望 res:// 失效。
// 修复后: resolveWithinRoot 仅校验，safeClassPath = 'res://' + normalized → load("res://r.gd")。
describe('A1 class_path 合法路径格式(I1 回归保护)', () => {
  it('合法 class_path → load() 收到 res:// 格式,非项目绝对路径', async () => {
    vi.clearAllMocks();
    const projDir = tmpdir();
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: projDir,
        class_path: 'res://r.gd',
        output_dir: 'out',
        filename_column: 'id',
        csv_content: 'id,name\n1,a\n',
      },
      { findGodot: async () => 'godot', projectDir: projDir } as unknown as ToolContext,
    );
    // 1. 合法路径不应 reject / 报错
    expect(r).not.toBeNull();
    // 2. executeGdscriptTrusted(别名 executeGdscript) 被调用,其 code 含 _class_path 行
    expect(executeGdscriptTrusted).toHaveBeenCalled();
    const callArgs = vi.mocked(executeGdscriptTrusted).mock.calls[0]![0] as { code: string };
    const m = callArgs.code.match(/var\s+_class_path\s*:=\s*"([^"]*)"/);
    expect(m, '_class_path 行必须存在').not.toBeNull();
    // 3. load() 收到 res:// 格式(I1 fix 后)
    expect(m![1]).toBe('res://r.gd');
    // 4. 反向: 非项目绝对路径(I1 bug 复发会让 m[1] 含 projDir)
    expect(m![1]).not.toMatch(projDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  });
});
