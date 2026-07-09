// test/regression/defects-fixed.test.ts — M2 Task 4
// FIXED_DEFECTS 38 条硬断言：detect() === 0（防复发）。
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

  it('FIXED_DEFECTS 覆盖 38 条且无重名', () => {
    // 31 = 19（原 FIXED）+ 3（2026-06-27 probe 实测 detect=0 移 fixed：gdscript-gen-null-root-deref /
    //   launcher-no-error-listener / plugin-no-super-call；后者 2026-07-04 detect 反转——
    //   654b162 误加 super 触发 4.6.2+ parse error,移除 6 处 super 后 detect 计数"原生类虚函数有 super"=0 防回归）
    //   + 1（ts-args-as-cast-no-validation 2026-06-27 args-validator 接入,detect 改查 executeToolCall
    //   validateArgs 接入点,文件级 grep;detect===0 防去验证化回归）
    //   + 3（2026-06-27 收窄：version-hardcoded-drift / secret-cache-and-perm-weak / normalizeargs-depth-limit
    //   detect 改查真缺陷形态,剔除合理模式 verifiedGodotVersion 元数据 / icacls ACL 替代 / .MAX_NORMALIZE_DEPTH
    //   常量引用,实测 detect===0 移 FIXED 防复发）
    //   + 1（2026-06-27 recording-no-touch-events ScreenDrag 补全 feat/recording-screen-drag,
    //   ScreenTouch+ScreenDrag 两类齐备 detect=0 移 FIXED 防复发）。
    //   + 2（2026-06-29 r2 N1/N3 fix-forward：frame-sequence-quota-bypass(workflow copyScript 配额绕过) /
    //   sim-threshold-bare-as(裸 as 致 NaN 放行),detect=0 移 FIXED 防复发）。
    //   小计 19+3+1+3+1+2=29,另 +2 为历史小计外新增（未逐一条目化）,
    //   +2(2026-07-04 审查 F-1/F-2 PowerShell 写 secret 注入 + blocking 误用:
    //   secret-write-powershell-injection / os-execute-blocking-false-exit-code),合计 33。
    //   +4(2026-07-04 审查 F-5/F-6/F-7/F-8 数据导入子系统 + 2026-07-05 复审 P1 扩展:
    //   csv-import-float-no-isfinite-guard(F-8 抽 _safe_float 守 FLOAT/VECTOR2/COLOR)/
    //   csv-import-mkdir-return-ignored(F-6 _mcp_done 净化)/ csv-import-save-return-ignored(F-5)/
    //   csv-import-no-byte-limit(F-7 + csv_path statSync 预检 P1-2)),合计 37。
//   +1(2026-07-06 ipc 审查 P1-8: game-bridge-invalidate-race,_socket === sock 守卫防废弃 socket
//   异步 close/error invalidate 新 socket),合计 38。
//   +3(2026-07-06 综合审查 P1-1/P1-2/P1-3: editor-blind-routing-no-fallback(-32601 回退 headless)/
//   editor-guards-text-write-not-wired(TS 写脚本/场景接线 guard 回调)/
//   heartbeat-pause-timeout-disconnect(暂停超时改恢复 normal 检测)),合计 41。
//   +4(2026-07-10 三层架构审查 P1×3+P2×1: pkill-spawn-error-handler / nav-bake-in-undo-action /
//   asset-undo-stack-top-guard / install-plugin-realpath-guard),合计 45。
    expect(FIXED_DEFECTS.length).toBe(45);
    const keys = FIXED_DEFECTS.map(d => d.key);
    expect(new Set(keys).size, '存在重名 key').toBe(45);
    // 全部 status=fixed
    for (const d of FIXED_DEFECTS) {
      expect(d.status, `${d.key} status 应为 fixed`).toBe('fixed');
    }
  });
});
