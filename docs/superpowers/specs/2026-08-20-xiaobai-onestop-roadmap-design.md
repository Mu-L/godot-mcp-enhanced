# 「小白无编辑器一条龙」多批路线图设计(2026-08-20)

> 定位:**小白不用打开编辑器完成一条龙游戏开发**。
> 本文是多批实施计划的设计文档(经一轮第三方独立审查后修订,审查记录见 §2)。
> 状态:待用户审阅。每批执行时另开独立会话,批内产出各自的 spec/plan/review 文档。

---

## 1. 背景

- 护城河研究(`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\research\2026-08-20-护城河方向研究.md`)确认:竞品全押生成侧(authoring),无人押验证侧(verification)——「验证管线 + 小白向导」组合无正面竞争者。
- CCGS 源码级调研(2026-08-20,本会话):24k★ 的 Claude Code 工作室模板,**零 MCP 集成、零运行时验证**(全 `.claude/` grep "mcp" 零命中;`/playtest-report` 是纯文档模板生成器)。它的洞恰是本项目形态:他们有流程没手脚,我们有手脚没声量。
- 一条龙旅程差距分析结论:后半段(搭建→验证→导出)已赛道最强;短板在**入口**(小白连 Godot 都没装)、**桥**(可玩模板仅 3 个骨架)、**出口**(做完拿不到可分享的东西)。

## 2. 第三方审查记录(2026-08-20,code-reviewer 子代理)

**判定:BLOCKING ISSUES → 已全部处置,批 4 整批重写。**

### Blocking 处置

| # | 审查发现(实测证据) | 处置 |
|---|---|---|
| B-1 | 「record 帧序列→GIF」地基不成立:`src/tools/recording.ts` 录的是输入事件 JSON(键鼠事件),无任何逐帧截图能力 | 批 4a 重写:帧来源改为**已有** qa screenshot 步骤 + playtest 驱动的低频截图循环(2-5fps 足够 demo GIF),零 GD 侧改动 |
| B-2 | 「export_build(web)+ 复用 instance-http-server」双重不成立:headless 返回 `EDITOR_ONLY`(`src/tools/test-framework.ts:75-77`);editor 侧是 stub(`addons/godot_mcp_server/commands/export_commands.gd:119-123`);`src/core/instance-http-server.ts` 是 POST-only 验签 API 转发器,无静态 serve 能力 | 批 4b 重写:headless CLI 直调 `godot --headless --export-release "<preset>"`(官方支持路径)+ 新写 127.0.0.1 静态服务器;export templates 下载复用批 2 基建 |
| B-3 | 批 2 白名单自动登记缺落点:`GODOT_MCP_ALLOWED_GODOT_PATHS` 只读 env 且未设即放行(`src/core/godot-finder.ts:80-81`) | 采用审查推荐:批 2 含 godot-finder 增加 `~/.godot-mcp/` 机器级配置文件消费点改造(env 优先 → 配置文件 → 签名校验兜底),属安全子系统改动,按 AGENTS.md 同步测试+文档 |

### Nits 处置(已吸收进批次内容)

- undo 计数失准:三方口径 45(护城河报告时点)/ 53(当前生产命令文件)/ 74(全 addons 递归含测试)。落盘统一口径:**生产命令文件 create_action 注册 53 处**(核查:`grep -rc "create_action" D:/GitHub/godot-mcp-series/godot-mcp-enhanced/addons/godot_mcp_server/commands/ | grep -v ":0"` 剔除测试与 undo_manager 自身,2026-08-20 实测 7+4+1+14+5+7+1+3+5+6=53)。
- GDD「直接互通」降为「大体互通」:CCGS 个别文档用 `## Tuning` 变体,本校验器精确匹配 `^## Section$` 会判 missing(`src/tools/game-design.ts:113-114`)。
- 批 3 现有 `ScaffoldTemplate`(string[] 清单,`src/tools/code-templates.ts:357`)装不下四件套,量级计入新模板数据结构设计。
- 调参表措辞:「改 CSV → 重导 .tres → 重启生效」,非热调参(`src/tools/data-import.ts` 链条)。
- skills 分发默认只覆盖 Claude Code(`src/cli/skills.ts`),其他客户端触达方式在指南写明。
- 批 2 若被批准动 `src/core` 安全面:测试+文档同步;批 4b 静态服务器防路径穿越(参考 `src/tools/recording.ts:57-65` sanitize 模式)、默认 127.0.0.1。
- SHA256 哈希来源为执行前必查项(见 §5 未决项)。

### 审查确认的亮点(保留)

批 1 真零依赖;批 2/批 3 可并行;批 5 硬依赖批 2-4;qa seed 确定性支撑就位(`src/tools/qa/runner.ts:164-166`);`~/.godot-mcp/` 机器级目录惯例与下载选址一致;「默认不发版 + CHANGELOG [Unreleased]」与 2026-08-20 例外条款相容;不动工具清单则不触发 matrix/版本硬门禁。

## 3. 批次计划(修订版)

### 批 1 —— C:分发/声量(近零代码,~1 天)

| 项 | 内容 |
|---|---|
| C-1 | CCGS 集成指南 `docs/guides/ccgs-integration.md`:CCGS godot-specialist 写码 → 本项目 `run_and_verify`/`qa` 验证的工作流;GDD「大体互通」说明(8 段逐字同源,个别变体注意);README 挂入口 |
| C-2 | README 小白叙事节:「从一句话到可玩游戏」——**只写已真能做的**(无编辑器读写/验证/qa/playtest/截图);GIF/Web 分享出口标注 roadmap,**不得写成已支持**(约束源于 B-1/B-2 审查发现);顺带落地护城河报告 N1(确定性分级)/N2(Undo 叙事,53 处口径) |
| C-3 | 赞助入口(BMAC/GitHub Sponsors 徽章) |

- ~~对外动作(向 CCGS 上游提 PR/Discussion)单独待用户确认,批内只落自己仓库~~ **已裁决(2026-08-20):不提上游 PR**(上游自 2026-05-13 停滞,见 §5 未决项 2);指南只落自己仓库,面向 CCGS 存量用户群。
- 验证:`grep -n` 核对措辞落位、链接可达、README 渲染通读;基线 `npm run lint`/`build`/`test`。

### 批 2 —— A1:Godot 自动安装 + 通用官方资产下载基建(2-3 天)

目标:小白零预装。扩展点:`src/cli/setup.ts:34-46`(当前 Godot not found 直接 exit 1)。

- **通用下载器**(两种资产:Godot editor 二进制 / export templates):官方 GitHub releases 域名硬编码白名单 → 用户确认(CLI 交互式 prompt,非 MCP elicitInput 链路)→ 下载到 `~/.godot-mcp/godot/<version>/`(机器级目录惯例已在)→ SHA256 校验(失败即删)→ 审计记录(`appendAuditLine` 基建已在)。
- **白名单登记架构改造**(B-3 处置):`src/core/godot-finder.ts` 增加 `~/.godot-mcp/godot-paths.json` 配置文件消费点(env 优先 → 配置文件 → 未设时签名校验兜底维持 back-compat)。属安全子系统改动:**测试+文档同步**(AGENTS.md 要求)。
- 验证:单测(哈希/路径登记/mock 下载/配置文件消费优先级)+ 三项全绿 + Windows 真机手测 doctor;THREAT_MODEL/README 安全面文档更新。

### 批 3 —— A2:可玩模板库第一期(3-5 个,每模板 1-2 天 + 结构设计 0.5 天)

从 2048/贪吃蛇/打砖块/横版跑酷/卡牌对练选 3-5,每模板四件套:

1. **可玩 demo**:场景+脚本+程序化占位美术(色块/几何,零外部资产);
2. **GDD**:8 段,过自家 `validate_gdd` 校验器(自产自销);
3. **qa 套件**:含至少一个确定性 playtest 断言(seed 锁定,支撑已就位);
4. **调参表**:CSV→.tres 表格驱动(「改表→重导→重启生效」)。

- 分发形态:**内置 npm 包**。前置工作:新模板数据结构(现 `ScaffoldTemplate` 只是文件名清单+空脚本骨架,装不下四件套);`package.json` files 字段扩展 + 构建拷贝脚本(类比 .gd 拷贝);模板游戏代码按「读 .tres 参数」设计。
- 不新增 MCP 工具 → 不动 capability-matrix、不触发版本硬门禁、check:budget 不受影响(工具描述不变)。
- 验证:每模板 `verify_delivery` 级验证 + qa 套件全绿(bridge 不需要编辑器,游戏运行态跑)。
- 可与批 2 并行(改动面不相交:doctor/core 安全侧 vs 模板内容)。

### 批 4a —— B1':demo GIF(2-3 天)

- 帧来源:**已有** bridge 截图(`game_query take_screenshot`)+ qa screenshot 步骤,新 CLI 子命令 `gif`(`src/cli/router.ts` 加路由):启动游戏(bridge)→ playtest 驱动(freeze/step/输入时间线)→ 定频截图(2-5fps)→ 收集帧序列。
- GIF 编码:零依赖自写(256 色量化 + LZW,~300-400 行;审查确认 pngjs 只覆盖 PNG 解码一步,量化器须自写)。
- 产物写项目外路径走确认;不动 `addons/**/*.gd`(无 check:gdscript 触发)。
- 验证:GIF 产物可打开、首帧与 bridge 截图像素 diff 通过;单测(编码器往返)+ 三项全绿。

### 批 4b —— B2':Web 试玩闭环(3-5 天,复用批 2 基建)

- **headless CLI 导出**:直调 `godot --headless --export-release "<preset>"`(官方支持路径,绕开 editor stub)。前置:export templates 检测+安装(**复用批 2 下载/哈希/审计基建**,同为官方 releases 资产);`export_presets.cfg` 预置(模板带或工具生成)。
- **本地试玩服务器**:新写静态文件服务器(~100-200 行):127.0.0.1、防路径穿越(参考 `src/tools/recording.ts:57-65` sanitize 模式)、起服务走确认门;serve 导出目录 → 返回 `http://127.0.0.1:<port>` 浏览器可玩。
- 明确不修 editor 侧 export_commands.gd stub(超范围;headless 路线已覆盖小白场景)。
- 验证:bridge 实测 serve 请求 200 + 页面可玩;路径穿越负向测试;三项全绿。

### 批 5 —— wizard 收尾(2-3 天,依赖批 1/2/3/4a/4b)

- `game_wizard` 向导,分发形态:`src/cli/skills.ts` skills 分发(SKILL.md 形态,不新增 MCP 工具);指南写明非 Claude Code 客户端的 `--target`/`GODOT_SKILL_LIBRARIES` 触达方式。
- 结构:借鉴 CCGS `/start` 四档分诊(没想法/模糊/清晰/已有项目)→ 阶段机(想法→选模板→迭代→**qa 门**→导出→分享);gate 用 qa CLI 退出码(0=全 PASSED,`src/cli/qa.ts:69`)替代文件存在检测——「CCGS 问文档写了吗,我们问游戏跑通了吗」。
- 验证:端到端真实走一遍小白旅程(新目录、零 Godot 预装 → 自动安装 → 模板 → 改玩法 → qa → GIF/Web 链接),录屏作 demo 素材(反哺业务线)。

## 4. 业务线(贯穿,不占代码批)

| 时机 | 动作 |
|---|---|
| 批 1 | 赞助入口上线;CCGS 指南作为第一篇引流内容 |
| 批 3-4 间 | 「用 AI 不开编辑器做你的第一个游戏」中文教程/B 站演示(每批产物即素材) |
| 批 5 后 | 视声量信号决定付费进阶模板包(一次性买断,GodotIQ 模式)等,**届时单独评估,不预建** |

## 5. 明确不做 + 未决项

**明确不做**:云化/托管(2026-08-19 裁决 defer)、多引擎(稀释护城河)、49 agents 工作室(小白要 autopilot)、CC0 外部资产管线(安全面扩张大,等真实反馈)、修复 editor 侧 export stub(超范围)。

**未决项(执行前必查)**:

1. **SHA256 哈希来源**(批 2 前置):核实 Godot 官方 GitHub releases 是否随 assets 附带校验文件;若无,从 godotengine.org 下载页取,域名白名单相应增加,且哈希信道与二进制信道不同源时的信任链须在实现文档说明。
2. ~~CCGS 上游 PR/Discussion~~ **已裁决(2026-08-20 用户):不提**。实测上游自 2026-05-13 v1.0.0 Release 后无任何提交(核查:`git -C D:/GitHub/ai-agent-tools/Claude-Code-Game-Studios log -1 --format=%ad` → 2026-05-13),PR 不会被 merge。策略改为**在自仓吸收其基础思路完善**——批 5 wizard 的 /start 四档分诊 + 阶段机设计即此路线(它停滞反而说明不能指望上游进化);批 1 C-1 配套指南仍保留,面向 CCGS 存量用户群(24k★ clone 量仍在)做引流,措辞按"指南适配其 v1.0.0 现状"写,不承诺上游配合。
3. 批 3 模板选型(3-5 个从候选 5 个中定):批 3 spec 时定。

## 6. 全局约束(每批适用)

- 每批独立 PR/独立会话;`npm run lint` + `npm run build` + `npm test` 全绿才合并。
- 默认不发版:CHANGELOG `[Unreleased]`,不 bump 版本;本计划预计不动 `rule-templates.ts`/`.claude/rules/`(若意外触及,按硬门禁走 bump 例外条款)。
- 每批完成后:vault 开发日志(`D:\workspace\Obsidian\GodotMCP\开发日志\`)+ memory 登记 + 第三方审查文档(`docs/reviews/`)。
- 安全相关改动(批 2)同步测试+文档(THREAT_MODEL/README)。
- 本文快照类数字均带核查命令,随时间漂移以实测为准。
