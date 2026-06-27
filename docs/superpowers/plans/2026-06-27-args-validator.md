# args-validator 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `executeToolCall` 入口(L231 后)按 inputSchema 运行时验证 args(`validateArgs` 手写验证器),335 处 `args-as` cast 变合理,detect 改查入口接入 335→0。

**Architecture:** 新增 `src/core/args-validator.ts`(手写 JSON schema 验证:type/required/enum/items 递归/properties 嵌套/type 数组,零依赖);`tool-registry` 加 `getToolDefinition`;`executeToolCall` L231 后(`validateCommonArgs` 后、`ReadOnlyGuard` 前)接入;`defects.ts` detect 改查 `executeToolCall` 含 `validateArgs` + `status:'fixed'`/`baseline:0`。

**Tech Stack:** TypeScript(零新依赖,无 zod/ajv)、vitest、MCP SDK `Tool` interface

**对应 spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-27-args-validator-design.md`(v1.1,R1+#8 审查响应后)

## Global Constraints

- **零新依赖**(无 zod/ajv,手写)
- ESM,Node `>=18`,`"type": "module"`
- **接入点 `executeToolCall` L231 后**(`validateCommonArgs` L230 后、`ReadOnlyGuard` L233 前;editor/headless 分叉 L244/L281/L337 前)
- **335 处 cast 保留不动**(验证后合理窄化)
- `validateArgs` 接 `normalizeArgs` 后的 args(key snake_case 与 inputSchema 一致)
- **inline tool**(`confirm_and_execute`/`godot_advanced_tool`)`getToolDefinition` 返 undefined → 跳过(不阻断)
- 未知字段允许(`additionalProperties` 不拒)
- `tsconfig` include 仅 `src/`(test/ 不经 `tsc --noEmit`)
- detect 实现简化(R2 note):文件级 grep `ToolDispatcher.ts` 含 `validateArgs(`(该文件内 validateArgs 只在 executeToolCall 出现一处,文件级 = 函数段级)

## File Structure

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/core/args-validator.ts` | `validateArgs` 手写 JSON schema 验证 | Create |
| `src/core/tool-registry.ts` | `getToolDefinition(name)` | Modify(加导出函数) |
| `src/core/ToolDispatcher.ts` | `executeToolCall` L231 后接入 | Modify(import + 调用) |
| `test/args-validator.test.ts` | 验证器单测 | Create |
| `test/regression/defects.ts` | detect 改 + status/baseline | Modify(OPEN→FIXED) |

---

## Task 1: `src/core/args-validator.ts` — validateArgs 核心

**Files:**
- Create: `src/core/args-validator.ts`
- Test: `test/args-validator.test.ts`

**Interfaces:**
- Produces: `validateArgs(args: Record<string, unknown>, inputSchema: object): { ok: boolean; errors: string[] }`

- [ ] **Step 1: 写失败测试**

创建 `test/args-validator.test.ts`:

```ts
/**
 * args-validator 测试 — validateArgs 各 JSON schema 关键字正反例
 */
import { describe, it, expect } from 'vitest';
import { validateArgs } from '../src/core/args-validator.js';

describe('validateArgs', () => {
  // ── type ──
  it('type: 字段类型正确 → ok;错误 → error', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' }, count: { type: 'number' } }, required: ['name'] };
    expect(validateArgs({ name: 'x', count: 1 }, schema).ok).toBe(true);
    const r = validateArgs({ name: 'x', count: 'bad' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('count');
    expect(r.errors.join(';')).toContain('number');
  });

  it('type 数组: ["string","null"] 接受 string 或 null,拒 number', () => {
    const schema = { type: 'object', properties: { v: { type: ['string', 'null'] } } };
    expect(validateArgs({ v: 's' }, schema).ok).toBe(true);
    expect(validateArgs({ v: null }, schema).ok).toBe(true);
    expect(validateArgs({ v: 1 }, schema).ok).toBe(false);
  });

  // ── required ──
  it('required: 缺必填字段 → error', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    expect(validateArgs({}, schema).ok).toBe(false);
    expect(validateArgs({}, schema).errors.join(';')).toContain('a');
  });

  // ── enum ──
  it('enum: 非法值 → error', () => {
    const schema = { type: 'object', properties: { action: { type: 'string', enum: ['read', 'write'] } } };
    expect(validateArgs({ action: 'read' }, schema).ok).toBe(true);
    const r = validateArgs({ action: 'delete' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('enum');
  });

  // ── items 递归(batch-tools files[] 模式)──
  it('items 递归: array of object 嵌套 properties+required,深层错类型 → error', () => {
    const schema = {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      },
    };
    expect(validateArgs({ files: [{ path: 'a', content: 'b' }] }, schema).ok).toBe(true);
    // 深层:items 缺 required
    const r1 = validateArgs({ files: [{ path: 'a' }] }, schema);
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(';')).toContain('content');
    // 深层:items 字段错类型
    const r2 = validateArgs({ files: [{ path: 1, content: 'b' }] }, schema);
    expect(r2.ok).toBe(false);
    expect(r2.errors.join(';')).toContain('path');
  });

  // ── 嵌套 properties ──
  it('properties 嵌套: 子对象字段验证', () => {
    const schema = { type: 'object', properties: { opts: { type: 'object', properties: { depth: { type: 'number' } } } } };
    expect(validateArgs({ opts: { depth: 3 } }, schema).ok).toBe(true);
    const r = validateArgs({ opts: { depth: 'x' } }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('depth');
  });

  // ── 未知字段允许 ──
  it('未知字段允许(additionalProperties 不拒)', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(validateArgs({ a: 'x', unknown: 1 }, schema).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/args-validator.test.ts`
Expected: FAIL —— `validateArgs is not a function`(模块不存在)

- [ ] **Step 3: 实现 `src/core/args-validator.ts`**

```ts
// src/core/args-validator.ts
/**
 * 手写 JSON schema 参数验证器(spec §2)。
 * 覆盖 inputSchema 实际用的关键字:type / required / enum / items(递归) / properties(嵌套)。
 * 不覆盖(YAGNI):pattern/format/minLength/maxItems/additionalProperties(未知字段允许)。
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

function actualType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkType(value: unknown, expected: string | string[]): boolean {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((t) => TYPE_CHECKS[t]?.(value) ?? false);
}

interface SubSchema {
  type?: string | string[];
  enum?: unknown[];
  items?: SubSchema;
  properties?: Record<string, SubSchema>;
  required?: string[];
}

function validateValue(value: unknown, schema: SubSchema, path: string, errors: string[]): void {
  // type
  if (schema.type !== undefined && !checkType(value, schema.type)) {
    const exp = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
    errors.push(`${path}: 期望 type ${exp},实际 ${actualType(value)}`);
    return; // 类型错,后续 enum/items/properties 跳过(避免噪音)
  }
  // enum
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: 值 ${JSON.stringify(value)} 不在 enum [${schema.enum.map((e) => String(e)).join(',')}]`);
  }
  // items 递归(array 元素)
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateValue(item, schema.items as SubSchema, `${path}[${i}]`, errors));
  }
  // properties 嵌套(object)
  if (checkType(value, 'object') && schema.properties) {
    validateObject(value as Record<string, unknown>, schema, path, errors);
  }
}

function validateObject(obj: Record<string, unknown>, schema: SubSchema, path: string, errors: string[]): void {
  // required
  if (schema.required) {
    for (const req of schema.required) {
      if (!(req in obj)) errors.push(`${path}.${req}: required 字段缺失`);
    }
  }
  // properties(只校验出现的字段;未知字段允许)
  if (schema.properties) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in obj && sub) {
        validateValue(obj[key], sub as SubSchema, `${path}.${key}`, errors);
      }
    }
  }
}

export function validateArgs(args: Record<string, unknown>, inputSchema: object): ValidationResult {
  const errors: string[] = [];
  const schema = inputSchema as SubSchema;
  // inputSchema 顶层是 object(MCP 惯例),校验 args 的 properties/required
  if (schema.properties || schema.required) {
    validateObject(args, schema, 'args', errors);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/args-validator.test.ts`
Expected: PASS —— 全部 it 绿

- [ ] **Step 5: 提交**

```bash
git add src/core/args-validator.ts test/args-validator.test.ts
git commit -m "feat(args-validator): validateArgs 手写 JSON schema 验证(type/required/enum/items递归/properties嵌套/type数组)"
```

---

## Task 2: `tool-registry.ts` — getToolDefinition

**Files:**
- Modify: `src/core/tool-registry.ts`(加导出函数,在 `getModuleForTool` L94 后或 `getAllToolDefinitions` L98 前)
- Test: 复用现有 `test/core/tool-registry-groups.test.ts` 或在 `args-validator.test.ts` 边上加(本 task 在 `test/core/tool-registry-groups.test.ts` 末尾加一个 it)

**Interfaces:**
- Consumes: `ToolModule.getToolDefinitions(): Tool[]`(已存在)、`modules: ToolModule[]`(已存在)
- Produces: `getToolDefinition(name: string): Tool | undefined`(inline tool 返 undefined)

- [ ] **Step 1: 写失败测试**

在 `test/core/tool-registry-groups.test.ts` 末尾(或新建 it)加:

```ts
import { getToolDefinition } from '../../src/core/tool-registry.js';

describe('getToolDefinition', () => {
  it('返已注册 tool 的 inputSchema;inline tool 返 undefined', () => {
    // scene/script 等经 registerModule 注册(模块顶层 import 触发)
    const scene = getToolDefinition('scene');
    expect(scene).toBeDefined();
    expect(scene?.inputSchema).toBeDefined();
    expect(typeof scene?.inputSchema).toBe('object');

    // inline tool(confirm_and_execute 经 registerInlineTool 只进 metaRegistry,不进 modules)
    expect(getToolDefinition('confirm_and_execute')).toBeUndefined();
    expect(getToolDefinition('godot_advanced_tool')).toBeUndefined();
    // 未注册
    expect(getToolDefinition('nonexistent_tool_xyz')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/tool-registry-groups.test.ts`
Expected: FAIL —— `getToolDefinition is not a function`

- [ ] **Step 3: 实现 `getToolDefinition`**

在 `src/core/tool-registry.ts` 的 `getModuleForTool`(L94-96)之后加:

```ts
/** 找某 tool 的定义(含 inputSchema);inline tool(只进 metaRegistry)返 undefined。 */
export function getToolDefinition(name: string): Tool | undefined {
  for (const m of modules) {
    const def = m.getToolDefinitions().find((t) => t.name === name);
    if (def) return def;
  }
  return undefined;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/core/tool-registry-groups.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/tool-registry.ts test/core/tool-registry-groups.test.ts
git commit -m "feat(tool-registry): getToolDefinition(name) 返 Tool|undefined(inline tool 返 undefined)"
```

---

## Task 3: `executeToolCall` L231 后接入 validateArgs + 集成测试

**Files:**
- Modify: `src/core/ToolDispatcher.ts`(import validateArgs/getToolDefinition + L231 后插入校验块)
- Test: `test/core/ToolDispatcher.test.ts`(加集成测试,参照现有 `new ToolDispatcher(createOptions({...}))` 模式)

**Interfaces:**
- Consumes: Task 1 `validateArgs`、Task 2 `getToolDefinition`、现有 `opsErrorResult`(`src/tools/shared/errors.ts`)、`COMMON_ERROR_CODES`
- Produces: `executeToolCall` 在 `validateCommonArgs` 后对每个 tool 做 schema 校验,失败返 `INVALID_PARAMS`

- [ ] **Step 1: 写失败集成测试**

在 `test/core/ToolDispatcher.test.ts` 末尾加(参照现有 `createOptions` 模式;若该文件的 public 入口名是 `executeRequest`/`handleCall` 之一,按现有用例一致选用):

```ts
describe('executeToolCall schema validation', () => {
  it('错类型 args → INVALID_PARAMS(不传 handler)', async () => {
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'headless' }));
    // scene inputSchema 的 action 是 string enum;传 number → 校验失败
    const result = await dispatcher.executeRequest?.({ params: { name: 'scene', arguments: { project_path: '/tmp', action: 123 } } } as any);
    // 注:public 入口名按现有 ToolDispatcher.test.ts 用例(executeRequest / handleCall / dispatchTool)一致选用
    expect(result.isError ?? (result.content?.[0] && /INVALID_PARAMS/.test(JSON.stringify(result.content)))).toBeTruthy();
  });

  it('editor 模式错类型 args 同样 → INVALID_PARAMS(锁定 #1 上移覆盖 editor)', async () => {
    const dispatcher = new ToolDispatcher(createOptions({ mode: 'editor' }));
    const result = await dispatcher.executeRequest?.({ params: { name: 'scene', arguments: { project_path: '/tmp', action: 123 } } } as any);
    expect(result.isError ?? (result.content?.[0] && /INVALID_PARAMS/.test(JSON.stringify(result.content)))).toBeTruthy();
  });
});
```

> **implementer 注意**:public 入口名(`executeRequest`/`handleCall`/`dispatchTool`)以现有 `ToolDispatcher.test.ts` 用例为准(plan 写作时未逐一确认);断言核心是"错类型 args 不传 handler,返 INVALID_PARAMS"。若现有测试已 mock executor/handler,断言改为"executor/handler 未被调用 + 返 INVALID_PARAMS"(用 `vi.fn()` 验未调用)。

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/core/ToolDispatcher.test.ts`
Expected: FAIL —— 接入前错类型 args 会传 handler(无 INVALID_PARAMS)

- [ ] **Step 3: 接入 validateArgs**

(a) `src/core/ToolDispatcher.ts` 顶部 import 区加:

```ts
import { validateArgs } from './args-validator.js';
import { getToolDefinition } from './tool-registry.js';
```

(b) 在 `executeToolCall` 的 L231(`if (typeErr) return typeErr;`)之后、L233(`// ── 1. ReadOnlyGuard ──`)之前,插入:

```ts
      // ── 0.x Schema validation (args vs inputSchema) ──
      // spec §3:normalizeArgs 后 args key 已 snake_case,与 inputSchema 一致。
      // inline tool(confirm_and_execute/godot_advanced_tool)getToolDefinition 返 undefined → 跳过。
      const schemaDef = getToolDefinition(name);
      if (schemaDef?.inputSchema) {
        const { ok, errors } = validateArgs(args, schemaDef.inputSchema);
        if (!ok) {
          return opsErrorResult(
            COMMON_ERROR_CODES.INVALID_PARAMS,
            `参数校验失败: ${errors.join('; ')}`,
          );
        }
      }
```

> `opsErrorResult` 与 `COMMON_ERROR_CODES` 已在文件顶部 import(现有 validateCommonArgs L446 已用)。若未 import,补 `import { opsErrorResult, COMMON_ERROR_CODES } from '../tools/shared/errors.js';`。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/core/ToolDispatcher.test.ts`
Expected: PASS —— 错类型 args → INVALID_PARAMS(editor + headless 两路)

- [ ] **Step 5: 提交**

```bash
git add src/core/ToolDispatcher.ts test/core/ToolDispatcher.test.ts
git commit -m "feat(dispatcher): executeToolCall L231 后接入 validateArgs(schema 防线,错类型→INVALID_PARAMS)"
```

---

## Task 4: `defects.ts` — detect 改 + status/baseline 修订

**Files:**
- Modify: `test/regression/defects.ts`(把 `ts-args-as-cast-no-validation` 从 OPEN_DEFECTS 移到 FIXED_DEFECTS,改 detect 谓词)
- Modify: `test/regression/defects-open.test.ts` + `test/regression/defects-fixed.test.ts`(length 断言同步:OPEN 15→14、FIXED 22→23)

**Interfaces:**
- Consumes: 现有 `readSrc`(detect-helpers)、Task 3 接入(executeToolCall 含 validateArgs)

- [ ] **Step 1: 改 detect 谓词 + 移 FIXED**

(a) `test/regression/defects.ts` 的 OPEN_DEFECTS 中删除 `ts-args-as-cast-no-validation` entry(原 detect `countMatchesInDir(src/tools, /args.x as/)` baseline 335),替换为注释:

```ts
  // ts-args-as-cast-no-validation 移 FIXED(2026-06-27 args-validator 接入,detect 改查入口)
```

(b) FIXED_DEFECTS 末尾(`];` 前)加:

```ts
  { key: 'ts-args-as-cast-no-validation', status: 'fixed', severity: 'IMPORTANT', dimension: 'Type Safety',
    // R1/R2:接入点上移 executeToolCall(L231)。detect 改查"入口验证接入":
    // ToolDispatcher.ts 含 validateArgs(调用 = executeToolCall 那一处接入;文件级 grep 与函数段级等价,
    // 因该文件内 validateArgs 只在 executeToolCall 出现一处)。detect===0 防去验证化回归。
    detect: () => /validateArgs\(/.test(readSrc('src/core/ToolDispatcher.ts')) ? 0 : 1 },
```

(c) `test/regression/defects-open.test.ts` 的 length 断言:`15 → 14`(OPEN 减一)+ 注释更新。
(d) `test/regression/defects-fixed.test.ts` 的 length 断言:`22 → 23`(FIXED 加一)+ 注释更新。

- [ ] **Step 2: 跑 defects 测试验证**

Run: `npx vitest run test/regression/defects-fixed.test.ts test/regression/defects-open.test.ts`
Expected: PASS —— FIXED 23(detect===0,含新 ts-args-as-cast)+ OPEN 14(length 断言同步)

- [ ] **Step 3: 跑全测试确认无回归**

Run: `npx vitest run`
Expected: 全绿(args-validator + tool-registry + ToolDispatcher 集成 + defects + 其余)。lint `npm run lint` + `tsc --noEmit` clean。

- [ ] **Step 4: 提交**

```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts test/regression/defects-open.test.ts
git commit -m "fix(regression): ts-args-as-cast 移 FIXED(detect 改查 executeToolCall validateArgs 接入,335→0)"
```

---

## Self-Review

**1. Spec 覆盖:**
- spec §1 架构(args-validator/getToolDefinition/executeToolCall 接入/defects 改)→ Task 1/2/3/4 ✅
- spec §2 验证器覆盖(type/required/enum/items 递归/properties 嵌套/type 数组)→ Task 1 validateArgs + 测试全覆盖 ✅
- spec §3 数据流(接入点 executeToolCall L231 后、normalizeArgs 后 args、confirm pending.args 无需二次)→ Task 3 接入(L231 后)+ 接入注释说明;inline tool ④ 跳过(spec §3 #8)由 getToolDefinition undefined 自然实现 ✅
- spec §4 错误处理(INVALID_PARAMS / inline 跳过 / additionalProperties 偏差)→ Task 3(inline undefined 跳过 + INVALID_PARAMS);additionalProperties 7 处偏差是已知(spec §4),plan 不拒未知字段(validateObject 只校验 properties 内字段)✅
- spec §5 detect(executeToolCall 含 validateArgs + status fixed/baseline 0)→ Task 4 ✅
- spec §6 测试(args-validator 单测 + executeToolCall 集成 editor+headless)→ Task 1(单测)+ Task 3(editor+headless 集成,#9 R2 补)✅
- spec 验收标准 8 条 → Task 1-4 全覆盖 ✅

**2. 占位符扫描:** Task 3 集成测试 public 入口名注明"按现有 ToolDispatcher.test.ts 用例为准"(非占位,是 implementer 适配现有 mock 框架的明确指引);其余 step 完整代码。

**3. 类型一致性:** `validateArgs(args: Record<string, unknown>, inputSchema: object): { ok: boolean; errors: string[] }` 在 Task 1 定义、Task 3 调用,签名一致;`getToolDefinition(name: string): Tool | undefined` 在 Task 2 定义、Task 3 调用,一致;`ValidationResult` 接口 Task 1 export,一致。

无 issue,plan 可执行。
