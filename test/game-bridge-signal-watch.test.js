import { describe, it, expect, beforeEach } from 'vitest';
import { getToolDefinitions, handleTool, resetBridgeState } from '../src/tools/game-bridge.js';

describe('game-bridge signal watch', () => {
  beforeEach(() => {
    resetBridgeState();
  });

  describe('tool registration', () => {
    it('should register watch_start/stop/poll in ACTIONS enum', () => {
      const tools = getToolDefinitions();
      const gameTool = tools.find(t => t.name === 'game');
      const actions = gameTool.inputSchema.properties.action.enum;
      expect(actions).toContain('watch_start');
      expect(actions).toContain('watch_stop');
      expect(actions).toContain('watch_poll');
    });

    it('should include signal_name and max_events in inputSchema', () => {
      const tools = getToolDefinitions();
      const gameTool = tools.find(t => t.name === 'game');
      const props = gameTool.inputSchema.properties;
      expect(props.signal_name).toBeDefined();
      expect(props.max_events).toBeDefined();
    });
  });

  // Imp-13 (2026-06-24 审查): 删除假测试——watch.start params validation(自构造 params 断言)
  // 和 watch event response schema(自构造 response 断言其字段),均不调产品代码、恒真零保护。保留 tool registration + handler。

  describe('watch handler', () => {
    it('should reject watch_start without node_path', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test',
        action: 'watch_start',
        signal_name: 'pressed',
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('node_path is required');
    });

    it('should reject watch_start without signal_name', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test',
        action: 'watch_start',
        node_path: 'root/Button',
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('signal_name is required');
    });

    it('should handle watch_start when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-watch',
        action: 'watch_start',
        node_path: '/root/Button',
        signal_name: 'pressed',
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.isError).toBe(true);  // 739: catch 兜底设 isError(原 textResult 缺)
      expect(result.content[0].text).toContain('error_code');  // 结构化 opsErrorResult(非 textResult)
    });

    it('should handle watch_stop when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-watch',
        action: 'watch_stop',
      }, { opsScript: '' });
      expect(result).toBeDefined();
    });

    it('should handle watch_poll when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-watch',
        action: 'watch_poll',
      }, { opsScript: '' });
      expect(result).toBeDefined();
    });
  });
});
