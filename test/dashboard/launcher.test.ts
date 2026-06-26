import { describe, it, expect, vi, afterEach } from 'vitest';

// mock child_process —— launcher 不应真正启动终端。
// IMP-9 (2026-06-26 review): launcher 现经 buildSafeEnv 依赖 helpers.ts,
// helpers.ts:57 顶层 promisify(execFile) 需要 execFile,故改 partial mock:
// execFile 等用真实模块,仅覆盖 launcher 实际驱动的 spawn/spawnSync。
vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    spawn: vi.fn(() => ({ unref: vi.fn(), on: vi.fn() })),
    spawnSync: vi.fn(() => ({ error: null, status: 0, stdout: '', stderr: '' })),
  };
});

const ORIG_PLATFORM = process.platform;
const ORIG_ENV = { ...process.env };

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
}

afterEach(() => {
  restorePlatform();
  process.env = { ...ORIG_ENV };
  vi.resetModules();
  vi.clearAllMocks();
});

describe('launchDashboardOnce', () => {
  it('skips when GODOT_MCP_NO_DASHBOARD=1', async () => {
    process.env.GODOT_MCP_NO_DASHBOARD = '1';
    const cp = await import('child_process');
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('skips when GODOT_MCP_NO_DASHBOARD=true', async () => {
    process.env.GODOT_MCP_NO_DASHBOARD = 'true';
    const cp = await import('child_process');
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it('launches only once per module instance (_launched guard)', async () => {
    const cp = await import('child_process');
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    const countAfterFirst = vi.mocked(cp.spawn).mock.calls.length;
    launchDashboardOnce(); // 第二次调用应为 no-op
    expect(vi.mocked(cp.spawn).mock.calls.length).toBe(countAfterFirst);
  });

  it('win32: spawns powershell Start-Process (IMPORTANT-1 single-quote escape path)', async () => {
    setPlatform('win32');
    const cp = await import('child_process');
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    const psCall = vi.mocked(cp.spawn).mock.calls.find(c => c[0] === 'powershell.exe');
    expect(psCall).toBeDefined();
    const cmdArg = psCall![1].find((a: string) => a.includes('Start-Process'));
    expect(cmdArg).toBeDefined();
    // IMPORTANT-1: ArgumentList 在单引号字面量内(转义后)
    expect(cmdArg).toMatch(/-ArgumentList\s+'/);
  });

  it('linux: probes terminals via spawnSync then spawns (IMPORTANT-2 sync detection)', async () => {
    setPlatform('linux');
    const cp = await import('child_process');
    vi.mocked(cp.spawnSync).mockReturnValue({ error: null, status: 0, stdout: '', stderr: '' });
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    expect(cp.spawnSync).toHaveBeenCalled();
    expect(cp.spawn).toHaveBeenCalled();
  });

  it('linux: skips ENOENT terminal and tries next (IMPORTANT-2 regression)', async () => {
    setPlatform('linux');
    const cp = await import('child_process');
    // gnome-terminal 不存在(ENOENT),konsole 可用
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' })
      .mockReturnValue({ error: null, status: 0, stdout: '', stderr: '' });
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    // spawnSync 至少探测两次(gnome 失败 → konsole 成功),证明不再"只试第一个就 break"
    expect(vi.mocked(cp.spawnSync).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(cp.spawn).toHaveBeenCalled();
  });

  it('darwin: spawns osascript', async () => {
    setPlatform('darwin');
    const cp = await import('child_process');
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    const osaCall = vi.mocked(cp.spawn).mock.calls.find(c => c[0] === 'osascript');
    expect(osaCall).toBeDefined();
  });

  it('I-2: clearing GODOT_MCP_NO_DASHBOARD allows launch on next call', async () => {
    process.env.GODOT_MCP_NO_DASHBOARD = '1';
    const cp = await import('child_process');
    const mod = await import('../../src/dashboard/launcher.js');
    mod.launchDashboardOnce();
    expect(cp.spawn).not.toHaveBeenCalled();
    delete process.env.GODOT_MCP_NO_DASHBOARD;
    mod.launchDashboardOnce(); // 清除后应能启动(_launched 未被首次禁用置位)
    expect(cp.spawn).toHaveBeenCalled();
  });

  // 审查 IMPORTANT: spawn().unref() 无 error 监听 → ENOENT 触发 uncaughtException 崩进程。
  // 触发苛刻(powershell/cmd/node/osascript 必存,linux 有 spawnSync probe 兜底),但 TOCTOU/异常环境
  // 仍可能命中。防御性加固:每个 spawn 的 child 必须挂 'error' 监听吞掉异步错误。
  function hasErrorListener(results: { value: unknown }[]): boolean {
    return results.some((r) => {
      const on = ((r.value as { on?: unknown } | null)?.on) as
        | { mock?: { calls?: unknown[][] } }
        | undefined;
      return !!on?.mock?.calls?.some((c) => c[0] === 'error');
    });
  }

  it('win32: attaches error listener on spawned child (prevents ENOENT uncaughtException)', async () => {
    setPlatform('win32');
    const cp = await import('child_process');
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    const results = vi.mocked(cp.spawn).mock.results;
    expect(results.length).toBeGreaterThan(0);
    expect(hasErrorListener(results as unknown as { value: unknown }[])).toBe(true);
  });

  it('linux: attaches error listener on spawned terminal (prevents ENOENT uncaughtException)', async () => {
    setPlatform('linux');
    const cp = await import('child_process');
    vi.mocked(cp.spawnSync).mockReturnValue({ error: null, status: 0, stdout: '', stderr: '' });
    const { launchDashboardOnce } = await import('../../src/dashboard/launcher.js');
    launchDashboardOnce();
    const results = vi.mocked(cp.spawn).mock.results;
    expect(results.length).toBeGreaterThan(0);
    expect(hasErrorListener(results as unknown as { value: unknown }[])).toBe(true);
  });
});
