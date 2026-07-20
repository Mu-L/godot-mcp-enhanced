# B/C 档 DX 改进（4 限制）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改进 B/C 档 4 个限制的 DX——C6（call_method TS :634 message 引导正确调用语法）+ B2（screenshot BLANK message 对齐 core.md）+ C5（运行时工具不持久化提示，公共 helper）+ B1（editor Ctrl+S 反向覆盖文档）。

**Architecture:** C6/B2 是单行/两行 message 改（game-bridge.ts:633 / screenshot.ts:99-104）；C5 新建 `shared/persistence-warning.ts` helper + 5 核心运行时工具返回包装（text 末尾加 warning，不破坏结构）；B1 editor.md 加一段。均 DX 提示/引导/文档，非核心逻辑。

**Tech Stack:** TypeScript（game-bridge/screenshot/shared/运行时工具）、Markdown（editor.md）。验证用 tsc + lint + vitest（C5 包装后跑运行时工具测试）+ check:gdscript（无 GD 改动，应 0/0）+ build。

## Global Constraints

- **行号基线**：HEAD `7091b5f`（spec eng-review 修订 commit）。C6 `game-bridge.ts:633`、B2 `screenshot.ts:99-104`。
- **C6 方向（reviewer C1 CRITICAL 已纳入）**：TS :634 **不读 env**（grep 零命中），env 只作用 bridge `mcp_bridge.gd:764-775`。`:633` message 引导正确语法（`call_method params`）+ env context（引导 call_method 路径后 env 在 bridge 层有效），**不暗示 :634 读 env**。
- **C5 包装策略（reviewer C5 预警）**：warning 追加到返回 **text 末尾**（不破坏结构化 `result` 字段），尽量不 break 现有测试断言。包装后**必须跑运行时工具测试**，断言可能需同步。
- **C5 helper 文件（reviewer C3）**：新建 `src/tools/shared/persistence-warning.ts`（非 shared.ts——后者是 7 行 barrel），`shared.ts` 加 `export * from './shared/persistence-warning'`。
- **B2 analyze path-leak（reviewer C4）**：message 保留 analyze 替代，path-leak 独立 follow-up（本 plan 不顺带修）。
- **不 push**：commit master 不 push origin（prior 惯例）。
- **TS 改动用 Edit 工具**（精确字符串）。

---

## File Structure

- **Modify** `src/tools/game-bridge.ts:633` — C6 message
- **Modify** `src/tools/screenshot.ts:99-104` — B2 两处 BLANK message
- **Create** `src/tools/shared/persistence-warning.ts` — C5 helper
- **Modify** `src/tools/shared.ts` — C5 barrel export
- **Modify** `src/tools/audio-ops.ts` / `particles.ts` / `signal-ops.ts` / `tilemap-ops.ts` / `animation/index.ts` — C5 返回包装（5 核心运行时工具）
- **Modify** `.claude/rules/godot-mcp-editor.md` — B1 文档段

---

### Task 1: C6 — game-bridge.ts :633 message 引导正确调用语法

**Files:**
- Modify: `src/tools/game-bridge.ts:633`

**Interfaces:** 无新接口，纯 message 字符串

- [ ] **Step 1: Edit game-bridge.ts:633 message**

old:
```ts
          return textResult(`Error: Unknown method "${method}". Supported: ${[...allowed].join(', ')}`);
```

new:
```ts
          return textResult(`Error: Unknown bridge method "${method}". Supported: ${[...allowed].join(', ')}. 业务方法（如 take_damage/emit_signal）请用 game_write method=call_method params={method:"业务方法名", args:[...]}（bridge 运行时白名单校验，可通过 GODOT_MCP_BRIDGE_EXTRA_METHODS env 扩展）`);
```

- [ ] **Step 2: tsc 编译验证**

Run: `npx tsc --noEmit`
Expected: exit 0（纯字符串改动）。

- [ ] **Step 3: commit C6**

```bash
git add src/tools/game-bridge.ts
git commit -m "feat(bridge): call_method TS :634 message 引导正确调用语法 + env context（C6）" -m "TS :634 不读 env（reviewer C1 核实），原 message 不引导正确语法。改：业务方法引导 game_write method=call_method params（bridge 白名单校验，env GODOT_MCP_BRIDGE_EXTRA_METHODS 扩展作用 bridge 层 call_method 路径）。修正原 spec 提 env 误导。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: B2 — screenshot.ts BLANK message 对齐 core.md

**Files:**
- Modify: `src/tools/screenshot.ts:99-104`（两处：BLANK_DETECTED + 小文件）

- [ ] **Step 1: Edit screenshot.ts:99-100（BLANK_DETECTED message）**

old:
```ts
          blankWarning = '\n⚠ Screenshot may be blank (2D rendering limitation in headless mode).\n' +
            'For 2D projects, consider using screenshot(action=analyze) with a user-provided screenshot instead.';
```

new:
```ts
          blankWarning = '\n⚠ Screenshot may be blank (headless RendererDummy 无 GPU 渲染，2D/3D 均空白).\n' +
            '替代：① Bridge take_screenshot（游戏运行时 GPU viewport，2D/3D 均可）② editor/GUI 模式截图 ③ 手动 F5 运行后截图 ④ screenshot(action=analyze) 分析本地文件';
```

- [ ] **Step 2: Edit screenshot.ts:103-104（小文件 message）**

old:
```ts
          blankWarning = `\n⚠ Screenshot file is unusually small (${result.fileSize} bytes), possibly blank.\n` +
            'For 2D projects, consider using screenshot(action=analyze) with a user-provided screenshot instead.';
```

new:
```ts
          blankWarning = `\n⚠ Screenshot file is unusually small (${result.fileSize} bytes), possibly blank (headless RendererDummy 无 GPU 渲染，2D/3D 均空白).\n` +
            '替代：① Bridge take_screenshot（游戏运行时 GPU viewport，2D/3D 均可）② editor/GUI 模式截图 ③ 手动 F5 运行后截图 ④ screenshot(action=analyze) 分析本地文件';
```

- [ ] **Step 3: tsc 编译验证**

Run: `npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 4: commit B2**

```bash
git add src/tools/screenshot.ts
git commit -m "docs(screenshot): BLANK message 对齐 core.md RendererDummy 2D+3D + 列全替代（B2）" -m "原 message 措辞旧（2D rendering limitation，core.md 已改 RendererDummy 2D+3D 均空白）+ 没提 Bridge/editor/手动 F5 替代。analyze path-leak 独立 follow-up（reviewer C4）。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: C5 — 运行时工具不持久化提示（公共 helper + 5 工具包装）

**Files:**
- Create: `src/tools/shared/persistence-warning.ts`
- Modify: `src/tools/shared.ts`（barrel export）
- Modify: `src/tools/audio-ops.ts` / `particles.ts` / `signal-ops.ts` / `tilemap-ops.ts` / `animation/index.ts`（5 工具返回包装）

**Interfaces:**
- Produces: `runtimePersistWarning(action: string): string`（shared/persistence-warning.ts 导出，shared.ts barrel）

**包装策略（reviewer C5 预警）**：warning 追加到返回 **text 末尾**（不破坏结构化 `result` 字段）。5 工具返回结构各异，implementer 须 Read 每个工具的返回 text 拼接处，在末尾 `+ runtimePersistWarning(action)`。包装后跑该工具测试，断言可能需同步（warning 出现在 text）。

- [ ] **Step 1: 新建 shared/persistence-warning.ts**

Create `src/tools/shared/persistence-warning.ts`:
```ts
const RUNTIME_PERSIST_HINT = '是运行时操作，headless 进程退出后丢失。持久化须 add_node + save_scene 写入 .tscn（运行时工具仅用于验证/测试）';

/** 运行时工具返回末尾追加的不持久化提示。action = 工具 action 名（如 audio_play）。 */
export function runtimePersistWarning(action: string): string {
  return `\n⚠ ${action} ${RUNTIME_PERSIST_HINT}`;
}
```

- [ ] **Step 2: shared.ts barrel export**

Read `src/tools/shared.ts`（7 行 barrel），在末尾加：
```ts
export * from './shared/persistence-warning';
```

- [ ] **Step 3: 包装 5 核心运行时工具返回**

对每个工具，Read 返回 text 拼接处，在末尾加 `+ runtimePersistWarning(action)`（import from '../shared' 或 './shared'）。5 工具 + action 清单：

| 文件 | action | import 路径 |
|------|--------|------------|
| `src/tools/audio-ops.ts` | `audio_play` / `audio_stop` 等 | `./shared` |
| `src/tools/particles.ts` | `particles_create` 等 | `./shared` |
| `src/tools/signal-ops.ts` | `signal_connect` / `signal_emit` 等 | `./shared` |
| `src/tools/tilemap-ops.ts` | `tilemap_read` / `tilemap_set` 等 | `./shared` |
| `src/tools/animation/index.ts` | `animation_play` 等 | `../shared` |

包装示例（audio-ops，具体行 Read 后定）：
```ts
// 返回 text 末尾加 warning（不破坏 result 结构）
import { runtimePersistWarning } from './shared';
// ... 在 textResult/buildResult 返回的 text 末尾 + runtimePersistWarning('audio_play')
```

**注**：每个工具可能多个 action 返回，优先在主 action（audio_play/particles_create/signal_connect/tilemap_set/animation_play）返回加 warning。若工具返回结构使 text 末尾追加困难（如纯结构化 result 无 text），加 `warning` 字段或顶层 text。

- [ ] **Step 4: tsc 编译验证**

Run: `npx tsc --noEmit`
Expected: exit 0。

- [ ] **Step 5: 跑 5 工具测试（reviewer C5 预警——断言可能 break）**

Run: `npx vitest run test/tools/audio* test/tools/particles* test/tools/signal* test/tools/tilemap* test/tools/animation* 2>/dev/null || npx vitest run 2>&1 | grep -iE "audio|particles|signal|tilemap|animation" | head -20`
Expected: 5 工具相关测试通过。**若断言因 warning break**（如 toEqual 精确匹配 text），同步断言（warning 是预期新增）。

- [ ] **Step 6: commit C5**

```bash
git add src/tools/shared/persistence-warning.ts src/tools/shared.ts src/tools/audio-ops.ts src/tools/particles.ts src/tools/signal-ops.ts src/tools/tilemap-ops.ts src/tools/animation/index.ts
git commit -m "feat(runtime): 运行时工具返回加不持久化提示（C5 公共 helper）" -m "新建 shared/persistence-warning.ts runtimePersistWarning + shared.ts barrel + 5 核心运行时工具（audio/particles/signal/tilemap/animation）返回包装。warning 追加 text 末尾不破坏结构。其他运行时工具（node-3d/physics/material/nav/recording）留 follow-up。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: B1 — editor.md 文档补强

**Files:**
- Modify: `.claude/rules/godot-mcp-editor.md`（常见陷阱段末尾加一条）

- [ ] **Step 1: Edit editor.md 加 B1 段**

在 `godot-mcp-editor.md` 常见陷阱段末尾（F2 的"editor 路由操作活动场景"条后，约 line 98）追加：
```markdown
- **headless 改盘 + editor 开同场景→Ctrl+S 覆盖（2026-07-20）**：headless 改盘后，**若编辑器开着同一场景**，编辑器内存的旧版本 Ctrl+S 会覆盖 MCP 改动——须 Project→Reload 场景（或 File→Close Scene）后再操作。`checkEditorSceneSave` 守卫只防 MCP→editor 脏方向；反向（editor→MCP，用户手动 Ctrl+S）是引擎行为，MCP 端不可控。headless 改盘后建议关闭编辑器内该场景或 Reload。
```

- [ ] **Step 2: commit B1**

```bash
git add .claude/rules/godot-mcp-editor.md
git commit -m "docs(editor-rule): headless 改盘后 editor Ctrl+S 反向覆盖陷阱（B1）" -m "reviewer C7 措辞明确触发条件（editor 开着同一场景 + headless 改盘）。checkEditorSceneSave 只防 MCP→editor 脏，反向引擎不可控，文档引导 Reload/Close。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 全量门禁 + build

**Files:** 无源码改动，验证 + build

- [ ] **Step 1: 全量门禁**

Run:
```bash
npx tsc --noEmit && npm run lint && npm run check:gdscript && npx vitest run
```
Expected: tsc exit 0 / lint 0 errors（既有 warning 可接受）/ check:gdscript errors=0 warnings=0 / vitest 全绿（4 pre-existing T11 elicitation 遗留不计；**C5 包装后运行时工具测试断言已同步**）。

- [ ] **Step 2: build**

Run: `npm run build`
Expected: exit 0。

- [ ] **Step 3: 验证 4 改动进 build（抽样）**

Run: `grep -c "业务方法" build/tools/game-bridge.js && grep -c "RendererDummy" build/tools/screenshot.js && grep -c "runtimePersistWarning" build/tools/shared.js`
Expected: 3 个都 ≥1（C6/B2/C5 进 build）。

- [ ] **Step 4: commit（如有 drift fix）**

通常 Task 1-4 已 commit 全部，本步无新 commit。若门禁发现 drift 需修，单独 commit。

---

## Self-Review

**Spec coverage**：
- C6（:634 message 引导 call_method params + env context，方向 b）→ Task 1 ✅
- B2（BLANK message 对齐 core.md + 列全替代）→ Task 2 ✅（C4 analyze path-leak 独立 follow-up 注）
- C5（shared/persistence-warning.ts helper + 5 工具包装）→ Task 3 ✅（C3 新文件 + C5 测试预警）
- B1（editor.md 文档，C7 措辞）→ Task 4 ✅
- reviewer C1-C7 全纳入（spec 修订 `7091b5f`）

**Placeholder 扫描**：Task 3 Step 3 工具包装给策略 + 清单 + 示例（非 placeholder，因 5 工具返回结构各异，implementer Read 后按模式包装是合理 dispatch；audio-ops 示例 + 5 工具 action 清单 + import 路径齐全）。其余步骤完整代码。

**Type/signature 一致**：`runtimePersistWarning(action: string): string` 全 plan 一致；C6/B2 message 字符串 verbatim 对齐 spec。

**C5 包装风险**：5 工具返回结构各异，包装可能 break 测试断言（reviewer C5）。Task 3 Step 5 预警 + 跑工具测试。implementer 须判断每工具包装方式（text 末尾 / warning 字段）。
