# 第三方审查:P1-4 + P1-7 协议适配(2026-08-05)

**日期**:2026-08-05
**审查对象**:`feat/p1-1-p1-2-annotations` 分支上 commit `9187991`(P1-4)+ `4c93376`(P1-7)
**审查者**:独立 code-reviewer 子 agent(隔离视角,所有声明 grep/read SDK 源码实测)
**总体判定**:**SHIPPED WITH NITS**(1 个 Important dead code + 1 个 Important 未赋值字段,4 个 nit)

---

## 关键发现摘要

### ✅ P1-4 + P1-7 真实修了 pre-existing bug
`logging: {}` + `sendLoggingMessage` 修了此前 warn/error 推送因 `assertNotificationCapability` 抛 SdkError 被吞的 pre-existing bug(SDK 实测:`mcp-DXXb3Vv3.mjs:966-970`)。这部分 SHIPPED。

### ⚠️ I1 — P1-7 per-request logLevel 是 dead code(置信度 95)
`ToolDispatcher.ts:226` 从 `request.params._meta['io.modelcontextprotocol/logLevel']` 读,但 **SDK v2 在 dispatch 前 `liftWireOnlyMaterial`**(`src-CX2iR2pK.mjs:6003-6041`)把 `RESERVED_ENVELOPE_META_KEYS`(含 logLevel)从 `params._meta` **delete 掉**搬到 `ctx.mcpReq.envelope`(`src-CX2iR2pK.mjs:6018-6027`)。handler 收到的 `_meta` **永远不含**该键 → `rawLogLevel` 恒 undefined → `requestLogLevel` 恒 null → 走旧行为。

**影响**:P1-7 宣称的"per-request logLevel 过滤"对所有实际客户端不生效。`withRequestLogLevel`/`withRequestLogLevelAsync`/`_currentRequestLogLevel` 整套机制是 dead code(单测手动调才跑得到)。

**修法**:从 `ctx.mcpReq.envelope` 而非 `request.params._meta` 提取。

### ⚠️ I2 — ToolContext.requestLogLevel? 字段从不赋值 + 误导注释(置信度 90)
`types.ts:33-35` 新增字段,但 `buildPerCallCtx`(`ToolDispatcher.ts:851-863`)从不设它。`ToolDispatcher.ts:746-748` 注释描述的包裹位置(handleCall:239 vs executeToolCall)与实际代码不符。

### Nit N1 — cacheHints 对当前客户端全 no-op(置信度 85)
enhanced 默认 `supportedProtocolVersions` 仅 legacy,`fillCacheFields`(`src-CX2iR2pK.mjs:3773-3786`)只在 modern-era `encodeResult`(`:4115-4116`)跑,ttlMs/cacheScope 永不上 wire。配置无害、面向未来合理,但 commit 措辞需澄清。

### Nit N2 — resources/prompts listChanged:true 过度声称
enhanced 只发 tools/list_changed,从不发 resources/prompts 的。协议合法但属技术债。

### Nit N3 — resetLogger 不复位 _currentRequestLogLevel
### Nit N4 — P1-4 cacheScope 测试盲区(templates/list + server/discover)

## 处置(主 agent 采纳)

- **I1 修复**:改从 `srvCtx.mcpReq.envelope` 提取 logLevel(透传 ctx,扩 ServerContext 类型读取)
- **I2 修复**:删 `ToolContext.requestLogLevel?` 字段 + 删误导注释
- **N1 修复**:GodotServer.ts 加注释澄清 cacheHints 当前 era-gated
- **N3 修复**:resetLogger 加 `_currentRequestLogLevel = null`
- **补 async 测试**:withRequestLogLevelAsync finally 复位语义覆盖

## 值得进 memory 的工程教训

1. **SDK v2 envelope lift 陷阱**:`RESERVED_ENVELOPE_META_KEYS` 在 dispatch 前被 lift,server 端读这些键必须从 `ctx.mcpReq.envelope` 读,从 `request.params._meta` 读恒 undefined
2. **SDK v2 cacheHints 是 era-gated**:`fillCacheFields` 只在 modern-era encode 跑,默认 supportedProtocolVersions 仅 legacy 时 cacheHints 是 no-op。字面量契约测试会假绿(与 GDScript validate_scripts 盲区同构)
3. **SDK logging capability 双重语义**:声明 `logging:{}` 同时放行 notifications/message + 自动注册 deprecated logging/setLevel handler。SDK 提供 `ctx.mcpReq.log` 自动按 envelope 过滤
