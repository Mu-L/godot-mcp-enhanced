# Godot 开发方法论 SKILL.md（形态 B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给仓库自身开发提供 3 个 Claude Code 原生 skill（`.claude/skills/<name>/SKILL.md`），从 `rule-templates.ts` 的 workflow 模板派生（单一内容源），由 Claude Code 按 description 主动触发——互补形态 A 的 rule 文档（按需加载）。

**Architecture:** 新 `skill-builder.ts` 纯函数（`deriveSkillFromWorkflow` + `buildAllSkills` + `WORKFLOW_TO_SKILL` 映射），从 `DETAILED_RULE_TEMPLATES` 的 3 个 workflow 模板派生 SKILL.md（剥 rule frontmatter + 剃版本引用行 + 包 SKILL frontmatter）。`scripts/build-skills.mjs` CLI wrapper（import 编译产物）写磁盘。DRY 一致性由 vitest 断言守护（磁盘 == 派生结果）。**不碰** setup_project_rules / rules-manifest（消费者仅仓库自身，git 版本控制）。

**Tech Stack:** TypeScript（`src/tools/skill-builder.ts` 纯函数）、ESM Node（`scripts/build-skills.mjs` wrapper）、Vitest（`test/tools/skill-builder.test.ts`）、Markdown（生成的 SKILL.md）。

**Spec 来源：** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-27-godot-methodology-skills-design.md`（§1-9 + 用户审 4 ADVISORY 修正）。

## Global Constraints

- **消费者仅仓库自身开发**：不碰 `setup_project_rules`、不扩展 `rules-manifest`（git 直接版本控制 `.claude/skills/`）。
- **派生单一源**：`rule-templates.ts` 的 `DETAILED_RULE_TEMPLATES` 3 个 workflow 模板（`:671/:698/:724`）。改 workflow 只改 rule-templates.ts，跑 `build:skills` 重派生。
- **description 引号处理**（spec §3 第 3-4 步，防 DRY 断言不稳）：提取 rule frontmatter `description:` **引号内的纯文本**（不含引号），输出 SKILL frontmatter **重新包双引号** `description: "<纯文本>"`。
- **wrapper 写盘不加 trailing newline**（spec §4，防 DRY 断言不稳）：`writeFileSync(path, content)`，**不**写 `content + '\n'`。
- **不加 H1**：SKILL.md 正文从 rule 的 `## 标题`（H2）起，不额外加 `# Title`。
- **ESM**：`package.json` `"type": "module"`；测试 import 源 `../../src/tools/skill-builder.js`（vitest 转译 .ts），wrapper import 编译产物 `../build/tools/skill-builder.js`（对齐 build-matrix 模式，先 `npm run build`）。
- **测试位置**：`test/tools/skill-builder.test.ts`（与 `arch-templates.test.ts` / `rule-templates-workflows.test.ts` 同构）。

---

## File Structure

| 文件 | 操作 | 责任 |
|------|------|------|
| `src/tools/skill-builder.ts` | 创建 | 纯函数：`WORKFLOW_TO_SKILL` 映射 + `deriveSkillFromWorkflow(tpl, skillName)` + `buildAllSkills()` |
| `test/tools/skill-builder.test.ts` | 创建 | 派生逻辑单元测试（Task 1）+ DRY 一致性（Task 2 加） |
| `scripts/build-skills.mjs` | 创建 | CLI wrapper：import 编译产物，调 `buildAllSkills()` 写 `.claude/skills/<name>/SKILL.md` |
| `package.json` | 修改（scripts 段） | 加 `"build:skills": "npm run build && node scripts/build-skills.mjs"` |
| `.claude/skills/godot-mcp-bridge-e2e/SKILL.md` | 创建（生成） | bridge-e2e skill（派生） |
| `.claude/skills/godot-mcp-verify-loop/SKILL.md` | 创建（生成） | verify-loop skill（派生） |
| `.claude/skills/godot-mcp-safe-edit/SKILL.md` | 创建（生成） | safe-edit skill（派生） |

---

## Task 1: skill-builder.ts 派生函数 + 派生逻辑测试

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\tools\skill-builder.ts`
- Create: `D:\GitHub\godot-mcp-enhanced\test\tools\skill-builder.test.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\skill-builder.test.ts`

**Interfaces:**
- Consumes: `DETAILED_RULE_TEMPLATES`（from `../../src/tools/rule-templates.js`）
- Produces: `WORKFLOW_TO_SKILL` / `deriveSkillFromWorkflow(tpl, skillName): string` / `buildAllSkills(): Map<string, string>`（Task 2 的 wrapper 与 DRY 测试依赖这些）

- [ ] **Step 1: 写 skill-builder.ts**

创建 `D:\GitHub\godot-mcp-enhanced\src\tools\skill-builder.ts`：

```typescript
// src/tools/skill-builder.ts
// 从 rule-templates.ts 的 workflow 模板派生 Claude Code SKILL.md（仓库自身开发用）
// 单一内容源 = DETAILED_RULE_TEMPLATES 的 3 个 workflow 模板；改 workflow 只改 rule-templates.ts
// 然后跑 npm run build:skills 重生成 .claude/skills/<name>/SKILL.md

import { DETAILED_RULE_TEMPLATES } from './rule-templates.js';

/** workflow 模板 key → skill name 映射（去 workflow- 中缀，verify 特例 -loop） */
export const WORKFLOW_TO_SKILL: Record<string, string> = {
  'godot-mcp-workflow-bridge-e2e.md': 'godot-mcp-bridge-e2e',
  'godot-mcp-workflow-verify.md': 'godot-mcp-verify-loop',
  'godot-mcp-workflow-safe-edit.md': 'godot-mcp-safe-edit',
};

/**
 * 从单个 workflow 模板派生 SKILL.md 内容（纯函数）。
 *
 * 派生规则：
 * 1. 剥 rule frontmatter（首部 ---\n...\n---\n，含 description + alwaysApply）
 * 2. 提取 description 引号内纯文本（rule-templates.ts 的 description 形如 description: "..."）
 * 3. 剃到首个 ## 标题前的所有内容（版本引用行 > 适用于 ... {{MCP_VERSION}}+ + 紧随空行）
 * 4. 组装 SKILL.md：---\nname: <skillName>\ndescription: "<纯文本>"\n---\n\n<正文从 ## 起>
 *    （description 重新包双引号；正文不加 H1，从 rule 的 H2 起）
 */
export function deriveSkillFromWorkflow(tpl: string, skillName: string): string {
  // 1. 剥 rule frontmatter
  const fmMatch = tpl.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) throw new Error('skill-builder: workflow 模板缺 rule frontmatter (---...---)');
  const frontmatter = fmMatch[1];
  const afterFm = tpl.slice(fmMatch[0].length);

  // 2. 提取 description 引号内纯文本
  const descMatch = frontmatter.match(/^description:\s*"([\s\S]*?)"\s*$/m);
  if (!descMatch) throw new Error('skill-builder: workflow frontmatter 缺 description (带引号)');
  const description = descMatch[1];

  // 3. 剃到首个 ## 前（版本引用行 + 空行）
  const h2Idx = afterFm.search(/^##\s/m);
  if (h2Idx === -1) throw new Error('skill-builder: workflow 模板缺 ## 标题');
  const body = afterFm.slice(h2Idx);

  // 4. 组装（description 重新包引号，不加 H1）
  return `---\nname: ${skillName}\ndescription: "${description}"\n---\n\n${body}`;
}

/** 遍历 WORKFLOW_TO_SKILL，对 DETAILED_RULE_TEMPLATES 的 3 个 workflow 模板派生。返回 skill name → SKILL.md 内容。 */
export function buildAllSkills(): Map<string, string> {
  const result = new Map<string, string>();
  for (const [workflowKey, skillName] of Object.entries(WORKFLOW_TO_SKILL)) {
    const tpl = DETAILED_RULE_TEMPLATES[workflowKey];
    if (!tpl) throw new Error(`skill-builder: DETAILED_RULE_TEMPLATES 缺 workflow 模板 ${workflowKey}`);
    result.set(skillName, deriveSkillFromWorkflow(tpl, skillName));
  }
  return result;
}
```

- [ ] **Step 2: 写派生逻辑测试（不含 DRY 一致性，Task 2 加）**

创建 `D:\GitHub\godot-mcp-enhanced\test\tools\skill-builder.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { deriveSkillFromWorkflow, buildAllSkills, WORKFLOW_TO_SKILL } from '../../src/tools/skill-builder.js';
import { DETAILED_RULE_TEMPLATES } from '../../src/tools/rule-templates.js';

describe('skill-builder 派生逻辑', () => {
  it('WORKFLOW_TO_SKILL 3 个映射正确', () => {
    expect(Object.keys(WORKFLOW_TO_SKILL)).toHaveLength(3);
    expect(WORKFLOW_TO_SKILL['godot-mcp-workflow-bridge-e2e.md']).toBe('godot-mcp-bridge-e2e');
    expect(WORKFLOW_TO_SKILL['godot-mcp-workflow-verify.md']).toBe('godot-mcp-verify-loop');
    expect(WORKFLOW_TO_SKILL['godot-mcp-workflow-safe-edit.md']).toBe('godot-mcp-safe-edit');
  });

  it('deriveSkillFromWorkflow 剥 rule frontmatter + 剃版本行 + 包 SKILL frontmatter（description 带引号）', () => {
    const tpl = DETAILED_RULE_TEMPLATES['godot-mcp-workflow-bridge-e2e.md']!;
    const skill = deriveSkillFromWorkflow(tpl, 'godot-mcp-bridge-e2e');
    // 剥 rule frontmatter（不含 alwaysApply）
    expect(skill).not.toContain('alwaysApply');
    // 剃版本引用行
    expect(skill).not.toContain('> 适用于');
    expect(skill).not.toContain('{{MCP_VERSION}}');
    // 包 SKILL frontmatter（name + description 带双引号开头）
    expect(skill.startsWith('---\nname: godot-mcp-bridge-e2e\ndescription: "')).toBe(true);
    // 正文从 ## 起（不加 H1）
    expect(skill).toContain('\n## ');
    expect(skill.indexOf('# ')).toBe(skill.indexOf('## ')); // 无单独 H1（# 后非 #）
    // description 含触发短语
    expect(skill).toContain('—— 当你');
  });

  it('buildAllSkills 返回 3 个 entry，frontmatter 合法', () => {
    const skills = buildAllSkills();
    expect(skills.size).toBe(3);
    expect(skills.has('godot-mcp-bridge-e2e')).toBe(true);
    expect(skills.has('godot-mcp-verify-loop')).toBe(true);
    expect(skills.has('godot-mcp-safe-edit')).toBe(true);
    for (const [name, content] of skills) {
      expect(content.startsWith(`---\nname: ${name}\ndescription: "`)).toBe(true);
      expect(content).toContain('—— 当你');
      expect(content).not.toContain('alwaysApply');
    }
  });
});
```

- [ ] **Step 3: 跑测试确认 PASS**

Run: `npx vitest run test/tools/skill-builder.test.ts`
Expected: PASS（3 个 it 全过）

- [ ] **Step 4: tsc 编译确认（wrapper Task 2 要 import 编译产物）**

Run: `npx tsc --noEmit`
Expected: 0 errors（skill-builder.ts 类型正确）

- [ ] **Step 5: Commit**

```bash
git add src/tools/skill-builder.ts test/tools/skill-builder.test.ts
git commit -m "feat(skills): skill-builder 派生函数 + 派生逻辑测试

- WORKFLOW_TO_SKILL 映射（3 workflow → skill name）
- deriveSkillFromWorkflow（剥 rule frontmatter + 剃版本行 + 包 SKILL frontmatter）
- buildAllSkills 返回 3 个 SKILL.md 内容
- 测试：映射/派生/buildAllSkills frontmatter 合法

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: build-skills.mjs wrapper + 生成 3 SKILL.md + DRY 一致性测试

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\scripts\build-skills.mjs`
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json`（scripts 段加 `build:skills`）
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\skills\godot-mcp-bridge-e2e\SKILL.md`（生成）
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\skills\godot-mcp-verify-loop\SKILL.md`（生成）
- Create: `D:\GitHub\godot-mcp-enhanced\.claude\skills\godot-mcp-safe-edit\SKILL.md`（生成）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\tools\skill-builder.test.ts`（加 DRY 一致性 describe）
- Test: `D:\GitHub\godot-mcp-enhanced\test\tools\skill-builder.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildAllSkills()`（from `../build/tools/skill-builder.js` 编译产物）
- Produces: 3 个 `.claude/skills/<name>/SKILL.md` 磁盘文件 + DRY 一致性断言

- [ ] **Step 1: 写 build-skills.mjs wrapper**

创建 `D:\GitHub\godot-mcp-enhanced\scripts\build-skills.mjs`：

```javascript
#!/usr/bin/env node
/**
 * build-skills.mjs
 * 从 rule-templates.ts 的 workflow 模板派生 Claude Code SKILL.md 到 .claude/skills/
 *
 * 用法：npm run build:skills（先 tsc 编译，再跑此 wrapper import 编译产物）
 * 改 workflow 内容后跑此命令重生成 SKILL.md，再 git add .claude/skills/ commit。
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildAllSkills } from '../build/tools/skill-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, '.claude', 'skills');

let count = 0;
for (const [name, content] of buildAllSkills()) {
  const skillDir = join(SKILLS_DIR, name);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, 'SKILL.md');
  // 不加 trailing newline——保证 vitest DRY 断言"磁盘 == buildAllSkills()"字符串严格相等
  writeFileSync(skillPath, content);
  console.log(`Generated ${skillPath}`);
  count++;
}
console.log(`Done: ${count} skills generated.`);
```

- [ ] **Step 2: package.json 加 build:skills script**

打开 `D:\GitHub\godot-mcp-enhanced\package.json`。在 scripts 段（`"generate-docs"` 行 :30 附近）之后加一行（保持字母/逻辑顺序，放 generate-docs 后）：

```json
    "build:skills": "npm run build && node scripts/build-skills.mjs",
```

精确插入位置：在 `"generate-docs": "node scripts/generate-doc-db.js",` 行之后。

- [ ] **Step 3: 跑 build:skills 生成 3 个 SKILL.md**

Run: `npm run build:skills`
Expected: 输出 3 行 `Generated .../godot-mcp-bridge-e2e/SKILL.md` 等 + `Done: 3 skills generated.`

- [ ] **Step 4: 人工核验一个生成的 SKILL.md**

读 `D:\GitHub\godot-mcp-enhanced\.claude\skills\godot-mcp-bridge-e2e\SKILL.md`，确认：
- 首行 `---`，含 `name: godot-mcp-bridge-e2e` + `description: "..."`（带引号，含"—— 当你"）
- frontmatter 后空行 + `## 运行时验证 / E2E 流程`（H2，无 H1）
- 不含 `alwaysApply` / `> 适用于` / `{{MCP_VERSION}}`

- [ ] **Step 5: 加 DRY 一致性测试到 skill-builder.test.ts**

在 `D:\GitHub\godot-mcp-enhanced\test\tools\skill-builder.test.ts` 末尾加新 describe（读磁盘比对派生结果）：

```typescript
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DRY 一致性（防忘记重跑 build:skills）：磁盘 SKILL.md == buildAllSkills() 派生结果
describe('SKILL.md DRY 一致性（磁盘 == 派生）', () => {
  it('3 个 SKILL.md 磁盘内容 == buildAllSkills() 派生结果（字符串严格相等）', () => {
    const skills = buildAllSkills();
    for (const [name, expected] of skills) {
      const diskPath = join(__dirname, '..', '..', '.claude', 'skills', name, 'SKILL.md');
      const disk = readFileSync(diskPath, 'utf-8');
      expect(disk).toBe(expected);  // 严格相等；wrapper 不加 trailing newline 保证此断言稳定
    }
  });
});
```

> 注：`import { readFileSync } from 'fs'` 等放文件顶部（与其他 import 一起），上面为可读性放 describe 前；实际写在文件顶部 import 区。

- [ ] **Step 6: 跑全量测试确认 DRY 一致性 PASS + 无回归**

Run: `npx vitest run test/tools/skill-builder.test.ts`
Expected: PASS（4 个 it：3 派生逻辑 + 1 DRY 一致性）

Run: `npm test`
Expected: 全量无新增失败（不少于现有用例数）

- [ ] **Step 7: 验收 spec §7 第 5 条（防忘记重跑机制有效）**

临时改一个 workflow 模板（如 rule-templates.ts 的 bridge-e2e description 末尾加一个字），跑 `npx vitest run test/tools/skill-builder.test.ts`，确认 **DRY 一致性 it 失败**（磁盘 != 派生）——证明机制有效。然后 `git checkout -- src/tools/rule-templates.ts` 还原。

Expected: DRY 一致性 it FAIL（证明改 workflow 忘跑 build:skills 会被测试捕获）

- [ ] **Step 8: Commit**

```bash
git add scripts/build-skills.mjs package.json .claude/skills/ test/tools/skill-builder.test.ts
git commit -m "feat(skills): build:skills wrapper + 3 SKILL.md 生成 + DRY 一致性测试

- scripts/build-skills.mjs CLI wrapper（import 编译产物, writeFileSync 不加 \\n）
- package.json build:skills script
- 生成 3 个 .claude/skills/<name>/SKILL.md（派生自 workflow 模板）
- DRY 一致性测试（磁盘 == buildAllSkills, 防忘跑 build:skills）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage（逐条对照 spec §1-9）：**

| spec 条目 | 覆盖 task/step |
|----------|---------------|
| §1 范围（仅仓库自身，不碰 setup_project_rules/rules-manifest） | Global Constraints 明示；File Structure 无 setup_project_rules/rules-manifest 改动 |
| §2 3 个 skill（name/派生源/目录） | Task 1 WORKFLOW_TO_SKILL + Task 2 生成 3 SKILL.md |
| §3 派生机制（剥 frontmatter + 剃版本行 + 包 SKILL frontmatter + 引号 + 不加 H1） | Task 1 Step 1 deriveSkillFromWorkflow 完整实现 |
| §3 WORKFLOW_TO_SKILL 映射 | Task 1 Step 1 + Step 2 测试 |
| §3 description 引号处理（提取纯文本+重新包引号） | Task 1 Step 1 descMatch + 组装 `description: "${description}"`；Global Constraints 锁 |
| §4 build-skills.mjs wrapper（import 编译产物, writeFileSync 不加 trailing newline） | Task 2 Step 1（注释明确不加 \n） |
| §4 package.json build:skills script | Task 2 Step 2 |
| §4 维护流（改 rule-templates → build:skills → commit） | Task 2 Step 3 + 派生方向 |
| §5 测试（派生逻辑 + DRY 一致性 + frontmatter 合法，放 vitest） | Task 1 Step 2（派生 3 it）+ Task 2 Step 5（DRY 1 it） |
| §6 范围边界（不含 setup_project_rules/rules-manifest/CI check/hook） | Global Constraints + File Structure 一致 |
| §7 验收标准 1-6 | Task 2 Step 3/4/6/7（验收 1-5）+ 全量 npm test（验收 6） |
| §8 风险（派生 regex / 触发 / 三份漂移） | 测试覆盖派生逻辑 + DRY；三份漂移由 DRY（rule→skill）+ 现有 check-rules-version-bump（rule→.claude/rules）正交守护 |

**Gaps：无未覆盖项。**

**2. Placeholder scan：** 无 TBD/TODO。skill-builder.ts / build-skills.mjs / 测试代码完整内联。3 个 SKILL.md 内容由 `build:skills` 生成（非手写占位），Task 2 Step 4 人工核验。

**3. Type/naming consistency：**
- `WORKFLOW_TO_SKILL` / `deriveSkillFromWorkflow` / `buildAllSkills` 全程一致（Task 1 定义、Task 2 wrapper + DRY 测试引用同名）。
- 3 个 skill name（`godot-mcp-bridge-e2e` / `godot-mcp-verify-loop` / `godot-mcp-safe-edit`）在 WORKFLOW_TO_SKILL + 测试断言 + 生成目录，全程一致。
- import 路径：测试 `../../src/tools/skill-builder.js`（源，vitest 转译）；wrapper `../build/tools/skill-builder.js`（编译产物，先 build）——两套路径对齐项目惯例（test import src / scripts import build）。
- DRY 测试 `join(__dirname, '..', '..', '.claude', 'skills', ...)`：`__dirname` = `test/tools/`，`../../.claude/skills` = 仓库根的 `.claude/skills/`（路径正确）。

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-27-godot-methodology-skills.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每个 task 派一个全新 subagent 执行，task 间 review。

**2. Inline Execution** — 当前会话用 executing-plans 批量执行，带 checkpoint。

Which approach?
