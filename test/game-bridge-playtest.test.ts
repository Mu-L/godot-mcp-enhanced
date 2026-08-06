import { describe, it, expect } from 'vitest';
import { PLAYTEST_METHODS, getToolDefinitions, TOOL_META } from '../src/tools/game-bridge.js';

// P2-4 确定性 playtest 单测:验证 method Set / action 注册 / actionRisks 声明
// (bridge 运行时行为靠 GD 侧 mcp_bridge.gd,TS 侧只测路由与元数据)

describe('P2-4 game_playtest method set', () => {
  it('PLAYTEST_METHODS 含 5 个确定性原语', () => {
    expect(PLAYTEST_METHODS.has('playtest.seed')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.fixed_delta')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.snapshot')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.restore')).toBe(true);
    expect(PLAYTEST_METHODS.has('playtest.step')).toBe(true);
    expect(PLAYTEST_METHODS.size).toBe(5);
  });

  it('playtest.seed/fixed_delta/step 与 snapshot/restore 命名一致性(点分)', () => {
    for (const m of PLAYTEST_METHODS) {
      expect(m).toMatch(/^playtest\.[a-z_]+$/);
    }
  });
});

describe('P2-4 game_playtest tool registration', () => {
  const tools = getToolDefinitions();
  const tool = tools[0];

  it('action enum 含 game_playtest', () => {
    expect(tool.inputSchema.properties.action.enum).toContain('game_playtest');
  });

  it('method 描述含 playtest 5 原语', () => {
    const desc = tool.inputSchema.properties.method.description;
    expect(desc).toContain('playtest.seed');
    expect(desc).toContain('playtest.fixed_delta');
    expect(desc).toContain('playtest.step');
    expect(desc).toContain('playtest.snapshot');
    expect(desc).toContain('playtest.restore');
  });

  it('工具描述含 P2-4 确定性 playtest', () => {
    expect(tool.description).toContain('确定性 playtest');
    expect(tool.description).toContain('game_playtest');
  });
});

describe('P2-4 game_playtest actionRisks', () => {
  it('game_playtest 标为 process(改引擎时间/帧推进)', () => {
    expect(TOOL_META.game.actionRisks?.game_playtest).toBe('process');
  });

  it('install_override/uninstall_override 标为 write(P2-1 同批)', () => {
    expect(TOOL_META.game.actionRisks?.install_override).toBe('write');
    expect(TOOL_META.game.actionRisks?.uninstall_override).toBe('write');
  });
});
