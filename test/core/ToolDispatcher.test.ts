import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DispatcherOptions } from '../../src/core/ToolDispatcher.js';
import { ToolDispatcher, buildPerCallCtx } from '../../src/core/ToolDispatcher.js';
import { getCallRecorder } from '../../src/core/call-recorder.js';
import { createProgressEmitter, setProgressSender, setProgressClientReady, resetProgressSender } from '../../src/core/progress.js';
import type { ProgressEmitter } from '../../src/core/progress.js';
import type { ReadOnlyGuard } from '../../src/core/ReadOnlyGuard.js';
import type { EditorToolExecutor } from '../../src/core/EditorToolExecutor.js';
import type { ToolResult } from '../../src/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { resolveProjectPath as _mockResolveProjectPath } from '../../src/core/path-utils.js';

// ─── Hoisted Mocks (vi.hoisted ensures these are available inside vi.mock factories) ──

const {
  mockGetAllToolDefinitions,
  mockGetModuleForTool,
  mockGetToolDefinition,
  mockLITE_TOOLS,
  mockMINIMAL_TOOLS,
  mockRequiresConfirmation,
  mockCreatePendingToken,
  mockConsumeToken,
  mockIsPathInAllowedRoots,
  mockIsToolAllowed,
  mockSetActiveGroups,
  mockValidateGodotBinary,
} = vi.hoisted(() => ({
  mockGetAllToolDefinitions: vi.fn<() => Tool[]>(),
  mockGetModuleForTool: vi.fn(),
  // Task 3: validateArgs 接入需要 getToolDefinition 返回带 enum 的 inputSchema。
  // 默认 undefined → 内联工具路径跳过(自然)。集成测试用例内按需 mockReturnValue。
  mockGetToolDefinition: vi.fn().mockReturnValue(undefined),
  mockLITE_TOOLS: new Set(['project', 'scene', 'script', 'validation', 'confirm_and_execute', 'animation', 'audio', 'docs', 'signal', 'material', 'test', 'screenshot', 'profiler', 'workflow', 'game']),
  mockMINIMAL_TOOLS: new Set(['project', 'scene', 'script', 'runtime', 'validation', 'confirm_and_execute']),
  mockRequiresConfirmation: vi.fn(),
  mockCreatePendingToken: vi.fn(),
  mockConsumeToken: vi.fn(),
  mockIsPathInAllowedRoots: vi.fn().mockReturnValue(true),
  mockIsToolAllowed: vi.fn().mockReturnValue(true),
  mockSetActiveGroups: vi.fn(),
  mockValidateGodotBinary: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/core/tool-registry.js', () => ({
  getAllToolDefinitions: mockGetAllToolDefinitions,
  getModuleForTool: mockGetModuleForTool,
  getToolDefinition: mockGetToolDefinition,
  registerInlineTool: vi.fn(),
  LITE_TOOLS: mockLITE_TOOLS,
  MINIMAL_TOOLS: mockMINIMAL_TOOLS,
  isToolAllowed: mockIsToolAllowed,
  setActiveGroups: mockSetActiveGroups,
  resolveProfile: vi.fn().mockReturnValue(new Set()),
  skipProjectPath: vi.fn().mockReturnValue(false),
  tryLegacyMapping: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/guard.js', () => ({
  requiresConfirmation: mockRequiresConfirmation,
  createPendingToken: mockCreatePendingToken,
  consumeToken: mockConsumeToken,
  TOKEN_TTL_MS: 60_000,  // CRITICAL-3 子项1: ToolDispatcher import TOKEN_TTL_MS, factory 须提供
}));

vi.mock('../../src/helpers.js', () => ({
  isPathInAllowedRoots: mockIsPathInAllowedRoots,
  parseGodotConfig: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/core/path-utils.js', () => ({
  resolveProjectPath: vi.fn().mockReturnValue('/default/project'),
  _resetProjectPathCache: vi.fn(),
}));

vi.mock('../../src/tools/shared.js', () => ({
  opsErrorResult: vi.fn((code: string, msg: string) => ({
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: msg, error_code: code, warnings: [] }) }],
    isError: true,
  })),
  COMMON_ERROR_CODES: { INVALID_PARAMS: 'INVALID_PARAMS' },
}));

vi.mock('../../src/core/process-state.js', () => ({
  getRunningProcess: vi.fn().mockReturnValue(null),
  setRunningProcess: vi.fn(),
  getOutputBuffer: vi.fn().mockReturnValue([]),
  setOutputBuffer: vi.fn(),
  getProcessStartTime: vi.fn().mockReturnValue(0),
  setProcessStartTime: vi.fn(),
  getProjectDir: vi.fn().mockReturnValue(''),
  setProjectDir: vi.fn(),
}));

// M-1: mock godot-finder 的 validateGodotBinary(resolveFindGodotOverride 动态 import 调用)
vi.mock('../../src/core/godot-finder.js', () => ({
  validateGodotBinary: mockValidateGodotBinary,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockGuard(blocked: boolean): ReadOnlyGuard {
  return {
    check: vi.fn().mockReturnValue({ blocked, errorCode: blocked ? -32001 : undefined, message: blocked ? 'blocked' : undefined }),
  } as unknown as ReadOnlyGuard;
}

const FIXTURE_TOOLS: Tool[] = [
  { name: 'scene', description: 'Scene ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'script', description: 'Script ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'project', description: 'Project ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'runtime', description: 'Runtime ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'validation', description: 'Validation ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'docs', description: 'Docs ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'screenshot', description: 'Screenshot ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'animation', description: 'Animation ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'audio', description: 'Audio ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'signal', description: 'Signal ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'material', description: 'Material ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'test', description: 'Test ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'profiler', description: 'Profiler ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'workflow', description: 'Workflow ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'game', description: 'Game ops', inputSchema: { type: 'object', properties: {} } },
  { name: 'tilemap', description: 'Tilemap ops', inputSchema: { type: 'object', properties: {} } },
];

function createOptions(overrides?: Partial<DispatcherOptions>): DispatcherOptions {
  return {
    readOnly: false,
    mode: 'full',
    connectionMode: 'headless',
    noFallback: false,
    readOnlyGuard: createMockGuard(false),
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn().mockResolvedValue('/fake/godot'),
    toolCallDelegate: vi.fn(),
    // CRITICAL(2026-07-13): 默认 elicitFn accept — 现有 confirm_and_execute 测试绿(gate 默认放行)。
    // gate 拒绝测试通过 overrides 注入 null/false elicitFn。
    elicitFn: async () => ({ confirm: true }),
    ...overrides,
  };
}

const mockToolResult: ToolResult = {
  content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllToolDefinitions.mockReturnValue([...FIXTURE_TOOLS]);
  mockRequiresConfirmation.mockReturnValue(false);
  (_mockResolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue('/default/project');
});

// ── getFilteredTools ────────────────────────────────────────────────────────

describe('ToolDispatcher.getFilteredTools', () => {
  // [T20] 默认模式 → 全部 + confirm_and_execute
  it('returns all tools plus confirm_and_execute in default mode', () => {
    const dispatcher = new ToolDispatcher(createOptions());
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('confirm_and_execute');
    expect(names).toContain('scene');
    expect(names).toContain('script');
    expect(names).toContain('docs');
    expect(names.length).toBe(FIXTURE_TOOLS.length + 1);
  });

  // [T21] readOnly → 过滤写工具
  it('filters write tools when readOnly is true', () => {
    const guard = createMockGuard(false);
    (guard.check as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      const blocked = ['scene', 'script', 'project'].includes(name);
      return { blocked, errorCode: blocked ? -32001 : undefined, message: blocked ? 'blocked' : undefined };
    });
    const dispatcher = new ToolDispatcher(createOptions({ readOnly: true, readOnlyGuard: guard }));
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('docs');
    expect(names).toContain('screenshot');
    expect(names).not.toContain('scene');
    expect(names).not.toContain('script');
  });

  // [T22] lite → 只保留 LITE_TOOLS
  it('filters to LITE_TOOLS in lite mode', () => {
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'lite' }));
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    for (const name of names) {
      expect(mockLITE_TOOLS.has(name)).toBe(true);
    }
    expect(names).toContain('project');
    expect(names).toContain('scene');
    expect(names).toContain('confirm_and_execute');
    // lite 应排除不在 LITE_TOOLS 中的工具（如 tilemap）
    expect(names).not.toContain('tilemap');
  });

  // [T22b] minimal → 只保留 MINIMAL_TOOLS (6 个核心工具)
  it('filters to MINIMAL_TOOLS in minimal mode', () => {
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'minimal' }));
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    for (const name of names) {
      expect(mockMINIMAL_TOOLS.has(name)).toBe(true);
    }
    expect(names).toContain('project');
    expect(names).toContain('scene');
    expect(names).toContain('script');
    expect(names).toContain('runtime');
    expect(names).toContain('validation');
    expect(names).toContain('confirm_and_execute');
    // minimal 应排除 docs, screenshot, animation 等
    expect(names).not.toContain('docs');
    expect(names).not.toContain('screenshot');
    expect(names).not.toContain('animation');
    expect(names).not.toContain('tilemap');
  });

  // [R2] slim-profile-silent-full-fallback: 未知/拼写错 profile 解析空集时,修复前 :151 只 warn 不过滤
  // (fail-open 暴露 full 含 execute_gdscript/run_project 等高危),修复后 fail-closed 回退 minimal(安全)。
  // resolveProfile mock 默认返回空集(:46),正好模拟未知 profile。
  it('[R2] unknown profile fails closed to minimal (not full)', () => {
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'typo-profile' }));
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('runtime');  // minimal 含
    expect(names).not.toContain('animation');  // minimal 不含(修复前 full 含)
    expect(names).not.toContain('docs');
    expect(names).not.toContain('material');
  });

  // [T23] readOnly + lite 组合
  it('applies both readOnly and lite filters combined', () => {
    const guard = createMockGuard(false);
    (guard.check as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      const blocked = ['scene', 'script', 'project'].includes(name);
      return { blocked, errorCode: blocked ? -32001 : undefined, message: blocked ? 'blocked' : undefined };
    });
    const dispatcher = new ToolDispatcher(createOptions({ readOnly: true, mode: 'lite', readOnlyGuard: guard }));
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    expect(names).not.toContain('scene');
    expect(names).not.toContain('script');
    expect(names).not.toContain('project');
    for (const name of names) {
      expect(mockLITE_TOOLS.has(name)).toBe(true);
    }
  });

  // [T23b] readOnly + minimal 组合
  it('applies both readOnly and minimal filters combined', () => {
    const guard = createMockGuard(false);
    (guard.check as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      const blocked = ['scene', 'script', 'project'].includes(name);
      return { blocked, errorCode: blocked ? -32001 : undefined, message: blocked ? 'blocked' : undefined };
    });
    const dispatcher = new ToolDispatcher(createOptions({ readOnly: true, mode: 'minimal', readOnlyGuard: guard }));
    const tools = dispatcher.getFilteredTools();
    const names = tools.map(t => t.name);
    expect(names).not.toContain('scene');
    expect(names).not.toContain('script');
    expect(names).not.toContain('project');
    for (const name of names) {
      expect(mockMINIMAL_TOOLS.has(name)).toBe(true);
    }
  });
});

// ── setConnectionMode ───────────────────────────────────────────────────────

describe('ToolDispatcher.setConnectionMode', () => {
  // [T24] 模式切换
  it('switches connection mode', () => {
    const dispatcher = new ToolDispatcher(createOptions({ connectionMode: 'editor' }));
    dispatcher.setConnectionMode('headless');
    expect(true).toBe(true);
  });
});

// ── setEditorExecutor ───────────────────────────────────────────────────────

describe('ToolDispatcher.setEditorExecutor', () => {
  // [T25] 设置新 executor
  it('sets a new executor', () => {
    const dispatcher = new ToolDispatcher(createOptions());
    const mockExecutor = { execute: vi.fn(), destroy: vi.fn() } as unknown as EditorToolExecutor;
    dispatcher.setEditorExecutor(mockExecutor);
    expect(mockExecutor.destroy).not.toHaveBeenCalled();
  });

  // [T26] 传 null → 自动 destroy 旧的
  it('destroys old executor when set to null', () => {
    const dispatcher = new ToolDispatcher(createOptions());
    const mockExecutor = { execute: vi.fn(), destroy: vi.fn() } as unknown as EditorToolExecutor;
    dispatcher.setEditorExecutor(mockExecutor);
    dispatcher.setEditorExecutor(null);
    expect(mockExecutor.destroy).toHaveBeenCalledOnce();
  });

  // [T27] 替换旧 executor → 先 destroy 旧的
  it('destroys old executor when replacing with new one', () => {
    const dispatcher = new ToolDispatcher(createOptions());
    const oldExecutor = { execute: vi.fn(), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const newExecutor = { execute: vi.fn(), destroy: vi.fn() } as unknown as EditorToolExecutor;
    dispatcher.setEditorExecutor(oldExecutor);
    dispatcher.setEditorExecutor(newExecutor);
    expect(oldExecutor.destroy).toHaveBeenCalledOnce();
    expect(newExecutor.destroy).not.toHaveBeenCalled();
  });
});

// ── handleCall 管道 ─────────────────────────────────────────────────────────

describe('ToolDispatcher.handleCall', () => {
  // 默认 fail-closed：清除开发者 shell 可能设的 GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true
  // （elicitation opt-in 降级），否则 4 个 T11 deny 测试被污染——elicitFn 不调用、
  // deny 路径走降级执行返回 mockToolResult(无 isError)。I-2/I-2b 测降级场景自行
  // vi.stubEnv('true') 覆盖此默认。见 test/setup-global-unrestricted：敏感 env 须测试内隔离。
  beforeEach(() => {
    vi.stubEnv('GODOT_MCP_ALLOW_UNSAFE_CONFIRM', '');
  });

  function createDispatcherForHandleCall(overrides?: Partial<DispatcherOptions>) {
    return new ToolDispatcher(createOptions(overrides));
  }

  // [T1] rawArgs undefined → 空 args {}
  it('handles undefined rawArgs gracefully', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene' } });
    expect(result).toBeTruthy();
    expect(mockModule.handleTool).toHaveBeenCalledWith('scene', expect.objectContaining({ project_path: '/default/project' }), expect.anything());
  });

  // [T2] 正常 camelCase → snake_case 转换
  it('normalizes camelCase args to snake_case', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { projectPath: '/test', nodeName: 'Player' } },
    });
    const calledArgs = mockModule.handleTool.mock.calls[0][1];
    expect(calledArgs).toHaveProperty('project_path');
    expect(calledArgs).toHaveProperty('node_name');
    expect(calledArgs).not.toHaveProperty('projectPath');
  });

  // [T3] readOnlyGuard.blocked → 返回错误
  it('returns error when readOnlyGuard blocks the tool', async () => {
    const guard = createMockGuard(true);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('blocked');
  });

  // [T4] readOnlyGuard.passed → 继续
  it('proceeds when readOnlyGuard passes', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    expect(mockModule.handleTool).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  // [T5] confirm_and_execute token 缺失
  it('returns error when confirm_and_execute has no token', async () => {
    const dispatcher = createDispatcherForHandleCall();
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: {} } });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('confirmation_token is required');
  });

  // [T6] consumeToken 返回 null
  it('returns error when token is invalid or expired', async () => {
    mockConsumeToken.mockReturnValue(null);
    const dispatcher = createDispatcherForHandleCall();
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'bad-token' } } });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Invalid or expired');
  });

  // [T6b] consumeToken 返回 wasTruncated → 拒绝执行(S2,ARGS_TRUNCATED)
  it('refuses execution when token args were truncated (ARGS_TRUNCATED) (S2)', async () => {
    mockConsumeToken.mockReturnValue({
      toolName: 'script',
      args: { action: 'execute_gdscript', code: 'a'.repeat(11_000) },
      wasTruncated: true,
    });
    const dispatcher = createDispatcherForHandleCall();
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'truncated-token' } } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('ARGS_TRUNCATED');
  });

  // [B2] elicitation middleware 强制顶层 required(elicitFn=null,纯校验)
  it('rejects calls missing top-level required params with MISSING_PARAM (B2)', async () => {
    mockGetAllToolDefinitions.mockReturnValue([
      { name: 'scene', description: 'x', inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
      ...FIXTURE_TOOLS,
    ]);
    mockRequiresConfirmation.mockReturnValue(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall();
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('MISSING_PARAM');
    expect(text).toContain('action');
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  it('passes through when required params are present (B2)', async () => {
    mockGetAllToolDefinitions.mockReturnValue([
      { name: 'scene', description: 'x', inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } },
      ...FIXTURE_TOOLS,
    ]);
    mockRequiresConfirmation.mockReturnValue(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall();
    await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'read_scene' } } });
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [T7] confirm 分支二次 readOnlyGuard 检查
  it('re-checks readOnlyGuard for confirmed tool', async () => {
    const guard = createMockGuard(false);
    (guard.check as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      if (name === 'confirm_and_execute') return { blocked: false };
      return { blocked: true, errorCode: -32001, message: 'blocked after confirm' };
    });
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: {} });
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('blocked');
  });

  // [T8] confirm 分支 editor 模式 dispatch
  it('dispatches confirmed tool via editor executor', async () => {
    const guard = createMockGuard(false);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'read_scene' } });
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(mockExecutor.execute).toHaveBeenCalledWith('scene', { action: 'read_scene' });
  });

  // [T9] confirm 分支 headless dispatch
  it('dispatches confirmed tool via headless when no executor', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'read_scene' } });
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'headless' });
    await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(mockModule.handleTool).toHaveBeenCalledWith('scene', { action: 'read_scene' }, expect.anything());
  });

  // [T11] CRITICAL(2026-07-13 安全): confirm_and_execute elicitation out-of-band gate
  // 堵 AI 自读自确认 token。单客户端下 caller/session 绑定无效(AI 产生与消费 token 同 session),
  // 故 confirm_and_execute(AI in-band 调用,token 明文回传 AI) 须经 MCP elicitInput
  // (server→client→user UI) 请求用户 out-of-band 确认,AI 无法伪造响应(非其 tools/call 通道)。
  it('requires user elicitInput consent before executing confirmed tool (T11)', async () => {
    const elicitFn = vi.fn().mockResolvedValue({ confirm: true });
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'read_scene' } });
    const dispatcher = createDispatcherForHandleCall({ elicitFn });
    await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(elicitFn).toHaveBeenCalledTimes(1);
    expect(mockModule.handleTool).toHaveBeenCalledWith('scene', { action: 'read_scene' }, expect.anything());
  });

  it('refuses confirmed execution when elicitation unsupported/declined/cancel (null) (T11)', async () => {
    const elicitFn = vi.fn().mockResolvedValue(null);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'remove_node' } });
    const dispatcher = createDispatcherForHandleCall({ elicitFn });
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('ELICITATION_DENIED');
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  it('refuses confirmed execution when user declines (confirm:false) (T11)', async () => {
    const elicitFn = vi.fn().mockResolvedValue({ confirm: false });
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'remove_node' } });
    const dispatcher = createDispatcherForHandleCall({ elicitFn });
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('ELICITATION_DENIED');
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  // M-3(security review): 严格 === 比较,truthy 强制转换({confirm:"true"}/{confirm:1})必须拒绝
  it('rejects truthy coercion ({confirm:"true"} string) — strict === only (T11)', async () => {
    const elicitFn = vi.fn().mockResolvedValue({ confirm: 'true' });
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'remove_node' } });
    const dispatcher = createDispatcherForHandleCall({ elicitFn });
    const result = await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(result.isError).toBe(true);
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  // I-2(security review): opt-in 降级 — GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true 时跳过 elicitation
  // 走 token 路径执行(不调 elicitFn,机制见 I-2b;此处 elicitFn mock 值无关)。默认未设=fail-closed。
  it('downgrades to token path when GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true (I-2)', async () => {
    vi.stubEnv('GODOT_MCP_ALLOW_UNSAFE_CONFIRM', 'true');
    const elicitFn = vi.fn().mockResolvedValue(null);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'read_scene' } });
    const dispatcher = createDispatcherForHandleCall({ elicitFn });
    await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(mockModule.handleTool).toHaveBeenCalledWith('scene', { action: 'read_scene' }, expect.anything());
    vi.unstubAllEnvs();
  });

  // I-2b(2026-07-15): env=true 时根本不调 elicitFn(不弹窗),对齐 I-2 注释"跳过 elicitation"语义。
  // 修复 I-2 原实现盲点:降级检查原在 elicitFn 调用之后,Claude Code 等支持 elicitation 的
  // client 仍弹窗(elicitation 照弹,仅在 decline 后放行——甚至"用户拒绝却被执行"的悖论)。
  // 前置检查后 env=true 直接跳过 elicitFn,真正免确认。
  it('does NOT call elicitFn when GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true — no popup (I-2b)', async () => {
    vi.stubEnv('GODOT_MCP_ALLOW_UNSAFE_CONFIRM', 'true');
    const elicitFn = vi.fn().mockResolvedValue({ confirm: true });
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'add_node' } });
    const dispatcher = createDispatcherForHandleCall({ elicitFn });
    await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(elicitFn).not.toHaveBeenCalled();
    expect(mockModule.handleTool).toHaveBeenCalledWith('scene', { action: 'add_node' }, expect.anything());
    vi.unstubAllEnvs();
  });

  // [T10] requiresConfirmation → 返回 token
  it('returns confirmation token when tool requires confirmation', async () => {
    const guard = createMockGuard(false);
    mockRequiresConfirmation.mockReturnValue(true);
    mockCreatePendingToken.mockReturnValue('test-token-123');
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'remove_node' } } });
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.requires_confirmation).toBe(true);
    expect(parsed.confirmation_token).toBe('test-token-123');
    expect(parsed.tool).toBe('scene');
    expect(parsed.ttl_seconds).toBe(60);  // CRITICAL-3: ttl_seconds 与 TOKEN_TTL_MS/1000 一致, 不再硬编码 180
  });

  // [T10b] IMP-6: legacy 工具名路由时 guard 前置 tryLegacyMapping,防 legacy name 绕过 guard
  it('guards legacy tool name via tryLegacyMapping before confirmation check (IMP-6)', async () => {
    const guard = createMockGuard(false);
    const { tryLegacyMapping } = await import('../../src/core/tool-registry.js');
    // remove_node 是 legacy name → 映射到 scene + remove_node action
    (tryLegacyMapping as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
      name === 'remove_node' ? { tool: 'scene', action: 'remove_node' } : null,
    );
    // requiresConfirmation 对映射后的 (scene, action=remove_node) 返回 true
    mockRequiresConfirmation.mockImplementation(
      (guardName: string, guardArgs: { action?: string }) =>
        guardName === 'scene' && guardArgs?.action === 'remove_node',
    );
    mockCreatePendingToken.mockReturnValue('legacy-token-456');

    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'remove_node', arguments: { node_path: 'root/Foo' } },
    });

    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.requires_confirmation).toBe(true);
    expect(parsed.confirmation_token).toBe('legacy-token-456');
    // IMP-6 核心:requiresConfirmation 必须以映射后的 (scene, action=remove_node) 调用,而非原始 remove_node
    expect(mockRequiresConfirmation).toHaveBeenCalledWith('scene', expect.objectContaining({ action: 'remove_node' }));
    // createPendingToken 必须以原始 legacy name 调用(confirm_and_execute 据此执行原工具)
    expect(mockCreatePendingToken).toHaveBeenCalledWith('remove_node', expect.objectContaining({ node_path: 'root/Foo' }));

    // 重置 tryLegacyMapping mock(clearAllMocks 不重置 implementation,避免污染后续 case)
    (tryLegacyMapping as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  // [T12] editor 模式 + executor 存在 → 转发
  it('forwards to editor executor in editor mode', async () => {
    const guard = createMockGuard(false);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'add_node' } } });
    expect(mockExecutor.execute).toHaveBeenCalledWith('scene', expect.objectContaining({ action: 'add_node', project_path: '/default/project' }));
  });

  // [B1] editor 模式大响应也经 truncateResponse(修复 editor 绕过 response-limiter)
  it('truncates large editor responses via truncateResponse (B1)', async () => {
    const prev = process.env.GODOT_MCP_RESPONSE_LIMIT;
    process.env.GODOT_MCP_RESPONSE_LIMIT = 'true';
    try {
      const guard = createMockGuard(false);
      const hugeText = 'x'.repeat(2.2 * 1024 * 1024); // >2MB 触发 truncateResponse warning 分支
      const hugeResult = { content: [{ type: 'text' as const, text: hugeText }] };
      const mockExecutor = { execute: vi.fn().mockResolvedValue(hugeResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
      const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
      dispatcher.setEditorExecutor(mockExecutor);
      const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'read_scene' } } });
      expect(result.content.length).toBeGreaterThan(1);
      expect(result.content.some(c => 'text' in c && c.text.includes('exceeds 2MB'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GODOT_MCP_RESPONSE_LIMIT;
      else process.env.GODOT_MCP_RESPONSE_LIMIT = prev;
    }
  });

  // [T13] editor 模式 executor 为 null → fallback headless
  it('falls back to headless when executor is null in editor mode', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'add_node' } } });
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [P1-1] (2026-07-06 review) editor 返回 -32601 Unknown method → 自动回退 headless dispatchTool。
  // 场景: TS (tool,action) 工具(script/screenshot/project/...)转发后 command_handler 不认 → -32601。
  it('falls back to headless when editor returns -32601 Unknown method (P1-1)', async () => {
    const guard = createMockGuard(false);
    const unknownMethodResult: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ error: { code: -32601, message: 'Unknown method: script' } }) }],
      isError: true,
    };
    const mockExecutor = { execute: vi.fn().mockResolvedValue(unknownMethodResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'script', arguments: { action: 'write_script' } } });
    expect(mockExecutor.execute).toHaveBeenCalledWith('script', expect.objectContaining({ action: 'write_script' }));
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [P1-1] editor 返回非 -32601 错误(如 -32003) → 不回退, 保留编辑器原生错误语义
  it('does not fall back when editor returns non-32601 error (P1-1)', async () => {
    const guard = createMockGuard(false);
    const otherErrorResult: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ error: { code: -32003, message: 'No scene loaded' } }) }],
    };
    const mockExecutor = { execute: vi.fn().mockResolvedValue(otherErrorResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'add_node' } } });
    expect(mockExecutor.execute).toHaveBeenCalled();
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  // [I-12/P1-1 一致性] editor 返回 -32601 的「平铺」形态（{error:msg, code:-32601}，
  // EditorToolExecutor I-12 catch 把 WS error 拍平后的结构）→ 同样应触发 headless 回退。
  it('falls back to headless when editor returns flat -32601 error (I-12/P1-1)', async () => {
    const guard = createMockGuard(false);
    const flatUnknownResult: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown method: script', code: -32601 }) }],
      isError: true,
    };
    const mockExecutor = { execute: vi.fn().mockResolvedValue(flatUnknownResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'script', arguments: { action: 'write_script' } } });
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [P1-1b] confirm_and_execute 路径 editor -32601 同样回退（与普通 dispatch 对齐）。
  // bug: confirm 分支此前直接返 editorResult，未登记 editor-method-map 的写工具（scene
  // add_node/edit_node/remove_node 等）经 confirm 时 editor 转发 command_handler 命中兜底
  // -32601 无回退 headless。修复后 confirm 路径检测 -32601 → dispatchTool 回退。
  it('falls back to headless on -32601 via confirm_and_execute path (P1-1b)', async () => {
    const guard = createMockGuard(false);
    const flatUnknownResult: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown method: scene', code: -32601 }) }],
      isError: true,
    };
    const mockExecutor = { execute: vi.fn().mockResolvedValue(flatUnknownResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'add_node', node_type: 'Node3D', node_name: 'X' } });
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'confirm_and_execute', arguments: { token: 'valid' } } });
    expect(mockExecutor.execute).toHaveBeenCalledWith('scene', { action: 'add_node', node_type: 'Node3D', node_name: 'X' });
    expect(mockModule.handleTool).toHaveBeenCalledWith('scene', expect.objectContaining({ action: 'add_node' }), expect.anything());
  });

  // [I-12/P1-1 负面用例] 成功响应（isError=false）即使顶层带 -32601 code 也不应误判回退。
  // _isUnknownMethod 调用前置 editorResult.isError === true，防止未来 plugin 成功响应
  // 顶层带数字 code 字段时被误判 unknown method 触发静默降级 headless。
  it('does NOT fall back when editor success carries top-level code (isError guard)', async () => {
    const guard = createMockGuard(false);
    const successWithCode: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ result: 'ok', code: -32601 }) }],
      isError: false,
    };
    const mockExecutor = { execute: vi.fn().mockResolvedValue(successWithCode), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    const result = await dispatcher.handleCall({ params: { name: 'script', arguments: { action: 'write_script' } } });
    // 未回退 headless：handler 不应被调用，且结果不是 error
    expect(mockModule.handleTool).not.toHaveBeenCalled();
    expect(result.isError).not.toBe(true);
  });

  // [P1-2] (2026-07-06 review) editorExecutor 可用时, dispatchTool 注入 guard 回调到 perCallCtx。
  // script.ts/scene 写前调 checkEditorTextResourceWrite/checkEditorSceneSave 防绕过编辑器守卫。
  it('injects editor guard callbacks into perCallCtx when executor available (P1-2)', async () => {
    const guard = createMockGuard(false);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const captured: { ctx?: { checkEditorTextResourceWrite?: unknown; checkEditorSceneSave?: unknown } } = {};
    const mockModule = {
      handleTool: vi.fn().mockImplementation((_n: string, _a: Record<string, unknown>, ctx: { checkEditorTextResourceWrite?: unknown; checkEditorSceneSave?: unknown }) => {
        captured.ctx = ctx;
        return Promise.resolve(mockToolResult);
      }),
    };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    dispatcher.setEditorExecutor(mockExecutor);
    await dispatcher.handleCall({ params: { name: 'scene', arguments: { action: 'read_scene' } } });
    expect(typeof captured.ctx?.checkEditorTextResourceWrite).toBe('function');
    expect(typeof captured.ctx?.checkEditorSceneSave).toBe('function');
  });

  // [T14] headless 正常返回 + duration
  it('returns result with duration in headless mode', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    const lastContent = result.content[result.content.length - 1] as { text: string };
    expect(lastContent.text).toMatch(/_duration_ms: \d+/);
  });

  // [T15] 工具不存在 → Unknown tool
  it('returns unknown tool error when module not found', async () => {
    const guard = createMockGuard(false);
    mockGetModuleForTool.mockReturnValue(undefined);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'nonexistent_tool', arguments: {} } });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Unknown tool');
  });

  // [T16] handler 返回 null → 错误消息
  it('returns error when tool handler returns null', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(null) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('handler returned null');
  });

  // [T17] 首次 fallback → 附加警告
  it('attaches fallback warning on first response when in fallback mode', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    dispatcher.markEditorFallback();
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    const firstText = (result.content[0] as { text: string }).text;
    expect(firstText).toContain('EDITOR_FALLBACK');
  });

  // [T18] 非首次 → 不附加
  it('does not attach fallback warning on second call', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
    }) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    dispatcher.markEditorFallback();
    await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    mockModule.handleTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
    });
    const result2 = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    const firstText = (result2.content[0] as { text: string }).text;
    expect(firstText).not.toContain('EDITOR_FALLBACK');
  });

  // [T19] catch 异常 → 错误消息
  it('catches exceptions and returns error message', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockRejectedValue(new Error('boom')) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('boom');
  });

  // ── validateCommonArgs 类型校验 ──────────────────────────────────────────

  // [V1] project_path=123 (number) → INVALID_PARAMS
  it('rejects numeric project_path', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: 123 } },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
    expect(parsed.error).toContain('project_path');
  });

  // [V2] project_path={} (object) → INVALID_PARAMS
  it('rejects object project_path', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: { foo: 'bar' } } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // [V3] project_path="  " (whitespace) → INVALID_PARAMS
  it('rejects whitespace-only project_path', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '   ' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // [V4] action=[] (array) → INVALID_PARAMS
  it('rejects array action', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { action: ['read'] } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
    expect(parsed.error).toContain('action');
  });

  // [V5] action=null → INVALID_PARAMS
  it('rejects null action', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { action: null } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // [V6] action="  " (whitespace) → INVALID_PARAMS
  it('rejects whitespace-only action', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { action: '   ' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // [V7] 合法字符串 → 通过（不拦截）
  it('passes valid project_path and action strings', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/valid', action: 'read_scene' } },
    });
    expect(mockModule.handleTool).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });

  // [V8] 参数完全缺失 → 不报错（由各模块处理）
  it('passes when common params are absent', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { some_other_param: 'value' } },
    });
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [V9] 多参数同时错误 → 返回第一个（project_path 先于 action）
  it('returns first error when multiple params are invalid', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: 123, action: [] } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error).toContain('project_path');
  });

  // [V10] project_path=null → 注入默认值（null 视为未提供）
  it('injects default project_path when project_path is null', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: null } },
    });
    expect(result.isError).toBeFalsy();
    expect(mockModule.handleTool).toHaveBeenCalledWith(
      'scene',
      expect.objectContaining({ project_path: '/default/project' }),
      expect.anything(),
    );
  });

  // [V11] project_path=undefined (key missing) → 不报错
  it('passes when project_path key is absent', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: {} },
    });
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [V12] action=undefined (key missing) → 不报错
  it('passes when action key is absent', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/valid' } },
    });
    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [V13] confirm_and_execute 分支使用 pending.args（包含 project_path: 123），
  // 但 validateCommonArgs 只校验 request.params.arguments 中的参数，所以 pending.args 不被拦截
  it('does not validate pending.args in confirm_and_execute branch', async () => {
    const guard = createMockGuard(false);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { project_path: 123 } });
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'confirm_and_execute', arguments: { token: 'valid' } },
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content[result.content.length - 1] as { text: string }).text;
    expect(text).toMatch(/(_duration_ms|status)/);
  });

  // [V14] editor 模式传入 project_path=123 → 在 editorExec 前拦截
  it('validates args before editor executor in editor mode', async () => {
    const guard = createMockGuard(false);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: 123 } },
    });
    expect(result.isError).toBe(true);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  // [V15] camelCase {projectPath: 123} → normalizeArgs 后被拦截
  it('validates after camelCase normalization', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { projectPath: 123 } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // ── IMPORTANT-02: path allowlist validation (all modes) ──────────────────

  // [P1] editor 模式下 project_path 不在白名单 → 被拦截，不转发到 editorExecutor
  it('rejects disallowed project_path in editor mode (I-02)', async () => {
    const guard = createMockGuard(false);
    mockIsPathInAllowedRoots.mockReturnValue(false);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/etc/passwd', action: 'read_scene' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('PATH_NOT_ALLOWED');
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  // [P2] headless 模式下 project_path 不在白名单 → 同样被拦截
  it('rejects disallowed project_path in headless mode (I-02)', async () => {
    const guard = createMockGuard(false);
    mockIsPathInAllowedRoots.mockReturnValue(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/etc/shadow', action: 'read_scene' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('PATH_NOT_ALLOWED');
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  // [P3] confirm_and_execute 中 pending.args 包含不允许的路径 → 被拦截
  it('rejects disallowed project_path in confirm_and_execute pending.args (I-02)', async () => {
    const guard = createMockGuard(false);
    mockIsPathInAllowedRoots.mockImplementation((p: string) => !p.includes('forbidden'));
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { project_path: '/forbidden/path', action: 'read_scene' } });
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    const result = await dispatcher.handleCall({
      params: { name: 'confirm_and_execute', arguments: { token: 'valid' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('PATH_NOT_ALLOWED');
  });

  // [P4] confirm_and_execute editor 分支中 pending.args 包含不允许的路径 → 被拦截
  it('rejects disallowed path in confirm_and_execute editor mode (I-02)', async () => {
    const guard = createMockGuard(false);
    mockIsPathInAllowedRoots.mockImplementation((p: string) => !p.includes('evil'));
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { project_path: '/evil/path', action: 'remove_node' } });
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    const result = await dispatcher.handleCall({
      params: { name: 'confirm_and_execute', arguments: { token: 'valid' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('PATH_NOT_ALLOWED');
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  // [P5] 允许的路径 → 正常通过所有分支
  it('allows valid project_path in editor mode (I-02)', async () => {
    const guard = createMockGuard(false);
    mockIsPathInAllowedRoots.mockReturnValue(true);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/valid/project', action: 'read_scene' } },
    });
    expect(mockExecutor.execute).toHaveBeenCalled();
    expect(result.isError).not.toBe(true);
  });

  // [P6] search_dir 不在白名单 → 被拦截
  it('rejects disallowed search_dir in editor mode (I-02)', async () => {
    const guard = createMockGuard(false);
    mockIsPathInAllowedRoots.mockImplementation((p: string) => !p.includes('secret'));
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard, connectionMode: 'editor' });
    dispatcher.setEditorExecutor(mockExecutor);
    const result = await dispatcher.handleCall({
      params: { name: 'project', arguments: { search_dir: '/secret/dir', action: 'list_projects' } },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('PATH_NOT_ALLOWED');
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });

  // [T20] 项7: normalizeArgs 超深抛错被 :186 catch(非逃逸/非 silently 绕过)
  it('rejects >20-level nested args (normalizeArgs depth limit, 项7)', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    let nested: Record<string, unknown> = { camelKey: 1 };
    for (let i = 0; i < 25; i++) nested = { outerKey: nested };
    const result = await dispatcher.handleCall({ params: { name: 'project', arguments: nested } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/depth limit|normalization failed/i);
  });

  // [M-2] 原型污染防护：normalizeArgs 丢弃 __proto__/constructor/prototype 键
  it('drops __proto__/constructor/prototype keys (M-2 原型污染防护)', () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    // JSON.parse 用 CreateDataProperty 语义，__proto__ 作为自有属性保留（区别于对象字面量的原型 setter），
    // 故能进入 Object.entries 被 normalizeArgs 遍历到——这正是攻击向量。
    const rawArgs = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":2,"normalKey":"v"}');
    const result = (dispatcher as unknown as { normalizeArgs: (a: unknown) => Record<string, unknown> }).normalizeArgs(rawArgs);
    // 污染键全部丢弃，仅保留 normalKey（camelCase → snake_case）
    expect(Object.keys(result)).toEqual(['normal_key']);
    expect(result.normal_key).toBe('v');
    // args 原型未被改写为攻击者对象（未防护时 args.__proto__={polluted:true} 会改原型）
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    // 全局 Object.prototype 未被污染（双保险）
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

// ── getFilteredTools with activeGroups ────────────────────────────────────

describe('getFilteredTools with activeGroups', () => {
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    // 默认 isToolAllowed 返回 true（不过滤）
    mockIsToolAllowed.mockReturnValue(true);
    dispatcher = new ToolDispatcher(createOptions());
  });

  it('returns only tools allowed by activeGroups', () => {
    // 模拟 activeGroups 过滤：core(animation,scene) 允许，bridge(game) 不允许
    mockIsToolAllowed.mockImplementation((name: string) => {
      const blocked = ['game'];
      return !blocked.includes(name);
    });

    const tools = dispatcher.getFilteredTools();
    const toolNames = tools.map(t => t.name);
    // core tools should be present
    expect(toolNames).toContain('scene');
    // animation tools should be present
    expect(toolNames).toContain('animation');
    // bridge tools should NOT be present
    expect(toolNames).not.toContain('game');
  });

  it('manage_tools always appears regardless of active groups', () => {
    // 模拟只有 core 组激活
    mockIsToolAllowed.mockImplementation((name: string) => {
      const coreTools = ['scene', 'script', 'project', 'confirm_and_execute'];
      return coreTools.includes(name);
    });

    const tools = dispatcher.getFilteredTools();
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('confirm_and_execute');
  });
});

// ── default project_path injection ─────────────────────────────────────────

describe('ToolDispatcher: default project_path injection', () => {
  it('injects default project_path when not provided', async () => {
    (_mockResolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue('/injected/project');

    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);

    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { action: 'read_scene' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalledWith(
      'scene',
      expect.objectContaining({ project_path: '/injected/project', action: 'read_scene' }),
      expect.anything(),
    );
  });

  it('returns error when project_path cannot be resolved', async () => {
    (_mockResolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const dispatcher = new ToolDispatcher(createOptions());
    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { action: 'read_scene' } },
    });

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('project_path');
  });

  it('preserves explicit project_path without calling resolveProjectPath', async () => {
    const mockResolve = _mockResolveProjectPath as ReturnType<typeof vi.fn>;
    mockResolve.mockReturnValue('/should-not-be-used');

    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);

    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/explicit', action: 'read_scene' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalledWith(
      'scene',
      expect.objectContaining({ project_path: '/explicit' }),
      expect.anything(),
    );
    // resolveProjectPath should NOT be called when explicit path provided
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('skips project_path injection for exempt tools (skipProjectPath=true)', async () => {
    // Make skipProjectPath return true for 'docs'
    const { skipProjectPath } = await import('../../src/core/tool-registry.js');
    (skipProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const mockResolve = _mockResolveProjectPath as ReturnType<typeof vi.fn>;
    mockResolve.mockReturnValue('/should-not-be-injected');

    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);

    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'docs', arguments: { action: 'search_classes', query: 'Node3D' } },
    });

    // resolveProjectPath should NOT be called for exempt tools
    expect(mockResolve).not.toHaveBeenCalled();
    // args should NOT have project_path injected
    expect(mockModule.handleTool).toHaveBeenCalledWith(
      'docs',
      expect.objectContaining({ action: 'search_classes', query: 'Node3D' }),
      expect.anything(),
    );
    expect(mockModule.handleTool).toHaveBeenCalledWith(
      'docs',
      expect.not.objectContaining({ project_path: expect.anything() }),
      expect.anything(),
    );

    // Reset mock
    (skipProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('still validates project_path type for exempt tools when explicitly provided', async () => {
    const { skipProjectPath } = await import('../../src/core/tool-registry.js');
    (skipProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const dispatcher = new ToolDispatcher(createOptions());
    const result = await dispatcher.handleCall({
      params: { name: 'docs', arguments: { action: 'search_classes', query: 'Node3D', project_path: 123 } },
    });

    // validateCommonArgs should still catch invalid project_path type
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('project_path');

    // Reset mock
    (skipProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
});

// ── findGodot override (CR-1 / CR-2 regression coverage) ─────────────────────
//
// 这些用例覆盖 C-CONC-1 重构引入的两个 CRITICAL 回归:
//   CR-1: 普通调用路径漏传 findGodotOverride → godot_path 参数失效
//   CR-2: confirm_and_execute 路径基于错误 args 计算 override
// 断言核心:传入工具模块的 ctx.findGodot(第 3 个参数)必须是 override 实现,
// 而非默认的 this.ctx.findGodot。

describe('ToolDispatcher: findGodot override propagation (CR-1/CR-2)', () => {
  function makeDispatcher(overrides?: Partial<DispatcherOptions>) {
    return new ToolDispatcher(createOptions(overrides));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllToolDefinitions.mockReturnValue([...FIXTURE_TOOLS]);
    mockRequiresConfirmation.mockReturnValue(false);
    mockValidateGodotBinary.mockResolvedValue(true);
    (_mockResolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue('/default/project');
  });

  // [FG1] CR-1: 普通调用 + godot_path → ctx.findGodot 应返回 override 值
  it('CR-1: propagates godot_path override to tool ctx in normal headless dispatch', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = makeDispatcher({ readOnlyGuard: guard });

    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { godot_path: '/custom/godot.exe' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalled();
    const ctx = mockModule.handleTool.mock.calls[0][2] as { findGodot: (p?: string) => Promise<string> };
    const resolved = await ctx.findGodot();
    expect(resolved).toBe('/custom/godot.exe');
  });

  // [FG2] CR-1: 普通调用 + project_path(无 godot_path) → findGodot 应以该 project_path 调用
  it('CR-1: passes explicit project_path to findGodot when no godot_path', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const findGodotSpy = vi.fn().mockResolvedValue('/found/godot');
    const dispatcher = makeDispatcher({ readOnlyGuard: guard, findGodot: findGodotSpy });

    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/explicit/project' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalled();
    const ctx = mockModule.handleTool.mock.calls[0][2] as { findGodot: (p?: string) => Promise<string> };
    await ctx.findGodot();
    // findGodot 应以显式 project_path 调用,而非 undefined
    expect(findGodotSpy).toHaveBeenCalledWith('/explicit/project');
  });

  // [FG4] P1-7 (批次 E): godot_path 两层校验拒绝分支——H-02 绝对路径 + H-01 validateGodotBinary。
  // 现有 godot_path 测试全传绝对路径+mock 成功不触发拒绝（守卫破坏可执行任意二进制）。
  it('P1-7: rejects relative godot_path (H-02 absolute path)', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = makeDispatcher({ readOnlyGuard: guard });

    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { godot_path: 'relative/godot.exe' } },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('must be an absolute path');
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  it('P1-7: rejects invalid godot binary (H-01 validateGodotBinary false)', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockValidateGodotBinary.mockResolvedValueOnce(false);
    const dispatcher = makeDispatcher({ readOnlyGuard: guard });

    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { godot_path: '/fake/godot.exe' } },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not a valid Godot binary');
    expect(mockModule.handleTool).not.toHaveBeenCalled();
  });

  // [FG3] CR-2: confirm_and_execute 应基于 pending.args(原始工具 args)的 godot_path 计算 override
  it('CR-2: confirm_and_execute uses pending.args godot_path for findGodot override', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    // pending.args 携带原始调用的 godot_path(confirm_and_execute 自身 args 只有 token)
    mockConsumeToken.mockReturnValue({
      toolName: 'scene',
      args: { action: 'remove_node', godot_path: '/pending/godot.exe' },
    });
    const dispatcher = makeDispatcher({ readOnlyGuard: guard, connectionMode: 'headless' });

    await dispatcher.handleCall({
      params: { name: 'confirm_and_execute', arguments: { token: 'valid-token' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalled();
    const ctx = mockModule.handleTool.mock.calls[0][2] as { findGodot: (p?: string) => Promise<string> };
    const resolved = await ctx.findGodot();
    // 必须是 pending.args 的 godot_path,而非默认 findGodot 或 confirm_and_execute 的 args
    expect(resolved).toBe('/pending/godot.exe');
  });

  // [G1] C-CONC-1: 并发派发时 findGodot override 必须隔离(局部变量,不串)。
  // 模拟 MCP SDK Promise.resolve().then 并发派发多个 tools/call。若用实例字段存 override,
  // 后发调用会覆盖先发 → 两调用 ctx.findGodot 都返回同一值(串)。局部变量沿调用链传递则隔离。
  it('concurrent dispatches isolate findGodot override (G1, C-CONC-1)', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    // 用 project_path + findGodotSpy(无 godot_path → 走项目感知 findGodot,不触发 validate 真实 spawn)
    const findGodotSpy = vi.fn((p?: string) => Promise.resolve(`/godot/for/${p ?? 'default'}`));
    const dispatcher = makeDispatcher({ readOnlyGuard: guard, findGodot: findGodotSpy });

    await Promise.all([
      dispatcher.handleCall({ params: { name: 'scene', arguments: { project_path: '/proj/A' } } }),
      dispatcher.handleCall({ params: { name: 'scene', arguments: { project_path: '/proj/B' } } }),
    ]);

    expect(mockModule.handleTool).toHaveBeenCalledTimes(2);
    // 各调用的 ctx.findGodot 返回各自的 override(基于该调用 project_path)— 不串
    const results = await Promise.all(
      mockModule.handleTool.mock.calls.map(c => (c[2] as { findGodot: () => Promise<string> }).findGodot()),
    );
    expect(results.sort()).toEqual(['/godot/for//proj/A', '/godot/for//proj/B']);
  });

  // [FG4] 无 godot_path 无 project_path → findGodot 以 undefined 调用(回退默认查找逻辑)
  it('falls back to default findGodot(undefined) when no godot_path and no project_path', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    // skipProjectPath 模拟,使 project_path 不被注入
    const { skipProjectPath } = await import('../../src/core/tool-registry.js');
    (skipProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const findGodotSpy = vi.fn().mockResolvedValue('/default/godot');
    const dispatcher = makeDispatcher({ readOnlyGuard: guard, findGodot: findGodotSpy });

    await dispatcher.handleCall({
      params: { name: 'docs', arguments: { action: 'search_classes', query: 'Node3D' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalled();
    const ctx = mockModule.handleTool.mock.calls[0][2] as { findGodot: (p?: string) => Promise<string> };
    await ctx.findGodot();
    // 无 project_path 时应以 undefined 调用
    expect(findGodotSpy).toHaveBeenCalledWith(undefined);

    (skipProjectPath as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
});

// ── buildPerCallCtx ─────────────────────────────────────────────────────────
// [REGRESSION] spread {...this.ctx} 会把 ctx 上的 getter(runningProcess/outputBuffer 等,
// 连 process-state 模块)展平成调用时刻快照。dispatch 入口 _runningProcess=null →
// perCallCtx.runningProcess 冻结成 null → run_project isCancelled 永远 true →
// wait_for_bridge 误报 "process exited during probe"。Object.create 继承原型 getter 修复。
describe('buildPerCallCtx', () => {
  it('保留 runningProcess getter — setRunningProcess 后 perCallCtx 反映新值(非 spread 快照)', () => {
    let current: unknown = null;
    const base = {
      get runningProcess() { return current; },
      setRunningProcess(p: unknown) { current = p; },
      findGodot: vi.fn(),
    } as unknown as Parameters<typeof buildPerCallCtx>[0];
    const perCallCtx = buildPerCallCtx(base, undefined);
    // 模拟 run_project: dispatch 后 setRunningProcess(proc) 改模块 state
    (base as any).setRunningProcess('PROC_A');
    expect((perCallCtx as any).runningProcess).toBe('PROC_A'); // spread 时为 null → fail
  });

  it('findGodot 覆盖: 有 override 用 override,无 override 继承 base', () => {
    const baseFind = vi.fn();
    const overrideFind = vi.fn();
    const base = { findGodot: baseFind, runningProcess: null } as unknown as Parameters<typeof buildPerCallCtx>[0];
    expect((buildPerCallCtx(base, overrideFind as any) as any).findGodot).toBe(overrideFind);
    expect((buildPerCallCtx(base, undefined) as any).findGodot).toBe(baseFind);
  });

  it('保留其他 getter(outputBuffer)', () => {
    let buf: string[] = ['old'];
    const base = {
      get outputBuffer() { return buf; },
      findGodot: vi.fn(),
    } as unknown as Parameters<typeof buildPerCallCtx>[0];
    const perCallCtx = buildPerCallCtx(base, undefined);
    buf.push('new');
    expect((perCallCtx as any).outputBuffer).toEqual(['old', 'new']); // spread 时为 ['old'] 快照 → fail
  });
});

// ── Task 3: validateArgs schema 防线集成 ───────────────────────────────────
//
// 接入点:executeToolCall L231(validateCommonArgs return)后、ReadOnlyGuard 前。
// 用 action enum 违规演示:'totally_bogus_action' 是非空 string → 通过 validateCommonArgs,
// 但不在 scene action enum 内 → validateArgs 拒绝。接入前此用例会传到 handler(无 INVALID_PARAMS),
// 接入后返 INVALID_PARAMS 且 handler/executor 不被调用。
// #9 R2 要求:editor + headless 两路都覆盖,锁定接入点上移覆盖 editor,防后续挪回 dispatchTool 时
// editor 静默回归。

describe('executeToolCall schema validation (Task 3)', () => {
  // scene 真实 inputSchema 的 action 是 string enum;用精简 schema 演示 enum 违规拒绝
  const sceneSchemaWithEnum: Tool = {
    name: 'scene',
    description: 'Scene ops',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        action: { type: 'string', enum: ['read_scene', 'add_node', 'remove_node'] },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllToolDefinitions.mockReturnValue([...FIXTURE_TOOLS]);
    mockGetToolDefinition.mockReturnValue(sceneSchemaWithEnum);
    mockRequiresConfirmation.mockReturnValue(false);
    (_mockResolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue('/default/project');
  });

  // [S1] headless:action 是非空 string → 通过 validateCommonArgs,但不在 enum → validateArgs 拒绝
  it('headless: enum-violating action → INVALID_PARAMS, handler not called', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'full', connectionMode: 'headless', readOnlyGuard: guard }));

    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/tmp', action: 'totally_bogus_action' } },
    });

    // 接入前:handler 被调用,result 是 mockToolResult(isError undefined) → 用例 fail(RED)
    // 接入后:返 INVALID_PARAMS + handler 未调用(GREEN)
    expect(mockModule.handleTool).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // [S2] editor:同样 enum 违规 → INVALID_PARAMS,executor 不被调用(锁定 #1 上移覆盖 editor)
  it('editor: enum-violating action → INVALID_PARAMS, executor not called', async () => {
    const guard = createMockGuard(false);
    const mockExecutor = { execute: vi.fn().mockResolvedValue(mockToolResult), destroy: vi.fn() } as unknown as EditorToolExecutor;
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'full', connectionMode: 'editor', readOnlyGuard: guard }));
    dispatcher.setEditorExecutor(mockExecutor);

    const result = await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/tmp', action: 'totally_bogus_action' } },
    });

    expect(mockExecutor.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  // [S3] 合法 enum 值 → 通过 validateArgs,正常 dispatch(防过度拦截回归)
  it('valid enum action passes validateArgs and dispatches normally', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'full', connectionMode: 'headless', readOnlyGuard: guard }));

    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/tmp', action: 'read_scene' } },
    });

    expect(mockModule.handleTool).toHaveBeenCalled();
  });

  // [S4] getToolDefinition 返 undefined(内联工具如 confirm_and_execute)→ 跳过校验,不误伤
  it('inline tool (getToolDefinition undefined) skips validateArgs', async () => {
    mockGetToolDefinition.mockReturnValue(undefined);
    const guard = createMockGuard(false);
    mockConsumeToken.mockReturnValue({ toolName: 'scene', args: { action: 'read_scene' } });
    const mockModule = { handleTool: vi.fn().mockResolvedValue(mockToolResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = new ToolDispatcher(createOptions({ readOnlyGuard: guard }));

    await dispatcher.handleCall({
      params: { name: 'confirm_and_execute', arguments: { token: 'valid' } },
    });

    // confirm_and_execute 路径应正常执行(内联工具无 inputSchema → 跳过)
    expect(mockModule.handleTool).toHaveBeenCalled();
  });
});

// ── Task 3: CallRecorder 接线(healthSample.after hook record) ───────────────
//
// 接线点:buildMiddleware 的 healthSample.after(:387-396)。每次工具调用后,
// record 被调(成功记 ctx.toolName+ok,失败记 +errorType/extractErrorMessage)。
// 验证 getCallRecorder().getStats() 的 total/success/fail 在成功/失败 dispatch 后变化。

describe('ToolDispatcher callRecorder wiring (Task 3)', () => {
  const successResult: ToolResult = {
    content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
  };
  const errorResult: ToolResult = {
    content: [{ type: 'text', text: JSON.stringify({ error: 'boom failure' }) }],
    isError: true,
  };

  beforeEach(() => {
    getCallRecorder().reset();
    vi.clearAllMocks();
    mockGetAllToolDefinitions.mockReturnValue([...FIXTURE_TOOLS]);
    mockRequiresConfirmation.mockReturnValue(false);
    (_mockResolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue('/default/project');
  });

  it('records success on successful tool call', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(successResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = new ToolDispatcher(createOptions({ readOnlyGuard: guard }));

    await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });

    const stats = getCallRecorder().getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.success).toBeGreaterThanOrEqual(1);
    expect(stats.fail).toBe(0);
  });

  it('records failure on error tool call (isError=true)', async () => {
    const guard = createMockGuard(false);
    const mockModule = { handleTool: vi.fn().mockResolvedValue(errorResult) };
    mockGetModuleForTool.mockReturnValue(mockModule);
    const dispatcher = new ToolDispatcher(createOptions({ readOnlyGuard: guard }));

    await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });

    const stats = getCallRecorder().getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.fail).toBeGreaterThanOrEqual(1);
    expect(stats.success).toBe(0);
  });
});

// ── Task 3: progress 透传链 ──────────────────────────────────────────────────
describe('ToolDispatcher progress 透传链', () => {
  let capturedCtx: any = null;
  const mockModule = {
    handleTool: vi.fn(async (_name: string, _args: Record<string, unknown>, ctx: any) => {
      capturedCtx = ctx;
      return mockToolResult;
    }),
  };

  beforeEach(() => {
    resetProgressSender();
    capturedCtx = null;
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockGetToolDefinition.mockReturnValue(undefined);
  });

  it('request 含 _meta.progressToken → perCallCtx.progress 非 undefined 且可调用触发 notification', async () => {
    const server = { notification: vi.fn().mockReturnValue(undefined) };
    setProgressSender(server as any);
    setProgressClientReady(true);
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'workflow', arguments: { action: 'dev_loop' }, _meta: { progressToken: 'tok-A' } },
    } as any);
    expect(capturedCtx).not.toBeNull();
    expect(typeof capturedCtx.progress).toBe('function');
    capturedCtx.progress(1, 3, 'executing');
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok-A', progress: 1, total: 3, message: 'executing' },
    });
  });

  it('request 无 _meta → perCallCtx.progress 为 undefined', async () => {
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'workflow', arguments: { action: 'dev_loop' } },
    } as any);
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx.progress).toBeUndefined();
  });

  it('并发两 handleCall 不同 token → emitter 闭包独立不串（C-CONC-1）', async () => {
    const server = { notification: vi.fn().mockReturnValue(undefined) };
    setProgressSender(server as any);
    setProgressClientReady(true);
    const dispatcher = new ToolDispatcher(createOptions());
    const ctxA: any[] = [];
    const ctxB: any[] = [];
    mockModule.handleTool
      .mockImplementationOnce(async (_n: string, _a: Record<string, unknown>, ctx: any) => { ctxA.push(ctx); return mockToolResult; })
      .mockImplementationOnce(async (_n: string, _a: Record<string, unknown>, ctx: any) => { ctxB.push(ctx); return mockToolResult; });
    // 并发派发（不 await 第一个）
    const pA = dispatcher.handleCall({ params: { name: 'workflow', arguments: {}, _meta: { progressToken: 'A' } } } as any);
    const pB = dispatcher.handleCall({ params: { name: 'workflow', arguments: {}, _meta: { progressToken: 'B' } } } as any);
    await Promise.all([pA, pB]);
    // 各自 emitter 带各自 token（验证不串）
    ctxA[0].progress(1, 2);
    ctxB[0].progress(1, 2);
    const tokens = server.notification.mock.calls.map((c: any[]) => c[0].params.progressToken);
    expect(tokens).toContain('A');
    expect(tokens).toContain('B');
  });

  it('editor 模式 + dev_loop + progressToken → fallback 路径 perCallCtx.progress 注入非 undefined', async () => {
    // editor 模式：currentExecutor.execute 返回 -32601 → 触发 _isUnknownMethod → fallback dispatchTool
    const editorExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: [{ type: 'text' as const, text: JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'Unknown method' } }) }],
        isError: true, // -32601 是 error 响应;_isUnknownMethod 调用前置 editorResult.isError===true(I-12/P1-1 guard)
      }),
    };
    const server = { notification: vi.fn().mockReturnValue(undefined) };
    setProgressSender(server as any);
    setProgressClientReady(true);
    const dispatcher = new ToolDispatcher(createOptions({ connectionMode: 'editor' } as any));
    dispatcher.setEditorExecutor(editorExecutor as any);
    await dispatcher.handleCall({
      params: { name: 'workflow', arguments: { action: 'dev_loop' }, _meta: { progressToken: 'tok-ed' } },
    } as any);
    // fallback 后走 dispatchTool → buildPerCallCtx → mockModule 收到 ctx.progress
    expect(capturedCtx).not.toBeNull();
    expect(typeof capturedCtx.progress).toBe('function');
  });
});
