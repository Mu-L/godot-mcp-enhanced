import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CMP-9-B (2026-08-08): bridge 通道 _cmd_call_method 放宽 — 源码字面量契约测试。
// mcp_bridge.gd 运行在游戏进程,无法单测运行时行为;这里验证源码改动落位。
// 对标竞品 regiellis/godot-mcp-go 的 runtime.call(运行中游戏进程上调方法)。
// B-2 (2026-08-14): BLOCKLIST 命中分支加内层 args[0] 检查(约 500 字符),
// _cmd_call_method 函数体窗口 2600 → 3200 保持覆盖到函数尾部的强转/undoable 声明。

describe('CMP-9-B: bridge _cmd_call_method 放宽（GD 源码契约）', () => {
  const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

  it('CMP-9B-a: _cmd_call_method 含 did-you-mean 调用', () => {
    const fnStart = gd.indexOf('func _cmd_call_method');
    const slice = gd.slice(fnStart, fnStart + 3200);
    expect(slice.includes('_suggest_bridge_method'), '缺 did-you-mean 调用').toBe(true);
    expect(slice.includes('Did you mean'), '缺 did-you-mean 提示文案').toBe(true);
  });

  it('CMP-9B-b: _cmd_call_method 含 args 类型强转', () => {
    const fnStart = gd.indexOf('func _cmd_call_method');
    const slice = gd.slice(fnStart, fnStart + 3200);
    expect(slice.includes('_coerce_bridge_args'), '缺类型强转调用').toBe(true);
  });

  it('CMP-9B-c: _cmd_call_method 返回 undoable=false', () => {
    const fnStart = gd.indexOf('func _cmd_call_method');
    const slice = gd.slice(fnStart, fnStart + 3200);
    expect(slice.includes('"undoable": false'), '缺 undoable=false 声明').toBe(true);
  });

  it('CMP-9B-d: 新增 _suggest_bridge_method helper(similarity > 0.6)', () => {
    const fnStart = gd.indexOf('func _suggest_bridge_method');
    expect(fnStart, '缺 _suggest_bridge_method 函数').toBeGreaterThan(-1);
    const slice = gd.slice(fnStart, fnStart + 600);
    expect(slice.includes('similarity'), 'did-you-mean 缺 similarity 调用').toBe(true);
    expect(slice.includes('0.6'), 'did-you-mean 缺 0.6 阈值').toBe(true);
  });

  it('CMP-9B-e: 新增 _coerce_bridge_args helper(按 ClassDB 声明类型)', () => {
    const fnStart = gd.indexOf('func _coerce_bridge_args');
    expect(fnStart, '缺 _coerce_bridge_args 函数').toBeGreaterThan(-1);
    const slice = gd.slice(fnStart, fnStart + 1000);
    expect(slice.includes('get_method_list'), '强转缺 get_method_list 调用').toBe(true);
    expect(slice.includes('declared_args'), '强转缺 declared_args 逻辑').toBe(true);
  });

  it('CMP-9B-f: _coerce_bridge_single 覆盖主要类型(Vector2/3/Color/bool/int/float)', () => {
    const fnStart = gd.indexOf('func _coerce_bridge_single');
    expect(fnStart, '缺 _coerce_bridge_single 函数').toBeGreaterThan(-1);
    const slice = gd.slice(fnStart, fnStart + 1500);
    expect(slice.includes('TYPE_VECTOR3'), '强转缺 TYPE_VECTOR3').toBe(true);
    expect(slice.includes('TYPE_VECTOR2'), '强转缺 TYPE_VECTOR2').toBe(true);
    expect(slice.includes('TYPE_COLOR'), '强转缺 TYPE_COLOR').toBe(true);
    expect(slice.includes('TYPE_BOOL'), '强转缺 TYPE_BOOL').toBe(true);
    expect(slice.includes('TYPE_INT'), '强转缺 TYPE_INT').toBe(true);
    expect(slice.includes('TYPE_FLOAT'), '强转缺 TYPE_FLOAT').toBe(true);
    expect(slice.includes('raw is Array'), '强转缺 Array 来源分支').toBe(true);
    expect(slice.includes('raw is String'), '强转缺 String 来源分支').toBe(true);
  });
});

describe('CMP-9-B: 向后兼容不变量（GD 源码契约）', () => {
  const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

  it('CMP-9B-g: ALLOWED_METHODS 只读白名单保留(向后兼容)', () => {
    expect(gd.includes('const ALLOWED_METHODS'), '缺 ALLOWED_METHODS 常量').toBe(true);
    // 白名单应仍含只读方法
    const amStart = gd.indexOf('const ALLOWED_METHODS');
    const slice = gd.slice(amStart, amStart + 400);
    expect(slice.includes('"get"'), 'ALLOWED_METHODS 缺 get').toBe(true);
    expect(slice.includes('"get_class"'), 'ALLOWED_METHODS 缺 get_class').toBe(true);
  });

  it('CMP-9B-h: EXTRA_METHODS_BLOCKLIST 硬底线保留(不可覆盖)', () => {
    expect(gd.includes('const EXTRA_METHODS_BLOCKLIST'), '缺 EXTRA_METHODS_BLOCKLIST').toBe(true);
    const blStart = gd.indexOf('const EXTRA_METHODS_BLOCKLIST');
    const slice = gd.slice(blStart, blStart + 300);
    expect(slice.includes('"free"'), 'BLOCKLIST 缺 free').toBe(true);
    expect(slice.includes('"queue_free"'), 'BLOCKLIST 缺 queue_free').toBe(true);
    expect(slice.includes('"set_script"'), 'BLOCKLIST 缺 set_script(RCE)').toBe(true);
  });

  it('CMP-9B-i: GODOT_MCP_BRIDGE_EXTRA_METHODS env 机制保留', () => {
    expect(gd.includes('GODOT_MCP_BRIDGE_EXTRA_METHODS'), '缺 env 扩展机制').toBe(true);
  });

  it('CMP-9B-j: get() 的 blocked property 检查保留(line 941 原逻辑)', () => {
    const fnStart = gd.indexOf('func _cmd_call_method');
    const slice = gd.slice(fnStart, fnStart + 3200);
    expect(slice.includes('_is_blocked_property'), '缺 blocked property 检查').toBe(true);
  });

  it('CMP-9B-k: args 数量上限 8 保留', () => {
    const fnStart = gd.indexOf('func _cmd_call_method');
    const slice = gd.slice(fnStart, fnStart + 3200);
    expect(slice.includes('max 8'), '缺 args 数量上限').toBe(true);
  });
});

describe('CMP-9-B: game-bridge.ts 文档更新', () => {
  it('CMP-9B-l: call_method params 描述含类型强转 + deny-list + undoable 说明', () => {
    const src = readFileSync('src/tools/game-bridge.ts', 'utf8');
    // 找 call_method 相关 params 描述段
    const descIdx = src.indexOf('EXTRA_METHODS_BLOCKLIST');
    expect(descIdx, 'game-bridge.ts params 描述缺 EXTRA_METHODS_BLOCKLIST 说明').toBeGreaterThan(-1);
    const slice = src.slice(descIdx - 200, descIdx + 400);
    expect(slice.includes('GODOT_MCP_BRIDGE_EXTRA_METHODS'), '缺 env 扩展说明').toBe(true);
    expect(slice.includes('undoable'), '缺 undoable 说明').toBe(true);
    expect(slice.includes('did-you-mean') || slice.includes('Did you mean'), '缺 did-you-mean 说明').toBe(true);
  });
});
