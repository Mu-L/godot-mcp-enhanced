// src/tools/rule-templates.ts
// 详细子系统规则模板，供 setup_project_rules 写入目标项目
//
// ⚠️ 维护注意：本文件中的模板内容与 .claude/rules/godot-mcp-*.md 是两份独立副本。
// 更新规则时，必须同步修改两处：(1) .claude/rules/ 下的实际文件 (2) 此处的模板。
// 分发追踪由 .godot-mcp-manifest.json 解决（见 setup_project_rules 的 reconcile），
// 但模板源与 .claude/rules/ 仍需保持一致 —— CI 的 check-rules-version-bump 脚本
// 会在模板变更时强制要求 package.json 版本 bump。

/**
 * 所有详细规则文件的映射：文件名 → 内容
 * godot-mcp.md（基础规则）由 claudemd-builder.ts 的 GODOT_MCP_RULES 提供
 */
export const DETAILED_RULE_TEMPLATES: Record<string, string> = {
  'godot-mcp-core.md': `---
description: "godot-mcp 核心指南 模式选择 Headless Editor Bridge execute_gdscript edit_script dev_loop run_and_verify validate_scripts verify_delivery 运行时 持久化"
alwaysApply: true
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 概述与架构

godot-mcp-enhanced 提供 43 个 MCP 工具（236 个 action，权威数据见 docs/capability-matrix.md，由 \`npm run build-matrix\` 生成），通过三层架构操作 Godot：

1. **Headless CLI** — 独立 Godot 进程执行 GDScript，适合文件读写和一次性验证
2. **Editor WebSocket** — 连接运行中的编辑器插件，适合实时场景操作
3. **Game Bridge** — TCP 连接运行中的游戏，适合运行时调试和 E2E 测试

\`setup_project_rules\` 生成的 \`.claude/rules/godot-mcp.md\` 是基础规则（始终可见）。
本指南是核心决策参考，子系统详细指南在 \`.claude/rules/godot-mcp-*.md\` 中按需加载。

## 模式选择决策树

\`\`\`
需要操作什么？
├─ .tscn/.gd 文件（静态读写）
│   ├─ 精确编辑 → Headless（edit_script / write_script）
│   └─ 批量创建 → Headless（batch_add_nodes / batch_create_files）
├─ 编辑器中打开的场景（实时）
│   ├─ 编辑器已连接？→ Editor 模式（editor_sync + add_node）
│   └─ 未连接 → Headless（read_scene + add_node + save_scene）
├─ 运行中的游戏（动态状态）
│   ├─ 只读查询 → Bridge（game_query）
│   ├─ 修改状态 → Bridge（game_write）
│   └─ 模拟输入 → Bridge（game_input + game_wait）
└─ 一次性验证
    ├─ 快速检查 → run_and_verify
    ├─ 完整交付 → verify_delivery
    └─ 语法检查 → validate_scripts
\`\`\`

## 核心工具使用决策

### execute_gdscript — 动态执行

- **片段模式**（默认）：无需 \`extends\`，代码自动包装为 \`extends SceneTree\`。用 \`_mcp_output(key, value)\` 返回结构化结果，用 \`_mcp_done()\` 结束执行。
- **完整类模式**：手写 \`extends SceneTree\`，适合需要 \`_process()\` 或复杂生命周期的场景。
- **load_autoloads=true**：在完整项目环境中运行，可访问 DataRegistry、PlayerData 等全局单例。启动较慢（需加载整个项目），仅在确实需要 Autoload 时开启。
- **注意**：片段模式中 \`func\`/\`var\`/\`const\` 声明自动放在类级别，语句行放在 \`_initialize()\` 体内。
- **⚠️ 沙箱安全限制（C-04 已知限制）**：GDScript 沙箱扫描基于正则匹配（非语法解析），设计用于防止**意外误操作**，**不可防御恶意/蓄意绕过**。已知绕过向量包括：
  - 字符串拼接：\`str("OS")+".cmd()"\` 或 \`%\` 格式化构造危险 API 名
  - 变量间接调用：通过 \`call()\` / \`funcref()\` 的非字面量参数绕过静态扫描
  - 注释中包含危险 API 名称会导致误报拦截（安全侧失败）
  - **适用场景**：本地单用户开发环境（信任调用者）。**不适用于多用户/远程/不可信输入场景**——后者需要容器/VM 隔离 + \`GODOT_MCP_ALLOW_UNSAFE=false\`
  - **write_script/edit_script 也走沙箱扫描**：写入 .gd 前对内容调 \`scanGdscriptSandbox\`，发现已知危险 API 模式（清单不列举防被侦察）则阻断（SANDBOX_VIOLATION），与 execute_gdscript 同威胁面对齐。双 opt-in 旁路（\`UNRESTRICTED + DISABLE_SAFETY\`）

### edit_script — 脚本编辑

- **优先使用 search_and_replace**：基于内容匹配，对行号偏移鲁棒，CRLF 安全。**⚠️ 不要使用 Claude 内置 Edit 工具编辑 .gd 文件**——内置 Edit 无法正确处理 GDScript 的 tab 缩进，匹配率极低。始终使用 MCP 的 \`edit_script\` + \`search_and_replace\` 参数。
- **search_and_replace 免确认**：使用 \`search_and_replace\` 模式的 \`edit_script\` 无需 confirmation token，直接执行，减少 API 调用。
- **行范围模式**（start_line/end_line）：仅在 search_and_replace 无法使用时（如批量重复修改）。仍需 confirmation token。
- **indent_mode**：\`smart\`（推荐）自动对齐缩进；\`raw\` 仅在确认缩进正确时使用。
- **verify_content**：提供期望内容作为守卫，防止过时的行号编辑。

### dev_loop vs 单独工具

- **dev_loop**：执行 GDScript → 可选验证 → 可选 Bridge 查询/截图 → 可选断言 → 可选状态保存。适合一体化验证流程。
- **★ dev_loop 的 \`code\` 全行匹配 E2E DSL 会静默切 Bridge 序列**：若 \`code\` 每一非空行都匹配 DSL 语法（\`waitFor(...)\`/\`click(x,y)\`/\`press(...)\`/\`typeText(...)\`/\`waitMs(...)\`），dev_loop **不执行 GDScript，而是逐行作为 Bridge 命令**发送（返回 \`mode: "dsl"\`）。传含 \`click(100,100)\` 的内容会被当 bridge 脚本——意图跑 GDScript 时避免整段恰好全是 DSL 语法。
- **dev_loop \`acceptance.assertions\` 三类型前置条件**：\`gdscript\`（默认，headless 跑断言脚本）、\`screenshot_diff\`（**需 Bridge 连接**，take_screenshot + 可选余弦相似度预筛 + 可见性检查）、\`frame_degradation\`（**需先 \`frame_sequence\` 捕获帧**或手动提供 \`frames_dir\`，否则无帧可比）。用高级断言前先确认前置满足。
- **单独工具**：execute_gdscript + validate_scripts + run_and_verify 灵活组合。适合多步调试或需要中间检查的场景。

### debug — 断点管理（editor-only）

- **set_breakpoint**：在 GDScript 指定行设断点（走 CodeEdit gutter，gutter 可见 + 现行 game 命中 + 下次 run 同步保持）。
- **clear_breakpoint**：清除指定行断点。
- **list_breakpoints**：列出当前活跃 tab 脚本的断点。
- **⚠️ Phase 1 限制**：脚本必须在编辑器中打开且是当前活跃 tab。headless 模式返回 EDITOR_ONLY。

### engine — 实时 ClassDB 内省（editor-only）

- **class_info**：查单个类的完整结构（属性/方法/信号/枚举/继承），默认 no_inherit=true 只看本类 own 成员。
- **search**：substring 匹配类名（返回 {name, parent} 列表，上限 100 条）。
- **get_inheritance**：返回类的继承链（从本类到 Object）。
- **vs docs**：docs 是静态 4.7 快照（离线），engine 是运行中引擎的真实 ClassDB（含第三方 addon/自定义类/实际版本差异）。

### run_and_verify vs 手动组合

- **run_and_verify**：一键 headless 运行 + 错误分析 + 可选场景树快照。适合快速检查。**自动读取 project.godot 的 autoload 配置**，将 autoload 单例相关的"Identifier not found"错误标记为 headless_limitation 而非真实错误，减少误报。
- **手动组合**：run_project + get_debug_output + stop_project。适合需要精细控制运行时长的场景。
  - \`run_project\` 支持 \`wait_for_bridge\` 参数（默认 false）：true 时等待 Bridge 就绪再返回（用 \`game-bridge.isBridgeReady\` 零接触探测）。
  - \`run_project\` 支持 \`bridge_timeout\` 参数（默认 10 秒）：等待 Bridge 就绪的最大超时时间。

## 运行时 vs 持久化

部分工具在 headless 进程中创建/修改节点，但**这些变更不持久化到 .tscn 文件**：

- **运行时工具**（不持久化）：signal_connect/disconnect/emit、node_create_3d、physics_raycast、tilemap_*、audio_*、particles_*、ui_*、recording_* 等
- **持久化方法**：使用 add_node（写入 .tscn）+ save_scene 保存。或用 write_script / edit_script 修改 .gd 文件。

> 运行时工具适合验证和测试。若需持久化场景修改，必须使用 add_node + save_scene。

## Headless 截图限制（2D 与 3D）

Headless 模式下场景截图可能完全空白——headless 进程默认用 **RendererDummy**（无 GPU 渲染后端），不初始化渲染服务器，2D CanvasItem 与 3D mesh 都不渲染像素。实测 Godot 4.7 headless 加载 3D 场景得 \`DummyMesh/DummyCamera/DummyMaterial\` 泄漏，截图全背景色空白（PIL 色散 spread=0）。**3D 同样受影响**，非仅 2D。

**推荐工作流**：
1. 用 \`screenshot(action=capture)\` 尝试截图
2. 如果返回 \`BLANK_DETECTED\` 警告，使用以下替代方案：
   - 用户手动截图（F5 运行后截图）
   - \`screenshot(action=analyze)\` 返回图片的 base64 数据供 AI 视觉分析（需配合 \`image_path\` 指定本地文件）
   - Bridge \`take_screenshot\`（游戏运行时 GPU viewport 渲染，2D/3D 均可）
3. 3D 视觉确认同理需 GPU 模式（Bridge 或 editor/GUI）；headless 下用数据铁证替代（场景加载成功 + ArrayMesh 顶点数据 + 几何拓扑 χ）

## 常见陷阱

- **忘记 \`_mcp_done()\`**：片段模式中如果没有调用 \`_mcp_done()\`，执行会超时。
- **edit_script 行号偏移**：多步编辑后行号会变化。始终优先使用 search_and_replace。
- **运行时操作误认为持久化**：运行时工具的修改在 headless 进程退出后丢失。
- **load_autoloads 性能开销**：仅在需要 Autoload 单例时开启，否则启动时间增加 3-5 倍。
- **Bridge 密钥过期**：Bridge 密钥有 5 分钟 TTL 缓存，长时间未操作后首次调用可能稍慢。
`,

  'godot-mcp-bridge.md': `---
description: "game bridge game_query game_input game_write game_wait game_bridge_install game_bridge_uninstall 运行时 TCP 密钥认证 端口 9081 autoload mcp_bridge E2E 测试 调试"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

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
| \`game_bridge_install\` | 安装 Bridge autoload 到项目（注册 autoload + 配置端口 9081） |
| \`game_bridge_uninstall\` | 卸载 Bridge autoload |

### 查询 — game_query

| method | 说明 |
|--------|------|
| \`ping\` | 检查游戏是否运行 |
| \`get_tree\` | 获取场景树结构 |
| \`find_nodes\` | 按名称/类型/路径查找节点 |
| \`get_node_properties\` | 获取节点属性值 |
| \`get_node_layout\` | 获取节点完整布局快照（type + position/global_position 成对 + Control anchor/offset + Sprite2D centered + Node3D Vector3，全走 _jsonify） |
| \`get_performance\` | 获取性能统计（FPS/内存等） |
| \`get_viewport_info\` | 获取视口信息 |
| \`take_screenshot\` | 从运行中的游戏截图 |
| \`get_errors\` | 查询游戏运行时错误（push_error/脚本报错/引擎错误），支持 \`since_seq\` 增量 + \`clear\` 读即焚 |
| \`clear_errors\` | 清空错误 buffer |

### 输入 — game_input

| method | 说明 |
|--------|------|
| \`send_key\` | 发送键盘事件（key + pressed） |
| \`send_mouse_click\` | 发送鼠标点击（x, y, button, pressed） |
| \`send_mouse_move\` | 移动鼠标（x, y） |
| \`send_text\` | 输入文本（text） |

### 写入 — game_write

| method | 说明 |
|--------|------|
| \`set_node_property\` | 设置节点属性值（path + property + value） |
| \`call_method\` | 调用节点方法（path + method + args）。CMP-9-B(2026-08-08)增强:默认只读白名单(get/has_*/get_meta 等),env \`GODOT_MCP_BRIDGE_EXTRA_METHODS=method1,method2\` 可扩展(含写方法如 take_damage);\`EXTRA_METHODS_BLOCKLIST\`(free/queue_free/set_script/call/emit_signal 等)是不可覆盖硬底线;args 按方法声明类型自动强转(传 [1,2,3] 给 Vector3 参数正确转换);方法不存在时返回 did-you-mean 建议;response 含 undoable=false(call 不可 undo) |

### 等待 — game_wait

| method | 说明 |
|--------|------|
| \`wait_for_node\` | 等待节点出现（path） |
| \`wait_for_property\` | 等待属性值变化（path + property + value） |

## 使用指南

### 安装流程

1. 调用 \`game_bridge_install(project_path)\` — 注册 autoload、配置端口 9081
2. 在 Godot 中运行项目（F5 或 \`run_project\`）
3. 游戏启动后 Bridge 自动监听 TCP 连接
4. 使用 \`game_query(method="ping")\` 验证连接

### 安全机制

- **密钥认证**：安装时生成随机密钥文件，每次 TCP 连接需认证
- **本地绑定**：TCP 仅监听 127.0.0.1，不暴露到网络
- **密钥生命周期**：读取后缓存 5 分钟（TTL），文件权限收紧（0600/icacls）
- **防符号链接**：密钥文件若是 symlink 则拒绝读取

### 与 dev_loop 集成

dev_loop 的 \`bridge\` 参数可在执行 GDScript 后自动进行 Bridge 查询：

\`\`\`json
{
  "bridge": {
    "screenshot": { "path": "user://test.png" },
    "queries": [
      { "method": "ping", "expect": "ok" },
      { "method": "find_nodes", "params": { "pattern": "Player" } }
    ]
  }
}
\`\`\`

## 调用示例

### 检查游戏运行状态

\`\`\`
game_query(method="ping")
// → { status: "ok", message: "Bridge connected" }

game_query(method="get_tree")
// → { root: "Node3D", child_count: 15 }

game_query(method="find_nodes", params={ "pattern": "Player" })
// → { nodes: [{ path: "root/Player", type: "CharacterBody3D" }] }
\`\`\`

### 模拟输入并等待

\`\`\`
game_input(method="send_mouse_click", params={ "x": 640, "y": 360, "button": "left", "pressed": true })
game_input(method="send_mouse_click", params={ "x": 640, "y": 360, "button": "left", "pressed": false })
game_wait(method="wait_for_node", params={ "path": "root/CanvasLayer/Dialog" })
game_query(method="get_node_properties", params={ "path": "root/CanvasLayer/Dialog", "properties": ["visible"] })
// → { visible: true }
\`\`\`

### 修改运行时状态

\`\`\`
game_write(method="set_node_property", params={ "path": "root/Player", "property": "position", "value": { "x": 10, "y": 0, "z": 5 } })
game_write(method="call_method", params={ "path": "root/Player", "method": "take_damage", "args": [25] })
\`\`\`

### 错误：Bridge 未连接

\`\`\`
game_query(method="ping")
// → 超时或错误: "Bridge not connected"
// 解决：1. 确认已运行 game_bridge_install
//       2. 确认游戏正在运行（F5 或 run_project）
//       3. 检查项目 .godot/ 目录下是否有 mcp_bridge_9081.secret 文件
\`\`\`

## 常见陷阱

- **Bridge 未安装**：调用 game_query/input/write/wait 前必须先 game_bridge_install。安装是一次性的（写入 project.godot autoload）。
- **游戏未运行**：Bridge autoload 只在游戏运行时监听。编辑器模式（编辑场景）不会启动 Bridge。
- **密钥文件权限**：Windows 上可能需要 icacls 权限。Linux/macOS 上自动 chmod 0600。
- **与录制系统**：recording_start 依赖 Bridge 连接。确保 Bridge 可用后再录制。
- **端口 9081 冲突**：如果端口被占用，需要手动修改 autoload 脚本中的端口配置。
- **密钥缓存**：5 分钟 TTL 后首次调用会重新读取密钥文件，可能有短暂延迟。
`,

  'godot-mcp-editor.md': `---
description: "editor websocket editor_sync_start editor_sync_stop editor_get_scene_tree launch_editor 编辑器 场景树同步 undo plugin addons godot_mcp_server"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 概述与架构

Editor 模式通过 WebSocket JSON-RPC 2.0 连接 Godot 编辑器内的 GDScript 插件，实时操作当前打开的场景。

- **插件位置**：\`addons/godot_mcp_server/\`（需安装在目标项目中）
- **连接机制**：launch_editor 启动编辑器后，服务端自动检测 WebSocket 连接（端口 13100）
- **回退策略**：无编辑器连接时自动回退到 Headless 模式；设置 \`GODOT_MCP_NO_FALLBACK=true\` 禁止回退

## 工具清单与对比

### Editor 独有工具

| 工具 | 说明 |
|------|------|
| \`editor_sync_start\` | 启动场景树实时监听，推送 node_added/node_removed 事件 |
| \`editor_sync_stop\` | 停止场景树监听 |
| \`editor_get_scene_tree\` | 获取编辑器当前场景树完整快照 |

### 仅 Headless 可用

| 工具 | 原因 |
|------|------|
| \`execute_gdscript\` | 独立进程执行，不适合编辑器环境 |
| \`query_scene_tree\` | Headless 专用，用 editor_get_scene_tree 替代 |
| \`inspect_node\` | Headless 专用 |

### 行为差异

| 工具 | Headless | Editor |
|------|----------|--------|
| \`add_node\` | 需指定 scene_path，创建后需 save_scene | 操作当前打开场景，实时刷新 |
| \`edit_node\` | 需指定 scene_path | 操作当前场景中的节点 |
| \`remove_node\` | 需确认令牌 | 需确认令牌 + 支持 undo |
| 其他工具 | 自动路由到 headless 执行 | 未知工具名自动 forward 到插件 |

## 使用指南

### 连接流程

1. 确认目标项目已安装 \`addons/godot_mcp_server/\` 插件
2. 调用 \`launch_editor(project_path)\` 启动编辑器
3. 服务端自动检测 WebSocket 连接（最长等待约 10 秒）
4. 连接成功后，工具调用自动路由到编辑器

### 场景树同步

- \`editor_sync_start\` 连接 SceneTree 的 node_added/node_removed 信号
- 事件通过 EditorToolExecutor 缓冲（最大 10000 条），超出时丢弃最旧记录
- 编辑器断开重连后，同步自动恢复
- \`editor_get_scene_tree\` 获取当前快照（不依赖 sync 状态）

## 调用示例

### 启动编辑器并同步场景树

\`\`\`
// 1. 启动编辑器
launch_editor(project_path="D:/projects/my-game")

// 2. 启动场景树监听
editor_sync_start(project_path="D:/projects/my-game")
// → 返回: { status: "ok", message: "Scene tree sync started" }

// 3. 获取当前场景树
editor_get_scene_tree(project_path="D:/projects/my-game")
// → 返回: { nodes: [...], root: "Node3D", child_count: 15 }
\`\`\`

### 错误：编辑器未安装插件

\`\`\`
editor_sync_start(project_path="D:/projects/my-game")
// → 返回: {
//     error: "EDITOR_NOT_CONNECTED",
//     message: "These tools require editor mode with plugin connection.
//               Use headless query_scene_tree as alternative."
//   }
// 解决：在 Godot 编辑器中安装 addons/godot_mcp_server/ 插件并重启编辑器
\`\`\`

## 常见陷阱

- **插件未安装**：editor_sync 工具返回 EDITOR_NOT_CONNECTED。需要手动安装插件到项目。
- **编辑器启动慢**：大型项目首次启动可能超过 10 秒。可分两步操作：先 launch_editor，等几秒后再 sync。
- **forward 机制**：未明确处理的工具名会自动转发到编辑器插件，可能产生意外行为。
- **断开重连**：编辑器崩溃或关闭后，sync 状态自动清理。需要重新 launch_editor。
- **launch_editor 崩溃恢复（2026-08-07 审查 P2 文档化）**：launch_editor 是 fire-and-forget（detached + unref），不跟踪编辑器生命周期。编辑器崩溃后：① WS 断开 → EditorConnection 自动重连（20 次指数退避）；② 重连耗尽 → reconnectExhausted handler → handleEditorStall 降级 headless（用户可用 headless 工作）；③ 非 PERSISTENT_SECRET 模式下崩溃即删 secret，rebuildEditorConnection 需 secret 文件 → rebuild 失败需手动重新 launch_editor 或重启 MCP server。**用户预期管理**：系统不会自动重启崩溃的编辑器，需手动 launch_editor 或重启 server。心跳降级走 B-T5 分流（REQUEST_TIMEOUT 主线程卡死 → 降级；NOT_CONNECTED/CONNECTION_LOST 下线 → 让自动重连兜底不降级）。
- **端口冲突**：默认端口 13100，如果被占用需检查编辑器插件配置。
- **editor 固定 secret（S4-editor）**：设环境变量 \`GODOT_MCP_EDITOR_PERSISTENT_SECRET=true\`，editor plugin 复用现有 \`mcp_editor.key\`（不重生、不收紧 ACL、\`_exit_tree\` 不删除），彻底消除 \`_ready\` 覆盖写需求及 MCP 端 TTL 缓存同步窗口。仅本地测试用（安全降级——secret 固定不再轮换，生产保持默认 false）。对称 bridge \`GODOT_MCP_BRIDGE_PERSISTENT_SECRET\`（见 godot-mcp-bridge.md「密钥权限循环」）。
- **mcp_editor.key 多实例互删（2026-07-23 修复）**：editor 启动写 \`{project}/.godot/mcp_editor.key\`，\`_exit_tree\` 默认删除。多个 editor 实例（或禁用→启用插件）共享同一路径时，**历史版本任一实例退出会误删仍存活实例的 key**（现象：editor 日志称 \`Auth secret written\` 但文件找不到；存活实例内存 \`_secret\` 仍有效、9090 仍 LISTEN，TS 端 TTL 缓存 5min 过期后重连连不上）。**已修复**：\`websocket_server.gd:_delete_secret_file\` 删前 \`FileAccess.get_file_as_string\` 校验 \`on_disk == _secret\`，只清自己生成的 key（读失败也不删，安全侧）。仍遇此问题（旧 addon 副本/未重启 editor）：设 \`GODOT_MCP_EDITOR_PERSISTENT_SECRET=true\` 重启 editor（见上条 S4-editor）。
`,

  'godot-mcp-ui.md': `---
description: "ui ui_create_control ui_build_layout ui_measure_layout ui_set_layout ui_get_layout ui_anchor_preset ui_set_theme ui_container_add ui_draw_recipe theme_create theme_set_property CSS flexbox grid 布局 测量 容器 锚点 rect Control HBoxContainer VBoxContainer GridContainer 全屏 居中"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 概述与架构

UI 布局工具将 **CSS Flexbox/Grid 语义**翻译为 Godot Container 树，让 AI 用熟悉的布局概念构建 Godot UI。

- **两种使用方式**：单节点操作（ui_create_control）vs 批量布局（ui_build_layout）
- **运行时工具**：操作在 headless 进程中执行，默认不持久化到 .tscn（例外：\`ui_build_layout\` 支持 \`persist=true\` 原子写）。详见 godot-mcp-core.md "运行时 vs 持久化"。
- **两种方式互补**：ui_build_layout 适合整体布局，ui_create_control + ui_set_layout 适合精确定位

## 工具清单

| 工具 | 说明 |
|------|------|
| \`ui_build_layout\` | 声明式批量布局，CSS Flexbox/Grid → Godot Container 树；支持 rect 绝对几何与 persist 原子写 |
| \`ui_measure_layout\` | headless 整树 computed rect 测量（等布局稳定后输出，可带 expect_tree diff） |
| \`ui_create_control\` | 创建单个 Control 节点（29 种类型） |
| \`ui_set_layout\` | 设置锚点/偏移/最小尺寸 |
| \`ui_get_layout\` | 查询节点布局信息 |
| \`ui_anchor_preset\` | 应用 16 种锚点预设 |
| \`ui_container_add\` | 向 Container 添加子 Control |
| \`ui_draw_recipe\` | 声明式 2D 绘图（7 种操作） |
| \`ui_set_theme\` | 设置/创建/保存/加载 Theme |
| \`theme_create\` | 创建空 Theme 或从节点提取 |
| \`theme_set_property\` | 设置 Theme 属性（font/color/constant/stylebox） |

### 支持的 29 种 Control 子类

Button, Label, Panel, LineEdit, TextEdit, RichTextLabel, LinkButton, HSlider, VSlider, CheckBox, CheckButton, OptionButton, SpinBox, ProgressBar, TextureRect, ColorPickerButton, TabContainer, Tree, ItemList, MarginContainer, HBoxContainer, VBoxContainer, GridContainer, CenterContainer, ScrollContainer, PanelContainer, HSplitContainer, VSplitContainer, NinePatchRect

## 使用指南

### ui_build_layout — 声明式布局

\`tree\` 参数定义布局结构，支持递归嵌套（最大深度 10）：

\`\`\`json
{
  "type": "VBoxContainer",
  "name": "MainMenu",
  "layout": { "direction": "column", "gap": 10, "padding": 20 },
  "children": [
    { "type": "Label", "name": "Title", "properties": { "text": "游戏标题" } },
    {
      "type": "HBoxContainer",
      "name": "ButtonRow",
      "layout": { "direction": "row", "justify": "center", "gap": 8 },
      "children": [
        { "type": "Button", "name": "StartBtn", "properties": { "text": "开始" } },
        { "type": "Button", "name": "QuitBtn", "properties": { "text": "退出" } }
      ]
    }
  ]
}
\`\`\`

### layout 字段

| 字段 | 值 | 对应 Godot |
|------|-----|-----------|
| \`direction\` | row/column/grid | HBoxContainer/VBoxContainer/GridContainer |
| \`justify\` | flex-start/center/flex-end/space-between/space-around/space-evenly | Container alignment |
| \`align\` | stretch/flex-start/center/flex-end | Cross-axis alignment |
| \`gap\` | number | Theme 默认间距 override |
| \`padding\` | number 或 [上,右,下,左] | MarginContainer |
| \`columns\` | number | GridContainer columns（仅 grid 方向） |

### flex 字段（控制子节点在容器中的行为）

| 字段 | 说明 | 对应 Godot |
|------|------|-----------|
| \`grow\` | 扩展比例（0=不扩展） | size_flags_stretch_ratio |
| \`min_width\` / \`min_height\` | 最小尺寸 | custom_minimum_size |
| \`align_self\` | 单独对齐覆盖 | size_flags + alignment |

### anchor_preset 锚点预设

16 种预设：top_left, top_right, bottom_left, bottom_right, center_left, center_top, center_right, center_bottom, center, left_wide, top_wide, right_wide, bottom_wide, vcenter_wide, hcenter_wide, **full_rect**（最常用）

### rect 绝对几何（v0.30.3 语义修正）

无 \`layout\` 字段的节点支持 \`rect: {x, y, w, h}\`——**相对父节点左上角**（不是视口绝对坐标），按**父尺寸**反解为 anchors+offsets：

- **求解基准**：根节点（挂 parent_path 下）的 rect 相对 **\`viewport\` 参数**求解（默认 1280x720）；子节点的 rect 相对**父节点的 rect.w/h** 求解；父节点未声明 rect 时降级用 viewport 求解并发 warning（\`parent's size is unknown\`，结果可能不准）。
- **viewport 参数**：\`ui_build_layout\` 顶层参数 \`{w, h}\`（须为正数），与项目 \`display/window/size\` 一致时根 rect 即视口绝对几何。
- **父必须非 Container**：HBoxContainer 等容器父会强制重排子节点，rect 会被运行时跳过并给出 warning（需要容器内定位请重构为非容器父或兄弟节点）。
- \`rect\` 优先于 \`anchor_preset\`；显式写四值 anchors+offsets，不用 set_anchors_preset（引擎陷阱：preset 不重置 offsets）。
- 锚点值吸附 0/0.5/1（可读性优先），其余位置保持比例锚点兜底。
- **带 \`layout\` 的容器节点自身 rect 不落地布局**：仅作为 \`ui_measure_layout(expect_tree)\` 的对照目标（diff 会报告实际偏差）；容器实际几何由 \`anchor_preset\`（默认 full_rect）与子节点内容/\`custom_minimum_size\` 撑开决定。

### justify space-* 行为（v0.30.3）

非 wrap 非 grid 的 row/column 下，\`space-between/around/evenly\` 通过注入 \`_spacer_N\` Control 节点实现（SIZE_EXPAND + stretch_ratio），**不再是近似映射**。\`wrap: "wrap"\` 时 justify 被忽略（FlowContainer 无对齐）、\`grid\` 方向时同样忽略——这两种情况**不注入 spacer、也不发 spacer 注入 warning**。与子节点 \`flex.grow\` 并存时，spacer 与 grow 子节点瓜分剩余空间，分配语义与 CSS 不同，会有 warning。

### 布局收敛闭环

\`ui_build_layout(tree 含 rect)\` → \`ui_measure_layout(expect_tree=同一棵 tree，**不带 node_path**)\` → 按 \`data.layout_verify.diff\` 的 Δ 数值修 tree → 循环至全绿 → \`ui_build_layout(persist=true)\` 原子写 .tscn（pack → tmp → rename）。

- \`layout_verify\` 结构：\`targets\`（期望 rect 清单）/ \`diff\`（逐节点 Δ，容差默认 2px）/ \`overlaps\`（兄弟节点重叠）/ \`out_of_bounds\`（溢出父边界）/ \`viewport\`（measure 输出的根参照系透传）。
- **坐标系语义（v0.30.3）**：rect 相对父节点左上角；\`diff\` 的 actual 为**父相对坐标**（measured 子 global − 父 global，与 target 同构可直接比 Δ）；根级 target（树根自身 rect）以视口原点为参照；父不在测量集（未渲染/不可见）时该条目 delta 为 NaN。
- \`ui_measure_layout\` 单独使用时：\`node_path\` 可选（省略则从场景根整树测），\`max_depth\` 默认 16（上限 64），等布局稳定（连续帧快照一致或最多 5 帧）后输出；输出含 \`viewport\`（项目声明视口尺寸）与 \`stalled\`（5 帧上限内未达 2 帧稳定时 true，布局可能未收敛）。

### draw_recipe 声明式绘图

7 种绘图操作：\`rect\`（矩形）、\`circle\`（圆形）、\`line\`（线段）、\`arc\`（弧线）、\`polygon\`（多边形）、\`polyline\`（折线）、\`string\`（文本）

每种操作支持 \`color\`（[r,g,b] 或 [r,g,b,a]，0-1 范围）、\`filled\`（是否填充）、\`width\`（线宽）。

## 调用示例

### Flexbox 行布局

\`\`\`
ui_build_layout(
  project_path="D:/game",
  scene_path="res://scenes/main.tscn",
  parent_path="root",
  tree={
    "type": "HBoxContainer",
    "name": "Toolbar",
    "layout": { "direction": "row", "gap": 4, "padding": [0, 8, 0, 8] },
    "children": [
      { "type": "Button", "name": "NewBtn", "properties": { "text": "新建" } },
      { "type": "Button", "name": "OpenBtn", "properties": { "text": "打开" } },
      { "type": "Button", "name": "SaveBtn", "properties": { "text": "保存" } }
    ]
  }
)
\`\`\`

### draw_recipe HP 条

\`\`\`
ui_draw_recipe(
  project_path="D:/game",
  scene_path="res://scenes/main.tscn",
  node_path="root/HUD/HealthBar",
  ops=[
    { "kind": "rect", "position": [0, 0], "size": [200, 20], "color": [0.2, 0.2, 0.2] },
    { "kind": "rect", "position": [0, 0], "size": [140, 20], "color": [0, 0.8, 0] },
    { "kind": "string", "text": "70/100", "position": [80, 14], "color": [1, 1, 1], "font_size": 12 }
  ]
)
\`\`\`

### 错误：无效 Control 类型

\`\`\`
ui_create_control(
  project_path="D:/game",
  scene_path="res://scenes/main.tscn",
  node_type="MyCustomWidget",    // ❌ 不在白名单中
  node_name="CustomWidget"
)
// → { error: "INVALID_CONTROL_TYPE", message: "MyCustomWidget is not a supported control type" }
// 解决：使用 29 种支持的类型之一，或通过 execute_gdscript 注册自定义场景
\`\`\`

## 常见陷阱

- **运行时默认不持久化**：UI 布局工具创建的节点在 headless 进程退出后丢失。\`ui_build_layout(persist=true)\` 可原子写 .tscn（pack → tmp → rename，默认 false）；其余持久化替代方案：\`add_node\` + \`save_scene\` 逐个写入，或 \`scene_commit\`（批量 node_property/node_add 操作）直接编辑 .tscn。
- **Container 子节点必须是 Control**：向 HBoxContainer/VBoxContainer 等容器添加非 Control 子节点会报错。
- **CSS 属性回退**：\`wrap\`、\`order\`、\`flex-shrink\`、\`max-width/height\` 等 CSS 属性在 Godot 中无对应，会被忽略。
- **grid 方向必须指定 columns**：使用 \`direction: "grid"\` 时必须同时指定 \`columns\` 数量。
- **ui_build_layout vs ui_create_control**：build_layout 一次创建整棵树，适合初始布局。create_control + set_layout 适合精确控制单个节点。
`,

  'godot-mcp-recording.md': `---
description: "recording recording_start recording_stop recording_save recording_load recording_play 录制 回放 输入事件 bridge E2E 测试 regression 操作复现 输入捕获 事件重放"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 概述与架构

录制系统捕获用户输入事件（键盘/鼠标），序列化为 JSON，可在后续回放。

- **依赖**：Game Bridge 必须已连接（输入事件通过 Bridge 发送和捕获）
- **存储位置**：\`res://recordings/recording_*.json\`（项目内）
- **使用场景**：E2E 测试用例录制、回归测试、Bug 复现、操作自动化

## 工具清单

| 工具 | 说明 | 前提 |
|------|------|------|
| \`recording_start\` | 开始捕获输入事件 | Bridge 已连接 |
| \`recording_stop\` | 停止捕获，返回事件 JSON | 录制进行中 |
| \`recording_save\` | 保存到 res://recordings/ | events_json 参数 |
| \`recording_load\` | 从文件加载录制 | 文件名匹配 recording_*.json |
| \`recording_play\` | 回放录制的输入事件 | Bridge 已连接 + events_json |

## 使用指南

### 完整流程

\`\`\`
1. game_bridge_install → 安装 Bridge（一次性）
2. run_project → 启动游戏
3. game_query(method="ping") → 确认 Bridge 连接
4. recording_start → 开始录制
5. [用户操作 / game_input 模拟输入]
6. recording_stop → 停止录制，获取 events_json
7. recording_save(file_name) → 保存到文件
--- 后续使用 ---
8. recording_load(file_name) → 加载录制
9. recording_play(events_json, speed=1.0) → 回放
\`\`\`

### 事件格式

\`\`\`json
{
  "version": 1,
  "duration_ms": 5420,
  "events": [
    { "type": "key", "keycode": 87, "pressed": true, "timestamp_ms": 120 },
    { "type": "mouse_click", "x": 640, "y": 360, "button": 1, "pressed": true, "timestamp_ms": 2300 },
    { "type": "key", "keycode": 87, "pressed": false, "timestamp_ms": 4100 }
  ]
}
\`\`\`

### 文件命名与安全

- **自动命名**：\`recording_YYYYMMDD_HHmmss.json\`（如 \`recording_20260527_143022.json\`）
- **强制格式**：文件名必须匹配 \`recording_*.json\`，否则报 \`INVALID_FILE_NAME\`
- **路径遍历防护**：文件名禁止包含 \`/\`、\`\\\\\`、\`..\`

## 调用示例

### 完整录制→保存→加载→回放

\`\`\`
// 1. 开始录制
recording_start(project_path="D:/game")
// → { status: "ok", message: "Recording started" }

// 2. [模拟玩家操作]
game_input(method="send_key", params={ "key": "Key_W", "pressed": true })
game_input(method="send_mouse_click", params={ "x": 320, "y": 240, "button": "left", "pressed": true })

// 3. 停止录制
recording_stop(project_path="D:/game")
// → { events_json: "{\\"version\\":1,\\"duration_ms\\":1200,\\"events\\":[...]}" }

// 4. 保存到文件
recording_save(project_path="D:/game", file_name="recording_test_login.json", events_json="<从 stop 获取>")
// → { status: "ok", path: "res://recordings/recording_test_login.json" }

// 5. 后续加载并回放
recording_load(project_path="D:/game", file_name="recording_test_login.json")
// → { events_json: "..." }

recording_play(project_path="D:/game", events_json="<从 load 获取>", speed=1.0)
// → { status: "ok", events_played: 5 }
\`\`\`

### 与 game_wait 结合的 E2E 测试

\`\`\`
// 录制一次操作，后续自动回放 + 验证
recording_load(project_path="D:/game", file_name="recording_open_menu.json")
recording_play(project_path="D:/game", events_json="<loaded>", speed=2.0)
game_wait(method="wait_for_node", params={ "path": "root/CanvasLayer/OptionsMenu" })
game_query(method="get_node_properties", params={ "path": "root/CanvasLayer/OptionsMenu", "properties": ["visible"] })
// → { visible: true } — 测试通过
\`\`\`

### 错误：Bridge 未连接

\`\`\`
recording_start(project_path="D:/game")
// → { error: "BRIDGE_NOT_CONNECTED", message: "Recording requires an active game bridge connection" }
// 解决：1. 确认已 game_bridge_install
//       2. 确认游戏正在运行（F5）
//       3. 确认 game_query(method="ping") 返回成功
\`\`\`

## 常见陷阱

- **Bridge 是硬依赖**：recording_start/recording_play 都需要 Bridge 连接。没有 Bridge 则无法录制或回放。
- **文件名格式严格**：\`recording_test.json\`（❌ 不匹配）、\`recording_test_login.json\`（✅ 匹配）。必须以 \`recording_\` 开头、\`.json\` 结尾。
- **回放时序**：speed > 1.0 会加速回放，但可能因游戏帧率跟不上导致事件丢失。建议 E2E 测试使用 speed=1.0。
- **录制文件存储在项目内**：\`res://recordings/\` 下的文件会随项目版本控制。敏感录制应在 .gitignore 中排除。
- **事件类型有限**：仅捕获键盘（key）和鼠标（mouse_click）事件。触摸、手柄等不适用。
`,

  'godot-mcp-engine-quirks.md': `---
description: "godot-mcp 引擎陷阱 物理查询 碰撞体 ConcavePolygonShape3D CollisionLayer Mask ArrayMesh GenerateNormals GLB headless RID leak _Ready Free QueueFree Camera2D screenshot 截图 导航 bake shader compile_success MaterialOverride MultiMesh"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 定位

这是 **Godot 引擎行为知识库**——不是工具调用指南（见 core/editor/bridge 等），不是语言教程。使用 MCP 工具操作 Godot 时会遇到这些**隐蔽的引擎陷阱**：多数无错误、无警告，静默失败，靠经验规避。按工具场景分组。

来源：吸收自 godogen（\`D:\\GitHub\\godogen\\godot\\skills\\godogen\\quirks.md\`）的引擎级、语言无关陷阱，剔除 C# 专属项（SetScript dispose / partial class / SceneBuilderBase 等），保留 GDScript 项目同样会踩的引擎行为。★ 标记对 MCP 工具直接相关、最易踩的重点。

## 截图与捕获（screenshot / execute_gdscript 捕获脚本）

- **★ \`--write-movie\` 第一帧在 \`_Process()\` 前渲染**：捕获序列的 frame 0 可能在 \`_Process\` 首次执行前生成。camera 若在 \`_Process\` 定位，frame 0 是 junk 帧。在 \`_Initialize()\` 用 \`Position\`/\`RotationDegrees\` 预置 camera（**勿用 \`LookAt\`**——节点未入树，空间方法失效）。关联：screenshot(capture)、execute_gdscript SceneTree 捕获脚本。
- **静态/动态场景的 fps 选择**：静态（UI/装饰/地形）\`--fixed-fps 1\`；动态（物理/移动/玩法）\`--fixed-fps 10+\`。低 FPS 使 \`delta\` 过大，引发物理 tunneling 和 erratic 行为。关联：screenshot(capture)。
- **★ 帧哈希全部相同 = 捕获接错**：若序列所有帧哈希一致，不要认定捕获成功——通常是 camera/time stepping/scripted input 接错。这是 frame-verify 的核心反作弊判据之一。关联：screenshot(capture)、frame-verify。

## 物理查询（physics / scene 碰撞体）

- **★ RayCast3D 不可靠检测 ConcavePolygonShape3D**：\`RayCast3D\` / \`PhysicsRayQueryParameters3D\` 对 \`ConcavePolygonShape3D\` 碰撞检测不可靠。用 \`PhysicsShapeQueryParameters3D\`（shape cast）或直接查 mesh 几何（SurfaceTool closest-point）做 trimesh 地形的落地/表面检测。关联：physics(raycast)——raycast 工具对 trimesh 地形会漏检。
- **ConcavePolygonShape3D 需顺时针 winding（Jolt）**：逆时针三角面产生朝下法线——物体从上方穿透，从下方碰撞。用平面 quad 测试：RigidBody 穿透则反转三角形索引顺序。关联：scene 创建碰撞形状、physics(body_info)。
- **BoxShape3D 在 trimesh 上卡边**：在 ConcavePolygon/trimesh 表面滑动的对象（载具/滚动体）用 \`BoxShape3D\` 会卡碰撞边（Godot/Jolt bug），改用 \`CapsuleShape3D\`。关联：scene 物理体。
- **★ CollisionLayer/Mask 是 bitmask 非 UI index**：\`CollisionLayer\`/\`CollisionMask\` 在代码里是 bitmask，不是编辑器 UI 层号。UI Layer 1=bitmask 1, Layer 2=2, Layer 3=4, Layer 4=8（2 的幂）。\`CollisionLayer=4\` 是 UI Layer 3，**不是 Layer 4**。关联：scene/edit_node 设碰撞属性、physics。
- **★ 默认 CollisionMask=1 漏非默认层**：新碰撞体默认 \`CollisionMask=1\`，若地形/墙用 layer 2+，玩家穿透**且无错误**。务必显式设 mask 覆盖所有该碰的层。关联：scene 物理体。

## 场景与资源导入（scene / edit_node / import_resources）

- **★ \`.gdignore\` 静默阻止整个目录导入**：任何目录放 \`.gdignore\` 会让 Godot importer **完全跳过**它。绝不在 \`assets/\` 放——只有 \`screenshots/\` 等捕获目录该放。纹理不导入时先查散落的 \`.gdignore\`。关联：import_resources、scene 加载纹理、screenshot。
- **★ ArrayMesh.GenerateNormals() 是阴影必需**：程序化 mesh（SurfaceTool/raw ArrayMesh）不调 \`GenerateNormals()\` 则不接收阴影——**无错误、无警告，阴影就是不出现**。手动算的法线（即使视觉正确）也可能破坏阴影接收，始终用 \`GenerateNormals()\`。关联：execute_gdscript 程序化 mesh、screenshot 查阴影。
- **GLB MaterialOverride 不序列化进 .tscn**：GLB 内部 MeshInstance3D 的 MaterialOverride 不持久化（owner 设置跳过有 \`SceneFilePath\` 的子节点）。需程序化 ArrayMesh 才能自定义材质。关联：scene/edit_node 改 GLB 材质。
- **MultiMeshInstance3D + GLB pack 后不渲染**：mesh 资源引用在 pack+save 序列化时丢失。用独立 GLB 实例替代。关联：scene 实例化、save_scene。

## Headless 执行（execute_gdscript / run_and_verify）

- **★ headless RID leak errors 无害**：headless 场景构建/退出总产生 \`leaked RID\`/\`Leaked instance\`/\`ObjectDB instances\` 错误，**无害，忽略**。run_and_verify 分析错误时不应把这些当真错误误报。关联：run_and_verify、execute_gdscript。
- **\`_Ready()\` 在 \`--script\` 的 \`_Initialize()\` 不触发**：\`godot --script\` 运行 SceneTree 脚本时，实例化场景节点的 \`_Ready()\` 在 \`_Initialize()\` 期间不触发，须 \`Root.AddChild(node)\` 后手动调 init 方法。关联：execute_gdscript 完整类模式。
- **\`Free()\` vs \`QueueFree()\`**：\`QueueFree()\` 把节点留到帧末才移除，阻塞 name 重用；测试脚本里立即替换场景用 \`Free()\`。关联：execute_gdscript 测试脚本。
- **★ \`execute_gdscript --script\` 不认 GutTest → 用 \`run_tests\`**：headless CLI \`godot --script\` 要求脚本 \`extends SceneTree\`/\`MainLoop\`，直接跑 \`extends GutTest\`（Node 子类）的 GUT 测试脚本必失败，弹窗 "Can't load the script ... as it doesn't inherit from SceneTree or MainLoop"。跑 GUT 单元测试用 \`runtime\` 工具的 \`run_tests\` action——它封装 \`godot --headless --script addons/gut/gut_cmdln.gd -gdir=<test_script> -gquit\`（\`test_script\` 默认 \`res://test/\`、须 \`res://\` 前缀，I-SEC-08 防目录穿越，自动解析 Tests/Failed 计数，120s 超时）。前提：项目装了 GUT addon（\`addons/gut/gut_cmdln.gd\`）。关联：execute_gdscript、runtime(run_tests)。

## 输入与相机（game_input / screenshot）

- **Camera2D 无 Current 属性**：设当前用 \`MakeCurrent()\`，且节点须已在场景树中。关联：scene 加 Camera2D、game_input。
- **Chase camera 每帧重设 Current 覆盖测试 camera**：游戏 camera 在 \`_PhysicsProcess\` 设 \`Current=true\` 会每帧覆盖测试/捕获 harness 的 camera。测试 harness 须**每帧禁用游戏 camera**。关联：screenshot 测试、execute_gdscript。
- **相机 Lerp 首帧从原点 swoop**：\`_PhysicsProcess\` 中 \`Lerp\` 的相机首帧从 (0,0,0) 飞过来。用 \`_initialized\` flag 首帧 snap 位置，后续帧再 lerp。关联：screenshot、execute_gdscript。

## 材质与着色器（material / shader_write / shader_apply_template）

- **★ \`compile_success\` 是假绿（C-BUG-1）**：\`shader_write\` / \`shader_apply_template\` 返回的 \`compile_success: true\` **仅确认 shader 资源已分配（\`get_rid().is_valid()\`），与代码能否编译无关**——Godot 4.x headless 无可靠 shader 编译验证 API（RenderingServer 不实际编译）。AI 看到 \`compile_success: true\` 易误判 shader 正确（与 \`run_tests\` 认知缺口同类假绿）。**必须**经截图或 Godot 错误输出人工确认；返回结构里的 \`verification_note\` 文本已提示，但勿只看布尔值。关联：material(shader_write/shader_apply_template)。

## 导航（navigation / nav_create_region / nav_query_path）

- **★ \`query_path\` 静默返回空路径**：无导航数据（未创建 region 或未烘焙）时，\`query_path\` 返回 \`path: []\` + \`path_length: 0\` + \`warning: "No navigation data available"\`，**不报错**。\`create_region\` 默认 \`bake=false\`——忘记单独调 \`bake_mesh\` 则后续 \`query_path\` 静默返回空。正确工作流：\`create_region\` → \`bake_mesh\`（单独 120s 超时，其他 action 30s）→ \`query_path\`。看到空 path 先回头确认已 bake。关联：navigation(query_path/create_region/bake_mesh)。

## 节点定位与坐标实测（scene / edit_node / game_query 坐标读取 / UI 布局调试）

- **★ 三种坐标系不可混算**：Sprite2D/Node2D 系的 \`position\` 是节点原点，Sprite2D 还有 \`centered\`（true=纹理以 position 为中心绘制，false=从 position 起绘）+ \`offset\`；Control 系（TextureRect/Button/Panel 等）用 \`anchor\` + \`offset_left/right/top/bottom\`，\`position\` 是相对父节点左上角且受父 Container 布局影响，\`global_position\` 才是屏幕坐标。纸面推算「Sprite2D 视觉中心」vs「TextureRect anchor 位置」vs「Control global_position」三者极易错，必须读运行时真实值再算。关联：scene/edit_node 设坐标属性、game_query(get_node_properties) 读坐标、UI 布局调试。
- **★ 定位类问题先实测不纸面猜**：调坐标/布局/对齐时第一步用 game bridge 读真实值，不要 headless 截图（空白，见「截图与捕获」段）或纸面推算：(1) \`game_query find_nodes\` 确认真实节点路径与类型；(2) \`game_query get_node_properties\` 读 \`position\`/\`global_position\`/\`size\`/\`offset_*\`；(3) \`game_query take_screenshot\`（GPU 真渲染）+ 视觉确认实际渲染的是哪个元素；(4) 看到真实数据再改。反例：据「偏右上」反馈想当然以为是 lock 按钮、反复改 4 次无果，game bridge 实测发现根本没 lock、偏的是角标——根因就是没第一时间实测。关联：game_query/find_ui_elements、screenshot（headless 空白）；headless 截图根因见 godot-mcp-core.md「Headless 截图限制」。\`get_node_layout\` method 一次返全布局（含 \`global_position\` 成对），优先于手动拼 \`get_node_properties\` 扁平 dump。
- **★ Node3D.scale 对部分节点无效**：Node3D.xml 原文 "The behavior of some 3D node types is not affected by this property. These include Light3D, Camera3D, AudioStreamPlayer3D"。\`get_node_layout\` 照读这些节点的 scale 值，但引擎忽略——AI 勿用 scale 对这几类节点做布局推断。关联：game_query(get_node_layout) Node3D 分支。
`,

  'godot-mcp-workflow-bridge-e2e.md': `---
description: "bridge e2e 运行时验证 game_bridge_install run_project wait_for_bridge game_query ping game_input game_wait take_screenshot frame-verify 录制 回归测试 输入模拟 —— 当你需要验证运行时行为、做 E2E 测试、模拟输入或回归测试时使用"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 运行时验证 / E2E 流程

把"安装 Bridge → 启动游戏 → 连接 → 模拟输入 → 留证"串成可遵循的 checklist，避免遗漏前置步骤。工具细节见 \`godot-mcp-bridge.md\` 与 \`godot-mcp-recording.md\`。

**何时用**：需要验证运行时行为、做 E2E 测试、模拟输入、回归测试、Bug 复现时。

**checklist**：
- [ ] 1. \`game_bridge_install(project_path)\` — 一次性安装 Bridge autoload（端口 9081，写 project.godot）
- [ ] 2. \`run_project(project_path, wait_for_bridge=true)\` — 启动游戏并等 Bridge 就绪（\`bridge_timeout\` 默认 10s）
- [ ] 3. \`game_query(method="ping")\` — 确认连接（期望 \`status: "ok"\`）；未连排查：未 install / 游戏没运行 / 密钥权限
- [ ] 4. 操作 + 验证：\`game_input\`（send_key/send_mouse_click/send_text）模拟输入 → \`game_wait\`（wait_for_node/wait_for_property）等状态变化
- [ ] 5. 留证：\`take_screenshot\`（**GPU viewport 真渲染**，非 headless 空白）/ 或 \`frame-verify\`（反作弊退化检测）

**常见偏离**：
- 忘记 \`game_bridge_install\`（query/input 直接报 BRIDGE_NOT_CONNECTED）
- 游戏没运行就 query（Bridge 只在游戏运行时监听）
- 用 headless \`screenshot\` 做运行时视觉确认（headless 用 RendererDummy，2D/3D 均空白）→ 必须用 bridge \`take_screenshot\`
- 节点路径不用绝对路径（\`game_write\`/\`game_wait\` 的 \`path\` 必须以 \`/root/\` 开头）
`,

  'godot-mcp-workflow-verify.md': `---
description: "验证闭环 run_and_verify validate_scripts verify_delivery read_scene edit_script 交付门禁 编译 跨文件依赖 parse error 场景树完整性 —— 当你改完代码/场景需要验证或交付前自检时使用"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 改 → 跑 → 验证闭环

把"理解 → 改 → 跑 → 编译验证 → 交付门禁"串成 checklist，避免只跑一种验证就交付。工具细节见 \`godot-mcp-core.md\`。

**何时用**：改完代码/场景后需要验证、交付前自检时。

**checklist**：
- [ ] 1. \`read_scene\` / \`read_script\` — 理解现有结构（属性类型解析）
- [ ] 2. \`edit_script\`（**search_and_replace 优先**）/ \`write_script\` — 修改
- [ ] 3. \`run_and_verify(capture_tree=true)\` — headless 跑 + 结构化错误分析（自动识别 autoload 相关 headless_limitation）
- [ ] 4. \`validate_scripts\` — 触发 Godot 完整 \`load()\` 编译（含**跨文件依赖**，捕 headless 运行遗漏的 Parse Error）
- [ ] 5. \`verify_delivery\` — 交付门禁（场景树完整性 + 脚本健康 + 性能 + 自定义断言 + GDD 合规）

**常见偏离**：
- 只跑 \`run_and_verify\` 不跑 \`validate_scripts\`（漏跨文件编译错误——两者可能不一致，以 run_and_verify 实跑为准但 validate_scripts 补跨文件依赖）
- 运行时工具（signal/tilemap/particles 等）误认为持久化（headless 退出即丢失，持久化须 add_node + save_scene）
- 忘记 \`_mcp_done()\`（execute_gdscript 片段模式超时）
`,

  'godot-mcp-workflow-safe-edit.md': `---
description: "安全编辑 edit_script search_and_replace validate_scripts 确认令牌 remove_node headless 改盘 editor 覆盖 沙箱 防误用 CRLF tab 缩进 —— 当你编辑 .gd/.tscn、删节点或执行危险操作时使用"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced {{MCP_VERSION}}+

## 安全编辑流

编辑 \`.gd\`/\`.tscn\`、删节点、运行危险操作时的防护 checklist。工具细节见 \`godot-mcp-core.md\` 与 \`godot-mcp-editor.md\`。

**何时用**：编辑 \`.gd\`/\`.tscn\`、删节点、执行危险操作时。

**checklist**：
- [ ] 1. \`edit_script\` **优先 search_and_replace**（内容匹配、行号偏移鲁棒、CRLF 安全、免确认 token）；**禁用内置 Edit 工具改 .gd**（tab 缩进匹配率极低）
- [ ] 2. 改 \`.gd\` 后必跑 \`validate_scripts\`（验证语法）
- [ ] 3. headless 改盘 + editor 开同场景 → Ctrl+S 覆盖风险：建议 editor 内 Reload 场景或关闭该场景后再操作
- [ ] 4. 危险操作（\`remove_node\` 等）需显式确认令牌
- [ ] 5. GDScript 沙箱是**防误用层非防对抗**（间接构造可绕过；真正隔离须容器/VM + \`GODOT_MCP_ALLOW_UNSAFE=false\`）
- [ ] 6. \`write_script\`/\`edit_script\` 写 .gd 前也走沙箱扫描（与 \`execute_gdscript\` 同威胁面，发现已知危险 API 模式（含 @tool 加载即执行等，清单不列举防被侦察）阻断 SANDBOX_VIOLATION；双 opt-in 旁路 \`UNRESTRICTED + DISABLE_SAFETY\`）

**常见偏离**：
- 用内置 Edit 工具改 \`.gd\`（tab 缩进失败）
- 改完不 validate
- headless 改盘后被 editor 旧版本 Ctrl+S 覆盖（MCP 不可控，须 Reload）
`,
};
