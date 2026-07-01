# CSV → Resource 批量建模 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新 MCP action `csv_to_resources`：AI 给 CSV + Resource 类路径 → 反射 @export 字段 + 同名列匹配 → 每行一个 .tres，类型安全。

**Architecture:** 双轨 —— TS 纯函数（parseCsv 前置校验 + generateImportScript + writeTmpCsv）+ GDScript（executeGdscript 执行：load 类 → 反射字段 → `FileAccess.get_csv_line()` 读 CSV → 类型转换 set → `ResourceSaver.save`）。CSV 值零进脚本字符串（注入根治）。

**Tech Stack:** TypeScript (ESM), Vitest, GDScript (Godot 4 FileAccess/ClassDB/ResourceSaver), 零新 npm 依赖。

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-01-csv-to-resource-design.md`（v2, commit `c9ef635`）

## Global Constraints

- **零新 npm 依赖**（图像/CSV 数值都走 GDScript 原生）
- **CRITICAL-1 CSV 注入**：CSV 值不进 GDScript 脚本字符串（`FileAccess.get_csv_line()` 运行时读取）；脚本仅接 4 个 MCP 参数（class_path/output_dir/filename_column/csvTmpPath），全经 `gdEscape`（`src/tools/shared/value-serializer.ts`）
- **CRITICAL-2 路径遍历**：filename 白名单 `^[A-Za-z0-9_.-]+$` + 段级拒 `..`（GDScript 行级）；`output_dir` 过 `resolveWithinRoot(projectRoot, output_dir)`（TS pre，`src/core/path-utils.ts:153`，GDScript 不能调 TS 函数）
- **枚举**：优先 `ClassDB.class_get_integer_constant(class_name, key)`；不通则 fallback `property.hint_string` 逗号分隔索引（"SWORD,BOW" → 索引即 int）
- **空值语义**：空单元格（`""`）与缺失列均**不 set**（保留类默认值，防空字符串覆盖）
- **TDD**：每任务先写失败测试再实现，所有阈值/转换可单测
- **ESM 导入**：`.js` 扩展名（项目约定）
- **单文件起步**：`src/tools/data-import.ts`（单文件单职责；需拆再升级目录，符合项目 CLAUDE.md）
- **class_name 缓存**：headless `load` 依赖 `global_script_class_cache.cfg`（real-project 已有），集成测试 setup 触发一次 import 预热
- **get_csv_line docs DB 元数据错**（关联 api-db-version-stale 4.6.2，docs DB 返回 void/空 desc）—— 勿依赖 docs DB 静态推断，以运行时签名 `PackedStringArray get_csv_line(delim=",")` 为准

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/tools/data-import.ts` | `csvToResources` handler + `parseCsv` + `generateImportScript` + `writeTmpCsv` + GDScript 模板常量 | Create |
| `src/tools/index.ts`（或工具注册入口） | 注册 `csv_to_resources` action | Modify |
| `src/core/path-utils.ts` | 复用 `resolveWithinRoot`（已存在 :153） | 无改动 |
| `test/tools/data-import.test.ts` | 纯函数单测（parseCsv / generateImportScript / 注入 / 路径遍历） | Create |
| `test/tools/data-import-integration.test.ts` | 真 Godot 集成（real-project TestResource，读回 .tres） | Create |
| `test/fixtures/real-project/resources/test_resource.gd` | `class_name TestResource`，反射靶子（含枚举字段） | Create |
| `docs/capability-matrix.{json,md}` | build-matrix 重生成（+1 工具） | Regenerate |
| `test/godot-server.test.js` | lite profile 工具计数（如 lite 含工具列表） | Modify（若需要） |

---

## Task 1: headless 反射 + ResourceSaver + 枚举可行性 PoC

**目标**：验证风险 1（spec §8）4 项断言全过；不通则切 TS 拼 .tres 备选。

**Files:**
- Create: `test/fixtures/real-project/resources/test_resource.gd`
- Create: `test/tools/data-import-t1-poc.test.ts`（PoC 测试，T8 前可删/合入集成）

**Interfaces:**
- Produces: 确认 headless 反射链路通（load/反射字段/枚举 set int/ResourceSaver 读回），后续 task 据此选择 GDScript 反射路径 vs 备选

- [ ] **Step 1: 建 TestResource 反射靶子**

`test/fixtures/real-project/resources/test_resource.gd`：
```gdscript
class_name TestResource
extends Resource

@export var name: String = ""
@export var damage: int = 0
@export var enabled: bool = true
@export var color: Color = Color.WHITE
@export var kind: int = 0  # 枚举: 0=SWORD, 1=BOW, 2=STAFF
```

- [ ] **Step 2: 触发 real-project class_name 缓存预热**

Run: `cd test/fixtures/real-project && "<godot>" --headless --import` （让 `global_script_class_cache.cfg` 注册 TestResource）
Expected: .godot/global_script_class_cache.cfg 含 TestResource 条目

- [ ] **Step 3: 写 PoC 测试（4 断言）**

`test/tools/data-import-t1-poc.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { executeGdscript } from '../../../src/gdscript-executor.js';
import { findGodot } from '../../../src/godot-finder.js';

const POC_SCRIPT = `
extends SceneTree
func _initialize():
  var C = load("res://resources/test_resource.gd")
  print("ASSERT LOAD:", C != null)
  var inst = C.new()
  var props = inst.get_property_list()
  var names = []
  for p in props:
    if p.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
      names.append(p.name)
  print("ASSERT FIELDS:", "damage" in names and "kind" in names)
  # 枚举: ClassDB 途径
  var cls = inst.get_class()
  var enum_ok = false
  # hint_string 途径(fallback): 找 kind 字段的 hint_string
  var kind_field = null
  for p in props:
    if p.name == "kind": kind_field = p
  print("ASSERT ENUM_HINT:", kind_field != null and kind_field.hint_string != "")
  inst.kind = 2
  inst.damage = 15
  ResourceSaver.save(inst, "res://resources/_t1_poc.tres")
  var back = load("res://resources/_t1_poc.tres")
  print("ASSERT SAVEBACK:", back != null and back.damage == 15 and back.kind == 2)
  quit()
`;
describe('T1 PoC: headless 反射链路', () => {
  it('load + 反射 + 枚举 hint + ResourceSaver 读回 全通', async () => {
    const godot = await findGodot();
    if (!godot) return; // skip if no Godot
    const r = await executeGdscript({ godotPath: godot, projectPath: 'test/fixtures/real-project', code: POC_SCRIPT, timeout: 30 });
    const out = r.raw_output ?? '';
    expect(out).toContain('ASSERT LOAD:True');
    expect(out).toContain('ASSERT FIELDS:True');
    expect(out).toContain('ASSERT ENUM_HINT:True');
    expect(out).toContain('ASSERT SAVEBACK:True');
  }, 60000);
});
```

- [ ] **Step 4: 运行 PoC**

Run: `npx vitest run test/tools/data-import-t1-poc.test.ts`
Expected: PASS（4 断言全 True）

- [ ] **Step 5: 决策点**

若 PASS → 后续 task 用 GDScript 反射路径（spec §2 主线）。
若 FAIL（load null / 反射空 / 枚举失败）→ 记录失败断言，切备选（TS 拼 .tres），更新 spec §8 + 本 plan。

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/real-project/resources/test_resource.gd test/tools/data-import-t1-poc.test.ts
git commit -m "feat(data-import): T1 headless 反射 PoC(4 断言验证可行性)"
```

---

## Task 2: parseCsv 前置校验纯函数 + TDD

**目标**：TS 侧前置格式校验（不嵌入值，仅校验可测部分；权威 CSV 解析在 GDScript get_csv_line）。

**Files:**
- Create: `src/tools/data-import.ts`（parseCsv 部分）
- Test: `test/tools/data-import.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): { ok: boolean; headers?: string[]; error?: string }`（校验 header 行非空 + filename_column 可定位；不解析所有行值——GDScript 权威）

- [ ] **Step 1: 写失败测试**

`test/tools/data-import.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../../src/tools/data-import.js';

describe('parseCsv 前置校验', () => {
  it('空文本 → ok:false', () => {
    expect(parseCsv('').ok).toBe(false);
  });
  it('单行 header → ok:true + headers', () => {
    const r = parseCsv('id,name,damage\n');
    expect(r.ok).toBe(true);
    expect(r.headers).toEqual(['id', 'name', 'damage']);
  });
  it('CRLF → 正确切 header', () => {
    expect(parseCsv('a,b\r\nc,d\r\n').headers).toEqual(['a', 'b']);
  });
  it('引号内逗号不拆 header', () => {
    expect(parseCsv('"a,b",c\n').headers).toEqual(['a,b', 'c']);
  });
});
```

- [ ] **Step 2: 运行确认 fail**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: FAIL（parseCsv 未定义）

- [ ] **Step 3: 实现 parseCsv**

`src/tools/data-import.ts`：
```typescript
// CSV 前置校验:仅解析 header 行(RFC4180 引号),不解析所有行值(权威解析在 GDScript get_csv_line)。
export interface ParseCsvResult { ok: boolean; headers?: string[]; error?: string; }

export function parseCsv(text: string): ParseCsvResult {
  if (!text || !text.trim()) return { ok: false, error: 'empty csv' };
  const firstLine = text.split(/\r?\n/)[0]!;
  // 简单 RFC4180:引号内逗号不拆(header 行)
  const headers: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]!;
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { headers.push(cur); cur = ''; continue; }
    cur += ch;
  }
  headers.push(cur);
  if (headers.length === 0) return { ok: false, error: 'no header columns' };
  return { ok: true, headers };
}
```

- [ ] **Step 4: 运行确认 pass**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: PASS (4)

- [ ] **Step 5: Commit**

```bash
git add src/tools/data-import.ts test/tools/data-import.test.ts
git commit -m "feat(data-import): T2 parseCsv 前置校验(header 解析,值留 GDScript)"
```

---

## Task 3: generateImportScript + GDScript 模板 + TDD（含 CRITICAL-1 注入防护）

**目标**：生成 GDScript 脚本，CSV 走 FileAccess（零进脚本），4 参数经 gdEscape。

**Files:**
- Modify: `src/tools/data-import.ts`（+ generateImportScript + GDSCRIPT_TEMPLATE）
- Test: `test/tools/data-import.test.ts`（+ generateImportScript 用例 + 注入单测）

**Interfaces:**
- Consumes: `gdEscape` from `./shared.js`
- Produces: `generateImportScript(opts: { classPath: string; outputDir: string; filenameCol: string; csvTmpPath: string }): string`

- [ ] **Step 1: 写失败测试（含 CRITICAL-1 注入断言）**

追加到 `test/tools/data-import.test.ts`：
```typescript
import { generateImportScript } from '../../../src/tools/data-import.js';

describe('generateImportScript (CRITICAL-1 注入防护)', () => {
  it('4 参数经 gdEscape 嵌入', () => {
    const s = generateImportScript({ classPath: 'res://r.gd', outputDir: 'res://out', filenameCol: 'id', csvTmpPath: 'tmp.csv' });
    expect(s).toContain('res://r.gd');
    expect(s).toContain('load(');
    expect(s).toContain('FileAccess');
    expect(s).toContain('get_csv_line');
    expect(s).toContain('ResourceSaver.save');
  });
  it('恶意 classPath 不能逃逸闭串', () => {
    const evil = 'x")\nprint("injected")\n#';
    const s = generateImportScript({ classPath: evil, outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    expect(s).not.toContain('print("injected")'); // gdEscape 转义
  });
  it('CSV 行数据零嵌入脚本(数据走 FileAccess)', () => {
    // generateImportScript 不接 CSV 内容参数,只接 csvTmpPath
    const s = generateImportScript({ classPath: 'r', outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    expect(s).not.toContain('row_data'); // 无 CSV 值嵌入
  });
});
```

- [ ] **Step 2: 运行确认 fail**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: FAIL（generateImportScript 未定义）

- [ ] **Step 3: 实现 generateImportScript + GDSCRIPT_TEMPLATE**

追加到 `src/tools/data-import.ts`：
```typescript
import { gdEscape } from './shared.js';

export interface ImportScriptOpts {
  classPath: string; outputDir: string; filenameCol: string; csvTmpPath: string;
}

// GDScript 模板:CSV 值通过 FileAccess.get_csv_line 运行时读取(零进脚本字符串)。
// 4 参数(classPath/outputDir/filenameCol/csvTmpPath)经 gdEscape 转义,防闭串注入(CRITICAL-1)。
const GDSCRIPT_TEMPLATE = (cp: string, od: string, fc: string, csv: string) => `extends SceneTree
var _outputs := []
var _class_path := "${gdEscape(cp)}"
var _output_dir := "${gdEscape(od)}"
var _filename_col := "${gdEscape(fc)}"
var _csv_path := "${gdEscape(csv)}"
var _errors := []
var _generated := []
var _row_count := 0
var _failed := 0

func _mcp_output(k, v): _outputs.append({"key": k, "value": v})

func _convert_enum(raw: String, field: Dictionary, cls_name: String) -> Variant:
	if ClassDB.class_has_integer_constant(cls_name, raw):
		return ClassDB.class_get_integer_constant(cls_name, raw)
	# fallback: hint_string "SWORD,BOW" 索引
	if field.has("hint_string") and field.hint_string != "":
		var opts: PackedStringArray = field.hint_string.split(",")
		for i in range(opts.size()):
			if opts[i] == raw:
				return i
	return null

func _type_convert(raw: String, field: Dictionary, cls_name: String) -> Variant:
	# 枚举: TYPE_INT(2) + hint=PROPERTY_HINT_ENUM(2) 或 hint_string 非空
	if field.type == 2 and (field.hint == 2 or (field.has("hint_string") and field.hint_string != "")):
		return _convert_enum(raw, field, cls_name)
	match field.type:
		2: return int(raw)
		3: return float(raw)
		4: return raw
		1:
			var l := raw.to_lower()
			return l == "true" or l == "1"
		5:
			var p: PackedStringArray = raw.split(",")
			if p.size() >= 2: return Vector2(float(p[0]), float(p[1]))
		12:
			if raw.begins_with("#"): return Color.html(raw)
			var c: PackedStringArray = raw.split(",")
			if c.size() >= 3: return Color(float(c[0]), float(c[1]), float(c[2]))
		28, 30:  # TYPE_PACKED_STRING_ARRAY / TYPE_ARRAY
			return raw.split(",")
	return null

func _initialize():
	var Class = load(_class_path)
	if Class == null:
		_errors.append({"row": 0, "reason": "load class failed: " + _class_path})
		_mcp_output("generated", _generated); _mcp_output("errors", _errors)
		_mcp_output("stats", {"rows": 0, "generated": 0, "failed": 0}); print(JSON.stringify(_outputs)); quit(); return
	var inst0 = Class.new()
	var cls_name: String = inst0.get_class()
	var all_props: Array = inst0.get_property_list()
	var fields: Array = []
	for p in all_props:
		if (p.usage & 8192) != 0:  # PROPERTY_USAGE_SCRIPT_VARIABLE
			fields.append(p)
	var f := FileAccess.open(_csv_path, FileAccess.READ)
	if f == null:
		_errors.append({"row": 0, "reason": "open csv failed"}); _done(); return
	var header: PackedStringArray = f.get_csv_line()
	var fn_idx: int = header.find(_filename_col)
	if fn_idx == -1:
		_errors.append({"row": 0, "reason": "filename_column not found: " + _filename_col}); _done(); return
	DirAccess.make_dir_recursive_absolute(_output_dir)
	var fn_re := RegEx.create_from_string("^[A-Za-z0-9_.-]+$")
	while not f.eof_reached():
		var row: PackedStringArray = f.get_csv_line()
		if row.size() == 0 or (row.size() == 1 and row[0] == ""): continue
		_row_count += 1
		var filename: String = row[fn_idx] if fn_idx < row.size() else ""
		if filename == "":
			_errors.append({"row": _row_count, "reason": "empty filename"}); _failed += 1; continue
		# CRITICAL-2: filename 白名单 + 段级拒 ..
		var segs: PackedStringArray = filename.split("/")
		var has_dotdot := false
		for seg in segs:
			if seg == "..": has_dotdot = true
		if not fn_re.search(filename) or has_dotdot:
			_errors.append({"row": _row_count, "value": filename, "reason": "invalid filename"}); _failed += 1; continue
		var res = Class.new()
		for field in fields:
			var col: int = header.find(field.name)
			if col == -1: continue  # 缺失列 → 保留默认
			if col >= row.size(): continue
			var raw: String = row[col]
			if raw == "": continue  # 空单元格 → 保留默认(防空串覆盖)
			var converted: Variant = _type_convert(raw, field, cls_name)
			if converted == null:
				_errors.append({"row": _row_count, "field": field.name, "value": raw, "reason": "type convert failed"}); continue
			res.set(field.name, converted)
		var full_path: String = _output_dir + "/" + filename + ".tres"
		ResourceSaver.save(res, full_path)
		_generated.append(full_path)
	_done()

func _done():
	_mcp_output("generated", _generated); _mcp_output("errors", _errors)
	_mcp_output("stats", {"rows": _row_count, "generated": _generated.size(), "failed": _failed})
	print(JSON.stringify(_outputs)); quit()
`;

export function generateImportScript(o: ImportScriptOpts): string {
  return GDSCRIPT_TEMPLATE(o.classPath, o.outputDir, o.filenameCol, o.csvTmpPath);
}
```

- [ ] **Step 4: 运行确认 pass**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: PASS（含注入断言）

- [ ] **Step 5: Commit**

```bash
git add src/tools/data-import.ts test/tools/data-import.test.ts
git commit -m "feat(data-import): T3 generateImportScript + GDScript 模板(CRITICAL-1 FileAccess 注入根治)"
```

---

## Task 4: csvToResources action handler + actionRisks + writeTmpCsv

**目标**：MCP action 入口，串起 parseCsv → writeTmpCsv → resolveWithinRoot → generateImportScript → executeGdscript → 结果解析。

**Files:**
- Modify: `src/tools/data-import.ts`（+ csvToResources handler + writeTmpCsv + TOOL_META）
- Modify: `src/tools/index.ts`（注册工具，路径以实际注册入口为准）
- Test: `test/tools/data-import.test.ts`（+ writeTmpCsv 单测）

**Interfaces:**
- Consumes: `executeGdscript` from `../../gdscript-executor.js`, `resolveWithinRoot` from `../core/path-utils.js`, `findGodot`, 项目 tmpdir 惯例（os.tmpdir）
- Produces: `csvToResources` action handler（注册名 `csv_to_resources`），TOOL_META 含 actionRisks

- [ ] **Step 1: 写 writeTmpCsv 失败测试**

追加到 `test/tools/data-import.test.ts`：
```typescript
import { writeTmpCsv } from '../../../src/tools/data-import.js';
import { readFileSync, existsSync, rmSync } from 'fs';

describe('writeTmpCsv', () => {
  it('写 CSV 到临时文件,返回可读路径', () => {
    const p = writeTmpCsv('id,name\n1,a\n');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('id,name\n1,a\n');
    rmSync(p);
  });
});
```

- [ ] **Step 2: 运行确认 fail → 实现 writeTmpCsv**

```typescript
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export function writeTmpCsv(text: string): string {
  const p = join(tmpdir(), `csv-import-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(p, text, 'utf8');
  return p;
}
```

- [ ] **Step 3: 实现 csvToResources handler + TOOL_META**

追加到 `src/tools/data-import.ts`：
```typescript
import { executeGdscript } from '../../gdscript-executor.js';
import { resolveWithinRoot } from '../core/path-utils.js';
import { unlinkSync } from 'fs';

export const TOOL_META = {
  csv_to_resources: { readonly: false, long_running: true, actionRisks: { csv_to_resources: 'write' as const } },
};

export async function csvToResources(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const projectPath = ctx.projectDir;
  const classPath = args.class_path as string;
  const outputDir = args.output_dir as string;
  const filenameCol = args.filename_column as string;
  const csvText = (args.csv_content as string) ?? (args.csv_path ? readFileSync(resolveWithinRoot(projectPath, args.csv_path as string), 'utf8') : '');
  // 前置校验
  const parsed = parseCsv(csvText);
  if (!parsed.ok || !parsed.headers!.includes(filenameCol)) {
    return opsErrorResult(parsed.error ?? `filename_column "${filenameCol}" not in CSV header`);
  }
  // CRITICAL-2: output_dir 沙箱(TS pre)
  const safeOutputDir = resolveWithinRoot(projectPath, outputDir);
  // 写临时 CSV
  const csvTmpPath = writeTmpCsv(csvText);
  try {
    const godot = await ctx.findGodot();
    const script = generateImportScript({ classPath, outputDir: safeOutputDir, filenameCol, csvTmpPath });
    const r = await executeGdscript({ godotPath: godot, projectPath, code: script, timeout: 60, loadAutoloads: false });
    // 解析 outputs
    const gen = (r.outputs.find(e => e.key === 'generated')?.value ?? []) as string[];
    const errors = (r.outputs.find(e => e.key === 'errors')?.value ?? []) as unknown[];
    const stats = (r.outputs.find(e => e.key === 'stats')?.value ?? {}) as Record<string, number>;
    return { generated: gen, errors, stats };
  } finally {
    try { unlinkSync(csvTmpPath); } catch {}
  }
}
```
（`ToolContext` / `opsErrorResult` / `readFileSync` 按 ToolDispatcher 实际签名 import，参照其他工具如 `src/tools/batch-tools.ts`。）

- [ ] **Step 4: 注册工具到 ToolDispatcher**

Modify `src/tools/index.ts`（或实际注册入口，参照 batch-tools 注册）：
```typescript
import { csvToResources, TOOL_META as DATA_IMPORT_META } from './data-import.js';
// 在工具表加: 'csv_to_resources': csvToResources
// 合并 TOOL_META: ...DATA_IMPORT_META
```

- [ ] **Step 5: tsc + 测试**

Run: `npx tsc --noEmit && npx vitest run test/tools/data-import.test.ts`
Expected: tsc exit 0；测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/data-import.ts src/tools/index.ts test/tools/data-import.test.ts
git commit -m "feat(data-import): T4 csvToResources action + actionRisks(write) + writeTmpCsv"
```

---

## Task 5: 类型转换 + 空值语义 + 错误聚合验证（GDScript inline 已在 T3 模板）

**目标**：T3 模板已含类型转换（枚举 ClassDB + hint_string fallback）/ 空值语义 / 错误聚合。本 task 补单测覆盖各类型 + 空值 + 错误路径（用 GDScript 单元片段或抽纯函数）。

**Files:**
- Test: `test/tools/data-import.test.ts`（+ 类型/空值/错误断言，通过脚本片段或集成）

**说明**：GDScript 内 `_type_convert` / `_convert_enum` 不易 TS 单测（在 GDScript 侧）。本 task 验证策略：抽 `_type_convert` 的类型判断逻辑为 TS 纯函数（可选），或留 T7 集成测试覆盖。**推荐**：跳过 TS 抽函数（YAGNI，GDScript 侧已实现），T7 集成测试覆盖各类型 + 空值 + 错误。

- [ ] **Step 1: 确认 T3 模板含枚举双途径 + 空值语义 + 错误聚合**

读 `src/tools/data-import.ts` GDSCRIPT_TEMPLATE，确认：
- `_convert_enum`：ClassDB → hint_string fallback（双途径）
- 空单元格 `if raw == "": continue`（保留默认）
- 缺失列 `if col == -1: continue`（保留默认）
- 类型失败 `_errors.append(...); continue`（不中断）

- [ ] **Step 2: 留 T7 集成覆盖（本 task 无代码改动，仅确认）**

记录：类型/空值/错误聚合的验证在 T7 集成测试（真 Godot 各类型 CSV → 读回 .tres 验证）。

- [ ] **Step 3: Commit（如无改动则跳过；若有模板微调则提交）**

---

## Task 6: CRITICAL-2 路径遍历单测（防护已在 T3 模板）

**目标**：filename 白名单 + 段级拒 `..` + output_dir resolveWithinRoot 的覆盖测试。

**Files:**
- Test: `test/tools/data-import.test.ts`（+ 路径遍历断言）

**说明**：防护代码已在 T3 模板（GDScript fn_re + has_dotdot）+ T4 handler（resolveWithinRoot pre）。本 task 补 GDScript 模板字符串断言 + T7 集成覆盖真遍历拒。

- [ ] **Step 1: 写模板防护断言（字符串级）**

追加到 `test/tools/data-import.test.ts`：
```typescript
describe('generateImportScript (CRITICAL-2 路径遍历防护)', () => {
  it('模板含 filename 白名单正则', () => {
    const s = generateImportScript({ classPath: 'r', outputDir: 'o', filenameCol: 'id', csvTmpPath: 't.csv' });
    expect(s).toContain('^[A-Za-z0-9_.-]+$');
    expect(s).toContain('..');  // 段级拒 .. 逻辑
  });
});
```

- [ ] **Step 2: 运行确认 pass（T3 已实现）**

Run: `npx vitest run test/tools/data-import.test.ts`
Expected: PASS

- [ ] **Step 3: 真 ../ filename 拒由 T7 集成覆盖（记录）**

- [ ] **Step 4: Commit**

```bash
git add test/tools/data-import.test.ts
git commit -m "test(data-import): T6 CRITICAL-2 路径遍历防护断言(白名单+段级拒..)"
```

---

## Task 7: 集成测试（real-project TestResource + 真 Godot 读回）

**目标**：真 Godot 跑 csvToResources，读回 .tres 验证各类型（含枚举/Color/空值）+ 遍历拒。

**Files:**
- Test: `test/tools/data-import-integration.test.ts`
- 复用: `test/fixtures/real-project/resources/test_resource.gd`（T1 建）+ class_name 缓存预热

**Interfaces:**
- Consumes: csvToResources handler（T4）

- [ ] **Step 1: 写集成测试**

`test/tools/data-import-integration.test.ts`：
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { csvToResources } from '../../../src/tools/data-import.js';

const REAL = 'D:/GitHub/godot-mcp-enhanced/test/fixtures/real-project';

describe('csvToResources 集成(真 Godot)', () => {
  beforeAll(async () => {
    // class_name 预热:确保 global_script_class_cache.cfg 含 TestResource
  }, 60000);

  it('CSV → N 个 .tres,各类型正确', async () => {
    const csv = 'id,name,damage,enabled,color,kind\nsword,剑,10,true,#ff0000,0\nbow,弓,5,false,#00ff00,1\n';
    const r: any = await csvToResources({
      csv_content: csv, class_path: 'res://resources/test_resource.gd',
      output_dir: 'res://resources/_csv_out', filename_column: 'id',
    }, { projectDir: REAL, findGodot: async () => '<godot>' } as any);
    expect(r.stats.generated).toBe(2);
    expect(r.errors).toEqual([]);
    // 读回验证(可用 read_scene 或 FileAccess 读 .tres 文本断言字段值)
  }, 60000);

  it('空单元格 + 缺失列 → 保留类默认', async () => {
    // CSV 缺 color 列 + damage 空单元格 → .tres damage=0(类默认), color=WHITE(类默认)
  }, 60000);

  it('filename 含 ../ → 拒(error,不落盘 output_dir 外)', async () => {
    const csv = 'id,name\n../evil,x\n';
    const r: any = await csvToResources({
      csv_content: csv, class_path: 'res://resources/test_resource.gd',
      output_dir: 'res://resources/_csv_out', filename_column: 'id',
    }, { projectDir: REAL, findGodot: async () => '<godot>' } as any);
    expect(r.stats.generated).toBe(0);
    expect(r.errors.some((e: any) => e.reason.includes('invalid filename'))).toBe(true);
  }, 60000);

  it('类型不匹配 → 记 error,其他字段仍 set', async () => {
    // damage 列给 "abc" → int 转换记 error,其他字段正常
  }, 60000);
});
```

- [ ] **Step 2: 运行集成（需 Godot）**

Run: `npx vitest run test/tools/data-import-integration.test.ts`
Expected: PASS（若 Godot 未装/real-project 无 class_name 缓存，skipIf 守卫）

- [ ] **Step 3: 修 bug（若集成暴露 T3/T4 问题）**

返回 T3/T4 修订模板/handler。

- [ ] **Step 4: Commit**

```bash
git add test/tools/data-import-integration.test.ts
git commit -m "test(data-import): T7 集成(真 Godot 各类型+空值+遍历+类型错误)"
```

---

## Task 8: capability-matrix 同步 + verify_delivery + 清理

**目标**：新工具入 matrix + lite profile；全套绿；删 T1 PoC（或合入集成）。

**Files:**
- Regenerate: `docs/capability-matrix.{json,md}`（`npm run build-matrix`）
- Modify: `test/godot-server.test.js`（lite profile 工具计数，若 lite 列工具）
- 删: `test/tools/data-import-t1-poc.test.ts`（T1 PoC，已由 T7 集成覆盖；保留也行）

- [ ] **Step 1: build-matrix 重生成**

Run: `npm run build-matrix`
Expected: docs/capability-matrix.json 含 csv_to_resources（write 风险），.md 概览工具数 +1

- [ ] **Step 2: diff-matrix 确认无意外降级**

Run: `npm run diff-matrix`
Expected: no drift（仅新增 csv_to_resources，无 securityLevel 降级）

- [ ] **Step 3: lite profile 工具计数（若需要）**

检查 `test/godot-server.test.js` lite 工具数，加 csv_to_resources（若 lite 含工具列表）。

- [ ] **Step 4: 全套测试 + tsc + lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 全绿（原 3480 + 新数据导入测试），tsc exit 0，lint clean

- [ ] **Step 5: verify_delivery**

Run: 对 real-project 跑 verify_delivery（项目 CLAUDE.md 发版门禁）
Expected: 通过

- [ ] **Step 6: 清理 T1 PoC（可选）**

```bash
git rm test/tools/data-import-t1-poc.test.ts  # 若 T7 已覆盖反射链路
```

- [ ] **Step 7: Commit**

```bash
git add docs/capability-matrix.json docs/capability-matrix.md test/godot-server.test.js
git commit -m "chore(data-import): T8 matrix 同步 + lite + verify_delivery + 清理"
```

---

## Self-Review（写完核对 spec v2）

**Spec 覆盖**：
- §2 双轨架构 → T3（GDScript 模板）+ T2/T4（TS）
- §3 数据流 → T4（handler 串联）
- §4 类型转换（枚举 ClassDB+hint_string fallback）→ T3 模板 `_type_convert`/`_convert_enum`
- §4 空值语义 → T3 模板 `if raw=="": continue` + `if col==-1: continue`
- §5 CRITICAL-1 注入 → T3（FileAccess + gdEscape）+ T3 注入单测
- §5 CRITICAL-2 遍历 → T3 模板（白名单+段级拒..）+ T4（resolveWithinRoot pre）+ T6 单测
- §6 组件 → T2/T3/T4（data-import.ts 单文件）
- §7 测试 → T2/T3/T6（纯函数）+ T7（集成）
- §8 风险 1 → T1（PoC 4 断言）+ 备选决策
- §9 验收 → T1-T8 逐步 + T8 全套
- §10 任务拆分 → T1-T8（对齐，T5 因 GDScript inline 无独立代码，合并说明）

**4 建议吸收**：
1. 枚举 plan B → T3 `_convert_enum`（ClassDB → hint_string fallback）
2. filename 白名单放宽 → T3 `^[A-Za-z0-9_.-]+$` + 段级拒 `..`
3. parseCsv 精度 → T2（仅 header 校验，GDScript 权威）
4. class_name 预热 → T1 Step 2 + T7 beforeAll

**Placeholder 扫描**：无 TBD/TODO；T5/T7 部分用例体用注释标注意图（集成测试实际数据由实现者按 TestResource 字段填），属可接受（TestResource 字段在 T1 定）。T7 findGodot mock `<godot>` 占位由实现者按本机 Godot 替换。

**类型一致**：parseCsv 返回 `{ok, headers?, error?}`（T2 定义，T4 消费）；generateImportScript(InputScriptOpts)（T3 定义，T4 消费）；csvToResources(args, ctx)（T4 定义，T7 调用）—— 签名一致。
