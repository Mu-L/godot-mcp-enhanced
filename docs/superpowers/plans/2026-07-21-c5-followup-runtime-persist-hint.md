# C5 follow-up 运行时持久化提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给剩余 5 个运行时工具（node-3d / physics / navigation / material）的"修改运行时节点树/资源属性"类 action 追加 C5 不持久化提示；recording 整工具不包装。

**Architecture:** 方案 A——调用处 `Set` 过滤。helper `appendRuntimePersistWarning(result, action)` 已存在（C5 `cee9477`），公共 API 零改动。每个多 action 工具定义 `*_PERSIST_ACTIONS = new Set([...])`，在公共返回点条件包装；node-3d 唯一创造 action 无条件包装；recording 不动。文案复用 helper 现有（不改 `runtimePersistWarning`）。

**Tech Stack:** TypeScript / vitest / godot-mcp-enhanced（`src/tools/*.ts` + `test/persistence-warning.test.ts`）

## Global Constraints

- **helper 不改**：`appendRuntimePersistWarning(result: ToolResult, action: string): ToolResult`（`src/tools/shared/persistence-warning.ts:18`），从 `./shared.js` 导入（barrel 已 re-export，C5 已验证）
- **action 名前缀**：`node_create_3d` / `physics_<action>` / `nav_<action>` / `material_<action>`（手动加工具前缀，与 C5 惯例一致）
- **加提示判据**：修改运行时节点树/资源属性→加；只读查询→不加；真落盘（`ResourceSaver`/`FileAccess WRITE`）→不加；recording 文案错位特例→不加
- **actionRisks ≠ 判据**：`TOOL_META.actionRisks: 'write'` 不等于加提示（`material save`/`shader_save_file` 也标 `'write'` 但落盘不加）；判据始终以"修改运行时节点树/资源属性"为准
- **executor 差异**：node-3d/physics/nav 用 `executeGdscript`；material 用 `executeGdscriptTrusted`（`material-ops.ts:776`），包装在 `parseGdscriptResult` 之后不受影响
- **不改**：recording.ts 整文件 / helper 公共 API / C5 已包装的 5 工具（audio/particles/signal/tilemap/animation）/ 工具描述里的 `NON_PERSIST`
- **验证命令**：`npx tsc --noEmit`（类型绿，test/ 目录 excluded 但 tsc 仍扫）/ `npx vitest run test/persistence-warning.test.ts` / `npx vitest run`（全量回归）

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `src/tools/node-3d-ops.ts` | Modify `:6` import + `:166` 返回点 | node_create_3d 无条件包装（唯一创造 action） |
| `src/tools/physics-ops.ts` | Modify `:7` import + 新增 `PHYSICS_PERSIST_ACTIONS` + `:442` 返回点 | collision_overlay 加，其余 4 只读 action 不加 |
| `src/tools/navigation.ts` | Modify `:7` import + 新增 `NAV_PERSIST_ACTIONS` + `:483` 返回点 | 5 创造 action 加，query_path 不加 |
| `src/tools/material-ops.ts` | Modify `:8` import + 新增 `MAT_PERSIST_ACTIONS` + `:784` 返回点 | 6 action 加（含 load/shader_load_file），save/shader_save_file/read/shader_read/shader_list_templates 不加 |
| `src/tools/recording.ts` | **不改** | 整工具不包装（C5 文案对录制语义错位） |
| `test/persistence-warning.test.ts` | Modify 顶部 import + mock + 末尾追加 4 个 describe | 正向（每工具 ≥2）+ 反向（每工具 ≥2）+ recording 静态保护 |

---

## Task 1: node-3d 包装

**Files:**
- Modify: `src/tools/node-3d-ops.ts:6`（import 行加 `appendRuntimePersistWarning`）
- Modify: `src/tools/node-3d-ops.ts:166-168`（主返回点包装）
- Test: `test/persistence-warning.test.ts`（顶部加 import + 末尾加 describe）

**Interfaces:**
- Consumes: `appendRuntimePersistWarning` from `./shared.js`（C5 已 re-export）
- Produces: `handleTool('node_create_3d', args, ctx)` 成功路径返回 `content[1]` 含 `⚠ node_create_3d ...`

- [ ] **Step 1: 写失败测试（顶部加 import + 末尾加 describe）**

在 `test/persistence-warning.test.ts` 现有 import 区（`:31` `animation-ops` 之后）追加：

```ts
import { handleTool as node3dHandle } from '../src/tools/node-3d-ops.js';
```

在文件末尾（现有 5 工具 describe 之后）追加：

```ts
// ─── follow-up Task 1: node-3d 包装 ──────────────────────────────────────────

describe('follow-up: node-3d node_create_3d 包装', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('node_create_3d: content[0] 可 JSON.parse + content[1] 含 ⚠ + node_create_3d', async () => {
    const result = await node3dHandle(
      'node_create_3d',
      { project_path: '/fake/p', type: 'Node3D', name: 'TestNode' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    // content[0] 仍是合法 JSON，未被 mutate
    expect(() => JSON.parse(result!.content[0].text)).not.toThrow();
    expect(result!.content[0].text).not.toContain('⚠');
    // content[1] 是独立 warning
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('node_create_3d');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/persistence-warning.test.ts -t "node_create_3d"`
Expected: FAIL（返回 content 只有 1 个元素，无 warning；`warning` 为 undefined）

- [ ] **Step 3: 改 import（`:6`）**

`src/tools/node-3d-ops.ts:6` 原：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, gdEscape, normalizeNodePath, validateVector3, TYPE_WHITELIST, validateIdentifier } from './shared.js';
```
改为（末尾加 `appendRuntimePersistWarning`）：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, gdEscape, normalizeNodePath, validateVector3, TYPE_WHITELIST, validateIdentifier, appendRuntimePersistWarning } from './shared.js';
```

- [ ] **Step 4: 改返回点（`:166-168`）**

`src/tools/node-3d-ops.ts:166-168` 原：
```ts
    return parseGdscriptResult(result, [], errorMapper, {
      suggestion: 'Use query_scene_tree to list available nodes, or check the node path spelling.',
    });
```
改为：
```ts
    return appendRuntimePersistWarning(
      parseGdscriptResult(result, [], errorMapper, {
        suggestion: 'Use query_scene_tree to list available nodes, or check the node path spelling.',
      }),
      'node_create_3d',
    );
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/persistence-warning.test.ts -t "node_create_3d"`
Expected: PASS

- [ ] **Step 6: commit**

```bash
git add src/tools/node-3d-ops.ts test/persistence-warning.test.ts
git commit -m "feat(node-3d): node_create_3d 返回追加 C5 不持久化提示"
```

---

## Task 2: physics 包装（Set 过滤 collision_overlay）

**Files:**
- Modify: `src/tools/physics-ops.ts:7`（import 加 `appendRuntimePersistWarning`）
- Modify: `src/tools/physics-ops.ts`（`TOOL_META` 前新增 `PHYSICS_PERSIST_ACTIONS`）
- Modify: `src/tools/physics-ops.ts:442`（返回点 Set 过滤）
- Test: `test/persistence-warning.test.ts`（顶部加 import + 末尾加 describe）

**Interfaces:**
- Consumes: `appendRuntimePersistWarning` from `./shared.js`；`action` 变量（`physics-ops.ts:371` `const action = args.action as string`）
- Produces: `handleTool('physics', {action:'collision_overlay',...}, ctx)` 返回 content[1] 含 `⚠ physics_collision_overlay`；`action:'raycast'`/`'query_spatial'` 返回不含 `⚠`

- [ ] **Step 1: 写失败测试**

顶部 import 区追加：
```ts
import { handleTool as physicsHandle } from '../src/tools/physics-ops.js';
```

文件末尾追加：
```ts
// ─── follow-up Task 2: physics 包装 ──────────────────────────────────────────

describe('follow-up: physics collision_overlay 包装 + 只读 action 不加', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('physics collision_overlay（创造运行时节点树）: content[1] 含 ⚠ + physics_collision_overlay', async () => {
    const result = await physicsHandle(
      'physics',
      { project_path: '/fake/p', action: 'collision_overlay', parent_path: 'root' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    expect(() => JSON.parse(result!.content[0].text)).not.toThrow();
    expect(result!.content[0].text).not.toContain('⚠');
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('physics_collision_overlay');
  });

  // 反向（A3：只读 action 每 Set ≥2，防误加 Set 漏抓）
  it('physics raycast（只读）: 返回不含 ⚠', async () => {
    const result = await physicsHandle(
      'physics',
      { project_path: '/fake/p', action: 'raycast', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });

  it('physics query_spatial（只读）: 返回不含 ⚠', async () => {
    const result = await physicsHandle(
      'physics',
      { project_path: '/fake/p', action: 'query_spatial', position: { x: 0, y: 0, z: 0 } },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/persistence-warning.test.ts -t "physics"`
Expected: FAIL（collision_overlay case：无 warning；反向 raycast/query_spatial 当前也通过——它们本来就无 ⚠，但 collision_overlay 正向失败）

- [ ] **Step 3: 改 import（`:7`）**

`src/tools/physics-ops.ts:7` 原：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, gdEscape, normalizeNodePath, validateVector3 } from './shared.js';
```
改为：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, gdEscape, normalizeNodePath, validateVector3, appendRuntimePersistWarning } from './shared.js';
```

- [ ] **Step 4: 新增 PHYSICS_PERSIST_ACTIONS（`TOOL_META` 声明 `:453` 之前插入）**

在 `src/tools/physics-ops.ts` 的 `// ─── Tool Meta ───` 注释行（`:451`）之前插入：
```ts
// follow-up C5: collision_overlay 创造运行时可视化节点树（genCollisionOverlayScript），
// headless 退出丢失 → 加提示；raycast/body_info/diagnose/query_spatial 只读不加。
const PHYSICS_PERSIST_ACTIONS = new Set(['collision_overlay']);

```

- [ ] **Step 5: 改返回点（`:442`）**

`src/tools/physics-ops.ts:442` 原：
```ts
    return parseGdscriptResult(result, [], errorMapper);
```
改为：
```ts
    const r = parseGdscriptResult(result, [], errorMapper);
    return PHYSICS_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, `physics_${action}`) : r;
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run test/persistence-warning.test.ts -t "physics"`
Expected: PASS（collision_overlay 含 ⚠；raycast/query_spatial 不含）

- [ ] **Step 7: commit**

```bash
git add src/tools/physics-ops.ts test/persistence-warning.test.ts
git commit -m "feat(physics): collision_overlay 返回追加 C5 提示（Set 过滤，只读 action 不加）"
```

---

## Task 3: navigation 包装（Set 过滤 5 创造 action）

**Files:**
- Modify: `src/tools/navigation.ts:7`（import 加 `appendRuntimePersistWarning`）
- Modify: `src/tools/navigation.ts`（新增 `NAV_PERSIST_ACTIONS`）
- Modify: `src/tools/navigation.ts:483`（返回点 Set 过滤）
- Test: `test/persistence-warning.test.ts`

**Interfaces:**
- Consumes: `appendRuntimePersistWarning`；`action` 变量（navigation.ts handleTool 内 `const action = args.action as string`，`:359` 之后）；`paramWarnings` 变量（返回点已用）
- Produces: 5 创造 action 返回含 `⚠ nav_<action>`；query_path 不含

- [ ] **Step 1: 写失败测试**

顶部 import 区追加：
```ts
import { handleTool as navHandle } from '../src/tools/navigation.js';
```

文件末尾追加：
```ts
// ─── follow-up Task 3: navigation 包装 ───────────────────────────────────────

describe('follow-up: navigation 创造 action 包装 + query_path 不加', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('nav create_region: content[1] 含 ⚠ + nav_create_region', async () => {
    const result = await navHandle(
      'nav',
      { project_path: '/fake/p', action: 'create_region', name: 'TestRegion' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    expect(() => JSON.parse(result!.content[0].text)).not.toThrow();
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('nav_create_region');
  });

  it('nav create_link（非主 action，防 Set 写漏）: content[1] 含 ⚠ + nav_create_link', async () => {
    const result = await navHandle(
      'nav',
      {
        project_path: '/fake/p', action: 'create_link', name: 'TestLink',
        start_position: { x: 0, y: 0, z: 0 }, end_position: { x: 1, y: 0, z: 0 },
      },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('nav_create_link');
  });

  it('nav query_path（只读）: 返回不含 ⚠', async () => {
    const result = await navHandle(
      'nav',
      {
        project_path: '/fake/p', action: 'query_path',
        start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 },
      },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/persistence-warning.test.ts -t "navigation"`
Expected: FAIL（create_region/create_link 无 warning）

- [ ] **Step 3: 改 import（`:7`）**

`src/tools/navigation.ts:7` 原：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, normalizeNodePath, gdEscape, validateVector3 } from './shared.js';
```
改为：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, normalizeNodePath, gdEscape, validateVector3, appendRuntimePersistWarning } from './shared.js';
```

- [ ] **Step 4: 新增 NAV_PERSIST_ACTIONS（handleTool 函数 `:354` 之前插入，模块级常量）**

在 `src/tools/navigation.ts` 的 `export async function handleTool(`（`:354`）之前插入：
```ts
// follow-up C5: 创造/改运行时导航节点树（NavigationRegion3D/Agent3D/Link3D + 烘焙 mesh + 参数）
// → 加提示；query_path 只读不加。
const NAV_PERSIST_ACTIONS = new Set(['create_region', 'bake_mesh', 'create_agent', 'set_params', 'create_link']);

```

- [ ] **Step 5: 改返回点（`:483`）**

`src/tools/navigation.ts:483` 原：
```ts
    return parseGdscriptResult(result, paramWarnings, errorMapper);
```
改为：
```ts
    const r = parseGdscriptResult(result, paramWarnings, errorMapper);
    return NAV_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, `nav_${action}`) : r;
```

> **注意**：确认 `action` 变量在 `:483` 作用域可见（handleTool 内 `const action = args.action as string`，在 try 块顶部声明）。若 `paramWarnings` 变量名不同，保留原变量名。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run test/persistence-warning.test.ts -t "navigation"`
Expected: PASS

- [ ] **Step 7: commit**

```bash
git add src/tools/navigation.ts test/persistence-warning.test.ts
git commit -m "feat(nav): 5 创造 action 返回追加 C5 提示（Set 过滤，query_path 不加）"
```

---

## Task 4: material 包装（Set 过滤 6 action，executeGdscriptTrusted mock）

**Files:**
- Modify: `test/persistence-warning.test.ts:12-24`（顶部 vi.mock 加 `executeGdscriptTrusted`）
- Modify: `src/tools/material-ops.ts:8`（import 加 `appendRuntimePersistWarning`）
- Modify: `src/tools/material-ops.ts`（新增 `MAT_PERSIST_ACTIONS`）
- Modify: `src/tools/material-ops.ts:784`（返回点 Set 过滤）
- Test: `test/persistence-warning.test.ts`（顶部加 import + 末尾加 describe）

**Interfaces:**
- Consumes: `appendRuntimePersistWarning`；`action`（`material-ops.ts:641`）；`materialErrorMapper`（返回点已用）；`executeGdscriptTrusted`（mock）
- Produces: 6 action（create/set_params/shader_write/shader_apply_template/load/shader_load_file）返回含 `⚠ material_<action>`；save/shader_save_file/read/shader_read/shader_list_templates 不含

- [ ] **Step 1: 改顶部 vi.mock 加 executeGdscriptTrusted**

`test/persistence-warning.test.ts:12-24` 原：
```ts
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => ({
    success: true,
    compile_success: true,
    compile_error: '',
    errors: [],
    run_success: true,
    run_error: '',
    outputs: [{ key: 'result', value: '{"ok":true}' }],
    raw_output: '',
    duration_ms: 100,
  })),
}));
```
改为（加 `executeGdscriptTrusted`，返回同结构）：
```ts
const SUCCESS_RESULT = {
  success: true,
  compile_success: true,
  compile_error: '',
  errors: [],
  run_success: true,
  run_error: '',
  outputs: [{ key: 'result', value: '{"ok":true}' }],
  raw_output: '',
  duration_ms: 100,
};

vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => SUCCESS_RESULT),
  executeGdscriptTrusted: vi.fn(async () => SUCCESS_RESULT),
}));
```

> **注意**：`SUCCESS_RESULT` 提到 vi.mock 之前。vi.mock 是 hoisted，但常量对象字面量在工厂函数内引用，vitest 允许（工厂在调用时求值）。若 vitest 报 hoisting 错，改为在工厂内直接内联两个对象字面量（重复而非共享常量）。

- [ ] **Step 2: 写测试（顶部 import + 末尾 describe）**

顶部 import 区追加：
```ts
import { handleTool as materialHandle } from '../src/tools/material-ops.js';
```

文件末尾追加：
```ts
// ─── follow-up Task 4: material 包装（executeGdscriptTrusted） ────────────────

describe('follow-up: material 6 action 包装 + 落盘/只读不加', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('material create: content[1] 含 ⚠ + material_create', async () => {
    const result = await materialHandle(
      'material',
      { project_path: '/fake/p', action: 'create', node_path: 'root/Mesh', material_type: 'StandardMaterial3D' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    expect(() => JSON.parse(result!.content[0].text)).not.toThrow();
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('material_create');
  });

  it('material load（eng-review 修正）: content[1] 含 ⚠ + material_load', async () => {
    const result = await materialHandle(
      'material',
      { project_path: '/fake/p', action: 'load', node_path: 'root/Mesh', resource_path: 'res://m.tres' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    expect(result!.isError).toBeFalsy();
    const warning = result!.content.find(
      (el, i) => i > 0 && el.type === 'text' && el.text.includes('⚠'),
    );
    expect(warning).toBeDefined();
    expect(warning!.text).toContain('material_load');
  });

  // 反向（A3：落盘 + 只读 ≥2）
  it('material save（落盘）: 返回不含 ⚠', async () => {
    const result = await materialHandle(
      'material',
      { project_path: '/fake/p', action: 'save', node_path: 'root/Mesh', resource_path: 'res://m.tres' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });

  it('material read（只读）: 返回不含 ⚠', async () => {
    const result = await materialHandle(
      'material',
      { project_path: '/fake/p', action: 'read', node_path: 'root/Mesh' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });

  it('material shader_read（只读）: 返回不含 ⚠', async () => {
    const result = await materialHandle(
      'material',
      { project_path: '/fake/p', action: 'shader_read', node_path: 'root/Mesh' },
      createMockCtx() as any,
    );
    expect(result).not.toBeNull();
    const allText = result!.content.map((el: any) => el.text ?? '').join('');
    expect(allText).not.toContain('⚠');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/persistence-warning.test.ts -t "material"`
Expected: FAIL（create/load 无 warning；可能 executeGdscriptTrusted 未 mock 导致真实调用——若 Step 1 已加 mock 则不会真实调用）

- [ ] **Step 4: 改 import（`:8`）**

`src/tools/material-ops.ts:8` 原：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult } from './shared.js';
```
改为：
```ts
import { SCENE_TREE_HEADER, NON_PERSIST, opsErrorResult, parseGdscriptResult, appendRuntimePersistWarning } from './shared.js';
```

- [ ] **Step 5: 新增 MAT_PERSIST_ACTIONS（handleTool `:635` 之前插入）**

在 `src/tools/material-ops.ts` 的 `export async function handleTool(`（`:635`）之前插入：
```ts
// follow-up C5: 改运行时 material/shader 属性（含 load/shader_load_file，eng-review 修正）
// → 加提示；save/shader_save_file（落盘）+ read/shader_read/shader_list_templates（只读）不加。
const MAT_PERSIST_ACTIONS = new Set(['create', 'set_params', 'shader_write', 'shader_apply_template', 'load', 'shader_load_file']);

```

- [ ] **Step 6: 改返回点（`:784`）**

`src/tools/material-ops.ts:784` 原：
```ts
    return parseGdscriptResult(result, [], materialErrorMapper);
```
改为：
```ts
    const r = parseGdscriptResult(result, [], materialErrorMapper);
    return MAT_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, `material_${action}`) : r;
```

> **注意**：`shader_list_templates` 在 `:645-651` 提前 inline 返回，不走 `:784`，天然不加（无需进 Set）。确认 `action`（`:641`）与 `materialErrorMapper` 在 `:784` 作用域可见。

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run test/persistence-warning.test.ts -t "material"`
Expected: PASS（create/load 含 ⚠；save/read/shader_read 不含）

- [ ] **Step 8: commit**

```bash
git add src/tools/material-ops.ts test/persistence-warning.test.ts
git commit -m "feat(material): 6 action 返回追加 C5 提示（Set 过滤，落盘/只读不加）"
```

---

## Task 5: recording 整工具静态保护（防回归）

**Files:**
- Test: `test/persistence-warning.test.ts`（末尾加静态源码断言 describe）
- 不改 `src/tools/recording.ts`

**Interfaces:**
- Produces: 锁定 recording.ts 不含 `appendRuntimePersistWarning`/`runtimePersistWarning` 调用；未来误加包装则测试失败

> **说明**：recording 整工具不包装（C5 文案对录制语义错位）。start/stop/play 走 bridge client（mock 过重），按 spec §5 降级——用静态源码断言替代端到端 mock，防未来误加包装。

- [ ] **Step 1: 写静态保护测试**

文件末尾追加：
```ts
// ─── follow-up Task 5: recording 整工具不包装（静态保护） ─────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('follow-up: recording 整工具不包装（C5 文案对录制语义错位，spec §1 特例）', () => {
  it('recording.ts 源码不含 appendRuntimePersistWarning / runtimePersistWarning 调用', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/tools/recording.ts'), 'utf8');
    expect(src).not.toContain('appendRuntimePersistWarning');
    expect(src).not.toContain('runtimePersistWarning');
  });

  it('recording save/load/start 反向：handleTool 返回不含 ⚠（若 bridge mock 不可行则保留此静态断言为下限）', async () => {
    // bridge client mock 较重（spec §5 :130 降级）；此 case 用静态源码断言锁定。
    // 若未来接入 bridge mock，可改为 handleTool('recording', {action:'recording_save',...}, ctx) 端到端断言。
    const src = readFileSync(resolve(process.cwd(), 'src/tools/recording.ts'), 'utf8');
    expect(src).not.toMatch(/appendRuntimePersistWarning|runtimePersistWarning/);
  });
});
```

> **注意**：`import { readFileSync }` 放在 describe 块内不符合 ESM 顶层 import 惯例。实际执行时把这两个 `import` 提到文件顶部 import 区（与现有 `import { describe, ... } from 'vitest'` 同区）。此处为可读性就近写出——执行者务必上移到顶部。

- [ ] **Step 2: 跑测试确认通过（recording 本就未包装，此为回归保护）**

Run: `npx vitest run test/persistence-warning.test.ts -t "recording"`
Expected: PASS（recording.ts 当前不含 helper，断言成立）

- [ ] **Step 3: commit**

```bash
git add test/persistence-warning.test.ts
git commit -m "test(recording): 静态锁定整工具不包装 C5 提示（防回归，spec §1 特例）"
```

---

## Task 6: Minor4 — content[0].text 类型收窄（type guard）

**Files:**
- Test: `test/persistence-warning.test.ts`（顶部加 `isTextContent` type guard helper + follow-up 断言用它收窄）

**Interfaces:**
- Produces: `isTextContent(el): el is { type: 'text'; text: string }` type guard，收窄 `ToolResult['content'][number]` union 到 text 元素，消除 `el.text` 在非 text 元素上的 `undefined` 访问

> **说明**：spec §5 :132 Minor4（顺带）。`test/` 目录 excluded 不阻塞构建，但 follow-up 一并做。低优先——不改现有 5 工具断言（避免回归风险），仅给 follow-up 新增断言提供类型安全 helper。

- [ ] **Step 1: 加 type guard helper（顶部 import 区之后）**

在 `test/persistence-warning.test.ts` 现有 `createMockCtx` 函数（`:33`）之前插入：
```ts
// Minor4: 收窄 content 元素 union 到 text 类型，消除 .text 在非 text 元素上的 undefined 访问
function isTextContent(el: ToolResult['content'][number]): el is { type: 'text'; text: string } {
  return el.type === 'text';
}

function textOf(result: ToolResult | null, index: number): string {
  if (!result || !result.content[index] || !isTextContent(result.content[index])) {
    throw new Error(`content[${index}] is not a text element`);
  }
  return result.content[index].text;
}
```

> **可选优化**：把 follow-up Task 1-4 的 `result!.content[0].text` 与 `.find((el, i) => ... && el.text.includes('⚠'))` 改用 `textOf(result, 0)` / `isTextContent` guard 收窄。本步仅引入 helper，不改现有断言（保持最小改动）；若要全面收窄，在 Task 1-4 的断言里替换 `result!.content[0].text` → `textOf(result, 0)`。

- [ ] **Step 2: 跑全量测试确认 helper 引入无回归**

Run: `npx vitest run test/persistence-warning.test.ts`
Expected: PASS（helper 引入不影响现有断言）

- [ ] **Step 3: commit**

```bash
git add test/persistence-warning.test.ts
git commit -m "test(Minor4): 加 isTextContent/textOf type guard 收窄 content 元素类型"
```

---

## 最终验证（全任务完成后）

- [ ] **Step 1: 类型绿**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 2: persistence-warning 全绿**

Run: `npx vitest run test/persistence-warning.test.ts`
Expected: 全 PASS（现有 5 工具 + helper 单元 + follow-up 正向/反向/recording 静态/Minor4）

- [ ] **Step 3: 全量回归**

Run: `npx vitest run`
Expected: 全 PASS（C5 已包装 5 工具断言不破坏——包装成功路径 content 多一个 warning 元素，若现有其他测试断言 content length/结构需同步，此处会抓）

- [ ] **Step 4: 反向防回归 grep 守卫**

Run（确认不加 action 返回路径无 helper 调用）:
```bash
grep -n "appendRuntimePersistWarning" src/tools/recording.ts
grep -n "save\|read\|raycast\|query_path" src/tools/material-ops.ts src/tools/physics-ops.ts src/tools/navigation.ts | grep -i "appendRuntimePersistWarning"
```
Expected: recording.ts 0 命中；material save/read、physics raycast、nav query_path 的返回路径无 `appendRuntimePersistWarning`（仅在 Set 过滤的公共返回点出现，非这些 action 的专属路径）

---

## Self-Review

**1. Spec coverage**（spec 各节 → task 映射）:
- spec §1 范围表（node-3d create / physics collision_overlay / nav 5 / material 6 加；recording 不加）→ Task 1-5 ✅
- spec §2 方案 A（调用处 Set，helper 不改）→ Task 2-4 Set + Task 1 无 Set（唯一 action）✅
- spec §3 包装位置（5 工具精确行号）→ Task 1 :166 / Task 2 :442 / Task 3 :483 / Task 4 :784 / Task 5 不动 ✅
- spec §4 文案与命名（action 前缀）→ 各 Task 传 `'<tool>_<action>'` ✅
- spec §5 测试（正向每工具 ≥2 / 反向每工具 ≥2 / recording 静态 / Minor4）→ Task 1-6 ✅
- spec §1 A1（actionRisks ≠ 判据）→ Global Constraints 说明 ✅
- spec §5 A3（反向 ≥2 对称）→ Task 2 physics（raycast+query_spatial）/ Task 4 material（save+read+shader_read）✅
- spec 验证步骤 1-4 → 最终验证 Step 1-4 ✅

**2. Placeholder scan**: 无 TBD/TODO/"add appropriate"。所有代码块完整。recording Task 5 的 bridge mock 降级有明确静态断言替代，非"待实现"。

**3. Type consistency**: `appendRuntimePersistWarning(result, action)` 签名全 Task 一致；`action` 变量各工具均在返回点作用域可见（已注明核实点）；Set 名 `PHYSICS_PERSIST_ACTIONS`/`NAV_PERSIST_ACTIONS`/`MAT_PERSIST_ACTIONS` 与引用处一致。

**潜在执行风险（执行者留意）**:
- **args 结构**：各 Task 测试 args（如 physics collision_overlay 的 `parent_path`、material create 的 `material_type`）基于源码推断。若 handleTool 参数校验报错，参考对应工具 schema（`physics-ops.ts:371+` / `material-ops.ts:641+` / `navigation.ts:359+`）调整字段名。
- **vi.mock hoisting**：Task 4 Step 1 的 `SUCCESS_RESULT` 常量提到 vi.mock 前，若 vitest hoisting 报错，内联两个对象字面量。
- **import 位置**：Task 5 的 `readFileSync`/`resolve` import 务必上移到文件顶部。
- **material executeGdscriptTrusted**：确认 mock 生效（material-ops.ts:776 调用被拦截），否则真实 spawn Godot 导致测试失败/慢。
