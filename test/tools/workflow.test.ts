import { describe, it, expect } from 'vitest';
import { genSceneSnapshotScript } from '../../src/tools/workflow.js';

// 审查 CRITICAL: scene_snapshot 的 _mcp_get_root().add_child(instance) 在 self.root==null 时
// null.add_child NPE 崩溃。加固为:var _root; if _root==null: 错误返回+queue_free; _root.add_child。
// 此测试锁定判空守卫,防回退到未判空的 _mcp_get_root().add_child(崩溃级)。
describe('workflow genSceneSnapshotScript: _root 判空守卫(CRITICAL 防回归)', () => {
  it('含 _root 判空守卫(null.add_child 防崩溃)', () => {
    const script = genSceneSnapshotScript('res://scenes/x.tscn', 5);
    expect(script).toContain('var _root: Node = _mcp_get_root()');
    expect(script).toContain('if _root == null:');
    expect(script).toContain('_mcp_output("error", "Scene root not available")');
    expect(script).toContain('instance.queue_free()');
    expect(script).toContain('_root.add_child(instance)');
    // 防回归:不应出现未判空的 _mcp_get_root().add_child(崩溃级)
    expect(script).not.toContain('_mcp_get_root().add_child');
  });
});
