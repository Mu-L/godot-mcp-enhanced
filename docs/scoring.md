# 评分层(Scoring)

把多维质量指标聚合成单一 `coverage/score.json`,作为 PR gate / dashboard / 发版的单一事实源。

## 6 维模型

| 维度 | 权重 | 数据源 | 硬否决 |
|---|---|---|---|
| integration | 0.30 | test/e2e-full(vitest json)✅ | < 80 |
| coverage | 0.20 | coverage/lcov.info | — |
| security | 0.20 | npm audit json✅ | < 60 |
| flaky | 0.10 | 重跑矩阵(M3) | — |
| performance | 0.10 | profiler 基准(M3) | — |
| gdscript | 0.10 | GUT(M3) | — |

pass 线 = 75。n/a 维度权重按比例重分配给有值维度。

## 运行

    npm run score

读 `coverage/lcov.info`,写 `coverage/score.json`。

## 架构约束

- `src/scoring/` 根 = 纯函数(可单测),`src/scoring/collectors/` = 有副作用采集器
- meta-test:`test/scoring/aggregate.test.ts` 验证评分系统自身(硬否决、权重重分配、pass 线)
- 新维度接入:实现 `collectors/<name>.ts` 返回 DimensionResult,在 generate-score.ts 用它替换对应 `na()`

## 报告与门禁(M3b)

- `npm run score` 顺带产 `coverage/score-report.md`(人读 markdown:总分/各维表格/硬否决/未验证)
- `npm run score:gate` 读 `coverage/score.json`,未过门禁(`total < 75` 或 `hardFails` 非空)→ exit 1
- CI check job 接入 gate,质量回归阻断 PR 合并
- partial(na 维)不阻断——只进报告,不影响门禁(M3c-e 接入前 3 维 na)

## PR Comment(M3b-PR)

- `npm run score:pr-comment` 读 `coverage/score.json` → 产 `coverage/pr-comment.md`(PR 专用摘要,比 score-report.md 简短)
- CI 用 `marocchino/sticky-pull-comment@v2` 贴到 PR(更新同一条,不堆积)
- gate 失败也贴(`if: always`,展示 fail 原因 + 各维分数,帮 review 定位回归)
- comment 层 `continue-on-error`:与 gate status check 隔离(评论/sticky 失败不拖红 PR)
- 已知 gap:score.json 缺失(score 步骤失败)时不贴评论(根因上游 M1 `continue-on-error`,留后续)
