# open_scene MCP 死映射修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 scene 工具 `open_scene` action 真正可用（接线 TS 入口，解除"editor-method-map 有映射但 scene 工具没接"的死映射）。

**Architecture:** 纯 TS 接线修复——GD 端（command_handler 路由 + scene_commands.handle_open_scene）、editor-method-map 映射、static-grep drift check、editor-method-map 单测全已就绪。仅 scene 工具 TS 入口（ACTIONS enum + handleTool switch + actionRisks）缺 open_scene。editor 模式由 editor-method-map 提前拦截走 command_handler（不进 TS case）；TS case 只服务 headless，返 `EDITOR_ONLY`（无 EditorInterface 无"活动场景"概念）。

**Tech Stack:** TypeScript、vitest、Godot 4.x editor plugin（GD 端已就绪，本计划不动 .gd）。

## Global Constraints

- GD 端零改动（`command_handler.gd:106` 路由 / `scene_commands.gd:26` handle_open_scene / `editor-method-map.ts:62` / `static-grep.ts:68` 全已就绪）
- 纯 TS 改动 3 处：`src/tools/scene/helpers.ts`、`src/tools/scene/index.ts`（两处）
- `opsErrorResult('EDITOR_ONLY', …)` 是既有惯例（`asset-ops.ts:171`、`test-framework.ts:79`）
- 发版门禁：`tsc --noEmit` exit 0 + `vitest run` 全绿
- 项目规则：编辑 .gd 须 MCP edit_script（本计划不动 .gd，N/A）

---

## File Structure

- **Modify** `src/tools/scene/helpers.ts` — `ACTIONS` 数组加 `'open_scene'`（action enum 注册，解除协议层拒绝）
- **Modify** `src/tools/scene/index.ts` — `handleTool` switch 加 `case 'open_scene'`（headless 返 EDITOR_ONLY）；`TOOL_META.actionRisks` 加 `open_scene: 'write'`
- **Create** `test/tools/scene-open-scene.test.ts` — open_scene headless 返 EDITOR_ONLY 单测（仿 `test/tools/asset-ops.test.ts` 模式：`textOf` helper + `NO_CTX`）

---

## Task 1: 接线 open_scene（TDD）

**Files:**
- Create: `test/tools/scene-open-scene.test.ts`
- Modify: `src/tools/scene/helpers.ts:9-16`（ACTIONS）
- Modify: `src/tools/scene/index.ts:377-379` 附近（switch case）+ `:418-423`（actionRisks）

**Interfaces:**
- Consumes: `handleTool(name, args, ctx)` 签名（`src/tools/scene/index.ts:114`，`name !== 'scene'` 返 null）；`opsErrorResult(code, message)` from `../shared.js`
- Produces: scene 工具识别 `action: 'open_scene'`，headless 返 `{ isError: true, content: [{text: '…EDITOR_ONLY…'}] }`

- [ ] **Step 1: 写失败测试**

创建 `test/tools/scene-open-scene.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { handleTool } from '../../src/tools/scene/index.js';
import type { ToolResult } from '../../src/types.js';

// content[0].text TS union（TextContent|ImageContent|...）未窄化 → helper 窄化（同 asset-ops.test.ts 模式）
function textOf(r: ToolResult | null): string {
  if (!r || !r.content || !r.content[0]) return '';
  const c = r.content[0] as { text?: string };
  return c.text ?? '';
}

// open_scene 是 editor-only：TS case 不读 ctx，直接返 EDITOR_ONLY
const NO_CTX = {} as never;

describe('scene handleTool — open_scene', () => {
  it('open_scene 在 headless ctx 返 EDITOR_ONLY（editor-only action）', async () => {
    const r = await handleTool(
      'scene',
      { action: 'open_scene', scene_path: 'res://scenes/main.tscn' },
      NO_CTX,
    );
    expect(r?.isError).toBe(true);
    expect(textOf(r)).toContain('EDITOR_ONLY');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/tools/scene-open-scene.test.ts`
Expected: FAIL —— 当前 `action: 'open_scene'` 落 switch `default`（`scene/index.ts:407`）返 `UNKNOWN_ACTION: Unknown action: open_scene`，`textOf(r)` 不含 `EDITOR_ONLY`，`isError` 虽为 true 但断言 `'EDITOR_ONLY'` 子串失败。

- [ ] **Step 3: helpers.ts ACTIONS 加 open_scene**

修改 `src/tools/scene/helpers.ts:9-16`，在 `'detach_instance',` 后加一行 `'open_scene',`：

```ts
export const ACTIONS = [
  'read_scene', 'create_scene', 'add_node', 'save_scene', 'load_sprite',
  'quick_scene', 'batch_add_nodes', 'query_scene_tree', 'inspect_node',
  'edit_node', 'remove_node', 'instance_scene', 'set_instance_property', 'detach_instance',
  'open_scene',
  'health_check',
  'merge_scene',
  'create_3d_node', 'commit',
] as const;
```

- [ ] **Step 4: scene/index.ts switch 加 open_scene case**

在 `src/tools/scene/index.ts` 的 `case 'detach_instance': return handleDetachInstance(args);`（:379）之后、`case 'health_check':`（:381）之前插入：

```ts
    case 'open_scene': {
      // editor-only：editor 模式由 editor-method-map 提前拦截走 command_handler.handle_open_scene，
      // headless 无 EditorInterface（无"活动场景"概念）→ 返 EDITOR_ONLY（与 asset 写工具惯例一致）
      return opsErrorResult('EDITOR_ONLY', 'open_scene requires editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin.');
    }
```

- [ ] **Step 5: scene/index.ts actionRisks 加 open_scene**

修改 `src/tools/scene/index.ts:418-423` 的 `actionRisks`，在 `commit: 'write',` 后加 `open_scene: 'write',`：

```ts
      read_scene: 'read', query_scene_tree: 'read', inspect_node: 'read', health_check: 'read',
      create_scene: 'write', quick_scene: 'write', add_node: 'write', batch_add_nodes: 'write',
      edit_node: 'write', save_scene: 'write', load_sprite: 'write', instance_scene: 'write',
      set_instance_property: 'write', detach_instance: 'write', create_3d_node: 'write', commit: 'write',
      open_scene: 'write',
      remove_node: 'destructive', merge_scene: 'destructive',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
```

- [ ] **Step 6: 跑测试验证通过**

Run: `npx vitest run test/tools/scene-open-scene.test.ts`
Expected: PASS（1 test passed）—— `case 'open_scene'` 命中返 EDITOR_ONLY，`isError===true` 且 text 含 `EDITOR_ONLY`。

- [ ] **Step 7: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0（`ACTIONS` 加项后 `satisfies Record<typeof ACTIONS[number], RiskLevel>` 仍完备——open_scene 已在 actionRisks 登记，无类型漏洞）。

- [ ] **Step 8: commit**

```bash
git add test/tools/scene-open-scene.test.ts src/tools/scene/helpers.ts src/tools/scene/index.ts
git commit -m "fix(scene): open_scene 接线 ACTIONS/switch/actionRisks（TS 入口死映射）

editor-method-map 登记 scene.open_scene 但 scene 工具 ACTIONS/handleTool/actionRisks
未接 → action 被协议层 enum 拒/落 default UNKNOWN_ACTION。GD 端全就绪，仅缺 TS 入口。
TS case headless 返 EDITOR_ONLY（editor 模式被 editor-method-map 提前拦截走 command_handler）。
反馈库 🔴→🟢（插件反馈与改进建议.md:139）。"
```

---

## Task 2: 全量验证 + 反馈库闭环

**Files:**
- Verify: 全量测试套件
- Modify（本仓库外）: `D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md:139`（状态 🔴→🟢）

**Interfaces:**
- Consumes: Task 1 的 3 处改动 + 新测试

- [ ] **Step 1: vitest 全量**

Run: `npx vitest run`
Expected: 全绿（3707→3708 passed，新增 1 个 open_scene 测试；16 skipped 不变）。关注 `test/core/editor-method-map.test.ts`（`scene.open_scene → open_scene` 仍通过）+ `test/capability/static-grep.test.ts`（drift check 仍通过，open_scene 已在 ROUTING）。

- [ ] **Step 2: 确认 GD drift check 无新红（GD 零改动，应无变化）**

Run: `npm run check:gdscript`
Expected: errors=0（本计划不动 .gd；`static-grep.ts` EDITOR_COMMAND_ROUTING 已含 open_scene，无新 drift）。

- [ ] **Step 3: 更新反馈库状态（Obsidian vault，本仓库外）**

修改 `D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md` 第 139 行那条反馈：
- 标题 `🔴 2026-07-11 · open_scene MCP 死映射…` → `🟢 2026-07-11 · open_scene MCP 死映射…`
- 「修复建议（上游，未修）」段改为「修复（上游）：ACTIONS + switch case（headless 返 EDITOR_ONLY）+ actionRisks，commit `<hash>`」
- 加「状态：🟢 fixed commit `<hash>`（fix/open-scene-routing，未 push）」

- [ ] **Step 4: 可选 — editor E2E 手动验证（反馈原场景）**

需 editor 运行（本上游仓库或 messenger-godot 项目）。`launch_editor` → `scene open_scene scene_path=res://scenes/gameplay_island.tscn`（或项目实际场景）→ 确认活动场景切换。GD 端 handle_open_scene 已就绪 + editor-method-map 已映射，TS 接线后 editor 模式自动走该路径。**此步为 eyeball 确认，非阻塞**（单测 + 全量 vitest 已覆盖逻辑正确性）。

---

## Self-Review

**1. Spec coverage：** spec 的 3 处改动 → Task 1 Step 3/4/5；验证（单测 + tsc + vitest + check:gdscript）→ Task 1 Step 6/7 + Task 2 Step 1/2；editor E2E → Task 2 Step 4；反馈库闭环 → Task 2 Step 3。✓ 全覆盖。

**2. Placeholder scan：** 无 TBD/TODO；测试代码完整；3 处改动代码完整（含上下文行）；commit message 完整。✓

**3. Type consistency：** `handleTool(name, args, ctx)` 签名一致；`opsErrorResult('EDITOR_ONLY', …)` 与 asset-ops.ts 惯例一致；`actionRisks` 的 `open_scene: 'write'` 与 `RiskLevel` 类型一致；`ACTIONS` 加 `'open_scene'` 后 `satisfies Record<typeof ACTIONS[number], RiskLevel>` 仍完备（actionRisks 同步加了 open_scene）。✓
