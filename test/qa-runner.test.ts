// test/qa-runner.test.ts — QA 执行器编排行为（mock bridge/runtime；断言分发/失败中止/报告聚合）
//
// mock 策略：
// - game-bridge：importOriginal 保留纯函数（pollWaitCondition/computePlaytestTimeoutMs/validate*），
//   只覆写 sendToBridge / setBridgeProjectDir / handleTool（install 用）
// - runtime：整模块 mock（run_project/stop_project）
// - runtime-assert 用真实现（其 sendToBridge 依赖同样被 mock → 同源验证 assert 复用链路）
// 报告目录 env 重定向 tmp。runner.ts 的 game-bridge.ts 不 mock net（符合"仅 game-bridge.test.ts 可 mock net"约定）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { textResult } from '../src/types.js';
import type { ToolContext } from '../src/types.js';

vi.mock('../src/tools/game-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/game-bridge.js')>();
  return {
    ...actual,
    sendToBridge: vi.fn(),
    setBridgeProjectDir: vi.fn(),
    handleTool: vi.fn(),
  };
});

vi.mock('../src/tools/runtime.js', () => ({
  handleTool: vi.fn(),
}));

import { sendToBridge, setBridgeProjectDir, handleTool as bridgeHandleTool } from '../src/tools/game-bridge.js';
import { handleTool as runtimeHandleTool } from '../src/tools/runtime.js';
import { runQaSuite } from '../src/tools/qa/runner.js';
import { parseQaSuite, type QaSuite } from '../src/tools/qa/spec.js';

const PROJECT = 'D:/proj/demo';

function makeCtx(): ToolContext {
  return {
    opsScript: 'D:/build/scripts/godot_operations.gd',
    findGodot: async () => 'godot',
    runningProcess: null,
    setRunningProcess: () => {},
    outputBuffer: [],
    setOutputBuffer: () => {},
    processStartTime: 0,
    setProcessStartTime: () => {},
    projectDir: '',
    setProjectDir: () => {},
    parseGodotConfig: () => ({}),
  };
}

function suite(overrides: Record<string, unknown> = {}): QaSuite {
  const parsed = parseQaSuite({
    name: 'unit',
    project_path: PROJECT,
    ...overrides,
  });
  if (!parsed.ok || !parsed.suite) throw new Error(parsed.error ?? 'bad suite');
  return parsed.suite;
}

/** 默认 mock：install/run 成功；sendToBridge 按方法路由 */
function defaultMocks(props: Record<string, unknown> = {}) {
  vi.mocked(bridgeHandleTool).mockResolvedValue(textResult(JSON.stringify({ success: true, message: 'installed' })));
  vi.mocked(runtimeHandleTool).mockImplementation(async (_n, args) => {
    const action = (args as Record<string, unknown>).action;
    if (action === 'run_project') return textResult('Bridge ready. Running project at D:/proj/demo (timeout: 600s).');
    return textResult('Stopped.');
  });
  vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
    if (method === 'get_node_properties') return { id: 1, result: { health: 100 } };
    if (method === 'get_tree') return { id: 2, result: { nodes: [{ path: '/root/Root' }] } };
    if (method === 'take_screenshot') return { id: 3, result: { success: true, path: 'user://mcp_screenshot.png', size: { x: 64, y: 64 } } };
    if (method === 'ping') return { id: 4, result: {} };
    if (method === 'wait_for_node') return { id: 6, result: { exists: true } };
    return { id: 5, result: {} };
  });
  void setBridgeProjectDir;
  void props;
}

let dir: string;
const prevEnv = process.env.GODOT_MCP_QA_REPORTS_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-runner-test-'));
  process.env.GODOT_MCP_QA_REPORTS_DIR = dir;
  vi.clearAllMocks();
  defaultMocks();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevEnv === undefined) delete process.env.GODOT_MCP_QA_REPORTS_DIR;
  else process.env.GODOT_MCP_QA_REPORTS_DIR = prevEnv;
});

describe('runQaSuite happy path', () => {
  it('install→run→seed→steps→stop 全链编排 + 报告 PASSED', async () => {
    const s = suite({
      options: { seed: 42, stop_after: true },
      steps: [
        { type: 'input', method: 'send_key', params: { key: 'space', pressed: true }, label: '按下' },
        { type: 'wait', method: 'wait_for_node', params: { path: '/root/Root' } },
        { type: 'assert', assert: 'node_state', path: '/root/Root', expect: { health: 100 }, label: '满血' },
        { type: 'screenshot', label: '留证' },
      ],
    });

    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');

    // 生命周期调用序列
    expect(bridgeHandleTool).toHaveBeenCalledWith('game', expect.objectContaining({ action: 'game_bridge_install' }), expect.anything());
    expect(runtimeHandleTool).toHaveBeenCalledWith('runtime', expect.objectContaining({ action: 'run_project', wait_for_bridge: true }), expect.anything());
    expect(runtimeHandleTool).toHaveBeenCalledWith('runtime', expect.objectContaining({ action: 'stop_project' }), expect.anything());

    // 步骤层 sendToBridge 序列：seed → input → wait probe → assert 查询 → screenshot
    const methods = vi.mocked(sendToBridge).mock.calls.map(c => c[0]);
    expect(methods).toEqual(expect.arrayContaining(['playtest.seed', 'send_key', 'wait_for_node', 'get_node_properties', 'take_screenshot']));

    expect(report.summary).toMatchObject({ total: 4, passed: 4, failed: 0, errors: 0, skipped: 0, status: 'PASSED' });
    expect(report.steps.map(x => x.status)).toEqual(['PASSED', 'PASSED', 'PASSED', 'PASSED']);
    // PROJECT 是虚构路径 → user:// 解析不到本地文件 → 诚实降级（记录游戏侧路径，不伪造证据）
    expect(report.steps[3]!.detail).toContain('留在游戏侧');
    expect(report.steps[3]!.evidence?.screenshot_path).toBeUndefined();
  });

  // darwin 的 Godot 数据根(~/Library/Application Support/Godot)无法用环境变量重定向,跳过(CI 矩阵仅 win/linux)
  it.skipIf(process.platform === 'darwin')('screenshot 步骤：user:// 解析成功时 PNG 拷入报告目录', async () => {
    // 构造 Godot app_userdata 布局(平台无关)：win32=APPDATA/Godot/app_userdata/<name>，
    // linux=XDG_DATA_HOME/godot/app_userdata/<name>(resolveGameDataPath 按 platform 选 base，
    // 只设 APPDATA 在 Linux CI 上解析不到 → 降级分支 → 本测试首跑 CI 即红,issue 见 PR#25)
    const appdata = mkdtempSync(join(tmpdir(), 'qa-appdata-'));
    const project = mkdtempSync(join(tmpdir(), 'qa-proj-'));
    const prevAppdata = process.env.APPDATA;
    const prevXdg = process.env.XDG_DATA_HOME;
    writeFileSync(join(project, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="TestProj"\n');
    const godotRoot = process.platform === 'win32'
      ? (process.env.APPDATA = appdata, join(appdata, 'Godot'))
      : (process.env.XDG_DATA_HOME = appdata, join(appdata, 'godot'));
    const userDataDir = join(godotRoot, 'app_userdata', 'TestProj');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(join(userDataDir, 'shot.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

    try {
      vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
        if (method === 'take_screenshot') return { id: 3, result: { success: true, path: 'user://shot.png', size: { x: 8, y: 4 } } };
        return { id: 5, result: {} };
      });
      const s = suite({ project_path: project, steps: [{ type: 'screenshot', label: '拷贝成功' }] });
      const report = await runQaSuite(s, project, makeCtx(), 'inline');

      expect(report.steps[0]!.status).toBe('PASSED');
      expect(report.steps[0]!.detail).toContain('8x4');
      const shotPath = report.steps[0]!.evidence!.screenshot_path!;
      expect(shotPath).toMatch(/-step0\.png$/);
      expect(existsSync(shotPath)).toBe(true);
    } finally {
      process.env.APPDATA = prevAppdata;
      if (prevXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prevXdg;
      rmSync(appdata, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('失败语义', () => {
  it('断言 mismatch → FAILED + 后续 SKIPPED（默认中止）', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'get_node_properties') return { id: 1, result: { health: 1 } }; // 不匹配 expect 100
      return { id: 5, result: {} };
    });
    const s = suite({
      steps: [
        { type: 'assert', assert: 'node_state', path: '/root/Root', expect: { health: 100 }, label: '满血' },
        { type: 'sleep', ms: 150, label: '不应执行' },
      ],
    });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.steps[0]).toMatchObject({ status: 'FAILED', label: '满血' });
    expect(report.steps[0]!.mismatch).toEqual({ health: { expected: 100, actual: 1 } });
    expect(report.steps[1]).toMatchObject({ status: 'SKIPPED' });
    expect(report.steps[1]!.skip_reason).toContain('aborted after step 0');
    expect(report.summary).toMatchObject({ status: 'FAILED', failed: 1, skipped: 1 });
  });

  it('continue_on_failure=true → FAILED 后继续执行', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'get_node_properties') return { id: 1, result: { health: 1 } };
      return { id: 5, result: {} };
    });
    const s = suite({
      options: { continue_on_failure: true },
      steps: [
        { type: 'assert', assert: 'node_state', path: '/root/Root', expect: { health: 100 } },
        { type: 'sleep', ms: 120 },
      ],
    });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.steps[0]!.status).toBe('FAILED');
    expect(report.steps[1]!.status).toBe('PASSED');
    expect(report.summary).toMatchObject({ failed: 1, passed: 1, status: 'FAILED' });
  });

  it('bridge error → 步骤 ERROR + 中止', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ id: 9, error: { code: -32001, message: 'auth fail' } });
    const s = suite({ steps: [{ type: 'input', method: 'send_key', params: { key: 'w' } }, { type: 'sleep', ms: 100 }] });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.steps[0]).toMatchObject({ status: 'ERROR' });
    expect(report.steps[0]!.detail).toContain('auth fail');
    expect(report.steps[1]!.status).toBe('SKIPPED');
  });

  it('wait 超时 → FAILED（非 ERROR）', async () => {
    vi.mocked(sendToBridge).mockImplementation(async (method: string) => {
      if (method === 'wait_for_node') return { id: 1, result: { exists: false } };
      return { id: 5, result: {} };
    });
    const s = suite({
      options: { wait_timeout_ms: 600 },
      steps: [{ type: 'wait', method: 'wait_for_node', params: { path: '/root/Nope' } }],
    });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.steps[0]!.status).toBe('FAILED');
    expect(report.steps[0]!.detail).toContain('未在');
  });
});

describe('setup / teardown', () => {
  it('install 失败 → 全 SKIPPED + setup_error，不 run_project', async () => {
    vi.mocked(bridgeHandleTool).mockResolvedValue(textResult('Error: Bridge script not found at /x'));
    const s = suite({ steps: [{ type: 'sleep', ms: 100 }] });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.setup_error).toContain('game_bridge_install 失败');
    expect(report.steps[0]!.skip_reason).toContain('setup'); // 初始 SKIPPED 无 skip_reason → 用状态断言
    expect(report.steps[0]!.status).toBe('SKIPPED');
    expect(report.summary.status).toBe('FAILED');
    expect(runtimeHandleTool).not.toHaveBeenCalled();
  });

  it('run_project 未就绪 → setup_error + 不执行步骤', async () => {
    vi.mocked(runtimeHandleTool).mockResolvedValue(textResult('Error: Bridge not ready (timeout). Game stopped.'));
    const s = suite({ steps: [{ type: 'sleep', ms: 100 }] });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.setup_error).toContain('run_project 失败');
    expect(report.summary.status).toBe('FAILED');
  });

  it('auto_run=false 且 ping 失败 → 可行动 setup_error', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ id: 1, error: { code: -1, message: 'ECONNREFUSED' } });
    const s = suite({ options: { auto_run: false }, steps: [{ type: 'sleep', ms: 100 }] });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.setup_error).toContain('auto_run=false');
    expect(report.setup_error).toContain('ECONNREFUSED');
  });

  it('stop_after=false → 不调 stop_project', async () => {
    const s = suite({ options: { stop_after: false }, steps: [{ type: 'sleep', ms: 100 }] });
    await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(runtimeHandleTool).toHaveBeenCalledTimes(1); // 仅 run_project
  });

  it('stop_project 抛异常 → teardown_warnings 记录且不影响判定', async () => {
    vi.mocked(runtimeHandleTool).mockImplementation(async (_n, args) => {
      const action = (args as Record<string, unknown>).action;
      if (action === 'run_project') return textResult('Bridge ready.');
      throw new Error('kill failed');
    });
    const s = suite({ steps: [{ type: 'sleep', ms: 100 }] });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(report.teardown_warnings?.[0]).toContain('stop_project 失败');
    expect(report.summary.status).toBe('PASSED');
  });
});

describe('步骤分支覆盖（审查 NIT-8 补缺：set/call/step_until/wait_frames）', () => {
  it('set 步骤：参数直传 + 非 /root/ 前缀路径被拒（ERROR）', async () => {
    const s1 = suite({ steps: [{ type: 'set', path: '/root/Root', property: 'x', value: 3 }] });
    const r1 = await runQaSuite(s1, PROJECT, makeCtx(), 'inline');
    expect(r1.steps[0]!.status).toBe('PASSED');
    expect(sendToBridge).toHaveBeenCalledWith('set_node_property',
      { path: '/root/Root', property: 'x', value: 3 }, expect.any(Number));

    vi.mocked(sendToBridge).mockClear();
    const s2 = suite({ steps: [{ type: 'set', path: 'Root', property: 'x', value: 3 }] });
    const r2 = await runQaSuite(s2, PROJECT, makeCtx(), 'inline');
    expect(r2.steps[0]!.status).toBe('ERROR');
    expect(r2.steps[0]!.detail).toContain('/root/');
  });

  it('call 步骤：args 默认空数组 + bridge 拒绝时提示 EXTRA_METHODS 逃生口', async () => {
    const s = suite({ steps: [{ type: 'call', path: '/root/Root', method: 'take_damage' }] });
    const r = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(sendToBridge).toHaveBeenCalledWith('call_method',
      { path: '/root/Root', method: 'take_damage', args: [] }, expect.any(Number));
    expect(r.steps[0]!.status).toBe('PASSED'); // 默认 mock 无 error

    vi.mocked(sendToBridge).mockResolvedValue({ id: 9, error: { code: -1, message: 'blocked by whitelist' } });
    const r2 = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(r2.steps[0]!.status).toBe('ERROR');
    expect(r2.steps[0]!.detail).toContain('GODOT_MCP_BRIDGE_EXTRA_METHODS');
  });

  it('step_until 步骤：conditions/max_frames/wall_budget_ms 透传 playtest.step_until', async () => {
    const s = suite({
      steps: [{
        type: 'step_until',
        conditions: [{ path: '/root/Root', property: 'x', op: '>=', value: 3 }],
        max_frames: 120,
        wall_budget_ms: 5000,
      }],
    });
    const r = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(r.steps[0]!.status).toBe('PASSED');
    const call = vi.mocked(sendToBridge).mock.calls.find(c => c[0] === 'playtest.step_until');
    expect(call?.[1]).toEqual({
      conditions: [{ path: '/root/Root', property: 'x', op: '>=', value: 3 }],
      max_frames: 120,
      wall_budget_ms: 5000,
    });
    // wall_budget 5000 + 5s 余量公式（≥10000，且不小于 step 基础超时下限）
    expect(call?.[2]).toBeGreaterThanOrEqual(10000);
  });

  it('wait_frames 步骤：playtest.step {frames} 透传', async () => {
    const s = suite({ steps: [{ type: 'wait_frames', frames: 5 }] });
    const r = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    expect(r.steps[0]!.status).toBe('PASSED');
    expect(sendToBridge).toHaveBeenCalledWith('playtest.step', { frames: 5 }, expect.any(Number));
  });
});

describe('报告落盘接线', () => {
  it('writeReport(runner 产物) → json 可回读且结构完整', async () => {
    const { writeReport } = await import('../src/tools/qa/report.js');
    const s = suite({ steps: [{ type: 'sleep', ms: 100, label: '唯一' }] });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');
    const paths = writeReport(report);
    const back = JSON.parse(readFileSync(paths.json_path, 'utf-8'));
    expect(back.summary.status).toBe('PASSED');
    expect(back.steps[0].label).toBe('唯一');
    expect(back.run_id).toBe(report.run_id);
  });
});
