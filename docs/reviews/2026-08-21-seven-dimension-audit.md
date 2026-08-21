# 七维度全面审核报告(功能业务全方向)

- **审查对象**:`fix/arch-review-20260821` @ `0becdfe`(含架构审查修复批 3 commits),版本 0.32.8
- **审查方式**:5 个独立子代理并行分维度深查(D1+D5 / D2 / D3 / D4 / D6+D7)+ 主审对 10 条高严重度 finding 逐条交叉核实(全部属实)+ 机械验证(build/lint/test/rules-sync/budget)
- **审查日期**:2026-08-21
- **总体判定**:**通过,带 6 条 P1 修复项(0 P0)**——核心功能/安全/可靠性健康;问题集中在**文档-分发面**与**机械同步门禁的结构性盲区**

> [!result] 修复状态(2026-08-21 当日修复批,v0.32.9)
> **6 P1 全部修复;P2 修 10/12;P3 修 10/14**。明细:
> - P1-1 ✅ help enum 改注册表动态构建(45 工具,含 7 新工具)+防复发测试;P1-2 ✅ recording 双副本通篇新名;P1-3 ✅ CHANGELOG 补登+[Unreleased] 置顶;P1-4 ✅ README 协议更正 TCP+NDJSON;P1-5 ✅ 13100 三处清除+措辞更新;P1-6 ✅ bridge-session 13 用例单测+runtime 假就绪修复。
> - P2:P2-7/8/9/10(CLI 双形式)✅、P2-11/12(兜底+.catch)✅、P2-13(editor 预探测)✅、P2-14(QA unfreeze)✅、P2-15(阈值 76/51/79/77)✅、P2-17(PII 收敛)✅、P2-18(zip 读侧)✅、P2-19/20(措辞/数字)✅;P2-16(game-bridge CI 双重排除)⏸ 不动——vitest Linux 平台 bug 有完整披露,修复需 vitest 升级/Windows runner 决策,超出本批。
> - P3:修 10 条(capture_screenshot/TOOL_META 4 旧名/13100 关联条目/game-fs ../spawn-helper 前缀/[::1]/index.html 复检/bridge auth 拒绝/setBridgeProjectDir 早退/router.test 单一真相源/gd 注释);不修 4 条(setter 3 个未清项有辩护理由、TOOL_META 写盘 action 标 read 有注释权衡、bridgeTimeout 双层默认各有理由、help docs files 已验证可达无需改)。
> - 验证:lint ✅ build ✅ check:gdscript errors=0 ✅ rules-sync STRICT ✅ build-matrix 45 tools(v0.32.9) ✅ protocol-versions ✅ budget 0 error ✅;测试 6095+ passed,仅 2 条真机 UI 超时(与审核基线一致,CI 三批绿历史结论)。

> [!result] 后续批(S-1 门禁升级 + d20b1ff 移植,同日追加 2 commits)
> - **S-1 ✅ 已实施**:check-rules-content-sync.mjs 新增第三层**事实对账**——(A) 模板中 `tool(action="name")` 精确引用必须 ⊆ 运行时注册表该工具 enum(真相源 build/module-loader 注册态);(B) 模板中"端口 NNNN"必须 ∈ GD 常量范围(editor 9090-9094 ∪ bridge 9081-9090,常量从 GD 源提取不硬编码)。负向验证:注入 `recording_start` 被精确抓到、注入 13100 四处全被抓、还原后 STRICT 绿——P1-2/P1-5 类"双副本一致地错"从此被机械拦截。
> - **d20b1ff 处置 ✅ 独有内容已移植,分支可废弃**:其 CLI 双形式部分本分支已等价实施;独有内容(in-flight 计数器根治 setBridgeProjectDir 恒误报 warn——C 组下沉时未随迁的真修复、test/cli-args.test.ts 96 行、game-bridge.test 两段守护)已全部移植(含 defects 基线 63→64 惯例注释);qa parseFlag 收敛到共享 opt 使两分支语义完全一致。分支剩余内容(plans 文档/CHANGELOG 行)无独有价值。**未 push 前可 `git branch -D fix/audit-3-cli-args`**(删除待用户执行)。
> - **⚠️ 版本冲突提醒**:audit-fixes 四批的"0.32.9 版本行终态约束"已被本分支用掉——四批分支后续 push 开 PR 前需把版本终态调整为 0.32.10 并重排 CHANGELOG。



## 机械验证基线(实跑输出)

| 项 | 结果 |
|---|---|
| `npm run build` | ✅ 0 错误 |
| `npm run lint` | ✅ 0 错误 |
| `npm test` | 6088 passed / 2 failed / 41 skipped(2 failed 为 `test/integration/ui-layout-integration.test.ts` 本地超时,与 8e70f36 记录的本地已知现象一致,CI 连续三批绿;非本批回归,基线 6075→6088 +13) |
| `STRICT=1 npm run check:rules-sync` | ✅ 9 模板双向一致(子代理实跑) |
| `npm run check:budget` | ✅ 0 error / 5 warning(总量 93822B,略超 warn 线 92160B) |
| `npm run test:coverage` | exit 0;lines 80.5% / functions 83.4% |

## 七维度健康度总表

| # | 维度 | 健康度 | 一句话结论 |
|---|---|---|---|
| D1 | 功能完整性 | 一般 | 45 工具三方对账(注册↔matrix↔README)零差集,但 help 工具硬编码 enum 漏 7 个新工具 |
| D2 | 业务链路/端到端 | 良好(8/10) | 三层链路/分发链/CLI 路由无断链;系统性债=CLI 参数双形式与未合并分支 `fix/audit-3-cli-args` 分叉 |
| D3 | 安全体系 | 良好(绿) | 核心防护链全部实测到位,历史教训全部已修;无 P0/P1 可利用漏洞 |
| D4 | 可靠性 | 良好 | 历史雷区零复发,进程管理工程质量高;剩 4 条 P2(兜底防线/缓解覆盖不全) |
| D5 | 一致性/同步 | 一般 | 机械同步链全绿,但"机械一致地错"现行案例 2 组(recording 旧名/13100 端口) |
| D6 | 测试质量 | 健康(7.5/10) | 负向用例全覆盖、mock shape 对齐真实契约、无假绿新案;新文件 bridge-session 零测试 |
| D7 | 文档与交付 | 中等偏弱(6.5/10) | 自动化对账全过;手写文档 3 处协议/端口事实错误且随分发链扩散 |

## P1 Findings(6 条,合并去重后)

### P1-1 help 工具硬编码 enum 漏 7 个新工具,注释虚假(9/10)
`src/tools/help.ts:14-24` — `TOOL_NAMES` 硬编码 38 个,缺 `analysis`/`audit`/`debug`/`engine`/`qa`/`translation`/`uid`(全部为 2026-08 后新增);`:38` `enum: [...TOOL_NAMES]` 使 MCP schema 直接拒绝 `help(tool_name="uid")` 等调用,而 `docs/tools/` 下 7 个文档文件全部存在、仅被 enum 拦截无法触达。`:14` 注释声称"从 capability-matrix 动态构建"——实际是静态数组。matrix.json 的 help 描述同步携带该 38 名单漂移。
**修复方向**:TOOL_NAMES 从 capability-matrix 或 module-loader 动态生成。

### P1-2 recording 规则双副本通篇旧 action 名,按规则调用必败(9/10)
`src/tools/rule-templates.ts:768-803` + `.claude/rules/godot-mcp-recording.md`(7 处) — 规则全篇指导 `recording_start`/`recording_save`/`recording_load`/`recording_play`(grep 实测旧名 17 处、新名 `record_start` 族 **0** 处);实际 enum 是 `record_start`/`record_stop`/`record_save`/`record_load`/`record_play`(`src/tools/runtime.ts:83`)。AI 按分发规则调用会被 inputSchema 拒绝。`STRICT=1 check:rules-sync` 通过——两副本**一致地错**,STRICT 只对比副本间不对比代码事实。同款:`rule-templates.ts:365`(bridge 段)"recording_start 依赖 Bridge 连接"。
**修复方向**:双副本同步改新名;给 check-rules-sync 补"规则中 action 名 ⊆ matrix enum"事实对账层(见结构性建议 S-1)。

### P1-3 CHANGELOG [Unreleased] 漏架构审查批 3 commits(9/10)
`CHANGELOG.md` — deffcc6(未知命令静默挂起修复 + zip ~1GB OOM 修复 + web 安全加固,含 2 个用户可感知修复)、a7d865d(bridge 客户端下沉 core + eslint 分层门禁)、0becdfe(适配器工厂折叠/module-loader 移位/manifest 守护)全部未登(grep 零命中),违反 2026-08-19「默认不发版,变更进 [Unreleased]」定规。另 `[0.32.8]` 定版段置顶于 `[Unreleased]` 之前,违反 Keep a Changelog 惯例。
**修复方向**:补 [Unreleased] 段并把 Unreleased 挪到最顶;合并本分支前完成。

### P1-4 README 把 bridge 协议错标为 "WebSocket 服务端"(9/10)
`README.md:357` — `game_bridge_install` 描述"安装 MCP Bridge autoload 到项目(WebSocket 服务端)";bridge 实为纯 TCP+NDJSON(`src/scripts/mcp_bridge.gd:31/:501` TCPServer+StreamPeerTCP;TS 侧 `src/core/bridge-client.ts` net.createConnection)。WebSocket 是 editor 层另一套(`addons/godot_mcp_server/websocket_server.gd`)。AGENTS.md 架构表写"TCP 连接"正确,README 与之矛盾。用户按 WebSocket 排查 bridge 会走错方向。
**修复方向**:改"TCP 服务端(NDJSON 协议)"。

### P1-5 分发模板 editor 端口 13100 自相矛盾,错误随分发扩散(9/10)
`src/tools/rule-templates.ts:245/:392/:474` — 三处写 13100(`:474` 明确"默认端口 13100"),同文件 `:477/:481` 自己纠正为"9090-9094(**非 13100**)"并引 `websocket_server.gd:3` BASE_PORT=9090(实测确认)。双副本 `.claude/rules/godot-mcp-bridge.md:99`、`godot-mcp-editor.md:13/:95` 同错;`agentsmd-builder.ts` import 该模板分发到目标项目 AGENTS.md——错误随分发扩散。另 `:245`"Bridge 使用 TCP 一次性连接,无持久会话可重连"已过时(C 组重构后为持久连接+30s keepalive+订阅重发)。
**修复方向**:清除 13100 三处 + 更新"一次性连接"措辞;双副本同步;触发 check-rules-version-bump 硬门禁(改 rule-templates 须 bump,按 2026-08-20 N-C 裁决照常走版本链)。

### P1-6 架构审查 C 组新文件 bridge-session.ts 零测试(9/10)
`src/cli/bridge-session.ts:30-53` — 全 test/ 目录零引用(grep 实测);唯一消费方 `src/cli/gif.ts:58` 同样无测试。该文件含真实判定逻辑:`installText.includes('already registered')||includes('success')`(:38)、`runText.includes('Bridge ready')`(:48)——靠子串匹配判定下游工具输出,措辞一变即静默断链,属接线零验证(删掉判定逻辑无测试会红)。同族问题:D2-5 的 `runtime.ts:245` 在未装 bridge 时仍无条件返回 "Bridge ready."(该字符串正是 :48 的判据),假就绪文案有放大效应。
**修复方向**:补 bridge-session 单测(含 "Bridge ready" 契约锁定测试);`runtime.ts:245` 的无条件 "Bridge ready." 文案仅在 waitForBridge 分支内返回。

## P2 Findings(12 条,按主题归组)

### CLI 参数双形式与分支分叉(D2,4 条,关联未合并分支 `fix/audit-3-cli-args` = d20b1ff)
- **P2-7** `src/cli/init.ts:9`(9/10) — `--template` 只认等号形式,空格形式静默落 `empty` 空骨架;d20b1ff 已修同一 bug 但非 HEAD 祖先(`git merge-base --is-ancestor` 证实)。
- **P2-8** `src/cli/qa.ts:35-49`(9/10) — `parseFlag` 只认空格形式,`--project=<path>` 时 project 静默丢失且 token 混入 positional → QA 对错误项目静默执行。
- **P2-9** `src/cli/skills.ts:90-91`(8/10) — `--target` 只认空格形式,等号形式静默装入用户级目录。
- **P2-10** 两分支各自创建 `src/cli/args.ts`(9/10) — HEAD 版(a7d865d)实际仅 gif.ts 一处消费,声明"消灭四处重复"与事实不符;d20b1ff 版已真统一五命令。同名文件必然冲突,当前弱版默认胜出——上三条 P2 即其代价。**建议:优先合并 d20b1ff 并消解 args.ts 冲突**。

### 可靠性兜底(D4,4 条)
- **P2-11** `src/index.ts`(9/10) — MCP server 主进程无 unhandledRejection/uncaughtException 全局处理器(唯一注册点在 dashboard 独立进程);Node 15+ 语义下任一 floating promise 直接 crash 长驻 server。
- **P2-12** `src/core/EditorConnectionManager.ts:217`(8/10) — `void this.verifyProject().then(...)` 链无 `.catch`,`handleStall()` 内任一同步抛错即产生 unhandled rejection,是 P2-11 的现实引爆点(同文件其他 void 调用均带 .catch,唯独此链裸奔;已本人核实 `:215-220`)。
- **P2-13** `addons/godot_mcp_server/websocket_server.gd:253-260`(8/10) — 双 bind 假成功缓解只覆盖 bridge 侧(`mcp_bridge.gd:486-512` connect 预探测),editor 侧仍只靠 listen 错误码;且 editor 端口递增后 TS 侧固定连 9090 无发现机制(bridge 有 registry,editor 无对应物)——双 editor 实例并开时可能连错实例或永远连不上。
- **P2-14** `src/tools/qa/runner.ts:229-280`(8/10) — teardown 对 watch/monitor/recording 均有兜底,唯独缺 `playtest.unfreeze`:套件 freeze 后中途 abort(断言失败/预算耗尽/cancel)时外部游戏残留 `tree.paused=true` 永久冻结(`auto_run:false` 场景)。freeze 是套件主动施加的破坏性状态,与"不替你关游戏"性质不同。

### 测试基础设施(D6,2 条)
- **P2-15** `vitest.config.ts:19-24`(9/10) — 覆盖率阈值滞后:实测 lines 80.5%/functions 83.4% vs 阈值 61/69,超 ~20%,违反同文件 `:17-18` 自家注释"持续超阈值 >4% 应上调"。
- **P2-16** `vitest.config.ts:16` + `ci.yml:107`(9/10) — `core/bridge-client.ts`(721 行关键路径,含 4 个历史 BLOCKING 回归守护的 23 个 socket 用例)被整文件退出覆盖率 + CI 排除(Linux vitest mock 平台 bug,issue #15),仅本地 Windows 单点执行——已知妥协有完整披露,但属结构性盲区。

### 安全纵深(D3,2 条;均非可利用漏洞)
- **P2-17** 工具层 catch-and-return 直泄 err.message/绝对路径(8/10) — `runtime-assert.ts:110/:336/:306`、`qa/index.ts:113-115`、`screenshot.ts:204/:433`、`validation.ts:993`、`script.ts:603` 等点绕过 G2 classifyError PII 护栏(主 catch 才生效),与 EditorToolExecutor 前科同构(该处已修);本地单用户威胁模型下属防护不一致非漏洞。修复:工具层 catch 统一走 classifyError。
- **P2-18** `src/cli/zip-extract.ts:214-230`(8/10) — zip 解压 size 校验是事后性(写盘后才比对),无解压总量上限,理论 zip bomb 会先写满磁盘;但全仓仅两处调用方均对 Godot 官方资产且 SHA512 校验先于解压,前提不可达,属纵深不足。

### 文档措辞(D6/D7,2 条)
- **P2-19** `README.md:236` + `docs/migration-from-coding-solo.md:15`(8/10) — validate_scripts"触发完整编译"措辞与 AGENTS.md 2026-08-01 P2-12 教训记录直接冲突(逐文件 load ≠ 项目级编译,`check:gdscript` 才是);同一仓库两份权威文档互相矛盾。
- **P2-20** `README.md:634`(7/10) — "回退全量 41 工具"数字漂移(其余各处均 45)。

## P3 摘要(低优先级,列清单不展开)

- `claudemd-builder.ts:95` capture_screenshot 旧名残留(历史挂账未修)
- `workflow.ts:892`/`validation.ts:1116-1118` TOOL_META 残留 4 个 merged 旧工具名,使 getAllToolNames 返回 49 而非 45,污染 isKnownTool/动态注册判定
- `.claude/rules/godot-mcp-core.md:94` + `rule-templates.ts:108` 列举 `node_create_3d`/`physics_raycast` 旧名;`godot-mcp-ui.md:277` `scene_commit` 旧名
- `.claude/rules/godot-mcp-bridge.md:220` + `rule-templates.ts:366` "端口冲突需手动修改"与自动递增避让实现矛盾
- `web-server.ts:97-105` 目录→index.html 跳转后未复过 resolveWithinRoot(纵深缝隙);`:50-54` `[::1]` 判断死代码
- `GodotServer.ts:725-751` close() 清理 21/24 setter,未清 3 个(setOnBridgeConnected/setProjectDir/setActiveGroups,均有可辩护理由)
- `bridge-client.ts:495-497` setBridgeProjectDir 早退分支致 keepalive timer 清理不对称(危害≈0)
- `game-fs.ts:16-48` user:// rel 无 `..` 段校验(来源是 bridge 返回值,威胁模型内)
- `spawn-helper.ts:88-94` async ENOENT 不带 SPAWN_FAILED 前缀,与同步 throw 语义不一致
- `test/game-bridge.test.ts:6-7` 头部注释引用旧行号;`test/cli/router.test.ts:75` 硬编码重复 SUBCOMMANDS
- `bridge-client.ts:369` auth 失败与超时错误不可区分;`bridge-session.ts:22` vs `runtime.ts:89` 两层 bridgeTimeout 默认值不同(20/10)
- `help.ts:74-79` npm 安装态 docs/tools/ 路径可达性未验证(可能生产态 help 全部读不到文档)
- TOOL_META 把写盘 action 标 'read' 免确认(validation/screenshot,注释自认权衡)

## 通过项亮点(实测证据)

- **三方对账零差集**:module-loader 43 模块 → 运行时 45 工具 = matrix 45 = README 主口径,action 248 精确吻合(node 实测双向 diff)
- **路径白名单**:deny-by-default 双层 realpath(防 junction)、resolveWithinRoot 五层防御;历史盲区(嵌套参数)抽查全过(scripts 数组/spec_path/evidence_path/screenshot 四 action);UNRESTRICTED 只读 env,全 src 零写入点
- **GDScript 沙箱**:deny-list 逐条核名真实 API(无错拼写);索引访问/单例别名/字符串拼接窗口/格式化/preload/Expression 绕过面全覆盖;write/edit 前全扫;marker 用 randomUUID()
- **bridge 鉴权**:crypto 64 字节 + 防模偏差采样、仅 127.0.0.1、constant-time 比较、per-peer lockout、EXTRA_METHODS_BLOCKLIST 不可覆盖且拦截内层 args[0]
- **确认令牌**:out-of-band elicitation 阻断 AI 自读自确认;审计-确认耦合前科已修(令牌请求不记虚假 ok)
- **进程管理**:spawn 五路注销对称、孤儿扫描、10MB 输出上限+超时强杀、环形缓冲;QA 并发第二 run 显式 BUSY 拒绝(非竞态)
- **eslint 分层门禁**:`src/core/` 零 tools import 实测;editor-method-map 18 族全登记
- **测试质量**:负向用例四类全覆盖且双向(不漏报+不误报);mock shape 逐字段对齐真实契约;qa-runner 有"诚实降级"守护断言;未发现假绿新案
- **分发链**:addons 全量拷贝+verify、setup_project_rules 白名单+原子写+幂等、game-templates 1:1 清单+双向对账测试、skills 7 个双副本 diff 全 SAME

## 结构性发现(比单条 P1 更重要的两个模式)

**S-1 机械同步门禁无法守护内容正确性(现行证据 ×2)**
STRICT rules-sync / skills 双副本 / matrix 对账全绿的同时,recording 旧名(双副本一致地错 17 处)、13100(同文件自相矛盾+随 agentsmd 分发扩散)全部漏网——这不是执行不力,是门禁设计盲区:机械 diff 只对比副本间,不对比代码事实。呼应 2026-08-16「机械一致性≠内容正确」教训,该教训当时已识别但未沉淀为自动化。**建议**:check-rules-sync 补第三层对账——(a) 规则文本中出现的 `工具(action="xxx")` 的 action 名 ⊆ matrix enum;(b) 端口/默认值等关键数字对照源码常量。这能机械拦截 P1-2/P1-5 类问题。

**S-2 未合并分支的技术债倒挂**
`fix/audit-3-cli-args`(d20b1ff)修了 init/qa/skills 三处 CLI 参数 bug 并建了完整版 args.ts,但本分支(更晚)独立建了弱版同名文件;两分支并存时间越长,合并冲突消解越难,且 HEAD 弱版若先合并 master,d20b1ff 的修复会被半途冲掉。**建议**:本分支合并 PR 前/后立即处理 d20b1ff(优先合并它,或在消解 args.ts 冲突时取其完整版)。

## 修复优先级建议

1. **合并本分支前必做**:P1-3(CHANGELOG 补登)——违反仓库定规且含用户可感知修复
2. **高价值低成本**:P1-1(help enum 动态化)、P1-4(README 一行)、P2-20(数字一行)
3. **成组修(触发规则模板硬门禁,一次 bump)**:P1-2 + P1-5 + 相关 P3 旧名/端口条目——同改 rule-templates 双副本,走 2026-08-20 N-C 裁决流程
4. **可靠性小补丁**:P2-11+P2-12(全局兜底 + 单点 .catch,一次 PR)、P2-14(QA unfreeze 兜底)
5. **分支整理**:S-2(d20b1ff 合并决策)
6. **门禁升级(长期)**:S-1(事实对账层)
7. **测试补缺**:P1-6(bridge-session 单测)、P2-15(阈值上调至 76/79 左右保留 margin)

---
*审查方法备忘:5 子代理独立深查(45-91 次工具调用/个)+ 主审 10 条高严重度 finding 逐条本人复核(grep/sed 实测,全部属实)+ 机械验证基线实跑。所有 file:line 为审查时快照,重构会漂移。*
