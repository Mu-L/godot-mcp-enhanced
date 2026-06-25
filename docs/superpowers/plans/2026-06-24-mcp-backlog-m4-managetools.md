# MCP backlog 次要项(M4 + manage_tools)+ S4/S5/S6 验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `run_project` 加可选 bridge 就绪探测(M4),让 `manage_tools` 的 reconnect/sync 接入真实连接状态,并验证 S4/S5/S6 运行时修复。

**Architecture:** M4 = `game-bridge.ts` 导出 `isBridgeReady`(独立短连接 + 零接触缓存 + 进程早退短路),`runtime.ts` 的 `run_project` 可选调用它。manage_tools = `manage-tools.ts` 加注入式 `setConnectionStatusProvider`/`setReconnectEditor`(复用 `setOnGroupsChanged` 模式)+ `buildConnectionStatus`/`buildReconnectEditor` 纯工厂,`GodotServer.ts` 接线。S4/S5/S6 是运行时验证(独立验证会话,需重启 MCP)。

**Tech Stack:** TypeScript(ESM)、vitest、Node `net`/`fs`、Godot 4.6。

## Global Constraints

- 编辑 `.gd` 后跑 `validate_scripts`;`.ts` 改动后跑 `vitest` + `tsc --noEmit` + `eslint`。
- `.ts` 测试用 vitest;mock 模式对齐 `test/runtime.test.js`(EventEmitter mockProc + vi.mock)与 `test/tools/manage-tools.test.ts`(vi.hoisted + vi.mock tool-registry/shared)。
- commit message 中文,末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`;每个 Task 一个 commit。
- 分支 `fix/mcp-tools-s1-s3-s4`;引用文件用绝对路径。
- YAGNI:不重构 `_doConnect`、不引入 bridge 持久连接、不动 `findGodot`(默认引擎 = M3 已覆盖)。
- 全套 vitest 须通过(基线 2718+ passed);tsc 0 错;eslint 0 警告。

---

## File Structure

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/tools/game-bridge.ts` | 新增 `isBridgeReady`(零接触探测)+ `_testBridgeCacheState`(测试快照) | Modify |
| `src/tools/runtime.ts` | `run_project` 接 `wait_for_bridge`/`bridge_timeout` + schema | Modify |
| `src/tools/manage-tools.ts` | 注入 setter + `handleReconnect`/`handleSync` + `buildConnectionStatus`/`buildReconnectEditor` 工厂 | Modify |
| `src/GodotServer.ts` | 接线 `setConnectionStatusProvider`/`setReconnectEditor` + stop 清理 | Modify |
| `test/game-bridge-isready.test.ts` | isBridgeReady 四态 + 零接触断言 | Create |
| `test/runtime.test.js` | run_project wait_for_bridge 分支(追加用例) | Modify |
| `test/tools/manage-tools.test.ts` | reconnect/sync 用例(追加) | Create/Modify |
| `docs/review-followup-2026-06-23-mcp-tools.md` | 追加 M4/manage_tools 已修段 | Modify |
| `.claude/rules/godot-mcp-core.md`/`godot-mcp-bridge.md` | run_project 新参数 + reconnect/sync 真实行为 | Modify |

依赖:Task 2 ← Task 1;Task 4 ← Task 3;Task 5 ← 1-4;Task 6 ← 1-5。

---

## Task 1: `isBridgeReady` — bridge 就绪探测(零接触 + 进程早退短路)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\game-bridge.ts`(顶部 import 加 `ChildProcess` 类型;末尾追加 `isBridgeReady`/`probeOnce`/`sleep`/`_testBridgeCacheState`)
- Test: `D:\GitHub\godot-mcp-enhanced\test\game-bridge-isready.test.ts`(Create)

**Interfaces:**
- Produces: `isBridgeReady(projectDir: string, timeoutMs: number, opts?: { proc?: ChildProcess; isCancelled?: () => boolean }): Promise<{ ready: boolean; reason: string }>`;`_testBridgeCacheState(): { projectDir: string|null; cachedSecret: string|null; socketNotNull: boolean }`。
- 消费模块常量:`BRIDGE_PORT`(9081)、`BRIDGE_HOST`('localhost'),不消费模块变量 `_projectDir`/`_cachedSecret`/`_socket`(零接触)。

- [ ] **Step 1: 写失败测试(Create `test/game-bridge-isready.test.ts`)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { mockCreate, mockExists, mockRead } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExists: vi.fn(() => true),
  mockRead: vi.fn(() => 'test-secret'),
}));

vi.mock('net', () => ({ createConnection: mockCreate }));
vi.mock('fs', () => ({
  existsSync: mockExists,
  readFileSync: mockRead,
  writeFileSync: vi.fn(), copyFileSync: vi.fn(), unlinkSync: vi.fn(),
  chmodSync: vi.fn(), statSync: vi.fn(), lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
  renameSync: vi.fn(),
}));

import { isBridgeReady, setBridgeProjectDir, _testBridgeCacheState } from '../src/tools/game-bridge.js';

/** 模拟 bridge 立即 auth 成功的 socket。 */
function authSuccessSocket(): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn();
  (sock as any).destroy = vi.fn();
  queueMicrotask(() => sock.emit('data', Buffer.from(JSON.stringify({ id: 0, result: { authenticated: true } }) + '\n')));
  return sock;
}
/** 永不发 auth 成功(卡住,触发 timeout)。 */
function stuckSocket(): EventEmitter {
  const sock = new EventEmitter();
  (sock as any).write = vi.fn();
  (sock as any).destroy = vi.fn();
  return sock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockReturnValue(true);
  mockRead.mockReturnValue('test-secret');
  setBridgeProjectDir('/known-project'); // 预设模块 _projectDir,用于零接触断言
});

describe('isBridgeReady', () => {
  it('auth 成功 → ready=true,且模块缓存零接触', async () => {
    const before = _testBridgeCacheState();
    mockCreate.mockReturnValue(authSuccessSocket());
    const r = await isBridgeReady('/other-project', 1000);
    expect(r.ready).toBe(true);
    expect(_testBridgeCacheState()).toEqual(before); // _projectDir 仍 /known-project,_cachedSecret/_socket 未变
  });

  it('secret 不存在 → ready=false, reason 含 secret not found', async () => {
    mockExists.mockReturnValue(false);
    const r = await isBridgeReady('/p', 100);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('secret not found');
  });

  it('auth 一直不成功 → ready=false, reason 含 did not succeed', async () => {
    mockCreate.mockReturnValue(stuckSocket());
    const r = await isBridgeReady('/p', 300);
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('did not succeed');
  });

  it('进程已 killed → 立即短路,不等 timeout', async () => {
    const proc = { killed: true } as any;
    const r = await isBridgeReady('/p', 5000, { proc });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('process exited during probe');
  });

  it('isCancelled 返回 true → 立即短路', async () => {
    const r = await isBridgeReady('/p', 5000, { isCancelled: () => true });
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('process exited during probe');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/game-bridge-isready.test.ts`
Expected: FAIL —— `isBridgeReady` / `_testBridgeCacheState` 未导出(ImportError)。

- [ ] **Step 3: 实现(game-bridge.ts)**

顶部 import 块(第 5 行 `import { execFileSync } from 'child_process';` 改为同时引入类型):
```ts
import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
```

文件末尾追加:
```ts
// ─── Bridge readiness probe (M4) ────────────────────────────────────────────
// 零接触:自读 secret + 独立短 socket,绝不碰模块级 _projectDir/_cachedSecret/_socket。
// 供 run_project(wait_for_bridge=true) 使用。

export interface BridgeReadyResult {
  ready: boolean;
  reason: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** 单次 TCP auth 探测(独立 socket,即建即毁)。成功返回 true。 */
function probeOnce(secretPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let secret: string;
    try {
      secret = readFileSync(secretPath, 'utf-8').trim();
    } catch {
      resolve(false);
      return;
    }
    const sock = createConnection({ port: BRIDGE_PORT, host: BRIDGE_HOST }, () => {
      sock.write(JSON.stringify({ id: 0, method: 'auth', params: { secret } }) + '\n');
    });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; sock.destroy(); resolve(false); }
    }, 1000);
    sock.on('data', (data: Buffer) => {
      if (settled) return;
      try {
        const resp = JSON.parse(data.toString().trim());
        if (resp?.result?.authenticated) {
          settled = true; clearTimeout(timer); sock.destroy(); resolve(true);
        }
      } catch { /* 部分/非 JSON 数据,忽略 */ }
    });
    sock.on('error', () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
    });
  });
}

/**
 * 探测 bridge autoload 是否已启动并接受 auth。轮询直到就绪/进程退出/超时。
 * 全程零接触模块级缓存:secret 由 projectDir 自拼路径自读。
 */
export async function isBridgeReady(
  projectDir: string,
  timeoutMs: number,
  opts?: { proc?: ChildProcess; isCancelled?: () => boolean },
): Promise<BridgeReadyResult> {
  const secretPath = join(projectDir, '.godot', `mcp_bridge_${BRIDGE_PORT}.secret`);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const interval = 500;

  for (;;) {
    if (opts?.proc?.killed || opts?.isCancelled?.()) {
      return { ready: false, reason: 'process exited during probe' };
    }
    if (existsSync(secretPath)) {
      if (await probeOnce(secretPath)) return { ready: true, reason: 'bridge ready' };
    }
    if (Date.now() >= deadline) {
      return existsSync(secretPath)
        ? { ready: false, reason: 'bridge auth did not succeed within timeout' }
        : { ready: false, reason: 'secret not found (bridge not installed?)' };
    }
    await sleep(Math.min(interval, deadline - Date.now()));
  }
}

/** 测试专用:模块缓存快照,用于断言 isBridgeReady 零接触。 */
export function _testBridgeCacheState(): {
  projectDir: string | null;
  cachedSecret: string | null;
  socketNotNull: boolean;
} {
  return { projectDir: _projectDir, cachedSecret: _cachedSecret, socketNotNull: _socket !== null };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/game-bridge-isready.test.ts`
Expected: PASS(5 用例)。

- [ ] **Step 5: 提交**

```bash
git add src/tools/game-bridge.ts test/game-bridge-isready.test.ts
git commit -m "feat(bridge): isBridgeReady 零接触探测 + 进程早退短路 (M4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `run_project` 接 `wait_for_bridge`

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\runtime.ts`(`run_project` case `:120-188` + 工具 schema)
- Test: `D:\GitHub\godot-mcp-enhanced\test\runtime.test.js`(追加用例)

**Interfaces:**
- Consumes: `isBridgeReady(projectDir, timeoutMs, opts)`(Task 1 产出)。
- Produces: `run_project` 新可选参数 `wait_for_bridge`(bool,默认 false)、`bridge_timeout`(秒,默认 10)。默认 false → 行为不变。

- [ ] **Step 1: 在 `test/runtime.test.js` 顶部 mock 块追加 game-bridge mock**

在现有 `vi.mock('fs', ...)` 之后加:
```js
vi.mock('../src/tools/game-bridge.js', () => ({
  isBridgeReady: vi.fn(),
  setBridgeProjectDir: vi.fn(),
}));
```
并在文件顶部 import 区追加:
```js
import { isBridgeReady } from '../src/tools/game-bridge.js';
```

- [ ] **Step 2: 写失败测试(追加到 `test/runtime.test.js` 末尾 describe 内)**

```js
function resultText(r) { return (r?.content?.[0]?.text) ?? ''; }

it('run_project 默认不探测 bridge', async () => {
  spawn.mockImplementation(() => mockProc());
  isBridgeReady.mockReset();
  const ctx = createMockCtx();
  await handleTool('run_project', { project_path: '/p' }, ctx);
  expect(isBridgeReady).not.toHaveBeenCalled();
});

it('run_project wait_for_bridge=true 且就绪 → 文本含 Bridge ready', async () => {
  spawn.mockImplementation(() => mockProc());
  isBridgeReady.mockResolvedValue({ ready: true, reason: 'bridge ready' });
  const ctx = createMockCtx();
  const r = await handleTool('run_project', { project_path: '/p', wait_for_bridge: true }, ctx);
  expect(isBridgeReady).toHaveBeenCalledWith('/p', expect.any(Number), expect.objectContaining({ isCancelled: expect.any(Function) }));
  expect(resultText(r)).toContain('Bridge ready');
});

it('run_project wait_for_bridge 但进程早退 → 文本含 not ready + process exited', async () => {
  spawn.mockImplementation(() => mockProc());
  isBridgeReady.mockResolvedValue({ ready: false, reason: 'process exited during probe' });
  const ctx = createMockCtx();
  const r = await handleTool('run_project', { project_path: '/p', wait_for_bridge: true, bridge_timeout: 10 }, ctx);
  expect(resultText(r)).toContain('not ready');
  expect(resultText(r)).toContain('process exited');
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/runtime.test.js -t "wait_for_bridge"`
Expected: FAIL —— 文本不含 "Bridge ready"(实现未加)。

- [ ] **Step 4: 实现 runtime.ts**

顶部 import 加(若已有 `game-bridge` import 则合并):
```ts
import { isBridgeReady } from './game-bridge.js';
```

在 `run_project` case 内(`runtime.ts:125` `const timeout = ...` 之后)解析新参数:
```ts
const waitForBridge = args.wait_for_bridge === true;
const bridgeTimeout = Math.max(1, Number(args.bridge_timeout) || 10);
```

把原返回行(`runtime.ts:187`):
```ts
return textResult(warnPrefix + `Running project at ${p} (timeout: ${timeout}s). Use get_debug_output or stop_project to check.`);
```
替换为:
```ts
let bridgeMsg = '';
if (waitForBridge) {
  const r = await isBridgeReady(p, bridgeTimeout * 1000, {
    proc,
    isCancelled: () => ctx.runningProcess !== proc,
  });
  bridgeMsg = r.ready ? 'Bridge ready. ' : `⚠ Bridge not ready (${r.reason}). `;
}
return textResult(warnPrefix + bridgeMsg + `Running project at ${p} (timeout: ${timeout}s). Use get_debug_output or stop_project to check.`);
```

run_project 工具定义的 `inputSchema.properties` 追加两属性:
```ts
wait_for_bridge: { type: 'boolean', default: false, description: 'true 时 spawn 后轮询 bridge 就绪(默认 false,向后兼容)' },
bridge_timeout: { type: 'number', default: 10, description: 'wait_for_bridge 轮询总预算(秒,默认 10)' },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/runtime.test.js`
Expected: PASS(含 3 个新用例 + 原有用例不回归)。

- [ ] **Step 6: 提交**

```bash
git add src/tools/runtime.ts test/runtime.test.js
git commit -m "feat(runtime): run_project 加 wait_for_bridge 就绪探测 (M4)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: manage_tools 注入 setter + reconnect/sync 逻辑

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\manage-tools.ts`(加 `ConnectionStatus` 类型 + `setConnectionStatusProvider`/`setReconnectEditor` + 改 `handleReconnect`/`handleSync`)
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\manage-tools.test.ts`(追加用例)

**Interfaces:**
- Produces: `setConnectionStatusProvider(fn | null)`、`setReconnectEditor(fn | null)`;`handleReconnect`/`handleSync` 改为消费注入的 provider/reconnectEditor。
- Consumes(Task 4 注入):provider 返回 `ConnectionStatus`、reconnectEditor 返回 `{ connected: boolean; detail: string }`。

- [ ] **Step 1: 写失败测试(追加到 `test/tools/manage-tools.test.ts`)**

import 区追加:
```ts
import { setConnectionStatusProvider, setReconnectEditor } from '../../src/tools/manage-tools.js';
```
`beforeEach` 内追加清理:
```ts
setConnectionStatusProvider(null);
setReconnectEditor(null);
```
追加用例:
```ts
it('reconnect 无 provider → editor=null + bridge no-op 说明', async () => {
  const result = await handleTool('manage_tools', { action: 'reconnect' }, {} as any);
  const data = JSON.parse((result!.content as any)[0].text);
  expect(data.success).toBe(true);
  expect(data.data.editor).toBeNull();
  expect(data.data.bridge.detail).toContain('无需重连');
});

it('reconnect 注入 reconnectEditor → 返回其结果', async () => {
  setReconnectEditor(async () => ({ connected: true, detail: '手动重连完成' }));
  const result = await handleTool('manage_tools', { action: 'reconnect' }, {} as any);
  const data = JSON.parse((result!.content as any)[0].text);
  expect(data.data.editor).toEqual({ reconnected: true, detail: '手动重连完成' });
});

it('sync 无 provider → status 为 unknown', async () => {
  const result = await handleTool('manage_tools', { action: 'sync' }, {} as any);
  const data = JSON.parse((result!.content as any)[0].text);
  const bridgeGroup = data.data.groups.find((g: any) => g.name === 'bridge');
  expect(bridgeGroup.status).toContain('unknown');
});

it('sync 注入 provider → requires 映射状态', async () => {
  setConnectionStatusProvider(() => ({
    editor: { installed: true, connected: true, state: 'connected' },
    bridge: { note: '每请求建连' },
  }));
  const result = await handleTool('manage_tools', { action: 'sync' }, {} as any);
  const data = JSON.parse((result!.content as any)[0].text);
  // mock TOOL_GROUPS 含 core(requires [])/animation([])/bridge(['bridge'])
  const byName = Object.fromEntries(data.data.groups.map((g: any) => [g.name, g]));
  expect(byName.core.status).toBe('n/a');        // requires []
  expect(byName.animation.status).toBe('n/a');   // requires []
  expect(byName.bridge.status).toBe('probe-required'); // requires ['bridge']
  expect(data.data.editor.connected).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/manage-tools.test.ts -t "reconnect|sync"`
Expected: FAIL —— `setConnectionStatusProvider`/`setReconnectEditor` 未导出;handleReconnect/handleSync 仍返回 NOT_IMPLEMENTED。

- [ ] **Step 3: 实现 manage-tools.ts**

顶部 import 块后追加类型:
```ts
import type { ConnectionState } from '../types.js';

export interface ConnectionStatus {
  editor: { installed: boolean; connected: boolean; state: ConnectionState | null };
  bridge: { note: string };
}

let _connectionStatusProvider: (() => ConnectionStatus) | null = null;
let _reconnectEditor: (() => Promise<{ connected: boolean; detail: string }>) | null = null;

export function setConnectionStatusProvider(fn: (() => ConnectionStatus) | null): void {
  _connectionStatusProvider = fn;
}
export function setReconnectEditor(fn: (() => Promise<{ connected: boolean; detail: string }>) | null): void {
  _reconnectEditor = fn;
}
```

替换 `handleSync`(`manage-tools.ts:133-135`)与 `handleReconnect`(`:137-139`)为:
```ts
async function handleReconnect(): Promise<ToolResult> {
  let editor: { reconnected: boolean; detail: string } | null;
  if (_reconnectEditor) {
    const r = await _reconnectEditor();
    editor = { reconnected: r.connected, detail: r.detail };
  } else {
    editor = null;
  }
  return textResult(JSON.stringify(opsSuccess({
    editor,
    bridge: { reconnected: false, detail: 'bridge 每请求建连,无需重连;用 game_query(method=ping) 探测' },
  })));
}

function handleSync(): ToolResult {
  const provider = _connectionStatusProvider;
  const groups = Object.entries(TOOL_GROUPS).map(([name, def]) => {
    const requires = def.requires ?? [];
    let status: string;
    if (!provider) {
      status = 'unknown (no provider)';
    } else {
      const cs = provider();
      if (requires.includes('editor')) status = cs.editor.connected ? 'connected' : 'disconnected';
      else if (requires.includes('bridge')) status = 'probe-required';
      else status = 'n/a';
    }
    return { name, requires, status };
  });
  return textResult(JSON.stringify(opsSuccess({
    groups,
    editor: provider?.().editor ?? null,
    bridge: provider?.().bridge ?? null,
  })));
}
```

`handleTool` switch 中两行改为 await(Task 2 已在 async 函数内):
```ts
case 'sync': return handleSync();
case 'reconnect': return await handleReconnect();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/manage-tools.test.ts`
Expected: PASS(新 4 用例 + 原有 list/activate/deactivate/migrate 不回归)。

- [ ] **Step 5: 提交**

```bash
git add src/tools/manage-tools.ts test/tools/manage-tools.test.ts
git commit -m "feat(manage-tools): 注入 connectionStatusProvider/reconnectEditor + 实现 reconnect/sync

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: `buildConnectionStatus`/`buildReconnectEditor` 工厂 + GodotServer 接线

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\manage-tools.ts`(加两个纯工厂)
- Modify: `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts`(接线 + stop 清理)
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\manage-tools.test.ts`(追加工厂用例)

**Interfaces:**
- Produces: `buildConnectionStatus(editorConn, healthMonitor): ConnectionStatus`、`buildReconnectEditor(getEditor): () => Promise<{connected, detail}>`。
- Consumes: `EditorConnection.isConnected()`/`.connect()`(EditorConnection.ts:511/139)、`HealthMonitor.getState()`(health-monitor.ts:174)。

- [ ] **Step 1: 写失败测试(追加到 manage-tools.test.ts)**

import 追加:
```ts
import { buildConnectionStatus, buildReconnectEditor } from '../../src/tools/manage-tools.js';
```
用例:
```ts
it('buildConnectionStatus 映射 editorConn + healthMonitor', () => {
  const ec = { isConnected: () => true } as any;
  const hm = { getState: () => 'connected' } as any;
  const cs = buildConnectionStatus(ec, hm);
  expect(cs.editor).toEqual({ installed: true, connected: true, state: 'connected' });
  expect(cs.bridge.note).toBeTruthy();

  const cs2 = buildConnectionStatus(null, null);
  expect(cs2.editor).toEqual({ installed: false, connected: false, state: null });
});

it('buildReconnectEditor: 已连接 → 不调 connect', async () => {
  const ec = { isConnected: () => true, connect: vi.fn() };
  const fn = buildReconnectEditor(() => ec as any);
  const r = await fn();
  expect(ec.connect).not.toHaveBeenCalled();
  expect(r).toEqual({ connected: true, detail: '已连接' });
});

it('buildReconnectEditor: 未连接 → 调 connect', async () => {
  const ec = { isConnected: () => false, connect: vi.fn(async () => { ec.isConnected = () => true; }) };
  const fn = buildReconnectEditor(() => ec as any);
  const r = await fn();
  expect(ec.connect).toHaveBeenCalled();
  expect(r.connected).toBe(true);
});

it('buildReconnectEditor: 无 editorConn → 提示 launch_editor', async () => {
  const fn = buildReconnectEditor(() => null);
  const r = await fn();
  expect(r.connected).toBe(false);
  expect(r.detail).toContain('launch_editor');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/manage-tools.test.ts -t "buildConnectionStatus|buildReconnectEditor"`
Expected: FAIL —— 两个工厂未导出。

- [ ] **Step 3: 实现工厂(manage-tools.ts 末尾追加)**

```ts
// ─── 纯工厂(供 GodotServer 接线,可单测)────────────────────────────────────

export interface EditorConnLike {
  isConnected(): boolean;
  connect(): Promise<void>;
}
export interface HealthMonitorLike {
  getState(): ConnectionState;
}

export function buildConnectionStatus(
  editorConn: EditorConnLike | null,
  healthMonitor: HealthMonitorLike | null,
): ConnectionStatus {
  return {
    editor: {
      installed: editorConn !== null,
      connected: editorConn?.isConnected() ?? false,
      state: healthMonitor?.getState() ?? null,
    },
    bridge: { note: '每请求建连,无持久连接' },
  };
}

export function buildReconnectEditor(
  getEditor: () => EditorConnLike | null,
): () => Promise<{ connected: boolean; detail: string }> {
  return async () => {
    const ec = getEditor();
    if (!ec) return { connected: false, detail: 'editor 未安装,用 launch_editor / F5 启动编辑器' };
    if (ec.isConnected()) return { connected: true, detail: '已连接' };
    try {
      await ec.connect();
      return { connected: ec.isConnected(), detail: '手动重连完成' };
    } catch (e) {
      return { connected: false, detail: `重连失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/manage-tools.test.ts`
Expected: PASS(工厂 4 用例 + Task 3 用例不回归)。

- [ ] **Step 5: GodotServer 接线**

`GodotServer.ts` 顶部 import 区(已有 `setOnGroupsChanged` 的 import 行,:38)扩展:
```ts
import { setOnGroupsChanged, setConnectionStatusProvider, setReconnectEditor, buildConnectionStatus, buildReconnectEditor } from './tools/manage-tools.js';
```

在 `setOnGroupsChanged(() => this.sendToolListChanged());`(`:143`)之后追加(闭包延迟读 `this.editorConn`/`this.dispatcher`,故可在构造期 set):
```ts
setConnectionStatusProvider(() => buildConnectionStatus(this.editorConn, this.dispatcher?.getHealthMonitor() ?? null));
setReconnectEditor(buildReconnectEditor(() => this.editorConn));
```

在 `stop()` 内 `setOnGroupsChanged(null);`(`:385`)之后追加:
```ts
setConnectionStatusProvider(null);
setReconnectEditor(null);
```

- [ ] **Step 6: 类型 + 回归验证**

Run: `npx tsc --noEmit` → Expected: 0 错。
Run: `npx vitest run` → Expected: 全套 PASS(基线 2718+ 不回归)。

- [ ] **Step 7: 提交**

```bash
git add src/tools/manage-tools.ts src/GodotServer.ts test/tools/manage-tools.test.ts
git commit -m "feat(manage-tools): buildConnectionStatus/buildReconnectEditor 工厂 + GodotServer 接线

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 文档 + memory 更新

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\docs\review-followup-2026-06-23-mcp-tools.md`(追加进展段)
- Modify: `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-core.md` 与 `godot-mcp-bridge.md`(run_project 新参数 + reconnect/sync 行为)
- Modify: `C:\Users\wgt\.claude\projects\D--GitHub-godot-mcp-enhanced\memory\mcp-godot-scene-script-pitfalls.md`(或新增 backlog 收尾 memory)

- [ ] **Step 1: 追加 backlog 进展段**

在 `docs/review-followup-2026-06-23-mcp-tools.md` 末尾"✅ 修复进展"段后追加:

```markdown
## ✅ 次要项收尾(2026-06-24,分支 `fix/mcp-tools-s1-s3-s4`)

| # | commit | 改动 | 验证 |
|---|--------|------|------|
| **M4** | `<Task1+2 hash>` | `run_project` 加 `wait_for_bridge`/`bridge_timeout`;`game-bridge.isBridgeReady` 独立短连接零接触探测 + 进程早退短路 | game-bridge-isready 5✓ + runtime wait_for_bridge 3✓ |
| **manage_tools** | `<Task3+4 hash>` | 注入 `setConnectionStatusProvider`/`setReconnectEditor` + `buildConnectionStatus`/`buildReconnectEditor` 工厂;reconnect 接 EditorConnection.connect,bridge 明确 no-op;sync 按 requires 数组映射状态 | manage-tools 8✓(原 4 + 新 4) |
| 默认引擎 | — | 剔除(= M3 文档化已覆盖,`godot-finder` 已 GODOT_PATH 优先) | — |

**S4/S5/S6 运行时验证**:待专门验证会话(需重启 MCP 注入 env)。
```

- [ ] **Step 2: 更新 rule 文档**

`godot-mcp-core.md` 的 run_project 说明加:`wait_for_bridge`(默认 false,true 时探测 bridge 就绪)+ `bridge_timeout`(默认 10s)。
`godot-mcp-bridge.md` 的 manage_tools 段:把 reconnect/sync 从"未实现"改为"reconnect 触发 editor 重连(bridge 无持久连接,no-op);sync 返回各组 requires 连接状态"。

- [ ] **Step 3: 更新 memory**

在 `mcp-godot-scene-script-pitfalls.md` 或新建 `mcp-backlog-m4-managetools-done.md` 记录:M4 isBridgeReady 零接触设计 + 进程早退短路;manage_tools 注入 provider 模式 + build* 工厂。同步更新 `MEMORY.md` 索引。

- [ ] **Step 4: 提交**

```bash
git add docs/review-followup-2026-06-23-mcp-tools.md .claude/rules/godot-mcp-core.md .claude/rules/godot-mcp-bridge.md
git commit -m "docs: M4/manage_tools 收尾进展 + rule/memory 更新

Co-Authored-By: Claude <noreply@anthropic.com>"
```
(memory 文件在用户 home,不进本仓库 commit,单独 Write。)

---

## Task 6: S4/S5/S6/M4 运行时验证(独立验证会话)

**⚠ 前提**:此任务需**重启 MCP 服务端**(env 进程级固化),会中断当前会话。必须在 Task 1-5 全部完成、commit、push 到分支后,在**新的验证会话**执行。

**Files:** 无代码改动(纯验证 checklist)。

- [ ] **Step 1: 准备验证项目**

在 `D:\GitHub\rpg-mcp-pilot` 重新安装 bridge 拿新版 mcp_bridge.gd(含 S4 env / S5 extra-methods / S6 physical_keycode):
```
game_bridge_install(project_path="D:/GitHub/rpg-mcp-pilot")
```

- [ ] **Step 2: 配置并重启 MCP 服务端**

宿主 settings.json 的 MCP env 段加:
```
GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true   # S4
GODOT_MCP_BRIDGE_EXTRA_METHODS=emit_signal # S5 验证用
```
**重启 MCP 服务端 / 宿主 Claude Code**(env 进程级固化,见 M3 文档)。

- [ ] **Step 3: M4 验证**

```
run_project(project_path="D:/GitHub/rpg-mcp-pilot", wait_for_bridge=true)
game_query(method="ping")
```
通过判据:run_project 文本含 "Bridge ready";紧接 ping 立即返回 ok(无需手动等)。

- [ ] **Step 4: S4 验证(secret 固定)**

跨 5 分钟 TTL 后再 `game_query(method="ping")`;读 `.godot/mcp_bridge_9081.secret` 权限(icacls)。
通过判据:secret 不被收紧/删除,反复 ping 不失效(PERSISTENT_SECRET 生效)。

- [ ] **Step 5: S5 验证(call_method 白名单扩展)**

```
game(action="watch_start", node_path="root/GameEvents", signal_name="enemy_encountered")
game_write(method="call_method", params={path:"/root/GameEvents", method:"emit_signal", args:["enemy_encountered"]})
game(action="watch_poll")
```
通过判据:watch_poll 记录到 enemy_encountered 事件(EXTRA_METHODS=emit_signal 生效)。

- [ ] **Step 6: S6 验证(send_key physical_keycode)**

```
game_input(method="send_key", params={key:"D"})
game_wait(method="wait_for_property", params={path:"/root/Player", property:"position", value:<预期>})
```
通过判据:Player 位置变化(physical_keycode 触发 input action)。若该项目 input map 用 keycode 映射则换键验证。

- [ ] **Step 7: 记录验证结果**

把 S4/S5/S6/M4 验证结论追加到 `docs/review-followup-2026-06-23-mcp-tools.md` 的次要项收尾段,标注 ✅/⚠。若 S6 受 rpg-mcp-pilot input map 映射方式影响,记录调整。

---

## Self-Review

**1. Spec coverage:**
- §2 M4 run_project wait_for_bridge → Task 1(isBridgeReady)+ Task 2(run_project 接线)✓
- §2.2 零接触缓存(自读 secret 不碰 _projectDir/_cachedSecret)→ Task 1 `_testBridgeCacheState` 断言 ✓
- §2.2 进程早退短路(opts.proc.killed / isCancelled)→ Task 1 用例 + Task 2 传 isCancelled ✓
- §2.3 handshake 重复接受、_doConnect 零改动 → Task 1 probeOnce 独立实现,不动 _doConnect ✓
- §3.1 注入机制(setConnectionStatusProvider/setReconnectEditor)→ Task 3 ✓
- §3.2 reconnect action(editor connect / bridge no-op)→ Task 3 handleReconnect + Task 4 buildReconnectEditor ✓
- §3.3 sync(requires 数组映射)→ Task 3 handleSync(含 'editor'/'bridge'/空数组)✓
- §4 S4/S5/S6 运行时验证 → Task 6 ✓
- §5 测试策略(M4 四态 + 零接触三者 + manage_tools 注入)→ Task 1/3/4 测试 ✓
- §6 文档 → Task 5 ✓

**2. Placeholder scan:** Task 5 的 `<Task1+2 hash>` / `<Task3+4 hash>` 是 commit 哈希占位,执行时回填实际值——其余无 TBD/TODO。无"add error handling"式空泛步骤。

**3. Type consistency:**
- `isBridgeReady` 签名(Task 1 产出)与 Task 2 调用一致:`(projectDir, timeoutMs, opts:{proc,isCancelled})`。
- `ConnectionStatus` / `setConnectionStatusProvider` / `setReconnectEditor`(Task 3)与 Task 4 工厂产出 `ConnectionStatus` 一致。
- `buildReconnectEditor` 返回 `() => Promise<{connected, detail}>`(Task 4)与 `setReconnectEditor` 入参(Task 3)一致。
- `handleReconnect` 改 async,`handleTool` 的 `case 'reconnect': return await handleReconnect()`(已在 async 函数)一致。
- `EditorConnLike`/`HealthMonitorLike` 字段(isConnected/connect、getState)与真实 `EditorConnection`/`HealthMonitor` 一致(已核 EditorConnection.ts:139/511、health-monitor.ts:174)。

无遗漏。Plan 可执行。
