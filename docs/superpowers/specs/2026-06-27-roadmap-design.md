# ROADMAP.md 路线图设计(2026-06-27)

> **r1(2026-06-27)**:经独立 review(`D:\workspace\review\.claude\reviews\2026-06-27-roadmap-design-review.md`)采纳 5 IMPORTANT + 4 ADVISORY。
> **r2(2026-06-27)**:基于真实 git 状态修正——prior session 已在 `feat/roadmap`(commit `640020b`,待合并 master)完成 #1 LICENSE + #2 README 重定位,并为 #12 README.en 加过渡滞后注;原设计误标这三项"未完成"已纠正为真实状态。

## 背景

基于 2026-06-27 两份竞品研究 + README 重定位 spec,沉淀 12 个去重行动项。**prior session 已在 `feat/roadmap` 分支(`640020b`,待合并 master)完成 M1 核心**:#1 LICENSE 双版权 + #2 README.md 重定位(128+ 工具;Hero/对比表/安全/核心能力重写),并为 #12 README.en 加过渡滞后注。

本设计创建项目级 `ROADMAP.md`,作为:
- **对外**:公开路线图(展示方向与活跃度,对冲战略文档指出的"声量不足、不在竞品对比表内"),被 README 链接
- **对内**:spec/plan 体系的**索引层** —— ROADMAP 答 *what & when*,spec 答 *how*,plan 答 *steps*;**索引 prior session 已完成工作 + 规划剩余 M2/M3/M4**

研究来源:
- `D:\workspace\Obsidian\GodotMCP\系统文档\资料-Godot MCP 竞品与赛道分析.md`(战略/赛道层)
- `D:\workspace\Obsidian\GodotMCP\系统文档\资料-godot-mcp-pro 源码深挖.md`(源码实现层)
- `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-27-readme-repositioning-design.md`(README 重定位 r2,在 feat/roadmap 分支)

## 行动项总览(去重 12 项,r2 真实状态)

| # | 行动项 | 来源 | 优先级 | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | 补 LICENSE(双版权) | 战略 | — | ✅ 已完成 | feat/roadmap `640020b`,待合并 master |
| 2 | README.md 重定位改写 | 战略+readme spec | 高 | ✅ 已实现 | feat/roadmap `640020b`(128+;Hero/对比表/安全/核心能力),待合并 |
| 12 | README.en 双语同步 | readme spec | — | 🟡 部分 | `640020b` 加滞后注,完整重构待做 |
| 10 | 上架 CodeBuddy MCP Market | 战略 | — | 📋 已规划 | 依赖 #11 |
| 11 | CodeBuddy 端到端验证 | 战略 | — | 📋 已规划 | 解锁 #10 |
| 3 | icon 匹配确定性 UI 检测 | 源码深挖 | P0 | 📋 已规划 | — |
| 4 | 错误返回 suggestion 字段 | 源码深挖 | P0 | 📋 已规划 | — |
| 5 | timeout 分层诊断 | 源码深挖 | P0 | 📋 已规划 | — |
| 6 | 编辑器打开场景/脚本写入 guard | 源码深挖 | P1 | 📋 已规划 | — |
| 7 | Android Deploy / 导出模板校验 | 战略+源码 | P2 | 💤 考虑中 | 社区痛点「能装不能跑」 |
| 8 | profiling_commands 补齐 | 源码深挖 | P2 | 💤 考虑中 | — |
| 9 | UndoRedo 封装完善 | 源码深挖 | P2 | 💤 考虑中 | — |

## 设计决策(brainstorming 已确认 + review 修正 + r2 真实状态)

1. **文件位置**:`ROADMAP.md` 放项目根(与 README.md 同级),对外公开 + 对内排期双重身份
2. **组织结构**:主题里程碑(M1 定位与声量 → M2 健壮性 P0 → M3 安全 P1 → M4 功能补齐 P2),非版本号/矩阵
3. **版本锚定**(I2 修正):M1 不绑版本(文档/运营工作随 ready 发);M2 目标 v0.20、M3 v0.21、M4 v0.22+。版本号是目标非承诺
4. **职责切分**(I1 修正):ROADMAP 记**路线图变更记录**(里程碑/状态变更+日期);**版本功能**统一归 `CHANGELOG.md`。两者不重叠
5. **单一真相源**(I4 修正):行动项详情 4 字段(目标/来源/验收/依赖),**不含状态**;状态唯一来源 = 里程碑表格的 emoji + 关联列
6. **依赖显式**(I3 修正):#11 验证 → #10 上架 → README Hero 兼容列表移入,顺序反了重蹈 r2 I3「宣称开箱即用 vs 未验证」覆辙
7. **诚实口径**:与 readme r2 一致——版本号标"目标"非承诺、状态真实、💤 标考虑中/搁置、数据断言带日期
8. **状态机**:✅ 已完成 / 🟡 进行中(spec 就绪或实现中或部分完成)/ 📋 已规划 / 💤 考虑中或搁置(可 reopen)(A1 修正)
9. **字段精简**(A2 修正):不加"工作量""目标版本"字段——前者违背诚实口径,后者被里程碑标题隐含
10. **M3 保持独立**(A4):仅 #6 一项但独立——安全是差异化核心,独立里程碑强化叙事
11. **r2 真实状态**:M1 的 #1/#2 已由 prior session 在 feat/roadmap(`640020b`)完成,ROADMAP 索引之并标 ✅;该 commit 待合并 master(合并后状态不变,仅落地主线)

## ROADMAP.md 结构总览

```
# Roadmap
> 主线一句话
> 诚实声明
## 状态图例
## M1 — 定位与声量
## M2 — 健壮性 P0
## M3 — 安全 P1
## M4 — 功能补齐 P2
## 明确不做什么
## 路线图变更记录
```

---

## 各节实施蓝本

### 顶部:主线 + 诚实声明 + 状态图例

```markdown
# Roadmap

> 免费 · 开源 · 安全 · 三层架构 —— 持续深化 Godot MCP 的差异化定位。
> 本路线图是规划意图,非交付承诺;状态随开发推进更新。版本号为目标参考。

## 状态图例

| 图标 | 含义 |
|---|---|
| ✅ | 已完成 |
| 🟡 | 进行中(spec 就绪 / 实现中 / 部分完成) |
| 📋 | 已规划 |
| 💤 | 考虑中 / 搁置(可 reopen) |
```

### M1 — 定位与声量(不绑版本,随 ready 发)

主题:**让赛道看见我们**。文档与运营工作。**prior session 已完成核心(#1/#2),剩 CodeBuddy 分发(#10/#11)与 README.en 完整重构(#12)。**

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 1 | 补 LICENSE(双版权 MIT) | ✅ | feat/roadmap `640020b`(待合并 master) |
| 2 | README.md 重定位改写 | ✅ | feat/roadmap `640020b`(待合并 master);spec: 2026-06-27-readme-repositioning-design.md |
| 12 | README.en 完整双语重构 | 🟡 | `640020b` 已加滞后注,完整重构待做 |
| 11 | CodeBuddy 端到端接入验证 | 📋 | 验证通过解锁 #10 |
| 10 | 上架 CodeBuddy MCP Market | 📋 | 依赖 #11 验证通过 |

> #11 → #10 顺序硬约束(I3):验证未通过不上架。#10 上架后,README Hero 兼容列表才可移入 CodeBuddy。

### M2 — 健壮性 P0(目标 v0.20)

主题:**让 agent 少踩坑**。源码深挖 P0 三项,直击 execute_gdscript 非确定 + agent 错误自愈。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 4 | 错误返回 suggestion 字段 | 📋 | spec 待写 |
| 3 | icon 匹配确定性 UI 检测 | 📋 | spec 待写 |
| 5 | timeout 分层诊断 | 📋 | spec 待写 |

### M3 — 安全 P1(目标 v0.21)

主题:**守住安全差异化**。独立里程碑强化「安全维度赛道空白」叙事。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 6 | 编辑器打开场景/脚本写入 guard | 📋 | spec 待写 |

### M4 — 功能补齐 P2(目标 v0.22+,部分 💤)

主题:**补齐竞品已占能力**。三项均 💤 考虑中,非近期承诺。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 8 | profiling_commands 补齐 | 💤 | — |
| 9 | UndoRedo 封装完善 | 💤 | — |
| 7 | Android Deploy / 导出模板校验 | 💤 | 社区痛点「能装不能跑」 |

### 单条目详情格式(4 字段,折叠)

每个里程碑下,表格给概览,折叠 `<details>` 给细节。**详情不含状态字段**(I4 单一真相源):

```markdown
<details><summary>#3 icon 匹配 — ⚠️ 已撤销(2026-06-28 核实)</summary>

- **撤销原因**:`execute_gdscript` 是 headless 独立进程,不操作编辑器 UI;"看板/select 检测"全仓 0 代码命中(把竞品 editor addon 检测 debugger Continue 按钮的 icon 匹配,错套到 headless execute_gdscript)。已从 ROADMAP.md 撤销;#5 timeout 改归 Bridge(对标 `game-bridge.ts:733` 缺口)
- ~~**目标**(已撤销)~~:execute_gdscript 看板/select 检测从 UI 文本匹配迁到 EditorIcons theme icon 匹配,根治非中文/英文 Godot 编辑器下失效
- **来源**:godot-mcp-pro `base_command.gd:261-290`(issue #34 意大利语「Continua ≠ Continue」教训)
- **验收**:非英文 Godot 编辑器下看板/select 检测稳定;新增 locale 适配测试
- **依赖**:无
</details>
```

```markdown
<details><summary>#11 CodeBuddy 端到端接入验证 — 详情</summary>

- **目标**:在 CodeBuddy 内跑通 godot-mcp-enhanced,验证 stdio MCP 接入
- **来源**:战略文档第八节「CodeBuddy = MCP client 可借力分发」
- **验收**:CodeBuddy 配置本项目后,至少 1 个工具(如 read_scene)端到端调用成功;通过后解锁 #10 上架 + README Hero 兼容列表移入
- **依赖**:无(但 #10 上架依赖本项通过)
</details>
```

### 明确不做什么(A3 措辞协调)

```markdown
## 明确不做什么

- **不拼工具数量**:工具数不是卖点(不跟 godot-mcp-pro 的 175);README 对比表诚实列出工具数但不以此竞争,以「免费+开源+安全+三层」差异化
- **不做闭源付费**:坚守免费开源定位(赛道真空地带)
- **不承诺 P2 时间**:M4 三项(Android/profiling/UndoRedo)标 💤 考虑中,非近期承诺
```

### 路线图变更记录(I1:与 CHANGELOG 职责切分)

```markdown
## 路线图变更记录

> 本节只记里程碑/状态变更(📋→🟡→✅ + 日期)。版本功能详见 CHANGELOG.md。

- 2026-06-27 — 初版路线图发布(M1–M4 + 12 行动项);M1 #1/#2 已完成(feat/roadmap `640020b`)
```

---

## 实施待办(ROADMAP.md 外)

### 合并策略(N1,方案 A —— 单分支闭环)

ROADMAP.md 产物 + README 加 Roadmap 链接 + readme r2 spec 回改,全部归到 `feat/roadmap` 分支,与 README+LICENSE(`640020b`)一次性合并 master。`docs/roadmap`(本 spec)随之合上。无中间态、易回滚。`feat/roadmap` 无并发 session(并发在 recording 分支),归并安全。

实施顺序:
1. 把 `docs/roadmap` 的 ROADMAP spec(`265a612`)合到 `feat/roadmap`(cherry-pick 或 merge)
2. 在 `feat/roadmap` 创建 `D:\GitHub\godot-mcp-enhanced\ROADMAP.md`(照本设计蓝本)
3. 在 `feat/roadmap` 回改 `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-27-readme-repositioning-design.md` 第 7 节收尾,补 `[Roadmap](ROADMAP.md)` 链接(I5)
4. 在 `feat/roadmap` 的 README.md 收尾节加 `[Roadmap](ROADMAP.md)` 链接
5. `feat/roadmap` 合并 master(README 重定位 + LICENSE + ROADMAP.md + spec 回改 单分支闭环落地)

### 其他

- [ ] 上架 CodeBuddy MCP Market(#10,依赖 #11 验证通过)

> N2(M2 三项排序依据)/N3(#7 出处占位)/N4(验收第 1 条「被 README.md 链接」措辞收紧)留 writing-plans 阶段处理(review 建议)

## 不改的部分

- 既有 spec 体系(docs/superpowers/specs/)—— ROADMAP 是其索引层,不替代
- CHANGELOG.md —— 继续记版本功能,与 ROADMAP 路线图变更记录职责分离

## 验收标准

- [ ] 项目根存在 `ROADMAP.md`,被 README.md(或其 spec)链接
- [ ] 4 个主题里程碑(M1–M4)各带主题叙事 + 行动项表格
- [ ] 12 个行动项全部归属到某里程碑(无悬空)
- [ ] **M1 #1/#2 标 ✅(反映 prior session 已完成),#12 标 🟡(部分)**(r2)
- [ ] 单条目详情为 4 字段(目标/来源/验收/依赖),**不含状态字段**(I4)
- [ ] 状态唯一来源 = 表格 emoji;状态图例含 ✅/🟡/📋/💤 四态,💤 含「搁置可 reopen」
- [ ] M1 不绑版本;M2/M3/M4 标「目标 vX.Y」非承诺(I2)
- [ ] #11 → #10 依赖顺序在表格 + 详情双重显式标注(I3)
- [ ] ROADMAP 用「路线图变更记录」节,不与 CHANGELOG 功能重叠(I1)
- [ ] 「不做什么」含「不拼工具数 + 工具数非卖点」口径(A3)
- [ ] 诚实声明在顶部(规划意图非承诺 + 版本号目标参考)
- [ ] 实施待办含「待 feat/roadmap 合并后回改 readme r2 spec 补 Roadmap 链接」(I5/r2)

---

## Review 采纳记录(r1, 2026-06-27)

来源:`D:\workspace\review\.claude\reviews\2026-06-27-roadmap-design-review.md`(IMPORTANT ×5 / ADVISORY ×4,无 CRITICAL)。逐条核实通过,全部采纳。

| ID | 级别 | finding | 核实 | 处理 |
|---|---|---|---|---|
| I1 | IMPORTANT | 更新日志归属 DRY 冲突 | ✅ readme r2 spec 第 110-114 行确有 CHANGELOG 链接 | ROADMAP 改「路线图变更记录」,版本功能归 CHANGELOG |
| I2 | IMPORTANT | M1 文档工作绑 v0.20 拖慢声量 | ✅ 推理成立 | M1 不绑版本,M2 v0.20 |
| I3 | IMPORTANT | #10/#11 依赖顺序未标 | ✅ 与 r2 I3 修正逻辑一致 | #11→#10→Hero,依赖字段显式 |
| I4 | IMPORTANT | 状态字段在详情+表格重复 | ✅ 单一真相源原则 | 详情去状态改 4 字段 |
| I5 | IMPORTANT | 需回改 readme r2 spec 补 Roadmap 链接 | ✅ readme r2 第 108-114 行确无 | 实施待办显式列回改(r2:待 feat/roadmap 合并后) |
| A1 | ADVISORY | 状态机缺撤销/搁置态 | ✅ | 💤 含义扩展含搁置,不加新 emoji |
| A2 | ADVISORY | 建议加工作量/目标版本字段 | ✅ 违背诚实口径+冗余 | 不加(pushing back 加字段建议) |
| A3 | ADVISORY | 「不拼工具数」措辞协调 | ✅ | 补「工具数非卖点,对比表诚实列出但不以此竞争」 |
| A4 | ADVISORY | M3 仅 #6 一项偏细 | ✅ 但安全是差异化核心 | 保持独立,强化叙事 |

## r2 修订记录(2026-06-27)

基于真实 git 状态核对(发现 prior session 已在 feat/roadmap `640020b` 完成 M1 核心):

| 变更 | r1(误) | r2(真实) |
|---|---|---|
| #1 LICENSE | 🟡 spec 就绪 | ✅ 已完成(`640020b`) |
| #2 README 重定位 | 🟡 spec 就绪 | ✅ 已实现(`640020b`,README.md 重写) |
| #12 README.en | 📋 | 🟡 部分(`640020b` 加滞后注,完整重构待做) |
| I5 实施待办 | 直接回改 readme r2 spec | 待 feat/roadmap 合并 master 后回改(该 spec 在 feat/roadmap 分支) |
| ROADMAP 角色 | 规划全部行动项 | 索引 prior 已完成工作 + 规划剩余 M2/M3/M4 |
