# Roadmap

> 免费 · 开源 · 安全 · 三层架构 —— 持续深化 Godot MCP 的差异化定位。
> 本路线图是规划意图,非交付承诺;状态随开发推进更新。版本号为目标参考。
> **详细版本变更历史见 [CHANGELOG.md](CHANGELOG.md)**(0.10.0+);早期版本概览见本文件底部「历史里程碑」。

## 状态图例

| 图标 | 含义 |
|---|---|
| ✅ | 已完成 |
| 🟡 | 进行中(spec 就绪 / 实现中 / 部分完成) |
| 📋 | 已规划 |
| 💤 | 考虑中 / 搁置(可 reopen) |

## M1 — 定位与声量(不绑版本,随 ready 发)

主题:**让赛道看见我们**。文档与运营工作。prior session 已完成核心(#1/#2),剩 CodeBuddy 分发(#10/#11)与 README.en 完整重构(#12)。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 1 | 补 LICENSE(双版权 MIT) | ✅ | feat/roadmap `640020b`(待合并 master) |
| 2 | README.md 重定位改写 | ✅ | feat/roadmap `640020b`(待合并 master);spec: 2026-06-27-readme-repositioning-design.md |
| 12 | README.en 完整双语重构 | 🟡 | `640020b` 已加滞后注,完整重构待做 |
| 11 | CodeBuddy 端到端接入验证 | 📋 | 验证通过解锁 #10 |
| 10 | 上架 CodeBuddy MCP Market | 📋 | 依赖 #11 验证通过 |

> #11 → #10 顺序硬约束:验证未通过不上架。#10 上架后,README Hero 兼容列表才可移入 CodeBuddy。

<details><summary>#11 CodeBuddy 端到端接入验证 — 详情</summary>

- **目标**:在 CodeBuddy 内跑通 godot-mcp-enhanced,验证 stdio MCP 接入
- **来源**:战略文档第八节「CodeBuddy = MCP client 可借力分发」
- **验收**:CodeBuddy 配置本项目后,至少 1 个工具(如 read_scene)端到端调用成功;通过后解锁 #10 上架 + README Hero 兼容列表移入
- **依赖**:无(但 #10 上架依赖本项通过)
</details>

## M2 — 健壮性 P0(目标 v0.20)

主题:**让 agent 少踩坑**。源码深挖 P0 三项,直击 execute_gdscript 非确定 + agent 错误自愈。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 4 | 错误返回 suggestion 字段 | 📋 | spec 待写 |
| 3 | icon 匹配确定性 UI 检测 | 📋 | spec 待写 |
| 5 | timeout 分层诊断 | 📋 | spec 待写 |

> M2 三项排序(#4 suggestion → #3 icon → #5 timeout)由 writing-plans 阶段定,依据:成本(#4 最低,先落地见效)→ 健壮性根因(#3 icon 根治非确定)→ 诊断(#5 timeout 分层)。

<details><summary>#3 icon 匹配确定性 UI 检测 — 详情</summary>

- **目标**:execute_gdscript 看板/select 检测从 UI 文本匹配迁到 EditorIcons theme icon 匹配,根治非中文/英文 Godot 编辑器下失效
- **来源**:godot-mcp-pro `base_command.gd:261-290`(issue #34 意大利语「Continua ≠ Continue」教训)
- **验收**:非英文 Godot 编辑器下看板/select 检测稳定;新增 locale 适配测试
- **依赖**:无
</details>

## M3 — 安全 P1(目标 v0.21)

主题:**守住安全差异化**。独立里程碑强化「安全维度赛道空白」叙事。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 6 | 编辑器打开场景/脚本写入 guard | 📋 | spec 待写 |

## M4 — 功能补齐 P2(目标 v0.22+,部分 💤)

主题:**补齐竞品已占能力**。三项均 💤 考虑中,非近期承诺。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 8 | profiling_commands 补齐 | 💤 | — |
| 9 | UndoRedo 封装完善 | 💤 | — |
| 7 | Android Deploy / 导出模板校验 | 💤 | 社区痛点「能装不能跑」([QQ 频道 Godot 社区调研](https://github.com/wgt19861219/godot-mcp-enhanced)) |

## 明确不做什么

- **不拼工具数量**:工具数不是卖点(不跟 godot-mcp-pro 的 175);README 对比表诚实列出工具数但不以此竞争,以「免费+开源+安全+三层」差异化
- **不做闭源付费**:坚守免费开源定位(赛道真空地带)
- **不承诺 P2 时间**:M4 三项(Android/profiling/UndoRedo)标 💤 考虑中,非近期承诺

## 路线图变更记录

> 本节只记里程碑/状态变更(📋→🟡→✅ + 日期)。版本功能详见 CHANGELOG.md。

- 2026-06-27 — 初版路线图发布(M1–M4 + 12 行动项);M1 #1/#2 已完成(feat/roadmap `640020b`)

---

<details><summary>历史里程碑(2026-05 及更早,版本概览)</summary>

> 早期版本(v0.1.0–v0.14.0)概览。CHANGELOG.md 自 v0.10.0 起有详细变更;此处保留 v0.1.0–v0.9.0 / 0.13.0 / 0.14.0 的概览(CHANGELOG 未覆盖,防丢失)。

## v0.14.0(2026-05-24)

7 轴全维度审查修复 + IK 框架 MVP + 测试基础设施升级。

- IK 框架 MVP(4 工具):ik_modifier_create / ik_modifier_get / ik_modifier_set / ik_list_bones
- 7 轴审查:8 CRITICAL + 20 IMPORTANT + 14 ADVISORY 发现,全部 CRITICAL 已修复
- 测试迁移 node:test → Vitest,1257 测试通过,47% 覆盖率;CI/CD GitHub Actions(Node 20/22 矩阵)

## v0.13.0(2026-05-23)

Bridge 安全加固 + 功能增强(C-01~C-03、requestId 取模、EditorConnection 重连上限、CSS Grid 翻译、edit_node camelCase→snake_case、L015 lint 逐行扫描)。

## v0.11.0~v0.11.1(2026-05-22)

安全修复 + CSS Flexbox + Lint 引擎(ui_build_layout、validate_scripts、Bridge TCP 绑定 127.0.0.1、密钥读后即删、符号链接防护、多字节绕过修复)。

## v0.9.0(2026-05-16)

审查反馈 + 架构优化(118 工具,463 测试):批量工具 / UI 工具 / 录制系统(5 工具)/ editor_sync / 确认令牌 / Read-Only 模式 / Lite 模式。

## v0.8.0(2026-05-13)

架构升级(96 工具):双模式架构(Editor WebSocket + GDScript 插件 + UndoManager)/ 测试框架 + 导出管理 / 高级工具集(粒子+导航+AnimationTree)。

## v0.7.0 及更早

| 版本 | 日期 | 要点 |
|------|------|------|
| v0.7.0 | 2026-05-08 | 安全加固:输入转义、超时泄漏、类型安全、crypto.randomUUID |
| v0.6.0 | 2026-05-03 | 音频播放控制(4) + TileMap 编辑(8) |
| v0.5.0 | 2026-05-02 | 信号控制(4) + 物理查询(2) + 3D 创建(1) + 导航寻路(1) |
| v0.4.0 | 2026-05-01 | 版本检测 + validate_scripts + search_and_replace |
| v0.3.0 | — | edit_script + batch_add_nodes + validate_project + import_resources |
| v0.2.0 | — | read_scene + read/write_script + query_scene_tree + MCP Resources |
| v0.1.0 | — | 基础功能:项目/场景/执行控制/截图/API 文档 |

</details>
