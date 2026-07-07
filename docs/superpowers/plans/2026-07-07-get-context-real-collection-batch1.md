# godot_get_context 真实采集 批 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 godot_get_context 的 mode/project/connections/rules/performance 5 字段从 MVP 占位补成真实采集（readScene 留批 2）。

**Architecture:** 模块级 setter `setGetContextConnectionProvider`（复用 manage-tools buildConnectionStatus）注入 editor 连接态；bridge 探测/查询直接 import sendToBridge（ping 判定 + get_performance 取值，用 ensureProjectDir 模式设 projectDir）；project/rules 走 fs。handleGetContext 改 async + safeAsync（M5 修复）。

**Tech Stack:** TypeScript / Vitest / @modelcontextprotocol/sdk / Godot bridge TCP

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-get-context-real-collection-design.md`（r2）
**Base:** master `9142939`（MVP 已 merge）

## Global Constraints

- 测试只在 `test/`（`vitest.config.ts:8` include `test/**/*.test.{js,ts}`）
- import 用 .js 后缀（ESM）
- commit conventional + 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`
- bridge 模块全局 `_projectDir`：get-context 调 sendToBridge 前须 `setBridgeProjectDir`（参照 game-bridge:497-504 ensureProjectDir）
- readScene **保持占位 null**（批 2 做 editor 插件协议 + bridge 树深度）
- readProject.godot 字段 = null（避免每次 spawn `godot --version`，godot-finder:86 detectGodotVersion 无缓存）
- 字段级降级保持（safeAsync + 永不抛，status=ok/partial）

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts` | 加 setter + 5 helper 真实 + async 化 | Modify |
| `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:147,436` | 接线 setGetContextConnectionProvider + 清理 | Modify |
| `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts` | mock provider/sendToBridge，测真实采集 + 降级 | Modify |

**依赖顺序**：Task 1（setter+computeMode+readConnections+async 基础）→ Task 2（readProject+readRules fs）→ Task 3（readPerformance bridge）→ Task 4（GodotServer 接线）→ Task 5（测试扩展+回归）。

---

### Task 1: setter + computeMode/readConnections 真实 + async 化（M5）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`（加 setter/模块变量 :16 附近；改 computeMode :98-105；改 readConnections :121-126；加 safeAsync :93 后；handleGetContext :48 改 async；handleTool :38 return await）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts`

**Interfaces:**
- Consumes: `import { sendToBridge, setBridgeProjectDir } from './game-bridge.js'`（新 import）；`ConnectionStatus` 类型（从 manage-tools 或 types）
- Produces: `setGetContextConnectionProvider(provider)` export（供 Task 4 GodotServer 接线）；computeMode/readConnections 改 async

- [ ] **Step 1: 写失败测试**

在 `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts` 顶部 import 加 `vi`，加 mock + 新 describe：
```ts
vi.mock('../../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn(),
  setBridgeProjectDir: vi.fn(),
  isBridgeReady: vi.fn(),
}));

import { setGetContextConnectionProvider } from '../../src/tools/get-context.js';
import { sendToBridge, setBridgeProjectDir } from '../../src/tools/game-bridge.js';
import type { ConnectionStatus } from '../../src/tools/manage-tools.js';

const fakeCs = (editor: Partial<ConnectionStatus['editor']> = {}): ConnectionStatus => ({
  editor: { installed: false, connected: false, state: null, ...editor } as ConnectionStatus['editor'],
  bridge: { note: '每请求建连' },
});

describe('computeMode + readConnections real (Task 1)', () => {
  beforeEach(() => { getCallRecorder().reset(); vi.clearAllMocks(); setGetContextConnectionProvider(null); });

  it('mode=editor when connectionStatus editor connected', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: true }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx());
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.mode).toBe('editor');
  });

  it('mode=bridge when editor not connected but ping succeeds', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.mode).toBe('bridge');
    expect(setBridgeProjectDir).toHaveBeenCalledWith('/p');
  });

  it('mode=headless when editor off + ping fails', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no bridge'));
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.mode).toBe('headless');
  });

  it('connections.bridge.status=connected when ping ok', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.connections.bridge.status).toBe('connected');
  });

  it('no project_path + no ctx.projectDir → bridge ping skipped, mode degrades', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    const r = await handleTool('godot_get_context', {}, mockCtx());
    expect(sendToBridge).not.toHaveBeenCalled();
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.mode).toBe('headless');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: FAIL — `setGetContextConnectionProvider` 未 export / computeMode 仍同步占位

- [ ] **Step 3: 实现 setter + computeMode/readConnections 真实 + async 化**

Modify `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`：

(a) 顶部 import 区加（参照现有 import 风格）：
```ts
import { sendToBridge, setBridgeProjectDir } from './game-bridge.js';
import type { ConnectionStatus } from './manage-tools.js';
```

(b) 模块级变量 + setter（加在现有 import 后、getToolDefinitions 前，约 :14）：
```ts
// ─── 注入的 provider（GodotServer 接线，参照 manage-tools _connectionStatusProvider）───
let _connectionStatusProvider: (() => ConnectionStatus | null) | null = null;

/** 注入 connectionStatus provider（editor 连接态 + bridge note）。setGetContextConnectionProvider
 *  独立命名避免与 manage-tools 的 setConnectionStatusProvider 撞名（r2 IMP-2）。 */
export function setGetContextConnectionProvider(provider: (() => ConnectionStatus | null) | null): void {
  _connectionStatusProvider = provider;
}
```

(c) 加 safeAsync（在 :93 safe 函数后）：
```ts
/** 异步字段降级 wrapper：rejected → 字段名入 failed，返回 null。 */
async function safeAsync<T>(fn: () => Promise<T>, field: string, failed: string[]): Promise<T | null> {
  try { return await fn(); } catch { failed.push(field); return null; }
}
```

(d) 加 bridge 探测 helper + 改 computeMode/readConnections 为 async（替换现有 computeMode/readConnections 占位）：
```ts
/** 探测 bridge 是否就绪（ping，短 timeout，不阻塞）。需 projectDir（无则跳过返 false）。 */
async function isBridgeReachable(projectPath: string | undefined, ctx: ToolContext): Promise<boolean> {
  const dir = ctx.projectDir || projectPath;
  if (!dir) return false;
  try {
    setBridgeProjectDir(dir);
    const r = await sendToBridge('ping', {}, 2000);
    return !!r && !r.error;
  } catch {
    return false;
  }
}

/** 摘要：editor 连了→editor，bridge ping 通→bridge，否则 headless。 */
async function computeMode(projectPath: string | undefined, ctx: ToolContext): Promise<'headless' | 'editor' | 'bridge'> {
  const cs = _connectionStatusProvider?.() ?? null;
  if (cs?.editor.connected) return 'editor';
  if (await isBridgeReachable(projectPath, ctx)) return 'bridge';
  return 'headless';
}

/** editor 字段从 connectionStatus；bridge.status 用 ping 探测。 */
async function readConnections(projectPath: string | undefined, ctx: ToolContext): Promise<{
  editor: { installed: boolean; connected: boolean; state: string | null };
  bridge: { status: string; note?: string };
}> {
  const cs = _connectionStatusProvider?.() ?? null;
  const bridgeReachable = await isBridgeReachable(projectPath, ctx);
  return {
    editor: cs?.editor ?? { installed: false, connected: false, state: null },
    bridge: {
      status: bridgeReachable ? 'connected' : (projectPath || ctx.projectDir ? 'unreachable' : 'probe-required'),
      note: cs?.bridge.note,
    },
  };
}
```

(e) 改 handleGetContext 为 async + 各 async 字段 await（替换 :48-88 整个函数体，scene 守卫保持批 2 null）：
```ts
async function handleGetContext(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const failedFields: string[] = [];
  const includeScene = args.include_scene !== false;
  const includePerf = args.include_performance !== false;
  const projectPath = args.project_path as string | undefined;

  const mode = await safeAsync(() => computeMode(projectPath, ctx), 'mode', failedFields);
  const project = safe(() => readProject(projectPath), 'project', failedFields);
  const connections = await safeAsync(() => readConnections(projectPath, ctx), 'connections', failedFields);
  const scene = null; // 批 2：editor 插件协议 + bridge 树深度
  void includeScene; // 批 2 接 readScene 时用
  const callStats = safe(() => getCallRecorder().getStats(), 'callStats', failedFields);
  const recentCalls = safe(() => getCallRecorder().getRecent(50), 'recentCalls', failedFields);
  const toolGroups = safe(() => readToolGroups(), 'toolGroups', failedFields);
  const workflows = safe(
    () => listPromptDefs().map(p => ({ name: p.name, type: 'prompt' as const, desc: p.description })),
    'workflows',
    failedFields,
  );
  const rules = safe(() => readRules(projectPath), 'rules', failedFields);
  const performance = (includePerf && mode === 'bridge')
    ? await safeAsync(() => readPerformance(ctx), 'performance', failedFields)
    : null;

  return textResult(JSON.stringify(opsSuccess({
    status: failedFields.length === 0 ? 'ok' : 'partial',
    failedFields,
    mode,
    project,
    connections,
    scene,
    recentCalls,
    callStats,
    toolGroups,
    workflows,
    rules,
    performance,
    hint: 'scene.nodeCount=节点总数；recentCalls=最近操作；callStats.topTools=最常用工具；workflows=推荐入口(prompt)；performance 仅 bridge；status=partial 时看 failedFields',
  })));
}
```

(f) 改 handleTool 的 return await（M5，替换 :38 的 `return handleGetContext(...)`）：
```ts
  if (toolName !== 'godot_get_context') return null;
  try {
    return await handleGetContext(args, ctx);
  } catch {
    // 永不抛：外层兜底（M5：async 后 return await 才能让外层 try/catch 抓到 rejection）
    return textResult(JSON.stringify(opsSuccess({ status: 'partial', failedFields: ['__handler__'], mode: 'headless' })));
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: PASS（新 5 用例 + 原 6 用例回归）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npm run lint` → exit 0
```bash
git add src/tools/get-context.ts test/tools/get-context.test.ts
git commit -m "feat(get-context): computeMode/readConnections 真实采集 + async 化（M5）

setGetContextConnectionProvider 注入 + sendToBridge ping 探测 bridge。
handleGetContext async + safeAsync + handleTool return await（修 final review M5）。"
```

---

### Task 2: readProject + readRules 真实（fs）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`（readProject :112-114 + readRules :149-154）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts`

**Interfaces:**
- Consumes: `fs`（readFileSync/existsSync/readdirSync）+ `path` + `ctx.parseGodotConfig` + `path-utils` 安全 join
- Produces: readProject 返 `{ name, godot: null, path }`；readRules 返 `string[]`

- [ ] **Step 1: 写失败测试**

加 describe（用真实 fs + tmp dir，或 mock fs；这里用 vi.mock 'fs'）：
```ts
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: string) => (actual as any).existsSync(p)),
    readFileSync: vi.fn((p: string, ...rest: any[]) => (actual as any).readFileSync(p, ...rest)),
    readdirSync: vi.fn((p: string) => (actual as any).readdirSync(p)),
  };
});
import * as fs from 'fs';

describe('readProject + readRules real (Task 2)', () => {
  beforeEach(() => { getCallRecorder().reset(); vi.clearAllMocks(); setGetContextConnectionProvider(null); });

  it('readProject returns name from project.godot + path, godot=null (no spawn)', async () => {
    const dir = 'D:/GitHub/godot-mcp-enhanced/test/fixtures/real-project'; // 已有 fixture
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('[application]\n\nconfig/name="TestGame"\n');
    setGetContextConnectionProvider(null);
    (sendToBridge as any).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', { project_path: dir }, mockCtx());
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.project).toEqual({ name: 'TestGame', godot: null, path: dir });
  });

  it('readProject null when project.godot missing/unreadable', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    (sendToBridge as any).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', { project_path: '/nope' }, mockCtx());
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.project).toBeNull();
  });

  it('readRules returns .claude/rules/*.md basenames', async () => {
    const dir = '/some/project';
    vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => String(p).includes('.claude/rules'));
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['godot-mcp-core.md', 'godot-mcp-bridge.md'] as any);
    (sendToBridge as any).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', { project_path: dir }, mockCtx());
    const rules = JSON.parse((r!.content[0] as { text: string }).text).data.rules;
    expect(rules).toEqual(['godot-mcp-core.md', 'godot-mcp-bridge.md']);
  });

  it('readRules [] when no project_path', async () => {
    (sendToBridge as any).mockRejectedValue(new Error('x'));
    const r = await handleTool('godot_get_context', {}, mockCtx());
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.rules).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/get-context.test.ts -t "readProject"`
Expected: FAIL — readProject 仍返 null

- [ ] **Step 3: 实现 readProject + readRules**

Modify `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`，替换 readProject/readRules 占位：
```ts
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

/** project = { name, godot: null, path }。name 从 project.godot config/name；godot=null 避免 spawn。 */
function readProject(projectPath: string | undefined): { name: string; godot: null; path: string } | null {
  if (!projectPath) return null;
  const cfg = join(projectPath, 'project.godot');
  if (!existsSync(cfg)) return null;
  try {
    const content = readFileSync(cfg, 'utf-8');
    const name = parseProjectName(content) ?? basename(projectPath);
    return { name, godot: null, path: projectPath };
  } catch {
    return null;
  }
}

/** 从 project.godot 文本提 [application] config/name="X" 的 X。 */
function parseProjectName(content: string): string | null {
  const m = content.match(/config\/name\s*=\s*"([^"]*)"/);
  return m ? m[1] : null;
}

/** rules = {projectPath}/.claude/rules/*.md 文件名列表。无 projectPath 或目录不存在→[]。 */
function readRules(projectPath: string | undefined): string[] {
  if (!projectPath) return [];
  const rulesDir = join(projectPath, '.claude', 'rules');
  if (!existsSync(rulesDir)) return [];
  try {
    return readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
}
```
> 注：readProject 用自有 parseProjectName（正则提 config/name），不依赖 ctx.parseGodotConfig（避免 ctx 耦合 + readProject 可独立测）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: PASS（Task 1 + Task 2 用例全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npm run lint` → exit 0
```bash
git add src/tools/get-context.ts test/tools/get-context.test.ts
git commit -m "feat(get-context): readProject/readRules 真实 fs 采集

readProject 从 project.godot config/name 提名 + godot=null 避免 spawn；
readRules 扫 .claude/rules/*.md basename。"
```

---

### Task 3: readPerformance bridge 真实

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`（readPerformance :160-162）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts`

**Interfaces:**
- Consumes: `sendToBridge('get_performance')`（返 BridgeResponse.result，字段结构用可选链 + 降级）
- Produces: readPerformance 返 `{ fps, memory_mb } | null`

- [ ] **Step 1: 写失败测试**

```ts
describe('readPerformance bridge real (Task 3)', () => {
  beforeEach(() => { getCallRecorder().reset(); vi.clearAllMocks(); setGetContextConnectionProvider(null); });

  it('performance filled when bridge mode + get_performance returns fps/mem', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as any)
      .mockResolvedValueOnce({ id: 1, result: { status: 'ok' } })           // ping
      .mockResolvedValueOnce({ id: 2, result: { fps: 60, static_mem: 268435456 } }); // get_performance
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const perf = JSON.parse((r!.content[0] as { text: string }).text).data.performance;
    expect(perf).toEqual({ fps: 60, memory_mb: 256 });
  });

  it('performance null when get_performance returns sparse (降级)', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as any)
      .mockResolvedValueOnce({ id: 1, result: { status: 'ok' } })
      .mockResolvedValueOnce({ id: 2, result: {} });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.performance).toBeNull();
  });

  it('performance null when not bridge mode', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: true })); // editor mode
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx());
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.performance).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/get-context.test.ts -t "readPerformance"`
Expected: FAIL — readPerformance 仍返 null

- [ ] **Step 3: 实现 readPerformance**

Modify `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`，替换 readPerformance 占位：
```ts
/** performance = { fps, memory_mb }。仅 bridge（外层已守卫）。get_performance result 字段可选链降级。 */
async function readPerformance(ctx: ToolContext): Promise<{ fps: number; memory_mb: number } | null> {
  const r = await sendToBridge('get_performance', {}, 2000);
  if (!r || r.error) return null;
  const result = (r.result ?? {}) as { fps?: number; static_mem?: number; memory?: number };
  const fps = typeof result.fps === 'number' ? result.fps : null;
  const memBytes = typeof result.static_mem === 'number' ? result.static_mem : (typeof result.memory === 'number' ? result.memory : null);
  if (fps === null || memBytes === null) return null;
  return { fps, memory_mb: Math.round(memBytes / (1024 * 1024)) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: PASS（Task 1-3 用例全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npm run lint` → exit 0
```bash
git add src/tools/get-context.ts test/tools/get-context.test.ts
git commit -m "feat(get-context): readPerformance bridge 真实采集

sendToBridge('get_performance') 取 fps + static_mem（字节→MB），可选链降级。"
```

---

### Task 4: GodotServer 接线 setGetContextConnectionProvider + 清理

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:147`（接线）+ `:436`（清理）+ import
- Test: 现有 GodotServer 接线测试覆盖（参照 manage-tools provider 接线测试）

**Interfaces:**
- Consumes: Task 1 的 `setGetContextConnectionProvider`（get-context.ts export）
- Produces: 生产路径 provider 真注入

- [ ] **Step 1: 接线 GodotServer.ts**

Modify `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts`：
- import 区（:38 `import { ... } from './tools/manage-tools.js'` 附近）加：
```ts
import { setGetContextConnectionProvider } from './tools/get-context.js';
```
- :147 旁（`setConnectionStatusProvider(...)` 后）加：
```ts
    setGetContextConnectionProvider(() => buildConnectionStatus(this.editorConn, this.dispatcher?.getHealthMonitor() ?? null));
```
- :436 旁（`setConnectionStatusProvider(null)` 后）加：
```ts
    setGetContextConnectionProvider(null);
```

- [ ] **Step 2: 跑测试确认接线 + 回归**

Run: `npx vitest run test/core/ToolDispatcher.test.ts test/tools/get-context.test.ts`
Expected: PASS（接线不破坏现有 + get-context 用例绿；生产 provider 注入后 mock 测试仍隔离）

- [ ] **Step 3: 全量 + tsc + lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 全绿，exit 0

- [ ] **Step 4: Commit**

```bash
git add src/GodotServer.ts
git commit -m "feat(get-context): GodotServer 接线 setGetContextConnectionProvider

:147 注入 buildConnectionStatus provider（同 manage-tools 模式）+ :436 清理。"
```

---

### Task 5: 全量回归 + MVP 6 用例验证 + 集成确认

**Files:** 无新文件（验证 task）

- [ ] **Step 1: MVP 6 用例回归确认**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: PASS（MVP 原 6 用例 def/unknown/headless ok/include_scene=false/failed partial/永不抛 + 批 1 新 12 用例全绿）

- [ ] **Step 2: 全量门禁**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 全绿，exit 0（批 1 不破坏现有 3558+ 用例）

- [ ] **Step 3: capability 不回归确认**

Run: `npx vitest run test/capability`
Expected: PASS（get_context 仍归 core，securityLevel 不变）

- [ ] **Step 4: 集成快照（人工核验生产路径 provider 注入）**

手动跑一次 `godot_get_context`（如环境允许）：确认 mode 真实反映连接态（非恒 headless）+ project.name 从 project.godot + rules 列 .claude/rules。
> 若环境不允许（无 editor/bridge 运行），确认 mode=headless + project/rules 从 fs 填充（非全 null）即合格。

- [ ] **Step 5: Commit（如有测试微调）+ 收尾**

```bash
# 如本 task 无代码改动，跳过 commit；否则：
git add -A
git commit -m "test(get-context): 批 1 全量回归 + MVP 6 用例确认"
```

---

## Self-Review

**1. Spec 覆盖（批 1 范围）**：
- computeMode 真实（connectionStatus editor + sendToBridge ping bridge）→ Task 1 ✅
- readConnections 真实（editor from cs + bridge.status ping）→ Task 1 ✅
- readProject 真实（fs project.godot，godot=null 避免 spawn）→ Task 2 ✅
- readRules 真实（fs .claude/rules）→ Task 2 ✅
- readPerformance 真实（sendToBridge get_performance）→ Task 3 ✅
- M5 await（async + safeAsync + return await）→ Task 1 ✅
- 接线 setGetContextConnectionProvider → Task 4 ✅
- 字段级降级保持 → safeAsync/safe 全 task ✅
- **readScene 留批 2**（保持 null 占位 + 注释）→ Task 1 scene=null ✅（spec §9.1/9.2 批 2）
- **M4 不做**（用户批准）→ 不在批 1 ✅

**2. 占位扫描**：readScene=null 是有意保留（批 2，标注清楚）非占位 bug。readPerformance result 字段用可选链降级（不依赖未确认结构，防 plan 失败）。

**3. 类型一致性**：`setGetContextConnectionProvider`（Task 1 export）↔ Task 4 import 一致；`ConnectionStatus` 类型从 manage-tools import 一致；computeMode/readConnections/readPerformance async 签名 ↔ handleGetContext await 一致；safeAsync<T> ↔ safe<T> 并行。

**4. 任务边界**：5 task 各独立可测（mode/connections → project/rules → performance → 接线 → 回归），每 task 绿测试 + commit。

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-07-get-context-real-collection-batch1.md`.

**批 2（后续）**：readScene（editor EditorToolExecutor/插件协议 + bridge get_tree 树深度/typeTopN），单独 spec/plan。

**Defects recall**：批 1 不新增 defect（connectionMode 注入解决 follow-up 前置；CallRecorder 单例已在 MVP 标注）。
