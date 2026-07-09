---
date: 2026-07-09
topic: mcp-elicitation
status: draft
related:
  - 2026-07-08-mcp-logging-design.md（server 注入先例）
  - 2026-07-09-mcp-progress-notification-design.md（server 注入 + per-request 数据先例）
  - 资料-官方MCP servers借鉴对照.md（Phase 3 P2-7 Elicitation 接线）
source: 官方 MCP servers 借鉴对照报告 Phase 3 P2-7
---

# MCP Elicitation 接线（form mode MVP）设计

## 1. 背景与动机

官方 MCP servers 借鉴对照报告 Phase 3 P2-7「Elicitation 接线」：

- MCP 协议规定 server 缺必需参数时可经 `elicitation/create` 请求 client 弹表单问用户（form mode 收集非敏感输入，JSON Schema 校验）。SDK 提供 `server.elicitInput({mode, message, requestedSchema}): Promise<ElicitResult>`（`node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:158`），返回 `{action:'accept'|'decline'|'cancel', content?}`（`spec.types.d.ts:2275/2277`）。client 能力经 `getClientCapabilities().elicitation`（`spec.types.d.ts:316`）检测。
- 本项目 **框架已搭但未接线**：`src/core/middleware.ts:111` `createElicitationMiddleware` 已完整实现（检测 missing required primitive → 调 elicitFn → fallback MISSING_PARAM），但 `src/core/ToolDispatcher.ts:410` 传 `elicitFn=null`——缺参数直接报 MISSING_PARAM，不主动问用户。
- `ELICITATION` feature flag 默认 `true`（`src/core/feature-flags.ts:12`），gate（middleware `:119`）默认通过，缺口纯粹是 elicitFn 实现。
- 官方 `elicitationFormExample.js` 用法：`await server.elicitInput({mode:'form', message, requestedSchema})` → `result.action === 'accept' && result.content` 取值。

**价值**：AI 漏传必需参数时，client（支持 elicitation 的）弹表单让用户直接填（带 type/enum 下拉），而非报错让 AI 猜测重试。UX 提升 + 减少无效往返。

## 2. 目标

1. 接线 elicitFn：missing required primitive param → `server.elicitInput` form mode 问用户，accept 则填入 args 继续执行。
2. **失败安全**：client 不支持 / 用户 decline·cancel / elicitInput 异常 → fallback MISSING_PARAM（现状行为，无 elicitation 能力的 client 零变化）。
3. **零回归**：现有测试全绿，非 missing 参数路径行为不变。

## 3. 非目标（YAGNI）

- ❌ **URL mode**（敏感输入，借鉴报告 `UrlElicitationRequiredError` -32042）：另设计 URL 场景触发逻辑，留 follow-up。
- ❌ **收窄到特定工具**：所有工具的 missing required primitive 均适用（现状 middleware 范围）。
- ❌ **多步 elicitation**（官方 create_event 那种 step1/step2 分步）：godot 工具单步足够。
- ❌ **非 primitive 类型**（oneOf/anyOf compound）：elicitation 跳过（现状 `:146-167` F-14），直接 MISSING_PARAM。

## 4. 架构

### 4.1 新文件 `src/core/elicit.ts`（server 注入 + createElicitFn）

```
模块级 _elicitServer: Server | null
setElicitServer(server | null)        // GodotServer 构造注入（:108，与 setProgressSender 同点）
createElicitFn(): ElicitFn            // 返回 elicitFn 实现，闭包捕获 _elicitServer
type ElicitFn = (requestedSchema: RequestedSchema, message: string) => Promise<Record<string, unknown> | null>
```

elicitFn 实现：
- guard `!_elicitServer` → null
- client 能力 `_elicitServer.getClientCapabilities()?.elicitation` falsy → null
- `try { const result = await _elicitServer.elicitInput({mode:'form', message, requestedSchema}); return result.action === 'accept' && result.content ? result.content : null } catch { return null }`

> **⚠️ 与 logger/progress 的关键区别（实现者注意，勿照搬两件套）**
>
> elicit.ts 只用**单值** `_elicitServer`，**不带 `_clientReady` gate**。原因：`elicitInput` 是 **request/response**——client 必已完成 initialize 才到达 middleware（`tools/call` 在握手后），不可能在握手前触发。而 logger `sendLoggingMessage` / progress `notification` 是 **fire-and-forget notification**，握手前发会崩，故需 `clientReady` gate。
>
> 此处"与 logger/progress 同构"**仅指 server 注入模式**（模块级 `set` + `null` 清理），**不**照搬两件套。给 elicit 加 `_clientReady` 是过度设计。

**返回类型 `Record<string, unknown>`**（非 `string`）：primitiveMissing 含 number/boolean（middleware `:150` `type === 'number' || type === 'boolean'`），SDK 按 `requestedSchema.type` 返回对应类型值（number 字段返回 number）。`Record<string,string>` 会把 number/boolean 窄化成 string；`safeArgs` 本就是 `Record<string,unknown>`（middleware `:126`），返回 `unknown` 与 SDK content 多态一致。

### 4.2 middleware.ts 改（`:169-177` elicitFn 调用块 + 第 2 参签名）

调用前构造 requestedSchema（middleware 作用域已有 `props = schema.properties`，`:142`，就地构造是顺水推舟）：

```typescript
const requestedSchema = {
  type: 'object',
  properties: Object.fromEntries(primitiveMissing.map(p => [p, props[p] ?? { type: 'string' }])),
  required: primitiveMissing,
};
const elicited = await elicitFn(requestedSchema, `Tool "${ctx.toolName}" missing required parameter(s)`);
```

同步改 `createElicitationMiddleware` 第 2 参类型：elicitFn 签名从 `(params: string[]) => Promise<Record<string,string>|null>` 改为 `(requestedSchema, message) => Promise<Record<string,unknown>|null>`。

**为何方案 A（middleware 构造 schema）优于 B/C**：
- **B**（elicitFn 收 toolName 自取 schema）：重复 getToolDef，且 elicitFn 需耦合 tool registry
- **C**（不改签名，params 都当 string）：SDK `server/index.js:367` 用 `requestedSchema` 校验/重塑 content（number/enum 转换），丢 type/enum 破坏 SDK content 处理行为——不只表单体验差

### 4.3 ToolDispatcher 接线（`:410`）

```typescript
mw.push(createElicitationMiddleware(
  (name: string) => getAllToolDefinitions().find(t => t.name === name) ?? null,
  createElicitFn(),  // 非 null（现状 null）
));
```

### 4.4 GodotServer 接线

- 构造 `:108`：`setElicitServer(this.server)`（与 `setProgressSender` 并列）
- close `:511` 区：`setElicitServer(null)`（与 progress 清理并列）

## 5. 数据流

```
client tools/call（缺 required primitive param）
 → middleware elicitation.before（ELICITATION flag 默认 true, :119）
   → missing = required.filter(未提供/null/'')（:136-139）
   → primitiveMissing = missing.filter(type ∈ string/number/boolean)（:146-151）
   → 构造 requestedSchema（从 def.inputSchema.properties 提取 primitiveMissing 定义）
   → elicitFn(requestedSchema, message)
     → guard(_elicitServer) + getClientCapabilities().elicitation 检测
     → server.elicitInput({mode:'form', message, requestedSchema})
     → accept + content → 返回 {param:value}（按 schema 类型，number 返回 number）
     → decline/cancel/throw → null
   → elicited 填入 safeArgs（:172-174）→ passed:true（继续执行工具）
   → null → fallback MISSING_PARAM error（:179-189 现状）
```

## 6. 错误处理

- **client 不支持 elicitation**（`getClientCapabilities().elicitation` falsy）→ elicitFn 返回 null → MISSING_PARAM（与现状一致，无能力 client 行为不变）
- **用户 decline/cancel** → null → MISSING_PARAM
- **elicitInput throw**（传输错误等）→ try/catch 返回 null → MISSING_PARAM（elicitation 是交互增强层，失败 fallback 到确定性行为，不阻塞主流程）
- **非 primitive missing**（oneOf/anyOf 无 type）→ 不 elicit，直接 MISSING_PARAM（现状 `:152-167` F-14 防御分支）
- **无 server**（`_elicitServer` null，测试隔离）→ null → MISSING_PARAM

## 7. 测试

**elicit.ts 单元**：
- client 支持 + accept → 返回 content（含 number/boolean 类型保留，验证不窄化成 string）
- client 不支持（caps.elicitation falsy）→ null
- decline/cancel → null
- elicitInput throw → null
- 无 `_elicitServer` → null

**middleware 集成**：
- missing primitive + elicitFn 返回值 → 填入 safeArgs + passed:true（继续执行工具）
- elicitFn 返回 null → MISSING_PARAM
- 非 primitive missing（无 type）→ MISSING_PARAM（不调 elicitFn，F-14 路径）
- requestedSchema 含 primitiveMissing 的 type/enum 正确（从 def.inputSchema.properties 提取）
- 无 missing → passed:true（不调 elicitFn）

**GodotServer 接线**（静态断言，同 progress-wiring.test.ts 模式）：`setElicitServer` 接线存在

## 8. 决策记录

- **方案 A（middleware 构造 requestedSchema）> B/C**：A 就地利用 middleware 已有的 `props = schema.properties`（`:142`），职责分离（middleware 知 schema，elicitFn 只调 elicitInput）。B 重复 getToolDef 且耦合 tool registry。C 破坏 SDK content 处理（`server/index.js:367` 用 requestedSchema 校验/重塑）。
- **elicit 不带 clientReady gate**：elicitInput 是 request/response（client 必已 initialize），非 fire-and-forget notification。logger/progress 的 clientReady 是防 notification 握手前崩，elicit 无此问题——加 clientReady 是过度设计。
- **elicit 不需四层参数链（并发安全天然成立）**：与 progress 的 C-CONC-1 命门不同——`requestedSchema`/`message` 是 elicitFn 的 **per-call 参数**（middleware 每次 call 局部构造），`_elicitServer` 只读共享，`elicitInput` 按 request id 路由 response。故 elicitFn 单例 + per-call 参数 = 天然并发安全，**不需** progress 那样的四层参数链透传。照 progress 模式给 elicitation 套四层链是过度设计。
- **返回 `Record<string, unknown>`**：兼容 number/boolean param（SDK 按 schema.type 返回），与 safeArgs 类型一致，避免窄化。
- **form mode only MVP**：URL mode（敏感输入）是另场景，YAGNI。

## 9. 行号卫生声明

本文行号基于当前 master（`8b2c709`，含 Progress feature）。**实现时以实际为准**——plan 阶段与实现阶段须重新核实（middleware/ToolDispatcher/GodotServer/feature-flags 行号可能因 Progress feature 漂移）。
