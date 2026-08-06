# P3 核查与选做 plan

> **status**: draft（2026-08-06，待用户审批）
> **来源**: `docs/plans/2026-08-05-mcp-ecosystem-research-and-upgrade-plan.md` 第二部分 P3 表格（第 93-103 行）
> **核查方法**: 3 路并行 Explore 只读子代理（仿 P2 核查做法），所有数字/版本号/行号经 `node`/`grep` 实测（见文末「快照证据」）
> **本 plan 目的**: P3 表格写于调研期（基于竞品推断），核查后发现与代码现状有多处偏差。本文给出每项「实际落地到什么程度」的诚实结论 + 选做建议，不写实现代码。

---

## 0. 核查纠偏摘要（最重要的 3 个偏差）

> [!warning] P3 核查纠偏（2026-08-06，3 路并行 Explore 只读核查）
>
> P3 表格写于调研期（基于竞品文档推断），核查后发现与代码现状偏差比 P2 更大：
>
> - **SDK 版本假设全错**：原计划多处假设「若 SDK 是 v1 大概率不支持 SEP-414/Tasks」。实测 `package.json:61` 是 `@modelcontextprotocol/server ^2.0.0`（**v2**），其 `index.d.cts` **已导出 P3-4/P3-5/P3-6 全部所需类型符号**（`TRACEPARENT_META_KEY`、`Task`/`CreateTaskResult`、`SubscribeRequest`/`SubscriptionsListenRequest` 等）。三项无 SDK 阻塞。
> - **P3-2 killProcessTree 已超额完成**：表格把「多阶段 Dockerfile」和「killProcessTree」并列，实测 `src/core/process-state.ts` 已实现双平台 kill tree + orphan 扫描 + 全系统扫描 opt-in，覆盖所有 spawn Godot 的位置（launch_editor 的 detached 是设计例外并已文档化）。P3-2 实际只剩 Dockerfile 一半。
> - **P3-1/P3-2 版本号系统性漂移**：根 `server.json`=0.25.0、`docs/distribution/server.json`=0.20.0、`Dockerfile`=0.24.0，而 `package.json`=0.25.7。根因是 `scripts/version-sync.mjs` 的 `TARGET_FILES` 不含 server.json/Dockerfile，CI gate 拦不住。一个改动可同时收口两项。
>
> 完整逐项证据见下文第一部分。

---

## 1. 逐项核查结论

### P3-1：Smithery yaml + server.json 新格式

**现状判定：部分落地（~60%）**

| 子项 | 现状 | 证据 |
|------|------|------|
| `server.json`（根） | 已有，schema 最新（2025-12-11） | `server.json:2` `$schema` 日期；version=**0.25.0**（落后 package.json 0.25.7 共 7 个 patch） |
| `smithery.yaml` | **已主动删除** | commit `45ae90e`「移除 smithery.yaml（Smithery 在线渠道砍掉，坚守离线定位）」；`smithery.json:7` 保留 `"localOnly": true` |
| 两份 server.json 分裂 | 根 0.25.0 / `docs/distribution` 0.20.0 | `check-tool-count.mjs:76` 读的是后者（更旧） |
| version 同步 | **未纳入** version-sync/CI | `scripts/version-sync.mjs:20` `TARGET_FILES` 只覆盖 packageJson/manifest/pluginCfg/guide/changelog/readme |

**Gap**：根 server.json version 漂移（0.25.0→应 0.25.7）；两份 server.json 需定真相源；smithery.yaml 已主动放弃（项目定位转离线，非 gap）。

**工作量复核**：原表 **XS** → 确认 **XS**（version-sync.mjs 加 server.json/Dockerfile 两行 + 正则 + 同步一次 version，~30 行）。

---

### P3-2：多阶段 Dockerfile + killProcessTree

**现状判定：killProcessTree 已完整落地（强）；Dockerfile 单阶段、版本落后、无 .dockerignore（弱）**

**killProcessTree 侧（已完成，剩 0 工作量）**：
- `src/core/process-state.ts:22-49`（forceKillTree：Windows `taskkill /F /T` + POSIX `pkill -P`，含 uncaughtException 防护）
- `process-state.ts:62-76`（killPidTree，按 PID）
- `process-state.ts:378-399`（killOrphanGodotProcesses，orphan 扫描，两层：默认集合扫描 + opt-in `GODOT_MCP_FULL_SYSTEM_SCAN=true` 全系统扫描）
- `GodotServer.ts:411-414,424`（60s 定时器调 orphan 扫描）
- spawn 接入核查：gdscript-executor / runtime(run_project/record) / godot-spawn / blender-spawn / screenshot / spawn-helper **全部接入**；唯一例外 launch_editor（`runtime.ts:128` detached + unref，`process-state.ts:136` 注释明确「设计如此，用户有意长期运行」）

**Dockerfile 侧**：
- `Dockerfile:6` `FROM node:18-slim`（单阶段）；`Dockerfile:9` `npm install -g godot-mcp-enhanced@0.24.0`（硬编码，落后 0.25.7）
- 用途注释明确：仅供 Glama/MCP 目录 introspection（initialize + tools/list），非生产部署镜像
- 无 `.dockerignore`、无 `docker-compose.yml`

**Gap**：Dockerfile 多阶段化 + .dockerignore + version 自动同步。killProcessTree 无 gap。

**工作量复核**：原表 **S** → 修正 **XS-S**（killProcessTree 已白送；Dockerfile 单文件重写 + .dockerignore + version-sync 加一行，偏小）。

---

### P3-3：HTTP transport（--http 模式）

**现状判定：完全未做**

- `GodotServer.ts:406-409` 100% 走 `StdioServerTransport`
- 全仓 grep 无 `StreamableHTTPServerTransport` / `@modelcontextprotocol/server/http` / express / fastify server 端痕迹
- `src/cli/router.ts:8` 子命令仅 setup/doctor/init/dashboard；`index.ts:60-72` 参数仅 --profile/--minimal/--lite/--overrides，无 --http/--port/--transport
- `package.json` 无 HTTP 相关依赖
- 半截路资产：`instance-api-auth.ts` 的 HMAC token 签发/校验（send-side 已有，`GodotServer.ts:326` 注释已点出 server-side middleware 缺口）、`instance-router.ts` fetch 客户端可复用为样板

**工作量复核**：原表 **M** → 确认 **M**（三项里唯一名副其实还剩 M 的）。改动：GodotServer.run() 分流 + transport 模块 + CLI 参数 + 鉴权 middleware wire + session 测试 + 与 P3-2 Dockerfile 耦合。

---

### P3-4：SEP-414 Trace Context (OTel)

**现状判定：完全未做（SDK 已就绪，无阻塞）**

- `package.json` 无 opentelemetry 依赖（`package-lock.json` 的 `@opentelemetry/api@^1.9.0` 是 SDK 间接依赖，非 enhanced 引入）
- src grep `opentelemetry|otel|traceparent|TRACEPARENT_META_KEY` 零命中
- SDK `index.d.cts` 已导出 `TRACEPARENT_META_KEY`/`TRACESTATE_META_KEY`/`BAGGAGE_META_KEY`（SEP-414 W3C Trace Context 透传载体，SDK 内部已解析转发）
- 现有 logger（`src/core/logger.ts:529`）无 requestId/correlationId/traceId 透传；`ToolDispatcher.ts:229` 已读 `mcpReq.envelope`，`logger.ts:510` 注释「HTTP 多请求场景（P3-3）需升级 AsyncLocalStorage」——接 trace 有现成挂载点

**工作量复核**：原表 **S** → 确认 **S**（SDK 做了重活，enhanced 只需引 `@opentelemetry/api` + 入口 `propagate.extract()` + 包 span tracer）。

**是否值得做：低-中**
- enhanced 是 stdio 单连接本地工具，分布式 trace 收益有限；仅 P3-3 HTTP 多请求场景才有真实价值
- **客户端侧断点**：Claude Desktop/Cursor 等目前几乎不在调用时注入 traceparent，server 单独接 OTel 形不成完整调用链

---

### P3-5：Tasks 扩展（长任务异步）

**现状判定：完全未做（SDK 已支持，P2-5 extensions 框架已声明）**

- src grep `task.create|ListTasks|CreateTask|TaskCreationParams|RELATED_TASK_META_KEY` 零命中
- P2-5 已落地（commit `ff45af5`，`GodotServer.ts:138-144` 声明 `extensions: { 'io.godot-mcp/runtime-bridge': {...} }`，注释「待 method routing 成熟」）
- SDK 已导出 `Task`/`TaskMetadata`/`TaskStatus`/`CreateTaskResult`/`GetTask*`/`ListTasks*`/`CancelTask*`/`TaskStatusNotification`/`RELATED_TASK_META_KEY`
- **现有长任务全是同步 await 阻塞**：android export `EXPORT_TIMEOUT_MS=300_000`（5 分钟，`android.ts:33`）、run_project 默认 30s（`runtime.ts:110`）、csv_to_resources 默认 60s
- progress 通知机制已有（`src/core/progress.ts:36` `notifications/progress`），但**仅 workflow.ts 一个工具实际调用**（`workflow.ts:301/325/361/371/440`）；9 个 longRunning 工具（实测 capability-matrix `longRunning:true` = **8 处**）全不发 progress
- **唯一不确定性**：SDK 虽导出 Task 类型，extensions method routing 成熟度需验证（`GodotServer.ts:137` 注释暗示）

**工作量复核**：原表 **L** → 确认 **L**（task 状态机 + 持久化 + 8 个 longRunning 工具改「创建 task→异步→轮询/取消」+ 客户端配合）。

**是否值得做：中**
- 5 分钟 Android export 阻塞是真实痛点；但这些任务**最终都需同步收果**（export 完才有 APK），异步化收益主要在「中途可取消 + 并行多任务」
- **客户端生态风险**：Claude/Cursor 是否支持 task 轮询协议不明朗；P2-5 注释点出 method routing 待成熟

---

### P3-6：Triggers 用 subscriptions/listen 过渡

**现状判定：部分落地（notification 通道已用，但 subscriptions handler 缺失，长连接仍是 client 轮询）**

- src grep `subscribe|SUBSCRIPTION_ID_META_KEY|SubscriptionsListen` 仅 2 处**注释**命中（`GodotServer.ts:272`「modern 用 subscriptions/listen」、`EditorToolExecutor.ts:26`「re-subscribe」指 editor WS 内部）——**enhanced 自身无 MCP subscriptions 实现**
- SDK 已导出 `SubscribeRequest`/`UnsubscribeRequest`/`SubscriptionsListenRequest`/`SubscriptionsAcknowledgedNotification`/`SUBSCRIPTION_ID_META_KEY`/`SubscriptionFilter`
- **server→client notification 通道已存在并使用**：`notifications/progress`（progress.ts:36）、`notifications/tools/list_changed`（tool-registry.ts:369 / GodotServer.ts:398）、logging（P1-7 已声明 logging capability）
- **两个长连接都是 client 轮询，非 server 主动推**：
  - game-bridge（TCP）：`monitor.start→monitor.poll→monitor.stop` / `watch.start→watch.poll→watch.stop`（`game-bridge.ts:786-812`），events 在 bridge 端缓冲，client 反复 poll 拉取
  - editor WS：`sync_start→get_scene_tree`（`editor-sync.ts:17-40`，description「get current snapshot」），同样启动监听 + 客户端拉快照

**工作量复核**：原表 **M** → 确认 **M**（把 game-bridge monitor/watch + editor sync 从 poll 改造成「事件到达→主动 notification + subscription 注册表」，两个连接改造范围可控）。

**是否值得做：中-高（三项里对 enhanced 实际价值最高）**
- game-bridge 的 watch.poll（信号监听）/ monitor.poll（属性监听）当前要求 AI 反复发 tool call 拉取，延迟高、token 浪费、易错过瞬时事件
- runtime 测试场景（敌人死亡/分数到达/动画完成）强烈依赖事件主动通知；editor 场景树变化同理
- subscriptions（listChanged / resources/subscribe）是 MCP 既有规范，比 Triggers WG 草案成熟；客户端对 `notifications/*` 已普遍支持（enhanced 已在用且工作正常）

---

### P3-7：C# / .NET 支持

**现状判定：部分落地（阶段一 ~50%、阶段二 ~30%、阶段三 0%）**

逐工具对照老规划 `docs/plans/csharp-support-plan.md`（2026-05-25）三阶段：

| 工具 | .cs 现状 | 证据 file:line | 完成度 |
|------|---------|---------------|-------|
| read_script | 支持，走 C# 分支提取 namespace/class_name/extends，输出 `language:'csharp'`；**缺 using 列表** | `script.ts:350-371` | ~80% |
| write_script | 支持（写无守卫）；仅 `.endsWith('.gd')` 才 lint，.cs 跳过；返回文案不区分 C# | `script.ts:408,415,434` | ~90% |
| edit_script | 编辑可用，但**自动验证回滚对 .cs 不生效**（godotPath=null 短路，提示「Auto-validate only supports .gd」） | `script.ts:457,500,544,669,686-688` | ~50% |
| validate_scripts | 自动扫描 .cs → 检测 .csproj → `dotnet build --no-restore`；**只报整体「N 个 .cs files」无法定位具体文件**；`scripts` 参数不过滤 C# 块 | `validation.ts:904-931` | ~60% |
| generate_test | **完全不支持**（纯 GDScript 正则 + GUT 模板） | `script.ts:719-738,758-776` | 0% |
| project_replace | **不支持且禁止**（`ALLOWED_EXTENSIONS` 白名单无 .cs，显式传也会被 filter 拒） | `script.ts:864,866-870` | 0%（与老规划目标相反） |
| execute_gdscript | N/A（架构限制正确），但**缺 .cs 检测提示** | `script.ts:832-858` | 0%（提示缺失） |

辅助文件 `src/core/dotnet-detector.ts`、`src/tools/csharp-lint.ts`、`src/tools/csharp-validator.ts` **均不存在**。

**Gap**：read 补 using；edit 验证回滚接 dotnet build；validate 解析输出到文件级；project_replace 白名单加 .cs（1 行，与老规划对齐）；generate_test 加 NUnit 模板；execute_gdscript 加 .cs 提示；dotnet-detector 基础设施。

**工作量复核**：原表 **L** → 确认 **L**（已落地 ~400 行等价工作量，剩 ~600 行核心 + 单测 + 跨平台 dotnet 检测 + 真实 .NET 项目验证）。

**是否值得做：中-低**
- 无 telemetry 数据（`docs/telemetry.md:36-46` 红线禁收文件路径/项目名），合理推断 C# 用户占比 ~15-25%（GDScript 主力 >80%）
- 但 C# 用户多为资深团队、项目复杂度高，对 AI 工具链诉求强度可能高于均值
- 建议：优先做阶段一剩余（project_replace 白名单 + edit 验证回滚，高 ROI 低工作量），generate_test/NUnit 延后

---

## 2. 选做建议（按 ROI 排序的批次）

> 基于核查结论，按「价值 ÷ 剩余工作量」排序。P3 全部可选，**不强求全做**。

### 第一批：版本同步收口（XS，立即做，零风险）

**合并 P3-1 的 version 漂移修复 + P3-2 的 Dockerfile version 修复**——根因相同（version-sync.mjs 不覆盖分发产物）。

| 子任务 | 工作量 | 改动 |
|--------|--------|------|
| version-sync.mjs 加 server.json（根）+ Dockerfile 到 TARGET_FILES | XS | ~30 行 + 正则 |
| 同步根 server.json 0.25.0→0.25.7、Dockerfile 0.24.0→0.25.7 | XS | 一次性 |
| 决定两份 server.json 真相源（建议根为准，docs/distribution 删或重定向） | XS | — |
| CI gate（`ci.yml:46` 已跑 --check）自动覆盖 | 0 | 现有 gate 即可拦截 |

**ROI**：极高（修一个系统性 bug，同时关掉 P3-1/P3-2 的 version 子项）。smithery.yaml 不恢复（项目已定离线定位）。

### 第二批：P3-6 subscriptions/listen（M，价值最高，建议做）

三项里对 enhanced 实际价值最高。把 game-bridge 的 watch/monitor 和 editor 的 scene-tree 从 client 轮询改成 server 主动 notification。

**风险**：客户端对 subscriptions/listen 的支持度需实测（但 `notifications/*` 通道 enhanced 已在用且工作正常，过渡方案可行性强）。

### 第三批：P3-7 C# 阶段一收尾（XS-S，低成本低风险）

只做高 ROI 部分：project_replace 白名单加 .cs（1 行）+ edit_script 对 .cs 接 dotnet build 验证回滚 + read_script 补 using 列表。generate_test/NUnit 延后。

### 暂缓：P3-3 HTTP / P3-4 OTel / P3-5 Tasks

| 项 | 暂缓理由 |
|----|---------|
| P3-3 HTTP（M） | 工作量真 M，且 enhanced 定位本地 stdio 工具，远程部署需求未明确。若做，应与 P3-2 Dockerfile 生产化 + P3-4 OTel 一起做（三者耦合） |
| P3-4 OTel（S） | 客户端侧不注入 traceparent，server 单独接 OTel 形不成完整链路。价值依赖 P3-3 HTTP 落地后才显现 |
| P3-5 Tasks（L） | 工作量真 L，客户端 task 轮询协议支持度不明，extensions method routing 成熟度有不确定性。8 个 longRunning 工具改造量大 |

### 明确不做

沿用 ecosystem plan 第 105-111 行的 3 项（Rust 重写 / C++ GDExtension / 297KB 单文件架构），理由不变。

---

## 3. 仓库级约束自查（AGENTS.md 要求）

本 plan 是核查 + 选做文档，**不写代码**，暂不触发以下约束。但第一批一旦落地需注意：

- **「分发产物与独立副本边界」**：server.json / Dockerfile 是分发产物，version 改动走 version-sync.mjs（改源），不手改产物——本 plan 第一批正是修这个机制。
- **「独立副本同步约束」**：本 plan 不涉及 `.claude/rules/` 与 `rule-templates.ts`，无同步义务。
- **capability-matrix**：本 plan 不改工具清单，无需 `npm run build-matrix`。

---

## 4. 快照证据（落盘前 node/grep 实测，2026-08-06）

| 快照 | 值 | 核查命令 |
|------|----|---------|
| package.json version | **0.25.7** | `node -e "console.log(require('./package.json').version)"` |
| 根 server.json version | **0.25.0** | `node -e "console.log(require('./server.json').version)"` |
| docs/distribution/server.json version | **0.20.0** | `node -e "console.log(require('./docs/distribution/server.json').version)"` |
| Dockerfile 版本 | **0.24.0** | `grep -oE "godot-mcp-enhanced@[0-9.]+" Dockerfile` |
| capability-matrix 工具数 | **38** | `node -e "console.log(require('./docs/capability-matrix.json').tools.length)"` |
| longRunning:true 计数 | **8** | `grep -c '"longRunning":\s*true' docs/capability-matrix.json` |
| SDK 版本 | **^2.0.0** | `node -e "console.log(require('./package.json').dependencies['@modelcontextprotocol/server'])"` |
| version-sync TARGET_FILES 含 server.json? | **否** | `grep -n "server.json\|Dockerfile" scripts/version-sync.mjs`（零命中） |

> 注：核查 agent 报告 longRunning 为 9 处，实测 grep -c 为 8。本 plan 用实测值 8。

---

## 5. 待用户拍板的决策点

1. **第一批是否立即做？**（版本同步收口，XS，零风险，建议做）
2. **P3-6 subscriptions/listen 是否纳入近期计划？**（M，价值最高，但有客户端支持度风险）
3. **P3-7 C# 收尾做到哪？**（建议只做阶段一高 ROI 部分，generate_test 延后）
4. **P3-3/P3-4/P3-5 是否暂缓？**（建议暂缓，等需求明确 / 客户端生态成熟）
5. **两份 server.json 哪份为准？**（建议根为准，docs/distribution 删除或改为说明文档）

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-06 | 初版，3 路并行 Explore 只读核查 + 选做建议，不写代码 |
