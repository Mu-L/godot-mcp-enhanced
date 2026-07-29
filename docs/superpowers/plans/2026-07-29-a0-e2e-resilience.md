# A0 e2e-resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补 report4 P0-1/P0-2 核心韧性运行时验证缺口——新增真进程 e2e（headless 进 CI + editor OPT_IN），为后续 A/B/C/D 批次 TDD detect 提供可信地基（spec `docs/superpowers/specs/2026-07-29-审查修复批次设计.md`）。

**Architecture:** 拆两部分。**A0-headless（接入 ci.yml）**：spawn 真 headless Godot 子进程 → `registerSpawnedGodotPid` → `killOrphanGodotProcesses` → 验集合清空 + 进程真死（process-state 孤儿清理契约的真进程验证，`--headless` 无 GUI 故 CI 可跑）。**A0-editor（`E2E_EDITOR` opt-in，CI skip）**：仿 `e2e-asset-tools.test.ts` 模式，自管 pid spawn editor → 建立 EditorConnection → kill -9 → `requestReconnect` → 验真重连 + executeChain 串行。

**Tech Stack:** vitest、Node `child_process`、`EditorConnection`、`process-state` 模块、ci.yml godot-matrix。

## Global Constraints

- master 不 push（[[user-prefers-local-ahead-no-push]]）
- 门禁：`tsc` 0 / `eslint` 0 err / `check:gdscript` 0-0 / `vitest` 全量 passed（4 pre-existing T11 baseline 须确认非回归）
- gating 模式（IMPORTANT-9b）：`const GODOT_PATH = process.env.GODOT_PATH || ''`（默认空强制显式设）+ `hasGodot = existsSync(GODOT_PATH)` + `describe.skipIf(!hasGodot)` + `process.stderr.write` 盲区告警（**非 console.warn**，vitest 捕获 console）
- editor OPT_IN：`E2E_EDITOR=1`（仿 e2e-asset-tools:60），CI GUI 不可用默认 skip + stderr 告警
- 进程安全：每个 it 自清理子进程（afterEach `resetState` + 杀残留 spawn），防 Godot 泄漏（[[l2-bridge-test-pitfalls]]：afterEach kill→单 it；timeout:120）
- **A0 的 TDD 形态特殊**：A0 是建测试验证**现有**契约，不写生产代码。测试绿=契约正确；测试红=暴露 bug，**归对应批次修**（如 headless spawn orphan→B 批次 report1 P1②），A0 不修 bug 只建检测

## File Structure

- Create: `test/e2e-resilience-headless.test.ts` — CI 真进程孤儿清理（P0-1③）
- Create: `test/e2e-resilience-editor.test.ts` — OPT_IN editor 重连 + executeChain 串行（P0-1①② + P0-2）
- Modify: `.github/workflows/ci.yml:145` — E2E 白名单加 `e2e-resilience-headless`

## 前置勘察（已做，锁死 plan 事实）

- `process-state.ts` 导出：`registerSpawnedGodotPid`(:139) / `unregisterSpawnedGodotPid`(:144) / `getSpawnedGodotPids`(:149) / `killOrphanGodotProcesses`(:377) / `resetState`(:330)
- `killOrphanGodotProcesses` 默认基于 `_spawnedGodotPids` 集合 + `isPidAlive`（不按进程名）→ register 任何存活 pid 都会被清理（`process-state.test.js:583` 假 PID 单元已证逻辑，A0 增量=真进程）
- editor e2e 先例：`e2e-asset-tools.test.ts`（`E2E_EDITOR` opt-in:60 + `readEditorSecret`:99 + `new EditorConnection({reconnect:false,secret,...})`:108）
- `launch_editor` spawn **detached 不注册 PID**（`runtime.test.js:209` 多会话契约）→ editor 崩溃注入**必须自管 pid**（非 detached spawn 拿 `child.pid`）

---

### Task 1: e2e-resilience-headless.test.ts（CI 真进程孤儿清理）

**Files:**
- Create: `test/e2e-resilience-headless.test.ts`
- 参考: `test/process-state.test.js:583`（假 PID 单元）、`test/e2e-p1-p5.test.ts:26-37`（gating 模式）

**Interfaces:**
- Consumes: `registerSpawnedGodotPid` / `getSpawnedGodotPids` / `killOrphanGodotProcesses` / `resetState` from `../src/core/process-state.js`
- Produces: `test/e2e-resilience-headless.test.ts`（Task 2 接入 ci.yml）

- [ ] **Step 1: 写测试文件 `test/e2e-resilience-headless.test.ts`**

```ts
/**
 * E2E Resilience (headless, CI) — 真进程验证 process-state 孤儿清理契约。
 * 补 report4 P0-1③: 强杀后扫孤儿 PID（_spawnedGodotPids）应为空。
 * 与 process-state.test.js:583（假 PID 单元）互补——spawn 真 headless Godot 子进程，
 * 验 killOrphanGodotProcesses 真清理真进程（非 mock isPidAlive）。--headless 无 GUI，CI 可跑。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  registerSpawnedGodotPid,
  getSpawnedGodotPids,
  killOrphanGodotProcesses,
  resetState,
} from '../src/core/process-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);
// 复用 e2e-p1-p5 的 e2e-scene fixture（无 autoload，headless 能驻留）
const FIXTURE_PROJECT = resolve(__dirname, 'e2e-scene');

if (!hasGodot) {
  process.stderr.write(
    `[E2E-SKIP] 未找到 GODOT_PATH (${GODOT_PATH})。e2e-resilience-headless 将跳过。设置 GODOT_PATH 启用。\n`,
  );
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** spawn 真 headless Godot 驻留子进程（--headless --path 跑项目主循环，不立即退）。 */
function spawnHeadlessGodot(): ChildProcess {
  return spawn(GODOT_PATH, ['--headless', '--path', FIXTURE_PROJECT], {
    stdio: 'ignore',
    env: { ...process.env },
  });
}

describe.skipIf(!hasGodot)('e2e-resilience (headless): 孤儿进程清理真进程契约', () => {
  let children: ChildProcess[] = [];

  afterEach(async () => {
    for (const c of children) { try { c.kill('SIGKILL'); } catch { /* 已退 */ } }
    children = [];
    resetState();
  }, 30_000);

  it('注册的真 headless Godot 进程被 killOrphanGodotProcesses 清理（集合清空 + 进程真死）', async () => {
    const proc = spawnHeadlessGodot();
    children.push(proc);
    const pid = proc.pid!;

    await new Promise((r) => setTimeout(r, 1500)); // 等就绪
    expect(isPidAlive(pid), 'headless Godot 应已启动并存活').toBe(true);

    registerSpawnedGodotPid(pid); // 模拟 run_project:224 注册
    expect(getSpawnedGodotPids()).toContain(pid);

    const killed = await killOrphanGodotProcesses();

    expect(getSpawnedGodotPids()).not.toContain(pid);
    expect(isPidAlive(pid), '孤儿清理后进程应已死').toBe(false);
    expect(killed).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('killOrphanGodotProcesses 幂等：二次调用清理 0', async () => {
    const proc = spawnHeadlessGodot();
    children.push(proc);
    const pid = proc.pid!;
    await new Promise((r) => setTimeout(r, 1500));
    registerSpawnedGodotPid(pid);

    await killOrphanGodotProcesses();
    const secondCall = await killOrphanGodotProcesses();
    expect(secondCall, '二次调用应清 0（幂等）').toBe(0);
    expect(getSpawnedGodotPids()).not.toContain(pid);
  }, 30_000);
});
```

- [ ] **Step 2: 跑测试，确认存活前提成立**

Run: `GODOT_PATH=<你的 godot 路径> npx vitest run test/e2e-resilience-headless.test.ts`
Expected: 2 passed

**⚠ Spike（Step 2 可能失败点）**：`godot --headless --path e2e-scene` 若**立即退出**（fixture 无 MainScene/autoload 致 headless 无主循环），`isPidAlive` 在 1500ms 后为 false → 第一个断言红。此时**不是 bug**，是 fixture 不驻留。解决（按优先）：
1. 改用 `test/fixtures/e2e-project`（e2e-full-tool-verification:23 用的 fixture，有场景）；
2. 或 spawn args 加驻留脚本 `['--headless','--path',FIXTURE,'--script','<res://wait.gd>']`（写个 `while true: await` 脚本）；
3. 确认 fixture 选择后再定稿，勿盲目换。

- [ ] **Step 3: 若测试绿 → 验契约正确；若红且非 fixture 问题 → 记录归 B 批次**

绿 = 孤儿清理契约正确（detect 地基就位）。
红（killOrphanGodotProcesses 没清掉真进程）= report1 P1② 类 bug → **记录到 `D:\workspace\Obsidian\GodotMCP\项目待办.md` B 批次**，A0 不修（A0 只建检测）。

- [ ] **Step 4: Commit**

```bash
git add test/e2e-resilience-headless.test.ts
git commit -m "test(e2e): A0-headless 真进程孤儿清理契约（CI 可跑，补 report4 P0-1③）"
```

---

### Task 2: ci.yml 接入 e2e-resilience-headless

**Files:**
- Modify: `.github/workflows/ci.yml:145`

- [ ] **Step 1: E2E 白名单加文件**

`ci.yml:145` 现状：
```
run: npx vitest run test/e2e-full-tool-verification.test.ts test/e2e-p1-p5.test.ts test/tools/data-import-integration.test.ts --reporter=json --outputFile=coverage/e2e-report-${{ matrix.name }}.json
```
改为（追加 `test/e2e-resilience-headless.test.ts`）：
```
run: npx vitest run test/e2e-full-tool-verification.test.ts test/e2e-p1-p5.test.ts test/tools/data-import-integration.test.ts test/e2e-resilience-headless.test.ts --reporter=json --outputFile=coverage/e2e-report-${{ matrix.name }}.json
```

- [ ] **Step 2: 本地预演 CI 路径（无 GODOT_PATH 应 skip 不红）**

Run: `npx vitest run test/e2e-resilience-headless.test.ts`（不设 GODOT_PATH）
Expected: skip（stderr 告警 `[E2E-SKIP]`），**不红**（describe.skipIf 生效）。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(E2E): godot-matrix 白名单加 e2e-resilience-headless（韧性维度首进 CI）"
```

---

### Task 3: e2e-resilience-editor.test.ts — editor 真重连（OPT_IN，需先 spike）

**Files:**
- Create: `test/e2e-resilience-editor.test.ts`
- 参考: `test/e2e-asset-tools.test.ts:60-121`（E2E_EDITOR opt-in + readEditorSecret + EditorConnection harness）

**Interfaces:**
- Consumes: `EditorConnection`（`requestReconnect`/`connect`/`disconnect`/`getState`）、`readEditorSecret` from `../src/core/editor-auth.js`、`EditorToolExecutor`
- Produces: editor 崩溃重连真进程验证（report4 P0-1① + P0-2 mock 鸿沟）

- [ ] **Step 0: Spike — editor spawn/就绪/secret harness 可行性（必须先做）**

A0-editor 是**新 harness**（e2e-asset-tools 依赖外部手动启动 editor，A0 要自管 spawn/kill/restart）。先验证三点，结果决定 Step 1 代码：

1. **非 detached spawn editor 拿 pid**：`spawn(GODOT_PATH, ['--editor','--path',REAL_PROJECT], {stdio:'pipe'})`（**不**用 detached，否则 child.pid 不可控 kill）→ 拿 `child.pid`。
2. **9090 就绪等待**：轮询 `new WebSocket('ws://127.0.0.1:9090')` 连接成功（或 readEditorSecret 成功=plugin _ready 已跑），超时 30s。
3. **secret 读取**：editor 启动后 `{project}/.godot/mcp_editor.key` 生成，`readEditorSecret(REAL_PROJECT)` 读出。

Spike 产出：确认 REAL_PROJECT fixture（`test/fixtures/real-project`，需含 `addons/godot_mcp_server/`——若缺，`cp -r addons/godot_mcp_server test/fixtures/real-project/addons/` + project.godot 加 `[editor_plugins] enabled=PackedStringArray("godot_mcp_server")`，参 [[editor-e2e-direct-websocket-verification]]）。

- [ ] **Step 1: 写测试框架 `test/e2e-resilience-editor.test.ts`**

```ts
/**
 * E2E Resilience (editor, OPT_IN) — editor 真进程崩溃重连。
 * 补 report4 P0-1① + P0-2: EditorConnection 354 行 mock ws 与真 Godot 进程鸿沟。
 * 仿 e2e-asset-tools，但自管 editor pid（spawn/kill/restart），非手动启动。
 * E2E_EDITOR=1 opt-in，CI GUI 不可用默认 skip。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EditorConnection } from '../src/core/EditorConnection.js';
import { readEditorSecret } from '../src/core/editor-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);
const hasEditorFlag = !!process.env.E2E_EDITOR;
const REAL_PROJECT = resolve(__dirname, 'fixtures', 'real-project');
const hasProject = existsSync(REAL_PROJECT) && existsSync(resolve(REAL_PROJECT, 'project.godot'));
const canRun = hasGodot && hasProject && hasEditorFlag;

if (!canRun) {
  const reasons: string[] = [];
  if (!hasGodot) reasons.push(`GODOT_PATH 未设(${GODOT_PATH || '<空>'})`);
  if (!hasProject) reasons.push(`real-project fixture 不存在(${REAL_PROJECT})`);
  if (!hasEditorFlag) reasons.push('E2E_EDITOR=1 未设(需 GUI editor + 插件)');
  process.stderr.write(
    `[E2E-SKIP] e2e-resilience-editor 未启用。原因: ${reasons.join('; ')}\n` +
    `  CI(GUI 不可用)默认跳过。本地: GODOT_PATH=<godot> E2E_EDITOR=1 npx vitest run test/e2e-resilience-editor.test.ts\n`,
  );
}

const EDITOR_PORT = parseInt(process.env.GODOT_EDITOR_PORT ?? '9090', 10);

/** spawn editor 非 detached（拿可 kill 的 pid）+ 等就绪。 */
async function startEditor(): Promise<ChildProcess> {
  const child = spawn(GODOT_PATH, ['--editor', '--path', REAL_PROJECT], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 轮询 secret 文件 = plugin _ready 已跑 + WS 监听
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (readEditorSecret(REAL_PROJECT)) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error('editor 30s 内未就绪（mcp_editor.key 未生成）');
}

describe.skipIf(!canRun)('e2e-resilience (editor): 崩溃后 EditorConnection 真重连', () => {
  let editor: ChildProcess | null = null;
  let conn: EditorConnection | null = null;

  afterEach(async () => {
    if (conn) { try { conn.disconnect(); } catch { /* */ } conn = null; }
    if (editor) { try { editor.kill('SIGKILL'); } catch { /* */ } editor = null; }
  }, 60_000);

  it('kill -9 editor → 重启 → requestReconnect 真重连 + query_scene_tree 恢复', async () => {
    editor = await startEditor();
    const secret = readEditorSecret(REAL_PROJECT)!;

    conn = new EditorConnection({
      port: EDITOR_PORT, host: '127.0.0.1',
      reconnect: false, secret, connectTimeout: 10_000, requestTimeout: 30_000,
    });
    await conn.connect();
    expect(conn.getState()).toBe('connected');

    // 崩溃注入：kill -9 editor（非 detached，pid 可控）
    const deadPid = editor.pid!;
    editor.kill('SIGKILL');
    editor = null;
    await new Promise((r) => setTimeout(r, 1000)); // 等 ws close 传播
    expect(conn.getState(), 'editor 死后应断连').not.toBe('connected');

    // 重启 editor + 手动触发重连（manage_tools(reconnect) 路径）
    editor = await startEditor();
    const newSecret = readEditorSecret(REAL_PROJECT)!; // 重启可能重生 secret
    conn.requestReconnect(); // 注：若 secret 变，需重建 conn（spike 确认 PERSISTENT_SECRET 行为）

    // 轮询重连成功（reconnect:false 时 requestReconnect 内部 scheduleReconnect，等回连）
    const reconDeadline = Date.now() + 30_000;
    while (Date.now() < reconDeadline && conn.getState() !== 'connected') {
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(conn.getState(), '重启后应重连成功').toBe('connected');
  }, 120_000);
});
```

- [ ] **Step 2: 跑测试（OPT_IN）**

Run: `GODOT_PATH=<godot> E2E_EDITOR=1 npx vitest run test/e2e-resilience-editor.test.ts`
Expected: 1 passed

**⚠ Spike 风险（Step 2 大概率首次红）**：
- `reconnect:false` + `requestReconnect` 组合是否真能重连（`requestReconnect:557` 调 `resetReconnectState` + `scheduleReconnect`，但 `reconnect:false` 是构造参数——需核实它是否禁用 scheduleReconnect；若是，测试要改 `reconnect:true` 或重建 conn）。**这是 Task 3 最关键核实点**，先读 `EditorConnection` 构造函数确认 `reconnect` 参数语义。
- secret 重生（PERSISTENT_SECRET=false 时重启重生）→ `newSecret` ≠ 旧 secret，conn 的 secret 过期 → 需设 `GODOT_MCP_EDITOR_PERSISTENT_SECRET=true` 或重建 conn。spike 确认。
- `query_scene_tree 恢复` 断言本 task 先省略（避免 open_scene 依赖），重连 getState 即可；query_scene_tree 留 follow-up。

- [ ] **Step 3: Commit（即便只有重连断言，无 query_scene_tree）**

```bash
git add test/e2e-resilience-editor.test.ts
git commit -m "test(e2e): A0-editor 崩溃重连真进程（OPT_IN，补 report4 P0-1①/P0-2 mock 鸿沟）"
```

---

### Task 4: executeChain 串行不变量（editor OPT_IN，需 spike）

**Files:**
- Modify: `test/e2e-resilience-editor.test.ts`（加 describe 块）或独立 it
- 参考: `src/core/EditorToolExecutor.ts:47-55`（executeChain 串行所有 editor 工具）

- [ ] **Step 0: Spike — 怎么观测串行**

executeChain 串行是性能/正确性不变量（防 undo LIFO）。观测方式待定（spike）：
1. 时间序：并发发 N 个 edit_node，记录各自 request 的开始/结束时间，验无重叠（区间不相交）；或
2. undo 栈顺序：N 个 edit_node 后 undo N 次，验恢复顺序正确（依赖 editor undo API，参 [[godot-editor-undo-redo-manager-not-undo-redo]]）。

推荐时间序（不依赖 undo API 复杂度），但需 EditorToolExecutor 暴露时序或用 spy。

- [ ] **Step 1: spike 后补测试**（代码待 spike 结果定，**不预先写死**——避免 placeholder）

- [ ] **Step 2: Commit**

```bash
git commit -am "test(e2e): A0-editor executeChain 串行不变量（report4 P0-1②，OPT_IN）"
```

---

## Self-Review（writing-plans step 7）

**1. Spec coverage（report4 P0-1/P0-2）**：
- P0-1① editor 崩溃重连 → Task 3 ✓
- P0-1② executeChain 串行 → Task 4 ✓
- P0-1③ 孤儿 PID 清空 → Task 1 ✓（headless 真进程版）
- P0-2 EditorConnection mock 鸿沟 → Task 3 ✓（真 editor EditorConnection）
- 「接入 ci.yml:145」→ Task 2 ✓（仅 headless；editor OPT_IN 不接 CI，spec A0 定界已确认）

**2. Placeholder scan**：Task 4 Step 1 标注「代码待 spike 结果定」——这是**有意的 spike 占位**（非偷懒），因 executeChain 串行观测方式未定。Task 1/2/3 均有完整代码。可接受（Task 4 是 A0 最不确定项，诚实标注优于瞎写）。

**3. Type consistency**：`EditorConnection` 构造参数（port/host/reconnect/secret/connectTimeout/requestTimeout）与 e2e-asset-tools:108 一致；`getState()` 返回 `'connected'|'reconnecting'|...`（Step 2 Spike 需核实 `reconnect:false` 下 `requestReconnect` 行为——这是类型/行为一致性的关键核实点，已标注）。

**4. 关键风险（plan 诚实标注，非阻塞）**：
- Task 1 Step 2：headless Godot 驻留行为（fixture 选择）
- Task 3 Step 2：`reconnect:false` + `requestReconnect` 组合 + secret 重生（PERSISTENT_SECRET）
- Task 4 Step 0：串行观测方式

这三处 spike 是 A0-editor 的固有复杂度（report4 P0-2 点名的"鸿沟"），plan 不假装已解决，执行时逐个核实。
