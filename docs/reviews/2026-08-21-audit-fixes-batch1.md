# 第三方审查报告:审查修复批 1(测试基建)

- **日期**:2026-08-21 | **分支**:`fix/audit-1-test-infra`(4 commits:fa8da37/ca9b6bc/c123b29/5143d30,基于 master 70bf3db)
- **审查者**:code-reviewer 子代理(独立会话,43 次工具调用;抽样 100+ 处替换逐条溯源 boolean 产生式)
- **原始判定**:**SHIPPED WITH NITS**(0 Blocking + 4 Nit)→ 全处置 → **SHIPPED**

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 断言强化正确性 | ✅ | 抽样 100+ 处(gdscript-lint 54/error-analyzer 18/裸标识符 19/复杂表达式 26/误改修正 2/A-neg 残留 2);全部溯源到 boolean 产生式——裸标识符逐个回溯定义签名(verifyOk←addon-version.ts:32/isError←=== true/removed←overrides.ts:161 boolean 返回);error-analyzer 18 处溯至 src/error-analyzer.ts:25 `hasErrors: boolean` 接口字段(TS 编译担保);**未发现非严格 boolean 误改致假红实例**;两处误改修正实测属实(qa-index toHaveProperty/ui-import some() 较原 find() 更强) |
| 未改面完整性 | ✅ | 审查者以同款正则全量 Grep 复测 **732 处/164 文件**,与门禁一致;另实测「一行双弱断言」0 处排除行数口径低估;860−732=128=113+15 自洽;B/C 不动决策与 plan「防恶化非消除」定位一致 |
| gate 正确性 | ✅ | 两 workflow 判据/位置/失败路径静态核对全过——E2E 真红时 gate 按 success() 跳过且 job 已红(职责是抓假绿不重复报真红);报告文件缺失→require throw exit 1 保守正确;字段缺失 ??0→t=0 红;editor-e2e gate 红联动 issue 创建(全 skip 假绿正是需 issue 报警场景);判据字段 `numPendingTests` 修正了 plan 原稿 `r.skipped` 猜测 |
| typecheck:helpers 接线 | ✅ 非假接线 | tsconfig.test.json:7 include 真覆盖;package.json:36 脚本;ci.yml:27-30 步骤在 npm ci 后 build 前(不依赖 build 产物);六工厂 satisfies(mock-results.ts:49/78/108/127/145/169)与接口逐字段对齐;plan 原稿未列 tsconfig/CI 接线,实现自识别假接线缺口补上(必要手段非 scope creep) |
| 仓库级约束 | ✅ | rule-templates/.claude/rules 零触碰(三重间接证据:版本 0.32.8 未 bump+matrix version 一致+CHANGELOG 无模板记录);npm files 不含 test/ 改名零分发影响;旧 .js 已删无双份歧义 |
| 验证完整性 | ⚠️→✅ | 审查会话无 Bash,静态等价复核全过;实跑命令由主会话补跑闭环(见下) |

## 审查后主会话补跑(审查者要求的三条最终门禁)

- `node scripts/check-test-quality.mjs` → **732 ≤ 860** ✅
- `npm run typecheck:helpers` → tsc 零输出(绿)✅
- `npx vitest run test/gdscript-lint.test.js test/error-analyzer.test.js` → **125/125 passed** ✅

## Nits 与处置

| # | 内容 | 处置 |
|---|---|---|
| N-1 | B83+C657=740 vs 实测残留 732 差 8 未对账 | ✅ 口径说明落 plan 执行偏移记录:分类快照是替换前按「预期修法」的划分,与实际消除集合(②类优先)存在 hasErrors 归属交叉(8 处);门禁口径以实测 732 为准,硬指标不受影响 |
| N-2 | plan 主还债面写①守卫式 throw,实现走②布尔强化,偏移未回写 | ✅ plan 补「执行偏移记录」段:②类改动面更小(一行 vs 三行)、零访问前置风险,128 预算超 80 目标即止 |
| N-3 | 消费文件计数三方漂移(plan 22/CHANGELOG 20/实测 19+1) | ✅ 统一口径:grep `mock-results` 命中 22 = 19 消费文件 + 1 自测(mock-results.test.ts) + 工厂自身 + 自测里第二处引用;「20 个消费文件」= 19 消费 + 1 自测 |
| N-4 | G-4 锚定边界未标注(可选字段加/删不红;内联极简对象无锚定) | ✅ CHANGELOG 补「锚定边界(部分解决)」:接口加/删/改**必选**字段才红,可选字段不触发;消费文件内联对象(不走工厂)仍无锚定 |

## 工程教训(登 memory)

1. **口径对齐先于数字采信**——第三方复核 grep 计数前先排除「一行多匹配」的行数/次数口径差(本审查以「双模式同行 grep=0 处」证伪偏差后,732 才与门禁 match().length 口径等价);不排口径差就采信数字是假验证。
2. **toBeTruthy→toBe 机械替换的安全判别法**——被测表达式必须溯到 boolean 产生式(接口 boolean 字段 TS 签名/比较式/some/every/test/===/布尔旗标);裸标识符断言必须回溯定义处签名;2 处误改自愈依赖测试真跑,**skip 块中的断言是机械替换的审查盲区**。
3. **plan 字段名猜测被实测定正**——plan 原稿 gate 判据写 `r.skipped`(jest 格式不存在),实现实测改 `numPendingTests`;「文件名/路径实取不猜」原则应推广到「字段名也不猜」。
