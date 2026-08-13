# G2 第三方审查:trace_id + 结构化 error_category + retryable + PII 护栏

**日期**:2026-08-13
**审查对象**:14 竞品对比附录 F.2 落地(G2 速赢批第一项)
**审查者**:code-reviewer 子 agent(隔离视角,所有结论 grep/read 实测)
**实现者**:主代理(本会话)
**总体判定**:**SHIPPED WITH NITS**(无 Blocking Issues)

---

## 实现摘要

| 交付 | 实现 | 标杆 |
|---|---|---|
| trace_id(16hex) | 注入 `result._meta.trace_id` + `duration_ms`(healthSample after,成功+失败双路径) | xulek `_attach_response_meta` |
| 结构化 error_category(7 类) | validation/path/timeout/transport/guard/connection/internal,进 content JSON | xulek 7 类 |
| retryable | timeout/transport/connection/guard-限流=true,进 content JSON | xulek payload |
| **PII 护栏(核心)** | 主 catch 用 `classifyError`(类型映射,**绝不读 err.message**);8 处 path/godot/addon 抛错点 message 去 PII | 解开 `ToolDispatcher:506` 固定 TOOL_ERROR 约束 |

**改动文件**:新建 `src/core/tool-errors.ts`;改 `types.ts`/`errors.ts`/`ToolDispatcher.ts`/`path-utils.ts`/`godot-finder.ts`/`addon-version.ts`/`guard.ts`/`EditorConnection.ts`;测试 `tool-errors.test.ts`(15)+ `ToolDispatcher.test.ts`(mock 透传 + PII 断言 + _meta 注入)。

---

## 逐维度结论(带 file:line 证据)

| 维度 | 结论 | 关键证据 |
|------|------|---------|
| **PII 护栏(主 catch)** | ✅ 有效 | `ToolDispatcher.ts:453-458` classifyError 不读 err.message;`tool-errors.ts:123-134` 原生 Error 兜底固定 'Internal error';T19 测试 `:911-929` 断言不含 'boom'/'secret' |
| **抛错点改造** | ✅ 完整安全 | path-utils(8 PathError)/godot-finder(4 InternalError)/addon-version(5)/guard(2)/EditorConnection(4)。safeMessage 均固定文本 |
| **err.code 分流兼容** | ✅ 仍工作 | ConnectionError 自带 code='NOT_CONNECTED'(`tool-errors.ts:71`),EditorToolExecutor `:149-163` 'code' in err=true,CONN_ERROR_CODES 含 NOT_CONNECTED |
| **_meta 注入逻辑** | ✅ 正确(已补测试) | `middleware.ts:65` after 链式赋值保证 healthSample 注入保留;`ToolDispatcher.ts:490-493` spread 合并不覆盖已有 _meta。I-2 测试已补 |
| **telemetry 回退** | ✅ defect 不复发 | `ToolDispatcher.ts:521` 固定 'TOOL_ERROR';`defects.ts:1178` 正则匹配该字面量,detect=0 |
| **classifyError 7 类** | ✅ retryable 全合理 | validation/path/guard=false;timeout/transport/connection=true;RateLimitError=guard+true(与 GuardError=false 区分) |
| **测试质量** | ✅ 非 fake-green | tool-errors 15 测试覆盖 7类+PII+newTraceId;T19 含路径 Error 验证护栏;mock opsErrorResult `:80-87` 真透传三元组;_meta 注入测试锚定 |
| **仓库级约束** | ✅ 无违反 | 不触及 capability-matrix 源 / rule-templates.ts / build/ 产物 |

---

## Blocking Issues

**无。** G2 在其设计范围(throw→主catch 路径)内 PII 护栏有效,无新泄漏。

---

## Important(非 Blocking)

### I-1. EditorToolExecutor catch→return 透传 err.message(pre-existing 缝隙)— **DEFERRED**
- **位置**:`src/core/EditorToolExecutor.ts:148-191`(`:152,172` err.message 进 errorPayload)
- **问题**:editor 插件 JSON-RPC error(`EditorConnection.ts:298-301` `new Error(msg.error.message)`)含编辑器侧路径时,经 EditorToolExecutor catch→return 路径直达 client,**不进 G2 主 catch**。
- **为何非 G2 Blocking**:pre-existing 行为,附录 F.2 scope 是主 catch + 抛错点。EditorToolExecutor 是 catch→return 中间层(把异常转 result 返回非 throw),独立一层。
- **处置**:**DEFERRED**。记录为后续独立改进(统一错误出口 / 对 msg.error.message 脱敏)。进 memory `pii-guard-catch-return-blindspot`。

### I-2. _meta.trace_id/duration_ms 注入无测试覆盖 — **已修复**
- **位置**:`src/core/ToolDispatcher.ts:490-493`
- **处置**:已补测试 `ToolDispatcher.test.ts`「injects _meta.trace_id + duration_ms on success path」,断言 `result._meta.trace_id` 匹配 `/^[0-9a-f]{16}$/` + `duration_ms` 为数字。106 测试全过。

---

## Nits

- **N-1** `ToolDispatcher.ts:681,689` resolveFindGodotOverride 回显 godot_path 绝对路径(pre-existing,回显用户主动提供的参数,风险低)
- **N-2** `overrides.ts:86,90,243` 三处 throw 含路径(pre-existing,冒泡主 catch 兜底 internal 不泄 PII,但分类不精)
- **N-3** `godot-finder.ts:116` detectGodotVersion 用 InternalError 而非 PathError(分类精度,无 PII 风险)
- **N-4** confirm 响应 `expires_at`(ToolDispatcher:414)是绝对 epoch ms,**非 PII**(无身份信息,ttl_seconds 已有,expires_at 是冗余便利字段)

---

## 工程教训(已进 memory)

1. **PII 护栏"主 catch 类型映射"的盲区**:classifyError 从异常类型映射、绝不读 err.message,在 throw→主catch 范围内有效。但 EditorToolExecutor 的 **catch→return** 路径(异常转 ToolResult 返回非 throw)是结构性盲区。教训:PII 护栏需覆盖**所有错误出口**,不能只守主 catch。→ memory `pii-guard-catch-return-blindspot`

2. **_meta 注入依赖 middleware after 链式赋值**:`executeMiddleware`(middleware.ts:62-71)Phase 3 按注册顺序执行 after,每个 after 返回值赋 result——这是 _meta 能到 client 的关键。若未来调整 middleware 顺序或 after 返回全新对象丢 _meta,无测试无法发现。教训:可观测性注入点必须有测试锚定。→ memory `meta-injection-needs-test-anchor`

3. **response 升级 + telemetry 固定的切分模式**:G2 让 response content JSON 携带结构化 errorCategory(给 AI),telemetry 维持固定 'TOOL_ERROR'(满足 defects.ts PII 检测器硬约束)。教训:defect 检测器约束某字段时,升级可分层——给 client response 精细化,给外发 telemetry 保持固定枚举。→ memory `response-telemetry-split-mode`

---

## 验证

- `npm run lint`:✅ 零错误
- `npm run build`:✅ tsc 零错误(_meta TS 断言 `as ToolResult & { _meta?: ... }` 验证 OK,SDK looseObject 运行时透传)
- `npm test`:✅ **5097 passed / 0 failed / 30 skipped**(含 tool-errors.test.ts 15 + ToolDispatcher.test.ts _meta/PII 断言)

---

## 后续(明确 deferred,不属本次 G2)

- I-1:EditorToolExecutor catch→return PII 盲区(统一错误出口)
- N-1/N-2:resolveFindGodotOverride godot_path 回显 + overrides.ts throw 分类
- G2 速赢批下一项:**G8 威胁模型文档**(附录 E.4,1d)
