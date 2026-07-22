# orphan 扫描会话隔离 设计文档

> **日期**: 2026-07-22
> **审查状态**: R1 修订完成（eng-review 3 IMPORTANT + 4 ADVISORY 已采纳），待进 plan
>
> **R1 修订记录**（headless-reviewer 独立审查）：
> - IMPORTANT-1：§4.2 抽 `killPidTree(pid)` 公共函数，POSIX 分支补 `pkill -P` 对等 `forceKillTree`（:35-47）；`run_project` 直接 spawn 不走 spawnGodot，V-01 残留子进程对它仍存在，POSIX 必须双杀
> - IMPORTANT-2：§6.3 从"完全移除全系统扫描"改为 opt-in env `GODOT_MCP_FULL_SYSTEM_SCAN=true` 默认关闭（默认仍是方向 A）；§9 修正 run_project 不走 spawnGodot 的事实
> - IMPORTANT-3：§7 T3 拆 T3a（Windows taskkill）/ T3b（POSIX pkill+SIGTERM，win32 skip），补 POSIX 覆盖防 CI 假绿
> - ADVISORY-1/2/3/4：§4.4 补 dashboard 脚注、§4.1 注释 only-run_project、§6.1 unregister 放守卫外、§6.4 提 future kill_editor
> **关联**: V-01（`docs/superpowers/specs/2026-06-07-v01-process-management-design.md`）、用户反馈"并发处理多个问题时其他进程总是杀掉编辑器"
> **根因调试**: `superpowers:systematic-debugging` Phase 1 完成（源码铁证）

## 1. 问题现象

用户在并发处理多个问题时（多个 Claude 会话 / 多个 MCP 客户端连接，各自独立 MCP server 进程），编辑器进程"总是会"被杀掉。现象看起来随机——实际是各会话不定时调用 `stop_project` 触发 orphan 扫描，清掉了同一台机器上其他会话（或本会话）正在运行的 Godot 编辑器。

## 2. 根因（源码铁证）

完整调用链：

1. **`launch_editor` 用 detached 启动编辑器且不注册 `_runningProcess`**：
   - `D:\GitHub\godot-mcp-enhanced\src\tools\runtime.ts:128` `spawn(godot, ['--editor', '--path', p], { detached: true, stdio: 'ignore', ... })` → `:132` `child.unref()`
   - 编辑器完全脱离 MCP server 进程独立存活，`_runningProcess` 始终为 `null`。

2. **`stop_project` 在 `!ctx.runningProcess` 时触发 orphan 扫描**：
   - `D:\GitHub\godot-mcp-enhanced\src\tools\runtime.ts:244-248`：`if (!ctx.runningProcess) { ... await killOrphanGodotProcesses(projectDir); }`
   - editor 模式下 `_runningProcess` 永远是 null → **必然走 orphan 扫描分支**。

3. **`killOrphanGodotProcesses` 以"项目目录"为键扫描全系统 Godot 进程**：
   - `D:\GitHub\godot-mcp-enhanced\src\core\process-state.ts:343-345`（Windows）：`Get-CimInstance Win32_Process -Filter "Name LIKE 'Godot%'" | Where { CommandLine -like '*--path*' -and CommandLine.Contains($path) }` → `:370` `taskkill /F /T /PID`
   - 编辑器命令行 `godot --editor --path <项目目录>` 同时命中 `--path` 与项目目录 → **被当孤儿杀掉**。

**关键缺陷**：orphan 扫描的匹配键是"项目目录"，不是"本 MCP server 进程启动的 PID"。多会话操作同一项目时，任一会话的 `stop_project` 会把系统里所有命令行含该项目目录的 Godot 进程（本会话 + 其他并发会话的编辑器、游戏、headless）一锅端。

**`killOrphanGodotProcesses` 全代码库唯一调用点**：`runtime.ts:248`。

## 3. V-01 原始意图 vs 实现退化

V-01 设计文档（`2026-06-07-v01-process-management-design.md`）阐明 orphan 扫描的初衷：

> `run_and_verify` 用 `execFileAsync` 启动 headless Godot，Windows 上 Godot 分裂出父子进程，超时 `proc.kill()` 只杀父进程，**子进程残留**脱离 `_runningProcess` 管理。orphan 扫描是兜底"清理本 MCP server 启动过、但因进程树分裂/崩溃而脱离管理的残留 Godot"。

**V-01 要清的本来就是"自己启动的失控进程"**，但实现退化成"按项目目录全系统扫"——这个匹配键在多会话/多 MCP server 环境下无法区分"我启动的"与"别人启动的"，必然误杀。

且 V-01 修复后 `run_and_verify` 已改用 `spawnGodot`（`spawn-helper.ts`）+ `forceKillTree`（`taskkill /F /T` 清整棵树），execFileAsync 残留子进程问题已大幅缓解，全系统扫描的兜底价值已下降。

**本方案回归 V-01 原始意图**：orphan 扫描只清"本会话 spawn 过的 Godot 进程"。

## 4. 方案：orphan 扫描改为基于"本会话 PID 集合"

### 4.1 核心数据结构（process-state.ts）

新增模块级状态 `_spawnedGodotPids: Set<number>`，记录**本 MCP server 进程 spawn 的、需要 orphan 兜底的长生命周期 Godot 进程 PID**。

```typescript
// process-state.ts 新增
// 仅 run_project 注册（长生命周期游戏进程，崩溃残留需 orphan 兜底）。
// launch_editor 不注册（detached 编辑器，用户有意长期运行，见 §4.4）；
// B 类 headless 不注册（自带 forceKillTree 清理，见 §4.4）。
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

`resetState()` 增加 `_spawnedGodotPids = new Set();`（测试隔离）。

### 4.2 killOrphanGodotProcesses 重写（默认基于集合 + opt-in 全系统扫描）

签名从 `(projectDir: string)` 改为 `(projectDir?: string)`（projectDir 仅 opt-in 全系统扫描路径用，默认路径忽略）。

```typescript
// process-state.ts 重写
export async function killOrphanGodotProcesses(projectDir?: string): Promise<number> {
  if (Date.now() - _lastOrphanScanTime < ORPHAN_SCAN_INTERVAL_MS) return 0;
  _lastOrphanScanTime = Date.now();

  const runningPid = _runningProcess?.pid;  // 正在管理的进程不杀
  let killed = 0;

  // 第一层（默认）：清本会话 spawn 过、脱离管理且存活的 PID
  for (const pid of Array.from(_spawnedGodotPids)) {
    if (pid === runningPid) continue;            // 正在管理，跳过
    if (!isPidAlive(pid)) { _spawnedGodotPids.delete(pid); continue; }  // 已退出，惰性移除
    killPidTree(pid);                            // 存活且脱离管理 → 清整树
    _spawnedGodotPids.delete(pid);
    killed++;
  }

  // 第二层（opt-in 崩溃恢复兜底，IMPORTANT-2）：GODOT_MCP_FULL_SYSTEM_SCAN=true 时全系统扫描
  if (process.env.GODOT_MCP_FULL_SYSTEM_SCAN === 'true' && projectDir) {
    killed += await fullSystemScanGodot(projectDir, runningPid);
  }
  return killed;
}
```

**辅助函数**（process-state.ts 新增/调整）：

```typescript
/** 探测 PID 是否存活（signal 0，不发信号）。 */
function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * 按 PID 杀进程树（IMPORTANT-1：与 forceKillTree 共享双平台语义）。
 * Windows taskkill /F /T 清整树；POSIX pkill -P 杀子进程 + SIGTERM 主进程
 * （Godot 可能 spawn 导入/资源子进程，对等 forceKillTree POSIX 分支 :35-47）。
 */
function killPidTree(pid: number): void {
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

**fullSystemScanGodot**：保留原 V-01 PowerShell `Get-CimInstance` / pgrep 全系统扫描逻辑，签名 `(projectDir: string, excludePid?: number)`，跳过 `runningPid`（防误杀正在管理的进程），返回清理数。仅在 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 时被调用。`escapePsSingleQuote` / `escapeShellArg` 保留（fullSystemScanGodot 用）。

**保留**：`_lastOrphanScanTime` / `ORPHAN_SCAN_INTERVAL_MS`（30s 节流）。

### 4.3 调用点改动（runtime.ts）

#### run_project：spawn 后注册 pid，退出时 unregister

`runtime.ts:220` `ctx.setRunningProcess(proc, true);` 之后新增：

```typescript
ctx.setRunningProcess(proc, true);
registerSpawnedGodotPid(proc.pid);   // 新增：登记到 orphan 兜底集合
```

run_project 的 `close` / `error` / `autoStop` 三个 handler（`:201` `:210` `:192`）在 `ctx.setRunningProcess(null)` 旁补 `unregisterSpawnedGodotPid(proc.pid)`（proc 闭包捕获，pid 稳定）。

#### stop_project：调用改无参

`runtime.ts:248`：

```typescript
// 之前
const projectDir = (typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : '') || ctx.projectDir || '';
const orphanKilled = await killOrphanGodotProcesses(projectDir);

// 之后
const orphanKilled = await killOrphanGodotProcesses();
```

返回信息文案调整（不再依赖 projectDir）：

```typescript
if (orphanKilled > 0) {
  return textResult(`Cleaned up ${orphanKilled} orphaned Godot process(es) from this session.`);
}
return textResult('No project is currently running.');
```

#### launch_editor：不改（不注册）

编辑器是 GUI 长期运行进程，用户有意保持。detached + unref 的语义就是"脱离 MCP 生命周期"。**不注册到 `_spawnedGodotPids`** → orphan 扫描永不会碰它。用户清理卡死编辑器的退路见 §6.4。

### 4.4 各 spawn 点处理决策

| spawn 点 | 文件:行 | 进程类型 | 是否注册 `_spawnedGodotPids` | 理由 |
|----------|---------|----------|------------------------------|------|
| `run_project` | `runtime.ts:170` | 长生命周期游戏进程（进 `_runningProcess`） | ✅ 注册 | 崩溃残留时需 orphan 兜底（V-01 原始场景） |
| `launch_editor` | `runtime.ts:128` | detached 编辑器（不进 `_runningProcess`） | ❌ 不注册 | 用户有意长期运行，不该被自动清理 |
| `spawnGodot` | `spawn-helper.ts:46` | headless 一次性（validation/scene/workflow/android 等） | ❌ 不注册 | 自带 `forceKillTree(/T)` 超时清理，await 完成即清理，不残留 |
| `execute_gdscript` | `gdscript-executor.ts:1141` | headless 一次性 | ❌ 不注册 | 同上（slot 机制 + 超时清理） |
| `screenshot` capture | `screenshot.ts:79` | headless 一次性 | ❌ 不注册 | 同上 |
| `godot-spawn.ts` | `godot-spawn.ts:24` | headless 一次性 | ❌ 不注册 | 同上 |
| `run_tests` | `runtime.ts:307` | headless 一次性（GUT） | ❌ 不注册 | 同上 |

> **脚注（ADVISORY-1）**：`src/dashboard/launcher.ts:21` 也有 `spawn`，但启动的是 `node <dashboardPath>`（TUI），非 Godot 进程，不被 orphan 扫描匹配（`Name LIKE 'Godot%'`），已排查不在范围。

## 5. 验收标准

1. **多会话隔离**：会话 A `launch_editor` + 运行中，会话 B 调 `stop_project`，会话 A 的编辑器**不被杀**。
2. **本会话自洽**：会话 A `launch_editor` 后，会话 A 自己调 `stop_project`，编辑器**不被杀**（核心回归——当前 bug 最痛的点）。
3. **V-01 兜底保留**：会话 `run_project` 后进程崩溃脱离管理（`_runningProcess` 被清成 null 但进程实际残留），`stop_project` 仍能清掉该残留 PID。
4. **正在管理的进程不被 orphan 误杀**：`run_project` 正常运行时（`_runningProcess` 非空且 pid 匹配），orphan 扫描跳过它（即便在集合里）。
5. **30s 节流保留**：30 秒内重复 `stop_project` 不重复探测。
6. **集合不无限增长**：进程正常退出（close handler）主动 unregister；orphan 扫描惰性移除已退出 PID。
7. **跨平台**：`killPidTree` 双平台对等——Windows `taskkill /F /T`、POSIX `pkill -P` + `SIGTERM`（对等 `forceKillTree` :35-47，IMPORTANT-1）。
8. **0 新回归**：`tsc` 0 错；`vitest` 全量通过（pre-existing T11 除外）；process-state / runtime 测试同步更新。

## 6. 边界决策点（待 reviewer 确认）

### 6.1 run_project 退出时：主动 unregister vs 仅惰性清理
**建议**：两者都做。close/error/autoStop handler 主动 `unregisterSpawnedGodotPid(proc.pid)`，orphan 扫描惰性兜底。**关键（ADVISORY-3）**：unregister 必须放在 handler 的**守卫外**（`proc.on('close')` 回调顶层），不能放进 `if (ctx.runningProcess === proc)` 守卫内——若旧 proc 被新 run_project 替换，旧 close handler 触发时守卫为 false，守卫内的 unregister 不会执行。放守卫外则该 proc 退出总能移除自身 pid；守卫失效时惰性清理（isPidAlive=false）再兜底。

### 6.2 B 类 headless（spawnGodot 等）是否注册
**建议**：不注册。这些进程是"启动→await 输出→forceKillTree 清理"的同步模型，V-01 改用 spawnGodot 后已不残留。注册它们会让集合频繁增删且无实际 orphan 价值（YAGNI）。

### 6.3 保留 opt-in 全系统扫描（环境变量，默认关闭）—— R1 修订
**决定**：保留全系统扫描代码，但用 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 门控，**默认关闭**。理由（eng-review IMPORTANT-2）：
- **默认行为仍是方向 A**（只清本会话 pid 集合），多会话安全，不违背用户选择；
- MCP server 崩溃 / Ctrl+C / IDE 重启是常态（非罕见）：run_project 正在跑且未调 stop_project 时，`_runningProcess` 与 `_spawnedGodotPids` **同在内存丢失**，重启后集合空，默认路径无法清残留——此时全系统扫描是唯一兜底；
- run_project 直接 `spawn`（runtime.ts:170）**不走 spawnGodot**，V-01 残留子进程场景对它仍存在（§9 风险表已修正此事实）；
- opt-in 默认关闭兼顾两者：日常多会话安全，崩溃恢复时用户显式设 env 清一次。成本：保留现有 PowerShell/pgrep 代码 + 一行 env check。
- rules 文档说明降级路径：设 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 后调 stop_project。

### 6.4 编辑器卡死的清理退路
launch_editor 不注册后，编辑器卡死时 `stop_project` 无法清它。退路（按优先级）：
1. 用户手动任务管理器结束（总是可行）；
2. 编辑器是 GUI，正常情况用户关窗口即可。
**建议**：接受此限制，在 rules 文档说明。卡死是罕见场景，不值得为它保留危险的全系统扫描。**未来改进（ADVISORY-4，非本期）**：可加独立 `kill_editor` 工具——launch_editor 时记录 detached pid 到独立集合（非 `_spawnedGodotPids`），kill_editor 显式清它，绕过 orphan 扫描。

### 6.5 `killOrphanGodotProcesses` 签名 —— R1 修订
签名从 `(projectDir: string)` 改为 `(projectDir?: string)`（projectDir 改可选，仅 opt-in 全系统扫描路径用，默认路径忽略）。唯一运行时调用点 `runtime.ts:248` 继续传 projectDir（无需改）；`test/runtime.test.js` mock 不受影响（vi.fn）。**已确认无外部消费者**（全仓 import 搜索：仅 runtime.ts 运行时 + 测试 mock）。

## 7. 测试计划

### 单元测试（process-state.test.js）

| # | 用例 | 验证点 |
|---|------|--------|
| T1 | `registerSpawnedGodotPid` / `unregisterSpawnedGodotPid` 基础 | 注册后 `getSpawnedGodotPids()` 含该 PID；unregister 后不含 |
| T2 | `registerSpawnedGodotPid` 忽略非法 PID（0/负数/NaN） | 集合不含 |
| T3a | `killOrphanGodotProcesses()` Windows 清集合存活 PID | win32：mock `isPidAlive=true` + mock spawn，验证 `taskkill /F /T /PID` 被调、返回 1、集合清空 |
| T3b | `killPidTree` POSIX 双杀（pkill -P + SIGTERM） | win32 skip + Linux RED→GREEN（参考 forceKillTree POSIX 测试先例 :256-289）；验 `spawn('pkill', ['-P', pid])` + `process.kill(pid,'SIGTERM')` 都被调；pkill spawn error 不崩（P1 先例） |
| T3c | opt-in 全系统扫描门控 | vi.stubEnv `GODOT_MCP_FULL_SYSTEM_SCAN=true` + 提供 projectDir，验 `fullSystemScanGodot` 被调；env 未开时不触发 |
| T4 | 跳过当前 `_runningProcess.pid` | 集合含 runningPid + 另一 PID，只清另一 PID |
| T5 | 已退出 PID 惰性移除 | mock `isPidAlive=false`，验证从集合删除、返回 0 |
| T6 | 30s 节流 | 第二次调用返回 0 |
| T7 | `resetState()` 清空集合 | 注册后 reset，`getSpawnedGodotPids()` 为空 |
| T8 | D4 PowerShell 测试改为针对 opt-in 路径 | 全系统扫描代码保留（fullSystemScanGodot，§6.3），D4 改为验 `GODOT_MCP_FULL_SYSTEM_SCAN=true` 时 `.Contains($path)` 仍生效；env 未开时不触发 |

> **mock 策略**：`process.kill(pid, 0)` 探测与 `spawn('taskkill')` 需可 mock。`process-state.test.js` 顶部已 `vi.mock('child_process')`；`process.kill` 用 `vi.stubGlobal` 或在 `isPidAlive` 内可注入。TDD 时先确认 mock 注入点（若 `process.kill` 难 mock，`isPidAlive` 导出为可替换函数或在测试用真实不存在的 PID 让其自然返回 false）。

### 单元测试（runtime.test.js）

| # | 用例 | 验证点 |
|---|------|--------|
| T9 | `run_project` spawn 后注册 PID | mock spawn 返回带 pid 的 child，验证 `getSpawnedGodotPids()` 含该 pid |
| T10 | `stop_project`（`_runningProcess=null`）调无参 `killOrphanGodotProcesses` | 验证调用签名（不再传 projectDir） |

> 现有 `runtime.test.js` / `runtime-timeout.test.ts` 中涉及 stop_project orphan 的断言同步更新。

## 8. 文件改动清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `src/core/process-state.ts` | 修改 | 新增 `_spawnedGodotPids` + `register/unregister/getSpawnedGodotPids` + `isPidAlive` + `killPidTree`（双平台对等 forceKillTree）；重写 `killOrphanGodotProcesses(projectDir?)` 为默认基于集合 + opt-in `fullSystemScanGodot`；保留 `escapePsSingleQuote`/`escapeShellArg`（fullSystemScanGodot 用）；`resetState` 补清集合 |
| `src/tools/runtime.ts` | 修改 | `run_project` spawn 后 `registerSpawnedGodotPid` + 三 handler 守卫**外** `unregister`（§6.1）；`stop_project` 继续传 projectDir（opt-in 用）+ 文案 |
| `test/process-state.test.js` | 修改 | T1-T8（含删 D4 旧测试） |
| `test/runtime.test.js` | 修改 | T9-T10 + 同步现有 orphan 断言 |
| `test/runtime-timeout.test.ts` | 修改 | 同步 stop_project orphan 相关断言（若有） |
| `.claude/rules/godot-mcp-core.md` | 追加 | 「常见陷阱」更新 orphan 扫描行为：多会话安全，只清本会话 run_project 残留，不再全系统扫 |
| `defects.ts`（或 defects 权威源） | 追加 | 登记此缺陷 + detect 闭包（防复发） |

## 9. 风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| MCP server 崩溃后残留 Godot（内存集合丢失）默认路径无法清理 | 中（崩溃是常态） | opt-in `GODOT_MCP_FULL_SYSTEM_SCAN=true` 后调 stop_project 全系统扫描兜底（§6.3） |
| 完全失联的 Godot（父 PID 未知）opt-in 全系统扫描可清 | 低 | env 开启时 fullSystemScanGodot 按项目目录扫 |
| `run_project` 崩溃后子进程残留（父 PID 在集合但子进程逃逸） | 低 | `killPidTree` 双平台清整树：Windows `taskkill /F /T`、POSIX `pkill -P` + SIGTERM（IMPORTANT-1，对等 forceKillTree） |
| `process.kill(pid, 0)` 在 Windows 对已退出 PID 的行为 | 低 | 已退出 PID 抛 EPERM/ESRCH → `isPidAlive` 返回 false → 惰性移除（符合预期） |
| 集合在 MCP server 长期运行后累积 | 低 | close handler 主动 unregister + orphan 扫描惰性清理双保险 |

## 10. 不做（YAGNI）

- 不引入 Windows Job Object 绑定子进程（过度工程）。
- 不给 launch_editor 加进程管理 / `_runningProcess` 注册（单例槽语义冲突，编辑器本就该 detached）。
- 不保留 opt-in 全系统扫描环境变量（§6.3）。
- 不改 B 类 headless spawn 的清理模型（已自洽）。

## 自查清单

- [x] 根因有源码 file:line 铁证（§2）
- [x] 回归 V-01 原始意图（§3）
- [x] 每个 spawn 点的处理决策有理由（§4.4）
- [x] 验收标准可验证（§5）
- [x] 边界决策点暴露给 reviewer（§6）
- [x] 测试计划含 mock 策略说明（§7）
- [x] 无 TBD/TODO/placeholder
- [x] 文件改动清单完整（§8）
