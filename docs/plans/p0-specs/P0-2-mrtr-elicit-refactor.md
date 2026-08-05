# P0-2 MRTR 改造 spec（elicit + confirm_and_execute）

> **状态**：待执行（阻塞于 P0-1）
> **优先级**：P0（2026-era 客户端可用性的硬约束）
> **预估工作量**：M-L（3-5 天）
> **依赖**：P0-1 SDK v2 升级必须先完成
> **关联文档**：[P0-1 SDK v2 升级](./P0-1-sdk-v2-upgrade.md) · [MCP 生态调研方案](../2026-08-05-mcp-ecosystem-research-and-upgrade-plan.md)

---

## 1. 目标与范围

### 1.1 必做项

| # | 任务 | 当前 | 目标 |
|---|------|------|------|
| 1 | `elicit` 协议路径 | 仅 push 模式（`server.elicitInput(...)`） | 双时代：2025-era 保持 push；2026-era 走 MRTR `InputRequiredResult` |
| 2 | `confirm_and_execute` | 单一路径（消费 token + elicit） | 双时代：2026-era 读 `inputResponses` + `requestState` |
| 3 | 所有 tool 结果 | 隐式 `complete` | 显式 `resultType: 'complete' \| 'input_required'`（2026-era 必填） |

### 1.2 范围内

- `src/core/elicit.ts`：era 检测 + MRTR 分支
- `src/core/ToolDispatcher.ts`：`confirm_and_execute` inline tool 改造
- `src/guard.ts`：token 系统适配 MRTR 的 `requestState`（opaque token 复用）
- 所有 tool handler 的返回值加 `resultType` 字段（2026-era 必填，2025-era 兼容）

### 1.3 范围外

- SDK v2 升级本身（P0-1）
- per-request 能力探测（P1-3，本 spec 用 protocolVersion 字符串判断即可）
- 其他 2026-era 特性（Extensions / Tasks）

---

## 2. 背景

### 2.1 为什么必须改

**SEP-2260**：server→client 请求只能在处理 client 请求时发。这意味着旧的 `elicitation/create`（server 主动 push 给 client）在 2026-era 协议下被禁止——只能在 client 的 `tools/call` 处理过程中发，且必须用新的返回值结构。

**SEP-2322**：MRTR（Multi Round-Trip Requests）用 `InputRequiredResult` 替代旧的 `elicitation/create` push 模式。server 不再"中途问 client"，而是返回一个特殊结果，让 client 收集答案后**重新发起原请求**。

**SDK v2 在 2026-era 时的行为**：`ctx.mcpReq.elicitInput(...)` 直接抛错（旧 API 不可用）。

**enhanced 的核心风险**：`elicit` 是危险操作门控的唯一入口——`confirm_and_execute` 通过 out-of-band elicit 堵 AI 自确认 token（2026-07-13 安全修复的关键）。**不改则所有 guarded 工具（write/execute 类）在 2026-era 客户端下完全不可用**，且安全门控失效（要么 elicit 抛错致工具全失败，要么被迫绕过 elicit 致 AI 自确认漏洞复现）。

### 2.2 MRTR 与 push 模式的核心区别

| 维度 | 2025-era push 模式 | 2026-era MRTR |
|------|-------------------|---------------|
| 触发方 | server 主动调 `elicitInput(...)` | server 返回 `InputRequiredResult`，client 重发请求 |
| 协议方向 | server→client 请求（双向） | client→server 的多次 round-trip |
| 状态保存 | server 持有 in-flight Promise | server 用 `requestState` opaque token 无状态保存 |
| AI 自确认防御 | elicit 经 server→client→user UI，AI 无法伪造 | 同（client 收到 `InputRequiredResult` 后弹 UI 给 user） |

---

## 3. MRTR 工作流

### 3.1 时序图

```
client                          server                         user
  │                               │                              │
  │── tools/call (delete_node) ──→│                              │
  │                               │ 检测需确认(requiresConfirmation=true)
  │                               │                              │
  │                       ┌───────┴───────┐                      │
  │                       │ era 检测       │                      │
  │                       └───────┬───────┘                      │
  │                               │                              │
  │               ┌───────────────┴───────────────┐              │
  │               │ 2025-era          2026-era    │              │
  │               ├──────────────┬─────────────────┤              │
  │               │ elicitInput()│ 返回             │              │
  │               │ (push, await)│ InputRequiredResult            │
  │←──────────────┤              │ {resultType,                   │
  │ elicitation/  │              │  inputRequests,                │
  │ create 请求   │              │  requestState}                 │
  │──────────────→│              │                               │
  │                               │                  ┌───────────┐│
  │                               │                  │ user 确认 ││
  │                               │                  └───────────┘│
  │←── accept/cancel ─────────────│                              │
  │                               │                              │
  │                               │ (2026-era)                    │
  │── tools/call (delete_node) ──→│                              │
  │   + inputResponses            │ 读 inputResponses             │
  │   + requestState              │ 校验 requestState             │
  │                               │ 继续执行                      │
  │←── result (complete) ─────────│                              │
```

### 3.2 关键数据结构

```typescript
// InputRequiredResult（2026-era server 返回）
interface InputRequiredResult {
  resultType: 'input_required';
  inputRequests: {
    [key: string]: {
      type: 'elicitation';
      message: string;
      schema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
    };
  };
  requestState: string;  // opaque token，server 自行解释（enhanced 复用 guard token）
}

// client 重试请求（2026-era）
interface RetryRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
    inputResponses?: { [key: string]: Record<string, unknown> };  // 用户答案
    requestState?: string;  // 原 server 返回的 opaque token
  };
}

// 完成结果（双时代，2026-era 必填 resultType）
interface CompleteResult {
  resultType: 'complete';
  content: [{ type: 'text'; text: string }];
  isError?: boolean;
}
```

### 3.3 era 检测逻辑

```typescript
// 从 v2 SDK 的 ServerContext 取 protocolVersion
function detectEra(ctx: ServerContext | undefined): '2025' | '2026' {
  const pv = ctx?.mcpReq?.envelope?.protocolVersion;
  if (typeof pv === 'string' && pv.startsWith('2026')) return '2026';
  return '2025';  // 默认 fallback（2025-era 或未知）
}
```

> [!warning] 字段路径待校准（审查报告 I-1）
> `ctx.mcpReq.envelope.protocolVersion` 基于 SDK v2 草案推测，**未被权威文档证实**。权威迁移指南列出 `ctx.mcpReq` 字段为 `signal/id/_meta/send/notify`，无 `envelope` / `protocolVersion`。
>
> **校准计划**：P0-1 完成后用 SDK v2 实际类型签名校准本节字段路径（可能改走 `ctx.session.protocolVersion` 或 SDK 暴露的 helper）。
>
> **默认 era=2025 的安全含义**：若 2026 客户端被误判为 2025，MRTR 失效（走旧 elicit push，在 2026-era 协议下会抛错），但 2025 push 模式在双时代 SDK 中仍可工作（降级而非崩溃）。误判的失败模式是"工具调用失败 + 错误日志"，而非"安全门控失效"，可接受作为 fallback。

---

## 4. 改动清单

> [!warning] 修订（审查报告 I-2 / I-3）
> 原 §4 漏列两个文件：`src/core/middleware.ts`（elicitFn 参数类型与调用点）和 `test/regression/defects.ts`（`confirm-token-trust-broken` 检测器）。本节已补全。

### 4.1 `src/core/elicit.ts`

| 行号 | 当前 | 改为 |
|------|------|------|
| 14 | `import type { Server } from '...'` | 加 `ServerContext` 类型 import |
| 22-25 | `ElicitFn = (requestedSchema, message) => Promise<Record \| null>` | 签名加 `era` / `ctx` 参数（或拆两个函数） |
| 39-60 | `createElicitFn()` 单路径 | 改为工厂：返回 `{ elicitPush, elicitMrtr }` 双实现 + era 分发器 |

**关键伪代码**：

```typescript
export interface ElicitResult {
  // 2025-era：直接返回答案
  answer: Record<string, unknown> | null;
  // 2026-era：返回 InputRequiredResult（由 handler 包装后返回 client）
  mrtr?: {
    inputRequests: InputRequiredResult['inputRequests'];
    requestState: string;
  };
}

export function createElicitFn(): ElicitFn {
  return async (requestedSchema, message, ctx?) => {
    const era = detectEra(ctx);
    if (era === '2026') {
      // 不调 elicitInput（会抛错），返回 MRTR 结构
      const requestState = createPendingToken('__elicit__', { schema: requestedSchema, message });
      return {
        answer: null,
        mrtr: {
          inputRequests: {
            confirm: { type: 'elicitation', message, schema: requestedSchema },
          },
          requestState,
        },
      };
    }
    // 2025-era：保持现有 push 模式
    const result = await _elicitServer!.elicitInput({ mode: 'form', message, requestedSchema });
    return { answer: result.action === 'accept' ? result.content : null };
  };
}
```

### 4.2 `src/core/ToolDispatcher.ts`

| 行号 | 当前 | 改为 |
|------|------|------|
| 108 | `registerInlineTool('confirm_and_execute', {...})` | 元数据不变 |
| 133-143 | `confirm_and_execute` inputSchema 只有 `token` | 加 `inputResponses` / `requestState`（2026-era 用，2025-era 可选） |
| handleCall | 检测 `confirm_and_execute` → 消费 token → elicit → 执行 | 双路径：2026-era 先读 `inputResponses` + `requestState`，若 present 直接执行；否则发 MRTR |

**关键伪代码**：

```typescript
// confirm_and_execute 处理（2026-era 分支）
async handleConfirmAndExecute(req, ctx): Promise<ToolResult> {
  const era = detectEra(ctx);
  const { token, inputResponses, requestState } = req.params.arguments;

  if (era === '2026' && inputResponses && requestState) {
    // 第二轮 round-trip：用户已确认，执行
    if (requestState !== token) return errorResult('STATE_MISMATCH');
    const pending = consumeToken(token);
    if (!pending) return errorResult('TOKEN_EXPIRED');
    return await this.executeGuardedTool(pending.toolName, pending.args);
  }

  // 首次进入：需确认
  const pending = consumeToken(token);  // 注：MRTR 模式下不立即消费，见 §4.3
  if (era === '2026') {
    // 返回 InputRequiredResult，等 client 重试
    return {
      resultType: 'input_required',
      inputRequests: { confirm: { type: 'elicitation', message: `Confirm ${pending.toolName}?`, schema: BOOL_SCHEMA } },
      requestState: token,  // 复用 guard token
    };
  }

  // 2025-era：现有 elicit push 流程
  const answer = await this.elicitFn(...);
  if (!answer) return errorResult('USER_DECLINED');
  return await this.executeGuardedTool(pending.toolName, pending.args);
}
```

### 4.3 `src/guard.ts`（token 系统适配）

| 字段/方法 | 当前 | 改造 |
|-----------|------|------|
| `PendingToken` | `{ token, toolName, args, createdAt, wasTruncated }` | 不变 |
| `TOKEN_TTL_MS` | 60_000（60s） | **延长到 120s**（MRTR 多一次 round-trip，60s 可能不够 client 弹 UI + 用户响应） |
| `createPendingToken` | 立即消费场景 | 增加可选 `consumeMode: 'immediate' \| 'deferred'`：MRTR 模式 deferred（创建后不消费，等第二轮 requestState 校验） |
| `consumeToken` | 读取即删除 | 增加可选参数 `peek: boolean`：MRTR 第一轮 peek（验证 requestState 有效但不删），第二轮真消费 |

**关键改动**：

```typescript
// MRTR 第一轮：peek 模式（验证不消费）
export function peekToken(token: string): PendingToken | null {
  const pending = pendingTokens.get(token);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > TOKEN_TTL_MS) {
    pendingTokens.delete(token);
    return null;
  }
  return pending;  // 不删
}

// MRTR 第二轮：消费（现有 consumeToken 语义不变）
```

> [!warning] 修订（审查报告 Nit 7）
> **token 流程分流说明**（双路径在 `confirm_and_execute` 入口分流）：
>
> | era | 入口路径 | token 操作 | elicit 路径 |
> |-----|---------|-----------|------------|
> | **2025-era** | `confirm_and_execute` 现有逻辑（`ToolDispatcher.ts:299` 附近） | **consume-then-elicit**：先 `consumeToken`，再调 `this.elicitFn` push 给 user | `server.elicitInput(...)` push |
> | **2026-era** | `confirm_and_execute` 新增分支 | **peek-then-consume**：第一轮 `peekToken`（不删，验证有效）→ 返回 `InputRequiredResult`；第二轮收到 `inputResponses` + `requestState` 后才 `consumeToken` | 不调 elicitInput，返回 MRTR 结构 |
>
> **分流点**：`confirm_and_execute` handler 入口处根据 `detectEra(ctx)` 选路径。两路径在 token 操作语义上**完全隔离**——2025-era 立即消费，2026-era 延迟消费。**严禁**两路径共用 consumeToken 调用点，否则 2026-era 第一轮就把 token 消费掉，第二轮 requestState 校验会失败。

### 4.4 `src/core/middleware.ts`（新增，审查报告 I-2）

> [!warning] 修订（审查报告 I-2）
> 改 `ElicitFn` 签名（§4.1）必然波及 `middleware.ts` 的参数类型与调用点。

| 行号 | 当前 | 改为 |
|------|------|------|
| 114 | `elicitFn: ((requestedSchema: RequestedSchema, message: string) => Promise<Record<string, unknown> \| null>) \| null` | 改为新 `ElicitFn` 签名（加 `ctx?` 参数，返回 `ElicitResult`） |
| 170 | `if (elicitFn) {` | 调用点不变，但需处理 `ElicitResult`（含 `mrtr` 字段）的返回值 |
| 178 | `const elicited = await elicitFn(...)` | 调用点签名适配；若 middleware 在 2026-era 路径被触达，需把 `mrtr` 透传给上层 handler（或 middleware 仅服务 2025-era，2026-era 走 ToolDispatcher 直连路径） |

**待澄清**：middleware.ts 的 elicitFn 调用是否在 2026-era 路径上？若 middleware 是 2025-era 专用（如仅 push 模式的中间件链），则改动可最小化（仅同步签名）；若 middleware 也参与 2026-era，需把 `ElicitResult.mrtr` 透传逻辑加入。**P0-2 开工时第一步**：读 middleware.ts:160-190 上下文确认。

### 4.5 `test/regression/defects.ts`（新增，审查报告 I-3）

> [!warning] 修订（审查报告 I-3）
> `defects.ts:127` 的 `confirm-token-trust-broken` 检测器用正则监测安全门控：
>
> ```typescript
> const hasGate = /this\.elicitFn\(/.test(td) && /ELICITATION_DENIED/.test(td);
> ```
>
> P0-2 改 `confirm_and_execute` 流程后，若 2026-era 分支**不经过** `this.elicitFn`（走 MRTR `InputRequiredResult` 路径），上述正则仍能命中（因为 2025-era 分支保留 `this.elicitFn` 调用），**不会误报**。但若后续重构把 2025-era 分支也改掉（如统一走 MRTR），检测器会失效。
>
> **必做改动**（§6.2 验证）：
> 1. 更新检测器正则兼容双路径：`/this\.elicitFn\(/.test(td) \|\| /InputRequiredResult/.test(td)`，并加 era-aware 判断（两条路径任一存在即视为 gate 完整）
> 2. 或保留现有正则 + 加注释说明"2026-era MRTR 路径的 gate 完整性由 §6.2 测试覆盖，本检测器仅守 2025-era"
>
> **推荐**：方案 1（检测器升级为 era-aware），避免后续重构时检测器静默失效。

### 4.6 所有 tool handler 返回值

| 范围 | 改动 |
|------|------|
| 36 个 merged 工具 + inline 工具 | 成功结果加 `resultType: 'complete'`（2026-era 必填，2025-era SDK 自动补默认值） |
| 错误结果 | 同上，`resultType: 'complete'` + `isError: true` |

**实现策略**：在 `ToolDispatcher.handleCall` 的统一返回包装层加默认 `resultType`，**不**改每个 tool handler（避免 36 处分散改动）。codemod 或 SDK 可能提供自动补全。

---

## 5. 双时代策略（必做）

### 5.1 era 分发原则

| era | elicit 路径 | result 字段 |
|-----|------------|------------|
| 2025 | `server.elicitInput(...)` push 模式（现有） | 不加 `resultType`（SDK 自动补） |
| 2026 | 不调 elicitInput，返回 `InputRequiredResult` | 必加 `resultType: 'complete' \| 'input_required'` |

### 5.2 兼容矩阵

| 场景 | 2025-era 客户端 | 2026-era 客户端 |
|------|----------------|----------------|
| 普通工具调用（无确认） | 现有路径，零变化 | `resultType: 'complete'` 自动补 |
| guarded 工具首次调用 | 返回 `confirmation_token`，提示用 confirm_and_execute | 同 |
| confirm_and_execute 第一轮 | elicit push → 用户确认 → 执行 | 返回 `InputRequiredResult`，client 弹 UI |
| confirm_and_execute 第二轮 | 不存在（push 单轮完成） | client 重发 + `inputResponses` + `requestState` → 执行 |

### 5.3 默认 era

- 客户端未声明 protocolVersion 或声明 2025 → 默认 2025-era（保守，向后兼容）
- 客户端声明 2026-XX-XX → 走 MRTR 分支

---

## 6. 验证计划

### 6.1 单元测试（elicit 工厂）

```bash
npx vitest run test/core/elicit.test.ts
```

**新增用例**：
- `detectEra('2025-11-25')` → '2025'
- `detectEra('2026-07-28')` → '2026'
- 2025-era elicitFn 走 push（mock `elicitInput`）
- 2026-era elicitFn 返回 `mrtr` 结构（不调 `elicitInput`）

### 6.2 confirm_and_execute 回归测试

> [!warning] 修订（审查报告 I-3 / I-4）
> 原 §6.2 引用 `test/regression/confirm-and-execute.test.ts`——**该文件不存在**（Glob 命中 0）。实际回归覆盖在两处：
> - `test/core/ToolDispatcher.test.ts` 的 T11 / T20 系列及 confirm_and_execute 相关用例（:137 / :158-163 / :196 / :214 / :319 / :377 等）
> - `test/regression/defects.ts` 的 `confirm-token-trust-broken` 检测器（:118-128）
>
> 已修正命令指向真实文件，并补充 defects.ts 检测器升级验证。

```bash
npx vitest run test/core/ToolDispatcher.test.ts
npx vitest run test/regression/defects.ts      # 或 npm run test:regression
```

**关键回归点**：
- 2025-era：token 创建 → confirm_and_execute → elicit push → 用户 accept → 执行（现有流程不破）
- 2025-era：用户 decline → 返回 USER_DECLINED
- 2026-era：token 创建 → confirm_and_execute → 返回 InputRequiredResult（不执行）
- 2026-era：第二轮（带 inputResponses + requestState）→ 执行
- 2026-era：requestState 不匹配 → STATE_MISMATCH 错误
- 2026-era：requestState 过期（> 120s）→ TOKEN_EXPIRED 错误
- AI 自确认防御：2026-era 第二轮必须有正确的 inputResponses（AI 无法伪造 user UI 响应）

**defects.ts 检测器升级验证**（对应 §4.5 改动）：
- `confirm-token-trust-broken` 检测器正则升级后仍能命中现有 2025-era gate（`this.elicitFn` + `ELICITATION_DENIED`）
- 升级后的 era-aware 正则（`/this\.elicitFn\(/ \|\| /InputRequiredResult/`）能识别 2026-era MRTR 路径
- 检测器返回 0（无复发）是 P0-2 落地的硬验收项

### 6.3 guard.ts token 系统测试

```bash
npx vitest run test/guard.test.ts
```

**新增用例**：
- `peekToken` 不删除 token
- TTL 120s 验证（MRTR 模式下 token 存活时间足够 round-trip）

### 6.4 手动测试（2026-era 客户端）

**前提**：需有 2026-era 客户端（下一代 Claude Desktop 或 MCP Inspector 切 protocolVersion=2026-07-28）。

**测试步骤**：
1. 连接 server，initialize 协商 protocolVersion=2026-07-28
2. 调用一个 guarded 工具（如 `scene` with `action: remove_node`）
3. 验证返回 `confirmation_token`
4. 调用 `confirm_and_execute` with token
5. 验证返回 `InputRequiredResult`（非直接执行）
6. 在 client UI 确认
7. client 自动重发 `confirm_and_execute` + inputResponses + requestState
8. 验证工具执行成功

### 6.5 验收标准

完成时能：
- [ ] 2025-era 客户端：confirm_and_execute 全流程零回归（现有测试套件全绿）
- [ ] 2026-era 客户端：guarded 工具走 MRTR，用户确认后执行成功
- [ ] AI 自确认防御在双时代均有效（2025: elicit push；2026: inputResponses 必须来自 user UI）
- [ ] `npm test` 全绿
- [ ] token TTL 从 60s 调整到 120s 后无回归

---

## 7. 依赖

### 7.1 强依赖

| 依赖 | 说明 |
|------|------|
| **P0-1 SDK v2 升级** | 必须先完成。本 spec 用 `ServerContext` / `protocolVersion` 字段，v1 SDK 不提供 |

### 7.2 弱依赖

| 依赖 | 说明 |
|------|------|
| P1-3 per-request 能力探测 | 本 spec 用 protocolVersion 字符串判断 era，是简化版；P1-3 完成后可改用更可靠的能力探测 |

### 7.3 时序

```
P0-1 (SDK v2) ──→ P0-2 (本 spec) ──→ P1-3 (per-request 能力探测，可选优化)
```

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| MRTR 是新协议，2026-era 客户端测试覆盖难 | 高 | 上线后才发现兼容问题 | 用 MCP Inspector 切 protocolVersion 模拟；保留 2025-era 兜底 |
| `confirm_and_execute` 的 token 流程适配 MRTR 后破坏 2025-era | 中 | 现有用户全部受影响 | 双路径完全隔离，2025-era 路径不改逻辑只加默认 resultType |
| guard token TTL 60s 在 MRTR 多轮下不够 | 高 | 用户还没确认 token 就过期 | TTL 调到 120s（§4.3）；peek 模式不消费 |
| era 检测用 protocolVersion 字符串脆弱（如 2026 客户端声明 "2026-07-28" vs "2026_07_28"） | 中 | era 误判致路径错误 | `startsWith('2026')` 宽松匹配 + 默认 fallback 2025-era |
| `InputRequiredResult` 结构与 SDK v2 实际实现不匹配 | 中 | 编译失败 | P0-1 完成后用 SDK v2 实际类型签名校对本 spec 的伪代码 |
| AI 自确认防御在 MRTR 下失效（AI 伪造 inputResponses） | 高（安全） | 危险操作绕过门控 | MRTR 下 inputResponses 必须由 client 经 user UI 产生；server 不信任 AI 直接发的 inputResponses（验证 requestState 必须匹配 server 颁发的 token） |

### 8.1 安全关键点

**AI 自确认防御**（2026-07-13 安全修复）在 MRTR 下的延续：

- 2025-era：elicit 经 `server → client → user UI`，AI 无法伪造 user 响应
- 2026-era：`InputRequiredResult` 经 `server → client → user UI`，client 收集答案后**重发请求**。AI 同样无法伪造 `inputResponses`（因为它必须匹配 server 颁发的 `requestState`，且 client 在 user UI 收集答案后才填入）

**风险**：若 server 仅校验 `requestState` 存在而不校验 `inputResponses` 内容真实性，AI 可自颁 token + 伪造 `inputResponses: { confirm: true }`。

**缓解**：`requestState` 复用 guard 的不可预测随机 token（`randomBytes(18).toString('base64url')`），AI 无法猜测；同时 `inputResponses` 字段名（如 `confirm`）由 server 在 `InputRequiredResult` 中指定，AI 无法注入。

---

## 9. 关键接口签名汇总

```typescript
// src/core/elicit.ts
export interface ElicitResult {
  answer: Record<string, unknown> | null;  // 2025-era
  mrtr?: {                                  // 2026-era
    inputRequests: InputRequiredResult['inputRequests'];
    requestState: string;
  };
}

export type ElicitFn = (
  requestedSchema: RequestedSchema,
  message: string,
  ctx?: ServerContext,
) => Promise<ElicitResult>;

// src/guard.ts（新增）
export function peekToken(token: string): PendingToken | null;
```

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
| **I-1** | §3.3 | era 检测字段路径 `ctx.mcpReq.envelope.protocolVersion` 加"待校准"callout：未被权威文档证实，P0-1 完成后用 SDK v2 实际类型签名校准。补充默认 era=2025 的安全含义说明（降级而非崩溃）。 |
| **I-2** | §4（新增 §4.4） | 改动清单补 `src/core/middleware.ts`：`:114`（elicitFn 参数类型）、`:170`/`:178`（调用点）。改 `ElicitFn` 签名必然波及，需同步适配 `ElicitResult` 返回值。 |
| **I-3** | §4（新增 §4.5）+ §6.2 | 改动清单补 `test/regression/defects.ts`：`:127` 的 `confirm-token-trust-broken` 检测器用 `/this\.elicitFn\(/` + `/ELICITATION_DENIED/` 双正则监测安全门控。P0-2 改 confirm_and_execute 流程后需升级检测器为 era-aware（兼容双路径）。 |
| **I-4** | §6.2 | 测试文件引用修正：`test/regression/confirm-and-execute.test.ts` **不存在**（Glob 命中 0）。实际回归在 `test/core/ToolDispatcher.test.ts`（T11/T20 系列，:137/:158-163/:196/:214/:319/:377）和 `test/regression/defects.ts`。命令已指向真实文件。 |
| **Nit 7** | §4.3 | token 流程分流说明：2025-era 走 consume-then-elicit（`ToolDispatcher.ts:299` 现有路径），2026-era 走 peek-then-consume（MRTR 模式）。两路径在 `confirm_and_execute` 入口根据 `detectEra(ctx)` 分流，token 操作语义完全隔离。 |

**未修订项**：

| 审查编号 | 原因 |
|---------|------|
| 无 | P0-2 无"Nit 未修订"项，所有 Important Issues 与 Nit 7 均已处理。 |
