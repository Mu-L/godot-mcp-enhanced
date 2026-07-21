# ui_* 持久化提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 ui_* 的 6 个 Control 创造/改 action 追加 C5 不持久化提示；theme 操作（ui_set_theme/theme_create/theme_set_property）整体不包装（C5 文案 add_node 对 Theme 资源错位）。

**Architecture:** 方案 A——调用处 Set 过滤。helper `appendRuntimePersistWarning(result, action)` 已存在（C5 `cee9477`），公共 API 零改动。ui 用单公共返回点 `src/tools/ui/index.ts:432`（所有 action 走 `parseGdscriptResult`），条件包装只对 6 Control action 加。文案复用 helper 现有（不改 `runtimePersistWarning`）。

**Tech Stack:** TypeScript / vitest / godot-mcp-enhanced（`src/tools/ui/index.ts` + `test/persistence-warning.test.ts`）

## Global Constraints

- **helper 不改**：`appendRuntimePersistWarning(result: ToolResult, action: string): ToolResult`（`src/tools/shared/persistence-warning.ts:18`），从 `'../shared.js'` 导入（ui 在 `src/tools/ui/`，shared 在 `src/tools/`；barrel re-export 在 `src/tools/shared.ts:7`）
- **action 名**：ui action 值已含 `ui_` 前缀（`ui_create_control` 等），直接传 `action`（与 C5 follow-up 的 nav_/material_ 手动加前缀不同）
- **加提示判据**：Control 创造/改运行时节点树→加（C5 文案 add_node+save_scene 对 Control 节点适用）；查询/主题/真落盘→不加
- **theme 整体不加**：ui_set_theme（全 theme_action）/ theme_create（全 theme_create_action）/ theme_set_property 操作 Theme 资源，C5 文案 add_node 对 theme 错位（Theme 用 ResourceSaver save theme_action=save/save_path），无 .tscn 误解风险（与 recording 同逻辑）
- **executor**：ui 用 `executeGdscriptTrusted`（`ui/index.ts:8` import / `:416` 调用），现有 `test/persistence-warning.test.ts:12` vi.mock 已 mock executeGdscript + executeGdscriptTrusted（C5 follow-up Task 4 加，复用 `SUCCESS_RESULT`）
- **scene_path 安全校验**：ui Control action 用 `resolveWithinRoot(projectPath, normalizeUserProjectPath(args.scene_path))`。`safeRealPath`（path-utils.ts:118）walks up 找存在 ancestor（`/fake/p`→`/`），对不存在路径容错；测试 `project_path='/fake/p'` + `scene_path='res://scene.tscn'`（normalizeUserProjectPath 去 `res://` → `scene.tscn`，resolveWithinRoot relative `scene.tscn` 不 `..` 通过）
- **不改**：helper 公共 API / C5 + C5 follow-up 已包装工具 / ui rule NON_PERSIST / ui_* 工具描述 / theme 操作行为
- **验证命令**：`npx tsc --noEmit` / `npx vitest run test/persistence-warning.test.ts` / `npx vitest run`

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `src/tools/ui/index.ts` | Modify `:9` import + 新增 `UI_PERSIST_ACTIONS` + `:432` 返回点 | 6 Control action 加提示，theme/query/落盘不加 |
| `test/persistence-warning.test.ts` | Modify 顶部 import + 末尾追加 2 个 describe | 正向（ui_create_control + ui_build_layout）+ 反向（ui_get_layout/ui_set_theme/theme_create/theme_set_property/落盘×2）|

---

## Task 1: ui_* 包装 + 正向测试

**Files:**
- Modify: `src/tools/ui/index.ts:9`（import 行加 `appendRuntimePersistWarning`）
- Modify: `src/tools/ui/index.ts`（`handleTool` `:209` 前新增 `UI_PERSIST_ACTIONS`）
- Modify: `src/tools/ui/index.ts:432`（返回点 Set 过滤）
- Test: `test/persistence-warning.test.ts`（顶部加 import + 末尾加 describe）

**Interfaces:**
- Consumes: `appendRuntimePersistWarning` from `'../shared.js'`（C5 已 re-export）；`action` 变量（`ui/index.ts:214` `const action = args.action as string`）
- Produces: `handleTool('ui', {action:'ui_create_control',...}, ctx)` 成功路径返回 `content[1]` 含 `⚠ ui_create_control ...`；theme/query action 返回不含 `⚠`

- [ ] **Step 1: 写失败测试（顶部 import + 末尾 describe）**

在 `test/persistence-warning.test.ts` 现有 import 区（`materialHandle` import 之后）追加：
```ts
import { handleTool as uiHandle } from '../src/tools/ui/index.js';
```

文件末尾追加：
```ts
// ─── ui_* follow-up Task 1: Control 包装 + 正向 ─────────────────────────────

describe('follow-up: ui Control action 包装 + 正向', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ui_create_control: content[0] 可 JSON.parse + content[1] 含 ⚠ + ui_create_control', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', node_type: 'Label', node_name: 'TestLabel' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    expect(() => JSON.parse(textOf(result, 0))).not.toThrow();
    expect(textOf(result, 0)).not.toContain('⚠');
    const warning = result!.content.find(
      (el, i): el is { type: 'text'; text: string } => i > 0 && isTextContent(el) && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('ui_create_control');
  });

  it('ui_build_layout（批量，非主 action 防 Set 写漏）: content[1] 含 ⚠ + ui_build_layout', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', parent_path: 'root', tree: { type: 'VBoxContainer', name: 'TestVBox' } },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const warning = result!.content.find(
      (el, i): el is { type: 'text'; text: string } => i > 0 && isTextContent(el) && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('ui_build_layout');
  });
});
```

> 注：用 C5 follow-up Task 6 加的 `textOf`/`isTextContent` helper（已存在）收窄 content 类型。`createMockCtx` 已存在。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/persistence-warning.test.ts -t "ui Control"`
Expected: FAIL（ui_create_control/ui_build_layout 无 warning，`warning` 为 undefined）

- [ ] **Step 3: 改 import（`:9`）**

`src/tools/ui/index.ts:9` 原：
```ts
import { normalizeNodePath, sanitizeResPath, opsErrorResult, parseGdscriptResult, NON_PERSIST } from '../shared.js';
```
改为（末尾加 `appendRuntimePersistWarning`）：
```ts
import { normalizeNodePath, sanitizeResPath, opsErrorResult, parseGdscriptResult, NON_PERSIST, appendRuntimePersistWarning } from '../shared.js';
```

- [ ] **Step 4: 新增 UI_PERSIST_ACTIONS（`handleTool` `:209` 之前插入）**

在 `src/tools/ui/index.ts` 的 `export async function handleTool(`（`:209`）之前插入模块级常量：
```ts
// follow-up C5: Control 创造/改节点树（headless 退出丢失）→ 加提示；ui_get_layout 查询 +
// ui_set_theme/theme_create/theme_set_property（Theme 资源，C5 文案 add_node 错位）不加。
const UI_PERSIST_ACTIONS = new Set(['ui_create_control', 'ui_set_layout', 'ui_anchor_preset', 'ui_container_add', 'ui_draw_recipe', 'ui_build_layout']);

```

- [ ] **Step 5: 改返回点（`:432`）**

`src/tools/ui/index.ts:432` 原：
```ts
    return parseGdscriptResult(result, [], errorMapper);
```
改为：
```ts
    const r = parseGdscriptResult(result, [], errorMapper);
    return UI_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, action) : r;
```

> 注：`action` 变量在 `:214`（`const action = args.action as string`），`:432` 作用域可见（同 handleTool 函数内）。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run test/persistence-warning.test.ts -t "ui Control"`
Expected: PASS（ui_create_control/ui_build_layout 含 ⚠ + action 名）

- [ ] **Step 7: commit**

```bash
git add src/tools/ui/index.ts test/persistence-warning.test.ts
git commit -m "feat(ui): 6 Control action 返回追加 C5 提示（Set 过滤，theme/query 不加）"
```

---

## Task 2: 反向测试覆盖（防机械套模式回归）

**Files:**
- Test: `test/persistence-warning.test.ts`（末尾加 describe）
- 不改 `src/tools/ui/index.ts`（Task 1 已包装）

**Interfaces:**
- Produces: 锁定 theme 操作（ui_set_theme/theme_create/theme_set_property）+ 查询（ui_get_layout）+ 持久化（ui_set_theme save/theme_create save_path）返回不含 `⚠`；未来误把这些加进 `UI_PERSIST_ACTIONS` 则测试失败

> **说明**：Task 1 包装后，反向 case 应 PASS（这些 action 不在 Set）。本 Task 是回归保护，非 TDD（无 RED→GREEN，是反向覆盖确认）。

- [ ] **Step 1: 写反向测试**

文件末尾追加：
```ts
// ─── ui_* follow-up Task 2: theme/query/落盘反向（不加，防回归）──────────────

describe('follow-up: ui theme/query/落盘 action 不加提示', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // 查询
  it('ui_get_layout（查询）: 返回不含 ⚠', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', node_path: 'root/X' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el) => (isTextContent(el) ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  // theme（文案错位，整体不加）
  it('ui_set_theme theme_action=create（theme）: 返回不含 ⚠', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', node_path: 'root/X', theme_action: 'create' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el) => (isTextContent(el) ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  it('theme_create theme_create_action=create（theme）: 返回不含 ⚠', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', theme_create_action: 'create' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el) => (isTextContent(el) ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  it('theme_set_property（theme）: 返回不含 ⚠', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', theme_node_path: 'root/X', item_type: 'color', prop_name: 'font_color', value: '#ffffff' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el) => (isTextContent(el) ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  // 持久化（真落盘，不加防误导）
  it('ui_set_theme theme_action=save（持久化 ResourceSaver）: 返回不含 ⚠', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', node_path: 'root/X', theme_action: 'save', theme_path: 'res://t.tres' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el) => (isTextContent(el) ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });

  it('theme_create save_path（持久化 ResourceSaver）: 返回不含 ⚠', async () => {
    const result = await uiHandle(
      'ui',
      { project_path: '/fake/p', scene_path: 'res://scene.tscn', theme_create_action: 'create', save_path: 'res://t.tres' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el) => (isTextContent(el) ? el.text : '')).join('');
    expect(allText).not.toContain('⚠');
  });
});
```

> 注：`uiHandle`/`createMockCtx`/`isTextContent` 已在 Task 1 + C5 follow-up 引入。反向 args 字段名已按 case 区核实（theme_action/theme_create_action/theme_path/save_path/theme_node_path/item_type/prop_name/value）。

- [ ] **Step 2: 跑测试确认通过（反向覆盖，Task 1 包装后应 PASS）**

Run: `npx vitest run test/persistence-warning.test.ts -t "theme/query/落盘"`
Expected: PASS（6 反向 case 均不含 ⚠——这些 action 不在 UI_PERSIST_ACTIONS）

- [ ] **Step 3: commit**

```bash
git add test/persistence-warning.test.ts
git commit -m "test(ui): theme/query/落盘反向锁定不加 C5 提示（防回归）"
```

---

## 最终验证（全任务完成后）

- [ ] **Step 1: 类型绿**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 2: persistence-warning 全绿**

Run: `npx vitest run test/persistence-warning.test.ts`
Expected: 全 PASS（C5 + C5 follow-up + ui_* 正向/反向）

- [ ] **Step 3: 全量回归**

Run: `npx vitest run`
Expected: 全 PASS（ui_* 现有测试若断言 content 结构/length，包装 Control 成功路径后 content 多 warning，可能需同步——此处会抓）

- [ ] **Step 4: 反向防回归 grep 守卫**

Run（确认不加 action 返回路径无 helper 调用，单返回点 Set 过滤已隔离）:
```bash
grep -n "appendRuntimePersistWarning" src/tools/ui/index.ts
```
Expected: 恰好 2 处（`:9` import + `:432` Set 过滤返回点）。theme/query/落盘 action 不在 Set，走 `: r` 分支不加。

---

## Self-Review

**1. Spec coverage**（spec 各节 → task 映射）：
- spec §1 范围表（6 Control 加 / ui_get_layout 查询不加 / ui_set_theme+theme_create+theme_set_property theme 不加）→ Task 1（6 Control Set）+ Task 2（反向覆盖 query/theme/落盘）✅
- spec §2 方案 A（单返回点 Set 过滤，helper 不改）→ Task 1 Step 4-5（UI_PERSIST_ACTIONS + :432）✅
- spec §3 包装位置（:9 import / :209 前 Set / :432 返回点）→ Task 1 Step 3-5 ✅
- spec §4 测试（正向 ≥2 + 反向 6）→ Task 1 正向 2（ui_create_control + ui_build_layout）+ Task 2 反向 6 ✅
- spec 持久化路径（ui-theme.ts:58/141 ResourceSaver）→ Task 2 反向 ui_set_theme save + theme_create save_path ✅
- spec 验证步骤 1-4 → 最终验证 Step 1-4 ✅

**2. Placeholder scan**: 无 TBD/TODO/"add appropriate"。所有代码块完整。Task 2 是反向覆盖（非"待实现"），有完整 args + 断言。

**3. Type consistency**: `appendRuntimePersistWarning(result, action)` 签名一致；`UI_PERSIST_ACTIONS` Set 名与引用一致；`textOf`/`isTextContent`（C5 follow-up Task 6 引入）复用；`action` 变量 `:214` 在 `:432` 可见。

**潜在执行风险（执行者留意）**：
- **ui_build_layout tree 结构**：测试用最小 `{type:'VBoxContainer', name:'TestVBox'}`。VBoxContainer 在 CONTROL_TYPES（ui rule 列）。若 genUiBuildLayoutScript 校验更多字段，参考 `src/tools/ui/ui-layout.ts:490` genUiBuildLayoutScript + types.ts UiNodeSpec 调整。
- **resolveWithinRoot scene_path**：`/fake/p` 不存在但 safeRealPath walks up 到 `/` 容错（path-utils.ts:118-141），resolveWithinRoot relative `scene.tscn` 不 `..` 通过。若实际抛（环境差异），改 scene_path 为 projectPath 下相对或 mock resolveWithinRoot。
- **uiHandle import**：从 `'../src/tools/ui/index.js'`（直接 ui/index.ts handleTool）。`ui-tools.js` 是 re-export shim（→ `./ui/index.js`），等价。
- **mock 复用**：executeGdscriptTrusted mock 在 C5 follow-up Task 4 已加（SUCCESS_RESULT），ui 用 executeGdscriptTrusted，复用。若 mock 缺失，参考 persistence-warning.test.ts:12 vi.mock 加 executeGdscriptTrusted。
