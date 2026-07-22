# ZCode 深度支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 godot-mcp-enhanced 深度支持 ZCode（智谱 GLM-5.2 ADE）：setup_project_rules 默认双写 CLAUDE.md + AGENTS.md（全量合并规则），并提供 ZCode 接入指南 + 确认机制对齐分析 + 协议层与 GUI 端到端实测。

**Architecture:** 仅面②动 TS 代码——新增 `agentsmd-builder.ts` 组装单文件 AGENTS.md，抽取共享 `section-merge.ts`，把 engine-quirks 纳入分发模板，project.ts 加 `agents_md` 参数实现双写。面①③是文档（接入指南 + 权限矩阵），面④是实测（协议层 SDK 模拟 + GUI 端到端，回填指南）。

**Tech Stack:** TypeScript（vitest 测试）、MCP SDK（`@modelcontextprotocol/sdk`）、GDScript 规则模板。

## Global Constraints

- **路径规范**：所有文件引用用绝对路径；plan 内代码 `import` 用相对路径（项目惯例）。
- **编辑 .ts 用标准 Edit/Write**（非 .gd，不用 edit_script）。
- **测试框架**：vitest，纯函数驱动 + 临时目录（见 `test/tools/setup-project-rules-manifest.test.ts` 模式）。测试文件放 `test/tools/`。
- **风格**：单文件单职责；JSDoc/注释用中文；camelCase；与 `claudemd-builder.ts`/`project.ts` 现有风格一致。
- **TDD**：每个代码 Task 先写失败测试 → 实现 → 通过 → commit。
- **不 push**：提交到本地 master，不 push origin（除非用户显式要求）。
- **AGENTS.md 内容前提**：「ZCode 单文件、不扫描子目录、不展开 @import」依赖官方文档 agents 页断言（webReader 抓取 2026-07-22）；Task 8 GUI 实测二次确认。若被推翻，Task 3/4 需重做。
- **行为变更登记**：`agents_md` 默认 true、engine-quirks 纳入分发——两处写入 CHANGELOG。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `src/tools/shared/section-merge.ts` | 共享的 markdown section 解析/合并（参数化 sectionIds） | 新增 |
| `src/tools/claudemd-builder.ts` | CLAUDE.md 内容 builders + 绑定 SECTION_IDS 的 mergeSections 包装 | 改（抽离 parseSections/mergeSections 实现） |
| `src/tools/rule-templates.ts` | DETAILED_RULE_TEMPLATES（含新 engine-quirks） | 改（加 engine-quirks 键） |
| `src/tools/agentsmd-builder.ts` | 组装单文件 AGENTS.md（标题降级 + frontmatter 剥离 + 全量合并） | 新增 |
| `src/tools/project.ts` | setup_project_rules 双写 CLAUDE.md + AGENTS.md | 改（加 agents_md 参数 + 双写块） |
| `test/tools/section-merge.test.ts` | section-merge 参数化测试 | 新增 |
| `test/tools/agentsmd-builder.test.ts` | agentsmd-builder 单测 | 新增 |
| `test/tools/setup-project-rules-agents.test.ts` | 双写集成测试 | 新增 |
| `CHANGELOG.md` | 行为变更登记 | 改 |
| `README.md` / `README.en.md` | 客户端列表加 ZCode | 改 |
| `docs/使用指南-ZCode.md` | ZCode 接入指南（面①+③A半） | 新增 |
| `docs/zcode-protocol-verify.mjs` | 协议层 SDK 模拟验证脚本（面④协议层） | 新增 |

---

## Task 1: 抽取共享 section-merge.ts（参数化）

**Files:**
- Create: `src/tools/shared/section-merge.ts`
- Modify: `src/tools/claudemd-builder.ts`（删除 Section/normalizeHeader/parseSections/mergeSections 实现，改为 import + 绑定包装）
- Test: `test/tools/section-merge.test.ts`

**Interfaces:**
- Produces: `mergeSections(existing, newSections, sectionIds)`、`parseSections(content, sectionIds)`、`normalizeHeader(line)`、`Section`、`SectionIdSet`（导出自 `src/tools/shared/section-merge.ts`）
- claudemd-builder.ts 仍导出 `mergeSections(existing, newSections)`（绑定 `SECTION_IDS` 的包装，签名不变，`project.ts` 零改动）

- [ ] **Step 1: 写失败测试**

Create `test/tools/section-merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeSections, parseSections, normalizeHeader } from '../../src/tools/shared/section-merge.js';

describe('section-merge（参数化）', () => {
  it('mergeSections 用传入 sectionIds 判定 MCP 段并替换，保留用户段', () => {
    const ids = new Set(['## MCP段']);
    const existing = '# Title\n\n## MCP段\nold\n\n## 用户段\n用户内容\n';
    const merged = mergeSections(existing, [['## MCP段', 'new-body']], ids);
    expect(merged).toContain('new-body');
    expect(merged).not.toContain('old');
    expect(merged).toContain('用户内容');
  });

  it('空 existing 直接拼接 newSections', () => {
    const ids = new Set(['## A']);
    const merged = mergeSections('', [['## A', 'a'], ['## B', 'b']], ids);
    expect(merged).toBe('## A\na\n\n## B\nb\n');
  });

  it('不同 sectionIds 产生不同 isMcp 判定', () => {
    const existing = '# T\n\n## X\nx\n';
    expect(parseSections(existing, new Set(['## X'])).sections[0]!.isMcp).toBe(true);
    expect(parseSections(existing, new Set<string>()).sections[0]!.isMcp).toBe(false);
  });

  it('normalizeHeader 折叠空白', () => {
    expect(normalizeHeader('##   a   b')).toBe('## a b');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/tools/section-merge.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/shared/section-merge.js'`

- [ ] **Step 3: 创建 shared/section-merge.ts**

Create `src/tools/shared/section-merge.ts`（从 `claudemd-builder.ts:336-426` 抽离 Section/normalizeHeader/parseSections/mergeSections，parseSections 与 mergeSections 加 `sectionIds` 参数）:

```typescript
// src/tools/shared/section-merge.ts
// 共享的 markdown section 解析/合并逻辑，供 claudemd-builder（CLAUDE.md）与
// agentsmd-builder（AGENTS.md）复用。参数化 sectionIds 以区分两套 MCP 管控段白名单。

export type SectionIdSet = Set<string>;

export interface Section {
  header: string;
  headerNorm: string;
  body: string;
  isMcp: boolean;
}

export function normalizeHeader(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

export function parseSections(content: string, sectionIds: SectionIdSet): {
  title: string;
  preSections: string;
  sections: Section[];
} {
  const lines = content.split('\n');

  // Extract title (# ...)
  let title = '';
  let titleEndIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^# /.test(lines[i]!)) {
      title = lines[i]!;
      titleEndIdx = i + 1;
      break;
    }
  }

  // Collect text between title and first ## header
  let preSections = '';
  let firstSectionIdx = lines.length;
  for (let i = titleEndIdx; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i]!)) {
      firstSectionIdx = i;
      break;
    }
    preSections += (preSections ? '\n' : '') + lines[i]!;
  }
  preSections = preSections.trim();

  // Parse ## sections
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = firstSectionIdx; i < lines.length; i++) {
    const headerMatch = lines[i]!.match(/^## (?!#)\s*(.*)/);
    if (headerMatch) {
      if (current) sections.push(current);
      const fullHeader = '## ' + headerMatch[1]!.trim();
      const norm = normalizeHeader(fullHeader);
      current = {
        header: fullHeader,
        headerNorm: norm,
        body: '',
        isMcp: sectionIds.has(norm),
      };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + lines[i];
    }
  }
  if (current) sections.push(current);

  return { title, preSections, sections };
}

export function mergeSections(
  existing: string,
  newSections: Array<[string, string]>,
  sectionIds: SectionIdSet,
): string {
  if (!existing.trim()) {
    return newSections.map(([h, b]) => `${h}\n${b}`).join('\n\n') + '\n';
  }

  const { title, preSections, sections } = parseSections(existing, sectionIds);

  // Collect user (non-MCP) sections in original order
  const userSections = sections.filter(s => !s.isMcp);

  // Build output
  const parts: string[] = [];
  if (title) parts.push(title);

  // New MCP sections
  for (const [header, body] of newSections) {
    parts.push(`${header}\n${body}`);
  }

  // User pre-section text
  if (preSections !== '') parts.push(preSections);

  // User sections
  for (const s of userSections) {
    parts.push(s.body.trim() ? `${s.header}\n${s.body}` : s.header);
  }

  return parts.join('\n\n') + '\n';
}
```

- [ ] **Step 4: 改 claudemd-builder.ts —— 删除抽离的实现，改为 import + 绑定包装**

在 `src/tools/claudemd-builder.ts` 中：
1. 删除 `interface Section`（336-341）、`normalizeHeader`（343-345）、`parseSections`（347-396）、`mergeSections`（398-426）的本地实现。
2. 在文件顶部 import 区加：

```typescript
import { mergeSections as mergeSectionsGeneric } from './shared/section-merge.js';
```

3. 在 `SECTION_IDS`/`SECTION_ORDER` 定义之后（约 line 20 后）加绑定包装（保持 `project.ts` import 的 `mergeSections` 签名不变）:

```typescript
// 绑定 CLAUDE.md 的 SECTION_IDS，保持调用方（project.ts）签名不变
export function mergeSections(existing: string, newSections: Array<[string, string]>): string {
  return mergeSectionsGeneric(existing, newSections, SECTION_IDS);
}
```

- [ ] **Step 5: 运行新测试 + 回归测试确认通过**

Run: `npx vitest run test/tools/section-merge.test.ts test/tools/setup-project-rules-manifest.test.ts test/tools/base-rule-version.test.ts`
Expected: 全部 PASS（新测试通过，现有 CLAUDE.md 相关测试无回归）

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add src/tools/shared/section-merge.ts src/tools/claudemd-builder.ts test/tools/section-merge.test.ts
git commit -m "refactor(section-merge): 抽离共享 section 解析/合并，参数化 sectionIds

为 AGENTS.md builder 复用 mergeSections 做准备。claudemd-builder 改为
绑定 SECTION_IDS 的包装，project.ts 零改动。"
```

---

## Task 2: engine-quirks 纳入 DETAILED_RULE_TEMPLATES

**Files:**
- Modify: `src/tools/rule-templates.ts`（加 `'godot-mcp-engine-quirks.md'` 键）
- Source: `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-engine-quirks.md`（内容来源）
- Test: 复用现有分发逻辑，本 task 加断言测试

**Interfaces:**
- Produces: `DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']` 存在；`project.ts:469` 的 `Object.keys(DETAILED_RULE_TEMPLATES)` 自动含 engine-quirks → setup_project_rules 分发它
- 下游：agentsmd-builder（Task 3）从 `DETAILED_RULE_TEMPLATES` 统一取 engine-quirks

- [ ] **Step 1: 写失败测试**

Create `test/tools/rule-templates-engine-quirks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DETAILED_RULE_TEMPLATES } from '../../src/tools/rule-templates.js';

describe('DETAILED_RULE_TEMPLATES 含 engine-quirks', () => {
  it('engine-quirks 键存在且非空', () => {
    expect(DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']).toBeTruthy();
    expect(DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']!.length).toBeGreaterThan(500);
  });

  it('engine-quirks 有 yaml frontmatter（description/alwaysApply）', () => {
    const tpl = DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']!;
    expect(tpl.startsWith('---\n')).toBe(true);
    expect(tpl).toContain('description:');
    expect(tpl).toContain('alwaysApply:');
  });

  it('engine-quirks 含 {{MCP_VERSION}} 占位符', () => {
    expect(DETAILED_RULE_TEMPLATES['godot-mcp-engine-quirks.md']!).toContain('{{MCP_VERSION}}');
  });

  it('6 个详细模板键齐全', () => {
    const keys = Object.keys(DETAILED_RULE_TEMPLATES).sort();
    expect(keys).toEqual([
      'godot-mcp-bridge.md',
      'godot-mcp-core.md',
      'godot-mcp-editor.md',
      'godot-mcp-engine-quirks.md',
      'godot-mcp-recording.md',
      'godot-mcp-ui.md',
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/tools/rule-templates-engine-quirks.test.ts`
Expected: FAIL — engine-quirks 键不存在

- [ ] **Step 3: 把 engine-quirks 内容加进 DETAILED_RULE_TEMPLATES**

打开 `D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-engine-quirks.md`（内容来源，system reminder 已载全文）。在 `src/tools/rule-templates.ts` 的 `DETAILED_RULE_TEMPLATES` 对象中，在 `'godot-mcp-recording.md'` 键之后、闭合 `}` 之前，加 `'godot-mcp-engine-quirks.md'` 键。

**关键转换规则**（从 .md 文件内容 → TS 模板字符串）：
1. **补 yaml frontmatter**（文件当前以 `> 适用于...` 引用块开头，无 frontmatter）。在内容最前面加：

```
---
description: "godot-mcp 引擎陷阱 物理查询 碰撞体 ConcavePolygonShape3D CollisionLayer Mask ArrayMesh GenerateNormals GLB headless RID leak _Ready Free QueueFree Camera2D screenshot 截图 导航 bake shader compile_success MaterialOverride MultiMesh"
alwaysApply: false
---

```

2. **版本引用**：把文件首行的 `> 适用于 godot-mcp-enhanced v0.19+` 改为 `> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+`（统一占位符）。
3. **转义**：模板字符串用反引号包裹，内容中的反引号 `` ` `` 转义为 `` \` ``、`${` 转义为 `\${`（按现有 5 个模板的转义惯例，见 `rule-templates.ts:35-51` 的决策树代码块）。
4. 内容主体（## 定位 / ## 截图与捕获 / ## 物理查询 / ## 场景与资源导入 / ## Headless 执行 / ## 输入与相机 / ## 材质与着色器 / ## 导航）原样拷贝，仅做上述转义。

模板键插入示例（结构，content 为上述转换后的全文）:

```typescript
  'godot-mcp-engine-quirks.md': `---
description: "godot-mcp 引擎陷阱 物理查询 碰撞体 ConcavePolygonShape3D CollisionLayer Mask ArrayMesh GenerateNormals GLB headless RID leak _Ready Free QueueFree Camera2D screenshot 截图 导航 bake shader compile_success MaterialOverride MultiMesh"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 定位

这是 **Godot 引擎行为知识库**……（此处为 .claude/rules/godot-mcp-engine-quirks.md 全文，按转义规则处理）
`,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/tools/rule-templates-engine-quirks.test.ts`
Expected: PASS

- [ ] **Step 5: 验证 setup_project_rules 现在分发 engine-quirks（allFilenames 自动含）**

Run: `npx vitest run test/tools/setup-project-rules-manifest.test.ts`
Expected: PASS（`Object.keys(DETAILED_RULE_TEMPLATES)` 现含 6 键，adopt/reconcile 逻辑对此透明）

- [ ] **Step 6: 同步检查 .claude/rules/ 副本一致性**

文件头注（`rule-templates.ts:4-8`）声明模板与 `.claude/rules/` 是两份独立副本。本 task 把 engine-quirks 纳入模板后，`.claude/rules/godot-mcp-engine-quirks.md` 仍是仓库自用副本。确认两者内容一致（模板补了 frontmatter + 版本占位符，.claude/rules/ 副本保持原样即可——它是 project instruction，frontmatter 非必需）。无需改动 .claude/rules/ 副本。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add src/tools/rule-templates.ts test/tools/rule-templates-engine-quirks.test.ts
git commit -m "feat(rules): engine-quirks 纳入 DETAILED_RULE_TEMPLATES 分发

修复不一致：.claude/rules/ 有 engine-quirks 但 setup_project_rules 不分发。
补 yaml frontmatter + {{MCP_VERSION}} 占位符。setup_project_rules 现分发 6 个
详细规则文件。同时为 AGENTS.md 全量合并提供统一来源。"
```

---

## Task 3: agentsmd-builder.ts（标题降级 + 全量合并）

**Files:**
- Create: `src/tools/agentsmd-builder.ts`
- Test: `test/tools/agentsmd-builder.test.ts`

**Interfaces:**
- Consumes: `GODOT_MCP_RULES`、`buildEngineVersion`/`buildRenderer`/`buildKeyPaths`/`buildMainScene`/`buildAutoloads`/`buildInputMap`/`buildPhysics`/`buildLayerNames`/`buildTypeGuide`/`buildBestPractices`（from `claudemd-builder.ts`）、`DETAILED_RULE_TEMPLATES`（from `rule-templates.ts`，现含 engine-quirks）、`mergeSectionsGeneric`（from `shared/section-merge.ts`）
- Produces: `buildAgentsMd(config, projectDir, projectName, mcpVersion)` → string；`AGENTS_SECTION_IDS`：`Set<string>`

- [ ] **Step 1: 写失败测试**

Create `test/tools/agentsmd-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAgentsMd, AGENTS_SECTION_IDS } from '../../src/tools/agentsmd-builder.js';
import type { GodotConfig } from '../../src/helpers.js';

const config: GodotConfig = {
  application: { 'config/name': 'TestGame', 'config/features': 'PackedStringArray("4.6")', 'run/main_scene': 'res://main.tscn' },
} as unknown as GodotConfig;

describe('agentsmd-builder', () => {
  it('生成含全部 MCP 段 header', () => {
    const md = buildAgentsMd(config, '.', 'TestGame', '0.99.0');
    for (const h of AGENTS_SECTION_IDS) {
      expect(md).toContain(h);
    }
  });

  it('标题降级：规则文件内嵌 ## 不出现在顶层（被降为 ###）', () => {
    const md = buildAgentsMd(config, '.', 'TestGame', '0.99.0');
    // core 模板有 "## 概述与架构"，降级后应为 "### 概述与架构"，不应作为顶层 ##
    expect(md).not.toMatch(/\n## 概述与架构\n/);
    expect(md).toMatch(/### 概述与架构/);
  });

  it('剥离 yaml frontmatter（生成结果无 --- 块）', () => {
    const md = buildAgentsMd(config, '.', 'TestGame', '0.99.0');
    expect(md).not.toMatch(/\ndescription:\s/);
    expect(md).not.toMatch(/\nalwaysApply:\s/);
  });

  it('{{MCP_VERSION}} 插值', () => {
    const md = buildAgentsMd(config, '.', 'TestGame', '0.99.0');
    expect(md).not.toContain('{{MCP_VERSION}}');
    expect(md).toContain('0.99.0');
  });

  it('代码块内的 # 不被降级（状态机跳过 ``` 块）', () => {
    const md = buildAgentsMd(config, '.', 'TestGame', '0.99.0');
    // core 模板决策树代码块含 "├─" 不含 # 标题；但若有代码块内 # 注释应保留原样。
    // 关键：base 的 GODOT_MCP_RULES 内无代码块；core 决策树 ``` 块内的内容不应出现多余的 ### 降级。
    // 断言：决策树块内的 "├─ .tscn/.gd 文件" 原样保留
    expect(md).toContain('├─ .tscn/.gd 文件');
  });

  it('AGENTS_SECTION_IDS 含 10 个段（项目信息 + base + 6 子系统 + 类型规范 + 最佳实践）', () => {
    expect(AGENTS_SECTION_IDS.size).toBe(10);
  });

  it('含 ZCode 内联说明（不指向 .claude/rules/）', () => {
    const md = buildAgentsMd(config, '.', 'TestGame', '0.99.0');
    expect(md).toContain('已全部内联到本文件');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/tools/agentsmd-builder.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/agentsmd-builder.js'`

- [ ] **Step 3: 创建 agentsmd-builder.ts**

Create `src/tools/agentsmd-builder.ts`:

```typescript
// src/tools/agentsmd-builder.ts
// 组装单文件 AGENTS.md（ZCode 等遵循 AGENTS.md 标准的客户端读取）。
// ZCode 约束：只读 workspace 根 AGENTS.md，不扫描子目录、不展开 @import →
// 必须把全部 godot-mcp 规则合并进单文件，并对规则文件标题做降级（避免与
// AGENTS.md 的 ## MCP 段冲突）。复用 claudemd-builder 的元数据 builders +
// rule-templates 的 DETAILED_RULE_TEMPLATES + shared/section-merge 的合并逻辑。
import type { GodotConfig } from '../helpers.js';
import {
  buildEngineVersion, buildRenderer, buildKeyPaths, buildMainScene,
  buildAutoloads, buildInputMap, buildPhysics, buildLayerNames,
  buildTypeGuide, buildBestPractices, GODOT_MCP_RULES,
} from './claudemd-builder.js';
import { DETAILED_RULE_TEMPLATES } from './rule-templates.js';
import { mergeSections as mergeSectionsGeneric } from './shared/section-merge.js';

// AGENTS.md 的 MCP 管控段 header 白名单（## 级，供幂等合并判定）
export const AGENTS_SECTION_IDS: Set<string> = new Set([
  '## 项目信息',
  '## Godot MCP 通用规则',
  '## Godot MCP 核心决策树',
  '## Godot MCP 编辑器模式',
  '## Godot MCP Game Bridge',
  '## Godot MCP UI 布局',
  '## Godot MCP 录制回放',
  '## Godot MCP 引擎特性',
  '## Godot MCP GDScript 规范',
  '## Godot MCP 最佳实践',
]);

// 段 header → 规则模板键（base 用特殊标记 __base__）
const SECTION_TO_TEMPLATE: Array<[string, string]> = [
  ['## Godot MCP 核心决策树', 'godot-mcp-core.md'],
  ['## Godot MCP 编辑器模式', 'godot-mcp-editor.md'],
  ['## Godot MCP Game Bridge', 'godot-mcp-bridge.md'],
  ['## Godot MCP UI 布局', 'godot-mcp-ui.md'],
  ['## Godot MCP 录制回放', 'godot-mcp-recording.md'],
  ['## Godot MCP 引擎特性', 'godot-mcp-engine-quirks.md'],
];

/**
 * 标题降级：行首 markdown 标题（#..######）降一级。用状态机跳过 ``` 代码块，
 * 避免误降级代码块内的 # 注释。
 */
function demoteHeadings(content: string): string {
  const lines = content.split('\n');
  let inCodeBlock = false;
  const out = lines.map(line => {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;
    const m = line.match(/^(#{1,6})( .*)$/);
    return m ? '#' + m[1] + m[2] : line;
  });
  return out.join('\n');
}

/** 剥离开头的 yaml frontmatter（--- ... ---）。 */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/** 剥离开头的 "> 适用于 godot-mcp-enhanced ..." 版本引用行（base 段保留自己的一次）。 */
function stripVersionQuote(content: string): string {
  return content.replace(/^> 适用于 godot-mcp-enhanced[^\n]*\n+/, '');
}

/** AGENTS.md 内联说明段（替代指向 .claude/rules/ 的映射表——ZCode 下该目录不生效）。 */
function buildInlineMapping(): string {
  return [
    '> ZCode 不读取 `.claude/rules/` 目录。上方各段（通用规则 / 核心决策树 /',
    '> 编辑器模式 / Game Bridge / UI 布局 / 录制回放 / 引擎特性）已全部内联到本文件，',
    '> 是 godot-mcp-enhanced 规则在 ZCode 下的唯一来源。',
  ].join('\n');
}

/**
 * 组装单文件 AGENTS.md 内容。sections 顺序固定，供幂等检测。
 * 返回未含 H1 标题的 sections 数组（H1 由 project.ts 的 setup_project_rules 拼接）。
 */
export function buildAgentsMdSections(
  config: GodotConfig | null,
  projectDir: string,
  mcpVersion: string,
): Array<[string, string]> {
  const sections: Array<[string, string]> = [];

  // ── 项目信息段（元数据 builders 合并）──
  const metaBuilders: Array<() => string | null> = [
    () => buildEngineVersion(config),
    () => buildRenderer(config),
    () => buildKeyPaths(projectDir),
    () => buildMainScene(config),
    () => buildAutoloads(config),
    () => buildInputMap(config),
    () => buildPhysics(config),
    () => buildLayerNames(config),
  ];
  const metaLines = metaBuilders.map(b => b()).filter((v): v is string => v !== null);
  if (metaLines.length > 0) {
    sections.push(['## 项目信息', metaLines.join('\n') + '\n\n' + buildInlineMapping()]);
  } else {
    sections.push(['## 项目信息', buildInlineMapping()]);
  }

  // ── base 规则（GODOT_MCP_RULES，H1+H2 → 降级为 H2+H3）──
  const baseContent = GODOT_MCP_RULES.replace(/\{\{MCP_VERSION\}\}/g, mcpVersion);
  sections.push(['## Godot MCP 通用规则', demoteHeadings(baseContent).trim()]);

  // ── 各子系统规则模板（剥离 frontmatter + 版本引用，降级 H2→H3/H3→H4）──
  for (const [header, templateKey] of SECTION_TO_TEMPLATE) {
    const tpl = DETAILED_RULE_TEMPLATES[templateKey];
    if (!tpl) continue;
    const cleaned = stripVersionQuote(stripFrontmatter(tpl)).replace(/\{\{MCP_VERSION\}\}/g, mcpVersion);
    sections.push([header, demoteHeadings(cleaned).trim()]);
  }

  // ── GDScript 规范 + 最佳实践（builders 直接产出，无标题需降级）──
  sections.push(['## Godot MCP GDScript 规范', buildTypeGuide()]);
  sections.push(['## Godot MCP 最佳实践', buildBestPractices()]);

  return sections;
}

/** 幂等合并 AGENTS.md：MCP 段替换，用户自建段保留。 */
export function mergeAgentsMd(existing: string, sections: Array<[string, string]>): string {
  return mergeSectionsGeneric(existing, sections, AGENTS_SECTION_IDS);
}

/**
 * 完整生成 AGENTS.md 全文（含 H1 项目名标题）。首次生成用；已存在时用 mergeAgentsMd。
 */
export function buildAgentsMd(
  config: GodotConfig | null,
  projectDir: string,
  projectName: string,
  mcpVersion: string,
): string {
  const sections = buildAgentsMdSections(config, projectDir, mcpVersion);
  const body = sections.map(([h, b]) => `${h}\n${b}`).join('\n\n');
  return `# ${projectName}\n\n${body}\n`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/tools/agentsmd-builder.test.ts`
Expected: PASS（全部 7 个断言）

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/tools/agentsmd-builder.ts test/tools/agentsmd-builder.test.ts
git commit -m "feat(agentsmd): 新增 agentsmd-builder，组装单文件 AGENTS.md

标题降级（状态机跳代码块）+ 剥离 frontmatter/版本引用 + 全量合并
base + 6 子系统规则。ZCode 不读 .claude/rules/，AGENTS.md 是唯一来源。"
```

---

## Task 4: project.ts 双写 AGENTS.md（agents_md 参数）

**Files:**
- Modify: `src/tools/project.ts`（setup_project_rules 加 `agents_md` 参数 + 双写块；schema 加 `agents_md`）
- Test: `test/tools/setup-project-rules-agents.test.ts`

**Interfaces:**
- Consumes: `buildAgentsMdSections`、`mergeAgentsMd`（from `agentsmd-builder.ts`，Task 3）
- Produces: setup_project_rules 接受 `agents_md: boolean`（默认 true），生成/合并 workspace 根 `AGENTS.md`

- [ ] **Step 1: 写失败测试**

Create `test/tools/setup-project-rules-agents.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleTool } from '../../src/tools/project.js';
import type { ToolContext } from '../../src/types.js';

// 最小 ToolContext mock（setup_project_rules 只用 parseGodotConfig）
function makeCtx(): ToolContext {
  return {
    parseGodotConfig: (raw: string) => {
      // 极简解析：把 [application] config/name 提出来
      const m = raw.match(/config\/name="([^"]+)"/);
      return { application: { 'config/name': m?.[1] ?? 'Test' } } as never;
    },
  } as unknown as ToolContext;
}

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gmc-agents-'));
  writeFileSync(join(dir, 'project.godot'), '[application]\nconfig/name="TestGame"\nconfig/features=PackedStringArray("4.6")\n');
  return dir;
}

describe('setup_project_rules AGENTS.md 双写', () => {
  let project: string;
  beforeEach(() => { project = makeProject(); });
  afterEach(() => { rmSync(project, { recursive: true, force: true }); });

  it('默认（agents_md 未传）生成 AGENTS.md + CLAUDE.md', async () => {
    // hooks=false 避免写 .claude/settings.json 干扰
    const res = await handleTool('project', { action: 'setup_project_rules', project_path: project, hooks: false }, makeCtx());
    const text = JSON.parse((res as { content: Array<{ text: string }> }).content[0]!.text);
    expect(text.actions.some((a: string) => a.includes('AGENTS.md'))).toBe(true);
    expect(existsSync(join(project, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(true);
  });

  it('agents_md=false 不生成 AGENTS.md', async () => {
    await handleTool('project', { action: 'setup_project_rules', project_path: project, hooks: false, agents_md: false }, makeCtx());
    expect(existsSync(join(project, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(true);
  });

  it('AGENTS.md 含项目名 H1 + 引擎特性段', async () => {
    await handleTool('project', { action: 'setup_project_rules', project_path: project, hooks: false }, makeCtx());
    const md = readFileSync(join(project, 'AGENTS.md'), 'utf-8');
    expect(md).toContain('# TestGame');
    expect(md).toContain('## Godot MCP 引擎特性');
  });

  it('幂等：再次运行不破坏用户段（保留用户自建 ## 段）', async () => {
    await handleTool('project', { action: 'setup_project_rules', project_path: project, hooks: false }, makeCtx());
    // 用户手动加一段
    const before = readFileSync(join(project, 'AGENTS.md'), 'utf-8');
    writeFileSync(join(project, 'AGENTS.md'), before + '\n## 我的自定义段\n\n保留我\n');
    await handleTool('project', { action: 'setup_project_rules', project_path: project, hooks: false, force: true }, makeCtx());
    const after = readFileSync(join(project, 'AGENTS.md'), 'utf-8');
    expect(after).toContain('## 我的自定义段');
    expect(after).toContain('保留我');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/tools/setup-project-rules-agents.test.ts`
Expected: FAIL — AGENTS.md 未生成 / `agents_md` 参数未识别

- [ ] **Step 3: 改 project.ts —— schema 加 agents_md**

在 `src/tools/project.ts` 的 inputSchema.properties 中（`claude_md` 定义之后，约 line 68 后）加：

```typescript
          agents_md: { type: 'boolean', description: '创建/追加 AGENTS.md 项目规则（ZCode/Codex/Cursor 等遵循 AGENTS.md 标准的客户端读取，默认 true）', default: true },
```

- [ ] **Step 4: 改 project.ts —— import agentsmd-builder**

在 `src/tools/project.ts` 顶部 import 区（claudemd-builder import 之后）加：

```typescript
import { buildAgentsMdSections, mergeAgentsMd, AGENTS_SECTION_IDS as AGENTS_SECTIONS } from './agentsmd-builder.js';
```

- [ ] **Step 5: 改 project.ts —— setup_project_rules 加 doAgentsMd 块**

**(a)** 在 `case 'setup_project_rules':` 内、`const force = args.force === true;` 之后（约 line 272 后）加（提升 `mcpPkgPath` 作用域 + 声明 `doAgentsMd`，让 doClaudeMd 与 doAgentsMd 块共用 mcpPkgPath）：

```typescript
      const doAgentsMd = args.agents_md !== false;
      const mcpPkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
```

并删除 `doClaudeMd` 块内原有的 `const mcpPkgPath = join(...)`（约 line 442，避免重复声明）。

**(b)** 在 CLAUDE.md 块（`if (doClaudeMd) { ... }` 整块）之后、CI workflow 块（`if (args.ci === true)`）之前，加 AGENTS.md 块。**关键**：`configForAgents` 与 `agentsMcpVersion` 都在本块内独立解析——不引用 doClaudeMd 块内的 `config`/`mcpVersion`（它们是块级 `let`，`claude_md=false` 时 doClaudeMd 块不执行，引用会 ReferenceError）：

```typescript
      // ── AGENTS.md rules（ZCode 等遵循 AGENTS.md 标准的客户端）──
      if (doAgentsMd) {
        const agentsMdPath = join(p, 'AGENTS.md');

        // 独立 parse config（不引用 doClaudeMd 块内的 config）
        let configForAgents: GodotConfig | null = null;
        try {
          configForAgents = ctx.parseGodotConfig(readFileSync(join(p, 'project.godot'), 'utf-8')) as GodotConfig;
        } catch { configForAgents = null; }

        // 独立解析 mcpVersion（不引用 doClaudeMd 块内的 mcpVersion）
        let agentsMcpVersion = '0.16.0';
        try { agentsMcpVersion = JSON.parse(readFileSync(mcpPkgPath, 'utf-8')).version || agentsMcpVersion; } catch { /* fallback */ }

        const sectionsVersioned = buildAgentsMdSections(configForAgents, p, agentsMcpVersion);
        const projectName = configForAgents
          ? (configForAgents.application as Record<string, unknown>)?.['config/name'] || basename(p)
          : basename(p);

        if (existsSync(agentsMdPath)) {
          const existing = readFileSync(agentsMdPath, 'utf-8');
          const hasMcpSections = [...AGENTS_SECTIONS].some(h => existing.includes(h));
          if (hasMcpSections && !force) {
            actions.push('AGENTS.md: skipped (already configured, use force=true to update)');
          } else {
            writeAtomic(agentsMdPath, mergeAgentsMd(existing, sectionsVersioned));
            actions.push(force ? 'AGENTS.md: updated (force)' : 'AGENTS.md: merged new sections into existing file');
          }
        } else {
          const body = sectionsVersioned.map(([h, b]) => `${h}\n${b}`).join('\n\n');
          writeAtomic(agentsMdPath, `# ${projectName}\n\n${body}\n`);
          actions.push('AGENTS.md: created with project metadata');
        }
      }
```

**作用域小结**：`mcpPkgPath` 提升到 case 顶部（Step 5a）供两块共用；`configForAgents`/`agentsMcpVersion` 在 doAgentsMd 块内独立解析，不依赖 doClaudeMd 块的 `config`/`mcpVersion`。

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run test/tools/setup-project-rules-agents.test.ts`
Expected: PASS（全部 4 个断言）

- [ ] **Step 7: 回归 + 类型检查**

Run: `npx vitest run test/tools/ test/core/ && npx tsc --noEmit`
Expected: 全部 PASS，无类型错误

- [ ] **Step 8: Commit**

```bash
git add src/tools/project.ts test/tools/setup-project-rules-agents.test.ts
git commit -m "feat(project): setup_project_rules 默认双写 CLAUDE.md + AGENTS.md

新增 agents_md 参数（默认 true）。AGENTS.md 服务 ZCode/Codex/Cursor 等
遵循 AGENTS.md 标准的客户端。幂等合并保留用户段。"
```

---

## Task 5: CHANGELOG + README 登记

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md`
- Modify: `D:\GitHub\godot-mcp-enhanced\README.md`
- Modify: `D:\GitHub\godot-mcp-enhanced\README.en.md`

- [ ] **Step 1: CHANGELOG 加两处行为变更**

在 `CHANGELOG.md` 顶部最新版本段（Unreleased 或下一版本）加：

```markdown
### 行为变更（BREAKING / 注意）
- `setup_project_rules` 现在默认同时生成 `AGENTS.md`（与 `CLAUDE.md` 并列）。`AGENTS.md` 是 ZCode / Codex / Cursor / Cline 等遵循 AGENTS.md 标准的客户端的指令来源。升级后首次运行会在项目根新增 `AGENTS.md` 并进入 git。如不需要，传 `agents_md=false`。
- `setup_project_rules` 现在分发 `godot-mcp-engine-quirks.md`（引擎陷阱知识，原仅在仓库自用 `.claude/rules/`，未纳入分发）。升级后目标项目 `.claude/rules/` 会新增此文件。
```

- [ ] **Step 2: README 客户端列表加 ZCode**

在 `README.md` 客户端接入章节（搜索 "Claude Code" / "Cursor" 配置段附近）加 ZCode 条目：

```markdown
- **ZCode**（智谱 GLM-5.2 ADE）：配置见 [使用指南-ZCode](docs/使用指南-ZCode.md)
```

`README.en.md` 对应位置加：

```markdown
- **ZCode** (Zhipu GLM-5.2 ADE): see [ZCode Setup Guide](docs/使用指南-ZCode.md)
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md README.en.md
git commit -m "docs: CHANGELOG 登记 AGENTS.md 双写 + engine-quirks 分发行为变更；README 加 ZCode"
```

---

## Task 6: docs/使用指南-ZCode.md（面①接入指南 + 面③A半权限矩阵）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\docs\使用指南-ZCode.md`

**产出**：对标 `docs/使用指南-Warp.md` 结构的 ZCode 接入指南。内容来源：ZCode 官方文档（webReader 抓取 2026-07-22，mcp-services + agents + safety-confirm 页）+ godot-mcp 现有机制。

- [ ] **Step 1: 写指南全文**

Create `docs/使用指南-ZCode.md`，结构如下（每节写出实际内容，非占位）：

```markdown
# 在 ZCode 中接入 godot-mcp-enhanced

> **版本**：0.x（当前）｜ **适用 ZCode**：支持 MCP 的版本 ｜ **适用 Godot**：4.x（4.6+ 已测试）
>
> **验证状态**：✅ 协议层（文档依据，来源 ZCode 官方文档 mcp-services/agents/safety-confirm 页，2026-07-22 抓取）｜ ⚠️ GUI 端到端实测待补（Task 8）

---

## 这份指南解决什么

[ZCode](https://zcode.z.ai/) 是智谱官方的 Agentic Development Environment（ADE），深度适配 GLM-5.2。godot-mcp-enhanced 是 **stdio MCP 服务端**，ZCode 是 **stdio MCP 客户端**——协议层天然匹配。

**关键差异（vs Claude Code）**：ZCode 不读 `CLAUDE.md`，只读 workspace 根 `AGENTS.md`（也不读 `.claude/rules/` 子目录）。因此接入后请运行 `setup_project_rules`（默认双写 CLAUDE.md + AGENTS.md），让 godot 规则在 ZCode 里生效。

---

## 1. 兼容性结论速览

| 维度 | 结论 | 依据 |
|------|------|------|
| stdio 传输 | ✅ 完美匹配 | ZCode stdio MCP 客户端 |
| 工具发现 | ✅ 全部工具可列出 | 待 Task 8 协议层脚本验证 |
| 项目指令注入 | ✅ 通过 AGENTS.md | ZCode 读 workspace AGENTS.md（官方 agents 页） |
| 配置作用域 | 用户级 / 工作区级 | .zcode/config.json 或 .agents/mcp.json |

---

## 2. 三种配置方式

### 方式 A：ZCode GUI

设置 → MCP 服务器 → 新建 MCP 服务器：
- 作用域：工作区（仅当前项目）或 用户（所有工作区）
- 类型：`stdio（本地命令）`
- 命令：`npx`，参数：`-y godot-mcp-enhanced`
- 环境变量（可选）：见 §4

### 方式 B：file-based（`.zcode/config.json` 或 `.agents/mcp.json`）

工作区级 `<项目根>/.zcode/config.json`（键 `mcp.servers`）：

```json
{
  "mcp": {
    "servers": {
      "godot": {
        "command": "npx",
        "args": ["-y", "godot-mcp-enhanced"],
        "env": {
          "ALLOWED_PROJECT_PATHS": "D:/my-game",
          "GODOT_PATH": "D:/Godot_v4.6.3-stable_win64.exe"
        }
      }
    }
  }
}
```

或兼容格式 `<项目根>/.agents/mcp.json`（键 `mcpServers`）：

```json
{
  "mcpServers": {
    "godot": { "command": "npx", "args": ["-y", "godot-mcp-enhanced"] }
  }
}
```

> **⚠️ 优先级坑**：同作用域内 `.zcode` 强优先——只要 `.zcode/config.json` 有任何 MCP 服务，同作用域的 `.agents/mcp.json` 会被**整体跳过，不合并**。两者混用时把 `.agents` 配置合并进 `.zcode`。

### 方式 C：从 Claude Code 导入（非 auto-spawn）

ZCode 设置 → MCP 服务器 → 导入图标，自动扫描发现可导入的服务器，来源含：
- Claude Code：`~/.claude/settings.json`
- Codex CLI：`~/.codex/config.toml`
- OpenCode：`~/.config/opencode/opencode.json`
- 通用 `.agents`：`~/.agents/mcp.json`

> **注意**：ZCode 是**导入**（手动点导入 → 勾选 → 写入 `.zcode`），不是 Warp 那种运行时 auto-spawn。原外部配置不被修改。

---

## 3. 让 godot 规则在 ZCode 生效（关键）

ZCode 不读 CLAUDE.md / .claude/rules/。运行一次：

```
project(action="setup_project_rules", project_path="D:/my-game")
```

会在项目根生成 `AGENTS.md`（默认双写，同时有 CLAUDE.md）。ZCode 启动任务时读取该文件，godot 工具规则（模式决策树 / 各子系统陷阱 / GDScript 规范）全部注入。

---

## 4. 环境变量

（同 Warp 指南 §4 表格：ALLOWED_PROJECT_PATHS 必设 / GODOT_PATH / GODOT_PROJECT_PATH / GODOT_MCP_SANDBOX）

---

## 5. 权限与安全（面③A半定论）

### ZCode 执行模式 × godot 危险操作

| ZCode 执行模式 | godot 危险操作（write_config/create_project/setup_project_rules）行为 |
|----------------|----------------------------------------------------------------------|
| 变更前确认 | ZCode 在文件/命令改动前弹确认 ✅ 兜底有效 |
| 自动编辑 / 完全访问 | 文件自动改，不拦截 |

### ⚠️ confirm_and_execute 在 ZCode 下不可靠

godot-mcp 的 `confirm_and_execute` 返回确认 token 给 AI，AI 可自确认（token 走 client→server→client 回路）。**单客户端下这等于无保护**——无论 ZCode 是否支持 elicitation，自动执行模式下都不能依赖它。

**建议**：在 ZCode 里用「变更前确认」执行模式兜底，不要依赖 confirm_and_execute。godot 的路径白名单 / GDScript 沙箱 / Bridge 密钥等安全层在所有客户端一致生效。

### elicitation（B 半，待 Task 8 实测定论）

ZCode 是否实现 MCP elicitation、确认弹窗具体形态——留 GUI 端到端实测确认后回填本节。

---

## 6. 验证

（Task 8 协议层脚本 + GUI 实测结果回填本节）

---

## 7. 限制与故障排查

- **文档断言待实测**：本指南的 ZCode 机制（.zcode/.agents/AGENTS.md 单文件）依据官方文档，Task 8 GUI 实测二次确认。
- **AGENTS.md 单文件**：ZCode 不扫描子目录、不展开 @import，所有规则已内联进单文件 AGENTS.md。
- **运行时不持久化**：同其他客户端，运行时工具不写盘。

---

## 8. 参考

- [ZCode MCP 服务器（官方）](https://zcode.z.ai/cn/docs/mcp-services)
- [ZCode Agent（官方）](https://zcode.z.ai/cn/docs/agents)
- [ZCode 安全确认（官方）](https://zcode.z.ai/cn/docs/safety-confirm)
- [使用指南](使用指南.md) — godot-mcp-enhanced 完整工具用法
```

- [ ] **Step 2: Commit**

```bash
git add docs/使用指南-ZCode.md
git commit -m "docs: 新增 ZCode 接入指南（三种配置 + AGENTS.md 注入 + 权限矩阵 A 半）
```

---

## Task 7: 协议层 SDK 模拟验证（面④协议层）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\docs\zcode-protocol-verify.mjs`

**产出**：用官方 MCP SDK 起一个 stdio 客户端，模拟 ZCode 接入（initialize → tools/list），验证 godot-mcp 全工具可发现。复用 Warp 指南 §6.2 脚本范式。

- [ ] **Step 1: 写验证脚本**

Create `docs/zcode-protocol-verify.mjs`:

```javascript
// 模拟 ZCode 接入 godot-mcp-enhanced（stdio 客户端 → initialize → tools/list）
// 用法：先 npm run build，再 node docs/zcode-protocol-verify.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['build/index.js'],
  env: { ...process.env, ALLOWED_PROJECT_PATHS: process.cwd() },
});
const client = new Client({ name: 'zcode-sim', version: '0.0.1' }, { capabilities: {} });

await client.connect(transport);
const { tools } = await client.listTools();
console.log('[OK] initialize 握手成功');
console.log(`[OK] tools/list 返回 ${tools.length} 个工具`);
console.log(`[OK] 含 inputSchema: ${tools.filter(t => t.inputSchema).length}/${tools.length}`);
console.log('工具名:', tools.map(t => t.name).join(', '));
await client.close();
console.log('[OK] 优雅关闭');
```

- [ ] **Step 2: 运行验证**

Run: `npm run build && node docs/zcode-protocol-verify.mjs`
Expected: initialize 成功 + 全工具列出 + 优雅关闭（记录工具数到 Task 6 §6 回填依据）

- [ ] **Step 3: Commit**

```bash
git add docs/zcode-protocol-verify.mjs
git commit -m "test(zcode): 协议层 SDK 模拟验证脚本（initialize + tools/list）"
```

---

## Task 8: GUI 端到端实测 + 回填指南（面④GUI + 面③B半）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\docs\使用指南-ZCode.md`（回填 §6 验证 + §5 elicitation B 半定论）
- **本 task 需用户手动配合 ZCode GUI**（用户本机已装 ZCode）

- [ ] **Step 1: 用户在 ZCode 配置 godot MCP server**

按指南方式 A（GUI 新建 stdio，command=npx, args=-y godot-mcp-enhanced，作用域=工作区）或方式 B（`.zcode/config.json`）。确认 MCP 服务器列表显示 godot 为启用/running。

- [ ] **Step 2: 验证 AGENTS.md 注入**

在一个 Godot 项目里运行 `setup_project_rules` 生成 AGENTS.md。在 ZCode agent 里问：「这个项目用 godot-mcp-enhanced，操作 .tscn 文件应该用哪个模式？修改后如何持久化？」验证 ZCode agent 回答引用了 AGENTS.md 的内容（Headless/edit_script/save_scene 等）。截图。

- [ ] **Step 3: 验证确认弹窗 + 定论 elicitation（B 半）**

在 ZCode 用「变更前确认」执行模式，调一个 godot 危险操作（如 `write_config`），观察：
- ZCode 是否弹确认？弹窗内容是什么？
- 是否有 elicitation（out-of-band server→client→user）形态的确认？

把观察结果写入指南 §5 elicitation 节（定论 B 半：支持/不支持 + 弹窗形态）。

- [ ] **Step 4: 二次确认前提断言**

确认 ZCode 的 MCP 配置机制（`.zcode`/`.agents` 优先级、AGENTS.md 单文件不扫描子目录）与指南 §1-§2 断言一致。若不一致，修正指南 + 评估是否影响 AGENTS.md 全量合并设计（Task 3/4）。

- [ ] **Step 5: 回填指南 §6 验证**

把协议层脚本结果（Task 7）+ GUI 实测结果（截图描述）写入指南 §6。更新头部「验证状态」为 ✅ GUI 端到端实测通过。

- [ ] **Step 6: Commit**

```bash
git add docs/使用指南-ZCode.md
git commit -m "docs(zcode): 回填 GUI 端到端实测 + elicitation B 半定论"
```

---

## Self-Review

**1. Spec coverage**：
- 面①接入指南 → Task 6 ✓
- 面②AGENTS.md 适配（agents_md 双写 / header 白名单 / 全量合并 / engine-quirks） → Task 1-4 ✓
- 面③A半定论 → Task 6 §5 ✓；B半留实测 → Task 8 Step 3 ✓
- 面④协议层 → Task 7 ✓；GUI → Task 8 ✓
- buildMcpMapping 不直用 → Task 3 buildInlineMapping ✓
- 行为变更 CHANGELOG → Task 5 ✓

**2. Placeholder scan**：Task 6 §4 env 表引用 Warp 指南（明确来源，非占位）；Task 2 engine-quirks 内容明确来自 `.claude/rules/godot-mcp-engine-quirks.md`（路径明确，非占位）。无 TBD/TODO。

**3. Type consistency**：
- `mergeSections(existing, newSections, sectionIds)` — Task 1 定义，Task 3/4 用 `mergeSectionsGeneric`/`mergeAgentsMd` ✓
- `buildAgentsMdSections(config, projectDir, mcpVersion)` — Task 3 定义，Task 4 调用 ✓
- `AGENTS_SECTION_IDS` — Task 3 export，Task 4 import 为 `AGENTS_SECTIONS` ✓
- `agents_md` 参数 — Task 4 schema + handler 一致 ✓

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-22-zcode-support.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 每个 Task 派新子代理实现，Task 间审查，快速迭代

**2. Inline Execution** - 当前 session 用 executing-plans 批量执行，检查点审查

哪种？
