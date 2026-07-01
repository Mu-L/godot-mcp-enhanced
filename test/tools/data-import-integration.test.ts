/**
 * T7 集成测试:真 Godot 跑 csvToResources 全链路,读回 .tres 验证。
 *
 * 全链路:parseCsv → writeTmpCsv → resolveWithinRoot → generateImportScript →
 *        executeGdscript → ResourceSaver → (反向) executeGdscript load 读回字段值。
 *
 * 4 场景:
 *   1. 各类型正确(String/int/bool/Color/@export_enum 枚举 SWORD→0/BOW→1)
 *   2. 空单元格 + 缺失列 → 保留类默认(damage=0, color=WHITE)
 *   3. filename 含 ../ → 拒(generated=0, errors 含 invalid filename, output_dir 外无文件)
 *   4. 类型不匹配 → 记 error,其他字段仍 set(damage="abc" 拒,name 仍 set)
 *
 * 依赖真实 Godot(GODOT_PATH);无 Godot 时 skipIf 守卫跳过(不假绿)。
 * class_name 缓存:T1 已触发 --import 预热 global_script_class_cache.cfg(命中 TestResource)。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { handleTool } from '../../src/tools/data-import.js';
import { executeGdscript } from '../../src/gdscript-executor.js';
import { findGodot } from '../../src/core/godot-finder.js';
import type { ToolContext } from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_PROJECT = resolve(__dirname, '..', 'fixtures', 'real-project');

const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);

if (!hasGodot) {
  process.stderr.write(
    `[T7-SKIP] 未找到 GODOT_PATH (${GODOT_PATH}) — T7 集成测试依赖真实 Godot,将被跳过。\n`,
  );
}

// output_dir(项目内临时目录)。CSV→Resource 在此落 .tres,afterEach 清理。
const OUT_REL = 'res://resources/_csv_test_out';
const OUT_ABS = resolve(REAL_PROJECT, 'resources', '_csv_test_out');

// 构造最小 ToolContext(只 csvToResources 用到的字段:projectDir + findGodot)。
function makeCtx(): ToolContext {
  return {
    opsScript: '',
    findGodot: async () => GODOT_PATH || findGodot(REAL_PROJECT),
    runningProcess: null,
    setRunningProcess: () => {},
    outputBuffer: [],
    setOutputBuffer: () => {},
    processStartTime: 0,
    setProcessStartTime: () => {},
    projectDir: REAL_PROJECT,
    parseGodotConfig: () => ({}),
  } as unknown as ToolContext;
}

// 解析 handleTool 返回的 textResult(JSON 字符串在 content[0].text)。
function parseResult(r: { content: { type: string; text: string }[] }): {
  generated: string[];
  errors: { row: number; field?: string; value?: string; reason: string }[];
  stats: { rows: number; generated: number; failed: number };
} {
  const txt = r.content[0]!.text;
  return JSON.parse(txt);
}

// 读回 .tres 字段(真 Godot load,验证各类型值)。每文件一个 executeGdscript 调用,
// 返回拼接的 raw_output 供 print 断言。GDScript 强制 tab 缩进,模板用 \t 显式构造。
async function readBack(
  paths: string[],
  fields: string[],
): Promise<string> {
  let combined = '';
  for (const p of paths) {
    const fname = p.split(/[\\/]/).pop()!.replace(/\.tres$/, '');
    const resPath = `res://resources/_csv_test_out/${fname}.tres`;
    const lines: string[] = ['extends SceneTree', 'func _initialize():'];
    lines.push(`\tvar r = load("${resPath}")`);
    lines.push(`\tif r == null:`);
    lines.push(`\t\tprint("READBACK_LOAD_NULL ${resPath}")`);
    lines.push(`\t\tquit()`);
    lines.push(`\t\treturn`);
    for (const f of fields) {
      lines.push(`\tprint("FIELD ${f}=", r.${f})`);
    }
    lines.push('\tquit()', '');
    const r = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: REAL_PROJECT,
      code: lines.join('\n'),
      timeout: 30,
    });
    combined += r.raw_output ?? '';
  }
  return combined;
}

// T7: Color 字段用 is_equal_approx 在 GDScript 侧比较,输出 COLORCHK 标记(脱离 print 格式耦合)。
// 避免 Godot 4.x print "(1.0, 0.0, 0.0, 1.0)" 字符串格式假设,改比较 r/g/b/a 分量值。
// expects: [{ resId, field, r, g, b, a }] → 输出 "COLORCHK <field> OK/FAIL"。
async function readBackColors(
  checks: { resId: string; field: string; r: number; g: number; b: number; a: number }[],
): Promise<string> {
  let combined = '';
  for (const c of checks) {
    const resPath = `res://resources/_csv_test_out/${c.resId}.tres`;
    const lines: string[] = ['extends SceneTree', 'func _initialize():'];
    lines.push(`\tvar r = load("${resPath}")`);
    lines.push(`\tif r == null:`);
    lines.push(`\t\tprint("READBACK_LOAD_NULL ${resPath}")`);
    lines.push(`\t\tquit()`);
    lines.push(`\t\treturn`);
    lines.push(`\tvar col = r.${c.field}`);
    lines.push(`\tvar ok = is_equal_approx(col.r, ${c.r}) and is_equal_approx(col.g, ${c.g}) and is_equal_approx(col.b, ${c.b}) and is_equal_approx(col.a, ${c.a})`);
    lines.push(`\tprint("COLORCHK ${c.field} ", "OK" if ok else "FAIL", " got=", col.r, ",", col.g, ",", col.b, ",", col.a)`);
    lines.push('\tquit()', '');
    const r = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: REAL_PROJECT,
      code: lines.join('\n'),
      timeout: 30,
    });
    combined += r.raw_output ?? '';
  }
  return combined;
}

// ─── 清理 ────────────────────────────────────────────────────────────────────

afterEach(() => {
  if (existsSync(OUT_ABS)) rmSync(OUT_ABS, { recursive: true, force: true });
});
afterAll(() => {
  if (existsSync(OUT_ABS)) rmSync(OUT_ABS, { recursive: true, force: true });
});

// ─── 测试 ──────────────────────────────────────────────────────────────────────

describe.skipIf(!hasGodot)('csvToResources 集成(真 Godot)', () => {
  beforeAll(() => {
    // class_name 预热:T1 已触发 --import,缓存命中 TestResource。
    const cache = resolve(REAL_PROJECT, '.godot', 'global_script_class_cache.cfg');
    if (!existsSync(cache)) {
      throw new Error(
        `[T7-SETUP] global_script_class_cache.cfg 不存在(${cache})。` +
        `T1 应已预热。运行 Godot --import 一次以生成。`,
      );
    }
  }, 60000);

  it('CSV → N 个 .tres,各类型正确(String/int/bool/Color/@export_enum)', async () => {
    const csv =
      'id,name,damage,enabled,color,weapon_kind,tags\n' +
      'sword,剑,10,true,#ff0000,SWORD,"sharp,metal"\n' +
      'bow,弓,5,false,#00ff00,BOW,"wood,bow"\n';
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: REAL_PROJECT,
        class_path: 'res://resources/test_resource.gd',
        output_dir: OUT_REL,
        filename_column: 'id',
        csv_content: csv,
      },
      makeCtx(),
    );
    expect(r).not.toBeNull();
    const parsed = parseResult(r!);
    expect(parsed.stats.generated).toBe(2);
    expect(parsed.errors).toEqual([]);

    // 读回验证(真 Godot load)。非 Color 字段经 readBack print 断言。
    const out = await readBack(parsed.generated, ['name', 'damage', 'enabled', 'weapon_kind', 'tags']);
    // sword(#ff0000 → Color(1,0,0,1))
    expect(out).toContain('FIELD name=剑');
    expect(out).toContain('FIELD damage=10');
    expect(out).toContain('FIELD enabled=true');
    expect(out).toContain('FIELD weapon_kind=0'); // SWORD → 0
    // T3: PackedStringArray 字段(CSV "sharp,metal" → split(",") → set 成功,print 格式 ["a", "b"])
    expect(out).toContain('FIELD tags=["sharp", "metal"]');
    // bow(#00ff00 → Color(0,1,0,1))。readBack 每文件独立 executeGdscript,
    // 输出按 generated 顺序拼接,断言用 bow 的唯一特征值(无需切片定位)。
    expect(out).toContain('FIELD name=弓');
    expect(out).toContain('FIELD damage=5');
    expect(out).toContain('FIELD enabled=false');
    expect(out).toContain('FIELD weapon_kind=1'); // BOW → 1
    expect(out).toContain('FIELD tags=["wood", "bow"]');
    // T7: Color 字段用 is_equal_approx 比较分量(脱离 Godot 4.x print "(1.0, 0.0, 0.0, 1.0)" 格式耦合)。
    const cout = await readBackColors([
      { resId: 'sword', field: 'color', r: 1, g: 0, b: 0, a: 1 },   // #ff0000
      { resId: 'bow', field: 'color', r: 0, g: 1, b: 0, a: 1 },     // #00ff00
    ]);
    expect(cout).toContain('COLORCHK color OK');
    expect(cout).not.toContain('COLORCHK color FAIL');
  }, 60000);

  it('空单元格 + 缺失列 → 保留类默认(damage=0, color=WHITE)', async () => {
    // CSV 缺 color 列 + damage 空单元格 → damage 保留类默认(0)、color 保留类默认(WHITE)。
    // enabled 保留类默认(true)。name 仍 set。
    const csv =
      'id,name,damage,enabled\n' + // 注意:无 color 列
      'def,默认,,false\n'; // damage 空单元格(enabled=false 覆盖类默认 true)
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: REAL_PROJECT,
        class_path: 'res://resources/test_resource.gd',
        output_dir: OUT_REL,
        filename_column: 'id',
        csv_content: csv,
      },
      makeCtx(),
    );
    expect(r).not.toBeNull();
    const parsed = parseResult(r!);
    expect(parsed.stats.generated).toBe(1);
    expect(parsed.errors).toEqual([]); // 空单元格/缺列非错误(保留默认)

    const out = await readBack(parsed.generated, ['name', 'damage', 'enabled']);
    expect(out).toContain('FIELD name=默认');
    expect(out).toContain('FIELD damage=0'); // 空单元格 → 类默认 0
    expect(out).toContain('FIELD enabled=false'); // 显式 false 覆盖
    // T7: Color.WHITE 分量比较(脱离 print 格式)。
    const cout = await readBackColors([{ resId: 'def', field: 'color', r: 1, g: 1, b: 1, a: 1 }]);
    expect(cout).toContain('COLORCHK color OK');
    expect(cout).not.toContain('COLORCHK color FAIL');
  }, 60000);

  it('filename 含 ../ → 拒(generated=0, output_dir 外无文件)', async () => {
    const csv = 'id,name\n../evil,x\n';
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: REAL_PROJECT,
        class_path: 'res://resources/test_resource.gd',
        output_dir: OUT_REL,
        filename_column: 'id',
        csv_content: csv,
      },
      makeCtx(),
    );
    expect(r).not.toBeNull();
    const parsed = parseResult(r!);
    expect(parsed.stats.generated).toBe(0);
    expect(parsed.errors.some((e) => e.reason.includes('invalid filename'))).toBe(true);

    // output_dir 外无文件:evil.tres 不应出现在 real-project 根目录(output_dir 上一级)。
    const evilTres = resolve(REAL_PROJECT, 'evil.tres');
    expect(existsSync(evilTres)).toBe(false);
    // output_dir 内也不应有文件(整行被拒)。
    if (existsSync(OUT_ABS)) {
      // 目录可能被 GDScript 创建(空),但不应有 evil.tres。
      const evilInside = resolve(OUT_ABS, 'evil.tres');
      expect(existsSync(evilInside)).toBe(false);
    }
  }, 60000);

  it('类型不匹配 → 记 error,其他字段仍 set(damage="abc" 拒, name 仍 set)', async () => {
    // damage 正常给数字,name 正常 → 这两个字段仍 set。
    // 为覆盖另一条转换失败路径(Color),用 color 字段给非法值(无法转换 → null → error)。
    // color="notacolor":不 begins_with #,split(',') size<3 → 返回 null → error。
    // 注:TYPE_INT 的转换失败路径由 I-1 场景(damage="abc")覆盖。
    const csv =
      'id,name,damage,color\n' +
      'mix,混合,7,notacolor\n';
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: REAL_PROJECT,
        class_path: 'res://resources/test_resource.gd',
        output_dir: OUT_REL,
        filename_column: 'id',
        csv_content: csv,
      },
      makeCtx(),
    );
    expect(r).not.toBeNull();
    const parsed = parseResult(r!);
    // 文件仍生成(类型错误是字段级,不阻止整行;ResourceSaver 仍执行)。
    expect(parsed.stats.generated).toBe(1);
    // errors 含 color 字段的 type convert failed。
    expect(parsed.errors.some((e) => e.field === 'color' && e.reason.includes('type convert'))).toBe(true);

    // 读回:damage=7(set 成功),name=混合(set 成功),color=WHITE(类默认,转换失败未覆盖)。
    const out = await readBack(parsed.generated, ['name', 'damage']);
    expect(out).toContain('FIELD name=混合');
    expect(out).toContain('FIELD damage=7');
    // T7: Color.WHITE 分量比较(类默认,转换失败保留)。
    const cout = await readBackColors([{ resId: 'mix', field: 'color', r: 1, g: 1, b: 1, a: 1 }]);
    expect(cout).toContain('COLORCHK color OK');
    expect(cout).not.toContain('COLORCHK color FAIL');
  }, 60000);

  it('I-1: TYPE_INT 转换失败(damage="abc")→记 error,不静默归零', async () => {
    // I-1 修复前:int("abc") 静默返回 0(GDScript 无异常),违反 spec §4/§9"转换失败→跳过+记 error"。
    // I-1 修复后:模板 _type_convert 对 TYPE_INT 先 is_valid_int() 校验,
    // "abc" 非法 → 返回 null → 命中 _errors.append(type convert failed) → 该行 damage 保留类默认。
    // generated 仍含该行(字段级错误不阻塞整行),errors 含 damage convert failed。
    const csv =
      'id,name,damage\n' +
      'badval,坏值,abc\n';
    const r = await handleTool(
      'csv_to_resources',
      {
        action: 'csv_to_resources',
        project_path: REAL_PROJECT,
        class_path: 'res://resources/test_resource.gd',
        output_dir: OUT_REL,
        filename_column: 'id',
        csv_content: csv,
      },
      makeCtx(),
    );
    expect(r).not.toBeNull();
    const parsed = parseResult(r!);
    // 文件仍生成(字段级错误不阻止整行;ResourceSaver 仍执行)。
    expect(parsed.stats.generated).toBe(1);
    // errors 含 damage 字段的 type convert failed(I-1 新增 is_valid_int 守卫触发)。
    expect(parsed.errors.some((e) => e.field === 'damage' && e.reason.includes('type convert'))).toBe(true);

    // 读回:name=坏值(set 成功),damage=0(类默认,转换失败保留,非静默归零覆盖)。
    const out = await readBack(parsed.generated, ['name', 'damage']);
    expect(out).toContain('FIELD name=坏值');
    expect(out).toContain('FIELD damage=0'); // 类默认(I-1:保留默认,非 abc→0 静默覆盖)
  }, 60000);
});
