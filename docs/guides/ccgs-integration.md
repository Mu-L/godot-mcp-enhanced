# CCGS × godot-mcp-enhanced 集成指南

> 给 [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios)(下称 CCGS)用户的实战指南:
> **CCGS 管流程与设计(agents / skills / GDD 体系),godot-mcp-enhanced 管真实运行时(读写 / 跑 / 验证)**——组合成「有手脚的 AI 游戏工作室」。
>
> 本指南适配 CCGS **v1.0.0 现状**(上游最后代码推送 2026-05-21,实测 `gh api repos/Donchitos/Claude-Code-Game-Studios --jq .pushed_at`),
> 只落在本仓库,不依赖也不承诺任何上游改动。

## 1. 为什么互补(实测事实)

| | CCGS | godot-mcp-enhanced |
|---|---|---|
| 定位 | Claude Code 工作室**模板**(49 个 agents + 73 个 skills,实测 `ls .claude/agents/ \| wc -l` / `ls .claude/skills/ \| wc -l`,2026-08-20;24225★ 同日 `gh api` 实测) | Godot **MCP 工具层**(45 个 MCP 工具 / 248 个 action,见 [capability-matrix](../capability-matrix.md)) |
| 强项 | 结构化流程:GDD 8 段标准、阶段 gate、多角色评审、design/production 目录约定 | 三层架构(headless / editor / bridge):AI 真能读、写、跑、验证 Godot 项目 |
| 短板 | **零 MCP 集成**——agents 无法操作真实 Godot;`/playtest-report` 是结构化报告**模板生成器**,不运行游戏(实测全 `.claude/` 目录 grep "mcp" 零命中,2026-08-20) | 无工作室流程层(无角色分工、无 GDD 体系、无阶段管理) |

一句话:**CCGS 有流程没手脚,本工具有手脚没流程**。装上本 MCP 后,CCGS 的 godot-specialist 写完码可以立刻真跑验证,`/gate-check` 的产物检查可以升级成「游戏真的跑通了」。

## 2. 前置条件

1. 一个按 CCGS 模板初始化的项目(有 `design/`、`production/`、`.claude/` 目录);
2. 安装本 MCP(Claude Code 全局):

   ```bash
   claude mcp add -s user godot -- npx -y godot-mcp-enhanced
   ```

3. 本机已装 Godot 4.5–4.7 并设 `GODOT_PATH`(或走 PATH/注册表自动搜索;详见 [README 快速开始](../../README.md#快速开始));
4. 首次对项目运行 `setup_project_rules`(生成 `.claude/settings.json` hook 与项目规则,CCGS 已有自己的 settings.json,用 `hooks=false` 只取规则,或先备份)。

> **注意**:CCGS 与本 MCP 的 `.claude/settings.json` 可能都写 hooks。冲突时保留两者各自条目即可;本 MCP 的 hook 只在编辑 `.gd` 后提醒运行 `validate_scripts`,与 CCGS hooks 职责不重叠。

## 3. 核心工作流:CCGS 写码 → 本工具验证

以「godot-specialist 实现一个系统」为例,在 CCGS 流程的三个关节点插入本工具调用:

```text
/design-review 出 GDD(design/gdd/<system>.md,8 段结构)
        │
        ▼
godot-specialist 按 GDD 写码(Write/Edit 直接落盘)
        │
        ▼  ── 关节点 1:编译与运行验证
run_and_verify            # headless 真跑,结构化错误分析(类型/文件/行号)
validate_scripts          # 每个脚本 load() 完整编译,抓 parse error
        │
        ▼  ── 关节点 2:交互与回归验证
qa run --spec <套件>      # 结构化测试:自动装 bridge → 起游戏 → 断言 → 报告
                          # playtest.seed 锁随机 ⇒ 同 seed 同输入可复现
        │
        ▼  ── 关节点 3:交付门禁(替代纯文件存在性检查)
verify_delivery           # 场景树完整性 + 脚本健康 + 性能 + 自定义断言
```

对应到 CCGS 的阶段 gate:`/gate-check systems-design` 检查「GDD 文件是否写好」,而本工具让 `production` 阶段的 gate 可以问「**游戏跑通了吗**」——`qa run` 的报告与 CLI 退出码(0 = 全 PASSED)可直接作为 gate 判据。

## 4. GDD 互通(大体互通,个别变体注意)

CCGS `design/CLAUDE.md` 要求 GDD 含 **8 个必需段**,与本项目 `validate_gdd` 的 `GDD_REQUIRED_SECTIONS` 逐字同源(两侧实测对照,2026-08-20):

| # | 段落标题(两侧一致) |
|---|---|
| 1 | Overview |
| 2 | Player Fantasy |
| 3 | Detailed Rules |
| 4 | Formulas |
| 5 | Edge Cases |
| 6 | Dependencies |
| 7 | Tuning Knobs |
| 8 | Acceptance Criteria |

**注意**:本校验器按 `^## <段落名>$` **精确匹配**二级标题。CCGS 存量 GDD 中个别文档使用变体标题(如 `## Tuning`、`## Rules`)时会被判 missing——把标题改回上表标准名即可通过,正文内容无需改动。这是「大体互通」而非逐文档保证的原因。

用法:AI 写完 GDD 后让 `validate_gdd` 机械校验 8 段结构,再走 CCGS `/design-review` 做内容评审——机械校验 + AI 评审各司其职。

## 5. 动作对照表(CCGS skill → 本项目工具)

| CCGS skill(流程层) | 本项目工具(执行层) | 说明 |
|---|---|---|
| `/design-review`(AI 评审 GDD) | `validate_gdd` | 机械校验 8 段结构,零幻觉;两者叠加用 |
| `/playtest-report`(生成报告模板) | `qa` 工具 / `npx godot-mcp-enhanced qa run` | **真跑游戏**:结构化步骤 + 8 种断言 + 报告落盘;报告再喂给 `/playtest-report analyze` 做人话整理 |
| `/code-review`(AI 评审代码) | `validate_scripts` + `run_and_verify` | 编译验证 + 运行时错误分析,给 AI 评审提供机器证据 |
| `/gate-check`(检查产物文件存在性) | `verify_delivery` + qa CLI 退出码 | 「文档写了吗」升级为「游戏跑通了吗」 |
| `validate-commit.sh`(CCGS 自带 GDScript lint) | `validate_scripts` 内置 L015 行级扫描 | 双层:行级静态扫描 + `load()` 完整编译 |
| —(CCGS 无对应) | `screenshot`(action `capture`)/ bridge `take_screenshot` | 运行画面截图,进 playtest 报告当证据 |
| —(CCGS 无对应) | `playtest.seed` / `freeze` / `step_until` / `send_input_sequence` | 确定性 playtest(L1–L3,见 README「确定性分级」) |

## 6. 非 Claude Code 客户端

CCGS 本身是 Claude Code 模板;若你的团队用 Cursor / Windsurf / ZCode 等客户端,本 MCP 均可接入(15 个客户端适配,`npx godot-mcp-enhanced configure --list`)。CCGS 的 skills/agents 体系不随行,但第 3 节的验证关节点(`run_and_verify` / `qa` / `verify_delivery`)在任何 MCP 客户端都可用。本仓库打包的 Claude Code skills 可用 `npx godot-mcp-enhanced skills install --target <目录>` 装到项目级,或设 `GODOT_SKILL_LIBRARIES` 环境变量让 `load_skill` 检索你的 skill 库。

## 7. 已知边界

- `validate_gdd` 是**结构**校验(8 段存在 + 段落长度),不是内容质量评审;
- `qa` 需要真实 Godot 运行游戏(截图在 Windows 为窗口模式,Linux/macOS 依赖 GPU 驱动,详见 README 平台说明);
- bridge 工具只连本机运行中的游戏(TCP 127.0.0.1),不适用远程/云端构建;
- 本指南不改 CCGS 任何文件;上游默认分支最后提交 2026-05-13(本地 `git log -1` 实测),全仓最后推送 2026-05-21(`gh api --jq .pushed_at` 实测),此后无活动;后续若上游演进,以两侧实测为准。
