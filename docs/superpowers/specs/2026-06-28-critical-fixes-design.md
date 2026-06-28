# R3 CRITICAL 修复设计（detach-instance + confirm-token）

**日期**：2026-06-28
**HEAD**：4fc3e39（v0.19.1+）
**来源**：R3 全面审查报告 `D:\workspace\review\.claude\reviews\2026-06-28-godot-mcp-enhanced-full-review-r3.md`
**spec 审查**：`D:\workspace\review\.claude\reviews\2026-06-28-critical-fixes-design-spec-eng-review.md`（5 项修正已纳入：migrate 归类错误 / detach 两条目命名 / :497 保留理由 / validation 边界理由改述 / analyze_error 补漏）
**范围**：2 个既有 CRITICAL（非本会话引入）

## 背景

R3 审查（4 并行子代理 + 主审交叉核实）发现 2 个 CRITICAL 既有缺陷待修：

- **CRITICAL-2** `detach-instance-drops-subresources` / `detach-instance-firstnode-subresource-loss`（同根因两条目）：detachInstance 首 `[node]` 是 instance 时 sub_resource 永不落盘，Godot 加载报 Invalid reference，**场景损坏**，触发条件常见（target 只实例化一个场景是最简用法）。
- **CRITICAL-3** `confirm-token-trust-broken`：确认令牌信任边界残留 4 子项。

本会话已先行修复 spawn 4 处 `buildSafeEnv` + android apkAbs 改 `resolveWithinRoot`（commit `4fc3e39`）。本 spec 处理剩余 2 个 CRITICAL。

## 范围决策

CRITICAL-3 含 4 子项，经澄清确认本次修**子项 1+4**：

| 子项 | 内容 | 本次 |
|------|------|------|
| 1 | TTL 180s→60s + 修 ToolDispatcher 硬编码漂移 | ✅ |
| 4 | GUARDED 扩 workflow/validation/manage_tools | ✅ |
| 2 | consumeToken 验 caller（架构级） | ⏸ 暂缓 |
| 3 | token 明文回传（协议级） | ⏸ 暂缓 |

**暂缓理由**：子项 2/3 属架构/协议级改动，`guard.ts:133-138` 注释明示"单客户端 MCP 架构下当前安全，多客户端才需加 clientId"。本地单用户模型下风险可控（R3 报告 CRITICAL-3 利用场景自承），遵循 YAGNI，留待真正多 agent/CI 部署前。CRITICAL-2 按已核实方案 A 修复。

---

## 改动 1：detach-instance 首 node 是 instance 时补插 sub_resources

**文件**：`src/tscn/tscn-editor-detach.ts:486-494`

### 根因（主审 Read 源码 + 报告 Agent3 核实，置信度 90%）

`detachInstance` 末段构建 `cleanResult` 的循环（`:484-513`）有两个分支：

```ts
for (let i = 0; i < targetLines.length; i++) {
  if (i >= info.lineIndex && i < instanceEndIdx) { ...continue; }   // :486 instance 跳过
  if (!insertedSubResources && i === firstNodeIdx && ...) { ... }    // :497 sub_resource 插入
  ...
}
```

当 target 首个 `[node]` 恰好是被 detach 的 instance（`firstNodeIdx === info.lineIndex`）时，`i === firstNodeIdx` 命中的是 `:486` instance 分支（抢先 `continue`），`:497` sub_resource 插入分支**永不触发**；循环后 `:515` fallback 只补 `expandedLines` 不补 `remappedSubResources` → 输出含 `SubResource("N")` 引用却无对应 `[sub_resource]` 段。

### 修复

在 `:487 if(!insertedExpanded)` 块内、push `expandedLines` 之前补插 sub_resources，靠 `!insertedSubResources` 守卫与 `:497` 分支互斥（常规 `firstNodeIdx < lineIndex` 情况仍由 `:497` 先触发插入，此处守卫跳过，不重复）：

```ts
if (!insertedExpanded) {
  // CRITICAL-2 fix: 首 node 是 instance 时 :497 分支被本 continue 抢先不可达，
  // 此处补插 sub_resources(若尚未插入)，避免输出含 SubResource 引用却无 [sub_resource] 段
  if (!insertedSubResources && remappedSubResources.length > 0) {
    cleanResult.push('');
    for (const subLine of remappedSubResources) {
      cleanResult.push(subLine);
    }
    insertedSubResources = true;
  }
  for (const expLine of expandedLines) {
    cleanResult.push(expLine);
  }
  insertedExpanded = true;
}
continue;
```

`:497-503` firstNodeIdx 分支**必须保留**：常规情况（`firstNodeIdx < lineIndex`，首个 [node] 不是 instance）下，sub_resource 仍需由 `:497` 在 `i === firstNodeIdx` 时插入到所有 `[node]` 之前（.tscn 前向声明要求）；若按 defects.md 旧 fix-forward 删掉 `:497`，常规情况会把 sub_resource 插到 `[node]` 段中间，破坏前向声明。两分支的 `if (!insertedSubResources)` 互斥守卫保证 sub_resources 全程只插一次。

> **注**：defects.md 两个 detach 条目的 fix-forward（"删 :495-503 firstNodeIdx 分支"）是错误指引，实施时一并回修为"保留 + 守卫互斥"。

### 测试

新增回归用例（`test/tscn/tscn-editor-detach.test.ts` 或同级）：

- **首 node 是 instance（CRITICAL 复现）**：target 首 node 是 instance（`firstNodeIdx === info.lineIndex`），源场景含 `[sub_resource type="..." id="1"]` + 节点引用 `SubResource("1")`；断言输出含 remapped 后的 `[sub_resource ...]` 段、`SubResource("N")` 的 N 与 remapped id 对得上、`load_steps` 正确。
- **常规情况（防 :497 误删回归）**：`firstNodeIdx < lineIndex`（首个 [node] 不是 instance，instance 在其后），源场景含 sub_resource；断言 sub_resource 插在所有 `[node]` **之前**（前向声明），且全程只插一次。

---

## 改动 2：TTL 60s + 修硬编码漂移

**文件**：`src/guard.ts:14`、`src/core/ToolDispatcher.ts:328`

### 问题

- `guard.ts:14` `TOKEN_TTL_MS = 180_000`（3 分钟），未达 fix-forward 要求的 60s 重放窗口收紧。
- `ToolDispatcher.ts:328` `ttl_seconds: 180` 是**硬编码**，与 `TOKEN_TTL_MS` 不同源——本身是不一致 bug（改一处忘另一处，同类不同步顽疾）。

### 修复

- `guard.ts:14`：`export const TOKEN_TTL_MS = 60_000;`（改值 + 加 export）
- `ToolDispatcher.ts:328`：`ttl_seconds: TOKEN_TTL_MS / 1000`（import 常量，消除硬编码）

### 不波及

`test/core/instance-api-auth.test.ts:111` 的 `TOKEN_TTL_MS` 注释指的是 instance API 的 HMAC token 系统（`generateApiToken`/`verifyApiToken`，独立常量，已为 60s 量级），与 confirm-token 的 `guard.ts:14` 无关，不受影响。

### 测试

补用例验证确认响应 `ttl_seconds === TOKEN_TTL_MS / 1000`（当前即 60），防再次硬编码漂移。

---

## 改动 3：GUARDED 扩 workflow/validation/manage_tools

**文件**：`src/guard.ts:52-75`（GUARDED 表）

merged name 已核实：`workflow`（module-loader/tool-registry 一致）、`validation`（含 test-framework/delivery/game-design 合并）、`manage_tools`（manage-tools.ts:53/82 `name: 'manage_tools'`）。

### 配置

```ts
workflow: new Set(['dev_loop', 'create_files', 'run_verify']),
validation: new Set(['export_build', 'assert', 'stress']),
manage_tools: new Set(['activate', 'deactivate']),  // migrate 只读(返回迁移映射 JSON, TOOL_META.readonly=true), 不守
```

### 守/不守依据（action 清单已 grep 核实）

| 工具 | 守（写/执行） | 不守（读/无副作用） |
|------|--------------|---------------------|
| workflow | `dev_loop`（执行任意 GDScript，等价 execute_gdscript）、`create_files`（写文件）、`run_verify`（运行+验证） | `scene_snapshot`、`batch_validate`、`diff_scenes` |
| validation | `assert`/`stress`（执行任意 GDScript/测试）、`export_build`（写产物） | `validate_project`/`validate_scripts`/`validate_gdd`/`import_resources`/`export_list_presets`/`export_get_preset`/`analyze_error` |
| manage_tools | `activate`/`deactivate`（改运行时工具组状态） | `list_groups`、`sync`、`reconnect`、`migrate`（只读，返回迁移映射 JSON；`TOOL_META.readonly=true`） |

### 边界透明声明

validation 的 `run_and_verify`/`verify_delivery`/`chain_verify` 不守，理由是**代码来源已防护**而非执行量：`assert`/`stress` 执行调用方内联 GDScript（直接 RCE 面，必须守）；而 `run_and_verify`/`verify_delivery` 执行的是**项目内文件代码**，其写入路径（`write_script`/`edit_script`）已被 GUARDED 独立防护，且本地单用户模型下调用方可信。本次跟随 R3 报告保守配置，留作后续 ADVISORY 评估。

> **注**：defects.md `guarded-missing-workflow-validation-manage`（`:746`）fix-forward 写的 `manage_tools:Set(['activate','deactivate','migrate'])` 含 `migrate` 是错误归类（migrate 只读），实施时一并回修为 `['activate','deactivate']`。

### 测试

补 `requiresConfirmation` 用例：上述 8 个 action（workflow 3 + validation 3 + manage_tools 2）返回 `true`；未列 action 返回 `false`——`scene_snapshot`/`batch_validate`/`diff_scenes`（workflow）、`validate_scripts`/`analyze_error`/`import_resources`（validation）、`list_groups`/`sync`/`reconnect`/`migrate`（manage_tools 边界全覆盖：activate/deactivate=true，list_groups/sync/reconnect/migrate=false）。

---

## 验证门禁

- `npm test` 全绿（基线 2956 tests + 新增回归用例）
- `tsc --noEmit` 干净
- `verify_delivery` 通过（项目发版门禁）

## defects 知识库同步

- `detach-instance-drops-subresources`（defects.md:415，R2 立条）+ `detach-instance-firstnode-subresource-loss`（defects.md:736，R3 立条，同根因精确化）：**两条都** status → fixed（改动 1 闭环覆盖同根因）；两条 fix-forward 一并回修（"删 :497"是错误指引 → "保留 + 守卫互斥"）。
- `confirm-token-trust-broken`：部分修（子项 1+4 完成），子项 2/3 仍 open，note 更新。
- `guarded-missing-workflow-validation-manage`（defects.md:746）：status → fixed（改动 3 闭环）；fix-forward 回修——`manage_tools` 守集合去掉 `migrate`（只读），即 `['activate','deactivate']`。
- 知识库：`D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`

## 暂缓项与后续

- CRITICAL-3 子项 2/3（验 caller、明文回传）：留待多客户端/CI 部署前。
- validation GUARDED 边界（run_and_verify/verify_delivery/chain_verify）：ADVISORY 评估。
