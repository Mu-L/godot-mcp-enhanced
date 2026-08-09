import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'node:fs';

// CMP-16-C (2026-08-08): drift 检测 CI 脚本测试。
// 验证脚本实跑通过(当前应 0 drift)+ 脚本结构完整。

describe('CMP-16-C: check-command-docs-drift.mjs 脚本', () => {
  it('CMP-16C-a: 脚本实跑通过(全 57 method 覆盖,0 drift)', () => {
    // CMP-16-C 扩充后从一期 7 method(debug+engine)扩到全 57 method
    const output = execFileSync('node', ['scripts/check-command-docs-drift.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(output).toContain('[command-docs-drift] ✓');
    expect(output).toContain('method 已校验');
    // 扩充后覆盖全 57(53 校验 + 1 无工具 + 3 schema 简化豁免)
    expect(output).toContain('57 GD docs 总计');
    expect(output).toContain('0 未映射');
  });

  it('CMP-16C-b: 脚本含 method→tool 映射表(全 13 工具组)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('debug_set_breakpoint'), '映射表缺 debug_set_breakpoint').toBe(true);
    expect(src.includes('engine_call_method'), '映射表缺 engine_call_method(CMP-9-A)').toBe(true);
    expect(src.includes('asset_create'), '映射表缺 asset_create(扩充)').toBe(true);
    expect(src.includes('nav_create_region'), '映射表缺 nav_create_region(扩充)').toBe(true);
    expect(src.includes('animation_track'), '映射表缺 animation_track(扩充)').toBe(true);
    expect(src.includes('ui_create_control'), '映射表缺 ui_create_control(扩充)').toBe(true);
  });

  it('CMP-16C-c: 脚本含 ROUTING_PARAMS 豁免(action 路由参数)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('ROUTING_PARAMS'), '缺 ROUTING_PARAMS 豁免集合').toBe(true);
    expect(src.includes("'action'"), 'ROUTING_PARAMS 缺 action').toBe(true);
  });

  it('CMP-16C-d: 脚本含 GD docs 提取逻辑(doc_param 解析)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('extractGdDocs'), '缺 extractGdDocs 函数').toBe(true);
    expect(src.includes('doc_param'), '缺 doc_param 解析正则').toBe(true);
  });

  it('CMP-16C-e: 脚本含 TS inputSchema 提取逻辑(括号匹配版)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('extractTsSchemas'), '缺 extractTsSchemas 函数').toBe(true);
    expect(src.includes('extractBalancedBraces'), '缺括号匹配函数(正则抓不全 merged tool 嵌套)').toBe(true);
  });

  it('CMP-16C-f: 脚本含已知重命名 + schema 简化豁免', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    // KNOWN_RENAMES:ui_set_theme/theme_create 的 action 重命名为 theme_action(避免路由冲突)
    expect(src.includes('KNOWN_RENAMES'), '缺 KNOWN_RENAMES 豁免').toBe(true);
    expect(src.includes('theme_action'), 'KNOWN_RENAMES 缺 theme_action 重命名').toBe(true);
    // KNOWN_SCHEMA_SIMPLIFIED:validation 吸收 test-framework 但 inputSchema 未声明 assert 参数
    expect(src.includes('KNOWN_SCHEMA_SIMPLIFIED'), '缺 KNOWN_SCHEMA_SIMPLIFIED 豁免').toBe(true);
    expect(src.includes('test_assert'), 'KNOWN_SCHEMA_SIMPLIFIED 缺 test_assert').toBe(true);
  });

  it('CMP-16C-g: 脚本含 NO_TOOL_METHODS(editor_get_scene_stats 走直调非工具)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('NO_TOOL_METHODS'), '缺 NO_TOOL_METHODS').toBe(true);
    expect(src.includes('editor_get_scene_stats'), 'NO_TOOL_METHODS 缺 editor_get_scene_stats').toBe(true);
  });
});

describe('CMP-16-C: CI 接入', () => {
  it('CMP-16C-g: package.json 含 check:command-docs-drift script', () => {
    const pkg = readFileSync('package.json', 'utf8');
    expect(pkg.includes('check:command-docs-drift'), '缺 npm script').toBe(true);
  });

  it('CMP-16C-h: ci.yml 含 check:command-docs-drift 步骤', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci.includes('check:command-docs-drift'), 'CI 缺 drift 检测步骤').toBe(true);
    expect(ci.includes('CMP-16-C'), 'CI 步骤缺 CMP-16-C 标注').toBe(true);
  });
});
