# godot_get_context 元工具设计

> **日期**: 2026-07-07
> **状态**: draft r3（r2 复核后再修订：r2-N1 放回 NO_PROJECT_PATH_TOOLS、r2-N2 进 core.tools；r2 的 I-1/I-2/I-3/A-1/A-4 不动）
> **关联候选**: `D:\workspace\Obsidian\GodotMCP\项目待办.md` §调研驱动改进候选 P0
> **参考实现**: `D:\GitHub\_research\sparda\src\server\stdio.js:403-475`（`sparda_get_context`）
> **调研出处**: `D:\workspace\Obsidian\GodotMCP\系统文档\资料-sparda与skil-lock范式借鉴.md`
> **审查报告**: `D:\workspace\review\.claude\reviews\2026-07-07-godot-mcp-enhanced-get-context-spec-review.md`

## 1. 背景与动机

2026-07-07 三轮调研（官方 MCP servers + sparda + skil-lock）识别出 P0 高 ROI 候选：`godot_get_context` 元工具。

**痛点**：AI 操作 Godot 时，每次新会话/新任务起步要反复调用 `query_scene_tree` / `list_nodes` / `manage_tools(sync)` / health 类工具摸清环境（当前场景、节点规模、可用工具组、最近做了什么、连接状态），产生大量"探路"开销——通常 5+ 次往返才能建立上下文。

**借鉴**：sparda 的 `sparda_get_context` 一次返回全景上下文（工具清单 + workflow + runtime stats + immune memory + behavior 快照），显著减少探路。godot 借鉴此范式，内容适配 Godot 工具世界（无 sparda 的 immune / flywheel / behavior 引擎，这些是 sparda 行为图专有）。

## 2. 目标与非目标

**目标**：
- 一次调用返回会话全景：模式 + 项目 + 连接 + 场景快照 + 调用历史/统计 + 工具组 + workflow(prompt)入口 + rules + 性能
- 替代 AI 起步探路循环（5+ 次 → 1 次）
- 元工具永不抛错（字段级降级，部分失败在字段内标注）

**非目标（YAGNI）**：
- 不做 sparda 式运行时行为分析（myelin / rhythm / flywheel / dependencies）—— 需行为图引擎，godot 工具世界无此骨架
- 不做 immune 熔断（候选 P1#3 `immune 熔断`，独立中间件，不在此工具）
- 不做调用序列自动挖掘 workflow（brainstorming 已否决的方案 C）
- 不持久化调用历史（进程内 RingBuffer，重启清空；持久化是另一条候选）
- 不替代 `query_scene_tree`（get_context 只给快照摘要：root + count + typeTopN；详细节点仍用 query_scene_tree）

## 3. 工具定义

| 属性 | 值 | 依据 |
|---|---|---|
| 工具名 | `godot_get_context` | 与 `godot_list_instances` / `godot_advanced_tool` 一致（元工具带前缀） |
| 工具组 | `core`（`core.tools` 列表加 `'godot_get_context'`，r3 修正 r2-N2） | `tool-registry.ts:167` `requires:[]` 始终可用 + `protected:true` 防误关 |
| 注册 | 加入 `ALWAYS_ALLOWED`（调用权限，不受 profile 过滤）+ `NO_PROJECT_PATH_TOOLS`（project_path 可选，起步探路场景 cwd 非 Godot 项目也能调，r3 修正 r2-N1）+ `core.tools` 列表加 `'godot_get_context'`（r3 修正 r2-N2：`extract.ts:32` 兜底只认 manage_tools，必须进 core.tools 才归 core 组） | `tool-registry.ts:167,243,303`；`capability/extract.ts:32` |
| actionRisks | `read` | 自动派生 `readOnlyHint:true` + `idempotentHint:true`（`module-loader.ts:104-149`） |
| 入参 | `project_path?: string`（可选，NO_PROJECT_PATH_TOOLS 保证不强制）、`include_scene?: boolean=true`、`include_performance?: boolean=true` | project/rules 字段依赖 project_path（传了补充，没传降级 null/[]，见 §4）；开关控制场景扫描/性能探测省开销 |
| 实现文件 | `src/tools/get-context.ts` | 单文件单职责，平铺父目录（`CLAUDE.md` src 分组规则） |

## 4. 返回结构

```json
{
  "status": "ok|partial",
  "failedFields": [],
  "mode": "headless|editor|bridge",
  "project": { "name": "my-game", "godot": "4.6.2", "path": "D:/..." },
  "connections": {
    "editor": { "installed": false, "connected": false, "state": null },
    "bridge": { "status": "probe-required|connected|unreachable" }
  },
  "scene": {
    "path": "res://main.tscn", "root": "Main", "nodeCount": 47,
    "typeTopN": [{ "type": "Node3D", "n": 12 }, { "type": "Label", "n": 8 }]
  },
  "recentCalls": [
    { "tool": "add_node", "ok": true, "ms": 120, "t": 34 }
  ],
  "callStats": {
    "total": 42, "success": 40, "fail": 2,
    "topTools": [{ "name": "add_node", "n": 12, "fail": 0 }],
    "recentErrors": [{ "tool": "edit_script", "type": "TOOL_ERROR", "msg": "...", "ms": 50 }]
  },
  "toolGroups": [{ "name": "scene", "active": true, "requires": ["headless"], "status": "n/a" }],
  "workflows": [{ "name": "create_platformer", "type": "prompt", "desc": "建平台游戏关卡" }],
  "rules": ["godot-mcp-core", "godot-mcp-bridge"],
  "performance": { "fps": 60, "memory_mb": 256 },
  "hint": "字段含义简短引导串（仿 sparda hint，但精简：告诉 AI scene.nodeCount=节点总数、recentCalls=最近操作、workflows=推荐入口、performance 仅 bridge）"
}
```

### 字段数据来源与降级

| 字段 | 数据来源 | 失败降级 |
|---|---|---|
| `status` / `failedFields` | 各字段采集结果聚合（任一失败→partial + 列名） | 始终可得 |
| `mode` | **摘要**：最高优先级可用连接——bridge 已连→"bridge"，否则 editor 已连→"editor"，否则→"headless"。editor/bridge 可同时连，明细见 connections | 始终可得 |
| `project` | 基于 `project_path`（无则 cwd / 最近活动项目）读 `project.godot`（name）+ `godot --version`（godot）+ path | 各子字段独立 null；无 project_path → null |
| `connections.editor` | `editorConn` 注入态 + healthMonitor state | `state=null` 当未启动 |
| `connections.bridge` | `game-bridge` 零接触探测（`isBridgeReady`） | `status="unreachable"` |
| `scene` | 按模式路由（见 §6）；**headless 恒 null**（无持久场景态） | `scene=null` 当 headless / 无场景 / 扫描失败 / `include_scene=false` |
| `recentCalls` / `callStats` | CallRecorder（§5.1） | 始终可得（空数组/零计数） |
| `toolGroups` | `TOOL_GROUPS` + `getActiveGroups()` + 各组 requires 探测 | 始终可得 |
| `workflows` | `prompts.ts` 注册的 prompt 清单（name + description） | 空数组 |
| `rules` | `{project_path}/.claude/rules/*.md` 文件名（r2 修正 A-3：基准为目标项目，非全局） | 无 project_path → `[]` |
| `performance` | bridge 模式 `game_query(get_performance)` | `null` 当非 bridge 或 `include_performance=false` |

## 5. 架构

### 5.1 CallRecorder（新增模块）+ RingBuffer 提升（fix-forward）

- **文件**: `src/core/call-recorder.ts`
- **形态**: 模块级单例（`getCallRecorder()`，仿 `getLogger()` 模式），ToolDispatcher 与 get_context 访问同一实例
- **RingBuffer 提升（r2 修正 I-2）**: `src/dashboard/ring-buffer.ts:5` **已存在** export class（含 `:13-15` ADVISORY-2 capacity 校验，比 `health-monitor.ts:58-88` 内联版健壮，但缺 sliceLast + Symbol.iterator）。实际现状是**两份**（dashboard export 版 + health-monitor 内联版）。方案：**提升 `src/dashboard/ring-buffer.ts` → `src/core/ring-buffer.ts`**，合并两版优点（吸收 dashboard 的 capacity 校验 + health-monitor 的 sliceLast + Symbol.iterator），三方 import（dashboard + health-monitor + call-recorder），**三份→一份**。这是 `duplication-across-layers(open)` defect 的 fix-forward（DRY 收益比原 spec 预期更大）。
- **数据结构**:
  - `recent: RingBuffer<CallRecord>`（容量 50），`CallRecord = { tool, ok, ms, errorType?, msg?, t }`（t = 相对秒，从首次记录起 offset）
  - `byTool: Map<string, { n, fail }>`（聚合，每工具调用数 + 失败数）
  - `total / success / fail`（全局计数）
  - `recentErrors: RingBuffer<ErrorRecord>`（容量 5）
- **API**:
  - `record(tool: string, ok: boolean, ms: number, errorType?: string, msg?: string, instanceId?: string): void`
  - `getRecent(n: number, instanceId?: string): CallRecord[]`
  - `getStats(instanceId?: string): { total, success, fail, topTools, recentErrors }`（topTools 取 byTool top-10）
  - `reset(): void`（测试用）
- **常量**: `RECENT_LIMIT=50`, `TOP_TOOLS=10`, `RECENT_ERRORS=5`
- **defect 标注（r2 修正 A-4）**: 模块级单例命中 `module-level-mutable-state(open)` defect 形态。同步操作无真实竞态、风险可接受；顶部注释标注此形态 + record/getStats 预留可选 `instanceId` 参数，为多实例 per-instance 扩展铺路（MVP 仍全局共享）。

### 5.2 ToolDispatcher 接线

`src/core/ToolDispatcher.ts:387-396` 现状（healthSample.after hook）：
```ts
after: async (ctx, result) => {
  const duration = Date.now() - ctx.startTime;
  const isError = result.isError === true || this.checkJsonSuccessFalse(result);
  if (isError) {
    this.healthMonitor.recordFailure('TOOL_ERROR', `Tool ${ctx.toolName} failed`);
  } else {
    this.healthMonitor.recordSuccess(duration);
  }
  return result;
}
```
旁加 callRecorder 记录（healthMonitor 记连接健康，callRecorder 记调用明细，职责分离）。**r2 修正 A-1**：现状 isError 分支无 errMsg 变量，需新增 helper 从 result.content 提取错误文本：
```ts
const recorder = getCallRecorder();
if (isError) {
  this.healthMonitor.recordFailure('TOOL_ERROR', `Tool ${ctx.toolName} failed`);
  const errMsg = extractErrorMessage(result);   // 新增 helper：从 result.content 首条 text 提取，截断 200 字符
  recorder.record(ctx.toolName, false, duration, 'TOOL_ERROR', errMsg);
} else {
  this.healthMonitor.recordSuccess(duration);
  recorder.record(ctx.toolName, true, duration);
}
```
`ctx.toolName` / `duration` / `isError` / `result` 在该作用域均已可用（已核实）。`extractErrorMessage` 为 call-recorder.ts 导出的小 helper。

### 5.3 get_context 数据流

handler 采集顺序（字段独立 try/catch，一处失败不阻塞其余，聚合到 status/failedFields）：
1. 同步字段：mode / project（基于 project_path）/ toolGroups / workflows / rules（读 project.godot + .claude/rules） / callStats
2. 连接探测：editor state + bridge probe（短超时）
3. 场景快照：按 mode 路由（§6），`include_scene=false` 跳过
4. CallRecorder：getRecent(50) + getStats()
5. performance：仅 bridge + `include_performance=true` 时探测

## 6. 场景快照模式适配

| 模式 | 采集方式 | 说明 |
|---|---|---|
| headless | `scene=null` | headless 无持久场景态（每次 `execute_gdscript` 是独立短进程，无"当前场景"）；避免无意义 spawn 开销，AI 需场景信息走 editor/bridge |
| editor | `editor_get_scene_tree`（已连接时取摘要） | 复用现成 editor 路径 |
| bridge | `game_query(method="get_tree")` 取 child_count + 递归统计 | bridge 在跑，渲染由 GPU |
| 无场景/未连 | `scene=null` | — |

typeTopN 统计：遍历场景树按 `node.get_class()` 计数，取 top-5，格式 `[{ type, n }]`。大场景（>2000 节点）只返回 nodeCount，跳过 typeTopN（省开销）。

## 7. 错误处理

- **元工具整体永不抛错**：最外层 try/catch，任何采集异常被捕获，对应字段降级（null / 空数组 / 默认值），返回 `{ status: "ok"|"partial", failedFields: [...] }`
- **字段级 try/catch**：每个字段独立包裹，互不影响；失败字段名记入 failedFields
- **超时**：bridge 探测 / 场景扫描各有短超时（2s），超时按失败降级
- **不污染调用统计**：get_context 自身的调用也会被 CallRecorder 记录（这是预期的——它确实是一次工具调用）

## 8. 测试策略

> **r2 修正 I-1**：`vitest.config.ts:8` `include: ['test/**/*.test.{js,ts}']`——测试只在 `test/` 下收集，`src/` 不跑。所有测试文件放 `test/` 子目录。

- **`test/core/ring-buffer.test.ts`**（新增，r2 修正 I-3）:
  - capacity 校验：`capacity<=0` / 非整数 → RangeError（**health-monitor 内联版无此校验，抽取后须保证不丢**——来自 dashboard 版 ADVISORY-2）
  - push / toArray / sliceLast / Symbol.iterator / length / clear 全 API
  - 边界：空、满、溢出滚动
  - 三方 import 回归（dashboard recentLogs/timeSeries + health-monitor 仍正常）
- **`test/core/call-recorder.test.ts`**（新增）:
  - record → getStats 聚合正确（total/success/fail、topTools 排序、recentErrors）
  - getRecent(n) sliceLast 边界
  - 单例（getCallRecorder 多次取同实例）
  - reset 清空
  - extractErrorMessage helper（result.content 提取 + 截断）
- **`test/tools/get-context.test.ts`**（新增）:
  - 字段组装（mock headless / editor / bridge 三模式连接态）
  - 场景快照三模式适配（mock 各采集函数）
  - 降级：场景扫描抛错 → scene=null + failedFields 含 scene，其余字段正常
  - include_scene=false → 跳过场景扫描
  - 非 bridge → performance=null
  - project_path 缺省 → project/rules=null|[]，会话级字段正常
- **回归**: 现有 `test/core/ToolDispatcher.test.ts` 不受 callRecorder 接线影响（callRecorder.record 不抛错、不影响返回值）；dashboard / health-monitor 改 import 后现有测试全绿
- **门禁**: `npm run lint` clean + `tsc` exit 0 + vitest 全绿（含新增测试）+ coverage 不退步（ring-buffer 三方共用提升覆盖率）

## 9. 风险与开放问题

1. **多实例（instance-tools）下的 CallRecorder 归属**：MVP 全局单例共享调用统计（§5.1 已预留 instanceId 参数）。per-instance 是后续优化。
2. **大场景 typeTopN 遍历开销**：1000+ 节点场景递归统计可能耗时。**缓解**：`include_scene` 开关 + GDScript 内节点数硬上限（>2000 只返回 nodeCount，跳过 typeTopN）。
3. **performance 非 bridge 返回 null 是否误导 AI**：**缓解**：字段内 `"note": "only available in bridge mode"` + hint 说明。
4. **RingBuffer 提升改动面**：dashboard + health-monitor 改 import（属"在做的工作中顺带改善"，skill 许可）；health-monitor 现有测试覆盖回归，dashboard 测试覆盖回归。
5. **core 归组（r3 修正 r2-N2）**：`extract.ts:32` 兜底硬编码 `name === 'manage_tools' ? 'core' : 'unknown'`——ALWAYS_ALLOWED 只保调用权限不保分组。get_context **进 `core.tools` 列表**（用 def.name 全名 `'godot_get_context'`，toolToGroup 按 def.name 匹配，见 `tool-registry.ts:235-240`；core.tools 本就混用短名/全名，全名安全）。

## 10. 参考文件清单

**调研与候选**:
- `D:\workspace\Obsidian\GodotMCP\系统文档\资料-sparda与skil-lock范式借鉴.md`（候选出处 + sparda 范式）
- `D:\workspace\Obsidian\GodotMCP\项目待办.md` §调研驱动改进候选 P0
- `D:\GitHub\_research\sparda\src\server\stdio.js:403-475`（sparda_get_context 参考实现）

**接线点（审查核实 6/6 零误差）**:
- `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts:387-396`（healthSample.after hook，CallRecorder 记录插入点）
- `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts:167`（core 组定义）/ `:243`（ALWAYS_ALLOWED）/ `:303`（NO_PROJECT_PATH_TOOLS，get_context **进**，r3 修正 r2-N1）
- `D:\GitHub\godot-mcp-enhanced\src\core\module-loader.ts:104-149`（annotations 自动派生）
- `D:\GitHub\godot-mcp-enhanced\src\dashboard\ring-buffer.ts:5-44`（RingBuffer 提升源，含 `:13-15` capacity 校验）
- `D:\GitHub\godot-mcp-enhanced\src\core\health-monitor.ts:58-88`（RingBuffer 内联版，贡献 sliceLast + iterator）
- `D:\GitHub\godot-mcp-enhanced\vitest.config.ts:8`（include 仅 test/**）

**新增 / 改动文件**:
- `D:\GitHub\godot-mcp-enhanced\src\core\ring-buffer.ts`（**提升自 src/dashboard/ring-buffer.ts，非新建**；dashboard 原文件删除或改 re-export）
- `D:\GitHub\godot-mcp-enhanced\src\dashboard\ring-buffer.ts` → 改 import `../core/ring-buffer.js`（或删除由 core 提供）
- `D:\GitHub\godot-mcp-enhanced\src\core\health-monitor.ts` → 内联 RingBuffer 删除，改 import `./ring-buffer.js`
- `D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts` → `core.tools` 列表 + `ALWAYS_ALLOWED` + `NO_PROJECT_PATH_TOOLS` 各加 `'godot_get_context'`（r3 修正 r2-N2 + r2-N1）
- `D:\GitHub\godot-mcp-enhanced\src\core\call-recorder.ts`（调用记录器 + extractErrorMessage helper）
- `D:\GitHub\godot-mcp-enhanced\src\tools\get-context.ts`（工具实现）
- `test/core/ring-buffer.test.ts` / `test/core/call-recorder.test.ts` / `test/tools/get-context.test.ts`（三个测试文件）
