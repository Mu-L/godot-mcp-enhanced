# 批次 A 安全修复设计（RCE + 路径穿越）

> 2026-07-23。源自 5 份审查报告（通用版 + 专项1安全RCE + 专项2可靠性 + 专项3GDScript + 专项4测试缺口）核实后的 11 条安全类 finding。superpowers 全闭环：本 spec → plan → 执行 → 审查 → 收尾。批次 A 是 5 批修复的第 1 批（安全最高危），后续 B 可靠性 / C 正确性 / D 工具治理 / E 测试缺口。

## 目标

修复 11 条安全 finding（1 RCE + 4 路径越权/穿越 + 1 symlink 顺序 + 5 纵深/一致性），堵掉路径越权确定漏洞与 class_path RCE，对齐已有防御模式（resolveWithinRoot / has_path_traversal / coerce_property_value）。

## 范围（11 条 → 7 组）

| 编号 | 来源 | 主题 | 级别 |
|---|---|---|---|
| A1 | 专项1 | data-import class_path 无 root 校验 + executeGdscriptTrusted 跳沙箱 → RCE | **P0/RCE** |
| A2 | 专项1 | run_and_verify `scene` 参数无 root 校验 | P1 |
| A3 | 专项1 | workflow.ts `user://..` 穿越×3（reference_path / frames_dir / bridge.screenshot.path） | P1 |
| A4 | 通用 | game-bridge symlink 检查在 icacls/chmod 之后 | P1 |
| A5 | 专项1 | asset_factory.gd:131 唯一漏 has_path_traversal 的 load 点 | P2 |
| A6 | 专项1 | batch_validate `scripts` 未 resolveWithinRoot（existsSync 信息泄露） | P2 |
| A7 | 专项1 | scene/index.ts create_scene/save_scene/load_sprite 缺 resolveWithinRoot | P2 |
| A8 | 专项1 | logger error 字段 + call-recorder msg 未脱敏（经 godot_get_context 返客户端） | P2 |
| A9 | 专项1 | delivery/game-design/batch-tools resolveWithinRoot 未先 normalize | P2 |
| A10 | 专项3 | property coerce 双轨制 + instance 纵深缺口 | P2 |
| A11 | 专项1+3 | traversal 系统性不一致（8 文件 find_node 无 has_path_traversal） | P2 |

## 全局约束

- **信任模型**：本地单用户（MCP 客户端可信），但路径越权仍需修——防误操作 + 契约一致（ALLOWED_PROJECT_PATHS 承诺）+ 纵深防御。
- **行为兼容**：纯加固，不改工具签名/返回结构/正常路径行为。合法 res:// 路径与项目内绝对路径照常工作，仅拦 `..` 段与项目外路径。
- **不破现有测试**：每条修复后跑相关单测 + `npx tsc --noEmit`。GD 改动跑 `validate_scripts` 或 `--import` 编译验证。
- **GDScript 缩进**：.gd 文件用 tab，edit_script search_and_replace（CRLF 安全）。
- **行号漂移**：本 spec 行号基于 2026-07-23 核实，实现时以 grep 实测为准（参考核实子代理报告）。

---

## 修复设计

### 组1 — TS 路径校验统一（A2 / A6 / A7 / A9）

**统一模式**：`resolveWithinRoot(projectPath, normalizeUserProjectPath(x))`（先剥 res:// 前缀，再段级拦 `..` + 项目外）。对齐已有调用（validation.ts:669/791、data-import.ts:321/350、scene/index.ts:126/399）。

- **A2** `src/tools/validation.ts` — handleTool `run_and_verify` 分支：`scene`（核实 ~:543 `cmdArgs.push(scene)`）+ captureTree 分支（~:610 `JSON.stringify({ scene_path: scene })`）。两处 push/序列化前补 `const safeScene = resolveWithinRoot(projectPath, normalizeUserProjectPath(scene));`，后续用 safeScene。
- **A6** `src/tools/workflow.ts` ~:701 batch_validate `scripts` 遍历：当前 `const rel = s.startsWith('res://') ? s.slice(6) : s; const full = join(projectPath, rel);`。改 `const full = resolveWithinRoot(projectPath, normalizeUserProjectPath(s));`（join 会规范 `..` 致越界探测，resolveWithinRoot 抛错拦）。
- **A7** `src/tools/scene/index.ts` ~:227/239/242 create_scene/save_scene/load_sprite：当前仅 `normalizeUserProjectPath`。补 `resolveWithinRoot(p, normalizeUserProjectPath(...))`，对齐同文件 read_scene(:126)/add_node(:399)/quick_scene(:269)。
- **A9** `src/tools/delivery.ts` ~:232/239 + `src/tools/game-design.ts` ~:329 + `src/tools/batch-tools.ts` ~:218-219：当前 `resolveWithinRoot(projectPath, args.xxx_path)` 直传原值。改先 `normalizeUserProjectPath` 剥 res:// 前缀（注：`..` 仍被拦，此条是可用性/一致性——客户端传 res:// 当前生成畸形路径不可用）。

**测试**：每处补单测——传 `..` 段期望 throw/INVALID_PARAMS（resolveWithinRoot 抛错由 ToolDispatcher 捕获）；传合法 res:// 期望通过。A2 场景越权传 `../../etc/passwd` 期望拒绝。

### 组2 — user:// `..` 段拒绝（A3）

**决策点①**（推荐最小补 `..` 拒绝）：user:// 涉及 user_dir 解析，统一 resolveWithinRoot 反而复杂；`..` 段拒绝直接堵穿越。

- `src/tools/workflow.ts` 三处 `startsWith('user://')` 放行分支：
  - ~:381 `bridge.screenshot.path`（**写逃逸**，最重）
  - ~:505 `reference_path`（读逃逸，经 Image.load_from_file）
  - ~:570 `frames_dir`（读逃逸，经 DirAccess.open 遍历）
- **修复**：抽 helper `hasTraversalSegments(p: string): boolean`（检查 `..` 段，复用 path-utils 逻辑或新写），三处 user:// 分支内 `if (hasTraversalSegments(rawPath)) { ...error 'path traversal blocked'... }`。或直接 inline `/../`、`startsWith('../')`、`endsWith('/..')`、`=== '..'` 判定（对齐 command_helpers.gd:49-50 has_path_traversal 语义）。

**测试**：传 `user://../../evil.png` 期望三处都拒绝（bridge screenshot 返 success:false error；reference_path/frames_dir 返 assertion passed:false error）。

### 组3 — class_path RCE（A1，最关键）

**RCE 链**（亲验确认）：`data-import.ts:298` classPath 仅类型断言 → :356 `generateImportScript({ classPath })` → GDScript `load(_class_path)` + `Class.new()` → 经 `executeGdscriptTrusted`（:227，跳沙箱 :1012-1013）→ 加载项目外 evil.gd 实例化 `_init()` = 任意代码执行。

- **修复** `src/tools/data-import.ts:298` 后补：
  ```ts
  const safeClassPath = resolveWithinRoot(projectPath, normalizeUserProjectPath(classPath));
  ```
  :356 `generateImportScript({ classPath: safeClassPath, ... })`（用校验后路径）。拦 `..` 段 + 项目外绝对路径。load() 接受项目内绝对路径或 res://（Godot 4 支持）。
- **注意**：classPath 是 .gd 脚本路径，合法值是项目内 res://scripts/xxx.gd。normalizeUserProjectPath 剥 res://，resolveWithinRoot 保证落在项目内。若需 load() 拿 res://，plan 阶段决定是否转回 res://（resolveWithinRoot 返回绝对路径，load 绝对路径亦可）。

**测试**：传 `class_path: 'res://../../evil.gd'` 期望 INVALID_PARAMS/throw；传合法项目内 .gd 期望通过（需 fixture 脚本）。

### 组4 — symlink 顺序（A4）

- **修复** `src/tools/game-bridge.ts` readBridgeSecret：当前顺序 icacls(~:97-104) → chmod(~:106-108) → lstatSync symlink 检查(~:110)。把 lstatSync + symlink 拒绝移到 icacls/chmod **之前**，对齐 `src/core/editor-auth.ts:75-81`（S-1 已是正确顺序）。或抽公共 helper `assertNotSymlink(path)` 两处复用。
- **后果**：防 symlink 指向受害者文件被 icacls/chmod 篡改 ACL/mode（DoS）。

**测试**：单测——mock lstatSync 返 symlink，断言 icacls/chmod 未被调用（顺序正确则副作用未发生）。

### 组5 — addon GD traversal（A5 / A11）

**决策点②**（推荐 find_node 内置）：CommandHelpers.find_node 是统一入口，内置一处覆盖所有 find_node 调用，DRY 避免再漏。

- **A11 主修复** `addons/godot_mcp_server/commands/command_helpers.gd:29` find_node：函数体开头加：
  ```gdscript
  if has_path_traversal(path):
      push_warning("find_node: path traversal blocked: %s" % path)
      return null
  ```
  覆盖所有经 find_node 的调用（nav/particle/animation/ui/scene/test/animtree 等）。
- **A11 补充** `addons/godot_mcp_server/commands/asset/asset_commands.gd:107` 直接 `get_node_or_null(node_path)`（不经 find_node）：补前置 `if CommandHelpers.has_path_traversal(node_path): return error`。
- **A5** `addons/godot_mcp_server/commands/asset/asset_factory.gd:131` create_material 的 material load：当前仅 `begins_with("res://")`。补 `if CommandHelpers.has_path_traversal(s): return MaterialPresets.create("default")`，对齐其余 5 个 load 点（command_helpers:205 / ui_commands:283,421,435 / scene_commands:105）。

**测试**：GD 侧难单测，靠 defects.ts 静态 detect（grep has_path_traversal 调用点）+ 运行时手动验（传 `../` 节点路径期望 null/error）。defects.ts 补 detect 守卫。

### 组6 — instance coerce 纵深（A10）

**决策点③**（推荐全统一）：双轨制是缺陷根源（老函数不 load Resource + 本地 blocked 无 instance），只补 instance 治标；批次 A 既动此处就彻底统一。

- **现状**：`coerce_property_value`（command_helpers.gd:187-215）完整含 BLOCKED + instance 双保险 + TYPE_OBJECT load，仅 node_commands 3 处用。老 `property_exists_and_type_ok`（:58-84，不 load + 无 instance 拦）仍被 ui_commands(:68,:326) + scene_commands(:131,:200) 用，且这 4 处用本地 blocked 列表（ui_commands:6-10 / scene_commands:115-119,187-191，均无 instance）。
- **修复**：
  1. ui_commands ui_create_control(:68) + ui_container_add(:326) + scene_commands instance_scene(:131) + set_instance_property(:200) 4 处：改调 `coerce_property_value`，适配返回值（Dictionary {ok,value,error} 替代 bool）。
  2. 删 ui_commands:6-10 BLOCKED_PROPS + scene_commands:115-119,187-191 本地列表，统一用 `CommandHelpers.BLOCKED_PROPERTIES`（:174-180，含 instance）。
  3. 老 `property_exists_and_type_ok` 若无其他调用方则删（grep 确认）；若仍有则保留并注明 deprecated。
- **后果**：ui/scene Resource 属性（theme/font）经 load 正确设置（非静默丢）；instance 纵深防御覆盖所有 property 设置路径。

**测试**：ui_create_control 传 theme res:// 期望加载成功；传 instance 期望被拒（BLOCKED）；defects.ts 补 detect 守卫（本地 blocked 列表应消失）。

### 组7 — 凭证脱敏（A8）

- **修复** `src/core/logger.ts:413` `entry.error = err` → `entry.error = sanitizeMsg(String(err))`（对齐同文件 :348 msg 字段已脱敏）。
- **修复** `src/core/call-recorder.ts:50,58` record 的 msg → 套 `sanitizeMsg(msg)`（经 godot_get_context getRecent(50)/getStats 返客户端，:91-92）。
- **注意**：当前 secret 不出现在异常 message（实际无泄露），此条是防御纵深——未来工具在异常拼接 secret 则有拦截。

**测试**：单测——构造含 secret pattern 的 error/msg，断言 sanitize 后不含原文。

---

## 决策点汇总

| # | 决策 | 推荐 | 备选 |
|---|---|---|---|
| ① | A3 user:// 穿越 | 最小补 `..` 段拒绝 | 统一 resolveWithinRoot（复杂） |
| ② | A11 traversal 系统性 | find_node 内置 + asset_commands 单独前置 | 每文件显式前置（工作量大） |
| ③ | A10 instance coerce | 全统一走 coerce_property_value + 删本地 blocked | 只补 instance 到本地 blocked（治标） |

## 测试策略

- **TS 侧**：每条补单测（vitest），重点 `..` 段拒绝 + 合法路径通过。A1/A2/A3/A6/A7 各 1-2 用例。
- **GD 侧**：defects.ts 补静态 detect 守卫（A5/A10/A11 的 grep 模式）。
- **不依赖运行时 Godot**：批次 A 多数修复可静态测（resolveWithinRoot/sanitizeMsg 纯函数）。A1 class_path load 验证需 fixture（可选运行时）。
- **回归**：`npx tsc --noEmit` + 全量 vitest（确保不破现有）。

## 验收标准

1. 11 条 finding 全部修复，每条有对应测试或 defects.ts detect 守卫。
2. `npx tsc --noEmit` exit 0。
3. 全量 vitest 不新增 failed（pre-existing T11 等可接受，需标注）。
4. A1 RCE 链堵掉（class_path `..` / 项目外路径被拦）。
5. defects.ts 新增 detect 守卫绿。
6. CHANGELOG 记录批次 A 修复（Security 段）。

## 风险

- **A10 全统一工作量大**：4 个调用点改返回值适配 + 删本地 blocked，可能引入 ui/scene property 设置回归。缓解：逐个调用点改 + 测试，defects.ts detect 守卫防本地 blocked 复活。
- **A1 load() 路径形式**：resolveWithinRoot 返回绝对路径，load() 是否接受需 plan 阶段验证（Godot 4 load 接受绝对路径，但保险可转 res://）。
- **A11 find_node 内置可能误拦**：某些合法节点路径含 `..`？Godot 节点路径 `..` 是父节点引用（如 `get_node("../Sibling")`），合法。但 MCP 工具传的 node_path 应是 root 下绝对/相对路径，`..` 段 escape 场景树是异常。缓解：find_node 内置只拦，push_warning 不中断（return null），调用方按 null 处理（现有 find_node 返 null 已被各 handler 检查）。

## 不在本批次（后续批次）

- B 可靠性（bridge/health）、C 正确性（资源写/addon）、D 工具治理（asset/android + 误标 read）、E 测试缺口。
- 通用版 7 条次要（fireDisconnect try-catch / 重建后 setState / csv_content OOM / .tmp.tres 跨目录自清 / 裸 rm 等）——第二批 follow-up。
