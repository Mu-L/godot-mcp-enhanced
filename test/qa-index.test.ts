// test/qa-index.test.ts — qa 工具入口层参数校验（含审查 Important-1 的 spec_path 白名单）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// runner mock：入口层测试不触执行链（INVALID_* 分支都在 runner 之前返回）
vi.mock('../src/tools/qa/runner.js', () => ({
  runQaSuite: vi.fn(),
}));

import { handleTool } from '../src/tools/qa/index.js';

function parse(res: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  return JSON.parse(res.content[0]!.text!) as Record<string, unknown>;
}

describe('qa handleTool 入口校验', () => {
  let allowedRoot: string;
  const prevAllowed = process.env.ALLOWED_PROJECT_PATHS;
  const prevUnrestricted = process.env.GODOT_MCP_UNRESTRICTED;

  beforeEach(() => {
    allowedRoot = mkdtempSync(join(tmpdir(), 'qa-idx-'));
    process.env.ALLOWED_PROJECT_PATHS = allowedRoot;
    delete process.env.GODOT_MCP_UNRESTRICTED; // UNRESTRICTED 是显式逃生口，白名单用例须排除
    process.env.GODOT_MCP_QA_REPORTS_DIR = mkdtempSync(join(tmpdir(), 'qa-idx-reports-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(allowedRoot, { recursive: true, force: true });
    if (prevAllowed === undefined) delete process.env.ALLOWED_PROJECT_PATHS;
    else process.env.ALLOWED_PROJECT_PATHS = prevAllowed;
    if (prevUnrestricted === undefined) delete process.env.GODOT_MCP_UNRESTRICTED;
    else process.env.GODOT_MCP_UNRESTRICTED = prevUnrestricted;
  });

  const ctx = {} as Parameters<typeof handleTool>[2];

  it('unknown action → UNKNOWN_ACTION', async () => {
    const r = await handleTool('qa', { action: 'nope' }, ctx);
    expect(parse(r!)).toMatchObject({ error_code: 'UNKNOWN_ACTION' });
  });

  it('run 无 spec/spec_path → INVALID_PARAMS', async () => {
    const r = await handleTool('qa', { action: 'run' }, ctx);
    expect(parse(r!)).toMatchObject({ error_code: 'INVALID_PARAMS' });
  });

  it('安全（审查 Important-1）：spec_path 白名单外 → INVALID_PATH 且不读文件', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'qa-outside-'));
    writeFileSync(join(outside, 'spec.json'), JSON.stringify({ name: 'x', steps: [{ type: 'sleep', ms: 100 }] }));
    const r = await handleTool('qa', { action: 'run', spec_path: join(outside, 'spec.json') }, ctx);
    expect(parse(r!)).toMatchObject({ error_code: 'INVALID_PATH' });
    rmSync(outside, { recursive: true, force: true });
  });

  it('spec_path 白名单内但非法 JSON → INVALID_SPEC（源格式错误，不进 zod）', async () => {
    const badSpec = join(allowedRoot, 'bad.json');
    writeFileSync(badSpec, 'not json at all', 'utf-8');
    const r = await handleTool('qa', { action: 'run', spec_path: badSpec }, ctx);
    const j = parse(r!);
    expect(j.error_code).toBe('INVALID_SPEC');
    expect(String(j.error)).toContain('qa-spec'); // extractSpecJson 的源格式错误消息
  });

  it('inline spec 缺 project_path → INVALID_PARAMS（在 runner 之前拦截）', async () => {
    const r = await handleTool('qa', {
      action: 'run',
      spec: { name: 'x', steps: [{ type: 'sleep', ms: 100 }] },
    }, ctx);
    expect(parse(r!)).toMatchObject({ error_code: 'INVALID_PARAMS' });
  });

  it('TOOL_NAMES 导出（C-1 归组对账契约）', async () => {
    const { TOOL_NAMES } = await import('../src/tools/qa/index.js');
    expect([...TOOL_NAMES]).toEqual(['qa']);
  });

  it('负向：入口层不消费 ctx 之外的执行面（spec 校验失败时 runner 零调用）', async () => {
    const { runQaSuite } = await import('../src/tools/qa/runner.js');
    await handleTool('qa', { action: 'run', spec: { steps: [] } }, ctx);
    expect(runQaSuite).not.toHaveBeenCalled();
    void resolve; // 保持 import 使用（Windows resolve 与 join 混用环境）
  });
});
