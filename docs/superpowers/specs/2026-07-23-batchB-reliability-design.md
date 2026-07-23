# 2026-07-23 批次 B 可靠性修复设计（进程通信 + 崩溃恢复 + 并发 + 资源原子化）

> 适用于 godot-mcp-enhanced v0.23.0+（批次 A 安全修复之后）

## 背景

5 份审查报告（2026-07-22 生成，通用版 + 4 专项）暴露 37 条 finding，全 CONFIRMED。拆 5 批（A 安全 / **B 可靠性** / C 正确性 / D 工具治理 / E 测试缺口）。批次 A（10 条安全）已闭环（`3c285bf..ff16a25`）。本 spec 是批次 B（可靠性）。

**批次 B 来源**：专项2「可靠性专项审查（进程通信+崩溃恢复+并发）」4 条 + 通用版「三层架构综合审查」进程通信/资源写 6 条 = **10 条**。用户选全 10 条一个 SDD（4 task 组）。

**Architecture**：纯加固 + 统一重构。降级链路 3 P1（B1-B3）协同设计（检测→归因→执行三环节），避免批次 A I1 式跨 task 裂缝。资源写 17 处三环境统一原子写模式。不改工具签名与正常路径行为。

## Finding 清单（10 条，B1-B10）

| # | 来源 | finding | 严重度 |
|---|------|---------|--------|
| B1 | 通用版 P1 | health-monitor evaluateState 不分 errorType，工具失败误降级 | P1 |
| B2 | 通用版 P1 | handleEditorStall 不 disconnect 留 zombie | P1 |
| B3 | 专项2 P1-1 | TCP 半开降级 ~225s（ping 复用 30s 超时） | P1 |
| B4 | 通用版 P2 | do_not_retry 覆盖不全（漏 Disconnected/JSON parse error） | P2 |
| B5 | 通用版 P2 | fireDisconnect/fireReconnect 裸迭代无 try/catch | P2 |
| B6 | 通用版 P2 | health-monitor 重建后卡 reconnecting 15s | P2 |
| B7 | 通用版 P1 | 资源写非原子（17 处 ResourceSaver.save 直写无 tmp+rename） | P1 |
| B8 | 专项2 P2-2 | isConnected() 假阳性无 JSDoc 活性语义（advisory） | P2 |
| B9 | 专项2 P2-3 | 崩溃恢复 orphan 文档缺 opt-in env 说明（advisory） | P2 |
| B10 | 专项2 P2-4 | performAuth 10s 硬编码（advisory） | P2 |

## 设计（4 task 组）

### 组 1：降级链路统一重构（B1+B2+B3，协同设计防裂缝）

三环节在同一降级链路（TCP 半开 → 心跳检测 → 失败归因 → reconnecting → handleEditorStall 降级），**必须协同**——各自改会引入裂缝（如检测快但归因不准仍误降级，或降级时留 zombie 触发跨实例误降级）。

**B3 检测**（`GodotServer.ts:460` ping fn + `EditorConnection.ts:136` requestTimeoutMs=30s）：
- 现状：`pingFn = () => editorConn.request('ping').then(()=>true).catch(()=>false)`，复用业务 request 的 30s 超时 → TCP 半开单次 ping 30s 才超时，5×(15s interval + 30s) ≈ 225s 才降级。
- 修复：心跳用**独立短超时**。EditorConnection.request 加可选 `{ timeoutMs }` 参数（心跳传 5000），或新增专用 `ping(timeoutMs)` 方法。单次失败 5s → 5 次约 50s + 间隔 ≈ 75-125s，显著改善。
- 与业务 request 分离：业务 request 仍 30s（编辑器操作可能慢），心跳 5s（活性检测要快）。

**B1 归因**（`health-monitor.ts:216-226` evaluateState + `:446` ToolDispatcher healthSample）：
- 现状：`recordFailure()` 不分来源，evaluateState `consecutiveFails >= maxConsecutiveFailures` → reconnecting。ToolDispatcher healthSample 中间件对所有工具失败调 recordFailure → headless 工具连续失败 5 次误判 editor 卡死降级。
- 修复：`recordFailure(errorType?)` 加参数，心跳失败传 `'heartbeat'`，工具失败传 `'tool'`（或 healthSample 只 recordSuccess + 单独 recordToolError 不驱动状态机）。evaluateState 仅当**最近失败含 heartbeat errorType** 才进 reconnecting；纯工具错误只贡献 degraded（recentSuccessFlags）。
- 决策（plan 细化）：推荐 recordFailure 加 errorType + evaluateState 分流（最小改动，保留 degraded 统计）。

**B2 执行**（`GodotServer.ts:423-432` handleEditorStall）：
- 现状：`handleEditorStall` 只 `markEditorFallback + connectionMode='headless' + degradeToHeadless + stopHeartbeat + editorConn = null`，**无 disconnect()**。旧 EditorConnection 的 WS 仍 OPEN + reconnectEnabled true → zombie 闭包重连耗尽后跨实例触发 reconnectExhausted → handleEditorStall 再降级。
- 修复：handleEditorStall 顶部加 `try { this.editorConn?.disconnect(); } catch {}` 再 `null`（对齐 :443 establishEditorConnection 的 disconnect 模式）。disconnect 会 reconnectEnabled=false + connectGeneration++ + 清空 handler Set，彻底切 zombie。

**统一设计原则**：检测快（5s ping）+ 归因准（仅 heartbeat 降级）+ 执行净（disconnect zombie）。三环节一个 task 实现同提交，避免半改状态。

### 组 2：进程通信 P2（B4+B5+B6）

**B4**（`EditorToolExecutor.ts:93` + `EditorConnection.ts:243/299/309/331/356/499`）：do_not_retry 字符串匹配三关键词，漏 `:299` JSON parse error + `:499` Disconnected。修复：EditorConnection reject 时挂 `err.code = 'CONNECTION_LOST'/'DISCONNECTED'/'PARSE_ERROR'`（对齐 :273-275 JSON-RPC error 处理），Executor 按 err.code 判 do_not_retry。

**B5**（`EditorConnection.ts:101-109` fireDisconnect/fireReconnect）：裸迭代 handler Set，单 handler 抛错跳过 scheduleReconnect + connectAttempt 残留。修复：对齐 `health-monitor.ts:156-160` try/catch 包裹每个 handler。

**B6**（health-monitor 重建）：establishEditorConnection 成功后 hm.state 卡 'reconnecting' 最长 15s（首个心跳要等 heartbeatIntervalMs）。修复：establishEditorConnection 成功后显式 `hm.setState('connected')`。

### 组 3：资源写原子化（B7，17 处三环境，拆 3 sub-task）

**问题**：17 处 `ResourceSaver.save(res, path)` 直写目标 path，无 tmp+rename。超时 kill 落在 save 中途产半截损坏 .tres/.tscn，阻塞项目加载（P2-1 csv 已修 1 处，复发同构）。

**统一模式**（tmp+rename 原子提交，对齐 P2-1 csv 修复 `5758366`/`0131823` + memory [[resourcesaver-extension-dispatch]]）：
```
save 到 path + ".tmp.tres"（tmp 须 .tres 结尾，Godot 按扩展名分派 saver）
→ DirAccess.rename_absolute(tmp, full_path) 覆盖
→ rename 失败 DirAccess.remove_absolute(tmp)
→ 脚本启动清残留 *.tmp.tres
```

**三环境不共享 helper**（addons editor / src headless / TS 生成片段是独立 GDScript 上下文）：
- **sub-task 3a**（`src/scripts/godot_operations.gd` 9 处 :285/352/406/489/564/641/689/825/847）：加 `_save_atomic(res, path)` helper，9 处改调。
- **sub-task 3b**（addons `ui_commands.gd:269/373` + `asset_commands.gd:120` 3 处）：editor 插件侧加 helper（或共用 command_helpers.gd），3 处改调。
- **sub-task 3c**（TS 生成片段 5 处：`ui-theme.ts:58/141` + `scene-instance.ts:26` + `scene-commit.ts:118` + `material-ops.ts:354`）：TS 模板改 tmp+rename 模式（每处独立，不共享 GDScript helper，对齐 data-import.ts:188 P2-1 模式）。

**注意**：.tscn 资源（packed_scene）tmp 须 `.tmp.tscn`（非 .tmp.tres），按目标扩展名分派。

### 组 4：advisory（B8+B9+B10）

**B8**（`EditorConnection.ts:535` isConnected）：JSDoc 注明"仅反映 ws close 事件，非 TCP 实时活性；活性检测见 health-monitor 心跳"。
**B9**（`.claude/rules/godot-mcp-core.md` orphan 段）：注明崩溃恢复需 `GODOT_MCP_FULL_SYSTEM_SCAN=true`（opt-in 防误杀是有意设计，不改默认）。
**B10**（`EditorConnection.ts:406` authTimeout=10000）：参数化 `authTimeoutMs`（独立选项或复用 connectTimeoutMs）。

## 不修 / 否决

无。10 条全修（用户选全范围）。

## 验收标准

1. **10 条修复**：B1-B10 每条有对应改动 + 来源可溯。
2. **降级链路协同**：B1+B2+B3 一个 task 同提交，三环节协同（检测快/归因准/执行净）。
3. **资源写原子化**：17 处改 tmp+rename（三环境），无直写目标残留（grep 验证）。
4. **回归门禁**：`tsc --noEmit` exit 0；`check:gdscript` errors=0 warnings=0（全 addon 编译）；全量 vitest 无新 failed（pre-existing T11 4 条不变）。
5. **defects detect 守卫**：批次 B 新增 finding 登记 defects.ts（FIXED detect===0 防复发）。
6. **CHANGELOG**：批次 B 条目（可靠性段）。

## 风险

1. **降级链路改动引入新裂缝**（最高）：B1/B2/B3 改 health-monitor/EditorConnection/GodotServer 核心通信，可能破坏既有降级/重连。缓解：三环节协同设计 + 集成测试（mock HealthMonitor + EditorConnection + Dispatcher，模拟 TCP 半开/工具失败/崩溃）+ final whole-branch review。
2. **资源写 17 处三环境**：跨 addons/headless/TS 生成，每环境 GDScript 上下文独立不共享 helper，改动面大。缓解：拆 3 sub-task 按环境隔离 + 每处对齐 P2-1 csv 已验证模式 + memory [[resourcesaver-extension-dispatch]] 注意 tmp 扩展名。
3. **B3 ping 独立超时**：改 EditorConnection.request 签名（加 timeoutMs）或新增方法，影响所有 request 调用方。缓解：可选参数不破坏既有调用（默认 30s），仅心跳传 5s。
4. **TCP 半开难复现验证**：模拟 TCP 半开（accept 不响应不 close）需特殊 fixture。缓解：单测 mock EditorConnection.request 超时行为 + 文档校准降级时间为实测值。
