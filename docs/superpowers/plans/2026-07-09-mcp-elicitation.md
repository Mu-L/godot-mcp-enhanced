# MCP Elicitation 接线（form mode MVP）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接线 elicitFn——missing required primitive param 时，`server.elicitInput` form mode 问用户，accept 则填入 args 继续执行；失败 fallback MISSING_PARAM。

**Architecture:** 框架已搭（`createElicitationMiddleware`），缺口是 elicitFn。新建 `src/core/elicit.ts`（**单值** `_elicitServer` 注入 + `createElicitFn`，**不带 clientReady**——elicitInput 是 request 非 notification；**不需四层参数链**——per-call 参数局部、天然并发安全）。middleware 就地构造 requestedSchema（方案 A）传 elicitFn。

**Tech Stack:** TypeScript + `@modelcontextprotocol/sdk`（`server.elicitInput`）+ vitest

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-09-mcp-elicitation-design.md`

## Global Constraints

- 行号基于 master `8b2c709`（含 Progress feature），实现时以实际为准——每个 task 实现前重新核对。
- 简体中文注释（匹配项目惯例）。
- 每个 task 须 `tsc` 0 错 + 相关测试绿；TDD（先红后绿）。
- 测试 vitest，命令 `npm test`（即 `vitest run`）。
- **elicit 不带 clientReady gate**（elicitInput 是 request/response，非 fire-and-forget notification）。
- **elicit 不需四层参数链**（requestedSchema/message per-call 局部构造，`_elicitServer` 只读，天然并发安全——**勿照 progress 四层链套用**）。
- elicitFn 返回 `Record<string, unknown>`（兼容 number/boolean，SDK 按 schema.type 返回）。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/core/elicit.ts` | `_elicitServer` 单值注入 + `createElicitFn` + `ElicitFn`/`RequestedSchema` 类型 | Create |
| `test/core/elicit.test.ts` | elicit.ts 单元测试 | Create |
| `src/core/middleware.ts` | elicitFn 调用块构造 requestedSchema + 第 2 参签名改 | Modify（`:113` 签名 / `:168-177` 调用块） |
| `test/core/middleware.test.ts` | 更新现有 `:237` 测试适配新签名 + 加 requestedSchema 构造验证 | Modify |
| `src/core/ToolDispatcher.ts` | `:410` elicitFn 从 null 改 `createElicitFn()` | Modify |
| `src/GodotServer.ts` | 构造 `setElicitServer` + close 清理 | Modify（`:108` 构造 / `:511` close） |
| `test/core/elicit-wiring.test.ts` | GodotServer 接线静态断言 | Create |

---

## Task 1: elicit.ts（server 注入 + createElicitFn）

**Files:**
- Create: `src/core/elicit.ts`
- Test: `test/core/elicit.test.ts`

**Interfaces:**
- Produces: `RequestedSchema`、`ElicitFn`、`setElicitServer(server|null)`、`createElicitFn(): ElicitFn`、`resetElicitServer()`

- [ ] **Step 1: 写失败测试 `test/core/elicit.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElicitFn, setElicitServer, resetElicitServer } from '../../src/core/elicit.js';
import type { RequestedSchema } from '../../src/core/elicit.js';

function mockServer(opts: { supportsElicitation?: boolean; elicitResult?: unknown; elicitThrows?: boolean }) {
  return {
    getClientCapabilities: vi.fn().mockReturnValue(
      opts.supportsElicitation === false ? {} : { elicitation: {} },
    ),
    elicitInput: opts.elicitThrows
      ? vi.fn().mockImplementation(() => { throw new Error('transport closed'); })
      : vi.fn().mockResolvedValue(opts.elicitResult ?? { action: 'decline' }),
  };
}

const schema: RequestedSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, count: { type: 'number' } },
  required: ['name', 'count'],
};

beforeEach(() => resetElicitServer());

describe('elicit.createElicitFn', () => {
  it('client 支持 + accept → 返回 content（number 类型保留，不窄化成 string）', async () => {
    const server = mockServer({ elicitResult: { action: 'accept', content: { name: 'x', count: 5 } } });
    setElicitServer(server as any);
    const result = await createElicitFn()(schema, '请补全参数');
    expect(result).toEqual({ name: 'x', count: 5 });
    expect(typeof result?.count).toBe('number');  // 关键：number 不被窄化
    expect(server.elicitInput).toHaveBeenCalledWith({ mode: 'form', message: '请补全参数', requestedSchema: schema });
  });

  it('client 不支持 elicitation（caps.elicitation falsy）→ null，不调 elicitInput', async () => {
    const server = mockServer({ supportsElicitation: false });
    setElicitServer(server as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
    expect(server.elicitInput).not.toHaveBeenCalled();
  });

  it('用户 decline → null', async () => {
    setElicitServer(mockServer({ elicitResult: { action: 'decline' } }) as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });

  it('用户 cancel → null', async () => {
    setElicitServer(mockServer({ elicitResult: { action: 'cancel' } }) as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });

  it('elicitInput throw → null（不抛，fallback 由 middleware 处理）', async () => {
    setElicitServer(mockServer({ elicitThrows: true }) as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });

  it('无 _elicitServer（null）→ null', async () => {
    resetElicitServer();
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/elicit.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/elicit.js'`

- [ ] **Step 3: 实现 `src/core/elicit.ts`**

```typescript
/**
 * MCP Elicitation 接线 —— server 注入 + createElicitFn。
 *
 * ⚠️ 与 logger/progress 的关键区别（实现者注意，勿照搬两件套）：
 * - **不带 clientReady gate**：elicitInput 是 request/response（client 必已 initialize
 *   才到达 middleware），非 fire-and-forget notification（logger/progress 的 clientReady
 *   是防 notification 握手前崩，elicit 无此问题）。
 * - **不需四层参数链**：requestedSchema/message 是 per-call 参数（middleware 局部构造），
 *   _elicitServer 只读共享，elicitInput 按 request id 路由 → 天然并发安全。
 *   "与 logger/progress 同构"仅指 server 注入模式（模块级 set + null 清理）。
 *
 * 失败安全：client 不支持 / decline / cancel / throw → 返回 null（middleware fallback MISSING_PARAM）。
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface RequestedSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

export type ElicitFn = (
  requestedSchema: RequestedSchema,
  message: string,
) => Promise<Record<string, unknown> | null>;

let _elicitServer: Server | null = null;

/** 注入 MCP Server 实例（GodotServer 构造时调）；null 清除（close/测试隔离） */
export function setElicitServer(server: Server | null): void {
  _elicitServer = server;
}

/**
 * 创建 elicitFn 实现。闭包捕获模块级 _elicitServer（只读共享）。
 * 返回 Record<string, unknown>（非 string）——SDK 按 requestedSchema.type 返回对应类型，
 * number/boolean param 不窄化。
 */
export function createElicitFn(): ElicitFn {
  return async (requestedSchema, message) => {
    if (!_elicitServer) return null;
    const caps = _elicitServer.getClientCapabilities();
    if (!caps?.elicitation) return null;
    try {
      const result = await _elicitServer.elicitInput({
        mode: 'form',
        message,
        requestedSchema,
      });
      if (result.action === 'accept' && result.content) {
        return result.content as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/** 测试隔离 / 干净关闭：重置模块状态 */
export function resetElicitServer(): void {
  _elicitServer = null;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/core/elicit.test.ts`
Expected: PASS（6 个 it 全绿）

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`（Expected: 0 errors）
```bash
git add src/core/elicit.ts test/core/elicit.test.ts
git commit -m "feat(elicit): server 注入 + createElicitFn（Task 1）

单值 _elicitServer（不带 clientReady——elicitInput 是 request 非 notification）。
createElicitFn 闭包捕获 server，返回 Record<string,unknown> 兼容 number/boolean。
client 不支持/decline/cancel/throw → null（middleware fallback MISSING_PARAM）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: middleware 构造 requestedSchema + 签名改

**Files:**
- Modify: `src/core/middleware.ts`（`:113` 签名 / `:168-177` 调用块）
- Modify: `test/core/middleware.test.ts`（更新 `:237` + 加 requestedSchema 验证）

**Interfaces:**
- Consumes: Task 1 的 `RequestedSchema` 类型
- Produces: `createElicitationMiddleware` 第 2 参新签名 `(requestedSchema, message) => Promise<Record<string,unknown>|null>`

- [ ] **Step 1: 更新现有 `:237` 测试 + 加 requestedSchema 验证测试**

在 `test/core/middleware.test.ts` 顶部 import 加 `RequestedSchema` 类型（若 elicit.js 已建）：
```typescript
import type { RequestedSchema } from '../../src/core/elicit.js';
```

替换 `:237-254` 的 'fills missing params from elicitation' it（elicitFn 签名 params→requestedSchema）：
```typescript
  it('fills missing params from elicitation', async () => {
    let capturedSchema: RequestedSchema | null = null;
    const mw = createElicitationMiddleware(
      () => makeToolDef(['project_path']),
      async (requestedSchema, _message) => {
        capturedSchema = requestedSchema;
        return { project_path: '/filled' };
      },
    );
    const ctx = {
      toolName: 'test_tool', args: {},
      startTime: Date.now(), phase: 'before',
    };
    const result = await mw.before(ctx);
    expect('passed' in result && result.passed).toBe(true);
    expect(ctx.args.project_path).toBe('/filled');
    expect(capturedSchema).toEqual({
      type: 'object',
      properties: { project_path: { type: 'string' } },
      required: ['project_path'],
    });
  });
```

在 describe 块末尾（`:281` 前）加新 it（验证 requestedSchema 含 type/enum）：
```typescript
  it('constructs requestedSchema with type/enum from inputSchema', async () => {
    let capturedSchema: RequestedSchema | null = null;
    const mw = createElicitationMiddleware(
      () => ({
        name: 'test_tool',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['a', 'b'] },
            count: { type: 'number' },
          },
          required: ['mode', 'count'],
        },
      }) as any,
      async (schema) => { capturedSchema = schema; return { mode: 'a', count: 1 }; },
    );
    await mw.before({ toolName: 'test_tool', args: {}, startTime: Date.now(), phase: 'before' });
    expect(capturedSchema).not.toBeNull();
    expect(capturedSchema!.properties.mode).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(capturedSchema!.properties.count).toEqual({ type: 'number' });
    expect(capturedSchema!.required).toEqual(['mode', 'count']);
  });
```

> **注：** `:256 'does not mutate original args object'` 用 `vi.fn().mockResolvedValue(...)`，vi.fn 忽略参数签名，新签名下仍兼容，**无需改**。

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/middleware.test.ts -t "elicitation"`
Expected: FAIL — 现有 :237 elicitFn 收到的是 requestedSchema 而非 string[]（旧实现传 primitiveMissing），`capturedSchema` 断言不匹配

- [ ] **Step 3: 修改 `src/core/middleware.ts`**

3a. import RequestedSchema（顶部 import 区，`:113` 类型用）：
```typescript
import type { RequestedSchema } from './elicit.js';
```

3b. 改 `createElicitationMiddleware` 第 2 参签名（`:113`）。当前：
```typescript
  elicitFn: ((params: string[]) => Promise<Record<string, string> | null>) | null,
```
改为：
```typescript
  elicitFn: ((requestedSchema: RequestedSchema, message: string) => Promise<Record<string, unknown> | null>) | null,
```

3c. 改 elicitFn 调用块（`:168-177`）。当前：
```typescript
      if (elicitFn) {
        const elicited = await elicitFn(primitiveMissing);
        if (elicited) {
```
改为（构造 requestedSchema 后传入）：
```typescript
      if (elicitFn) {
        const requestedSchema: RequestedSchema = {
          type: 'object',
          properties: Object.fromEntries(
            primitiveMissing.map(p => [p, props[p] ?? { type: 'string' }]),
          ),
          required: primitiveMissing,
        };
        const elicited = await elicitFn(
          requestedSchema,
          `Tool "${ctx.toolName}" missing required parameter(s)`,
        );
        if (elicited) {
```

> **注：** `props` 已在 `:142` 定义（`const props = schema.properties ?? {};`），就地构造是顺水推舟。后续 `if (elicited) { ... safeArgs[key] = val ... }` 块（原 `:171-176`）不变。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/core/middleware.test.ts`
Expected: PASS（含更新后的 :237 + 新 requestedSchema it + 原有 elicitation/middleware 测试全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit`（0 errors）；`npx eslint src/core/middleware.ts`（0 errors）
```bash
git add src/core/middleware.ts test/core/middleware.test.ts
git commit -m "feat(elicit): middleware 构造 requestedSchema + elicitFn 签名改（Task 2）

elicitFn 签名 (params:string[])→(requestedSchema,message)。middleware 就地构造
requestedSchema（方案 A，利用已有 props=schema.properties）。返回 Record<string,unknown>。
更新 :237 测试 + 加 requestedSchema type/enum 验证。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: ToolDispatcher 接线 + GodotServer 接线

**Files:**
- Modify: `src/core/ToolDispatcher.ts`（`:410` elicitFn null→createElicitFn()）
- Modify: `src/GodotServer.ts`（`:108` 构造 setElicitServer / `:511` close 清理 / import）
- Test: `test/core/elicit-wiring.test.ts`（Create，静态断言）

**Interfaces:**
- Consumes: Task 1 的 `createElicitFn`/`setElicitServer`、Task 2 的 elicitFn 新签名
- Produces: elicitFn 接线生效（missing primitive param → elicitInput 问用户）

- [ ] **Step 1: 写失败测试 `test/core/elicit-wiring.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const godotServerSrc = readFileSync(join(here, '../../src/GodotServer.ts'), 'utf8');
const dispatcherSrc = readFileSync(join(here, '../../src/core/ToolDispatcher.ts'), 'utf8');

// 项目惯例不实例化 GodotServer（依赖重），接线是确定性赋值，用静态断言验证。
// elicitFn→elicitInput 行为由 elicit.test.ts 单元 + middleware.test.ts 集成覆盖。
describe('Elicitation 接线（静态断言）', () => {
  it('GodotServer import 了 elicit 模块', () => {
    expect(godotServerSrc).toMatch(/from ['"]\.\/core\/elicit\.js['"]/);
  });
  it('GodotServer 构造时 setElicitServer(this.server)', () => {
    expect(godotServerSrc).toMatch(/setElicitServer\(this\.server\)/);
  });
  it('GodotServer close 时 setElicitServer(null)', () => {
    expect(godotServerSrc).toMatch(/setElicitServer\(null\)/);
  });
  it('ToolDispatcher elicitFn 非 null（createElicitFn）', () => {
    expect(dispatcherSrc).toMatch(/createElicitFn\(\)/);
    expect(dispatcherSrc).not.toMatch(/createElicitationMiddleware\(\s*[^,]+,\s*null/);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/elicit-wiring.test.ts`
Expected: FAIL — 接线尚未存在

- [ ] **Step 3: 修改 `src/core/ToolDispatcher.ts`（:410）**

import（顶部 import 区加）：
```typescript
import { createElicitFn } from './elicit.js';
```

`:410-413` 当前：
```typescript
    mw.push(createElicitationMiddleware(
      (name: string) => getAllToolDefinitions().find(t => t.name === name) ?? null,
      null,
    ));
```
改为（第 2 参 null → createElicitFn()）：
```typescript
    mw.push(createElicitationMiddleware(
      (name: string) => getAllToolDefinitions().find(t => t.name === name) ?? null,
      createElicitFn(),
    ));
```

- [ ] **Step 4: 修改 `src/GodotServer.ts`（import + 构造 + close）**

4a. import（在 progress import `from './core/progress.js'` 后加）：
```typescript
import { setElicitServer } from './core/elicit.js';
```

4b. 构造（在 `:108` `setProgressSender(this.server);` 后加）：
```typescript
    setElicitServer(this.server);
```

4c. close（在 `:511` 区 `setProgressSender(null);` / `setProgressClientReady(false);` 后加）：
```typescript
    setElicitServer(null);
```

- [ ] **Step 5: 跑测试验证通过**

Run: `npx vitest run test/core/elicit-wiring.test.ts`
Expected: PASS（4 个 it 全绿）

- [ ] **Step 6: tsc + lint + commit**

Run: `npx tsc --noEmit`（0 errors）；`npx eslint src/core/ToolDispatcher.ts src/GodotServer.ts`（0 errors）
```bash
git add src/core/ToolDispatcher.ts src/GodotServer.ts test/core/elicit-wiring.test.ts
git commit -m "feat(elicit): ToolDispatcher + GodotServer 接线（Task 3）

ToolDispatcher:410 elicitFn null→createElicitFn()。GodotServer 构造
setElicitServer(this.server) + close setElicitServer(null)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 全量验证 + 收尾

**Files:** 无代码改动（验证 + 文档）

- [ ] **Step 1: 全量 tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 全量 lint**

Run: `npm run lint`
Expected: 0 errors（既有 warning 若与基线一致可接受）

- [ ] **Step 3: 全量 vitest**

Run: `npm test`
Expected: 全绿（基线 3646 + 新增 elicit 测试 ~11，0 failed）。L2 e2e flaky 若预存在不算回归。

- [ ] **Step 4: 行号复核**

核对 spec/plan 行号（`:113` / `:142` / `:168-177` / `:410` / `:108` / `:511` 等）vs 实际。spec §9 已声明"实现时以实际为准"。

- [ ] **Step 5: diff-matrix**

Run: `npm run diff-matrix`
Expected: no drift（elicitation 是运行时行为，不新增工具/action）

- [ ] **Step 6: Obsidian 开发日志**

写 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-09 MCP Elicitation 接线.md`（frontmatter + callouts）：SDD 全流程 + 关键决策（form mode MVP / 单值 server 注入不带 clientReady / 不需四层参数链并发对比 / 方案 A middleware 构造 schema / 返回 Record<string,unknown>）。

- [ ] **Step 7: 收尾 commit（若仓库有改动）**

若仅 vault 日志（仓库外）+ 验证无新仓库改动，**不创建空 commit**，报告"仓库无新改动，验证全绿"。

---

## Self-Review

**1. Spec coverage：**
- spec §4.1 elicit.ts 单值 server 注入 + createElicitFn → Task 1 ✓
- spec §4.1 不带 clientReady + 返回 unknown → Task 1（注释 + 类型 + 测试 number 保留）✓
- spec §4.2 middleware 构造 requestedSchema + 签名改 → Task 2 ✓
- spec §4.3 ToolDispatcher 接线 → Task 3 ✓
- spec §4.4 GodotServer 接线 → Task 3 ✓
- spec §5 数据流（missing→schema→elicitFn→elicitInput→accept/decline）→ Task 1+2+3 ✓
- spec §6 错误处理（client 不支持/decline/cancel/throw/无 server → null→MISSING_PARAM）→ Task 1 单元 ✓
- spec §7 测试（elicit 单元/middleware 集成/接线静态断言）→ Task 1/2/3 ✓
- spec §3 非目标（URL mode/收窄/多步/非 primitive YAGNI）→ 不实现 ✓

**2. Placeholder scan：** Task 2 Step 1 注明 :256 mockResolvedValue 兼容无需改（基于实测）。Task 3 静态断言（同 progress-wiring 先例）。无 TBD/TODO 空洞。

**3. Type consistency：** `RequestedSchema`（elicit.ts 定义）→ middleware.ts import + elicitFn 签名 → 测试断言一致。`ElicitFn` 返回 `Record<string, unknown>` 跨 Task 1（定义）/ Task 2（middleware 第 2 参）/ 测试一致。`createElicitFn()` 签名跨 Task 1（产出）/ Task 3（接线）一致。

**4. 并发安全对比落地：** Global Constraints + Task 1 elicit.ts 注释明示"不需四层参数链"，防实现者照 progress 套用。
