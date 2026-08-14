import { describe, it, expect, vi } from 'vitest';
import type { ToolResult, MiddlewareResult, DispatchContext, Middleware } from '../../src/types.js';
import { executeMiddleware, createConnectionCheckMiddleware, createElicitationMiddleware } from '../../src/core/middleware.js';
import { textResult, errorResult } from '../../src/types.js';
import type { Tool } from "@modelcontextprotocol/server";
import type { RequestedSchema } from '../../src/core/elicit.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(toolName = 'test_tool'): DispatchContext {
  return { toolName, args: {}, startTime: Date.now(), phase: 'before' };
}

function pass(): MiddlewareResult {
  return { passed: true };
}

function reject(msg: string): MiddlewareResult {
  return { rejected: true, error: errorResult(msg) };
}

// ─── Pipeline executor ────────────────────────────────────────────────────────

describe('executeMiddleware', () => {
  it('passes through with empty middleware list', async () => {
    const result = await executeMiddleware([], makeCtx(), async () => textResult('ok'));
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' });
    expect(result.isError).toBeFalsy();
  });

  it('executes tool when all before hooks pass', async () => {
    const mw: Middleware = {
      name: 'pass-all',
      before: async () => pass(),
    };
    const toolFn = vi.fn().mockResolvedValue(textResult('done'));

    const result = await executeMiddleware([mw], makeCtx(), toolFn);

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(result.content[0]).toEqual({ type: 'text', text: 'done' });
  });

  it('stops before-chain on first rejection and skips tool execution', async () => {
    const mw2Called = vi.fn();
    const mw1: Middleware = {
      name: 'rejector',
      before: async () => reject('blocked'),
    };
    const mw2: Middleware = {
      name: 'should-not-run',
      before: async () => { mw2Called(); return pass(); },
    };
    const toolFn = vi.fn().mockResolvedValue(textResult('done'));

    const result = await executeMiddleware([mw1, mw2], makeCtx(), toolFn);

    expect(mw2Called).not.toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it('runs all after hooks even when before was rejected', async () => {
    const afterResults: string[] = [];

    const mw1: Middleware = {
      name: 'rejector',
      before: async () => reject('nope'),
      after: async (_ctx, result) => {
        afterResults.push('mw1-after');
        return result;
      },
    };
    const mw2: Middleware = {
      name: 'observer',
      before: async () => pass(),
      after: async (_ctx, result) => {
        afterResults.push('mw2-after');
        return result;
      },
    };
    const toolFn = vi.fn().mockResolvedValue(textResult('done'));

    await executeMiddleware([mw1, mw2], makeCtx(), toolFn);

    // Both after hooks must run
    expect(afterResults).toEqual(['mw1-after', 'mw2-after']);
    expect(toolFn).not.toHaveBeenCalled();
  });

  it('allows after hooks to modify result', async () => {
    const mw: Middleware = {
      name: 'modifier',
      before: async () => pass(),
      after: async (_ctx, _result) => textResult('modified!'),
    };

    const result = await executeMiddleware([mw], makeCtx(), async () => textResult('original'));

    expect(result.content[0]).toEqual({ type: 'text', text: 'modified!' });
  });

  it('silently catches after hook errors', async () => {
    const mw: Middleware = {
      name: 'throwing-after',
      before: async () => pass(),
      after: async () => { throw new Error('after boom'); },
    };

    // Should not throw — the error is silently caught
    const result = await executeMiddleware([mw], makeCtx(), async () => textResult('ok'));

    // Result should be from tool execution (after hook threw, so its modification is lost)
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' });
  });

  it('catches before hook throws as rejection', async () => {
    const mw: Middleware = {
      name: 'throwing-before',
      before: async () => { throw new Error('before boom'); },
    };

    const result = await executeMiddleware([mw], makeCtx(), async () => textResult('ok'));

    expect(result.isError).toBe(true);
    // G2 PII 护栏: catch 用 classifyError 的 safeMessage,不外泄 err.message('before boom')
    const beforeText = (result.content[0] as { type: string; text: string }).text;
    expect(beforeText).toContain('Internal error');
    expect(beforeText).not.toContain('before boom');
  });

  it('catches tool execution errors', async () => {
    const result = await executeMiddleware([], makeCtx(), async () => {
      throw new Error('tool crashed');
    });

    expect(result.isError).toBe(true);
    // G2 PII 护栏: 兜底 catch 用 safeMessage,不外泄 err.message('tool crashed')
    const execText = (result.content[0] as { type: string; text: string }).text;
    expect(execText).toContain('Internal error');
    expect(execText).not.toContain('tool crashed');
  });
});

// ─── createConnectionCheckMiddleware ──────────────────────────────────────────

describe('createConnectionCheckMiddleware', () => {
  it('rejects online-only tools when disconnected', async () => {
    const mw = createConnectionCheckMiddleware(
      () => false,  // disconnected
      (name) => name.startsWith('offline_'),  // only offline_ tools are ok
    );

    const result = await mw.before(makeCtx('editor_sync'));

    expect('rejected' in result && result.rejected).toBe(true);
  });

  it('allows offline-capable tools when disconnected', async () => {
    const mw = createConnectionCheckMiddleware(
      () => false,  // disconnected
      (name) => name.startsWith('offline_'),
    );

    const result = await mw.before(makeCtx('offline_read'));

    expect('passed' in result && result.passed).toBe(true);
  });

  it('allows all tools when connected', async () => {
    const mw = createConnectionCheckMiddleware(
      () => true,   // connected
      () => false,  // nothing is offline-capable
    );

    const result = await mw.before(makeCtx('editor_sync'));

    expect('passed' in result && result.passed).toBe(true);
  });

  it('integrates with pipeline — blocks disconnected online tool', async () => {
    const mw = createConnectionCheckMiddleware(
      () => false,
      () => false,
    );
    const toolFn = vi.fn().mockResolvedValue(textResult('done'));

    const result = await executeMiddleware([mw], makeCtx('some_tool'), toolFn);

    expect(toolFn).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});

// ─── createElicitationMiddleware ───────────────────────────────────────────────

describe('elicitation middleware', () => {
  const makeToolDef = (required: string[]): Tool => ({
    name: 'test_tool',
    description: 'test',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string' },
        action: { type: 'string' },
      },
      required,
    },
  });

  it('passes when all required params provided', async () => {
    const mw = createElicitationMiddleware(
      () => makeToolDef(['project_path', 'action']),
      () => null,
    );
    const result = await mw.before({
      toolName: 'test_tool', args: { project_path: '/tmp', action: 'get' },
      startTime: Date.now(), phase: 'before',
    });
    expect('passed' in result && result.passed).toBe(true);
  });

  it('returns MISSING_PARAM when client lacks elicitation', async () => {
    const mw = createElicitationMiddleware(
      () => makeToolDef(['project_path']),
      () => null,
    );
    const result = await mw.before({
      toolName: 'test_tool', args: {},
      startTime: Date.now(), phase: 'before',
    });
    expect('rejected' in result && result.rejected).toBe(true);
  });

  it('passes when tool def not found', async () => {
    const mw = createElicitationMiddleware(() => null, () => null);
    const result = await mw.before({
      toolName: 'unknown', args: {},
      startTime: Date.now(), phase: 'before',
    });
    expect('passed' in result && result.passed).toBe(true);
  });

  it('fills missing params from elicitation', async () => {
    let capturedSchema: RequestedSchema | null = null;
    const mw = createElicitationMiddleware(
      () => makeToolDef(['project_path']),
      async (requestedSchema, _message) => {
        capturedSchema = requestedSchema;
        return { project_path: '/filled' };
      },
    );
    const ctx = {
      toolName: 'test_tool', args: {},
      startTime: Date.now(), phase: 'before',
    };
    const result = await mw.before(ctx);
    expect('passed' in result && result.passed).toBe(true);
    expect(ctx.args.project_path).toBe('/filled');
    expect(capturedSchema).toEqual({
      type: 'object',
      properties: { project_path: { type: 'string' } },
      required: ['project_path'],
    });
  });

  it('elicitation does not mutate original args object', async () => {
    const toolDef = {
      name: 'test_tool',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          project_path: { type: 'string' },
        },
        required: ['action', 'project_path'],
      },
    };
    const elicitFn = vi.fn().mockResolvedValue({ project_path: '/test' });
    const mw = createElicitationMiddleware(() => toolDef as any, elicitFn);

    const originalArgs = { action: 'ping' };
    const ctx = { toolName: 'test_tool', args: originalArgs, startTime: Date.now(), phase: 'before' as const };

    process.env.GODOT_MCP_ELICITATION = 'true';
    await mw.before(ctx);
    delete process.env.GODOT_MCP_ELICITATION;

    expect(originalArgs).not.toHaveProperty('project_path');
    expect(ctx.args).toHaveProperty('project_path', '/test');
  });

  it('constructs requestedSchema with type/enum from inputSchema', async () => {
    let capturedSchema: RequestedSchema | null = null;
    const mw = createElicitationMiddleware(
      () => ({
        name: 'test_tool',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['a', 'b'] },
            count: { type: 'number' },
          },
          required: ['mode', 'count'],
        },
      }) as any,
      async (schema) => { capturedSchema = schema; return { mode: 'a', count: 1 }; },
    );
    await mw.before({ toolName: 'test_tool', args: {}, startTime: Date.now(), phase: 'before' });
    expect(capturedSchema).not.toBeNull();
    expect(capturedSchema!.properties.mode).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(capturedSchema!.properties.count).toEqual({ type: 'number' });
    expect(capturedSchema!.required).toEqual(['mode', 'count']);
  });

  it('fills empty-string required param from elicitation (regression: value must not be dropped)', async () => {
    // P1 回归（middleware.ts:184）：required primitive 传 '' 占位（key 存在但空），
    // elicitFn 返回的真实值必须覆盖空值。原 bug：apply 条件 !(key in safeArgs) 使填入值被吞，
    // 工具仍用 '' 执行 —— elicitation 在最常见的「空值占位」场景完全失效。
    const mw = createElicitationMiddleware(
      () => makeToolDef(['project_path']),
      async () => ({ project_path: '/filled' }),
    );
    const ctx = {
      toolName: 'test_tool', args: { project_path: '' },
      startTime: Date.now(), phase: 'before',
    };
    const result = await mw.before(ctx);
    expect('passed' in result && result.passed).toBe(true);
    expect(ctx.args.project_path).toBe('/filled');
  });
});
