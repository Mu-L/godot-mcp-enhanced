// test/regression/defects-fixed.test.ts — M2 Task 4
// FIXED_DEFECTS 17 条硬断言：detect() === 0（防复发）。
// 复发即红，失败消息指引按 spec §8 闭环（改 status=open + 加 baseline + 移组）。
// 不调 _setProjectRootForTest：detect-helpers DEFAULT_ROOT 已修（C1），detect 默认读对项目根真文件。
import { describe, it, expect } from 'vitest';
import { FIXED_DEFECTS } from './defects.js';

describe('DEFECT fixed 防复发（硬断言 detect() === 0）', () => {
  it.each(FIXED_DEFECTS)('[${severity}] ${key}', ({ key, severity, dimension, detect }) => {
    const hits = detect();
    // 硬断言：detect 必须为 0。非 0 = 复发或翻译错。
    expect(
      hits,
      `DEFECT [${severity}] ${key} (${dimension}) fixed 但 detect 命中 ${hits}（复发）— ` +
      `复核 src 真实状态：若真复发，按 spec §8 闭环改 status='open' + 加 baseline=实测 + 移到 OPEN_DEFECTS；` +
      `若 detect 翻译错则修闭包忠实 defects.md 谓词`
    ).toBe(0);
  });

  it('FIXED_DEFECTS 覆盖 23 条且无重名', () => {
    // 23 = 19（原 FIXED）+ 3（2026-06-27 probe 实测 detect=0 移 fixed：gdscript-gen-null-root-deref /
    //   launcher-no-error-listener / plugin-no-super-call；后者系 R2 super IMP-4 654b162 已修）
    //   + 1（ts-args-as-cast-no-validation 2026-06-27 args-validator 接入,detect 改查 executeToolCall
    //   validateArgs 接入点,文件级 grep;detect===0 防去验证化回归）。
    expect(FIXED_DEFECTS.length).toBe(23);
    const keys = FIXED_DEFECTS.map(d => d.key);
    expect(new Set(keys).size, '存在重名 key').toBe(23);
    // 全部 status=fixed
    for (const d of FIXED_DEFECTS) {
      expect(d.status, `${d.key} status 应为 fixed`).toBe('fixed');
    }
  });
});
