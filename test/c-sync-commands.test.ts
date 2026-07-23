import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('C1 sync_commands _on_node_added/removed 用 _plugin', () => {
  const src = readFileSync('addons/godot_mcp_server/commands/sync_commands.gd', 'utf8');

  it('回调不绕路 _command_handler.get_plugin()', () => {
    expect(src).not.toContain('_command_handler.get_plugin()');
    expect(src).not.toContain('has_method("get_plugin")');
  });

  it('回调用 _plugin 取 edited_root', () => {
    // _on_node_added / _on_node_removed 两处均用 _plugin
    const cb1 = src.match(/func _on_node_added[\s\S]*?func _on_node_removed/)?.[0] ?? '';
    const cb2 = src.match(/func _on_node_removed[\s\S]*?\n\n/)?.[0] ?? '';
    expect(cb1).toContain('get_edited_scene_root(_plugin)');
    expect(cb2).toContain('get_edited_scene_root(_plugin)');
  });
});
