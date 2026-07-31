# 5 份 PR 计划跨计划研究（2026-07-28）

> 本文档是 [`2026-07-28-pr-plans-review.md`](./2026-07-28-pr-plans-review.md)（单计划审查）之上的**跨计划层分析摘要**。
> 完整版（含 Obsidian frontmatter/callouts）：`D:\workspace\Obsidian\GodotMCP\系统文档\跨计划研究-2026-07-28.md`。

## 核对结论

review 的 10 个关键现状判断 **10/10 实测通过**（13 adapter / self_update 工具链 / update-checker 被动 fetch / dashboard 只读 / lint 25 规则 / buildMiddleware / StdioServerTransport / dispatchTool 不查 router / run_tests GUT 封装）。判定完全可信，5 份计划的 BLOCKING 结论成立。

## 现状契合度光谱

| 计划 | 契合度 | 抢救度 |
|------|--------|--------|
| 遥测 | 高 | 改 2 点即进 PR-1（最接近可落地） |
| 测试框架 | 中 | 5 事实修正后稳 |
| 多客户端 session | 中低 | 需补 PR-0 架构前置 |
| 签名自更新 | 低 | 拆分：签名 PR-1/2 先做，自更新重思 |
| 客户端配置 | 极低 | 驳回 greenfield，改增量 |

## 跨计划洞察

1. **两份计划共同误判 dashboard 角色**：签名自更新 + 客户端配置都把 dashboard 当 GUI 宿主，实测它是只读 CLI。5 份计划唯一没统一的架构决策——未来 GUI 触发的配置/自更新须先选路线（A 改造 dashboard 可写 / B 全走 env+MCP 工具）。
2. **多客户端 PR-0 牵动遥测包装点**：两者同在 `ToolDispatcher.dispatchTool → executeMiddleware` 链（`:625` / `:434`），未来需协调 instanceId 透传。
3. **零成本先做项独立于各自 BLOCKING**：签名 PR-1（SHA256 sidecar）、class_name 兼容审计、Zcode/Warp adapter、遥测 PR-1/2/4——可立即抽出并行，不必等整份计划重做。
4. **三份 BLOCKING 同根**：采信过时竞品研究文档。源头文档需加时效标注。

## 推进优先级

- **第一梯队**（立即）：签名 PR-1 / Zcode adapter / 遥测 PR-1+2+4
- **第二梯队**（修正后）：遥测 PR-3+5 / 测试框架
- **第三梯队**（搁置/重构）：多客户端 session / 签名自更新 PR-3+4+5 / 客户端配置 greenfield

## 落地前待决策

1. dashboard 路线（A 改造可写 / B 永远只读）
2. 签名密钥托管（GitHub secret / Sigstore）
3. 遥测后端（PostHog 自托管 / Cloud Run / SaaS）
