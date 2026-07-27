# 设计：Godot 开发方法论 workflow 文档（形态 A）

- **日期**：2026-07-27
- **状态**：design（待 user review → writing-plans）
- **范围**：方法论 pack 第一期（形态 A：增强文档层）。不含形态 B（Claude Code SKILL.md）/ 形态 C（MCP Prompts），二者视 A 效果评估。
- **来源**：2026-07-27 brainstorm（竞品 memory `godot-mcp-competitive-landscape.md` 发展方向② + Obsidian 日志 `2026-07-27 MCP 生态大盘与 Summer Engine 叙事威胁调研.md`）

## 1. 背景与目标

`setup_project_rules` 现生成 6 个**子系统参考文档**（`.claude/rules/godot-mcp-*.md`：core/bridge/editor/ui/recording/engine-quirks）+ CLAUDE.md + AGENTS.md + settings.json hook，分发机制成熟（`rules-manifest.ts` 的 hash + 二维判定 + check/update/overwrite）。

**差距**：现有规则是**被动参考文档**（AI 按需查阅），而 MCP 生态中 star 数最高的 agentic skills 方法论之一 obra/superpowers 是**主动 checklist 流程**（AI 按流程走；star 数随时间变化，不硬编码具体值）。竞品分析结论：rules-manifest 应升格为"Godot 开发方法论 pack"叙事主角。

**第一期目标**（形态 A）：新增 3 个**跨子系统 workflow 文档**（带 checklist），把高频开发流程从"埋在参考文档里"变成"AI 主动遵循的步骤"，同时为 README 提供"方法论"叙事素材。复用现有分发机制，零机制改动。

## 2. 新增 3 个 workflow 文档

文件位于 `.claude/rules/godot-mcp-workflow-*.md`（`workflow-` 前缀区分跨子系统流程 vs 子系统参考）。

**文档结构约定**（与现有 6 模板一致）：frontmatter 后正文首行统一为 `> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+`，随后才是"何时用"/checklist/常见偏离。`{{MCP_VERSION}}` 占位符由 `setup_project_rules` 插值（§6 测试断言其存在）。

### 2.1 `godot-mcp-workflow-bridge-e2e.md`（运行时验证 / E2E）

**frontmatter**：
```yaml
---
description: "bridge e2e 运行时验证 game_bridge_install run_project wait_for_bridge game_query ping game_input game_wait take_screenshot frame-verify 录制 回归测试 输入模拟 —— 当你需要验证运行时行为、做 E2E 测试、模拟输入或回归测试时使用"
alwaysApply: false
---
```

**何时用**：AI 需要验证运行时行为、做 E2E 测试、模拟输入、回归测试、Bug 复现时。

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

### 2.2 `godot-mcp-workflow-verify.md`（改 → 跑 → 验证闭环）

**frontmatter**：
```yaml
---
description: "验证闭环 run_and_verify validate_scripts verify_delivery read_scene edit_script 交付门禁 编译 跨文件依赖 parse error 场景树完整性 —— 当你改完代码/场景需要验证或交付前自检时使用"
alwaysApply: false
---
```

**何时用**：AI 改完代码/场景后需要验证、交付前自检时。

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

### 2.3 `godot-mcp-workflow-safe-edit.md`（安全编辑流）

**frontmatter**：
```yaml
---
description: "安全编辑 edit_script search_and_replace validate_scripts 确认令牌 remove_node headless 改盘 editor 覆盖 沙箱 防误用 CRLF tab 缩进 —— 当你编辑 .gd/.tscn、删节点或执行危险操作时使用"
alwaysApply: false
---
```

**何时用**：AI 编辑 `.gd`/`.tscn`、删节点、运行危险操作时。

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

## 3. 分发接入（零机制改动）

### 3.1 `rule-templates.ts`

在 `D:\GitHub\godot-mcp-enhanced\src\tools\rule-templates.ts` 的 `DETAILED_RULE_TEMPLATES` 加 3 个条目：
- `'godot-mcp-workflow-bridge-e2e.md'`
- `'godot-mcp-workflow-verify.md'`
- `'godot-mcp-workflow-safe-edit.md'`

模板内容 = `.claude/rules/godot-mcp-workflow-*.md` 的完整内容（含 `{{MCP_VERSION}}` 占位符插值）。**两份副本必须一致**（现有约束，`rule-templates.ts` 顶部注释已声明）。

### 3.2 `rules-manifest.ts`（复用，不改）

新文件自动纳入现有分发：
- `buildAdoptManifest` / `planReconcile` 按 filename 遍历，新文件名自动进入 manifest
- 二维判定（版本维度 × 用户修改维度）天然适用：升级时 pure-upgrade → write，stale-and-modified → warn-keep（不吞用户修改）
- **无需改 `rules-manifest.ts` 任何代码**

### 3.3 `.claude/rules/` 实际文件

在 `D:\GitHub\godot-mcp-enhanced\.claude\rules\` 新建 3 个 `godot-mcp-workflow-*.md`（与模板一致）。这是 setup_project_rules 安装到用户项目的源文件。

## 4. README 方法论故事段

在 `D:\GitHub\godot-mcp-enhanced\README.md`「核心能力」段后（"### 批量操作与资源管理" 之后、"## 工具一览" 之前）加：

```markdown
### 不只是工具，是带 checklist 的开发流程

对标 agentic skills 方法论（如 obra/superpowers），本项目不止堆工具，还提供 AI 可遵循的结构化开发流程（`setup_project_rules` 生成到 `.claude/rules/godot-mcp-workflow-*.md`）：

- **Bridge E2E 流程** — install → run(wait_for_bridge) → ping → 操作+wait → 截图/frame-verify 留证
- **改→跑→验证闭环** — read → edit → run_and_verify → validate_scripts → verify_delivery
- **安全编辑流** — search_and_replace 优先 / 改后 validate / 防覆盖 / 确认令牌

每个流程带 checklist + 常见偏离提示，让 AI 少踩坑、按纪律走。
```

英文 `README.en.md` 同步对应段落。注意：此段与已落盘的反叙事 callout（对比表后）不冲突——反叙事讲"engine-level 能力"，此段讲"方法论流程"，位置不同。

## 5. 版本与 CI

- `package.json`：`0.24.1` → `0.25.0`（minor，新增功能；**当前已是 0.24.1 非 0.24.0**——`package.json:3` 实测）。与竞品 memory「下版本(v0.25.0)思路」其他项合并进同一版本。
- CI `check-rules-version-bump`：模板变更（新增 3 条）会强制要求 version bump，已有机制覆盖。
- `plugin.cfg` / manifest 等版本元数据同步（v0.19.1 先例：版本元数据同步专项）。

## 6. 测试策略

- **`rule-templates.ts` 测试**：**新建**条目完整性测试（现有无——核实 `test/tools/` 下 37 个测试文件，仅 `rule-templates-engine-quirks.test.ts` 是单模板专项且唯一含 `DETAILED_RULE_TEMPLATES`；`rules-manifest.test.ts`/`setup-project-rules-manifest.test.ts` 测纯函数不覆盖模板内容）。建议建统一测试 `test/tools/rule-templates-workflows.test.ts`（参照 engine-quirks 专项形态，但合并 3 个 workflow 到一个文件，避免重复专项），断言：3 个新 key 存在 + 内容含 `{{MCP_VERSION}}` 正文行 + frontmatter 合法（description 非空 + alwaysApply 字段）。
- **`rules-manifest.ts` 测试**：纯函数已覆盖（hash/classify/planReconcile），新文件名自动纳入，无需新增测试——但可加一条「新 filename 经 planReconcile 正确分类」的回归测试。
- **不新增运行时测试**：workflow 文档是静态 markdown，无运行时行为。

## 7. 范围边界

**本期含**：
- 3 个 workflow 文档（`.claude/rules/` + `rule-templates.ts` 双副本）
- README 方法论故事段（中英）
- package.json 0.24.0 → 0.25.0 + 版本元数据同步
- rule-templates 测试加 3 条断言

**本期不含**（形态 B/C，视 A 效果评估）：
- 生成 Claude Code 原生 SKILL.md 到用户项目 `.claude/skills/`（绑 Claude Code，需扩展分发+版本追踪）
- MCP Prompts 暴露方法论（客户端无关，需新增 prompts 实现）

## 8. 验收标准

1. `setup_project_rules` 在干净项目运行后，`.claude/rules/` 出现 3 个 `godot-mcp-workflow-*.md`，内容含 checklist
2. `setup_project_rules(action="check")` 能识别新文件的版本状态（纳入二维判定）
3. 升级场景：旧项目（无 workflow 文件）跑 update → 新文件由**缺失补全机制**写入（`project.ts:473-487`，任意 rules_mode 都先创建缺失文件，不走 `classifyFile` 的 pure-upgrade 分类）；用户改过的 workflow 文件 → warn-keep 不覆盖
4. README 中英两版含方法论故事段
5. `package.json` 0.25.0 + CI `check-rules-version-bump` 通过
6. rule-templates 测试新增 3 条断言通过

## 9. 风险

- **AI 主动遵循率**：workflow 文档是 `alwaysApply: false`（按需加载），AI 是否主动触发取决于 description 关键词命中。形态 B（SKILL.md）能提升主动率，但本期先靠 description + README 引导，效果待观察。
- **两份副本漂移**：`.claude/rules/` 与 `rule-templates.ts` 模板需手动同步（现有约束），新增 3 条增加同步面。CI `check-rules-version-bump` 不校验内容一致性，仅校验版本 bump——内容一致性靠人工/review。
