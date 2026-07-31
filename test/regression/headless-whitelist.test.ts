import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// P1 RCE 核心契约：headless instantiate_class 必须用合并白名单 ∈ 检查，
// 不再依赖 is_parent_class("Node") 兜底（Node 是 Node 的父类 → extends Node 恶意脚本绕过）。
// 参 recording F2 模式：读 .gd 源码做字面量断言。
const GD = readFileSync(
  join(__dirname, '..', '..', 'src', 'scripts', 'godot_operations.gd'),
  'utf-8',
);

describe('headless instantiate_class whitelist (P1 RCE)', () => {
  it('has ALLOWED_HEADLESS_TYPES const (merged node + control + Control, no bare Node)', () => {
    expect(GD).toMatch(/const ALLOWED_HEADLESS_TYPES/);
    // Node 系代表
    expect(GD).toMatch(/"Node2D"/);
    expect(GD).toMatch(/"Node3D"/);
    // Control 系基础类与代表
    expect(GD).toMatch(/"Control"/);
    expect(GD).toMatch(/"Button"/);
    // 反向：白名单数组中不含裸 "Node"（防误加回 → extends Node 绕过）
    const wlBlock = GD.match(/const ALLOWED_HEADLESS_TYPES[\s\S]{0,1200}?\]/);
    expect(wlBlock, 'ALLOWED_HEADLESS_TYPES array block found').toBeTruthy();
    expect(wlBlock![0]).not.toMatch(/^[\t ]*"Node",/m);
    expect(wlBlock![0]).not.toMatch(/,\s*"Node"\s*,/);
  });

  it('ClassDB branch uses whitelist membership (not is_parent_class fallback)', () => {
    // 匹配整个 ClassDB 分支体（到该分支的 return result 为止），非贪婪到首个 return null
    // 会截断在 helper 调用前，故用 return result 作为右界
    const m = GD.match(/if ClassDB\.class_exists[\s\S]{0,1200}?return result/);
    expect(m, 'ClassDB branch found').toBeTruthy();
    // 白名单检查实现：helper 调用（_is_headless_allowed 内部引用 ALLOWED_HEADLESS_TYPES）
    expect(m![0]).toMatch(/_is_headless_allowed\(name_of_class\)/);
    // 反向：不再用 is_parent_class("Node") 作为 ClassDB 分支的充分守卫
    expect(m![0]).not.toMatch(
      /if not ClassDB\.is_parent_class\(\s*name_of_class,\s*"Node"\s*\)/,
    );
  });

  it('script branch uses base_type whitelist membership (rejects extends Node)', () => {
    const m = GD.match(/if script is GDScript:[\s\S]{0,700}?return script\.new\(\)/);
    expect(m, 'script branch found').toBeTruthy();
    expect(m![0]).toMatch(/ALLOWED_HEADLESS_TYPES|_is_headless_allowed\(base_type\)/);
    // 反向：不再用 is_parent_class(base_type, "Node") 兜底（Node 是 Node 的父类 → 绕过）
    expect(m![0]).not.toMatch(/is_parent_class\(\s*base_type\s*,\s*"Node"\s*\)/);
  });
});
