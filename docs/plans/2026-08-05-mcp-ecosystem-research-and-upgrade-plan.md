# MCP 生态调研与 enhanced 升级方案

> **调研日期**：2026-08-05
> **调研方法**：5 个研究代理并行调研（breakpoint-mcp / better-godot-mcp+heren-mcp / 其他 4 竞品 / MCP 2026-07-28 规范 / enhanced 自身现状）
> **项目现状基线**：v0.25.3 · 36 merged 工具 · 306 测试文件 · SDK 1.29.0 · 纯 stdio · TypeScript ESM
> **Obsidian 镜像**：`D:\workspace\Obsidian\godot-mcp-enhanced\开发日志\2026-08-05 MCP生态调研与升级方案.md`

---

## 第一部分：现状基线（诚实盘点）

### 1.1 enhanced 的优势项（应保留，不推倒重来）

| 维度 | enhanced 现状 | 竞品对比 |
|------|--------------|---------|
| **tscn 解析** | `src/tscn/` 5 文件 72KB，支持 detach 等高级操作 | better-godot-mcp 仅 17KB，功能较少 |
| **三层架构** | headless + editor + bridge 完整三态 | 多数竞品只有 1-2 层 |
| **客户端适配** | 14 个客户端 + CLI 一键 setup/doctor | 竞品最多支持 4-5 个 |
| **动态执行器** | `gdscript-executor.ts` 1422 行 + 输出标记防伪造 | 唯一的动态执行+反伪造 |
| **路径白名单** | deny-by-default + junction 防御 + MCP Roots 动态注入 | 多数竞品无路径白名单 |
| **危险操作门控** | `confirm_and_execute` + elicit + TTL 令牌 + 速率限制 | 多数竞品无门控 |
| **MCP annotations** | `module-loader.ts:141-162` 已自动推断注入 | breakpoint 是手工白名单 |
| **prompts/resources** | 已实现 4 prompts + 9 静态 + 4 模板 resources | 多数竞品未实现 |
| **安全分级** | `SecurityLevel: 'danger-api'\|'guarded'\|'safe'` | bradypp 有 readOnly 标记 |
| **token 预算** | `check-token-budget.mjs` warn-only 门禁 | 唯一带预算门禁的 |

### 1.2 enhanced 的短板（12 项诚实清单）

| # | 短板 | 实测验证 |
|---|------|---------|
| 1 | 工具表 token 占用偏高（~17000 tokens） | matrix 总 68047B ÷ 4 ≈ 17012 tok |
| 2 | 能力组是运行时停用，非注册时丢弃 | `manage_tools` 是动态停用 |
| 3 | runtime_assert 嵌在 workflow 内部 | 非 first-class 工具 |
| 4 | 无 EditorUndoRedoManager 集成 | addon 无 undo_redo_wrapper |
| 5 | 无契约检查脚本 | 只有 tool-count + version-sync |
| 6 | idempotentHint 推断过简（等于 readOnly） | `module-loader.ts:153` |
| 7 | annotations 不进 capability-matrix | matrix 只存 readonly/guarded |
| 8 | 无 HTTP transport | 仅 stdio |
| 9 | prompts 仅 4 个，无验证闭环 | `src/prompts.ts` |
| 10 | SDK 1.x（v1 维护窗口仅到 2027-02） | package-lock 实锁 1.29.0 |
| 11 | 无视觉成本层级 | `src/screenshot.ts` 无预算 |
| 12 | elicit 在 2026-era 客户端会抛错 | `src/core/elicit.ts` |

---

## 第二部分：升级方案优先级总表

### P0（必须做，6 项）

| # | 任务 | 来源 | 工作量 | 依赖 | 收益 |
|---|------|------|--------|------|------|
| P0-1 | 升级 TS SDK v1 → v2（含 zod v4） | MCP 2026-07-28 | L（1-2 周） | 无 | 解锁所有 2026 特性；v1 维护仅到 2027-02 |
| P0-2 | MRTR 改造：elicit + confirm_and_execute | SEP-2260/2322 | M-L（3-5 天） | P0-1 | 2026 客户端 elicit 不改会抛错 |
| P0-3 | 注册时丢弃能力组（monkey-patch registerTool） | breakpoint `capabilities.ts` | M（~200 行） | 无 | 安全姿态质变：agent 看不到危险工具 |
| P0-4 | EditorUndoRedoManager 集成 | heren `undo_redo_wrapper.gd` | M | 无 | UX 质变：Ctrl+Z 撤销 AI 操作 |
| P0-5 | runtime_assert 提升为 first-class 工具 | breakpoint Plane C | M | 无 | agent 任意时刻验证，不依赖 workflow |
| P0-6 | 工具表分层压缩 + help 按需展开 | better-godot-mcp | M | 无 | 省 4000-8000 tokens |

### P1（强烈建议，7 项）

| # | 任务 | 来源 | 工作量 | 依赖 |
|---|------|------|--------|------|
| P1-1 | 改进 idempotentHint 推断规则 | breakpoint annotations | S（半天） | 无 |
| P1-2 | annotations 进 capability-matrix | 自身短板 #7 | S | 无 |
| P1-3 | SEP-2575：oninitialized → per-request 能力探测 | SEP-2575 | M（2-4 天） | P0-1 |
| P1-4 | SEP-2549：list handler 加 ttlMs + cacheScope | SEP-2549 | S（半天） | P0-1 |
| P1-5 | 视觉成本层级（coords/ascii/budget） | heren 视觉系统 | M | 无 |
| P1-6 | 契约检查独立 CI job | breakpoint contract_check | L（可增量） | 无 |
| P1-7 | Logging 改造（per-request logLevel） | SEP-2577 | M（2 天） | P0-1 |

### P2（建议，6 项）

| # | 任务 | 来源 | 工作量 | 依赖 |
|---|------|------|--------|------|
| P2-1 | `overrides` 参数（启动时注入 autoload） | peek | S | 无 |
| P2-2 | ~~`validate_gdd` 改用 SceneTree `_initialize()`~~（2026-08-06 核查纠偏：功能已在 `validate_scripts` 落地，见下） | tugcantopaloglu v3.1 | XS | 无 |
| P2-3 | nodeType 参数 RCE 审计 | Coding-Solo #95 | S | 无 |
| P2-4 | 确定性 playtest 四原语 | breakpoint Plane C | M | 无 |
| P2-5 | SEP-2133：capabilities 加 extensions 字段 | SEP-2133 | S | P0-1 |
| P2-6 | recipe 加入验证闭环 + SAFETY 收尾 | breakpoint recipes | S | 无 |

> [!warning] P2 核查纠偏（2026-08-06，3 路并行 Explore 只读核查）
>
> P2 表格写于调研期（基于竞品文档推断），核查后发现与代码现状有偏差：
>
> - **P2-2 已实质落地**：原写"validate_gdd 改用 SceneTree `_initialize()`"。核查发现 `validate_gdd`（`src/tools/game-design.ts:106-199`）是纯 markdown 文档校验器，不碰 Godot；真正要的 autoload 感知 **已在 `validate_scripts` → `src/tools/validation.ts:200-202`**（`extends SceneTree` + `func _initialize():` + `load()` + `--path projectPath`）落地。处置：关闭代码任务，补回归测试 `test/regression/validate-scripts-autoload.test.ts`，纠正本表措辞。
> - **P2-3 双层防御已做**：nodeType 类参数的 TS 字符白名单 + GD 类白名单 + 契约测试（`test/regression/headless-whitelist.test.ts`）均已就位（commit `2a6ebcd` 堵 extends Node RCE）。**唯一 gap**：`src/tools/scene/scene-commit.ts:91-96` 的 node_add 用黑名单（9 项敏感类）而非白名单，第三方 addon 注册的恶意 class_name 不在列。处置：收尾黑名单→白名单。
> - **P2-5 SDK 已支持**：`@modelcontextprotocol/server` v2 的 `ServerCapabilitiesSchema` 已有 `extensions` 可选字段，声明是 trivial。但 enhanced 无消费方，纯声明零价值。处置：声明 `io.godot-mcp/runtime-bridge` 发现性 extension（暴露 bridge 端口/认证/确定性能力），让 modern 客户端可发现。
> - **P2-6 SAFETY 已天然达成**：`ui_draw_recipe` 的 7 种 op（rect/circle/line/arc/polygon/polyline/string）全是 `draw_*` immediate-mode 原语，无清屏/资源加载/代码执行；`action-gate.ts:16-22` 正确地不 gate 它；`actionRisks: 'write'` 已标。处置：仅加验证闭环（draw_result 读回），SAFETY 仅文档说明。
>
> 完整核查证据与处置方案见 `docs/plans/` 下 P2 实施 plan（2026-08-06）。

### P3（长期/可选，7 项）

| # | 任务 | 来源 | 工作量 |
|---|------|------|--------|
| P3-1 | Smithery yaml + server.json 新格式 | better-godot-mcp | XS |
| P3-2 | 多阶段 Dockerfile + killProcessTree | better-godot-mcp | S |
| P3-3 | HTTP transport（--http 模式） | better-godot-mcp | M |
| P3-4 | SEP-414 Trace Context (OTel) | SEP-414 | S |
| P3-5 | Tasks 扩展（长任务异步） | SEP Tasks | L |
| P3-6 | Triggers 用 subscriptions/listen 过渡 | MCP Triggers WG | M |
| P3-7 | C# / .NET 支持 | tugcantopaloglu | L |

### 明确不做（3 项）

| # | 拒绝项 | 理由 |
|---|--------|------|
| ❌ | Rust 重写 / FlojoMCP | heren-mcp 的 Rust 宣传**是虚假的**（实际 Python+FastMCP，FlojoMCP 仓库 404），IO-bound 场景无收益，重写成本极高 |
| ❌ | C++ GDExtension（peek 路线） | 跨平台编译矩阵维护成本远超收益，不支持 Windows 是硬伤 |
| ❌ | 297KB 单文件架构（tugcantopaloglu 路线） | 反面教材，enhanced 已有更优的工具组拆分 |

---

## 第三部分：依赖关系与时序

### 3.1 依赖关系图

```
P0-1(SDK v2)─┬─→ P0-2(MRTR)
              ├─→ P1-3(oninitialized)
              ├─→ P1-4(ttlMs)
              ├─→ P1-7(Logging)
              ├─→ P2-5(extensions)
              └─→ P3-5(Tasks)

P0-3(能力组)─→ P1-2(annotations 进 matrix)
P0-4(undo)   ─→ (无下游，独立)
P0-5(assert) ─→ (无下游，独立)
P0-6(压缩)   ─→ (无下游，独立)
```

**可并行启动**（无依赖）：P0-3、P0-4、P0-5、P0-6 四项可同时开工。
**串行关键路径**：P0-1 → P0-2 →（其余 P1 协议改造）。

### 3.2 6 个月路线图

| 月份 | 任务 | 备注 |
|------|------|------|
| **月份 1-2** | P0-1 SDK v2 升级 + P0-2 MRTR 改造 | 协议层关键路径 |
| **月份 2-3** | P0-3 能力组 + P0-4 UndoRedoManager + P0-5 runtime_assert + P0-6 工具压缩 | 4 项可并行 |
| **月份 3-4** | P1 协议适配（oninitialized / ttlMs / Logging / idempotentHint / annotations 进 matrix） | 依赖 P0-1 |
| **月份 4-5** | P1 产品化（视觉成本层级 / 契约检查 CI） | |
| **月份 5-6** | P2/P3 选做（overrides / validate_gdd / 确定性 playtest / Smithery） | |

---

## 第四部分：竞品全景（7 家）

| 竞品 | Star | 语言 | 核心差异化 | 可借鉴 |
|------|------|------|-----------|--------|
| `n24q02m/better-godot-mcp` | 32 | TS | 17 复合大工具 + help 按需展开 + stdio+HTTP + Docker + Smithery | 工具压缩 / Docker 多阶段 / killProcessTree |
| `jlivingston-Cipher/godot-breakpoint-mcp` | 4 | TS | 真 DAP/LSP 客户端 + 291 工具默认关 13 个 + contract_check + recipes + W/R/E | 能力组 / 契约检查 / recipes / runtime_assert |
| `CerebroCanibalus/heren-mcp` | 7 | **Python**（非 Rust！） | undo/redo wrapper + 视觉成本层级 + orchestrate（宣传虚假） | undo_redo_wrapper / 视觉层级 / orchestrate |
| `PrajnaAvidya/Godot-Peek-MCP` | 10 | C++ + Go | 运行时可见性 + Unix socket 多 session + overrides | overrides 参数 |
| `Coding-Solo/godot-mcp` | - | TS | 老牌 + RCE 修复教训（class_name 白名单） | RCE 防御审计 |
| `tugcantopaloglu/godot-mcp` | - | TS | 157 工具 + autoload 感知 validate + C# 支持 | autoload 感知 validate（enhanced 借鉴到 `validate_scripts`，非 `validate_gdd`；2026-08-06 核查见 P2 纠偏块） |
| `bradypp/godot-mcp` | - | TS | ToolRegistry readOnly 标记（已停滞 14 月） | readOnly 元数据 |

### 关键竞品发现

1. **heren-mcp 的 Rust 宣传是虚假的**：实际是 Python + FastMCP，FlojoMCP 仓库 404，全 GitHub 搜索 0 结果。借鉴其设计思路（undo/redo、视觉层级、orchestrate），但不要相信性能宣传
2. **better-godot-mcp 是真实工程标杆**：registry.ts 分层、scene-parser 性能优化、Dockerfile 多 target 都可信
3. **breakpoint-mcp 的能力组+契约检查是安全工程范本**：注册时丢弃（monkey-patch registerTool）+ contract_check.py 22 项校验

---

## 第五部分：MCP 2026-07-28 规范关键变化

### 5 大支柱性变化

| 变化 | 对 enhanced 的影响 |
|------|------------------|
| **无状态协议**（SEP-2575/2567） | oninitialized 失效 → per-request 能力探测（P1-3）；纯 stdio 无 Mcp-Session-Id 影响 |
| **MRTR**（SEP-2260/2322） | **elicitInput 在 2026-era 抛错** → 必须改造（P0-2） |
| **Extensions 框架**（SEP-2133） | capabilities 加 extensions 字段（P2-5）；Tasks 扩展（P3-5） |
| **Roots/Sampling/Logging deprecate** | Logging 改造（P1-7）；Roots 迁移可延后到 2027 |
| **ttlMs + cacheScope**（SEP-2549） | list handler 加字段（P1-4） |

### TS SDK v1 → v2 关键变化

- 包名拆分：`@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` + `/core`
- `setRequestHandler(Schema, fn)` → `setRequestHandler('method', fn)`（8 处）
- handler 第二参数：`extra` → `ctx: ServerContext`
- 强制 Node 20+（当前 engines 写 18，CI 实跑 24）
- zod v4.2.0+（Standard Schema）
- **双时代策略**：`serveStdio` 默认同时服务 2025 + 2026 客户端，零破坏

---

## 第六部分：风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| SDK v2 codemod 不完整，手动修整量大 | 中 | 升级延期 | 先在分支跑 codemod，评估残留 |
| MRTR 改造后 confirm_and_execute 回归测试 | 中 | 安全门控失效 | 保留 2025-era 路径，渐进迁移 |
| EditorUndoRedoManager 改 addon 后向后兼容 | 低 | 老项目升级断裂 | 版本化 addon，双轨期 |
| 工具压缩导致 LLM 找不到工具 | 中 | 用户体验回退 | help 工具 + findClosestMatch 拼写纠错 |
| heren-mcp 的 undo_redo_wrapper 在 Godot 4.7 行为变化 | 低 | undo 失效 | 实测多版本（4.5/4.6/4.7） |

---

## 第七部分：P0 任务详细方案

### P0-1：升级 TS SDK v1 → v2

**关键变化（enhanced 受影响部分）**：
1. 包名拆分：`@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` + `/core`
2. `setRequestHandler(ListToolsRequestSchema, fn)` → `setRequestHandler('tools/list', fn)`（8 处）
3. handler 第二参数：`extra: RequestHandlerExtra` → `ctx: ServerContext`
4. 强制 Node 20+
5. zod v4.2.0+

**升级路径**（渐进式）：
1. 先升级 zod 到 v4.2.0+（独立 PR，验证 schema 行为）
2. 跑 codemod：`npx @modelcontextprotocol/codemod@latest v1-to-v2 .`
3. 手动改 `package.json` + import 路径
4. 改 `setRequestHandler` 调用（8 处）
5. 跑测试 + MCP Inspector 验证

**关键策略**：用 `serveStdio` 默认双时代行为，2025-era 客户端零破坏。

### P0-2：MRTR 改造（elicit + confirm_and_execute）

**双时代策略**（必做）：
```typescript
// src/core/elicit.ts
function createElicitFn() {
  return async (request, ctx) => {
    const era = ctx?.mcpReq?.envelope?.protocolVersion?.startsWith('2026') ? '2026' : '2025';
    if (era === '2026') {
      return { resultType: 'input_required', inputRequests: {...}, requestState: ... };
    } else {
      return request.server.elicitInput({...});
    }
  };
}
```

### P0-3：注册时丢弃能力组

**实现 trick**（<200 行）：
```typescript
// 新建 src/core/capability-gate.ts
const DROPPED_BY_DEFAULT = {
  'code-execution': ['execute_gdscript', 'execute_bpy', 'blender'],
};

export function applyCapabilityGate(server: McpServer, enabled: string[]) {
  const original = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    const group = toolToGroup(name);
    if (group && !enabled.includes(group) && !enabled.includes('all')) {
      return { name };  // stub，不真正注册 → 从 tools/list 消失
    }
    return original(name, config, handler);
  };
}
```

### P0-4：EditorUndoRedoManager 集成

**实现**（直接移植 heren `undo_redo_wrapper.gd`，<100 行）：
```gdscript
# addons/godot_mcp_bridge/undo_redo_wrapper.gd
@tool
class_name McpUndoRedoWrapper extends Node

var _editor_plugin: EditorPlugin

func begin_action(name: String) -> void:
    _editor_plugin.get_undo_redo().create_action(name)

func add_do_method(obj: Object, method: String, args: Array) -> void:
    _editor_plugin.get_undo_redo().callv("add_do_method", [obj, method] + args)

func add_undo_method(obj: Object, method: String, args: Array) -> void:
    _editor_plugin.get_undo_redo().callv("add_undo_method", [obj, method] + args)

func commit_action() -> void:
    _editor_plugin.get_undo_redo().commit_action()
```

### P0-5：runtime_assert 提升为 first-class 工具

**5 个断言工具**（从现有代码提取）：

| 新工具 | 来源 |
|--------|------|
| `runtime_assert_node_state` | 现有 `assert-protocol.ts` 提取 |
| `runtime_assert_scene_structure` | 现有 `assert-protocol.ts` 提取 |
| `runtime_assert_screen_text` | 新增 |
| `runtime_assert_perf` | 现有 `degradation.ts` 提取 |
| `runtime_screenshot_diff` | 现有 `proof-bundle.ts` 提取 |

### P0-6：工具表分层压缩 + help 按需展开

**三层压缩策略**（参考 better-godot-mcp）：
- **P0 核心工具（~10 个）**：description 含完整 action 清单
- **P1/P2 领域工具（~20 个）**：description 单行 + `Use help tool for full docs` 重定向
- **help 工具**：传 `tool_name`（enum 限定），返回 `docs/tools/{name}.md`

**预期收益**：从 ~17000 tokens → ~8000-10000 tokens（省 40-50%）。

---

## 参考

- MCP 2026-07-28 官方博客：https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- InfoQ 峰会报道：https://www.infoq.cn/article/f4df9bE6zm1wy9pI1xKA
- learnagent 生态报告：https://learnagent.org/library/compare/mcp-server-ecosystem-2026/
- breakpoint-mcp：https://github.com/jlivingston-Cipher/godot-breakpoint-mcp
- better-godot-mcp：https://github.com/n24q02m/better-godot-mcp
- heren-mcp（注意虚假宣传）：https://github.com/CerebroCanibalus/heren-mcp
- Godot-Peek-MCP：https://github.com/PrajnaAvidya/Godot-Peek-MCP

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-05 | 初版，基于 5 路并行调研整合 |
