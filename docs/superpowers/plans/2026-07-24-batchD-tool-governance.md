# 批次 D 工具治理（D1 asset/android 游离）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 D1 finding——asset/android 工具在 module-loader 注册但不在 TOOL_GROUPS/ALWAYS_ALLOWED 致 isToolAllowed 恒 false（发现层隐藏 + profile 不强制），补 2 组消除游离。

**Architecture:** 纯 bug 修复，不改工具签名/正常路径。tool-registry.ts TOOL_GROUPS 补 asset(requires editor)/android(requires []) 2 组，toolToGroup reverse map + activeGroups + getFilteredTools 链自动派生一致。方案 a（不修 executeToolCall，避免破坏 advanced-proxy delegateCall 逃生舱）。D2（find_node traversal）已撤销转 follow-up（范畴错误，见 spec）。

**Tech Stack:** TypeScript（src/core/tool-registry.ts）、vitest（行为测试）、defects.ts（防复发 detect）。

## Global Constraints

- **行号会漂移**：本 plan `文件:行号` 为 2026-07-24 核查快照，实现以 grep 实际行号为准。
- **不改工具签名/正常路径行为**：bug 修复不得破坏既有工具调用语义。
- **TS 门禁**：`tsc --noEmit` exit 0；lint 0err（2 warning pre-existing 不变）；build 0。
- **回归门禁**：全量 `npx vitest run` 无新 failed（4 T11 elicitation pre-existing 不变）。
- **master 本地不 push**（用户惯例）；commit 中文 `fix(tool-governance):`/`test(tool-governance):` 前缀 + Co-Authored-By 尾。
- **android requires 待实测**：plan Step 核实 android export 是否需 editor（若需改 requires:['editor']）。
- **eng-review 3 小瑕疵**：行号 grep 实测 / `isFeatureEnabled('TOOL_GROUPS')` flag 对新组无特殊（plan Step 核实）/ android requires（见上）。

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `src/core/tool-registry.ts` | TOOL_GROUPS 定义 + toolToGroup/isToolAllowed/getGroupForTool | T1: TOOL_GROUPS 补 asset/android 2 组 |
| `test/d-tool-governance.test.ts` | D1 行为测试 | T1: 新建（getGroupForTool/TOOL_GROUPS 断言） |
| `test/regression/defects.ts` | defect detect | T2: 加 asset-android-tool-orphan FIXED detect |
| `test/regression/defects-fixed.test.ts` | FIXED 硬断言 | T2: 计数 93→94 |
| `CHANGELOG.md` | 变更日志 | T2: 批次 D 段 |

---

## Task 1: D1 — TOOL_GROUPS 补 asset/android 组

**Files:**
- Modify: `src/core/tool-registry.ts:166-193`（TOOL_GROUPS）
- Test: `test/d-tool-governance.test.ts`（新建）

**Interfaces:**
- Consumes: tool-registry.ts 已有 `TOOL_GROUPS`（:166-193 export Record）、`toolToGroup`（:236 从 TOOL_GROUPS 构建 reverse map）、`getGroupForTool(toolName): string|undefined`（:267）、`isToolAllowed(toolName): boolean`（:259，查 activeGroups 默认全组 :233）。
- Produces: TOOL_GROUPS 含 `asset`/`android` key；toolToGroup 自动含 'asset'→'asset' / 'android'→'android'（:237 循环构建，无需手动接线）；getGroupForTool('asset'/'android') 返组名。

**★ android requires 决策（plan Step 3 核实）**：默认 `requires: []`（deploy=spawn godot --export-android，process 类，无连接依赖，对齐 dynamic/blender/multi_instance）。若实测 android export 依赖编辑器（export 配置/预设），改 `requires: ['editor']`。实现时查 `src/tools/android.ts` 或 android deploy 实现。

- [ ] **Step 1: 写失败测试**

`test/d-tool-governance.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { TOOL_GROUPS, getGroupForTool } from '../src/core/tool-registry.js';

describe('D1 asset/android TOOL_GROUPS 补组（消除游离）', () => {
  it('TOOL_GROUPS 含 asset 与 android 组', () => {
    expect(TOOL_GROUPS.asset, 'asset 组缺失').toBeDefined();
    expect(TOOL_GROUPS.android, 'android 组缺失').toBeDefined();
    // tools 数组含对应工具名
    expect(TOOL_GROUPS.asset.tools).toContain('asset');
    expect(TOOL_GROUPS.android.tools).toContain('android');
  });

  it('getGroupForTool(asset/android) 返组名（非 undefined，toolToGroup reverse map 自动含）', () => {
    expect(getGroupForTool('asset')).toBe('asset');
    expect(getGroupForTool('android')).toBe('android');
  });

  it('asset 组 requires editor（操作场景节点）；android 组 requires []（process 类 deploy）', () => {
    expect(TOOL_GROUPS.asset.requires).toContain('editor');
    expect(TOOL_GROUPS.android.requires).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/d-tool-governance.test.ts`
Expected: FAIL（`TOOL_GROUPS.asset` undefined / getGroupForTool('asset') undefined）。

- [ ] **Step 3: 核实 android requires + 实现 TOOL_GROUPS 补组**

先核实 android export 是否需 editor（eng-review 小瑕疵 3）：
Run: `grep -n "requires\|editor\|export" src/tools/android.ts | head -20`（或查 android 工具 deploy 实现）
- 若 android export 不依赖 editor 连接（spawn godot CLI process）→ `requires: []`（默认）。
- 若依赖 editor（export 预设/配置需编辑器）→ `requires: ['editor']`（调整下面 android 行）。

`tool-registry.ts` TOOL_GROUPS（:166-193）`multi_instance` 行（:191）后、`dynamic`（:192）前补 2 组：
```typescript
  multi_instance: { description: '多实例', tools: ['godot_list_instances', 'godot_select_instance'], requires: [] },
  asset:          { description: '资源操作（asset-forge）', tools: ['asset'], requires: ['editor'] },
  android:        { description: 'Android deploy', tools: ['android'], requires: [] },
  dynamic: { description: '动态工具（Godot 端注册但 MCP 侧未定义）', tools: ['godot_advanced_tool', 'godot_list_dynamic_routes'], requires: [] },
```
（保持原 2 空格缩进 + 对齐风格。`asset.requires: ['editor']` 因 asset 工具操作场景节点；`android.requires: []` 据 Step 3 核实，默认 process 类无连接依赖。）

- [ ] **Step 4: 编译 + 测试通过**

Run: `npx tsc --noEmit && npx vitest run test/d-tool-governance.test.ts`
Expected: tsc exit 0 + 测试 3/3 PASS。

- [ ] **Step 5: 核实 profile/isFeatureEnabled 无副作用（eng-review 小瑕疵 2）**

Run: `npx vitest run test/tool-groups.test.ts 2>&1 | tail -15`（或含 profile/lite/minimal 的测试）
Expected: 无新 failed。asset/android 进 TOOL_GROUPS 后 resolveProfile('lite'/'minimal') 自动派生（lite/minimal 按组排除，asset/android 默认不进 lite/minimal 除非 profile 显式含）。`isFeatureEnabled('TOOL_GROUPS')` flag 对新组无特殊逻辑（flag 控制整组特性，非 per-group）。

- [ ] **Step 6: 全量回归 + Commit**

Run: `npx vitest run`
Expected: 除 4 T11 pre-existing 外 0 新 failed。
```bash
git add src/core/tool-registry.ts test/d-tool-governance.test.ts
git commit -m "fix(tool-governance): D1 asset/android TOOL_GROUPS 补组（消除 isToolAllowed 恒 false 游离）

asset/android 在 module-loader 注册但不在 TOOL_GROUPS → isToolAllowed 恒 false（发现层隐藏 + profile 不强制）。
补 asset(requires editor)/android(requires []) 组,toolToGroup + activeGroups + getFilteredTools 链自动派生一致。
方案 a（不修 executeToolCall 避免 advanced-proxy delegateCall 逃生舱破坏）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: defects detect + CHANGELOG

**Files:**
- Modify: `test/regression/defects.ts`（加 D1 detect）、`test/regression/defects-fixed.test.ts`（计数 93→94）、`CHANGELOG.md`

**Interfaces:**
- Consumes: defects.ts 既有 FIXED detect 闭包模式（内联非 global 正则/includes，批次 A/B/C 教训）；defects-fixed.test.ts 计数处（头注释 + toBe + Set.size）。
- Produces: `asset-android-tool-orphan` FIXED detect（查 TOOL_GROUPS 含 asset/android）；defects-fixed 计数 94；CHANGELOG 批次 D 段。

- [ ] **Step 1: defects.ts 加 D1 detect**

`test/regression/defects.ts` 批次 C 段后（`];` FIXED 数组结束前，参考批次 C 段位置 grep `批次 C`）加：
```typescript
  // ─── 2026-07-24 批次 D 工具治理（D1 asset/android 游离；D2 find_node traversal 撤销转 follow-up 见 spec）──
  { key: 'asset-android-tool-orphan', status: 'fixed', severity: 'IMPORTANT', dimension: 'Tooling',
    // D1(批次 D): asset/android 在 module-loader 注册但不在 TOOL_GROUPS/ALWAYS_ALLOWED → isToolAllowed 恒 false
    // （发现层 tools/list 隐藏 + profile 不强制）。fix: TOOL_GROUPS 补 asset/android 组。detect: 含两 key = fixed。
    detect: () => {
      const f = readSrc('src/core/tool-registry.ts');
      const m = f.slice(f.indexOf('export const TOOL_GROUPS'), f.indexOf('ALWAYS_ALLOWED'));
      return /asset:\s*\{[^}]*tools:\s*\['asset'\]/.test(m) && /android:\s*\{[^}]*tools:\s*\['android'\]/.test(m) ? 0 : 1;
    } },
```

- [ ] **Step 2: defects-fixed.test.ts 计数 93→94**

`test/regression/defects-fixed.test.ts` 批次 C 合计 93 后加批次 D +1（grep `合计 93` 定位）：
- 头注释 `FIXED_DEFECTS 93 条` → `94 条`
- 合计段加 `+1(2026-07-24 批次 D): asset-android-tool-orphan(D1 asset/android TOOL_GROUPS 补组), 合计 94。`
- `expect(FIXED_DEFECTS.length).toBe(93)` → `toBe(94)`
- `expect(new Set(keys).size, ...).toBe(93)` → `toBe(94)`

（4 处同步：头注释 + 合计段 + toBe + Set.size。可用 `replace_all` 93→94 但注意 editor-secret 合计 81 不受影响——批次 C 校准段已是 93，批次 D +1=94。）

- [ ] **Step 3: RED→GREEN 验证**

临时注释 tool-registry.ts asset 组（或 sed 倒带）→ `npx vitest run test/regression/defects-fixed.test.ts` 应红（asset-android-tool-orphan detect 命中 1）→ restore → 绿。证 detect 非恒 0 假绿。

- [ ] **Step 4: CHANGELOG 批次 D 段**

`CHANGELOG.md` 批次 C 段后（`### Not Fixed` 前）加：
```markdown
### Fixed — Tooling（批次 D：asset/android 工具游离，2026-07-24）

- **asset-android-tool-orphan（D1）**：`src/core/tool-registry.ts` asset/android 工具在 module-loader 注册（`module-loader.ts:57,71,75`）但不在 `TOOL_GROUPS`/`ALWAYS_ALLOWED` → `isToolAllowed('asset'/'android')` 恒 false（发现层 tools/list 隐藏 + profile 不强制，执行层 ReadOnlyGuard 兜底非 RCE）。补 `asset`(requires editor) + `android`(requires []) 2 组，toolToGroup reverse map + activeGroups + getFilteredTools 链自动派生一致。方案 a（不修 executeToolCall，避免破坏 advanced-proxy delegateCall 逃生舱）。

**D2 撤销**（find_node 内置 has_path_traversal）：经 eng-review + memory [[nodepath-traversal-category-error]] 核实为范畴错误复活（批次 A A11 已否决同建议）——has_path_traversal 是 resource 范畴（注释 "resource path"），find_node 出口 get_node_or_null 纯场景树，NodePath `..` 是 Godot 合法父引用（`../Sibling`）非 fs traversal。D2 转 follow-up（NodePath `..` 策略统一：node_commands:51 拒 .. vs memory 范畴错误，需项目方拍板）。
```

- [ ] **Step 5: 全量回归 + Commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0 + defects-fixed 94/94 + 全量无新 failed（4 T11 pre-existing）。
```bash
git add test/regression/defects.ts test/regression/defects-fixed.test.ts CHANGELOG.md
git commit -m "test(tool-governance): 批次 D defects detect + CHANGELOG（D1 asset/android, D2 撤销转 follow-up）

defects.ts 加 asset-android-tool-orphan FIXED detect + 计数 93→94。CHANGELOG 批次 D 段（D1 修复 +
D2 撤销理由：范畴错误复活,转 follow-up 统一 node_commands:51 vs memory 立场）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**：spec D1（TOOL_GROUPS 补组）→ T1；spec defects detect（93→94）+ CHANGELOG → T2；spec 验收（tsc/全量/defects/CHANGELOG）→ T1 Step 4/6 + T2 Step 5。spec D2 撤销 → 不实施（follow-up）。spec eng-review 3 小瑕疵 → T1 Step 3（android requires）+ Step 5（isFeatureEnabled）+ Global Constraints（行号 grep）。

**2. Placeholder scan**：无 TBD。代码步骤含实际代码（T1 测试 + TOOL_GROUPS 补组 + T2 detect/CHANGELOG）。android requires 标 Step 3 核实（含 grep 命令 + 两分支决策），非占位。

**3. Type consistency**：`TOOL_GROUPS.asset`/`.android`（T1 定义）↔ T2 detect 查 `asset:\s*\{[^}]*tools:\s*\['asset'\]`（字面匹配）↔ CHANGELOG `asset`(requires editor)。getGroupForTool 签名（:267 string|undefined）↔ T1 测试 toBe('asset')。

**4. 跨 task 裂缝**：T1（tool-registry）+ T2（defects/CHANGELOG）不同文件，顺序执行不冲突。defects detect 查 tool-registry.ts（T1 已改），T2 在 T1 后。
