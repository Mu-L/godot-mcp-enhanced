# 2026-07-23 批次 C 正确性修复设计（协议契约 + 返回值语义 + undo 完整性 + 参数校验）

> 适用于 godot-mcp-enhanced v0.23.0+（批次 A 安全 + 批次 B 可靠性之后）
>
> **行号锚点声明**：本文 `文件:行号` 为 2026-07-23 核查快照，会漂移；实现/plan 一律以 grep 实际行号为准。

## 背景

5 份审查报告（2026-07-22）暴露 37 条 finding。批次 A（10 安全）+ 批次 B（10 可靠性）已闭环。本 spec 是批次 C（正确性，13 条 C1-C13），来源：通用版「三层架构综合审查」协议正确性/参数校验段 + addons GDScript 审查的正确性 finding + data-import 子代理。

**Architecture**：纯 bug 修复，不改工具签名与正常路径行为。13 条按 GD（9）/ TS（4）分 task 组，每 finding TDD（RED→fix→GREEN）。GDScript 改动须 `check:gdscript` + `godot --headless --import` 真编译（批次 B 教训：check:gdscript 是正则假绿）。

## Finding 清单（13 条，C1-C13）

| # | 位置 | finding | 严重度 |
|---|------|---------|--------|
| C1 | sync_commands.gd:127/144 | _on_node_added/removed 绕路 _command_handler.get_plugin()（不存在→null→get_child(0) fallback 错场景） | IMPORTANT |
| C2 | gdscript-executor.ts:1361 | extractCompileError marker 分支裸 includes（用户 print "Parse Error:" 误判 compile_success:false） | IMPORTANT |
| C3 | websocket_server.gd:267 | params:null 放行→Dictionary 强类型 SCRIPT ERROR 中断帧 packet 循环 | IMPORTANT |
| C4 | nav_commands.gd:37/58/64 | bake_result 判据恒 true（mesh 预置非 null）+ bake_navigation_mesh coroutine 未 await | IMPORTANT |
| C5 | path_generator.gd:18 | resolve_points 不 strip "root/" 前缀（与 asset_placer/command_helpers 不一致） | ADVISORY |
| C6 | data-import.ts:318-334 | csv_content 分支无前置 size 守卫（超大字符串 MCP SDK JSON.parse 阶段 OOM） | ADVISORY |
| C7 | data-import.ts:147-156 | .tmp.tres 启动自清只扫当前 _output_dir（跨目录残留） | ADVISORY |
| C8 | gdscript-executor.ts:1344 | proc.on('error') 裸 rm 非 retryRm（Windows EPERM 残留） | ADVISORY |
| C9 | test_commands.gd:29 | test_assert 用 str() 比较（Vector3 vs Array / bool vs int 永不等） | IMPORTANT |
| C10 | animtree_commands.gd:69/100/136 | add_state/add_transition/set_blend 不建 undo action（Ctrl+Z 只撤 create） | IMPORTANT |
| C11 | node_commands.gd:216-256 | batch_add_nodes 预校验 instantiate 的 Node commit 失败时孤儿 leak | IMPORTANT |
| C12 | node_commands.gd:179 / scene_commands.gd:205 | edit_node/set_instance_property undo 只读属性 old_val=null 错误赋值 | IMPORTANT |
| C13 | ui_commands.gd:264/421/435 | set_params 任意 key + load font/stylebox null 未守 | IMPORTANT |

## 设计（6 task 组）

### 组 1：GD-sync/editor 集成（C1）

**★ 核查校准**（2026-07-23）：sync_commands.gd **已有** `_plugin: EditorPlugin` 字段（:11）+ `_get_ei()`（:23-27 用 `_plugin.get_editor_interface()`），:61/:76 已正确用 `ei.get_edited_scene_root()`。bug 仅在 :127/:144 两个回调绕路用 `_command_handler.get_plugin()`（command_handler.gd extends Node 无此方法→`has_method` 恒 false→传 null）。
- 现状：`get_edited_scene_root(null)` fallback 到 `command_helpers.gd:22-23` `st.root.get_child(0)`（编辑器主 UI 根，非被编辑场景）→ `is_ancestor_of(node)` 判断错 → scene_tree_changed 通知对错节点/被错误过滤 → EditorToolExecutor ring buffer 数据错。
- **修复（2 行）**：:127/:144 改用现成 `_plugin`：`var edited_root = CommandHelpers.get_edited_scene_root(_plugin)`（或直接 `_get_ei().get_edited_scene_root()` 对齐 :61/:76）。删 dead `_command_handler.get_plugin()` indirection。
- 与 spec 设计决策①一致（"sync._plugin 对齐其他命令"——实际 _plugin 已存在，只是回调没用）。

### 组 2：GD-协议/返回值语义（C3 + C4 + C9）

**C3**（websocket_server.gd:267）：params 守卫 `if _rpc_params != null and not (_rpc_params is Dictionary)` 用 `and` 短路，`params:null`（key 存在 get 返 null）放行。修复：守卫改 `if _rpc_params == null or not (_rpc_params is Dictionary)` → null 时 coerced `{}` 或 reject（plan 细化，倾向 coerce `{}` 保 JSON-RPC 容错 + 日志 warn）。

**C4**（nav_commands.gd）：
- bake_result 判据恒 true：:37 `nav.navigation_mesh = mesh`（new 非 null），:58/:64 `nav.navigation_mesh != null` 恒 true。
- bake_navigation_mesh coroutine 未 await：:63 `nav.bake_navigation_mesh()`（无 await）+ :52 undo path do_method。
- 修复：bake_result 改查真成功（`nav.navigation_mesh.get_vertices_count() > 0`）；bake 若 coroutine 加 `await`（非 undo path :63）。undo path :52 do_method 的 coroutine 执行——核查 commit_action 是否 await（若否，plan 决策：bake 移出 undo op 单独 await 或接受 commit 后异步 bake + 结果轮询）。

**C9**（test_commands.gd:29）：`var match = str(val) == str(expected)`。str(Vector3(10,0,5))="(10, 0, 5)" ≠ str([10,0,5])="[10, 0, 5]"；str(true)≠str(1)。
- 修复：command_helpers.gd 加 `values_equal(val, expected) -> bool` helper（类型感知）：
  - val/expected 同类型：直接 `==`
  - expected is Array + val is Vector2/3/4i/Color/Plane/Quaternion：分量比（复用 coerce_property_value 的 Array→数学类型逻辑反向）
  - bool↔int：`int(val) == int(expected)` 宽松（或严格拒，plan 决策）
  - 数字（int/float）：`==`（GDScript 数字比较宽松）
  - fallback：`str(val) == str(expected)`
  - test_assert property_equals 改调 `values_equal`。设计决策②。

### 组 3：GD-undo 完整性（C10 + C11 + C12）

**C10**（animtree_commands.gd）：handle_animtree_create（:52）有 create_action_mixed undo，但 add_state（:69）/add_transition（:100）/set_blend（:136）直接改 sm/tree 无 undo action。
- 修复：三者用既有 `_undo_manager.create_action_mixed` 模式（nav_commands.gd:53 示范），add undo op + 对应 undo op（remove_state/remove_transition/reset_blend）。设计决策④。

**C11**（node_commands.gd:216-256 batch_add_nodes）：预校验 :230 `ClassDB.instantiate` ≤100 Node（未 add_child），:256 commit；commit 中途某 add_child 抛错→已 instantiate Node 孤儿 leak。
- 修复：commit 失败 catch 遍历 validated 清未入树：`if not cls.is_inside_tree(): cls.free()`。

**C12**（node_commands.gd:179 edit_node / scene_commands.gd:205 set_instance_property）：undo `old_val = node.get(key)`，只读属性返 null，undo 时 `set(key, null)` 错误赋值（注释 node_commands.gd:149-150 已承认 follow-up）。
- 修复：记录 old_val 前查 `PROPERTY_USAGE_READ_ONLY` flag（`property_usage` via get_property_list），只读属性跳过 undo 记录（或记标记 undo 时跳过 set）。设计决策④。

### 组 4：GD-参数校验（C13 + C5）

**C13**（ui_commands.gd）：① :264 set_params 遍历 params `theme.set(key, val)`，key 任意 String，Theme 无该动态属性 silent fail；② :421/:435 `load(font_path)`/`load(sb_path)` 返 null 直接传 set_default_font/set_stylebox → SCRIPT ERROR 或 silent no-op。
- 修复：① set_params 校验 key（查 Theme 有效属性白名单或 get_property_list，无效 key 报错/跳过+warn）；② load 后 null 守卫（返 error 而非传 null）。

**C5**（path_generator.gd:18 resolve_points）：`get_node_or_null(path_node)` 不 strip "root/" 前缀。
- 修复：对齐 command_helpers.find_node（:28-30 strip "root/" + leading slashes）/ asset_placer.gd:151-166。复用 CommandHelpers.find_node 或内联 strip。

### 组 5：TS 正确性（C2 + C6 + C7 + C8）

**C2**（gdscript-executor.ts:1361 extractCompileError）：marker 成功分支裸 `trimmed.includes('Parse Error:') || ...('Script Error:')` 扫全部行，用户 `print("Parse Error: debug")` 误判。no-marker 分支用 `\b...\b` 词边界。
- 修复：marker 分支对齐 no-marker 的 `\b` 词边界正则（`/\bParse Error:/` 等），避免命中用户 print 内容。

**C6**（data-import.ts:318-334 csv_content 分支）：无前置 size 守卫，超大字符串 MCP SDK JSON.parse 阶段 OOM（后置 :337 守卫太晚）。
- 修复：csv_content 解析前置 size 守卫（对齐 csv_file 分支的 MAX_CSV_SIZE 检查，在 JSON.parse 前）。

**C7**（data-import.ts:147-156）：.tmp.tres 启动自清只扫当前 `_output_dir`，跨目录残留不扫。
- 修复：自清扩展为扫 res:// 全局 `*.tmp.tres`（或目标输出根下递归），对齐 godot_operations.gd `_clean_atomic_tmp` 模式（批次 B T3a）。

**C8**（gdscript-executor.ts:1344 proc.on('error')）：裸 `rm` 非 `retryRm`（Windows EPERM 残留），与 timer/close 分支不一致。
- 修复：改 `retryRm`（对齐同文件其他清理分支）。

### 组 6：defects detect + CHANGELOG

defects.ts 加 C1-C13 detect 闭包（FIXED 返回 0，内联非 global 正则避 lastIndex bug，批次 B 教训）+ defects-fixed 计数同步（80→93）+ CHANGELOG 批次 C 段。RED→GREEN 验证。

## 不修 / 否决

无。13 条全修（用户选全范围）。

## 验收标准

1. **13 条修复**：C1-C13 每条有对应改动 + 来源可溯。
2. **TDD**：每 finding RED（失败测试复现 bug）→ fix → GREEN。
3. **GDScript 编译门**：`check:gdscript` errors=0 warnings=0 **且** `godot --headless --import` 4.7+4.6.2 双版本真编译过（check:gdscript 假绿，批次 B 教训）。
4. **回归门禁**：`tsc --noEmit` exit 0；全量 vitest 无新 failed（pre-existing T11 4 条不变）。
5. **defects detect 守卫**：C1-C13 登记 defects.ts（FIXED detect===0 防复发）。
6. **CHANGELOG**：批次 C 条目（正确性段）。

## 风险

1. **undo 完整性（C10/C12）**：改 undo 栈可能引入 undo/redo 回归。缓解：对齐既有 create_action_mixed 模式（nav_commands 示范）+ 只读属性 PROPERTY_USAGE_READ_ONLY 检查 + undo 端到端集成测试。
2. **C4 bake coroutine**：bake_navigation_mesh 是 coroutine，undo do_method 执行 + await 语义复杂。缓解：plan 细化（bake 移出 undo op / commit 后轮询 / 接受异步），实测 bake 结果。
3. **C9 类型感知比较**：bool↔int 宽松 vs 严格、Array↔Vector3 分量比的边界。缓解：values_equal helper 单测覆盖各类型组合。
4. **C1 回调行为变化**：改 _on_node_added/removed 的 edited_root 来源可能改变 scene_tree_changed 通知行为（之前错场景，修后对场景）。缓解：集成测试验证 notification 正确触发 + EditorToolExecutor ring buffer 收到正确节点。
