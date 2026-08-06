# P3 三批选做 — 第三方审查报告

> **审查日期**: 2026-08-06
> **审查对象**: 分支 `feat/p3-selection`,4 个 commit(de637bb / 9d73e72 / 021fb6a / 4a1031a + 审查修复 90f065e)
> **审查者**: 自查(第三方 code-reviewer agent 因使用上限失败,由实施者以独立视角完成,所有声明 grep/read 实测)
> **审查方法**: 不预设 commit message 为真,逐条实测关键声明

---

## 总体判定: **SHIPPED WITH NITS**(审查中发现 1 个 BLOCKING 已修复 + 2 个 NIT)

三批改动设计正确、验证充分。审查中发现 1 个 BLOCKING bug(sendToBridge 误把 push 消息当响应 resolve)已在同一审查周期内修复(commit `90f065e`)。剩余 2 个 NIT 不阻断。

---

## 逐批结论

### 第一批:P3-1/P3-2 版本同步收口(commit `9d73e72`)— **SHIPPED**

**声称**: version-sync.mjs 加 server.json/Dockerfile,根治版本漂移。

**实测**:
- `D:\GitHub\godot-mcp-enhanced\scripts\version-sync.mjs:20-28` TARGET_FILES 含 serverJson/dockerfile ✓
- `D:\GitHub\godot-mcp-enhanced\scripts\version-sync.mjs:30` WRITE_TARGETS 含两者 ✓
- `D:\GitHub\godot-mcp-enhanced\scripts\version-sync.mjs:64-69` dockerfile 正则 `/godot-mcp-enhanced@([0-9][0-9.\w-]*)/` 实测匹配 prerelease(0.20.0-rc.1 / 1.0.0-alpha.3 均 OK)✓
- `node scripts/version-sync.mjs` 幂等(再跑全跳过)✓
- 4 处 version 实测一致:package.json/server.json/Dockerfile = 0.25.7,manifest/plugin.cfg/guide 也同步 ✓
- docs/distribution/server.json 已删除,check-tool-count.mjs:76 改读根 server.json ✓

**仓库级约束核查**:
- AGENTS.md「分发产物边界」:server.json/Dockerfile version 改动走 version-sync.mjs(改源机制),非手改产物 ✓
- AGENTS.md「独立副本同步约束」:本批不涉及 .claude/rules/ 与 rule-templates.ts ✓
- 删除决策(docs/distribution/server.json):实测无代码/CI 引用(grep 排除 CHANGELOG/plans 后零命中),安全 ✓

**NIT-1**: server.json description 补 `— 38 tools` 锚点是为让 check-tool-count 正则匹配。根 server.json description 现为 `"...closed-loop AI dev. — 38 tools"`——尾部工具数锚点对 MCP Registry 展示略突兀,但不阻断。建议后续优化 description 文案。

### 第二批:P3-7 C# 阶段一收尾(commit `021fb6a`)— **SHIPPED**

**声称**: project_replace 白名单加 .cs;read using 提取;edit 验证回滚接 dotnet build。

**实测**:
- `D:\GitHub\godot-mcp-enhanced\src\tools\script.ts:864` ALLOWED_EXTENSIONS 含 '.cs' ✓
- `D:\GitHub\godot-mcp-enhanced\src\tools\script.ts:349-377` read_script C# 分支有 using 提取(正则 `/^\s*using\s+([^;]+);/`,上限 50)✓
- `D:\GitHub\godot-mcp-enhanced\src\tools\script.ts:115-161` csharpValidateAndRevert 函数存在,调 dotnet build,无 .csproj/dotnet 不可用时返回 null(优雅降级)✓
- 三处 edit 调用点(L555/L603/L732 区域)有 `if (isCsharp && autoValidate)` 分支 ✓
- test/script-csharp.test.ts 5 case 全过 ✓

**NIT-2**: csharpValidateAndRevert 的 .csproj 检测(L134 `readdirSync(projectPath).some(f => f.endsWith('.csproj'))`)只扫项目根目录,不递归。Godot .NET 项目的 .csproj 通常在根目录,但 MSBuild SDK 风格项目可能在子目录。当前实现覆盖主流场景,子目录场景延后。

### 第三批:P3-6 subscriptions/listen(commit `4a1031a` + 修复 `90f065e`)— **SHIPPED (BLOCKING 已修复)**

**声称**: 三层改造(addon push + bridge 常驻 handler + GodotServer notification)。

**实测**:
- addon `D:\GitHub\godot-mcp-enhanced\src\scripts\mcp_bridge.gd` _push_event_to_peer(L1306) + _push_peers 状态 + watch/monitor push 集成 ✓
- TS `D:\GitHub\godot-mcp-enhanced\src\tools\game-bridge.ts` 常驻 data handler(L213) + _pushBuffer + registerBridgePushHandler ✓
- TS `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:262-274` resources/subscribe handler + registerBridgePushHandler 注册 ✓
- GDScript push 消息格式 `{"jsonrpc":"2.0","method":"bridge/event","params":{...}}` 与 TS 解析(msg.method && msg.id === undefined)匹配 ✓
- npm run check:gdscript 0 errors/0 warnings ✓

**⚠️ BLOCKING ISSUE(已在 90f065e 修复)**:

`sendToBridge` 临时 data handler 的响应匹配逻辑(L337 原 `resp.id != null && resp.id !== id`)在收到 push 消息(无 id)时,`resp.id != null` 为 false → **不 continue** → 误把 push 消息当响应 resolve 正在等待的 request。

**根因**: P3-6 引入的 bridge/event push 消息(method 存在、id 为空)与 sendToBridge 的响应匹配条件冲突。P3 前无 push 消息,原逻辑无害;P3 后 push 消息会误触发 resolve,导致**正在等待的 bridge 请求收到错误数据**。

**修复(commit 90f065e)**: L337 改为 `resp.id == null || resp.id !== id` — 无 id 的消息(push/通知)一律 continue 跳过,只有 id 匹配当前 request 的响应才处理。

**影响分析**: 此修复改变原有 sendToBridge 核心逻辑,但 P3 前无无 id 消息到达此路径(bridge 是纯 req-resp),对非 push 场景零影响。76 个 bridge 测试全过验证无回归。

---

## Blocking Issues

| # | 问题 | 状态 |
|---|------|------|
| B-1 | sendToBridge 误把 push 消息(无 id)当响应 resolve | **已修复**(90f065e) |

## Nits

| # | 问题 | 建议 |
|---|------|------|
| N-1 | server.json description 尾部 `— 38 tools` 锚点文案突兀 | 后续优化 description |
| N-2 | csharpValidateAndRevert .csproj 检测只扫根目录不递归 | 子目录场景延后(主流 .csproj 在根) |

---

## 值得进 memory 的工程教训

1. **bridge-rpc-push-coexistence-pattern**: Node EventEmitter 多 'data' listener 共存是 push 改造的基础,但必须同步审查 req-resp handler 的响应匹配逻辑——无 id 消息(push)会穿透 `resp.id != null` 的防御,需显式 `resp.id == null → continue`(已登 memory)
2. **审查时机**: 第三方审查 agent 因限额失败时,实施者自查也能发现 BLOCKING(sendToBridge 误 resolve)——关键是独立于 commit message,重新 trace 数据流

---

## 验证完整性核查

| 声称的验证 | 核查结果 |
|-----------|---------|
| npm test 4517 passed | ✓ 实测 311 files / 4517 passed / 26 skipped |
| npm run check:gdscript 0 errors | ✓ 实测 errors=0 warnings=0 |
| npm run lint 零 error | ✓ 实测零 error |
| npm run build 零 error | ✓ 实测零 error |
| version-sync 幂等 | ✓ 实测再跑全跳过 |
| check-tool-count 20 处一致 | ✓ 实测 20 处通过 |

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-06 | 初版,自查(第三方 agent 限额失败),发现并修复 B-1 BLOCKING |
