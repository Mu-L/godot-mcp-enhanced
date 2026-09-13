import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// P0-3 (2026-09-11): monitor 帧步长 → 游戏时间调度 — 源码字面量契约测试。
// 坑(satellite #378 同款):帧步长采样在窗口期帧率变化时实际节奏漂移 2-4 倍(freeze 后
// fps 读数过期尤甚);tree.paused 时帧步长还在烧样本、记过期值。
// 修复:采样节奏锚定游戏时间(delta*1000 累计,含 time_scale),paused 跳过,长帧 resync
// 不 burst 补帧,stop 补采终态。模式对齐 cmp-9-bridge-call-method.test.ts(GD 行为无法
// 单测,验证源码落位)。

describe('P0-3: monitor 游戏时间调度(GD 源码契约)', () => {
  const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

  it('P0-3a: monitor_start 状态含游戏时间调度字段', () => {
    const fnStart = gd.indexOf('func _cmd_monitor_start');
    const fnEnd = gd.indexOf('\nfunc ', fnStart + 10);
    const slice = gd.slice(fnStart, fnEnd);
    expect(slice.includes('"interval_ms": interval_ms'), '缺 interval_ms(60fps 基准换算)').toBe(true);
    expect(slice.includes('1000.0 / 60.0'), '缺 60fps 基准换算').toBe(true);
    expect(slice.includes('"elapsed_ms": 0.0'), '缺 elapsed_ms(游戏时间累计)').toBe(true);
    expect(slice.includes('"next_sample_ms": interval_ms'), '缺 next_sample_ms(目标时刻制)').toBe(true);
    expect(slice.includes('"advanced_since_sample": false'), '缺 stop 补采标志').toBe(true);
    // frame_counter 退役:采样段不再消费,状态字典不应残留死字段
    expect(slice.includes('"frame_counter"'), 'frame_counter 已无消费方,不应残留在状态字典').toBe(false);
  });

  it('P0-3b: _process 采样段为游戏时间目标时刻制 + paused 跳过 + 长帧 resync', () => {
    const fnStart = gd.indexOf('func _process(delta: float)');
    expect(fnStart, '缺 _process(delta: float) 签名(delta 启用)').toBeGreaterThan(-1);
    const segStart = gd.indexOf('Property monitor sampling', fnStart);
    const slice = gd.slice(segStart, segStart + 2000);
    expect(slice.includes('_game_paused'), '缺 paused 跳过判定').toBe(true);
    expect(slice.includes('if _game_paused:'), '缺 paused continue 分支').toBe(true);
    expect(slice.includes('delta * 1000.0'), '缺游戏时间累计(delta 含 time_scale)').toBe(true);
    expect(slice.includes('next_sample_ms'), '缺目标时刻调度').toBe(true);
    expect(slice.includes('resync'), '缺长帧 resync(不 burst 补帧)注释').toBe(true);
    expect(slice.includes('t_game_ms'), '样本缺 t_game_ms 游戏时间戳字段').toBe(true);
    // 帧步长逻辑应已退役
    expect(slice.includes('ms["frame_counter"]'), '帧步长计数不应残留在采样段').toBe(false);
  });

  it('P0-3c: _cmd_monitor_stop 含 stop 补采(终态不丢,paused 不补)', () => {
    const fnStart = gd.indexOf('func _cmd_monitor_stop');
    const fnEnd = gd.indexOf('\nfunc ', fnStart + 10);
    const slice = gd.slice(fnStart, fnEnd);
    expect(slice.includes('advanced_since_sample'), 'stop 缺补采标志判定').toBe(true);
    expect(slice.includes('not get_tree().paused'), 'stop 补采缺 paused 守卫(暂停下补的是过期样本)').toBe(true);
  });

  it('P0-3d: 帧末采样(process_priority)决策留痕——评估结论为不加,防输入时序偏移', () => {
    const readyStart = gd.indexOf('func _ready');
    const readyEnd = gd.indexOf('\nfunc ', readyStart + 10);
    const slice = gd.slice(readyStart, readyEnd);
    // P0-3 评估结论注释必须存在(决策留痕),且不得有实际的 priority 赋值
    expect(slice.includes('P0-3 (2026-09-11) 评估结论:不加 process_priority'), '缺帧末采样决策注释').toBe(true);
    expect(slice.includes('process_priority = 1000'), '不应有全局 priority 赋值(输入注入时序会偏移一位)').toBe(false);
  });

  it('P0-3e: TS 侧 interval_frames 描述同步游戏时间语义', () => {
    const ts = readFileSync('src/tools/game-bridge.ts', 'utf8');
    const propStart = ts.indexOf('interval_frames:');
    const slice = ts.slice(propStart, propStart + 300);
    expect(slice.includes('游戏时间'), '描述缺游戏时间调度说明').toBe(true);
    expect(slice.includes('t_game_ms'), '描述缺 t_game_ms 字段说明').toBe(true);
  });
});
