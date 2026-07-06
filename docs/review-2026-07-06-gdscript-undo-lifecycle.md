# Review 2026-07-06: GDScript 撤销栈完整性 + @tool 生命周期 + 主线程副作用

> **审查范围**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\` 下全部 20 个 `.gd` 文件 + `status_panel.tscn`（TS 侧不在本轮范围）
> **审查方法**：按深挖清单 8 路深挖（undo 栈原子性 / 跨工具串扰 / 栈溢出 / 未入栈的"偷偷修改" / @tool 生命周期 / 主线程约定 / free 后引用 / 内存与信号泄漏）。完整通读 `undo_manager.gd` / `editor_guards.gd` / `plugin.gd` / `command_handler.gd` / `heartbeat.gd` / `websocket_server.gd` + 11 个 `commands/*.gd` + `ui/status_panel.gd`
> **结论**：4 条 P0 + 6 条 P1。最严重集中在 **undo 栈完整性**（P0-1/2/3）与 **@tool 插件输入副作用**（P0-4）。`undo_manager.gd` 的 Callable/引用处理有系统性缺陷；`particle_commands.gd` 四个 setter **完全绕过 undo_manager**；`recording_commands.gd` 的 `_input`/`parse_input_event` 在编辑器插件里可触发自动保存等危险操作

---

## 调用链关键事实

- **undo 入口**：所有 mutating 工具调用 → `command_handler.handle`（`command_handler.gd:98`）→ 各 `commands/*.gd` 的 `handle_*` → `_undo_manager.create_action_mixed`（`undo_manager.gd:35`）→ `_plugin.get_undo_redo().create_action/commit_action`
- **commit_action 语义**：Godot 的 `UndoRedo.commit_action()` **立即执行 do 分支**并注册 undo 分支。任何在 `commit_action` **之后**对节点的修改都不会进 undo 栈（见 P0-2）
- **@tool 链路**：`plugin.gd`（@tool EditorPlugin）→ `websocket_server` → `command_handler` → 各 commands。`recording_commands` 挂在 `command_handler` 下，整个链路在编辑器主线程运行
- **_process 主入口**：`websocket_server._process`（`websocket_server.gd:194`）每帧同步 `peer.poll()` + `_handle_message` → `_command_handler.handle`（`:319`）。慢命令阻塞所有 peer 的心跳（见 P1-10）
- **信号连接**：`sync_commands.start_sync`（`sync_commands.gd:39`）连到 `SceneTree.node_added/node_removed` 全局信号；`heartbeat.timeout_detected` → `websocket_server._on_heartbeat_timeout`（`websocket_server.gd:39`）
- **已存在的健壮设计**（避免误报）：per-peer auth 锁定（`websocket_server.gd:257-265`）、constant_time_compare（`:381`）、icacls/chmod 权限收紧（`:116-137`）、Recording 事件上限 `MAX_RECORDED_EVENTS=50000` + 回放上限 `MAX_PLAYBACK_EVENTS=10000`（`recording_commands.gd:11,15`）、node_type/Control_type 严格白名单（`node_commands.gd:79`、`ui_commands.gd:48`）

## 初始假设证伪

| 假设 | 实测结果 |
|------|---------|
| 所有 mutating 工具都进 undo 栈 | ❌ `particle_commands.gd` 的 4 个 setter（set_emission/set_process/load_preset/set_material）**全程不调用 `_undo_manager`**，字段注入了但从未使用（`particle_commands.gd:8,43-57,60-222`） |
| `commit_action` 后再改节点是安全的 | ❌ `nav_commands.gd:49-56` 在 `create_action_mixed` **之后**才赋值 `navigation_mesh` 和 `bake_navigation_mesh()`，这些操作不进 undo 栈 |
| undo 的 Callable 在 redo 期间可靠 | ❌ `undo_manager.gd:46-56` 用 `Callable(target, method).bindv(args)`，但 Godot 4.x `add_undo_method(Callable)` **不校验 target 存活**，target 被 free 后 undo 静默失效或 push error |
| remove_track 的 undo 用绝对索引安全 | ❌ `animation_commands.gd:80-108` 的 undo_ops 用 `get_track_count()-1` 作为 new_idx，但 redo 第二次时若用户手动增删 track，原 `ti` 索引已失效，删错轨道 |
| recording 只在运行时游戏里捕获输入 | ❌ `recording_commands.gd:20` `_input` 在 @tool 编辑器插件运行时**全程激活**，回放 `Input.parse_input_event`（`:210` 等）会重新注入事件到编辑器，可能触发 Ctrl+S 自动保存等危险操作 |
| editor_guards 对 .gd 脚本守卫全覆盖 | ❌ `editor_guards.gd:120-135` 只遍历 `script_editor.get_open_scripts()`，**从未在编辑器打开过**的脚本（TS 侧直接写新文件）守卫直接放行 |

---

## 一、P0（立即修复）

### [P0] 1. undo_manager.add_undo_method 的 Callable/引用处理系统性缺陷 ⭐ 最该修

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\undo_manager.gd:9-27, 46-56, 85-94`
- **问题**：
  1. `_add_method`（`:46-56`）对 do/undo 都用 `Callable(target, method).bindv(args)`。Godot 4.x 的 `UndoRedo.add_undo_method(Callable)` **不校验 target 存活**，undo 重放时若 target 已被 `free()`/`queue_free()`，Callable 调用命中空引用 → 静默不执行或编辑器刷红字
  2. `create_action`（`:9-16`）和 `create_action_with_props`（`:20-27`）**完全不处理 reference**。UndoRedo 的契约是：被 `add_do_method` 操作的 Node 必须配对 `add_do_reference/add_undo_reference`，否则 Node 在 redo 间隔被编辑器回收后，undo 无法重放。只有 `create_action_mixed`（`:35`）支持 reference（`:85-94`），且仅限 Node 不接受 Resource
  3. `reference` 分支（`:85-94`）对非 Node 值只 `push_warning` 跳过，但调用方（node_commands/scene_commands 等）传的就是新建 Node，理论上配对了；问题在 `_add_method` 这层没有 `is_instance_valid(target)` 守卫
- **后果**：用户点 Undo 时，add_child+set_owner 这类操作的 undo 要么静默不回滚、要么编辑器刷红字错误。场景树与 undo 栈不一致，最终需手动修复 .tscn。影响面最广 —— node_commands / scene_commands / particle / nav / ui 全族
- **修复**：
  1. `_add_method` 顶部加 `if not is_instance_valid(target): push_warning(...); return`
  2. 所有走 `add_child` 的 do op 必须 `add_do_reference(新Node)` + undo 侧也加（已有但需审查每个调用点）
  3. `create_action` / `create_action_with_props` 废弃或内部转调 `create_action_mixed`，强制 reference 配对
- **验证**：写单测 —— `add_node` 后立即 `queue_free` 该节点再触发 undo，断言不报错且回滚行为符合预期（保留或显式拒绝）；`scene_commands.handle_instance_scene` 录制→Undo→Redo 100 次循环，断言无内存增长无错误日志

### [P0] 2. nav_create_region 在 commit_action 之后修改节点，undo 完全漏掉 NavigationMesh

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\nav_commands.gd:34-56`
- **问题**：代码顺序为：先 `create_action_mixed`（含 add_child/set_owner/reference，`:35-44`）→ **commit_action 在此处立即执行 do 分支** → 然后 `:49-51` `var mesh = NavigationMesh.new(); mesh.geometry_parsed_collision_mask = 0xFFFFFFFF; nav.navigation_mesh = mesh` → `:54-56` `bake_navigation_mesh()`。这些后置修改**全部不进 undo 栈**
- **后果**：Undo 只 `remove_child`，但 NavigationMesh 资源和烘焙数据在 undo 时随节点 detach 丢失；Redo 时节点回来却没有 mesh。对烘焙（耗时操作）尤其浪费。更糟的是 `mesh` 是局部变量未持有引用，存在被 GC 后 `navigation_mesh` 变 null 的风险（Godot Resource 弱引用语义）
- **修复**：把 mesh 创建、`set_navigation_mesh`、bake 全部放进 do_ops（用 method op 调 `set_navigation_mesh`），undo 用对应清除/恢复。或至少把 `:49-56` 移到 `create_action_mixed` 之前作为"初始化"，再让 add_child 把带 mesh 的节点整体入栈
- **验证**：录制 nav_create_region(bake=true)→Undo→Redo，断言 `nav.navigation_mesh != null` 且 `geometry_parsed_collision_mask == 0xFFFFFFFF`

### [P0] 3. particle_commands 四个 setter 完全绕过 undo_manager（"偷偷修改"）

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\particle_commands.gd:60-222`（涉及 `handle_particles_set_emission` `:60` / `handle_particles_set_process` `:115` / `handle_particles_load_preset` `:160` / `handle_particles_set_material` `:207`）
- **问题**：四个工具**全程不调用 `_undo_manager`**，直接 `node.amount = ...`、`node.process_material = mat`、`mat.spread = ...`。模块 `_undo_manager` 字段虽在 setup（`:6-8`）注入，但**从未在任何 setter 里使用**
- **具体表现**：
  - `set_emission`（`:72-97`）：改 amount / emission_shape / direction / spread 无 undo 记录
  - `set_process`（`:128-156`）：改 gravity / speed_scale / explosiveness / randomness / lifetime / damping 无 undo
  - `load_preset`（`:184-203`）：一次性改 6+ 个属性无 undo
  - `set_material`（`:219-220`）：每次 `ParticleProcessMaterial.new()` 覆盖旧材质，**旧材质直接丢失，Undo 也无救**
- **后果**：所有粒子参数变更无法 Undo。配合 P0-2，整个 particles + nav 工具族的写操作大多是"半截子 undo"或"零 undo"，与 `undo_manager.gd` 注释声称的"原子入栈"完全不符
- **修复**：每个 setter 用 `create_action_mixed` 记录 do（设新值）+ undo（先 `target.get(prop)` 捕获旧值并恢复），与 `animation_commands` 的 keyframe update（`:208-227`）模式一致。`set_material` 需额外捕获旧 `process_material` 引用用于 undo
- **验证**：对每个 setter 录制→Undo，断言节点属性回到原值；`set_material` 连续调用 3 次后 Undo 3 次，断言回到初始材质

### [P0] 4. recording_commands._input / parse_input_event 在 @tool 编辑器插件里全局捕获并重放，可触发自动保存等副作用

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\recording_commands.gd:20-73`（`_input`）、`:198-245`（`_fire_playback_event` + `Input.parse_input_event`）
- **问题**：节点挂在 `command_handler → websocket_server → plugin` 下，整个链路是 @tool 编辑器插件。`_input`（`:20`）在编辑器运行时**全程激活**，仅靠 `_recording` 布尔门控。一旦 `handle_recording_start`（`:86`）被任何已认证 peer 调用，`_input` 开始拦截**编辑器自身的所有键盘/鼠标/触摸事件**
  1. `_input` 而非 `_UnhandledInput` —— 它会**抢占**编辑器快捷键（Ctrl+S、Ctrl+Z、Delete 等）的事件流。虽然 InputEventKey 仍会冒泡，但回放 `Input.parse_input_event`（`:210`/`:218`/`:224`）会**重新注入**这些事件，可能触发编辑器的 Save Scene / Undo / 删除选中节点等危险操作
  2. 回放 `Input.parse_input_event` 在编辑器上下文等于模拟用户按键，**无法限定目标窗口**，会作用到当前焦点控件
  3. 录制时编辑器实际快捷键被吃进 `_recorded_events`，回放时再触发，形成"幽灵操作"
- **后果**：录制回放期间编辑器可能被"幽灵操作" —— 回放含 Ctrl+S 的事件会真实保存场景；含 Delete 会删除选中节点。这是 @tool 生命周期副作用的直接命中，可能造成数据丢失
- **修复**：
  1. `_input` 顶部加 `if Engine.is_editor_hint(): return` 保护（插件在编辑器内运行时拒绝捕获）
  2. 改用 `_UnhandledInput` + `set_input_as_handled()` 仅消费未处理事件
  3. 回放改用 `Input.call_deferred("parse_input_event", ie)`，并在回放前后用 `Engine.is_editor_hint()` 门控，编辑器非播放态时拒绝回放
  4. 录制/回放前明确告警用户切换焦点到游戏运行视口
- **验证**：录制含 Ctrl+S 的事件序列 → 在编辑器打开脏场景 → 回放 → 断言场景文件 mtime 不变（未被自动保存）

---

## 二、P1（尽快修复）

### [P1] 5. websocket_server._process / _exit_tree 的 _server 生命周期与 peer 清理顺序

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:194-238, 392-402`
- **问题**：
  1. `:195` `if not _server: return` 保护了 server，但 `_exit_tree`（`:392-402`）先 `set_process(false)` 再 `_server.stop()` 再 `for peer in _peers: peer.close()`，**没有把 `_server` 置 null**。若 `_exit_tree` 后还有残留的 deferred `_process` 调用（Godot 在同帧内可能再调一次），`:197` `_server.is_connection_available()` 会对已 stop 的 TCPServer 调用 —— 不致命但会刷错误日志
  2. `:229-237` 删除 peer 用 `to_remove` 倒序遍历，但 `peer.close()`（`:226` STATE_CLOSED 分支）是异步的 —— 本帧 close 后 `get_ready_state()` 可能仍返回 CLOSING，导致同一 peer 跨多帧重复进入 `to_remove`。虽然 `remove_at` 后索引错位被倒序规避，但 `_heartbeat.remove_peer(rid)` + `_authenticated_peers.erase(rid)` 在 peer 已被移除后再次 erase（幂等，无错）
- **后果**：插件卸载/重载时偶发错误日志噪声；极端情况下 peer 在 CLOSING 态被重复处理，`_auth_fail_count` 等字典清理不彻底（虽有 erase，但 `:226` 的 STATE_CLOSED 判定时机依赖 poll 结果）
- **修复**：
  1. `_exit_tree` 末尾 `_server = null`
  2. `_process` 顶部改为 `if not _server or not is_instance_valid(_server): return`
  3. 删除 peer 前显式判 `not is_instance_valid(peer)`
- **验证**：在 `_exit_tree` 后手动再触发一次 `_process`（deferred），断言无错误日志；模拟 peer CLOSING→CLOSED 转换，断言只清理一次

### [P1] 6. sync_commands 信号连接到 SceneTree 全局信号，cleanup 失败时信号泄漏

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\sync_commands.gd:39-41, 47-55, 77-108, 111-113`
- **问题**：
  1. `start_sync`（`:39-41`）把 `_on_node_added`/`_on_node_removed` 连到 `tree.node_added`/`node_removed`（**全局 SceneTree 信号，每次任何节点增删都触发**）。`stop_sync`（`:50-52`）有 `is_connected` 守卫做断开。但 `cleanup`（`:111`）只在 `_syncing` 为真时调 `stop_sync`，而 `_syncing` 在 `start_sync` 成功后才置 true（`:36`）。竞态：若 `start_sync` 中 `connect`（`:39`）成功但 `_syncing` 因异常未置 true，则 cleanup 不调 stop_sync → **信号永久泄漏**
  2. `_on_node_added`/`_on_node_removed`（`:77-108`）每次编辑器场景树任何变动都触发，且内部调 `CommandHelpers.get_edited_scene_root` + `send_notification`（广播 JSON-RPC）。高频编辑时这俩回调成为性能热点
  3. `_on_node_removed`（`:81`）调 `node.get_path()` —— 在 Godot 4.x node_removed 信号在节点 detach 前 emit，但依赖版本；若节点已不在树中，`get_path()` 行为未定义
- **后果**：信号泄漏导致插件卸载后仍回调已 free 的 `_command_handler`，push error；高频编辑时 UI 卡顿
- **修复**：
  1. `start_sync` 用 try/finally 或先 connect 再置 `_syncing=true`
  2. `cleanup` 无条件 `if tree.node_added.is_connected(...): disconnect`
  3. `_on_node_removed` 里 `node.get_path()` 前判 `is_instance_valid(node) and node.is_inside_tree()`
- **验证**：`start_sync`→模拟 connect 抛错→`cleanup`→断言信号已断开；高频 add/remove 1000 节点测延迟

### [P1] 7. heartbeat pause/resume 状态机在 cancel + timeout 竞态下 _operation_peer_id 错乱

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\heartbeat.gd:30-37, 58-75`；`websocket_server.gd:351-367`
- **问题**：`tick`（`:30-37`）在 `_is_paused` 时累计 `_operation_timer`，超 `_operation_timeout` 后 emit `timeout_detected` 并清 `_operation_peer_id`（`:33-37`）。`cancel_current_operation`（`websocket_server.gd:363-367`）调 `resume()` 后，`_is_paused=false`、`_operation_peer_id=-1`
  - 竞态窗口：tick 已经 emit 了 timeout（`:37`），**同一帧或下一帧**客户端发来 `operation_end` → `resume()`，此时 `_is_paused` 已被 tick 自己置 false（`:34`），resume 再置一次 false（幂等），但 `resume` 的 `:68-74` 会重置 `_operation_peer_id` 的活动计时 —— 而该 peer 可能已被 `_on_heartbeat_timeout`（`websocket_server:351-361`）close 掉了
  - `_peer_activity[pid]` 残留：timeout 后 peer 被 close，但 `_peer_activity[pid]` 条目仍在，`tick` 里 `:44-46` 对已关闭 peer 继续累计 activity/ping，`:54` `peer.get_ready_state() == STATE_OPEN` 返回 false 不发 ping（无害但浪费 CPU）。最终会经 `websocket_server.gd:226` STATE_CLOSED 路径清理，但存在窗口期
- **后果**：操作超时后 peer 被 close，但 `_peer_activity` 字典对已断开 peer 短期内永不清理；多次 cancel + timeout 交替时 `_operation_peer_id` 状态错乱
- **修复**：
  1. `_on_heartbeat_timeout`（`websocket_server:351-361`）里 close peer 后立即 `_heartbeat.remove_peer(pid)`（已有 `remove_peer` API，`heartbeat.gd:26-28`）
  2. `resume` 时校验 `_operation_peer_id` 对应 peer 仍 OPEN
- **验证**：构造超时场景，断言 timeout 后 `_peer_activity` 不含该 pid；cancel + timeout 交替 10 次，断言无状态泄漏

### [P1] 8. animation_commands remove track 的 undo 用绝对索引，redo 第二次删错轨道

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\animation_commands.gd:80-108`
- **问题**：`remove` 分支捕获旧 track 数据后，undo_ops 里 `:98` `var new_idx: int = anim.get_track_count() - 1`。这个 `new_idx` 是在 **do（remove_track）执行前**计算的 —— 即当前 track 数 N，remove 后变 N-1，add_track 追加到 N-1，索引正确。但这是**首次 undo 时的快照**。UndoRedo 的语义是：do 提交时存当前状态用于 undo，**undo 执行后再 redo 时，do_ops 重新执行**。redo 第二次时，`remove_track(ti)` 的 `ti` 是首次执行时记录的索引，但若期间用户手动增删了 track，`ti` 已失效 —— `remove_track(ti)` 删错轨道
- **后果**：用户 Undo → 手动编辑动画 → Redo，删错轨道，动画数据损坏
- **修复**：用 track 的 NodePath 而非索引定位（按 path 匹配重建索引），或在 do/undo 里加越界 + path 一致性校验，发现不一致时 push error 并放弃本次 redo
- **验证**：add track A → add track B → remove B → Undo → 手动 add track C → Redo remove B，断言删的是 B 不是 C

### [P1] 9. editor_guards 对 .gd 脚本守卫依赖 script_editor.get_open_scripts，未打开过的脚本守卫失效

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\editor_guards.gd:99-136`（与 TS 侧 ReadOnlyGuard 对齐性问题）
- **问题**：`guard_text_resource_write` 对 `.gd` 脚本走 `:120-135` 分支，遍历 `script_editor.get_open_scripts()`（返回已打开的 Script Resource）。但：
  1. 若脚本**从未在编辑器打开过**（TS 侧用 FileAccess 直接写新文件），`get_open_scripts()` 返回空，守卫直接放行 —— 此时若该脚本已被 `preload`/`load` 进某节点，TS 写入会与内存中的 stale Resource 冲突
  2. 着色器走 `:109-118` `ResourceLoader.has_cached(target)`，逻辑正确但**仅检查缓存，不检查磁盘上的打开状态**（shader editor 无等价 get_open_scripts API，这是已知限制，但守卫名 `guard_text_resource_write` 暗示全覆盖，误导调用方）
  3. **与 TS 侧对齐**：审查清单第 2 条要求"GDScript 侧二次防线与 TS 侧 ReadOnlyGuard 对齐"。当前 TS 侧若用文件 mtime 或 inode 判断，与本处的 Resource 缓存判断**口径不一致** —— 同一文件 TS 拒绝、GDScript 放行，或反之
- **后果**：脚本/着色器在"已加载但未在编辑器打开"状态下被 TS 覆盖，编辑器内 Script 资源仍持旧字节码，运行时用旧逻辑、磁盘是新逻辑，调试噩梦
- **修复**：
  1. 对 `.gd` 额外检查 `ResourceLoader.has_cached(target)`（与 shader 对称）
  2. 在本文件注释明确"未打开过的脚本守卫不覆盖"，让 TS 侧承担首写责任
  3. 与 TS 侧 ReadOnlyGuard 做一次对齐 review，统一判断口径（缓存 vs 打开 vs mtime）
- **验证**：`preload` 一个脚本 → 不打开 → 调 `guard_text_resource_write`，断言返回 error 而非放行

### [P1] 10. websocket_server._handle_message 同步执行 command_handler.handle，慢命令阻塞所有 peer 心跳

- **位置**：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:240-329`（`:319` 同步调用）
- **问题**：`_handle_message` 在 `_process`（`:194`）内**同步**调用 `_command_handler.handle`（`:319`）。`_process` 是主线程每帧入口，若 `handle` 执行耗时长（`nav_bake_mesh` 烘焙、`export`、大量节点 add），整帧被阻塞。期间：
  1. `peer.poll()`（`:216`）对其他 peer 不执行 → 其他 peer 的心跳 `tick`（`:219`）不推进 → **其他连接被这条慢请求饿死**，可能触发 `:48` `INACTIVITY_TIMEOUT` 误断
  2. 编辑器 UI 冻结，用户感知卡死
  3. `_pkt_count < 50`（`:221`）的限制只防同一 peer 包洪水，不防单包处理耗时
  - 虽然有 `operation_start`（`:289`）的 `pause_for_operation` 暂停心跳，但**那是客户端主动调用的协议**，单个恶意/失控请求（如 nav bake）若不包裹 operation_start/operation_end，直接阻塞
- **后果**：一个烘焙请求让所有客户端超时断开；编辑器假死
- **修复**：
  1. 长操作（bake、export、批量 add）用 `call_deferred` 或拆帧
  2. 或在 `handle` 顶部对已知慢方法强制要求 operation_start 前置（否则返回 error）
  3. 短期至少在 `nav_bake_mesh` 前后 emit operation_active
- **验证**：连两个 peer → peer A 发 `nav_bake` 大场景 → 断言 peer B 心跳不超时（或在合理时间内）

---

## 三、未单列但值得关注的次要问题（P2，不计入 10 条）

- `plugin.gd:18-29` `_exit_tree` 对 `websocket_server` 的 cleanup 通过 `get_node_or_null("command_handler")` 按名字查找（依赖 `websocket_server.gd:45` 显式设 `.name`，已有注释说明，脆弱但可接受）
- `command_handler.gd:71-81` `cleanup` 遍历 modules 调 `queue_free`，但 modules 之间的引用（如 `_scene_commands._undo_manager`）不会立即置 null，存在跨帧访问已 free 节点的小窗口
- `status_panel.gd:9-17` `_ready` 里 `Label.new()` / `Button.new()` 动态创建子节点，与 `status_panel.tscn` 的静态节点定义并存 —— 实际运行时面板有 2 个动态子节点，tscn 里没有任何子节点定义，重构时易混淆
- `heartbeat.gd:17-23` `reset_activity(peer_id=-1)` 默认参数 -1 作为"全部 peer"哨兵，若真实 peer_id 恰为 -1（理论不可能，instance_id > 0）会冲突，建议用单独方法 `reset_all_activity()`

---

## 四、修复优先级建议

1. **P0-1 + P0-3 一起修**（undo 栈系统性问题）：先给 `undo_manager._add_method` 加 `is_instance_valid` 守卫，再补全 `particle_commands` 四个 setter 的 undo 调用。这两个是同一类问题的不同表现
2. **P0-4 单独修**（输入副作用）：安全/数据安全风险，可在 P0-1/3 之前修。最低成本是 `_input` 顶部加 `if Engine.is_editor_hint(): return`
3. **P0-2 随 P0-1 一起**：nav_create_region 的 commit 后修改是模式问题，修 P0-1 时顺手规范
4. **P1 批次**：P1-6（信号泄漏）和 P1-5（_server 生命周期）是插件卸载可靠性，可作为一个"插件生命周期加固"批次；P1-8/P1-9/P1-10 可作为"undo 一致性 + 守卫对齐 + 并发"批次

所有修复均建议配套单测：animation/nav 可用临时场景跑 headless 断言 undo/redo 一致性；recording 可用 `Engine.is_editor_hint()` mock 验证门控；websocket 并发可用多 peer 模拟。


---

## 五、核实修订记录（2026-07-06 源码逐条复核）

**已修（4.7 编译 errors=0）**:
- P0-1 真缺陷（undo_manager._add_method:47 仅 target==null 挡不住 freed 对象）→ _add_method + _apply_op property + reference 三处加 is_instance_valid 守卫
- P0-2 真缺陷（nav_commands.gd:49-56 mesh/bake 在 create_action_mixed 返回后不入栈）→ mesh 初始化移到 commit 前（附着 nav，随 reference 保护）
- P0-4 真缺陷（recording_commands.gd:20 _input 非 _unhandled_input + 回放 Input.parse_input_event 重注入编辑器）→ _input/handle_recording_start/handle_recording_play 三处加 Engine.is_editor_hint() 守卫，编辑器录制禁用走 Bridge

**Push back（描述夸大或成本/价值不划算）**:
- P0-3 核心成立（4 setter 无 undo）但**描述夸大**：称"全程不调用 _undo_manager，字段从未使用"——实际 handle_particles_create:43-53 用了 create_action_mixed。准确说法是"4 个 setter 不调用"。登记 defect 暂不修（需重写 4 setter + 改路由签名加 request_id，成本高/particle 次要）
- P1-8 真缺陷（animation_commands.gd:98 new_idx + remove_track(ti) redo 索引失效）登记 defect（根治需扩展 undo_manager 支持 path-based op，触发苛刻）

**与其他报告重叠（已在 security-reliability / ipc-reliability 修复）**:
- P1-7（heartbeat pause/resume 竞态）= security-reliability P1#1，已修（heartbeat.gd tick/pause/resume per-peer 化）
- P1-10（慢命令阻塞所有 peer 心跳）= ipc-reliability P1-5，登记 defect（需 GDScript command_handler 异步化）

**登记 defect（基于报告，未深入核实）**: P1-5（_server 生命周期）、P1-6（sync_commands 信号泄漏）、P1-9（editor_guards 未打开脚本）。
