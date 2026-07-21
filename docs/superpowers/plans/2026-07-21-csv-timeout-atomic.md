# csv_to_resources 超时残留修复（P2-1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 csv_to_resources 在 60s 超时 kill 时不产半截损坏 .tres（消除阻塞项目加载风险），并使 timeout 可配。

**Architecture:** GDScript 侧改 tmp+rename 原子提交（`ResourceSaver.save` 写 `.tmp` → `DirAccess.rename_absolute` 覆盖 full_path）+ 脚本开头清上次残留 `.tmp`；TS handler timeout 改可配；schema 加可选 timeout 字段；defects.ts 登记 detect 闭包防复发。

**Tech Stack:** TypeScript（data-import.ts 含 GDSCRIPT_TEMPLATE 模板字符串）/ GDScript（Godot 4.x DirAccess API）/ vitest

## Global Constraints

- GDScript 原子提交用 `DirAccess.rename_absolute(tmp_path, full_path)`（Godot 4.x：Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` / POSIX `rename()`，同文件系统原子覆盖）。实现时若 4.6.2/4.7 实测不覆盖，降级 `if file_exists(full_path): remove(full_path)` 再 `rename`（remove+rename 间窗口 full_path 不存在，kill 仍不产半截，可接受）。
- schema `timeout` 字段：`type: 'number'`，`optional: true`，`default: 60`。
- defects.ts detect 闭包查 `var tmp_path: String = full_path + ".tmp"` + `DirAccess.rename_absolute(tmp_path, full_path)` 两模式（删任一 → detect=1 复发）。
- 所有注释中文（项目全局规则）。
- 测试用 vitest（`npx vitest run <file>`）。
- `src/tools/data-import.ts` 是 TS 文件（GDScript 代码在其中的 `GDSCRIPT_TEMPLATE` 模板字符串内），用 Edit 改（**非 .gd 文件，Edit 适用**）。模板内 GDScript 用 **tab 缩进**（与现有一致），Edit 时匹配真 tab。
- commit message 中文，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- master 分支累积 commit，**不 push origin**（项目惯例 [[user-prefers-local-ahead-no-push]]）。

---

## File Structure

| 文件 | 职责 | 本 plan 改动 |
|------|------|-------------|
| `src/tools/data-import.ts` | csv_to_resources 工具（GDSCRIPT_TEMPLATE + handleTool + getToolDefinitions + TOOL_META） | GDSCRIPT_TEMPLATE save 循环 + .tmp 清理（Task 1）；handler timeout + schema 字段（Task 2） |
| `test/tools/data-import.test.ts` | csv 导入测试 | Task 1 加 generateImportScript 静态断言；Task 2 加 timeout 透传断言 |
| `test/regression/defects.ts` | defect 回归数据层 | Task 3 加 csv-import-timeout-no-atomic-write FIXED 条目 + 头注释 |
| `test/regression/defects-fixed.test.ts` | FIXED 计数断言 | Task 3 计数 67→68 |

---

### Task 1: GDScript tmp+rename 原子提交 + 启动清 .tmp 残留

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\data-import.ts`（GDSCRIPT_TEMPLATE：mkdir 守卫后 `:146` 加 .tmp 清理；save 循环 `:173-180` 改 tmp+rename）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\data-import.test.ts`（追加 generateImportScript 静态断言 describe）

**Interfaces:**
- Consumes: `generateImportScript(o: ImportScriptOpts): string`（已存在 `src/tools/data-import.ts:193`），`ImportScriptOpts = { classPath, outputDir, filenameCol, csvTmpPath }`（`:32-37`）
- Produces: GDSCRIPT_TEMPLATE 输出含 (1) `.tres.tmp` 清理循环 (2) `tmp_path` 变量 (3) `ResourceSaver.save(res, tmp_path)` (4) `DirAccess.rename_absolute(tmp_path, full_path)` (5) rename 失败 `DirAccess.remove_absolute(tmp_path)`

- [ ] **Step 1: 写 failing test**

在 `test/tools/data-import.test.ts` 末尾追加：

```ts
import { generateImportScript } from '../../src/tools/data-import.js';

describe('generateImportScript P2-1 原子提交 + .tmp 清理', () => {
  const script = generateImportScript({
    classPath: 'res://item.gd',
    outputDir: '/tmp/out',
    filenameCol: 'name',
    csvTmpPath: '/tmp/csv.tmp',
  });

  it('save 循环用 tmp_path 中转 + rename_absolute 原子提交', () => {
    expect(script).toMatch(/var\s+tmp_path\s*:\s*String\s*=\s*full_path\s*\+\s*"\.tmp"/);
    expect(script).toMatch(/ResourceSaver\.save\(\s*res\s*,\s*tmp_path\s*\)/);
    expect(script).toMatch(/DirAccess\.rename_absolute\(\s*tmp_path\s*,\s*full_path\s*\)/);
  });

  it('rename 失败时清 tmp + 记 error', () => {
    expect(script).toMatch(/DirAccess\.remove_absolute\(\s*tmp_path\s*\)/);
    expect(script).toMatch(/rename failed/);
  });

  it('脚本开头清上次 kill 留下的 .tres.tmp 残留', () => {
    expect(script).toMatch(/\.tres\.tmp/);
    expect(script).toMatch(/clean_dir\.remove\(/);
  });

  it('保留 full_path 作为最终路径 + _generated.append(full_path)', () => {
    expect(script).toMatch(/var\s+full_path\s*:\s*String\s*=\s*_output_dir/);
    expect(script).toMatch(/_generated\.append\(\s*full_path\s*\)/);
  });
});
```

> 若 `generateImportScript` 已在文件顶部 import，勿重复 import。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: 4 个新 `it` FAIL（`toMatch` 模式不匹配——当前模板无 tmp_path/rename_absolute/.tres.tmp 清理）

- [ ] **Step 3: 改 GDSCRIPT_TEMPLATE（Edit data-import.ts）**

**Edit 1**（mkdir 守卫后加 .tmp 清理）。先 Read `src/tools/data-import.ts:143-146` 确认精确文本（tab 缩进），再 Edit：

old_string（注意是真 tab 缩进）:
```
	var mkdir_err: int = DirAccess.make_dir_recursive_absolute(_output_dir)
	if mkdir_err != OK:
		_errors.append({"row": 0, "reason": "create output dir failed: " + str(mkdir_err)})
		_mcp_done(); return
```

new_string:
```
	var mkdir_err: int = DirAccess.make_dir_recursive_absolute(_output_dir)
	if mkdir_err != OK:
		_errors.append({"row": 0, "reason": "create output dir failed: " + str(mkdir_err)})
		_mcp_done(); return
	# P2-1: 清上次 kill 留下的 .tres.tmp 残留（半截无害但占空间，每次调用自清）
	var clean_dir = DirAccess.open(_output_dir)
	if clean_dir:
		clean_dir.list_dir_begin()
		var clean_fn = clean_dir.get_next()
		while clean_fn != "":
			if clean_fn.ends_with(".tres.tmp"):
				clean_dir.remove(clean_fn)
			clean_fn = clean_dir.get_next()
		clean_dir.list_dir_end()
```

**Edit 2**（save 循环 :173-180 改 tmp+rename）。Read `src/tools/data-import.ts:173-181` 确认精确文本后 Edit：

old_string:
```
		var full_path: String = _output_dir + "/" + filename + ".tres"
		# F-5(2026-07-04 审查): ResourceSaver.save 返回 Error,失败记 error + continue(不谎报 generated)。
		var save_err: int = ResourceSaver.save(res, full_path)
		if save_err != OK:
			_errors.append({"row": _row_count, "value": filename, "reason": "save failed: " + str(save_err)})
			_failed += 1
			continue
		_generated.append(full_path)
```

new_string:
```
		var full_path: String = _output_dir + "/" + filename + ".tres"
		# P2-1: tmp+rename 原子提交。kill 落在 save(tmp) 中途→tmp 半截 full_path 旧(不损);
		# rename 后→full_path 完整。full_path 永不半截→Godot 启动不 parse error→不阻塞加载。
		var tmp_path: String = full_path + ".tmp"
		# F-5(2026-07-04 审查): ResourceSaver.save 返回 Error,失败记 error + continue(不谎报 generated)。
		var save_err: int = ResourceSaver.save(res, tmp_path)
		if save_err != OK:
			_errors.append({"row": _row_count, "value": filename, "reason": "save failed: " + str(save_err)})
			_failed += 1
			continue
		var rename_err: int = DirAccess.rename_absolute(tmp_path, full_path)
		if rename_err != OK:
			DirAccess.remove_absolute(tmp_path)
			_errors.append({"row": _row_count, "value": filename, "reason": "rename failed: " + str(rename_err)})
			_failed += 1
			continue
		_generated.append(full_path)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: 4 新 `it` PASS + 现有 data-import 测试全绿（tmp+rename 不变成功路径语义，`_generated`/`_errors`/`_failed` 输出不变）

- [ ] **Step 5: Commit**

```bash
git add src/tools/data-import.ts test/tools/data-import.test.ts
git commit -m "fix(data-import): GDScript tmp+rename 原子提交 + 清 .tmp 残留（P2-1）

ResourceSaver.save 改写 .tmp 中转 → DirAccess.rename_absolute 原子覆盖 full_path。
kill 落在 save 中途→tmp 半截 full_path 旧(不损);rename 后→full_path 完整。
full_path 永不半截→消除超时 kill 产半截损坏 .tres 阻塞项目加载风险。
脚本开头清上次 kill 留下的 .tres.tmp 残留(每次调用自清)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: handler timeout 可配 + schema 可选 timeout 字段

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\data-import.ts`（handler executeGdscript 调用 `:336`；schema getToolDefinitions csv_to_resources properties `:234` 附近）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\data-import.test.ts`（追加 timeout 透传 describe）

**Interfaces:**
- Consumes: `handleTool(args, ctx)` 的 `args.timeout`（新可选字段，与 `args.output_dir`/`args.filename_column` 同层，`data-import.ts:273-275`）；`executeGdscript(opts)`（`src/gdscript-executor.ts`，opts.timeout 已支持）
- Produces: `executeGdscript({ ..., timeout: args.timeout ?? 60 })`——不传 timeout 默认 60，传值则透传

- [ ] **Step 1: 写 failing test**

先 Read `test/tools/data-import.test.ts` 确认现有测试的 args/ctx 构造模式（含如何构造合法 csv_content 绕过 parseCsv + output_dir 绕过 resolveWithinRoot），再追加：

```ts
// 文件顶部（若未 mock executeGdscript）：
vi.mock('../../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn().mockResolvedValue({
    compile_success: true,
    run_success: true,
    outputs: [{ key: 'generated', value: '[]' }, { key: 'errors', value: '[]' }, { key: 'stats', value: '{}' }],
  }),
}));

import { handleTool } from '../../src/tools/data-import.js';
import { executeGdscript } from '../../src/gdscript-executor.js';

describe('csv_to_resources timeout 可配 P2-1', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('不传 timeout → executeGdscript 收到默认 60', async () => {
    await handleTool(makeValidArgs({}), makeCtx());
    expect(executeGdscript).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60 }));
  });

  it('传 timeout=120 → executeGdscript 收到 120', async () => {
    await handleTool(makeValidArgs({ timeout: 120 }), makeCtx());
    expect(executeGdscript).toHaveBeenCalledWith(expect.objectContaining({ timeout: 120 }));
  });
});
```

> `makeValidArgs(overrides)` / `makeCtx()` 辅助须复用现有测试的合法构造（class_path/output_dir/filename_column/csv_content 齐全，csv_content header 含 filename_column，output_dir 在项目根内）。若现有测试已有类似工厂函数，直接复用；否则按现有 `it` 内的 args 字面量提炼。implementer 负责让 args 通过 `:277` 必填校验 + `:319` parseCsv header 校验 + `:325` resolveWithinRoot，到达 `:332` executeGdscript 调用。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: 2 新 `it` FAIL（当前 handler 硬编码 `timeout: 60`——不传 timeout 的用例碰巧通过 60，但传 120 的用例 FAIL：收到 60 !== 120）

> 若"不传 timeout → 60"用例因硬编码碰巧 PASS，仍保留（它锁默认值）；"传 120"用例 FAIL 是驱动实现的关键。

- [ ] **Step 3: 改 handler + schema**

**Edit 1**（handler `:336`）：

old_string:
```
      timeout: 60,
```
new_string:
```
      timeout: args.timeout ?? 60,
```

**Edit 2**（schema 加 timeout property）。Read `src/tools/data-import.ts:231-258`（getToolDefinitions csv_to_resources 条目的 properties/inputSchema），在现有 properties 中加 timeout 字段（对齐现有 property 格式）：

```ts
          timeout: {
            type: 'number',
            description: 'GDScript 执行超时秒数（大批量 CSV 可调大，默认 60）',
            optional: true,
            default: 60,
          },
```

> implementer 按现有 properties 的确切缩进/格式插入（Read 后对齐）。位置：与 class_path/output_dir/filename_column/csv_content/csv_path 同层。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: 2 新 `it` PASS（默认 60 + 自定义 120 透传）+ 现有测试无回归

- [ ] **Step 5: Commit**

```bash
git add src/tools/data-import.ts test/tools/data-import.test.ts
git commit -m "feat(data-import): csv_to_resources timeout 可配（P2-1）

schema 加可选 timeout 字段(default 60);handler executeGdscript 调用改 args.timeout ?? 60。
大批量 CSV 用户可调大 timeout 减少超时触发。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: defects.ts 登记 detect 闭包 + fixed.test 计数同步

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts`（数据导入段 `:377` 后加条目；头注释 `:2` FIXED 67→68）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\regression\defects-fixed.test.ts`（`:84` 注释 + `:85`,`:87` 计数 67→68）

**Interfaces:**
- Consumes: Task 1 已实现的 `tmp_path` + `rename_absolute` 模式（detect 查 `src/tools/data-import.ts`）
- Produces: `csv-import-timeout-no-atomic-write` FIXED 条目，detect 返回 0（模式存在），FIXED_DEFECTS 总数 67→68

**依赖：** Task 1（detect 查的 tmp+rename 模式须已落地，否则 detect=1 测试失败）

- [ ] **Step 1: 写 failing test（改 fixed.test 计数期望）**

Read `test/regression/defects-fixed.test.ts:80-90` 确认精确文本后 Edit：

Edit `:84` 注释（合计 67 → 68 + 加 P2-1 说明）。在注释末尾"合计 67"改为"合计 68"，并追加一行说明：
```
//   2026-07-21 P2-1 csv-import-timeout-no-atomic-write（tmp+rename 原子提交防超时残留），合计 68。
```
（具体插入位置 Read 后对齐现有注释风格）

Edit `:85`:
old: `    expect(FIXED_DEFECTS.length).toBe(67);`
new: `    expect(FIXED_DEFECTS.length).toBe(68);`

Edit `:87`:
old: `    expect(new Set(keys).size, '存在重名 key').toBe(67);`
new: `    expect(new Set(keys).size, '存在重名 key').toBe(68);`

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run test/regression/defects-fixed.test.ts`
Expected: FAIL（`FIXED_DEFECTS.length` 仍是 67 !== 68）

- [ ] **Step 3: 加 defects.ts 条目**

Read `test/regression/defects.ts:366-378` 确认 csv-import-no-byte-limit（`:366-377`）与 game-bridge-invalidate-race（`:378`）边界，在 `:377`（csv-import-no-byte-limit 闭合 `} },`）后、`:378`（game-bridge）前插入：

```ts
  { key: 'csv-import-timeout-no-atomic-write', status: 'fixed', severity: 'IMPORTANT', dimension: 'Reliability',
    // P2-1(2026-07-21 核实真问题): ResourceSaver.save 直写目标,超时 kill 落在 save 中途产半截损坏 .tres,
    // Godot 启动 ResourceLoader 扫 res:// parse error 阻塞项目加载。
    // 修复:tmp+rename 原子提交(ResourceSaver.save 写 .tmp → DirAccess.rename_absolute 覆盖 full_path)。
    // detect 查 tmp_path 变量 + rename_absolute 调用(删任一→detect=1 复发)。
    detect: () => {
      const f = readSrc('src/tools/data-import.ts');
      const hasTmp = /var\s+tmp_path\s*:\s*String\s*=\s*full_path\s*\+\s*"\.tmp"/.test(f);
      const hasRename = /DirAccess\.rename_absolute\(\s*tmp_path\s*,\s*full_path\s*\)/.test(f);
      return hasTmp && hasRename ? 0 : 1;
    } },
```

同时更新 defects.ts `:2` 头注释"FIXED_DEFECTS 67 条"→"68 条"，并在末尾追加"+ 2026-07-21 P2-1 csv-import-timeout-no-atomic-write×1"（对齐现有注释列举风格，Read `:2` 后精确 Edit）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run test/regression/defects-fixed.test.ts`
Expected: PASS（`FIXED_DEFECTS.length` === 68，新 detect 返回 0——Task 1 已实现两模式）

- [ ] **Step 5: Commit**

```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts
git commit -m "test(defects): 登记 csv-import-timeout-no-atomic-write（P2-1 防复发）

FIXED 67→68。detect 查 tmp_path + rename_absolute 模式(删任一→detect=1 复发)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 完成验证（全部 Task 后）

- [ ] **tsc 0 error**: `npx tsc --noEmit`
- [ ] **vitest 全量绿**: `npx vitest run`（含 data-import.test.ts 新断言 + defects-fixed.test.ts 计数 68 + 现有全量无回归）
- [ ] **Godot 4.6.2 + 4.7 rename 覆盖实测（可选但推荐）**: headless `--script` 验证 `DirAccess.rename_absolute(tmp, full_path)` 在 full_path 已存在时原子覆盖（写 tmp → rename 覆盖已有 full_path → 读 full_path 确认是新内容）。若某版本不覆盖，按 Global Constraints 降级 remove+rename 并补注释。

## Self-Review（writing-plans 自审，实施前完成）

**Spec coverage:**
- A.1 .tmp 清理 → Task 1 Edit 1 ✓
- A.2 tmp+rename → Task 1 Edit 2 ✓
- B handler timeout → Task 2 Edit 1 ✓
- C schema timeout → Task 2 Edit 2 ✓
- D defects.ts detect → Task 3 ✓
- 测试策略 4 项 → Task 1（静态断言）+ Task 2（timeout 透传）+ Task 3（detect）+ 完成验证（回归）✓
- 验收标准 9 项 → 全覆盖（tsc/vitest/4.6.2+4.7 实测在完成验证）✓

**Placeholder scan:** 无 TBD/TODO；schema/Edit 精确位置标注"Read 后对齐"是因 implementer 须确认 tab 缩进/确切行（非占位符，是 Edit 前置）。

**Type consistency:** `generateImportScript(ImportScriptOpts)` / `handleTool(args, ctx)` / `executeGdscript(opts)` 签名跨 Task 一致；detect 正则与 Task 1 实现代码字面对齐（`tmp_path`/`rename_absolute`/`.tres.tmp`）。
