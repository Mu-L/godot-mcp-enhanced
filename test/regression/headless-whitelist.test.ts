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

// P2-3 (2026-08-06): scene-commit node_add 从黑名单收紧为白名单。
// 原黑名单(SENSITIVE_NODE_TYPES 9 项)漏第三方 addon 注册的 extends Node 恶意 class_name,
// ${op.type}.new() 跑 _ready() → OS.execute RCE(不经 execute_gdscript 沙箱)。
// 白名单须与 headless ALLOWED_HEADLESS_TYPES 同步(defects detect 守护)。
const COMMIT = readFileSync(
  join(__dirname, '..', '..', 'src', 'tools', 'scene', 'scene-commit.ts'),
  'utf-8',
);

describe('scene-commit node_add whitelist (P2-3)', () => {
  it('has ALLOWED_COMMIT_NODE_TYPES const (whitelist, not blacklist)', () => {
    expect(COMMIT).toMatch(/const ALLOWED_COMMIT_NODE_TYPES = new Set\(/);
    // 反向：不再用黑名单 SENSITIVE_NODE_TYPES(防回退到 IMP-4 黑名单方案)
    expect(COMMIT).not.toMatch(/const SENSITIVE_NODE_TYPES/);
    expect(COMMIT).not.toMatch(/SENSITIVE_NODE_TYPES\.has/);
  });

  it('whitelist mirrors headless ALLOWED_HEADLESS_TYPES (Node3D/Node2D/Control representatives)', () => {
    // 白名单覆盖三大家族的代表类(与 godot_operations.gd:195-211 同源)
    expect(COMMIT).toMatch(/'Node3D'/);
    expect(COMMIT).toMatch(/'Node2D'/);
    expect(COMMIT).toMatch(/'Control'/);
    expect(COMMIT).toMatch(/'Button'/);
    // 反向:白名单不含敏感类(网络/系统/执行)
    const wlBlock = COMMIT.match(/const ALLOWED_COMMIT_NODE_TYPES[\s\S]{0,3000}?\]\)/);
    expect(wlBlock, 'ALLOWED_COMMIT_NODE_TYPES block found').toBeTruthy();
    expect(wlBlock![0]).not.toMatch(/'HTTPRequest'/);
    expect(wlBlock![0]).not.toMatch(/'Thread'/);
    expect(wlBlock![0]).not.toMatch(/'OS'/);
    expect(wlBlock![0]).not.toMatch(/'ClassDB'/);
  });

  it('node_add branch rejects non-allowlist types (whitelist membership check)', () => {
    // 匹配 node_add case 从白名单守卫到 reject 错误信息(含 "Type not in allowlist")
    const m = COMMIT.match(/ALLOWED_COMMIT_NODE_TYPES\.has\(op\.type\)[\s\S]{0,400}?Type not in allowlist/);
    expect(m, 'node_add whitelist reject branch found').toBeTruthy();
    expect(m![0]).toMatch(/ALLOWED_COMMIT_NODE_TYPES\.has\(op\.type\)/);
    // 反向:不再用黑名单 has 检查
    expect(COMMIT).not.toMatch(/SENSITIVE_NODE_TYPES\.has/);
  });
});
