// Phase 1e 验证:healthSample middleware 把逻辑失败的 isError 写回客户端
// 对标 unity-mcp-server index.js:466-469
import { describe, it, expect, vi } from 'vitest';
import { ToolDispatcher } from '../../src/core/ToolDispatcher.js';
import { registerModule, setActiveGroups, type ToolModule } from '../../src/core/tool-registry.js';
import type { DispatcherOptions } from '../../src/core/ToolDispatcher.js';
import type { ReadOnlyGuard } from '../../src/core/ReadOnlyGuard.js';

function createMockGuard(): ReadOnlyGuard {
  return { check: vi.fn().mockReturnValue({ passed: true }) } as unknown as ReadOnlyGuard;
}

function createOptions(overrides?: Partial<DispatcherOptions>): DispatcherOptions {
  return {
    readOnly: false,
    mode: 'full',
    connectionMode: 'headless',
    noFallback: false,
    readOnlyGuard: createMockGuard(),
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn().mockResolvedValue('/fake/godot'),
    toolCallDelegate: vi.fn(),
    elicitFn: async () => ({ confirm: true }),
    ...overrides,
  };
}

describe('Phase 1e: isError write-back to client', () => {
  it('writes isError=true when handler returns {success:false} without isError flag', async () => {
    // mock 模块:返回 {success:false} 但不设 isError(模拟旧 handler / 未规范 handler)
    const mockModule: ToolModule = {
      getToolDefinitions() {
        return [{
          name: 'phase1e_test_tool',
          description: 'Tool that returns success:false',
          inputSchema: { type: 'object', properties: {} },
        }];
      },
      async handleTool(name) {
        if (name === 'phase1e_test_tool') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: 'logical failure', error_code: 'FAIL' }) }],
            // 关键:不设 isError(模拟旧 handler 行为)
          };
        }
        return null;
      },
    };
    registerModule(mockModule);
    setActiveGroups(new Set(['core', 'dynamic', 'full']));

    const dispatcher = new ToolDispatcher(createOptions());
    const result = await dispatcher.handleCall({
      params: { name: 'phase1e_test_tool', arguments: {} },
    });

    // Phase 1e 核心:healthSample middleware 应补打 isError:true
    expect(result.isError).toBe(true);
  });

  it('detects {ok:false} shape (unity compatibility)', async () => {
    const mockModule: ToolModule = {
      getToolDefinitions() {
        return [{
          name: 'phase1e_ok_false_tool',
          description: 'Tool returning ok:false',
          inputSchema: { type: 'object', properties: {} },
        }];
      },
      async handleTool(name) {
        if (name === 'phase1e_ok_false_tool') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, reason: 'failed' }) }],
          };
        }
        return null;
      },
    };
    registerModule(mockModule);

    const dispatcher = new ToolDispatcher(createOptions());
    const result = await dispatcher.handleCall({
      params: { name: 'phase1e_ok_false_tool', arguments: {} },
    });

    // {ok:false} 也应被识别为错误(unity 形态)
    expect(result.isError).toBe(true);
  });

  // 注:F-2 的负向验证(非首块 "Error:" 用户文本不被误判)在 response-format.test.ts
  // 以 isErrorText(text, { checkTextPrefix }) 单元测试覆盖 —— 那里可直接控制 checkTextPrefix,
  // 不受本集成层 project_path 注入失败(handler 未执行)的干扰。
});
