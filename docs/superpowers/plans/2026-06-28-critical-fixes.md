# R3 CRITICAL 修复实施计划（detach-instance + confirm-token）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 R3 审查的 2 个既有 CRITICAL——detach-instance 首 node 是 instance 时 sub_resource 丢失（场景损坏）+ confirm-token TTL/硬编码漂移/GUARDED 缺口。

**Architecture:** 3 处源码改动 + 配套回归测试 + defects 知识库同步。纯 bugfix，无新模块。改动 1 修 `tscn-editor-detach.ts` 循环分支互斥；改动 2 收紧 confirm-token TTL 并消除 ToolDispatcher 硬编码；改动 3 扩 GUARDED 表覆盖 workflow/validation/manage_tools 写操作。

**Tech Stack:** TypeScript（src）、vitest（test，.js/.ts 混用）、Godot .tscn 文本处理。

## Global Constraints

- 项目 root：`D:\GitHub\godot-mcp-enhanced`；master 直接提交（单人本地领先工作流，**不 push**）
- commit message 中文 + 尾部 `Co-Authored-By: Claude <noreply@anthropic.com>`
- TDD：先写失败测试 → 实现 → 通过 → 提交
- 单测命令：`npx vitest run <file> -t "<test name>"`（单个）/ `npm test`（全量）
- tsc 检查：`npx tsc --noEmit`
- .ts 文件用内置 Edit 工具（非 .gd，不走 MCP edit_script）
- 同文件多处 Edit 必须**串行**（见 memory `gateguard-parallel-edit-halfchanged`）
- defects 知识库 `D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md` **不在项目 repo**，其修改不进项目 commit
- spec：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-28-critical-fixes-design.md`

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `src/tscn/tscn-editor-detach.ts` | detachInstance 循环（:486-494） | 改动 1：首 node 是 instance 时补插 sub_resources |
| `src/guard.ts` | `TOKEN_TTL_MS`（:14）+ `GUARDED` 表（:52-75） | 改动 2：TTL 60s + export；改动 3：GUARDED 加 3 行 |
| `src/core/ToolDispatcher.ts` | confirm 响应（:328） | 改动 2：`ttl_seconds` 引用常量 + import |
| `test/tscn-editor.test.js` | detachInstance 测试 | 改动 1：3 fixtures + 2 回归用例 |
| `test/guard.test.js` | requiresConfirmation / TOKEN_TTL 测试 | 改动 2：TOKEN_TTL_MS 断言；改动 3：8 action true/false |
| `test/core/ToolDispatcher.test.ts` | confirm 流程测试 | 改动 2：[T10] 加 ttl_seconds 断言 |
| `defects.md`（review repo） | 知识库 | 4 条 status/fix-forward 同步（不进项目 commit） |

---

## Task 1: detach-instance 首 node 是 instance 时补插 sub_resources（CRITICAL-2）

**Files:**
- Modify: `src/tscn/tscn-editor-detach.ts:486-494`
- Test: `test/tscn-editor.test.js`

**Interfaces:**
- Consumes: `detachInstance(targetTscn: string, sourceTscn: string, nodeName: string, parent: string): string`（既有签名，不变）
- Produces: 修复后首 node 是 instance 时输出含 `[sub_resource]` 段；常规情况 sub_resources 仍插在所有 `[node]` 之前（:497 保留）

- [ ] **Step 1: 写 fixtures + 失败/防回归测试**

在 `test/tscn-editor.test.js` 的 fixtures 区（`SOURCE_WITH_EXT_CONFLICT` 常量定义之后、`// ── findInstanceNode` 注释之前）追加 3 个 fixture：

```js
// CRITICAL-2 回归: 首 [node] 就是 instance + 源场景含 SubResource
const TARGET_FIRST_NODE_IS_INSTANCE = `[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" uid="uid://ui1" path="res://scenes/ui.tscn" id="1"]

[node name="UI" parent="." instance=ExtResource("1")]
`;

const SOURCE_WITH_SUBRESOURCE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ui.gd" id="1"]

[sub_resource type="StyleBoxFlat" id="1"]
bg_color = Color(1, 0, 0, 1)

[node name="UI" type="Control"]
theme_override_styles/panel = SubResource("1")
`;

// 常规情况: 首 [node] 非 instance + 源场景含 SubResource(防 :497 误删回归)
const TARGET_NORMAL_WITH_SUBRESOURCE = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" uid="uid://ui1" path="res://scenes/ui.tscn" id="1"]

[node name="Main" type="Node2D"]

[node name="UI" parent="." instance=ExtResource("1")]
`;
```

在 `describe('tscn-editor detachInstance', ...)` 块**末尾**（最后一个 `it(...)` 之后、闭合 `});` 之前）追加 2 个用例：

```js
  it('CRITICAL-2: inserts sub_resources when first [node] is the instance', () => {
    const result = detachInstance(TARGET_FIRST_NODE_IS_INSTANCE, SOURCE_WITH_SUBRESOURCE, 'UI', '.');

    // 修复前: sub_resource 丢失(输出含 SubResource 引用却无 [sub_resource] 段)
    expect(result.includes('[sub_resource')).toBe(true);
    // SubResource 引用 id 应与 remapped [sub_resource] id 对得上(target 无 sub_resource, remap 从 1 起)
    const subMatch = result.match(/\[sub_resource type="StyleBoxFlat" id="(\d+)"\]/);
    expect(subMatch).not.toBeNull();
    const subId = subMatch[1];
    expect(result.includes(`SubResource("${subId}")`)).toBe(true);
  });

  it('CRITICAL-2 regression: sub_resources precede all [node] sections in normal case (guards :497)', () => {
    const result = detachInstance(TARGET_NORMAL_WITH_SUBRESOURCE, SOURCE_WITH_SUBRESOURCE, 'UI', '.');

    // 常规情况(firstNodeIdx < lineIndex): sub_resources 必须由 :497 插在所有 [node] 之前(前向声明)
    const subIdx = result.indexOf('[sub_resource');
    const firstNodeIdx = result.indexOf('[node');
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(firstNodeIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeLessThan(firstNodeIdx);  // 删 :497 会令 subIdx > firstNodeIdx, 测试失败
  });
```

- [ ] **Step 2: 运行验证——首个用例失败，常规用例通过**

Run: `npx vitest run test/tscn-editor.test.js -t "CRITICAL-2"`
Expected: `inserts sub_resources when first [node] is the instance` **FAIL**（`result.includes('[sub_resource')` 为 false）；`sub_resources precede all [node] sections` **PASS**（:497 当前存在）

- [ ] **Step 3: 写修复**

Edit `src/tscn/tscn-editor-detach.ts`。将 `:486-494` 的 instance 跳过分支：

```ts
    if (i >= info.lineIndex && i < instanceEndIdx) {
      if (!insertedExpanded) {
        for (const expLine of expandedLines) {
          cleanResult.push(expLine);
        }
        insertedExpanded = true;
      }
      continue;
    }
```

替换为（在 push expandedLines 前补插 sub_resources）：

```ts
    if (i >= info.lineIndex && i < instanceEndIdx) {
      if (!insertedExpanded) {
        // CRITICAL-2 fix: 首 node 是 instance 时(firstNodeIdx===info.lineIndex) :497 分支被本
        // continue 抢先不可达,此处补插 sub_resources(若尚未插入);常规情况由 :497 先插入,
        // !insertedSubResources 守卫跳过不重复
        if (!insertedSubResources && remappedSubResources.length > 0) {
          cleanResult.push('');
          for (const subLine of remappedSubResources) {
            cleanResult.push(subLine);
          }
          insertedSubResources = true;
        }
        for (const expLine of expandedLines) {
          cleanResult.push(expLine);
        }
        insertedExpanded = true;
      }
      continue;
    }
```

`:497-503` firstNodeIdx 分支**保留不动**。

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run test/tscn-editor.test.js`
Expected: 全部 PASS（含 2 个新 CRITICAL-2 用例 + 既有 detachInstance 用例）

- [ ] **Step 5: 提交**

```bash
git add src/tscn/tscn-editor-detach.ts test/tscn-editor.test.js
git commit -m "fix(r3): CRITICAL-2 detach-instance 首 node 是 instance 时补插 sub_resources

detach-instance-firstnode-subresource-loss / drops-subresources(同根因): 首 node 是
instance 时 :486 continue 抢先于 :497 sub_resource 插入分支, sub_resource 永不落盘致场景损坏
修复: :487 块内补插(守卫互斥), 保留 :497 服务常规前向声明
+ 2 回归用例(首节点 instance 复现 + 常规防 :497 误删)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: TTL 60s + 修 ToolDispatcher 硬编码漂移（CRITICAL-3 子项1）

**Files:**
- Modify: `src/guard.ts:14`
- Modify: `src/core/ToolDispatcher.ts`（import 行 + :328）
- Test: `test/guard.test.js`、`test/core/ToolDispatcher.test.ts`

**Interfaces:**
- Consumes: `createPendingToken`/`consumeToken`/`requiresConfirmation`（guard.ts 既有 export）
- Produces: `guard.ts` 新 export `TOKEN_TTL_MS = 60_000`；ToolDispatcher `ttl_seconds` 引用该常量

- [ ] **Step 1: 写失败测试**

Edit `test/guard.test.js`。改 import 行（第 3-5 行）追加 `TOKEN_TTL_MS`：

```js
import {
  requiresConfirmation, createPendingToken, consumeToken, pendingCount, resetState,
  TOKEN_TTL_MS,
} from '../src/guard.js';
```

在文件末尾追加：

```js
// ─── TOKEN_TTL_MS (CRITICAL-3 子项1) ───────────────────────────────────────

describe('TOKEN_TTL_MS', () => {
  it('CRITICAL-3: TTL tightened to 60s (from 180s)', () => {
    expect(TOKEN_TTL_MS).toBe(60_000);
  });
});
```

Edit `test/core/ToolDispatcher.test.ts`。在 [T10] 用例（`returns confirmation token when tool requires confirmation`，约 :417-428）的 `expect(parsed.tool).toBe('scene');` 之后追加：

```js
    expect(parsed.ttl_seconds).toBe(60);  // CRITICAL-3: ttl_seconds 与 TOKEN_TTL_MS/1000 一致, 不再硬编码 180
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run test/guard.test.js -t "TTL" && npx vitest run test/core/ToolDispatcher.test.ts -t "returns confirmation token"`
Expected: guard TTL 用例 **FAIL**（`TOKEN_TTL_MS` 当前 180_000 或未 export → undefined ≠ 60_000）；ToolDispatcher 用例 **FAIL**（`ttl_seconds` 当前 180 ≠ 60）

- [ ] **Step 3: 改 guard.ts TTL + export**

Edit `src/guard.ts:14`：

```ts
const TOKEN_TTL_MS = 180_000; // 3 minutes
```

替换为：

```ts
export const TOKEN_TTL_MS = 60_000; // 60s — CRITICAL-3 子项1: 收紧重放窗口(原 180s)
```

- [ ] **Step 4: 改 ToolDispatcher 引用常量**

Edit `src/core/ToolDispatcher.ts`。先在现有 guard import 行（grep `from '../guard.js'` 或 `'./guard.js'` 定位，含 `createPendingToken`/`requiresConfirmation` 等）追加 `TOKEN_TTL_MS`。

再将 `:328`：

```ts
              ttl_seconds: 180,
```

替换为：

```ts
              ttl_seconds: TOKEN_TTL_MS / 1000,
```

- [ ] **Step 5: 运行验证通过**

Run: `npx vitest run test/guard.test.js test/core/ToolDispatcher.test.ts`
Expected: 全部 PASS（含新 TTL 断言）

- [ ] **Step 6: 提交**

```bash
git add src/guard.ts src/core/ToolDispatcher.ts test/guard.test.js test/core/ToolDispatcher.test.ts
git commit -m "fix(r3): CRITICAL-3 子项1 confirm-token TTL 60s + 修硬编码漂移

guard.ts TOKEN_TTL_MS 180s→60s 并 export; ToolDispatcher.ts:328 ttl_seconds 改引用常量
(原硬编码 180 与 guard.ts 不同源, 同类不同步顽疾); + TTL 断言防再次漂移
子项2(consumeToken 验 caller)/3(明文回传)架构级 YAGNI 暂缓

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: GUARDED 扩 workflow/validation/manage_tools（CRITICAL-3 子项4）

**Files:**
- Modify: `src/guard.ts:52-75`（GUARDED 表，android 行后追加 3 行）
- Test: `test/guard.test.js`

**Interfaces:**
- Consumes: `requiresConfirmation(toolName, args)`（既有）
- Produces: GUARDED 表新增 `workflow`/`validation`/`manage_tools` 三个 key

- [ ] **Step 1: 写失败测试**

在 `test/guard.test.js` 末尾（Task 2 的 `TOKEN_TTL_MS` describe 之后）追加：

```js
// ─── GUARDED workflow/validation/manage_tools (CRITICAL-3 子项4) ───────────

describe('GUARDED workflow/validation/manage_tools', () => {
  it('workflow: dev_loop/create_files/run_verify guarded; read not', () => {
    expect(requiresConfirmation('workflow', { action: 'dev_loop' })).toBe(true);
    expect(requiresConfirmation('workflow', { action: 'create_files' })).toBe(true);
    expect(requiresConfirmation('workflow', { action: 'run_verify' })).toBe(true);
    expect(requiresConfirmation('workflow', { action: 'scene_snapshot' })).toBe(false);
    expect(requiresConfirmation('workflow', { action: 'batch_validate' })).toBe(false);
    expect(requiresConfirmation('workflow', { action: 'diff_scenes' })).toBe(false);
  });
  it('validation: assert/stress/export_build guarded; read not', () => {
    expect(requiresConfirmation('validation', { action: 'assert' })).toBe(true);
    expect(requiresConfirmation('validation', { action: 'stress' })).toBe(true);
    expect(requiresConfirmation('validation', { action: 'export_build' })).toBe(true);
    expect(requiresConfirmation('validation', { action: 'validate_scripts' })).toBe(false);
    expect(requiresConfirmation('validation', { action: 'analyze_error' })).toBe(false);
    expect(requiresConfirmation('validation', { action: 'import_resources' })).toBe(false);
  });
  it('manage_tools: activate/deactivate guarded; read/migrate not', () => {
    expect(requiresConfirmation('manage_tools', { action: 'activate' })).toBe(true);
    expect(requiresConfirmation('manage_tools', { action: 'deactivate' })).toBe(true);
    expect(requiresConfirmation('manage_tools', { action: 'list_groups' })).toBe(false);
    expect(requiresConfirmation('manage_tools', { action: 'sync' })).toBe(false);
    expect(requiresConfirmation('manage_tools', { action: 'reconnect' })).toBe(false);
    expect(requiresConfirmation('manage_tools', { action: 'migrate' })).toBe(false);  // 只读(返回迁移映射)
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run test/guard.test.js -t "GUARDED workflow"`
Expected: **FAIL**（`requiresConfirmation('workflow', ...)` 等当前返回 false——GUARDED 无这三个 key）

- [ ] **Step 3: 加 GUARDED 3 行**

Edit `src/guard.ts`。在 GUARDED 表的 `android` 行（`:74`）之后、闭合 `};`（`:75`）之前追加 3 行：

```ts
  android: new Set(['deploy']),  // list_devices/get_preset_info 读不守;deploy install 改设备
  workflow: new Set(['dev_loop', 'create_files', 'run_verify']),  // scene_snapshot/batch_validate/diff_scenes 读不守
  validation: new Set(['export_build', 'assert', 'stress']),  // validate_*/analyze_error/import_resources 读不守
  manage_tools: new Set(['activate', 'deactivate']),  // migrate 只读(返回迁移映射, TOOL_META.readonly=true)/list_groups/sync/reconnect 不守
};
```

- [ ] **Step 4: 运行验证通过**

Run: `npx vitest run test/guard.test.js`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/guard.ts test/guard.test.js
git commit -m "fix(r3): CRITICAL-3 子项4 GUARDED 扩 workflow/validation/manage_tools

workflow(dev_loop/create_files/run_verify) + validation(assert/stress/export_build)
+ manage_tools(activate/deactivate) 写/执行类补确认令牌; migrate 只读不守
闭合 guarded-missing-workflow-validation-manage defect

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: defects.md 知识库同步（review repo，不进项目 commit）

**Files:**
- Modify: `D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`

**说明**：defects.md 在 review 知识库（非项目 git repo），本 task 只改文件，**不进项目 commit**。

- [ ] **Step 1: 两条 detach 条目 status → fixed + fix-forward 回修**

Edit defects.md：
- `:420` `detach-instance-drops-subresources.status=open` → `=fixed`
- `:419` 该条 fix-forward 末尾追加注：`（2026-06-28 修复：采用"保留 :497 + :487 块内守卫互斥补插"，非"删 :497"——删 :497 会破坏常规情况前向声明）`
- `:741` `detach-instance-firstnode-subresource-loss.status=open` → `=fixed`
- `:740` 该条 fix-forward 同样追加注（同上）

- [ ] **Step 2: guarded-missing-workflow-validation-manage status → fixed + fix-forward 回修**

- `:751` `guarded-missing-workflow-validation-manage.status=open` → `=fixed`
- `:750` 该条 fix-forward：`manage_tools:Set(['activate','deactivate','migrate'])` → `manage_tools:Set(['activate','deactivate'])`（migrate 只读移出），追加注：`（2026-06-28 修复：migrate 只读(返回迁移映射, TOOL_META.readonly=true)不守）`

- [ ] **Step 3: confirm-token-trust-broken note 更新**

Grep `confirm-token-trust-broken` 在 defects.md 定位条目。其 `status` **保持 open**（子项 2/3 未修），在 `.note` 字段追加：`（2026-06-28：子项1 TTL 60s + 子项4 GUARDED 扩 workflow/validation/manage_tools 已修；子项2 consumeToken 验 caller / 子项3 明文回传 架构级 YAGNI 仍 open）`

- [ ] **Step 4: 追加 R3 闭环汇总（可选）**

在 defects.md 末尾 R3 汇总区块追加一行：`2026-06-28 CRITICAL 闭环：detach-instance(CRITICAL-2) + confirm-token 子项1/4(CRITICAL-3) 已 fixed；子项2/3 暂缓。`

- [ ] **Step 5: 验证（无项目 commit）**

确认 defects.md 改动落盘。此 task 不产生项目 git commit（defects.md 不在项目 repo）。

---

## Task 5: 验证收尾

**Files:** 无（纯验证）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿（基线 2956 + 本计划新增用例）

- [ ] **Step 2: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0，无错误

- [ ] **Step 3: 发版门禁（可选，确认场景树 + 脚本健康）**

Run（经 MCP）: `verify_delivery`
Expected: 通过

- [ ] **Step 4: 确认 commits**

Run: `git log --oneline -5`
Expected: 看到 Task 1/2/3 的 3 个 fix 提交在 master

---

## Self-Review（plan 写完后自查）

**1. Spec coverage**：
- 改动 1（detach-instance）→ Task 1 ✅
- 改动 2（TTL + 硬编码）→ Task 2 ✅
- 改动 3（GUARDED 扩展）→ Task 3 ✅
- defects 同步 → Task 4 ✅
- 验证门禁（npm test / tsc / verify_delivery）→ Task 5 ✅
- 暂缓项（子项 2/3）→ 不需 task，spec 已声明 ✅

**2. Placeholder scan**：无 TBD/TODO；每个 step 含完整代码或精确 Edit 指令 ✅

**3. Type consistency**：
- `TOKEN_TTL_MS`：Task 2 Step 3 export → Step 4 ToolDispatcher import → 测试断言一致 ✅
- `detachInstance` 签名不变 ✅
- GUARDED key `workflow`/`validation`/`manage_tools` 与 merged name（manage-tools.ts:53 `name:'manage_tools'`）一致 ✅
- migrate 不守：Task 3 配置 `['activate','deactivate']` ↔ 测试 `migrate → false` ↔ defects fix-forward 回修，三处一致 ✅
