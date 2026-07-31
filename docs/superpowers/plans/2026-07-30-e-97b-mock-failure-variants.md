# E-97b mock failure 变体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 data-import 工具补 executeGdscriptTrusted 的 3 类 failure 变体（compile_error/run_error/timeout），覆盖 data-import.ts:392-397 显式 failure 分支 + timeout 冒泡（当前固定 happy mock 从未触发，假绿）。

**Architecture:** 在 `test/tools/data-import.test.ts` 加一个 failure describe，per-it `mockResolvedValueOnce`/`mockRejectedValueOnce` 覆盖 `executeGdscriptTrusted`（:16 固定 happy mock 作默认），3 个 it 分别验证 compile_error/run_error 返 `SCRIPT_EXEC_FAILED` + timeout 干净冒泡（rejects.toThrow）。不改 src/。

**Tech Stack:** TypeScript + Vitest（vi.mock/vi.mocked/mocksResolvedValueOnce）。

**Spec:** `docs/superpowers/specs/2026-07-30-e-97b-mock-failure-variants-design.md`（commit 02cbcec）

## Global Constraints

- 工作仓库 `D:\GitHub\godot-mcp-enhanced`；master 本地 commit 不 push。
- 仅改 `test/tools/data-import.test.ts`（加 failure describe）。不改 src/、package.json、ci.yml。
- mock 对象：`executeGdscriptTrusted`（data-import.ts:239 `import { executeGdscriptTrusted as executeGdscript }` 别名；test :16 mock executeGdscriptTrusted 一致）。
- 调用方式：`handleTool('csv_to_resources', args, ctx)`（对齐现有 8 处 + delivery.test.js:679，**非 callTool**）。
- timeout 断言：`rejects.toThrow(/timed out/)`（确定结论——csvToResources try(:381)/finally(:414) 无 catch + handleTool :296 不包 try/catch + A1 :407 rejects.toThrow 先例 → executeGdscriptTrusted reject 干净冒泡）。
- 改测试后 `npm test`（pretest 钩子强制 build，E-P1 Task2）。
- 核实驱动（[[plan-baseline-verify-grep]][[verify-implementation-by-source]]）：data-import.ts 分支行号 + mock 对象改动前核实。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `test/tools/data-import.test.ts` | 加 failure 变体 describe（3 it） | Modify（文件末尾追加 describe） |

---

## Task 1: data-import failure 变体（compile_error / run_error / timeout）

**Files:**
- Modify: `test/tools/data-import.test.ts`（文件末尾追加 failure describe）

**Interfaces:**
- Consumes: `handleTool` / `executeGdscriptTrusted`（已 import，I1 :434 先例）/ `ToolContext`（已 import）；data-import.ts:392-397 分支（`!compile_success → opsErrorResult('SCRIPT_EXEC_FAILED', compile_error)` / `!run_success → opsErrorResult('SCRIPT_EXEC_FAILED', run_error)`）
- Produces: 无（纯测试追加，不改 src/，无下游依赖）

**现状基线（git HEAD 02cbcec，改动前核实）：**
- `data-import.test.ts:16` 固定 happy mock `executeGdscriptTrusted: vi.fn().mockResolvedValue({ compile_success:true, run_success:true, outputs:[...] })`
- data-import.ts:392-397 failure 分支从未触发（happy mock 永远 success）

- [ ] **Step 1: 跑基线计数**

Run: `npx vitest run test/tools/data-import.test.ts 2>&1 | tail -3`
Expected: 记录 passed 数（基线，重构后须 +3）。

- [ ] **Step 2: 追加 failure describe（3 it）**

在 `test/tools/data-import.test.ts` 文件末尾（最后一个 describe `});` 之后）追加：

```ts

// ─── :97b executeGdscriptTrusted failure 变体（覆盖 data-import.ts:392-397 + timeout 冒泡）──
// 现有 mock :16 固定 happy（compile_success:true, run_success:true），failure 分支零触发（假绿）。
// per-it mockResolvedValueOnce/mockRejectedValueOnce 覆盖单次，不破坏 happy 默认。
describe('csv_to_resources executeGdscriptTrusted failure 变体（:97b）', () => {
  const makeValidArgs = (overrides: Record<string, unknown> = {}) => ({
    action: 'csv_to_resources',
    project_path: tmpdir(),
    class_path: 'res://r.gd',
    output_dir: 'out',
    filename_column: 'id',
    csv_content: 'id,name\n1,a\n',
    ...overrides,
  });
  const makeCtx = (): ToolContext =>
    ({ findGodot: async () => 'godot', projectDir: tmpdir() } as unknown as ToolContext);

  beforeEach(() => { vi.clearAllMocks(); });

  it('compile_error → SCRIPT_EXEC_FAILED（data-import.ts:392-393 !compile_success 分支）', async () => {
    vi.mocked(executeGdscriptTrusted).mockResolvedValueOnce({
      success: false, compile_success: false, compile_error: 'GDScript parse error: unterminated string',
      errors: [], run_success: false, run_error: '', outputs: [], raw_output: '', duration_ms: 0, autoload_detected: [],
    });
    const r = await handleTool('csv_to_resources', makeValidArgs(), makeCtx()) as unknown as
      { content: { type: string; text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.error_code).toBe('SCRIPT_EXEC_FAILED');
    expect(parsed.error).toContain('parse error');
  });

  it('run_error → SCRIPT_EXEC_FAILED（data-import.ts:395-396 !run_success 分支）', async () => {
    vi.mocked(executeGdscriptTrusted).mockResolvedValueOnce({
      success: false, compile_success: true, compile_error: '', errors: [],
      run_success: false, run_error: 'runtime crash: null instance', outputs: [], raw_output: '', duration_ms: 0, autoload_detected: [],
    });
    const r = await handleTool('csv_to_resources', makeValidArgs(), makeCtx()) as unknown as
      { content: { type: string; text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.error_code).toBe('SCRIPT_EXEC_FAILED');
    expect(parsed.error).toContain('runtime crash');
  });

  it('timeout → rejects（executeGdscriptTrusted reject 干净冒泡，对齐 A1 :407 rejects.toThrow 先例）', async () => {
    vi.mocked(executeGdscriptTrusted).mockRejectedValueOnce(new Error('Godot process timed out after 60s'));
    await expect(handleTool('csv_to_resources', makeValidArgs(), makeCtx())).rejects.toThrow(/timed out/);
  });
});
```

**关键判据（GREEN 验证 failure 分支正确）：**
- compile_error/run_error it：`mockResolvedValueOnce` 返 failure → data-import.ts:392/395 分支返 `opsErrorResult('SCRIPT_EXEC_FAILED', ...)` → `r.isError===true` + parsed.error_code==='SCRIPT_EXEC_FAILED' + error 含 compile/run 错误。**若红**：data-import.ts failure 处理有 bug（如分支条件错），修 src（但 spec 核实 :392-397 已实现，预期绿）。
- timeout it：`mockRejectedValueOnce` → reject 经 try/finally 干净冒泡 → `rejects.toThrow(/timed out/)`。**若红**：data-import 有外层 catch 吞异常（spec 核实无，:407 先例证，预期绿）。

- [ ] **Step 3: 跑 data-import.test.ts 确认 +3 it 绿**

Run: `npx vitest run test/tools/data-import.test.ts 2>&1 | tail -3`
Expected: passed == 基线 + 3，0 failed。

- [ ] **Step 4: commit**

```bash
git add test/tools/data-import.test.ts
git commit -m "test(data-import): E-97b executeGdscriptTrusted failure 变体（compile/run/timeout）"
```

---

## Task 2: 全量验证 + final review + 待办回标

**Files:** 无新改动，验证整支。

- [ ] **Step 1: 全量 vitest**

Run: `npm test 2>&1 | tail -5`
Expected: 全绿，0 failed。对比 E-95 基线（4273 passed，以实跑为准），应 +3（failure 变体）。

- [ ] **Step 2: final review opus（整支）**

调 superpowers:requesting-code-review，审查范围：data-import.test.ts failure describe diff（3 it）。重点：① mock 对象 executeGdscriptTrusted 正确 ② failure 分支断言精确（SCRIPT_EXEC_FAILED + error 含义）③ timeout 冒泡断言 ④ 不破坏现有 happy mock 默认。

- [ ] **Step 3: 项目待办 :97b 回标 + master 状态**

`D:\workspace\Obsidian\GodotMCP\项目待办.md` 第 97 行（:97b 部分）回标 `[ ]` → `[x]` + commit hash + 一句话。`git rev-list --count origin/master..master` 确认领先数（惯例不 push）。

---

## Self-Review

**1. Spec coverage：** spec §设计/data-import failure 分支（:392-397）→ Task 1 compile_error/run_error it；spec §设计/timeout → Task 1 timeout it；spec §验收（全量绿/final review/待办回标）→ Task 2。spec 审阅 3 点吸收：① timeout rejects.toThrow 确定结论（Task 1 Step 2 timeout it + Global Constraints）② handleTool 调用（Task 1 代码）③ defer 21 文件（spec 已写，plan 不重复）。全覆盖。

**2. Placeholder scan：** 无 TBD。Task 1 failure describe 完整代码（3 it + makeValidArgs/makeCtx + 断言）。RED/GREEN 判据明确（failure 分支首次触发）。

**3. Type consistency：** `executeGdscriptTrusted` mock 返回结构（success/compile_success/compile_error/errors/run_success/run_error/outputs/raw_output/duration_ms/autoload_detected）对齐 gdscript-executor.ts Result（grep 确认 :452-472）。`handleTool('csv_to_resources', args, ctx)` 签名对齐现有 it（:378/:407/:419）。

**4. 风险点：** Task 1 failure it 若红（data-import.ts 分支 bug 或 mock 结构不符），按判据修（预期绿，spec 核实 :392-397 已实现）。mock 返回结构字段须完整（对齐 Result 类型，缺字段可能 TS 报错——但 test/ 不进 tsc，运行时 vitest 不严格，仍建议完整）。
