import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { INPUT_METHODS, getToolDefinitions, computePlaytestTimeoutMs } from '../src/tools/game-bridge.js';
import { QaSuiteSchema } from '../src/tools/qa/spec.js';

// H1 (2026-08-20) send_input_sequence 单测:TS 侧路由/schema/qa 枚举 + GD 侧契约(文本级)。
// bridge 运行时行为(帧对齐/开窗/refreeze)由 e2e-bridge-input-sequence.test.ts(L2)与
// 真机实测锚定,本文件只锁静态结构(对齐 game-bridge-playtest.test.ts 模式)。

const __dirname = dirname(fileURLToPath(import.meta.url));
const GD_SRC = readFileSync(resolve(__dirname, '..', 'src', 'scripts', 'mcp_bridge.gd'), 'utf-8');
const TS_BRIDGE_SRC = readFileSync(resolve(__dirname, '..', 'src', 'tools', 'game-bridge.ts'), 'utf-8');
const QA_RUNNER_SRC = readFileSync(resolve(__dirname, '..', 'src', 'tools', 'qa', 'runner.ts'), 'utf-8');

describe('H1 INPUT_METHODS 含 send_input_sequence', () => {
  it('方法集含 7 个输入方法', () => {
    expect(INPUT_METHODS.has('send_input_sequence')).toBe(true);
    expect(INPUT_METHODS.has('send_key')).toBe(true);
    expect(INPUT_METHODS.size).toBe(7);
  });
});

describe('H1 game 工具 schema 描述', () => {
  const tools = getToolDefinitions();
  const tool = tools[0];

  it('method/params/工具描述均含 send_input_sequence', () => {
    expect(tool.inputSchema.properties.method.description).toContain('send_input_sequence');
    expect(tool.inputSchema.properties.params.description).toContain('timeline');
    expect(tool.inputSchema.properties.params.description).toContain('at_frame');
    expect(tool.description).toContain('send_input_sequence');
  });

  it('timeout 描述声明延迟响应自动放宽', () => {
    expect(tool.inputSchema.properties.timeout.description).toContain('wall_budget+10s');
  });
});

describe('H1 timeout 放宽接线(N-4 收敛后:computePlaytestTimeoutMs 统一)', () => {
  it('computePlaytestTimeoutMs 覆盖 send_input_sequence(wall+10s 余量,65000 上界)', () => {
    // 默认 wall 30000 → 40000;超界 60000 → 65000(容纳 GD clamp 50000+10000 后仍可更大,安全)
    expect(computePlaytestTimeoutMs('send_input_sequence', undefined, 10000)).toBe(40000);
    expect(computePlaytestTimeoutMs('send_input_sequence', 60000, 10000)).toBe(65000);
    // 即时输入方法不受影响(send_key 保持原值)
    expect(computePlaytestTimeoutMs('send_key', 60000, 10000)).toBe(10000);
  });

  it('game-bridge 与 qa/runner 两调用点均走 computePlaytestTimeoutMs(不再内联公式)', () => {
    expect(TS_BRIDGE_SRC).toContain('const timeout = computePlaytestTimeoutMs(method, params.wall_budget_ms, rawTimeout)');
    expect(QA_RUNNER_SRC).toContain('computePlaytestTimeoutMs(step.method, step.params.wall_budget_ms, o.step_timeout_ms)');
    // 内联公式已删(防两套并存回潮)
    expect(TS_BRIDGE_SRC).not.toContain('Math.max(timeout, wallBudget + 10000)');
    expect(QA_RUNNER_SRC).not.toContain('Math.max(inputTimeout, wallBudget + 10000)');
  });
});

describe('H1 qa 套件 schema 接受 send_input_sequence', () => {
  const baseSuite = {
    name: 'h1-smoke',
    steps: [
      { type: 'freeze' as const },
      {
        type: 'input' as const,
        method: 'send_input_sequence',
        params: {
          timeline: [
            { at_frame: 5, type: 'action', name: 'jump', pressed: true },
            { at_frame: 10, type: 'action', name: 'jump', pressed: false },
          ],
          settle_frames: 3,
        },
        label: 'tap jump',
      },
      { type: 'unfreeze' as const },
    ],
  };

  it('合法套件通过校验', () => {
    const parsed = QaSuiteSchema.safeParse(baseSuite);
    expect(parsed.success).toBe(true);
  });

  it('未知 input method 被拒(负向,防枚举漂移静默放开)', () => {
    const bad = structuredClone(baseSuite);
    (bad.steps[1] as { method: string }).method = 'send_nonexistent';
    expect(QaSuiteSchema.safeParse(bad).success).toBe(false);
  });
});

describe('H1 mcp_bridge.gd 契约(文本级,防关键结构被误删)', () => {
  it('dispatch 注册 send_input_sequence', () => {
    expect(GD_SRC).toContain('"send_input_sequence":');
  });

  it('_cmd_control_input_sequence owner 互斥(第 4 处 control owner 校验)', () => {
    // freeze/unfreeze/step_until/input_sequence 四命令各一处
    const matches = GD_SRC.match(/control layer held by another session/g);
    expect(matches?.length).toBeGreaterThanOrEqual(4);
  });

  it('at_frame 下限 1(0 非法,登记帧不计数语义)', () => {
    expect(GD_SRC).toContain('at_f < 1 or at_f > _INPUT_SEQ_MAX_AT_FRAME');
  });

  it('事件类型六类 + 深预检(key 解析/InputMap 存在性)', () => {
    expect(GD_SRC).toContain('const _INPUT_SEQ_TYPES := ["action", "key", "mouse_click", "mouse_move", "touch", "drag"]');
    expect(GD_SRC).toContain('_key_from_string(str(e.get("key", ""))) == 0');
    expect(GD_SRC).toContain('InputMap.has_action(str(e.get("name", "")))');
  });

  it('事件上限 256 / at_frame 上限 600 / settle 上限 600 / wall clamp 50s(D-5 同款)', () => {
    expect(GD_SRC).toContain('const _INPUT_SEQ_MAX_EVENTS := 256');
    expect(GD_SRC).toContain('const _INPUT_SEQ_MAX_AT_FRAME := 600');
    expect(GD_SRC).toContain('const _INPUT_SEQ_MAX_SETTLE := 600');
  });

  it('注入复用 _cmd_send_*(零重复实现)', () => {
    expect(GD_SRC).toContain('return _cmd_send_key(ev)');
    expect(GD_SRC).toContain('return _cmd_send_drag(ev)');
  });

  it('unfreeze 与 owner 断线两路径均清 input_seq pending(D-1 对称)', () => {
    const matches = GD_SRC.match(/_control_input_seq_pending\.clear\(\)/g);
    expect(matches?.length).toBe(2);
  });

  it('step_until paused 原值还原条件纳入 input_seq pending(双开窗者互斥还原)', () => {
    expect(GD_SRC).toContain('_control_step_until_pending.is_empty() and _control_input_seq_pending.is_empty() and not _control_frozen');
  });

  it('两条开窗完成路径的还原条件计数锁定(审查 N-2:防 includes 对相同字符串只锁任一)', () => {
    // step_until(:317)与 input_sequence(:378)完成路径的 elif 还原分支字符串互含,
    // includes 只锁一处;计数断言防对称分支被误删而不红
    const matches = GD_SRC.match(/_control_input_seq_pending\.is_empty\(\) and not _control_frozen/g);
    expect(matches?.length).toBe(2);
  });

  it('qa runner 判 result 层软失败(审查 I-1:wall_timeout 截断不得报 PASSED)', () => {
    expect(QA_RUNNER_SRC).toContain('seqResult.success === false');
  });

  it('_process 轮询块存在(applied 如实上报 + wall_timeout 语义)', () => {
    expect(GD_SRC).toContain('H1 (2026-08-20) input_sequence 轮询');
    expect(GD_SRC).toContain('"wall_timeout": bool(isq_entry.get("_wall_timeout", false))');
    expect(GD_SRC).toContain('"refrozen": bool(isq_entry.get("refreeze", false))');
  });
});
