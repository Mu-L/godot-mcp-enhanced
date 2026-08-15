import { describe, it, expect } from 'vitest';
import { PLAYTEST_METHODS, CONTROL_METHODS } from '../../src/tools/game-bridge.js';

// G1 (2026-08-13) control-first satellite 层(附录 F.1)—— TS 侧 CONTROL_METHODS 集合校验。
// GD 侧 freeze/unfreeze/step_until 的引擎行为(paused 真冻结/条件真满足)需 Godot bridge 实测,
// CI 只覆盖集合 + 正交性(GD 编译由 check:gdscript errors=0 锚定)。

describe('G1 CONTROL_METHODS(control-first satellite 层)', () => {
  it('含 freeze/unfreeze/step_until 三命令', () => {
    expect(CONTROL_METHODS.has('playtest.freeze')).toBe(true);
    expect(CONTROL_METHODS.has('playtest.unfreeze')).toBe(true);
    expect(CONTROL_METHODS.has('playtest.step_until')).toBe(true);
  });

  it('size === 3(新增命令时同步更新此断言)', () => {
    expect(CONTROL_METHODS.size).toBe(3);
  });

  it('与 PLAYTEST_METHODS(determinism-first)不重叠 —— 正交叠加', () => {
    for (const m of CONTROL_METHODS) {
      expect(PLAYTEST_METHODS.has(m)).toBe(false);
    }
    for (const m of PLAYTEST_METHODS) {
      expect(CONTROL_METHODS.has(m)).toBe(false);
    }
  });

  it('PLAYTEST_METHODS 仍含 determinism 四原语 + step(不受 G1 影响)', () => {
    expect(PLAYTEST_METHODS.has('playtest.seed')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.fixed_delta')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.snapshot')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.restore')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.step')).toBe(true);
  });

  it('game_playtest 接受的完整方法集 = PLAYTEST ∪ CONTROL(8 个)', () => {
    const all = new Set([...PLAYTEST_METHODS, ...CONTROL_METHODS]);
    expect(all.size).toBe(8); // 5 determinism + 3 control
  });
});
