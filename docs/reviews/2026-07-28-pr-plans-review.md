# 5 份 enhanced PR 计划审查报告（2026-07-28）

> **审查范围**：`D:\workspace\Obsidian\GodotMCP\系统文档\` 下 5 份 enhanced PR 计划（遥测 / 客户端配置 / 测试框架 / 签名自更新 / 多客户端 session）。
> **审查方法**：派 5 个独立 `code-reviewer` 子 agent 并行审查，隔离视角，**所有声明 grep/read 实测**，不预设计划作者声明为真。
> **审查基准**：enhanced `package.json` 版本 `0.25.0`（注意：AGENTS.md:168 仍写"当前 0.23.0"已漂移，本审查以 `package.json:3` 实测值为准）。
> **对照依据**：竞品深度研究（godot-ai 代码级深挖 II/III）+ 战略主报告。

---

## 总体判定矩阵

| 计划 | 判定 | Blocking | 核心问题 |
|------|------|----------|---------|
| [遥测](#1-遥测) | 🟡 **SHIPPED WITH NITS**（2 准-BLOCKING） | 2 | 包装点/dashboard 宿主对 enhanced 架构误判，但方向正确 |
| [客户端配置](#2-客户端配置) | 🔴 **BLOCKING**（建议驳回重做） | 2 | 核心前提失实：enhanced 已有 13 适配器，计划 greenfield 重写 |
| [测试框架](#3-测试框架) | 🔴 **BLOCKING**（方向对，事实修正） | 5 | 未识别已有 `runtime.run_tests`，但 headless 战略判断成立 |
| [签名自更新](#4-签名自更新) | 🔴 **BLOCKING**（建议驳回重做） | 4 | "enhanced 无自更新"虚假：已有 `self_update` 工具链 |
| [多客户端 session](#5-多客户端-session) | 🔴 **BLOCKING**（最深改造） | 4 | 常规工具不过 router + stdio 无 header 通道 |

**最接近可落地**：遥测（只需修 2 个方案性误判即可进 PR-1）。
**建议搁置**：多客户端 session（架构级缺口，需先补"让 dispatchTool 经过 router"的 PR-0）。

---

## 贯穿性问题（最高优先级，影响所有计划）

### 贯穿问题 1：竞品研究的"enhanced 缺口"结论已过时，计划作者未 grep 自家仓库

5 份计划中 **3 份**的核心前提经实测不成立：

| 计划 | 计划声称 | 实测真相 | 证据 |
|------|---------|---------|------|
| 客户端配置 | "enhanced 需手填客户端配置" | 已有 `src/cli/clients/` **13 适配器** + `setup.ts` 一键配置 + `doctor.ts` 诊断 + 18 测试文件 | `src/cli/clients/index.ts:24-40`、`src/cli/setup.ts:34-79` |
| 签名自更新 | "enhanced 无自更新" | 已有 `self_update` MCP 工具 + `update-checker.ts` + `addon-version.ts` + 173 行测试 | `src/tools/self-update.ts:33-130`、`src/core/addon-version.ts:15-36` |
| 测试框架 | （未提及 `runtime.run_tests`） | 已有 headless GUT 封装（`godot --headless --script addons/gut/gut_cmdln.gd`，120s timeout，`Tests:`/`Failed:` 解析） | `src/tools/runtime.ts:294-365` |

**根因**：竞品研究文档（如 `竞品深度研究-godot-ai-代码级深挖II-2026-07-28.md:23` 断言"enhanced 完全没有"客户端配置）在某个时间点做的"enhanced 现状"结论，随 enhanced 版本推进（0.23→0.25）已过时；计划作者直接采信竞品文档作为前提，没回头 grep 自家仓库。

**已登 memory**：`competitor-research-gap-conclusions-stale`——任何 PR 计划动笔前，其"现状描述"必须 grep 实测自家仓库，不能直接采信竞品研究的"enhanced 缺口"结论作为前提。

### 贯穿问题 2：enhanced 有未被文档登记的隐藏子系统

`src/cli/` 子系统（`clients/` + `setup/doctor/init/router`）在 `AGENTS.md` 仓库结构表（`AGENTS.md:176-191`）**完全没提**。这导致竞品研究者、计划作者都不知道它存在，直接导致客户端配置计划作者把已有系统当 greenfield 重写。

**修复动作**：本次审查已补 `AGENTS.md` 仓库结构表的 `src/cli/` 行（见本文档「修复动作」段）。

**已登 memory**：`src-cli-subsystem-undocumented-in-AGENTS`。

### 贯穿问题 3：对 enhanced 独立进程边界理解不足

3 份计划误把 `dashboard` 当 server 的 UI 前端：

| 计划 | 误判 | 实测真相 | 证据 |
|------|------|---------|------|
| 遥测 PR-5 | opt-in 开关放进 dashboard | dashboard 是 `#!/usr/bin/env node` 独立 CLI 进程，与 server 不共享配置态 | `src/dashboard/index.ts:1-2` |
| 签名自更新 PR-3/4/5 | dashboard 是自更新安装宿主 | dashboard 是纯只读日志查看器（LogReader→Aggregator→render），无 HTTP/写入/editor 连接 | `src/dashboard/index.ts:1-201`、`src/dashboard/launcher.ts:31-113` |

**根因**：这与许多项目"dashboard = server 内嵌 Web UI"的惯例相反，plan 作者易踩。

**已登 memory**：`enhanced-dashboard-is-readonly-cli-not-server-frontend`——任何"在 dashboard 加设置项/安装能力影响 server 行为"的计划都架构不可行；enhanced 的配置开关走 env（`GODOT_MCP_*`）或 `~/.godot-mcp/settings.json`。

### 贯穿问题 4：MCP stdio transport 无 header 通道

多客户端 session 计划把"从 MCP context/headers 提取 agent 标识（标准）"列为推荐项，但实测：

- enhanced 唯一启用的 transport 是 `StdioServerTransport`（`src/GodotServer.ts:339`）。
- MCP SDK 的 `mcp-session-id` header 仅在 `StreamableHTTPClient`（`node_modules/@modelcontextprotocol/sdk/dist/cjs/client/streamableHttp.js:70-71`）可用，stdio transport 无 header 通道。
- enhanced 现有 `ToolDispatcher.ts:204-209` 注释自承 `agentId` 通常为 `undefined`（多 Agent 路径不可用）。

**已登 memory**：`mcp-stdio-no-header-channel`——涉及 MCP 协议层能力的方案，必须先确认 transport 类型；stdio MCP server 下 agent 标识只能走工具参数（client 自报）或不可靠的 `_meta`。

---

## 1. 遥测

**判定**：🟡 **SHIPPED WITH NITS（2 准-BLOCKING，最接近可落地）**

方向正确（opt-in 反向、setImmediate 替 daemon thread、数据脱敏扎实），只需修 2 个方案性误判即可进 PR-1。

### Blocking Issues

**B-1（准-BLOCKING）：PR-3 包装点定在 `tool-registry.register` 基于架构误判**

- **证据**：`src/core/tool-registry.ts:39`（`registerModule` 只接收 `ToolModule`，`handleTool` 是接口方法签名，不在此处调用）、`:75`（`registerInlineTool` 只接收 `Omit<ToolMeta,'name'>`，连 handler 引用都不存）。
- **真相**：handler 执行链是 `ToolDispatcher.handleCall`（`src/core/ToolDispatcher.ts:189`）→ `executeMiddleware`（:220）→ `dispatchTool`（:625）。enhanced **已有现成的 instrumentation 注入点**：`buildMiddleware`（`ToolDispatcher.ts:434`）返回 `Middleware[]`，已有 `healthSample` after-hook（:438-454）记录 duration + success + error，且 `call-recorder.ts` 已在做类似记录。
- **修复**：PR-3 重写为"在 `buildMiddleware` 注入 `createTelemetryMiddleware()`"，before 记 startTime，after 调 `record({tool, success, duration_ms, error_category, project_hash})`。完全不用碰 tool-registry。

**B-2（准-BLOCKING）：PR-5 把 opt-in 开关放进 dashboard 架构不可行**

- **证据**：`src/dashboard/index.ts:1`（`#!/usr/bin/env node` shebang，独立 CLI）、`:140`（`resolveLogDir()` 读日志目录渲染）。dashboard 进程与 MCP server 是两个独立进程，不共享配置内存。
- **修复**：opt-in 只走 `GODOT_MCP_ENABLE_TELEMETRY` env（最贴合 enhanced 惯例——所有安全相关开关都是 env），或新增 `~/.godot-mcp/settings.json` 由 server 读写。

### 重要 Nits

1. **PR 合并顺序应调整为 PR-1 → PR-2 → PR-4 → PR-3 → PR-5**（PR-3 依赖 PR-4 的 `hashProject`/`_safeExceptionCategory`）。
2. **既有外传点隐患**：`src/core/update-checker.ts:13,86` 启动时被动 fetch npm registry 无 opt-in、无 `trustEnv=false` 硬化。"默认零外传"声明会被用户 grep 打脸。`docs/telemetry.md` 应诚实披露。
3. **CI 环境自动禁用**：`isTelemetryEnabled()` 加 `process.env.CI === 'true'` 时强制 false。
4. **新增 `src/telemetry/*.ts` 后必须跑 `npm run build`**（AGENTS.md:360）。

---

## 2. 客户端配置

**判定**：🔴 **BLOCKING（建议驳回重做）**

核心前提失实：计划把 enhanced 已有的 13 适配器系统当 greenfield 重写到全新 `src/client-config/` 目录，会产出 dual source of truth。

### Blocking Issues

**B-1：核心前提失实，计划重造既有系统（confidence 100）**

- **计划声称**："enhanced 需手填客户端配置"（:19）、"首批 6 客户端"全新实现（:55-96）。
- **实测真相**：`src/cli/clients/` 已有 **13 适配器**：
  - Claude Desktop → `src/cli/clients/claude-desktop.ts:8`
  - Cursor → `src/cli/clients/cursor.ts:8`
  - Cline → `src/cli/clients/cline.ts:8`
  - VS Code（Cline 走 globalStorage）→ `cline.ts:16-19`
  - Windsurf → `src/cli/clients/windsurf.ts:8`
  - Zed（已正确用 `context_servers` 非 `mcpServers`）→ `zed.ts:24,32`
  - Claude Code CLI → `src/cli/clients/claude-code.ts:8`
  - Codex CLI（CLI strategy + execFile + timeout）→ `src/cli/clients/codex.ts:27-35`
  - + Cherry Studio / Antigravity / Trae / Qwen Code / Gemini CLI / OpenCode
- **计划自称"直接抄 godot-ai"的能力 enhanced 已有**：`entry_extra_fields`/`entry_initial_fields` 二分（`cline.ts:12-14,41-43`）、`readOrInit` 拒绝覆写 + BOM 去头（`json-config.ts:20-33`）、atomic write（`claude-desktop.ts:37-39`）。
- **修复建议**：作废 greenfield 框架，改为基于 `ClientAdapter` 接口（`src/cli/clients/types.ts:16-25`）增量扩展：加 `verifyPostState`/`checkStatus` 三态方法、补 drift 检测、补 dashboard 面板（复用 `ALL_ADAPTERS`，`index.ts:24`）。

**B-2：路径白名单护城河被跨进程写用户家目录绕过，计划未识别（confidence 90）**

- **证据**：`AGENTS.md:336` 路径白名单是核心安全定位，`path-utils.ts:258` deny-by-default。但所有既有 global-scope adapter（`claude-desktop.ts:13`、`windsurf.ts:14`、`cline.ts:18` 等）直写 `~/Library/Application Support/`、`%APPDATA%`、`~/.codeium/` 等用户家目录，完全不经 `isPathInAllowedRoots`。计划 PR-5 第 90 行还要把 `ALLOWED_PROJECT_PATHS` 本身写进这些家目录配置文件的 env 块——等于把护城河变量外泄到白名单外路径。
- **修复**：计划必须新增"用户全局配置写入的安全模型"段，明确 CLI `setup` 是用户显式触发的带外操作（非 MCP 工具自动调用），与运行时 `isPathInAllowedRoots` 是不同信任域。

### 真实缺口（应优先于重写）

- **ZCode/Warp 适配器**：`docs/使用指南-ZCode.md`、`docs/使用指南-Warp.md` 存在但 `src/cli/clients/` 无对应 adapter（grep 零命中）。用户实际在用 ZCode。
- **drift 检测**（计划 PR-6 的 `CONFIGURED_MISMATCH` 三态）：既有只有 `isConfigured` 二态（`types.ts:21`），是真实增强点。

### Nits

- 计划 PR-2 第 42-49 行的 `mcpServers` schema 对 Zed 错（Zed 用 `context_servers`，既有 `zed.ts:24,32` 已正确处理）。
- `.cursor/` / `.vscode/` 属 AGENTS.md:70 禁编辑类别（除非用户明确要改），写入需在文档标注"目标 Godot 项目的 .cursor/，非本仓库"。

---

## 3. 测试框架

**判定**：🔴 **BLOCKING（方向对，5 个事实性 Blocking 待修正）**

核心战略判断——**enhanced headless 路线天然避开 transport 防饥饿 hard gate**——**经独立验证成立**（见下方证据链）。Blocking 全是事实性修正，不影响计划整体方向。

### 战略判断验证（成立）

- **godot-ai 的 starvation 源头**：`run_tests` 在编辑器主线程同步跑整个套件，长 suite >~20-40s → WebSocket pong 饿死 → socket 1011 关闭。
- **enhanced 的执行模型不同**：headless 走 `child_process.spawn`（`gdscript-executor.ts:1192`）是独立 OS 进程，Node 主线程不被阻塞；editor WS 是请求-响应模型（`EditorConnection.ts:325-372`），无 godot-ai 那种"长命令占据 WS 响应权"结构。
- **结论**：headless 测试进程不经过编辑器 WS，长 suite 不会饿死任何 keepalive。计划诚实标注 editor 路线（阶段 2）仍需 hard gate，正确。

### Blocking Issues

**B-1：未识别与现有 `runtime.run_tests` 的重叠**

- **证据**：`src/tools/runtime.ts:294-365` 已实现 headless GUT 封装。计划全文 140 行零次提及 `run_tests`。
- **修复**：加"与现有 `runtime.run_tests` 的差异定位"——`test_run`（自建套件，零项目依赖）与 `run_tests`（调项目侧 GUT）共存，PR-5 文档给 AI 决策树。

**B-2：PR-3 复用 `execute_gdscript` 传参假设不成立**

- **证据**：`gdscript-executor.ts:468-475` `ExecuteGdscriptOptions` 无 `extraArgs` 字段；`:1130-1161` `godotArgs` 固定拼装。
- **修复**：PR-3 直接 `spawn`（对齐 `runtime.ts:311-316` 的 `run_tests` 模式）。

**B-3：lint 规则数引用错误（16 → 实际 25）**

- **证据**：`src/tools/gdscript-lint.ts:156` `rules_count: 25`；规则 L001–L025 在 `:161-373`。计划 :72 写"16 规则"。
- **修复**：改为"25 规则（L001–L025）"，新规则建议 L026–L031。

**B-4：分发产物边界强制命令缺失**

- **证据**：`package.json:33` build 脚本拷 `src/scripts/*.gd` → `build/scripts/`；AGENTS.md:279 + :359 改工具清单必须 `npm run build-matrix`；`src/core/tool-registry.ts:167` core 组工具清单需登记。
- **修复**：PR-1 验收加 `npm run build`；PR-3 验收加 `npm run build-matrix` + tool-registry 登记 + version bump。

**B-5：测试框架自测（dogfooding）路径未定义，PR-1/PR-2 循环依赖**

- **证据**：计划 :50 PR-1"测试：基类单元"，但 GDScript 基类单测只能由 runner（PR-2）跑，PR-1 单独无法验证。
- **修复**：合并 PR-1+PR-2，或 PR-1 含最小 runner stub 能跑基类自身测试。

### Nits（已在计划内修正）

- ✅ 已修：lint 规则 16 → 25。
- ✅ 已修：`AGENTS.md:158-169` 引用错误（enhanced 该段是 Git 卫生，非测试卫生；六大模式源自 godot-ai 的 AGENTS.md）。
- ✅ 已修：`McpTestSuite` vs `MccpTestSuite` 命名统一为 `McpTestSuite`（计划已有此用法）。
- ✅ 已修：`[[project-godot-mcp-lint-engine]]` Obsidian 死链 → 改引 `src/tools/gdscript-lint.ts` 绝对路径。
- "GUT 是 enhanced 已集成的成熟框架"措辞误导——enhanced 不分发 GUT，只支持调项目侧 GUT（`runtime.ts:313`）。
- `CACHE_MODE_IGNORE`（:54）最低 Godot 版本未标注（enhanced 支持 4.5–4.7，需确认 4.5 支持）。

---

## 4. 签名自更新

**判定**：🔴 **BLOCKING（建议驳回重做）**

计划建立在两个关于现状的错误前提之上：(1) "enhanced 无自更新"虚假；(2) "dashboard 是安装宿主"虚假。签名部分（PR-1/PR-2）方向正确。

### Blocking Issues

**B-1：计划声称"enhanced 无自更新"但已有完整 `self_update` 工具链**

- **证据**：`src/tools/self-update.ts:33-130`（`self_update` MCP 工具，`action: enum[check, update]`）、`src/core/update-checker.ts:13`（npm registry 查询 + 24h 缓存 + semver 比较）、`src/core/addon-version.ts:15-36`（`readAddonVersion` + `updateAddon` cpSync）、`test/self-update.test.ts`（173 行测试）。
- **影响**：战略定位论述（"补齐即第二"）前提失真；PR-3 与已有 `self_update check` 功能重叠；现有 `updateAddon` 的 cpSync 路径（无 zip-slip/无签名/无回滚）是真实暴露面，计划 PR-4 未覆盖。
- **修复**：重写"现状"段，明确 PR-4 与 `addon-version.ts:updateAddon()`（cpSync）的关系——推荐"替换 cpSync 为签名+zip-slip+单遍快照版"，并把现有 cpSync 路径作为签名验证的强制前置（无签名不走）。**否则旧路径绕过签名 = 签名形同虚设**。

**B-2：dashboard 不适合做安装宿主**

- **证据**：`src/dashboard/index.ts:1-201`（LogReader→Aggregator→render，无 HTTP/写入/editor 连接）；`src/dashboard/launcher.ts:31-113`（仅 spawn 终端）。
- **影响**：PR-3/4/5 的大半工作量（dashboard 新增 HTTP 客户端、banner UI、下载管道、安装管道）被当成"借鉴"低估；godot-ai dock 是带交互编辑器面板，enhanced dashboard 是只读 TUI，形态根本不同，"抄"不可行。
- **修复**：考虑复用已有 `self_update` MCP 工具（AI 驱动，已有确认门 `self-update.ts:22-31`）做"带签名验证的 update"，dashboard 仅做只读"有新版"提示。

**B-3：editor WS reload 能力不存在**

- **证据**：`addons/godot_mcp_server/command_handler.gd:104-242` 无 reload method（未知返回 -32601）；`src/core/editor-method-map.ts` 无 reload 映射；grep `reload|EditorFileSystem` 在 addons/ 零命中。
- **修复**：把"addon 端新增 reload handler（GDScript，调 `EditorInterface.get_resource_filesystem().scan()` 或 `set_plugin_enabled` 等价物）+ editor-method-map 登记"显式列为 PR-5 的交付物，而非开放问题。

**B-4：插件更新缺目标项目 Godot 版本兼容门禁**

- **证据**：AGENTS.md:381"addons 改动需考虑向后兼容"；现有 `addon-version.ts:26` `updateAddon` 也无版本检查。
- **修复**：PR-4 加目标项目 Godot 版本探测 + 兼容矩阵门禁。

### Nits

- 版本基线漂移：计划基于 0.23.0，实测 `package.json:3` 已 0.25.0。
- 密钥吊销路径缺失：PR-2 提密钥轮换反向自检，但未提密钥泄露后的吊销/已发布签名失效流程。
- npm publish 与 GitHub Release 原子性：两者失败不一致会让 `self_update check`（npm）与 dashboard（GitHub Release）版本不同步。
- Windows smoke baseline：计划抄 macOS .ips，但 enhanced 主用户在 Windows（`launcher.ts:45`）。
- AGENTS.md 同步：PR-5 抄 class_name 铁律进 AGENTS.md/CLAUDE.md，若新增规则段需同步 `.claude/rules/` + `rule-templates.ts`。

---

## 5. 多客户端 session

**判定**：🔴 **BLOCKING（最深改造）**

差异化论证（sticky + per-call 叠加）方向正确，但存在 3 个会让 PR 在落地时撞墙的设计缺陷。建议搁置或大幅重构。

### Blocking Issues

**B-1（Critical）：架构盲区——常规工具不过 InstanceRouter，"sticky fallback"前提不成立**

- **证据**：`src/core/ToolDispatcher.ts:625-664`（`dispatchTool` 只调 `targetMod.handleTool`，不查 router）；`src/GodotServer.ts:303-324`（`setDynamicSender` 是 router 唯一非 instance-tool 消费者）；`src/tools/advanced-proxy.ts:192`（唯一查 `_dynamicSender` 的工具）。
- **影响**：99% 的工具根本不经过 router，sticky 只对 `godot_advanced_tool` 这一个动态代理工具生效。"单客户端零感"论证建立在错误前提上——实际不是"退化到 sticky"，而是"根本没路由层"。
- **修复**：必须先补 PR-0「让 dispatchTool 经过 InstanceRouter」（含三层：headless findGodot 按 instance 切、editor WS 按 instance 端口切、bridge TCP 按 instance 切），否则后续 PR 全部悬空。

**B-2（Critical）：协议层难点误判——stdio 下无 header/session 通道**

- 见[贯穿问题 4](#贯穿问题-4mcp-stdio-transport-无-header-通道)。
- **修复**：改用工具参数自报 agent 标识（client 自报），并在计划写清"agent 标识不可靠时退化为单 agent 模式"。

**B-3（High）：PR-1 / PR-2 分阶段产生净负中间态**

- **证据**：PR-1（:41-45）只下沉 instanceId 形参；PR-2（:47-52）才接 AgentContextManager。PR-1 落地后多客户端共享时仍互踩（全局 sticky 被抢）。
- **修复**：PR-1 + PR-2 必须合并提交，或 PR-1 在 AgentContextManager 接入前不暴露 instanceId 参数（feature flag 保护）。

**B-4（High）：遗漏 capability-matrix 重建**

- **证据**：AGENTS.md:71/279/359 明确改工具清单必须 `npm run build-matrix`；`src/capability/static-grep.ts:23` 已登记 `multi_instance` group。
- **影响**：PR-1 改所有工具 inputSchema → matrix schema 全变 → 不跑 build-matrix 则文档与代码漂移。
- **修复**：PR-1 任务清单加"跑 `npm run build-matrix` + `npm run diff-matrix`"，并评估 token 预算（`npm run check:budget`）。

### Nits

- `multi_instance` group 默认关（`feature-flags.ts:9`），计划整篇讲"多客户端共享"但没说这个能力的启用前提。
- `instanceSuffix` 字段是 instance id 格式 breaking change，会影响已持久化的 `state-store.ts` agent.selectedInstance，计划没提迁移。
- AGENTS.md:294-300 要求 plan 落地后必出第三方审查文档放 `docs/reviews/`，计划没列。

---

## 工程教训汇总（已登 memory）

| memory 实体 | 类型 | 一句话 |
|------------|------|--------|
| `competitor-research-gap-conclusions-stale` | methodology-lesson | 竞品研究的"enhanced 缺口"结论会过时，PR 计划"现状描述"必须 grep 实测自家仓库 |
| `src-cli-subsystem-undocumented-in-AGENTS` | engineering-lesson | `src/cli/` 子系统在 AGENTS.md 未登记，导致客户端配置计划 greenfield 重写 |
| `enhanced-dashboard-is-readonly-cli-not-server-frontend` | engineering-lesson | dashboard 是独立只读 CLI，不是 server 前端；配置开关走 env 或 settings.json |
| `mcp-stdio-no-header-channel` | engineering-lesson | stdio transport 无 header 通道，`mcp-session-id` 仅 StreamableHTTP 可用 |
| `pr-plan-review-round-2026-07-28` | feature-decision-log | 本次审查的判定结果 + 5 个 agent id 指针 |

---

## 修复动作清单（本次已执行）

1. ✅ 本综合审查报告落档 `docs/reviews/2026-07-28-pr-plans-review.md`。
2. ✅ 5 份计划文件加审查状态头（在 frontmatter 后插入判定 + 问题摘要 + 指向本报告的指针）。
3. ✅ `AGENTS.md` 仓库结构表补 `src/cli/` 行（修复隐藏子系统问题）。
4. ✅ 直接修正计划里的可修 Nits：
   - 测试框架：lint 规则 16 → 25；`AGENTS.md:158-169` 引用错误修正；`[[project-godot-mcp-lint-engine]]` 死链改绝对路径。
   - 遥测：PR-3 包装点加"应改 middleware"提示；PR-5 opt-in 加"应改 env"提示。

---

## 审查者声明

本报告所有 file:line 证据均经 5 个独立 `code-reviewer` 子 agent 的 grep/read 实测（`agent_f5f2b9a0` 遥测 / `agent_05df416d` 客户端配置 / `agent_c17ce454` 测试框架 / `agent_d9ccaec5` 签名自更新 / `agent_ed79a983` 多客户端），未预设计划作者声明为真。核心战略判断（遥测方向、测试框架 headless 避 hard gate）经独立验证成立；Blocking 问题集中在仓库现状契合度，均为可修复的事实性问题。
