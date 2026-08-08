import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-2 (2026-08-08): runtime error 捕获——game bridge 通道的 _ErrorCapture Logger 子类。
// 字面量契约测试(对齐 playtest-gd-contract.test.ts 模式):验证 mcp_bridge.gd 含
// _ErrorCapture extends Logger、OS.add_logger 注册、get_errors/clear_errors method case、
// ring buffer MAX_ENTRIES、re-entrancy guard。
// GD 侧无 bridge 测试基础设施(handler 测试在 TS 侧 mock socket),这里锁结构防回归。

describe('CMP-2: game bridge runtime error 捕获（源码字面量契约）', () => {
  const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

  it('CMP-2a: _ErrorCapture 内部类定义存在且 extends Logger', () => {
    expect(
      /class\s+_ErrorCapture\s+extends\s+Logger/.test(gd),
      'mcp_bridge.gd 缺少 _ErrorCapture extends Logger 内部类',
    ).toBe(true);
  });

  it('CMP-2b: _ready() 注册 _error_capture 到 OS.add_logger', () => {
    // 定位 _ready 函数体
    const readyStart = gd.indexOf('func _ready()');
    expect(readyStart, '未找到 _ready 函数').toBeGreaterThan(-1);
    const readyEnd = gd.indexOf('\nfunc ', readyStart + 10);
    const slice = gd.slice(readyStart, readyEnd > 0 ? readyEnd : readyStart + 500);
    expect(slice.includes('_ErrorCapture.new()'), '_ready 未创建 _ErrorCapture 实例').toBe(true);
    expect(slice.includes('OS.add_logger'), '_ready 未调 OS.add_logger 注册').toBe(true);
  });

  it('CMP-2c: _exit_tree() 注销 _error_capture 从 OS.remove_logger', () => {
    const exitStart = gd.indexOf('func _exit_tree()');
    expect(exitStart, '未找到 _exit_tree 函数').toBeGreaterThan(-1);
    const exitEnd = gd.indexOf('\nfunc ', exitStart + 10);
    const slice = gd.slice(exitStart, exitEnd > 0 ? exitEnd : exitStart + 500);
    expect(slice.includes('OS.remove_logger'), '_exit_tree 未调 OS.remove_logger 注销').toBe(true);
  });

  it('CMP-2d: _handle_message 注册 get_errors 和 clear_errors method case', () => {
    // 定位 _handle_message 的 match 块
    const handleStart = gd.indexOf('func _handle_message');
    expect(handleStart, '未找到 _handle_message 函数').toBeGreaterThan(-1);
    const slice = gd.slice(handleStart, handleStart + 4000);
    expect(
      /"get_errors"\s*:/.test(slice),
      '_handle_message 未注册 get_errors case',
    ).toBe(true);
    expect(
      /"clear_errors"\s*:/.test(slice),
      '_handle_message 未注册 clear_errors case',
    ).toBe(true);
  });

  it('CMP-2e: _ErrorCapture 有 ring buffer MAX_ENTRIES 上限', () => {
    expect(
      /MAX_ENTRIES\s*:=\s*\d+/.test(gd),
      '_ErrorCapture 缺少 MAX_ENTRIES ring buffer 上限',
    ).toBe(true);
    // pop_front 是 ring buffer 溢出清理的标志
    expect(
      /pop_front\(\)/.test(gd),
      '_ErrorCapture 缺少 pop_front(ring buffer 溢出清理)',
    ).toBe(true);
  });

  it('CMP-2f: _ErrorCapture 有 re-entrancy guard(_in_log flag)', () => {
    // 定位 _ErrorCapture 类体
    const classStart = gd.indexOf('class _ErrorCapture');
    expect(classStart, '未找到 _ErrorCapture 类').toBeGreaterThan(-1);
    const slice = gd.slice(classStart, classStart + 2000);
    expect(
      /_in_log/.test(slice),
      '_ErrorCapture 缺少 _in_log re-entrancy guard(push_error 递归致 error storm)',
    ).toBe(true);
    // guard 必须在 _log_error 入口 early return
    const logErrIdx = slice.indexOf('func _log_error');
    expect(logErrIdx, '未找到 _log_error 方法').toBeGreaterThan(-1);
    const logErrSlice = slice.slice(logErrIdx, logErrIdx + 200);
    expect(
      /if\s+_in_log\s*:/.test(logErrSlice),
      '_log_error 入口缺少 if _in_log: return re-entrancy guard',
    ).toBe(true);
  });

  it('CMP-2g: _log_error 捕获全部 4 种错误类型(ERROR/SCRIPT/SHADER/WARNING)', () => {
    const classStart = gd.indexOf('class _ErrorCapture');
    const slice = gd.slice(classStart, classStart + 3000);
    // NIT-1 修复后补了 ERROR_TYPE_ERROR,覆盖引擎层运行时错误
    expect(slice.includes('ERROR_TYPE_ERROR'), '_log_error 缺少 ERROR_TYPE_ERROR(引擎层运行时错误)').toBe(true);
    expect(slice.includes('ERROR_TYPE_SCRIPT'), '_log_error 缺少 ERROR_TYPE_SCRIPT').toBe(true);
    expect(slice.includes('ERROR_TYPE_SHADER'), '_log_error 缺少 ERROR_TYPE_SHADER').toBe(true);
    expect(slice.includes('ERROR_TYPE_WARNING'), '_log_error 缺少 ERROR_TYPE_WARNING').toBe(true);
  });

  it('CMP-2g2 (NIT-4): message/code/function/file 有 substr 截断防撑爆消息上限', () => {
    const classStart = gd.indexOf('class _ErrorCapture');
    const slice = gd.slice(classStart, classStart + 3000);
    expect(slice.includes('MAX_TEXT_LEN'), '_ErrorCapture 缺少 MAX_TEXT_LEN 截断常量').toBe(true);
    expect(/\.substr\(0,\s*MAX_TEXT_LEN\)/.test(slice), '_log_error 缺少 substr(0, MAX_TEXT_LEN) 截断').toBe(true);
  });

  it('CMP-2h: poll() 方法返回 errors 数组 + next_seq 游标(增量查询)', () => {
    const classStart = gd.indexOf('class _ErrorCapture');
    const slice = gd.slice(classStart, classStart + 3000);
    expect(
      /func\s+poll\s*\(/.test(slice),
      '_ErrorCapture 缺少 poll 方法',
    ).toBe(true);
    expect(slice.includes('next_seq'), 'poll 返回值缺少 next_seq 增量游标').toBe(true);
  });
});

// ─── TS 侧白名单契约 ──────────────────────────────────────────────────────────
describe('CMP-2: game-bridge.ts 白名单登记', () => {
  const ts = readFileSync('src/tools/game-bridge.ts', 'utf8');

  it('CMP-2i: QUERY_METHODS 包含 get_errors 和 clear_errors', () => {
    const qmStart = ts.indexOf('QUERY_METHODS');
    const qmEnd = ts.indexOf(']);', qmStart);
    const slice = ts.slice(qmStart, qmEnd);
    expect(slice.includes("'get_errors'"), 'QUERY_METHODS 缺少 get_errors').toBe(true);
    expect(slice.includes("'clear_errors'"), 'QUERY_METHODS 缺少 clear_errors').toBe(true);
  });

  it('CMP-2j: BRIDGE_READ_ONLY_METHODS 包含 get_errors 和 clear_errors', () => {
    const roStart = ts.indexOf('BRIDGE_READ_ONLY_METHODS');
    const roEnd = ts.indexOf(']);', roStart);
    const slice = ts.slice(roStart, roEnd);
    expect(slice.includes("'get_errors'"), 'BRIDGE_READ_ONLY_METHODS 缺少 get_errors').toBe(true);
    expect(slice.includes("'clear_errors'"), 'BRIDGE_READ_ONLY_METHODS 缺少 clear_errors').toBe(true);
  });

  it('CMP-2k: method 描述含 get_errors/clear_errors 说明', () => {
    // method description 在 inputSchema 里
    const descIdx = ts.indexOf('game_query: ping, get_tree');
    expect(descIdx, '未找到 method 描述').toBeGreaterThan(-1);
    const slice = ts.slice(descIdx, descIdx + 600);
    expect(slice.includes('get_errors'), 'method 描述缺少 get_errors').toBe(true);
    expect(slice.includes('clear_errors'), 'method 描述缺少 clear_errors').toBe(true);
  });
});
