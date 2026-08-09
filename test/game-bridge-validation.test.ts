// test/game-bridge-validation.test.ts
// 纯函数测试:game-bridge.ts 的参数校验逻辑(validateBridgePath / validateWaitPropertyParams /
// clampTimeoutMs)。零 vi.mock(不碰 net/socket),平台无关,Linux CI 可直接跑。
//
// 缘起(2026-08-09 待办 #3):原 T-1/I-1/I-2 共 12 个测试在 game-bridge.test.ts 里走 handleTool
// 完整路径(碰 socket mock),因 vitest 4.1.x 在 Linux 的 vi.mock('net') 跨文件隔离失效
// (issue #15,定性为永久窄抑制),整个 game-bridge.test.ts 被 ci.yml:75 `--exclude` 出 Linux CI,
// 导致这 12 个纯校验测试在 Linux CI 零覆盖。抽函数 export + 本文件迁移后,Linux CI 恢复覆盖。
//
// 模式参考:game-bridge-wait.test.ts / game-bridge-playtest.test.ts(同目录"按职责切片 + 不 mock net")。
import { describe, it, expect } from 'vitest';
import { validateBridgePath, validateWaitPropertyParams, clampTimeoutMs } from '../src/tools/game-bridge.js';

describe('validateBridgePath (T-1/I-1: /root/ 绝对路径校验)', () => {
  describe('T-1: game_write/wait/query 的 path 参数', () => {
    it('path 非 /root/ → 返回错误消息(含 /root/ 提示)', () => {
      const err = validateBridgePath({ path: 'Player', property: 'position', value: { x: 1 } });
      expect(err).not.toBeNull();
      expect(err).toContain('/root/');
    });

    it('path 合法(/root/Player) → null(校验通过)', () => {
      expect(validateBridgePath({ path: '/root/Player', property: 'position' })).toBeNull();
    });

    it('wait_for_node 的 path 非 /root/ → 返回错误消息', () => {
      const err = validateBridgePath({ path: 'Player' });
      expect(err).not.toBeNull();
      expect(err).toContain('/root/');
    });

    it('ping 无 path → null(无节点路径的方法不校验)', () => {
      expect(validateBridgePath({})).toBeNull();
    });
  });

  describe('I-1: monitor/watch/click_button 的 node_path/path', () => {
    it('monitor_start 的 node_path 非 /root/ → 返回错误消息', () => {
      const err = validateBridgePath({ node_path: 'Player', properties: ['position'] });
      expect(err).not.toBeNull();
      expect(err).toContain('/root/');
    });

    it('click_button 的 path 非 /root/ → 返回错误消息', () => {
      const err = validateBridgePath({ path: 'UI/Button' });
      expect(err).not.toBeNull();
      expect(err).toContain('/root/');
    });

    it('monitor_start 的 node_path 合法(/root/Player) → null', () => {
      expect(validateBridgePath({ node_path: '/root/Player', properties: ['position'] })).toBeNull();
    });

    it('find_ui_elements 的 pattern(无 path/node_path)→ null(不校验)', () => {
      expect(validateBridgePath({ type: 'Button', pattern: 'Start' })).toBeNull();
    });

    it('click_button 仅 text(空 path)→ null(回归守护,审查#3)', () => {
      expect(validateBridgePath({ text: 'Start' })).toBeNull();
    });
  });

  describe('边界:path/node_path 的空值与精确 /root', () => {
    it('path 为空字符串 → null(不校验,防误拒无路径方法)', () => {
      expect(validateBridgePath({ path: '' })).toBeNull();
    });

    it('path 精确等于 /root → null(根本身合法)', () => {
      expect(validateBridgePath({ path: '/root' })).toBeNull();
    });

    it('node_path 非字符串(数字)→ null(类型不符不校验,交给上层)', () => {
      expect(validateBridgePath({ node_path: 123 })).toBeNull();
    });

    it('同时给非法 path 和非法 node_path → 返回 path 的错误(先遇先返)', () => {
      const err = validateBridgePath({ path: 'Bad', node_path: 'AlsoBad' });
      expect(err).not.toBeNull();
      expect(err).toContain('path must be an absolute path');  // path 在 node_path 前迭代,消息前缀用 path
    });
  });
});

describe('validateWaitPropertyParams (I-2: wait_for_property property/value 校验)', () => {
  it('wait_for_property 缺 property → 返回错误消息(含 property)', () => {
    const err = validateWaitPropertyParams('wait_for_property', { path: '/root/Player' });
    expect(err).not.toBeNull();
    expect(err).toContain('property');
  });

  it('wait_for_property 缺 value → 返回错误消息(含 value)', () => {
    const err = validateWaitPropertyParams('wait_for_property', { path: '/root/Player', property: 'health' });
    expect(err).not.toBeNull();
    expect(err).toContain('value');
  });

  it('wait_for_node → null(不需 property,回归守护)', () => {
    expect(validateWaitPropertyParams('wait_for_node', { path: '/root/Player' })).toBeNull();
  });

  it('wait_for_property property+value 齐全 → null', () => {
    expect(validateWaitPropertyParams('wait_for_property', { property: 'health', value: 100 })).toBeNull();
  });

  it('property 为空字符串 → 错误(非空校验)', () => {
    const err = validateWaitPropertyParams('wait_for_property', { property: '', value: 100 });
    expect(err).not.toBeNull();
    expect(err).toContain('property');
  });

  it('property 非字符串(数字)→ 错误(类型校验)', () => {
    const err = validateWaitPropertyParams('wait_for_property', { property: 123, value: 100 });
    expect(err).not.toBeNull();
    expect(err).toContain('property');
  });

  it('value 为 null(显式 null)→ null 校验通过(既有行为:仅 value===undefined 才拒,null 被接受)', () => {
    // 锁定当前实际行为:校验条件是 value === undefined,null 不等于 undefined 故通过。
    // 这是既有逻辑边界(见 game-bridge.ts validateWaitPropertyParams),本次不改语义,仅锁定基线。
    expect(validateWaitPropertyParams('wait_for_property', { property: 'health', value: null })).toBeNull();
  });
});

describe('clampTimeoutMs (边界值,补当前零覆盖)', () => {
  it('undefined → 默认值', () => {
    expect(clampTimeoutMs(undefined)).toBe(10000);
  });

  it('null → 默认值', () => {
    expect(clampTimeoutMs(null)).toBe(10000);
  });

  it('NaN → 默认值', () => {
    expect(clampTimeoutMs(NaN)).toBe(10000);
  });

  it('Infinity → 默认值(Number.isFinite 拦截)', () => {
    expect(clampTimeoutMs(Infinity)).toBe(10000);
  });

  it('超上限 → 钳到 max', () => {
    expect(clampTimeoutMs(999999, 1000, 60000, 10000)).toBe(60000);
  });

  it('超下限(含负数)→ 钳到 min', () => {
    expect(clampTimeoutMs(-5, 1000, 60000, 10000)).toBe(1000);
    expect(clampTimeoutMs(0, 1000, 60000, 10000)).toBe(1000);
  });

  it('合法值 → 原值(Math.round)', () => {
    expect(clampTimeoutMs(5000, 1000, 60000, 10000)).toBe(5000);
    expect(clampTimeoutMs(2500.4, 1000, 60000, 10000)).toBe(2500);
  });

  it('字符串数字 → 解析为数字(宽容输入)', () => {
    expect(clampTimeoutMs('5000', 1000, 60000, 10000)).toBe(5000);
  });

  it('自定义 min/max/def(游戏 wait 的 interval 50-2000-200)', () => {
    expect(clampTimeoutMs(undefined, 50, 2000, 200)).toBe(200);
    expect(clampTimeoutMs(10, 50, 2000, 200)).toBe(50);
    expect(clampTimeoutMs(99999, 50, 2000, 200)).toBe(2000);
  });
});
