# P0-3 注册时丢弃能力组（Capability Gate）

> **状态**：spec（待实施，2026-08-05 修订版）
> **优先级**：P0
> **来源**：breakpoint-mcp 的 `host/src/capabilities.ts`（移植后大改：从工具级改为 action 级）
> **基线**：enhanced v0.25.3

> [!warning] 修订（2026-08-05，依据审查 B-1/B-2）
> 原方案直接照搬 breakpoint 的工具级 `applyCapabilities(server.registerTool)`。但 enhanced 既没有 `server.registerTool` 入口（B-2，实际走 `module-loader.ts` → `tool-registry.ts`），且工具级 gate 会 over-block：MCP `tools/list` 暴露工具名而非 action，干掉 `runtime` 工具会连带干掉 `record_*` 等同工具的非高危 action（B-1）。**核心机制已重新设计为 action 级 gate**，详见 §3.1。

---

## 2. 现状基线（调研实测）

| 机制 | 位置 | 作用域 | 局限 |
|------|------|--------|------|
| `SecurityLevel` | `src/capability/schema.ts` | 静态分类（`danger-api`/`guarded`/`safe`） | 仅用于 capability-matrix 报告，不参与运行时门控 |
| `manage_tools` | `src/tools/manage-tools.ts` + `tool-registry.ts:249-254` | **工具级**运行时停用（activeGroups copy-on-write） | 工具仍进 `tools/list`，agent 可见；干掉 `runtime` 组会连带干掉所有非 execute_gdscript action（over-blocking） |
| `profile`（编译时） | `ToolDispatcher.ts:145-185` + `tool-registry.ts:198` `PROFILES` | **工具级**编译时控制（`READ_ONLY_MODE`/`LITE`/`MINIMAL`/`slim`/`full`） | 同样是工具粒度，fail-closed 回退 minimal |
| `ToolDispatcher:226` `executeToolCall` | `src/core/ToolDispatcher.ts` | call-time 校验 `isToolAllowed`（按工具名+组） | **只到工具粒度**，无 action 级拦截能力 |
| `feature-flags.ts` | `src/core/feature-flags.ts` | 启动时一次性读 env | 不支持组级 opt-in |

> [!warning] 修订（2026-08-05，依据 N-3）
> §2 表中 `manage_tools` 的行号原为 `tool-registry.ts:233`，实测修正为 `tool-registry.ts:249-254`（`setActiveGroups` 函数）。

**关键事实**：
- `GodotServer.ts:148-150` 由 `dispatcher.getFilteredTools()` 决定 `tools/list` 内容——决定工具可见性
- `ToolDispatcher.ts:226 executeToolCall` 是所有工具调用的统一入口——决定工具可执行性
- 两者都按工具名操作，**都不感知 action**——这是为何需新建 action-gate 模块

---

## 3. 设计

### 3.1 核心思路：action 级 gate（替代工具级 gate）

> [!warning] 修订（2026-08-05，依据 B-1/B-2）
> 原方案是工具级 gate，包装 `server.registerTool`。enhanced 既无此入口（B-2，实际注册走 `module-loader.ts:231 registerAllModules` → `tool-registry.ts:39 registerModule`），且工具级 gate 无法实现"只挡 `execute_gdscript` 不挡 `record_*`"的精准目标（B-1）。**改为 action 级 gate**，在 `executeToolCall` 入口拦截 `args.action`。

**新方案**：新建 `src/core/action-gate.ts`（替代原方案的 `capability-gate.ts`），在 `executeToolCall` 入口拦截 action 级权限。`tools/list` 仍暴露工具名（`runtime`/`blender`），agent 能看到工具但调用 gated action 时返回 -32601。

伪代码：

```typescript
// 新建 src/core/action-gate.ts（替代原方案的 capability-gate.ts）
const GATED_ACTIONS: Record<string, string[]> = {
  'code-execution': [
    'runtime.execute_gdscript',     // 工具名.action 名
    'blender.execute_bpy',
  ],
  // 未来可扩展（如 'network', 'asset-export'）
};

const ALL_GATED = new Set(Object.values(GATED_ACTIONS).flat());

/** 反查：action key → group name */
function findGroupForAction(actionKey: string): string | undefined {
  for (const [group, actions] of Object.entries(GATED_ACTIONS)) {
    if (actions.includes(actionKey)) return group;
  }
  return undefined;
}

export function isActionGated(toolName: string, action: string): boolean {
  return ALL_GATED.has(`${toolName}.${action}`);
}

export function isActionAllowed(
  toolName: string,
  action: string,
  enabledGroups: string[],
): boolean {
  const key = `${toolName}.${action}`;
  if (!ALL_GATED.has(key)) return true;  // 未登记 = 放行
  const group = findGroupForAction(key)!;
  return enabledGroups.includes(group) || enabledGroups.includes('all');
}
```

**接入点**（在 `src/core/ToolDispatcher.ts:226 executeToolCall` 入口，**不是** `server.registerTool`，也**不是** `getFilteredTools`）：

```typescript
// ToolDispatcher.ts executeToolCall 入口
private async executeToolCall(name, args, startTime, progressEmitter) {
  // ... 现有 isToolAllowed 检查 ...

  // 新增 action-gate 检查（在 isToolAllowed 之后、handler 调度之前）
  const action = typeof args.action === 'string' ? args.action : '';
  if (isActionGated(name, action) && !isActionAllowed(name, action, resolveEnabledGroups())) {
    return opsErrorResult(-32601, `action '${action}' is gated. Set GODOT_MCP_PRIVILEGED_GROUPS=code-execution to enable.`);
  }

  // ... 原有 handler 调度 ...
}
```

**为什么不在 `getFilteredTools` 层做**：
- `getFilteredTools` 控制的是 `tools/list` 内容（工具可见性）
- 在那里过滤会导致整个 `runtime` / `blender` 工具消失——回到 over-blocking 问题
- action-gate 必须在 call-time（`executeToolCall`）做，因为只有 args 传进来才知道是哪个 action

### 3.2 GATED_ACTIONS 分组（重新审视所有高风险 action）

> [!warning] 修订（2026-08-05，依据 B-1 + N-8）
> 原方案只列 `code-execution` 一个组，未审视 android/selfupdate/cpp。新方案补"为何不 gate"的说明，避免审查者再次质问。

| 组名 | gated action | 理由 |
|------|-------------|------|
| `code-execution` | `runtime.execute_gdscript`、`blender.execute_bpy` | 任意代码执行（GDScript 沙箱 + bpy 全功能 Python RCE），无独立确认门控 |

**以下高风险面不 gate 的理由**（防 over-blocking / 防与 enhanced 核心定位冲突）：

| 工具/action | 为何不 gate |
|------------|------------|
| `android.deploy` | 已有 `mcp__godot__confirm_and_execute` 二次确认门控可介入；blast radius 限于目标 Android 设备，不影响宿主 |
| `self_update.update` | 已是 enhanced 自身的核心维护机制；gate 它会让用户无法拉安全补丁；且需用户主动触发 |
| `cpp.scaffold_gdextension` | 只生成工程骨架文件（不联网、不编译），blast radius 限于工程目录；与 enhanced "可扩展性"核心定位冲突 |
| `runtime.record_*` | 属 `runtime` 工具但非 RCE 面——这是为何不能工具级 gate `runtime` 的关键证据 |

**breakpoint 教训**：breakpoint 1.28.0 主动删除了 `network` 组——其 gate 的两个工具实际都是 loopback，名为 `network` 双向误导。enhanced 审视原则：**组名必须准确描述威胁面**。当前只定义 1 个组（`code-execution`），不强行凑数。未来如新增（如 `asset-export`、`process-spawn`），需逐个核对实际 action 能力。

### 3.3 与现有机制的关系（避免用户混淆，三层互补）

> [!warning] 修订（2026-08-05，依据审查"漏看现有 profile 硬隔离"+ N-2）
> 原方案完全无视 enhanced 已有的 profile 硬隔离机制（`ToolDispatcher.ts:145-185`），且 §3.3 表中 `manage_tools` 粒度写"22 组"，实测应为"20 组"。重新梳理为三层互补模型。

| 维度 | `profile`（已有） | `manage_tools`（已有） | `action-gate`（本 spec 新增） |
|------|------------------|----------------------|------------------------------|
| 时机 | 编译时（启动一次性） | 运行时（连接后动态） | 注册时（启动时读 env） |
| 粒度 | 工具级（profile → 工具集） | **工具级**（TOOL_GROUPS，**实测 20 组**） | **action 级**（最细粒度） |
| 可逆性 | 不可逆（启动固定） | 可逆（activate/deactivate） | 不可逆（启动固定） |
| agent 可见 | 工具从 list 消失 | 工具仍在 list，调用被拒 | 工具仍在 list，**仅特定 action 调用被拒** |
| 典型场景 | slim/minimal 部署 | 调试时临时收窄 | 生产环境精准拦截高危 action |

**三层互补链**：
1. `profile` 决定哪些工具注册（编译时白名单）
2. `manage_tools` 决定哪些工具可调（运行时组级开关）
3. `action-gate` 决定哪些 action 可执行（注册时 action 黑名单）

生产环境建议：profile 用 `full`（保留所有工具） + action-gate 默认开（`code-execution` 拦截） + `manage_tools` 按需临时收窄。开发环境用 env 显式 opt-in action-gate。

---

## 4. opt-in 路径（3 条，对齐 breakpoint）

1. **环境变量**：`GODOT_MCP_PRIVILEGED_GROUPS=code-execution`（逗号分隔多组，或 `all` 全开）
2. **CLI 参数**：`godot-mcp-enhanced init --trust full`（写入 `~/.godot-mcp/config.json`，跨会话生效）

   > [!warning] 修订（2026-08-05，依据 N-7）
   > `--trust` 是**新建 CLI 功能**，enhanced 当前 `src/cli/` 下没有 `--trust` 参数解析。实施时需新增此 CLI 子命令或参数，不要假设已存在。

3. **资源可见性**：注册 `godot://capabilities` 资源（agent 可读，了解当前可用组+状态，但不影响 gate 决策）

伪代码（解析优先级）：

```typescript
function resolveEnabledGroups(): string[] {
  const env = process.env.GODOT_MCP_PRIVILEGED_GROUPS;
  if (env === 'all') return Object.keys(GATED_ACTIONS);
  if (env) return env.split(',').map(s => s.trim());
  // CLI 写入的 config.json 兜底
  return readConfigFile()?.privilegedGroups ?? [];
}
```

---

## 5. 改动清单

> [!warning] 修订（2026-08-05，依据 B-3 + 共性 1）
> 原清单遗漏 `npm run build-matrix`（capability-matrix 重建）和 `rule-templates.ts`（仓库级约束），且测试文件名引用错误。新增仓库级约束同步项。

| 文件 | 类型 | 改动 |
|------|------|------|
| `src/core/action-gate.ts` | **新建**（替代原 `capability-gate.ts`） | gate 核心 + `GATED_ACTIONS` + `resolveEnabledGroups` + `isActionGated`/`isActionAllowed` |
| `src/core/ToolDispatcher.ts` | 改 | `executeToolCall`（`:226`）入口新增 action-gate 检查（在 `isToolAllowed` 之后） |
| `src/resources.ts` | 改 | 新增 `godot://capabilities` 资源（列出组+状态+opt-in 来源） |
| `src/cli/setup.ts` 或 `src/cli/init.ts` | 改 | **新建** `--trust` 参数解析（`full`/`none`/组名列表），见 §4 注 |
| `src/core/feature-flags.ts` | 改（可选） | 新增 `ACTION_GATE` flag 控制总开关 |
| **`docs/capability-matrix.{json,md}`** | 改 | **`npm run build-matrix` 重建**（action-gate 状态需在 matrix 中反映；AGENTS.md §5 强制项） |
| **`src/tools/rule-templates.ts`** | **待评估** | 评估是否需在 rule-templates 中说明 action-gate 行为（agent 需知道某些 action 会被 gate）。实施前 grep `rule-templates.ts` 现有内容再决定改动幅度 |
| **`.claude/rules/godot-mcp-core.md`** | 改（如 rule-templates 改） | 独立副本同步（AGENTS.md 独立副本同步约束） |
| 测试 | 新增 | `test/core/action-gate.test.ts`（默认/opt-in/混合/over-blocking 验证四场景） |

> [!warning] 修订（2026-08-05，依据 N-1）
> 原验收标准引用的 `test/capability-matrix.test.js` **不存在**。实际文件是 `test/capability/matrix-integrity.test.ts`（实测 `find test -name "*matrix*"` 命中）。本 spec 不直接改 matrix 测试，但 `npm run build-matrix` 重建后 `matrix-integrity.test.ts` 必须仍全绿。

---

## 6. 验收标准

> [!warning] 修订（2026-08-05，依据 B-1 over-blocking 验证 + B-3 build-matrix）
> 新增"over-blocking 验证"（确保非 gated action 不受影响）和"`build-matrix` 无 diff"两条硬验收。删除原"工具从 tools/list 消失"的验收（action 级 gate 不改 tools/list）。

1. **默认启动 over-blocking 验证（关键）**：
   - `runtime.execute_gdscript` 调用返回 `-32601 Method not found`，错误信息含 `"action 'execute_gdscript' is gated. Set GODOT_MCP_PRIVILEGED_GROUPS=code-execution to enable."`
   - **`runtime.record_start` 仍可正常调用**（验证非 gated action 不被 over-block，这是新方案相对原方案的核心优势）
   - `blender.execute_bpy` 同样返回 -32601 + gate 提示
2. **`tools/list` 不变**：`runtime`、`blender` 工具仍出现在 `tools/list`（action 级 gate 不影响工具可见性）
3. **`GODOT_MCP_PRIVILEGED_GROUPS=code-execution` 启动**：上述 action 调用走正常路径，返回非 -32601
4. **`GODOT_MCP_PRIVILEGED_GROUPS=all`**：所有 gated action 走正常路径
5. **`godot://capabilities` 资源**：返回 JSON，列出 `code-execution` 组及其状态（`gated`/`enabled`）+ 当前 opt-in 来源（env/cli/default）
6. **`manage_tools` 兼容**：action-gate 启用时 `manage_tools` 仍能进一步停用整组（如 deactivate `runtime` 组后 `record_*` 也被挡；二者互不干扰——action-gate 是更细粒度的下一层）
7. **`npm run build-matrix` 无 diff**：或 diff 反映 action-gate 状态（如 matrix 中标注哪些 action 是 gated）
8. **回归**：`test/capability/matrix-integrity.test.ts` 全绿；新增 `test/core/action-gate.test.ts` 全绿

---

## 7. 风险评估

> [!warning] 修订（2026-08-05，依据 B-2）
> 删除原"`module-loader.ts` 注册路径与 gate 拦截点不一致"风险（已确认接入点为 `executeToolCall`，不涉及注册路径）。新增"agent 误以为工具不可用"风险（action 级 gate 的副作用：工具可见但 action 报错，agent 可能困惑）。

| 风险 | 等级 | 缓解 |
|------|------|------|
| Gate 误挡核心 action（如误把 `record_*` 加入 GATED_ACTIONS） | 高 | `GATED_ACTIONS` 白名单严格 review；`test/core/action-gate.test.ts` 必须含 over-blocking 验证（gated 挡、非 gated 放） |
| Agent 看到 `runtime` 工具但调用 `execute_gdscript` 报错，误判工具不可用 | 中 | 错误信息明确提示 opt-in 路径（`Set GODOT_MCP_PRIVILEGED_GROUPS=code-execution to enable`）；`godot://capabilities` 资源可查 gate 状态 |
| `ALWAYS_ALLOWED`（`tool-registry.ts:247`）工具的 action 被误加入 GATED_ACTIONS | 中 | `action-gate.ts` 的 `GATED_ACTIONS` 字典与 `ALWAYS_ALLOWED` 集合在 CI 中做交叉检查（不允许 `manage_tools`/`confirm_and_execute` 等的任何 action 进 GATED） |
| 用户从 breakpoint 迁移，期望工具级 `network` 组 | 低 | 文档明确 enhanced 用 action 级 gate，不复用 breakpoint 的工具级命名 |
| Client 缓存 tools/list（不响应 `list_changed`） | 低 | action-gate 不改 `tools/list`（工具仍可见），故无此风险。改 env 需重启文档说明 |

---

## 8. 后续演进（非本 spec 范围）

- 动态 gate（运行时通过 `godot://capabilities` 的资源订阅触发 list_changed）——复杂度高，留 P1
- gate 状态进 telemetry（与 `src/telemetry/` 集成）
- 与 P0-2（MRTR elicit）联动：gated action 可改用 elicit 二次确认而非完全拒绝

---

## 修订记录

| 日期 | 修订项 | 对应审查 Issue |
|------|--------|---------------|
| 2026-08-05 | 核心机制重新设计：工具级 gate → action 级 gate（新建 `action-gate.ts` 替代 `capability-gate.ts`，接入点从 `server.registerTool` 改为 `executeToolCall`） | **B-1**（gate 粒度错配）+ **B-2**（入口不存在） |
| 2026-08-05 | §3.2 重新审视 DROPPED 分组：补"为何不 gate android/selfupdate/cpp"说明 | **B-1**（DROPPED 分组补充）+ **N-8** |
| 2026-08-05 | §3.3 补全三层互补模型（profile / manage_tools / action-gate），修正组数为 20 组 | 审查"漏看现有 profile 硬隔离" + **N-2**（22 组→20 组） |
| 2026-08-05 | §2 修正 `manage_tools` 行号 `tool-registry.ts:233` → `:249-254` | **N-3** |
| 2026-08-05 | §4 标注 `--trust` 是新建 CLI 功能（enhanced 当前无此参数） | **N-7** |
| 2026-08-05 | §5 改动清单新增 `npm run build-matrix` 重建 + `rule-templates.ts` 评估 + `.claude/rules` 同步 | **B-3** + **共性 1** |
| 2026-08-05 | §5/§6 修正测试文件名 `test/capability-matrix.test.js` → `test/capability/matrix-integrity.test.ts` | **N-1** |
| 2026-08-05 | §6 新增 over-blocking 验证（`runtime.record_start` 仍可调用）+ `build-matrix` 无 diff 验收 | **B-1** + **B-3** |
| 2026-08-05 | §7 删除 monkey-patch 相关风险，新增"agent 误判工具不可用"风险 | **B-2** |
