# MCP Progress 通知（dev_loop MVP）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 dev_loop 在客户端传入 `_meta.progressToken` 时，按阶段推送 MCP `notifications/progress`，客户端实时显示多阶段进度。

**Architecture:** 新建 `src/core/progress.ts`（与 logger 同构的两件套：`_progressSender` + `_progressClientReady`，但 emitter 闭包捕获 per-request token）。token 经四层参数链（handleCall→executeToolCall→dispatchTool→buildPerCallCtx）透传，全程局部变量不进实例字段（C-CONC-1 并发安全）。dev_loop 按动态 total 矩阵（DSL/正常/early-return）推送。

**Tech Stack:** TypeScript + `@modelcontextprotocol/sdk`（低层 `Server.notification()`）+ vitest

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-09-mcp-progress-notification-design.md`

## Global Constraints

- 行号基于 master `26a1f95`（v0.22.0），实现时以实际为准——重构后可能漂移，每个 task 实现前重新核对。
- 简体中文注释（匹配项目惯例）。
- 发版门禁不适用（本 plan 是功能开发，非发版）；但每个 task 须 `tsc` 0 错 + 相关测试绿。
- 测试用 vitest，命令 `npm test`（即 `vitest run`）。
- TDD：每个 task 先写失败测试 → 跑红 → 实现 → 跑绿 → commit。
- C-CONC-1 命门：token/emitter **绝不进实例字段**，全程参数链透传（照抄 findGodotOverride 模式）。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/core/progress.ts` | MCP Progress 两件套 + createProgressEmitter + ProgressEmitter 类型 | Create |
| `test/core/progress.test.ts` | progress.ts 单元测试 | Create |
| `src/types.ts` | ToolContext 加 `progress?` 字段 | Modify（`:8` ToolContext） |
| `src/GodotServer.ts` | 构造/oninitialized/close 接线 setProgressSender/Ready | Modify（`:49` import / `:108` 构造 / `:221` oninitialized / `:511` close） |
| `test/core/progress-wiring.test.ts` | GodotServer 接线静态断言 | Create |
| `src/core/ToolDispatcher.ts` | 四层参数链透传 emitter | Modify（`:200` handleCall / `:213` executeToolCall / `:323` `:357` `:373` dispatchTool 调用 / `:571` dispatchTool / `:706` buildPerCallCtx） |
| `test/core/ToolDispatcher.test.ts` | 透传链集成测试（有/无 token、并发、editor fallback） | Modify（加 describe） |
| `src/tools/workflow.ts` | dev_loop total 矩阵 + 推送点 | Modify（`:262` dev_loop 入口 / DSL `:282` / execute `:307` / verify `:341` / bridge `:350` / acceptance `:416`） |
| `test/tools/workflow.test.ts` | dev_loop 推送序列测试 | Modify（加 describe） |

---

## Task 1: progress.ts 模块（两件套 + createProgressEmitter）

**Files:**
- Create: `src/core/progress.ts`
- Test: `test/core/progress.test.ts`

**Interfaces:**
- Produces: `ProgressToken`（`string | number`）、`ProgressEmitter`（`(progress, total, message?) => void`）、`setProgressSender(server | null)`、`setProgressClientReady(ready)`、`createProgressEmitter(token): ProgressEmitter`、`resetProgressSender()`（测试隔离）

- [ ] **Step 1: 写失败测试 `test/core/progress.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProgressEmitter,
  setProgressSender,
  setProgressClientReady,
  resetProgressSender,
} from '../../src/core/progress.js';

function createMockServer(notificationImpl?: ReturnType<typeof vi.fn>) {
  return { notification: notificationImpl ?? vi.fn().mockReturnValue(undefined) };
}

beforeEach(() => {
  resetProgressSender();
});

describe('progress.createProgressEmitter', () => {
  it('ready + sender 时调 notification 且 params 带 token/progress/total/message', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(true);
    const emit = createProgressEmitter('tok-1');
    emit(2, 5, 'verifying');
    expect(server.notification).toHaveBeenCalledTimes(1);
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 2, total: 5, message: 'verifying' },
    });
  });

  it('未 ready（clientReady=false）→ no-op，不调 notification', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(false);
    createProgressEmitter('tok-2')(1, 3);
    expect(server.notification).not.toHaveBeenCalled();
  });

  it('无 sender（null）→ 不抛、不调', () => {
    setProgressSender(null);
    setProgressClientReady(true);
    expect(() => createProgressEmitter('tok-3')(1, 3)).not.toThrow();
  });

  it('notification 返回 rejected promise → 不抛（fire-and-forget）', async () => {
    const server = createMockServer(vi.fn().mockReturnValue(Promise.reject(new Error('transport closed'))));
    setProgressSender(server as any);
    setProgressClientReady(true);
    expect(() => createProgressEmitter('tok-4')(1, 3)).not.toThrow();
    await new Promise(r => setImmediate(r)); // 等 microtask 让 .catch 处理 reject
  });

  it('notification 同步 throw → 不抛', () => {
    const server = createMockServer(vi.fn().mockImplementation(() => { throw new Error('sync boom'); }));
    setProgressSender(server as any);
    setProgressClientReady(true);
    expect(() => createProgressEmitter('tok-5')(1, 3)).not.toThrow();
  });

  it('string 与 number 两种 token 透传', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(true);
    createProgressEmitter('string-tok')(1, 2);
    createProgressEmitter(42)(1, 2);
    expect(server.notification).toHaveBeenNthCalledWith(1, {
      method: 'notifications/progress',
      params: { progressToken: 'string-tok', progress: 1, total: 2, message: undefined },
    });
    expect(server.notification).toHaveBeenNthCalledWith(2, {
      method: 'notifications/progress',
      params: { progressToken: 42, progress: 1, total: 2, message: undefined },
    });
  });

  it('message 省略时为 undefined', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(true);
    createProgressEmitter('tok')(1, 2);
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok', progress: 1, total: 2, message: undefined },
    });
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/progress.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/progress.js'`

- [ ] **Step 3: 实现 `src/core/progress.ts`**

```typescript
/**
 * MCP Progress 通知 — 与 logger 同构的两件套（sender + clientReady）。
 *
 * 区别于 logger（sendLoggingMessage 无 token 广播，可模块级注入）：
 * progress 必须带 progressToken 路由到特定请求（per-request），
 * 故 token 经 createProgressEmitter 闭包捕获，随 request 透传（见 spec §4.3 四层参数链）。
 *
 * 失败安全：progress 是观测层，绝不影响主流程（guard + fire-and-forget）。
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export type ProgressToken = string | number;
export type ProgressEmitter = (progress: number, total: number, message?: string) => void;

let _progressSender: Server | null = null;
let _progressClientReady = false;

/** 注入 MCP Server 实例（GodotServer 构造时调）；null 清除（close/测试隔离） */
export function setProgressSender(server: Server | null): void {
  _progressSender = server;
}

/** 标记 client 是否已完成 initialize（oninitialized 时设 true）；未就绪不发，避免 SDK 握手前报错 */
export function setProgressClientReady(ready: boolean): void {
  _progressClientReady = ready;
}

/**
 * 创建 per-request progress emitter。token 闭包捕获，并发安全（C-CONC-1）。
 * guard: _progressSender + _progressClientReady。失败静默。
 */
export function createProgressEmitter(token: ProgressToken): ProgressEmitter {
  return (progress: number, total: number, message?: string): void => {
    if (!_progressSender || !_progressClientReady) return;
    try {
      const p = _progressSender.notification({
        method: 'notifications/progress',
        params: { progressToken: token, progress, total, message },
      });
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => {});
      }
    } catch {
      // 同步 throw 静默——progress 是观测层，绝不影响主流程
    }
  };
}

/** 测试隔离 / 干净关闭：重置模块状态 */
export function resetProgressSender(): void {
  _progressSender = null;
  _progressClientReady = false;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/core/progress.test.ts`
Expected: PASS（7 个 it 全绿）

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`（Expected: 0 errors）
```bash
git add src/core/progress.ts test/core/progress.test.ts
git commit -m "feat(progress): MCP Progress 两件套模块 + createProgressEmitter（Task 1）

与 logger 同构的 _progressSender + _progressClientReady，emitter 闭包捕获
per-request token（C-CONC-1 并发安全）。guard + fire-and-forget，观测层不影响主流程。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: ToolContext.progress 字段 + GodotServer 接线

**Files:**
- Modify: `src/types.ts:8`（ToolContext 加字段）
- Modify: `src/GodotServer.ts`（import + 构造 `:108` + oninitialized `:221` + close `:511`）
- Test: `test/core/progress-wiring.test.ts`（Create）

**Interfaces:**
- Consumes: Task 1 的 `setProgressSender` / `setProgressClientReady`
- Produces: `ToolContext.progress?: ProgressEmitter`（Task 3/4 使用）；GodotServer 生命周期注入 progress 两件套

**测试策略说明：** 项目惯例不实例化 GodotServer（无 `new GodotServer` 测试先例，依赖重）。接线是 3 处确定性赋值，用**静态源码断言**验证接线存在；emitter→notification 行为由 Task 1 单元 + Task 3 透传集成测试覆盖。

- [ ] **Step 1: 写失败测试 `test/core/progress-wiring.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const godotServerSrc = readFileSync(join(here, '../../src/GodotServer.ts'), 'utf8');
const typesSrc = readFileSync(join(here, '../../src/types.ts'), 'utf8');

// 项目惯例不实例化 GodotServer（依赖重），接线是 3 处确定性赋值，用静态断言验证。
// emitter→notification 行为由 progress.test.ts 单元 + ToolDispatcher 透传集成测试覆盖。
describe('GodotServer progress 接线（静态断言）', () => {
  it('import 了 progress 模块', () => {
    expect(godotServerSrc).toMatch(/from ['"]\.\/core\/progress\.js['"]/);
  });
  it('构造时 setProgressSender(this.server)', () => {
    expect(godotServerSrc).toMatch(/setProgressSender\(this\.server\)/);
  });
  it('oninitialized 时 setProgressClientReady(true)', () => {
    expect(godotServerSrc).toMatch(/setProgressClientReady\(true\)/);
  });
  it('close 时 setProgressSender(null) + setProgressClientReady(false)', () => {
    expect(godotServerSrc).toMatch(/setProgressSender\(null\)/);
    expect(godotServerSrc).toMatch(/setProgressClientReady\(false\)/);
  });
});

describe('ToolContext.progress 字段（静态断言）', () => {
  it('ToolContext 含可选 progress 字段', () => {
    expect(typesSrc).toMatch(/progress\?\s*:\s*\(progress:\s*number,\s*total:\s*number/);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/progress-wiring.test.ts`
Expected: FAIL — 接线/字段尚未存在，正则不匹配

- [ ] **Step 3: 修改 `src/types.ts`（ToolContext 加字段）**

在 `checkEditorSceneSave?` 字段后（`:26` 之后、interface 闭合 `}` `:27` 之前）插入：

```typescript
  /** MCP Progress 通知 emitter（per-request，dispatcher 注入）。无 progressToken 时 undefined，调用方用 ctx.progress?.()。 */
  progress?: (progress: number, total: number, message?: string) => void;
```

- [ ] **Step 4: 修改 `src/GodotServer.ts`（import + 三处接线）**

4a. import（在 `:49` `import { getLogger, setLoggerServer, setLoggerClientReady } from './core/logger.js';` 后加一行）：

```typescript
import { setProgressSender, setProgressClientReady } from './core/progress.js';
```

4b. 构造接线（在 `:108` `setLoggerServer(this.server);` 后加一行）：

```typescript
    setProgressSender(this.server);
```

4c. oninitialized 接线（在 `:221` `setLoggerClientReady(true);` 后加一行，位于 `this.server.oninitialized = async () => {` 体内）：

```typescript
      setProgressClientReady(true);
```

4d. close 接线（在 `:510-511` `setLoggerServer(null);` / `setLoggerClientReady(false);` 后加两行）：

```typescript
    setProgressSender(null);
    setProgressClientReady(false);
```

- [ ] **Step 5: 跑测试验证通过**

Run: `npx vitest run test/core/progress-wiring.test.ts`
Expected: PASS（5 个 it 全绿）

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`（Expected: 0 errors）
```bash
git add src/types.ts src/GodotServer.ts test/core/progress-wiring.test.ts
git commit -m "feat(progress): ToolContext.progress 字段 + GodotServer 接线（Task 2）

构造 setProgressSender + oninitialized setProgressClientReady(true) +
close 清理。ToolContext 加可选 progress emitter 字段。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: ToolDispatcher 四层参数链（透传 emitter）

**Files:**
- Modify: `src/core/ToolDispatcher.ts`（`:200` handleCall 提取 / `:208` `:213` executeToolCall 签名+调用 / `:323` `:357` `:373` dispatchTool 调用 / `:571` dispatchTool 签名 / `:706` buildPerCallCtx 签名+注入）
- Test: `test/core/ToolDispatcher.test.ts`（加 describe）

**Interfaces:**
- Consumes: Task 1 的 `createProgressEmitter`、Task 2 的 `ToolContext.progress`
- Produces: `perCallCtx.progress` 在 request 含 `_meta.progressToken` 时为 emitter（Task 4 dev_loop 使用）

**关键约束（C-CONC-1）：** emitter 全程局部变量参数链，**绝不进实例字段**。照抄 findGodotOverride 透传模式。

- [ ] **Step 1: 写失败测试（加到 `test/core/ToolDispatcher.test.ts` 末尾）**

先在文件顶部 import 区加（`:3` 附近）：
```typescript
import { createProgressEmitter, setProgressSender, setProgressClientReady, resetProgressSender } from '../../src/core/progress.js';
import type { ProgressEmitter } from '../../src/core/progress.js';
```

在文件末尾加 describe：

```typescript
// ── Task 3: progress 透传链 ──────────────────────────────────────────────────
describe('ToolDispatcher progress 透传链', () => {
  let capturedCtx: any = null;
  const mockModule = {
    handleTool: vi.fn(async (_name: string, _args: Record<string, unknown>, ctx: any) => {
      capturedCtx = ctx;
      return mockToolResult;
    }),
  };

  beforeEach(() => {
    resetProgressSender();
    capturedCtx = null;
    mockGetModuleForTool.mockReturnValue(mockModule);
    mockGetToolDefinition.mockReturnValue(undefined);
  });

  it('request 含 _meta.progressToken → perCallCtx.progress 非 undefined 且可调用触发 notification', async () => {
    const server = { notification: vi.fn().mockReturnValue(undefined) };
    setProgressSender(server as any);
    setProgressClientReady(true);
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'workflow', arguments: { action: 'dev_loop' }, _meta: { progressToken: 'tok-A' } },
    } as any);
    expect(capturedCtx).not.toBeNull();
    expect(typeof capturedCtx.progress).toBe('function');
    capturedCtx.progress(1, 3, 'executing');
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok-A', progress: 1, total: 3, message: 'executing' },
    });
  });

  it('request 无 _meta → perCallCtx.progress 为 undefined', async () => {
    const dispatcher = new ToolDispatcher(createOptions());
    await dispatcher.handleCall({
      params: { name: 'workflow', arguments: { action: 'dev_loop' } },
    } as any);
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx.progress).toBeUndefined();
  });

  it('并发两 handleCall 不同 token → emitter 闭包独立不串（C-CONC-1）', async () => {
    const server = { notification: vi.fn().mockReturnValue(undefined) };
    setProgressSender(server as any);
    setProgressClientReady(true);
    const dispatcher = new ToolDispatcher(createOptions());
    const ctxA: any[] = [];
    const ctxB: any[] = [];
    mockModule.handleTool
      .mockResolvedValueOnce(mockToolResult)
      .mockImplementationOnce(async (_n: string, _a: Record<string, unknown>, ctx: any) => { ctxB.push(ctx); return mockToolResult; });
    mockModule.handleTool.mockImplementationOnce(async (_n: string, _a: Record<string, unknown>, ctx: any) => { ctxA.push(ctx); return mockToolResult; });
    // 并发派发（不 await 第一个）
    const pA = dispatcher.handleCall({ params: { name: 'workflow', arguments: {}, _meta: { progressToken: 'A' } } } as any);
    const pB = dispatcher.handleCall({ params: { name: 'workflow', arguments: {}, _meta: { progressToken: 'B' } } } as any);
    await Promise.all([pA, pB]);
    // 各自 emitter 带各自 token（验证不串）
    ctxA[0].progress(1, 2);
    ctxB[0].progress(1, 2);
    const tokens = server.notification.mock.calls.map((c: any[]) => c[0].params.progressToken);
    expect(tokens).toContain('A');
    expect(tokens).toContain('B');
  });

  it('editor 模式 + dev_loop + progressToken → fallback 路径 perCallCtx.progress 注入非 undefined', async () => {
    // editor 模式：currentExecutor.execute 返回 -32601 → 触发 _isUnknownMethod → fallback dispatchTool
    const editorExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: [{ type: 'text' as const, text: JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'Unknown method' } }) }],
      }),
    };
    const server = { notification: vi.fn().mockReturnValue(undefined) };
    setProgressSender(server as any);
    setProgressClientReady(true);
    const dispatcher = new ToolDispatcher(createOptions({ connectionMode: 'editor' } as any));
    dispatcher.setEditorExecutor(editorExecutor as any);
    await dispatcher.handleCall({
      params: { name: 'workflow', arguments: { action: 'dev_loop' }, _meta: { progressToken: 'tok-ed' } },
    } as any);
    // fallback 后走 dispatchTool → buildPerCallCtx → mockModule 收到 ctx.progress
    expect(capturedCtx).not.toBeNull();
    expect(typeof capturedCtx.progress).toBe('function');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/ToolDispatcher.test.ts -t "progress 透传链"`
Expected: FAIL — `capturedCtx.progress` 为 undefined（透传链未实现）

- [ ] **Step 3: 实现 — 修改 `src/core/ToolDispatcher.ts`（四层）**

3a. import（文件顶部 import 区加）：
```typescript
import { createProgressEmitter, type ProgressEmitter, type ProgressToken } from './progress.js';
```

3b. **第①层 — handleCall 提取 + 创建 emitter**（`:200-204` 区，提取 agentId 后、构造 ctx 前）。当前 `:200-204`：
```typescript
    const meta = (request as { params?: { _meta?: Record<string, unknown> } }).params?._meta;
    const agentId = (meta?.agentId ?? meta?.agent_id) as string | undefined;
    if (this.options.agentContext) {
      this.options.agentContext.getOrCreate(agentId);
    }
```
在其后插入：
```typescript
    // Task 3: 提取 progressToken → 创建 per-request emitter（C-CONC-1：局部变量，照抄 findGodotOverride 透传）
    const progressToken = meta?.progressToken as ProgressToken | undefined;
    const progressEmitter: ProgressEmitter | undefined =
      progressToken !== undefined ? createProgressEmitter(progressToken) : undefined;
```

3c. **第②层 — executeToolCall 闭包传入**。当前 `:208-210`：
```typescript
    return executeMiddleware(this.middleware, ctx, async () => {
      return this.executeToolCall(name, args, startTime);
    });
```
改为：
```typescript
    return executeMiddleware(this.middleware, ctx, async () => {
      return this.executeToolCall(name, args, startTime, progressEmitter);
    });
```

3d. **executeToolCall 签名加第 4 参**。当前 `:213`：
```typescript
  private async executeToolCall(name: string, args: Record<string, unknown>, startTime: number): Promise<ToolResult> {
```
改为：
```typescript
  private async executeToolCall(name: string, args: Record<string, unknown>, startTime: number, progressEmitter?: ProgressEmitter): Promise<ToolResult> {
```

3e. **三处 dispatchTool 调用传 emitter 作第 5 参**。
- `:323`（confirm 分支）当前：`return this.attachFallbackWarning(await this.dispatchTool(pending.toolName, pending.args, startTime, confirmedFindGodotOverride));`
  改为：`return this.attachFallbackWarning(await this.dispatchTool(pending.toolName, pending.args, startTime, confirmedFindGodotOverride, progressEmitter));`
- `:357`（editor fallback）当前：`return this.attachFallbackWarning(await this.dispatchTool(name, args, startTime, findGodotOverride));`
  改为：`return this.attachFallbackWarning(await this.dispatchTool(name, args, startTime, findGodotOverride, progressEmitter));`
- `:373`（headless）当前：`return this.attachFallbackWarning(await this.dispatchTool(name, args, startTime, findGodotOverride));`
  改为：`return this.attachFallbackWarning(await this.dispatchTool(name, args, startTime, findGodotOverride, progressEmitter));`

3f. **第③层 — dispatchTool 签名加第 5 参**。当前 `:571`：
```typescript
  private async dispatchTool(toolName: string, args: Record<string, unknown>, startTime: number, findGodotOverride?: ((projectPath?: string) => Promise<string>)): Promise<ToolResult> {
```
改为（加 `, progressEmitter?: ProgressEmitter`）：
```typescript
  private async dispatchTool(toolName: string, args: Record<string, unknown>, startTime: number, findGodotOverride?: ((projectPath?: string) => Promise<string>), progressEmitter?: ProgressEmitter): Promise<ToolResult> {
```

3g. **第④层 — buildPerCallCtx 调用 + 签名 + 注入**。
- `:597` 当前：`const perCallCtx = buildPerCallCtx(this.ctx, findGodotOverride);`
  改为：`const perCallCtx = buildPerCallCtx(this.ctx, findGodotOverride, progressEmitter);`
- `:706-713` 当前签名 + 实现：
```typescript
export function buildPerCallCtx(
  baseCtx: ToolContext,
  findGodotOverride?: (projectPath?: string) => Promise<string>,
): ToolContext {
  const perCallCtx = Object.create(baseCtx) as ToolContext;
  perCallCtx.findGodot = findGodotOverride ?? baseCtx.findGodot;
  return perCallCtx;
}
```
改为：
```typescript
export function buildPerCallCtx(
  baseCtx: ToolContext,
  findGodotOverride?: (projectPath?: string) => Promise<string>,
  progressEmitter?: ProgressEmitter,
): ToolContext {
  const perCallCtx = Object.create(baseCtx) as ToolContext;
  perCallCtx.findGodot = findGodotOverride ?? baseCtx.findGodot;
  // Task 3: 注入 per-request progress emitter（progress 是新增字段非 getter，不破坏 Object.create 继承机制）
  if (progressEmitter) {
    perCallCtx.progress = progressEmitter;
  }
  return perCallCtx;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/core/ToolDispatcher.test.ts`
Expected: PASS（含新增 4 个 progress 透传 it + 原有全绿，零回归）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit`（Expected: 0 errors）；`npx eslint src/core/ToolDispatcher.ts`（Expected: 0 errors）
```bash
git add src/core/ToolDispatcher.ts test/core/ToolDispatcher.test.ts
git commit -m "feat(progress): ToolDispatcher 四层参数链透传 emitter（Task 3）

handleCall 提取 _meta.progressToken → createProgressEmitter → 经
executeToolCall/dispatchTool/buildPerCallCtx 参数链注入 perCallCtx.progress。
全程局部变量不进实例字段（C-CONC-1 并发安全），照抄 findGodotOverride 模式。
含 editor fallback 路径 emitter 透传测试。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: dev_loop total 矩阵 + 推送点

**Files:**
- Modify: `src/tools/workflow.ts`（dev_loop 入口 + DSL/execute/verify/bridge/acceptance 推送点）
- Test: `test/tools/workflow.test.ts`（加 describe）

**Interfaces:**
- Consumes: Task 3 的 `ctx.progress`（`ToolContext.progress?`）
- Produces: dev_loop 按动态 total 推送 `notifications/progress`

**total 矩阵（spec §5）：**
- DSL 模式（`allDsl`）：`total = dslCommands.length`，每命令前推 `(i+1, total, cmd.method)`
- 正常模式：`total = 1(execute) + (verify?1:0) + (bridge?1:0) + (acceptance?1:0)`，每阶段开始前推 `(idx, total, label)`
- early-return（execute 失败）：停在 `(1, total)`，不推假完成

- [ ] **Step 1: 写失败测试（加到 `test/tools/workflow.test.ts` 末尾）**

dev_loop 真实执行依赖 godot 子进程，测试 mock `executeGdscript` + `sendToBridge` + `runVerification`。先在文件顶部加 import + vi.mock：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock dev_loop 的外部依赖（避免真跑 godot）
vi.mock('../../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(),
}));
vi.mock('../../src/tools/shared.js', () => ({
  opsErrorResult: vi.fn((code: string, msg: string) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: msg, error_code: code }) }], isError: true })),
  COMMON_ERROR_CODES: { INVALID_PARAMS: 'INVALID_PARAMS' },
  textResult: vi.fn((s: string) => ({ content: [{ type: 'text' as const, text: s }] })),
  requireProjectPath: vi.fn(() => '/fake/project'),
}));
vi.mock('../../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn(),
  setBridgeProjectDir: vi.fn(),
}));
```

> **注：** `requireProjectPath` / `textResult` 的实际 export 名以 `src/tools/shared.js` 与 `src/tools/workflow.ts` 当前 import 为准——实现前先 `grep "from.*shared" src/tools/workflow.ts` 确认，mock 工厂按实际 export 调整。`runVerification` 若在 workflow.ts 内部定义则不需 mock。

在末尾加 describe：

```typescript
describe('dev_loop progress 推送（Task 4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('仅 execute（无 verify/bridge/acceptance）→ 推送 [(1,1,executing)]', async () => {
    const { executeGdscript } = await import('../../src/gdscript-executor.js');
    (executeGdscript as any).mockResolvedValue({ compile_success: true, run_success: true, outputs: [] });
    const { handleTool } = await import('../../src/tools/workflow.js');
    const progress = vi.fn();
    await handleTool('workflow', { action: 'dev_loop', code: 'pass', project_path: '/p' }, { progress } as any);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(1, 1, 'executing GDScript');
  });

  it('verify + bridge + acceptance → 4 次推送，total=4', async () => {
    const { executeGdscript } = await import('../../src/gdscript-executor.js');
    (executeGdscript as any).mockResolvedValue({ compile_success: true, run_success: true, outputs: [] });
    const { sendToBridge } = await import('../../src/tools/game-bridge.js');
    (sendToBridge as any).mockResolvedValue({ result: {} });
    const { handleTool } = await import('../../src/tools/workflow.js');
    const progress = vi.fn();
    await handleTool('workflow', {
      action: 'dev_loop', code: 'pass', project_path: '/p',
      verify: true,
      bridge: { queries: [{ method: 'ping' }] },
      acceptance: { assertions: [] },
    }, { progress } as any);
    const calls = progress.mock.calls.map((c: any[]) => [c[0], c[1], c[2]]);
    expect(calls).toContainEqual([1, 4, 'executing GDScript']);
    expect(calls).toContainEqual([2, 4, 'verifying']);
    expect(calls).toContainEqual([3, 4, 'bridge queries/screenshot']);
    expect(calls).toContainEqual([4, 4, 'acceptance assertions']);
    expect(progress).toHaveBeenCalledTimes(4);
  });

  it('execute compile_error early-return → 仅 [(1,total)]，不推假完成', async () => {
    const { executeGdscript } = await import('../../src/gdscript-executor.js');
    (executeGdscript as any).mockResolvedValue({ compile_success: false, compile_error: 'boom', run_success: false, outputs: [] });
    const { handleTool } = await import('../../src/tools/workflow.js');
    const progress = vi.fn();
    const result: any = await handleTool('workflow', {
      action: 'dev_loop', code: 'pass', project_path: '/p', verify: true,
    }, { progress } as any);
    // total = 1(execute) + 1(verify) = 2；execute 失败 early-return，只推 (1,2)
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(1, 2, 'executing GDScript');
    // 结果含 step1_execute='compile_error'，isError 未设（textResult 不设 isError）
    const text = result?.content?.[0]?.text ?? '';
    expect(text).toContain('compile_error');
    expect(result?.isError).toBeFalsy();
  });

  it('ctx.progress 为 undefined → 不抛、不推送、结果正常（向后兼容）', async () => {
    const { executeGdscript } = await import('../../src/gdscript-executor.js');
    (executeGdscript as any).mockResolvedValue({ compile_success: true, run_success: true, outputs: [] });
    const { handleTool } = await import('../../src/tools/workflow.js');
    // ctx 无 progress 字段（模拟无 token 的旧客户端）
    const result: any = await handleTool('workflow', { action: 'dev_loop', code: 'pass', project_path: '/p' }, {} as any);
    expect(result?.content?.[0]?.text).toBeTruthy();
  });
});
```

> **DSL 模式测试** 见 Step 3 后补充（依赖 parseE2eDsl，实现时按 `workflow.ts` 实际 DSL 解析构造 allDsl 输入）。最小断言：3 条 DSL 命令 → 推送 `[(1,3,m1),(2,3,m2),(3,3,m3)]`。

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/workflow.test.ts -t "dev_loop progress"`
Expected: FAIL — `progress` 未被调用（推送点未实现）

- [ ] **Step 3: 实现 — 修改 `src/tools/workflow.ts` dev_loop（`:262` case 内）**

3a. **正常模式 total 计算**。当前 `:262-267` 提取 code/verify 后，在 `if (!code ...)` 校验（`:269-271`）后、DSL detection（`:273`）前插入：
```typescript
      // Task 4: 算正常模式 total（execute 恒有 + verify/bridge/acceptance 条件性）
      const willVerify = verify;
      const willBridge = !!(args.bridge && typeof args.bridge === 'object' && !Array.isArray(args.bridge));
      const willAccept = !!(args.acceptance && typeof args.acceptance === 'object' && !Array.isArray(args.acceptance));
      const total = 1 + (willVerify ? 1 : 0) + (willBridge ? 1 : 0) + (willAccept ? 1 : 0);
      let stepIdx = 0;
```

3b. **DSL 模式推送**。当前 DSL 循环 `:282` `for (const cmd of dslCommands) {`，在循环体开头（`:283` `if (!cmd) continue;` 后）插入推送。但 DSL 的 total = 命令数，与正常模式 total 不同。在 `:279` `if (allDsl) {` 体内、循环前定义 DSL total，循环内按命令索引推：
```typescript
      if (allDsl) {
        if (projectPath) setBridgeProjectDir(projectPath);
        const dslTotal = dslCommands.length;  // Task 4: DSL total = 命令数
        const dslResults: Array<{ command: string; success: boolean; error?: string }> = [];
        for (let i = 0; i < dslCommands.length; i++) {
          const cmd = dslCommands[i];
          if (!cmd) continue;
          ctx.progress?.(i + 1, dslTotal, cmd.method);  // Task 4: 每命令前推
          // ...（保留原有 _sleep / sendToBridge 逻辑不变）
```
> **注：** 原 `:282` 是 `for (const cmd of dslCommands)`，改为索引 for 以取 i。原循环体逻辑（`_sleep` 分支 / `sendToBridge` / `dslResults.push`）保留，仅外层换索引 + 加推送行。

3c. **execute 阶段推送**。当前 `:307` `const godot = await ctx.findGodot();` 前插入：
```typescript
      ctx.progress?.(++stepIdx, total, 'executing GDScript');
      const godot = await ctx.findGodot();
```

3d. **verify 阶段推送**。当前 `:341` `if (verify) {` 体内、`result.step2_verify = await runVerification(...)` 前：
```typescript
      if (verify) {
        ctx.progress?.(++stepIdx, total, 'verifying');
        result.step2_verify = await runVerification(godot, projectPath);
      }
```

3e. **bridge 阶段推送**。当前 `:350` `if (bridge) {` 体内开头（`if (projectPath) setBridgeProjectDir(...)` 前）：
```typescript
      if (bridge) {
        ctx.progress?.(++stepIdx, total, 'bridge queries/screenshot');
        if (projectPath) {
```

3f. **acceptance 阶段推送**。当前 `:416` `if (acceptance) {` 体内开头（frame_sequence 处理前）：
```typescript
      if (acceptance) {
        ctx.progress?.(++stepIdx, total, 'acceptance assertions');
        // ── frame_sequence: ...（保留原逻辑）
```

> **early-return 不加推送**（`:320-329`）：execute 失败时 stepIdx 停在 1，progress 停在 `(1, total)`，符合 spec §6（不推假完成）。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/tools/workflow.test.ts`
Expected: PASS（含新增 dev_loop progress it + 原有 genSceneSnapshotScript it 全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit`（Expected: 0 errors）；`npx eslint src/tools/workflow.ts`（Expected: 0 errors）
```bash
git add src/tools/workflow.ts test/tools/workflow.test.ts
git commit -m "feat(progress): dev_loop total 矩阵 + 阶段推送点（Task 4）

DSL 模式 total=命令数；正常模式 total=1(execute)+verify+bridge+acceptance。
每阶段开始前 ctx.progress?.(idx,total,label)。execute 失败 early-return
停在 (1,total) 不推假完成。无 token 时 ctx.progress undefined 全 no-op。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 全量验证 + 收尾

**Files:** 无代码改动（验证 + 文档同步）

- [ ] **Step 1: 全量 tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 全量 lint**

Run: `npm run lint`
Expected: 0 errors（既有 1 warning 若存在可接受，与基线一致）

- [ ] **Step 3: 全量 vitest**

Run: `npm test`
Expected: 全绿（基线 3625 passed/0 failed/8 skipped + 新增 progress 测试，0 failed）。若 L2 e2e 有 flaky（预存在，非本次引入），记录但不算回归。

- [ ] **Step 4: 行号复核**

核对 spec/plan 引用的行号（`:108` `:200` `:213` `:323` `:350` `:357` `:373` `:511` `:571` `:706` 等）与实现后实际行号。若漂移，在 spec §9 已声明"实现时以实际为准"，无需改 spec。

- [ ] **Step 5: capability-matrix 一致性（可选）**

Run: `npm run diff-matrix`
Expected: no drift（progress 是运行时行为，不新增工具/action，matrix 应无变化）

- [ ] **Step 6: 开发日志（按 CLAUDE.md Obsidian 规范）**

写 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-09 MCP Progress 通知 dev_loop MVP.md`（frontmatter + callouts），记录 SDD 全流程 + 关键决策（四层参数链 C-CONC-1、total 矩阵、ready gate 独立、editor fallback 测试盲点）。

- [ ] **Step 7: 最终 commit（日志/收尾）**

```bash
git add -A
git commit -m "chore(progress): dev_loop MVP 收尾（全量验证绿 + 日志）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review（plan 作者自查）

**1. Spec coverage：**
- spec §4.1 progress.ts 两件套 → Task 1 ✓
- spec §4.2 ToolContext.progress 字段 → Task 2 ✓
- spec §4.3 四层参数链 → Task 3 ✓
- spec §4.4 GodotServer 接线 → Task 2 ✓
- spec §5 total 矩阵（DSL/正常/early-return）→ Task 4 ✓
- spec §6 错误处理（ready gate/fire-and-forget/token 类型/early-return isError 语义）→ Task 1（单元覆盖 ready/throw/reject/token）+ Task 4（early-return isError 未设）✓
- spec §7 测试（progress 单元/Dispatcher 集成含并发+editor fallback/dev_loop 推送）→ Task 1/3/4 ✓
- spec §3 非目标（取消/其他长操作 YAGNI）→ 不实现，plan 无对应 task（正确）✓

**2. Placeholder scan：** Task 4 Step 1 的 DSL 测试标注"实现时按实际 DSL 解析构造"——这是因 parseE2eDsl 输入格式需实现时确认，plan 给了断言骨架。Task 4 Step 1 的 mock export 名注明"实现前 grep 确认"。无 TBD/TODO 空洞。

**3. Type consistency：** `ProgressEmitter = (progress: number, total: number, message?: string) => void` 在 Task 1（progress.ts）定义，Task 2（types.ts progress? 字段，内联同签名）、Task 3（ToolDispatcher import + 透传）、Task 4（ctx.progress?.() 调用）一致。`ProgressToken = string | number` 一致。`buildPerCallCtx` 第 3 参 `progressEmitter?: ProgressEmitter` 跨 Task 3 定义与调用一致。`createProgressEmitter(token): ProgressEmitter` 签名一致。

**4. 行号漂移风险：** spec §9 + plan Global Constraints 已声明行号基于 `26a1f95`、实现时以实际为准。每个 Modify 步骤给出现有代码片段（实现者按内容匹配，非纯行号）。
