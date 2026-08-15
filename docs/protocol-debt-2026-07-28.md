# MCP 2026-07-28 规范对齐债与决策记录

> **建立日期**：2026-08-15（v0.30 D 批）
> **背景**：MCP `2026-07-28` 规范正式废弃 Roots / Sampling / Logging（12 个月窗口，SEP-2577），Tasks 转正为扩展（SEP-2663），MCP Apps 进入 extensions 框架（SEP-1865）。本文记录 enhanced 对每一项的实测影响面、v0.30 处置与后续计划。
> **SDK 基线**：`@modelcontextprotocol/server` 2.0.0（re-export core 2.0.0）。以下 SDK 能力判断基于当日 `node_modules` dist 类型定义实测。

---

## 1. Roots —— ✅ v0.30 已退役（处置完毕）

**原用途**：server 在 `oninitialized` 拉取 client 声明的 roots（`listRoots()`），解析 `file://` URI 后**整体替换** `ALLOWED_PROJECT_PATHS` 作为路径白名单（"client 是授权权威"信任模型）。

**实测影响面**：
- modern era（2026-07-28 协议）下 `listRoots()` 直接 throw（SDK `_assertPushApiInServedEra`）、`oninitialized` 不触发——**modern 客户端本就只走 env**，删除零行为变化。
- legacy（2025-era）+ 配置了 roots 的客户端：删除后回落 `ALLOWED_PROJECT_PATHS` env。SDK 弃用注释的官方迁移路径就是 configuration（env），无现代等价 push API（`server/discover` / `extensions` 是 server→client 方向，承载不了"client 授权路径给 server"）。

**处置**（v0.30 D 批）：
- 删 `GodotServer.initRootsIntegration`（原 :310-369）+ `path-utils.ts` 动态 roots 三函数（`setAllowedRootsFromClient`/`hasDynamicRoots`/`parseFileRootUris`），`getAllowedProjectPaths()` 简化为仅读 env。
- `oninitialized` 回调保留（承载与 Roots 无关的 logger/progress client-ready 信号）。
- 行为变化在 CHANGELOG 0.30.0 段声明；契约锁定：`test/core/godot-server-oninitialized.test.ts`（负向断言源码无 Roots API 引用）。

## 2. Logging —— ⏸ 窗口内保持，迁移路径已定（SEP-2577）

**实测使用点**（4 处，全部经 SDK `sendLoggingMessage`，SDK 已标 `@deprecated 2026-07-28`）：
| 位置 | 用途 |
|------|------|
| `src/GodotServer.ts:537,555`（原行号，P1-7 改造后） | server 级 warn/error 推送（正规 SDK 路径） |
| `src/core/logger.ts:200` | 无 per-request logFn 时的降级推送 |
| `src/core/EditorConnectionManager.ts:227` | editor 事件通知转发 |

**不受影响面**：工具调用内日志走 `ctx.mcpReq.log`（per-request envelope logLevel，P1-7/SEP-2577 已改造）；`logging/setLevel` 是 SDK 声明 logging capability 后自动注册的内置 handler（`test/k-subscribe-setlevel.test.ts` 锁定）。

**决策**：12 个月窗口内不动代码（仍工作，SDK 承诺窗口内兼容）。到期前（≈2027-07）迁移：server 级 warn/error 改 **stderr**（SDK 官方迁移方向；enhanced 的 stderr 已用于 diagnostics 通道）。届时同步调整 `logger.ts` 降级路径与 `EditorConnectionManager` 事件转发，并在 `docs/telemetry.md` 披露。

## 3. Sampling —— ✅ 零使用，零影响

全仓 `src/` 无 `sampling/createMessage` 调用（2026-08-15 grep 实测）。视觉链路不走 sampling：`src/core/vision-router.ts` 是 server 直连 groq HTTP API（`GODOT_MCP_VISION_KEY`，双重 opt-in）；`screenshot` analyze 是把 image content 放进工具结果交客户端自身视觉能力。**无需任何动作。**

## 4. Tasks 扩展 —— 🟡 SDK 仅 wire 词汇无运行时，自研 defer v0.31+

**SDK 实测**（core dist 类型定义）：`TaskSchema`/`TaskStatusNotificationSchema`/`ServerTasksCapabilitySchema` 等全套 wire schema 已导出，但 `tasks/get|result|list|cancel` 被显式排除出类型化 handler 表（`createMcpHandler` d.mts 注释原话 "Task methods are 2025-11-25 wire vocabulary with no SDK runtime"）——`setRequestHandler('tasks/…')` 无类型支持，Server 类也没有 task store / status 通知 helper。

**enhanced 诉求**：长跑操作（`export_build` 分钟级、`qa run` 套件、e2e）目前全部同步阻塞 + 大超时（`run_tests` 硬编码 120s 强杀；qa 套件预算上限 600s）。Tasks 的 durable handle + poll 天然契合。

**决策**：v0.30 不做（对抗 SDK 强转 handler + 自建任务注册表/状态机/清理的成本，超出本版范围；qa 长任务用同步 + `suite_budget_ms` 顶住）。v0.31+ 若 SDK 落地 runtime 再评估接入 `export_build`/`qa run`；自研注册表可参照 `process-state.ts` 的 `_spawnedGodotPids` + watch/monitor 的 start-poll 模式。

## 5. MCP Apps（ui://）—— 🔴 SDK 2.0.0 零支持，降级方案 defer v0.32+

**SDK 实测**：`ui:` scheme / `AppManifest` / `apps/list` / iframe / sandbox 在 server 与 core 两包 dist 中**零命中**；`resources/read` 无特殊 HTML/ui 资源类型。

**enhanced 诉求**：`src/dashboard/`（ANSI 终端 TUI，LogReader→Aggregator→render 纯数据层）是现成候选——数据层无终端依赖可直接复用，但渲染层需新写 HTML。

**降级方案**（defer）：不依赖 Apps 扩展也能做——普通 `resources/read` + 自定义 URI（如 `dashboard://`，仓库已有 `bridge://events` 先例）返回聚合 HTML/JSON + `resources/subscribe` + `notifications/resources/updated` 推刷新；聚合层需从 dashboard 子进程宿主进 server 进程（或仍读同一日志目录）。"dashboard 不在 server 加设置项"的既有约束不变。

**决策**：v0.32+ 视 SDK Apps 支持落地情况二选一（原生 Apps vs 降级 resource）。本文记录两条路径的底座评估，避免重新调研。

## 6. 其他 2026-07-28 变更（已对齐项备忘）

- 无状态核心 / MRTR / header 路由 / 可缓存 list（`ttlMs`+`cacheScope`）：P0-1/P0-2/P1-4 已在 0.26-0.28 落地。
- HTTP+SSE transport 废弃：enhanced 仅 stdio，无影响。
- `initialize` 握手退役：`server/discover` 由 SDK 按 era 自动注册（`GodotServer.ts` supportedProtocolVersions 已含 `2026-07-28`，`test/p1-3-modern-era.test.ts` 锁定）。

---

## 复核节奏

| 项 | 触发条件 |
|----|---------|
| Logging stderr 迁移 | 2027-04 前启动（预留 3 个月缓冲至 12 个月窗口关闭） |
| Tasks 接入评估 | SDK 发布 task runtime（关注 @modelcontextprotocol/server minor 版本 changelog） |
| MCP Apps | SDK 落地 ui:// 或 v0.32 规划时按本文 §5 底座评估直接选型 |
