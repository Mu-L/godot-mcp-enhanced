---
description: "game bridge game_query game_input game_write game_wait game_bridge_install game_bridge_uninstall 运行时 TCP 密钥认证 端口 9081 autoload mcp_bridge E2E 测试 调试"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced v0.17.0+

## 概述与架构

Game Bridge 是 MCP 服务端与**运行中的游戏**之间的 TCP 通信层。

- **三层区别**：Headless（独立 Godot 进程）vs Editor（连接 IDE）vs Bridge（连接运行时游戏）
- **通信方式**：MCP 服务端 → TCP JSON-RPC 2.0 → 游戏内 mcp_bridge.gd autoload
- **使用场景**：E2E 测试、运行时调试、输入模拟、状态验证、截图验证
- **前提**：游戏必须正在运行（F5 或 run_project），且已安装 Bridge autoload

## 工具清单

### 安装管理

| 工具 | 说明 |
|------|------|
| `game_bridge_install` | 安装 Bridge autoload 到项目（注册 autoload + 配置端口 9081） |
| `game_bridge_uninstall` | 卸载 Bridge autoload |

### 查询 — game_query

| method | 说明 |
|--------|------|
| `ping` | 检查游戏是否运行 |
| `get_tree` | 获取场景树结构 |
| `find_nodes` | 按名称/类型/路径查找节点 |
| `get_node_properties` | 获取节点属性值 |
| `get_node_layout` | 获取节点完整布局快照（type + position/global_position 成对 + Control anchor/offset + Sprite2D centered + Node3D Vector3，全走 _jsonify） |
| `get_performance` | 获取性能统计（FPS/内存等） |
| `get_viewport_info` | 获取视口信息 |
| `take_screenshot` | 从运行中的游戏截图 |
| `get_errors` | 查询游戏运行时错误（push_error/脚本报错/引擎错误），支持 `since_seq` 增量 + `clear` 读即焚 |
| `clear_errors` | 清空错误 buffer |

### 输入 — game_input

| method | 说明 |
|--------|------|
| `send_key` | 发送键盘事件（key + pressed） |
| `send_mouse_click` | 发送鼠标点击（x, y, button, pressed） |
| `send_mouse_move` | 移动鼠标（x, y） |
| `send_text` | 输入文本（text） |
| `send_input_sequence` | H1(2026-08-20) 帧定时输入时间线（timeline=[{at_frame:1-600 开窗后第N帧, type:"action"/"key"/"mouse_click"/"mouse_move"/"touch"/"drag", ...事件参数}], settle_frames, wall_budget_ms）。延迟响应;owner 互斥同 control 层;frozen 下自动开窗播放+完成 refreeze;与 playtest.seed/fixed_delta 组合=确定性完全体。action 事件需 name 在项目 InputMap |

### 写入 — game_write

| method | 说明 |
|--------|------|
| `set_node_property` | 设置节点属性值（path + property + value） |
| `call_method` | 调用节点方法（path + method + args）。CMP-9-B(2026-08-08)增强:默认只读白名单(get/has_*/get_meta 等),env `GODOT_MCP_BRIDGE_EXTRA_METHODS=method1,method2` 可扩展(含写方法如 take_damage);`EXTRA_METHODS_BLOCKLIST`(free/queue_free/set_script/call/emit_signal 等)是不可覆盖硬底线;args 按方法声明类型自动强转(传 [1,2,3] 给 Vector3 参数正确转换);方法不存在时返回 did-you-mean 建议;response 含 undoable=false(call 不可 undo) |

### 等待 — game_wait

| method | 说明 |
|--------|------|
| `wait_for_node` | 等待节点出现（path） |
| `wait_for_property` | 等待属性值变化（path + property + value） |

### 监控 — monitor_start/stop/poll

| action | 说明 |
|--------|------|
| `monitor_start` | 开始属性采样（node_path + properties + interval_frames） |
| `monitor_stop` | 停止采样，返回完整时间线 |
| `monitor_poll` | 获取当前采样数据（不停止） |

### 信号监听 — watch_start/stop/poll

| action | 说明 |
|--------|------|
| `watch_start` | 监听信号事件（node_path + signal_name + max_events） |
| `watch_stop` | 停止监听，返回事件列表 |
| `watch_poll` | 获取已记录事件（不停止） |

### UI 发现 — find_ui_elements / click_button

| action | 说明 |
|--------|------|
| `find_ui_elements` | 查找可见 Control 节点（pattern / type / visible_only / limit） |
| `click_button` | 点击按钮（text 或 path） |

### 工具组管理 — manage_tools

| action | 说明 |
|--------|------|
| `list_groups` | 列出所有工具组及其启用/停用状态 |
| `activate` | 启用指定工具组（按名称） |
| `deactivate` | 停用指定工具组（按名称） |
| `sync` | 返回各工具组的 `requires` 连接状态（editor/bridge/headless） |
| `reconnect` | 触发 EditorConnection 重新连接（bridge 无持久连接，no-op） |

**行为说明**：
- `reconnect` 仅影响 Editor WebSocket 连接（端口 9090-9094）。Bridge 为持久 TCP 连接（30s keepalive、断线自动重连并重发订阅），无显式重连语义，故 no-op。
- `sync` 返回结构：`{ groups: [{ name, requires, status }, ...], editor: { installed, connected, state }, bridge: { note } }`。其中 **status**:editor 组 = `connected`/`disconnected`(基于 editor 连接);bridge 组 = `probe-required`(用 `game_query(method=ping)` 探测);无 requires 组(core/animation/ui 等)= `n/a`。**editor.state**:连上时用 healthMonitor(工具调用健康),未连报 `disconnected`,未启动报 `null`。**editor.installed** = editorConn 是否注入(launch_editor 后 true)。

## 使用指南

### 安装流程

1. 调用 `game_bridge_install(project_path)` — 注册 autoload、配置端口 9081
2. 在 Godot 中运行项目（F5 或 `run_project`）
3. 游戏启动后 Bridge 自动监听 TCP 连接
4. 使用 `game_query(method="ping")` 验证连接

### 安全机制

- **密钥认证**：安装时生成随机密钥文件，每次 TCP 连接需认证
- **本地绑定**：TCP 仅监听 127.0.0.1，不暴露到网络
- **密钥生命周期**：读取后缓存 5 分钟（TTL），文件权限收紧（0600/icacls）
- **防符号链接**：密钥文件若是 symlink 则拒绝读取

### 与 dev_loop 集成

dev_loop 的 `bridge` 参数可在执行 GDScript 后自动进行 Bridge 查询：

```json
{
  "bridge": {
    "screenshot": { "path": "user://test.png" },
    "queries": [
      { "method": "ping", "expect": "ok" },
      { "method": "find_nodes", "params": { "pattern": "Player" } }
    ]
  }
}
```

## 调用示例

### 检查游戏运行状态

```
game_query(method="ping")
// → { status: "ok", message: "Bridge connected" }

game_query(method="get_tree")
// → { root: "Node3D", child_count: 15 }

game_query(method="find_nodes", params={ "pattern": "Player" })
// → { nodes: [{ path: "/root/Player", type: "CharacterBody3D" }] }
```

### 模拟输入并等待

```
game_input(method="send_mouse_click", params={ "x": 640, "y": 360, "button": "left", "pressed": true })
game_input(method="send_mouse_click", params={ "x": 640, "y": 360, "button": "left", "pressed": false })
game_wait(method="wait_for_node", params={ "path": "/root/CanvasLayer/Dialog" })
game_query(method="get_node_properties", params={ "path": "/root/CanvasLayer/Dialog", "properties": ["visible"] })
// → { visible: true }
```

### 修改运行时状态

```
game_write(method="set_node_property", params={ "path": "/root/Player", "property": "position", "value": { "x": 10, "y": 0, "z": 5 } })
game_write(method="call_method", params={ "path": "/root/Player", "method": "take_damage", "args": [25] })
```

### 属性监控

```
game(action="monitor_start", node_path="/root/Player", properties=["position", "health"], interval_frames=5)
// → { monitoring: true, node_path: "/root/Player", properties: [...], interval_frames: 5 }

game(action="monitor_poll")
// → { monitoring: true, samples: [{frame: 100, time: 1.667, values: {position: {x:10,y:0}}}], sample_count: 1 }

game(action="monitor_stop")
// → { monitoring: false, samples: [...], sample_count: 30, duration_seconds: 2.5 }
```

### 信号监听

```
game(action="watch_start", node_path="/root/Button", signal_name="pressed", max_events=100)
// → { watching: true, node_path: "/root/Button", signal_name: "pressed", max_events: 100 }

game(action="watch_poll")
// → { watching: true, events: [{frame: 150, time: 2.5, args: []}], event_count: 1 }

game(action="watch_stop")
// → { watching: false, events: [...], event_count: 5, duration_seconds: 8.2 }
```

### UI 元素发现

```
game(action="find_ui_elements", type="Button", visible_only=true)
// → { elements: [{path: "/root/Menu/StartBtn", type: "Button", text: "Start", ...}], count: 3 }

game(action="click_button", text="Start")
// → { clicked: true, button_path: "/root/Menu/StartBtn", button_text: "Start" }
```

### 错误：Bridge 未连接

```
game_query(method="ping")
// → 超时或错误: "Bridge not connected"
// 解决：1. 确认已运行 game_bridge_install
//       2. 确认游戏正在运行（F5 或 run_project）
//       3. 检查项目 .godot/ 目录下是否有 mcp_bridge_9081.secret 文件
```

## 常见陷阱

- **Bridge 未安装**：调用 game_query/input/write/wait 前必须先 game_bridge_install。安装是一次性的（写入 project.godot autoload）。
- **游戏未运行**：Bridge autoload 只在游戏运行时监听。编辑器模式（编辑场景）不会启动 Bridge。
- **密钥文件权限**：Windows 上可能需要 icacls 权限。Linux/macOS 上自动 chmod 0600。
- **密钥权限循环**：Bridge 首次运行后将密钥文件权限收紧为只读（Windows: `(R)` only），导致后续启动时无法重写密钥而中止（"Failed to write secret — aborting Bridge startup"）。**解决**：手动恢复写入权限 `icacls ".godot/mcp_bridge_9081.secret" /grant "%USERNAME%:(W)"`，或删除密钥文件让 Bridge 重新生成。**S4 治本（v0.18.x+）**：设置环境变量 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`，Bridge 复用现有 secret 文件（不重生、不收紧、`_exit_tree` 不删除），彻底打破权限循环并与 MCP 端 5min TTL 缓存保持同步。仅本地测试用（安全降级，生产保持默认 false）。
- **节点路径必须用绝对路径**：`game_write`、`game_wait` 等的 `path` 参数必须以 `/root/` 开头（如 `/root/Main/Player`），不接受 `root/Main/Player` 格式。`game_query(method="get_tree")` 返回的路径可用于参考。
- **与录制系统**：`runtime(action="record_start")` 依赖 Bridge 连接。确保 Bridge 可用后再录制。
- **端口 9081 冲突**：端口被占时自动递增避让（9081 起，最多尝试 10 个候选）；可用环境变量 `GODOT_MCP_BRIDGE_PORT` 设起点，无需修改 autoload 脚本。
- **密钥缓存**：5 分钟 TTL 后首次调用会重新读取密钥文件，可能有短暂延迟。
- **monitor 最大属性数**：单次监控最多 20 个属性（MONITOR_MAX_PROPERTIES），超出会报错。
- **monitor 自动停止**：采样达到 500 条（_monitor_max_samples）后自动停止。
- **watch Lambda 适配器**：信号回调使用 0-4 参数的匹配 Callable，超过 4 参数的信号只记录前 4 个。
- **watch 自动断开**：事件达到 max_events 后自动断开信号连接并停止。
- **find_ui_elements 最大返回**：默认 200，上限 500 条结果。
- **click_button**：通过 emit_signal("pressed") 触发，不模拟实际鼠标点击事件。
- **call_method 白名单只读（S5, v0.18.x+）**：`ALLOWED_METHODS` 仅含只读方法（get/has_*/get_meta/get_signal_list 等），刻意禁状态修改（防 call_method 任意执行）。`emit_signal`/`_on_*` 回调/业务方法默认被拒。需触发业务逻辑时：(a) 设环境变量 `GODOT_MCP_BRIDGE_EXTRA_METHODS=emit_signal,xxx` 显式扩展（opt-in，注意 emit_signal 会触发已连接的任意回调，安全降级）；(b) 用 `set_node_property` 改属性间接触发；(c) 业务逻辑内联到 GDScript 片段。注：`_cmd_call_method` 仍有 `args.size() > 8` 拒绝限制（>8 参数的调用/emit_signal 会失败）。
- **call_method CMP-9-B 增强（v0.27.0+）**：(1) args 按方法声明类型自动强转（传 `[1,2,3]` 给 Vector3 参数正确转换，Godot callv 不自动转，防静默零值）；(2) 方法不存在时返回 did-you-mean 建议（`String.similarity` > 0.6 取最高分）；(3) response 含 `undoable: false`（call 不可 undo，对标竞品）；(4) `EXTRA_METHODS_BLOCKLIST`（free/queue_free/set_script/call/callv/emit_signal/connect/disconnect 等）是不可覆盖硬底线（即使 env 列出也拒，防 RCE/运行时结构破坏）。向后兼容：不设 env 时行为完全不变。
- **send_key 已支持 physical_keycode（S6, v0.18.x+）**：`_cmd_send_key` 同时设 `keycode` + `physical_keycode`，触发用物理键码映射的 input action（Godot 4 推荐 physical_keycode 映射）。早期版本只设 keycode，physical 映射项目（如 `ui_right` 用 physical）不触发。
- **多用户环境不安全**：Bridge 使用 TCP 绑定 127.0.0.1 + 共享密钥认证。在单用户本地开发环境下足够安全，但在多用户共享系统（如远程开发服务器）上，localhost 通信可被同一机器上的其他用户嗅探。如需多用户隔离，考虑使用 Unix Domain Socket（仅文件权限控制访问）。
