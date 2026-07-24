import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// 批次 C Task 5：C2 extractCompileError \b 词边界 + C6 csv_content size + C7 .tmp 全局清 + C8 proc.on retryRm
// 字面量契约（extractCompileError 私有不 export，csv_to_resources 需 mock ctx，故用源码断言）。
describe('C2/C6/C7/C8 TS 正确性', () => {
  it('C2 extractCompileError 用 \\b 词边界（非裸 includes）', () => {
    const src = readFileSync('src/gdscript-executor.ts', 'utf8');
    const fn = src.match(/function extractCompileError[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn.length, 'extractCompileError 未找到').toBeGreaterThan(0);
    // \b 词边界正则（对齐 :1303 no-marker 兜底），避免用户 print("Parse Error: debug") 误判
    expect(fn).toMatch(/:\[0-9\]\+ - \(Parse Error\|Script Error\):/);
    // 不再裸 includes（原 trimmed.includes('Parse Error:')）
    expect(fn).not.toMatch(/trimmed\.includes\('Parse Error/);
  });

  it('C8 proc.on(error) + catch 用 retryRm（非裸 rm sessionDir）', () => {
    const src = readFileSync('src/gdscript-executor.ts', 'utf8');
    // 不再有裸 rm(sessionDir, { recursive... }).catch
    expect(src).not.toMatch(/rm\(sessionDir,\s*\{/);
    // retryRm(sessionDir) 存在（timer :1255 / close :1269 / proc.on :1344 / catch :1143）
    expect(src).toMatch(/retryRm\(sessionDir\)/);
  });

  it('C6 csv_content 分支前置 size 守卫（对齐 csv_path statSync 预检）', () => {
    const src = readFileSync('src/tools/data-import.ts', 'utf8');
    const branch = src.match(/if \(args\.csv_content\) \{[\s\S]*?\} else if \(args\.csv_path\)/)?.[0] ?? '';
    expect(branch.length, 'csv_content 分支未找到').toBeGreaterThan(0);
    // 前置 size 守卫（在 csvContent 赋值前）
    expect(branch).toMatch(/MAX_CSV_BYTES/);
    expect(branch).toMatch(/byteLength/);
  });

  it('C7 data-import 模板扫 res:// 全局 .tmp.tres（_clean_tmp_global 递归）', () => {
    const src = readFileSync('src/tools/data-import.ts', 'utf8');
    expect(src).toContain('_clean_tmp_global');
    // _initialize 内调用扫 res://（替换原只扫 _output_dir 的 P2-1）
    expect(src).toMatch(/_clean_tmp_global\("res:\/\/"\)/);
    // helper 递归 + 跳过 . 前缀目录（.godot）+ depth≤10（对齐 godot_operations find_files）
    const helper = src.match(/func _clean_tmp_global[\s\S]*?func _initialize/)?.[0] ?? '';
    expect(helper.length, '_clean_tmp_global helper 未找到').toBeGreaterThan(0);
    expect(helper).toMatch(/begins_with\("\."\)/);
    expect(helper).toMatch(/depth > 10/);
    expect(helper).toMatch(/ends_with\("\.tmp\.tres"\)/);
  });
});
