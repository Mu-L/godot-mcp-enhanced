// test/regression/defects-open.test.ts — M2 Task 5
// OPEN_DEFECTS 11 条基线阈值：detect() <= baseline（防恶化）。
// 改善（detect < baseline）→ console.warn 提示可降基线（非红）；
// 清零（detect === 0）→ console.log 提示可改硬断言 + 移 FIXED（如 edit-node-blocked-props baseline=0 不触发，但留通用出口）。
// 不调 _setProjectRootForTest：detect-helpers DEFAULT_ROOT 已修（C1），detect 默认读对项目根真文件。
import { describe, it, expect } from 'vitest';
import { OPEN_DEFECTS } from './defects.js';

describe('DEFECT open 防恶化（基线阈值 detect() <= baseline）', () => {
  it.each(OPEN_DEFECTS)('[${severity}] ${key}', ({ key, severity, dimension, detect, baseline }) => {
    const hits = detect();
    const base = baseline!;
    // 防恶化硬门：detect 超 baseline 即红（恶化）。
    expect(
      hits,
      `DEFECT [${severity}] ${key} (${dimension}) 恶化：detect 命中 ${hits} > 基线 ${base} — ` +
      `复核 src 改动是否引入新缺陷；若确为改善后基线过松，更新 baseline 为新实测值`
    ).toBeLessThanOrEqual(base);

    // 改善提示（非红）：detect 严格小于 baseline，可考虑降基线锁紧门。
    if (hits < base) {
      console.warn(
        `[regression] ${key} detect=${hits} < baseline=${base}，可降基线`
      );
    }
    // 清零提示（非红）：detect 已为 0，可改硬断言 + 移到 FIXED_DEFECTS。
    // edit-node-blocked-props baseline=0 不触发此分支；其余 open 若修复到 0 会提示。
    if (hits === 0) {
      console.log(
        `[regression] ${key} detect=0，可改硬断言 + 移 FIXED`
      );
    }
  });

  it('OPEN_DEFECTS 覆盖 11 条、无重名且 baseline 已锁定', () => {
    // 11 = 原 18 − 3（gdscript-gen-null-root-deref / launcher-no-error-listener / plugin-no-super-call
    //   2026-06-27 probe 实测 detect=0 移 FIXED 防复发;plugin-no-super-call 系 R2 super IMP-4 654b162 已修）
    //   − 1（ts-args-as-cast-no-validation 2026-06-27 args-validator 接入 detect 改查入口移 FIXED）
    //   − 3（2026-06-27 收窄：version-hardcoded-drift / secret-cache-and-perm-weak / normalizeargs-depth-limit
    //   detect 改查真缺陷形态实测 0 移 FIXED）。
    // 沿用：4 条（原 fixed 实测真未修 Task 2 闭环）+ 14 条（Task 3 追加）− 7（本次移 fixed）。
    // 注：2 条（module-level-mutable-state / regex-danger-api-bypassable）降 ADVISORY 但仍 OPEN
    //   （detect/baseline 不变,承认合理设计/已认知防御层,保留 baseline 防恶化）。
    expect(OPEN_DEFECTS.length).toBe(11);
    const keys = OPEN_DEFECTS.map(d => d.key);
    expect(new Set(keys).size, '存在重名 key').toBe(11);
    // 全部 status=open 且 baseline 已锁定（防恶化门必须）
    for (const d of OPEN_DEFECTS) {
      expect(d.status, `${d.key} status 应为 open`).toBe('open');
      expect(d.baseline, `${d.key} 缺 baseline（防恶化门无效）`).toBeDefined();
    }
  });
});
