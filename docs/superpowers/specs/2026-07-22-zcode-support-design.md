# godot-mcp-enhanced 对 ZCode 的深度支持

**日期**：2026-07-22
**承接**：`docs/使用指南-Warp.md`（客户端接入指南范式）+ `setup_project_rules` 双写扩展（`2026-05-26-setup-project-rules-claudemd-design.md`）
**范围**：4 面 — ① 接入配置指南（文档）/ ② AGENTS.md 适配（代码）/ ③ 确认安全对齐（分析+文档）/ ④ 协议层+GUI 实测。**仅面 ② 动 TS 代码**，其余为文档 + 实测产出。
**核心约束**：默认双写（`setup_project_rules` 同时生成 CLAUDE.md + AGENTS.md）；AGENTS.md 全量合并（ZCode 不扫描子目录/不展开 @import，必须把规则全塞进单文件）；复用优先（builders / 规则模板 / merge 逻辑不重写）。

## 背景

### godot-mcp-enhanced 现状（行号已 grep 实测）

- `project.ts:268` `setup_project_rules`：已有 `claude_md`（`:68`，默认 true）、`force`、`rules_mode`（manifest 驱动 reconcile）。CLAUDE.md 段幂等靠 header 白名单 `SECTION_IDS`（`claudemd-builder.ts:8-13`）+ `mergeSections`（`:398`；`:387` 打 `isMcp` 标、`:406` 保留 `!isMcp` 用户段）。`{{MCP_VERSION}}` 插值在 `:451`（base）+ `:453-455`（detail 循环，重复）。`actionRisks.setup_project_rules = 'write'`（`:613`）。
- `claudemd-builder.ts` 导出 11 个纯函数 builders（`buildEngineVersion` / `buildRenderer` / `buildKeyPaths` / `buildMainScene` / `buildAutoloads` / `buildInputMap` / `buildPhysics` / `buildLayerNames` / `buildMcpMapping` / `buildTypeGuide` / `buildBestPractices`），可直接被新 builder 复用。
- `buildMcpMapping()`（`claudemd-builder.ts:278`）返回指向 `.claude/rules/*.md` 的映射表 —— 对 ZCode 误导（见 §2 复用调整）。
- 客户端指南范式：`docs/使用指南-Warp.md`（头部「验证状态」声明 + 三种接入方式 + 协议层验证脚本 + 权限矩阵 + 故障排查）。

### ZCode 机制（证据：官方文档全文，webReader 抓取）

> 来源 `zcode.z.ai/cn/docs/mcp-services` + `/agents`，2026-07-22 抓取。**文档 ≠ 真机行为，面 ④ GUI 实测二次确认（双保险）。**

| 机制 | 原文要点 | 对设计的影响 |
|---|---|---|
| MCP 配置文件 | 用户 `~/.zcode/cli/config.json`（键 `mcp.servers`）、工作区 `<项目根>/.zcode/config.json`（`mcp.servers`）、`.agents/mcp.json`（`mcpServers`）。file-based 项目级配置官方明确存在 | 面 ① 方式 B 落点 |
| 同作用域优先级 | `.zcode` 读到任何 MCP 服务 → 同作用域 `.agents/mcp.json` 整体跳过，不合并 | 面 ① 坑（配了 .zcode 后 .agents 失效） |
| 从外部 Agent 导入 | 发现来源含 Claude Code `~/.claude/settings.json`；走**导入**路径（设置→MCP 服务器→导入图标→勾选→写入 `.zcode`），**非运行时 auto-spawn** | 面 ① 方式 C（措辞：导入，非零配置） |
| 项目指令文件 | 只读用户全局 AGENTS.md + 当前 Workspace AGENTS.md；**不合并多层级、不扫描子目录、不展开 @import/@include、不按任务类型选规则** | **面 ② 全量合并前提成立** |

## 核心决策（brainstorming + review 闭环确认）

三个决策点经一轮 review 闭环（header 白名单纠后缀标记偏移、面 ① 证据补全、方式 C 措辞修正）后定稿：

| 决策 | 结论 | 理据 |
|---|---|---|
| ① `agents_md` 命名 | `agents_md: boolean = true`，与 `claude_md`（`:68`）对称，**独立默认 true**（不跟 `claude_md` 联动） | AGENTS.md 是 Codex/Cursor/Cline/Sourcegraph 共守的跨厂商标准，Claude Code 自己也读 —— 不是「为 ZCode 污染项目根」。行为变更（升级后突然多生成 AGENTS.md 进 git）须 CHANGELOG 登记 |
| ② 幂等机制 | header 白名单 `AGENTS_SECTION_IDS` + 抽 `shared/section-merge.ts` 共用，**不用后缀标记** | `mergeSections`（`:398`）本就靠 `SECTION_IDS` 白名单判 MCP 段（`:8-13`/`:387`/`:406`），无后缀机制。后缀标记是发明新机制且有歧义 |
| ③ 面 ③ 定位 | 分析为主、代码 contingent；elicitation 拆 **A 半（现在定论）/ B 半（留面 ④）** | A 半是 godot 侧逻辑（与客户端无关）；B 半是 ZCode 客户端能力，须 GUI 实测 |

---

## §1 面 ① — 接入配置指南（`docs/使用指南-ZCode.md`，新增）

对标 `使用指南-Warp.md` 结构。**头部必须加「验证状态」声明**（沿用 Warp 指南 `:5` 范式）：协议层/文档 ✅、GUI 端到端 ⚠️ 待面 ④。

三种接入方式：

| 方式 | 落点 | 要点 |
|---|---|---|
| A. ZCode GUI（推荐新手） | 设置 → MCP 服务器 → 新建（stdio） | `command: npx`、`args: ["-y","godot-mcp-enhanced"]`、作用域选「工作区」 |
| B. file-based | `<项目根>/.zcode/config.json`（`mcp.servers`）或 `.agents/mcp.json`（`mcpServers`） | **坑**：`.zcode` 有服务时 `.agents` 整体被跳过，不合并 |
| C. 从 Claude Code 导入 | ZCode 设置 → MCP 服务器 → 导入图标 → 勾选 → 写入 `.zcode` | ZCode 发现 `~/.claude/settings.json`；**导入（非 auto-spawn）**，非零配置 |

含：env 表（`ALLOWED_PROJECT_PATHS` / `GODOT_PATH` / `GODOT_PROJECT_PATH` / `GODOT_MCP_SANDBOX`）、`working_directory` 必设坑（同 Warp §5）、协议层验证脚本（复用 Warp §6.2 范式）、权限矩阵（面 ③ 产出）、GUI 实测结果（面 ④ 回填）、故障排查表。

**所有 ZCode 机制断言标来源 + 抓取日期**；面 ④ 做本机二次确认。

## §2 面 ② — AGENTS.md 适配（代码改动，核心）

### 2.1 新增 `src/tools/agentsmd-builder.ts`

类比 `claudemd-builder.ts`。`buildAgentsMd(config, projectDir, mcpVersion): string` 组装单文件 AGENTS.md。

**内容顺序**（固定 `##` header，即 `AGENTS_SECTION_IDS` 白名单）：

```
# {项目名}
> ZCode 项目指令。标注「由 godot-mcp 管理」的段落由 setup_project_rules 维护，请勿手改。

## 项目信息（由 godot-mcp 管理）        ← 元数据 builders 合并（引擎版本/渲染器/关键路径/主场景/Autoload/InputMap/物理/层级）
## Godot MCP 通用规则（由 godot-mcp 管理） ← base（GODOT_MCP_RULES）
## Godot MCP 核心决策树                    ← godot-mcp-core.md
## Godot MCP 编辑器模式                    ← godot-mcp-editor.md
## Godot MCP Game Bridge                   ← godot-mcp-bridge.md
## Godot MCP UI 布局                        ← godot-mcp-ui.md
## Godot MCP 录制回放                        ← godot-mcp-recording.md
## Godot MCP 引擎特性                        ← engine-quirks（若 DETAILED_RULE_TEMPLATES 含此键）
## Godot MCP GDScript 规范                   ← buildTypeGuide()
## Godot MCP 最佳实践                        ← buildBestPractices()
## Godot MCP 规则说明（由 godot-mcp 管理）    ← 改写 buildMcpMapping：说明规则已内联本文件，ZCode 下 .claude/rules/ 不生效
```

> **实现 Task 1（硬前提）**：上表各规则文件段的确切 header **以 `DETAILED_RULE_TEMPLATES` 实际键为准**。写 builder 前先通读 `rule-templates.ts`，确认每个模板的内嵌标题层级 + 是否有 engine-quirks 键（`buildMcpMapping` 表 `:278` 未列 engine-quirks，待确认）。

### 2.2 标题降级（硬前提，否则幂等失效）

每个规则文件有自己的 `#` 一级 / `##` 二级标题。合并进 AGENTS.md 时必须降级：

- 文件级 `#` → AGENTS.md 的 `##`（固定 header，入 `AGENTS_SECTION_IDS`）
- 文件内 `##` → `###`（防止 `parseSections` 把规则文件内嵌 `##` 误判成顶层 MCP 段）

降级函数在 `agentsmd-builder.ts` 内实现，**对 base（`GODOT_MCP_RULES`）和各 detail 模板统一处理**。

### 2.3 抽 `src/tools/shared/section-merge.ts`（共用，不复制）

把 `claudemd-builder.ts` 的 `parseSections` / `mergeSections` / `normalizeHeader` / `Section` 接口移到 `shared/section-merge.ts`，两个 builder 都 import。

**重构点**：`parseSections` 现依赖模块级 `SECTION_IDS`（`:387` `isMcp: SECTION_IDS.has(norm)`）。抽共享后须参数化 —— `mergeSections(existing, newSections, sectionIds)` 接收各自的白名单集合。`SECTION_IDS` / `SECTION_ORDER` 留在 `claudemd-builder.ts`，`AGENTS_SECTION_IDS` 留在 `agentsmd-builder.ts`，作为参数传入。

`shared.ts` barrel（`src/tools/shared.ts`）按现有模式 re-export。

### 2.4 复用调整

- 元数据 builders（`buildEngineVersion` 等 8 个）+ `buildTypeGuide` + `buildBestPractices`：直接 import 复用，零改动。
- `{{MCP_VERSION}}` 插值：抽 `interpolateVersion(content, version)` helper（消除 `project.ts:451` base + `:453-455` detail 循环的重复），base + detail 统一走此 helper。
- `buildMcpMapping()`：**不直接复用**。AGENTS.md 改写为「规则已全部内联到本文件上方各段；ZCode 下 `.claude/rules/` 不生效（ZCode 不扫描子目录）」，不指向 `.claude/rules/*.md`。

### 2.5 改 `src/tools/project.ts`

- `setup_project_rules` 加参数 `agents_md`（`:68` inputSchema 加定义，默认 true；`:271` 旁加 `const doAgentsMd = args.agents_md !== false;`）。
- `doClaudeMd` 块（`:372-535`）旁加 `doAgentsMd` 块：生成/合并 workspace 根 `AGENTS.md`，同样的 `force` / 幂等语义（`AGENTS_SECTION_IDS` 白名单 + `mergeSections`）。
- `rules_mode` reconcile 语义**不扩展**到 AGENTS.md（rules manifest 只管 `.claude/rules/` 文件；AGENTS.md 是合并产物，靠 `force` + header 白名单幂等即可，不进 manifest）。

## §3 面 ③ — 确认/安全机制对齐（分析 + 文档，预期零代码改动）

产出 = ZCode 指南权限章节。elicitation 拆两半：

**A 半（现在定论，与客户端无关）**：单客户端下 `confirm_and_execute` 的 token 走 client→server→client 回路，AI 可自取 —— **自动执行模式下不算可靠保护**。依据：已知 defect（confirm-token 回路自确认，见 `defects.md` elicitation 相关条目 + `2026-07-09-mcp-elicitation-design.md`）。指南明确建议：**ZCode 用户用「变更前确认」执行模式兜底，不要依赖 `confirm_and_execute`**。

**B 半（留面 ④）**：ZCode 是否实现 MCP elicitation、变更前确认弹窗形态 —— GUI 实测定论。

| ZCode 执行模式 | godot 危险操作（write_config / create_project / setup_project_rules）行为 |
|---|---|
| 变更前确认 | ZCode 拦截确认 ✅ 兜底有效 |
| 自动编辑/完全访问 | 依赖 `confirm_and_execute` + risk-coverage（A 半：不可靠，建议切回变更前确认） |

> 若面 ④ 实测发现需 godot 侧适配（如 ZCode 的确认协议有特殊要求），才追加代码改动 —— spec 标 contingent。

## §4 面 ④ — 协议层 + GUI 端到端实测

- **协议层**：官方 SDK 客户端模拟 ZCode（initialize / tools/list / progress / elicitation / logging / roots），复用 Warp 指南 §6.2 脚本范式。
- **GUI 端到端**（手动配合）：① 配 godot MCP server ② 调 `setup_project_rules` 生成 AGENTS.md ③ 问 ZCode agent「这个项目的 godot 规则」验证 AGENTS.md 注入 ④ 调危险操作验证执行模式/确认弹窗 ⑤ 截图。
- **产出**：兼容性报告回填指南 §验证；定论 B 半的 elicitation 问题。

## 文件改动清单

| 文件 | 动作 | 面 |
|---|---|---|
| `docs/使用指南-ZCode.md` | 新增（① + ③ + ④ 回填） | ①③④ |
| `src/tools/agentsmd-builder.ts` | 新增 | ② |
| `src/tools/shared/section-merge.ts` | 新增（从 claudemd-builder 抽出） | ② |
| `src/tools/claudemd-builder.ts` | 改：parseSections/mergeSections 改 import shared + SECTION_IDS 参数化 | ② |
| `src/tools/project.ts` | 改：加 `agents_md` 参数 + 双写逻辑 + 抽 `interpolateVersion` | ② |
| `src/tools/rule-templates.ts` | 改：抽 AGENTS.md 复用的规则片段（按 Task 1 通读结果） | ② |
| `test/tools/agentsmd-builder.test.ts` | 新增 | ② |
| `test/project` setup_project_rules 相关 | 改/扩（默认双写、`agents_md:false` 单写、`force`） | ② |
| `README.md` / `README.en.md` | 改：客户端列表加 ZCode | ① |
| `CHANGELOG.md` | 改：登记 `agents_md` 默认双写的行为变更 | ② |

## 测试策略

- `agentsmd-builder.test.ts`：内容组装顺序、`{{MCP_VERSION}}` 插值、标题降级（`#`→`##`、内嵌 `##`→`###`）、幂等 merge（二次运行不重复、不破坏用户段、`force` 覆盖）。
- `project` setup_project_rules 双写集成测试：默认双写（CLAUDE.md + AGENTS.md 都生成）、`agents_md:false` 单写、`claude_md:false` 单写、`force` 语义。
- 风险登记：`setup_project_rules` 的 `actionRisks` 已是 `write`（`project.ts:613`），双写不改变风险等级。

## 不含（YAGNI）

- 不给 AGENTS.md 做 manifest 驱动 reconcile（rules manifest 只管 `.claude/rules/` 文件集；AGENTS.md 靠 header 白名单幂等足够）。
- 不做 ZCode 专用的规则文件（规则文本只维护一份，AGENTS.md 是合并产物）。
- 不实测 Warp 之外的客户端（ZCode 是本指南唯一新目标）。
- 不在面 ③ 预先写代码（contingent：仅当面 ④ 实测发现需适配才动）。

## 验证步骤

1. `npx tsc --noEmit`
2. `npx vitest run test/tools/agentsmd-builder.test.ts`
3. `npx vitest run`（全量回归，重点 claudemd-builder / project 双写）
4. 手动：`setup_project_rules` 生成 AGENTS.md → 二次运行确认幂等（无重复段、用户段保留）→ `agents_md:false` 确认不生成
5. 协议层脚本（面 ④）：tools/list 完整性 + elicitation 能力探测
6. GUI 端到端（面 ④）：AGENTS.md 注入验证 + 危险操作确认弹窗截图

## 风险与对策

- **AGENTS_SECTION_IDS 不全**：实现 Task 1 先通读 `rule-templates.ts`，照实际键填全；漏键会导致对应规则段不进白名单，二次运行重复追加。测试用「二次运行 diff 为空」守卫。
- **标题降级漏处理**：若某规则文件内嵌 `##` 未降级，`parseSections` 误判顶层段、幂等失效。测试用「内嵌 `###` 计数 = 规则文件 `##` 计数」守卫。
- **行为变更**：`agents_md` 默认 true 使现有用户升级后多生成 AGENTS.md。CHANGELOG 显式登记 + spec 标注；用户可 `agents_md:false` 关闭。
- **ZCode 文档滞后真机**：面 ① 所有断言标来源 + 日期，面 ④ GUI 实测二次确认（双保险）。
- **section-merge 重构影响 CLAUDE.md**：抽共享后 `mergeSections` 签名变（加 `sectionIds` 参数），须回归 `claudemd-builder.test.ts` + 现有 project 双写测试，确保 CLAUDE.md 路径行为不变。
