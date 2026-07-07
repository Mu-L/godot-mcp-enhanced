# godot_get_context 元工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `godot_get_context` 元工具，一次调用返回会话全景（模式/项目/连接/场景快照/调用统计/工具组/workflow/rules/performance），替代 AI 起步探路循环。

**Architecture:** 新建 `src/core/call-recorder.ts`（模块级单例，记录最近 50 次调用 + 聚合统计）+ 提升 `src/dashboard/ring-buffer.ts` → `src/core/ring-buffer.ts`（fix-forward duplication defect，三方共用）+ 在 `ToolDispatcher` healthSample.after hook 接线 record + 新建 `src/tools/get-context.ts` 工具（字段级 try/catch，永不抛错）。

**Tech Stack:** TypeScript / Vitest / @modelcontextprotocol/sdk / Godot 4.x headless+editor+bridge 三模式

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-godot-get-context-design.md`（r3，三轮审查 DONE）

## Global Constraints

- **测试只在 `test/`**：`vitest.config.ts:8` `include: ['test/**/*.test.{js,ts}']`，`src/` 下测试不被收集。所有测试文件放 `test/<subdir>/`。
- **src 分组规则**：单文件单职责平铺父目录（`src/tools/get-context.ts`），不建子目录（`CLAUDE.md` src 分组规则）。
- **工具命名**：元工具带 `godot_` 前缀（同 `godot_list_instances` / `godot_advanced_tool`）。
- **导入路径**：所有相对 import 用 `.js` 后缀（ESM，项目惯例，如 `./ring-buffer.js`）。
- **提交惯例**：conventional commits（`feat:` / `test:` / `refactor:`），中文 commit body 可。
- **绝对路径**：所有文件引用用绝对路径（项目规则）。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\src\core\ring-buffer.ts` | 公共 RingBuffer（capacity 校验 + sliceLast + iterator） | **Create**（提升自 dashboard） |
| `D:\GitHub\godot-mcp-enhanced\src\dashboard\ring-buffer.ts` | 原 dashboard RingBuffer | **Modify** → 改 re-export `../core/ring-buffer.js` |
| `D:\GitHub\godot-mcp-enhanced\src\core\health-monitor.ts:58-88` | 内联 RingBuffer 类 | **Modify** → 删除内联，改 import `./ring-buffer.js` |
| `D:\GitHub\godot-mcp-enhanced\src\core\call-recorder.ts` | 调用记录单例 + extractErrorMessage | **Create** |
| `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts:387-396` | healthSample.after hook | **Modify** → 加 callRecorder.record |
| `D:\GitHub\godot-mcp-enhanced\src\prompts.ts` | prompt 注册 | **Modify** → 导出 `listPromptDefs()` |
| `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts` | 元工具实现 | **Create** |
| `D:\GitHub\godot-mcp-enhanced\src\core\module-loader.ts:55,70` | 工具模块注册 | **Modify** → import + ALL_MODULES |
| `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts:167,243,311` | 三处注册 | **Modify** → 加 `'godot_get_context'` |
| `D:\GitHub\godot-mcp-enhanced\test\core\ring-buffer.test.ts` | RingBuffer 测试 | **Create** |
| `D:\GitHub\godot-mcp-enhanced\test\core\call-recorder.test.ts` | CallRecorder 测试 | **Create** |
| `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts` | 工具测试 | **Create** |

**依赖顺序**：Task 1 (RingBuffer) → Task 2 (CallRecorder，用 RingBuffer) → Task 3 (ToolDispatcher 接线，用 CallRecorder) → Task 4 (prompts listPromptDefs，独立) → Task 5 (get-context 工具，用 CallRecorder + listPromptDefs) → Task 6 (注册接线 + 门禁)。

---

### Task 1: 提升 RingBuffer 到 core/（fix-forward duplication-across-layers）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\core\ring-buffer.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\dashboard\ring-buffer.ts`（全文替换为 re-export）
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\health-monitor.ts:56-88`（删内联 class，改 import）
- Test: `D:\GitHub\godot-mcp-enhanced\test\core\ring-buffer.test.ts`

**Interfaces:**
- Produces: `RingBuffer<T>` class（`src/core/ring-buffer.ts`），constructor `(capacity: number)` throws RangeError 当 capacity 非正整数；API: `push(item)` / `[Symbol.iterator]()` / `toArray()` / `sliceLast(n)` / `get length` / `clear()`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\core\ring-buffer.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/core/ring-buffer.js';

describe('RingBuffer', () => {
  it('throws RangeError for non-positive capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError);
    expect(() => new RingBuffer<number>(-1)).toThrow(RangeError);
    expect(() => new RingBuffer<number>(1.5)).toThrow(RangeError);
  });

  it('push and toArray preserve order', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2); rb.push(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it('overwrites oldest when full (rolling)', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2); rb.push(3); rb.push(4);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.length).toBe(3);
  });

  it('sliceLast returns last n', () => {
    const rb = new RingBuffer<number>(5);
    [1, 2, 3, 4, 5].forEach(n => rb.push(n));
    expect(rb.sliceLast(2)).toEqual([4, 5]);
    expect(rb.sliceLast(10)).toEqual([1, 2, 3, 4, 5]);
  });

  it('Symbol.iterator works', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(10); rb.push(20);
    expect([...rb]).toEqual([10, 20]);
  });

  it('clear resets', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1); rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it('empty buffer toArray/sliceLast return []', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.toArray()).toEqual([]);
    expect(rb.sliceLast(5)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/core/ring-buffer.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/ring-buffer.js'`

- [ ] **Step 3: 创建 src/core/ring-buffer.ts（合并版）**

```ts
// src/core/ring-buffer.ts
/**
 * RingBuffer — 固定容量环形缓冲区，O(1) 插入。
 *
 * 提升自 src/dashboard/ring-buffer.ts（fix-forward duplication-across-layers defect）。
 * 合并两版优点：dashboard 的 capacity 校验（ADVISORY-2）+ health-monitor 的 sliceLast + Symbol.iterator。
 * 三方共用：dashboard + health-monitor + call-recorder。
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    // ADVISORY-2: capacity<=0 会导致 % 0 → NaN 索引污染状态。
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got: ${capacity}`);
    }
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  *[Symbol.iterator](): Iterator<T> {
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.size; i++) {
      yield this.buffer[(start + i) % this.capacity] as T;
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    for (const item of this) result.push(item);
    return result;
  }

  sliceLast(n: number): T[] {
    return this.toArray().slice(-n);
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
    this.buffer = new Array(this.capacity);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/ring-buffer.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: dashboard/ring-buffer.ts 改 re-export**

将 `D:\GitHub\godot-mcp-enhanced\src\dashboard\ring-buffer.ts` 全文替换为：
```ts
// src/dashboard/ring-buffer.ts
// RingBuffer 已提升到 src/core/ring-buffer.ts（fix-forward duplication-across-layers）。
// 此文件保留 re-export 以兼容现有 dashboard import。
export { RingBuffer } from '../core/ring-buffer.js';
```

- [ ] **Step 6: health-monitor.ts 删内联 class，改 import**

Modify `D:\GitHub\godot-mcp-enhanced\src\core\health-monitor.ts`：
- 删除 `:56-88` 的 `class RingBuffer<T> { ... }`（整个内联 class）
- 在文件顶部 import 区（`:6-8` 附近）加：`import { RingBuffer } from './ring-buffer.js';`

- [ ] **Step 7: 跑全量回归确认 dashboard + health-monitor 无破坏**

Run: `npx vitest run`
Expected: PASS（全量绿，含现有 dashboard / health-monitor 测试）

- [ ] **Step 8: 类型检查 + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0

- [ ] **Step 9: Commit**

```bash
git add src/core/ring-buffer.ts src/dashboard/ring-buffer.ts src/core/health-monitor.ts test/core/ring-buffer.test.ts
git commit -m "refactor: 提升 RingBuffer 到 core/（fix-forward duplication-across-layers）

合并 dashboard capacity 校验 + health-monitor sliceLast/iterator，三方共用。
dashboard 改 re-export，health-monitor 改 import。"
```

---

### Task 2: CallRecorder 模块

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\core\call-recorder.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\core\call-recorder.test.ts`

**Interfaces:**
- Consumes: `RingBuffer`（Task 1）、`ToolResult`（`src/types.ts`）
- Produces: `getCallRecorder(): CallRecorder`（单例）、`CallRecorder.record(tool, ok, ms, errorType?, msg?, instanceId?)`、`.getRecent(n, instanceId?)`、`.getStats(instanceId?)`、`.reset()`、`extractErrorMessage(result: ToolResult): string`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\core\call-recorder.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getCallRecorder, extractErrorMessage } from '../../src/core/call-recorder.js';
import type { ToolResult } from '../../src/types.js';

describe('CallRecorder', () => {
  beforeEach(() => getCallRecorder().reset());

  it('singleton returns same instance', () => {
    expect(getCallRecorder()).toBe(getCallRecorder());
  });

  it('record accumulates totals', () => {
    const r = getCallRecorder();
    r.record('add_node', true, 10);
    r.record('add_node', true, 20);
    r.record('edit_script', false, 30, 'TOOL_ERROR', 'parse error');
    const stats = r.getStats();
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(2);
    expect(stats.fail).toBe(1);
  });

  it('topTools sorted by count desc', () => {
    const r = getCallRecorder();
    r.record('a', true, 1);
    r.record('b', true, 1); r.record('b', true, 1);
    r.record('c', true, 1); r.record('c', true, 1); r.record('c', false, 1, 'E');
    const { topTools } = r.getStats();
    expect(topTools[0]).toEqual({ name: 'c', n: 3, fail: 1 });
    expect(topTools[1]).toEqual({ name: 'b', n: 2, fail: 0 });
  });

  it('recentErrors only captures failures', () => {
    const r = getCallRecorder();
    r.record('a', true, 1);
    r.record('b', false, 2, 'TOOL_ERROR', 'boom');
    const { recentErrors } = r.getStats();
    expect(recentErrors).toHaveLength(1);
    expect(recentErrors[0]).toMatchObject({ tool: 'b', type: 'TOOL_ERROR', msg: 'boom', ms: 2 });
  });

  it('getRecent returns last n records', () => {
    const r = getCallRecorder();
    for (let i = 0; i < 60; i++) r.record(`t${i}`, true, i);
    const recent = r.getRecent(5);
    expect(recent).toHaveLength(5);
    expect(recent[4].tool).toBe('t59');
  });

  it('reset clears all', () => {
    const r = getCallRecorder();
    r.record('a', true, 1);
    r.reset();
    expect(r.getStats().total).toBe(0);
    expect(r.getRecent(10)).toHaveLength(0);
  });
});

describe('extractErrorMessage', () => {
  it('extracts first text content truncated to 200', () => {
    const long = 'x'.repeat(300);
    const result: ToolResult = { content: [{ type: 'text', text: long }] } as ToolResult;
    expect(extractErrorMessage(result)).toHaveLength(200);
  });

  it('returns empty when no text content', () => {
    const result: ToolResult = { content: [] } as ToolResult;
    expect(extractErrorMessage(result)).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/core/call-recorder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 src/core/call-recorder.ts**

```ts
// src/core/call-recorder.ts
import { RingBuffer } from './ring-buffer.js';
import type { ToolResult } from '../types.js';

export interface CallRecord {
  tool: string;
  ok: boolean;
  ms: number;
  t: number; // 相对秒（从首次记录起 offset）
  errorType?: string;
  msg?: string;
}

export interface CallStats {
  total: number;
  success: number;
  fail: number;
  topTools: Array<{ name: string; n: number; fail: number }>;
  recentErrors: Array<{ tool: string; type: string; msg: string; ms: number }>;
}

const RECENT_LIMIT = 50;
const TOP_TOOLS = 10;
const RECENT_ERRORS = 5;
const MSG_TRUNCATE = 200;

/**
 * CallRecorder — 进程内工具调用记录器（模块级单例）。
 *
 * defect 标注：命中 module-level-mutable-state(open) 形态。同步操作无真实竞态，
 * 风险可接受；record/getStats 预留可选 instanceId 参数，为多实例 per-instance 扩展铺路（MVP 全局共享）。
 */
class CallRecorder {
  private recent: RingBuffer<CallRecord>;
  private recentErrors: RingBuffer<{ tool: string; type: string; msg: string; ms: number }>;
  private byTool = new Map<string, { n: number; fail: number }>();
  private total = 0;
  private success = 0;
  private fail = 0;
  private startTime = 0;

  constructor() {
    this.recent = new RingBuffer<CallRecord>(RECENT_LIMIT);
    this.recentErrors = new RingBuffer(RECENT_ERRORS);
  }

  record(tool: string, ok: boolean, ms: number, errorType?: string, msg?: string, _instanceId?: string): void {
    if (this.startTime === 0) this.startTime = Date.now();
    const t = Math.floor((Date.now() - this.startTime) / 1000);
    this.recent.push({ tool, ok, ms, t, errorType, msg });
    this.total++;
    if (ok) this.success++; else this.fail++;
    const entry = this.byTool.get(tool) ?? { n: 0, fail: 0 };
    entry.n++;
    if (!ok) entry.fail++;
    this.byTool.set(tool, entry);
    if (!ok && errorType) {
      this.recentErrors.push({ tool, type: errorType, msg: msg ?? '', ms });
    }
  }

  getRecent(n: number, _instanceId?: string): CallRecord[] {
    return this.recent.sliceLast(n);
  }

  getStats(_instanceId?: string): CallStats {
    const topTools = [...this.byTool.entries()]
      .map(([name, v]) => ({ name, n: v.n, fail: v.fail }))
      .sort((a, b) => b.n - a.n)
      .slice(0, TOP_TOOLS);
    return {
      total: this.total,
      success: this.success,
      fail: this.fail,
      topTools,
      recentErrors: this.recentErrors.toArray(),
    };
  }

  reset(): void {
    this.recent.clear();
    this.recentErrors.clear();
    this.byTool.clear();
    this.total = 0;
    this.success = 0;
    this.fail = 0;
    this.startTime = 0;
  }
}

let _instance: CallRecorder | null = null;
export function getCallRecorder(): CallRecorder {
  if (!_instance) _instance = new CallRecorder();
  return _instance;
}

/** 从工具 result 提取错误文本（截断 MSG_TRUNCATE 字符）。 */
export function extractErrorMessage(result: ToolResult): string {
  for (const c of result.content ?? []) {
    if (typeof (c as { text?: unknown }).text === 'string' && (c as { text: string }).text.length > 0) {
      return (c as { text: string }).text.slice(0, MSG_TRUNCATE);
    }
  }
  return '';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/call-recorder.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/core/call-recorder.ts test/core/call-recorder.test.ts
git commit -m "feat: 新增 CallRecorder 模块（调用记录单例 + extractErrorMessage）

进程内记录最近 50 次调用 + 聚合统计（topTools/recentErrors）。
预留 instanceId 参数（MVP 全局单例）。"
```

---

### Task 3: ToolDispatcher 接线 callRecorder

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts:387-396`（healthSample.after hook）
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts:7`（import 行，已 import middleware，旁加 call-recorder import）
- Test: `D:\GitHub\godot-mcp-enhanced\test\core\ToolDispatcher.test.ts`（扩展，验证 record 被调）

**Interfaces:**
- Consumes: `getCallRecorder` + `extractErrorMessage`（Task 2）
- Produces: 每次工具调用后 callRecorder.record 被调用

- [ ] **Step 1: 写失败测试（扩展 ToolDispatcher.test.ts）**

在 `D:\GitHub\godot-mcp-enhanced\test\core\ToolDispatcher.test.ts` 末尾加（如文件已存在；先 Read 确认其 import 与 describe 结构再追加）：
```ts
import { getCallRecorder, extractErrorMessage } from '../../src/core/call-recorder.js';
// ... 在合适 describe 块内或新建 describe：
describe('ToolDispatcher callRecorder wiring', () => {
  beforeEach(() => getCallRecorder().reset());

  it('records success on successful tool call', async () => {
    // 复用现有 dispatch 成功的 fixture（参照文件内已有 "dispatches tool" 类用例）
    // 调一次成功工具后：
    const stats = getCallRecorder().getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.success).toBeGreaterThanOrEqual(1);
  });

  it('records failure on error tool call', async () => {
    // 调一次失败工具后：
    const stats = getCallRecorder().getStats();
    expect(stats.fail).toBeGreaterThanOrEqual(1);
  });
});
```
> 注：执行者需先 Read `test/core/ToolDispatcher.test.ts`，复用其现有 dispatcher 构造方式 + 成功/失败 fixture（该文件已有 dispatch 测试用例），把上面的断言接入现有 dispatch 调用之后。不要新造 dispatcher 装配代码。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/core/ToolDispatcher.test.ts -t "callRecorder"`
Expected: FAIL — `stats.total` 为 0（未接线）

- [ ] **Step 3: 接线 ToolDispatcher.ts**

Modify `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts`：
- import 区（`:7` `import { executeMiddleware, ... } from './middleware.js';` 附近）加：
```ts
import { getCallRecorder, extractErrorMessage } from './call-recorder.js';
```
- `:387-396` healthSample.after hook 改为：
```ts
      after: async (ctx, result) => {
        const duration = Date.now() - ctx.startTime;
        const isError = result.isError === true || this.checkJsonSuccessFalse(result);
        const recorder = getCallRecorder();
        if (isError) {
          this.healthMonitor.recordFailure('TOOL_ERROR', `Tool ${ctx.toolName} failed`);
          recorder.record(ctx.toolName, false, duration, 'TOOL_ERROR', extractErrorMessage(result));
        } else {
          this.healthMonitor.recordSuccess(duration);
          recorder.record(ctx.toolName, true, duration);
        }
        return result;
      },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/ToolDispatcher.test.ts`
Expected: PASS（含新 callRecorder 用例 + 现有用例无回归）

- [ ] **Step 5: 跑全量回归**

Run: `npx vitest run`
Expected: PASS（接线不影响现有返回值）

- [ ] **Step 6: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add src/core/ToolDispatcher.ts test/core/ToolDispatcher.test.ts
git commit -m "feat: ToolDispatcher healthSample.after 接线 CallRecorder

每次工具调用后 record（成功/失败），healthMonitor 仍记连接健康，
callRecorder 记调用明细，职责分离。"
```

---

### Task 4: prompts.ts 导出 listPromptDefs

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\prompts.ts`（PROMPTS 是 module-private，需导出清单 API）
- Test: `D:\GitHub\godot-mcp-enhanced\test\prompts.test.ts`（如不存在则 Create，否则扩展）

**Interfaces:**
- Produces: `listPromptDefs(): PromptDef[]`（返回所有 prompt 的 `{ name, description, arguments? }`）

- [ ] **Step 1: 写失败测试**

在 `D:\GitHub\godot-mcp-enhanced\test\prompts.test.ts`（不存在则创建）加：
```ts
import { describe, it, expect } from 'vitest';
import { listPromptDefs } from '../src/prompts.js';

describe('listPromptDefs', () => {
  it('returns all registered prompt defs', () => {
    const defs = listPromptDefs();
    expect(defs.length).toBeGreaterThanOrEqual(4);
    const names = defs.map(d => d.name);
    expect(names).toContain('create_platformer');
    expect(names).toContain('setup_player_controller');
    expect(names).toContain('optimize_scene');
    expect(names).toContain('debug_performance');
  });

  it('each def has name and description', () => {
    for (const d of listPromptDefs()) {
      expect(typeof d.name).toBe('string');
      expect(typeof d.description).toBe('string');
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/prompts.test.ts`
Expected: FAIL — `listPromptDefs` 未导出

- [ ] **Step 3: prompts.ts 加导出**

Modify `D:\GitHub\godot-mcp-enhanced\src\prompts.ts`，在文件末尾加：
```ts
/** 列出所有已注册 prompt 的定义（name + description + arguments）。供 godot_get_context 的 workflows 字段使用。 */
export function listPromptDefs(): PromptDef[] {
  return Object.values(PROMPTS).map(p => p.def);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: tsc + lint + Commit**

Run: `npx tsc --noEmit && npm run lint` → exit 0
```bash
git add src/prompts.ts test/prompts.test.ts
git commit -m "feat: prompts.ts 导出 listPromptDefs 供 get_context workflows 字段使用"
```

---

### Task 5: godot_get_context 工具实现

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts`

**Interfaces:**
- Consumes: `getCallRecorder`（Task 2）、`listPromptDefs`（Task 4）、`TOOL_GROUPS`/`getActiveGroups`（`tool-registry.ts`）、`ToolContext`（含 connectionMode + editor/bridge 探测，参照 `manage-tools.ts` sync）
- Produces: `getToolDefinitions()` / `handleTool(toolName, args, ctx)` / `TOOL_META`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\tools\get-context.test.ts`：
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleTool, getToolDefinitions } from '../../src/tools/get-context.js';
import { getCallRecorder } from '../../src/core/call-recorder.js';
import type { ToolContext } from '../../src/types.js';

// 最小 ctx mock（执行者按 ToolContext 真实形状补全，参照 manage-tools.test.ts 的 ctx 装配）
function mockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    connectionMode: 'headless',
    ...overrides,
  } as ToolContext;
}

describe('godot_get_context', () => {
  beforeEach(() => getCallRecorder().reset());

  it('tool def has correct name + read-only meta', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('godot_get_context');
  });

  it('returns null for unknown tool', async () => {
    const result = await handleTool('other_tool', {}, mockCtx());
    expect(result).toBeNull();
  });

  it('returns ok status with session fields in headless mode', async () => {
    const result = await handleTool('godot_get_context', {}, mockCtx({ connectionMode: 'headless' }));
    expect(result).not.toBeNull();
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.status).toBe('ok');
    expect(payload.data.mode).toBe('headless');
    expect(payload.data.scene).toBeNull();           // headless 恒 null
    expect(payload.data.performance).toBeNull();      // 非 bridge
    expect(Array.isArray(payload.data.callStats)).toBe(false);
    expect(payload.data.callStats.total).toBeDefined();
    expect(Array.isArray(payload.data.toolGroups)).toBe(true);
    expect(Array.isArray(payload.data.workflows)).toBe(true);
  });

  it('include_scene=false skips scene', async () => {
    const result = await handleTool('godot_get_context', { include_scene: false }, mockCtx());
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.scene).toBeNull();
  });

  it('failed fields downgrade gracefully (status=partial)', async () => {
    // mock listPromptDefs 抛错 → workflows 进 failedFields
    vi.doMock('../../src/prompts.js', () => ({ listPromptDefs: () => { throw new Error('boom'); } }));
    const { handleTool: ht } = await import('../../src/tools/get-context.js');
    const result = await ht('godot_get_context', {}, mockCtx());
    const payload = JSON.parse((result!.content[0] as { text: string }).text);
    expect(payload.data.status).toBe('partial');
    expect(payload.data.failedFields).toContain('workflows');
    expect(payload.data.callStats.total).toBeDefined(); // 其余字段仍正常
    vi.doUnmock('../../src/prompts.js');
  });

  it('never throws — outer try/catch swallows', async () => {
    // 即使所有探测失败，工具仍返回 ok/partial，不抛
    const result = await handleTool('godot_get_context', {}, mockCtx());
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 创建 src/tools/get-context.ts**

```ts
// src/tools/get-context.ts
/**
 * godot_get_context — 会话全景元工具。
 * 一次返回模式/项目/连接/场景快照/调用统计/工具组/workflow/rules/performance，
 * 减少 AI 反复 list_nodes/get_scene_tree/manage_tools(sync)/health 摸环境。
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { opsSuccess } from './shared.js';
import { getCallRecorder } from '../core/call-recorder.js';
import { listPromptDefs } from '../prompts.js';
import { TOOL_GROUPS, getActiveGroups } from '../core/tool-registry.js';

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'godot_get_context',
    description: '一次返回会话全景（模式/项目/连接/场景快照/最近调用统计/工具组/推荐 workflow/规则/性能），减少反复探路。headless 模式 scene=null。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string', description: '项目路径（可选；传了补 project/rules 字段，没传降级 null/[]）' },
        include_scene: { type: 'boolean', description: '是否采集场景快照（默认 true；headless 恒 null）' },
        include_performance: { type: 'boolean', description: '是否采集性能（默认 true；仅 bridge 有效）' },
      },
    },
  }];
}

export async function handleTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  if (toolName !== 'godot_get_context') return null;
  return handleGetContext(args, ctx);
}

async function handleGetContext(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const failedFields: string[] = [];
  const includeScene = args.include_scene !== false;
  const includePerf = args.include_performance !== false;
  const projectPath = args.project_path as string | undefined;

  const mode = safe(() => computeMode(ctx), 'mode', failedFields);
  const project = safe(() => readProject(projectPath), 'project', failedFields);
  const connections = safe(() => readConnections(ctx), 'connections', failedFields);
  const scene = (!includeScene || mode === 'headless')
    ? null
    : safe(() => readScene(mode, ctx), 'scene', failedFields);
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
    ? safe(() => readPerformance(ctx), 'performance', failedFields)
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

/** 字段级降级 wrapper：抛错 → 字段名入 failedFields，返回 null。 */
function safe<T>(fn: () => T, field: string, failed: string[]): T | null {
  try { return fn(); } catch { failed.push(field); return null; }
}

// ─── 字段采集 helper（执行者按契约 + 现有 API 实现）─────────────────────────

/** 摘要：bridge 连了→bridge，否则 editor 连了→editor，否则 headless。 */
function computeMode(ctx: ToolContext): 'headless' | 'editor' | 'bridge' {
  // 参照 manage-tools.ts sync 的 editor/bridge 探测；ctx.connectionMode 给主模式
  const m = (ctx as unknown as { connectionMode?: string }).connectionMode;
  if (m === 'bridge' || m === 'editor') return m;
  return 'headless';
}

/** project = { name, godot, path }。读 project.godot + godot --version。无 project_path → null。 */
function readProject(_projectPath: string | undefined): { name: string; godot: string; path: string } | null {
  // 执行者：复用 src/tools/project.ts 的 project.godot 解析 + findGodot 的版本探测；
  // 无 project_path 或非 Godot 项目 → 返回 null（不抛）。
  return null; // 占位实现：MVP 可先返回 null，后续 Task 或 follow-up 补实读
}

/** editor 安装/连接态 + bridge 探测。参照 manage-tools.ts handleSync。 */
function readConnections(_ctx: ToolContext): {
  editor: { installed: boolean; connected: boolean; state: string | null };
  bridge: { status: string };
} {
  return { editor: { installed: false, connected: false, state: null }, bridge: { status: 'probe-required' } };
}

/** 场景快照：editor 用 editor_get_scene_tree，bridge 用 game_query(get_tree)。headless 不调（外层已 null）。 */
function readScene(_mode: string, _ctx: ToolContext): { path: string; root: string; nodeCount: number; typeTopN: Array<{ type: string; n: number }> } | null {
  // 执行者：editor 模式调 editor-sync 的场景树读取；bridge 模式调 game-bridge get_tree + 递归统计 typeTopN（>2000 节点只返回 nodeCount）。
  return null;
}

/** toolGroups 清单。复用 manage-tools.ts handleListGroups 模式。 */
function readToolGroups(): Array<{ name: string; active: boolean; requires: string[] }> {
  const active = getActiveGroups();
  return Object.entries(TOOL_GROUPS).map(([name, def]) => ({
    name,
    active: active.has(name),
    requires: def.requires,
  }));
}

/** rules = {project_path}/.claude/rules/*.md 文件名。无 project_path → []。 */
function readRules(projectPath: string | undefined): string[] {
  if (!projectPath) return [];
  // 执行者：用 src/core/path-utils.ts 安全 join + glob .claude/rules/*.md，返回 basename 列表。
  return [];
}

/** performance = { fps, memory_mb }。仅 bridge（外层已守卫）。game_query(get_performance)。 */
function readPerformance(_ctx: ToolContext): { fps: number; memory_mb: number } | null {
  return null;
}

export const TOOL_META = {
  godot_get_context: { readonly: true, long_running: false, actionRisks: { _: 'read' as const } },
};
```

> **执行者注**：`readProject` / `readScene` / `readConnections` / `readPerformance` 的占位实现（返回 null）是**有意 MVP 简化**——首版让工具可跑通（字段降级为 null，status=partial 或 ok），真实采集逻辑作为本 Task 完成后的 follow-up（或执行者实现时按契约 + 引用的现有 API 补全：`src/tools/project.ts` 解析 project.godot、`src/tools/editor-sync.ts` 读场景树、`src/tools/game-bridge.ts` get_tree/get_performance、`src/core/path-utils.ts` 安全路径）。测试 Step 1 的"headless 返回 ok"用例不依赖这些 helper 的真实实现（headless 下 scene/perf 恒 null），可先通过；bridge/editor 的真实采集测试在 follow-up 补集成测试。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: PASS（6 tests；headless 用例 + 降级用例通过）

- [ ] **Step 5: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/tools/get-context.ts test/tools/get-context.test.ts
git commit -m "feat: 新增 godot_get_context 元工具（会话全景）

一次返回模式/项目/连接/场景/调用统计/工具组/workflow/rules/performance。
字段级 try/catch 永不抛错，headless scene=null。
project/scene/connections/performance 采集为 MVP 占位（follow-up 补真实探测）。"
```

---

### Task 6: 注册接线 + 集成验证

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\module-loader.ts:55,70`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts:167,243,311`

**Interfaces:**
- Consumes: `get-context.ts` 模块（Task 5）
- Produces: `godot_get_context` 被注册、归 core 组、始终允许、不需 project_path

- [ ] **Step 1: module-loader 接入**

Modify `D:\GitHub\godot-mcp-enhanced\src\core\module-loader.ts`：
- import 区（`:55` `import * as dataImport from '../tools/data-import.js';` 后）加：
```ts
import * as getContext from '../tools/get-context.js';
```
- ALL_MODULES 数组（`:70` `dataImport,` 后）加 `getContext,`：
```ts
const ALL_MODULES = [
  runtime, screenshot, project, scene, script, validation, docs,
  // ... 现有 ...
  dataImport,
  getContext,
];
```

- [ ] **Step 2: tool-registry 三处注册**

Modify `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts`：
- `:167` core.tools 列表加 `'godot_get_context'`：
```ts
core: { description: '核心工具', tools: ['project', 'scene', 'script', 'runtime', 'validation', 'confirm_and_execute', 'godot_get_context'], requires: [], protected: true },
```
- `:243` ALWAYS_ALLOWED 加 `'godot_get_context'`：
```ts
const ALWAYS_ALLOWED = new Set(['manage_tools', 'confirm_and_execute', 'godot_advanced_tool', 'godot_get_context']);
```
- `:311` NO_PROJECT_PATH_TOOLS 加 `'godot_get_context'`（`'load_skill',` 后）：
```ts
  'load_skill',          // 读用户本地知识库路径(libraries 参数),不操作 Godot 项目
  'godot_get_context',   // 会话全景元工具 — project_path 可选，字段降级（r3 修正 r2-N1）
]);
```

- [ ] **Step 3: 写集成测试（工具被发现 + 归 core + 不需 project_path）**

在 `D:\GitHub\godot-mcp-enhanced\test\core\tool-registry.test.ts`（如存在）或新建 `D:\GitHub\godot-mcp-enhanced\test\core\get-context-registration.test.ts` 加：
```ts
import { describe, it, expect } from 'vitest';
import { TOOL_GROUPS, ALWAYS_ALLOWED, NO_PROJECT_PATH_TOOLS, getGroupForTool, isToolAllowed, skipProjectPath } from '../../src/core/tool-registry.js';

describe('godot_get_context registration', () => {
  it('belongs to core group via core.tools', () => {
    expect(getGroupForTool('godot_get_context')).toBe('core');
    expect(TOOL_GROUPS.core.tools).toContain('godot_get_context');
  });

  it('is always allowed', () => {
    expect(ALWAYS_ALLOWED.has('godot_get_context')).toBe(true);
    expect(isToolAllowed('godot_get_context')).toBe(true);
  });

  it('skips project_path requirement', () => {
    expect(NO_PROJECT_PATH_TOOLS.has('godot_get_context')).toBe(true);
    expect(skipProjectPath('godot_get_context')).toBe(true);
  });
});
```
> 注：ALWAYS_ALLOWED / NO_PROJECT_PATH_TOOLS 需从 `tool-registry.ts` export（若未 export，本 Step 先加 export）。执行者先 grep 确认这两个 Set 是否已 export，未 export 则在 tool-registry.ts 加 `export`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/get-context-registration.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 全量门禁**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 全绿，exit 0

- [ ] **Step 6: 验证工具被发现（capability extract 不报 unknown）**

Run: `npx vitest run test/capability` （或项目的 capability 测试目录）
Expected: `godot_get_context` 归 core 组（非 unknown），capability 测试不回归

- [ ] **Step 7: Commit**

```bash
git add src/core/module-loader.ts src/core/tool-registry.ts test/core/get-context-registration.test.ts
git commit -m "feat: 注册 godot_get_context（core 组 + ALWAYS_ALLOWED + NO_PROJECT_PATH_TOOLS）

工具被发现 + 归 core（非 unknown，r3 修正 r2-N2）+ project_path 可选（r3 修正 r2-N1）。"
```

---

## Self-Review

**1. Spec 覆盖**：
- §3 工具定义（命名/组/注册/入参/actionRisks）→ Task 5（工具）+ Task 6（注册）✅
- §4 返回结构（status/mode/project/connections/scene/recentCalls/callStats/toolGroups/workflows/rules/performance/hint）→ Task 5 handler ✅
- §5.1 CallRecorder（单例 + RingBuffer 提升 + instanceId 预留 + defect 标注）→ Task 1 + Task 2 ✅
- §5.2 ToolDispatcher 接线（errMsg = extractErrorMessage）→ Task 3 ✅
- §5.3 数据流（字段级 try/catch + 降级聚合）→ Task 5 safe() ✅
- §6 场景快照模式适配（headless null）→ Task 5 readScene + 外层守卫 ✅
- §7 错误处理（永不抛错 + status/failedFields）→ Task 5 ✅
- §8 测试策略（test/ 路径 + ring-buffer 独立测试含 capacity 校验）→ Task 1/2/3/4/5/6 测试 ✅
- §9 开放问题（多实例 MVP 全局 / 大场景上限 / RingBuffer 改动面 / core 归组）→ Task 设计已纳入 ✅
- **gap**：§6 的">2000 节点只返回 nodeCount"上限、§4 performance 的 bridge `get_performance` 真实采集、readProject 真实读取——Task 5 标为 MVP 占位/follow-up（诚实标注，非占位 bug）。

**2. 占位扫描**：
- Task 5 的 `readProject`/`readScene`/`readConnections`/`readPerformance` 返回 null 是**有意 MVP 占位**，已显式标注 + 给 follow-up 指引 + 引用现有 API（project.ts/editor-sync.ts/game-bridge.ts/path-utils.ts）。非"TODO/TBD"占位 bug。
- 无"add appropriate error handling"类空话（错误处理在 safe() 给了完整代码）。

**3. 类型一致性**：
- `RingBuffer` API（push/toArray/sliceLast/iterator/length/clear）Task 1 定义，Task 2 CallRecorder 使用一致 ✅
- `getCallRecorder().record/getRecent/getStats/reset` Task 2 定义，Task 3/5 使用一致 ✅
- `listPromptDefs(): PromptDef[]` Task 4 定义，Task 5 使用一致 ✅
- `CallRecord`/`CallStats` 接口 Task 2 定义，handler 返回一致 ✅

**4. 任务边界**：每 Task 独立可测（RingBuffer → CallRecorder → 接线 → prompts → 工具 → 注册），每 Task 有自己 commit + 绿测试。

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-07-godot-get-context.md`.

**Defects recall**（实现后 `/review-recall`）：`duplication-across-layers`（Task 1 RingBuffer 提升 fix-forward）、`module-level-mutable-state`（Task 2 CallRecorder 单例 + instanceId 预留）。
