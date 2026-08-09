import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-14 (2026-08-09): debug Phase 2/3 — 桩阶段契约测试。
// 验证基础设施(async 路由 + debugger_bridge + plugin 注册)落位。
// 运行时行为(栈帧/变量/step)需 editor 实测,这里验证源码签约 + async 分流。

describe('CMP-14-A: debugger_bridge.gd(EditorDebuggerPlugin 子类)', () => {
  it('CMP-14a: debugger_bridge.gd extends EditorDebuggerPlugin', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    expect(gd.includes('extends EditorDebuggerPlugin'), '缺 extends EditorDebuggerPlugin').toBe(true);
  });

  it('CMP-14b: 重写 _setup_session + _has_capture + _capture 虚方法', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    expect(gd.includes('func _setup_session'), '缺 _setup_session 重写').toBe(true);
    expect(gd.includes('func _has_capture'), '缺 _has_capture 重写').toBe(true);
    expect(gd.includes('func _capture'), '缺 _capture 重写').toBe(true);
  });

  it('CMP-14c: _capture 处理 stack_dump/stack_frame_vars/stack_frame_var/evaluation_return', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    const captureStart = gd.indexOf('func _capture');
    const slice = gd.slice(captureStart, captureStart + 2000);
    expect(slice.includes('"stack_dump"'), '_capture 缺 stack_dump 处理').toBe(true);
    expect(slice.includes('"stack_frame_vars"'), '_capture 缺 stack_frame_vars 处理').toBe(true);
    expect(slice.includes('"stack_frame_var"'), '_capture 缺 stack_frame_var 处理').toBe(true);
    expect(slice.includes('"evaluation_return"'), '_capture 缺 evaluation_return 处理').toBe(true);
  });

  it('CMP-14d: 含 settle + await_new_break + press + select_frame 核心方法', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    expect(gd.includes('func settle'), '缺 settle(轮询等栈落地)').toBe(true);
    expect(gd.includes('func await_new_break'), '缺 await_new_break(step 后等新断点)').toBe(true);
    expect(gd.includes('func press'), '缺 press(按图标找按钮)').toBe(true);
    expect(gd.includes('func select_frame'), '缺 select_frame(切栈帧)').toBe(true);
  });

  it('CMP-14e: 超时常量 SETTLE_MS/STEP_WAIT_MS/RESUME_WATCH_MS 存在', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    expect(gd.includes('SETTLE_MS'), '缺 SETTLE_MS').toBe(true);
    expect(gd.includes('STEP_WAIT_MS'), '缺 STEP_WAIT_MS').toBe(true);
    expect(gd.includes('RESUME_WATCH_MS'), '缺 RESUME_WATCH_MS').toBe(true);
  });

  it('CMP-14f: ICON_NAMES 含 resume/pause/over/into 按钮图标映射', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    expect(gd.includes('"resume": "DebugContinue"'), 'ICON_NAMES 缺 resume').toBe(true);
    expect(gd.includes('"pause": "Pause"'), 'ICON_NAMES 缺 pause').toBe(true);
    expect(gd.includes('"over": "DebugNext"'), 'ICON_NAMES 缺 over').toBe(true);
    expect(gd.includes('"into": "DebugStep"'), 'ICON_NAMES 缺 into').toBe(true);
  });

  it('CMP-14g: press 走按钮 emit pressed(非 send_message),注释说明原因', () => {
    const gd = readFileSync('addons/godot_mcp_server/debug/debugger_bridge.gd', 'utf8');
    expect(gd.includes('emit_signal("pressed")'), 'press 缺 emit pressed').toBe(true);
    // 注释应说明为何不用 send_message("step")(thread id 设不了)
    expect(gd.includes('thread') || gd.includes('send_message'), 'press 缺 thread id 限制说明').toBe(true);
  });
});

describe('CMP-14-A: plugin.gd 注册 debugger_bridge', () => {
  it('CMP-14h: plugin.gd 含 add_debugger_plugin + _debugger_bridge 字段', () => {
    const gd = readFileSync('addons/godot_mcp_server/plugin.gd', 'utf8');
    expect(gd.includes('var _debugger_bridge'), '缺 _debugger_bridge 字段').toBe(true);
    expect(gd.includes('add_debugger_plugin'), '缺 add_debugger_plugin 注册').toBe(true);
    expect(gd.includes('remove_debugger_plugin'), '缺 remove_debugger_plugin 注销').toBe(true);
    expect(gd.includes('debug/debugger_bridge.gd'), '缺 debugger_bridge.gd preload').toBe(true);
  });
});

describe('CMP-14-B: handle_debug_async 路由', () => {
  it('CMP-14i: command_handler.gd 含 handle_debug_async + 7 method 分发', () => {
    const gd = readFileSync('addons/godot_mcp_server/command_handler.gd', 'utf8');
    expect(gd.includes('func handle_debug_async'), '缺 handle_debug_async 函数').toBe(true);
    expect(gd.includes('"debug_stack_trace"'), '缺 debug_stack_trace 分发').toBe(true);
    expect(gd.includes('"debug_inspect_frame"'), '缺 debug_inspect_frame 分发').toBe(true);
    expect(gd.includes('"debug_evaluate"'), '缺 debug_evaluate 分发').toBe(true);
    expect(gd.includes('"debug_step"'), '缺 debug_step 分发').toBe(true);
    expect(gd.includes('"debug_continue"'), '缺 debug_continue 分发').toBe(true);
    expect(gd.includes('"debug_pause"'), '缺 debug_pause 分发').toBe(true);
    expect(gd.includes('"debug_reload_scripts"'), '缺 debug_reload_scripts 分发').toBe(true);
  });

  it('CMP-14j: websocket_server.gd 含 debug_ 前缀分流(排除 Phase 1 同步断点)', () => {
    const gd = readFileSync('addons/godot_mcp_server/websocket_server.gd', 'utf8');
    expect(gd.includes('begins_with("debug_")'), '缺 debug_ 前缀分流').toBe(true);
    // Phase 1 三个同步断点 method 必须排除(它们保持同步)
    expect(gd.includes('debug_set_breakpoint'), '缺 Phase 1 排除项 debug_set_breakpoint').toBe(true);
    expect(gd.includes('debug_clear_breakpoint'), '缺 Phase 1 排除项 debug_clear_breakpoint').toBe(true);
    expect(gd.includes('debug_list_breakpoints'), '缺 Phase 1 排除项 debug_list_breakpoints').toBe(true);
    // 分流到 handle_debug_async
    expect(gd.includes('handle_debug_async'), '缺 handle_debug_async 调用').toBe(true);
  });

  it('CMP-14k: debug_commands.gd 含 7 个 handler 实现 + _ensure_bridge 守卫', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    expect(gd.includes('func _ensure_bridge'), '缺 _ensure_bridge 守卫').toBe(true);
    expect(gd.includes('func handle_stack_trace'), '缺 handle_stack_trace').toBe(true);
    expect(gd.includes('func handle_inspect_frame'), '缺 handle_inspect_frame').toBe(true);
    expect(gd.includes('func handle_evaluate'), '缺 handle_evaluate').toBe(true);
    expect(gd.includes('func handle_step'), '缺 handle_step').toBe(true);
    expect(gd.includes('func handle_continue'), '缺 handle_continue').toBe(true);
    expect(gd.includes('func handle_pause'), '缺 handle_pause').toBe(true);
    expect(gd.includes('func handle_reload_scripts'), '缺 handle_reload_scripts').toBe(true);
  });

  it('CMP-14l: debug_commands.gd 桩已填实现(无 not yet implemented 残留)', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    // 桩应已填实现,无 "not yet implemented" 残留
    expect(gd.includes('not yet implemented'), '仍有 not yet implemented 桩残留').toBe(false);
  });

  it('CMP-14l2: _ensure_bridge 动态取 bridge(非 setup 时缓存)— 修时序 bug', () => {
    // 关键:plugin.gd _enter_tree 时序——websocket_server(setup 链)先于 add_debugger_plugin,
    // 若 setup 时缓存 _bridge 必为 null。必须每次调用时动态取。
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    // _ensure_bridge 应含动态取逻辑(plugin.get("_debugger_bridge"))
    const fnStart = gd.indexOf('func _ensure_bridge');
    const slice = gd.slice(fnStart, fnStart + 800);
    expect(slice.includes('_plugin.get("_debugger_bridge")'), '_ensure_bridge 缺动态取 bridge(时序 bug 根因)').toBe(true);
    // setup 不应缓存 _bridge(注释说明时序)
    const setupStart = gd.indexOf('func setup');
    const setupSlice = gd.slice(setupStart, setupStart + 200);
    expect(!setupSlice.includes('_bridge ='), 'setup 仍缓存 _bridge(时序 bug 未修)').toBe(true);
  });
});

describe('CMP-14: Phase 2/3 实现逻辑(源码签约)', () => {
  it('CMP-14m: handle_stack_trace 调 current_break + settle + synced_selection', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_stack_trace');
    const slice = gd.slice(fnStart, fnStart + 2500);
    expect(slice.includes('current_break'), 'stack_trace 缺 current_break 调用').toBe(true);
    expect(slice.includes('settle'), 'stack_trace 缺 settle 调用').toBe(true);
    expect(slice.includes('synced_selection'), 'stack_trace 缺 synced_selection').toBe(true);
    // 变量截断/过滤
    expect(slice.includes('all_vars'), 'stack_trace 缺 all_vars 参数').toBe(true);
    expect(slice.includes('filter'), 'stack_trace 缺 filter 参数').toBe(true);
  });

  it('CMP-14n: handle_step 走 bridge.press(mode) + await_new_break(非 send_message)', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_step');
    const slice = gd.slice(fnStart, fnStart + 2500);
    // step 必须走 press(按钮 emit pressed),不能 send_message("step")
    expect(slice.includes('bridge.call("press"'), 'step 缺 bridge.press 调用').toBe(true);
    expect(slice.includes('await_new_break'), 'step 缺 await_new_break').toBe(true);
    // is_breaked 前置检查(未暂停返错)
    expect(slice.includes('not paused') || slice.includes('nothing to step'), 'step 缺未暂停守卫').toBe(true);
  });

  it('CMP-14o: handle_reload_scripts 含 4 道安全守卫', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func handle_reload_scripts');
    const slice = gd.slice(fnStart, fnStart + 3500);
    // 守卫 1:is_playing_scene
    expect(slice.includes('is_playing_scene'), 'reload 缺 is_playing_scene 守卫').toBe(true);
    // 守卫 2:active_sessions
    expect(slice.includes('active_sessions'), 'reload 缺 active_sessions 守卫').toBe(true);
    // 守卫 3:暂停态拒绝
    expect(slice.includes('queue unheard'), 'reload 缺暂停态拒绝守卫').toBe(true);
    // 守卫 4:拒绝重载 MCP 自身 addon
    expect(slice.includes('addons/godot_mcp_server'), 'reload 缺 MCP 自身保护').toBe(true);
    // update_file 先同步 FS
    expect(slice.includes('update_file'), 'reload 缺 update_file(先同步 FS)').toBe(true);
    // caveats 返回
    expect(slice.includes('caveats'), 'reload 缺 caveats 告诫').toBe(true);
  });

  it('CMP-14p: _toggle_breakpoint 含自动打开脚本(edit_script)', () => {
    const gd = readFileSync('addons/godot_mcp_server/commands/debug_commands.gd', 'utf8');
    const fnStart = gd.indexOf('func _toggle_breakpoint');
    const slice = gd.slice(fnStart, fnStart + 1500);
    expect(slice.includes('edit_script'), '_toggle_breakpoint 缺 edit_script(自动打开脚本)').toBe(true);
  });
});

describe('CMP-14: debug.ts 工具层(Phase 2/3)', () => {
  it('CMP-14q: debug.ts ACTIONS 含 10 个 action(Phase 1 + Phase 2/3)', async () => {
    const mod = await import('../src/tools/debug.js');
    const defs = mod.getToolDefinitions();
    const schema = defs[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, { enum?: string[] }>;
    expect(props.action?.enum).toEqual([
      'set_breakpoint', 'clear_breakpoint', 'list_breakpoints',
      'stack_trace', 'inspect_frame', 'evaluate',
      'step', 'continue', 'pause', 'reload_scripts',
    ]);
  });

  it('CMP-14r: debug.ts TOOL_META 含 Phase 2/3 actionRisks(write 类)', async () => {
    const mod = await import('../src/tools/debug.js');
    const risks = mod.TOOL_META.debug.actionRisks!;
    expect(risks.step).toBe('write');
    expect(risks.continue).toBe('write');
    expect(risks.pause).toBe('write');
    expect(risks.reload_scripts).toBe('write');
    expect(risks.stack_trace).toBe('read');
    expect(risks.evaluate).toBe('read');
  });

  it('CMP-14s: debug.ts readonly=false(含 write action)+ long_running=true', async () => {
    const mod = await import('../src/tools/debug.js');
    expect(mod.TOOL_META.debug.readonly).toBe(false);
    expect(mod.TOOL_META.debug.long_running).toBe(true);
  });

  it('CMP-14t: inputSchema 含 frame_index/expression/mode/paths/all_vars/filter 字段', async () => {
    const mod = await import('../src/tools/debug.js');
    const defs = mod.getToolDefinitions();
    const props = (defs[0].inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(props).toHaveProperty('frame_index');
    expect(props).toHaveProperty('expression');
    expect(props).toHaveProperty('mode');
    expect(props).toHaveProperty('paths');
    expect(props).toHaveProperty('all_vars');
    expect(props).toHaveProperty('filter');
  });
});
