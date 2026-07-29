/**
 * Process state management for Godot MCP Enhanced.
 *
 * C-04: Async state-mutating operations are serialized through `enqueueAsync`.
 * Reads are still direct (no queueing) since they're atomic in the Node.js
 * single-threaded model. This prevents race conditions when MCP clients
 * introduce parallel tool calls.
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { getLogger } from './logger.js';

const isWin = process.platform === 'win32';

const MAX_OUTPUT_BUFFER_SIZE = 5000;
const MAX_SHORT_CONCURRENT = 3;

// ─── Cross-platform process termination ────────────────────────────────────

/** Kill process tree without blocking the event loop. Uses async spawn on Windows. */
export function forceKillTree(proc: ChildProcess): void {
  if (proc.killed) return;
  if (isWin) {
    try {
      const child = spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
      child.on('error', () => { proc.kill(); });
    } catch (err) {
      getLogger().debug('process-state', `taskkill failed, falling back to proc.kill: ${err}`);
      proc.kill();
    }
  } else {
    // P1.2: POSIX 对等 Windows taskkill /T — 先 pkill -P 杀直接子进程(Godot 可能
    // spawn 导入/资源工具子进程),再 kill 主进程。pkill 失败不阻断主进程 kill。
    if (proc.pid) {
      try {
        // P1: pkill may be absent (alpine w/o procps) → spawn emits an async
        // 'error' (ENOENT) that try/catch cannot intercept. Without a listener,
        // EventEmitter rethrows → uncaughtException → MCP server crash. SIGTERM
        // below is the unconditional fallback, so swallow pkill errors.
        const pk = spawn('pkill', ['-P', String(proc.pid)], { stdio: 'ignore' });
        pk.on('error', () => {});
      } catch (err) {
        getLogger().debug('process-state', `pkill failed, falling back to proc.kill: ${err}`);
      }
    }
    proc.kill('SIGTERM');
  }
}

/** 探测 PID 是否存活（signal 0，不发信号）。 */
function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * 按 PID 杀进程树（与 forceKillTree 共享双平台语义，IMPORTANT-1）。
 * Windows taskkill /F /T 清整树；POSIX pkill -P 杀子进程 + SIGTERM 主进程
 * （Godot 可能 spawn 导入/资源子进程，对等 forceKillTree POSIX 分支）。
 * 导出仅为测试可测性（@internal）。
 */
export function killPidTree(pid: number): void {
  if (!pid) return;
  if (isWin) {
    try {
      const tk = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
      tk.on('error', () => {});  // P1 先例：防 uncaughtException
    } catch { /* best effort */ }
  } else {
    try {
      const pk = spawn('pkill', ['-P', String(pid)], { stdio: 'ignore' });
      pk.on('error', () => {});  // P1 先例：pkill 缺失(alpine)防 uncaughtException
    } catch { /* best effort */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* best effort */ }
  }
}

/** Async kill: waits for 'close' event, with 5 s fallback. */
export function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    // F-5: 进程已自然退出(exitCode !== null)也立即 resolve,避免无谓等 5s timer
    if (proc.killed || proc.exitCode !== null) { resolve(); return; }
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const timer = setTimeout(() => {
      forceKillTree(proc);
      done();
    }, 5000);

    proc.on('close', () => {
      clearTimeout(timer);
      done();
    });
    proc.on('error', () => {
      clearTimeout(timer);
      done();
    });

    forceKillTree(proc);
  });
}

// ─── Module-level mutable state ─────────────────────────────────────────────
// Intentional design: module-scoped "singleton" state accessed exclusively
// through the getter/setter functions below. This avoids class instantiation
// overhead while still providing encapsulation — consumers never touch these
// variables directly. Use resetState() for test isolation.
//
// ⚠️ CONCURRENCY / MULTI-INSTANCE LIMITATION (CR-3): This singleton state is
// shared across all callers within one MCP server process. In the default
// single-instance mode, acquireProcessSlot (serialized via enqueueAsync) plus
// the long-running lock implicitly bound cross-talk — a second run_project fails
// while the slot is busy, and short ops (query_scene_tree) are capped by
// acquireShortRunningSlot. setProjectDir / setRunningProcess are intentionally
// NOT enqueued: making them async would break all synchronous callers
// (ToolDispatcher, e2e tests). Residual risk is confined to:
//   (a) GODOT_MCP_MULTI_INSTANCE=true mixing local headless + remote instances,
//   (b) the window between long-lock release and the next setProjectDir.
// For true per-project isolation, run a separate MCP server process per project.
let _runningProcess: ChildProcess | null = null;
let _outputBuffer: string[] = [];
let _processStartTime = 0;
let _projectDir = '';

// Long-running lock: run_project only (game process that persists for seconds/minutes)
let _processBusy = false;
let _busyOwner = '';
let _busySince = 0;

// Short-running counter: query_scene_tree / inspect_node (seconds-level operations)
let _shortRunningCount = 0;

// 仅 run_project 注册（长生命周期游戏进程，崩溃残留需 orphan 兜底）。
// launch_editor 不注册（detached 编辑器，用户有意长期运行）；
// B 类 headless 不注册（自带 forceKillTree 清理）。
let _spawnedGodotPids: Set<number> = new Set();

/** 记录本会话 spawn 的需要 orphan 兜底的 Godot 进程 PID（仅 run_project）。 */
export function registerSpawnedGodotPid(pid: number): void {
  if (pid && pid > 0) _spawnedGodotPids.add(pid);
}

/** 进程正常退出时移除（主动清理，避免集合累积死 PID）。 */
export function unregisterSpawnedGodotPid(pid: number): void {
  _spawnedGodotPids.delete(pid);
}

/** 测试用：读取当前集合。 */
export function getSpawnedGodotPids(): number[] {
  return Array.from(_spawnedGodotPids);
}

// ─── C-04: Async queue for serializing state mutations ────────────────────────
let _queueTail: Promise<void> = Promise.resolve();

/** Serialize an async state-mutating operation. Ensures only one async mutation
 *  is in-flight at a time. Supports returning a value from the serialized function. */
function enqueueAsync<T>(fn: () => (Promise<T> | T)): Promise<T> {
  let resolve!: (value: void) => void;
  const prev = _queueTail;
  _queueTail = new Promise<void>((r) => { resolve = r; });
  return prev
    .then(() => fn())
    .then(
      (result) => { resolve(); return result; },
      (err) => { resolve(); throw err; },
    );
}

// ─── Long-running process lock ──────────────────────────────────────────────

export function isProcessBusy(): boolean {
  return _processBusy;
}

/**
 * Acquire the long-running process slot through the async serialization queue.
 * Serialized via enqueueAsync to prevent race conditions when MCP clients
 * issue parallel tool calls (e.g. run_project + execute_gdscript simultaneously).
 * Returns true if acquired, false if slot is busy.
 */
export async function acquireProcessSlot(owner: string = ''): Promise<boolean> {
  return enqueueAsync(() => {
    if (_processBusy) {
      // I-06: 即时检查进程存活 — 仅在进程对象已注册时才检查
      if (_runningProcess && (_runningProcess.killed || _runningProcess.exitCode !== null)) {
        getLogger().warn('process-state', `Process slot held by "${_busyOwner}", process dead — auto-releasing`);
        _processBusy = false;
        _busyOwner = '';
        _busySince = 0;
      } else if (_busySince > 0 && Date.now() - _busySince > 300_000) {
        const processDead = !_runningProcess || _runningProcess.killed || _runningProcess.exitCode !== null;
        if (processDead) {
          getLogger().warn('process-state', `Process slot held by "${_busyOwner}" for >5min, process dead — auto-releasing`);
          _processBusy = false;
          _busyOwner = '';
          _busySince = 0;
        } else {
          getLogger().warn('process-state', `Process slot held by "${_busyOwner}" for >5min, process still alive — not releasing`);
        }
      }
      if (_processBusy) return false;
    }
    _processBusy = true;
    _busyOwner = owner;
    _busySince = Date.now();
    return true;
  });
}

export function setProcessBusy(busy: boolean): void {
  _processBusy = busy;
  if (!busy) {
    _busyOwner = '';
    _busySince = 0;
  }
}

/** Get info about what is currently holding the long-running lock. */
export function getBusyInfo(): { owner: string; startTime: number; projectDir: string } {
  return { owner: _busyOwner, startTime: _processStartTime, projectDir: _projectDir };
}

/** Build a user-friendly error message when the long-running slot is occupied. */
export function buildBusyErrorMessage(): string {
  if (!_processBusy) return '';
  const info = getBusyInfo();

  const details: string[] = [];
  if (info.startTime > 0) {
    const elapsed = Math.round((Date.now() - info.startTime) / 1000);
    details.push(`running for ${elapsed}s`);
  }
  if (info.projectDir) {
    details.push(`project: ${info.projectDir}`);
  }

  let msg = 'Error: another Godot process is running';
  if (info.owner) {
    msg += ` (started by ${info.owner}`;
    if (details.length > 0) msg += ', ' + details.join(', ');
    msg += ')';
  } else if (details.length > 0) {
    msg += ' (' + details.join(', ') + ')';
  }
  return msg + '. Use stop_project to release it.';
}

// ─── Short-running process lock ─────────────────────────────────────────────

export function acquireShortRunningSlot(): boolean {
  if (_shortRunningCount >= MAX_SHORT_CONCURRENT) return false;
  _shortRunningCount++;
  return true;
}

export function releaseShortRunningSlot(): void {
  _shortRunningCount = Math.max(0, _shortRunningCount - 1);
}

export function getShortRunningCount(): number {
  return _shortRunningCount;
}

// ─── Running process management ─────────────────────────────────────────────

export function getRunningProcess(): ChildProcess | null {
  return _runningProcess;
}

export function setRunningProcess(proc: ChildProcess | null, skipBusyCheck = false): void {
  if (!skipBusyCheck && _processBusy && proc !== null) {
    throw new Error('Cannot replace process while another operation is using it');
  }
  // Clearing the process always clears busy state
  if (proc === null) {
    if (_processBusy) {
      getLogger().debug('process-state', `setRunningProcess(null) called while process is busy (owner: ${_busyOwner || '(unknown)'}). This bypasses acquire/release semantics.`);
    }
    _processBusy = false;
    _busyOwner = '';
    _busySince = 0;
  }
  if (_runningProcess && !_runningProcess.killed && proc !== _runningProcess) {
    forceKillTree(_runningProcess);
  }
  _runningProcess = proc;
  if (!proc) {
    _outputBuffer = [];
    _processStartTime = 0;
  }
}

export function getOutputBuffer(): string[] {
  return _outputBuffer;
}

export function appendOutput(lines: string[]): void {
  _outputBuffer.push(...lines);
  if (_outputBuffer.length > MAX_OUTPUT_BUFFER_SIZE) {
    _outputBuffer = _outputBuffer.slice(-MAX_OUTPUT_BUFFER_SIZE);
  }
}

export function clearOutputBuffer(): void {
  _outputBuffer = [];
}

export function setOutputBuffer(buf: string[]): void {
  _outputBuffer = buf;
}

export function getProcessStartTime(): number {
  return _processStartTime;
}

export function setProcessStartTime(t: number): void {
  _processStartTime = t;
}

export function getProjectDir(): string {
  return _projectDir;
}

export function setProjectDir(d: string): void {
  _projectDir = d;
}

/** Reset all module-level state — for test isolation. */
export function resetState(): void {
  _runningProcess = null;
  _outputBuffer = [];
  _processStartTime = 0;
  _projectDir = '';
  _processBusy = false;
  _busyOwner = '';
  _busySince = 0;
  _shortRunningCount = 0;
  _spawnedGodotPids = new Set();
  _queueTail = Promise.resolve();
  _lastOrphanScanTime = 0;
}

// Export async queue for consumers that need serialized async operations (e.g. killProcess)
export { enqueueAsync };

// ─── Orphan process cleanup (V-01 second layer) ────────────────────────────

let _lastOrphanScanTime = 0;
const ORPHAN_SCAN_INTERVAL_MS = 30_000;

/** Escape single quotes for PowerShell single-quoted strings (' → ''). */
function escapePsSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}

/** Escape single quotes for POSIX shell single-quoted strings (' → '\''). */
function escapeShellArg(s: string): string {
  return s.replace(/'/g, "'\\''");
}

const ORPHAN_SCAN_TIMEOUT_MS = 15_000;

/**
 * 清理本会话 orphan Godot 进程（V-01 第二层，会话隔离版）。
 *
 * 默认（第一层）：遍历 `_spawnedGodotPids`，清"脱离 `_runningProcess` 管理且仍存活"的 PID。
 *   - 跳过 `_runningProcess.pid`（正在管理的进程不杀）
 *   - 已退出 PID 惰性移除
 *   - 存活且脱离管理 → killPidTree（双平台清整树）
 *
 * opt-in（第二层，崩溃恢复兜底）：`GODOT_MCP_FULL_SYSTEM_SCAN=true` 且提供 projectDir 时，
 *   走 V-01 全系统扫描（清命令行含 projectDir 的所有 Godot，跳过 runningPid）。
 *
 * 30s 节流。返回清理数。
 */
export async function killOrphanGodotProcesses(projectDir?: string): Promise<number> {
  if (Date.now() - _lastOrphanScanTime < ORPHAN_SCAN_INTERVAL_MS) return 0;
  _lastOrphanScanTime = Date.now();

  const runningPid = _runningProcess?.pid;
  let killed = 0;

  // 第一层（默认）：本会话 PID 集合
  for (const pid of Array.from(_spawnedGodotPids)) {
    if (pid === runningPid) continue;  // 正在管理，跳过
    if (!isPidAlive(pid)) { _spawnedGodotPids.delete(pid); continue; }  // 已退出，惰性移除
    killPidTree(pid);
    _spawnedGodotPids.delete(pid);
    killed++;
  }

  // 第二层（opt-in 崩溃恢复兜底）
  if (process.env.GODOT_MCP_FULL_SYSTEM_SCAN === 'true' && projectDir) {
    killed += await fullSystemScanGodot(projectDir, runningPid);
  }
  return killed;
}

/**
 * V-01 全系统扫描（仅 GODOT_MCP_FULL_SYSTEM_SCAN=true 时调用）。
 * 扫描命令行含 projectDir 的 Godot 进程并清理，跳过 excludePid（正在管理的进程）。
 * 保留 escapePsSingleQuote / escapeShellArg 转义（注入防护）。
 */
async function fullSystemScanGodot(projectDir: string, excludePid?: number): Promise<number> {
  if (!projectDir) return 0;
  const normalizedDir = projectDir.replace(/\\/g, '/');

  if (isWin) {
    const safePath = escapePsSingleQuote(normalizedDir);
    return new Promise((resolve) => {
      let settled = false;
      const ps = spawn('powershell', [
        '-NoProfile', '-Command',
        // I-01 fix: use ('*'+$path+'*') instead of "*$path*" to avoid $ expansion in -like
        // D4 fix: -like treats '['/']'/'*'/'?' as wildcards → path containing them mismatches.
        //         Switch the path test to literal .Contains($path); keep '-like ''*--path*'''
        //         (literal, no wildcard chars). '$_.CommandLine -and' guards null/empty
        //         (-and short-circuits before .Contains so null CommandLine won't throw).
        `$path = '${safePath}'; ` +
        `Get-CimInstance Win32_Process -Filter "Name LIKE 'Godot%'" | ` +
        `Where-Object { $_.CommandLine -and $_.CommandLine -like '*--path*' -and $_.CommandLine.Contains($path) -and -not ($_.CommandLine -like '*--editor*') } | ` +
        `Select-Object -ExpandProperty ProcessId | ForEach-Object { Write-Output $_ }`
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      // I-03 fix: 15s timeout to prevent hanging on unresponsive WMI/shell
      const timer = setTimeout(() => {
        if (!settled && !ps.killed) {
          settled = true;
          ps.kill();
          resolve(0);
        }
      }, ORPHAN_SCAN_TIMEOUT_MS);

      let out = '';
      let stderr = '';
      ps.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      ps.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      ps.on('close', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const pids = out.trim().split('\n').map(Number).filter(n => n > 0 && n !== excludePid);
        for (const pid of pids) {
          try {
            // P1: same async-error guard as forceKillTree — a spawn 'error' without
            // a listener crashes via uncaughtException. best-effort orphan kill.
            const tk = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
            tk.on('error', () => {});
          } catch { /* best effort */ }
        }
        if (stderr) getLogger().debug('process-state', `orphan scan stderr: ${stderr.slice(0, 200)}`);
        resolve(pids.length);
      });
      ps.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        getLogger().debug('process-state', `orphan scan error: ${err.message}`);
        resolve(0);
      });
    });
  } else {
    // I-02 fix: use single-quoted shell argument with proper escaping
    const safeDir = escapeShellArg(normalizedDir);
    return new Promise((resolve) => {
      let settled = false;
      const ps = spawn('sh', ['-c',
        `pgrep -f godot | xargs -I{} sh -c 'cat /proc/{}/cmdline 2>/dev/null | tr "\\0" " " | grep -v -- "--editor" | grep -F -- '${safeDir}' && echo {}'`
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        if (!settled && !ps.killed) {
          settled = true;
          ps.kill();
          resolve(0);
        }
      }, ORPHAN_SCAN_TIMEOUT_MS);

      let out = '';
      let stderr = '';
      ps.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      ps.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      ps.on('close', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const lines = out.trim().split('\n').filter(l => /^\d+$/.test(l.trim()));
        const pids = lines.map(Number).filter(n => n > 0 && n !== excludePid);
        for (const pid of pids) {
          try { process.kill(pid, 'SIGTERM'); } catch { /* best effort */ }
        }
        if (stderr) getLogger().debug('process-state', `orphan scan stderr: ${stderr.slice(0, 200)}`);
        resolve(pids.length);
      });
      ps.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        getLogger().debug('process-state', `orphan scan error: ${err.message}`);
        resolve(0);
      });
    });
  }
}
