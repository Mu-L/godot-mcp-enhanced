import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// 批次 C Task 4：C13 ui set_params key 校验 + load null 守卫；C5 path_generator strip root/
// 字面量契约（对齐批次 B/C TDD 风格：读 .gd 源码断言修复标记）。
describe('C13/C5 参数校验', () => {
  it('C13 ui set_params 校验 Theme 有效属性（_theme_has_property 守卫 theme.set）', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/ui_commands.gd', 'utf8');
    // helper 定义存在
    expect(src).toContain('func _theme_has_property');
    // set_params case 内 theme.set 前校验（match action 的 case 块）
    const setParams = src.match(/"set_params":[\s\S]*?\n\t\t"save":/)?.[0] ?? '';
    expect(setParams.length, 'set_params case 未找到').toBeGreaterThan(0);
    expect(setParams).toContain('_theme_has_property');
    expect(setParams).toContain('theme.set(');
  });

  it('C13 default_font load null 守卫（非直接 load 传入 set_default_font）', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/ui_commands.gd', 'utf8');
    const fontCase = src.match(/"default_font":[\s\S]*?\n\t\t"color":/)?.[0] ?? '';
    expect(fontCase.length, 'default_font case 未找到').toBeGreaterThan(0);
    // load 结果先存变量再 null 守卫，不再直接 set_default_font(load(...))
    expect(fontCase).toMatch(/=\s*load\(/);
    expect(fontCase).toMatch(/==\s*null/);
    expect(fontCase).not.toMatch(/set_default_font\(load\(/);
  });

  it('C13 stylebox load null 守卫（非直接 load 传入 set_stylebox）', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/ui_commands.gd', 'utf8');
    const sbCase = src.match(/"stylebox":[\s\S]*?\n\t\t_:/)?.[0] ?? '';
    expect(sbCase.length, 'stylebox case 未找到').toBeGreaterThan(0);
    expect(sbCase).toMatch(/=\s*load\(/);
    expect(sbCase).toMatch(/==\s*null/);
    expect(sbCase).not.toMatch(/set_stylebox\([^)]*,\s*[^,]*load\(/);
  });

  it('C5 path_generator resolve_points strip "root/" 前缀', () => {
    const src = readFileSync('addons/godot_mcp_server/commands/asset/path_generator.gd', 'utf8');
    const resolve = src.match(/static func resolve_points[\s\S]*?\nstatic func /)?.[0] ?? '';
    expect(resolve.length, 'resolve_points 未找到').toBeGreaterThan(0);
    // strip "root/" 前缀，或改用 CommandHelpers.find_node
    expect(resolve).toMatch(/begins_with\("root\/"\)|CommandHelpers\.find_node/);
  });
});
