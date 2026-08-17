# 2026-08-16 QA 编排收尾（qa-closeout）第三方审查报告

> **审查者**:code-reviewer 独立子代理（隔离视角，不预设实现者声明为真）
> **审查对象**:分支 `feat/qa-closeout` commit `480fe77`（feat(qa): nightly 跑批 + 失败自动留录制 + CLI audit 留痕 + NIT-7/8 收口）
> **审查方式**:Read/Grep 静态实测 file:line 证据 + 与 ToolDispatcher/audit-log/capability-matrix/规则文件交叉印证；`.git/HEAD` 与 reflog 核实工作区即 commit 检出状态。限制：审查环境无 Bash，动态命令由 coordinator 侧执行（见「修复后记」验证段）。
> **背景**:v0.30 方向 B（AI QA）收尾——调研报告原定 v0.31 的「nightly diff + 录制集成」+ v0.30 审查 NIT-7/8 遗留。

## 总体判定:SHIPPED WITH NITS(修复后无 Blocking、无 Important 遗留)

四项交付（nightly CLI / record_on_failure / NIT-7 audit / NIT-8 测试补全）设计正确、接线真实、测试有效。审查产出 2 Important + 3 Nit，全部已在审查后处置（见文末「修复后记」）。

## 逐维度结论

### 1. 设计正确性 — 通过(2 个 Important 见后)

- **录制挂钩位置正确**:`runner.ts:227` recording.stop 确在 `:242` stop_project 之前(杀游戏断 bridge 后取不到 events),顺序由测试钉死。全部 5 个 failSetup 调用点(`:146,162,169,175,179`)都在 recording.start(`:184`)之前——早退时 recordStarted 必为 false,不会 stop 未 start 的录制;start 失败仅记 teardown_warnings 降级不中止。
- **SKIPPED>0 也判 FAILED → 纯 budget exhausted 也落录制**:合理——耗尽前的事件流正是排查"为何耗尽"的证据。
- **findPreviousReport 时间序正确**:timestampStem 全数字定长,字典序=时间序,跨日/跨月正确;curIdx 排除当前 run 正确(writeReport 已先落盘)。
- **nightly spec 错误继续后续套件**语义正确;auditRun best-effort 静默与 `audit-log.ts:66` 注释("审计失败应由调用方 catch")一致。
- **audit 字段形态与 dispatcher 一致可比**:字段集同构;trace_id 形态不同但可区分来源(cli-qa-<run_id> vs 16 位 hex);ok 判定用 status==='PASSED' 比 dispatcher 的 isError 更准,是改进非 drift;changed_files 恒空比 dispatcher 的 inferChangedFiles(会把 spec_path 误记)更诚实。

### 2. 测试质量 — 通过(接线真实)

- 删掉 runner.ts 录制落盘逻辑 → recording_path/events 断言必红;顺序断言(order.indexOf)对"stop 移到 stop_project 之后"的顺序 bug 直接红。
- suite_budget 的 Date.now spy 阈值(calls>3)不脆:断言 some(skip_reason)+skipped>=1 不看具体第几步,翻转点有 ±3 次调用余量。
- nightly 测试模拟真实度高:spec 文件真写 tmp 目录、readdirSync 真、head 报告真落盘、diff 用 report.ts 真函数;process.exit mock 改 throw + rejects code 模式正确。
- findPreviousReport 已覆盖跳过当前/跨套件/首次 null/中文 sanitize(碰撞场景审查时未覆盖,修复批已补,见后记)。

### 3. 仓库级约束独立核查 — 6 项全过

| 项 | 结论 |
|---|------|
| capability-matrix 重建 | qa description 与 index.ts 当前版逐字一致;43 tools |
| check:budget | qa desc 773B < 800B warn 线(warn 消除属实;余量仅 27B 见 Nit-3) |
| rules 双副本 | 全规则文件 grep qa 零命中 → 本批无需双副本同步,豁免成立 |
| version bump | check-rules-version-bump 只管 rule-templates.ts,本批未动 → 无需 |
| ESM 惯例 | cli/qa.ts import 全带 .js 扩展名,无 unused |
| NIT-7/8 对应 | v0.30 审查 :85"CLI 直调零 audit——保留,后续增强"与 :41 NIT-8 确对应本批四项 |

## Blocking Issues

无。

## Important Issues(审查产出 → 已修复)

| # | 问题 | 处置 |
|---|------|------|
| Important-1 | CLI auditRun 缺 `isAuditEnabled()` 检查,`GODOT_MCP_AUDIT=false` 被 CLI 路径无视(dispatcher 两写点 :529/:783 均有检查)——用户显式关审计后 nightly 仍向用户项目追加写入,违背配置意图 | ✅ auditRun 开头加 `if (!isAuditEnabled()) return`;测试补开关两向用例(false 零调用/默认每套件一次) |
| Important-2 | findPreviousReport 仅按 sanitize 后缀匹配不校验 JSON 内 suite.name——碰撞套件名('a b' vs 'a_b'、'冒烟'→'_' vs 字面 '_')会拿错基线,diff 混入对方用例,nightly 回归清单静默失真 | ✅ 候选命中后读 JSON 校验 `rep.suite?.name === suiteName`,不等继续往前找,损坏候选跳过;测试补碰撞三断言(不误拿他套件/字面_自查命中/冒烟跨碰撞命中最近同名) |

## Nits

| # | 问题 | 处置 |
|---|------|------|
| Nit-1 | runner.ts:244 stop_project 失败的 teardown_warnings 直接赋值,会覆盖 recording.stop 已记的 warning | ✅ 改 append 模式(同函数其余 4 处一致) |
| Nit-2 | nightly 基线损坏与真首次不可区分(catch 静默后都显示"首次运行,无基线") | ✅ baselineBroken 标志区分输出"基线报告存在但不可读";Important-2 修复后 findPreviousReport 内部已跳过损坏候选继续找,残余窗口(全部候选损坏)极窄 |
| Nit-3 | qa desc 773B 距 800B warn 线仅 27B 余量 | 保留提示:后续扩展 qa description 优先把选项说明移入 schema 字段 description |

## 修复后记(2026-08-16,coordinator 侧)

- Important-1/2 + Nit-1/2 全处置(上表);Nit-3 记录为后续扩展注意事项。
- 修复后验证:`npx vitest run test/qa-report.test.ts test/qa-cli-nightly.test.ts test/qa-runner.test.ts test/qa-index.test.ts test/qa-spec.test.ts` **64 passed**(含修复新增 3 用例:audit 开关两向 + 碰撞三断言);`npx tsc --noEmit` 0 错误;`npm run lint` 0 警告;全量 `npm test` 于修复前实测 5543 passed/0 failed(commit 480fe77 时点),修复面为 CLI/纯函数/测试,qa 五文件局部回归已覆盖。

## 值得进 memory 的工程教训

1. **CLI 直调补 audit 的对称性不止字段形态,还包括开关语义**:dispatcher 路径有的 guard(如 isAuditEnabled),CLI 复刻路径要逐项对照——只对照字段集会漏掉行为开关。
2. **文件名 sanitize 不能做身份匹配**:sanitize 是有损压缩天然引入碰撞;结构化数据里存了原始字段(suite.name)就该用它做二次校验,文件名只做粗筛。
3. **warnings 类累积数组的 append 模式要全函数一致**:一处直接赋值就会在多失败叠加时静默丢前序诊断。
