import { describe, it, expect, beforeEach } from 'vitest';
import { getToolDefinitions, handleTool, resetBridgeState } from '../src/tools/game-bridge.js';

describe('game-bridge monitor', () => {
  beforeEach(() => {
    resetBridgeState();
  });

  describe('tool registration', () => {
    it('should register monitor_start/stop/poll in ACTIONS enum', () => {
      const tools = getToolDefinitions();
      const gameTool = tools.find(t => t.name === 'game');
      expect(gameTool).toBeDefined();
      const actions = gameTool.inputSchema.properties.action.enum;
      expect(actions).toContain('monitor_start');
      expect(actions).toContain('monitor_stop');
      expect(actions).toContain('monitor_poll');
    });

    it('should include node_path, properties, interval_frames in inputSchema', () => {
      const tools = getToolDefinitions();
      const gameTool = tools.find(t => t.name === 'game');
      const props = gameTool.inputSchema.properties;
      expect(props.node_path).toBeDefined();
      expect(props.properties).toBeDefined();
      expect(props.interval_frames).toBeDefined();
    });
  });

  // Imp-13 (2026-06-24 审查): 删除假测试——monitor.start command generation(自构造 params 断言 ?? 运算符)
  // 和 monitor response validation(自构造 response 断言其字段),均不调产品代码、恒真零保护。保留 tool registration + handler。

  describe('monitor handler', () => {
    it('should return null for non-game tools', async () => {
      const result = await handleTool('other_tool', {}, { opsScript: '' });
      expect(result).toBeNull();
    });

    it('should reject monitor_start without node_path', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test',
        action: 'monitor_start',
        properties: ['position'],
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('node_path is required');
    });

    it('should reject monitor_start without properties', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test',
        action: 'monitor_start',
        node_path: 'root/Player',
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('non-empty array');
    });

    it('should reject monitor_start with empty properties array', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test',
        action: 'monitor_start',
        node_path: 'root/Player',
        properties: [],
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('non-empty array');
    });

    it('should handle monitor_start when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-monitor',
        action: 'monitor_start',
        node_path: '/root/Player',
        properties: ['position'],
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('Error');
    });

    it('should handle monitor_stop when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-monitor',
        action: 'monitor_stop',
      }, { opsScript: '' });
      expect(result).toBeDefined();
    });

    it('should handle monitor_poll when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-monitor',
        action: 'monitor_poll',
      }, { opsScript: '' });
      expect(result).toBeDefined();
    });
  });
});
