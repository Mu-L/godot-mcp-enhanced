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

// N2 nav status 动态派生（C-T2：C-Correctness 第 2 条）
describe('N2 nav status 派生（反硬编码）', () => {
  it('N2: bake status derived from success/_bake_state (not hardcoded)', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/nav_commands.gd', 'utf-8');
    // 正向：sync 分支按 success 派生（GDScript 三元：value if cond else value）
    expect(gd).toMatch(/"status":\s*"bake_completed"\s+if\s+success\s+else\s+"bake_failed"/);
    // 正向：async 分支按 _bake_state["done"] 派生
    expect(gd).toMatch(/"status":\s*"bake_completed"\s+if\s+_bake_state\["done"\]\s+else\s+"bake_timeout"/);
    // 反向：不再有行末纯字面量 "status": "bake_completed"（后面没有 if/else）
    // 允许三元表达式中出现 bake_completed
    const lines = gd.split('\n');
    const hardcodedLines = lines.filter(line =>
      line.includes('"status": "bake_completed"') &&
      !line.includes(' if ') &&
      !line.includes(' else ')
    );
    expect(hardcodedLines.length).toBe(0);
  });
});
