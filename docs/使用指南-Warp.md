# 在 Warp 终端中接入 godot-mcp-enhanced

> **版本**：0.19.1 ｜ **适用 Warp**：支持 MCP 的版本（2025+）｜ **适用 Godot**：4.x（4.6+ 已测试）
>
> **验证状态**：✅ 协议层实测通过（initialize 握手 + tools/list 全工具发现）｜ ⚠️ 未经 Warp GUI 端到端实测（撰写时本机未安装 Warp）。配置方法基于 [Warp 官方 MCP 文档](https://docs.warp.dev/agent-platform/capabilities/mcp/) + Warp 源码级研究 + 协议层实测。

---

## 这份指南解决什么

[Warp](https://www.warp.dev/) 是内置 AI agent 的现代终端，agent 通过 MCP（Model Context Protocol）调用外部工具。godot-mcp-enhanced 是一个 **stdio MCP 服务端**，Warp 是一个 **stdio MCP 客户端**——两者在协议层天然匹配。本文档给出三种接入方式、完整配置示例、兼容性核对表，以及一份可复现的协议层验证方法。

如果你只想快速跑起来，看 [§2 方式 A（GUI）](#方式-a-warp-gui推荐新手) 或 [§2 方式 C（复用 Claude Code 配置）](#方式-c复用-claude-code-配置零配置最强)。

---

## 1. 兼容性结论速览

| 维度 | 结论 | 依据 |
|------|------|------|
| **stdio 传输** | ✅ 完美匹配 | Warp CLI Server = stdio 子进程；godot-mcp = stdio 服务端 |
| **工具发现** | ✅ 29 个工具全列出 | 协议层实测（见 [§6](#6-验证)） |
| **inputSchema** | ✅ 29/29 完整 | Warp 的 `mcp_context` 需要工具 schema，全部就绪 |
| **integer 参数强转** | ✅ 无风险 | godot-mcp 数值参数用 `number` 而非 `integer`，**不触发** Warp 的 `coerce_integer_args` |
| **env 变量传递** | ✅ 支持 | Warp `env` 字段直传 `GODOT_PATH` / `ALLOWED_PROJECT_PATHS` |
| **权限** | ⚠️ 首次调用需确认 | Warp 默认 `AgentDecides` profile，首次调工具弹确认（见 [§7](#7-权限与安全)） |
| **Windows 启动** | ✅ 可用 | Warp 在 Windows 用 `cmd.exe /c` 包裹 `npx`，能正确解析 PATH |

> **结论**：godot-mcp-enhanced 与 Warp 在协议层完全兼容，无已知阻塞。下文展开。

---

## 2. 三种配置方式

### 方式 A：Warp GUI（推荐新手）

打开 Warp：**Settings > Agents > MCP servers > + Add > CLI Server (Command)**，填入：

| 字段 | 值 |
|------|-----|
| **command** | `npx` |
| **args** | `["-y", "godot-mcp-enhanced"]` |
| **env** | 见 [§4 环境变量](#4-环境变量)（至少建议设 `ALLOWED_PROJECT_PATHS`） |
| **working_directory** | **你的 Godot 项目根目录**（强烈建议，见 [§5](#5-️-working_directory-为什么必须显式设)） |

Warp 会在启动时 spawn 该命令、退出时关闭它。

### 方式 B：file-based（`.warp/.mcp.json`）

把配置写成文件，Warp 自动检测并 spawn：

- **全局**（所有项目可用）：`~/.warp/.mcp.json`
- **项目级**（仅当前项目）：`<项目根>/.warp/.mcp.json`

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "godot-mcp-enhanced"],
      "env": {
        "ALLOWED_PROJECT_PATHS": "/path/to/your/godot/project",
        "GODOT_PATH": "/path/to/godot"
      },
      "working_directory": "/path/to/your/godot/project"
    }
  }
}
```

> **安全门**：Warp 对 file-based MCP 配置有审批闸——配置文件编辑需手动批准；**项目级**配置（如克隆的仓库里的 `.warp/.mcp.json`）**不会自动 spawn**，必须在 MCP servers 页手动开启，防止恶意仓库自动执行本地命令。

### 方式 C：复用 Claude Code 配置（零配置，最强）

**关键发现**：Warp 原生读取 Claude Code 的 MCP 配置文件，无需重复配置。

1. 如果你已按 [使用指南 §2.1](使用指南.md#21-claude-code-全局安装推荐) 执行过：
   ```bash
   claude mcp add -s user godot -- npx -y godot-mcp-enhanced
   ```
   该配置已写入 `~/.claude.json`。
2. 在 Warp：**Settings > Agents > MCP servers**，开启 **Auto-spawn servers from third-party agents**。
3. Warp 自动发现并启动 `godot` server——**零额外配置**。

> **原理**：Warp 支持读取多家 agent provider 的配置文件（`~/.warp/.mcp.json`、`~/.claude.json`、`~/.codex/config.toml`、`~/.agents/.mcp.json`）。全局 Warp 配置默认 auto-spawn；第三方 provider（含 Claude Code）的全局配置需开启上述开关。

---

## 3. 完整配置示例（含全部常用 env）

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "godot-mcp-enhanced"],
      "env": {
        "ALLOWED_PROJECT_PATHS": "D:/my-game;D:/another-project",
        "GODOT_PATH": "D:/Godot_v4.6.3-stable_win64.exe",
        "GODOT_PROJECT_PATH": "D:/my-game"
      },
      "working_directory": "D:/my-game"
    }
  }
}
```

---

## 4. 环境变量

| 变量 | 说明 | 建议 |
|------|------|------|
| `ALLOWED_PROJECT_PATHS` | 允许访问的项目根（分号分隔），deny-by-default | **必设**——不设则 godot-mcp 仅允许 `process.cwd()`，而 Warp 的 cwd 通常不是你的 Godot 项目 |
| `GODOT_PATH` | Godot 可执行文件路径 | 不设则自动搜索 PATH / 注册表 / Scoop / Downloads |
| `GODOT_PROJECT_PATH` | 默认项目路径 | 设了可省去每次工具调用传 `project_path` |
| `GODOT_MCP_UNRESTRICTED` | `true` = 禁用路径限制 | ⚠️ 仅开发环境，生产勿用 |
| `GODOT_MCP_SANDBOX` | `disabled` / `strict` / 默认 | 控制执行 GDScript 前的危险模式扫描 |

> 完整变量表见 [使用指南 §13](使用指南.md#13-环境变量参考)。

---

## 5. ⚠️ `working_directory` 为什么必须显式设

这是 Warp 接入 godot-mcp **最容易踩的坑**，两边的官方文档都各自提到了，合在一起就是强制要求：

- **Warp 官方**：「Always set `working_directory` explicitly when your MCP server command or args include relative paths.」
- **godot-mcp**：几乎所有工具的首参是 `project_path`（绝对路径）。若未显式传，godot-mcp 会从 `process.cwd()` 向上搜索 `project.godot`——**而 MCP 客户端（含 Warp）的 cwd 通常是客户端启动目录，不是你的 Godot 项目**。

**不设的后果**：godot-mcp 启动时 stderr 会打 `WARN resolveProjectPath: no project.godot found`，且每次调用工具都要手动传 `project_path`。

**三种解决（任选其一）**：

1. 设 `working_directory` 指向 Godot 项目根（最干净）
2. 设 `env.GODOT_PROJECT_PATH` 指向项目根
3. 每次工具调用显式传 `project_path` 参数（兜底）

---

## 6. 验证

### 6.1 Warp 内验证

配置后，**Settings > Agents > MCP servers** 页应显示 `godot` 为 running 状态，点开能看到可用工具列表（预期 29 个工具组，含 `scene` / `script` / `validation` / `game` 等）。

### 6.2 协议层验证（可复现，不依赖 Warp）

下面的脚本用官方 MCP SDK 起一个 stdio 客户端，精确模拟 Warp 的接入行为（spawn server → initialize → tools/list）。Warp 用 `rmcp`（Rust SDK）实现客户端，行为与官方 JS SDK 等价（都遵循 MCP spec）。**能被这个脚本列出的工具，Warp 也能列出。**

```bash
# 在 godot-mcp-enhanced 仓库根目录（需已 npm run build）
node --input-type=module -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: ["build/index.js"],
  env: { ...process.env, ALLOWED_PROJECT_PATHS: process.cwd() } });
const c = new Client({ name: "warp-sim", version: "0.0.1" }, { capabilities: {} });
await c.connect(t);
const { tools } = await c.listTools();
console.log("tools:", tools.length, "| with schema:", tools.filter(x => x.inputSchema).length);
console.log("names:", tools.map(x => x.name).join(", "));
await c.close();'
```

**撰写本文档时的实测结果（v0.19.1，2026-06-28）**：

```
[OK] initialize 握手成功 (522ms)
[OK] tools/list 返回 29 个工具
     工具名: runtime, screenshot, project, scene, script, validation, docs, physics,
             audio, tilemap, material, game, workflow, animation, animation_track,
             profiler, animtree, nav, particles, signal, ui, editor, manage_tools,
             godot_list_instances, godot_select_instance, godot_advanced_tool,
             godot_list_dynamic_routes, load_skill, confirm_and_execute
[OK] 含 inputSchema 的工具: 29/29
[INFO] 含 integer 参数的工具: 0    ← godot-mcp 用 number 类型，无 f64→i64 强转风险
[OK] 优雅关闭 (2548ms 总耗时)
```

---

## 7. 权限与安全

### 7.1 Warp 的 MCP 权限模型（server 级）

Warp 对 MCP 工具调用采用 **server 级三态 profile**（权限对象是 server，不是单个工具/参数——"trust the server, not the tool"）：

| profile | 判定（同一 server 上所有工具权限相同） |
|---------|----------------------------------------|
| `AgentDecides`（默认） | 在 allowlist 且不在 denylist → 自动执行；否则弹确认 |
| `AlwaysAllow` | 不在 denylist → 自动执行 |
| `AlwaysAsk` | 在 allowlist 且不在 denylist → 自动执行；否则确认 |

**默认行为**：`AgentDecides` + 空 allowlist → godot-mcp 的**每个工具首次调用都会弹确认**。确认后该 server 进入 allowlist，后续自动。

> CLI/非交互场景 Warp 会切到 `AlwaysAllow`（无法弹窗）。godot-mcp 自身还有 `confirm_and_execute` 二次确认层（危险操作），双重保护。

### 7.2 godot-mcp 侧的安全机制（仍然生效）

在 Warp 里调用 godot-mcp，以下安全层**与在其他客户端完全一致**：

- **路径白名单**（deny-by-default）：`ALLOWED_PROJECT_PATHS` 控制可访问的项目根；防 `..` 遍历、UNC 路径、Windows 设备名。
- **GDScript 沙箱**：`execute_gdscript` 执行前扫描危险模式（`OS.execute` / `FileAccess(WRITE)` 等）。
- **Game Bridge 密钥**：运行时调试的 TCP 通信走 127.0.0.1 + 随机密钥。

详见 [使用指南 §11 安全模型](使用指南.md#11-安全模型)。

---

## 8. 已知行为（启动时 stderr 预期输出）

godot-mcp 启动时会在 **stderr** 打几条日志（**不影响功能**，Warp 会把 server 的 stderr 转发到日志面板，方便排查）。看到这些不必慌：

| 日志 | 含义 | 处理 |
|------|------|------|
| `[security] ... GODOT_MCP_UNRESTRICTED=false is ACTIVE` | 措辞误导，实际是「安全检查**启用**」（false=未禁用） | 无视，正常 |
| `WARN resolveProjectPath: no project.godot found` | cwd 不在 Godot 项目内 | 见 [§5](#5-️-working_directory-为什么必须显式设)，设 `working_directory` |
| `Auto-launching Dashboard TUI...` | godot-mcp 默认启动 Dashboard 面板 | 不阻塞 stdio 通信，可忽略 |
| `Features disabled: MULTI_INSTANCE` | 多实例模式未开启（默认） | 正常，单实例足够 |

---

## 9. 限制与注意事项

- **⚠️ 未经 Warp GUI 端到端实测**：本指南的配置方法基于 Warp 官方文档 + 源码研究，协议层兼容性已用官方 SDK 客户端实测证明，但未在 Warp GUI 内完整跑通。首次接入若遇 GUI 特有问题，欢迎提 issue。
- **运行时操作不持久化**：`signal_connect` / `tilemap_set_cell` / `particles_create` 等运行时操作只在执行上下文生效，不写盘。需持久化用 `add_node` + `save_scene`。详见 [使用指南 §3.3](使用指南.md#33-headless-执行-vs-持久化)。
- **Warp 的 `call_method` 白名单与 godot-mcp 无关**：Warp 自身对 `call_method` 有只读白名单（S5 安全措施），但这针对的是 Warp 的 shell/系统调用，不影响 godot-mcp 工具的执行——godot-mcp 的工具在 godot-mcp 进程内运行，不受 Warp 的方法白名单约束。
- **会话连续性**：Warp agent 是云端推理 + 本地工具执行的混合模型。godot-mcp 工具执行结果作为 `ToolCallResult` 回灌 LLM 继续推理，对 godot-mcp 透明（godot-mcp 只负责执行并返回结构化结果）。

---

## 10. 工作流示例

在 Warp agent 里用自然语言驱动 Godot 开发：

```text
你: 打开 D:/my-game 项目，读一下 player.gd，把 speed 从 200 改到 300，然后验证语法

Warp agent（自动调用 godot-mcp 工具）:
  → project(get_project_info)          理解项目
  → script(read_script, "res://player.gd")   读脚本
  → script(edit_script, search_and_replace={...})  改 speed
  → validation(validate_scripts)       验证语法
  → 返回结果
```

完整工作流模式见 [使用指南 §9 闭环开发完整示例](使用指南.md#9-闭环开发完整示例)。

---

## 11. 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| MCP servers 页 godot 不 running | spawn 失败 | 检查 `command`/`args`；Windows 上 `npx` 路径；看 stderr 日志 |
| 工具调用报 `Path traversal detected` 或路径拒绝 | `ALLOWED_PROJECT_PATHS` 未含目标项目 | 在 env 里加项目根路径 |
| 工具调用报 `project_path is required` | 未设 `working_directory` / `GODOT_PROJECT_PATH`，且没传 `project_path` | 见 [§5](#5-️-working_directory-为什么必须显式设) |
| `read_scene` / `read_script` 报 `project_path is required` | 传了裸绝对路径的 scene_path | 它们要 `res://` 相对路径 + `project_path` 绝对路径，见 [使用指南 §3.2](使用指南.md#32-路径约定res-vs-绝对路径) |
| 改了 server 代码但 Warp 里没生效 | MCP server 进程是旧的（启动时 spawn，不热重载） | 在 MCP servers 页 stop / start，或重启 Warp |
| 首次调工具弹确认 | Warp 默认 `AgentDecides` 权限 | 确认后该 server 进 allowlist，后续自动；或改 profile 为 `AlwaysAllow` |

---

## 12. 参考

- [Warp 官方 MCP 文档](https://docs.warp.dev/agent-platform/capabilities/mcp/) — 配置属性、file-based server、auto-spawn 行为
- [Warp 仓库 `warpdotdev/Warp`](https://github.com/warpdotdev/Warp) — MCP 客户端实现源码（`crates/mcp/` + `app/src/ai/mcp/`）
- [使用指南](使用指南.md) — godot-mcp-enhanced 完整工具用法、核心概念、安全模型
- [README](../README.md) — 1 分钟配置（Claude Code / Cursor / CodeBuddy 等其他客户端）

---

*本文档基于 Warp MCP 客户端的源码级研究与协议层实测撰写。如 Warp 行为有变，以 [Warp 官方文档](https://docs.warp.dev/agent-platform/capabilities/mcp/) 为准。*
