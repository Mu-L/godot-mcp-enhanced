import { describe, it, expect } from 'vitest';
import { genUiMeasureScript } from '../src/tools/ui/ui-measure.js';

describe('genUiMeasureScript', () => {
  it('生成 full-class SceneTree 脚本:等帧 + marker 输出 + quit', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s.startsWith('extends SceneTree')).toBe(true);
    expect(s).toContain('process_frame.connect(_on_measure_frame)');
    expect(s).toContain('_mcp_output("measure"');
    expect(s).toContain('_mcp_done()');
    expect(s).toContain('quit(0)');
    expect(s).toContain('_mcp_load_scene("res://scenes/main.tscn")');
  });

  it('稳定判定:连续 2 帧快照一致即输出,上限 5 帧', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('_stable_count >= 2');
    expect(s).toContain('_frames >= 5');
  });

  it('node_path 限定测量子树', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', 'HUD', 16);
    expect(s).toContain('_mcp_get_scene_node("HUD")');
  });

  it('maxDepth 截断深度', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 7);
    expect(s).toContain('depth > 7');
  });

  it('节点数上限 2000 防爆', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('_count >= 2000');
  });

  it('maxDepth clamp 到 1-64,NaN/Infinity 回落默认 16(防生成 depth > NaN 非法 GD)', () => {
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, 0)).toContain('depth > 1');
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, 100)).toContain('depth > 64');
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, Number.NaN)).toContain('depth > 16');
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, Number.POSITIVE_INFINITY)).toContain('depth > 16');
  });
});
