---
date: 2026-07-08
topic: mcp-logging
status: draft
related:
  - docs/superpowers/plans/2026-07-08-mcp-logging.md
  - 2026-07-08-server-instructions-design.md（同"协议级细粒度特性"主题）
  - 2026-07-07-mcp-roots-dynamic-auth-design.md（oninitialized 先例）
source: 2026-07-07 三轮调研 P1 候选（官方 MCP servers 借鉴）
---

# MCP Logging 协议注入设计

## 1. 背景与动机

2026-07-07 三轮调研 P1 候选「MCP Logging 协议」（官方）：

- MCP 协议规定 server 可经 `sendLoggingMessage({level, logger, data})` 向 client 推送日志，client 按 level 收（`notifications/message`）。SDK 低层 `Server` 提供 `server.sendLoggingMessage(params)`（`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:751` + `protocol.js`）。
- 本项目 `src/core/logger.ts` 当前**双写 JSONL 文件 + stderr**，**完全没走 sendLoggingMessage** —— client（Claude Code / Cursor 等）收不到任何 server 端日志，调试时只能看本地文件。
- `getLogger()` 在 `src/` 有 **143 处调用**（debug/info/warn/error + toolStart/toolEnd），改动 `writeEntry` 一处即可全覆盖。
- 注入先例：`GodotServer.ts:107` `setMcpServer(server)` 已把 MCP Server 实例注入 `tool-registry`；`GodotServer.ts:219` `oninitialized` 回调（MCP Roots `initRootsIntegration`）是 client 就绪信号先例。

**价值**：client 按级别接收 server 端 warn/error，实时可观测异常（路径拒绝、密钥问题、Bridge 断连、工具超时等），不必翻本地日志文件。

## 2. 目标

1. MCP server 经 `sendLoggingMessage` 向 client 推送 **warn + error** 级日志（默认）。
2. 接入对现有 143 处 logger 调用**零侵入**——只改 `writeEntry` 一处 + 加注入接口。
3. **失败安全**：sendLoggingMessage 失败/未注入/client 未就绪时静默退化，绝不影响主流程或现有文件/stderr 双写。
4. **现有 3604 测试零回归**——测试默认不注入 server，logger 行为不变。

## 3. 非目标（YAGNI，明确不做）

- ❌ `setLevel` handler（MCP `notifications/setLevel`）——让 client 动态调最低 level。**留 follow-up**，本版本 server 端固定 warn+error。
- ❌ 发 debug / info / toolStart / toolEnd（量太大，client 有工具结果流）。
- ❌ 节流 / 去重 / 速率限制——warn+error 是异常量小；循环 warn 是 bug，该修不是节流。
- ❌ 替代现有文件 + stderr 双写——`sendLoggingMessage` 是**增量第三写**。

## 4. 架构

```
logger.writeEntry(entry)
   ├─ 现有: buffer.push + stderr 双写（不变）
   └─ 新增: emitToClient(entry)
              ├─ guard: _mcpServer && _clientReady && level∈{warn,error}
              ├─ level 映射: warn→warning, error→error
              └─ _mcpServer.sendLoggingMessage({level, logger, data})
                   └─ fire-and-forget + .catch(()=>{})  （日志不阻塞主流程）

GodotServer 构造 → setLoggerServer(this.server)（:107 setMcpServer 旁）
GodotServer.oninitialized → setLoggerClientReady(true)（:219 现有回调体内）
GodotServer.close → setLoggerServer(null) + setLoggerClientReady(false)
```

**一句话**：`writeEntry` 三写——文件、stderr、（条件满足时）MCP client。条件由「server 已注入」+「client 已 initialize」+「级别 ≥ warn」三者守卫。

## 5. 组件（4 处改动）

### 5.1 `src/core/logger.ts` 加注入接口（模块变量 + setter）

顶部加 `import type { Server } from '@modelcontextprotocol/sdk/server.js';`

模块级（`instance` / `_singletonWarned` 旁）加：

```ts
let _mcpServer: Server | null = null;
let _clientReady = false;

/** 注入 MCP Server 实例（GodotServer 构造时调）；null 清除（close/测试隔离） */
export function setLoggerServer(server: Server | null): void {
  _mcpServer = server;
}

/** 标记 client 是否已完成 initialize（oninitialized 时设 true）；未就绪不发，避免 SDK 报错 */
export function setLoggerClientReady(ready: boolean): void {
  _clientReady = ready;
}
```

### 5.2 `src/core/logger.ts` 加 `emitToClient` + `writeEntry` 调用

模块级纯函数（读模块级 `_mcpServer` / `_clientReady`，不进 `createLogger` 闭包，便于独立测试）：

```ts
/** MCP LoggingLevel 子集映射：本项目 4 级 → MCP 8 级 */
function toMcpLevel(level: LogLevel): 'warning' | 'error' | null {
  if (level === 'warn') return 'warning';
  if (level === 'error') return 'error';
  return null;  // debug/info 不发 client
}

/** 增量第三写：按条件向 MCP client 推送 warn/error。失败静默。 */
function emitToClient(entry: LogEntry): void {
  if (!_mcpServer || !_clientReady) return;
  const mcpLevel = toMcpLevel(entry.level);
  if (!mcpLevel) return;  // debug/info
  const data: Record<string, unknown> = { msg: entry.msg, module: entry.module };
  if (entry.tool) data.tool = entry.tool;
  if (entry.meta) data.meta = entry.meta;
  try {
    const p = _mcpServer.sendLoggingMessage({ level: mcpLevel, logger: entry.module, data });
    if (p && typeof (p as Promise<unknown>).catch === 'function') {
      (p as Promise<unknown>).catch(() => {});  // async reject 静默
    }
  } catch {
    // 同步 throw 静默（如 SDK 内部参数校验）
  }
}
```

`writeEntry`（`:232`）末尾、`buffer.push` + stderr 之后加一行：

```ts
emitToClient(entry);
```

### 5.3 `src/core/logger.ts` `close` / 单例清理

`resetLogger`（`:443`）补清理（测试隔离）：

```ts
export function resetLogger(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
  _mcpServer = null;      // 新增
  _clientReady = false;   // 新增
}
```

### 5.4 `src/GodotServer.ts` 接线（3 处）

顶部 import：`import { setLoggerServer, setLoggerClientReady } from './core/logger.js';`

**构造**（`:107` `setMcpServer(this.server);` 下一行）：

```ts
setMcpServer(this.server);
setLoggerServer(this.server);   // 新增：logger 三写
```

**oninitialized**（`:219` 现有 `this.server.oninitialized = async () => {...}` 回调体**首行**加，不覆盖 MCP Roots `initRootsIntegration` 既有逻辑）：

```ts
this.server.oninitialized = async () => {
  setLoggerClientReady(true);   // 新增首行
  // ... MCP Roots 既有 initRootsIntegration 逻辑（listRoots 等）保持不变
};
```

**close**（`resetLogger`/清理段，与 `setMcpServer` 清理对称）加：

```ts
setLoggerServer(null);
setLoggerClientReady(false);
```

> implementer 需读 `GodotServer.ts:219` 确认现有 oninitialized 结构，在体内首行插入，不破坏 MCP Roots 逻辑。

## 6. 数据流

| 阶段 | 触发 | 动作 |
|------|------|------|
| 启动 | `new GodotServer()` 构造 | `setLoggerServer(server)` 注入；`_clientReady=false`（未 initialize 前不发） |
| handshake | client 发 initialize | SDK 握手 |
| 就绪 | `oninitialized` 回调 | `setLoggerClientReady(true)` —— 此后 warn/error 可发 |
| 运行 | 任意 `getLogger().warn/.error(...)` | `writeEntry` → 文件+stderr（不变）+ `emitToClient` → `sendLoggingMessage` → client |
| 关闭 | `server.close()` | `setLoggerServer(null)` + `setLoggerClientReady(false)` |

**MCP 协议侧**：`sendLoggingMessage` → client 收 `notifications/message`（含 level/logger/data）→ client 按 level 展示/过滤。

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| 未注入 server（`_mcpServer=null`，如测试环境） | `emitToClient` 直接 return，零开销 |
| client 未 initialize（`_clientReady=false`） | return，避免 SDK "未连接发消息" 报错 |
| level 是 debug/info | `toMcpLevel` 返 null，return |
| `sendLoggingMessage` 同步 throw | try/catch 静默 |
| `sendLoggingMessage` async reject | `.catch(()=>{})` 静默 |
| `sendLoggingMessage` 成功 | client 收 notification；主流程不 await（fire-and-forget） |

**核心不变量**：日志发送失败**绝不**影响 `writeEntry` 的文件/stderr 双写或主流程。日志是观测层，不是业务路径。

**安全不变量**：`emitToClient` 发送的 `data.msg` / `data.meta` 是 `log()`（logger.ts:309）经 `sanitizeMsg`（:128）/ `sanitizeMeta`（:105）**脱敏后**的内容（敏感 key=value → `***`，P2-10 已加固）。`entry` 进入 `writeEntry` 时已脱敏，故 MCP notification 不会把 secret 二次泄露给 client——与现有文件/stderr 双写同等安全。

## 8. 测试策略

新建 `test/core/logger-mcp-logging.test.ts`（沿用 `test/core/*.ts` 惯例）：

1. **warn/error 触发**：`setLoggerServer(mockServer)` + `setLoggerClientReady(true)` → `getLogger().warn(...)` / `.error(...)` → 断言 `mockServer.sendLoggingMessage` 被调，params 含正确 level（warning/error）+ logger=module + data。
2. **info/debug 不触发**：同上注入，`.info(...)` / `.debug(...)` → `sendLoggingMessage` **未**被调。
3. **未就绪不发**：`setLoggerServer(mockServer)` + `setLoggerClientReady(false)` → `.warn(...)` → 未调。
4. **未注入不发**：`_mcpServer=null`（默认）→ `.warn(...)` → 未调（亦证明现有 3604 测试零回归）。
5. **async reject 静默**：mock `sendLoggingMessage` 返 `Promise.reject(...)` → `.warn(...)` 不抛、不导致进程 unhandled rejection。
6. **同步 throw 静默**：mock `sendLoggingMessage` throw → `.warn(...)` 不抛。
7. **level 映射**：warn→`'warning'`、error→`'error'`（断言 params.level）。
8. **toolStart/toolEnd 不发**：`logger.toolStart(...)` / `toolEnd(...)`（info 级）→ `sendLoggingMessage` 未调。
9. **resetLogger 清理**：`resetLogger()` 后 `_mcpServer=null` / `_clientReady=false`（后续 warn 不发）。

**Mock 模式**：`vi.fn()` mock Server 的 `sendLoggingMessage`；每个 it 前 `resetLogger()` + 重置 mock（避免跨测试污染）。不 mock 整个 SDK 模块（只 mock 实例方法），避开 vitest 4 ESM/Linux mock 坑（[[vitest-4-node22-mock-isolation]]）。

**回归**：现有 `test/core/*.test.ts` + 全量 3604 测试默认不注入 server → `_mcpServer=null` → `emitToClient` 直接 return → 零行为变化。defects baseline 不变。

## 9. 影响面

- **代码**：2 文件（`src/core/logger.ts` 加注入接口 + emitToClient + writeEntry 一行 + resetLogger 清理；`src/GodotServer.ts` 3 处接线）。
- **运行时行为**：仅在 MCP server 运行 + client 已 initialize 后，warn/error 额外推 client。无 server 运行时（如纯库使用）零变化。
- **依赖**：零新增（`Server` type 从已有 SDK import）。
- **测试**：新增 1 测试文件（~9 用例）。
- **defects**：不触及任何 detect 路径（baseline 计数不变）。

## 10. 验收标准

- [ ] `getLogger().warn/.error` 在 server 注入 + clientReady 时触发 `sendLoggingMessage`（level=warning/error）
- [ ] `getLogger().info/.debug` 及 `toolStart/toolEnd` 不触发
- [ ] clientReady=false / server 未注入时不触发
- [ ] `sendLoggingMessage` throw / reject 静默，不影响 `writeEntry` 文件+stderr 双写或主流程
- [ ] `tsc` exit 0；`npm test` 全绿（新增 ~9 用例，3604 基线零回归）；`npm run lint` 0
- [ ] GodotServer.oninitialized 接线不破坏 MCP Roots `initRootsIntegration`（既有 roots 测试绿）

## 11. 后续 follow-up（不在本 spec 范围）

- **`setLevel` handler**：注册 `SetLevelRequestSchema` handler，维护 client 当前 level（默认 warning），`emitToClient` 按 client level 动态过滤。让 client 可调级（如临时开 info 看工具流）。
- **`tools/call` 业务错误也走 sendLoggingMessage**：当前 `toolEnd` 错误是 info+error 级混合，本版本 toolEnd 不发（量太大）；follow-up 可对失败 toolEnd（err 非空）单独发 error 级。
- **MCP client 展示验证**：在 Claude Code / inspector 实测 client 是否展示 logging notification（协议支持 ≠ client UI 展示）。
