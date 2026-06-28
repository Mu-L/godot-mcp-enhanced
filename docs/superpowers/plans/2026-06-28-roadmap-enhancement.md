# ROADMAP 增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 06-28 竞品复核结论回灌 `ROADMAP.md`(M1 分发扩充 + 真空→安全真空) + 校正 `README.md`(工具数口径 128→28 tool definition + tagline/对比表改以安全差异化立句)。

**Architecture:** 纯文档增强,2 文件(`ROADMAP.md` + `README.md`),不动代码。每任务一次 commit,验收用 grep 机器校验 + 人眼复查。对应 spec:`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-28-roadmap-enhancement-design.md`(r2)。

**Tech Stack:** Markdown(Obsidian callouts / GitHub 表格);grep 验收;git。

## Global Constraints

- **不动代码**:`git diff --stat` 仅 `README.md` + `ROADMAP.md`
- **工具数口径 = MCP tool definition(28)**,权威源 `docs/capability-matrix.md`(已确认 total=28),不用 action 清单(128)
- **真空表述校准为"安全真空"**(全赛道零安全设防),删除裸"赛道真空地带"
- **不动 M3 表述**(第60行已正确);不改对比表竞品列(godot-mcp-pro/GDAI/Coding-Solo 四列)
- 分支 `docs/roadmap-enhancement-2026-06-28`,本地 commit **不 push**
- 中文;绝对路径引用;同文件多 Edit 必须串行(GateGuard)
- 编辑 `.md` 用 Claude 内置 Edit 工具(精确字符串替换),不要用 MCP edit_script(那是 `.gd` 专用)

## File Structure

- Modify: `D:\GitHub\godot-mcp-enhanced\ROADMAP.md`(Task 1,A1-A5)
- Modify: `D:\GitHub\godot-mcp-enhanced\README.md`(Task 2 定位立句 B1/B2;Task 3 工具数口径 B3)
- Reference(不改): `D:\GitHub\godot-mcp-enhanced\docs\capability-matrix.md`(工具数权威源,total=28)
- Spec: `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-28-roadmap-enhancement-design.md`

---

### Task 1: ROADMAP.md — M1 分发扩充 + 表述校准(A1-A5)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\ROADMAP.md`(第16-26行 M1 区 / 第30-36行 details / 第76-80行 明确不做什么 / 第82-86行 变更记录)

**Interfaces:** 无(独立文档任务,不依赖其他 task)

- [ ] **Step 1: A1 — M1 主题说明追加分发战略依据**

Edit `ROADMAP.md`,old → new:

```
old:
主题:**让赛道看见我们**。文档与运营工作。prior session 已完成核心(#1/#2),剩 CodeBuddy 分发(#10/#11)与 README.en 完整重构(#12)。

new:
主题:**让赛道看见我们**。文档与运营工作。**最大劣势是声量(实测 59★ vs 龙头 Coding-Solo 4431★,1/75)——龙头仅 13 工具,靠分发(2025 初先发 + Topics SEO + 被 best-of-mcp-servers/mcp.directory 收录 + 教程固化)拿赛道 40%+ 星,非功能取胜;故 M1 胜负手是分发,不是功能。** prior session 已完成核心(#1/#2),剩分发矩阵(#10/#11/#13/#14)与 README.en(#12)。
```

- [ ] **Step 2: A2 — M1 行动项表新增 #13/#14**

Edit `ROADMAP.md`,在 `#10` 行后插入两行。old → new:

```
old:
| 10 | 上架 CodeBuddy MCP Market | 📋 | 依赖 #11 验证通过 |

new:
| 10 | 上架 CodeBuddy MCP Market | 📋 | 依赖 #11 验证通过 |
| 13 | 被主要 MCP 目录收录(best-of-mcp-servers / mcp.directory / PulseMCP) | 📋 | 分发战略,06-28 复核结论 |
| 14 | 写「从 Coding-Solo/godot-mcp 升级到 enhanced」迁移指南 | 📋 | 蹭龙头流量;详见竞品文档 §八复核实录 |
```

- [ ] **Step 3: A3 — 新增 #13/#14 详情折叠块**

Edit `ROADMAP.md`,在 #11 details 块结尾 `</details>` 与 `## M2` 之间插入。old → new:

```
old:
</details>

## M2 — 健壮性 P0(目标 v0.20)

new:
</details>

<details><summary>#13 被主要 MCP 目录收录 — 详情</summary>

- **目标**:被 best-of-mcp-servers / mcp.directory / PulseMCP 等主要 MCP 目录收录(流量入口)
- **来源**:06-28 复核——龙头 Coding-Solo 4.4k★ 主因即被这些目录收录 + 教程固化
- **验收**:至少 1 个目录收录本项目(提交 PR 被合并)
- **依赖**:无
</details>

<details><summary>#14 从 Coding-Solo 升级迁移指南 — 详情</summary>

- **目标**:写一篇「从 Coding-Solo/godot-mcp 升级到 enhanced」迁移指南(蹭龙头搜索流量)
- **来源**:06-28 复核——龙头靠社区教程固化心智,迁移指南是切入龙头用户群的杠杆
- **验收**:指南发布(README 链接 / 博客 / GitHub Discussion),覆盖安装切换 + 工具对应
- **依赖**:无
</details>

## M2 — 健壮性 P0(目标 v0.20)
```

- [ ] **Step 4: A4a — 「不拼工具数量」补依据(括号内追加,后半句保留)**

Edit `ROADMAP.md`。old → new:

```
old:
- **不拼工具数量**:工具数不是卖点(不跟 godot-mcp-pro 的 175);README 对比表诚实列出工具数但不以此竞争,以「免费+开源+安全+三层」差异化

new:
- **不拼工具数量**:工具数不是卖点(不跟 godot-mcp-pro 的 175;且 tugcantopaloglu 149 > ours 仍不拼;Coding-Solo 13→4431★ 证用户不按工具数投票);README 对比表诚实列出工具数但不以此竞争,以「免费+开源+安全+三层」差异化
```

- [ ] **Step 5: A4b — 「不做闭源付费」真空表述校准**

Edit `ROADMAP.md`。old → new:

```
old:
- **不做闭源付费**:坚守免费开源定位(赛道真空地带)

new:
- **不做闭源付费**:坚守免费开源(安全维度赛道真空——tugcantopaloglu 149 / yurineko73 155 工具达标但均无安全设防,本项目独占)
```

- [ ] **Step 6: A5 — 路线图变更记录加 06-28 条目**

Edit `ROADMAP.md`,在 `2026-06-27` 条目后追加。old → new:

```
old:
- 2026-06-27 — 初版路线图发布(M1–M4 + 12 行动项);M1 #1/#2 已完成(feat/roadmap `640020b`)

new:
- 2026-06-27 — 初版路线图发布(M1–M4 + 12 行动项);M1 #1/#2 已完成(feat/roadmap `640020b`)
- 2026-06-28 — 06-28 复核校准:M1 扩充分发(#13 目录收录 / #14 迁移指南)+ 明确胜负手=分发;「真空地带」→「安全真空」;README 工具数口径校正(128→28 tool definition)+ tagline 整体重写。依据:竞品文档 §八复核实录
```

- [ ] **Step 7: 验证 M3 不动 + 无裸"赛道真空地带"**

Run: `grep -n "赛道真空地带" "D:/GitHub/godot-mcp-enhanced/ROADMAP.md"`
Expected: 命中 0(校准后只剩"安全维度赛道真空",无"地带")

人眼复查 `ROADMAP.md` 第58-60行 M3 区(## M3 — 安全 P1 ... 守住安全差异化 / 安全维度赛道空白)**无变更**。

- [ ] **Step 8: Commit**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" add ROADMAP.md
git -C "D:/GitHub/godot-mcp-enhanced" commit -m "docs(roadmap): M1 分发扩充(#13 目录收录/#14 迁移指南) + 胜负手=分发 + 真空→安全真空" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: README.md — 定位立句校正(B1 tagline + B2 对比表说明)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\README.md`(第3-4行 tagline / 第15行 对比表说明)

**Interfaces:** 无

- [ ] **Step 1: B1 — tagline blockquote 整体重写(安全差异化立句)**

Edit `README.md`。old → new:

```
old:
> 免费 · 开源 · 全功能 —— 截至 2026-06-27 调研,Godot MCP 赛道里
> 罕见「免费 + 开源 + 128+ 工具」的方案。

new:
> 免费 · 开源 · 安全 —— 截至 2026-06-28 调研,Godot MCP 赛道里
> 少见提供「系统化安全防护 + 三层架构」的开源方案。
```

- [ ] **Step 2: B2 — 对比表说明改以"安全"立句**

Edit `README.md`。old → new:

```
old:
> 免费的 Coding-Solo 仅 13 个。真正稀缺的是「免费 + 开源 + 全功能 + 安全」的组合。

new:
> 免费的 Coding-Solo 仅 13 个。真正稀缺的不是工具数量,而是「免费 + 开源 + 系统化安全防护」——安全维度在赛道内几乎无人设防。
```

- [ ] **Step 3: 验证 tagline/对比表口径**

Run: `grep -n "罕见" "D:/GitHub/godot-mcp-enhanced/README.md"`
Expected: 命中 0(tagline 已无"罕见")

Run: `grep -n "全功能 + 安全" "D:/GitHub/godot-mcp-enhanced/README.md"`
Expected: 命中 0(原"全功能+安全组合"措辞已替换为安全立句)

- [ ] **Step 4: Commit**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" add README.md
git -C "D:/GitHub/godot-mcp-enhanced" commit -m "docs(readme): tagline + 对比表改以安全差异化立句(B1/B2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: README.md — 工具数口径校正 128→28(B3)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\README.md`(第7行 描述 / 第22行 对比表 / 第92行 工具一览标题)

**Interfaces:** 依赖 `docs/capability-matrix.md`(权威源,total=28,已确认存在)

- [ ] **Step 1: B3a — 第7行描述句改 28 + 链接 matrix**

Edit `README.md`。old → new:

```
old:
工具层:128+ 工具覆盖场景/脚本/UI/动画/物理/粒子/导航/音频/测试/导出,三层架构

new:
工具层:28 个 MCP 工具(merged,每个含多 action;完整清单见 [capability-matrix](docs/capability-matrix.md))覆盖场景/脚本/UI/动画/物理/粒子/导航/音频/测试/导出,三层架构
```

- [ ] **Step 2: B3b — 第22行对比表工具数格改 28 + 链接**

Edit `README.md`。old → new:

```
old:
| 工具数 | 128+ | 175 [^p1] | ~30 [^p1] | 13 [^p1] |

new:
| 工具数 | **28** ([matrix](docs/capability-matrix.md)) | 175 [^p1] | ~30 [^p1] | 13 [^p1] |
```

- [ ] **Step 3: B3c — 第92行工具一览标题去数字 + 加口径说明**

Edit `README.md`。old → new:

```
old:
## 工具一览(128+)

new:
## 工具一览

> 共 28 个 MCP 工具(merged tool definition),以下按 action 逐项展开全部操作;权威清单见 [capability-matrix](docs/capability-matrix.md)。
```

- [ ] **Step 4: 验证工具数口径统一为 28**

Run: `grep -nE "128\+?|130\+?" "D:/GitHub/godot-mcp-enhanced/README.md"`
Expected: 命中 0(changelog 历史版本用的是 124/118/96 等,不含 128/130)

Run: `grep -nE "128" "D:/GitHub/godot-mcp-enhanced/README.md"`
Expected: 命中 0(确认无遗漏的 128 散落处)

- [ ] **Step 5: Commit**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" add README.md
git -C "D:/GitHub/godot-mcp-enhanced" commit -m "docs(readme): 工具数口径校正 128→28 tool definition,链接 capability-matrix(B3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 全量验收

**Files:** 无(只读校验)

**Interfaces:** 汇总 Task 1-3 的 spec 验收标准

- [ ] **Step 1: ROADMAP 验收 grep**

```bash
grep -n "赛道真空地带" "D:/GitHub/godot-mcp-enhanced/ROADMAP.md"     # 期望 0
grep -n "声量" "D:/GitHub/godot-mcp-enhanced/ROADMAP.md"               # 期望 ≥1(M1 主题)
grep -n "#13\|#14" "D:/GitHub/godot-mcp-enhanced/ROADMAP.md"          # 期望 ≥4(表2行+details 2 标题)
grep -n "2026-06-28 — 06-28 复核校准" "D:/GitHub/godot-mcp-enhanced/ROADMAP.md"  # 期望 1
```

- [ ] **Step 2: README 验收 grep**

```bash
grep -n "罕见" "D:/GitHub/godot-mcp-enhanced/README.md"               # 期望 0
grep -nE "128\+?|130\+?" "D:/GitHub/godot-mcp-enhanced/README.md"     # 期望 0
grep -n "capability-matrix" "D:/GitHub/godot-mcp-enhanced/README.md"  # 期望 ≥3(描述/对比表/工具一览)
grep -n "系统化安全防护" "D:/GitHub/godot-mcp-enhanced/README.md"      # 期望 ≥2(tagline+对比表)
```

- [ ] **Step 3: M3 不动 + 纯文档确认**

```bash
git -C "D:/GitHub/godot-mcp-enhanced" diff master -- ROADMAP.md | grep -E "^[-+]" | grep -iE "M3|安全 P1|守住安全"   # 期望 0(M3 行未出现在 diff)
git -C "D:/GitHub/godot-mcp-enhanced" diff master --stat             # 期望仅 ROADMAP.md + README.md
```

- [ ] **Step 4: 人眼终检**

打开 `ROADMAP.md` + `README.md`,确认:tagline 读起来通顺、对比表格式未坏、M1 新增 #13/#14 与现有 #10/#11 编号/状态一致、"明确不做什么"两条校准后语义通顺。

- [ ] **Step 5: 不 commit(验收 task,仅校验)**

如全部通过,本计划完成。若 master push 时机成熟,另经用户确认(`user-prefers-local-ahead-no-push`)。

---

## Self-Review(plan 写完后自查)

- **Spec 覆盖**:A1→Task1Step1、A2→Step2、A3→Step3、A4→Step4+5、A5→Step6、B1→Task2Step1、B2→Step2、B3→Task3Step1-3、验收→Task4。spec 全部 8 条验收标准均有 task 覆盖。✓
- **占位符**:无 TBD/TODO;每个 Edit 给 exact old/new;每个验证给 grep 命令 + 期望。✓
- **类型一致**:工具数全程 28(未混 128/130);"安全真空"/"系统化安全防护"口径在 ROADMAP/README 一致;#13/#14 编号与现有 #10-#12 衔接。✓
- **M3 保护**:Task1Step7 + Task4Step3 双重确认 M3 不动。✓
