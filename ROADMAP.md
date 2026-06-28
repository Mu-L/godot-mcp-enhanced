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

主题:**让赛道看见我们**。文档与运营工作。**最大劣势是声量(实测 59★ vs 龙头 Coding-Solo 4431★,1/75)——龙头仅 13 工具,靠分发(2025 初先发 + Topics SEO + 被 best-of-mcp-servers/mcp.directory 收录 + 教程固化)拿赛道 40%+ 星,非功能取胜;故 M1 胜负手是分发,不是功能。** prior session 已完成核心(#1/#2),剩分发矩阵(#10/#11/#13/#14)与 README.en(#12)。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 1 | 补 LICENSE(双版权 MIT) | ✅ | feat/roadmap `640020b`(待合并 master) |
| 2 | README.md 重定位改写 | ✅ | feat/roadmap `640020b`(待合并 master);spec: 2026-06-27-readme-repositioning-design.md |
| 12 | README.en 完整双语重构 | ✅ | 策略A:关键节英译+工具表链接中文(遵循"工具描述中文"策略);去滞后注;对齐 28/安全立句/对比表 |
| 11 | CodeBuddy 端到端接入验证 | 📋 | 验证通过解锁 #10 |
| 10 | 上架 CodeBuddy MCP Market | 📋 | 依赖 #11 验证通过 |
| 13 | 被主要 MCP 目录收录(best-of-mcp-servers / mcp.directory / PulseMCP) | 📋 | 分发战略,06-28 复核结论 |
| 14 | 写「从 Coding-Solo/godot-mcp 升级到 enhanced」迁移指南 | ✅ | docs/migration-from-coding-solo.md + README 入口;蹭龙头流量 |

> #11 → #10 顺序硬约束:验证未通过不上架。#10 上架后,README Hero 兼容列表才可移入 CodeBuddy。

<details><summary>#11 CodeBuddy 端到端接入验证 — 详情</summary>

- **目标**:在 CodeBuddy 内跑通 godot-mcp-enhanced,验证 stdio MCP 接入
- **来源**:战略文档第八节「CodeBuddy = MCP client 可借力分发」
- **验收**:CodeBuddy 配置本项目后,至少 1 个工具(如 read_scene)端到端调用成功;通过后解锁 #10 上架 + README Hero 兼容列表移入
- **依赖**:无(但 #10 上架依赖本项通过)
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

主题:**让 agent 少踩坑**。源码深挖核实(2026-06-28)后,P0 三项里 #4 已实现、#3 误配撤销,仅剩 #5 Bridge 超时分层。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 4 | 错误返回 suggestion 字段 | ✅ | `src/tools/shared/errors.ts:22-42`(opsError/opsErrorResult 的 suggestion 参数;2026-06-28 核实已实现) |
| 5 | Bridge 超时分层诊断 | ✅ | 三元分类(BRIDGE_NOT_CONNECTED/BRIDGE_TIMEOUT/BRIDGE_ERROR)+suggestion;spec: 2026-06-28-bridge-timeout-diagnosis-design.md |

> M2 核实修订(2026-06-28):#4 suggestion 实测已实现;#3 icon 匹配**撤销**——`execute_gdscript` 是 headless 进程不碰编辑器 UI,"看板/select 检测"全仓 0 命中(技术对象误配);#5 timeout **改归 Bridge**(`game-bridge.ts:733-737` 自承「游戏未运行与一般桥接错误同归 BRIDGE_ERROR」,恢复 BRIDGE_NOT_CONNECTED 语义需改 sendToBridge 转译层)。

<details><summary>#5 Bridge 超时分层诊断 — 详情(2026-06-28 改归)</summary>

- **目标**:sendToBridge 转译层区分「连不上(ECONNREFUSED→游戏没跑/没装)」vs「连上但请求超时(游戏卡住)」,恢复 BRIDGE_NOT_CONNECTED 语义
- **来源**:godot-mcp-pro `base_command.gd:345-379`(build_timeout_error 分层诊断);本项目 `game-bridge.ts:733-737` 自承缺口
- **借鉴边界**:竞品「读编辑器 debugger Errors tab 内联 runtime error」本项目做不到(Bridge 是独立 TCP 层,不接编辑器 debugger),仅借鉴「区分未运行 vs 卡住」
- **验收**:Bridge 超时返回区分两类语义 + suggestion;新增两类超时测试
- **依赖**:无
</details>

## M3 — 安全 P1(目标 v0.21)

主题:**守住安全差异化**。独立里程碑强化「安全维度赛道空白」叙事。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 6 | 编辑器打开场景/脚本写入 guard | ✅ | `addons/godot_mcp_server/editor_guards.gd:62,99`(guard_offline_scene_save+guard_text_resource_write,已接入 scene_commands/command_handler;2026-06-28 核实已实现) |

## M4 — 功能补齐 P2(目标 v0.22+,部分 💤)

主题:**补齐竞品已占能力**。核实(2026-06-28)后 #8/#9 已实现,仅 #7 Android 仍 💤。

| # | 行动项 | 状态 | 关联 |
|---|---|---|---|
| 8 | profiling_commands 补齐 | ✅ | `src/tools/profiler-ops.ts`(2026-06-28 核实已实现) |
| 9 | UndoRedo 封装完善 | ✅ | R2 阶段5 已接入 undo_manager(nav/particle/animtree/ui) |
| 7 | Android Deploy | ✅ | list_devices/get_preset_info/deploy;TS child_process+spawnGodot;spec: 2026-06-28-android-deploy-design.md |

## 明确不做什么

- **不拼工具数量**:工具数不是卖点(不跟 godot-mcp-pro 的 175;且 tugcantopaloglu 149 > ours 仍不拼;Coding-Solo 13→4431★ 证用户不按工具数投票);README 对比表诚实列出工具数但不以此竞争,以「免费+开源+安全+三层」差异化
- **不做闭源付费**:坚守免费开源(安全维度赛道真空——tugcantopaloglu 149 / yurineko73 155 工具达标但均无安全设防,本项目独占)
- **不承诺 P2 时间**:M4 三项(Android/profiling/UndoRedo)标 💤 考虑中,非近期承诺

## 路线图变更记录

> 本节只记里程碑/状态变更(📋→🟡→✅ + 日期)。版本功能详见 CHANGELOG.md。

- 2026-06-27 — 初版路线图发布(M1–M4 + 12 行动项);M1 #1/#2 已完成(feat/roadmap `640020b`)
- 2026-06-28 — 06-28 复核校准:M1 扩充分发(#13 目录收录 / #14 迁移指南)+ 明确胜负手=分发;「真空地带」→「安全真空」;README 工具数口径校正(128→28 tool definition)+ tagline 整体重写。依据:竞品文档 §八复核实录
- 2026-06-28 — M1 #14 完成:从 Coding-Solo 升级迁移指南(docs/migration-from-coding-solo.md)+ README 入口;采纳审查 4 gap 修正(零风险→能力零丢失 / FAQ 旧会话需新开 / 验证通俗化 / remove 命令弹性)+ 安全卖点前置
- 2026-06-28 — M1 #12 完成:README.en 完整双语重构(策略A:关键节英译+工具表链接中文,对齐 28/安全立句/对比表);采纳审查 4 写作点(Hero 三要素:安全+closed-loop+fork 继承 / 工具中文声明前置 Hero / capability-matrix 点明 security classification / 入口位置中英一致)
- 2026-06-28 — M2/M3/M4 源码核实校准(依据:竞品 godot-mcp-pro 源码深挖文档逐条对照本项目实测):#4 suggestion / #6 editor guard / #8 profiling 实测已实现→✅;#9 UndoRedo R2 阶段5 已接入→✅;#3 icon 匹配**撤销**(`execute_gdscript` 是 headless 不碰编辑器 UI,对象误配);#5 timeout **改归 Bridge**(原误配 execute_gdscript,对标 `game-bridge.ts:733` 缺口)。仅 #7 Android 仍 💤 成立
- 2026-06-28 — M2 #5 完成:Bridge 超时分层诊断(三元分类 BRIDGE_NOT_CONNECTED/BRIDGE_TIMEOUT/BRIDGE_ERROR + Error 子类 + suggestion;ECONNREFUSED/auth 失败/secret 缺失→NOT_CONNECTED,request timeout→TIMEOUT)。feat/bridge-timeout-diagnosis,2939 tests 绿
- 2026-06-28 — M4 #7 完成:Android Deploy 工具(3 action list_devices/get_preset_info/deploy + INI 解析 + 安全校验 package/deviceSerial/apk 白名单 + spawnGodot timeoutMs 300s;adb shell 协议层注入防护独立于 GUARDED)。feat/android-deploy,2950 tests 绿,capability-matrix 29 tools
- 2026-06-28 — #7 follow-up:check_template action(默认 Android 导出模板校验,major.minor 目录名 4.6.2.stable→4.6)+ detectGodotVersion 共享原语(godot-finder,DRY 复用 isGodotVersionSignature)。get_godot_version refactor 标 backlog。feat/template-check,2956 tests 绿

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
