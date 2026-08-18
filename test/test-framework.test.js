import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSuccessResult } from './helpers/mock-results.js';

// Mock executor
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => mockSuccessResult({
    outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'Node exists: root/Player' }) }],
  })),
  executeGdscriptTrusted: vi.fn(async () => mockSuccessResult({
    outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'Node exists: root/Player' }) }],
  })),
}));

import { getToolDefinitions, handleTool, TOOL_META } from '../src/tools/test-framework.js';

describe('test-framework tools', () => {
  const mockCtx = {
    findGodot: vi.fn(async () => '/usr/bin/godot'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx.findGodot.mockResolvedValue('/usr/bin/godot');
  });

  it('getToolDefinitions returns 1 merged definition named "test"', () => {
    const defs = getToolDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBe(1);
    expect(defs[0].name).toBe('test');
  });

  it('action enum contains all 5 actions', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('assert');
    expect(actionEnum).toContain('stress');
    expect(actionEnum).toContain('export_list_presets');
    expect(actionEnum).toContain('export_get_preset');
    expect(actionEnum).toContain('export_build');
  });

  it('TOOL_META has exactly 1 entry for "test"', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
    expect(TOOL_META.test).toBeDefined();
    expect(TOOL_META.test.readonly).toBe(true);
    expect(TOOL_META.test.long_running).toBe(false);
  });

  it('handleTool returns null for unknown tool', async () => {
    const result = await handleTool('unknown_tool_xyz', {}, mockCtx);
    expect(result).toBeNull();
  });

  it('handleTool for test assert with node_exists', async () => {
    const { executeGdscript } = await import('../src/gdscript-executor.js');
    executeGdscript.mockResolvedValueOnce({
      success: true,
      compile_success: true,
      compile_error: '',
      errors: [],
      run_success: true,
      run_error: '',
      outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'Node exists: root/Player' }) }],
      raw_output: '',
      duration_ms: 100,
    });

    const result = await handleTool('test', {
      project_path: 'C:/tmp/test-project',
      action: 'assert',
      assertion_type: 'node_exists',
      path: 'root/Player',
    }, mockCtx);
    expect(result).not.toBeNull();
    const text = result.content[0].text;
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(0);
  });

  it('property_equals wraps expected as a string literal, not a bare identifier (security P2)', async () => {
    // :146 `str(${gdEscape(expected)})` 语句位置无引号 → expected="Player" 生成 str(Player)
    // (GDScript 当标识符，功能 bug + 弱注入面)。修复后应 str("Player")。
    const { executeGdscriptTrusted } = await import('../src/gdscript-executor.js');
    let capturedCode = '';
    executeGdscriptTrusted.mockImplementationOnce(async (opts) => {
      capturedCode = opts.code;
      return {
        success: true, compile_success: true, compile_error: '',
        errors: [], run_success: true, run_error: '',
        outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'ok' }) }],
        raw_output: '', duration_ms: 10,
      };
    });

    await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'assert',
      assertion_type: 'property_equals',
      path: 'root/Player',
      property: 'name',
      expected: 'Player',
    }, mockCtx);

    expect(capturedCode).toContain('var _expected = str("Player")');
    expect(capturedCode).not.toContain('var _expected = str(Player)');
  });

  it('handleTool for test assert with invalid assertion_type', async () => {
    const result = await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'assert',
      assertion_type: 'invalid_type',
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_PARAMS');
  });

  // T2b (debt-cleanup-20260818): parentPath 是混合上下文,拆两份变量:
  //   - :158 _mcp_get_node / :160 错误消息 → 纯字面量,escapeForGdLiteral(%HUD 原样保留,
  //     gdEscape 双写 %%HUD 使 unique-name 查找失败,预先存在的 bug);
  //   - :164 "Children of %s: %d..." 是 % 格式串左侧,必须 gdEscape(%% 格式化后还原为 %)。
  // 本用例同时断言两种形态各归其位——拆分正确性的直接锁。
  it('T2b: node_count parent 含 % ——字面量处 %HUD 原样、% 格式串处 %%HUD 双写', async () => {
    const { executeGdscriptTrusted } = await import('../src/gdscript-executor.js');
    let capturedCode = '';
    executeGdscriptTrusted.mockImplementationOnce(async (opts) => {
      capturedCode = opts.code;
      return {
        success: true, compile_success: true, compile_error: '',
        errors: [], run_success: true, run_error: '',
        outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'ok' }) }],
        raw_output: '', duration_ms: 10,
      };
    });

    await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'assert',
      assertion_type: 'node_count',
      parent: '%HUD',
      count: 3,
    }, mockCtx);

    // 字面量消费点(:158 查找 + 空串比较、:160 错误消息)——% 原样,不被双写
    expect(capturedCode).toContain('var _p = _mcp_get_node("%HUD") if "%HUD" != "" else _root');
    expect(capturedCode).toContain('"Parent node not found: %HUD"');
    expect(capturedCode).not.toContain('_mcp_get_node("%%HUD")');
    // % 格式串左侧(:164)——必须双写,格式化后还原为字面 %
    expect(capturedCode).toContain('"Children of %%HUD: %d (expected: %d)" % [_count, _expected]');
  });

  // T2b: path 的全部消费点(:131 字面量赋值 → :134/:140/:150 _mcp_get_node、:136/:138/:142
  // 消息拼接、:148 % 格式串**右侧数组**——右侧参数不解析 % 转义)均需 % 原样 → 整体切
  // escapeForGdLiteral,无需拆分。
  it('T2b: node_exists path 含 % (unique-name) 不双写', async () => {
    const { executeGdscriptTrusted } = await import('../src/gdscript-executor.js');
    let capturedCode = '';
    executeGdscriptTrusted.mockImplementationOnce(async (opts) => {
      capturedCode = opts.code;
      return {
        success: true, compile_success: true, compile_error: '',
        errors: [], run_success: true, run_error: '',
        outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'ok' }) }],
        raw_output: '', duration_ms: 10,
      };
    });

    await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'assert',
      assertion_type: 'node_exists',
      path: '%Player',
    }, mockCtx);

    expect(capturedCode).toContain('var _path = "%Player"');
    expect(capturedCode).not.toContain('%%Player');
  });

  // T2b: targetPath 消费点(:151 _mcp_get_node 纯字面量、:156 % 格式串右侧数组)均需 % 原样 → 整体切。
  it('T2b: signal_connected target 含 % (unique-name) 不双写', async () => {
    const { executeGdscriptTrusted } = await import('../src/gdscript-executor.js');
    let capturedCode = '';
    executeGdscriptTrusted.mockImplementationOnce(async (opts) => {
      capturedCode = opts.code;
      return {
        success: true, compile_success: true, compile_error: '',
        errors: [], run_success: true, run_error: '',
        outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'ok' }) }],
        raw_output: '', duration_ms: 10,
      };
    });

    await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'assert',
      assertion_type: 'signal_connected',
      path: 'root/A',
      signal: 'hit',
      target: '%Tgt',
      method: 'on_hit',
    }, mockCtx);

    expect(capturedCode).toContain('var _tgt = _mcp_get_node("%Tgt")');
    expect(capturedCode).not.toContain('%%Tgt');
  });

  it('handleTool for test assert with missing project_path', async () => {
    // SEC-P2-1 (2026-08-09): 删手写 typeof 检查后,project_path 缺失由 requireProjectPath
    // 内部 requireString 抛错,被外层 catch 包装成 INVALID_PATH(语义:路径参数不合法)。
    const result = await handleTool('test', {
      action: 'assert',
      assertion_type: 'node_exists',
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/INVALID_PATH|project_path/);
  });

  it('handleTool for test stress', async () => {
    const { executeGdscriptTrusted } = await import('../src/gdscript-executor.js');
    executeGdscriptTrusted.mockResolvedValueOnce({
      success: true, compile_success: true, compile_error: '',
      errors: [], run_success: true, run_error: '',
      outputs: [{ key: 'result', value: JSON.stringify({
        success: true, iterations: 100, node_type: 'Node',
        memory_before: 1000000, memory_after: 1000000, peak_memory: 1000100,
        leaked: false,
        message: 'Stress test PASSED: 100 iterations, memory stable',
      }) }],
      raw_output: '', duration_ms: 100,
    });

    const result = await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'stress',
      node_type: 'Node',
      iterations: 100,
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBeFalsy();
  });

  it('handleTool for test stress with invalid node_type', async () => {
    const result = await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'stress',
      node_type: 'MaliciousNode',
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('INVALID_NODE_TYPE');
  });

  it('export_list_presets returns EDITOR_ONLY error', async () => {
    const result = await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'export_list_presets',
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('EDITOR_ONLY');
  });

  it('export_build returns EDITOR_ONLY error', async () => {
    const result = await handleTool('test', {
      project_path: '/tmp/test-project',
      action: 'export_build',
      preset: 'windows',
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('EDITOR_ONLY');
  });
});

// SEC-P2-1 (2026-08-09): test-framework 用 requireProjectPath 后,project_path 必须在
// ALLOWED_PROJECT_PATHS 白名单内。test/setup.js 全局设 GODOT_MCP_UNRESTRICTED=true 让白名单
// 恒 true,故须在独立 describe 显式清空 UNRESTRICTED 才能验证拒绝路径。
// 模式参考 test/godot-finder.test.js:429-432(GODOT_MCP_ALLOWED_GODOT_PATHS describe)。
describe('SEC-P2-1: test-framework requireProjectPath root enforcement', () => {
  const mockCtx = { findGodot: vi.fn(async () => '/usr/bin/godot') };

  beforeEach(() => {
    vi.clearAllMocks();
    // 显式清空 setup.js 的全局 UNRESTRICTED,否则 isPathInAllowedRoots 恒 true
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
    vi.stubEnv('ALLOWED_PROJECT_PATHS', '/allowed/root');
    mockCtx.findGodot.mockResolvedValue('/usr/bin/godot');
  });

  afterEach(() => {
    // 恢复全局 UNRESTRICTED,避免污染后续测试
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
    vi.stubEnv('ALLOWED_PROJECT_PATHS', '');
  });

  it('rejects project_path outside ALLOWED_PROJECT_PATHS', async () => {
    const result = await handleTool('test', {
      project_path: '/outside/allowlist/malicious-project',
      action: 'assert',
      assertion_type: 'node_exists',
      path: 'root',
    }, mockCtx);
    expect(result).not.toBeNull();
    expect(result.isError).toBe(true);
    // requireProjectPath 抛错 → catch 包装成 INVALID_PATH,消息含 "not in ALLOWED_PROJECT_PATHS"
    expect(result.content[0].text).toMatch(/INVALID_PATH|not in ALLOWED_PROJECT_PATHS/i);
  });

  it('allows project_path inside ALLOWED_PROJECT_PATHS', async () => {
    const { executeGdscript } = await import('../src/gdscript-executor.js');
    executeGdscript.mockResolvedValueOnce({
      success: true, compile_success: true, compile_error: '',
      errors: [], run_success: true, run_error: '',
      outputs: [{ key: 'result', value: JSON.stringify({ passed: true, message: 'ok' }) }],
      raw_output: '', duration_ms: 50,
    });
    const result = await handleTool('test', {
      project_path: '/allowed/root/my-project',
      action: 'assert',
      assertion_type: 'node_exists',
      path: 'root',
    }, mockCtx);
    expect(result).not.toBeNull();
    // 白名单内应放行(不因路径被拒)
    expect(result.isError).toBeFalsy();
  });
});
