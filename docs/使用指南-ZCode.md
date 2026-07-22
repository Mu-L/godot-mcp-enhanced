# 在 ZCode 中接入 godot-mcp-enhanced

> **版本**：0.23.0 ｜ **适用 ZCode**：支持 MCP 的版本 ｜ **适用 Godot**：4.x（4.6+ 已测试）
>
> **验证状态**：✅ 协议层（文档依据，来源 ZCode 官方文档 [mcp-services](https://zcode.z.ai/cn/docs/mcp-services) / [agents](https://zcode.z.ai/cn/docs/agents) / [safety-confirm](https://zcode.z.ai/cn/docs/safety-confirm) 页，2026-07-22 抓取）｜ ⚠️ GUI 端到端实测待补（Task 8）

---

## 这份指南解决什么

[ZCode](https://zcode.z.ai/) 是智谱官方的 Agentic Development Environment（ADE），深度适配 GLM 系列模型。godot-mcp-enhanced 是 **stdio MCP 服务端**，ZCode 是 **stdio MCP 客户端**——协议层天然匹配。

**关键差异（vs Claude Code）**：ZCode 不读 `CLAUDE.md`，只读 workspace 根 `AGENTS.md`（也不扫描 `.claude/rules/` 子目录、不展开 `@import`）。因此接入后请运行一次 `setup_project_rules`（Task 3/4 起默认双写 `CLAUDE.md` + `AGENTS.md`），让 godot 规则在 ZCode 里生效。

如果你只想快速跑起来，看 [§2 方式 A（GUI）](#方式-a-zcode-gui) 或 [§2 方式 C（从 Claude Code 导入）](#方式-c从-claude-code-导入非-auto-spawn)。

---

## 1. 兼容性结论速览

| 维度 | 结论 | 依据 |
|------|------|------|
| **stdio 传输** | ✅ 完美匹配 | ZCode 是 stdio MCP 客户端；godot-mcp 是 stdio 服务端 |
| **工具发现** | ✅ 协议层预期全列出 | 待 Task 8 协议层脚本实测确认（与 [使用指南-Warp §6.2](使用指南-Warp.md#62-协议层验证可复现不依赖-warp) 同方法） |
| **inputSchema** | ✅ 全工具就绪 | godot-mcp 全部工具声明 Zod schema，ZCode 表单/校验可用 |
| **项目指令注入** | ✅ 通过 `AGENTS.md` | ZCode 读 workspace 根 `AGENTS.md`（来源官方 agents 页，2026-07-22 抓取） |
| **配置作用域** | 用户级 / 工作区级 | `.zcode/config.json` 或兼容 `.agents/mcp.json`（来源 mcp-services 页） |
| **危险操作权限** | ⚠️ 需执行模式兜底 | `confirm_and_execute` 单客户端不可靠，见 [§5](#5-权限与安全面a-半定论) |

> **结论**：协议层与 ZCode 完全兼容；唯一需注意的接入动作是生成 `AGENTS.md`（ZCode 不读 `CLAUDE.md`），以及执行模式选择（见 §5）。

---

## 2. 三种配置方式

### 方式 A：ZCode GUI

ZCode 设置 → MCP 服务器 → 新建 MCP 服务器，填入：

| 字段 | 值 |
|------|-----|
| **作用域** | 工作区（仅当前项目）或 用户（所有工作区） |
| **类型** | `stdio（本地命令）` |
| **command** | `npx` |
| **args** | `["-y", "godot-mcp-enhanced"]` |
| **env** | 见 [§4 环境变量](#4-环境变量)（至少建议设 `ALLOWED_PROJECT_PATHS`） |

ZCode 支持三种录入方式（来源 mcp-services 页，2026-07-22 抓取）：GUI 表单（stdio，填 command+args+env）/ file-based（读 `.zcode` 或 `.agents` 配置文件）/ **完整配置粘贴**（直接粘贴 JSON，支持 `{"server":{...}}` 和 `{"mcpServers":{...}}` 两种顶层格式）。

### 方式 B：file-based（`.zcode/config.json` 或 `.agents/mcp.json`）

工作区级 `<项目根>/.zcode/config.json`，键 `mcp.servers`（来源 mcp-services 页，2026-07-22 抓取）：

```json
{
  "mcp": {
    "servers": {
      "godot": {
        "command": "npx",
        "args": ["-y", "godot-mcp-enhanced"],
        "env": {
          "ALLOWED_PROJECT_PATHS": "D:/my-game",
          "GODOT_PATH": "D:/Godot_v4.6.3-stable_win64.exe"
        }
      }
    }
  }
}
```

`.zcode/config.json` 的两个作用域（来源 mcp-services 页，2026-07-22 抓取）：
- 用户级：`~/.zcode/cli/config.json`
- 工作区级：`<项目根>/.zcode/config.json`

或兼容格式 `<项目根>/.agents/mcp.json`，键 `mcpServers`：

```json
{
  "mcpServers": {
    "godot": { "command": "npx", "args": ["-y", "godot-mcp-enhanced"] }
  }
}
```

兼容路径的两个作用域（来源 mcp-services 页）：
- 用户级：`~/.agents/mcp.json`
- 工作区级：`<项目根>/.agents/mcp.json`

> **⚠️ 优先级坑（来源 mcp-services 页，2026-07-22 抓取）**：同作用域内 `.zcode` **强优先**——只要 `.zcode/config.json` 有任何 MCP 服务，同作用域的 `.agents/mcp.json` 会被**整体跳过，不合并**。两者混用时，请把 `.agents` 的配置手动合并进 `.zcode/config.json`，避免静默丢失服务。

### 方式 C：从 Claude Code 导入（非 auto-spawn）

ZCode 设置 → MCP 服务器 → **导入图标**，自动扫描可导入的服务器配置。来源（来源 mcp-services 页，2026-07-22 抓取）含：

- **Claude Code**：`~/.claude/settings.json`
- **Codex CLI**：`~/.codex/config.toml`
- **OpenCode**：`~/.config/opencode/opencode.json`
- **通用 `.agents`**：`~/.agents/mcp.json`

操作流程：点导入图标 → 勾选要导入的服务器 → 写入 `.zcode/config.json`。

> **⚠️ 这是「导入」，不是 Warp 那种运行时 auto-spawn**。ZCode 把选中配置拷贝进自己的 `.zcode/config.json`，**原外部配置文件不被修改**。后续外部配置变更不会自动同步——需重新点导入。与 [使用指南-Warp 方式 C](使用指南-Warp.md#方式-c复用-claude-code-配置零配置最强) 的运行时自动 spawn 语义不同，不要混淆。

---

## 3. 让 godot 规则在 ZCode 生效（关键）

ZCode **不读** `CLAUDE.md`，也**不扫描** `.claude/rules/` 子目录、**不展开** `@import` / `@include`、**不合并**多层级 `AGENTS.md`（来源官方 agents 页，2026-07-22 抓取）。它只读：

- 全局：`~/.zcode/AGENTS.md`
- 工作区：workspace 根 `AGENTS.md`

> ZCode 在 onboarding 时会一次性把 `CLAUDE.md` 迁移到 `AGENTS.md`，但这是一次性动作，之后不再读 `CLAUDE.md`。

因此接入 godot-mcp 后，运行一次：

```
project(action="setup_project_rules", project_path="D:/my-game")
```

该工具自 v0.23.0 起 `agents_md` 参数默认 `true`（Task 3/4），会在项目根同时生成：

- `CLAUDE.md`（供 Claude Code 等读取）
- `AGENTS.md`（供 ZCode / Codex / Cursor 等遵循 AGENTS.md 标准的客户端读取）

`AGENTS.md` 是**单文件全量内联**——所有 godot 工具规则（模式决策树 / 各子系统陷阱 / GDScript 规范 / engine-quirks）都打平进这一个文件，不依赖子目录扫描或 `@import` 展开，正好匹配 ZCode 的单文件读取模型。

若只想生成 `AGENTS.md`（不写 `CLAUDE.md`），显式传 `claude_md=false`：

```
project(action="setup_project_rules", project_path="D:/my-game", claude_md=false)
```

---

## 4. 环境变量

ZCode 的 `env` 字段直传到 godot-mcp 进程，与 [使用指南-Warp §4](使用指南-Warp.md#4-环境变量) 完全一致（godot-mcp 的 env 契约与客户端无关）。常用变量速查：

| 变量 | 说明 | 建议 |
|------|------|------|
| `ALLOWED_PROJECT_PATHS` | 允许访问的项目根（分号分隔），deny-by-default | **必设**——不设则 godot-mcp 仅允许 `process.cwd()`，而 ZCode 启动 MCP server 的 cwd 通常不是你的 Godot 项目 |
| `GODOT_PATH` | Godot 可执行文件路径 | 不设则自动搜索 PATH / 注册表 / Scoop / Downloads |
| `GODOT_PROJECT_PATH` | 默认项目路径 | 设了可省去每次工具调用传 `project_path` |
| `GODOT_MCP_SANDBOX` | `disabled` / `strict` / 默认 | 控制执行 GDScript 前的危险模式扫描 |
| `GODOT_MCP_UNRESTRICTED` | `true` = 禁用路径限制 | ⚠️ 仅开发环境，生产勿用 |

> 完整变量表见 [使用指南 §13 环境变量参考](使用指南.md#13-环境变量参考)。`working_directory` 同样建议显式设——理由与 [使用指南-Warp §5](使用指南-Warp.md#5-️-working_directory-为什么必须显式设) 完全相同（MCP 客户端的 cwd 通常不是 Godot 项目根）。

---

## 5. 权限与安全（面③ A 半定论）

### 5.1 ZCode 执行模式 × godot 危险操作

ZCode 提供 4 种执行模式（来源官方 safety-confirm 页，2026-07-22 抓取）：**变更前确认** / **自动编辑** / **计划模式** / **完全访问**。决策选项含：允许 / 始终允许 / 拒绝 / 始终拒绝 / 允许本会话 / 始终允许本项目。

| ZCode 执行模式 | godot 危险操作行为 |
|----------------|-------------------|
| **变更前确认** | ZCode 在文件/命令改动前弹确认 ✅ **兜底有效** |
| **自动编辑** / **完全访问** | 文件/命令自动改，不拦截 ⚠️ |
| **计划模式** | 仅规划不执行，无副作用 |

### 5.2 ⚠️ `confirm_and_execute` 在 ZCode 下不可靠

godot-mcp 的 `confirm_and_execute` 机制：危险操作（`write_config` / `create_project` / `setup_project_rules` 等）先返回一个确认 token 给 AI，AI 再回传 token 触发执行。**问题**：token 走 `client → server → client` 回路，单客户端下 AI 可以自确认——**无论 ZCode 是否实现 MCP elicitation，自动执行模式下都不能依赖它**。

这是 godot-mcp 协议层的固有限制（单客户端 confirm token 无法形成 out-of-band 通道），与具体客户端无关。

**建议（A 半定论）**：

- 在 ZCode 里用 **「变更前确认」** 执行模式兜底，不要依赖 `confirm_and_execute`
- 把 godot 危险操作的拦截责任交给 ZCode 的执行模式 + godot-mcp 自身的路径白名单 / GDScript 沙箱 / Bridge 密钥

godot-mcp 的以下安全层在所有客户端一致生效（与客户端无关）：

- **路径白名单**（deny-by-default）：`ALLOWED_PROJECT_PATHS` 控制可访问的项目根；防 `..` 遍历、UNC 路径、Windows 设备名
- **GDScript 沙箱**：`execute_gdscript` 执行前扫描危险模式（`OS.execute` / `FileAccess(WRITE)` 等）
- **Game Bridge 密钥**：运行时调试的 TCP 通信走 127.0.0.1 + 随机密钥

详见 [使用指南 §11 安全模型](使用指南.md#11-安全模型)。

### 5.3 elicitation（B 半，待 Task 8 实测定论）

ZCode 是否实现 MCP elicitation（server→client→user 的 out-of-band 确认通道）、确认弹窗的具体形态、是否能堵住 `confirm_and_execute` 的自确认漏洞——这些**留 Task 8 GUI 端到端实测确认后回填本节**。在 Task 8 定论之前，按 §5.2 的「变更前确认」执行模式保守兜底。

---

## 6. 验证

> 本节为占位，Task 8（协议层脚本 + ZCode GUI 端到端实测）回填。

预期验证项（Task 8 落地后补完整结果）：

- **协议层**（可复现，不依赖 ZCode GUI）：复用 [使用指南-Warp §6.2](使用指南-Warp.md#62-协议层验证可复现不依赖-warp) 的 stdio 客户端脚本，验证 `initialize` 握手 + `tools/list` 全工具发现 + `inputSchema` 完整性。ZCode 的 MCP 客户端行为与官方 SDK 等价（都遵循 MCP spec），能被该脚本列出的工具 ZCode 也能列出。
- **GUI 端到端**（Task 8）：在 ZCode GUI 内配置 godot server，确认工具列表展示、`AGENTS.md` 注入生效、危险操作在「变更前确认」模式下被拦截。

---

## 7. 限制与故障排查

- **⚠️ 文档断言待实测**：本指南的 ZCode 机制（`.zcode` / `.agents` / `AGENTS.md` 单文件读取模型）依据 ZCode 官方文档（2026-07-22 抓取），Task 8 GUI 实测将二次确认。若实测发现文档与行为不一致，以实测为准并回标本指南。
- **AGENTS.md 单文件**：ZCode 不扫描子目录、不展开 `@import`、不合并多层级 `AGENTS.md`。`setup_project_rules` 生成的 `AGENTS.md` 已全量内联，无需额外配置。
- **方式 C 非自动同步**：从 Claude Code 等导入的配置是**一次性拷贝**，原配置后续变更不自动同步——需重新点导入。
- **`.zcode` / `.agents` 优先级**：同作用域下 `.zcode` 强优先，混用时务必合并，否则 `.agents` 配置静默失效。
- **运行时操作不持久化**：与在其他客户端一致，`signal_connect` / `tilemap_set_cell` / `particles_create` 等运行时操作只在执行上下文生效，不写盘。需持久化用 `add_node` + `save_scene`。详见 [使用指南 §3.3](使用指南.md#33-headless-执行-vs-持久化)。
- **启动时 stderr 日志**：godot-mcp 启动时会在 stderr 打几条日志（`[security] ... is ACTIVE` / `WARN resolveProjectPath` / `Auto-launching Dashboard TUI...`），**不影响功能**。具体含义见 [使用指南-Warp §8](使用指南-Warp.md#8-已知行为启动时-stderr-预期输出)。

---

## 8. 参考

- [ZCode MCP 服务器（官方）](https://zcode.z.ai/cn/docs/mcp-services) — 配置作用域、三种录入方式、外部配置导入
- [ZCode Agent（官方）](https://zcode.z.ai/cn/docs/agents) — `AGENTS.md` 读取模型（不读 `CLAUDE.md`、不扫描子目录）
- [ZCode 安全确认（官方）](https://zcode.z.ai/cn/docs/safety-confirm) — 4 种执行模式 + 决策选项
- [使用指南](使用指南.md) — godot-mcp-enhanced 完整工具用法、核心概念、安全模型
- [使用指南-Warp](使用指南-Warp.md) — env 契约、`working_directory` 坑、协议层验证脚本（与客户端无关，ZCode 复用）
- [README](../README.md) — 1 分钟配置（Claude Code / Cursor / Codex 等其他客户端）

---

*本文档基于 ZCode 官方文档（mcp-services / agents / safety-confirm 页，2026-07-22 抓取）撰写。ZCode 机制断言已标注来源与抓取日期；GUI 端到端实测留待 Task 8 二次确认。如 ZCode 行为有变，以 [ZCode 官方文档](https://zcode.z.ai/cn/docs) 为准。*
