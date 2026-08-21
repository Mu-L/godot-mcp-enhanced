// bridge-session.test.ts — P1-6(2026-08-21 七维度审核):CLI bridge 会话编排单测
//
// 锁定契约:
// (1) install 判定子串:success / already registered 二者任一即过;
// (2) 'Bridge ready' 子串契约——runtime.ts run_project(wait_for_bridge=true) 的输出
//     是本会话的 load-bearing 判据(措辞变更此测试红,防静默断链);
// (3) 失败路径 process.exit(1)(CLI 语义);
// (4) 成功路径 setBridgeProjectDir(projectAbs) 接线在 run_project 之前。
// 删掉 bridge-session.ts 的判定逻辑本文件必红(接线零验证判别法)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { textResult, type ToolContext } from '../src/types.js';

vi.mock('../src/tools/game-bridge.js', () => ({
  handleTool: vi.fn(),
}));
vi.mock('../src/tools/runtime.js', () => ({
  handleTool: vi.fn(),
}));
vi.mock('../src/core/bridge-client.js', () => ({
  sendToBridge: vi.fn(),
  setBridgeProjectDir: vi.fn(),
}));
vi.mock('../src/tools/game-fs.js', () => ({
  resolveGameDataPath: vi.fn(),
}));

import { startBridgeSession, stopBridgeSession } from '../src/cli/bridge-session.js';
import { handleTool as gameBridgeHandle } from '../src/tools/game-bridge.js';
import { handleTool as runtimeHandle } from '../src/tools/runtime.js';
import { setBridgeProjectDir } from '../src/core/bridge-client.js';

const mockedGameBridge = vi.mocked(gameBridgeHandle);
const mockedRuntime = vi.mocked(runtimeHandle);
const mockedSetDir = vi.mocked(setBridgeProjectDir);

const ctx = {} as ToolContext;
const PROJECT = 'D:/games/demo';

/** process.exit mock:记录退出码并抛哨兵错误打断控制流(真退出会杀测试进程) */
let exitCodes: number[] = [];

beforeEach(() => {
  exitCodes = [];
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
    throw new Error(`EXIT_SENTINEL:${code ?? 0}`);
  }) as never);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startBridgeSession — install 判定', () => {
  it('install 输出含 success → 通过,继续起游戏', async () => {
    mockedGameBridge.mockResolvedValueOnce(textResult('Autoload installed successfully.'));
    mockedRuntime.mockResolvedValueOnce(textResult('Bridge ready. Running project at ' + PROJECT));

    await startBridgeSession(PROJECT, ctx);

    expect(exitCodes).toEqual([]);
    expect(mockedGameBridge).toHaveBeenCalledWith('game',
      { action: 'game_bridge_install', project_path: PROJECT }, ctx);
  });

  it('install 输出含 already registered → 幂等通过', async () => {
    mockedGameBridge.mockResolvedValueOnce(textResult('Bridge autoload already registered (v0.31.0).'));
    mockedRuntime.mockResolvedValueOnce(textResult('Bridge ready. Running project at ' + PROJECT));

    await startBridgeSession(PROJECT, ctx);

    expect(exitCodes).toEqual([]);
  });

  it('install 失败(子串都不含) → exit(1),不起游戏', async () => {
    mockedGameBridge.mockResolvedValueOnce(textResult('INVALID_PATH: project not in whitelist'));

    await expect(startBridgeSession(PROJECT, ctx)).rejects.toThrow('EXIT_SENTINEL:1');
    expect(exitCodes).toEqual([1]);
    expect(mockedRuntime).not.toHaveBeenCalled();
  });
});

describe('startBridgeSession — "Bridge ready" 契约', () => {
  it('run 输出含 "Bridge ready" → 成功;setBridgeProjectDir 在 run 前接线', async () => {
    mockedGameBridge.mockResolvedValueOnce(textResult('installed successfully'));
    mockedRuntime.mockResolvedValueOnce(textResult('Bridge ready. Running project at ' + PROJECT + ' (timeout: 120s).'));

    await startBridgeSession(PROJECT, ctx);

    expect(exitCodes).toEqual([]);
    // 接线顺序:setBridgeProjectDir(projectAbs) 先于 run_project(bridge 端口解析依赖它)
    expect(mockedSetDir).toHaveBeenCalledWith(PROJECT);
    expect(mockedSetDir.mock.invocationCallOrder[0]).toBeLessThan(mockedRuntime.mock.invocationCallOrder[0]!);
    expect(mockedRuntime).toHaveBeenCalledWith('runtime',
      expect.objectContaining({ action: 'run_project', wait_for_bridge: true }), ctx);
  });

  it('run 输出不含 "Bridge ready"(如未装 bridge 的普通启动文案) → exit(1)', async () => {
    mockedGameBridge.mockResolvedValueOnce(textResult('installed successfully'));
    // P1-6 修复后 wait_for_bridge=false 的输出不再假宣称 Bridge ready——本用例锁定该语义
    mockedRuntime.mockResolvedValueOnce(textResult('Running project at ' + PROJECT + ' (timeout: 120s; bridge not probed).'));

    await expect(startBridgeSession(PROJECT, ctx)).rejects.toThrow('EXIT_SENTINEL:1');
    expect(exitCodes).toEqual([1]);
  });

  it('run 返回 null → exit(1)', async () => {
    mockedGameBridge.mockResolvedValueOnce(textResult('installed successfully'));
    mockedRuntime.mockResolvedValueOnce(null);

    await expect(startBridgeSession(PROJECT, ctx)).rejects.toThrow('EXIT_SENTINEL:1');
  });
});

describe('stopBridgeSession', () => {
  it('调 runtime stop_project;抛错被吞(best-effort)', async () => {
    mockedRuntime.mockResolvedValueOnce(textResult('Stopped.'));
    await stopBridgeSession(ctx);
    expect(mockedRuntime).toHaveBeenCalledWith('runtime', { action: 'stop_project' }, ctx);

    mockedRuntime.mockReset();
    mockedRuntime.mockRejectedValueOnce(new Error('game already dead'));
    await expect(stopBridgeSession(ctx)).resolves.toBeUndefined();
    expect(exitCodes).toEqual([]);
  });
});
