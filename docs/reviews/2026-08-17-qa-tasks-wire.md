# PR-2(MCP Tasks 协议层)最终全分支第三方审查

- **日期**:2026-08-17
- **审查对象**:分支 `feat/qa-tasks-wire`,11 commits(`fdae0ab..22c75a3`,基线 3f423e4)
- **审查者**:独立 code-reviewer 子 agent(隔离视角,全量 diff 19 文件 +1472/-32 + 独立 grep/read 实测)
- **spec**:`docs/plans/2026-08-17-qa-deepening-spec.md` §3 / **plan**:`docs/plans/2026-08-17-qa-deepening-pr2-plan.md`
- **门禁背书**(controller 已跑):npm test 5661 passed/0 failed/35 skipped;lint 0 错;build 通过;diff-matrix no drift;version-check 绿(0.31.4);e2e L2 1 passed

## 总体判定

**SHIPPED WITH NITS**(0 Blocking / 0 Important / 5 Nit 全留档,建议合并)。

T5/T6 controller 直接执行部分经首审通过。spec §3 三组件、§3.3 三风险、§3.4 改动面全对齐,且有两处**优于 spec 原案**的裁定(task-view 位置 tools/qa 防分层倒置;客户端能力协商替代 `_meta` 信令探测——I-9 恒真问题连根消解)。协议安全面(B-3 audit 留痕与 CLI 先例字段级同构/只读三 handler 零内部字段泄漏/wire 校验防线 get+cancel+list 全覆盖)经独立验证成立。

## 逐维度结论(摘要;完整论证见审查执行记录)

1. **跨任务一致性零裂缝**:ttl ms→s 两处换算点双向测试锁定;status 四值词汇全链一致;taskAugmented 传递链(GodotServer→dispatcher→confirm 两轮路径→buildPerCallCtx 仅 ===true 赋值→qa index)完整;显式 mode 优先修复(093301d)真值表五情形全对。
2. **仓库级约束全合规**:task-view 在 tools/qa(core 零新增 tools import);phantom dependency 修复完整(package.json+lock);matrix schemaBytes +13B 源于 mode description 如实反映新缺省行为(实现正确推翻 plan 预测);CHANGELOG/README/版本三件套;tasks/* 是协议 method 非 tool action,不触发 risk-declarations/check-tool-count(43 工具/240 action 不变)。
3. **协议安全面**:tasks/cancel audit 九字段与 CLI auditRun 完全同构(trace_id `tasks-cancel-` 对齐 `cli-qa-` 风格);绕过 confirm 门正当性裁定链完整(启动已过 process 门+取消是收敛操作+审计兜底);toWireTask/toTaskPayload 零内部字段泄漏;4 handler 均走 SDK 3 参 schema 重载(缺参 -32602/handler 抛 -32603)。
4. **spec §3 验收全 ✅**:三组件/三风险(全消解:能力协商替代信令、getClientCapabilities 现成、SDK 默认 2025 era)/改动面;顺手项 M-7(随机后缀+双兼容基线)/M-8(error 透传含兜底文案)落地带测试。
5. **T5/T6 首审通过**:era 版本锁断言失败形态即设计意图(升级提醒闸,与 P1-3 快照先例同构);CHANGELOG/README 口径与交付吻合。
6. **测试质量**:手写 JSON-RPC 客户端三通道纪律(id 匹配/request 分流 -32601/notification 收集)合格;三键共存断言(relatedTask+trace_id+duration_ms)锁 G2 借道路径;删实现必红推演抽 5 全真红。

## Nit(5 条全留档)

| # | 问题 | 处置 |
|---|------|------|
| Nit-1 | CHANGELOG PR-2 条目与 ### Fixed 间缺空行 | 终审后顺手补 |
| Nit-2 | tasks/result 的 {payload} 未过 GetTaskPayloadResultSchema(passthrough,校验意义近零) | 留档 |
| Nit-3 | plan『schema 零改动』预测被实现正确推翻(mode 行为变化必须进 description) | 留档,教训进 memory |
| Nit-4 | 时序断言余量偏紧(80ms/150ms,mock sleep 100/150ms) | 留档观察;CI 偶发红先查此处 |
| Nit-5 | era 断言 2 源码静态 grep 未来重构可能假红 | 留档;假红时改 grep 目标 |

## 值得进 memory 的工程教训(6 条)

1. **SDK 类型层排除已删协议词汇时的通道**:3 参 schema 重载(`setRequestHandler(method, {params: zod}, handler)`)字符串 method 通道可用且自带 params 校验(缺参 SDK 自动 -32602);类型缺口单点 `as never` 隔离并注释归因。
2. **子路径 import 的 phantom dependency**:import 传递依赖子路径(`@modelcontextprotocol/core/internal`)npm hoisting 能解析、pnpm/PnP 会炸——必须同步提升直接依赖(package.json+lock)。
3. **『schema 零改动』预测被行为变化推翻**:默认值行为变化必须进 schema description,否则制造描述性 drift;plan 改动面预测是假设不是承诺。
4. **外部常量依赖的版本锁断言**:依赖 SDK LATEST=2025-11-25 的结论以断言固化,升级时红即复核提醒。
5. **手写 JSON-RPC 测试客户端三通道纪律**:response 按 id 匹配 / server→client request 分流应答 / notification 收集——缺第二通道时 elicitation 用例悬挂而非明确失败。
6. **G2 `_meta` 展开透传借道**:未知键经 `{...result._meta, trace_id}` 展开天然透传——新协议字段借道必须加三键共存集成断言,防未来改白名单式注入静默丢键。

## 修复后记(2026-08-17,Controller 侧)

Nit-1(CHANGELOG 空行)已顺手补;其余 4 Nit 留档。**判定:SHIPPED WITH NITS → 收口。**
