---
title: 竞品 followups 批①-④ 第三方审查
date: 2026-07-31
reviewer: code-reviewer (subagent)
branch: feat/competitor-followups
commits: [e650053, 05ef998, e46ead6, 1d2e56a]
verdict: SHIPPED WITH NITS
---

# 竞品 followups 批①-④ 第三方审查

> 独立 code-reviewer subagent 审查。所有声明 grep/read 实测（审查者无 Bash 工具，运行时项由 coordinator 复核）。

## 总体判定：SHIPPED WITH NITS

4 个 commit 核心目标全部达成，**无 Blocking Issue**。批①工具数口径、批②CI 校验脚本、批③进程生命周期、批④GDScript 纯函数测试均与设计声明一致。仓库级约束（独立副本同步、生成产物、禁编辑类别、version bump）独立核查通过。4 处非阻塞 Nit。

## 逐维度结论

### 维度 1：批①工具数口径修正 — PASS
- 权威值基线：`docs/capability-matrix.json` 顶层 tool 对象计数 = 35（Grep 实测）。
- **独立副本同步**（AGENTS.md「独立副本同步约束」）：`src/tools/rule-templates.ts:24` 与 `.claude/rules/godot-mcp-core.md:10` 逐字一致，均为「提供 35 个 MCP 工具（203 个 action...）」。同步性满分。
- 关键文件实测：`docs/distribution/server.json:4` 已改 35；Warp 指南第 170 行原始输出块保留 29 + 第 166 行补注（处理正确，未直接改数字避免与下方工具名列表内部不一致）。
- 残留旧工具数（130+/33/29/28）grep 全部位于历史/过程文档（`.superpowers/sdd/*.diff`、`docs/superpowers/plans/`、`coverage/`），是快照完整性，非遗漏。
- version bump：package.json / manifest.json / plugin.cfg 均为 0.25.1，version-sync 同步。

### 维度 2：批② check-tool-count.mjs — PASS
- 15 条 check 正则静态推演全部命中批①改后文档原文（含全角括号等边界字符）。
- negate 规则正确：manifest 的 `/130\+\s*tools?/` 与 rule-templates 的 `/130\+\s*工具/` 命中即漂移，实测均不命中。
- 独立副本一致性覆盖：RULES 表显式覆盖 `rule-templates.ts` 与 `godot-mcp-core.md` 双校验（含 expect2Key action 数第二捕获组），补 check-rules-version-bump 的内容盲区。
- 单测 6 case 有效（tmpdir fixture 覆盖 readAuthority/全一致/数字不匹配/negate/文件缺失）。
- ci.yml 插入位置正确（token-budget 后、rules-version-bump 前，6 空格缩进）。

### 维度 3：批③进程生命周期 — PASS（安全性重点核查通过）
- **P0 setInterval 挂载**：`GodotServer.ts:362-365`，connect 后挂载，60s 间隔（规避 30s 节流），`unref()` 不阻塞退出。
- **close() clearInterval 位置**：`GodotServer.ts:590-593`，在 kill 逻辑**之前**，防竞争。顺序正确。
- **P1 STARTUP_CLEANUP**：`GodotServer.ts:372-374`，双条件（flag + projectPath），`void` 不 await，默认关。
- **安全性：P0 周期扫描不会误杀合法 Godot**。`process-state.ts:386-392` 第一层只遍历 `_spawnedGodotPids`（本会话注册集），跳过 runningPid，不扫系统全局。第二层全系统扫描需双 env opt-in。
- 实现比 plan 更严谨：plan 写 `ps.getProjectDir()`，实际代码是 `ps.getProjectDir() || undefined`，避免传空字符串。
- 3 个新 P0/P1 测试有效（fake timers + mock process-state）。

### 维度 4：批④ GDScript 纯函数测试 — PASS
- 测试目标（`values_equal`/`parse_vec3`/`has_path_traversal`）确实是纯 Variant 运算，零 EditorInterface 依赖。
- 断言值正确：`str(Vector3(1,2,3))` = `(1.0, 2.0, 3.0)`；`values_equal(true,1)` 走 str fallback → false（语义正确）。
- skipIf 防假绿：无 GODOT_PATH 时 stderr 打印并跳过。
- ci.yml godot-matrix job 已把 `test/gdscript-unit.test.ts` 加进 vitest 参数。

### 维度 5：仓库级约束独立核查 — PASS
- 独立副本同步：rule-templates.ts 与 core.md 一致（维度 1）。
- 生成产物未手改：capability-matrix.json未被改；build/ 未碰。
- 禁编辑类别：未碰 build/、.git/。package-lock.json 因 package.json 加 script 更新属正常。
- version bump 触发：改了 rule-templates.ts 已 bump（0.25.1）。

## Nits（非阻塞）

### Nit-1：action 数措辞不统一（200+ vs 203）
manifest/README.en 用"200+ actions"，rule-templates/core.md/README.md 用精确"203 个 action"。非错误（"200+" 是合理近似，check-tool-count 只对 rule-templates/core.md 校验 action 数），但统一会更专业。

### Nit-2：check-rules-version-bump.mjs 在 CI 单 commit 场景恒过（既有局限）
该脚本用 `git diff HEAD`，CI checkout 后工作区==HEAD，version 校验形同虚设。非本次引入，但意味着"rule-templates 改了必 bump"在 CI 侧无强制力。建议未来改为比对 commit range。

### Nit-3：docs/capability-matrix.json 缺 DO NOT EDIT banner
json 头部无 banner（md 有"自动生成，勿手改"）。建议加 `_meta` 字段（JSON 不支持注释）。非本次范围。

### Nit-4：批③ P1 测试只覆盖"默认关"
未覆盖 `GODOT_MCP_STARTUP_CLEANUP=true` + projectPath 时触发启动清理的主路径。

**coordinator 处理决定**：不强行补。P1 开启测试需 mock `resolveProjectPath`（projectPath 在测试环境难控制，前面尝试过失败）。P1 核心逻辑（flag 读取 + 条件分支）已被"默认关"测试覆盖一半，开启路径由代码 review 确认正确（`GodotServer.ts:372-374` 的 `isFeatureEnabled('STARTUP_CLEANUP') && projectPath` 双条件清晰）。强行补一个脆弱的 mock 测试违反"不过度设计"原则。此 gap 作为已知限制记录。

## 运行时复核项（coordinator 已执行）
1. ✅ `node scripts/check-tool-count.mjs` exit 0（20 处校验通过）
2. ✅ `npx vitest run test/scripts/check-tool-count.test.ts` 6 passed
3. ✅ `npx vitest run test/godot-server.test.js` 24 passed（含 3 个新 P0/P1）
4. ✅ `GODOT_PATH=... npx vitest run test/gdscript-unit.test.ts` 5 passed
5. ✅ `npm run lint && npm run build` 全绿
6. ✅ `npm test` 4288 passed 0 failed
7. ✅ git 层面：4 commit 在 feat/competitor-followups，从 master 开，hash 正确

## 值得进 memory 的工程教训

1. **CI 内容一致性盲区需独立脚本补**：check-rules-version-bump 只校验 version 不校验内容，version-sync 不覆盖 server.json。批②的 check-tool-count.mjs 用 RULES 表显式覆盖独立副本双校验，是填补 CI 盲区的正确范式。
2. **历史文档的工具数不应被"统一"**：批①正确区分"当前产品声明"（必须改）与"历史快照"（保留旧数字是快照完整性）。check-tool-count.mjs 的 RULES 表只覆盖前者。
3. **Warp 指南"保留原始输出块 + 块前补注"模式**：处理"历史实测痕迹 vs 当前数据"冲突的优秀模式，值得作为文档维护惯例。
4. **orphan 扫描的"会话隔离"安全设计**：第一层只扫本会话注册集 + 跳过 runningPid，第二层全系统扫描需显式双 env opt-in。周期性 kill 进程类危险操作的安全范式。

## deferred 项（批⑤，另起独立 session）
- 批⑤a schema 瘦身 pass：收益不紧迫（ui 8921B 离 12KB 阈值剩 3079B）+ 设计摩擦（action→参数映射无现成解，ACTIONS 是 ui 模块私有）。
- 批⑤b McpTestSuite 移植：CI 可行性已确认（`--headless --editor` 无需 Xvfb，godot-ai 实证），工作量 7-13 天，是最大单项。
