# ui_* 持久化提示（C5 follow-up 独立分支，eng-review I1）

**日期**：2026-07-21
**承接**：C5（2026-07-20，audio/particles/signal/tilemap/animation）+ C5 follow-up（2026-07-21，node-3d/physics/nav/material 包装，recording 不包装）。eng-review I1 指出 ui_*（core.md 列运行时不持久化）C5 + 上一轮都没包，独立 follow-up。
**范围**：给 ui_* 的 Control 创造/改 action 补"不持久化"提示。Theme 操作不加（文案错位）。

## 背景

C5 helper `appendRuntimePersistWarning(result, action)`（`src/tools/shared/persistence-warning.ts:18`）。ui 用 `executeGdscriptTrusted`（`src/tools/ui/index.ts:8` import / `:416` 调用），**单公共返回点** `src/tools/ui/index.ts:432`（所有 action 走 `parseGdscriptResult`）。`shared.ts:7` barrel `export * from './shared/persistence-warning.js'` 已 re-export helper。

## 核心决策（brainstorming 确认）

**Q1：Control 加 / theme 不加**。
- C5 文案"持久化须 add_node + save_scene 写入 .tscn"对 Control 节点操作**适用**（Control 是节点，add_node 持久化对）。
- 对 Theme 资源操作（ui_set_theme / theme_create / theme_set_property）**语义错位**——Theme 用 `ResourceSaver.save`（theme_action=save / save_path），不是 add_node；用户不会以为 theme 写 .tscn，无 C5 误解风险。与 recording 同逻辑（文案错位不加）。
- 判据沿用 C5 follow-up：修改运行时节点树/资源属性→加；只读→不加；真落盘→不加；文案错位+无 .tscn 误解→不加（theme 特例）。

## §1 范围：ui_* action 分类

| action | 分类 | 加提示？ |
|---|---|---|
| ui_create_control | Control 创造节点 | ✅ |
| ui_set_layout | Control 改布局 | ✅ |
| ui_anchor_preset | Control 改锚点 | ✅ |
| ui_container_add | Control 加子节点 | ✅ |
| ui_draw_recipe | Control 绘图 | ✅ |
| ui_build_layout | Control 批量创造 Container 树 | ✅ |
| ui_get_layout | 查询（只读） | ❌ |
| ui_set_theme（全 theme_action: set_params/create/save/load） | theme 资源（文案错位） | ❌ |
| theme_create（全 theme_create_action: create/extract） | theme 资源（文案错位） | ❌ |
| theme_set_property | theme 资源（文案错位） | ❌ |

**持久化路径（不加，防误导）**：
- `ui_set_theme theme_action=save`（`genUiSetThemeScript` save 分支，`src/tools/ui/ui-theme.ts:58` `ResourceSaver.save(theme, themePath)`）
- `theme_create` 带 `save_path`（`genThemeCreateScript` savePath 分支，`src/tools/ui/ui-theme.ts:141` `ResourceSaver.save(theme, savePath)`）

**theme 整体不加的理由**：ui_set_theme / theme_create / theme_set_property 操作 Theme 资源（非 Control 节点）。即使 theme_action=create/set_params（运行时改 theme），C5 文案"add_node+save_scene 写入 .tscn"对 theme 错位，且 theme 持久化路径明确（theme_action=save / save_path），用户无"theme 写到 .tscn"误解风险。故 theme 整体不加（含二级 action 不细分）。

## §2 实现策略：方案 A（单返回点 Set 过滤，helper 不改）

- helper 公共 API 零改动
- 单公共返回点 `ui/index.ts:432` 条件包装（所有 action 走此，Set 过滤只对 6 Control action 加）
- `UI_PERSIST_ACTIONS = new Set(['ui_create_control', 'ui_set_layout', 'ui_anchor_preset', 'ui_container_add', 'ui_draw_recipe', 'ui_build_layout'])`
- action 值已含 `ui_` 前缀，直接传 `action`（与 C5 follow-up 的 nav_/material_ 手动加前缀不同）

## §3 包装位置（行号已 grep 实测）

`src/tools/ui/index.ts`：
- `:9` import 加 `appendRuntimePersistWarning`：
  ```ts
  // 原
  import { normalizeNodePath, sanitizeResPath, opsErrorResult, parseGdscriptResult, NON_PERSIST } from '../shared.js';
  // 改
  import { normalizeNodePath, sanitizeResPath, opsErrorResult, parseGdscriptResult, NON_PERSIST, appendRuntimePersistWarning } from '../shared.js';
  ```
- `handleTool`（`:209`）前定义模块级 `const UI_PERSIST_ACTIONS = new Set([...]);`
- `:432` 返回点改：
  ```ts
  const r = parseGdscriptResult(result, [], errorMapper);
  return UI_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, action) : r;
  ```
- `action` 变量 `:214`（`const action = args.action as string`），`:432` 作用域可见

## §4 测试（扩展 `test/persistence-warning.test.ts`）

**正向**（≥2，防 Set 写漏）：
- `ui_create_control`（创建 Control）
- `ui_build_layout`（批量创造 Container 树，非主 action 防漏）
断言：`content[0]` 可 JSON.parse + 不含 ⚠ + `content[1]` 含 ⚠ + action 名

**反向**（不加，防机械套模式回归）：
- `ui_get_layout`（查询）
- `ui_set_theme`（theme 文案错位，theme_action=create 任一）
- `theme_create`（theme，theme_create_action=create 任一）
- `theme_set_property`（theme）
- `ui_set_theme theme_action=save`（持久化）
- `theme_create` 带 `save_path`（持久化）
断言：返回 content 不含 ⚠

**mock**：`executeGdscriptTrusted`（C5 follow-up Task 4 已加 mock `SUCCESS_RESULT`，复用）

## 不含（YAGNI）

- theme 操作不加（ui_set_theme / theme_create / theme_set_property，文案错位）
- 不改 helper / C5 + C5 follow-up 已包装工具 / ui rule NON_PERSIST / ui_* 工具描述
- theme 二级 action 不细分（整体不加）

## 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run test/persistence-warning.test.ts`
3. `npx vitest run`（全量回归）
4. `grep` 确认 ui_get_layout / ui_set_theme / theme_create / theme_set_property 返回路径无 `appendRuntimePersistWarning`（反向守卫）

## 风险与对策

- **ui import 路径**：`ui/index.ts` 在 `src/tools/ui/`，shared 在 `src/tools/`，import `'../shared.js'`（已核实 `:9`）。appendRuntimePersistWarning 经 `shared.ts:7` barrel re-export 可用。
- **二级 action 整体不加**：ui_set_theme / theme_create 不加（所有 theme_action / theme_create_action），Set 只含 6 顶层 Control action，二级不分。
- **反向断言防回归**：theme + 持久化 + 查询都不加，反向断言锁定（防未来误把 theme/持久化 action 加 Set）。
- **现有测试断言同步**（C5 spec line 57 同类预警）：ui_* 现有测试若断言 content 结构/length，包装 Control 成功路径后 content 多 warning，可能需同步（全量回归抓）。
