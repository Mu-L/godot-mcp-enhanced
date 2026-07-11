# editor PERSISTENT_SECRET — Design Spec

> 2026-07-11 · 对称移植 bridge 端 S4 固定 secret 模式到 editor 侧

## 背景与动机

editor 插件 `addons/godot_mcp_server/websocket_server.gd:48` 的 `_ready()` 每次启动无条件调 `_generate_and_write_secret()` 覆盖写 `mcp_editor.key` + `_restrict_secret_permissions` 收紧 ACL。

这是 `c75317a`（:R→:M）修复的根因——plugin 同 USERNAME 身份覆盖写被只读 ACL 拒 → secret 文件停旧值/内存换新值 → MCP auth 失败 → 降级 headless 死循环。`:M` 是缓解（让覆盖写能成功），但每次重生仍带来 MCP 端 5min TTL 缓存与 plugin 内存 secret 的同步窗口。

bridge 端 `src/scripts/mcp_bridge.gd:216-226,441-443` 已有 S4 治本方案：env `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true` 时复用现有 secret（不重生/不收紧/不删），彻底打破死循环。**editor 侧缺少对称机制**。

## 目标

给 editor 侧加固定 secret 模式（对称 bridge S4），治本消除 `_ready` 覆盖写需求。本地测试 opt-in，生产默认关闭。

## 非目标

- 不改变生产默认行为（默认 false，生产每次重生保持 secret 轮换安全）
- 不改 TS 端 `editor-auth.ts` 读逻辑
- 不退回 ACL `:R`（`:M` 保留作非 PERSISTENT 模式的缓解）
- 不涉及 editor 写入 E2E（#2）/ asset_undo 卡 30s（#3）——独立任务

## 方案

对称移植 bridge `mcp_bridge.gd:219-226,441-443` 到 `websocket_server.gd`。

### 改动点 1：`_generate_and_write_secret`（websocket_server.gd:51）加 PERSISTENT 复用分支

现状顺序：`_secret = _generate_secret()`（:55）→ project_dir/godot_dir（:60-67）→ `_secret_file` 赋值（:68）→ 写文件 + `_restrict`（:69-97）。

PERSISTENT 复用需在 `_secret_file` 赋值后、`_generate_secret` 前判断。**实现需重排**：把 project_dir/godot_dir/`_secret_file` 赋值提前到 `_generate_secret` 之前，插入 PERSISTENT 分支：

```gdscript
# (project_dir / godot_dir / _secret_file 赋值后)
# S4-editor: 固定 secret 模式(本地测试, env GODOT_MCP_EDITOR_PERSISTENT_SECRET=true)。
# mcp_editor.key 存在且有效则复用,跳过重生+写入+_restrict,打破"重生→覆盖写→
# MCP 端 TTL 缓存不同步"窗口(对称 bridge mcp_bridge.gd:216-226 S4)。默认 false。
var _persistent_secret := OS.get_environment("GODOT_MCP_EDITOR_PERSISTENT_SECRET").to_lower() == "true"
if _persistent_secret and FileAccess.file_exists(_secret_file):
    var _existing := FileAccess.get_file_as_string(_secret_file)
    if _existing.length() >= 32:
        _secret = _existing
        print("[MCP] Reusing persistent editor secret (GODOT_MCP_EDITOR_PERSISTENT_SECRET=true)")
        return  # 不调 _start_server — 由 _ready:49 统一调(避免双重调用致 TCPServer 孤儿,见下方注)
_secret = _generate_secret()
# ... 原写文件 + _restrict 逻辑
```

> 注：原 `_ready:48-49` 是 `_generate_and_write_secret()` 后接 `_start_server()`（两个独立调用，`_generate_and_write_secret` **不**内含 `_start_server`）。PERSISTENT 复用早 return 前**不**调 `_start_server`——直接 return，由 `_ready:49` 统一启动。若在分支内调会双重调用：`_start_server` 每次执行 `_server = TCPServer.new()`，第一次建的 server 成孤儿（占 9090 未 stop），第二次 listen 9090 失败退到 9091，`_process` 只操作后者 → 连 9090 的客户端成死连接。bridge S4（`mcp_bridge.gd:221-226`）无此问题因 bridge 是 `listen→secret` 顺序，editor 是 `secret→server` 反序，须靠 `_ready:49` 兜底。

### 改动点 2：`_delete_secret_file`（:174）加 PERSISTENT guard

```gdscript
func _delete_secret_file() -> void:
    var _persistent_secret := OS.get_environment("GODOT_MCP_EDITOR_PERSISTENT_SECRET").to_lower() == "true"
    if _persistent_secret:
        return  # S4-editor: 固定 secret 模式不删(持久化供下次复用 + 与 MCP 端缓存同步)
    if _secret_file != "" and FileAccess.file_exists(_secret_file):
        DirAccess.remove_absolute(_secret_file)
    _secret_file = ""
```

bridge 在 `_exit_tree:441-443` 内联检查；editor 复用 `_delete_secret_file` 封装、在函数头加 guard 更干净（`_exit_tree:413` 调用处无需改）。

### 改动点 3：rule template 源 `src/tools/rule-templates.ts`（review 纠正：改 template 源，非生成物 .md）

> **review 发现的 spec gap**：`.claude/rules/godot-mcp-editor.md` 是 `project.ts:453` 从 `DETAILED_RULE_TEMPLATES`（`rule-templates.ts`）生成的产物，直接改会被下次 `setup_project_rules` 覆盖。改 template 源才持久。详见 plan Task 3（已实现 commit e3dc620）。

editor template「常见陷阱」段加一条（对称 bridge 的密钥权限循环条目）：

> - **editor 固定 secret（S4-editor）**：设环境变量 `GODOT_MCP_EDITOR_PERSISTENT_SECRET=true`，editor plugin 复用现有 `mcp_editor.key`（不重生、不收紧 ACL、`_exit_tree` 不删除），彻底消除 `_ready` 覆盖写需求及 MCP 端 TTL 缓存同步窗口。仅本地测试用（安全降级——secret 固定不再轮换，生产保持默认 false）。对称 bridge `GODOT_MCP_BRIDGE_PERSISTENT_SECRET`（见 godot-mcp-bridge.md「密钥权限循环」）。

### 改动点 4：`src/helpers.ts` buildSafeEnv 透传 GODOT_MCP_EDITOR_*（review 发现的 spec gap）

> **review 发现**：`launch_editor`（`runtime.ts:128`）用 `buildSafeEnv()` spawn Godot 编辑器子进程，而 `buildSafeEnv`（`helpers.ts:141`）只透传 `GODOT_MCP_BRIDGE_*` 前缀 → `GODOT_MCP_EDITOR_*` 被截断 → editor plugin `OS.get_environment()` 读空 → PERSISTENT 永不触发。bridge 能工作正因为 `BRIDGE_*` 在白名单（`helpers.test.js:317` 专门测）。

白名单扩展 `GODOT_MCP_BRIDGE_` → `BRIDGE_`‖`EDITOR_`（对称 bridge）。安全边界不退化（服务端安全开关 UNRESTRICTED/ALLOW_UNSAFE/ALLOW_EXECUTE_GDSCRIPT/ALLOWED_PROJECT_PATHS 仍 strip）。详见 plan Task 1（已实现 commit 89ae910）。

## 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| env 名 | `GODOT_MCP_EDITOR_PERSISTENT_SECRET` | editor 专用，与 `GODOT_MCP_BRIDGE_*` 平行命名；两 secret 独立文件（`mcp_editor.key` / `mcp_bridge_9081.secret`） |
| 默认值 | `false` | 生产每次重生保持 secret 轮换安全；仅本地测试 opt-in |
| TS 端 | 不改 | 读逻辑不变；PERSISTENT 时 key 稳定，`:M` 含 Read，plugin 能读 |
| ACL | 保留 `:M` | 非 PERSISTENT 模式仍需 `:M` 缓解覆盖写；PERSISTENT 模式跳过 `_restrict` |
| 复用阈值 | `length >= 32` | 对称 bridge；防复用截断/空文件 |

## 验证

1. `godot --headless --import --path <test-project>`（4.7 编译干净，无 parse error）——本会话 `GODOT_PATH=D:\godot\Godot_v4.7-stable_win64.exe`
2. 注释自洽（env 名 / 默认值 / 对称引用一致）
3. 核对 `_secret_file` 赋值点与 PERSISTENT 分支可见性、`_start_server()` 仅由 `_ready:49` 单次调用（PERSISTENT 早 return 不自调，避免双重调用）

## 风险

- **顺序重排**：`_generate_and_write_secret` 内 `_secret_file` 赋值提前，须保证 project_dir 为空时的早 return 路径（:61-63）仍正确（PERSISTENT 分支在 project_dir 校验之后）
- **_start_server 单次性**：PERSISTENT 早 return 前**不**调 `_start_server()`，由 `_ready:49` 统一调（方案 1）。若误在分支内调会双重调用致 TCPServer 孤儿 + 端口错位（9090 孤儿 / 9091 实际监听），见改动点 1 注释
