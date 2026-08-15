/**
 * 批 I (2026-08-14 审查,2026-08-15 落地): GD server 杂项与可疑项源码级契约。
 *
 * 覆盖(行为正确性靠 check:gdscript 完整编译 + 本文件防重构回退):
 *   I-1 debug_reload_scripts 改 resolve_session()(多 session 明确拒绝)
 *   I-2 debug set/clear breakpoint 补 ".." 穿越校验(对齐 reload 的 P2-5)
 *   I-3 undo_manager _add_method 注册期 args freed-Object 防御
 *   I-4 websocket_server debug 协程 script-error watchdog(_await_with_watchdog)
 *   I-5 websocket_server STATE_CONNECTING 握手超时 + mcp_bridge 无 CONNECTING 态评估注释
 *
 * 测试模式(对齐 gd-open-findings-contract.test.ts):stripComments 后断言关键词/结构。
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

const DEBUG_CMD = src('addons/godot_mcp_server/commands/debug_commands.gd');
const UNDO = src('addons/godot_mcp_server/undo_manager.gd');
const WS_RAW = src('addons/godot_mcp_server/websocket_server.gd');
const BRIDGE_SCRIPT_RAW = src('src/scripts/mcp_bridge.gd');

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

const DEBUG_CMD_CODE = stripComments(DEBUG_CMD);
const UNDO_CODE = stripComments(UNDO);
const WS_CODE = stripComments(WS_RAW);

/** 截取 func 到下一个顶级 func 的函数体(stripComments 后) */
function funcBody(code: string, funcDecl: string): string {
  const start = code.indexOf(funcDecl);
  expect(start, `函数 ${funcDecl} 未找到`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf('\nfunc ', start + 1);
  return code.slice(start, end === -1 ? undefined : end);
}

describe('I-1: debug_reload_scripts 改 resolve_session()', () => {
  it('数据四件套(含 reload)均经 resolve_session,不再 active_sessions()[0]', () => {
    const count = (DEBUG_CMD_CODE.match(/bridge\.call\("resolve_session"\)/g) ?? []).length;
    // stack_trace / inspect_frame / evaluate(原三件套) + reload_scripts(I-1)
    expect(count).toBeGreaterThanOrEqual(4);
    // reload 不再用 sessions[0][1] 静默取第一个
    expect(DEBUG_CMD_CODE).not.toMatch(/sessions\[0\]\[1\]/);
  });
  it('handle_reload_scripts: Multiple 拒绝透传 + session 与 state 同源', () => {
    const body = funcBody(DEBUG_CMD_CODE, 'func handle_reload_scripts');
    expect(body).toContain('bridge.call("resolve_session")');
    // 多 session 明确拒绝(返回错误,非静默选第一个)
    expect(body).toMatch(/begins_with\("Multiple"\)/);
    expect(body).toContain('return {"error": rs_err}');
    // session 取自 resolve_session 结果(与 state 同源,消除归属错配)
    expect(body).toMatch(/var session: EditorDebuggerSession = rs\["session"\]/);
    // 暂停态拒绝改用同源 state(原 current_break 第一个 breaked)
    expect(body).toMatch(/rs\["state"\]\.get\("breaked", false\)/);
    expect(body).not.toContain('current_break');
  });
});

describe('I-2: set/clear breakpoint 补 ".." 穿越校验', () => {
  it('set/clear 两 handler 均含 contains("..") 拒绝(reload 同款)', () => {
    const setBody = funcBody(DEBUG_CMD_CODE, 'func handle_set_breakpoint');
    const clearBody = funcBody(DEBUG_CMD_CODE, 'func handle_clear_breakpoint');
    for (const body of [setBody, clearBody]) {
      expect(body).toMatch(/begins_with\("res:\/\/"\)/);
      expect(body).toMatch(/path\.contains\("\.\."\)/);
      // 错误信息与 reload 的 P2-5 同款(可 grep 的固定措辞)
      expect(body).toContain("Path must not contain '..' (path traversal blocked)");
    }
  });
  it('全文件代码级 contains("..") 守卫共 3 处(set/clear/reload)', () => {
    const count = (DEBUG_CMD_CODE.match(/contains\("\.\."\)/g) ?? []).length;
    expect(count).toBe(3);
  });
});

describe('I-3: undo_manager _add_method 注册期 freed-Object 防御', () => {
  it('callv 前对 args 中 freed Object push_warning + 跳过该 op', () => {
    const body = funcBody(UNDO_CODE, 'func _add_method');
    // 检测必须用 typeof(freed 实例上求值 `is` 本身即 SCRIPT ERROR,headless probe 实证):
    // typeof==TYPE_OBJECT 对 freed/live Object 均 true,is_instance_valid 仅 live 为 true,
    // 非 Object(int/String/null)typeof 均 false → 守卫只命中 freed。
    expect(body).toMatch(/if typeof\(arg\) == TYPE_OBJECT and not is_instance_valid\(arg\):/);
    // 跳过的是单个 op(不中断整个 action 注册)
    expect(body).toMatch(/push_warning\(\s*"undo_manager: freed Object arg/);
    // 防御检查位于 callv 注册之前
    const guardIdx = body.indexOf('freed Object arg');
    const callvIdx = body.indexOf('undo_redo.callv(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(callvIdx).toBeGreaterThan(guardIdx);
  });
});

describe('I-4: websocket_server debug 协程 script-error watchdog', () => {
  it('_await_with_watchdog + _fill_response_box fire-and-forget box 模式', () => {
    expect(WS_CODE).toContain('func _await_with_watchdog(');
    expect(WS_CODE).toContain('func _fill_response_box(');
    expect(WS_CODE).toContain('const DEBUG_ASYNC_WATCHDOG_MS := 10000');
    // watchdog 超时返 error(而非永不返回)——client 不再干等 30s 超时
    expect(WS_CODE).toMatch(/_await_with_watchdog[\s\S]*?code": -32008/);
    // 正常路径零延迟:box done 即返回 handler 真实 response
    expect(WS_CODE).toMatch(/if box\["done"\]:\s*\n\t\treturn box\["response"\]/);
  });
  it('debug 分支经 watchdog 调用 handle_debug_async,互斥锁 await 后必释放', () => {
    expect(WS_CODE).toMatch(
      /response = await _await_with_watchdog\(\s*\n\s*Callable\(_command_handler, "handle_debug_async"\)/,
    );
    // watchdog 返回(正常/超时)后立即释放互斥锁(不再依赖 120s stale 自愈)
    expect(WS_CODE).toMatch(/_await_with_watchdog[\s\S]*?DEBUG_ASYNC_WATCHDOG_MS, _method\)\s*\n\s*_debug_in_flight = false/);
  });
  it('批 H reply 兼容未被回退:result/data 双形状 reshape 仍在', () => {
    // I-4 改动紧邻批 H 修复点,守护不回退:response.result 点访问 → get 兜底 reshape
    expect(WS_CODE).toContain('response.get("result", response.get("data"))');
  });
});

describe('I-5: STATE_CONNECTING 握手超时', () => {
  it('websocket_server: CONNECTING 分支超时 close + 回收槽位', () => {
    expect(WS_CODE).toContain('const WS_HANDSHAKE_TIMEOUT_MS := 10000');
    expect(WS_CODE).toContain('var _connecting_since: Dictionary = {}');
    // accept 时记录握手起点
    expect(WS_CODE).toMatch(/_peers\.append\(ws_peer\)\s*\n\s*_connecting_since\[ws_peer\.get_instance_id\(\)\]/);
    // CONNECTING 分支:超时 → close + to_remove(槽位回收)
    const branch = WS_CODE.slice(
      WS_CODE.indexOf('WebSocketPeer.STATE_CONNECTING:'),
      WS_CODE.indexOf('WebSocketPeer.STATE_CLOSED:'),
    );
    expect(branch).toContain('_connecting_since');
    expect(branch).toMatch(/peer\.close\(\)/);
    expect(branch).toMatch(/to_remove\.append\(i\)/);
    // 握手完成(OPEN)清计时;移除路径也清(防字典泄漏)
    expect(WS_CODE).toMatch(/STATE_OPEN:\s*\n\s*_connecting_since\.erase\(peer\.get_instance_id\(\)\)/);
    expect(WS_CODE).toMatch(/_heartbeat\.remove_peer\(rid\)\s*\n\s*_authenticated_peers\.erase\(rid\)\s*\n\s*_connecting_since\.erase\(rid\)/);
  });
  it('mcp_bridge: 无 CONNECTING 态评估注释落位(裸 TCP peer 有界占用)', () => {
    // I-5 评估结论(原始源码注释,非代码):mcp_bridge peer 是 StreamPeerTCP,accept 即
    // CONNECTED;静默 peer 由 INACTIVITY_TIMEOUT=60s 兜底——不适用握手超时。
    // 代码级不变量:accept 即记 _peer_last_activity(槽位占用有界的根据)
    const code = stripComments(BRIDGE_SCRIPT_RAW);
    expect(code).toMatch(/_peers\.append\(peer\)\s*\n\s*_peer_last_activity\[peer\.get_instance_id\(\)\]/);
    expect(BRIDGE_SCRIPT_RAW).toContain('I-5 (2026-08-14 审查 P3) 评估结论');
  });
});
