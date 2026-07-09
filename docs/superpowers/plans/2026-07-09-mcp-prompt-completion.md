# MCP Prompt Completion（参数自动补全 MVP）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** client 对 prompt 参数请求补全（`completion/complete`）→ 返回候选值（enum 固定枚举 / scenes 项目 .tscn 列表）。

**Architecture:** prompts.ts 加 `CompletionSource`（enum/scenes）+ `PromptDef.completion` 字段 + `getPromptDef` 导出 + `resolveCompletion` + **`handleCompletion`（逻辑提取，可单测）**。4 prompt 配 completion。GodotServer 加 CompleteRequest handler（纯 wiring 调 handleCompletion）。

**Tech Stack:** TypeScript + `@modelcontextprotocol/sdk`（`CompleteRequestSchema` 低层）+ vitest + 现有 `scanFiles`

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-09-mcp-prompt-completion-design.md`

## Global Constraints

- 行号基于 master `12aab2e`（含 Elicitation feature），实现时以实际为准。
- 简体中文注释。
- 每个 task `tsc` 0 错 + 相关测试绿；TDD。
- 测试 vitest，命令 `npm test`。
- **字段名已实测**（spec §9，对照 SDK types.d.ts）：`argument.{name,value}`（:5478）、`completion.{values,total,hasMore}`（:5509/5513/5517）。
- **total = all.length**（非 truncated.length，SDK :5511 "可超过实际发送数"语义）。
- **MAX=100**（SDK :5507 "Must not exceed 100 items" 规范上限）。
- scenes 用 `scanFiles(projectPath, ['.tscn'])`（src/core/file-scanner.ts），归一化 `res://` 路径（Windows `\` → `/`）。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/prompts.ts` | CompletionSource 类型 + PromptDef.completion + getPromptDef + resolveCompletion + handleCompletion + 4 prompt 配 completion | Modify |
| `test/prompts.test.ts` | getPromptDef/resolveCompletion/handleCompletion 单元（含 enum/scenes/MAX/total 语义） | Modify |
| `src/GodotServer.ts` | CompleteRequestSchema import + handler（调 handleCompletion） | Modify（`:9` import 区 / `:176` 区 handler） |
| `test/prompt-completion-wiring.test.ts` | GodotServer CompleteRequest handler 静态断言 | Create |

---

## Task 1: prompts.ts（CompletionSource + getPromptDef + resolveCompletion + handleCompletion）

**Files:**
- Modify: `src/prompts.ts`
- Modify: `test/prompts.test.ts`

**Interfaces:**
- Produces: `CompletionSource`、`PromptDef.completion?`、`getPromptDef(name)`、`resolveCompletion(source, prefix, projectPath)`、`handleCompletion(ref, argument, projectPath)`

- [ ] **Step 1: 写失败测试（加到 `test/prompts.test.ts`）**

顶部 import 改（加新导出 + mock file-scanner）：
```typescript
import { describe, it, expect, vi } from 'vitest';
import { listPrompts, getPrompt, listPromptDefs, getPromptDef, resolveCompletion, handleCompletion } from '../src/prompts.js';

// mock scanFiles 避免 IO，测 resolveCompletion/handleCompletion 的 scenes 归一化逻辑
vi.mock('../src/core/file-scanner.js', () => ({
  scanFiles: vi.fn(() => [
    '/proj/scenes/main.tscn',
    '/proj/scenes/level1.tscn',
    '/proj/scenes/sub/deep.tscn',
    '/proj/other.tscn',
  ]),
  DEFAULT_SKIP_DIRS: [],
}));
```

文件末尾加 describe：
```typescript
describe('prompt completion', () => {
  it('getPromptDef 返回指定 prompt 定义', () => {
    const def = getPromptDef('optimize_scene');
    expect(def?.name).toBe('optimize_scene');
    expect(def?.arguments?.find(a => a.name === 'scene_path')?.completion).toEqual({ type: 'scenes' });
  });

  it('getPromptDef 未知 name → undefined', () => {
    expect(getPromptDef('nonexistent')).toBeUndefined();
  });

  it('resolveCompletion enum 过滤 prefix', async () => {
    const r = await resolveCompletion({ type: 'enum', values: ['2d', '3d'] }, '2');
    expect(r).toEqual(['2d']);
  });

  it('resolveCompletion enum 空 prefix → 全部', async () => {
    const r = await resolveCompletion({ type: 'enum', values: ['2d', '3d'] }, '');
    expect(r).toEqual(['2d', '3d']);
  });

  it('resolveCompletion scenes 归一化 res:// + 过滤 prefix', async () => {
    const r = await resolveCompletion({ type: 'scenes' }, 'res://scenes/', '/proj');
    expect(r).toEqual(['res://scenes/main.tscn', 'res://scenes/level1.tscn', 'res://scenes/sub/deep.tscn']);
  });

  it('resolveCompletion scenes 无 projectPath → 空', async () => {
    const r = await resolveCompletion({ type: 'scenes' }, '', undefined);
    expect(r).toEqual([]);
  });

  it('handleCompletion ref/prompt + enum 参数 → values', async () => {
    const r = await handleCompletion({ type: 'ref/prompt', name: 'setup_player_controller' }, { name: 'dimension', value: '' }, undefined);
    expect(r.completion.values).toEqual(['2d', '3d']);
    expect(r.completion.total).toBe(2);
    expect(r.completion.hasMore).toBe(false);
  });

  it('handleCompletion ref 非 ref/prompt → 空', async () => {
    const r = await handleCompletion({ type: 'ref/resource', name: 'x' }, { name: 'y', value: '' }, undefined);
    expect(r.completion.values).toEqual([]);
  });

  it('handleCompletion 未知 prompt / 参数无 completion → 空', async () => {
    const r1 = await handleCompletion({ type: 'ref/prompt', name: 'nonexistent' }, { name: 'x', value: '' }, undefined);
    expect(r1.completion.values).toEqual([]);
    // create_platformer.project_name 无 completion 配置
    const r2 = await handleCompletion({ type: 'ref/prompt', name: 'create_platformer' }, { name: 'project_name', value: '' }, undefined);
    expect(r2.completion.values).toEqual([]);
  });

  it('handleCompletion scenes 超 MAX → values 截断 100 + total=all.length + hasMore', async () => {
    const { scanFiles } = await import('../src/core/file-scanner.js');
    (scanFiles as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      Array.from({ length: 150 }, (_, i) => `/proj/s${i}.tscn`),
    );
    const r = await handleCompletion({ type: 'ref/prompt', name: 'optimize_scene' }, { name: 'scene_path', value: '' }, '/proj');
    expect(r.completion.values).toHaveLength(100);
    expect(r.completion.total).toBe(150);  // total=all.length 非 truncated.length（SDK :5511）
    expect(r.completion.hasMore).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/prompts.test.ts -t "prompt completion"`
Expected: FAIL — `getPromptDef`/`resolveCompletion`/`handleCompletion` 未导出

- [ ] **Step 3: 修改 `src/prompts.ts`**

3a. import scanFiles + relative（顶部 import 区，PromptMessage import 后）：
```typescript
import { scanFiles } from './core/file-scanner.js';
import { relative } from 'node:path';
```

3b. 加 CompletionSource 类型 + PromptDef.completion（替换现有 `:4-8` PromptDef）：
```typescript
export type CompletionSource =
  | { type: 'enum'; values: string[] }
  | { type: 'scenes' };

export interface PromptDef {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
    completion?: CompletionSource;
  }>;
}
```

3c. 4 prompt arguments 加 completion 字段：
- `create_platformer.resolution`（`:27` 后）加：`completion: { type: 'enum', values: ['1280x720', '1920x1080', '2560x1440'] },`
- `setup_player_controller.dimension`（`:40` 后）加：`completion: { type: 'enum', values: ['2d', '3d'] },`
- `setup_player_controller.movement_type`（`:41` 后）加：`completion: { type: 'enum', values: ['topdown', 'platformer', 'fps'] },`
- `optimize_scene.scene_path`（`:54` 后）加：`completion: { type: 'scenes' },`

> 在每个 argument 对象的 `required?: false`（或 description）后加 `completion` 字段。

3d. 加 getPromptDef + resolveCompletion + handleCompletion（文件末尾，getPrompt 后）：
```typescript
/** 按 name 查单个 PromptDef（CompleteRequest handler 用，访问 completion 配置的唯一干净路径） */
export function getPromptDef(name: string): PromptDef | undefined {
  return PROMPTS[name]?.def;
}

/**
 * 解析补全源 → values（按 prefix 过滤）。
 * enum: 固定枚举；scenes: scanFiles 列 .tscn 归一化 res://。失败/无 projectPath → 空。
 */
export async function resolveCompletion(
  source: CompletionSource, prefix: string, projectPath?: string,
): Promise<string[]> {
  if (source.type === 'enum') {
    return source.values.filter(v => v.startsWith(prefix));
  }
  if (!projectPath) return [];
  try {
    const files = scanFiles(projectPath, ['.tscn']);
    return files
      .map(f => 'res://' + relative(projectPath, f).replace(/\\/g, '/'))
      .filter(r => r.startsWith(prefix));
  } catch {
    return [];
  }
}

/** CompleteRequest 逻辑（提取自 GodotServer handler，可单测）。SDK :5511 total=all.length；:5507 MAX=100。 */
export async function handleCompletion(
  ref: { type: string; name: string },
  argument: { name: string; value: string },
  projectPath?: string,
): Promise<{ completion: { values: string[]; total: number; hasMore: boolean } }> {
  const EMPTY = { completion: { values: [] as string[], total: 0, hasMore: false } };
  if (ref.type !== 'ref/prompt') return EMPTY;
  const argDef = getPromptDef(ref.name)?.arguments?.find(a => a.name === argument.name);
  if (!argDef?.completion) return EMPTY;
  const all = await resolveCompletion(argDef.completion, argument.value, projectPath);
  const MAX = 100;
  const truncated = all.slice(0, MAX);
  return { completion: { values: truncated, total: all.length, hasMore: all.length > MAX } };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/prompts.test.ts`
Expected: PASS（含新增 prompt completion 9 个 it + 原有 prompts/listPromptDefs it 全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit`（0 errors）；`npx eslint src/prompts.ts`（0 errors）
```bash
git add src/prompts.ts test/prompts.test.ts
git commit -m "feat(prompts): CompletionSource + getPromptDef + handleCompletion（Task 1）

PromptDef.completion 字段（enum/scenes）。4 prompt 配 completion（resolution/dimension/
movement_type enum + scene_path scenes）。handleCompletion 提取逻辑可单测（total=all.length
SDK :5511 语义 + MAX=100 :5507）。scenes 用 scanFiles 归一化 res://。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: GodotServer CompleteRequest handler（wiring）

**Files:**
- Modify: `src/GodotServer.ts`（`:9` import + CompleteRequestSchema / `:176` 区 handler）
- Create: `test/prompt-completion-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `handleCompletion`
- Produces: CompleteRequest handler 接线（client prompts/complete 生效）

- [ ] **Step 1: 写失败测试 `test/prompt-completion-wiring.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/GodotServer.ts'), 'utf8');

// 项目惯例不实例化 GodotServer，handler 是 wiring（调 handleCompletion），
// 逻辑由 prompts.test.ts 的 handleCompletion 单元覆盖。静态断言验证 handler 接线。
describe('CompleteRequest handler 接线（静态断言）', () => {
  it('import 了 CompleteRequestSchema', () => {
    expect(src).toMatch(/CompleteRequestSchema/);
  });
  it('import 了 handleCompletion from prompts', () => {
    expect(src).toMatch(/handleCompletion.*from\s+['"]\.\/prompts\.js['"]/);
  });
  it('setRequestHandler(CompleteRequestSchema, ...) 存在', () => {
    expect(src).toMatch(/setRequestHandler\(CompleteRequestSchema/);
  });
  it('handler 调 handleCompletion', () => {
    expect(src).toMatch(/handleCompletion\(/);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/prompt-completion-wiring.test.ts`
Expected: FAIL — handler 未接线

- [ ] **Step 3: 修改 `src/GodotServer.ts`**

3a. import CompleteRequestSchema（`:9-12` import 区，GetPromptRequestSchema 后加）：
```typescript
  CompleteRequestSchema,
```

3b. import handleCompletion（`:21` `import { listPrompts, getPrompt } from './prompts.js';` 改为）：
```typescript
import { listPrompts, getPrompt, handleCompletion } from './prompts.js';
```

3c. 加 CompleteRequest handler（`:176` 区，GetPrompt handler `:180-183` 后加）：
```typescript
    // ── MCP Prompt Completion handler（Phase P2-6）──────────────────────────
    this.server.setRequestHandler(CompleteRequestSchema, async (request) => {
      const { ref, argument } = request.params;
      return handleCompletion(
        ref as { type: string; name: string },
        argument as { name: string; value: string },
        resolveProjectPath(),
      );
    });
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/prompt-completion-wiring.test.ts`
Expected: PASS（4 个 it 全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit`（0 errors）；`npx eslint src/GodotServer.ts`（0 errors）
```bash
git add src/GodotServer.ts test/prompt-completion-wiring.test.ts
git commit -m "feat(prompts): GodotServer CompleteRequest handler 接线（Task 2）

setRequestHandler(CompleteRequestSchema) 调 handleCompletion（Task 1 提取）。
纯 wiring，逻辑由 prompts.test.ts handleCompletion 单元覆盖。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 全量验证 + 收尾

**Files:** 无代码改动（验证 + 文档）

- [ ] **Step 1: 全量 tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: 全量 lint**

Run: `npm run lint`
Expected: 0 errors（既有 warning 若与基线一致可接受）

- [ ] **Step 3: 全量 vitest**

Run: `npm test`
Expected: 全绿（基线 3657 + 新增 completion 测试 ~13，0 failed）。

- [ ] **Step 4: diff-matrix**

Run: `npm run diff-matrix`
Expected: no drift（completion 是 prompt 行为，不新增工具/action）

- [ ] **Step 5: Obsidian 开发日志**

写 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-09 MCP Prompt Completion.md`（frontmatter + callouts）：SDD 全流程 + 关键决策（completion only MVP / CompletionSource enum+scenes / getPromptDef 导出盲点 / handleCompletion 提取可测 / total=all.length SDK :5511 语义 / MAX=100 卡 :5507 规范上限）。

- [ ] **Step 6: 收尾 commit（若仓库有改动）**

若仅 vault 日志（仓库外），不创建空 commit，报告"仓库无新改动，验证全绿"。

---

## Self-Review

**1. Spec coverage：**
- spec §4.1 CompletionSource/PromptDef.completion/getPromptDef/resolveCompletion → Task 1 ✓
- spec §4.1 PROMPTS 未导出盲点（getPromptDef 唯一路径）→ Task 1（getPromptDef 导出 + ⚠️ 注释）✓
- spec §4.1 4 prompt 配 completion（enum 值与 build 默认一致）→ Task 1 3c ✓
- spec §4.2 GodotServer CompleteRequest handler → Task 2 ✓
- spec §5 数据流 → Task 1 handleCompletion + Task 2 handler ✓
- spec §6 错误处理（未知/无配置/glob 失败/非 ref/prompt → 空）→ Task 1 handleCompletion ✓
- spec §6 scenes MAX=100 + hasMore + total=all.length → Task 1 handleCompletion（MAX/total/hasMore）+ 测试 ✓
- spec §7 测试（resolveCompletion 单元/handler 集成）→ Task 1（handleCompletion 单元，含 enum/scenes/MAX/total）+ Task 2（静态断言）✓

**2. Placeholder scan：** Task 1 Step 3c 注明"在每个 argument 对象的 required/description 后加 completion"（具体位置）。无 TBD/TODO 空洞。

**3. Type consistency：** `CompletionSource`（prompts.ts 定义）→ PromptDef.completion → handleCompletion/resolveCompletion 参数一致。`handleCompletion(ref, argument, projectPath)` 签名 Task 1 定义 → Task 2 handler 调用一致。返回 `{completion:{values,total,hasMore}}` 与 SDK CompleteResultSchema 一致（spec §9 实测）。

**4. handleCompletion 提取的收益：** 逻辑（getPromptDef + resolveCompletion + MAX/total/hasMore）在 prompts.ts 可单测，GodotServer handler 纯 wiring（静态断言），避免 GodotServer 实例化（项目惯例）。
