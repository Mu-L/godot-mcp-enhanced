# P0 Spec 第三方审查报告

> **审查日期**：2026-08-05
> **审查者**：3 个 code-reviewer 子代理（隔离视角，所有声明 grep/read 实测）
> **审查对象**：`docs/plans/p0-specs/P0-1` ~ `P0-6` 共 6 份 spec
> **审查依据**：AGENTS.md「plan 落地后必出第三方审查文档」+「仓库级约束独立核查」规则

---

## 总体判定

| Spec 组 | 判定 | Blocking 数 | 关键问题 |
|---------|------|-------------|---------|
| P0-1 SDK v2 + P0-2 MRTR | **SHIPPED WITH NITS** | 0 真 Blocking | 4 个 Important（执行前必改）+ 7 Nits + **1 重大事实修正**（zod 零用法） |
| P0-3 能力组 + P0-4 UndoRedoManager | **BLOCKING ISSUES** | 6 | P0-3 粒度错配+入口不存在；P0-4 sync/recording 误判 |
| P0-5 runtime_assert + P0-6 工具压缩 | **BLOCKING ISSUES** | 2 | 两份都漏列工具数下游同步；P0-6 漏 editor 工具 |

**结论**：6 份 spec 全部需修订后才能开工。其中 P0-3 需要重新设计核心机制（gate 粒度从工具级改为 action 级），是返工量最大的一份。

---

## 第一部分：P0-1 + P0-2 审查结论

### 总体判定：SHIPPED WITH NITS

无真正 BLOCKING 设计性硬伤，但 4 个 Important Issues 执行前必改。

### 重大事实修正：enhanced 零 zod 用法

**实测证据**：`Grep from ['"]zod['"]` in `D:\GitHub\godot-mcp-enhanced\src` → **0 命中**

P0-1 spec §4.3 声称"enhanced 的 zod schema 主要在 tool-registry inputSchema 和 args-validator"——**这是错误声明**。enhanced 所有 inputSchema 是裸 JSON Schema 对象（如 `src/core/ToolDispatcher.ts:137 type: 'object' as const`），zod 只是 SDK 的 peerDependency，enhanced 自身代码零 zod 用法。

**影响**：PR-A（zod v4 升级）的工作量被高估。spec 说"回归面有限但需验证"，实际是**回归面为零**（自身代码无 zod），风险纯粹来自 SDK 内部。

### Important Issues（执行前需修正）

| # | 问题 | 证据 | 修复 |
|---|------|------|------|
| I-1 | [P0-2] era 检测字段路径 `ctx.mcpReq.envelope.protocolVersion` 未被权威文档证实 | 权威迁移指南列出 `ctx.mcpReq` 字段为 `signal/id/_meta/send/notify`，无 `envelope/protocolVersion` | P0-1 完成后用 SDK v2 实际类型签名校准；或在 §3.3 加注"字段路径待 P0-1 校准" |
| I-2 | [P0-2] 改动清单漏列 `src/core/middleware.ts` | `middleware.ts:114`（elicitFn 参数类型）和 `:170/:178`（调用点） | §改动清单补此文件 |
| I-3 | [P0-2] 改动清单漏列 `test/regression/defects.ts` | `defects.ts:127` 的 `confirm-token-trust-broken` 检测器用正则监测安全门控 | §6.2 显式列出：更新检测器正则兼容双路径 |
| I-4 | [P0-2] §6.2 引用不存在的测试文件 | `test/regression/confirm-and-execute.test.ts`（Glob 命中 0）；实际回归在 `test/core/ToolDispatcher.test.ts` T11 系列 | 修正命令指向真实文件 |

### Nits（7 项非阻塞）

1. [P0-1] import 计数数字小误：spec 说"56 处/51 文件"，实测 55 处/53 文件
2. [P0-1] §3.4 错误类迁移项是空头支票：全仓库无 SDK McpError/ErrorCode import
3. [P0-1] §4.3 zod v4 影响描述失实（见上）
4. [P0-1] 验证计划漏 `build-matrix` / `diff-matrix`（SDK v2 Tool 类型字段变化可能导致 matrix 漂移）
5. [P0-1] §3.3 Server 类型 import 计数：说"3"，实际 4 处
6. [两份] 内部数字不一致：spec 说"9 处 setRequestHandler"，调研方案说"8 处"（9 更准确，含 NotificationHandler）
7. [P0-2] §4.3 token 流程与现有代码冲突未充分说明（2025-era consume-then-elicit vs 2026-era peek-then-consume 的分流）

### 值得进 memory 的工程教训

1. **spec 声明的"现有代码用了 X 库"必须独立 grep 验证**：spec 作者可能想当然地把"SDK 依赖 zod"等同于"项目代码用 zod"
2. **回归检测器（defects.ts）是改动的隐性依赖**：改 confirm_and_execute / elicit / guard 流程时，必须同步检查 `test/regression/defects.ts` 的 detect 正则

---

## 第二部分：P0-3 + P0-4 审查结论

### 总体判定：BLOCKING ISSUES（6 个 Blocking）

这是返工量最大的一组。P0-3 的核心机制（工具级 gate）无法实现核心目标（action 级 drop），需要重新设计。

### Blocking Issues

#### B-1（P0-3）：gate 粒度（工具级）与目标（action 级）错配 ⚠️ 最严重

**证据**：
- `execute_gdscript` 是 `runtime` 工具的 **action**（`src/tools/runtime.ts:76`），不是顶层工具名
- `execute_bpy` 是 `blender` 工具的 **唯一 action**（`src/tools/blender.ts:36,44`）
- MCP `tools/list` 暴露的是工具名（`runtime`），不是 action（`execute_gdscript`）
- 工具级 gate 干掉 `runtime` 会连带干掉 `record_start/stop/play` 等所有 runtime action——**over-blocking，违反最小权限**

**修复**：spec 需重新设计为 **action 级 gate**（在 `executeToolCall` 入口拦截 `args.action`），或在 `runtime`/`blender` 工具的 handler 内对特定 action 做丢弃。

#### B-2（P0-3）：monkey-patch `server.registerTool` 入口在 enhanced 不存在

**证据**：grep 全 `src/` 无 `server.registerTool` 调用。实际注册路径是 `module-loader.ts:231 registerAllModules()` → `tool-registry.ts:39 registerModule` → registry → `ToolDispatcher.ts:129 getFilteredTools`。

**修复**：spec §3.1 主方案改为在 `getFilteredTools` 或 `registerModule` 层做过滤，删除 `server.registerTool` monkey-patch 伪代码。

#### B-3（P0-3）：改动清单遗漏 `npm run build-matrix`

AGENTS.md「完成前强制检查」§5 + 「分发产物与独立副本边界」。P0-3 改变工具可见性属工具清单行为变更。

#### B-4（P0-4）：改动清单遗漏 `npm run check:gdscript`（AGENTS.md 强制项）

AGENTS.md「完成前强制检查」§6 明确"改 `addons/**/*.gd` 后**必须**跑 `check:gdscript`，不只是 validate_scripts"。2026-08-01 P2-12 教训。P0-4 §4 全是 addon .gd 改动，spec 完全没提 `check:gdscript`。

#### B-5（P0-4）：`sync_commands.gd` 误判为 mutation

**证据**：`sync_commands.gd` 全文 186 行都是纯观察者——connect/disconnect SceneTree 信号 + 只读序列化 + notification，**无场景树 mutation**。把信号 connect 接入 EditorUndoRedoManager 无意义。

#### B-6（P0-4）：`recording_commands.gd` 在 editor 路径被禁用，接入 editor-only UndoRedoManager 逻辑矛盾

**证据**：`recording_commands.gd:92-93,117-118` 在 `Engine.is_editor_hint()` 时直接拒绝；EditorUndoRedoManager 是 editor-only API。recording 强制走 Bridge，editor 插件路径禁用。

### P0-3 其他重要发现

- **漏看现有 profile 硬隔离**：`ToolDispatcher.ts:145-185` 已有 `READ_ONLY_MODE`、`LITE`、`MINIMAL`、`PROFILE`、`slim` 五种模式过滤，且 fail-closed 回退 minimal。P0-3 的目标部分可由现有 profile 机制达成，spec 完全无视
- **DROPPED 分组不全**：只列 `code-execution`，未审视 `android`（部署设备）、`selfupdate`（覆盖 addon）、`cpp`（代码生成）等高风险面
- **TOOL_GROUPS 组数错**：spec 称"22 组"，实测 20 个组
- **验收标准引用文件不存在**：`test/capability-matrix.test.js`（实际是 `test/capability/matrix-integrity.test.ts`）

### P0-4 其他重要发现

- **handler 接入度表格数字系统性虚高**：spec 称 ui=25/particle=16/animation=15，实测 ui=14/particle=5/animation=7（普遍虚高 2-3 倍）
- **漏列 2 个已接入文件**：`asset_commands.gd`（1 引用）、`asset_placer.gd`（7 引用）已接入 undo 但 spec 未列
- **`test_commands.gd` 误判为"已接入 undo"**：实测 0 个 `create_action_mixed` 调用，仅注入 undo_manager 到 test 上下文

### 值得进 memory 的工程教训

1. **spec 移植竞品方案前必须 grep 目标项目实际入口**：P0-3 直接照搬 breakpoint 的 `applyCapabilities(server.registerTool)`，但 enhanced 根本没有这个入口
2. **gate 粒度必须对齐 MCP 协议层暴露单位**：MCP tools/list 暴露工具名，不是 action。工具级 gate 会 over-block
3. **undo 接入前必须读代码确认目标文件确有 mutation**：P0-4 把 sync（纯观察者）和 recording（editor 禁用）当作 undo 接入目标
4. **AGENTS.md `check:gdscript` 是 addon .gd 改动的硬门禁**
5. **handler 接入度表格不能用凭印象的数字**：必须 `grep -c create_action_mixed addons/**/*.gd` 生成

---

## 第三部分：P0-5 + P0-6 审查结论

### 总体判定：BLOCKING ISSUES（2 个 Blocking）

实测层面大部分声明属实（行号、文件存在、token 数、阈值），但在改动清单完整性和 P0-6 工具清单一致性两处存在阻塞问题。

### Blocking Issues

#### B-1（两份）：漏列"工具数变更触发的下游同步"

**证据**：`scripts/check-tool-count.mjs:48-112` 校验 9 文件 17 处工具数；AGENTS.md:280"工具清单变更必须同步"；AGENTS.md:374-381 独立副本同步约束。

- P0-5 加 5 工具 → 工具数 36→41
- P0-6 加 help 工具 → 36→37

任一 spec 落地后 CI 校验会红，且 `rule-templates.ts` 与 `.claude/rules/godot-mcp-core.md` drift 静默放过。

**修复**：两份 spec §改动清单必须新增：
- `src/tools/rule-templates.ts`：工具数 36→41/37
- `.claude/rules/godot-mcp-core.md`：同步（独立副本）
- `README.md` / `README.en.md` / `manifest.json` 等 9 文件 17 处工具数
- `npm run build-matrix`：重建 capability-matrix

#### B-2（P0-6）：§3 分层表 + §4 TOOL_NAMES enum 漏列 `editor` 工具

**证据**：`docs/capability-matrix.json:1404` 有 `editor` 工具；P0-6 §3 三层表任一层都没 editor；§4 TOOL_NAMES 数组逐项数 = 35（缺 editor）。

**修复**：把 `editor` 加入 P0-6 §3 分层表（建议 P0 核心层）+ §4 enum + §5"37 个单工具文档" + §6"任意 37 个工具"。

### 其他重要发现

- **P0-5 R-fail**：`runtime_screenshot_diff` 标 readOnly **不准确**。该工具调用 `sendToBridge('take_screenshot', { path: 'user://mcp_assert_screenshot.png' })`，会写磁盘文件。建议拆分：纯查询类标 readOnly；截图类标 non-readonly 或描述中说明"会写临时文件"
- **P0-5 N-1**：§2 称 `runtime_assert_screen_text` 用"OCR"是过度声明。实测 `find_ui_elements` 用 Godot match 语法匹配节点 name/type，**不是 OCR**（无图像文字识别）
- **P0-5 行号略不精确**：spec 说"workflow.ts:135-160 和 :434-560"，实际是 135-164 和 434-653
- **P0-5 §4 改动清单写"src/core/tool-registry.ts 修改"**，但实测 tool-registry.ts 无工具清单，且 TOOL_GROUPS 无 'runtime' 组（runtime 工具归在 core 组）
- **P0-6 §6 验收 5"LLM 调用错误率不上升"无具体测试集**：实测 e2e 测试只验工具可发现，不验 agent 选工具准确率

### 值得进 memory 的工程教训

1. **"spec §改动面清单本身要核查完整性"模式复现**：再次命中 AGENTS.md:302 记录的 2026-07-27 get_node_layout PR 教训——审查者必须独立 grep 仓库级约束，不能信 spec §改动清单
2. **`find_ui_elements` ≠ OCR 的认知偏差**：spec 作者把 Godot 的节点 name/text 匹配误当成 OCR
3. **`readOnly` 标注要区分"不改场景状态"和"完全不写盘"**：截图类工具虽不改场景树，但会写 PNG 到 user://。建议 tool-registry 的 RiskLevel 体系加 'write-temp' 中间档

---

## 第四部分：跨 spec 共性问题

### 共性 1：spec §改动清单系统性遗漏仓库级约束（6/6 spec 命中）

| Spec | 漏列项 | AGENTS.md 依据 |
|------|--------|---------------|
| P0-1 | `build-matrix` / `diff-matrix` 回归 | §5（工具清单变化可能导致 matrix 漂移） |
| P0-2 | `test/regression/defects.ts` 检测器同步 | 回归检测器是隐性依赖 |
| P0-3 | `build-matrix` 重建、`rule-templates.ts` 同步 | §5 + 独立副本同步约束 |
| P0-4 | `check:gdscript` 硬门禁 | §6（2026-08-01 教训） |
| P0-5 | `build-matrix` + `check-tool-count.mjs` 17 处 + `rule-templates.ts` | §5 + 独立副本 + 分发产物边界 |
| P0-6 | 同 P0-5 | 同 P0-5 |

**根因**：spec 作者只列了直接修改的源文件，漏了 AGENTS.md 强制的下游同步链。这正是 AGENTS.md:302 记录的 2026-07-27 教训的**第三次复现**。

**建议**：在 spec 模板加"仓库级约束检查清单"必填项，列出 `build-matrix` / `check:gdscript` / `check-tool-count.mjs` / `rule-templates.ts` 同步 / `version-sync` 五项，每项标"触发/不触发/待评估"。

### 共性 2：spec 声称的数字必须实测验证（4/6 spec 有数字误差）

| Spec | spec 声称 | 实测值 |
|------|----------|--------|
| P0-1 | 56 处 import / 51 文件 | 55 处 / 53 文件 |
| P0-3 | TOOL_GROUPS 22 组 | 20 组 |
| P0-4 | ui=25/particle=16/animation=15 | ui=14/particle=5/animation=7 |
| P0-5 | workflow.ts:135-160 / :434-560 | 135-164 / 434-653 |

**建议**：spec 落盘前所有 file:line + 数字必须 `grep -c` / `node -e` 验证（AGENTS.md「行为准则」§5 + 「快照护栏」）。

### 共性 3：竞品方案移植前未核查 enhanced 实际入口（P0-3 最严重）

P0-3 直接照搬 breakpoint 的 `server.registerTool` monkey-patch，但 enhanced 用 `module-loader.ts` 动态注册，根本没有这个入口。

**建议**：移植竞品方案前，先 `grep <核心 API> src/` 确认入口存在。

---

## 第五部分：修订优先级与下一步

### 必须重新设计的 spec（1 份）

**P0-3 能力组**：
- 核心机制从"工具级 gate"改为"action 级 gate"（B-1）
- 删除 `server.registerTool` monkey-patch，改为 `getFilteredTools` 或 `executeToolCall` 层（B-2）
- 重新审视 DROPPED 分组（补 android/selfupdate/cpp 审视）
- 评估与现有 profile 硬隔离的关系

### 需要"做减法"的 spec（1 份）

**P0-4 UndoRedoManager**：
- 删除 sync_commands.gd 接入项（B-5，无 mutation）
- 删除 recording_commands.gd 接入项（B-6，editor 禁用）
- 重新 grep 生成 handler 接入度表格（数字虚高 2-3 倍）
- 补 `check:gdscript` 到验收（B-4）

### 需要"做加法"的 spec（4 份）

**P0-1 / P0-2 / P0-5 / P0-6**：
- 补仓库级约束检查清单（共性 1）
- 修正数字误差（共性 2）
- P0-1 修正 zod 描述（enhanced 零 zod 用法）
- P0-5 修正 readOnly 标注（截图类写盘）+ OCR 过度声明
- P0-6 补 editor 工具到 enum（B-2）

### 修订后流程

1. 逐份修订 spec（按上述优先级）
2. 修订后重新派 code-reviewer 复审（只审 Blocking 是否解决）
3. 复审通过后开工

---

## 审查者签名

- 审查代理 1（P0-1 + P0-2）：SHIPPED WITH NITS
- 审查代理 2（P0-3 + P0-4）：BLOCKING ISSUES
- 审查代理 3（P0-5 + P0-6）：BLOCKING ISSUES

所有声明经 grep / read / Glob 独立实测验证，证据置信度 ≥ 90%。

---

## 第六部分：复审结论（2026-08-05 修订后）

修订后重新派 3 个 code-reviewer 子代理复审，**只审 Blocking 是否解决**。

### 复审总表

| Spec 组 | 复审判定 | Blocking 解决 | 剩余 |
|---------|---------|--------------|------|
| P0-1 + P0-2 | **ALL CLEAR** | 4 Important + zod 修正全 RESOLVED | 1 个开工期悬留（middleware.ts 2026-era 路径，已披露） |
| P0-3 + P0-4 | **ALL CLEAR** | 6 Blocking 全 RESOLVED | 1 Nits（rule-templates 同步语气略弱，不阻塞） |
| P0-5 + P0-6 | **RESOLVED WITH NITS** | 2 Blocking 全 RESOLVED | 2 Nits（help enum 含自身落地注意、dbg_ 工具名核对，不阻塞） |

### P0-1 + P0-2 复审：ALL CLEAR

| Issue | 状态 | 证据 |
|-------|------|------|
| I-1 era 检测字段路径 | RESOLVED | §3.3 callout 加"字段路径待校准"+ 默认 era=2025 安全含义 |
| I-2 漏列 middleware.ts | RESOLVED | §4.4 新增，行号 114/170/178 实测精确命中 |
| I-3 漏列 defects.ts | RESOLVED | §4.5 新增，defects.ts:127 正则实测一致 + 双路径升级方案 |
| I-4 测试文件不存在 | RESOLVED | §6.2 修正指向 ToolDispatcher.test.ts T11/T20 系列 |
| zod 修正 | RESOLVED | §4.3/§7/§9 全面修正为"零 zod 用法"，grep 实测 0 命中 |

### P0-3 + P0-4 复审：ALL CLEAR

| Blocking | 状态 | 证据 |
|----------|------|------|
| B-1 gate 粒度错配 | RESOLVED | 核心机制改为 action 级 gate（executeToolCall 拦截 args.action），runtime.ts:81-83 实测确认 action 粒度 |
| B-2 入口不存在 | RESOLVED | 删除 server.registerTool monkey-patch，改用 ToolDispatcher.ts:226 executeToolCall（实测真实存在 + :228-235 isToolAllowed 先例） |
| B-3 漏 build-matrix | RESOLVED | §5 改动清单 + §6 验收 7 补 build-matrix |
| B-4 漏 check:gdscript | RESOLVED | §6 验收 6 补 check:gdscript + 2026-08-01 教训说明 |
| B-5 sync 误判 | RESOLVED | 全面删除 sync 接入项，grep 实测 sync_commands.gd 0 个 mutation |
| B-6 recording 误判 | RESOLVED | 全面删除 recording 接入项，实测 :23/:92/:117 三处 editor 禁用 |

**额外验证**：handler 接入度表格数字（ui=14/animation=7/particle=5）grep 实测**完全匹配**；over-blocking 验证（runtime.record_start 仍可调用）已补入验收。

### P0-5 + P0-6 复审：RESOLVED WITH NITS

| Blocking | 状态 | 证据 |
|----------|------|------|
| B-1 漏列工具数下游同步 | RESOLVED | P0-5 §4.2 + P0-6 §5.2 补全 build-matrix/rule-templates/README 等 9 文件 17 处 |
| B-2 漏 editor 工具 | RESOLVED | P0-6 §3 分层表 + §4 enum + §6 验收全部补 editor（实测 capability-matrix.json:1404） |

**额外验证**：readOnly 标注修正（截图类改 non-readonly）、OCR 过度声明修正（去掉"/ OCR"）、依赖关系修正（P0-6 不阻塞 P0-5 但需回填 enum）——全部 RESOLVED。

### 最终结论

**所有 12 个 Blocking 全部解决，6 份 spec 可进入开工阶段。**

剩余 Nits 均为开工期细节（如 middleware.ts 2026-era 路径待 P0-1 完成后确认、help enum 落地时含自身、dbg_ 工具名跨项目核对），不阻塞 spec 实施。

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-05 | 初版，基于 3 个 code-reviewer 子代理并行审查 |
| 2026-08-05 | 追加第六部分：修订后复审结论（3 个 code-reviewer 复审，12 Blocking 全解决） |
