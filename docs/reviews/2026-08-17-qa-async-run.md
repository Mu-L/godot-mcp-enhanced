# PR-1b(QA 应用级异步长跑)最终全分支第三方审查

- **审查对象**:分支 `feat/qa-async-run`,9 commits(`604c654..15a5bfe`)
- **审查者**:独立 code-reviewer 子 agent(隔离视角,不预设 plan/台账声明为真,关键声明经 grep/read 实测)
- **spec**:`docs/plans/2026-08-17-qa-deepening-spec.md` §2 / **plan**:`docs/plans/2026-08-17-qa-deepening-pr1b-plan.md`
- **门禁**(controller 已跑):npm test 5633 passed/0 failed/35 skipped;lint 0 错;build 通过;STRICT check:rules-sync 9 模板一致;e2e L2 1 passed;matrix qa descBytes 469/schema 1940/total 2409,check:budget 0 error

## 总体判定

**SHIPPED WITH NITS**(0 Blocking / 0 Important / 2 Nit,均一行修复,已于终审后顺手处置——见文末修复后记)。

异步生命周期全出口覆盖无死锁(正常/取消/writeReport 抛错/意外抛错四路径全部 finishRun)、双分支(sync await 消费/async done 吞错)无 unhandled rejection、taskId=run_id 单一标识与 status 三值映射全链一致、仓库级约束(双副本 238→240 + version 0.31.4 全套 + matrix + actionRisks 五声明)独立核过全落实,spec §2.1-2.6 逐条验收通过。

## 逐维度结论(摘要;完整论证见审查记录)

1. **跨任务一致性 PASS**:registry→runner ctl→index→close 全链实读;进度链(runner onProgress 与 ctx.progress 同点位 → updateProgress → condenseRecord 透出)与取消链(requestCancel → 步骤间轮询 → aborted 复用 SKIPPED → teardown finally 照常)闭环。
2. **仓库级约束 PASS**:双副本两处 238→240 逐字一致;版本 bump 覆盖 package.json/package-lock(两处)/manifest/server.json(两处)/Dockerfile/plugin.cfg/使用指南/matrix 全套 0.31.3→0.31.4;CHANGELOG 0.31.4 段与两批交付一致无夸大(PR-1a 已进 master 未单独发版,一个版本号涵盖两批是正确口径);CLI 零改动(CANCELLED 退出码经既有表达式自然涵盖)。
3. **异步生命周期终判 PASS**:四出口枚举全覆盖;BUSY 死锁防御有专项测试(异常安全用例);close 收尾在 killProcess 前(顺序约束满足);makeRunId 同秒覆盖终评=既有行为,BUSY 门收窄,留档(PR-2 前建议 run_id 加随机后缀)。
4. **spec §2 验收 PASS**:mode 默认 sync 零破坏(sync 响应逐字段一致+测试锁定);async 立即返回(<150ms 断言);CANCELLED 优先于 FAILED(failed:1 且 CANCELLED 用例锁定);findPreviousReport 跳过 CANCELLED(双用例);close 上限 min(60s,ttl) 偏离 spec 原文 suite_budget_ms 有据且更保守。
5. **T7(controller 执行)首审 PASS**:description async 句 469B 达标;CHANGELOG 内容逐条核实;matrix 逐字段与源码一致。Nit:CHANGELOG 曾写中间值 407(已修,见后记)。
6. **测试质量 PASS**:七组关键用例删实现必红推演全部成立;mock 带真实 shape;覆盖面含 async 生命周期/BUSY 双向/cancel 三态/异常安全/sync 回归/e2e node_state 真 shape(12 步)。

## Minor triage(留档,合并后或 PR-2 处置)

| # | 项 | 处置 |
|---|---|---|
| M-2 | 取消用例未断言 teardown 照常 | PR-2 e2e 补真 Godot cancel 收尾断言 |
| M-4 | ctl 回调抛异常边界未测 | 留档(现网实现不可触发) |
| M-5 | ttl 透传 0/负立即超时 | 留档(失败方向安全) |
| M-6 | min 截断测试失败形态慢 | 留档 |
| M-7 | makeRunId 同秒覆盖 | **PR-2 前加 run_id 随机后缀**(timestampStem 前缀保序) |
| M-8 | async failed 时失败原因不可观测(finishRun 不带 error 详情) | **PR-2 时 RunRecord 加 error? 字段并入 condenseRecord** |
| N-2 | `runner.ts` `!aborted` 冗余(上方 continue 已保证) | 留档(防御性) |

## 值得进 memory 的工程教训

1. **后台 promise 异常安全的"兜底先行"模式**:`exec.then(finishRun正常).catch(err => { finishRun('failed'); throw err; })` + `done = exec.then(_,()=>{})` 组合,使 sync/async 两分支同时满足终态必写(不死锁 BUSY)+ 无 unhandled rejection + close settled 判定可靠。可复现:`src/tools/qa/index.ts:183-198`、`src/tools/qa/registry.ts:125-140`。
2. **单 working 互斥无需锁**:JS 单线程 + SDK 同步分发下 registerRun 同步检查天然无竞态;真正要防的是"终态不写死锁"与"同秒 run_id 覆盖"。
3. **多批共用一个发版号时,CHANGELOG 数字快照以最终 matrix 实测为准**(快照护栏的跨批次变体:PR-1a 中间值 407 vs 发版终值 469)。
4. **mock 平铺 shape 盲区再次实证**:assertNodeState 平铺假设在全部单测绿下存活,直到真 bridge e2e 才暴露——L2 真 Godot 用例是 mock 无法替代的 shape 契约验证层。

## 修复后记(2026-08-17,Controller 侧)

终审 2 Nit 已顺手处置(80 passed 回归绿):
- N-1:CHANGELOG "descBytes 773→407" → "773→469"(发版终值);
- M-3:`'cancelled by user'` 提取为 `CANCEL_REASON` 常量(`runner.ts:30`,置值/skip_reason/判定三处统一,防字面量漂移致 CANCELLED 静默降级 FAILED)。

**判定:SHIPPED WITH NITS → 修复后收口。**
