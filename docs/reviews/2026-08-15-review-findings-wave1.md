# 第一波（批 A–G）全分支终审报告

**日期**：2026-08-15
**审查对象**：分支 `fix/review-findings-batch-20260814`，范围 `592dc60..36994a0`（25 commits：P0×1 + P1×10 + P2×12 + 小修若干，2026-08-14 六批次审查 findings 第一波修复）
**审查者**：独立 whole-branch reviewer（隔离视角，不预设各批 task review 结论为真，全部声明 git/grep/npm 实测复核）
**审查定位**：三个逐批审查覆盖不到的维度——①跨批次交互一致性 ②仓库级约束独立核查 ③Minor 清单 triage。每批实现细节以各自 task review 为准（`.superpowers/sdd/batch20260814/task-{A..G}-report.md`）。

---

## 总体判定

**SHIPPED WITH NITS**（Blocking 0 / Nit 3 + 新登记待办 10 + 接受不改 8）

七批修复本身无行为级缺陷：三个跨批次交互面（editor/bridge 重连、mcp_bridge.gd 三批次段边界、dispatcher 沙箱×审计顺序）实测全部干净；仓库级硬约束（rules 独立副本、capability-matrix 幂等、build/scripts 同步）全过；门禁九项亲跑全绿。三处 Nit 全是文档/流程层（生成产物 drift、CHANGELOG 空登记、L2 闭环验证缺失），其中两处**必须在批 K 发版前处理**、一处**必须进批 K 发版门禁**，详见下文"必须在批 K 前处理的事项"。

---

## 0. 执行门禁（全部亲跑，2026-08-15）

| 门禁 | 命令 | 实测输出 |
|------|------|---------|
| Lint | `npm run lint` | exit 0（eslint src/ 零输出） |
| Build | `npm run build` | exit 0（tsc strict 零错误 + .gd 拷贝完成） |
| 全量测试 | `npm test` | **354 files passed / 5 skipped；5282 tests passed / 30 skipped / 0 failed**（104.29s） |
| GDScript 完整编译 | `npm run check:gdscript`（GODOT_PATH=Godot_v4.6.3） | **errors=0 warnings=0** |
| token 预算 | `npm run check:budget` | `2 warning(s), 0 error — 通过`（2 warning 为既有 desc 长度基线，非本波引入） |
| 工具归组 | `npm run check:tool-groups` | `✓ 全部 41 个注册工具已归组(39 grouped + 6 always-allowed)` |
| 契约 | `npm run check:contract` | `✓ 全部合规（0 error, 5 warning）` |
| matrix 幂等 | `npm run build-matrix` + `git status docs/capability-matrix.*` | 生成后 git status **干净**（幂等，产物已同步提交） |
| 覆盖率 | `npm run test:coverage` | exit 0（CI 阈值 statements60/branches51/functions69/lines61 全过，不满足会非零退出） |

---

## 维度一：跨批次交互一致性 — ✅ 通过（4 个交互面实测全部干净）

### 1.1 批 A（editor 重连状态机）× 批 G（bridge 订阅重发）——无交叉污染 ✅

两批都动了"重连"概念但分属 editor WebSocket 链与 bridge TCP 链，grep 实测：

- `grep -n "EditorConnection" src/tools/game-bridge.ts` → **零命中**（G 不依赖 A 的任何状态机）。
- `grep -n "game-bridge\|_resendSubscriptions\|keepalive" src/core/EditorConnection.ts src/core/EditorConnectionManager.ts` → EditorConnection.ts 零命中；EditorConnectionManager.ts 仅 2 处**注释**（`:68`/`:128`，"对齐 game-bridge `_connectionLock` 模式"）——设计模式借鉴，非代码耦合。
- 批 A 触及文件全集（`git show --stat 7a11d2e c42c06c`）：`src/core/EditorConnection.ts`、`src/core/EditorConnectionManager.ts` + 3 测试文件——与批 G 触及的 `src/tools/game-bridge.ts`/`src/GodotServer.ts`/`src/core/overrides.ts` **零文件交集**。

**概念互补链闭环验证**（G-1 keepalive × GD 侧 idle 断线 × D 段 `_cleanup_peer_state`）：

- GD 侧 `src/scripts/mcp_bridge.gd:177`：`if p.get_available_bytes() > 0:` ——收到**任何**数据行（含 TS keepalive 的 `ping` 请求，dispatch `:740-741` → `_cmd_ping`）都刷新 `_peer_last_activity`，故 TS 的 30s keepalive（`src/tools/game-bridge.ts:141 _startKeepalive`）确实阻断 `:171` 的 INACTIVITY_TIMEOUT(60s) 断线——G-1 的设计前提成立。
- 若仍断线：D 段 `_cleanup_peer_state`（`:202` erase 活动表等）清理 GD 侧状态 → TS 侧 G-1 重连（新 peer id）→ `_resendSubscriptions`（`game-bridge.ts:117`，接线点 `:327`）恢复订阅。三批改动在 peer 生命周期上各管一段，无语义重叠。

### 1.2 mcp_bridge.gd 三批次段边界（B deny-list / D playtest+control / E set_node_property）——函数级干净 ✅

`git log --oneline 592dc60..36994a0 -- src/scripts/mcp_bridge.gd` = 7 commits（B×1 / D×4 / E×2）。逐 commit hunk 头（`git show <c> -- src/scripts/mcp_bridge.gd | grep '^@@'`）实测：

| 批 | commit | hunk 区间（改动前→后行号） | 落点函数 |
|----|--------|---------------------------|---------|
| B | b7aaf52 | @@ -98,10 +98,14 | 常量区（EXTRA_METHODS_BLOCKLIST） |
| B | b7aaf52 | @@ -1055,7 +1059,13 | `_cmd_call_method` |
| D | 72d8ffb/d323aea | @@ -67,6 / -289,7 / -806,9 / -1818,7 / -1974,6 / -1982,6 / -2003,7 / -2037,7 / -2078,6 | 全局变量 / `_process` / `_handle_message` / `_cleanup_peer_state` / playtest 函数群 |
| D | be5bdb0/fd82f64 | @@ -2103,6 / -2178,8 / -2152,7 | `_cmd_playtest_restore` / `_cmd_control_step_until` / `_cmd_control_unfreeze` |
| E | 0bf53a0/71fb911 | @@ -1042,13 +1042,112 / @@ -1046,12 / @@ -1080,6 | `_cmd_set_node_property`（+新增 `_get_property_type`/`_coerce_math_value`/`_math_comp`） |

**注意点（已排除冲突）**：B 的 hunk（1055-1072）与 E 的 hunk（1042-1160）**物理行号区间数值交叠**，但 git hunk 头的函数名上下文锚定证实二者分别落在 `_cmd_call_method` 与 `_cmd_set_node_property` 两个不同函数（E 后落，行号基于 B 改后文件正确偏移）——函数级边界干净，无互相踩踏。

**段间语义交互点已显式管理**：`_cmd_call_method` args 侧的 `_coerce_bridge_single` 对 Vector2/3 **接受** String 构造 vs `_cmd_set_node_property` 属性侧**拒绝** String 输入——这是 E fix round 1 Nit① 在 DUPLICATE 注释中显式声明的有意不对称（args 转换语义 vs 属性 set 语义），已注释互指防维护混淆。核对无误。

### 1.3 scene/ 目录多批次（B × F）+ script.ts 导出——分文件零重叠 ✅

- 批 B（7d967eb）：`src/tools/scene/index.ts`（quick_scene 扫沙箱，`scanScriptSandboxOrThrow` 调用点 :289 附近）。
- 批 F（e590b64 + 7d40fc0）：`src/tools/scene/scene-commit-tool.ts` + `src/tools/scene/scene-commit.ts`。
- **不同文件零重叠**；`src/tools/script.ts` 仅批 B 动（export `scanScriptSandboxOrThrow`，函数体零改动）。三旁路调用点 grep 复核：`scene/index.ts:20`（import）+ `batch-tools.ts` + `code-templates.ts:841`，与 B 报告声明一致。
- `test/godot-server.test.js` 双批共存（C-1 lite 清单 +audit @4cdc0ef :358 附近 / G-2 close 用例 @2fe4eeb :69/:87/:220 附近）——hunk 无重叠，全量测试绿证实共存无冲突。

### 1.4 批 C audit middleware × 批 B 沙箱接线——dispatcher 执行顺序语义正确 ✅（附 1 Nit）

这是三维度中唯一需要**语义正确性推演**（而非只查文件边界）的交互：**沙箱拒绝时 audit 是否仍落盘？**

代码链四级确认（全部实测）：

1. **after hooks 恒执行**：`src/core/middleware.ts:61-72` Phase 3 注释明示 "After hooks (always run)"——before 拒绝（:36-41）或工具 throw（:52-58 catch 转 errorResult）后，audit after 仍被调用。
2. **沙箱拒绝产生 isError result**：`scanScriptSandboxOrThrow`（`src/tools/script.ts:79`）返回 `ToolResult | null`（不 throw，名字有误导性）；拒绝走 `opsErrorResult('SANDBOX_VIOLATION', ...)` → `errorResult`（`src/core/shared/errors.ts:41-47`）置 `isError: true`。
3. **audit after 读 isError 通道**：`src/core/ToolDispatcher.ts:547` `const isError = result.isError === true || this.checkJsonSuccessFalse(result)` → 落盘 `ok: !isError`（`:556`）。
4. **token-request 豁免不误吞**：`:542 isTokenRequestResult(result)` 只拦 confirm 令牌请求响应形态，SANDBOX_VIOLATION 不受影响。

**结论**：沙箱拒绝（含批 B 三旁路 quick_scene/create_files/apply_template 与第 4 写入面 create_project）的写尝试都会被审计为 `ok:false` 落盘——既不漏盘也不虚假 `ok:true`，语义正确。被拒写尝试留审计痕迹正是 G3 审计的设计意图。

**Nit-3（新发现）**：此交互无用例直接锁定——批 C 的 9 场景（`test/core/ToolDispatcher-audit.test.ts`）未含"沙箱拒绝 → 落盘 ok:false"场景，语义目前纯靠结构保证。建议批 H（测试补强）补 1 用例（成本约 10 行）。

### 1.5 附带核对：批 D 移交项闭环

批 D 报告移交批 G 的 `game-bridge.ts` 工具描述漂移（`wall_budget_ms 1000-60000`）已在 G-3（8e6d598）修复并同步 schema 描述 `1000-50000`；GD 侧 clamp（D-5 `mcp_bridge.gd:2315` 注释自指）与 TS 侧 `wall_budget+5s` 超时（G-3）协同后 TS 永不先于 GD 到期——跨波移交链闭环，无悬空。

---

## 维度二：仓库级约束独立核查 — ⚠️ 2 处发版前须补，其余全过

> 按 AGENTS.md「plan 落地后必出第三方审查文档」要求独立 grep 仓库级约束涉及文件，不只对照 plan §改动面清单。

### 2.1 `.claude/rules/` 与 `src/tools/rule-templates.ts` 独立副本 — ✅ 未触及

`git diff 592dc60..36994a0 --stat -- .claude/rules src/tools/rule-templates.ts` → **空**。本波无规则文件改动，不触发同步 + version bump 义务。（对照教训：2026-07-27 get_node_layout PR 正是在此约束上翻车，本波干净。）

### 2.2 capability-matrix 同步幂等 — ✅

`npm run build-matrix` → `41 tools (v0.28.3)`，跑后 `git status --porcelain docs/capability-matrix.json docs/capability-matrix.md` **干净**——批 G 的 36994a0 重建到位，产物与源零 drift。C-1 的 audit `safe→danger-api` 降级（组级聚合，保守加严）已在批 C 审查裁决，本审复核无异议。

### 2.3 `src/scripts/*.gd` → `build/scripts/` 拷贝同步 — ✅

`npm run build` 后逐文件 diff：`mcp_bridge.gd`、`godot_operations.gd` 均 **IDENTICAL**，目录文件数 6=6。

### 2.4 `docs/tools/*.md` 生成产物 — ❌ Nit-1（发版前必须补，本审已实测证实并恢复现场）

计划 Global Constraints 明文要求改工具描述须跑**三件套**：`build-matrix` + **`gen:tool-docs`** + `check:budget`。批 C/G 各自跑了 build-matrix + check:budget，**均漏 `gen:tool-docs`**。本审亲跑 `npm run gen:tool-docs` 产生 **3 文件 drift**（`git diff --stat` = 4 insertions/4 deletions）：

| 文件 | drift 内容 | 来源批 |
|------|-----------|--------|
| `docs/tools/audit.md:8` | 安全级别 `safe` → `danger-api` | C-1（audit 入 core 组的组级聚合连带） |
| `docs/tools/game.md:41` | `autoload/MCPOVERRIDE_<basename>` → `MCPOVERRIDE_<basename> autoload` | G-5 |
| `docs/tools/game.md:43` | `wall_budget_ms ... 1000-60000` → `1000-50000` | G-3 |
| `docs/tools/godot_advanced_tool.md:5` | proxyable 清单去掉 `audit` | C-1（audit 入 protected core 组后不可再 proxy——**当前文档错误声称 audit 可 proxy**） |

性质：纯文档产物 drift，无运行时行为影响；但违反计划三件套明文约束，且 `godot_advanced_tool.md` 与 `game.md` 是用户可见参考文档、内容已失真。**处置：本审跑生成命令证实 drift 后已 `git checkout` 恢复原状（保持工作区干净），修复动作留批 K 前执行（跑一次 `npm run gen:tool-docs` + commit 即可）。**

### 2.5 CHANGELOG [Unreleased] 登记 — ❌ Nit-2（计划内延后到 K-3，但点名清单必须补全）

`git diff 592dc60..36994a0 --stat -- CHANGELOG.md` → **空**。当前 [Unreleased] 段全部是 2026-08-11 审查批（A1-A7/B1-B5/C 系）内容，与本波 25 commits 无关。

**定性**：计划 K-3 明确"CHANGELOG 归档：按批 A–J 逐条登记"安排在批 K，属**计划内延后而非违规**。但两点必须在 K-3 执行时补全：

1. 计划 K-3 文本未点名 **autoload 键迁移**（G-5）——这是用户可感知的 breaking 类变更：≤0.23.x 旧代码安装的 bridge 在 project.godot 写的是带 `autoload/` 前缀的坏键（Godot 节点名冲突），用户需**重跑 `game_bridge_install` / `install_override` 自愈迁移**。发版 notes 必须给出迁移说明，不能只混在"逐条登记"里。
2. K-3 执行时按批 A–G 用户可见修复点名：P0 重连链死、audit 归组可见性（isToolAllowed 恒 false）、write_script 沙箱三旁路 + create_project 第 4 写入面、deny-list 拼写错误、playtest 控制层 6 项、属性 coerce 三路 no-op 假成功、scene-commit 假成功、订阅断线恢复 + keepalive、close() 清理链、autoload 键迁移。

### 2.6 测试覆盖率下滑风险 — ✅ 无

- `npm run test:coverage` exit 0（CI 阈值全过；vitest 阈值不满足会非零退出）。
- 新增量对比（`git diff --numstat` 聚合）：**src +780 −106 / test +2617 −41**，测试:源码 ≈ 3.4:1。
- 新增 0 skip（30 skipped / 5 skipped files 全为既有平台条件 skip，批 B 报告声明且本审全量跑数与批 G 报告一致：5282/5312）。

---

## 维度三：Minor 清单 triage — 逐条处置

来源：`.superpowers/sdd/progress.md:819-827`（"review-findings-batch-20260814" 段各批 Minor 留档）+ 各批报告遗留/concerns 段。

### A. 必须在批 K（或发版）前处理（3 项）

| # | 事项 | 理由 |
|---|------|------|
| **K-前-1** | 跑 `npm run gen:tool-docs` 补 3 文件 drift 并 commit（= Nit-1） | 计划三件套漏项；用户可见文档失真（audit 可 proxy 错误声明 / 旧描述值） |
| **K-前-2** | CHANGELOG [Unreleased] 登记（K-3 执行）+ **autoload 键迁移显式点名与迁移说明**（= Nit-2） | breaking 类用户需知；计划 K-3 未点名该项，存在漏登风险 |
| **K-前-3** | **e2e L2 恢复验证必须进批 K 发版门禁**（K-4 扩展） | G-4 修复了 autoload 预检键名误报（疑致 L2 suite 静默 skip 的根因），但 G 报告自承"本批未跑 L2 e2e 验证其恢复"。修复的**闭环验证**缺失——若 L2 仍 skip，G-4 只是被推理为修好。批 K 发版门禁除 `verify_delivery` 外必须真跑 L2（`GODOT_MCP_E2E_L2=1` + 真游戏进程），确认 L2 用例实际执行而非静默 skip。**评估结论：是，必须进批 K**（否则第一波最大的"疑似修复但未闭环"项带病发版） |

### B. 登记待办留后续（10 项）

| # | 来源 | 事项 |
|---|------|------|
| D-1 | 批 B concerns-1 | cmp-9 固定窗口脆弱模式（2600→3200 仅调宽；重构为"下一顶层 func 为界"的 extractFunc 式，`test/gd-secret-symlink-guard.test.ts` 有现成实现） |
| D-2 | 批 B concerns-自审-5 | script.ts ↔ code-templates.ts 循环 import（ESM 函数声明提升下运行时安全；上移 shared/ 低优） |
| D-3 | 批 B fix-1 concern-2 | project_name 换行未转义注入 project.godot config/name（配置污染非 RCE；台账已 P3 新登记） |
| D-4 | 批 D 遗留-6 | snapshot 他人持有 owner 时不拒绝仅登记（peer B 可覆盖 A 快照；后续加同款互斥） |
| D-5 | 批 D Nit-A 备注 | `_cleanup_peer_state` 还原段与 unfreeze 场景 (b) 对称的理论窗口（窗口极窄；与 D-4 同批收紧） |
| D-6 | 批 D 遗留-4/5 | D-2 断线还原 + D-4 recording 链路无运行时实测（editor-e2e 观察项；建议随批 K 发版 e2e 门禁一并观察） |
| D-7 | 批 E fix-1 | coerce 三路后续两项：in 语义对 null static var 的实测 + 三路 prop_type==-1 行为对齐评估（台账已 P3 登记） |
| D-8 | 批 G 留档 | max_events 满自动断开后重连复活语义（GD 侧自动断 vs TS 侧重发策略需明确） |
| D-9 | 批 G 留档 | keepalive timer 常驻空转（订阅表空 + 无请求时仍 30s ping；评估空闲停 ping） |
| D-10 | 本审 Nit-3 | audit × sandbox 交互无用例锁定（沙箱拒绝落盘 ok:false 场景；批 H 测试补强可选加 1 用例，约 10 行） |

### C. 接受不改（8 项）

| # | 来源 | 事项 | 接受理由 |
|---|------|------|---------|
| A-1 | 批 A Minor | open 成功但 auth 失败路径不清 timer | `reconnectEnabled=false` 挡住，无实际影响（批内审查已推演）；后续若重构 reconnectEnabled 语义需复查 |
| A-2 | 批 A 遗留-2 | manage_tools(reconnect) 在 backoff 窗口内首次调用仍失败一次 | 已知用户体验权衡（比"永远死"大幅改善），报告已声明 |
| C-1 | 批 C Minor | audit 工具 file URL 手写构造 | 低优，无功能影响 |
| C-2 | 批 C Minor | check-tool-groups 依赖 build 产物 | CI 顺序已保证（build 先于 check），本审实测通过 |
| E-1 | 批 E 遗留-1 | headless edit_node 负例 exit=0（quit(1) 不生效） | 既有怪癖非本波引入；错误信息本身正确输出 |
| F-1 | 批 F 裁决 | scene-commit.ts save=false 分支 `"success": true` 保留 | 审查已裁决有意保留；7d40fc0 success 驱动已覆盖全部真失败路径（含 stopOnError corner） |
| F-2 | 批 F concern-2 | commit 无 existsSync 前置检查 | 保持 GD load 报错语义，避免改错误码 |
| G-1 | 批 G 留档 | autoload 检测/删除空格不对称 | 触发面极窄（需手写非标准 project.godot 格式） |

**批 F 报告 concern-1(b) 技术勘误确认**：F 报告称理由 (b)"改为 not _has_error"有技术错误（`_has_error` 恒 true）——本审核实该勘误留档正确，`7d40fc0` 采用的 `success === false` 驱动是正确实现，后人不应按 (b) 原文照做无效修复。

---

## Blocking Issues

**无。**（三处 Nit 均为文档/流程层，无行为缺陷；两处已在"必须在批 K 前处理"中给出明确修复动作与责任批次。）

## Nits

1. **Nit-1（=K-前-1）**：`docs/tools/{audit,game,godot_advanced_tool}.md` 生成产物 drift（批 C/G 漏跑 `gen:tool-docs`，违反计划三件套）。修复 = 跑一次生成命令 + commit。证据：本审 `npm run gen:tool-docs` 实测 3 文件 diff 后恢复现场。
2. **Nit-2（=K-前-2）**：CHANGELOG [Unreleased] 对本波 25 commits 零登记（计划内 K-3 延后，可接受），但 K-3 点名清单缺 autoload 键迁移的显式条目与迁移说明。
3. **Nit-3（=待办 D-10）**：沙箱拒绝 → audit 落盘 ok:false 的交互无用例锁定（语义由 middleware always-run 结构保证，本审代码链四级确认，但缺回归锁）。

## 值得进 memory 的教训

1. **生成产物三件套漏一即 drift**：`build-matrix` 幂等 ≠ 全产物同步，`gen:tool-docs` 是独立产物且 `check:budget` 不校验它——批 C 改组归属、批 G 改描述都触发了 tool-docs 重生成，但两批都只跑了"自己知道的二件套"。教训：凡触及工具 schema/description/组归属，三件套应作为单一原子清单执行（或给 gen:tool-docs 加进 check:contract 类门禁）。
2. **函数级 hunk 边界核对法**：多批次改同一大 .gd 文件时，`git show <c> -- <file> | grep '^@@'` 的 hunk 头函数名上下文是判断段边界的权威证据——比行号区间数值是否交叠更可靠（本审 B/E hunk 物理区间 1042-1160 数值交叠但函数级干净）。
3. **audit after-middleware 的 always-run 语义是审计完整性的结构保证**（`middleware.ts:61-72` Phase 3 + `:52-58` throw 兜底）：任何拒绝路径（before 拒绝 / 工具 throw / opsErrorResult）都不丢审计——后续往 dispatcher 加新拒绝门（如新沙箱检查）无需再单独考虑审计落盘。

---

## 附：审查方法与证据可复现性

- 全部行号引用为 2026-08-15 HEAD（36994a0）`grep -n` / `git show @@` 实测。
- 全部 git 断言（diff 空/hunk 区间/幂等）可直接以文中命令复跑。
- 本审唯一的写操作：跑 `npm run build` / `build-matrix` / `gen:tool-docs`（证实 drift 后 `git checkout -- docs/tools/` 恢复），最终 `git status` 干净 + 本报告文件。
