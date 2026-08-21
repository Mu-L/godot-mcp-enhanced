import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-3 (2026-08-08): debug 组 Phase 1 断点管理——editor-only 工具。
// 字面量契约测试:验证 TS 工具定义 + GD handler 注册 + editor-method-map + ROUTING 登记。

describe('CMP-3: debug 工具定义（TS 契约）', () => {
  it('CMP-3a: debug.ts 定义工具 name=debug + action enum(Phase 1 三个 + CMP-14 Phase 2/3 七个)', async () => {
    const mod = await import('../src/tools/debug.js');
    const defs = mod.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('debug');
    const schema = defs[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, { enum?: string[] }>;
    expect(props.action?.enum).toEqual([
      'set_breakpoint', 'clear_breakpoint', 'list_breakpoints',
      'stack_trace', 'inspect_frame', 'evaluate',
      'step', 'continue', 'pause', 'reload_scripts',
    ]);
  });

  it('CMP-3b: handleTool 在 headless 返回 EDITOR_ONLY(含 Phase 2/3 action)', async () => {
    const mod = await import('../src/tools/debug.js');
    for (const action of ['set_breakpoint', 'clear_breakpoint', 'list_breakpoints', 'stack_trace', 'step']) {
      const result = await mod.handleTool('debug', { action }, {} as never);
      expect(result?.isError).toBe(true);
      const text = result?.content?.[0]?.text ?? '';
      expect(text).toContain('EDITOR_ONLY');
    }
  });

  it('CMP-3c: TOOL_META 标 readonly=false(含 write action)+ long_running=true', async () => {
    const mod = await import('../src/tools/debug.js');
    // CMP-14 后含 step/continue/pause/reload(write),组级非纯只读
    expect(mod.TOOL_META.debug.readonly).toBe(false);
    expect(mod.TOOL_META.debug.long_running).toBe(true);
    // Phase 1 断点保持 read
    expect(mod.TOOL_META.debug.actionRisks?.set_breakpoint).toBe('read');
    expect(mod.TOOL_META.debug.actionRisks?.clear_breakpoint).toBe('read');
    expect(mod.TOOL_META.debug.actionRisks?.list_breakpoints).toBe('read');
  });

  it('CMP-3d: handleTool 拒绝未知 action', async () => {
    const mod = await import('../src/tools/debug.js');
    const result = await mod.handleTool('debug', { action: 'unknown' }, {} as never);
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toContain('INVALID_ACTION');
  });

  it('CMP-3e: handleTool 拒绝缺失 action', async () => {
    const mod = await import('../src/tools/debug.js');
    const result = await mod.handleTool('debug', {}, {} as never);
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toContain('INVALID_PARAMS');
  });
});

describe('CMP-3: debug 工具注册链路（源码字面量契约）', () => {
  it('CMP-3f: module-loader.ts 注册 debug 模块', () => {
    const src = readFileSync('src/module-loader.ts', 'utf8');
    expect(src.includes("import * as debug from"), 'module-loader 未 import debug').toBe(true);
    // ALL_MODULES 数组里含 debug 条目
    const allModStart = src.indexOf('const ALL_MODULES');
    const slice = src.slice(allModStart, allModStart + 1000);
    expect(/^\s+debug,/m.test(slice), 'ALL_MODULES 未含 debug 条目').toBe(true);
  });

  it('CMP-3g: editor-method-map.ts MAP 含 debug 族 + 3 action', () => {
    const src = readFileSync('src/core/editor-method-map.ts', 'utf8');
    const debugStart = src.indexOf('debug: {');
    expect(debugStart, 'editor-method-map MAP 未含 debug 族').toBeGreaterThan(-1);
    const slice = src.slice(debugStart, debugStart + 400);
    expect(slice.includes("'debug_set_breakpoint'"), 'MAP debug 族缺 debug_set_breakpoint method').toBe(true);
    expect(slice.includes("'debug_clear_breakpoint'"), 'MAP debug 族缺 debug_clear_breakpoint method').toBe(true);
    expect(slice.includes("'debug_list_breakpoints'"), 'MAP debug 族缺 debug_list_breakpoints method').toBe(true);
  });

  it('CMP-3h: static-grep.ts EDITOR_COMMAND_ROUTING 含 3 debug method', () => {
    const src = readFileSync('src/capability/static-grep.ts', 'utf8');
    expect(src.includes('debug_set_breakpoint:'), 'ROUTING 缺 debug_set_breakpoint').toBe(true);
    expect(src.includes('debug_clear_breakpoint:'), 'ROUTING 缺 debug_clear_breakpoint').toBe(true);
    expect(src.includes('debug_list_breakpoints:'), 'ROUTING 缺 debug_list_breakpoints').toBe(true);
    // 指向 debug_commands.gd
    expect(src.includes("'commands/debug_commands.gd'"), 'ROUTING debug method 未指向 commands/debug_commands.gd').toBe(true);
  });
});

describe('CMP-3: GD 侧 debug_commands.gd（源码字面量契约）', () => {
  it('CMP-3i: debug_commands.gd 含 3 handler + CodeEdit gutter 路径', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    expect(gd.includes('func handle_set_breakpoint'), '缺 handle_set_breakpoint').toBe(true);
    expect(gd.includes('func handle_clear_breakpoint'), '缺 handle_clear_breakpoint').toBe(true);
    expect(gd.includes('func handle_list_breakpoints'), '缺 handle_list_breakpoints').toBe(true);
    // 走 CodeEdit gutter(竞品验证可行路径)
    expect(gd.includes('set_line_as_breakpoint'), '缺 set_line_as_breakpoint(CodeEdit gutter 路径)').toBe(true);
    expect(gd.includes('is_line_breakpointed'), '缺 is_line_breakpointed(二次校验)').toBe(true);
    // 行号 1-based → 0-based 转换
    expect(gd.includes('line - 1'), '缺 1-based → 0-based 行号转换').toBe(true);
    // res:// 路径校验
    expect(gd.includes('begins_with("res://")'), '缺 res:// 路径校验').toBe(true);
  });

  it('CMP-3j: command_handler.gd 注册 debug_commands(成员+setup+cleanup+handle)', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    // 成员变量
    expect(gd.includes('var _debug_commands'), '缺 _debug_commands 成员变量').toBe(true);
    // setup preload
    expect(gd.includes('preload("commands/debug_commands.gd")'), '缺 debug_commands.gd preload').toBe(true);
    // cleanup modules 数组含 _debug_commands
    const cleanupStart = gd.indexOf('var modules = [');
    const cleanupSlice = gd.slice(cleanupStart, cleanupStart + 500);
    expect(cleanupSlice.includes('_debug_commands'), 'cleanup modules 数组缺 _debug_commands').toBe(true);
    // handle() match 含 3 case
    expect(gd.includes('"debug_set_breakpoint"'), 'handle() 缺 debug_set_breakpoint case').toBe(true);
    expect(gd.includes('"debug_clear_breakpoint"'), 'handle() 缺 debug_clear_breakpoint case').toBe(true);
    expect(gd.includes('"debug_list_breakpoints"'), 'handle() 缺 debug_list_breakpoints case').toBe(true);
  });
});
