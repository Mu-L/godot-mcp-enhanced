# 设计：Godot 开发方法论 SKILL.md（形态 B，仓库自身开发 skill）

- **日期**：2026-07-27
- **状态**：design（待 user review → writing-plans）
- **范围**：方法论 pack 形态 B（仓库自身的 Claude Code skill）。互补形态 A（v0.25.0 已交付）。不含 spec §9 原设想的"生成到用户项目 .claude/skills/"——本期消费者缩小为**仅仓库自身开发用**（见 §1 范围调整）。
- **来源**：spec `2026-07-27-godot-methodology-workflows-design.md` §9 + 2026-07-27 brainstorming（两节定稿）

## 1. 背景与目标 + 范围调整

形态 A（v0.25.0，commit `e7f7aa2..1b89e37`）已交付 3 个跨子系统 workflow rule 文档（`.claude/rules/godot-mcp-workflow-*.md`），由 `setup_project_rules` 分发到用户项目，`alwaysApply: false`（按需加载，靠 description 关键词命中）。

**形态 B 目标**：给**仓库自身开发**（开发 godot-mcp-enhanced 的 AI 会话）提供 Claude Code 原生 skill（`.claude/skills/<name>/SKILL.md`），由 Claude Code 按 description **主动触发**——比 rule 按需加载更主动，减少"AI 不主动遵循 workflow"风险（形态 A spec §9 识别的核心风险）。

**范围调整（相对 spec §9 原设想）**：spec §9 原写"生成 SKILL.md 到用户项目 `.claude/skills/`（绑 Claude Code，需扩展分发+版本追踪）"。本期 brainstorming 确认消费者 = **仅仓库自身开发用**：
- skill 放**仓库自身** `.claude/skills/`（`D:\GitHub\godot-mcp-enhanced\.claude\skills\`），git 直接版本控制
- **不碰 `setup_project_rules`**（不分发到用户项目）
- **不扩展 `rules-manifest`**（无需 hash/二维判定/check/update——git 版本控制足够）
- 砍掉原方案最重的两块（分发扩展 + manifest 扩展），只保留"派生 + 生成 + 测试"

用户项目仍用形态 A 的 rule 文档（`setup_project_rules` 生成 `.claude/rules/`）。形态 B 与形态 A **互补**：内容同源（`rule-templates.ts` workflow 模板），格式/机制不同（rule 按需加载 vs skill 主动触发），服务不同消费者（用户项目 vs 仓库自身开发）。

## 2. 3 个 skill（对应形态 A 的 3 workflow）

| skill name | 派生源（`rule-templates.ts` 模板） | 目录 |
|---|---|---|
| `godot-mcp-bridge-e2e` | `godot-mcp-workflow-bridge-e2e.md` | `.claude/skills/godot-mcp-bridge-e2e/SKILL.md` |
| `godot-mcp-verify-loop` | `godot-mcp-workflow-verify.md` | `.claude/skills/godot-mcp-verify-loop/SKILL.md` |
| `godot-mcp-safe-edit` | `godot-mcp-workflow-safe-edit.md` | `.claude/skills/godot-mcp-safe-edit/SKILL.md` |

**命名说明**：`godot-mcp-*` 前缀（与项目命名一致，仓库自身命名空间无冲突风险）。`verify` 用 `godot-mcp-verify-loop`（避免 `verify` 太泛）。因去 `workflow-` 中缀致 skill name 与 workflow 文件名不对称，映射存 `WORKFLOW_TO_SKILL` 常量表查表（非纯字符串变换）。

## 3. 派生机制（新 `src/tools/skill-builder.ts`）

**纯函数导出，无副作用**（副作用隔离在 CLI wrapper，§4）：

```typescript
/** workflow 模板 key → skill name 映射（去 workflow- 中缀，verify 特例 -loop） */
export const WORKFLOW_TO_SKILL: Record<string, string> = {
  'godot-mcp-workflow-bridge-e2e.md': 'godot-mcp-bridge-e2e',
  'godot-mcp-workflow-verify.md': 'godot-mcp-verify-loop',
  'godot-mcp-workflow-safe-edit.md': 'godot-mcp-safe-edit',
};

/**
 * 从 workflow 模板派生单个 SKILL.md 内容。
 * 处理：剥 rule frontmatter（description/alwaysApply 两字段）+ 剃到首个 ## 标题前的所有内容
 * （版本引用行 `> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+` + 紧随空行）。
 * 输出：SKILL frontmatter（name + description）+ \n\n + 正文（从 ## 标题起，不加 H1）。
 */
export function deriveSkillFromWorkflow(tpl: string, skillName: string): string;

/** 遍历 WORKFLOW_TO_SKILL，对 DETAILED_RULE_TEMPLATES 的 3 个 workflow 模板派生，返回 name→SKILL.md 内容。 */
export function buildAllSkills(): Map<string, string>;
```

**派生规则**（输入 = `DETAILED_RULE_TEMPLATES['godot-mcp-workflow-*.md']`）：
1. 剥 rule frontmatter：去首部 `---\n...\n---\n`（含 description + alwaysApply 两字段）
2. 剃到首个 `##` 前的所有内容：`> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+\n\n`（版本引用行 + 紧随空行）
3. 提取 rule 的 `description` 值（frontmatter 内），复用为 SKILL description（已含"—— 当你…时使用"触发短语）
4. 组装：`---\nname: <skillName>\ndescription: <ruleDescription>\n---\n\n<正文从 ## 起>`

**不加 H1**：SKILL.md 正文从 rule 的 `## 标题`（H2）开始，不额外加 `# Title`（派生最简，Claude Code skill 不强制 H1）。

**description 语言**：中文，直接复用 rule 模板的（项目中文定位；Claude Code 按 description 语义匹配，中文可行）。rule 模板的 description 已含触发短语（形态 A v0.25.0 已写入，如"...输入模拟 —— 当你需要验证运行时行为、做 E2E 测试、模拟输入或回归测试时使用"）。

## 4. 生成与维护（CLI wrapper + npm script）

**新 `scripts/build-skills.mjs`**（CLI wrapper，对齐项目惯例：`generate-docs` → `scripts/generate-doc-db.js`、`build-matrix` → `npm run build && node build/capability/build-matrix.js`）：
- import 编译产物 `build/tools/skill-builder.js`
- 调 `buildAllSkills()`，对每个 `name→content` 写 `.claude/skills/<name>/SKILL.md`（mkdirSync 递归建目录）
- `skill-builder.ts` 保持纯导出（无 CLI 副作用），副作用隔离在 wrapper——测试直接 import 纯函数

**`package.json` scripts 加**：
```json
"build:skills": "npm run build && node scripts/build-skills.mjs"
```

**维护流**：
1. 改 workflow 内容 → 改 `rule-templates.ts`（单一源，`DETAILED_RULE_TEMPLATES` 的 3 个 workflow 模板）
2. 跑 `npm run build:skills` 重新生成 3 个 `.claude/skills/<name>/SKILL.md`
3. 手动 `git add .claude/skills/` + commit
4. `.claude/rules/godot-mcp-workflow-*.md` 仍走**现有**手动同步机制（`rule-templates.ts:4-8` 顶部注释 + CI `check-rules-version-bump`，本次不动）

**派生方向（单向，DRY）**：
```
rule-templates.ts (DETAILED_RULE_TEMPLATES 的 3 workflow 模板, 单一源)
   ├─→ .claude/skills/<name>/SKILL.md   （派生, build:skills）
   └─→ .claude/rules/godot-mcp-workflow-*.md （手动同步, 现有机制, 本次不动）
```
改 workflow 只改 `rule-templates.ts` 一处 → SKILL.md 自动派生（跑 build:skills）；`.claude/rules/*.md` 按现有机制手动同步（不在本次范围）。

## 5. 测试（`test/tools/skill-builder.test.ts`，vitest）

放 `test/tools/`（与 `arch-templates.test.ts` / `base-rule-version.test.ts` / `rule-templates-workflows.test.ts` 同构——vitest 测模板源结构合法性）。

**断言**：
1. **派生逻辑**（`deriveSkillFromWorkflow`）：
   - 剥 rule frontmatter（输出不以 `---\ndescription:` / `alwaysApply:` 开头，但含 SKILL 的 `name:` / `description:`）
   - 剃版本引用行（输出不含 `> 适用于 godot-mcp-enhanced` / `{{MCP_VERSION}}`）
   - 输出以 `---\nname: <skillName>\n` 开头 + 含 `## ` 标题
2. **WORKFLOW_TO_SKILL 映射**：3 个 key 存在 + skill name 正确（`godot-mcp-bridge-e2e` / `godot-mcp-verify-loop` / `godot-mcp-safe-edit`）
3. **buildAllSkills**：返回 3 个 entry，每个 SKILL.md frontmatter 合法（`name` 非空 + `description` 含"—— 当你"触发短语）
4. **DRY 一致性**（新模式，防忘记重跑 build:skills）：对每个 skill，读磁盘 `.claude/skills/<name>/SKILL.md` 内容 == `buildAllSkills().get(name)` 派生结果（字符串相等）。开发者改 `rule-templates.ts` 后忘跑 `build:skills` → 此断言失败 → `npm test` 直接报"SKILL.md 漂移"。

**DRY 一致性放 vitest 而非独立 CI step 的理由**（先例核实）：
- 派生逻辑本身该有单元测试（纯逻辑，天然属 vitest）；DRY 一致性是派生函数端到端正确性的自然延伸（磁盘 == 派生结果）
- `test/tools/` 下全是 vitest，同构
- 反馈链路最短：改 rule-templates.ts → `npm test` → vitest 直接报，不用等 CI
- CI 已覆盖：`ci.yml` 跑 `npm test`，vitest DRY 断言在 CI 同样跑，等价独立 CI step 但少一个脚本
- 独立 CI 脚本（如 `check-rules-version-bump.mjs`）更适合"需 git 操作"的检查（比 HEAD/工作区 hash）；"磁盘 == 派生结果"不需 git 操作，vitest 足够

## 6. 范围边界

**本期含**：
- 3 个 `.claude/skills/<name>/SKILL.md`（派生生成 + commit）
- `src/tools/skill-builder.ts`（纯函数：`deriveSkillFromWorkflow` + `buildAllSkills` + `WORKFLOW_TO_SKILL`）
- `scripts/build-skills.mjs`（CLI wrapper）
- `package.json` 加 `build:skills` script
- `test/tools/skill-builder.test.ts`（派生逻辑 + DRY 一致性 + frontmatter 合法）

**本期不含**（YAGNI）：
- `setup_project_rules` 生成 skills 段（消费者仅仓库自身，不分发用户项目）
- `rules-manifest` 扩展（git 版本控制足够）
- client 探测（无条件仓库自身用）
- 独立 CI check 脚本（vitest DRY 断言已覆盖）
- pre-commit hook（项目无 husky 基建，对齐 `check-rules-version-bump.mjs` 靠 CI + 手动惯例）
- `.claude/rules/*.md` 同步机制改动（现有手动同步，本次不动）

## 7. 验收标准

1. `npm run build:skills` 在干净仓库跑后，`.claude/skills/` 出现 3 个 `<name>/SKILL.md`
2. 每个 SKILL.md frontmatter 合法（`name` 非空 + `description` 含"—— 当你"触发短语）
3. 每个 SKILL.md 正文从 `##` 标题起，不含 rule frontmatter（`alwaysApply`）+ 不含版本引用行（`> 适用于` / `{{MCP_VERSION}}`）
4. `test/tools/skill-builder.test.ts` 全 PASS（派生逻辑 + WORKFLOW_TO_SKILL 映射 + DRY 一致性 + frontmatter 合法）
5. 改 `rule-templates.ts` 某 workflow 模板后，不跑 `build:skills` → `npm test` 的 DRY 一致性断言失败（防忘记重跑机制有效）
6. `npm test` 全量无回归（含既有 4096 passed）

## 8. 风险

- **派生 regex 鲁棒性**：剥 frontmatter + 剃版本引用行靠正则/字符串操作。若 workflow 模板结构变（如多加空行、frontmatter 字段顺序变），派生可能错。缓解：测试覆盖派生逻辑 + DRY 一致性（结构变 → 测试失败）。
- **SKILL.md 不被 Claude Code 触发**：形态 B 核心价值依赖 Claude Code 主动加载 skill。若 description 触发语义不足，skill 可能不被触发。缓解：description 复用 rule 的触发短语（形态 A 已优化）；效果待观察（与形态 A 同风险根因）。
- **三份内容表征漂移**：`rule-templates.ts` 模板 / `.claude/rules/*.md` 磁盘 / `.claude/skills/*/SKILL.md` 派生。其中 rule-templates → skills 是派生（自动），rule-templates → .claude/rules 是手动同步（现有）。若改 rule-templates 后只跑 build:skills 忘同步 .claude/rules，两份磁盘漂移。缓解：现有 CI `check-rules-version-bump` 管 rule-templates → .claude/rules 的版本维度；本 spec 的 DRY 一致性管 rule-templates → skills 的派生维度；两个正交不变式。

## 9. 与 spec `2026-07-27-godot-methodology-workflows-design.md` §9 的差异

| 维度 | spec §9 原设想 | 本 spec（brainstorming 调整后） |
|---|---|---|
| 消费者 | 用户项目（`.claude/skills/`） | **仅仓库自身开发**（仓库 `.claude/skills/`） |
| 分发 | setup_project_rules 扩展生成 | **不碰 setup_project_rules** |
| 版本追踪 | rules-manifest 扩展 | **git 直接版本控制**（不扩展 manifest） |
| client 探测 | 隐含需探测 | **无条件**（仓库自身用） |

范围缩小后，形态 B 从"分发功能"降为"仓库开发工具"——复杂度大幅降低（无机制扩展），但价值聚焦（仓库自身开发的 AI 主动遵循 workflow）。
