# Godot 开发方法论 workflow 文档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 3 个跨子系统 workflow 文档（带 checklist），把高频开发流程从"埋在参考文档里"变成"AI 主动遵循的步骤"，复用现有 `rules-manifest.ts` 分发机制（零机制改动），并为 README 提供"方法论"叙事段。

**Architecture:** 在 `DETAILED_RULE_TEMPLATES`（`rule-templates.ts`）加 3 个 `godot-mcp-workflow-*.md` key + `.claude/rules/` 磁盘副本。现有 `project.ts` 的 `Object.keys(DETAILED_RULE_TEMPLATES)` 遍历 + `rules-manifest.ts` 二维判定自动纳入新文件——无需改任何分发代码。`agentsmd-builder.ts` 用显式 `SECTION_TO_TEMPLATE` 映射表（非通用遍历），workflow 不进 AGENTS.md（保持精简，符合 spec 范围）。

**Tech Stack:** TypeScript（`rule-templates.ts` 模板源）、Markdown（文档内容 + README）、Vitest（单元测试）、Godot MCP `setup_project_rules`（端到端验收）。

**Spec 来源：** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-27-godot-methodology-workflows-design.md`（§1–9 + 审查报告 6 项修正已全部应用）。

## Global Constraints

- **版本**：`package.json` `0.24.1` → `0.25.0`（minor，新增功能；当前实测 `package.json:3` = `0.24.1`）。
- **两份副本约束**（`rule-templates.ts:4-8` 顶部注释）：模板（`rule-templates.ts`）与磁盘文件（`.claude/rules/`）的**正文内容**必须一致。
- **frontmatter 不对称（已存在现状，本 plan 遵循）**：`rule-templates.ts` 模板**有** frontmatter（`description` + `alwaysApply: false`）；`.claude/rules/` 磁盘文件**无** frontmatter（首行直接 `> 适用于 ...`，与现有 6 个磁盘文件一致）。两份副本差异仅 frontmatter + 版本号占位符，正文逐字相同。
- **版本号占位符**：模板用 `{{MCP_VERSION}}`（`project.ts:459` 运行时插值）；磁盘文件用具体版本 `v0.25.0+`（workflow 文档自本期首发）。
- **零机制改动**：不改 `rules-manifest.ts` / `project.ts` / `agentsmd-builder.ts`（`SECTION_TO_TEMPLATE` 不含 workflow，故 workflow 不进 AGENTS.md——这是有意决策，非遗漏）。
- **测试框架**：Vitest，测试文件位于 `test/tools/`（非 `src/tools/__tests__/`）。
- **commit 粒度**：每个 Task 末尾一次 commit，遵循项目 commit 惯例（`feat(...)`/`docs(...)`/`chore(release)`）。

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `.claude/rules/godot-mcp-workflow-bridge-e2e.md` | 创建 | Bridge E2E 运行时验证 workflow（磁盘副本，无 frontmatter，`v0.25.0+`） |
| `.claude/rules/godot-mcp-workflow-verify.md` | 创建 | 改→跑→验证闭环 workflow（磁盘副本） |
| `.claude/rules/godot-mcp-workflow-safe-edit.md` | 创建 | 安全编辑流 workflow（磁盘副本） |
| `src/tools/rule-templates.ts` | 修改（:669 后插入 3 key） | 3 个 workflow 模板（含 frontmatter + `{{MCP_VERSION}}`，反引号转义） |
| `test/tools/rule-templates-workflows.test.ts` | 创建 | 3 个 workflow key 的条目完整性测试 |
| `test/tools/rule-templates-engine-quirks.test.ts` | 修改（:21-31） | "6 个键齐全"断言 → "9 个键齐全"（加 3 个 workflow key） |
| `README.md` | 修改（:112 后插入） | 方法论故事段（中文，"批量操作与资源管理"段后） |
| `README.en.md` | 修改（:87 后插入） | 方法论故事段（英文，"Batch ops"段后） |
| `package.json` / `manifest.json` / `server.json` / `addons/godot_mcp_server/plugin.cfg` | 修改 | 版本 `0.24.1`/`0.24.0` → `0.25.0`（顺带修 `server.json` 已存在的 `0.24.0` 漂移） |

---

## Task 1: 新增 3 个 workflow 文档（磁盘副本 + 模板 + 测试）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-workflow-bridge-e2e.md`
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-workflow-verify.md`
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-workflow-safe-edit.md`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\rule-templates.ts:669`（在 engine-quirks 模板闭合 `` `, `` 后、`};` 前插入 3 key）
- Create: `D:\GitHub\godot-mcp-enhanced\test\tools\rule-templates-workflows.test.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\test\tools\rule-templates-engine-quirks.test.ts:21-31`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\rule-templates-workflows.test.ts` + `D:\GitHub\godot-mcp-enhanced\test\tools\rule-templates-engine-quirks.test.ts`

**Interfaces:**
- Consumes: 无（首个 task）
- Produces: `DETAILED_RULE_TEMPLATES['godot-mcp-workflow-bridge-e2e.md' | 'godot-mcp-workflow-verify.md' | 'godot-mcp-workflow-safe-edit.md']` 三个键存在；`project.ts:474` 的 `Object.keys(DETAILED_RULE_TEMPLATES)` 自动含 3 个新键 → `setup_project_rules` 分发它们；`rules-manifest.ts` 的 `planReconcile`/`classifyFile` 按文件名遍历，自动覆盖。

**⚠️ 实现决策（spec §3.3"与模板一致"的澄清）：**
spec §3.3 说磁盘文件"与模板一致"。核实现状：现有 6 个 `.claude/rules/*.md` 磁盘文件**均无 frontmatter**（首行直接 `> 适用于 ...`），而 `rule-templates.ts` 模板**有** frontmatter。两份副本在 frontmatter 上本就不对称（已存在现状）。本 plan 遵循磁盘族现状：**磁盘文件无 frontmatter，正文与模板逐字一致**。frontmatter 是模板特有（`setup_project_rules` 写用户项目时保留 frontmatter 供 Claude Code rules 加载用）。若 reviewer 认为磁盘副本也应含 frontmatter，可在本 task 后追加（但会与现有 6 个磁盘文件不一致——不推荐）。

- [ ] **Step 1: 创建磁盘文件 `godot-mcp-workflow-bridge-e2e.md`**

写入 `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-workflow-bridge-e2e.md`（**无 frontmatter**，首行版本引用用具体 `v0.25.0+`）：

```markdown
> 适用于 godot-mcp-enhanced v0.25.0+

## 运行时验证 / E2E 流程

把"安装 Bridge → 启动游戏 → 连接 → 模拟输入 → 留证"串成可遵循的 checklist，避免遗漏前置步骤。工具细节见 `godot-mcp-bridge.md` 与 `godot-mcp-recording.md`。

**何时用**：需要验证运行时行为、做 E2E 测试、模拟输入、回归测试、Bug 复现时。

**checklist**：
- [ ] 1. `game_bridge_install(project_path)` — 一次性安装 Bridge autoload（端口 9081，写 project.godot）
- [ ] 2. `run_project(project_path, wait_for_bridge=true)` — 启动游戏并等 Bridge 就绪（`bridge_timeout` 默认 10s）
- [ ] 3. `game_query(method="ping")` — 确认连接（期望 `status: "ok"`）；未连排查：未 install / 游戏没运行 / 密钥权限
- [ ] 4. 操作 + 验证：`game_input`（send_key/send_mouse_click/send_text）模拟输入 → `game_wait`（wait_for_node/wait_for_property）等状态变化
- [ ] 5. 留证：`take_screenshot`（**GPU viewport 真渲染**，非 headless 空白）/ 或 `frame-verify`（反作弊退化检测）

**常见偏离**：
- 忘记 `game_bridge_install`（query/input 直接报 BRIDGE_NOT_CONNECTED）
- 游戏没运行就 query（Bridge 只在游戏运行时监听）
- 用 headless `screenshot` 做运行时视觉确认（headless 用 RendererDummy，2D/3D 均空白）→ 必须用 bridge `take_screenshot`
- 节点路径不用绝对路径（`game_write`/`game_wait` 的 `path` 必须以 `/root/` 开头）
```

- [ ] **Step 2: 创建磁盘文件 `godot-mcp-workflow-verify.md`**

写入 `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-workflow-verify.md`：

```markdown
> 适用于 godot-mcp-enhanced v0.25.0+

## 改 → 跑 → 验证闭环

把"理解 → 改 → 跑 → 编译验证 → 交付门禁"串成 checklist，避免只跑一种验证就交付。工具细节见 `godot-mcp-core.md`。

**何时用**：改完代码/场景后需要验证、交付前自检时。

**checklist**：
- [ ] 1. `read_scene` / `read_script` — 理解现有结构（属性类型解析）
- [ ] 2. `edit_script`（**search_and_replace 优先**）/ `write_script` — 修改
- [ ] 3. `run_and_verify(capture_tree=true)` — headless 跑 + 结构化错误分析（自动识别 autoload 相关 headless_limitation）
- [ ] 4. `validate_scripts` — 触发 Godot 完整 `load()` 编译（含**跨文件依赖**，捕 headless 运行遗漏的 Parse Error）
- [ ] 5. `verify_delivery` — 交付门禁（场景树完整性 + 脚本健康 + 性能 + 自定义断言 + GDD 合规）

**常见偏离**：
- 只跑 `run_and_verify` 不跑 `validate_scripts`（漏跨文件编译错误——两者可能不一致，以 run_and_verify 实跑为准但 validate_scripts 补跨文件依赖）
- 运行时工具（signal/tilemap/particles 等）误认为持久化（headless 退出即丢失，持久化须 add_node + save_scene）
- 忘记 `_mcp_done()`（execute_gdscript 片段模式超时）
```

- [ ] **Step 3: 创建磁盘文件 `godot-mcp-workflow-safe-edit.md`**

写入 `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-workflow-safe-edit.md`：

```markdown
> 适用于 godot-mcp-enhanced v0.25.0+

## 安全编辑流

编辑 `.gd`/`.tscn`、删节点、运行危险操作时的防护 checklist。工具细节见 `godot-mcp-core.md` 与 `godot-mcp-editor.md`。

**何时用**：编辑 `.gd`/`.tscn`、删节点、执行危险操作时。

**checklist**：
- [ ] 1. `edit_script` **优先 search_and_replace**（内容匹配、行号偏移鲁棒、CRLF 安全、免确认 token）；**禁用内置 Edit 工具改 .gd**（tab 缩进匹配率极低）
- [ ] 2. 改 `.gd` 后必跑 `validate_scripts`（验证语法）
- [ ] 3. headless 改盘 + editor 开同场景 → Ctrl+S 覆盖风险：建议 editor 内 Reload 场景或关闭该场景后再操作
- [ ] 4. 危险操作（`remove_node` 等）需显式确认令牌
- [ ] 5. GDScript 沙箱是**防误用层非防对抗**（间接构造可绕过；真正隔离须容器/VM + `GODOT_MCP_ALLOW_UNSAFE=false`）

**常见偏离**：
- 用内置 Edit 工具改 `.gd`（tab 缩进失败）
- 改完不 validate
- headless 改盘后被 editor 旧版本 Ctrl+S 覆盖（MCP 不可控，须 Reload）
```

- [ ] **Step 4: 在 `rule-templates.ts` 加 3 个模板 key**

打开 `D:\GitHub\godot-mcp-enhanced\src\tools\rule-templates.ts`。当前 engine-quirks 模板在第 669 行以 `` `, `` 闭合，第 670 行是 `};`。在 669 行之后、670 行 `};` 之前，插入以下 3 个 key（**注意：反引号字符串内，正文里的反引号 `` ` `` 必须转义为 `` \` ``，与现有 6 个模板一致**）：

```typescript

  'godot-mcp-workflow-bridge-e2e.md': `---
description: "bridge e2e 运行时验证 game_bridge_install run_project wait_for_bridge game_query ping game_input game_wait take_screenshot frame-verify 录制 回归测试 输入模拟 —— 当你需要验证运行时行为、做 E2E 测试、模拟输入或回归测试时使用"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 运行时验证 / E2E 流程

把"安装 Bridge → 启动游戏 → 连接 → 模拟输入 → 留证"串成可遵循的 checklist，避免遗漏前置步骤。工具细节见 \`godot-mcp-bridge.md\` 与 \`godot-mcp-recording.md\`。

**何时用**：需要验证运行时行为、做 E2E 测试、模拟输入、回归测试、Bug 复现时。

**checklist**：
- [ ] 1. \`game_bridge_install(project_path)\` — 一次性安装 Bridge autoload（端口 9081，写 project.godot）
- [ ] 2. \`run_project(project_path, wait_for_bridge=true)\` — 启动游戏并等 Bridge 就绪（\`bridge_timeout\` 默认 10s）
- [ ] 3. \`game_query(method="ping")\` — 确认连接（期望 \`status: "ok"\`）；未连排查：未 install / 游戏没运行 / 密钥权限
- [ ] 4. 操作 + 验证：\`game_input\`（send_key/send_mouse_click/send_text）模拟输入 → \`game_wait\`（wait_for_node/wait_for_property）等状态变化
- [ ] 5. 留证：\`take_screenshot\`（**GPU viewport 真渲染**，非 headless 空白）/ 或 \`frame-verify\`（反作弊退化检测）

**常见偏离**：
- 忘记 \`game_bridge_install\`（query/input 直接报 BRIDGE_NOT_CONNECTED）
- 游戏没运行就 query（Bridge 只在游戏运行时监听）
- 用 headless \`screenshot\` 做运行时视觉确认（headless 用 RendererDummy，2D/3D 均空白）→ 必须用 bridge \`take_screenshot\`
- 节点路径不用绝对路径（\`game_write\`/\`game_wait\` 的 \`path\` 必须以 \`/root/\` 开头）
`,

  'godot-mcp-workflow-verify.md': `---
description: "验证闭环 run_and_verify validate_scripts verify_delivery read_scene edit_script 交付门禁 编译 跨文件依赖 parse error 场景树完整性 —— 当你改完代码/场景需要验证或交付前自检时使用"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 改 → 跑 → 验证闭环

把"理解 → 改 → 跑 → 编译验证 → 交付门禁"串成 checklist，避免只跑一种验证就交付。工具细节见 \`godot-mcp-core.md\`。

**何时用**：改完代码/场景后需要验证、交付前自检时。

**checklist**：
- [ ] 1. \`read_scene\` / \`read_script\` — 理解现有结构（属性类型解析）
- [ ] 2. \`edit_script\`（**search_and_replace 优先**）/ \`write_script\` — 修改
- [ ] 3. \`run_and_verify(capture_tree=true)\` — headless 跑 + 结构化错误分析（自动识别 autoload 相关 headless_limitation）
- [ ] 4. \`validate_scripts\` — 触发 Godot 完整 \`load()\` 编译（含**跨文件依赖**，捕 headless 运行遗漏的 Parse Error）
- [ ] 5. \`verify_delivery\` — 交付门禁（场景树完整性 + 脚本健康 + 性能 + 自定义断言 + GDD 合规）

**常见偏离**：
- 只跑 \`run_and_verify\` 不跑 \`validate_scripts\`（漏跨文件编译错误——两者可能不一致，以 run_and_verify 实跑为准但 validate_scripts 补跨文件依赖）
- 运行时工具（signal/tilemap/particles 等）误认为持久化（headless 退出即丢失，持久化须 add_node + save_scene）
- 忘记 \`_mcp_done()\`（execute_gdscript 片段模式超时）
`,

  'godot-mcp-workflow-safe-edit.md': `---
description: "安全编辑 edit_script search_and_replace validate_scripts 确认令牌 remove_node headless 改盘 editor 覆盖 沙箱 防误用 CRLF tab 缩进 —— 当你编辑 .gd/.tscn、删节点或执行危险操作时使用"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 安全编辑流

编辑 \`.gd\`/\`.tscn\`、删节点、运行危险操作时的防护 checklist。工具细节见 \`godot-mcp-core.md\` 与 \`godot-mcp-editor.md\`。

**何时用**：编辑 \`.gd\`/\`.tscn\`、删节点、执行危险操作时。

**checklist**：
- [ ] 1. \`edit_script\` **优先 search_and_replace**（内容匹配、行号偏移鲁棒、CRLF 安全、免确认 token）；**禁用内置 Edit 工具改 .gd**（tab 缩进匹配率极低）
- [ ] 2. 改 \`.gd\` 后必跑 \`validate_scripts\`（验证语法）
- [ ] 3. headless 改盘 + editor 开同场景 → Ctrl+S 覆盖风险：建议 editor 内 Reload 场景或关闭该场景后再操作
- [ ] 4. 危险操作（\`remove_node\` 等）需显式确认令牌
- [ ] 5. GDScript 沙箱是**防误用层非防对抗**（间接构造可绕过；真正隔离须容器/VM + \`GODOT_MCP_ALLOW_UNSAFE=false\`）

**常见偏离**：
- 用内置 Edit 工具改 \`.gd\`（tab 缩进失败）
- 改完不 validate
- headless 改盘后被 editor 旧版本 Ctrl+S 覆盖（MCP 不可控，须 Reload）
`,
```

- [ ] **Step 5: 写失败的测试 `rule-templates-workflows.test.ts`**

创建 `D:\GitHub\godot-mcp-enhanced\test\tools\rule-templates-workflows.test.ts`（参照 `rule-templates-engine-quirks.test.ts` 的形态，但合并 3 个 workflow 到一个文件，避免重复专项）：

```typescript
import { describe, it, expect } from 'vitest';
import { DETAILED_RULE_TEMPLATES } from '../../src/tools/rule-templates.js';

const WORKFLOW_KEYS = [
  'godot-mcp-workflow-bridge-e2e.md',
  'godot-mcp-workflow-verify.md',
  'godot-mcp-workflow-safe-edit.md',
] as const;

describe('DETAILED_RULE_TEMPLATES 含 3 个 workflow 文档', () => {
  it('3 个 workflow 键存在且非空', () => {
    for (const key of WORKFLOW_KEYS) {
      expect(DETAILED_RULE_TEMPLATES[key]).toBeTruthy();
      expect(DETAILED_RULE_TEMPLATES[key]!.length).toBeGreaterThan(300);
    }
  });

  it('3 个 workflow 有 frontmatter（description + alwaysApply:false）', () => {
    for (const key of WORKFLOW_KEYS) {
      const tpl = DETAILED_RULE_TEMPLATES[key]!;
      expect(tpl.startsWith('---\n')).toBe(true);
      expect(tpl).toContain('description:');
      expect(tpl).toContain('alwaysApply: false');
    }
  });

  it('3 个 workflow 含 {{MCP_VERSION}} 占位符 + checklist（- [ ]）', () => {
    for (const key of WORKFLOW_KEYS) {
      const tpl = DETAILED_RULE_TEMPLATES[key]!;
      expect(tpl).toContain('{{MCP_VERSION}}');
      expect(tpl).toContain('- [ ]');
    }
  });
});
```

- [ ] **Step 6: 运行新测试，确认通过（Step 4 已加 key，应直接 PASS）**

Run: `npx vitest run test/tools/rule-templates-workflows.test.ts`
Expected: PASS（3 个 it 全过）

> 注：本 plan 不要求"先红后绿"写一个必然失败的测试，因为 Step 4 已实现 key，Step 5 的测试是验证已实现内容（条目完整性测试本质是回归守护，非 TDD 驱动设计——spec §6 明确这是"新建条目完整性测试"）。

- [ ] **Step 7: 更新 `rule-templates-engine-quirks.test.ts` 的键齐全断言（6 → 9）**

打开 `D:\GitHub\godot-mcp-enhanced\test\tools\rule-templates-engine-quirks.test.ts`。第 21-31 行的 `it('6 个详细模板键齐全', ...)` 断言会因新增 3 个 workflow key 而**失败**（实际 keys 变 9 个）。把该 it 块的标题与预期数组更新为 9 个键（按字母序）：

```typescript
  it('9 个详细模板键齐全（6 子系统 + 3 workflow）', () => {
    const keys = Object.keys(DETAILED_RULE_TEMPLATES).sort();
    expect(keys).toEqual([
      'godot-mcp-bridge.md',
      'godot-mcp-core.md',
      'godot-mcp-editor.md',
      'godot-mcp-engine-quirks.md',
      'godot-mcp-recording.md',
      'godot-mcp-ui.md',
      'godot-mcp-workflow-bridge-e2e.md',
      'godot-mcp-workflow-safe-edit.md',
      'godot-mcp-workflow-verify.md',
    ]);
  });
```

- [ ] **Step 8: 运行 engine-quirks 测试，确认 9 键断言通过**

Run: `npx vitest run test/tools/rule-templates-engine-quirks.test.ts`
Expected: PASS（4 个 it 全过，含更新后的"9 个键齐全"）

- [ ] **Step 9: 运行全量 rule-templates + rules-manifest 相关测试，确认无回归**

Run: `npx vitest run test/tools/rule-templates-workflows.test.ts test/tools/rule-templates-engine-quirks.test.ts test/tools/setup-project-rules-manifest.test.ts test/tools/base-rule-version.test.ts`
Expected: 全部 PASS

- [ ] **Step 10: 校验两份副本正文一致（防 spec §9 漂移风险）**

人工核对：`.claude/rules/godot-mcp-workflow-*.md`（磁盘，无 frontmatter，`v0.25.0+`）的正文，与 `rule-templates.ts` 对应模板（去 frontmatter + `{{MCP_VERSION}}` → `v0.25.0` 后）**逐字一致**。差异仅允许：frontmatter（模板有/磁盘无）+ 版本号占位符（模板 `{{MCP_VERSION}}`/磁盘 `v0.25.0`）。

Run（快速核对占位符替换后的一致性，可选）:
```bash
node -e "const {DETAILED_RULE_TEMPLATES}=require('./dist/tools/rule-templates.js');const fs=require('fs');for(const k of ['godot-mcp-workflow-bridge-e2e.md','godot-mcp-workflow-verify.md','godot-mcp-workflow-safe-edit.md']){const tpl=DETAILED_RULE_TEMPLATES[k].replace(/^---[\s\S]*?---\n/,'').replace(/{{MCP_VERSION}}/g,'v0.25.0');const disk=fs.readFileSync('.claude/rules/'+k,'utf8');console.log(k, tpl===disk?'MATCH':'DRIFT');}"
```
Expected: 3 行均 `MATCH`（若用 dist 不便，跳过脚本，人工 diff 即可）

- [ ] **Step 11: Commit**

```bash
git add .claude/rules/godot-mcp-workflow-bridge-e2e.md .claude/rules/godot-mcp-workflow-verify.md .claude/rules/godot-mcp-workflow-safe-edit.md src/tools/rule-templates.ts test/tools/rule-templates-workflows.test.ts test/tools/rule-templates-engine-quirks.test.ts
git commit -m "feat(rules): 新增 3 个跨子系统 workflow 文档（bridge-e2e/verify/safe-edit）

- .claude/rules/ 磁盘副本 3 个（无 frontmatter，v0.25.0+）
- rule-templates.ts DETAILED_RULE_TEMPLATES 加 3 key（含 frontmatter + {{MCP_VERSION}}）
- 新建 rule-templates-workflows.test.ts 条目完整性测试
- engine-quirks 测试键齐全断言 6→9
- 分发机制零改动（project.ts Object.keys 自动纳入）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: README 方法论故事段（中英）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\README.md:112`（"### 批量操作与资源管理"段末尾后、"## 工具一览"前插入）
- Modify: `D:\GitHub\godot-mcp-enhanced\README.en.md:87`（"### Batch ops & resource management"段末尾后、"## Tools (28)"前插入）

**Interfaces:**
- Consumes: Task 1 的 3 个 workflow 文档名
- Produces: README 中英两版含方法论叙事段

**⚠️ 标题决策（spec §4 标题撞车）：**
spec §4 原标题"### 不只是工具，是带 checklist 的开发流程"与 `README.md:95` 现有段"### AI 开发闭环 — 不只是工具堆砌"都含"不只是工具"，措辞重复会让读者困惑。本 plan 改用**`### 结构化开发流程（带 checklist）`**（中文）/ **`### Structured workflows (with checklists)`**（英文），点明"流程文档"且与 :95 闭环段区分。正文仍用 spec §4 内容（对标 superpowers 叙事）。若 user 偏好 spec 原标题可回退，但需接受与 :95 的措辞重复。

- [ ] **Step 1: 在 `README.md` 插入中文方法论段**

打开 `D:\GitHub\godot-mcp-enhanced\README.md`。定位第 108 行 `### 批量操作与资源管理` 段（至第 112 行 `import_resources` 条目结束），其第 114 行是 `## 工具一览`。在第 112 行（`import_resources` 条目）之后、第 114 行（`## 工具一览`）之前，插入空行 + 以下段落：

```markdown

### 结构化开发流程（带 checklist）

对标 agentic skills 方法论（如 obra/superpowers），本项目不止堆工具，还提供 AI 可遵循的结构化开发流程（`setup_project_rules` 生成到 `.claude/rules/godot-mcp-workflow-*.md`）：

- **Bridge E2E 流程** — install → run(wait_for_bridge) → ping → 操作+wait → 截图/frame-verify 留证
- **改→跑→验证闭环** — read → edit → run_and_verify → validate_scripts → verify_delivery
- **安全编辑流** — search_and_replace 优先 / 改后 validate / 防覆盖 / 确认令牌

每个流程带 checklist + 常见偏离提示，让 AI 少踩坑、按纪律走。
```

- [ ] **Step 2: 在 `README.en.md` 插入英文方法论段**

打开 `D:\GitHub\godot-mcp-enhanced\README.en.md`。定位第 83 行 `### Batch ops & resource management` 段（至第 87 行 `import_resources` 条目结束），其第 89 行是 `## Tools (28)`。在第 87 行之后、第 89 行之前，插入空行 + 以下段落：

```markdown

### Structured workflows (with checklists)

Following agentic-skills methodology (e.g. obra/superpowers), this project ships AI-followable structured development workflows (`setup_project_rules` generates them to `.claude/rules/godot-mcp-workflow-*.md`):

- **Bridge E2E flow** — install → run(wait_for_bridge) → ping → input+wait → screenshot/frame-verify
- **Edit→Run→Verify loop** — read → edit → run_and_verify → validate_scripts → verify_delivery
- **Safe-edit flow** — search_and_replace first / validate after edit / override-guard / confirm token

Each workflow ships with a checklist + common-deviation tips, keeping AI on-rails and reducing footguns.
```

- [ ] **Step 3: 校验插入位置 + 无重复标题**

Run: `grep -n "结构化开发流程\|不只是工具\|## 工具一览\|### 批量操作" README.md`
Expected: 看到"### 结构化开发流程（带 checklist）"出现在"### 批量操作与资源管理"之后、"## 工具一览"之前；"不只是工具堆砌"仍在第 95 行（两段不撞标题）。

Run: `grep -n "Structured workflows\|## Tools\|Batch ops" README.en.md`
Expected: "### Structured workflows (with checklists)"出现在"### Batch ops & resource management"之后、"## Tools (28)"之前。

- [ ] **Step 4: Commit**

```bash
git add README.md README.en.md
git commit -m "docs(readme): 方法论 workflow 故事段（中英）

README.md/README.en.md 在核心能力段加\"结构化开发流程\"段，
对标 superpowers 叙事，引导 setup_project_rules 生成的 workflow 文档。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 版本 bump 0.24.1 → 0.25.0 + 元数据同步（修 server.json 漂移）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json:3`（`0.24.1` → `0.25.0`）
- Modify: `D:\GitHub\godot-mcp-enhanced\manifest.json:5`（`0.24.1` → `0.25.0`）
- Modify: `D:\GitHub\godot-mcp-enhanced\server.json:9` + `:14`（**`0.24.0` → `0.25.0`**，顺带修复已存在的版本漂移：server.json 停在 0.24.0，落后 package.json 的 0.24.1）
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\plugin.cfg:6`（`0.24.1` → `0.25.0`）
- Modify: `D:\GitHub\godot-mcp-enhanced\package-lock.json:3` + `:9`（`npm install` 自动同步）

**Interfaces:**
- Consumes: Task 1（模板变更触发 CI `check-rules-version-bump` 要求 bump）
- Produces: 所有版本元数据点对齐 `0.25.0`；CI `check-rules-version-bump` 通过。

**⚠️ bonus 修复**：`server.json` 当前是 `0.24.0`（落后），本 task 顺带拉齐到 `0.25.0`，消除已存在漂移。无需单独 task（属同一版本同步动作）。

- [ ] **Step 1: 改 4 个版本元数据文件**

逐个修改（用 Edit 工具，精确匹配）：

`package.json:3`：`"version": "0.24.1"` → `"version": "0.25.0"`
`manifest.json:5`：`"version": "0.24.1"` → `"version": "0.25.0"`
`server.json:9`：`"version": "0.24.0"` → `"version": "0.25.0"`
`server.json:14`：`"version": "0.24.0"` → `"version": "0.25.0"`
`addons/godot_mcp_server/plugin.cfg:6`：`version="0.24.1"` → `version="0.25.0"`

- [ ] **Step 2: 同步 package-lock.json**

Run: `npm install --package-lock-only`
Expected: `package-lock.json:3` + `:9` 更新为 `0.25.0`（仅更新 lock，不重装 node_modules）

- [ ] **Step 3: 校验所有版本点对齐 0.25.0**

Run: `grep -rn '"0\.25\.0"\|version="0\.25\.0"' package.json manifest.json server.json package-lock.json addons/godot_mcp_server/plugin.cfg`
Expected: 命中 package.json:3 / manifest.json:5 / server.json:9 / server.json:14 / package-lock.json:3 / package-lock.json:9 / plugin.cfg:6，且**无任何残留 `0.24.0` / `0.24.1`**

Run（确认无旧版本残留）: `grep -rn '0\.24\.[01]' package.json manifest.json server.json package-lock.json addons/godot_mcp_server/plugin.cfg`
Expected: 无匹配（全部已升 0.25.0）

- [ ] **Step 4: 跑 CI 本地等价检查（check-rules-version-bump）**

确认模板变更（Task 1）+ 版本 bump（本 task）满足 CI 规则。Run: `npx vitest run test/tools/base-rule-version.test.ts`
Expected: PASS（base rule 版本测试不回归）

> 若项目有 `npm run check:rules-version` 之类 script，优先跑它；否则 base-rule-version.test.ts 是最接近的本地校验。CI 的 `check-rules-version-bump` 会在 push 时强制——本 task 确保 bump 已发生即可。

- [ ] **Step 5: 跑全量测试确认无回归**

Run: `npm test`
Expected: 全量 PASS（Task 1 的 9 键 + workflows 测试 + 其他测试均过；允许已知的 pre-existing 4 failed，若出现需核对是否本 task 引入）

- [ ] **Step 6: Commit**

```bash
git add package.json manifest.json server.json package-lock.json addons/godot_mcp_server/plugin.cfg
git commit -m "chore(release): v0.25.0 — workflow 文档 + 版本元数据同步

- package.json/manifest.json/plugin.cfg 0.24.1→0.25.0
- server.json 0.24.0→0.25.0（顺带修复已存在漂移：v0.24.1 发版漏改）
- 模板变更（3 workflow）触发 CI check-rules-version-bump 要求 bump

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 端到端验收（setup_project_rules 干净项目集成验证）

**Files:**
- 无新建/修改（纯验证 task）；若验收失败回到对应 Task 修复。

**Interfaces:**
- Consumes: Task 1（模板）+ Task 3（版本）
- Produces: spec §8 验收标准 1-3 的证据。

**前提**：本 task 验证 `setup_project_rules` 在干净项目的实际分发。执行者需有可用的 Godot MCP 工具（`mcp__godot:setup_project_rules`）或用 headless `execute_gdscript` 模拟。若在无 MCP 工具的 subagent 执行，本 task 留给 controller 人工验收（spec §8 标准 1-3）。

- [ ] **Step 1: 准备干净测试项目**

创建/复用一个空 Godot 项目目录（如 `D:\GitHub\godot-mcp-enhanced\test-tmp\workflow-verify-fixture`），确保 `.claude/rules/` 不含 `godot-mcp-workflow-*.md`。

Run: `ls D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/ 2>/dev/null || echo "干净（无 workflow 文件）"`
Expected: `干净（无 workflow 文件）`（或目录不存在）

- [ ] **Step 2: 跑 setup_project_rules（adopt 模式）**

用 MCP 工具（controller 执行）：
```
setup_project_rules(project_path="D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture", action="adopt")
```
Expected: 返回成功，报告写入了 9 个详细规则文件（6 子系统 + 3 workflow）。

- [ ] **Step 3: 验收标准 1 — 干净项目出现 3 个 workflow 文件且含 checklist**

Run: `ls D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/godot-mcp-workflow-*.md`
Expected: 列出 3 个文件（bridge-e2e / verify / safe-edit）

Run: `grep -l "\- \[ \]" D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/godot-mcp-workflow-*.md | wc -l`
Expected: `3`（3 个文件都含 checklist）

Run（确认 frontmatter 已写入用户项目文件——与磁盘副本不同，用户项目文件保留模板的 frontmatter）: `grep -l "alwaysApply: false" D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/godot-mcp-workflow-*.md | wc -l`
Expected: `3`

Run（确认版本占位符已插值为具体版本，非裸 {{MCP_VERSION}}）: `grep "{{MCP_VERSION}}" D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/godot-mcp-workflow-*.md`
Expected: 无匹配（占位符已替换为 `v0.25.0`）

- [ ] **Step 4: 验收标准 2 — check 能识别新文件版本状态**

```
setup_project_rules(project_path="D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture", action="check")
```
Expected: 报告 3 个 workflow 文件处于 `up-to-date`（或纯升级分类），manifest 正确记录。

- [ ] **Step 5: 验收标准 3 — 缺失补全机制（旧项目 update 写入新文件）**

模拟旧项目（无 workflow 文件）：删除刚生成的 3 个 workflow 文件（保留其他 6 个 + manifest），再跑 update：
```
rm D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/godot-mcp-workflow-*.md
setup_project_rules(project_path="D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture", action="update")
```
Expected: 3 个 workflow 文件由缺失补全机制重新写入（`project.ts:473-487`，任意 rules_mode 先创建缺失文件），内容为模板（插值后）。

Run: `ls D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture/.claude/rules/godot-mcp-workflow-*.md | wc -l`
Expected: `3`

- [ ] **Step 6: 清理测试 fixture + 验收总结**

Run: `rm -rf D:/GitHub/godot-mcp-enhanced/test-tmp/workflow-verify-fixture`
Expected: 清理完成（不污染仓库）

**验收 checklist（spec §8 全部 6 条）**：
- [ ] §8.1 干净项目生成 3 个 workflow 文件含 checklist ✓（Step 3）
- [ ] §8.2 check 识别新文件版本状态 ✓（Step 4）
- [ ] §8.3 升级场景缺失补全写入 + 用户修改 warn-keep ✓（Step 5 验证缺失补全；warn-keep 由现有 rules-manifest 测试覆盖）
- [ ] §8.4 README 中英含方法论段 ✓（Task 2）
- [ ] §8.5 package.json 0.25.0 + CI check-rules-version-bump 通过 ✓（Task 3 + CI）
- [ ] §8.6 rule-templates 测试新增断言通过 ✓（Task 1 Step 6/8/9）

- [ ] **Step 7: 无 commit（纯验收 task）**

本 task 不产生代码变更（仅临时 fixture，已清理）。若 Step 1-6 任一失败，回到对应 Task 修复并重新 commit；全部通过则整个 plan 完成。

---

## Self-Review

**1. Spec coverage（逐条对照 spec §1-9 + 审查报告 6 项修正）：**

| spec 条目 | 覆盖 task/step |
|----------|---------------|
| §2.1 bridge-e2e 文档（frontmatter + 何时用 + checklist + 偏离） | Task 1 Step 1（磁盘）+ Step 4（模板） |
| §2.2 verify 文档 | Task 1 Step 2 + Step 4 |
| §2.3 safe-edit 文档 | Task 1 Step 3 + Step 4 |
| §2 文档结构约定（正文首行 `{{MCP_VERSION}}`） | Task 1 Step 4（模板含）+ Step 1-3（磁盘含 `v0.25.0+`） |
| §3.1 rule-templates.ts 加 3 key（两份副本一致） | Task 1 Step 4 + Step 10（一致性校验） |
| §3.2 rules-manifest.ts 零改动（复用） | Global Constraints 明示不改；Task 4 Step 4/5 验证分发生效 |
| §3.3 .claude/rules/ 磁盘文件 | Task 1 Step 1-3 |
| §4 README 方法论段（中英） | Task 2 |
| §5 版本 0.24.1→0.25.0 + 元数据同步 | Task 3（+ bonus 修 server.json 漂移） |
| §6 测试策略（新建条目完整性测试 + 不新增运行时测试） | Task 1 Step 5-9 |
| §7 范围边界（不含形态 B/C） | Global Constraints + 不改 agentsmd-builder（workflow 不进 AGENTS.md） |
| §8 验收标准 1-6 | Task 4 Step 3-6 + Task 2/3 |
| §9 风险（AI 主动遵循率 / 两份副本漂移） | description 含"何时用"短语（Task 1 Step 4 模板）；Step 10 一致性校验 |
| 审查修正 1：版本号 0.24.1（非 0.24.0） | Task 3（基线 package.json:3 = 0.24.1 已核实） |
| 审查修正 2：测试路径 test/tools/ + 新建非追加 | Task 1 Step 5（`test/tools/rule-templates-workflows.test.ts`） |
| 审查修正 3：缺失补全机制措辞 | Task 4 Step 5（验证缺失补全） |
| 审查修正 4：正文首行 {{MCP_VERSION}} | Task 1 Step 4 |
| 审查修正 5：description "何时用" | Task 1 Step 4（3 个 description 均含"当你...时使用"） |
| 审查修正 6：star 数不硬编码 | README 段（Task 2）用"如 obra/superpowers"不写具体星数 |

**spec §7 残留瑕疵（版本号自洽）**：spec §7 范围清单第 152 行仍写 `0.24.0 → 0.25.0`（与 §5 已修正的 `0.24.1` 不一致）。本 plan 以 §5 + 实测 `package.json:3 = 0.24.1` 为准（Task 3），忽略 §7 的滞后表述。

**Gaps：无未覆盖项。**

**2. Placeholder scan：** 无 TBD/TODO/"add appropriate X"/"similar to Task N"。所有 step 含完整代码/命令/预期输出。3 个 workflow 文档的完整 markdown 已内联（磁盘版 Step 1-3 + 模板版 Step 4）。

**3. Type/naming consistency：**
- 3 个 key 名全程一致：`godot-mcp-workflow-bridge-e2e.md` / `godot-mcp-workflow-verify.md` / `godot-mcp-workflow-safe-edit.md`（Task 1 Step 1-4 / Step 5 测试 / Step 7 断言 / Task 4 验收，命名统一）。
- 测试 import 路径 `../../src/tools/rule-templates.js`（与 engine-quirks 测试一致，.js 扩展名匹配现有 TS→ESM 编译惯例）。
- `WORKFLOW_KEYS` 数组顺序 = 字母序（与 Step 7 的 9 键 `toEqual` 字母序一致，避免排序断言失败）。

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-27-godot-methodology-workflows.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 task 派一个全新 subagent 执行，task 间 review，快速迭代。

**2. Inline Execution** — 在当前会话用 executing-plans 批量执行，带 checkpoint review。

Which approach?
