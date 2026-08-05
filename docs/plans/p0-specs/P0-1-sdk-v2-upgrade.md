# P0-1 SDK v1 → v2 升级 spec

> **状态**：待执行
> **优先级**：P0（关键路径，解锁所有 2026 协议特性）
> **预估工作量**：L（1-2 周）
> **依赖**：无（其他 P0/P1 协议改造的上游）
> **关联文档**：[MCP 生态调研与升级方案](../2026-08-05-mcp-ecosystem-research-and-upgrade-plan.md)

---

## 1. 目标与范围

### 1.1 必做项

| # | 任务 | 当前 | 目标 |
|---|------|------|------|
| 1 | `@modelcontextprotocol/sdk` | 1.29.0（package-lock 实锁） | v2 stable（≥ 2.0.0） |
| 2 | `zod` | 3.25.76 | ≥ 4.2.0（Standard Schema 最低版） |
| 3 | Node `engines` | `>=18.0.0` | `>=20.0.0` |

### 1.2 范围内

- 替换 SDK 包结构（单包 → server/core 拆分）
- 改造 9 处 `setRequestHandler` / `setNotificationHandler` 调用
- 改造 56 处 SDK import 路径（53 个源文件，实测 `grep -rl "@modelcontextprotocol/sdk" src/ --include="*.ts" | wc -l` = 53）
- 改造 handler 签名（`extra` → `ctx: ServerContext`）
- `tsconfig.json` target/lib 适配（若需要）

> [!warning] 修订（审查报告 Nit 2）
> 原范围列有"错误类与类型迁移（`McpError` → `ProtocolError` 等）"——**删除**。实测全仓库无 SDK `McpError` / `ErrorCode` import，enhanced 的 `src/core/error-codes.ts` 与 `src/core/action-response.ts` 是**项目自定义**类型，与 SDK 无继承关系。仅当 SDK v2 的错误码**数值**发生变化时才需对齐（见 §3.4 表格末行）。

### 1.3 范围外

- MRTR 改造（独立 P0-2，依赖本 spec 完成）
- HTTP transport（enhanced 不受影响，SSE/WS 已在 v2 移除）
- zod schema 行为回归（属 zod v4 独立 PR）

---

## 2. 背景

### 2.1 为什么必须升级

- **v1 维护窗口仅到 2027-02**：之后无安全补丁，长期不可维护
- **v2 是 2026-07-28 spec 的 stable release**（非 RC），承载全部新协议特性（MRTR / 无状态协议 / Extensions / ttlMs / per-request Logging）
- **2026-era 客户端**（下一代 Claude Desktop / Cursor）默认按 v2 协议握手，v1 server 需依赖 v2 的双时代兼容层

### 2.2 v2 双时代策略（核心设计）

v2 的 `serveStdio` 默认同时服务 2025-era 与 2026-era 客户端，无需 server 端做协议版本判断：

- 2025-era 客户端（Claude Desktop / Cursor 现版本）：走旧 `elicitation/create` push 模式
- 2026-era 客户端：走 MRTR `InputRequiredResult`（见 P0-2）

**明确决策**：不使用 `legacy: 'reject'`（强制拒绝 2025 客户端会破坏现有用户）。保留双时代兼容是 enhanced 的零破坏承诺。

### 2.3 SDK v2 主要变化摘要

| 维度 | v1（当前） | v2（目标） |
|------|-----------|-----------|
| 包名 | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server` + `/core`（Zod `*Schema` 常量在 core） |
| 错误类 | `McpError` / `ErrorCode` | `ProtocolError` / `ProtocolErrorCode` |
| handler 注册 | `setRequestHandler(ZodSchema, fn)` | `setRequestHandler('method/string', fn)` |
| handler 第二参数 | 扁平 `extra: RequestHandlerExtra` | 结构化 `ctx: ServerContext`（`extra.sendRequest()` → `ctx.mcpReq.send()`） |
| elicit | `server.elicitInput(...)` 始终工作 | 2025-era 仍工作；2026-era 抛错（见 P0-2） |
| Standard Schema | 自定义包装 | 期望 `z.object(...)` 包装（zod v4.2.0+） |
| Transport | stdio / SSE / WebSocket | stdio only（SSE/WS 移除，enhanced 不受影响） |

---

## 3. 改动清单

### 3.1 `package.json`

| 字段 | 当前 | 改为 |
|------|------|------|
| `dependencies["@modelcontextprotocol/sdk"]` | `^1.29.0` | 移除 |
| `dependencies["@modelcontextprotocol/server"]` | — | `^2.0.0` |
| `dependencies["@modelcontextprotocol/core"]` | — | `^2.0.0`（若用到 Zod schema 常量） |
| `dependencies["zod"]` | 隐式（3.25.76） | `^4.2.0`（显式） |
| `engines.node` | `>=18.0.0` | `>=20.0.0` |
| `devDependencies["@types/node"]` | `^20.11.24` | 保留 20（对齐 engines） |

### 3.2 `src/GodotServer.ts`（核心改造）

| 行号 | 当前 | 改为 |
|------|------|------|
| 1 | `import { Server } from '@modelcontextprotocol/sdk/server/index.js'` | `import { Server } from '@modelcontextprotocol/server'` |
| 2 | `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'` | `import { StdioServerTransport } from '@modelcontextprotocol/server'`（或子路径，按 codemod 输出） |
| 3-13 | 9 个 `*RequestSchema` / `*NotificationSchema` 从 `/types.js` | 改用方法字符串常量（从 `@modelcontextprotocol/core` 或 server 包导出） |
| 120-126 | `new Server({ name, version }, { capabilities: {...} })` | capabilities 字段结构按 v2（可能新增 `resultTypes: ['complete', 'input_required']` 或 `extensions`） |
| 148 | `setRequestHandler(ListToolsRequestSchema, fn)` | `setRequestHandler('tools/list', fn)` |
| 152 | `setRequestHandler(CallToolRequestSchema, fn)` | `setRequestHandler('tools/call', fn)` |
| 157 | `setRequestHandler(ListResourcesRequestSchema, fn)` | `setRequestHandler('resources/list', fn)` |
| 163 | `setRequestHandler(ListResourceTemplatesRequestSchema, fn)` | `setRequestHandler('resources/templates/list', fn)` |
| 168 | `setRequestHandler(ReadResourceRequestSchema, fn)` | `setRequestHandler('resources/read', fn)` |
| 194 | `setRequestHandler(ListPromptsRequestSchema, fn)` | `setRequestHandler('prompts/list', fn)` |
| 198 | `setRequestHandler(GetPromptRequestSchema, fn)` | `setRequestHandler('prompts/get', fn)` |
| 204 | `setRequestHandler(CompleteRequestSchema, fn)` | `setRequestHandler('completion/complete', fn)` |
| 263 | `setNotificationHandler(RootsListChangedNotificationSchema, fn)` | `setNotificationHandler('notifications/roots/list_changed', fn)` |
| 252-261 | `this.server.oninitialized = async () => {...}` | v2 可能改 per-request 能力探测（属 P1-3，本 spec 仅保留兼容签名） |

### 3.3 handler 签名改造

| 文件 | 行 | 当前签名 | 改为 |
|------|-----|---------|------|
| `src/GodotServer.ts` | 148-211 | `(request) => ...` 或 `async (request) => ...`，部分 handler 隐式用 `extra` | `(request, ctx: ServerContext) => ...`；若用到 sendRequest 改 `ctx.mcpReq.send()` |
| `src/core/logger.ts` | 155 | `_mcpServer.sendLoggingMessage(...)` | 检查 v2 是否保留该方法名；若改名（如 `ctx.mcpReq.log()`）适配 |
| `src/core/progress.ts` | 36-37 | `_progressSender.notification({ method: 'notifications/progress', ... })` | v2 progress 通知格式可能变（per-request token 注入方式） |
| `src/core/elicit.ts` | 47 | `_elicitServer.elicitInput({...})` | v2 2025-era 仍工作（保留）；2026-era 改造属 P0-2 |

> **注**：logger/progress 是模块级单例注入 `Server` 实例，handler 签名变化对其影响有限（它们调的是 Server 实例方法，不是 request handler 的第二参数）。

> [!warning] 修订（审查报告 Nit 5）
> Server 类型 import 计数修正：实测 `grep -rn "import.*\bServer\b.*from.*@modelcontextprotocol" src/` 命中 **5 处**——`GodotServer.ts:1`（运行时）+ `logger.ts:12` / `elicit.ts:14` / `progress.ts:10` / `tool-registry.ts:354`（type import）。原 spec §3.4 称"3"是少计。

### 3.4 56 处 SDK import 改造（53 个文件）

> [!warning] 修订（审查报告 Nit 1）
> 文件数实测修正为 **53**（原 spec 写"51"）。import 总处数实测仍为 **56**（`grep -rn "@modelcontextprotocol/sdk" src/ --include="*.ts" | wc -l` = 56）。

按文件类别分组：

| 类别 | 文件数 | 主要 import | 改造策略 |
|------|--------|------------|---------|
| `Server` / transport | 1（`GodotServer.ts`） | `@modelcontextprotocol/sdk/server/index.js` | 改 `@modelcontextprotocol/server` |
| `Server` 类型 | 4（`logger.ts` / `elicit.ts` / `progress.ts` / `tool-registry.ts`） | `import type { Server } from '@modelcontextprotocol/sdk/server/index.js'` | 改 `@modelcontextprotocol/server` |
| `Tool` 类型 | ~45（`src/tools/**/*.ts`、`types.ts`） | `import type { Tool } from '@modelcontextprotocol/sdk/types.js'` | 改 `@modelcontextprotocol/server` 或 `core`（codemod 决定） |
| `elicit` / `progress` / `logger` 类型 | 见上（已并入 Server 类型行） | — | — |
| 错误类 / ErrorCode | **0 处 SDK import**（enhanced 自定义） | enhanced 用 `src/core/error-codes.ts`（项目自定义 ErrorCodes） | 无需迁移；仅当 SDK v2 错误码**数值**变化才需对齐 enhanced 的 ErrorCodes 表 |

> [!warning] 修订（审查报告 Nit 2）
> 原 §3.4 表格列"错误类 / ErrorCode：少量（需 grep 确认）"——实测 enhanced **零** SDK McpError/ErrorCode import，所有错误类是项目自定义（`src/core/error-codes.ts` + `src/core/action-response.ts`），与 SDK 无继承关系。删除"迁移"措辞，改为"仅在 SDK v2 错误码数值变更时对齐"。

**验证命令**（执行前后各跑一次）：

```bash
grep -rn "@modelcontextprotocol/sdk" src/ --include="*.ts" | wc -l
# 预期：改造后归零（或仅留 codemod 临时映射）
```

### 3.5 `tsconfig.json`

| 字段 | 当前 | 是否改 | 备注 |
|------|------|--------|------|
| `target` | `ES2022` | 大概率不改 | Node 20 支持 ES2023，但 v2 SDK 未强制 |
| `module` / `moduleResolution` | `Node16` | 可能改 `NodeNext` 或 `Bundler` | 若 v2 SDK 用纯 ESM exports 字段导致 Node16 解析失败 |
| `lib` | 默认 | 检查是否需加 `ES2023` | zod v4 可能依赖新 API |

> 决策延后到 codemod 跑完看 tsc 报错。

---

## 4. 关键技术决策

### 4.1 codemod 还是手工改写？

**建议**：先跑 codemod 评估残留量，再决定。

**步骤**：
1. 新建分支 `chore/sdk-v2-upgrade`，跑官方 codemod：
   ```bash
   git checkout -b chore/sdk-v2-upgrade
   npx @modelcontextprotocol/codemod@latest v1-to-v2 .
   ```
2. 跑 `npm run build`，统计 tsc 报错数量与类别
3. **若残留 < 20 处**：手工修复，继续在本分支
4. **若残留 > 50 处**：codemod 覆盖度不足，回到设计阶段评估手工路径

**不直接手工改的原因**：56 处 import + 9 处 handler + 类型签名变更，手工易遗漏；codemod 是官方维护，覆盖度有保证。

### 4.2 双时代策略

**采用**：`serveStdio` 默认双时代（不加 `legacy: 'reject'`）。

**理由**：
- enhanced 14 个客户端适配中，大量用户在 Claude Desktop / Cursor 现版本（2025-era）
- 强制拒绝 2025 客户端会破坏现有用户，违反零破坏承诺
- 双时代是 v2 推荐路径，2026-era 特性按需启用（如 P0-2 的 MRTR 分支）

### 4.3 zod v4 升级是否独立 PR？

**建议**：是。拆分两个 PR：

1. **PR-A**：zod 3.25.76 → 4.2.0+（独立验证 schema 行为回归）
2. **PR-B**：SDK v1 → v2（依赖 PR-A 的 zod v4）

**理由**：
- zod v4 有破坏性变化（`.parse()` 错误结构、`.optional()` 行为、`*Schema` 常量）
- 独立 PR 可在 schema 回归失败时不阻塞 SDK 升级

> [!warning] 修订（审查报告 重大事实修正 / Nit 3）
> 原 §4.3 称"enhanced 的 zod schema 主要在 tool-registry（inputSchema 定义）和 args-validator，回归面有限但需验证"——**失实**。实测 `grep -rn "from ['\"]zod['\"]" src/ --include=\"*.ts\"` 命中 **0**，enhanced 源码**零 zod 用法**：所有 inputSchema 是裸 JSON Schema 对象（如 `src/core/ToolDispatcher.ts:137 type: 'object' as const`），zod 仅是 SDK 的 peerDependency，enhanced 自身代码不依赖。
>
> **修正后的影响评估**：zod v4 升级对 enhanced 自身代码**回归面为零**，风险纯粹来自 SDK 内部（SDK 用 zod 解析 client 请求 / 序列化 server 响应）。PR-A 的工作量从"验证 schema 行为回归"降为"验证 SDK 在 zod v4 下的请求解析 / 响应序列化行为"，主要通过 inspector + tools/list 序列化对比验证，无需扫 enhanced 源码。

---

## 5. 验证计划

### 5.1 静态验证

```bash
npm run lint       # ESLint 全绿
npm run build      # tsc 全绿（关键：56 处 import 路径 + 类型签名）
```

### 5.2 单元 + 回归测试

```bash
npm test           # vitest 全套（306 测试文件）
npm run test:regression   # regression 套件
npm run smoke      # e2e-full-tool-verification
```

> [!warning] 修订（审查报告 Nit 4）
> 新增 capability-matrix 漂移检查。SDK v2 的 `Tool` 类型字段若发生变化（如 v2 增加 `resultTypes` / `annotations` 等元字段），build-matrix 提取的工具元数据可能与 committed 基线漂移，CI 会红。**必须**在 SDK 升级后跑一次：

```bash
npm run build-matrix && npm run diff-matrix
# 预期：diff 为空（或仅有可解释的字段新增，需更新 capability-matrix.json 基线）
```

**关键回归点**：
- 所有 tool 的 inputSchema 序列化（zod v4 兼容）
- `confirm_and_execute` 流程（token 系统不破）
- elicit / progress / logger 注入路径
- Roots 动态授权（`oninitialized` + `list_changed`）

### 5.3 协议握手验证

```bash
npm run inspector  # MCP Inspector 验证 stdio 握手
```

**检查项**：
- initialize 握手成功，protocolVersion 协商正确
- tools/list 返回 36 工具（数量不变）
- tools/call 正常分发
- resources/list / prompts/list / completion/complete 全通

### 5.4 双时代客户端兼容性

| 客户端 | era | 测试方式 |
|--------|-----|---------|
| Claude Desktop（现版本） | 2025 | 手动连接，跑一个 guarded 工具（验证 elicit push） |
| Cursor（现版本） | 2025 | 手动连接，跑一个 resources/read |
| MCP Inspector | 双时代 | 切换 protocolVersion 参数，验证两端握手 |

**验收标准**：2025-era 客户端行为零回归（elicit/progress/logging 全工作）。

### 5.5 验收标准

完成时能：
- [ ] `npm run build && npm test` 全绿
- [ ] MCP Inspector 双时代握手成功
- [ ] Claude Desktop（2025-era）连接后所有 36 工具可见、guarded 工具 elicit 弹窗正常
- [ ] 全仓库 `grep -rn "@modelcontextprotocol/sdk" src/` 归零
- [ ] `node -e "console.log(require('./package-lock.json').packages['node_modules/zod'].version)"` 输出 ≥ 4.2.0

---

## 6. 回滚方案

### 6.1 分支策略

```
main
  └─ chore/sdk-v2-upgrade   ← 本 PR 分支
       └─ chore/zod-v4-bump  ← zod 升级独立分支（先 merge）
```

- 全部工作在 feature 分支，main 保持 v1 可用
- PR 合并前 main 若有紧急修复，rebase 即可

### 6.2 若 codemod 残留过大

**判定阈值**：codemod 跑完后 `npm run build` tsc 报错 > 100 处。

**回滚动作**：
1. `git checkout main`（丢弃 codemod 分支）
2. 改用手工渐进路径：
   - 第一 commit：仅改 package.json + 1 个文件（GodotServer.ts），验证最小可编译
   - 后续 commit：批量改 import（按文件类别分批，每批跑一次 build）
3. 暂停 P0-2（MRTR）依赖，先稳定 SDK 层

### 6.3 若 zod v4 回归失败

- 回滚 zod 到 3.25.76
- SDK v2 升级降级为"不升 zod"路径（与 v2 维护方沟通是否有 zod v3 兼容层）
- 若 v2 强制 zod v4，则本 spec 阻塞，重新评估

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| codemod 覆盖度不足，手工修整量大 | 中 | 升级延期 1-2 周 | 先跑评估，阈值化决策（见 §6.2） |
| 56 处 import 中有隐性依赖（如 `Tool` 类型字段在 v2 变化） | 中 | 运行时工具元数据错乱 | tools/list 回归测试 + capability-matrix diff 验证（见 §5.2） |
| zod v4 破坏性变化影响 SDK 内部 schema 解析（enhanced 自身代码零 zod 用法，**回归面为零**；风险纯粹来自 SDK 内部） | 中 | SDK 解析 client 请求 / 序列化 server 响应异常 | 独立 PR 先行（§4.3），inspector 双时代验证 + tools/list 序列化对比 |
| handler 第二参数 `ctx: ServerContext` 字段未对齐 | 中 | sendRequest / elicitation 调用失败 | codemod 输出 + inspector 双时代验证 |
| `tsconfig.json` Node16 moduleResolution 与 v2 ESM 不兼容 | 低 | tsc 编译失败 | 切 NodeNext，已验证可行 |
| 双时代策略下 2026-era 客户端行为未测试 | 中 | 2026 特性不可用（但 P0-2 才是关键） | 本 spec 仅保证 2025-era 零回归；2026-era 由 P0-2 处理 |

> [!warning] 修订（审查报告 重大事实修正 / Nit 3）
> 原 §7 称"zod v4 破坏性变化：schema 校验失效"概率"高"——**下调为中**。理由：enhanced 源码零 zod 用法（实测命中 0），zod v4 不会直接破坏 enhanced 的 inputSchema；风险传导路径是"SDK 内部用 zod 解析 → 解析失败 → enhanced 收到错误请求"，影响范围有限且可通过 inspector 双时代验证发现。

---

## 8. 时序与依赖

```
本 spec (P0-1)
  ├─ PR-A: zod v4 升级（独立，先行）
  └─ PR-B: SDK v1 → v2（依赖 PR-A）
       ↓
  P0-2 (MRTR 改造)  ← 强依赖
  P1-3 (oninitialized → per-request)
  P1-4 (ttlMs + cacheScope)
  P1-7 (Logging 改造)
  P2-5 (extensions 字段)
```

**关键路径**：P0-1 → P0-2 →（其余 P1 协议改造）。建议月 1-2 完成 P0-1。

---

## 9. 关键伪代码（仅签名，非实现）

```typescript
// GodotServer.ts 改造后
import { Server, StdioServerTransport } from '@modelcontextprotocol/server';
import type { ServerContext } from '@modelcontextprotocol/server';

this.server.setRequestHandler('tools/list', async (req, ctx: ServerContext) => ({
  tools: dispatcher.getFilteredTools(),
}));

this.server.setRequestHandler('tools/call', (req, ctx: ServerContext) =>
  dispatcher.handleCall(req, ctx)
);

// 注意：不再 import ListToolsRequestSchema 等 Zod schema 常量
```

> [!warning] 修订（审查报告 Nit 2）
> 原 §9 末尾"错误类迁移示例"代码块（`McpError → ProtocolError`）已删除。enhanced 全仓库无 SDK `McpError` / `ErrorCode` import，`src/core/error-codes.ts` 是项目自定义，不存在迁移关系。

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-05 | 初版，基于调研方案细化 |
| 2026-08-05 | 修订（基于第三方审查报告 `docs/reviews/2026-08-05-p0-specs-review.md`） |

---

## 修订记录（2026-08-05）

对应审查报告 Issue 编号：

| 审查编号 | 修订位置 | 修订内容 |
|---------|---------|---------|
| **重大事实修正 / Nit 3** | §1.2、§4.3、§7、§9 | zod 描述全面修正：enhanced 源码零 zod 用法（实测 `grep from ['\"]zod['\"]` 命中 0），所有 inputSchema 是裸 JSON Schema。zod v4 升级对 enhanced 自身代码回归面为零，风险纯粹来自 SDK 内部。§7 zod 风险概率从"高"下调为"中"。删除 §9 末尾"错误类迁移示例"代码块。 |
| **Nit 1** | §1.2、§3.4 | import 文件数实测修正：51 → **53**（`grep -rl "@modelcontextprotocol/sdk" src/ --include="*.ts" \| wc -l` = 53）。import 总处数仍为 56。 |
| **Nit 2** | §1.2、§3.4、§9 | 错误类迁移项删除/重定位：全仓库无 SDK `McpError` / `ErrorCode` import，`src/core/error-codes.ts` 是项目自定义。§1.2 删除"错误类与类型迁移"项；§3.4 表格末行改为"仅在 SDK v2 错误码数值变化时对齐"；§9 删除伪代码示例。 |
| **Nit 4** | §5.2 | 验证计划补 `npm run build-matrix && npm run diff-matrix`：SDK v2 的 `Tool` 类型字段变化可能导致 capability-matrix 漂移。 |
| **Nit 5** | §3.3 | Server 类型 import 计数修正：3 → **5**（GodotServer 1 处运行时 + logger/elicit/progress/tool-registry 4 处 type import）。 |

**未修订项**：

| 审查编号 | 原因 |
|---------|------|
| Nit 6 | "9 处 setRequestHandler"经实测确认含 NotificationHandler（GodotServer.ts:148-204 共 8 处 setRequestHandler + :263 1 处 setNotificationHandler = 9）。spec 内部数字一致，无需修订。 |
