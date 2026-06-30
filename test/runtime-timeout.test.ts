// runtime-timeout.test.ts — computeRunTimeout 纯函数(问题 3:run_project timeout race 修复)
// 提取自 runtime.ts run_project 的 timeout 计算,使可单元测试。
// 修复:wait_for_bridge 时 timeout 至少 bridge_timeout + 10,防 auto-stop 与 bridge 就绪 race。
import { describe, it, expect } from 'vitest';
import { computeRunTimeout } from '../src/tools/runtime.js';

describe('computeRunTimeout', () => {
  it('无 wait_for_bridge 时默认 30', () => {
    expect(computeRunTimeout(undefined, 10, false)).toBe(30);
  });

  it('wait_for_bridge 时 timeout ≥ bridge_timeout + 10(防 race)', () => {
    // 默认 30 vs bridge 30+10=40 → 取 40(当前 bug:取 30,race)
    expect(computeRunTimeout(undefined, 30, true)).toBe(40);
  });

  it('wait_for_bridge + 小 bridge:取默认 30(max(20,30))', () => {
    expect(computeRunTimeout(undefined, 10, true)).toBe(30);
  });

  it('显式 timeout > bridge+10 时尊重显式值', () => {
    expect(computeRunTimeout(120, 30, true)).toBe(120);
  });

  it('显式 timeout < bridge+10 时用 bridge+10(防 race)', () => {
    expect(computeRunTimeout(15, 30, true)).toBe(40);
  });

  it('最小 5(下限)', () => {
    expect(computeRunTimeout(1, 10, false)).toBe(5);
  });
});
