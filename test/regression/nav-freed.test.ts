import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('N1: nav freed 对象访问修复', () => {
  it('N1: freed branch does not access nav.bake_finished (freed object)', () => {
    const gd = readFileSync(join(__dirname, '../../addons/godot_mcp_server/commands/nav_commands.gd'), 'utf-8');
    // 定位两处 freed 分支（create_region + bake_mesh async）
    const branches = gd.match(/if not is_instance_valid\(nav\):[\s\S]{0,200}?return \{"error"/g);
    expect(branches?.length, '两个 freed 分支').toBe(2);
    // 反向：freed 分支内不得访问 nav.bake_finished（信号随对象释放自动断开）
    for (const b of branches!) {
      expect(b).not.toMatch(/nav\.bake_finished/);
    }
  });
});
