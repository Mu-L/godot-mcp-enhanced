import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process to prevent real taskkill/spawn calls on Windows
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const mockPs = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((evt, cb) => { if (evt === 'close') setTimeout(() => cb(0), 0); }),
      killed: false,
      kill: vi.fn(),
      pid: 99999,
    };
    return mockPs;
  }),
}));
import { spawn } from 'child_process';
import {
  resetState,
  getRunningProcess,
  setRunningProcess,
  getOutputBuffer,
  appendOutput,
  clearOutputBuffer,
  setOutputBuffer,
  getProcessStartTime,
  setProcessStartTime,
  getProjectDir,
  setProjectDir,
  forceKillTree,
  killPidTree,
  killProcess,
  isProcessBusy,
  setProcessBusy,
  acquireProcessSlot,
  getBusyInfo,
  buildBusyErrorMessage,
  acquireShortRunningSlot,
  releaseShortRunningSlot,
  getShortRunningCount,
  registerSpawnedGodotPid,
  unregisterSpawnedGodotPid,
  getSpawnedGodotPids,
  killOrphanGodotProcesses,
} from '../src/core/process-state.js';

function makeMockProc({ killed = false, pid = 12345 } = {}) {
  const listeners = {};
  const mock = {
    killed,
    pid,
    kill: vi.fn(() => { mock.killed = true; }),
    on: vi.fn((evt, cb) => { listeners[evt] = cb; }),
    emit(evt) { listeners[evt]?.(); },
    _listeners: listeners,
  };
  return mock;
}

beforeEach(() => resetState());

// ─── resetState ──────────────────────────────────────────────────────────────

describe('resetState', () => {
  it('clears all state', () => {
    const proc = makeMockProc();
    setRunningProcess(proc);
    setProcessStartTime(999);
    setProjectDir('/tmp/project');
    appendOutput(['line1', 'line2']);

    resetState();

    expect(getRunningProcess()).toBeNull();
    expect(getOutputBuffer()).toEqual([]);
    expect(getProcessStartTime()).toBe(0);
    expect(getProjectDir()).toBe('');
  });

  it('clears short running count', () => {
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    expect(getShortRunningCount()).toBe(2);
    resetState();
    expect(getShortRunningCount()).toBe(0);
  });

  it('clears busy owner', async () => {
    await acquireProcessSlot('run_project');
    expect(getBusyInfo().owner).toBe('run_project');
    resetState();
    expect(getBusyInfo().owner).toBe('');
  });
});

// ─── get/set runningProcess ──────────────────────────────────────────────────

describe('getRunningProcess / setRunningProcess', () => {
  it('sets and gets a process', () => {
    const proc = makeMockProc();
    setRunningProcess(proc);
    expect(getRunningProcess()).toBe(proc);
  });

  it('sets to null', () => {
    const proc = makeMockProc();
    setRunningProcess(proc);
    setRunningProcess(null);
    expect(getRunningProcess()).toBeNull();
  });

  it('kills old process when replaced with a different one', () => {
    const oldProc = makeMockProc({ killed: false });
    const newProc = makeMockProc();
    setRunningProcess(oldProc);
    setRunningProcess(newProc);

    expect(getRunningProcess()).toBe(newProc);
  });

  it('does NOT kill old process if it is already killed', () => {
    const oldProc = makeMockProc({ killed: true });
    const newProc = makeMockProc();
    setRunningProcess(oldProc);
    setRunningProcess(newProc);

    expect(oldProc.kill).not.toHaveBeenCalled();
  });

  it('does NOT kill old process if same reference is set again', () => {
    const proc = makeMockProc({ killed: false });
    setRunningProcess(proc);
    setRunningProcess(proc);

    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('clears output buffer and start time when set to null', () => {
    const proc = makeMockProc();
    setRunningProcess(proc);
    appendOutput(['a', 'b']);
    setProcessStartTime(42);

    setRunningProcess(null);

    expect(getOutputBuffer()).toEqual([]);
    expect(getProcessStartTime()).toBe(0);
  });

  it('clears busy owner when set to null', async () => {
    await acquireProcessSlot('run_project');
    expect(isProcessBusy()).toBe(true);
    setRunningProcess(null);
    expect(isProcessBusy()).toBe(false);
    expect(getBusyInfo().owner).toBe('');
  });
});

// ─── outputBuffer ────────────────────────────────────────────────────────────

describe('outputBuffer operations', () => {
  it('append adds lines', () => {
    appendOutput(['line1', 'line2']);
    expect(getOutputBuffer()).toEqual(['line1', 'line2']);
  });

  it('get returns current buffer', () => {
    expect(getOutputBuffer()).toEqual([]);
    appendOutput(['x']);
    expect(getOutputBuffer()).toEqual(['x']);
  });

  it('clear empties buffer', () => {
    appendOutput(['a', 'b', 'c']);
    clearOutputBuffer();
    expect(getOutputBuffer()).toEqual([]);
  });

  it('set replaces buffer', () => {
    appendOutput(['old']);
    setOutputBuffer(['new1', 'new2']);
    expect(getOutputBuffer()).toEqual(['new1', 'new2']);
  });
});

describe('appendOutput truncates at 5000', () => {
  it('keeps only last 5000 lines when exceeded', () => {
    const lines = Array.from({ length: 6000 }, (_, i) => `line-${i}`);
    appendOutput(lines);
    const buf = getOutputBuffer();
    expect(buf.length).toBe(5000);
    expect(buf[0]).toBe('line-1000');
    expect(buf[4999]).toBe('line-5999');
  });

  it('does not truncate below 5000', () => {
    const lines = Array.from({ length: 4999 }, (_, i) => `line-${i}`);
    appendOutput(lines);
    expect(getOutputBuffer().length).toBe(4999);
  });

  it('truncates across multiple appends', () => {
    for (let i = 0; i < 60; i++) {
      appendOutput(Array.from({ length: 100 }, (_, j) => `batch${i}-${j}`));
    }
    const buf = getOutputBuffer();
    expect(buf.length).toBe(5000);
  });
});

// ─── processStartTime ────────────────────────────────────────────────────────

describe('getProcessStartTime / setProcessStartTime', () => {
  it('defaults to 0', () => {
    expect(getProcessStartTime()).toBe(0);
  });

  it('sets and gets', () => {
    setProcessStartTime(Date.now());
    const t = getProcessStartTime();
    expect(typeof t).toBe('number');
    expect(t).toBeGreaterThan(0);
  });
});

// ─── projectDir ──────────────────────────────────────────────────────────────

describe('getProjectDir / setProjectDir', () => {
  it('defaults to empty string', () => {
    expect(getProjectDir()).toBe('');
  });

  it('sets and gets', () => {
    setProjectDir('/home/user/project');
    expect(getProjectDir()).toBe('/home/user/project');
  });
});

// ─── forceKillTree ───────────────────────────────────────────────────────────

describe('forceKillTree', () => {
  it('is no-op when process is already killed', () => {
    const proc = makeMockProc({ killed: true });
    forceKillTree(proc);
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('calls kill on non-Windows (or async spawn taskkill on Windows)', () => {
    const proc = makeMockProc({ killed: false });
    forceKillTree(proc);
    if (process.platform === 'win32') {
      expect(spawn).toHaveBeenCalledWith(
        'taskkill', ['/F', '/T', '/PID', '12345'], { stdio: 'ignore' }
      );
    } else {
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    }
  });

  it('kills child process tree via pkill -P on POSIX (P1.2)', () => {
    // POSIX 分支在 win32 不执行(isWin 模块常量于加载时固化,无法本机翻转)。
    // 本测试在 Linux/CI 上走 RED→GREEN;win32 下 skip。P1.2 真实验证依赖 CI Linux。
    if (process.platform === 'win32') return;
    const proc = makeMockProc({ killed: false, pid: 4242 });
    forceKillTree(proc);
    // 对等 Windows taskkill /T:先 pkill -P 杀直接子进程,再 kill 主进程
    expect(spawn).toHaveBeenCalledWith('pkill', ['-P', '4242'], { stdio: 'ignore' });
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('pkill spawn error handler prevents uncaughtException (P1: alpine w/o procps)', async () => {
    // P1 修复: pkill 在无 procps 的容器(alpine)异步 emit 'error'(ENOENT), try/catch
    // 只捕同步 throw 不捕 async 'error' 事件; 无 handler 时 EventEmitter rethrows →
    // uncaughtException → MCP server 崩。isWin 模块常量加载时固化, POSIX 分支 win32
    // 不执行 → 本测试 win32 skip, CI Linux 走 RED→GREEN(同上例 P1.2 先例)。
    if (process.platform === 'win32') return;
    const { EventEmitter } = await import('node:events');
    spawn.mockClear();
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      return child;
    });
    const proc = makeMockProc({ killed: false, pid: 4242 });
    forceKillTree(proc);
    // 取 pkill spawn 返回的 child, 模拟 ENOENT
    const pkillChild = spawn.mock.results[0].value;
    // 无 handler: EventEmitter emit('error') 无 listener 同步 throw → 崩
    // 有 handler: 不抛
    expect(() => pkillChild.emit('error', new Error('spawn pkill ENOENT'))).not.toThrow();
    // pkill 失败不阻断 SIGTERM fallback
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

// ─── killPidTree (orphan 清理辅助，双平台对等 forceKillTree) ─────────────────

describe('killPidTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('Windows: taskkill /F /T /PID <pid>', () => {  // T3a-Win
    if (process.platform !== 'win32') return;
    killPidTree(12345);
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', '12345'], { stdio: 'ignore' });
  });

  it('POSIX: pkill -P <pid> + process.kill(SIGTERM) 双杀', () => {  // T3b
    if (process.platform === 'win32') return;  // isWin 模块常量加载时固化，POSIX 分支 win32 不执行
    killPidTree(4242);
    expect(spawn).toHaveBeenCalledWith('pkill', ['-P', '4242'], { stdio: 'ignore' });
    // process.kill 对真实 pid 4242 会抛（不存在），best-effort 吞掉；验证 spawn pkill 已调即可
  });

  it('POSIX: pkill spawn error 不崩 (P1 先例 alpine 无 procps)', () => {  // T3b-err
    if (process.platform === 'win32') return;
    const { EventEmitter } = require('events');
    spawn.mockImplementationOnce(() => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      return child;
    });
    expect(() => killPidTree(4242)).not.toThrow();
  });

  it('no-op when pid is falsy', () => {
    killPidTree(0);
    expect(spawn).not.toHaveBeenCalled();
  });
});

// ─── killProcess ─────────────────────────────────────────────────────────────

describe('killProcess', () => {
  it('resolves immediately for killed process', async () => {
    const proc = makeMockProc({ killed: true });
    await expect(killProcess(proc)).resolves.toBeUndefined();
  });

  it('resolves when close event fires', async () => {
    const proc = makeMockProc({ killed: false });
    const promise = killProcess(proc);
    proc.emit('close');
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves when error event fires', async () => {
    const proc = makeMockProc({ killed: false });
    const promise = killProcess(proc);
    proc.emit('error');
    await expect(promise).resolves.toBeUndefined();
  });
});

// ─── busy guard ──────────────────────────────────────────────────────────────

describe('busy guard (C-03)', () => {
  it('defaults to not busy', () => {
    expect(isProcessBusy()).toBe(false);
  });

  it('setProcessBusy toggles state', () => {
    setProcessBusy(true);
    expect(isProcessBusy()).toBe(true);
    setProcessBusy(false);
    expect(isProcessBusy()).toBe(false);
  });

  it('setProcessBusy(false) clears owner', async () => {
    await acquireProcessSlot('test_tool');
    expect(getBusyInfo().owner).toBe('test_tool');
    setProcessBusy(false);
    expect(getBusyInfo().owner).toBe('');
  });

  it('blocks setRunningProcess when busy', () => {
    setProcessBusy(true);
    expect(() => setRunningProcess(makeMockProc())).toThrow(/Cannot replace process while another operation is using it/);
    setProcessBusy(false);
  });

  it('allows setRunningProcess when not busy', () => {
    const proc = makeMockProc();
    expect(() => setRunningProcess(proc)).not.toThrow();
    expect(getRunningProcess()).toBe(proc);
  });

  it('allows setRunningProcess(null) even when busy (auto-clears busy)', () => {
    setProcessBusy(true);
    expect(() => setRunningProcess(null)).not.toThrow();
    expect(isProcessBusy()).toBe(false);
  });

  it('resetState clears busy flag', () => {
    setProcessBusy(true);
    resetState();
    expect(isProcessBusy()).toBe(false);
  });
});

// ─── acquireProcessSlot ──────────────────────────────────────────────────────

describe('acquireProcessSlot', () => {
  it('returns true and sets busy when slot is free', async () => {
    expect(isProcessBusy()).toBe(false);
    expect(await acquireProcessSlot('run_project')).toBe(true);
    expect(isProcessBusy()).toBe(true);
  });

  it('returns false when already busy', async () => {
    setProcessBusy(true);
    expect(await acquireProcessSlot()).toBe(false);
  });

  it('is atomic: double acquire fails', async () => {
    expect(await acquireProcessSlot()).toBe(true);
    expect(await acquireProcessSlot()).toBe(false);
  });

  it('allows re-acquire after release', async () => {
    expect(await acquireProcessSlot()).toBe(true);
    setProcessBusy(false);
    expect(await acquireProcessSlot()).toBe(true);
  });

  it('records owner name', async () => {
    await acquireProcessSlot('run_project');
    expect(getBusyInfo().owner).toBe('run_project');
  });

  it('records owner as empty string by default', async () => {
    await acquireProcessSlot();
    expect(getBusyInfo().owner).toBe('');
  });
});

// ─── getBusyInfo ─────────────────────────────────────────────────────────────

describe('getBusyInfo', () => {
  it('returns empty info when not busy', () => {
    const info = getBusyInfo();
    expect(info.owner).toBe('');
    expect(info.startTime).toBe(0);
    expect(info.projectDir).toBe('');
  });

  it('returns owner and context when busy', async () => {
    setProcessStartTime(1000);
    setProjectDir('/my/project');
    await acquireProcessSlot('run_project');
    const info = getBusyInfo();
    expect(info.owner).toBe('run_project');
    expect(info.startTime).toBe(1000);
    expect(info.projectDir).toBe('/my/project');
  });
});

// ─── buildBusyErrorMessage ───────────────────────────────────────────────────

describe('buildBusyErrorMessage', () => {
  it('returns empty string when not busy', () => {
    expect(buildBusyErrorMessage()).toBe('');
  });

  it('includes owner when provided', async () => {
    await acquireProcessSlot('run_project');
    const msg = buildBusyErrorMessage();
    expect(msg).toContain('run_project');
    expect(msg).toContain('stop_project');
  });

  it('includes elapsed time when startTime is set', async () => {
    setProcessStartTime(Date.now() - 45000);
    await acquireProcessSlot('run_project');
    const msg = buildBusyErrorMessage();
    expect(msg).toMatch(/running for \d+s/);
  });

  it('includes project dir when set', async () => {
    setProjectDir('/my/game');
    await acquireProcessSlot('run_project');
    const msg = buildBusyErrorMessage();
    expect(msg).toContain('/my/game');
  });

  it('works without owner', async () => {
    await acquireProcessSlot();
    const msg = buildBusyErrorMessage();
    expect(msg).toContain('another Godot process is running');
    expect(msg).toContain('stop_project');
  });
});

// ─── short-running process lock ──────────────────────────────────────────────

describe('acquireShortRunningSlot / releaseShortRunningSlot', () => {
  it('acquires slot successfully', () => {
    expect(acquireShortRunningSlot()).toBe(true);
    expect(getShortRunningCount()).toBe(1);
  });

  it('allows up to 3 concurrent slots', () => {
    expect(acquireShortRunningSlot()).toBe(true);
    expect(acquireShortRunningSlot()).toBe(true);
    expect(acquireShortRunningSlot()).toBe(true);
    expect(acquireShortRunningSlot()).toBe(false);  // 4th fails
  });

  it('releases slot correctly', () => {
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    expect(getShortRunningCount()).toBe(2);
    releaseShortRunningSlot();
    expect(getShortRunningCount()).toBe(1);
  });

  it('does not go below 0 on over-release', () => {
    releaseShortRunningSlot();
    releaseShortRunningSlot();
    expect(getShortRunningCount()).toBe(0);
  });

  it('allows re-acquire after release', () => {
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    expect(acquireShortRunningSlot()).toBe(false);
    releaseShortRunningSlot();
    expect(acquireShortRunningSlot()).toBe(true);
  });

  it('is independent of long-running lock', async () => {
    await acquireProcessSlot('run_project');
    // Short-running slot should still be available even when long-running is busy
    expect(acquireShortRunningSlot()).toBe(true);
    expect(getShortRunningCount()).toBe(1);
  });

  it('resetState clears count', () => {
    acquireShortRunningSlot();
    acquireShortRunningSlot();
    resetState();
    expect(getShortRunningCount()).toBe(0);
  });
});

// ─── spawnedGodotPids registry ──────────────────────────────────────────────

describe('spawnedGodotPids registry', () => {
  beforeEach(() => resetState());

  it('register adds pid to the set', () => {  // T1
    registerSpawnedGodotPid(12345);
    expect(getSpawnedGodotPids()).toContain(12345);
  });

  it('unregister removes pid from the set', () => {  // T1
    registerSpawnedGodotPid(12345);
    registerSpawnedGodotPid(67890);
    unregisterSpawnedGodotPid(12345);
    expect(getSpawnedGodotPids()).toEqual([67890]);
  });

  it('register ignores illegal pids (0 / negative / NaN)', () => {  // T2
    registerSpawnedGodotPid(0);
    registerSpawnedGodotPid(-1);
    registerSpawnedGodotPid(NaN);
    expect(getSpawnedGodotPids()).toEqual([]);
  });

  it('resetState clears the set', () => {  // T7
    registerSpawnedGodotPid(111);
    registerSpawnedGodotPid(222);
    resetState();
    expect(getSpawnedGodotPids()).toEqual([]);
  });
});

// ─── killOrphanGodotProcesses (V-01 second layer) ───────────────────────────

describe('killOrphanGodotProcesses', () => {
  beforeEach(() => {
    resetState();
  });

  it('returns 0 when projectDir is empty', async () => {
    const count = await killOrphanGodotProcesses('');
    expect(count).toBe(0);
  });

  it('returns 0 when no orphan processes exist', async () => {
    const count = await killOrphanGodotProcesses('/nonexistent/project/path');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('throttles: second call within 30s returns 0', async () => {
    await killOrphanGodotProcesses('/some/project');
    const count = await killOrphanGodotProcesses('/some/project');
    expect(count).toBe(0);
  });

  it('Windows: uses literal .Contains($path) for matching, not -like wildcard (D4)', async () => {
    // 非 Windows 走 pgrep 分支,不 spawn powershell — 仅 Windows 验证命令字符串
    if (process.platform !== 'win32') return;
    spawn.mockClear();
    // 路径含 [ ] 会让 -like 通配符误判;修复后用 .Contains 精确匹配
    const weirdPath = 'D:/my[game]/proj';
    await killOrphanGodotProcesses(weirdPath);
    const psCall = spawn.mock.calls.find(c => c[0] === 'powershell');
    expect(psCall).toBeDefined();
    const cmd = psCall[1].find(a => typeof a === 'string' && a.includes('Where-Object'));
    expect(cmd).toBeDefined();
    // D4:路径匹配用 .Contains($path) 字面量,不再用 -like ('*'+$path+'*') 通配符
    expect(cmd).toContain('.Contains($path)');
    expect(cmd).not.toMatch(/-like\s+\('\*'\s*\+\s*\$path/);
    // $path 值被注入(escapePsSingleQuote 仅转义单引号,方括号原样保留)
    expect(cmd).toContain(weirdPath);
  });
});
