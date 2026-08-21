---
description: "editor websocket editor_sync_start editor_sync_stop editor_get_scene_tree launch_editor 编辑器 场景树同步 undo plugin addons godot_mcp_server"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced v0.17.0+

## 概述与架构

Editor 模式通过 WebSocket JSON-RPC 2.0 连接 Godot 编辑器内的 GDScript 插件，实时操作当前打开的场景。

- **插件位置**：`addons/godot_mcp_server/`（需安装在目标项目中）
- **连接机制**：launch_editor 启动编辑器后，服务端自动检测 WebSocket 连接（端口 9090，被占自动递增至 9094）
- **回退策略**：无编辑器连接时自动回退到 Headless 模式；设置 `GODOT_MCP_NO_FALLBACK=true` 禁止回退

## 工具清单与对比

### Editor 独有工具

| 工具 | 说明 |
|------|------|
| `editor_sync_start` | 启动场景树实时监听，推送 node_added/node_removed 事件 |
| `editor_sync_stop` | 停止场景树监听 |
| `editor_get_scene_tree` | 获取编辑器当前场景树完整快照 |

### 仅 Headless 可用

| 工具 | 原因 |
|------|------|
| `execute_gdscript` | 独立进程执行，不适合编辑器环境 |
| `query_scene_tree` | Headless 专用，用 editor_get_scene_tree 替代 |
| `inspect_node` | Headless 专用 |

### 行为差异

| 工具 | Headless | Editor |
|------|----------|--------|
| `add_node` | 需指定 scene_path，创建后需 save_scene | 操作当前打开场景，实时刷新 |
| `edit_node` | 需指定 scene_path | 操作当前场景中的节点 |
| `remove_node` | 需确认令牌 | 需确认令牌 + 支持 undo |
| 其他工具 | 自动路由到 headless 执行 | 未知工具名自动 forward 到插件 |

## 使用指南

### 连接流程

1. 确认目标项目已安装 `addons/godot_mcp_server/` 插件
2. 调用 `launch_editor(project_path)` 启动编辑器
3. 服务端自动检测 WebSocket 连接（最长等待约 10 秒）
4. 连接成功后，工具调用自动路由到编辑器

### 场景树同步

- `editor_sync_start` 连接 SceneTree 的 node_added/node_removed 信号
- 事件通过 EditorToolExecutor 缓冲（最大 10000 条），超出时丢弃最旧记录
- 编辑器断开重连后，同步自动恢复
- `editor_get_scene_tree` 获取当前快照（不依赖 sync 状态）

## 调用示例

### 启动编辑器并同步场景树

```
// 1. 启动编辑器
launch_editor(project_path="D:/projects/my-game")

// 2. 启动场景树监听
editor_sync_start(project_path="D:/projects/my-game")
// → 返回: { status: "ok", message: "Scene tree sync started" }

// 3. 获取当前场景树
editor_get_scene_tree(project_path="D:/projects/my-game")
// → 返回: { nodes: [...], root: "Node3D", child_count: 15 }
```

### 错误：编辑器未安装插件

```
editor_sync_start(project_path="D:/projects/my-game")
// → 返回: {
//     error: "EDITOR_NOT_CONNECTED",
//     message: "These tools require editor mode with plugin connection.
//               Use headless query_scene_tree as alternative."
//   }
// 解决：在 Godot 编辑器中安装 addons/godot_mcp_server/ 插件并重启编辑器
```

## 常见陷阱

- **插件未安装**：editor_sync 工具返回 EDITOR_NOT_CONNECTED。需要手动安装插件到项目。
- **编辑器启动慢**：大型项目首次启动可能超过 10 秒。可分两步操作：先 launch_editor，等几秒后再 sync。
- **forward 机制**：未明确处理的工具名会自动转发到编辑器插件，可能产生意外行为。
- **断开重连**：编辑器崩溃或关闭后，sync 状态自动清理。需要重新 launch_editor。
- **launch_editor 崩溃恢复（2026-08-07 审查 P2 文档化）**：launch_editor 是 fire-and-forget（detached + unref），不跟踪编辑器生命周期。编辑器崩溃后：① WS 断开 → EditorConnection 自动重连（20 次指数退避）；② 重连耗尽 → reconnectExhausted handler → handleEditorStall 降级 headless（用户可用 headless 工作）；③ 非 PERSISTENT_SECRET 模式下崩溃即删 secret，rebuildEditorConnection 需 secret 文件 → rebuild 失败需手动重新 launch_editor 或重启 MCP server。**用户预期管理**：系统不会自动重启崩溃的编辑器，需手动 launch_editor 或重启 server。心跳降级走 B-T5 分流（REQUEST_TIMEOUT 主线程卡死 → 降级；NOT_CONNECTED/CONNECTION_LOST 下线 → 让自动重连兜底不降级）。
- **端口冲突**：默认端口 9090（`BASE_PORT`），被占自动递增至 9094；MCP 端默认连 9090，多实例场景可用 `GODOT_EDITOR_PORT` 指定。
- **editor 插件 4.7 Vector 类兼容**：早期记忆称 4.7 编译失败（Vector.from_string 等 4.6 API 移除），但 master 已迁移（Vector→`_count_number_components`，`Color.from_string` 4.7 保留），headless 工具 4.7 正常。**但 `godot --check-only <file>` 是假绿**：该用法只打 banner 不触发编译（4.7+4.6.2 实测），2026-06-26 据此称"6 文件全编译通过"不可信。addon 全量编译验证应用 `godot --headless --import --path test/fixtures/gdscript-check`（启用 plugin + 建全局类 class_name 缓存）。
- **原生类虚函数禁 super()（2026-07-04 修复 654b162 回归）**：`super()`（无方法名）对 Godot 原生类（EditorPlugin/Node/VBoxContainer）虚函数（`_ready`/`_process`/`_enter_tree`/`_exit_tree`，**含 `_init`**）一律是 **Parse Error**："Cannot call the parent class' virtual function ... hasn't been defined"，**4.6.2+ 均报（非 4.7 特有）**。调父类实现用 `super._method()`（带方法名）显式形式。IMP-4 "虚函数首行调 super" **仅适用 extends 自定义基类**（见 CHANGELOG `mcp_bridge.gd` 移除 super 先例 + `docs/review-followup-2026-06-18.md:93`）。654b162（v0.19.0）误加 6 处 super() 致 addon 加载失败/9090 不监听；2026-07-04 移除（plugin/websocket_server/status_panel），4.7+4.6.2 `--import` 实测全量编译通过。
- **editor 模式 WebSocket 端口 9090-9094（非 13100）**：`addons/godot_mcp_server/websocket_server.gd:3` `BASE_PORT=9090`。`editor_get_scene_tree` 返回 `EDITOR_NOT_CONNECTED` 通常是**端口/key/未就绪**问题（非编译）：需 `mcp_editor.key` icacls 权限 + 等 editor GUI 就绪（插件 WebSocket 监听 9090）+ MCP 端连对端口。详见 [[godot-editor-plugin-e2e-verification]]。
- **editor 路由操作活动场景（2026-07-20）**：`add_node`/`edit_node`/`batch_add_nodes`/`remove_node` 的 editor 路由（editor-method-map 登记后 editor 连接时走 `handle_*`）操作**编辑器活动场景**（`ei.get_edited_scene_root()`），`scene_path` 参数仅 headless 生效。editor 模式操作非活动场景须先 `open_scene` 切换活动场景。editor/headless 语义差异：headless 按 scene_path 加载磁盘场景改盘，editor 改内存活动场景（不落盘，须 save_scene 持久化）。
- **headless 改盘 + editor 开同场景→Ctrl+S 覆盖（2026-07-20）**：headless 改盘后，**若编辑器开着同一场景**，编辑器内存的旧版本 Ctrl+S 会覆盖 MCP 改动——须 Project→Reload 场景（或 File→Close Scene）后再操作。`checkEditorSceneSave` 守卫只防 MCP→editor 脏方向；反向（editor→MCP，用户手动 Ctrl+S）是引擎行为，MCP 端不可控。headless 改盘后建议关闭编辑器内该场景或 Reload。
- **editor 固定 secret（S4-editor）**：设环境变量 `GODOT_MCP_EDITOR_PERSISTENT_SECRET=true`，editor plugin 复用现有 `mcp_editor.key`（不重生、不收紧 ACL、`_exit_tree` 不删除），彻底消除 `_ready` 覆盖写需求及 MCP 端 TTL 缓存同步窗口。仅本地测试用（安全降级——secret 固定不再轮换，生产保持默认 false）。对称 bridge `GODOT_MCP_BRIDGE_PERSISTENT_SECRET`（见 godot-mcp-bridge.md「密钥权限循环」）。
- **mcp_editor.key 多实例互删（2026-07-23 修复）**：editor 启动写 `{project}/.godot/mcp_editor.key`，`_exit_tree` 默认删除。多个 editor 实例（或禁用→启用插件）共享同一路径时，**历史版本任一实例退出会误删仍存活实例的 key**（现象：editor 日志称 `Auth secret written` 但文件找不到；存活实例内存 `_secret` 仍有效、9090 仍 LISTEN，TS 端 TTL 缓存 5min 过期后重连连不上）。**已修复**：`websocket_server.gd:_delete_secret_file` 删前 `FileAccess.get_file_as_string` 校验 `on_disk == _secret`，只清自己生成的 key（读失败也不删，安全侧）。仍遇此问题（旧 addon 副本/未重启 editor）：设 `GODOT_MCP_EDITOR_PERSISTENT_SECRET=true` 重启 editor（见上条 S4-editor）。
