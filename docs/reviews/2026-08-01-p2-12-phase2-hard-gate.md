# P2-12 二期 McpTestSuite Transport 防饥饿 — 独立审查报告

> **审查者**：code-reviewer subagent（隔离视角，所有声明 grep/read 实测）
> **日期**：2026-08-01
> **分支**：`feat/p2-12-phase2-hard-gate`
> **路线**：async coroutine（nav_bake_mesh 范式）
> **判定**：**SHIPPED WITH NITS**（无 Blocking Issue，3 Nits 已全处理）

## 总体判定

核心改动正确、自洽、与既有 nav_bake async 范式高度一致，防饥饿机制（每 test 后 `await get_tree().process_frame`）闭环成立，heartbeat 在 test_run 期间持续 tick。无 Blocking，3 Nits（注释 drift / dead code）已全处理。

## 逐维度结论

### 1. async 路由一致性 — PASS
- websocket_server.gd:360-364 test_run 分流与 nav 分流（:353-359）完全对称
- command_handler.gd:266-270 handle_test_async 正确 await
- test_manage 仍走同步 handle()（:130-131）

### 2. yield_cb 机制正确性 — PASS
- mcp_test_runner.gd:46 默认 Callable()（invalid）→ :134 if yield_cb.is_valid() 守卫，空时走同步
- test_commands.gd:117 传 Callable(self, "_yield_frame")，:155-156 含 await get_tree().process_frame
- RefCounted 无 get_tree()，yield 委托给 Node 的 test_commands 是正确职责分离

### 3. TS operation 包裹 — PASS
- EditorToolExecutor.ts:127-137 完全照搬 nav bake 模板
- 290s < GD clamp 600（heartbeat.gd:69 + websocket_server.gd:325）
- HealthMonitor ping 走独立 setTimeout 链，不经 executeChain 串行
- 比nav_bake 更优：显式 timeoutMs:290000 消除 orphan

### 4. 兼容性 — PASS
- test_undo_manager.gd 5 测试仍可跑（同步、无 await）
- run_suite 唯一调用方 test_commands.gd:121 已 await
- headless 不受影响（testing.ts 硬返 EDITOR_ONLY）

### 5. drift 检测调整 — PASS
- static-grep.test.ts:63 正则 `/^\s*"(\w+)":(?:\s*$|\s+return)/gm` 同时匹配多行体 + 单行体
- 扫三函数 handle(/handle_nav_async(/handle_test_async( 完整

### 6. 仓库级约束 — PASS
- 工具清单未变（test_run/test_manage 一期已登记）
- rule-templates.ts / godot-mcp-core.md 未改 → 无需 version-sync

### 7. 验证完整性 — PASS
- yield_count=11 合理（10 test × 1 yield + 1 suite 间 yield）
- coordinator 实测 lint 0 / build 0 / test 4377 passed

## Nits（全处理）

### N1. editor-method-map.ts 注释 drift — ✅ 已修
:98-99 "phase 1 sync <30s" 改 "async coroutine (290s 预算)"；editor-method-map.test.ts:215 同步改。

### N2. test_run orphan 注释未对称 nav — ✅ 已修
websocket_server.gd test_run 分流补 orphan 注释（290s 大幅降低概率 + §10 peer 守卫兜底）。

### N3. handle_test_run_async dead pass 块 — ✅ 已修
test_commands.gd:135-143 两个 `if ... pass` 空块 + 过期 TODO 删除，改诚实注释（verbose per-test rows 三期补）。

## 值得进 memory 的工程教训

1. **RefCounted vs Node 协程职责分离**：McpTestRunner extends RefCounted 无 get_tree()，yield 能力注入为 Callable（yield_cb），由 Node 的 caller 提供。Godot 中非 Node 类参与主循环 yield 的通用范式。

2. **Callable.is_valid() 守卫实现可选 yield**：默认 Callable()（invalid）→ if is_valid() await。一行守卫同时支持 editor 异步 + headless 同步，无需 if/else 分叉。

3. **operation 包裹 + 长 timeoutMs 优于 nav_bake orphan 默认**：test_run 显式 timeoutMs:290000 让客户端等满预算，从根消除 orphan。nav_bake 默认 30s 致 orphan，未来可照此升级。

4. **drift 检测正则须覆盖所有 dispatcher 函数**：method 从 handle() 移到 handle_test_async() 时，子串匹配仍绿但失位置感知；函数体扫描才精确。

5. **注释是 PR 最易 drift 的资产**：本 PR 逻辑正确但 2 处 "phase 1 sync <30s" 注释未同步。审查清单应含"grep 旧术语确认无残留"。
