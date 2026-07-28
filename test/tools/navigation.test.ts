import { describe, it, expect } from 'vitest';
import {
  genCreateRegionScript,
  genCreateAgentScript,
  genCreateLinkScript,
  genBakeMeshScript,
} from '../../src/tools/navigation.js';

// 审查发现:navigation 三个 create 生成器的 set_owner(_mcp_get_root()) 在 self.root==null 时为
// set_owner(null)。虽 Godot4 合法不崩,但按项目判空惯例(6处+3模板均判空)加固为:
//   var _root: Node = _mcp_get_root()
//   if _root != null:
//       _x.set_owner(_root)
// 这些测试锁定判空守卫,防未来回退到未判空的 set_owner(_mcp_get_root())。
describe('navigation 生成器: set_owner 判空守卫(防回归)', () => {
  const pos = { x: 0, y: 0, z: 0 };

  it('genCreateRegionScript: set_owner 经 _root 判空', () => {
    const script = genCreateRegionScript('TestNav', 'root', pos, false);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script).toContain('if _root != null:');
    expect(script).toContain('_nav.set_owner(_root)');
    // 防回归:不应出现未判空的直接 set_owner(_mcp_get_root())
    expect(script).not.toContain('set_owner(_mcp_get_root())');
  });

  it('genCreateAgentScript: set_owner 经 _root 判空', () => {
    const script = genCreateAgentScript('TestAgent', 'root', pos, 0.5, 1.0, false);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script).toContain('if _root != null:');
    expect(script).toContain('_agent.set_owner(_root)');
    expect(script).not.toContain('set_owner(_mcp_get_root())');
  });

  it('genCreateLinkScript: set_owner 经 _root 判空', () => {
    const script = genCreateLinkScript('TestLink', 'root', pos, pos, true);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script).toContain('if _root != null:');
    expect(script).toContain('_link.set_owner(_root)');
    expect(script).not.toContain('set_owner(_mcp_get_root())');
  });
});

// Task 6 (§9，与 editor §6 同款): headless bake 不能用 is_baking 轮询
// (NavigationRegion3D 无 is_baking 属性)，改用 bake_finished 信号 + dict holder
// (GDScript 4 lambda by-value，避 _baking 局部变量捕获退化)。判据用
// navigation_mesh.get_vertices().size() > 0（非 plan 原写的 get_vertices_count，
// Task 0 实测 Nonexistent function；非乐观 _nav.navigation_mesh != null）。
describe('navigation bake 完成检测（fallback 信号+dict holder，防退化）', () => {
  it('genBakeMeshScript: 用 _wait_bake_done + get_vertices().size() 判据', () => {
    const script = genBakeMeshScript('root/NavRegion');
    // fallback 信号 + dict holder helper 内嵌
    expect(script).toContain('func _wait_bake_done(_nav, _timeout_ms)');
    expect(script).toContain('var _state = {"done": false}');
    expect(script).toContain('_nav.bake_finished.connect(_cb)');
    expect(script).toContain('await _wait_bake_done(_nav, 110000)');
    // 判据：get_vertices().size() > 0
    expect(script).toContain('_nav.navigation_mesh.get_vertices().size() > 0');
    // 防回归：不应出现 is_baking 属性轮询（属性不存在）
    expect(script).not.toContain('.is_baking');
    // 防回归：不应出现 get_vertices_count（Nonexistent function）
    expect(script).not.toContain('get_vertices_count()');
    // 防回归：不应出现乐观 _nav.navigation_mesh != null 单独判据
    expect(script).not.toMatch(/_bake_ok = _nav\.navigation_mesh != null\n/);
  });

  it('genCreateRegionScript: bake=true 时嵌入 _wait_bake_done 调用 + vertices 判据', () => {
    const script = genCreateRegionScript('TestNav', 'root', { x: 0, y: 0, z: 0 }, true);
    expect(script).toContain('await _wait_bake_done(_nav, 110000)');
    expect(script).toContain('_nav.navigation_mesh.get_vertices().size() > 0');
    expect(script).toContain('"baked": _baked');
    expect(script).not.toContain('.is_baking');
  });

  it('genCreateRegionScript: bake=false 时不调 bake_navigation_mesh / _wait_bake_done', () => {
    const script = genCreateRegionScript('TestNav', 'root', { x: 0, y: 0, z: 0 }, false);
    expect(script).not.toContain('bake_navigation_mesh()');
    expect(script).not.toContain('await _wait_bake_done');
    expect(script).toContain('"baked": _baked');
  });
});
