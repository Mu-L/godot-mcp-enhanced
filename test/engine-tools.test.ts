import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-4 (2026-08-08): engine 组 实时 ClassDB 内省——editor-only 工具。
// 字面量契约测试:验证 TS 工具定义 + GD handler 注册 + editor-method-map + ROUTING 登记。

describe('CMP-4: engine 工具定义（TS 契约）', () => {
  it('CMP-4a: engine.ts 定义工具 name=engine + 3 action enum', async () => {
    const mod = await import('../src/tools/engine.js');
    const defs = mod.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('engine');
    const schema = defs[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, { enum?: string[] }>;
    expect(props.action?.enum).toEqual(['class_info', 'search', 'get_inheritance']);
  });

  it('CMP-4b: handleTool 在 headless 返回 EDITOR_ONLY', async () => {
    const mod = await import('../src/tools/engine.js');
    for (const action of ['class_info', 'search', 'get_inheritance']) {
      const result = await mod.handleTool('engine', { action }, {} as never);
      expect(result?.isError).toBe(true);
      expect(result?.content?.[0]?.text).toContain('EDITOR_ONLY');
    }
  });

  it('CMP-4c: TOOL_META 标 readonly + 3 action risk=read', async () => {
    const mod = await import('../src/tools/engine.js');
    expect(mod.TOOL_META.engine.readonly).toBe(true);
    expect(mod.TOOL_META.engine.actionRisks?.class_info).toBe('read');
    expect(mod.TOOL_META.engine.actionRisks?.search).toBe('read');
    expect(mod.TOOL_META.engine.actionRisks?.get_inheritance).toBe('read');
  });

  it('CMP-4d: handleTool 拒绝未知 action', async () => {
    const mod = await import('../src/tools/engine.js');
    const result = await mod.handleTool('engine', { action: 'unknown' }, {} as never);
    expect(result?.content?.[0]?.text).toContain('INVALID_ACTION');
  });
});

describe('CMP-4: engine 注册链路（源码字面量契约）', () => {
  it('CMP-4e: module-loader.ts 注册 engine 模块', () => {
    const src = readFileSync('src/core/module-loader.ts', 'utf8');
    expect(src.includes("import * as engine from"), 'module-loader 未 import engine').toBe(true);
    const allModStart = src.indexOf('const ALL_MODULES');
    const slice = src.slice(allModStart, allModStart + 1200);
    expect(/^\s+engine,/m.test(slice), 'ALL_MODULES 未含 engine 条目').toBe(true);
  });

  it('CMP-4f: editor-method-map.ts MAP 含 engine 族 + 3 action', () => {
    const src = readFileSync('src/core/editor-method-map.ts', 'utf8');
    const engineStart = src.indexOf('engine: {');
    expect(engineStart, 'editor-method-map MAP 未含 engine 族').toBeGreaterThan(-1);
    const slice = src.slice(engineStart, engineStart + 400);
    expect(slice.includes("'engine_class_info'"), 'MAP engine 族缺 engine_class_info method').toBe(true);
    expect(slice.includes("'engine_search'"), 'MAP engine 族缺 engine_search method').toBe(true);
    expect(slice.includes("'engine_get_inheritance'"), 'MAP engine 族缺 engine_get_inheritance method').toBe(true);
  });

  it('CMP-4g: static-grep.ts EDITOR_COMMAND_ROUTING 含 3 engine method', () => {
    const src = readFileSync('src/capability/static-grep.ts', 'utf8');
    expect(src.includes('engine_class_info:'), 'ROUTING 缺 engine_class_info').toBe(true);
    expect(src.includes('engine_search:'), 'ROUTING 缺 engine_search').toBe(true);
    expect(src.includes('engine_get_inheritance:'), 'ROUTING 缺 engine_get_inheritance').toBe(true);
    expect(src.includes("'commands/engine_commands.gd'"), 'ROUTING engine method 未指向 commands/engine_commands.gd').toBe(true);
  });
});

describe('CMP-4: GD 侧 engine_commands.gd（源码字面量契约）', () => {
  it('CMP-4h: engine_commands.gd 含 3 handler + ClassDB API', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    expect(gd.includes('func handle_class_info'), '缺 handle_class_info').toBe(true);
    expect(gd.includes('func handle_search'), '缺 handle_search').toBe(true);
    expect(gd.includes('func handle_get_inheritance'), '缺 handle_get_inheritance').toBe(true);
    // 直调 ClassDB API(不经沙箱)
    expect(gd.includes('ClassDB.class_get_property_list'), '缺 ClassDB.class_get_property_list').toBe(true);
    expect(gd.includes('ClassDB.class_get_method_list'), '缺 ClassDB.class_get_method_list').toBe(true);
    expect(gd.includes('ClassDB.get_class_list'), '缺 ClassDB.get_class_list').toBe(true);
    expect(gd.includes('ClassDB.get_parent_class'), '缺 ClassDB.get_parent_class').toBe(true);
    // search 上限(防全量返回过大)
    expect(gd.includes('SEARCH_LIMIT'), '缺 SEARCH_LIMIT 上限').toBe(true);
  });

  it('CMP-4i: command_handler.gd 注册 engine_commands(成员+setup+cleanup+handle)', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('var _engine_commands'), '缺 _engine_commands 成员变量').toBe(true);
    expect(gd.includes('preload("commands/engine_commands.gd")'), '缺 engine_commands.gd preload').toBe(true);
    const cleanupStart = gd.indexOf('var modules = [');
    const cleanupSlice = gd.slice(cleanupStart, cleanupStart + 500);
    expect(cleanupSlice.includes('_engine_commands'), 'cleanup modules 数组缺 _engine_commands').toBe(true);
    expect(gd.includes('"engine_class_info"'), 'handle() 缺 engine_class_info case').toBe(true);
    expect(gd.includes('"engine_search"'), 'handle() 缺 engine_search case').toBe(true);
    expect(gd.includes('"engine_get_inheritance"'), 'handle() 缺 engine_get_inheritance case').toBe(true);
  });

  it('CMP-4j (B-2): _type_name 映射含 Projection(19) + PackedVector4Array(38) 防 off-by-two', () => {
    // B-2 第三方审查:原表漏 Projection(19) 致 19+ 全部错位。验证关键字映射值。
    const gd = readFileSync('addons/godot_mcp_server/commands/engine_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func _type_name');
    const slice = gd.slice(fnStart, fnStart + 2000);
    // Projection(19) 必须存在(原 bug 漏了这个)
    expect(/19:\s*return "Projection"/.test(slice), '_type_name 缺 Projection(19) 映射（B-2 off-by-two 根因）').toBe(true);
    // Color(20) 在 Projection 之后
    expect(/20:\s*return "Color"/.test(slice), '_type_name 映射 Color 不是 20（B-2 错位残留）').toBe(true);
    // PackedVector4Array(38) 必须存在
    expect(/38:\s*return "PackedVector4Array"/.test(slice), '_type_name 缺 PackedVector4Array(38)').toBe(true);
    // PackedColorArray(37) 在 PackedVector4Array 之前
    expect(/37:\s*return "PackedColorArray"/.test(slice), '_type_name 映射 PackedColorArray 不是 37').toBe(true);
  });
});
