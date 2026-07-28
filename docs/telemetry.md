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
| `error_category` | string? | 失败时附加：`Error.name` 经白名单脱敏（仅 `[A-Za-z0-9_.-]`，截断 64），**绝不携带原始 `message`** |
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

- **队列**：进程内数组，上限 `QUEUE_MAXSIZE = 500`，满时丢新事件（保业务关键旧事件）
- **发送**：`setTimeout(flush, 0)` 异步 fire-and-forget，批量 POST 到 `GODOT_MCP_TELEMETRY_ENDPOINT`
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
- **网络请求**：`:86` `fetch(REGISTRY_URL, ...)`，5 秒超时
- **缓存**：24 小时 TTL，缓存文件 `~/.godot-mcp/update-cache.json`，缓存命中则不发网络请求
- **发送的数据**：仅 HTTPS GET 请求 npm registry（标准 npm registry GET，不附 body、不附 install UUID、不附任何自定义 header）。npm registry 服务端会记录请求 IP / UA（fetch 默认 User-Agent），这些由 npmjs.org 服务端策略控制，**本仓库不可控**
- **失败静默**：网络失败 / 超时 / 解析失败均 `catch {}` 吞掉，不影响 MCP 启动

### 当前**无** env 门控（诚实声明）

> 截至本文档撰写时（commit 19a35ab + Task 5 docs），**`update-checker.ts` 没有任何环境变量门控**。
> 已用 `grep -r GODOT_MCP_UPDATE_CHECK src/` 全仓库搜索确认：**零匹配**。
> 也就是说：
>
> - 没有 `GODOT_MCP_UPDATE_CHECK=false` 之类的 opt-out 开关
> - 每次 MCP server 启动都会查 npm registry（24h 缓存命中则不发网络请求，但仍读本地缓存文件）
> - 这与「默认零外传」的遥测声明是**冲突的硬伤**——遥测默认关闭，但 update-checker 启动即外传
>
> **本 PR（Task 5）只做文档披露，不改 update-checker 行为**。补 env 门控（如 `GODOT_MCP_UPDATE_CHECK=false`）属于未来 PR 的范围。在此期间，若你需要完全离线运行：
>
> 1. **防火墙阻断** `registry.npmjs.org`（最彻底，但也阻断 npm install）
> 2. **预置缓存**：手动写 `~/.godot-mcp/update-cache.json` 为 `{ "lastCheck": <未来时间戳>, "latest": "<当前版本>" }`，则 24h 内 `readCache` 命中、跳过 fetch（注意 `lastCheck` 是 `Date.now()` 毫秒时间戳）
> 3. **设代理**：通过 HTTPS proxy 拦截或重写该请求
>
> 以上均为 workaround，**非官方支持的 opt-out**。未来 PR 补 env 门控后会同步更新本段。

---

## 相关代码

| 模块 | 路径 | 职责 |
|------|------|------|
| Config | `src/telemetry/config.ts` | opt-in 判定（CI 强制 false）+ install UUID 管理 |
| Sanitize | `src/telemetry/sanitize.ts` | `hashProject` / `safeErrorCategory` / `sanitizeVersion` |
| Collector | `src/telemetry/collector.ts` | fire-and-forget 队列 + flush，endpoint 空=零外传 |
| Index | `src/telemetry/index.ts` | re-export |
| Middleware 接入 | `src/core/dispatcher/ToolDispatcher*.ts` | after-hook：每次 tool 调用后 record |
| Feature flag | `src/core/feature-flags.ts` | `FEATURES.TELEMETRY`（env `GODOT_MCP_TELEMETRY`，default `false`） |

---

## 后续阶段（规划，非当前实现）

- **阶段 0（当前）**：骨架 + 默认关闭 + endpoint 空 = 零外传。仅本地积累队列（仅内存）。
- **阶段 1（未来 PR）**：接入收集服务（自建 PostHog / Plausible / 自托管），定默认 endpoint，补隐私 policy 链接。
- **阶段 2（未来 PR）**：聚合看板（工具使用频次 / 错误率 Top N / 版本分布），仅项目维护者可见。
- **update-checker env 门控（独立 PR）**：补 `GODOT_MCP_UPDATE_CHECK=false` opt-out，让默认零外传声明对所有外传点都成立。

阶段 1+ 均会同步更新本文档与 CHANGELOG，并通过 `setup_project_rules` 写入 `.claude/rules/` 让 AI 在使用本工具时知晓当前阶段。
