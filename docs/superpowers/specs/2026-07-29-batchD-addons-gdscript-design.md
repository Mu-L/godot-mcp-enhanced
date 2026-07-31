---
date: 2026-07-29
project: godot-mcp-enhanced
type: design
status: approved-pending-review
systems:
  - "[[M2-defect-regression]]"
  - "[[plan-baseline-verify-grep]]"
  - "[[verify-implementation-by-source]]"
---

# 2026-07-29 批次 D（addons GDScript）修复设计

> 承接总 spec `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-29-审查修复批次设计.md`（A0→A→B→C→**D**→E）与报告5 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-29 审查 addons GDScript（v0.24.1 后）.md`。A0/A-RCE/B-Reliability/C-Correctness 已闭环（HEAD `e2e87c2`），本 spec 定义 D 批次（addons editor 插件 .gd）的**子批划分、修复、验收**。
>
> **所有 file:line 经 grep 实测复核**（HEAD `e2e87c2`），非引用报告5 快照。报告5 审查的是 `e0346a0`，A/B/C 在其后但未触及本批 editor 插件 .gd，行号一致。

## 决策（brainstorming + 评审已对齐）

- **子批切分**：D-P2（F1-F4，先）→ D-ADV（F5-F9，后），各出独立 plan、各走一轮 SDD。对齐总 spec 子序列惯例（A 批 telemetry→RCE 同模式），P2（有实际影响）优先闭环，F2 工作量大单独成批更聚焦。
- **F8 豁免**：EditorPlugin 继承 Node，`_enter_tree`/`_exit_tree` 为空实现，不调 `super()` 功能无害（非 bug）。不改代码，`defects.ts` `plugin-no-super-call`（:277 已 status:fixed）补 note「EditorPlugin 生命周期无需 super，原 finding 误判」。
- **F1 只 GD 层**：asset 工具是 **GD 单点校验架构**（`D:\GitHub\godot-mcp-enhanced\src\tools\asset\schema.ts:3-5` 明文「TS 不重复校验」+ `asset-ops.ts:63` params 是无结构 `{type:'object'}` + grep zod 零命中）。F1 只做 .gd `clampi`，不碰 TS schema。（评审 B2 推翻先前"双层"设想，依据代码实测。）
- **F7 降级**：`handle_batch_add_nodes:202-204` 入口已有 `_plugin` null 守卫（`_get_ei`→`ei==null` 返回 -32000）+ `:260` `_undo_manager != null` else 分支 + `:267-271` 孤儿扫描，三层覆盖。F7 改为「TDD 验证现有守卫有效 + 注释残余风险」，不加冗余 null 守卫（YAGNI）。
- **F9 落点**：守卫加在 **`asset_placer.gd` 内**（static 参数守卫 `if undo_mgr != null`，非模块级）。理由：调用方 `asset_commands.gd:43-73` 入口守卫了 `_plugin`（via `_get_ei`/ei）但**未守卫 `_undo_manager`**，asset_placer 是放置原子单元，参数自防御 + else 直接 add_child fallback 自然落在放置层。

## D-P2 子批（先，4 条）

### F1 网格细分参数无上限 → GD clampi（最高优先，唯一 DoS 面）

**问题**：`custom_meshes.gd` 6 处细分参数 `max(int(...), N)` 只取下限不取上限，认证客户端（asset 工具经 confirm 门）可传超大值在 `@tool` 编辑器主线程同步建顶点 → 卡死/OOM。`path_generator.gd` sample 的 count 同样无采样数上限。

**文件 + 修复**（`max(int(...), N)` → `clampi(int(...), N, CAP)`）：
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\custom_meshes.gd`
  - `:16` cone segments、`:56` tube segments → `clampi(int(...), 3, 128)`
  - `:136` torus ms、`:137` torus ns → `clampi(int(...), 3, 128)`；**加注释**：ms/ns 各 ≤128 隐含 ms×ns ≤ 16384，顶点 ≈ 9.8 万 < 20 万上限，故无需额外乘积守卫（各自 clampi 已隐含约束乘积）
  - `:169` stairs steps → `clampi(int(...), 1, 200)`；`:202` fence posts → `clampi(int(...), 1, 200)`
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\path_generator.gd`
  - `sample` 入口（`:51-88`）对 `count` 加上限 ≤ 10000，超限返 `{"error":{"code":-32004,"message":"count exceeds maximum 10000"}}`。（spacing≤0 死循环 P0-3 已修 `:102/:120`，此处只防超大采样数 OOM。）

**验证**：editor 实测 `asset_create torus{major_segments:1000000,minor_segments:1000000}` clamp 后快速完成不卡死；`path count:100000` 返 -32004。

**detect**：补 `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts` detect 断言 `custom_meshes.gd` 6 处含 `clampi`（grep 基线：当前 `max(int` 6 处、`clampi` 0 处）。

### F2 nav_set_params + ui layout/theme 无 undo → _record_prop 模式

**问题**：`nav_commands.handle_nav_set_params` 与 `ui_commands` 5 个 layout/theme handler 直接赋值改属性，未走 `create_action_mixed`，Ctrl+Z 不撤销。nav_set_params 与 ui layout/theme 的 undo 缺失**此前无对应 detect**（defects.ts 含 undo 的 key 仅 `nav-bake-in-undo-action`:470 覆盖 nav create region/agent/link、`animtree-state-transition-blend-no-undo`:977 覆盖 animtree transition，均不涉及 set_params/ui 属性赋值）。F2 为**纯新增防护 + 新增 detect**。

**文件 + 修复**（照搬 `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\particle_commands.gd:19` 的 `_record_prop(do_ops, undo_ops, target, prop, new_val)`：do=set new / undo=set old=`target.get(prop)`）：
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\nav_commands.gd`
  - `handle_nav_set_params`（:238）：在该文件加 `_record_prop` helper + `create_action_mixed` 包裹（region 多属性逐个 `_record_prop` 聚合一次 action）
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\ui_commands.gd`
  - `handle_ui_set_layout`（:85，多属性聚合一次 action）、`handle_ui_anchor_preset`（:185）、`handle_ui_set_theme`（:226）、`handle_theme_create`（:347）、`handle_theme_set_property`（:404）同理

**验证**：editor 端到端实测 `nav_set_params` 改 radius → Ctrl+Z 真回滚；`ui_set_layout` 改布局 → Ctrl+Z 回滚。

**detect**：补 detect 断言 `nav_commands.gd` `handle_nav_set_params` 函数体内含 `create_action_mixed`（grep 基线：当前该函数 :238 内 0 处 create_action_mixed）。

### F3 animation keyframe_index 越界 → ki 边界守卫

**问题**：`animation_commands.gd` remove（:186）/update（:206）/curve（:269）三分支 `ki = int(keyframe_index)` 后无 `ki >= 0 and ki < track_get_key_count(ti)` 守卫，越界 ki → Godot 内部 push_error + 假成功（返 keyframe_removed/updated/curve_set）。

**文件 + 修复**：
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\animation_commands.gd`
  - :186（remove）、:206（update）、:269（curve）三分支，`ki = int(...)` 后加：`if ki < 0 or ki >= anim.track_get_key_count(ti): return {"error":{"code":-32004,"message":"keyframe_index out of range"}}`（对齐 ti 既有守卫 :139/:270）

**验证**：传越界 ki（如 keyframe_index=999）返 -32004 而非假成功。

**detect**：补 detect 断言三分支含 `track_get_key_count` 守卫（grep 基线：当前 `track_get_key_count` 仅 :86/:343 循环用，无 ki 守卫）。

### F4 websocket outbound buffer 无上限 → set_outbound_buffer_size

**问题**：`websocket_server.gd:231` 只有 `set_inbound_buffer_size(MAX_MESSAGE_SIZE)`，无 `set_outbound_buffer_size`，sync 风暴/慢消费者 → outbound 无界增长 OOM（Obsidian defects.md `websocket-outbound-no-buffer-limit` open）。

**文件 + 修复**：
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd`
  - `:231` 后加 `ws_peer.set_outbound_buffer_size(4 * 1024 * 1024)`（4MB）
  - **不重复加 push_warning**：`send_mcp_notification`（:393-397）已有 `if _send_err != OK: push_warning(...)`（评审 B1 实测）；**不加 close peer**（本地 ≤5 认证 peer，push_warning 足够，close 过度）

**验证**：grep `set_outbound_buffer_size` 命中；editor 多 peer 慢消费者场景不致 OOM（push_warning 告警）。

**detect**：**新增** `defects.ts` detect `websocket-outbound-no-buffer-limit`（key 名对齐 Obsidian defects.md 已有条；grep 实测当前 defects.ts **无此条**，故 CI 门禁为**新增** 128→129，非回标）+ Obsidian defects.md 回标 open→fixed。

## D-ADV 子批（后，5 条）

### F5 animtree conditions 元素未校验 Dictionary

- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\animtree_commands.gd:136-138`：`for cond in conditions` 循环内加 `if not (cond is Dictionary): continue`（或累计失败返 -32004）
- detect：断言 conditions 循环含 Dictionary 校验

### F6 undo_manager 死代码删除

- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\undo_manager.gd:9,20`：删 `create_action` / `create_action_with_props`（grep 实测零外部调用，仅 `create_action_mixed`:35 在用）
- detect：断言两方法已移除（`create_action_mixed` 保留）

### F7 batch_add_nodes 孤儿清理（降级：验证 + 注释，不加冗余守卫）

- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\node_commands.gd:201-271`：入口 `:202-204` 已守卫 `_plugin` null（`_get_ei`→ei==null 返 -32000）、`:260` 已守卫 `_undo_manager` null（else callv 直接执行）、`:267-271` 孤儿扫描兜底。F7 = TDD 写测试验证「`_plugin` null 时入口返 -32000 不 instantiate」「commit 失败时孤儿扫描 free 未入树 cls」+ 注释说明残余风险（commit 内部 SCRIPT ERROR 理论可能，但触发条件被入口守卫排除大半）。**不加冗余 null 守卫**（YAGNI）。
- detect：plan 阶段确认是否已有 batch orphan detect 可复用

### F8 plugin super() 豁免标注

- 不改 `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\plugin.gd`（`_enter_tree:7`/`_exit_tree:18` 不调 super 功能无害）
- `D:\GitHub\godot-mcp-enhanced\test\regression\defects.ts:277` `plugin-no-super-call`（已 status:fixed）补 note「EditorPlugin 继承 Node 空实现，无需 super，原 finding 误判」+ Obsidian defects.md 同步
- 无新增 detect

### F9 asset_placer undo_mgr null 守卫

- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\asset_placer.gd`：`place_one`（:45）、`place_batch`（:85）加 `if undo_mgr != null: undo_mgr.create_action_mixed(...) else: 直接 add_child fallback`（static 参数守卫，对齐 `node_commands.handle_add_node:76`）。`place_path`（:96）经 `return place_batch(...)`（:130）委托，修 place_batch 自动覆盖，无需单独修。调用方 `asset_commands.gd:43-73` 入口守卫了 `_plugin`（via ei）但未守卫 `_undo_manager`，故守卫落在 asset_placer。
- detect：断言 place_one/place_batch 含 undo_mgr null 守卫

## 流程（每子批完整 SDD，继承总 spec）

1. 各子批进 `writing-plans` 出详细 plan（含下文「待核实点」的代码勘察）
2. TDD 逐条：RED（失败测试）→ GREEN；含**反向断言**（越界返 -32004 / isError / 超大参数不卡死）
3. `requesting-code-review`，final review 用 opus
4. 多 commit（按 finding 粒度），master 不 push（push 须 AskUserQuestion 显式确认，惯例 [[user-prefers-local-ahead-no-push]]）
5. D-P2 全门禁绿 + review 过，再开 D-ADV spec→plan

## 验收门禁（每子批结束必跑）

- `tsc` 0 错误（D 批次基本不动 TS，仅 F4/F6/F8 触 defects.ts）
- `eslint` 0 errors
- `check:gdscript` 0 err / 0 warn（4.6.3 + 4.7.1 真编译，`check-gdscript.ts:91` 内部 `runGodotHeadless`，非 npm flag、非 `--check-only` 假绿）
- `vitest` 全量 passed（4 pre-existing T11 elicitation baseline 确认非回归）
- `defects-fixed` 全绿：当前 **128 key / 9 open**（`grep -c "key:"` 实测，头注 117 旧）；D-P2 新增 detect（F1/F2/F3/F4）后计数更新；D-ADV 视 F5/F6/F9 新增 detect。每加一条 detect 同步头注计数。
- `build-matrix` 同步（若动工具/组/GUARDED_KEYS——D 批次预计不动）
- editor .gd 改动：cp 同步项目内 addons + 重启编辑器端到端实测（F2 nav/ui undo Ctrl+Z、F1 超大参数不卡死、F4 多 peer）

## writing-plans 待核实点

- **F1**：`path_generator.gd:51-88` sample 入口结构，count 上限落点（入口 early-return vs sample 内）；torus ms/ns clampi 128 后实测建顶点不卡
- **F2**：`nav_set_params` 实际改哪些 region 属性（radius/height/agent_radius 等，决定 `_record_prop` 调用数）；`ui_set_layout` 多属性清单
- **F4**：4MB outbound buffer 上限合理性（对齐 `MAX_MESSAGE_SIZE` inbound）；defects.ts detect 写法（参现有风格）
- **F9**：**已结案**——`place_path:130` `return place_batch(...)`，修 place_batch:85 自动覆盖 place_path，无需单独修
- **detect 计数**：plan 阶段 `grep -c "key:"` 实测当前值，每加一条 detect 同步头注计数

## 关联

- 总 spec：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-29-审查修复批次设计.md`
- 报告5：`D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-29 审查 addons GDScript（v0.24.1 后）.md`
- 去重待办：`D:\workspace\Obsidian\GodotMCP\项目待办.md`
- progress：`D:\GitHub\godot-mcp-enhanced\.superpowers\sdd\progress.md`（A0/A/B/C 已闭环段，D 待开章节）
