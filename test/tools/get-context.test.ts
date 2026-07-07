import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn(),
  setBridgeProjectDir: vi.fn(),
  isBridgeReady: vi.fn(),
}));

// Task 2: mock fs so readProject/readRules 可被 spyOn 精确控制（不真读盘）
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: string) => (actual as any).existsSync(p)),
    readFileSync: vi.fn((p: string, ...rest: any[]) => (actual as any).readFileSync(p, ...rest)),
    readdirSync: vi.fn((p: string) => (actual as any).readdirSync(p)),
  };
});

import { handleTool, getToolDefinitions, setGetContextConnectionProvider } from '../../src/tools/get-context.js';
import { getCallRecorder } from '../../src/core/call-recorder.js';
import { sendToBridge, setBridgeProjectDir } from '../../src/tools/game-bridge.js';
import type { ConnectionStatus } from '../../src/tools/manage-tools.js';
import type { ToolContext } from '../../src/types.js';
import * as fs from 'fs';

const fakeCs = (editor: Partial<ConnectionStatus['editor']> = {}): ConnectionStatus => ({
  editor: { installed: false, connected: false, state: null, ...editor } as ConnectionStatus['editor'],
  bridge: { note: '每请求建连' },
});

// 最小 ctx mock（执行者按 ToolContext 真实形状补全，参照 manage-tools.test.ts 的 ctx 装配）
function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    connectionMode: 'headless',
    ...overrides,
  } as ToolContext;
}

describe('godot_get_context', () => {
  beforeEach(() => getCallRecorder().reset());

  it('tool def has correct name + read-only meta', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('godot_get_context');
  });

  it('returns null for unknown tool', async () => {
    const result = await handleTool('other_tool', {}, mockCtx());
    expect(result).toBeNull();
  });

  it('returns ok status with session fields in headless mode', async () => {
    const result = await handleTool('godot_get_context', {}, mockCtx({ connectionMode: 'headless' }));
    expect(result).not.toBeNull();
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.status).toBe('ok');
    expect(payload.data.mode).toBe('headless');
    expect(payload.data.scene).toBeNull();           // headless 恒 null
    expect(payload.data.performance).toBeNull();      // 非 bridge
    expect(Array.isArray(payload.data.callStats)).toBe(false);
    expect(payload.data.callStats.total).toBeDefined();
    expect(Array.isArray(payload.data.toolGroups)).toBe(true);
    expect(Array.isArray(payload.data.workflows)).toBe(true);
  });

  it('include_scene=false skips scene', async () => {
    const result = await handleTool('godot_get_context', { include_scene: false }, mockCtx());
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.scene).toBeNull();
  });

  it('failed fields downgrade gracefully (status=partial)', async () => {
    // mock listPromptDefs 抛错 → workflows 进 failedFields
    // 注意：get-context.ts 顶部静态 import 了 listPromptDefs，doMock 必须配合
    // resetModules 强制 get-context.js 重新求值，否则拿到首次求值时的原绑定。
    vi.resetModules();
    vi.doMock('../../src/prompts.js', () => ({ listPromptDefs: () => { throw new Error('boom'); } }));
    const { handleTool: ht } = await import('../../src/tools/get-context.js');
    const result = await ht('godot_get_context', {}, mockCtx());
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.status).toBe('partial');
    expect(payload.data.failedFields).toContain('workflows');
    expect(payload.data.callStats.total).toBeDefined(); // 其余字段仍正常
    vi.doUnmock('../../src/prompts.js');
    vi.resetModules();
  });

  it('never throws — outer try/catch swallows', async () => {
    // 即使所有探测失败，工具仍返回 ok/partial，不抛
    const result = await handleTool('godot_get_context', {}, mockCtx());
    expect(result).not.toBeNull();
  });
});

describe('computeMode + readConnections real (Task 1)', () => {
  beforeEach(() => {
    getCallRecorder().reset();
    vi.clearAllMocks();
    setGetContextConnectionProvider(null);
  });

  it('mode=editor when connectionStatus editor connected', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: true }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx());
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.mode).toBe('editor');
  });

  it('mode=bridge when editor not connected but ping succeeds', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.mode).toBe('bridge');
    expect(setBridgeProjectDir).toHaveBeenCalledWith('/p');
  });

  it('mode=headless when editor off + ping fails', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no bridge'));
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.mode).toBe('headless');
  });

  it('connections.bridge.status=connected when ping ok', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.connections.bridge.status).toBe('connected');
  });

  it('no project_path + no ctx.projectDir → bridge ping skipped, mode degrades', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    const r = await handleTool('godot_get_context', {}, mockCtx());
    expect(sendToBridge).not.toHaveBeenCalled();
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.mode).toBe('headless');
  });
});

describe('readProject + readRules real (Task 2)', () => {
  beforeEach(() => {
    getCallRecorder().reset();
    vi.clearAllMocks();
    setGetContextConnectionProvider(null);
  });

  it('readProject returns name from project.godot + path, godot=null (no spawn)', async () => {
    const dir = 'D:/GitHub/godot-mcp-enhanced/test/fixtures/real-project'; // 已有 fixture
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('[application]\n\nconfig/name="TestGame"\n');
    setGetContextConnectionProvider(null);
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', { project_path: dir }, mockCtx());
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.project).toEqual({ name: 'TestGame', godot: null, path: dir });
  });

  it('readProject null when project.godot missing/unreadable', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', { project_path: '/nope' }, mockCtx());
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.project).toBeNull();
  });

  it('readRules returns .claude/rules/*.md basenames', async () => {
    const dir = '/some/project';
    // Windows path.join 用反斜杠，跨平台匹配两种分隔符
    vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
      const s = String(p).replace(/\\/g, '/');
      return s.includes('.claude/rules');
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['godot-mcp-core.md', 'godot-mcp-bridge.md'] as any);
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', { project_path: dir }, mockCtx());
    const rules = JSON.parse((r!.content[0] as { text: string }).text).data.rules;
    expect(rules).toEqual(['godot-mcp-core.md', 'godot-mcp-bridge.md']);
  });

  it('readRules [] when no project_path', async () => {
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', {}, mockCtx());
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.rules).toEqual([]);
  });
});
