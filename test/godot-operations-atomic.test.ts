import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// B7 headless 资源写原子化（godot_operations.gd）
// 字面量契约测试：验证 helper 存在 + 8 处改调 + :847 .uid 例外直写 + 启动清残留。
// 不跑 Godot，只读源码字面量。
describe('B7 godot_operations.gd 资源写原子化', () => {
  const src = readFileSync('src/scripts/godot_operations.gd', 'utf8');

  it('定义 _save_atomic helper（tmp 按目标扩展名派生 + 写前清旧 tmp + rename + 失败清理）', () => {
    expect(src).toContain('func _save_atomic(');
    expect(src).toMatch(/get_extension\(\)/);
    expect(src).toContain('".tmp."');
    expect(src).toContain('DirAccess.rename_absolute');
    expect(src).toContain('DirAccess.remove_absolute'); // save/rename 失败清理 tmp
    // B7 写前清同路径旧 tmp(防上次同路径 crash 残留); FileAccess.file_exists 是静态, DirAccess.file_exists 非静态
    expect(src).toContain('if FileAccess.file_exists(tmp)');
  });

  it('启动清理 _clean_atomic_tmp（扫 res:// 残留 *.tmp.{tres,tscn,res}，进程入口调用一次）', () => {
    expect(src).toContain('func _clean_atomic_tmp()');
    expect(src).toContain('.tmp.tres');
    expect(src).toContain('.tmp.tscn');
    expect(src).toContain('.tmp.res');
    // _init 进程入口调用
    expect(src).toContain('_clean_atomic_tmp()');
  });

  it('8 处资源写改调 _save_atomic + :847 resave uid 例外直写（helper 内 tmp + 例外共 2 处 ResourceSaver.save）', () => {
    // helper 内写 tmp 1 处 + :847 .uid 例外直写原路径 1 处 = 2
    const saveMatches = src.match(/ResourceSaver\.save/g) ?? [];
    expect(saveMatches.length).toBe(2);
    // 8 处调用点 + 1 处 helper 定义
    const atomicCalls = src.match(/_save_atomic\(/g) ?? [];
    expect(atomicCalls.length).toBeGreaterThanOrEqual(8 + 1);
  });

  it(':847 resave_resources 的 .uid 例外文档化（不原子化, 直写原路径 script_path）', () => {
    expect(src).toContain('B7 例外');
    // resave_resources 内直接 ResourceSaver.save(res, script_path)
    expect(src).toContain('ResourceSaver.save(res, script_path)');
  });
});
