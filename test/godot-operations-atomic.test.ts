import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// B7 headless 资源写原子化（godot_operations.gd 9 处）
// 字面量契约测试：验证 helper 存在 + 9 处改调 + 无直写目标残留。
// 不跑 Godot，只读源码字面量。
describe('B7 godot_operations.gd 资源写原子化', () => {
  const src = readFileSync('src/scripts/godot_operations.gd', 'utf8');

  it('定义 _save_atomic helper（tmp 按目标扩展名派生 + rename + 失败清理）', () => {
    expect(src).toContain('func _save_atomic(');
    expect(src).toMatch(/get_extension\(\)/);
    expect(src).toContain('".tmp."');
    expect(src).toContain('DirAccess.rename_absolute');
    expect(src).toContain('DirAccess.remove_absolute'); // save/rename 失败清理 tmp
  });

  it('9 处资源写改调 _save_atomic（helper 内部仅 1 处 ResourceSaver.save 写 tmp）', () => {
    // helper 内部允许且仅允许 1 处 ResourceSaver.save(tmp)，其余全走 _save_atomic
    const saveMatches = src.match(/ResourceSaver\.save/g) ?? [];
    expect(saveMatches.length).toBeLessThanOrEqual(1); // 仅 helper 内 1 处
    const atomicCalls = src.match(/_save_atomic\(/g) ?? [];
    expect(atomicCalls.length).toBeGreaterThanOrEqual(9 + 1); // 9 处调用点 + 1 处 helper 定义
  });
});
