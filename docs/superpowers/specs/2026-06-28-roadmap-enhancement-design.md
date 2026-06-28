# ROADMAP 增强设计(2026-06-28)

> **修订 r2(2026-06-28)**:经审查应用 5 处修订(B3 口径校正为 28/capability-matrix 为准 + B1 tagline 整体重写 + A4 引用补全 + B2 改以安全立句 + 非目标声明不动 M3)。决策:B3 用 tool definition 口径(28)非 action 清单(128);B1 整体重写 blockquote。

## 背景

2026-06-27 创建的 ROADMAP.md(M1-M4)其核心论断基于 06-27 竞品调研:"赛道真空地带 = 免费+开源+全功能,本项目唯一占位"。2026-06-28 对竞品文档深入复核(GitHub API + 子代理实测 + 主链交叉核实),**校准了该论断**:

1. **真空地带严格口径已破**:tugcantopaloglu(149 工具/MIT/297★) 与 yurineko73(155 工具/MIT/347★) 均满足"免费+开源+100+工具",本项目不再"唯一占位"。真空上移到「开源+全功能+安全+三层架构+高声量」,且**安全维度全赛道零设防**(本项目独占)。
2. **胜负手是分发,不是功能或真空**:龙头 Coding-Solo 13 工具靠**分发**(2025 初先发 + Topics SEO + 被 best-of-mcp-servers/mcp.directory 收录 + 社区教程固化)拿 4431★(赛道 40%+),非功能取胜。本项目最大结构性劣势是**声量**(实测 59★/6 forks vs 4431★,1/75),不是功能。
3. README 有过时点:**工具数口径混淆**(对外报"128+"实为 action 清单,真实 merged tool definition = 28,权威源 `docs/capability-matrix.md`)、tagline「罕见免费+开源+128+工具」与新结论矛盾。

详见 `D:\workspace\Obsidian\GodotMCP\系统文档\资料-Godot MCP 竞品与赛道分析.md` §八 2026-06-28 深入复核实录。

现版 ROADMAP M1 主题已是"定位与声量",但行动项仅 CodeBuddy(#10/#11)+ README.en(#12),**未覆盖最关键的分发动作**(目录收录 / 迁移指南);"明确不做什么"的"真空地带"表述过时。

## 目标

用 06-28 复核结论**回灌** ROADMAP(不另起炉灶):
- M1 扩充分发行动项 + 点明"分发是胜负手"
- 校准过时表述(真空→安全真空、不拼工具数的新依据)
- README 过时点修正(工具数口径校正、tagline 整体重写)

## 非目标

- 不重组 M4(三项已 💤,重组收益 < 扰动)
- 不新增 M5(M1 本就是声量里程碑,无需拆)
- 不改对比表竞品列(维持 godot-mcp-pro/GDAI/Coding-Solo 四列;数据更新标为可选)
- 不动代码(纯文档增强)
- **不动 M3 表述**:M3(第60行)已用"守住安全差异化 / 安全维度赛道空白"表述,本次 A4 校准的是 M1「明确不做什么」,M3 不改(避免执行者误改已正确处)

## 设计决策

1. **增强而非重写**:ROADMAP 结构(M1-M4 + 明确不做什么 + 变更记录)保留,只回灌新认知
2. **分发定为 M1 胜负手**:主题说明补"声量 1/75 + 龙头靠分发"依据
3. **M1 新增 2 个行动项**:#13 目录收录、#14 迁移指南(最高杠杆分发)
4. **真空表述校准为"安全真空"**:附 tugcantopaloglu/yurineko73 工具达标但无安全设防的依据
5. **README tagline 整体重写**为安全差异化立句(避开"罕见全功能"——已破;不强调工具数)
6. **工具数口径 = tool definition(28)**:非 action 清单(128);权威源 `docs/capability-matrix.md`,与"不拼工具数"叙事自洽

## 实施蓝本

### A. ROADMAP.md

**A1. M1 主题说明**(第16-18行区域)

现:"主题:**让赛道看见我们**。文档与运营工作。prior session 已完成核心(#1/#2),剩 CodeBuddy 分发(#10/#11)与 README.en 完整重构(#12)。"

改为追加分发战略依据:"主题:**让赛道看见我们**。文档与运营工作。**最大劣势是声量(实测 59★ vs 龙头 Coding-Solo 4431★,1/75)——龙头仅 13 工具,靠分发(2025 初先发 + Topics SEO + 被 best-of-mcp-servers/mcp.directory 收录 + 教程固化)拿赛道 40%+ 星,非功能取胜;故 M1 胜负手是分发,不是功能。** prior session 已完成核心(#1/#2),剩分发矩阵(#10/#11/#13/#14)与 README.en(#12)。"

**A2. M1 行动项表新增**(第20-26行表后)

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 13 | 被主要 MCP 目录收录(best-of-mcp-servers / mcp.directory / PulseMCP) | 📋 | 分发战略,06-28 复核结论 |
| 14 | 写「从 Coding-Solo/godot-mcp 升级到 enhanced」迁移指南 | 📋 | 蹭龙头流量;详见 §八复核实录 |

**A3. M1 详情折叠块**新增 #13/#14 的 `<details>`(目标/来源/验收/依赖),与现有 #11 详情块同格式。

**A4. 「明确不做什么」校准**(第76-80行)

- 第一条:现"不做闭源付费:坚守免费开源定位(赛道真空地带)" → 改"不做闭源付费:坚守免费开源(**安全维度**赛道真空——tugcantopaloglu 149 / yurineko73 155 工具达标但均无安全设防,本项目独占)"
- 第二条(在括号内追加依据,后半句保留):现完整原文"**不拼工具数量**:工具数不是卖点(不跟 godot-mcp-pro 的 175);README 对比表诚实列出工具数但不以此竞争,以「免费+开源+安全+三层」差异化" → 在"(不跟 godot-mcp-pro 的 175)"括号内追加"**;且 tugcantopaloglu 149 > yours 仍不拼;Coding-Solo 13→4431★ 证用户不按工具数投票**",分号后"README 对比表...差异化"保留不动

**A5. 路线图变更记录**(第82-86行)新增

"- 2026-06-28 — 06-28 复核校准:M1 扩充分发(#13 目录收录 / #14 迁移指南)+ 明确胜负手=分发;「真空地带」→「安全真空」;README 工具数口径校正(128→28 tool definition)+ tagline 整体重写。依据:竞品文档 §八 复核实录"

### B. README.md

**B1. tagline blockquote 整体重写**(第3-4行)

整体重写两行 blockquote(保留"截至日期 + 赛道"上下文框架,换立句核心):从"罕见全功能"改为**安全差异化**立句,且不强调工具数(与"不拼工具数"叙事一致)。

现:
```
> 免费 · 开源 · 全功能 —— 截至 2026-06-27 调研,Godot MCP 赛道里
> 罕见「免费 + 开源 + 128+ 工具」的方案。
```

方向(候选措辞,plan/review 阶段定稿):保留"截至 2026-06-28 调研,Godot MCP 赛道里"上下文,核心立句改为以**安全**为主轴(如"少见提供系统化安全防护 + 三层架构的开源方案")。tagline 不出现具体工具数(对比表诚实列 28 即可)。

**B2. 对比表上方说明**(第14-16行)

现:"真正稀缺的是「免费 + 开源 + 全功能 + 安全」的组合。" —— **校准**(r1"保留"是疏忽):新结论下"全功能"已不稀缺(tugcantopaloglu 149/yurineko73 155 都全功能),稀缺只由"+安全"撑。改为以**安全**立句,与 A4/M3 口径齐。

方向(候选措辞,plan 阶段定):"真正稀缺的不是工具数量,而是「免费 + 开源 + 系统化安全防护」的组合——安全维度在赛道内几乎无人设防。"

**B3. 工具数口径校正:action 清单(128) → tool definition(28)**

口径决策:用 **MCP tool definition(merged tool)口径 = 28**,不是 action 清单(128)。权威源 = `docs/capability-matrix.md`(`npm run build-matrix` 自动生成,工具总数 28),**不另跑 grep**。理由:与 ROADMAP「不拼工具数、拼安全差异化」叙事自洽——诚实展示 28 反强化定位;28 vs 175(godot-mcp-pro) vs 13(Coding-Solo) 是同口径诚实对比;merged 架构(每 tool 含多 action)的选择代价,不丢人。

改动:
- README 第22行对比表「工具数」格:128 → **28**
- README 工具一览标题「(128+)」→「(28)」
- README 其余 "128+" 散落处 → "28"(以 capability-matrix.md 为准)
- tagline 不强调工具数(见 B1)

**维护策略**:README 写精确 "28"(非"28+"),在对比表/工具一览处链接 `docs/capability-matrix.md` 为权威源;`npm run build-matrix` 发版时自动重生成 matrix,README 数字随之 sync(纳入发版 checklist)。merged tool 数变化慢(v0.18.0 由 39 合并至 27,现 28),精确值过时风险低。

**B4.(可选)对比表竞品数据更新**到 06-28 实测(Coding-Solo 4431★ 等)——标记可选,默认不动(防范围膨胀)。

## 验收标准

- [ ] ROADMAP M1 主题说明含"声量 1/75 + 龙头靠分发"依据
- [ ] ROADMAP M1 行动项表含 #13(目录收录)、#14(迁移指南),状态 📋
- [ ] ROADMAP M1 有 #13/#14 的 details 详情块
- [ ] ROADMAP「明确不做什么」:无裸"赛道真空地带"字样(`grep -n "赛道真空地带" ROADMAP.md` 命中 0);含 tugcantopaloglu/yurineko73 安全依据
- [ ] ROADMAP 路线图变更记录含 2026-06-28 校准条目
- [ ] **M3 表述不动**(`git diff ROADMAP.md` 的 M3 第60行区域无变更)
- [ ] README tagline(第3-4行)整体重写,不含"罕见「免费 + 开源 + 128+ 工具」"原文(`grep -n "罕见" README.md` 命中 0 或仅合理上下文);以安全差异化立句
- [ ] README 工具数统一为 **28**(tool definition 口径):对比表第22行、工具一览标题、散落处;`grep -nE "128\+?|130\+?" README.md` 命中 0
- [ ] README 对比表/工具一览链接 `docs/capability-matrix.md`(权威源)
- [ ] README 第15行对比表说明改为以"安全"立句(与 A4/M3 齐),`grep -n "全功能 + 安全" README.md` 命中 0(原组合措辞已替换)
- [ ] 不改代码(纯文档):`git diff --stat` 仅 README.md + ROADMAP.md(+ 本 spec)

## 交付流程

SDD:本 spec(设计)→ writing-plans(执行步骤)→ 执行(改 ROADMAP.md + README.md)→ 验收。文档增强类,plan 精简。

## 关联

- 依据:`D:\workspace\Obsidian\GodotMCP\系统文档\资料-Godot MCP 竞品与赛道分析.md` §八 2026-06-28 深入复核实录
- 权威工具数源:`D:\GitHub\godot-mcp-enhanced\docs\capability-matrix.md`(`npm run build-matrix` 生成,工具总数 28)
- 上游 spec:`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-27-roadmap-design.md`(ROADMAP 初版设计)
- 关联 spec:`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-27-readme-repositioning-design.md`(README 重定位;其"128+ / 真空地带"口径本次校准)
