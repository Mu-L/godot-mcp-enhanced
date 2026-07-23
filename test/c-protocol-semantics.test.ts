import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('C3/C4/C9 协议返回值语义', () => {
  it('C3 websocket params:null 被 reject（守卫含 == null）', () => {
    const src = readFileSync('addons/godot_mcp_server/websocket_server.gd', 'utf8');
    const guard = src.match(/var _rpc_params[\s\S]*?return/)?.[0] ?? '';
    expect(guard).toMatch(/_rpc_params == null|_rpc_params is Dictionary/);
    expect(guard).not.toMatch(/_rpc_params != null and not/); // 旧 and 短路已删
  });

  it('C4 nav bake_result 查 vertices（非仅 != null）', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/nav_commands.gd', 'utf8');
    expect(src).toContain('get_vertices_count()');
    expect(src).toMatch(/await.*bake_navigation_mesh/);
  });

  it('C9 command_helpers 有 values_equal + test_commands 改调', () => {
    expect(readFileSync('addons/godot_mcp_server/commands/command_helpers.gd', 'utf8')).toContain('func values_equal');
    expect(readFileSync('addons/godot_mcp_server/commands/test_commands.gd', 'utf8')).toContain('values_equal(');
  });
});
