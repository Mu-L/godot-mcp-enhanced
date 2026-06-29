import { describe, it, expect } from 'vitest';
import {
  genCreateRegionScript,
  genCreateAgentScript,
  genCreateLinkScript,
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
