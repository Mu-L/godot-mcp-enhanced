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

  it('FIXED_DEFECTS 覆盖 19 条且无重名', () => {
    // 19 = 原 21 条中 4 条（godot-version-hardcoded-create-project / api-db-version-stale /
    // lint-rule-no-targeted-test / lint-missing-4-7-accessibility-breaking）实测 detect!=0 已转 open（Task 2 spec §8 闭环）
    // + Task 3 review 闭环 +2（reconnect-degrade-fail / edit-node-blocked-props-json-pollution 从 open 移 fixed）。
    expect(FIXED_DEFECTS.length).toBe(19);
    const keys = FIXED_DEFECTS.map(d => d.key);
    expect(new Set(keys).size, '存在重名 key').toBe(19);
    // 全部 status=fixed
    for (const d of FIXED_DEFECTS) {
      expect(d.status, `${d.key} status 应为 fixed`).toBe('fixed');
    }
  });
});
