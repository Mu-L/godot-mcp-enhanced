import { describe, it, expect, beforeEach } from 'vitest';
import { getToolDefinitions, handleTool, resetBridgeState } from '../src/tools/game-bridge.js';

describe('game-bridge UI discovery', () => {
  beforeEach(() => {
    resetBridgeState();
  });

  describe('tool registration', () => {
    it('should register find_ui_elements and click_button in ACTIONS', () => {
      const tools = getToolDefinitions();
      const gameTool = tools.find(t => t.name === 'game');
      const actions = gameTool.inputSchema.properties.action.enum;
      expect(actions).toContain('find_ui_elements');
      expect(actions).toContain('click_button');
    });

    it('should include UI-related properties in inputSchema', () => {
      const tools = getToolDefinitions();
      const gameTool = tools.find(t => t.name === 'game');
      const props = gameTool.inputSchema.properties;
      expect(props.pattern).toBeDefined();
      expect(props.type).toBeDefined();
      expect(props.visible_only).toBeDefined();
      expect(props.limit).toBeDefined();
      expect(props.text).toBeDefined();
      expect(props.path).toBeDefined();
    });
  });

  // Imp-13 (2026-06-24 审查): 删除假测试——find_ui_elements/click_button response schema(自构造 response 断言其字段)
  // 和 UI type extraction(自构造 types 字典断言),均不调产品代码、恒真零保护。保留 tool registration + handler。

  describe('handler', () => {
    it('should reject click_button without text or path', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test',
        action: 'click_button',
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('text');
    });

    it('should handle find_ui_elements when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-ui',
        action: 'find_ui_elements',
      }, { opsScript: '' });
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('Error');
    });

    it('should handle click_button when bridge is unavailable', async () => {
      const result = await handleTool('game', {
        project_path: '/tmp/test-ui',
        action: 'click_button',
        text: 'Start',
      }, { opsScript: '' });
      expect(result).toBeDefined();
    });
  });
});
