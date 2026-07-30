# E-97b mock failure 变体（报告4 :97b）

> 继承总 spec `docs/superpowers/specs/2026-07-29-审查修复批次设计.md` batch E :97b。报告4 :97b（23 vi.mock 补 failure 变体）独立子批。:97a 删 godot-mock.ts 已闭环（E-P1 Task1，commit bd78a97）。同 batch 已闭环：:93/:94/:96/:97a（E-P1）/ :98（E-P2）/ :95（E-95）。

## Goal

给 data-import 工具补 `executeGdscriptTrusted` 的 failure 变体（compile_error / run_error / timeout），覆盖 `data-import.ts:392-397` 的显式 failure 分支——当前固定 happy mock 从未触发（假绿：failure 处理逻辑零覆盖）。

## brainstorming 核实（核实推翻待办"23 文件全做"）

### 待办"23 vi.mock 补 failure 变体"核实（grep 实测，不照待办自述）

实测 **22 文件** vi.mock gdscript-executor（非 23）。逐类核实大部分不需补 failure 变体：

- **经 parseGdscriptResult 的工具**（audio-ops / animation / navigation / physics / particles / signal / scene-instance / scene-query 等）：failure 处理在共享 `parseGdscriptResult`（`src/tools/shared/errors.ts:44`），**已由 `test/shared.test.js:50-99` 充分覆盖**（compile_error → SCRIPT_EXEC_FAILED、run_error → SCRIPT_EXEC_FAILED、errorMapper、paramWarnings）→ mock failure 冗余
- **透传工具**（script execute，`script.ts:852` 直接 `JSON.stringify(result)` 无 failure 分支）→ 不需
- **已测 failure**：delivery（`delivery.test.js:668/822/856/881` compile/run/killed 充分）/ animation-ops（:217）/ workflow（`workflow.test.ts:111` compile_success:false）/ validation-tools（:151 spawnGodot timeout）
- **scene-commit**：`parseCommitResult` 已覆盖（`scene-commit-tool.test.ts:34-53` + `e2e-p1-p5.test.ts:143`）；run_success 透传（`scene-commit-tool.ts:109`）次要 defer

### 唯一真缺口 = data-import

`test/tools/data-import.test.ts:16` 固定 happy mock（`mockResolvedValue({ compile_success:true, run_success:true, outputs:[...] })`），`data-import.ts:392-397` 的 `!compile_success`/`!run_success` 显式 failure 分支**从未触发**。

### mock 对象一致性确认

`data-import.ts:239 import { executeGdscriptTrusted as executeGdscript }`——**别名**。data-import 经 `executeGdscriptTrusted`（A1 安全决策：跳沙箱 `load()` + `Class.new()`，因为要实例化用户类）。test mock `executeGdscriptTrusted` **对象正确**（一致）。

## 设计

### data-import failure 分支（src/tools/data-import.ts:384-397，实测）

```ts
const r = await executeGdscript({ ... });  // 实际 executeGdscriptTrusted（别名 :239）
if (!r.compile_success) return opsErrorResult('SCRIPT_EXEC_FAILED', r.compile_error);  // :392-393
if (!r.run_success) return opsErrorResult('SCRIPT_EXEC_FAILED', r.run_error);          // :395-396
```

timeout：`executeGdscriptTrusted` reject（`gdscript-executor.ts:1266 new Error('Godot process timed out after ${timeout}s')`）→ data-import `try/finally`（:381/414）无 catch → 冒泡。

### failure 变体（test/tools/data-import.test.ts 加 describe）

per-it `mockResolvedValueOnce` / `mockRejectedValueOnce`（不破坏现有固定 happy mock 默认 :16，对齐 `delivery.test.js:668` 现有模式）：

| 变体 | mock（executeGdscriptTrusted） | 断言 |
|------|----------------------------|------|
| compile_error | `mockResolvedValueOnce({ success:false, compile_success:false, compile_error:'syntax error', errors:[], run_success:false, run_error:'', outputs:[], raw_output:'', duration_ms:0, autoload_detected:[] })` | callTool 返 `SCRIPT_EXEC_FAILED` + content 含 compile_error（验 :393） |
| run_error | `mockResolvedValueOnce({ ..., compile_success:true, compile_error:'', run_success:false, run_error:'runtime crashed' })` | `SCRIPT_EXEC_FAILED` + 含 run_error（验 :396） |
| timeout | `mockRejectedValueOnce(new Error('Godot process timed out after 60s'))` | reject 冒泡；plan 核实断言形态（data-import handleTool 外层 catch 与否 → `rejects.toThrow` 或外层返 error） |

### 模式

per-it mock 覆盖（vitest 标准）。现有固定 happy mock（:16 `mockResolvedValue`）保留作默认，failure it 用 `mockResolvedValueOnce` 覆盖单次（不影响其他 it）。

## 集成

- 仅改 `test/tools/data-import.test.ts`（加 failure describe + import executeGdscriptTrusted 如未 import）。不改 src/。
- 不改 package.json / ci.yml。

## Global Constraints（继承总 spec）

- 工作仓库 `D:\GitHub\godot-mcp-enhanced`；master 本地 commit 不 push。
- TDD：failure 变体先写（RED：mock failure → 断言 SCRIPT_EXEC_FAILED，分支首次触发）→ 跑确认覆盖 → 全量绿。
- 核实驱动（[[plan-baseline-verify-grep]][[verify-implementation-by-source]]）：data-import.ts 分支行号 + mock 对象 + 现有 it 结构核实。
- timeout 断言形态 plan 核实（data-import handleTool 外层 catch 与否）。

## Defer 清单

- scene-commit run_success 透传 failure 变体（parseCommitResult 已覆盖，run_success 透传 :109 次要）
- 其余 22 文件（经 parseGdscriptResult 已覆盖 / 透传 / 已测）
- 检测器（mock failure 覆盖检测，类比 E-P2，但 :97b 范围小至单文件 3 变体，检测器成本 > 价值）

## 验收

- `data-import.test.ts` 加 3 failure 变体（compile_error / run_error / timeout），覆盖 `data-import.ts:392-397` + timeout
- 全量 vitest 绿（+3 it）
- final review opus
- 项目待办.md 报告4 :97b 回标
- master 本地不 push

## Self-Review

- **Spec 覆盖**：data-import 3 failure 变体 + 核实推翻 + defer 全设计。无遗漏。
- **占位符**：failure 变体有精确 mock + 断言表。timeout 断言形态标注 plan 核实（data-import 外层 catch 与否），属实现细节非设计占位。
- **一致性**：核实段（data-import 唯一缺口 + parseGdscriptResult 已覆盖）与范围（data-import only）一致；mock 对象 executeGdscriptTrusted 与 `data-import.ts:239` 别名一致。
- **范围**：单一文件 3 变体，一个 plan 可覆盖。22 文件 + 检测器 defer 明列。
- **边界**：明确不碰其余 22 文件（已覆盖/透传/已测）+ 不做检测器，避免 scope 蔓延。
