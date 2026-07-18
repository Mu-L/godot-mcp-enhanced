# Spec B — bridge change_scene 断连修复设计

**日期**：2026-07-18
**范围**：反馈 ④ bridge change_scene 后 `game_query ping` 报 `BRIDGE_NOT_CONNECTED`
**recall**：review 工作区 defects.md 已登记 3 条直接相关 open finding（**非"根因未锁"** — 审查 CRITICAL 修正）
**审查**：`D:\workspace\review\.claude\reviews\2026-07-18-edit-node-persist-design-eng-review.md`

## 背景

CardGame2（Godot 4.7 + bridge 模式）：`run_project` 启动游戏后 bridge 连上（main_scene ping 通，scene=main_scene）；触发 change_scene 到 hero_scene 后 `game_query ping` 报 `BRIDGE_NOT_CONNECTED`。游戏进程仍在跑。用户 07-18 多次复现，现象真实。即使设 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`（S4）也不行。

子代理源码核实：autoload 在 change_scene 时**不销毁重建**（Godot 语义+源码双证：autoload 是 `get_tree().root` 直接子节点，与 `current_scene` 平级，change_scene 只换 current_scene），secret 不会重生——**疑似根因（autoload 重建）推翻**。

## recall（审查 CRITICAL）

**⚠️ 自审发现：模式与子系统核实（plan Step 0 前置必做）**：3 条 finding 均为 **editor connection**（`EditorConnection` 9090 WebSocket / `GodotServer.handleEditorStall`）相关。但反馈 ④ 标注 **bridge 模式**（`mcp_bridge.gd` 9081 TCP / `game-bridge.ts` 客户端）——两者是三层架构的不同连接层。

- **若 CardGame2 实际是 editor 模式**（反馈"bridge"误标）→ 3 条 finding 直接适用。
- **若真 bridge 模式**（TCP 9081）→ editor stall finding 可能不适用（editorConn 与 bridgeConn 是独立连接，GodotServer 内互不影响），应回到子代理 bridge 侧分析（`game-bridge.ts:206,220-223,231` 三种 BRIDGE_NOT_CONNECTED 触发 + 主线程卡顿 > 10s auth timeout 假设，autoload 不销毁已证）。

plan Step 0 第 0 步：用 `godot_get_context` 看 connectionMode / 端口监听（9081 = bridge vs 9090 = editor），确认 CardGame2 实际模式，再决定 3 条 finding 是否适用。

---

`D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`（**review 工作区 defects.md，非本仓库 `test/regression/defects.ts`** — 已 grep 核实本仓库 defects.ts 无这 3 条）已登记 3 条直接相关 open finding（2026-07-13 进程通信增量审查），fix-forward 已给出。**不是"从头复现锁根因"**（前提：模式核实确认是 editor 模式）。

3 条 finding 均与 change_scene 断连强相关（场景切换触发 stall → 置 null 不 disconnect → zombie 重连抢 peer slot → 新连接建不上 = "断连"）。

## 3 条 finding（review defects.md，Step 0 须对照本仓库代码核实是否仍命中）

### 1. handle-editor-stall-no-disconnect（IMPORTANT, review defects.md :1541-1549）
- **现象**：`src/GodotServer.ts:423-432` `handleEditorStall` 置 `editorConn=null`（:431）前未 `disconnect()`，被遗弃连接的 `reconnectTimer` 继续 zombie 重连 ~15min 占 peer slot。
- **fix-forward**：`:431` `this.editorConn=null;` 前加 `try { this.editorConn?.disconnect(); } catch {}`（与 :442-444 对称）。

### 2. do-not-retry-missing-disconnected（IMPORTANT, :1551-1558）
- **现象**：`src/core/EditorToolExecutor.ts:92-93` `isConnectionError` 匹配 `'Connection lost'/'Not connected'/'Request timeout'`，**漏 `'Disconnected'`**；`src/core/EditorConnection.ts:499` disconnect() reject 的是 `'Disconnected'`。重建期间 in-flight 调用不带 `do_not_retry` → 客户端重试 → 重复执行。
- **fix-forward**：`isConnectionError` 补 `'Disconnected'`（或统一 `EditorConnection.ts:499` reject 措辞为 `'Connection lost'`）。

### 3. operation-pause-unwired（IMPORTANT, :1561）
- **现象**：operation 暂停机制（`startOperation/endOperation`）**零生产调用**，长编辑器操作（nav bake / import / **change_scene**）可能伪心跳断连丢结果。
- **fix-forward**：接 `startOperation/endOperation` 到长操作前后。

## Step 0 — recall 核实（强制先做，对照本仓库 master HEAD 代码）

**不写 CardGame2 复现脚本**（detect 即证据）。重跑 3 条 finding 的 detect（status 可能滞后于代码，[[godot-mcp-enhanced-defects-status-stale]]）：

1. 读 `src/GodotServer.ts:423-432`，确认 `this.editorConn=null`（:431）前**无** `disconnect()`。
2. 读 `src/core/EditorToolExecutor.ts:92-93` `isConnectionError`，确认匹配列表**不含** `'Disconnected'`。
3. grep `startOperation|endOperation` 生产调用点（非定义/测试），确认**零**生产调用。

**同时**：把这 3 条登记进本仓库 `test/regression/defects.ts`（CI 门禁 baseline — 已核实本仓库 defects.ts 当前无这 3 条，status=OPEN + detect 命令 + fix-forward 注释）。

## Step 1 — 按 detect 结果分支修法

- **handle-editor-stall-no-disconnect 命中** → 直接采用一行 fix-forward（null 前 try disconnect）。**首选**，不需要 CardGame2 复现。
- **do-not-retry-missing-disconnected 命中** → `isConnectionError` 补 `'Disconnected'`（或统一 reject 措辞）。
- **operation-pause-unwired 命中 + change_scene 复现仍指向长操作伪心跳** → 此时才写复现脚本，修法是接 `startOperation/endOperation`。
- **3 条全不命中**（代码已修但 finding 未关）→ 重新分析，change_scene 断连另有根因（回到子代理报告的"主线程卡顿 > 10s auth timeout"假设，安排 get_performance fps + ping timeout=60000 复现）。

## 验收

- 每条改完重跑对应 detect（grep/读行号）确认命中消失（对齐 defects FIXED 惯例：detect=0）。
- change_scene 后 bridge ping 不再断（CardGame2 运行时确认；若 handle-editor-stall fix 后仍断则进入 operation-pause 分支）。
- 本仓库 `defects.ts` 3 条登记后 detect 全绿（CI 门禁）。

## 范围边界

- 仅修 change_scene 断连相关（editor stall disconnect / do_not_retry / operation pause）。
- 不改 bridge secret 机制（autoload 不销毁已证实，secret 无关）。
- 不改 `INACTIVITY_TIMEOUT`（60s 不活动是独立机制，若 Step 1 后仍断再评估）。

## 行号说明

本 spec 行号（GodotServer.ts:423-432/431/442-444、EditorToolExecutor.ts:92-93、EditorConnection.ts:499、review defects.md :1541-1561）来自审查文档（审查者 2026-07-18 读的）。plan Step 0 全部重新读核实。
