# 第三方审查:C-可靠性批次

**审查日期**:2026-08-09
**审查对象**:`feat/sec-batch-p2-1-p2-2` 分支工作树(C-可靠性批次部分,与 C-安全批次同分支)
**审查者**:code-reviewer 子 agent(隔离视角,所有声明 grep/read 实测复核)
**被审查批次**:38 open 待办的 C-可靠性批次(第 3 批)

## 总体判定:**SHIPPED WITH NITS**(0 Blocking + 2 Nit,均已当场修复)

7 项回标依据全部 grep/read 实测复核通过——5 项"已修"回标真实落地,2 项"知情接受"决策有据。唯一代码改动(注释固化)只加注释不改逻辑。

## 批次特点:基线核实优先(第二次验证)

与 C-安全批次一致:**7 项里 5 项已在 2026-08-08 P1/P2 批次落地但待办没回标**,1 项已决策(CR-3),1 项有意设计(只读并发)。若不基线核实直接实现,会重复劳动 5 项 + 改变有意设计 1 项。

| # | 待办 | 核实结果 | 处理 |
|---|------|---------|------|
| 1 | IPC-R7 _in_log finally | ✅ 已修 `mcp_bridge.gd:2032-2044`(与 GD-R2 同源) | 回标 |
| 2 | 半开 HOL 预检 | ✅ 已修 `EditorToolExecutor.ts:16-19/71-79`(B-T3) | 回标 |
| 3 | 全系统扫误杀 | ✅ 已修 `process-state.ts`(--editor 跳过+15s timeout+unref) | 回标 |
| 4 | CR-3 残留 | ✅ 已决策知情接受(`process-state.ts:109-119` 注释) | 回标 |
| 5 | 只读并发 | ⚠️ 有意串行设计,本批加注释固化 | 注释+回标 |
| 6 | IPC-R5 STARTUP_CLEANUP | ✅ 已修 `GodotServer.ts:462-470`(显式 options 消除 env 竞态) | 回标 |
| 7 | guard CI | ⚠️ C6 warn 已存在,豁免理由审查后修正 | 回标(修正论证) |

## 逐项核实关键证据

### IPC-R7 与 GD-R2 同源性(✅ 确认)
- `mcp_bridge.gd:2032` 单条注释同时标记 "GD-R2/IPC-R7"
- `CHANGELOG.md:67` 同一条目
- `defects.ts:1498-1502` detect 名 `error-capture-in-log-no-finally` 注释同时写两者
- `bridge-error-capture-contract.test.ts:84-104` 测试 `CMP-2f-GD-R2` 守护
- 全仓 grep `_in_log` 无第三处遗漏

### IPC-R5 env 竞态真消除(✅ 不只是注释声称)
- grep `GODOT_MCP_FULL_SYSTEM_SCAN` 仅命中注释/docstring(2 处)
- **零 `process.env.GODOT_MCP_FULL_SYSTEM_SCAN` 读取代码**
- 门控改为 `options?.fullSystemScan === true`(`process-state.ts:404`)
- `defects.ts:844-850` detect 守护三特征

## Blocking Issues

**无。**

## Nits(均已当场修复)

### Nit-1: 回标依据行号漂移(已修复)
- **问题**:本批新增 :55-58 注释(4 行)把 EditorToolExecutor.ts 后续行号下移,plan 声称的 `:65-72` 实际落到 `:71-79`
- **修复**:待办里半开 HOL 回标行号更新为实测 `:16-19/71-79` + 加注"以 grep 关键词定位为准"

### Nit-2: C6 warn 豁免论证过时(已修复)
- **问题**:回标写"manage_tools 无 actionRisks",但 reviewer 发现 manage_tools 在 commit `f6c41b1` 已补齐 6 个 actionRisks(`manage-tools.ts:202-209`)
- **真正豁免理由**:inline tool confirm_and_execute 不进 matrix(`ToolDispatcher.ts:110` 注释"不属于任何 ToolModule"),C6 扫不到它故 warn 兜底
- **修复**:待办里 guard CI 回标理由更新为正确论证(含 manage_tools 已补齐 + confirm_and_execute 才是真豁免)

## 值得进 memory 的工程教训(已登记)

1. **基线核实优先模式**(engineering-lesson-baseline-verify-before-implement-pattern):连续两批(C-安全+C-可靠性)验证"待办状态滞后"是高频问题。判定信号:待办日期久 + 子系统近期有大批次修复 + 待办描述与代码注释矛盾。

2. **注释新增致同文件行号漂移**:给 :55-58 加 4 行注释,致 plan 声称的 :65-72 落到 :71-79。审查文档行号必须配 grep 关键词锚点。

3. **回标论证理由要随代码演进更新**:C6 warn 豁免理由引用了"manage_tools 无 actionRisks",但该状态在 `f6c41b1` 已变。回标不仅要核实修复落地,还要核实回标理由里引用的事实是否仍成立。

## 验证清单(实跑输出)

| 命令 | 结果 |
|------|------|
| `npm run lint` | 0 error |
| `npm run build` | tsc 0 error + .gd 拷贝成功 |
| `npm test` | 329 files / 4834 tests passed(零回归,仅注释改动) |
| `grep -c "^- \[ \]" 项目待办.md` | 30 → 23(回标 7 项) |

## 关联

- C-安全批次审查:[[2026-08-09-sec-batch-p2-1-p2-2]](`docs/reviews/2026-08-09-sec-batch-p2-1-p2-2.md`)
- memory:`feature-decision-2026-08-09-reliability-batch` + `engineering-lesson-baseline-verify-before-implement-pattern`
- 开发日志:`Obsidian/GodotMCP/开发日志/2026-08-09 C-可靠性批次.md`
