import { describe, it, expect } from 'vitest';
import { PROFILES, resolveProfile, expandGroups } from '../../src/core/tool-registry.js';

// G7 (2026-08-13) basic profile(附录 E.4,借鉴 GoPeak compact 默认)。
// basic = 默认 profile(BREAKING from full),复用 lite 9 组,省 ~60% context。
// RCE action 经 action-gate 默认全 gate 兜底(本测试只覆盖 profile 集合,action-gate 独立)。

describe('G7 basic profile(默认省 context)', () => {
  it('PROFILES.basic 存在 + 组清单 = lite 9 组', () => {
    expect(PROFILES.basic).toBeDefined();
    expect(PROFILES.basic).toEqual([
      'core', 'bridge', 'animation', 'audio', 'signal', 'visual', 'code', 'test', 'profiler',
    ]);
  });

  it('basic = lite(语义名,组清单一致)', () => {
    expect(PROFILES.basic).toEqual(PROFILES.lite);
  });

  it('resolveProfile("basic") 展开为 9 组的工具并集', () => {
    const basic = resolveProfile('basic');
    const lite = resolveProfile('lite');
    expect(basic.size).toBe(lite.size);
    for (const t of basic) expect(lite.has(t)).toBe(true);
  });

  it('basic ⊂ full(basic 工具是 full 子集,省 context)', () => {
    const basic = resolveProfile('basic');
    const full = resolveProfile('full');
    expect(basic.size).toBeLessThan(full.size); // basic 省 context(少于 full)
    for (const t of basic) expect(full.has(t)).toBe(true);
  });

  it('basic 含 core 组(protected,manage_tools/help 等元工具必须可用)', () => {
    const basic = resolveProfile('basic');
    const coreTools = expandGroups(['core']);
    for (const t of coreTools) expect(basic.has(t)).toBe(true);
  });

  it('PROFILES 含 basic(7 preset: full/lite/basic/minimal/slim/bridge_dev/3d_dev)', () => {
    expect(Object.keys(PROFILES)).toContain('basic');
    expect(Object.keys(PROFILES).length).toBeGreaterThanOrEqual(7);
  });
});
