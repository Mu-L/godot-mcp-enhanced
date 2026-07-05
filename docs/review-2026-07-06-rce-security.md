---
date: 2026-07-06
reviewer: ZCode 安全审查 (RCE 面)
scope: MCP server (TS) + Godot 编辑器插件 (GDScript)
focus: 安全 / RCE 执行面（不报其他维度）
findings: 10 条（P0×2, P1×5, P2×3）
code_changed: false
---

# 安全审查报告 — RCE 面（2026-07-06）

## 0. 审查目标与边界

**项目**：`D:\GitHub\godot-mcp-enhanced`（MCP server + Godot 编辑器插件）

**本项目最大的安全特性**：

> MCP 工具最终在用户的 Godot 编辑器进程里执行脚本/命令 = **任意代码执行面**。
> 一旦工具参数能逃逸到 `load()`/`eval`/文件写/命令执行，等于 AI 能在用户机器上执行任意代码。

**本轮只审【安全 / RCE 面】**，其他维度（功能、性能、可维护性）不报。

**深挖清单**：

1. 入口点枚举（TS 侧 `load/exec/spawn/writeFile/fs.*`、GDScript 侧 `load()/evaluate/execute/OS.execute/DirAccess/FileAccess`）
2. 动态 GDScript 执行链（gdscript-executor、inspect_node.gd、query_scene_tree.gd）
3. 路径穿越（file-scanner、install-plugin、resource-manager、screenshot 保存路径）
4. ReadOnlyGuard + editor_guards 边界
5. 网络面（WebSocket/HTTP 监听地址、鉴权机制、未授权入口）
6. 凭证与日志（token/key 硬编码、日志回显、telemetry 外泄）
7. 供应链（package.json 依赖可疑包、install-plugin.js 拉远程内容）

---

## 1. 关键架构纠正

**`execute_gdscript` 不经过 WebSocket 编辑器插件**。实际链路：

```
MCP 工具参数(code 字符串)
  → src/tools/script.ts (action="execute_gdscript")
  → src/gdscript-executor.ts (wrapSnippet 拼接 + scanGdscriptSandbox 正则扫描)
  → writeTempScript 落盘临时 .gd
  → spawn(godot --script tmp.gd) 独立 headless 进程
```

WebSocket 通道（`addons/godot_mcp_server/`）是**另一条独立路径**，专门用于运行中的编辑器交互。`command_handler.gd` 的 `match` 分发表里**没有 execute/eval 类方法**（最大危险点是受控的 `load()`）。

两条链路隔离，这是安全设计上的优点。

---

## 2. 最严重 10 条发现

> 每条格式：[等级] + 绝对路径:行号 + 问题 + 后果 + 修复 + 验证

---

### 【P0-1】沙箱可被单个环境变量彻底关闭

- **路径**：`D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:397-400, 975, 967`
- **问题**：
  三个 env 开关可让所有安全检查归零——
  - `GODOT_MCP_SANDBOX=disabled`（L397，跳过正则扫描直接返回 `[]`）
  - `GODOT_MCP_DISABLE_SAFETY=true` / 旧版 `GODOT_MCP_ALLOW_UNSAFE=true`（L975，即使扫描报警也照执行）
  - `ALLOW_EXECUTE_GDSCRIPT=false` 是 kill switch，但前两者能独立绕过它下游的代码拼接执行

  文件头注释（L10-15, L33-44）作者已自述"沙箱仅防误操作，非安全边界，GDScript 图灵完备，正则无法穷举绕过（变量间接、`Expression.execute` 分行、`call()` 非字面首参、`ClassDB.class_call` 反射）"。
- **后果**：
  客户端 `code` 经 `wrapSnippet`（L1050）原文拼进 `extends SceneTree` 脚本 → spawn Godot 执行 = 任意代码执行。
  一旦 env 被误设（CI 配置、Docker compose、共享开发机 `.envrc`），保护完全失效。
- **修复**：
  1. 将 kill switch 改为单向——`ALLOW_EXECUTE_GDSCRIPT=false` 不可被其它 flag 翻转
  2. `GODOT_MCP_DISABLE_SAFETY` / `GODOT_MCP_SANDBOX=disabled` 触发时拒绝执行而非放行，或要求与 `GODOT_MCP_UNRESTRICTED` 同时显式设置且记录审计
  3. 在 README 与 `manifest.json` 的 user_config 中明确警告这些是"开发者自担风险"开关
- **验证**：
  设 `GODOT_MCP_DISABLE_SAFETY=true` 调 `execute_gdscript` 传含 `OS.execute` 的代码，确认是否仍执行；再设 `ALLOW_EXECUTE_GDSCRIPT=false` + `GODOT_MCP_DISABLE_SAFETY=true` 确认 kill switch 是否被绕过。

---

### 【P0-2】MULTI_INSTANCE 模式下实例 HTTP 端点零鉴权

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts:169-173, 188-195, 227-229`
  - `D:\GitHub\godot-mcp-enhanced\src\core\instance-api-auth.ts:121`（`verifyApiToken` 定义，零生产调用）
- **问题**：
  MULTI_INSTANCE 启用时，TS server 通过 `fetch('http://127.0.0.1:<port>/api/<tool>', { headers: buildAuthHeaders(...) })` 向实例发请求，请求头带 HMAC Bearer token，但**接收端（实例 bridge）从不校验该 token**。
  `grep verifyApiToken src/` 仅返回定义（L121）和注释（L16-18, GodotServer.ts:170），**零调用点**。代码自带 `console.warn`（L173）明确承认 "Do NOT treat as end-to-end authentication"。
- **后果**：
  任何能访问 `127.0.0.1:<port>` 的本地进程（含低权限恶意软件、浏览器通过 fetch 到 loopback、其它 MCP server）可未授权调用 `/api/<tool>`，包括写操作工具——等于绕过整个 MCP 鉴权链直接操控 Godot 实例。
- **修复**：
  在实例 HTTP/TCP server 入口接线 `verifyApiToken`（接收端校验 `Authorization` 头，TTL 60s + nonce 防重放，逻辑已在 instance-api-auth.ts 写好只差接线）；或禁用 MULTI_INSTANCE 的对外端点直到接线完成。
- **验证**：
  MULTI_INSTANCE 模式下用不带 token 的 curl POST 到实例 `/api/some_tool`，确认是否被拒（当前预期：200 通过）。

---

### 【P1-3】`godot_advanced_tool` 动态路由绕过 ReadOnlyGuard

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\tools\advanced-proxy.ts:152-194, 191, 243`
  - `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts:261`
- **问题**：
  `godot_advanced_tool` 自身标记 `readonly: true`（L243），始终通过 `ReadOnlyGuard.check`（ToolDispatcher.ts:261）。其 `handleTool` 有两条路径：
  1. **delegateCall**（L149）针对已注册工具，会重入 `handleCall` 重新跑 guard——**安全**
  2. **动态路由**（L191 `_dynamicSender`）针对未注册的 `godot_*` 工具，直接 HTTP POST 到实例 bridge，**不再回到 ToolDispatcher，不跑 ReadOnlyGuard**

  注释（L241-242）声称 "target tool 的 readonly 检查在 handleCall 中间件链里"——只对路径①成立。`dynamic` 组激活与否（L165-169）不受 ReadOnlyGuard 控制。
- **后果**：
  `GODOT_MCP_READ_ONLY=true`（只读部署）下，启用 `dynamic` 组后，客户端可构造任意 `godot_<category>_<action>` 工具名经 advanced-proxy 发到实例，执行写操作，绕过只读策略。
- **修复**：
  动态路由路径在调用 `_dynamicSender` 前补一次 guard——要么用目标 route 名查 `dynamic` 组工具的 readonly 标记，要么在只读模式下整体拒绝动态路由；或把 `godot_advanced_tool` 标记为非只读。
- **验证**：
  `GODOT_MCP_READ_ONLY=true` + `dynamic` 组激活，调 `godot_advanced_tool` 传一个未注册的写操作工具名，确认是否被只读模式拦截（当前预期：放行）。

---

### 【P1-4】`GODOT_MCP_UNRESTRICTED=true` 一键关闭所有路径校验

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\core\path-utils.ts:222-225`
  - `D:\GitHub\godot-mcp-enhanced\src\helpers.ts:105`
- **问题**：
  `isPathInAllowedRoots`（path-utils.ts:222）和 `allowOutsideProjectPaths`（helpers.ts:105）都判断 `GODOT_MCP_UNRESTRICTED === 'true'` 时直接返回 true，跳过 `ALLOWED_PROJECT_PATHS` 白名单和 `resolveWithinRoot` 的 UNC/device/段级 `..`/realpath 五层校验。
  这意味着所有文件 IO 工具（write_script、save_scene、screenshot output_path、data-import output_dir 等）可写到任意绝对路径。
- **后果**：
  一旦该 env 被设（开发者为图方便开 dev mode 后忘记关、容器镜像默认带、CI 注入），客户端可经 `script.write_script` 写到 `C:\Windows\...`、用户启动目录、SSH key 等任意位置 → 持久化/提权。
- **缓解现状**：
  `buildSafeEnv`（helpers.ts:138-165）正确从子进程剥离该变量，但**父 MCP server 进程自身**仍读它，所有 TS 侧工具的 IO 都受影响。
- **修复**：
  1. 该开关仅在 `NODE_ENV=development` 下生效，生产模式硬拒绝
  2. 触发时在启动日志和每次工具调用时打显眼审计警告
  3. 文档明确"绝不在生产/共享机设置"
- **验证**：
  `GODOT_MCP_UNRESTRICTED=true` 下调 write_script 传 `file_path=C:/Users/x/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/test.bat`，确认是否被拒（当前预期：写入成功）。

---

### 【P1-5】`execute_gdscript` 内部可信旁路被多处业务代码调用

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:476-479`（`executeGdscriptTrusted` 用 Symbol 跳过沙箱）
  - 调用点：
    - `D:\GitHub\godot-mcp-enhanced\src\tools\material-ops.ts:776`
    - `D:\GitHub\godot-mcp-enhanced\src\tools\recording.ts:253, 281`
    - `D:\GitHub\godot-mcp-enhanced\src\tools\data-import.ts:328`
- **问题**：
  `executeGdscriptTrusted` 用 Symbol 标记绕过 `scanGdscriptSandbox`，本意只服务内部生成的代码。但调用方拼接的脚本里混入了**外部输入**：
  - `data-import.ts:328` 把 CSV 数据（用户提供的文件内容）转成 GDScript 资源
  - `material-ops.ts` 把 material 参数嵌入脚本

  若这些参数/数据里能注入 GDScript 语法（如未转义的字符串引号、`];OS.execute(...);var x=[`），即可在 Trusted 通道执行任意代码。
- **后果**：
  攻击面从"`execute_gdscript` 工具的 `code` 参数"扩展到"任何经 data-import/material-ops/recording 传入的数据文件/参数"——这些工具的 schema 不提示 RCE 风险，客户端/AI 可能传不可信数据。
- **修复**：
  1. 审计每个 Trusted 调用点的输入转义（重点：字符串字面量是否 `quote()` / `JSON.stringify` 而非裸拼）
  2. Trusted 通道也跑 Phase 2 字符串拼接检测（`detectStringConcatBypass`）作为底线
  3. data-import 解析 CSV 时拒绝含 GDScript 元字符的单元或强制转义
- **验证**：
  构造含 `","\"]\nOS.execute(\"cmd\",[\"/c\",\"calc\"])\nvar _=[\"` 的 CSV/参数喂给 data-import/material-ops，确认是否触发执行。

---

### 【P1-6】Game Bridge `GODOT_MCP_BRIDGE_EXTRA_METHODS` 可扩任意方法白名单

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\scripts\mcp_bridge.gd:706-714`（env 扩展）
  - `D:\GitHub\godot-mcp-enhanced\src\scripts\mcp_bridge.gd:694-723`（`call_method` 白名单 + `callv`）
  - `D:\GitHub\godot-mcp-enhanced\src\helpers.ts:141-143`（`buildSafeEnv` 放行 `GODOT_MCP_BRIDGE_*`）
- **问题**：
  运行时桥的 `call_method` 有 `ALLOWED_METHODS` 白名单（L55-61，仅只读方法如 `get_position`/`get_name`），但 `GODOT_MCP_BRIDGE_EXTRA_METHODS` env（L706-712）允许运行时追加任意方法名到白名单，`node.callv(method, args)`（L723）随即执行。
  `set_node_property` 虽有 `BLOCKED_PROPERTIES`（L46-51 含 `script`），但 `call_method` 无属性黑名单联动。
- **后果**：
  1. 若 env 被设（配置文件、启动脚本），本地任何连到 bridge 9081 端口的进程可调用 `queue_free`/`set_script`/`add_child` 等结构性方法改变运行时行为
  2. `set_node_property` 的 BLOCKED 仅挡 `script` 等少数属性，`process_mode`/`owner`/`filename` 等可能被滥用
  3. 注意 `buildSafeEnv`（helpers.ts:141-143）**主动放行** `GODOT_MCP_BRIDGE_*` 前缀变量到子进程，意味着父进程设的该 env 会传给 bridge 进程
- **修复**：
  1. EXTRA_METHODS 加入时校验方法名不在危险集（`set_script`/`queue_free`/`add_child`/`call`/`callv`）
  2. 对 EXTRA_METHODS 的调用额外审计日志
  3. `set_node_property` 的 BLOCKED_PROPERTIES 扩充并考虑联动 `call_method`
- **验证**：
  设 `GODOT_MCP_BRIDGE_EXTRA_METHODS=set_script,queue_free`，通过 bridge 调 `call_method` 传 `set_script` + 恶意脚本资源路径，确认是否执行（当前预期：执行）。

---

### 【P1-7】`editor_guards.gd` 的 `force=true` 客户端可直传绕过写检查

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\editor_guards.gd:99-102`
  - `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd:191-200, 196`
- **问题**：
  `guard_text_resource_write(path, force=false)` 在 `force=true` 时直接 `return {}` 放行（L101-102）。
  `command_handler.gd:196` 的 `force` 直接取自 `params.get("force", false)`，无服务端校验。任何已认证的 WS 客户端可发 `{"method":"guard_text_resource_write","params":{"path":"res://main.gd","force":true}}` 拿到 `{"status":"ok"}`。
- **现状缓解**：
  当前 `src/` 下**零调用**此 GDScript 方法（grep 仅返回 `static-grep.ts:121` 的展示映射常量），TS 写脚本走自己的路径不经此守卫。所以是**潜在旁路**而非活跃旁路——一旦未来 `script` 工具改为经编辑器预检查写入，立即激活。
- **后果**：
  守卫被设计为"防止覆盖编辑器打开中的脚本/shader"，`force=true` 使其失效，可能导致覆盖用户未保存的代码或损坏正在编辑的资源。
- **修复**：
  1. 服务端忽略客户端 `force`，由内部逻辑决定
  2. 或要求 `force=true` 必须配合确认 token（复用 confirm_and_execute 机制）
- **验证**：
  连编辑器 WS 发 `guard_text_resource_write` 带 `force:true` 指向一个打开中的脚本，确认返回（当前预期：`status:ok`）。

---

### 【P2-8】编辑器 WebSocket secret 明文落盘且多用户主机不安全

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:48, 91, 187`
  - `D:\GitHub\godot-mcp-enhanced\src\core\editor-auth.ts:53, 71-78`
- **问题**：
  32 字节随机 secret 写入 `.godot/mcp_editor.key`，已做 `0600`/`icacls` 收紧 + TS 侧 symlink 检查（editor-auth.ts:71-78 `lstatSync` 拒符号链接）。但：
  1. secret 经 WS 明文传输（无 TLS，loopback 内可接受）
  2. GDScript 侧权限收紧用 `OS.get_environment("USERNAME")`（websocket_server.gd:120-122）可被环境变量伪造，而 TS 侧已改用 `os.userInfo().username`（C-ARC-01 修正）——两侧不一致
  3. 共享主机/多用户系统下 `.godot/` 在项目目录内，同机其它用户若拿到项目目录读取权限（或项目被同步到云盘）即泄露 secret
- **后果**：
  本地低权限用户/恶意进程拿到 secret 后可连编辑器 WS 执行任意已认证命令（add_node/save_scene 等写操作）。
- **修复**：
  1. GDScript 侧也改用不可伪造的用户名来源（或与 TS 侧统一用 `os.userInfo()` 传递）
  2. secret 存 `user://` 而非项目 `.godot/`（避免随项目分发）
  3. 文档警告共享主机风险
- **验证**：
  在共享用户机器上用另一普通用户读 `.godot/mcp_editor.key`，确认权限（当前：仅所有者可读）。

---

### 【P2-9】`scanGdscriptSandbox` Phase 2 仅检测字符串字面量拼接，遗漏间接构造

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:405-435`（Phase 1 skeleton 正则）
  - `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:431`（Phase 2 detectStringConcatBypass）
- **问题**：
  沙箱分两阶段：
  - Phase 1 在 skeleton（剥去字符串/注释）上正则匹配危险 API
  - Phase 2 检测字符串字面量拼接重构绕过

  但漏掉：
  1. 变量间接——`var f="OS"; f.execute(...)`、`var m="execute"; OS.call(m,...)`
  2. `Expression.execute()` 经分行/Unicode 空格拆分绕正则
  3. `ClassDB.class_call("OS","execute",...)` 反射
  4. 数组/字典动态构造方法名后 `callv`

  作者在文件头注释（L10-15, L33-44）已诚实承认 "非安全边界"。
- **后果**：
  技术足够的攻击者（或运气好的 prompt）可在 `GODOT_MCP_DISABLE_SAFETY=false`（即沙箱正常开启）下绕过正则，触发 `OS.execute`/网络回连/文件写。
- **缓解现状**：
  这是 MCP-in-Godot 类工具的固有限制——GDScript 图灵完备，无法在 TS 侧静态保证安全。真正的隔离应靠进程沙箱（容器/seccomp）而非正则。
- **修复**：
  1. 文档与工具描述（script.ts:233 已部分提示）必须把"沙箱非安全边界"告知 AI 和用户
  2. 推荐 `execute_gdscript` 默认在受限环境（无网络、只读 FS、drop 权限）运行 godot
  3. 提供 `ALLOW_EXECUTE_GDSCRIPT=false` 作为生产部署的推荐默认
- **验证**：
  构造 `var a="OS"; a.execute("calc",[])` 类 payload，确认沙箱是否报警（当前预期：Phase 1 skeleton 剥字符串后 `a.execute` 不匹配 `OS.execute`，漏报）。

---

### 【P2-10】`logger.sanitizeMsg` 不脱敏消息体，依赖调用方自律

- **路径**：
  - `D:\GitHub\godot-mcp-enhanced\src\core\logger.ts:61, 105-118, 122-124`
- **问题**：
  `sanitizeMeta`（L105-118）对 meta 对象的 **key 名** 匹配 `SENSITIVE_RE = /password|secret|token|key|auth/i` 则跳过整条；但 `sanitizeMsg`（L122-124）仅 `truncate` 到 200 字符，**不做值级脱敏**。
  若调用方把 secret 值拼进 `msg` 字符串（而非放进 meta 的敏感 key），原样落盘。
- **现状**：
  审查所有 auth 调用点（editor-auth.ts、instance-api-auth.ts、game-bridge.ts），当前都是拼 `secretPath`/`err.message` 进 msg，不含 secret 值本身——**暂无活跃泄露**。但这是脆弱设计：未来新增调用方若不自律即泄露。
- **后果**：
  secret 值（editor WS 鉴权密钥、bridge secret、API HMAC secret）可能进入日志文件（`resolveLogDir()` 下的滚动日志），日志若被收集/同步即泄露。
- **修复**：
  1. `sanitizeMsg` 也对值做 `SENSITIVE_RE` 匹配并脱敏（如把疑似 token 的 hex 串替换为 `***`）
  2. 或强制 secret 值只能经 meta 传递，禁止拼进 msg（lint 规则约束）
- **验证**：
  临时在某个 logger 调用里拼 `msg: "secret=abc123"`，确认日志输出（当前预期：原样记录）。

---

## 3. 总评

### 最危险组合

**P0-1 和 P0-2** 叠加 = 在 MULTI_INSTANCE + 误设 env 的部署下：

```
本机任意进程 → 实例 bridge (无鉴权) → 任意工具 → Godot 执行任意代码
```

### 值得肯定的设计

| 设计 | 位置 | 评价 |
|---|---|---|
| 所有网络监听绑定 `127.0.0.1` | EditorConnection.ts:126-128（还硬拒非 localhost） | 无对外暴露面 |
| `buildSafeEnv` 剥离安全开关 | helpers.ts:138-165 | 防子进程自解锁 |
| editor/bridge secret | websocket_server.gd:141-166 + editor-auth.ts | 32 字节随机 + 常时比较 + 锁定 + symlink 检查 |
| 路径校验 `resolveWithinRoot` | path-utils.ts:153-187 | UNC/device/URL解码/段级`..`/realpath 五层防御 |
| `install-plugin.js` | scripts/install-plugin.js | 纯本地复制，无远程下载，无 postinstall 钩子 |
| 无 telemetry/analytics | 全仓 | 无外报，无硬编码密钥 |
| execute_gdscript 走独立 spawn 链 | gdscript-executor.ts | 不经 WebSocket，与编辑器插件隔离 |

### 审查未发现

- 编辑器 WebSocket 插件侧的 `eval`/`Expression.execute`/`set_script` 等直接执行客户端字符串的活跃路径
- 硬编码的 API key / password
- 可疑/恶意 npm 包
- 对外网络监听（`0.0.0.0`）

### 修复优先级建议

| 优先级 | 编号 | 一句话 |
|---|---|---|
| **立即** | P0-2 | 接线 `verifyApiToken` 或禁用 MULTI_INSTANCE 对外端点 |
| **立即** | P0-1 | 让 kill switch 单向，禁止单 env 关闭整个沙箱 |
| 高 | P1-4 | `GODOT_MCP_UNRESTRICTED` 限制为 dev-only |
| 高 | P1-3 | 动态路由补 ReadOnlyGuard |
| 高 | P1-5 | 审计 Trusted 通道输入转义 |
| 中 | P1-6 | EXTRA_METHODS 危险方法黑名单 |
| 中 | P1-7 | 服务端忽略客户端 `force` |
| 低 | P2-8/9/10 | 加固与文档 |

---

## 4. 审查方法

- 入口建图：枚举 TS/GDScript 源文件，识别 MCP 工具 → WebSocket → Godot 执行链
- 七路并行深挖（动态执行 / 路径穿越 / Guard 边界 / 网络鉴权 / 凭证日志 / 供应链）
- 关键发现交叉验证（亲眼读原始代码确认行号与逻辑）
- 仅报最严重 10 条，不凑数，不改代码

**审查未修改任何代码**。

---

## 5. 核实记录（2026-07-06，接收审查侧独立核实）

> 本节由接收审查侧（主审）独立核实：亲验调用链 + grep + 源码读取，非报告作者。用户选"全部可修的都修"。

### 核实结论汇总

| 编号 | 报告定级 | 核实结论 | 处置 |
|------|---------|---------|------|
| P0-1 | P0 | **降级**：含错误前提（kill switch 无法被绕过） | 部分修（双开关加固） |
| P0-2 | P0 | **误判**（接收端根本不存在） | 不修（已有充分自标注） |
| P1-3 | P1 | 理论缺陷，可利用性极低（需 MULTI_INSTANCE+外部实例） | 修（动态路由补只读拦截） |
| P1-4 | P1 | 设计意图，已有审计 | 不修（dev opt-in） |
| P1-5 | P1 | **不成立**（注入路径不存在） | 不修（push back） |
| P1-6 | P1 | 真实缺陷（EXTRA_METHODS 无黑名单） | 修 |
| P1-7 | P1 | 潜在非活跃（src/ 零调用，YAGNI） | 修（防未来激活） |
| P2-8 | P2 | 部分成立，已自标注威胁有限 | 不修（设计权衡） |
| P2-9 | P2 | 作者已自述非安全边界 | 不修（固有限制） |
| P2-10 | P2 | 脆弱设计，非活跃泄露 | 修（sanitizeMsg 值脱敏） |

### 误判更正

**P0-2（MULTI_INSTANCE 零鉴权）误判**：报告称"接收端不验证 token"。实际 `grep createServer|http.createServer|listen|/api/` 证明 src 下无任何 HTTP 服务端创建。`instance-api-auth.ts:13-18` + `GodotServer.ts:169-173` 双处明确自述"HTTP /api/<tool> 接收端在本仓库未实现，verifyApiToken 零生产调用"，启动时 `console.warn`。`sendToInstance`/`dynamicSender`（GodotServer.ts:188/227）是**发送端 fetch**，目标端口属外部注册实例。一个不存在的端点谈不上"被未授权调用"。与 07-06 security-reliability 核实结论一致。

**P1-5（Trusted 旁路注入）不成立**：报告点名的两例均不成立。`data-import.ts:323-327` 把 CSV 写临时文件（`writeTmpCsv`），GDScript 用 FileAccess 读——**数据零进脚本源码**（注释明确"CRITICAL-1 注入根治"），`generateImportScript` 只收临时文件路径。`material-ops.ts:426/535` 用 `gdEscape(JSON.stringify(code))` 序列化，外部输入作为 JSON 字符串字面量，非裸拼 `%s`。

**P0-1 含错误前提**：报告称"前两者能独立绕过 kill switch 下游执行"。实际 `ALLOW_EXECUTE_GDSCRIPT=false`（`gdscript-executor.ts:967`）在 sandbox 扫描（L973）和 safetyDisabled 检查（L976）**之前**直接 return，无法被下游 flag 绕过。

### 已修复 5 条

1. **P1-6** `src/scripts/mcp_bridge.gd`：新增 `EXTRA_METHODS_BLOCKLIST` const（set_script/queue_free/free/add_child/remove_child/call/callv/emit_signal/connect/disconnect），`_cmd_call_method` 在 EXTRA_METHODS 匹配后补黑名单检查（error -6）。
2. **P1-7** `addons/godot_mcp_server/command_handler.gd:197`：删除 `var force = params.get("force", false)`，`guard_text_resource_write(guard_path, false)` 永远传 false，客户端 force 失效。
3. **P0-1** `src/gdscript-executor.ts`：`GODOT_MCP_DISABLE_SAFETY`/`ALLOW_UNSAFE`/`SANDBOX=disabled` 改为双开关（需同时 `GODOT_MCP_UNRESTRICTED=true` 才生效）。
4. **P2-10** `src/core/logger.ts:122`：`sanitizeMsg` 增加 KV 模式值脱敏（复用 SENSITIVE_RE 词表，匹配 `key(:|=)value` 替换值为 ***）。
5. **P1-3** `src/tools/advanced-proxy.ts`：动态路由分支调用 `_dynamicSender` 前补只读拦截（`GODOT_MCP_READ_ONLY=true` → READ_ONLY 错误）。

### 测试验证

- 全量 vitest：**209 files, 3524 passed + 6 skipped**（5 新用例 + 现有全通过，无回归）
- GDScript 编译：`command_handler.gd`（addon --import 4.7 通过）、`mcp_bridge.gd`（4.7+4.6.2 parse OK）

### 未修（push back / 设计意图 / YAGNI）

- **P0-2**：误判，已有充分自标注（`instance-api-auth.ts:13-18` + `GodotServer.ts:169-173` + console.warn）
- **P1-4**：`GODOT_MCP_UNRESTRICTED` 是 dev opt-in 总开关，已有 info+debug 双审计（`path-utils.ts:224/228`），`buildSafeEnv` 已剥离子进程
- **P1-5**：注入路径不存在（FileAccess 读 + JSON.stringify+gdEscape）
- **P2-8**：secret 落盘 `.godot/` 是设计（editor-auth.ts 读取路径依赖），已 icacls 收紧 + symlink 检查；USERNAME 不一致已自标注（`websocket_server.gd:112-113` 威胁有限）
- **P2-9**：沙箱非安全边界，作者文件头已诚实自述（GDScript 图灵完备，正则无法穷举绕过，真隔离靠进程沙箱）
