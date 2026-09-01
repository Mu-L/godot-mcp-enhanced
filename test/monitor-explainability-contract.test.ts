import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// M-EXPLAIN (2026-09-01) 契约测试:monitor 输出可解释性(对标 satelliteoflove
// 2fb5f07/05f721b 的"输出自己解释自己"攻势)+ bridge 行协议 UTF-8 跨 chunk 安全性质固化
// (对标 blender-mcp 3100b36 同类 bug 的免疫证明)。
//
// ⚠️ 局限(对齐 e1-headless-coerce-contract 范式):源码字符串断言验证"修复模式落位"
// 而非运行时行为;结构/缩进正确性由 `npm run check:gdscript`(项目级完整编译)覆盖。

const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

function sliceBetween(startAnchor: string, endAnchor: string): string {
  const start = gd.indexOf(startAnchor);
  expect(start, `锚点未找到: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  const end = gd.indexOf(endAnchor, start);
  expect(end, `结束锚点未找到: ${endAnchor}`).toBeGreaterThan(start);
  return gd.slice(start, end);
}

const startFn = () => sliceBetween('func _cmd_monitor_start', 'func _monitor_summary');
const summaryFn = () => sliceBetween('func _monitor_summary', 'func _cmd_monitor_stop');
const stopFn = () => sliceBetween('func _cmd_monitor_stop', 'func _cmd_monitor_poll');
const pollFn = () => sliceBetween('func _cmd_monitor_poll', '# --- Signal watch commands');
const lineFn = () => sliceBetween('func _process_buffer_bytes', 'func _handle_message');

describe('M-EXPLAIN: monitor 输出可解释性(mcp_bridge.gd)', () => {
  it('M-a: monitor_start 返回 properties 用 filtered_props,不再谎报原始请求列表', () => {
    const s = startFn();
    const retIdx = s.indexOf('"properties": filtered_props');
    expect(retIdx, '返回体缺 "properties": filtered_props').toBeGreaterThanOrEqual(0);
    // 原始列表 properties 只应出现在过滤循环里,不得再作为返回字段
    expect(s.includes('"properties": properties'), '仍存在谎报写法 "properties": properties').toBe(false);
  });

  it('M-b: 被安全过滤属性逐个点名(dropped_blocked),且去重', () => {
    const s = startFn();
    expect(s.includes('var dropped_blocked: Array = []'), '缺 dropped_blocked 收集').toBe(true);
    expect(s.includes('if not dropped_blocked.has(prop)'), '缺去重守卫').toBe(true);
    expect(s.includes('"dropped_blocked": dropped_blocked'), '返回体缺 dropped_blocked').toBe(true);
  });

  it('M-c: monitor_start 自述窗口上限(max_samples)', () => {
    expect(startFn().includes('"max_samples": MONITOR_DEFAULT_MAX_SAMPLES'), 'start 返回缺 max_samples').toBe(true);
  });

  it('M-d: _monitor_summary 数值白名单——仅 int/float 进摘要(Vector/Dict 跳过)', () => {
    const s = summaryFn();
    expect(s.includes('if not (v is int or v is float):'), '缺数值类型白名单').toBe(true);
    expect(s.includes('continue'), '非数值属性未跳过').toBe(true);
  });

  it('M-e: _monitor_summary 跳过 error 样本(node_lost 等)', () => {
    const errIdx = summaryFn().indexOf('if sd.has("error"):');
    expect(errIdx, '缺 error 样本跳过').toBeGreaterThanOrEqual(0);
  });

  it('M-f: 极值摘要含发生时刻(min/max at frame/time)', () => {
    const s = summaryFn();
    for (const f of ['min_at_frame', 'min_at_time', 'max_at_frame', 'max_at_time', '"min"', '"max"']) {
      expect(s.includes(f), `摘要缺 ${f}`).toBe(true);
    }
  });

  it('M-g: stop 两个 return(auto-stopped 与正常)均带 summary + interval_frames', () => {
    const s = stopFn();
    expect((s.match(/"summary": _monitor_summary\(/g) ?? []).length, 'stop 应有 2 处 summary 组装').toBe(2);
    expect((s.match(/"interval_frames": int\(ms\.get/g) ?? []).length, 'stop 应有 2 处 interval_frames').toBe(2);
  });

  it('M-h: monitor_poll active 分支带 summary + interval_frames', () => {
    const s = pollFn();
    expect(s.includes('"summary": _monitor_summary('), 'poll 缺 summary').toBe(true);
    expect(s.includes('"interval_frames": int(ms.get'), 'poll 缺 interval_frames').toBe(true);
  });
});

describe('UTF-8 跨 chunk 安全性质固化(_process_buffer_bytes)', () => {
  // blender-mcp 3100b36 的同类 bug:socket 缓冲多字节 UTF-8 在 chunk 边界被截断。
  // enhanced 的安全实现 = 缓冲保持字节形态(PackedByteArray)→ 按 \n 字节切行 → 整行解码;
  // UTF-8 多字节序列不含 0x0A,跨 chunk 字节留在缓冲直到行完整。本组用例固化该性质,
  // 防未来重构引入"先转字符串再分割"的同款 bug。
  it('U-a: 按 \\n 字节查找切行(raw.find(0x0A)),字节级切片', () => {
    const s = lineFn();
    expect(s.includes('raw.find(0x0A)'), '缺字节级换行查找').toBe(true);
    expect(s.includes('var line_bytes: PackedByteArray = raw.slice(0, nl_idx)'), '缺字节级切片').toBe(true);
  });

  it('U-b: 整行解码(仅对 line_bytes),解码发生在切片之后', () => {
    const s = lineFn();
    const sliceIdx = s.indexOf('raw.slice(0, nl_idx)');
    const decodeIdx = s.indexOf('line_bytes.get_string_from_utf8()');
    expect(decodeIdx, '缺整行解码').toBeGreaterThanOrEqual(0);
    expect(sliceIdx, '缺切片锚点').toBeGreaterThanOrEqual(0);
    expect(decodeIdx, '解码必须晚于切片').toBeGreaterThan(sliceIdx);
  });

  it('U-c(负向): 缓冲 raw 不得先整体转字符串再分割', () => {
    const s = lineFn();
    expect(s.includes('raw.get_string_from_utf8()'), '禁止对整个缓冲 raw 先解码').toBe(false);
  });

  it('U-d: 无效 UTF-8 显性失败(断连)而非静默替换', () => {
    const s = lineFn();
    expect(s.includes('Invalid UTF-8'), '缺无效 UTF-8 检测').toBe(true);
    expect(s.includes('disconnect_from_host()'), '解码失败应断连').toBe(true);
  });
});
