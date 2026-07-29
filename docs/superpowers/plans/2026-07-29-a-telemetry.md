# A-telemetry Implementation Plan（A 批次 telemetry 子序列）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 修 A 安全批次的 telemetry 2 条 P1（T1 error_category 泄漏 PII + T2 opt-out 仍创建 UUID），为 Stage 1 接 telemetry endpoint 扫清前置阻塞。

**Architecture:** 两 finding 都在 `ToolDispatcher` telemetry after-hook（`:462-474`）。T1 改 error_category 为固定枚举（不让原始错误文本进字段）+ 删因此废弃的 safeErrorCategory；T2 加 isTelemetryEnabled 前置守卫堵参数求值期副作用。各补 defects.ts detect 防复发。

**Tech Stack:** TypeScript、vitest、ToolDispatcher middleware、telemetry 模块。

## Global Constraints

- master 不 push（[[user-prefers-local-ahead-no-push]]）
- 门禁：`tsc` 0 / `eslint` 0 err / `vitest` 全量 passed（4 pre-existing T11 baseline 须确认非回归）
- TDD：RED（写失败测试看真失败）→ GREEN（最小实现）→ commit
- 每条修后补 `test/regression/defects.ts` detect（静态 grep 防复发，参考现有 detect 格式如 `:618`）
- YAGNI：T1 放弃从错误文本推断分类（result 无结构化 code，关键词推断主观；Stage 0 不发，分类需求未证；Stage 1 要分类时再加 categorizeError）

## 前置勘察（已做，锁死事实）

- `safeErrorCategory` 仅 `ToolDispatcher:470` 调用（+ `:37` import + `telemetry/index.ts:3` 导出 + `sanitize.ts:12-17` 定义）→ T1 修后可删
- `extractErrorMessage`（call-recorder.ts:99）仍被 `ToolDispatcher:448` recorder.record 用（**本地记录**，经 sanitizeMsg，不外传）→ T1 不删 extractErrorMessage，只改 telemetry 调用
- `sanitizeMsg`（logger.ts:129）只脱敏 sensitive KV（password/secret/...）+ truncate，**不移除路径** → 不能用它修 T1（报告3「先过 sanitizeMsg」方案无效）
- `isTelemetryEnabled`（config.ts:20）已存在，`telemetry/index.ts` 未导出它 → T2 须从 `../telemetry/config.js` import 或加 index 导出

## File Structure

- Modify: `src/core/ToolDispatcher.ts:470`（T1 改 error_category）+ `:462`（T2 加守卫）+ `:37`（T1 import 去 safeErrorcategory，T2 加 isTelemetryEnabled）
- Modify: `src/telemetry/sanitize.ts:12-17`（T1 删 safeErrorCategory）
- Modify: `src/telemetry/index.ts:3`（T1 删 safeErrorCategory 导出；T2 可选加 isTelemetryEnabled 导出）
- Test: 现有 `test/core/ToolDispatcher.test.ts`（加 T1/T2 用例）或新建 telemetry after-hook 测试
- Modify: `test/regression/defects.ts`（T1/T2 各补 detect）

---

### Task 1: T1 — error_category 改固定枚举，删 safeErrorCategory

**Files:**
- Modify: `src/core/ToolDispatcher.ts:37,470`
- Modify: `src/telemetry/sanitize.ts:12-17`
- Modify: `src/telemetry/index.ts:3`
- Test: `test/core/ToolDispatcher.test.ts`（加用例，参考其现有 middleware 测试模式）

**Interfaces:**
- Consumes: `extractErrorMessage`（仍用于 :448 recorder，本地）—— T1 **不动** :448
- Produces: after-hook error_category 固定 `'TOOL_ERROR'`（后续 Stage 1 接 endpoint 时此字段零 PII）

- [ ] **Step 1: 写失败测试（error_category 不含路径）**

在 `test/core/ToolDispatcher.test.ts` 加用例（参考现有 telemetry/after-hook 测试的 spy 模式；若文件无 after-hook 测试先 grep `recordTelemetry\|telemetry` 看现有怎么触发，必要时 vi.mock 或 spyOn `recordTelemetry`）：

```ts
it('T1: telemetry error_category 固定 TOOL_ERROR，不含原始错误文本/路径', async () => {
  // 构造失败 ToolResult，content text 含路径（模拟 PII）
  const failingResult: ToolResult = {
    isError: true,
    content: [{ type: 'text', text: '{"success":false,"error":"Failed to load /home/wgt/secret/Main.tscn"}' }],
  };
  const recorded = vi.fn();
  vi.mock('../../src/telemetry/index.js', () => ({
    record: (e: { error_category?: string }) => recorded(e),
    hashProject: () => 'deadbeef',
  }));
  // 触发 after-hook（经 ToolDispatcher middleware 或直接调，适配现有测试装配）
  // ... 参考文件现有 telemetry 测试的触发方式 ...
  expect(recorded).toHaveBeenCalled();
  const evt = recorded.mock.calls[0][0];
  expect(evt.error_category).toBe('TOOL_ERROR');
  // 反假绿：确认路径片段不入字段
  expect(JSON.stringify(evt)).not.toMatch(/home|wgt|secret|tscn/i);
});
```

注：若 `recordTelemetry` 经 `hashProject(ctx.args.project_path)` 求值，测试要提供 `ctx.args.project_path`（字符串）避免 hashProject 报错。

- [ ] **Step 2: 跑测试看 RED**

Run: `npx vitest run test/core/ToolDispatcher.test.ts -t "T1"`
Expected: FAIL（当前 error_category 是 `safeErrorCategory(extractErrorMessage(result))` → 含路径片段如 `Failed_to_load__home_wgt_...`，断言 `toBe('TOOL_ERROR')` 红）

- [ ] **Step 3: 改 :470 为固定枚举**

`src/core/ToolDispatcher.ts:470`：
```ts
// 旧:
error_category: isError ? safeErrorCategory(extractErrorMessage(result) || 'TOOL_ERROR') : undefined,
// 新（T1: 固定枚举，原始错误文本绝不入 telemetry 字段——result 无结构化 code，文本含路径/项目名 PII）:
error_category: isError ? 'TOOL_ERROR' : undefined,
```

- [ ] **Step 4: 删废弃的 safeErrorCategory（3 处）**

1. `src/core/ToolDispatcher.ts:37` import 去 safeErrorCategory（保留 record/hashProject）：
```ts
import { record as recordTelemetry, hashProject } from '../telemetry/index.js';
```
2. `src/telemetry/index.ts:3` 去 safeErrorCategory 导出：
```ts
export { hashProject, sanitizeVersion } from './sanitize.js';
```
3. `src/telemetry/sanitize.ts:12-17` 删整个 safeErrorCategory 函数。

- [ ] **Step 5: 跑测试看 GREEN + tsc**

Run: `npx vitest run test/core/ToolDispatcher.test.ts -t "T1" && npx tsc --noEmit`
Expected: T1 PASS + tsc 0（确认删 safeErrorCategory 无残留引用）

- [ ] **Step 6: 补 defects.ts detect**

`test/regression/defects.ts` 加 detect（参考 `:618` rce-script-branch detect 格式）：
- id: `telemetry-error-category-pii-leak`
- detect: grep `ToolDispatcher.ts` 的 telemetry error_category 行，确认是 `'TOOL_ERROR'` 固定枚举**且不含** `extractErrorMessage`/`safeErrorCategory`（防回退到文本路径）。例：`/error_category:\s*isError\s*\?\s*['"]TOOL_ERROR['"]/.test(line) && !/extractErrorMessage|safeErrorCategory/.test(line)`
- status: FIXED，baseline 1→0

- [ ] **Step 7: Commit**

```bash
git add src/core/ToolDispatcher.ts src/telemetry/sanitize.ts src/telemetry/index.ts test/core/ToolDispatcher.test.ts test/regression/defects.ts
git commit -m "fix(telemetry): T1 error_category 改固定 TOOL_ERROR 枚举（堵 PII 泄漏）+ 删 safeErrorCategory"
```

---

### Task 2: T2 — after-hook 加 isTelemetryEnabled 前置守卫

**Files:**
- Modify: `src/core/ToolDispatcher.ts:462`（after-hook 第一行加守卫）+ `:37`（import isTelemetryEnabled）
- Test: `test/core/ToolDispatcher.test.ts`

**Interfaces:**
- Consumes: `isTelemetryEnabled`（`src/telemetry/config.ts:20`）
- Produces: opt-out（默认）下 after-hook 不触发 hashProject→getInstallUUID→写 telemetry-uuid.txt

- [ ] **Step 1: 写失败测试（opt-out 不创建 UUID 文件 / 不触发 hashProject）**

```ts
it('T2: opt-out（isTelemetryEnabled=false）时 after-hook 不触发 hashProject/record（堵 telemetry-uuid.txt 创建）', async () => {
  // stubEnv 使 isTelemetryEnabled 返 false（CI 强制 false，或 FEATURES.TELEMETRY 未设）
  vi.stubEnv('CI', 'true');  // isTelemetryEnabled: CI===true → false（config.ts:21）
  const hashSpy = vi.fn();
  vi.mock('../../src/telemetry/index.js', () => ({
    record: () => {},
    hashProject: () => { hashSpy(); return 'deadbeef'; },
  }));
  const result: ToolResult = { isError: false, content: [{ type: 'text', text: '{}' }] };
  // 触发 after-hook（ctx.args.project_path 为字符串，会触发 hashProject 求值——除非守卫拦截）
  // ... 适配现有装配 ...
  expect(hashSpy, 'opt-out 时 hashProject 不应被调用（守卫在前）').not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
```

- [ ] **Step 2: 跑测试看 RED**

Run: `npx vitest run test/core/ToolDispatcher.test.ts -t "T2"`
Expected: FAIL（当前 after-hook 无守卫，hashProject 在参数求值期被调 → hashSpy 被调 → 断言 not-called 红）

- [ ] **Step 3: 加守卫 + import**

`src/core/ToolDispatcher.ts:37` 加 import（从 config.js，或先在 index.ts 加导出）：
```ts
import { isTelemetryEnabled } from '../telemetry/config.js';
```
`src/core/ToolDispatcher.ts:462` after-hook 第一行（在构造 recordTelemetry 参数**之前**）：
```ts
after: async (ctx, result) => {
  if (!isTelemetryEnabled()) return result;  // T2: opt-out 前置守卫——堵 hashProject/getInstallUUID 参数求值期创建 telemetry-uuid.txt（[[feature-gate-inside-callee-defeated-by-arg-eval]]）
  // ...原 after-hook 逻辑（isError 判定 + recordTelemetry）...
```

- [ ] **Step 4: 跑测试看 GREEN + 全量**

Run: `npx vitest run test/core/ToolDispatcher.test.ts -t "T2" && npx vitest run test/core/ToolDispatcher.test.ts`
Expected: T2 PASS + 整文件无回归

- [ ] **Step 5: 补 defects.ts detect**

`test/regression/defects.ts` 加 detect：
- id: `telemetry-afterhook-no-optout-guard`
- detect: grep `ToolDispatcher.ts` after-hook 块含 `isTelemetryEnabled` 守卫（在 recordTelemetry 之前）。例：确认 after-hook 函数体内 `if (!isTelemetryEnabled())` 出现在 `recordTelemetry(` 之前（位置契约，参 `godot-server-degrade.test.ts:27-34` 的 indexOf 位置检测模式）
- status: FIXED

- [ ] **Step 6: Commit**

```bash
git add src/core/ToolDispatcher.ts test/core/ToolDispatcher.test.ts test/regression/defects.ts
git commit -m "fix(telemetry): T2 after-hook 加 isTelemetryEnabled 前置守卫（堵 opt-out 创建 telemetry-uuid.txt）"
```

---

## Self-Review

**1. Spec coverage**：T1（error_category PII）→ Task 1 ✓；T2（opt-out UUID）→ Task 2 ✓。报告3 telemetry 2 条全覆盖。RCE 6 条不在本 plan（后续 plan 周期）。

**2. Placeholder scan**：Task 1/2 Step 1 测试的「触发 after-hook」标注「参考现有装配」——因 `test/core/ToolDispatcher.test.ts` 的 middleware 触发方式未在本轮勘察中确认，implementer 须先 grep 该文件的 `recordTelemetry|telemetry|after` 看现有触发模式（mock/spy/实例化）。这是执行时核实（类 A0 spike），非偷懒占位——修复代码（Step 3-4）完整。

**3. Type consistency**：T1 删 safeErrorCategory 后，确认无其他文件 import 它（勘察已证仅 ToolDispatcher:470）。T2 isTelemetryEnabled 从 config.js import（config.ts:20 导出）。error_category 类型 `string | undefined` 不变（值从动态改固定 'TOOL_ERROR'）。

**4. 风险**：T1 删 safeErrorCategory 跨 3 文件，须 tsc 确认无残留引用（Step 5）。T2 守卫在 recordTelemetry 前，不影响 recorder（:448 本地记录，独立）。
