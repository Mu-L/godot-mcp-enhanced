# 评分层(Scoring)

把多维质量指标聚合成单一 `coverage/score.json`,作为 PR gate / dashboard / 发版的单一事实源。

## 6 维模型

| 维度 | 权重 | 数据源 | 硬否决 |
|---|---|---|---|
| integration | 0.30 | test/e2e-full(M2) | < 80 |
| coverage | 0.20 | coverage/lcov.info | — |
| security | 0.20 | npm audit/AgentShield(M1.5) | < 60 |
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
