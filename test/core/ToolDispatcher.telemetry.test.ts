// test/core/ToolDispatcher.telemetry.test.ts
// 验证 ToolDispatcher.buildMiddleware 接入的 telemetry after-hook：
// 每次工具调用后调 record({tool,success,duration_ms,error_category?,project_hash?})。
// buildMiddleware 为 private，经 handleCall 全链路触发，断言 record mock 调用契约。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DispatcherOptions } from '../../src/core/ToolDispatcher.js';
import type { ReadOnlyGuard } from '../../src/core/ReadOnlyGuard.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResult } from '../../src/types.js';

// ─── Hoisted Mocks ──────────────────────────────────────────────────────────
// 仅 mock ToolDispatcher 直接依赖（tool-registry/guard/helpers/path-utils/
// shared/process-state/godot-finder/telemetry）；其余（health-monitor/elicit/
// logger/middleware/feature-flags/progress）走真实模块，保留全链路语义。
const {
  mockGetAllToolDefinitions,
  mockGetModuleForTool,
  mockGetToolDefinition,
  mockRequiresConfirmation,
  mockIsPathInAllowedRoots,
  mockSkipProjectPath,
  mockValidateGodotBinary,
  mockRecord,
  mockHashProject,
  mockSafeErrorCategory,
} = vi.hoisted(() => ({
  mockGetAllToolDefinitions: vi.fn<() => Tool[]>(),
  mockGetModuleForTool: vi.fn(),
  mockGetToolDefinition: vi.fn().mockReturnValue(undefined),
  mockRequiresConfirmation: vi.fn().mockReturnValue(false),
  mockIsPathInAllowedRoots: vi.fn().mockReturnValue(true),
  mockSkipProjectPath: vi.fn().mockReturnValue(false),
  mockValidateGodotBinary: vi.fn().mockResolvedValue(true),
  mockRecord: vi.fn(),
  mockHashProject: vi.fn().mockReturnValue('deadbeef'),
  mockSafeErrorCategory: vi.fn().mockReturnValue('TOOL_ERROR'),
}));

vi.mock('../../src/telemetry/index.js', () => ({
  record: mockRecord,
  hashProject: mockHashProject,
  safeErrorCategory: mockSafeErrorCategory,
  isTelemetryEnabled: () => true,
  getInstallUUID: () => 'salt',
  cleanupLocalFiles: vi.fn(),
}));

vi.mock('../../src/core/tool-registry.js', () => ({
  getAllToolDefinitions: mockGetAllToolDefinitions,
  getModuleForTool: mockGetModuleForTool,
  getToolDefinition: mockGetToolDefinition,
  registerInlineTool: vi.fn(),
  LITE_TOOLS: new Set<string>(),
  MINIMAL_TOOLS: new Set<string>(),
  isToolAllowed: vi.fn().mockReturnValue(true),
  setActiveGroups: vi.fn(),
  resolveProfile: vi.fn().mockReturnValue(new Set<string>()),
  skipProjectPath: mockSkipProjectPath,
  tryLegacyMapping: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/guard.js', () => ({
  requiresConfirmation: mockRequiresConfirmation,
  createPendingToken: vi.fn(),
  consumeToken: vi.fn(),
  TOKEN_TTL_MS: 60_000,
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

vi.mock('../../src/core/godot-finder.js', () => ({
  validateGodotBinary: mockValidateGodotBinary,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockGuard(): ReadOnlyGuard {
  return {
    check: vi.fn().mockReturnValue({ blocked: false }),
  } as unknown as ReadOnlyGuard;
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

const okResult: ToolResult = {
  content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
};

const FIXTURE_TOOL: Tool = {
  name: 'scene',
  description: 'Scene ops',
  inputSchema: { type: 'object', properties: {} },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ToolDispatcher telemetry middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllToolDefinitions.mockReturnValue([FIXTURE_TOOL]);
    mockGetModuleForTool.mockReturnValue({ handleTool: vi.fn().mockResolvedValue(okResult) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 核心契约：成功路径下 record 一次调用，参数含 tool/success/duration_ms/project_hash
  it('invokes record after successful tool call with full payload', async () => {
    const { ToolDispatcher } = await import('../../src/core/ToolDispatcher.js');
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/test/proj' } },
    });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const event = mockRecord.mock.calls[0][0];
    expect(event.tool).toBe('scene');
    expect(event.success).toBe(true);
    expect(typeof event.duration_ms).toBe('number');
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.error_category).toBeUndefined();
    expect(event.project_hash).toBe('deadbeef');
    expect(mockHashProject).toHaveBeenCalledWith('/test/proj');
  });

  // 失败路径：success=false，error_category 由 safeErrorCategory 计算
  it('flags failure and derives error_category when tool returns isError', async () => {
    const failResult: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ error: { code: -32603, message: 'boom' } }) }],
      isError: true,
    };
    mockGetModuleForTool.mockReturnValue({ handleTool: vi.fn().mockResolvedValue(failResult) });

    const { ToolDispatcher } = await import('../../src/core/ToolDispatcher.js');
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'scene', arguments: { project_path: '/p' } },
    });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const event = mockRecord.mock.calls[0][0];
    expect(event.success).toBe(false);
    expect(event.error_category).toBe('TOOL_ERROR');
    expect(mockSafeErrorCategory).toHaveBeenCalled();
    // extractErrorMessage 提取错误文本（非空字符串），传入 safeErrorCategory
    const [errArg] = mockSafeErrorCategory.mock.calls[0];
    expect(typeof errArg === 'string' && errArg.length > 0).toBe(true);
  });

  // final review fix: {success:false} JSON 无 isError:true 时口径对齐 healthSample
  // （旧实现仅判 isError!==true 会把这种结果记为 success=true，遥测虚高）
  it('flags failure when result is {success:false} JSON without isError (aligns with healthSample)', async () => {
    const falseSuccessResult: ToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'something failed' }) }],
      // 注意：无 isError: true —— 仅靠 checkJsonSuccessFalse 识别
    };
    mockGetModuleForTool.mockReturnValue({ handleTool: vi.fn().mockResolvedValue(falseSuccessResult) });

    const { ToolDispatcher } = await import('../../src/core/ToolDispatcher.js');
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({ params: { name: 'scene', arguments: { project_path: '/p' } } });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const event = mockRecord.mock.calls[0][0];
    expect(event.success).toBe(false);
    expect(event.error_category).toBe('TOOL_ERROR');
  });

  // typeof 守卫：project_path 缺失（skipProjectPath=true 跳过注入）→ project_hash undefined
  it('omits project_hash when project_path is not present', async () => {
    mockSkipProjectPath.mockReturnValue(true);

    const { ToolDispatcher } = await import('../../src/core/ToolDispatcher.js');
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({ params: { name: 'scene', arguments: {} } });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const event = mockRecord.mock.calls[0][0];
    expect(event.project_hash).toBeUndefined();
    expect(mockHashProject).not.toHaveBeenCalled();
  });
});
