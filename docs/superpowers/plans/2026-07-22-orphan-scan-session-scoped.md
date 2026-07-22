# orphan 扫描会话隔离 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `killOrphanGodotProcesses` 从"按项目目录全系统扫描"改为"默认只清本会话 spawn 过的 PID 集合 + opt-in 环境变量触发全系统扫描"，解决多会话并发时编辑器被误杀的问题。

**Architecture:** `process-state.ts` 新增 `_spawnedGodotPids` 集合记录 `run_project` spawn 的 pid；`killOrphanGodotProcesses(projectDir?)` 默认遍历集合清"脱离 `_runningProcess` 管理且仍存活"的 pid（`killPidTree` 双平台对等 `forceKillTree`），`GODOT_MCP_FULL_SYSTEM_SCAN=true` 时额外走原 V-01 全系统扫描（崩溃恢复兜底）。`runtime.ts` 的 `run_project` spawn 后注册 pid、三 handler 退出时 unregister（守卫外）；`launch_editor` 不注册（编辑器永不被自动清理）。

**Tech Stack:** TypeScript、vitest 4、Node child_process（taskkill/pkill）。

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-22-orphan-scan-session-scoped-design.md`（R1 修订完成）

## Global Constraints

- 编辑 `.gd` 文件后必须运行 `validate_scripts`（本期不涉及 .gd）。
- Windows 本机测试用 vitest；POSIX 分支测试 `win32 skip` + 依赖 CI Linux RED→GREEN（参考 `test/process-state.test.js:256-289` forceKillTree POSIX 先例）。
- `tsc` 0 错；`vitest` 全量通过（pre-existing T11 失败除外，基线见当前 master）。
- 不用 Claude 内置 Edit 工具编辑 .gd（本期不涉及）；TS 文件用 Edit/Write 正常。
- 命令用绝对路径 node.exe 或 npm script（Git Bash PATH 坑，见 memory `windows-bash-path-absolute`）。
- 测试隔离：`test/setup.js` 全局设 `GODOT_MCP_UNRESTRICTED=true`（见 memory `test-setup-global-unrestricted`），新 env `GODOT_MCP_FULL_SYSTEM_SCAN` 测试用 `vi.stubEnv` + 每测试后清理。

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `src/core/process-state.ts` | 进程状态单例 + orphan 清理 | 修改 |
| `src/tools/runtime.ts` | launch_editor / run_project / stop_project | 修改 |
| `test/process-state.test.js` | process-state 单测（真实模块） | 修改 |
| `test/runtime.test.js` | runtime 工具单测（mock process-state） | 修改 |
| `.claude/rules/godot-mcp-core.md` | orphan 扫描行为说明 | 追加 |
| `test/regression/defects.ts` | 缺陷登记 + 防复发 detect 闭包 | 追加 |

---

## Task 1: process-state.ts 数据结构 + 辅助函数

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\process-state.ts`（`_spawnedGodotPids` 声明区 + `resetState`）
- Test: `D:\GitHub\godot-mcp-enhanced\test\process-state.test.js`

**Interfaces:**
- Produces（供 Task 2/3 用）：
  - `registerSpawnedGodotPid(pid: number): void`
  - `unregisterSpawnedGodotPid(pid: number): void`
  - `getSpawnedGodotPids(): number[]`
  - `isPidAlive(pid: number): boolean`（模块内私有，不导出）
  - `killPidTree(pid: number): void`（模块内私有，不导出）

- [ ] **Step 1: 写失败测试（T1 + T2 + T7）**

在 `test/process-state.test.js` 顶部 import 块（现有 import from `'../src/core/process-state.js'`）追加：

```javascript
  registerSpawnedGodotPid,
  unregisterSpawnedGodotPid,
  getSpawnedGodotPids,
```

在文件末尾（`killOrphanGodotProcesses` describe 块之前）插入新 describe 块：

```javascript
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/process-state.test.js -t "spawnedGodotPids registry"`
Expected: FAIL — `registerSpawnedGodotPid is not a function`（尚未实现）

- [ ] **Step 3: 实现 `_spawnedGodotPids` + register/unregister/getSpawnedGodotPids**

在 `src/core/process-state.ts` 的模块级状态区（`let _shortRunningCount = 0;` 之后，即约第 104 行后）追加：

```typescript
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
```

在 `resetState()` 函数体（约第 283-294 行）的 `let _shortRunningCount` 清零之后、`_lastOrphanScanTime = 0;` 之前，插入：

```typescript
  _spawnedGodotPids = new Set();
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/process-state.test.js -t "spawnedGodotPids registry"`
Expected: PASS（4 用例全绿）

- [ ] **Step 5: 实现 `isPidAlive` + `killPidTree`（为 Task 2 准备，先写 T3b 失败测试）**

在 `test/process-state.test.js` 的 `forceKillTree` describe 块之后插入新 describe：

```javascript
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
```

`killPidTree` 需在测试中可访问。因 `killPidTree` 是模块内私有函数（不 export），测试无法直接调。**决策**：为可测性导出 `killPidTree`（仅测试用，加 `// @internal` 注释）。在 import 块加 `killPidTree`。

- [ ] **Step 6: 运行测试验证失败**

Run: `npx vitest run test/process-state.test.js -t "killPidTree"`
Expected: FAIL — `killPidTree is not defined`

- [ ] **Step 7: 实现 `isPidAlive` + `killPidTree`**

在 `src/core/process-state.ts` 的 `forceKillTree` 函数之后（约第 49 行后）追加：

```typescript
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
```

测试 import 块加 `killPidTree,`（在 `forceKillTree,` 之后）。

- [ ] **Step 8: 运行测试验证通过**

Run: `npx vitest run test/process-state.test.js -t "killPidTree"`
Expected: PASS（win32 跑 Windows 用例 + no-op；Linux CI 跑 POSIX 用例）

- [ ] **Step 9: 提交**

```bash
git add src/core/process-state.ts test/process-state.test.js
git commit -m "feat(process-state): _spawnedGodotPids 集合 + killPidTree 双平台辅助（orphan 隔离 T1）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: killOrphanGodotProcesses 重写 + opt-in 全系统扫描

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\process-state.ts`（`killOrphanGodotProcesses` :323-427 + 拆出 `fullSystemScanGodot`）
- Test: `D:\GitHub\godot-mcp-enhanced\test\process-state.test.js`

**Interfaces:**
- Consumes: Task 1 的 `killPidTree` / `isPidAlive` / `_spawnedGodotPids`
- Produces: `killOrphanGodotProcesses(projectDir?: string): Promise<number>`（签名从 `(projectDir: string)` 改可选）；`fullSystemScanGodot(projectDir, excludePid?)` 模块内私有

- [ ] **Step 1: 改造现有 `killOrphanGodotProcesses` 测试（T3a/T3c/T4/T5/T6/T8）**

在 `test/process-state.test.js` 替换现有 `describe('killOrphanGodotProcesses', ...)` 整块（原 :509-547）为：

```javascript
// ─── killOrphanGodotProcesses (默认基于集合 + opt-in 全系统扫描) ────────────

describe('killOrphanGodotProcesses', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('默认路径：清集合里存活 PID（Windows taskkill）', async () => {  // T3a
    if (process.platform !== 'win32') return;
    registerSpawnedGodotPid(process.pid);  // 当前进程，isPidAlive=true
    const count = await killOrphanGodotProcesses();
    expect(count).toBe(1);
    expect(spawn).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', String(process.pid)], { stdio: 'ignore' });
    expect(getSpawnedGodotPids()).toEqual([]);  // 清后集合空
  });

  it('跳过当前 _runningProcess.pid（正在管理的进程不杀）', async () => {  // T4
    const fakeRunning = { killed: false, pid: process.pid, kill: vi.fn(), on: vi.fn() };
    setRunningProcess(fakeRunning);
    registerSpawnedGodotPid(process.pid);      // == runningPid，应跳过
    registerSpawnedGodotPid(999999);            // 不存在，惰性移除（isPidAlive=false）
    const count = await killOrphanGodotProcesses();
    expect(count).toBe(0);  // runningPid 跳过 + 999999 不存活，均不计 killed
    expect(getSpawnedGodotPids()).toEqual([process.pid]);  // runningPid 仍在集合（未清，因跳过）
  });

  it('已退出 PID 惰性移除，返回 0', async () => {  // T5
    registerSpawnedGodotPid(999999);  // 不存在的 pid，isPidAlive=false
    const count = await killOrphanGodotProcesses();
    expect(count).toBe(0);
    expect(getSpawnedGodotPids()).toEqual([]);  // 惰性删除
  });

  it('30s 节流：第二次调用返回 0', async () => {  // T6
    registerSpawnedGodotPid(999999);
    await killOrphanGodotProcesses();
    const count = await killOrphanGodotProcesses();
    expect(count).toBe(0);
  });

  it('opt-in：GODOT_MCP_FULL_SYSTEM_SCAN=true 时触发全系统扫描', async () => {  // T3c
    vi.stubEnv('GODOT_MCP_FULL_SYSTEM_SCAN', 'true');
    const count = await killOrphanGodotProcesses('/some/project');
    // fullSystemScanGodot 走 spawn（Win: powershell / POSIX: sh），count 取决于 mock；
    // 关键验证：env 开启时额外 spawn 被调用（powershell 或 sh）
    const scanSpawn = spawn.mock.calls.find(c => c[0] === 'powershell' || c[0] === 'sh');
    expect(scanSpawn).toBeDefined();
    expect(count).toBeGreaterThanOrEqual(0);
    vi.unstubAllEnvs();
  });

  it('opt-in 关闭：不触发全系统扫描', async () => {  // T3c-neg
    vi.stubEnv('GODOT_MCP_FULL_SYSTEM_SCAN', 'false');
    await killOrphanGodotProcesses('/some/project');
    const scanSpawn = spawn.mock.calls.find(c => c[0] === 'powershell' || c[0] === 'sh');
    expect(scanSpawn).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('Windows: fullSystemScanGodot 用 literal .Contains($path)（D4，opt-in 路径）', async () => {  // T8
    if (process.platform !== 'win32') return;
    vi.stubEnv('GODOT_MCP_FULL_SYSTEM_SCAN', 'true');
    spawn.mockClear();
    const weirdPath = 'D:/my[game]/proj';
    await killOrphanGodotProcesses(weirdPath);
    const psCall = spawn.mock.calls.find(c => c[0] === 'powershell');
    expect(psCall).toBeDefined();
    const cmd = psCall[1].find(a => typeof a === 'string' && a.includes('Where-Object'));
    expect(cmd).toContain('.Contains($path)');
    expect(cmd).not.toMatch(/-like\s+\('\*'\s*\+\s*\$path/);
    expect(cmd).toContain(weirdPath);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/process-state.test.js -t "killOrphanGodotProcesses"`
Expected: FAIL — 旧实现 `(projectDir: string)` 不匹配新断言（默认路径不清集合、opt-in 未门控）

- [ ] **Step 3: 重写 `killOrphanGodotProcesses` + 拆出 `fullSystemScanGodot`**

替换 `src/core/process-state.ts` 中现有 `killOrphanGodotProcesses`（:316-427 整个函数，含 docstring）为：

```typescript
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
```

把原 `killOrphanGodotProcesses` 中 Windows/POSIX 全系统扫描实现体拆为独立私有函数 `fullSystemScanGodot`（保留原 PowerShell/pgrep 逻辑，签名加 `excludePid`，taskkill/process.kill 前跳过 `excludePid`）。在 `killOrphanGodotProcesses` 之后插入：

```typescript
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
        `$path = '${safePath}'; ` +
        `Get-CimInstance Win32_Process -Filter "Name LIKE 'Godot%'" | ` +
        `Where-Object { $_.CommandLine -and $_.CommandLine -like '*--path*' -and $_.CommandLine.Contains($path) } | ` +
        `Select-Object -ExpandProperty ProcessId | ForEach-Object { Write-Output $_ }`
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        if (!settled && !ps.killed) { settled = true; ps.kill(); resolve(0); }
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
    const safeDir = escapeShellArg(normalizedDir);
    return new Promise((resolve) => {
      let settled = false;
      const ps = spawn('sh', ['-c',
        `pgrep -f godot | xargs -I{} sh -c 'cat /proc/{}/cmdline 2>/dev/null | tr "\\0" " " | grep -F -- '${safeDir}' && echo {}'`
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        if (!settled && !ps.killed) { settled = true; ps.kill(); resolve(0); }
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
```

保留 `escapePsSingleQuote` / `escapeShellArg` / `ORPHAN_SCAN_INTERVAL_MS` 不动。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/process-state.test.js -t "killOrphanGodotProcesses"`
Expected: PASS（7 用例；win32 跑 T3a/T4/T5/T6/T3c/T3c-neg/T8，POSIX 用例 skip）

- [ ] **Step 5: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 错（`projectDir?: string` 可选签名兼容 runtime.ts:248 传参）

- [ ] **Step 6: 提交**

```bash
git add src/core/process-state.ts test/process-state.test.js
git commit -m "feat(process-state): killOrphanGodotProcesses 默认基于会话 PID 集合 + opt-in 全系统扫描（T2）

默认只清本会话 run_project 残留（多会话安全）；GODOT_MCP_FULL_SYSTEM_SCAN=true
时保留 V-01 全系统扫描作崩溃恢复兜底。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: runtime.ts 接线（run_project 注册 + handler unregister + stop_project 文案）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\runtime.ts`（run_project :136-241 + stop_project :243-253）
- Test: `D:\GitHub\godot-mcp-enhanced\test\runtime.test.js`

**Interfaces:**
- Consumes: Task 1 的 `registerSpawnedGodotPid` / `unregisterSpawnedGodotPid`，Task 2 的 `killOrphanGodotProcesses(projectDir?)`

- [ ] **Step 1: 加测试 mock + T9/T10 失败测试**

在 `test/runtime.test.js` 的 `vi.mock('../src/core/process-state.js', ...)` 块（:20-31）追加两个 mock 导出：

```javascript
  registerSpawnedGodotPid: vi.fn(),
  unregisterSpawnedGodotPid: vi.fn(),
```

在文件顶部 import（从 `../src/tools/runtime.js` 之外，需从 process-state mock 直接 import 这些 vi.fn 以便断言）。在现有 import 区追加（若 runtime.test.js 已 import 这些符号则跳过；通常 handleTool 内部用，测试需直接引用 mock）：

```javascript
import { registerSpawnedGodotPid, unregisterSpawnedGodotPid, killOrphanGodotProcesses } from '../src/core/process-state.js';
```

给 `mockProc()`（:6-14）加 `pid`：

```javascript
const mockProc = () => {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.killed = false;
  proc.unref = vi.fn();
  proc.pid = 54321;
  return proc;
};
```

在 `describe('runtime handleTool — run_project', ...)` 块末尾（:271 `});` 之前）加：

```javascript
  it('registers spawned pid for orphan cleanup', async () => {  // T9
    const proc = mockProc();
    setupSpawnMock(proc);
    const ctx = createMockCtx();
    await handleTool('runtime', { action: 'run_project', project_path: '/p' }, ctx);
    expect(registerSpawnedGodotPid).toHaveBeenCalledWith(54321);
  });
```

在 `describe('runtime handleTool — stop_project', ...)` 块（:275-306）内第一个 `it`（:280）之后加：

```javascript
  it('calls killOrphanGodotProcesses when no running process (orphan cleanup)', async () => {  // T10
    vi.clearAllMocks();
    const ctx = createMockCtx({ runningProcess: null });
    await handleTool('runtime', { action: 'stop_project', project_path: '/p' }, ctx);
    expect(killOrphanGodotProcesses).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/runtime.test.js -t "registers spawned pid"`
Expected: FAIL — `registerSpawnedGodotPid` 未被调用（run_project 尚未接线）

- [ ] **Step 3: 接线 run_project 注册 + handler unregister**

在 `src/tools/runtime.ts` 顶部 import（:6 一行从 `'../core/process-state.js'`）追加 `registerSpawnedGodotPid`, `unregisterSpawnedGodotPid`。

在 run_project `ctx.setRunningProcess(proc, true);`（:220）之后加：

```typescript
      ctx.setRunningProcess(proc, true); // skip busy check — slot acquired via acquireProcessSlot above
      registerSpawnedGodotPid(proc.pid);
```

在 run_project 的三个 handler 里 `unref`/清理处补 unregister（**守卫外**，回调顶层）。

`autoStopTimer`（:192-198）改为：

```typescript
        autoStopTimer = setTimeout(() => {
          if (ctx.runningProcess === proc) {
            setProcessBusy(false);
            void killProcess(proc);
            ctx.setRunningProcess(null);
          }
          unregisterSpawnedGodotPid(proc.pid);  // 守卫外：该 proc 退出即移除自身 pid
        }, timeout * 1000);
```

`proc.on('close')`（:201-208）改为：

```typescript
      proc.on('close', () => {
        if (ctx.runningProcess === proc) {
          setProcessBusy(false);
          ctx.setRunningProcess(null);
        }
        unregisterSpawnedGodotPid(proc.pid);  // 守卫外（ADVISORY-3）
        if (autoStopTimer) clearTimeout(autoStopTimer);
      });
```

`proc.on('error')`（:210-218）改为：

```typescript
      proc.on('error', (err) => {
        if (ctx.runningProcess === proc) {
          setProcessBusy(false);
          ctx.setRunningProcess(null);
        }
        unregisterSpawnedGodotPid(proc.pid);  // 守卫外
        if (autoStopTimer) clearTimeout(autoStopTimer);
        appendOutput([`Spawn error: ${err.message}`]);
      });
```

- [ ] **Step 4: 运行测试验证 T9 通过**

Run: `npx vitest run test/runtime.test.js -t "registers spawned pid"`
Expected: PASS

- [ ] **Step 5: 运行 T10 + 现有 run_project/stop_project 全量测试**

Run: `npx vitest run test/runtime.test.js`
Expected: PASS（含新 T9/T10 + 现有 run_project/stop_project/wait_for_bridge/Imp-4 全绿）

- [ ] **Step 6: 提交**

```bash
git add src/tools/runtime.ts test/runtime.test.js
git commit -m "feat(runtime): run_project 注册 pid + handler unregister（orphan 隔离 T3）

run_project spawn 后 registerSpawnedGodotPid；close/error/autoStop 三 handler
守卫外 unregister（ADVISORY-3）。stop_project 继续传 projectDir（opt-in 用）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: rules 文档 + defects.ts 登记

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-core.md`（「常见陷阱」段）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts`

- [ ] **Step 1: 更新 rules 文档**

在 `.claude/rules/godot-mcp-core.md` 的「常见陷阱」段，找到现有 `run_and_verify 可能残留进程` 条目，在其后追加：

```markdown
- **orphan 扫描会话隔离（多会话安全，v0.x+）**：`stop_project` 的 orphan 清理**默认只清本会话 `run_project` 启动过、脱离管理且仍存活的 Godot 进程**（按 PID 集合，非全系统扫描）。多个并发会话操作同一项目时，互不误杀对方的编辑器/游戏进程。`launch_editor` 启动的编辑器**不纳入** orphan 清理（detached，用户有意长期运行，永不被自动杀）。崩溃恢复场景（MCP server 重启后内存 PID 集合丢失）：设环境变量 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 后调 `stop_project`，恢复 V-01 全系统扫描兜底（按项目目录匹配，会清所有匹配的 Godot，慎用）。
```

- [ ] **Step 2: defects.ts 登记**

读 `test/regression/defects.ts` 现有结构（defect 条目格式 + detect 闭包模式），按既有格式追加一条 defect（参考现有条目的字段：id / 标题 / 严重度 / detect 闭包 / 状态）。detect 闭包检测：`killOrphanGodotProcesses` 默认路径不再全系统扫描（grep 确认 `GODOT_MCP_FULL_SYSTEM_SCAN` 门控存在 + `_spawnedGodotPids` 集合存在）。

具体条目内容（字段名对齐 defects.ts 现有定义，实现者读文件后对齐）：

```typescript
{
  id: 'orphan-scan-session-scoped',
  title: 'orphan 扫描按项目目录全系统扫，多会话误杀编辑器',
  severity: 'P1',
  status: 'fixed',
  detect: (src) => {
    // 默认路径基于 _spawnedGodotPids 集合；全系统扫描须 GODOT_MCP_FULL_SYSTEM_SCAN 门控
    const ps = src['src/core/process-state.ts'] ?? '';
    return ps.includes('_spawnedGodotPids')
      && ps.includes('GODOT_MCP_FULL_SYSTEM_SCAN')
      && !/killOrphanGodotProcesses\(projectDir:\s*string\)/.test(ps);  // 签名改可选
  },
},
```

> 实现者：读 defects.ts 确认字段名（id/title/severity/status/detect 等）与现有条目完全一致；detect 闭包的 `src` 参数形态（Record<文件路径, 内容>）对齐现有闭包。

- [ ] **Step 3: 运行 defects 回归**

Run: `npx vitest run test/regression/`
Expected: PASS（新 defect detect 闭包对当前实现返回 true=已修复；现有 defects 不受影响）

- [ ] **Step 4: 提交**

```bash
git add .claude/rules/godot-mcp-core.md test/regression/defects.ts
git commit -m "docs(rules): orphan 扫描会话隔离说明 + defects 登记（T4）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 全量验证（发版门禁）

- [ ] **Step 1: tsc 全量**

Run: `npx tsc --noEmit`
Expected: 0 错

- [ ] **Step 2: vitest 全量**

Run: `npx vitest run`
Expected: 全绿（pre-existing T11 失败除外——实现者用 `git stash` 对比基线确认 4 failed 全为 T11 pre-existing，0 新回归；参考 memory `P2-1 csv 回归坑`的基线对比法）

- [ ] **Step 3: 确认 0 新回归**

对比 master 基线：当前 master 的 vitest 失败数 vs 本分支失败数，差值 = 0（新加测试全绿，无原有测试被改红）。

- [ ] **Step 4: （可选）集成验证**

若有 Godot 环境，用 dev_loop 或 run_project + stop_project 实跑一次：
- launch_editor 启动编辑器 → stop_project → 确认编辑器窗口仍在（核心验收 #2）
- run_project 启动游戏 → stop_project → 确认游戏被清（验收 #3）

无 Godot 环境则跳过，依赖单测 + final review。

---

## Self-Review

**Spec 覆盖**：
- §4.1 数据结构 → Task 1 Step 3 ✓
- §4.2 killOrphanGodotProcesses 重写 → Task 2 Step 3 ✓
- §4.3 run_project 注册 / stop_project 文案 → Task 3 Step 3/5 ✓
- §4.4 spawn 点决策（launch_editor 不注册、headless 不注册）→ Task 3 只接 run_project，launch_editor 不动 ✓
- §5 验收标准 1-8 → Task 1-5 测试覆盖（#1/#2 多会话隔离=单测逻辑保证 + 可选集成验；#3 V-01 兜底=T3a/T5；#4 跳过 runningPid=T4；#5 节流=T6；#6 集合不增长=T1 unregister + T5 惰性；#7 跨平台=T3b；#8 0 新回归=Task 5）✓
- §6.1 unregister 守卫外 → Task 3 Step 3 ✓
- §6.3 opt-in env → Task 2 Step 3 + Task 4 rules ✓
- §7 测试 T1-T10 → Task 1/2/3 ✓

**Placeholder 扫描**：无 TBD/TODO；每步含完整代码或精确命令。

**类型一致性**：`killOrphanGodotProcesses(projectDir?: string)` 在 Task 2 定义、Task 3 调用一致；`registerSpawnedGodotPid`/`unregisterSpawnedGodotPid`/`getSpawnedGodotPids`/`killPidTree` 在 Task 1 定义、Task 2/3 消费一致。

**风险**：Task 2 Step 3 的 `fullSystemScanGodot` 代码量大但直接搬运现有 V-01 实现体（加 `excludePid` 过滤），无新逻辑。Task 3 Step 3 三 handler 改动需精确匹配现有 `runtime.ts:192-218` 行结构（实现者 Read 确认行号后再 Edit）。
