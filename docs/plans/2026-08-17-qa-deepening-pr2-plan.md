# PR-2:MCP Tasks 协议层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 qa run 注册表按 MCP 2025-11-25 tasks wire 契约暴露:`tasks/get|list|cancel|result` 四 handler + `notifications/tasks/status` 终态通知 + capabilities 声明 + 客户端 task 能力协商驱动的 taskAugmented 自动 async(`_meta.relatedTask` 响应);顺手做 makeRunId 随机后缀与 RunRecord error 字段(PR-1b 登记项)。

**Architecture:** 依赖方向裁定——task wire 视图放 `src/tools/qa/task-view.ts`(与 registry 同目录;**不放 spec 原文的 `src/core/task-store.ts`**,避免 core→tools 分层倒置,仓库 P0-arch-cleanup 教训);GodotServer 直连 4 个 `tasks/*` 字符串 method handler(SDK 无 task 运行时,wire schema 从 `@modelcontextprotocol/core/internal` 导入校验);taskAugmented 探测用**客户端能力协商**(`server.getClientCapabilities()?.tasks?.requests?.tools?.call`,SDK 现成方法)替代 per-request `_meta` 信令(spec §3.3 风险 3 与 I-9 的 safeParse 恒真问题一并消解)。

**Tech Stack:** TypeScript strict/ESM + Vitest + SDK InMemoryTransport(集成测试)。零新依赖。

**Spec:** `docs/plans/2026-08-17-qa-deepening-spec.md` §3 + §0.5。前置 PR-1a/1b 已合并 master(3f423e4)。

## 已锁定的 wire 契约(2026-08-17 实测 `@modelcontextprotocol/core/internal`)

- `LATEST_PROTOCOL_VERSION = '2025-11-25'` 且 SUPPORTED 全列表 ≤ 该值——**SDK Client 默认协商即 tasks 可用 era**,InMemoryTransport 集成测试无需特殊版本处理。
- `Task` / `GetTaskResult` / `CancelTaskResult` 必填五字段**平铺**:`{taskId, status, ttl, createdAt, lastUpdatedAt}`(+可选 `statusMessage`);`ListTasksResult = {tasks: [Task…]}`;`TaskStatusNotificationParams` 同五字段;`GetTaskPayloadResult = {payload: <任意对象>}`(任意 payload 校验通过)。
- `ServerTasksCapabilitySchema.safeParse({list:{}, cancel:{}, requests:{tools:{call:{}}}})` 通过;`ClientTasksCapabilitySchema` 接受 `{requests:{tools:{call:{}}}}`。
- status 枚举 `working|input_required|completed|failed|cancelled`;**ttl 数字(秒)**通过校验(3600 OK)——registry 内部 ms,导出 `/1000`。
- SDK Server 现成方法:`getClientCapabilities()`(客户端能力探测,spec §3.3 风险 2 消解)。
- 2026 era 客户端发 `tasks/get` 在 SDK 分发层 METHOD_NOT_FOUND(到不了 handler,N-8 免风险确认)。

## Global Constraints

- 工作目录 `D:\GitHub\godot-mcp-series\godot-mcp-enhanced`;分支 `feat/qa-tasks-wire`(Task 1 建);Conventional Commits(type 英文、subject 中文)。
- TypeScript strict + noUncheckedIndexedAccess,禁 any;ESM import `.js`;lint 零警告。
- **分层约束**:新增模块不得使 `src/core/*` import `src/tools/*`(task-view 放 tools/qa);GodotServer→tools 既有方向合法。
- **B-3 安全裁定**:tasks/cancel 免二次 elicitation(启动 run 已过 confirm 门)但**必须 audit 留痕**(`isAuditEnabled` + `appendAuditLine`,CLI auditRun 先例 `src/cli/qa.ts:87-107`);tasks/get|list|result 只读零审计。
- 通知纪律:`notifications/tasks/status` 仅**终态变化**时发(working 进度不发,防刷屏);仅当 `getClientCapabilities()?.tasks` 存在时发(协议要求);通知失败 best-effort(try/catch 记日志)。
- wire schema 校验:handler 响应对象先经对应 Schema `.parse`(出错 = 实现 bug,抛给 SDK 转 JSON-RPC internal error)。
- 默认零破坏:无 tasks 能力的客户端一切现状不变(taskAugminated 探测基于客户端能力,未声明 → sync 现状);qa 工具 schema/description 本批**零改动**(matrix 预期无 drift,Task 6 实测确认)。
- mock 带真实 shape;每任务 TDD;全部完成后 lint + build + test + build-matrix + check:budget + version-check 全绿。

---

### Task 1:registry 增强——终态通知钩子 + error 字段 + makeRunId 随机后缀

**Files:**
- Modify: `src/tools/qa/registry.ts`(setTerminalNotifier / RunRecord.error / finishRun error 参)
- Modify: `src/tools/qa/report.ts`(makeRunId 随机后缀 + findPreviousReport 匹配适配)
- Test: `test/qa-registry.test.ts`、`test/qa-report.test.ts`

**Interfaces:**
- Produces(Task 2/3 依赖):
  ```ts
  // registry.ts 新增
  export function setTerminalNotifier(fn: ((runId: string, status: 'completed' | 'failed' | 'cancelled') => void) | null): void;
  // RunRecord 加可选字段 error?: string;finishRun 加尾参 error?: string(写入 r.error)
  // report.ts:makeRunId() → `${timestampStem()}-${sanitizeSuiteName(name)}-${rand4}`(rand4 = 小写hex 4 位)
  // findPreviousReport 粗筛从 f.endsWith(`-${sanitize}.json`) 改为 f 包含 `-${sanitize}-` 段
  ```

- [ ] **Step 1:写失败测试**

`test/qa-registry.test.ts` 追加:

```ts
describe('registry 终态通知与 error 字段(PR-2)', () => {
  afterEach(() => setTerminalNotifier(null));

  it('finishRun 终态时调用 notifier(runId+status);updateProgress 不触发', () => {
    clearRegistry();
    const fired: Array<[string, string]> = [];
    setTerminalNotifier((id, st) => fired.push([id, st]));
    registerRun('run-1', 'a', 'D:/p', 2);
    updateProgress('run-1', 1, 2, 'x');
    expect(fired).toHaveLength(0);
    finishRun('run-1', 'completed');
    expect(fired).toEqual([['run-1', 'completed']]);
  });

  it('notifier 抛异常不影响 finishRun 状态写入(best-effort)', () => {
    clearRegistry();
    setTerminalNotifier(() => { throw new Error('boom'); });
    registerRun('run-2', 'a', 'D:/p', 1);
    expect(() => finishRun('run-2', 'failed')).not.toThrow();
    expect(getRun('run-2')!.status).toBe('failed');
  });

  it('finishRun error 参数写入 RunRecord.error', () => {
    clearRegistry();
    registerRun('run-3', 'a', 'D:/p', 1);
    finishRun('run-3', 'failed', undefined, undefined, 'writeReport failed: EACCES');
    expect(getRun('run-3')!.error).toBe('writeReport failed: EACCES');
  });
});
```

`test/qa-report.test.ts` 追加:

```ts
describe('makeRunId 随机后缀与 findPreviousReport 适配(PR-2)', () => {
  it('同秒内两次 makeRunId 同名套件 → run_id 不同(随机后缀)', () => {
    const a = makeRunId('suiteX');
    const b = makeRunId('suiteX');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^-\d+-suiteX-[0-9a-f]{4}$/);   // 时间戳-sanitize-rand4 三段
  });

  it('findPreviousReport 仍能跨随机后缀找到同套件基线', () => {
    // 沿用现有 findPreviousReport 用例的临时目录构造:old-PASSED → new-PASSED(均带随机后缀形态
    // run_id 如 '20260817-080000-suiteX-a1b2')→ 断言命中 old
  });

  it('findPreviousReport 不误配 sanitize 相同的不同套件(碰撞防护回归)', () => {
    // 'suite X' 与 'suite_X' sanitize 后同后缀段,但 suite.name 精校拒(既有语义回归,用随机后缀形态构造)
  });
});
```

> 后两个用例按该文件既有 findPreviousReport 用例构造惯例落地(env 重定向 + writeReport);`toMatch` 正则按实现微调(锚定 `-suiteX-[0-9a-f]{4}$`)。

- [ ] **Step 2:跑测试确认失败**(`npx vitest run test/qa-registry.test.ts test/qa-report.test.ts`)

- [ ] **Step 3:实现**

registry.ts:

```ts
/** 终态通知钩子(PR-2 tasks wire):finishRun 到终态时回调(发 notifications/tasks/status 用)。
 * null = 注销。回调抛异常 best-effort 吞掉(记日志由调用方包装),不影响状态写入。 */
let terminalNotifier: ((runId: string, status: 'completed' | 'failed' | 'cancelled') => void) | null = null;

export function setTerminalNotifier(fn: ((runId: string, status: 'completed' | 'failed' | 'cancelled') => void) | null): void {
  terminalNotifier = fn;
}
```

RunRecord 接口加 `error?: string;`(注释:终态失败原因(PR-1b M-8);finishRun 尾参写入)。finishRun 签名加 `error?: string`,函数体末尾(`if (reportPaths) ...` 之后)加:

```ts
  if (error !== undefined) r.error = error;
  if (terminalNotifier) {
    try { terminalNotifier(runId, status); } catch { /* best-effort:通知失败不影响注册表 */ }
  }
```

report.ts 的 makeRunId:

```ts
/** 落盘前生成 run_id(时间戳-套件名-4位随机;PR-2 加随机后缀防同秒同名覆盖,PR-1b M-7) */
export function makeRunId(suiteName: string): string {
  const rand4 = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `${timestampStem()}-${sanitizeSuiteName(suiteName)}-${rand4}`;
}
```

findPreviousReport 粗筛行改:

```ts
  const suffix = `-${sanitizeSuiteName(suiteName)}-`;   // PR-2:run_id 加随机后缀,粗筛改中段匹配
  ...
    if (!f.includes(suffix)) continue;                   // 原 f.endsWith(`-${sanitize}.json`) 不再成立
```

**同步检查**:`grep -rn 'makeRunId\|findPreviousReport' src/ test/`——凡断言 run_id 精确形态/文件名 `.json` 拼接的调用点(readReport 按完整 run_id 查不受影响;`writeReport` 用 `report.run_id` 不受影响),修到全绿;e2e-qa-assert-batch 若 regex 匹配 run_id 也核对。

- [ ] **Step 4:跑测试确认通过**(含 qa-index/qa-runner/e2e 相关回归:`npx vitest run test/qa-registry.test.ts test/qa-report.test.ts test/qa-index.test.ts test/qa-runner.test.ts test/qa-cli-nightly.test.ts`)

- [ ] **Step 5:Commit**

```bash
git checkout -b feat/qa-tasks-wire
git add src/tools/qa/registry.ts src/tools/qa/report.ts test/qa-registry.test.ts test/qa-report.test.ts
git commit -m "feat(qa): registry 终态通知钩子+error 字段;makeRunId 随机后缀防同秒覆盖(M-7/M-8)"
```

---

### Task 2:task-view.ts——RunRecord → wire Task 视图

**Files:**
- Create: `src/tools/qa/task-view.ts`
- Test: `test/qa-task-view.test.ts`(新)

**Interfaces:**
- Consumes: `RunRecord`/`getRun`/`listRuns`(`./registry.js`);SDK schema(`@modelcontextprotocol/core/internal`)。
- Produces(Task 3 依赖):

```ts
import type { Task } from '@modelcontextprotocol/core/internal';   // 若该入口无类型导出,用结构类型自声明(见 Step 3 注)
export interface WireTask { taskId: string; status: 'working'|'completed'|'failed'|'cancelled'; ttl: number; createdAt: string; lastUpdatedAt: string; statusMessage?: string }
export function toWireTask(r: RunRecord): WireTask;         // 五字段 + working 时 statusMessage='step N/M: <current>'
export function toTaskPayload(r: RunRecord): Record<string, unknown>;  // 终态:{run_id, summary, report_paths, error?};working 时抛 Error('task not terminal')
export function assertTaskWire(t: WireTask): void;          // TaskSchema.safeParse 校验,失败抛(实现 bug 早爆)
```

- [ ] **Step 1:写失败测试**(纯函数级:构造 RunRecord 字面量 → toWireTask 断言五字段/ttl 秒换算/statusMessage;toTaskPayload 终态/working 两路;assertTaskWire 对真 schema 校验合法样本通过)

```ts
import { describe, it, expect } from 'vitest';
import { toWireTask, toTaskPayload, assertTaskWire, type WireTask } from '../src/tools/qa/task-view.js';
import { registerRun, finishRun, getRun, clearRegistry } from '../src/tools/qa/registry.js';

beforeEach(() => clearRegistry());

describe('task-view: RunRecord → wire Task', () => {
  it('working 记录 → 五字段 + statusMessage(step N/M: current),ttl 为秒', () => {
    registerRun('r1', 's', 'D:/p', 5);
    const rec = getRun('r1')!;
    rec.progress = { step: 2, total: 5, current: 'input(send_key)' };
    const t = toWireTask(rec);
    expect(t.taskId).toBe('r1');
    expect(t.status).toBe('working');
    expect(t.statusMessage).toBe('step 2/5: input(send_key)');
    expect(t.ttl).toBe(Math.round(rec.ttl / 1000));   // ms→s
    expect(t.createdAt).toBe(rec.createdAt);
    assertTaskWire(t);   // SDK TaskSchema 校验通过
  });

  it('终态记录 → status 直映,无 statusMessage;assertTaskWire 过', () => {
    registerRun('r2', 's', 'D:/p', 1);
    finishRun('r2', 'cancelled');
    const t = toWireTask(getRun('r2')!);
    expect(t.status).toBe('cancelled');
    expect(t.statusMessage).toBeUndefined();
    assertTaskWire(t);
  });

  it('toTaskPayload:终态返回 run_id/summary/report_paths(+error);working 抛', () => {
    registerRun('r3', 's', 'D:/p', 1);
    expect(() => toTaskPayload(getRun('r3')!)).toThrow(/not terminal/);
    finishRun('r3', 'failed', { summary: { status: 'FAILED' } } as never, { json_path: 'j', md_path: 'm' }, 'boom');
    const p = toTaskPayload(getRun('r3')!);
    expect(p.run_id).toBe('r3');
    expect(p.error).toBe('boom');
    expect(p.report_paths).toEqual({ json_path: 'j', md_path: 'm' });
  });
});
```

- [ ] **Step 2:确认失败 → Step 3:实现**

```ts
// src/tools/qa/task-view.ts — qa run 注册表 → MCP 2025-11-25 tasks wire 视图(PR-2)
//
// 依赖方向裁定:与 registry 同目录(不放 core/,防 core→tools 分层倒置,仓库 P0-arch-cleanup 教训)。
// wire 契约(Task/GetTaskResult/CancelTaskResult 平铺五字段)2026-08-17 实测:
// 必填 taskId/status/ttl(秒)/createdAt/lastUpdatedAt,可选 statusMessage;枚举 working|input_required|completed|failed|cancelled。

import type { RunRecord } from './registry.js';
import { TaskSchema } from '@modelcontextprotocol/core/internal';

export interface WireTask {
  taskId: string;
  status: 'working' | 'completed' | 'failed' | 'cancelled';
  ttl: number;              // 秒(wire 单位;registry 内部 ms)
  createdAt: string;
  lastUpdatedAt: string;
  statusMessage?: string;   // working 进度文本(TaskSchema 无结构化 progress 字段,I-8)
}

/** RunRecord → wire Task。ttl ms→s;working 时经 statusMessage 承载进度。 */
export function toWireTask(r: RunRecord): WireTask {
  const t: WireTask = {
    taskId: r.taskId,
    status: r.status,
    ttl: Math.round(r.ttl / 1000),
    createdAt: r.createdAt,
    lastUpdatedAt: r.lastUpdatedAt,
  };
  if (r.status === 'working') {
    const cur = r.progress.current ? `: ${r.progress.current}` : '';
    t.statusMessage = `step ${r.progress.step}/${r.progress.total}${cur}`;
  }
  return t;
}

/** tasks/result 的 payload(终态报告摘要;working 抛错由 handler 转 JSON-RPC error) */
export function toTaskPayload(r: RunRecord): Record<string, unknown> {
  if (r.status === 'working') throw new Error(`task ${r.taskId} not terminal (status: working)`);
  return {
    run_id: r.taskId,
    summary: r.report?.summary,
    report_paths: r.reportPaths,
    ...(r.error !== undefined ? { error: r.error } : {}),
  };
}

/** wire 校验:TaskSchema.safeParse 失败即实现 bug(注册表字段与契约漂移),早爆。 */
export function assertTaskWire(t: WireTask): void {
  const r = TaskSchema.safeParse(t);
  if (!r.success) throw new Error(`task wire 校验失败(实现 bug): ${JSON.stringify(r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`))}`);
}
```

> 注:若 `@modelcontextprotocol/core/internal` 的 `TaskSchema` 类型导出不符(zod v4 类型推断),import 保持 value-only(schema 校验用),WireTask 结构类型自声明即可(已如此)。若该子路径 import 在 vitest 解析失败,备选 `import { TaskSchema } from '@modelcontextprotocol/server'` 先试主入口(实测主入口曾无 TaskSchema——则必须 core/internal;tsconfig moduleResolution Node16 下子路径导出需包 exports 字段允许,实测失败则改 `@modelcontextprotocol/core/dist/internal.js` 深路径并在报告注明)。

- [ ] **Step 4:确认通过 → Step 5:Commit**

```bash
git add src/tools/qa/task-view.ts test/qa-task-view.test.ts
git commit -m "feat(qa): task-view——RunRecord→wire Task 五字段视图(statusMessage 承载进度,payload 组装)"
```

---

### Task 3:GodotServer tasks wire 层——capabilities + 4 handler + cancel audit + 终态通知

**Files:**
- Modify: `src/GodotServer.ts`(capabilities.tasks;4 个 setRequestHandler;通知注册;close 清理)
- Test: `test/qa-tasks-wire.test.ts`(新,InMemoryTransport 集成)

**Interfaces:**
- Consumes: Task 1 `setTerminalNotifier`;Task 2 `toWireTask/toTaskPayload/assertTaskWire`;registry `getRun/listRuns/requestCancel`;audit-log `isAuditEnabled/appendAuditLine`(AuditEntry 形态照 `src/cli/qa.ts:87-107` auditRun 先例)。
- Produces: 协议面上线——2025 era 客户端可 `tasks/get|list|cancel|result`。

- [ ] **Step 1:写失败测试**(InMemoryTransport 全链;参考仓库既有 InMemoryTransport 测试先例——`grep -rln "InMemoryTransport" test/` 找一个照抄连接基建)

```ts
// test/qa-tasks-wire.test.ts(骨架+验收标准;连接基建照抄仓库既有 InMemoryTransport 测试)
// 起真实 GodotServer(或最小构造路径,按既有测试惯例)+ InMemoryTransport + SDK Client(clientCapabilities 声明 tasks)。

describe('tasks wire layer(PR-2)', () => {
  it('initialize 后 server capabilities 含 tasks(细粒度 list/cancel/requests.tools.call)', async () => {
    // client.connect → client.getServerCapabilities() 断言 tasks 字段存在
  });
  it('tasks/list 返回注册表条目(wire 五字段,ttl 秒)', async () => {
    // 测试侧直接 registerRun 造一条 → client.request({method:'tasks/list'}) → tasks[0].taskId 匹配
  });
  it('tasks/get:working 带 statusMessage;终态 status 直映', async () => { /* registerRun+updateProgress → get 断言;finishRun → get 断言 */ });
  it('tasks/get 未知 taskId → JSON-RPC error(-32602 INVALID_PARAMS 或 SDK 默认 invalid params,断言 code/消息含 taskId) ', async () => {});
  it('tasks/cancel working → ok(taskId 回显);且写入 audit line(GODOT_MCP_AUDIT 默认开,tmp 项目目录,断言 mcp_audit.jsonl 新增行含 action:"tasks/cancel")', async () => {
    // project_path 用 tmp 目录(registerRun 传 tmp);cancel 后读 .godot/mcp_audit.jsonl 断言
  });
  it('tasks/cancel 终态/未知 → JSON-RPC error', async () => {});
  it('tasks/result:终态返回 payload(run_id/summary);working → error', async () => {});
  it('终态通知:客户端声明 tasks 能力 → finishRun 触发 notifications/tasks/status(五字段);未声明 tasks 能力的客户端 → 不发', async () => {
    // client.setOnNotification 捕获;两客户端分别连(一个 capabilities.tasks 一个无)
  });
  it('无 tasks 能力客户端的现状零破坏:tools/call 一切照旧', async () => { /* 既有行为回归,任选一个轻量工具调用 */ });
});
```

- [ ] **Step 2:确认失败 → Step 3:实现——GodotServer.ts**

3a. capabilities 对象加(既有 capabilities 声明段,era-gated 注释同 extensions 先例):

```ts
          // PR-2 (2025-11-25 tasks wire):tasks 族协议 method 上线(era-gated——2026 era 客户端
          // 在 SDK 分发层即 METHOD_NOT_FOUND,无害;spec §3.2)。SDK 无 task 运行时,handler 自建。
          tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
```

3b. 4 个 handler(`setRequestHandler('tools/call', …)` 附近集中注册;import task-view/registry/audit-log):

```ts
      // ── PR-2: tasks wire(2025-11-25 词汇;字符串 method 注册,era 门控由 SDK 分发层处理)──
      this.server.setRequestHandler('tasks/get', async (request: { params?: { taskId?: string } }) => {
        const taskId = request.params?.taskId;
        if (!taskId || typeof taskId !== 'string') {
          throw new Error('tasks/get requires params.taskId');
        }
        const r = getRun(taskId);
        if (!r) throw new Error(`task not found: ${taskId}(server 可能已重启;qa report 可读落盘报告)`);
        const t = toWireTask(r);
        assertTaskWire(t);
        return t;
      });
      this.server.setRequestHandler('tasks/list', async () => {
        return { tasks: listRuns().map(r => { const t = toWireTask(r); assertTaskWire(t); return t; }) };
      });
      this.server.setRequestHandler('tasks/cancel', async (request: { params?: { taskId?: string } }) => {
        const taskId = request.params?.taskId;
        if (!taskId || typeof taskId !== 'string') throw new Error('tasks/cancel requires params.taskId');
        const r = getRun(taskId);
        if (!r) throw new Error(`task not found: ${taskId}`);
        const res = requestCancel(taskId);
        if (!res.ok) throw new Error(`cannot cancel: ${res.message}`);
        // B-3 裁定:免二次 elicitation(启动已过 confirm 门)但必须 audit 留痕(CLI auditRun 先例)
        if (isAuditEnabled()) {
          try {
            await appendAuditLine(r.project_path, {
              /* AuditEntry 字段照 src/cli/qa.ts auditRun 构造:tool:'qa',action:'tasks.cancel',
                 ok:true,risk:'process',changed_files:[],details:{run_id:taskId,via:'tasks/cancel'},
                 timestamp/trace_id 等按该先例字段名同构 */
            } as never);
          } catch { /* best-effort(与 dispatcher 审计哲学一致:失败由 catch 吞) */ }
        }
        const t = toWireTask(r);
        assertTaskWire(t);
        return t;
      });
      this.server.setRequestHandler('tasks/result', async (request: { params?: { taskId?: string } }) => {
        const taskId = request.params?.taskId;
        if (!taskId || typeof taskId !== 'string') throw new Error('tasks/result requires params.taskId');
        const r = getRun(taskId);
        if (!r) throw new Error(`task not found: ${taskId}`);
        return { payload: toTaskPayload(r) };   // working 时 toTaskPayload 抛 → SDK 转 error
      });
```

> AuditEntry 精确字段以 `src/core/audit-log.ts:46` 接口与 `src/cli/qa.ts` auditRun 构造为准(实现者照抄同构,勿臆测字段)。

3c. 终态通知注册(构造函数里,setRequestHandler 之前)+ close 清理:

```ts
      // PR-2: 终态通知——仅当客户端声明 tasks 能力时发(协议要求);best-effort。
      setTerminalNotifier((runId, status) => {
        try {
          const caps = this.server.getClientCapabilities();
          if (!caps?.tasks) return;
          const r = getRun(runId);
          if (!r) return;
          this.server.notification({
            method: 'notifications/tasks/status',
            params: { taskId: r.taskId, status, ttl: Math.round(r.ttl / 1000), createdAt: r.createdAt, lastUpdatedAt: r.lastUpdatedAt },
          } as never);
        } catch { /* best-effort */ }
      });
```

close() 里(既有清理链加一项,`setTerminalNotifier(null)`——防测试隔离泄漏)。

> `server.notification()` 方法名以 SDK 实测为准(`grep -n "notification" node_modules/@modelcontextprotocol/server/dist/*.d.cts | head`——Protocol 基类方法;若为 `sendNotification` 则用之,报告注明)。

- [ ] **Step 4:确认通过 → Step 5:Commit**

```bash
git add src/GodotServer.ts test/qa-tasks-wire.test.ts
git commit -m "feat(tasks): tasks/get|list|cancel|result wire handler + 终态通知 + cancel audit 留痕"
```

---

### Task 4:taskAugmented 链——客户端能力协商 → 自动 async + _meta.relatedTask

**Files:**
- Modify: `src/GodotServer.ts`(tools/call handler 读 client capabilities 传 dispatcher)
- Modify: `src/core/ToolDispatcher.ts`(dispatch 接受 clientTasksCapable;ctx.taskAugmented 注入;after 中间件 `_meta.relatedTask` 写回)
- Modify: `src/types.ts`(ToolContext.taskAugmented?: boolean)
- Modify: `src/tools/qa/index.ts`(ctx.taskAugmented → mode 自动 async;async 响应 result 加 `_meta.relatedTask = {taskId, status:'working'}`)
- Test: `test/qa-tasks-wire.test.ts`(追加)/ `test/qa-index.test.ts`

**Interfaces:**
- Consumes: Task 3 全部;G2 `_meta` 注入先例(`ToolDispatcher.ts:486-491`);`RELATED_TASK_META_KEY` 或结构 `{taskId, status}`(响应 `_meta.relatedTask`,spec §3.2 组件 3)。
- Produces: 声明 tasks 能力的客户端 `tools/call qa run` → 自动 async + `_meta.relatedTask`;未声明 → sync 现状。

- [ ] **Step 1:写失败测试**(追加到 qa-tasks-wire.test.ts)

```ts
describe('taskAugmented 自动 async(PR-2 Task 4)', () => {
  it('声明 tasks 能力的客户端:tools/call qa run → 立即返回 + result._meta.relatedTask.taskId = run_id;tasks/get 轮询到终态', async () => {
    // client(clientCapabilities.tasks)调 listTools 确认 qa 存在 → callTool({name:'qa', arguments:{action:'run',
    // spec:<最小套件,mock 或真?——集成测试用 GodotServer 直连时 qa run 会真跑 bridge!
    // 处理:vi.mock game-bridge/runtime(同 qa-index.test.ts 惯例)或用 sleep 步骤+auto_run:false+mock ping。
    // 按仓库集成测试既有 mock 边界处理,断言:
    // - result._meta.relatedTask.taskId 与 content JSON 里 data.run_id 一致
    // - tasks/get(taskId) 轮询至 completed
  });
  it('未声明 tasks 能力的客户端:qa run → sync 现状(无 relatedTask,响应结构同 PR-1b)', async () => {});
});
```

- [ ] **Step 2:确认失败 → Step 3:实现**

3a. `src/types.ts` ToolContext 加字段(progress 字段后):

```ts
  /** PR-2: 客户端声明 tasks 能力(tools/call task-augmented)时 true——qa run 据此自动转 async
   *  并在响应 _meta.relatedTask 回指 task。由 GodotServer tools/call handler 从
   *  server.getClientCapabilities() 读出注入(dispatcher 层拿不到 server 引用)。 */
  taskAugmented?: boolean;
```

3b. GodotServer tools/call handler(现有 `setRequestHandler('tools/call', (request, ctx) => …)` 处):调用 dispatcher 前读一次能力,随调用传入(传法按 dispatch 现有签名最小适配——新增可选参或并入 options;**推荐**:dispatcher.dispatch 已接收 srvCtx,再加一个可选布尔参 `clientTasksCapable?: boolean`,GodotServer 传 `!!this.server.getClientCapabilities()?.tasks`)。

3c. ToolDispatcher:dispatch 内(构造 perCallCtx 处)`taskAugmented: clientTasksCapable === true` 进 ctx;after 链(G2 `_meta` 注入同点)加:

```ts
          // PR-2: taskAugmented 响应回指——qa run 的 async 响应携带 _meta.relatedTask(客户端可
          // tasks/get 轮询)。G2 先例同点位;仅当工具结果显式带 relatedTask 时透传(组装见 qa/index.ts)。
          const rel = (result as ToolResult & { _meta?: Record<string, unknown> })._meta?.relatedTask;
          // (qa index 在 async 响应 result 上写 _meta.relatedTask;dispatcher 原样保留即可——
          //  若 G2 展开已透传未知 _meta 键则此处零改动,实测确认后在报告注明)
```

> 实测优先:G2 注入用 `{...__g2Meta, trace_id, duration_ms}` 展开——**未知 `_meta` 键天然透传**。若 qa/index.ts 直接在 textResult 前给 result 挂 `_meta`,则 dispatcher 零改动(3c 仅验证),实现者实测后在报告写明路径。

3d. `src/tools/qa/index.ts` handleRun:async 分流条件改 `const mode = args.mode === 'async' || ctx.taskAugmented === true ? 'async' : 'sync';`;async 返回改为带 `_meta` 的 result(类型断言放宽同 G2):

```ts
  if (mode === 'async') {
    const res = textResult(JSON.stringify({ success: true, data: { /* 既有字段 */ } }));
    (res as ToolResult & { _meta?: Record<string, unknown> })._meta = { relatedTask: { taskId: runId, status: 'working' } };
    return res;
  }
```

3e. `qa-index.test.ts` 补单测:makeCtx 加 `taskAugmented: true` → qa run(不传 mode)→ 响应 data.status==='working' 且 `_meta.relatedTask.taskId` 一致;`taskAugmented` 缺省 + mode 缺省 → sync(既有回归)。

- [ ] **Step 4:确认通过 → Step 5:Commit**

```bash
git add src/GodotServer.ts src/core/ToolDispatcher.ts src/types.ts src/tools/qa/index.ts test/qa-tasks-wire.test.ts test/qa-index.test.ts
git commit -m "feat(tasks): 客户端能力协商驱动的 taskAugmented 自动 async + _meta.relatedTask 回指"
```

---

### Task 5:era 降级路径验证(2026 era 客户端 tasks/get 被拒)

**Files:**
- Test: `test/qa-tasks-wire.test.ts`(追加)

- [ ] **Step 1:写测试**(SDK Client 构造显式指定协议版本 `2026-07-28` 不在 SUPPORTED——SDK 会拒连接。改用最小路径:直接向 server 发一条裸 JSON-RPC `tasks/get` 帧按 InMemoryTransport 可行性,或跳过并改为**单元级断言**:SUPPORTED_PROTOCOL_VERSIONS 不含 2026 字符串 + handler 注释引用——如实降级为文档断言)。

验收标准(二选一,按 InMemoryTransport 能力落):集成级——非 2025 era 协商的客户端 tasks/get 收 METHOD_NOT_FOUND;或断言级——测试锁定 `LATEST_PROTOCOL_VERSION === '2025-11-25'` 且 GodotServer 的 tasks handler 注册存在(era 免风险的 N-8 结论以 SDK 版本锁形式固化,升级 SDK 时该测试红以提醒复核)。

- [ ] **Step 2:确认通过 → Step 3:Commit**

```bash
git add test/qa-tasks-wire.test.ts
git commit -m "test(tasks): era 门控断言(SDK 分发层拒 2026 客户端 tasks/*,N-8 以版本锁固化)"
```

---

### Task 6:收尾——描述核验 + matrix + CHANGELOG + 全量门禁

**Files:**
- Modify: `CHANGELOG.md`(0.31.4 段追加 PR-2 要点)、`README.md`(v0.31.4 行追加 PR-2 要点)
- 产物: `docs/capability-matrix.{json,md}`(预期无 drift;实测确认)

- [ ] **Step 1**:qa 工具定义本批应零改动——`npm run build && npm run diff-matrix` 实测;若 qa schema 意外漂移(taskAugmented 是 ctx 层不进 schema),修到无 drift。
- [ ] **Step 2**:CHANGELOG 0.31.4 段 Added 追加一条 PR-2(协议层 tasks/get|list|cancel|result + 终态通知 + taskAugmented + makeRunId 随机后缀/error 字段);README v0.31.4 行同步追加要点。
- [ ] **Step 3**:`npm run version-check`(0.31.4 不变,B 类三件套齐——**PR-1b 教训:CHANGELOG/README 同步改**)。
- [ ] **Step 4**:全量门禁 `npm run lint && npm run build && npm test` + `npm run check:budget` 全绿贴数;e2e 回归 `GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-qa-assert-batch.test.ts`。
- [ ] **Step 5**:Commit

```bash
git add CHANGELOG.md README.md docs/capability-matrix.json docs/capability-matrix.md
git commit -m "docs(tasks): CHANGELOG/README 0.31.4 段补 PR-2 协议层要点"
```

---

## Self-Review 记录

1. **Spec 覆盖**:§3.2 组件 1 task-view(Task 2,**位置偏离 spec 的 core/ 裁定为 tools/qa/——分层约束优先**)/组件 2 capabilities+4handler+audit+通知(Task 3)/组件 3 taskAugmented(Task 4,**探测从 _meta 信令改为客户端能力协商——I-9 消解,优于 spec 原案**)/§3.3 风险三项全部预先消解(getClientCapabilities 现成/SDK 默认 2025 era/能力协商替代信令)/N-9 细粒度 capabilities(Task 3)/§3.4 改动面全对齐;顺手项 M-7/M-8(Task 1)。**无缺口**。
2. **占位符**:Task 3 Step 3b 的 AuditEntry 字段明确指示照抄 qa.ts auditRun 先例(精确到行号),Task 3 Step 1/Task 4 Step 1 测试为行为验收标准骨架(沿用前两批授权模式);其余含完整代码。
3. **类型一致性**:WireTask(Task 2 定义,Task 3 消费)、setTerminalNotifier/RunRecord.error(Task 1 定义,Task 3 消费)、ctx.taskAugmented(types.ts 定义,dispatcher 注入,qa/index 消费)。ttl 单位:registry ms / wire 秒,换算点在 toWireTask 与通知处(各一次)。
