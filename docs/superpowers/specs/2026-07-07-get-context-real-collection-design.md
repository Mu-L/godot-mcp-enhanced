# godot_get_context 真实采集 follow-up 设计

> **日期**: 2026-07-07
> **状态**: draft r2（按 spec 审查修订：IMP-1 computeMode/readConnections 数据源加 isBridgeReady + IMP-2 setter 名避撞名 + A-1/A-2 补注）
> **前置**: godot_get_context MVP 已 merge master `9142939`（spec r3 + 6 task SDD）
> **前 spec**: `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-godot-get-context-design.md`（r3）
> **触发**: final opus review 的 follow-up 清单（4 占位 helper 真实采集 + connectionMode 注入 + M5 await）

## 1. 背景与动机

godot_get_context MVP（master 9142939）的 4 个采集 helper（readProject/readScene/readConnections/readPerformance）为占位实现（返 null/默认），导致首版只返回会话级数据（callStats/toolGroups/workflows/mode），项目级字段降级。同时 computeMode 软读 `ctx.connectionMode`（ToolContext 无此字段），生产路径恒 headless。

本 follow-up 补真实采集 + connectionMode 注入，让 get_context 返回真实全景。

## 2. 目标与非目标

**目标**：
- 4 helper 真实采集（readProject/readScene/readConnections/readPerformance）
- connectionMode 真实推断（不软读 ctx）+ readConnections 真实连接态
- M5 修复（readScene/readPerformance 异步化 + handleGetContext async + return await）
- 字段级降级保持（永不抛错），单个采集失败不阻塞其余

**非目标（YAGNI）**：
- 不改 ToolContext 接口（用模块级 setter 注入，遵循 manage-tools 模式）
- 不做 M4 listPrompts 委托（留后续润色）
- 不改 MVP 已 merge 的字段结构（status/mode/project/connections/scene/recentCalls/callStats/toolGroups/workflows/rules/performance/hint 不变，只填充真实值）
- 不持久化采集（每调用现采）

## 3. 注入设计（方案 A — 模块级 setter，遵循 manage-tools 模式）

get-context 模块加两个 setter（同 instance-tools/manage-tools 的模块级注入模式）：

| setter | 签名 | 接线点 | 复用 |
|---|---|---|---|
| `setGetContextConnectionProvider(fn)` | `(provider: () => ConnectionStatus \| null) => void` | GodotServer.ts:147 旁（同一 provider 函数，独立 setter 避免与 manage-tools 的 `setConnectionStatusProvider` 撞名，r2 IMP-2） | 复用 manage-tools 的 `buildConnectionStatus` 工厂 |
| `setEditorSceneProvider(fn)` | `(provider: (projectPath?: string) => Promise<SceneSnapshot \| null>) => void` | GodotServer.ts（新，内部用 editorConn 调场景树查询） | 新注入（editor-sync 无独立工厂） |

**bridge 查询不注入**：get-context 直接 `import { sendToBridge, isBridgeReady } from './game-bridge.js'`（模块级导出，无需注入）。注：bridge 全局单例（多实例方向取舍，与 CallRecorder 单例同类，MVP 接受，r2 A-2）。

**project/rules 不注入**：直接 fs 读（projectPath 参数）。

**为什么 A 非 B（扩 ToolContext）**：manage-tools（`_connectionStatusProvider`）+ instance-tools（`_manager`/`_router`）都惯用模块级 setter。扩 ToolContext 侵入所有工具 ctx 类型，偏离既有模式。

## 4. 各 helper 真实采集契约

| helper | 现状（MVP 占位） | follow-up 真实采集 | 数据源 |
|---|---|---|---|
| `computeMode` | 软读 ctx.connectionMode（恒 headless） | connectionStatus.editor.connected→'editor'；否则 `isBridgeReady()`→'bridge'；否则 'headless' | connectionStatusProvider（editor 判定）+ `isBridgeReady`（bridge 判定 — `ConnectionStatus.bridge` 只 `note` 无 `connected`，r2 IMP-1） |
| `readConnections` | 硬编码默认未连接态 | editor 字段从 connectionStatus（installed/connected/state）；bridge.status 用 `isBridgeReady` 探测（connected/unreachable），bridge.note 从 connectionStatus | connectionStatusProvider（editor）+ `isBridgeReady`（bridge.status，r2 IMP-1） |
| `readProject` | return null | `{ name, godot, path }`：name 从 project.godot `[application] config/name`（或目录名兜底）；godot 从 godot-finder 版本；path = projectPath | projectPath 参数 + fs 读 project.godot + `getGodotPath`/版本探测 |
| `readRules` | 占位返 [] | 扫 `{projectPath}/.claude/rules/*.md` 返 basename 列表（无 projectPath 或目录不存在→[]） | projectPath + fs（用 path-utils 安全 join） |
| `readScene` | return null | editor 模式：调 `editorSceneProvider(projectPath)` 拿快照；bridge 模式：`sendToBridge('get_tree')` + 递归统计 typeTopN（>2000 节点只返 nodeCount）；headless：null | editorSceneProvider（editor）/ import sendToBridge（bridge） |
| `readPerformance` | return null | bridge 模式：`sendToBridge('get_performance')` 取 fps + memory；非 bridge：null | import sendToBridge |

### SceneSnapshot 契约（editorSceneProvider 返回）
```ts
interface SceneSnapshot {
  path: string;        // 当前场景 res:// 路径
  root: string;        // 根节点名
  nodeCount: number;   // 总节点数
  typeTopN: Array<{ type: string; n: number }>;  // get_class() 计数 top-5
}
```
editor 场景树查询的具体实现（editorConn 调哪个方法/命令）由 GodotServer 接线时定（参照 editor-sync handleTool 的场景树读取路径），plan 阶段读 EditorConnection 确认精确 API。

### bridge get_tree / get_performance 返回解析
- `sendToBridge('get_tree')` 返回 `{ root, child_count, ... }`（BridgeResponse.data）—— 递归统计需额外遍历（get_tree 默认可能只返顶层，深度遍历要发额外命令或在 bridge 端聚合）。plan 阶段确认 get_tree 是否返完整树 + typeTopN 统计策略（bridge 端 GDScript 聚合 vs TS 端逐节点查）。
- `sendToBridge('get_performance')` 返回 Performance 标准字段（fps/memory/static_mem 等），取 fps + memory_mb。

## 5. M5 await 锁定（final review M5）

readScene（editorSceneProvider async + sendToBridge async）+ readPerformance（sendToBridge async）→ 异步 helper。

改动：
- `handleGetContext(args, ctx): Promise<ToolResult>` 改 async
- readScene/readPerformance 在 safe() 内 `await`（safe 改 async 或用 safeAsync wrapper）
- `handleTool` 的 `return handleGetContext(...)` 改 `return await handleGetContext(...)`（修 M5：外层 try/catch 才能抓 async 抛错，保"永不抛"契约）

注：safe() 当前同步（`safe<T>(fn: () => T, ...)`）。异步 helper 要 `safeAsync<T>(fn: () => Promise<T>, ...): Promise<T | null>`，或 safe 统一改 async。plan 阶段定（倾向 safeAsync 并行，保持同步 safe 给同步字段）。另：若 readProject 走 `godot --version` spawn 探版本（§9.4），readProject 也变 async（加入 safeAsync）；§9.4 倾向"无版本缓存则 godot 字段降级 null 避免 spawn"以保持 readProject 同步（r2 A-1）。

## 6. 接线（GodotServer.ts）

:147 现有 `setConnectionStatusProvider(() => buildConnectionStatus(this.editorConn, ...))`（manage-tools）。

新增（:147 旁）：
```ts
// get-context 共享 connectionStatus provider（同 manage-tools，独立 setter 避撞名）
setGetContextConnectionProvider(() => buildConnectionStatus(this.editorConn, this.dispatcher?.getHealthMonitor() ?? null));
// get-context editor 场景快照 provider（内部调 editorConn 场景查询）
setEditorSceneProvider(async (projectPath) => {
  if (!this.editorConn?.isConnected()) return null;
  // 调 editorConn 场景树查询（具体方法 plan 阶段读 EditorConnection 确认）
  // 返回 SceneSnapshot 或 null（未打开场景/查询失败）
});
```
:436 现有 `setConnectionStatusProvider(null)`（清理）旁加 get-context provider 清理（setGetContextConnectionProvider(null) + setEditorSceneProvider(null)）。

## 7. 错误处理（保持 MVP 契约）

- **字段级降级保持**：每个 helper 独立 try/catch（safe/safeAsync），失败→字段 null + failedFields 入列，status=partial
- **元工具永不抛错**：外层 try/catch + handleTool `return await`（M5 后 async 仍抓得到）
- **provider 未注入**：connectionStatusProvider/editorSceneProvider 未注入（null）→ 对应字段降级（mode=headless 兜底 / scene=null），不抛
- **bridge 未就绪**：isBridgeReady false / sendToBridge 抛错 → mode 跳过 bridge / scene/performance 降级 null（safeAsync 捕获）

## 8. 测试策略

- **test/tools/get-context.test.ts 扩展**（真实采集 + 降级）：
  - mock setGetContextConnectionProvider（注入 fake connectionStatus：editor connected / bridge note）
  - mock isBridgeReady + sendToBridge（vi.mock game-bridge，返 fake get_tree/get_performance + isBridgeReady true/false）
  - mock setEditorSceneProvider（返 fake SceneSnapshot / null / 抛错）
  - 断言：editor 模式 scene 来自 editorSceneProvider；bridge 模式（isBridgeReady true）scene/performance 来自 sendToBridge；headless（editor 未连 + isBridgeReady false）scene/perf null；provider 抛错→字段降级 + status=partial
  - M5：readScene/readPerformance 抛 async 错 → 外层 catch 抓到（不泄漏 unhandledRejection）
- **readProject/readRules**：真实 fs（用 test/fixtures 小项目，或 mock fs）—— project.godot parse + .claude/rules 扫描
- **回归**：MVP 6 用例（def/unknown/headless ok/include_scene=false/failed partial/永不抛）不破坏
- **接线测试**：GodotServer.ts:147 接线后 provider 真注入（参照 manage-tools 接线测试模式）
- **门禁**：vitest 全绿 + tsc 0 + lint 0 + capability 不回归

## 9. 风险与开放问题

1. **editor 场景查询 API**：EditorConnection 的场景树查询方法/命令未在 spec 阶段核实（editor-sync handleTool 封装了；reviewer 印证 EditorConnection 无现成场景快照 API）。plan 阶段读 `src/core/EditorConnection.ts` + editor-sync handleTool 的场景读取路径，确认 editorSceneProvider 实现的精确 API。若 editorConn 无便捷场景快照方法，editorSceneProvider 可能要发多条 WS 命令（get_tree + get_node 递归），或退化为只返 root+nodeCount（typeTopN 跳过）。
2. **bridge get_tree 深度**：sendToBridge('get_tree') 默认返顶层还是完整树未确认。若只顶层，typeTopN 递归要逐节点查（慢）或在 bridge GDScript 端聚合（mcp_bridge.gd 加方法）。plan 阶段确认 + 选策略。
3. **connectionStatusProvider 共享**：manage-tools 的 provider 是模块私有。get-context 独立 setter `setGetContextConnectionProvider`（GodotServer 接线时注入同一 provider 函数），不抽公共模块（YAGNI，两模块够用；若第三个消费者出现再抽）。
4. **readProject godot 版本探测**：godot-finder 的版本 API（getGodotPath 返路径，版本要 `godot --version` 子进程或缓存）。plan 确认是否已有版本缓存（避免每次 get_context spawn godot）。若无缓存，readProject.godot 字段降级（只返 name+path，godot=null）避免每次 spawn。

## 10. 参考文件清单

**前置（MVP）**:
- `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`（待改：4 helper 真实实现 + 2 setter + M5 async）
- `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-godot-get-context-design.md`（r3，字段结构）

**注入模式参照**:
- `D:\GitHub\godot-mcp-enhanced\src\tools\manage-tools.ts:247` buildConnectionStatus 工厂 + `:174` handleSync 用法 + 模块级 `_connectionStatusProvider` + `:262` bridge={note}（无 connected，IMP-1 前提）
- `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:147,436`（provider 接线 + 清理点）

**bridge 查询**:
- `D:\GitHub\godot-mcp-enhanced\src\tools\game-bridge.ts:264` sendToBridge + `:869` isBridgeReady（直接 import）

**editor 场景查询（plan 阶段确认 API）**:
- `D:\GitHub\godot-mcp-enhanced\src\core\EditorConnection.ts`（editorConn 场景查询方法）
- `D:\GitHub\godot-mcp-enhanced\src\tools\editor-sync.ts:51` handleTool（场景树读取路径参照）

**project/rules**:
- `D:\GitHub\godot-mcp-enhanced\src\tools\project.ts`（project.godot 解析参照）
- `D:\GitHub\godot-mcp-enhanced\src\core\godot-finder.ts`（godot 路径/版本）
- `D:\GitHub\godot-mcp-enhanced\src\core\path-utils.ts`（安全 join）

**M5**:
- `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts:38,91`（handleTool return + safe wrapper，改 async/await）
