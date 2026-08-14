/**
 * 2026-08-11 审查 open findings 批次(2026-08-14 落地):GD 侧修复源码级契约。
 *
 * 覆盖(对应审查 finding,行为正确性靠 check:gdscript 完整编译 + 本文件防重构回退):
 *   A2 websocket_server debug in-flight 互斥(_states 串台)
 *   A3 engine_commands deny-list env 追加语义(∪ 默认表)
 *   A4 debugger_bridge resolve_session + debug_commands 数据三件套接线
 *   A5 mcp_bridge EXTRA_METHODS_BLOCKLIST 补 call_deferred/call_threadsafe/queue_delete
 *   B1 debugger_bridge dispose/_connect_tracked + plugin.gd _exit_tree free
 *   B2 debugger_bridge _panel_duplicate 去重守卫
 *   B3 instance_registry 删除验 pid + tmp pid 后缀
 *   B4 mcp_bridge _jsonify Object 分支(editor 侧对称)
 *   B5 node_commands batch_add_nodes added 真实入树计数
 *
 * 测试模式(对齐 gd-secret-symlink-guard.test.ts):stripComments 后断言关键词存在。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function src(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8');
}

const WS = src('addons/godot_mcp_server/websocket_server.gd');
const ENGINE = src('addons/godot_mcp_server/commands/engine_commands.gd');
const DEBUG_CMD = src('addons/godot_mcp_server/commands/debug_commands.gd');
const BRIDGE_GD = src('addons/godot_mcp_server/debug/debugger_bridge.gd');
const BRIDGE_SCRIPT = src('src/scripts/mcp_bridge.gd');
const PLUGIN = src('addons/godot_mcp_server/plugin.gd');
const REGISTRY = src('addons/godot_mcp_server/instance_registry.gd');
const NODE_CMD = src('addons/godot_mcp_server/commands/node_commands.gd');

/** GDScript 注释剥离(对齐既有契约测试;保留代码骨架供关键词断言) */
function stripComments(gdSource: string): string {
  return gdSource
    .split('\n')
    .map(line => {
      const idx = line.indexOf('#');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

const WS_CODE = stripComments(WS);
const ENGINE_CODE = stripComments(ENGINE);
const DEBUG_CMD_CODE = stripComments(DEBUG_CMD);
const BRIDGE_CODE = stripComments(BRIDGE_GD);
const PLUGIN_CODE = stripComments(PLUGIN);
const REGISTRY_CODE = stripComments(REGISTRY);
const NODE_CMD_CODE = stripComments(NODE_CMD);
const BRIDGE_SCRIPT_CODE = stripComments(BRIDGE_SCRIPT);

describe('A2: websocket_server debug in-flight 互斥(_states 串台)', () => {
  it('debug 分支有 in-flight 互斥 + stale 自愈', () => {
    expect(WS_CODE).toContain('_debug_in_flight');
    expect(WS_CODE).toContain('DEBUG_IN_FLIGHT_STALE_MS');
    // 互斥命中时立即拒绝(返回 error 而非排队)
    expect(WS_CODE).toMatch(/_debug_in_flight and Time\.get_ticks_msec\(\) - _debug_in_flight_since < DEBUG_IN_FLIGHT_STALE_MS/);
    // coroutine 恢复后立即释放(在 peer 守卫之前)
    expect(WS_CODE).toMatch(/response = await _command_handler\.handle_debug_async[\s\S]*?_debug_in_flight = false/);
  });
});

describe('A3: engine_commands deny-list env 追加语义', () => {
  it('_resolve_call_denylist 以默认表为基础追加(env ∪ DEFAULT)', () => {
    // 修复前:env 非空 → PackedStringArray() 从空表开始(完全替换,丢默认防护)
    expect(ENGINE_CODE).toContain('var result: PackedStringArray = PackedStringArray(DEFAULT_CALL_DENYLIST)');
    expect(ENGINE_CODE).toMatch(/if trimmed != "" and not result\.has\(trimmed\):/);
    // 显式空串 = 完全放开逃生口(保留)
    expect(ENGINE_CODE).toMatch(/if env_val == "" and OS\.has_environment\("GODOT_MCP_EDITOR_CALL_DENYLIST_OVERRIDE"\):[\s\S]*?return PackedStringArray\(\)/);
  });
});

describe('A4: debugger_bridge resolve_session + debug_commands 接线', () => {
  it('bridge 提供 resolve_session(单 session 语义,多 session 报错)', () => {
    expect(BRIDGE_CODE).toContain('func resolve_session() -> Dictionary:');
    expect(BRIDGE_CODE).toMatch(/ids\.size\(\) > 1:/);
    expect(BRIDGE_CODE).toContain('Multi-session debugging is not supported');
  });
  it('数据读取三件套经 resolve_session(不再 current_break + active_sessions[0] 错配)', () => {
    const count = (DEBUG_CMD_CODE.match(/bridge\.call\("resolve_session"\)/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);  // stack_trace / inspect_frame / evaluate
    // evaluate 不再用 active_sessions()[0] 取 session
    expect(DEBUG_CMD_CODE).not.toMatch(/active_sessions[\s\S]{0,120}sessions\[0\]\[1\]/);
  });
});

describe('A5: bridge EXTRA_METHODS_BLOCKLIST 补间接调用入口', () => {
  it('BLOCKLIST 含 call_deferred/call_threadsafe/queue_delete', () => {
    const blockMatch = BRIDGE_SCRIPT_CODE.match(/const EXTRA_METHODS_BLOCKLIST := \[([\s\S]*?)\]/);
    expect(blockMatch, 'EXTRA_METHODS_BLOCKLIST 块未找到').toBeTruthy();
    const body = blockMatch![1]!;
    for (const m of ['call_deferred', 'call_threadsafe', 'queue_delete']) {
      expect(body).toContain(`"${m}"`);
    }
  });
});

describe('B1: debugger_bridge Object 生命周期(dispose + free)', () => {
  it('bridge 记录全部信号连接并提供 dispose', () => {
    expect(BRIDGE_CODE).toContain('func _connect_tracked(');
    expect(BRIDGE_CODE).toContain('_connections.append(');
    expect(BRIDGE_CODE).toContain('func dispose() -> void:');
    expect(BRIDGE_CODE).toMatch(/source\.disconnect\(c\["sig"\], c\["cb"\]\)/);
  });
  it('plugin.gd _exit_tree 在 remove 后 dispose(断信号;RefCounted 引用归零自动释放,禁 free)', () => {
    expect(PLUGIN_CODE).toMatch(/remove_debugger_plugin\(_debugger_bridge\)[\s\S]*?call\("dispose"\)/);
    // RefCounted 上 free() 运行时报 "Attempted to free a RefCounted object"(check:gdscript 实测)
    expect(PLUGIN_CODE).not.toContain('_debugger_bridge.free()');
  });
  it('面板/会话信号经 _connect_tracked 登记(不再裸 connect)', () => {
    // ensure_connected 与 _setup_session 均走 tracked 路径
    const trackedCalls = (BRIDGE_CODE.match(/_connect_tracked\(/g) ?? []).length;
    expect(trackedCalls).toBeGreaterThanOrEqual(6);  // 3 session 信号 + 3 面板信号
    // _setup_session 内不允许残留裸 session.connect
    const setupMatch = BRIDGE_CODE.match(/func _setup_session[\s\S]*?\n\n/);
    expect(setupMatch).toBeTruthy();
    expect(setupMatch![0]).not.toMatch(/\bsession\.connect\(/);
  });
});

describe('B2: _capture 与面板信号双重消费去重', () => {
  it('capture 侧计数 + 面板侧守卫', () => {
    expect(BRIDGE_CODE).toContain('_cap_counts');
    expect(BRIDGE_CODE).toContain('_panel_counts');
    expect(BRIDGE_CODE).toContain('func _panel_duplicate(');
    // 三个面板回调均经守卫
    const guardCount = (BRIDGE_CODE.match(/if _panel_duplicate\(/g) ?? []).length;
    expect(guardCount).toBe(3);
  });
});

describe('B3: instance_registry pid 校验 + tmp 隔离', () => {
  it('删除前验 pid(非自己持有的文件不删)', () => {
    expect(REGISTRY_CODE).toContain('file_pid != OS.get_process_id()');
    expect(REGISTRY_CODE).toMatch(/DirAccess\.remove_absolute\(_instance_file\)/);
  });
  it('tmp 文件带 pid 后缀(多实例交错写隔离)', () => {
    expect(REGISTRY_CODE).toMatch(/\.\%d\.tmp" % OS\.get_process_id\(\)/);
    expect(REGISTRY_CODE).not.toContain('_instance_file + ".tmp"');
  });
});

describe('B4: mcp_bridge _jsonify Object 分支(editor 侧对称)', () => {
  it('_jsonify 在 Resource/Node 之后处理裸 Object', () => {
    const fn = BRIDGE_SCRIPT_CODE.match(/func _jsonify[\s\S]*?\n\treturn val\n/);
    expect(fn, '_jsonify 函数体未找到').toBeTruthy();
    const body = fn![0]!;
    expect(body).toMatch(/if val is Resource:/);
    expect(body).toMatch(/if val is Node:/);
    expect(body).toMatch(/if val is Object:\s*\n\s*return \{"type": val\.get_class\(\), "instance_id": val\.get_instance_id\(\)\}/);
  });
});

describe('B5: batch_add_nodes added 真实入树计数', () => {
  it('added 基于 is_inside_tree 计数(非 validated.size() 乐观陈述)', () => {
    expect(NODE_CMD_CODE).toMatch(/var added := 0/);
    expect(NODE_CMD_CODE).toMatch(/elif cls != null and is_instance_valid\(cls\):\s*\n\s*added \+= 1/);
    expect(NODE_CMD_CODE).toMatch(/"added": added,/);
    expect(NODE_CMD_CODE).not.toMatch(/"added": validated\.size\(\)/);
  });
});
