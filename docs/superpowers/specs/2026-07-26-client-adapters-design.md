# 2026-07-26 Client Adapters Design

> 补齐 AI 客户端配置 adapter，对标 Godot AI 的 19 client auto-configure。现状 4 个（Claude Code/Cursor/OpenCode/Codex）→ 13 个（+9 头部主流）。superpowers brainstorming 产物，经两轮源码级审查修订。

## 背景与约束

- enhanced 是 **stdio MCP server**（`{command, args, env:{GODOT_PATH}}` 形态），Godot AI 是 **HTTP server**（`{url}` 形态）——transport 差异决定 Godot AI 的配置**格式不能直接搬用**，但**配置文件路径 / server_key 名 / 检测方式**（client 厂商定义，与传输无关）可直接采用。
- 现状接口 `ClientAdapter { name; detect(); isConfigured(projectDir); configure(projectDir, godotPath, mcpCommand, mcpArgs) }`（`src/cli/clients/types.ts`），两范式：文件写入型（Claude Code/Cursor/OpenCode，`readJsonConfigWithBackup` + 原子 tmp+rename）+ CLI 调用型（Codex，`execFile` 分别传参不拼字符串）。
- 现状 4 adapter **已有高质量单测**（`test/cli/clients/*.test.ts`，文件型 `mkdtempSync` 真实 tmpdir / CLI 型 mock `execFile`）。
- Godot AI 13 client 配置约定已 100% 源码核实（`plugin/addons/godot_ai/clients/*.gd` + 基础设施 `_path_template.gd`/`_json_strategy.gd`/`_toml_strategy.gd`/`_atomic_write.gd`），见 §2。

## 已定决策（brainstorming）

| 决策 | 选定 |
|---|---|
| 范围 | 务实主流 9 个：Claude Desktop / Windsurf / Cline / Zed / Gemini CLI / Antigravity / Trae / Cherry Studio / Qwen Code（4→13） |
| 实现方案 | A：一次性全做 9 个 + 接口轻扩展 + 全覆盖单测 |
| scope | 混合：按各 client 能力定（plan 前置核实后 **global 7 + project 2**，见 §2 表与「plan 前置核实结论」段），scope 由 client 官方支持决定 |
| 单测 | 全覆盖（现有 4 已有测，新 9 按现有两模式补，现有 4 加 `scope` 断言 + BOM/user-state 联动） |
| setup 行为 | 不加 `--global/--project` flag（YAGNI），日志标 `(global)`/`(project)`，scope 由 client 能力决定 |

## §1 架构

### 1.1 接口轻扩展（`src/cli/clients/types.ts`）

方法签名不变（调用侧 setup/doctor 无感）；新增**必需**属性 `scope`——现有 4 adapter 须同步补声明，选必需而非可选正是让 TS 挡住 13 个里任何一个漏表态。

```ts
export interface ClientAdapter {
  name: string;
  scope: 'project' | 'global';   // 新增
  detect(): Promise<boolean>;
  isConfigured(projectDir: string): Promise<boolean>;
  configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void>;
}
```

`scope='global'` 的 adapter：`isConfigured`/`configure` 的 `projectDir` 参数为 no-op（首行 `void projectDir` 或注释标明，对齐现状 CodexAdapter `codex.ts:18,26` 的 `_projectDir` 模式），内部用 `os.homedir()`/`process.env.APPDATA` 等定位全局路径。

### 1.2 types.ts:5-6 注释修正（审查 A 项收尾）

现状注释把 OpenCode 错归 CLI 型（实际 `opencode mcp add` 交互式挂起，IMPORTANT-6 已改文件型，`opencode.ts:21-23,33-48`，仅 `detect()` 仍走 `opencode --version`）。修正为按 `configure()` 实现方式划分，`detect()` 探测方式与范式正交：

```ts
/**
 * ClientAdapter — 统一的 AI 客户端配置接口。
 *
 * 按 configure() 实现方式分两类范式（detect() 探测方式与范式正交，另说）：
 * - 文件写入型（Claude Code、Cursor、OpenCode）：读写配置文件（readJsonConfigWithBackup + 原子 tmp+rename）
 * - CLI 调用型（Codex）：调用 CLI 子命令（execFile 分别传参，不拼字符串防注入）
 *
 * 注：OpenCode 原为 CLI 型，因 `opencode mcp add` 是交互式 prompts、非交互 execFile 会挂起超时（IMPORTANT-6），
 * 改文件型读写 opencode.json；仅 detect() 仍走 `opencode --version`。
 *
 * detect() 探测方式与范式正交：文件型 adapter 多用 existsSync(配置目录/文件)，CLI 型用 execFile --version。
 */
```

### 1.3 文件组织（沿用现状单文件单 client）

- `src/cli/clients/{client}.ts` × 9 新文件
- `src/cli/clients/index.ts`：`ALL_ADAPTERS` 注册 9 新（4→13）
- `src/cli/clients/json-config.ts`：加 `stripBom` + `readJsonForCheck`（见 §3.5）
- `src/cli/setup.ts` / `doctor.ts`：仅日志加 scope 标注；**`doctor.ts:12` `checkClientConfig` 签名不动**（它是 `{name; isConfigured}` 结构子集，不读 scope），scope 标注只加在 `doctor.ts:61` 循环体日志

## §2 13 个 client 配置约定（源码核实）

> transport 差异：Godot AI 的 `url`/`serverUrl`/`httpUrl`/`streamableHttp` 等是 HTTP transport 字段，enhanced stdio 一律用 `{command, args, env:{GODOT_PATH}}` 形态（除 OpenCode 保留 `type:"local"`）。Claude Desktop 在 enhanced **不需要 uvx mcp-proxy 桥**（Godot AI 桥是因它自身 HTTP，enhanced 本就是 stdio）。

| Client | scope | 配置路径（跨平台见 §3.3） | server_key | detect | entry stdio 形态 | user-state（§3.1） | type pin（§3.2） |
|---|---|---|---|---|---|---|---|
| Claude Code | project ✓现状 | `{project}/.claude/settings.json` | mcpServers | existsSync(`.claude`) | `{command, args, env}` | 无 | 无（stdio 默认） |
| Cursor | project ✓现状 | `{project}/.cursor/mcp.json` | mcpServers | existsSync(`.cursor`) | `{command, args, env}` | 无 | 无 |
| OpenCode | project ✓现状 | `{project}/opencode.json` | **mcp** | execFile `opencode --version` | `{type:"local", command:[...], environment}` | `enabled` | `type:"local"` |
| Codex | global ✓现状 | CLI（内部写 `~/.codex/config.toml`） | TOML | execFile `codex --version` | CLI 调用 | — | — |
| **Claude Desktop** | **global** | Win `{APPDATA}/Claude/claude_desktop_config.json` / mac `~/Library/Application Support/Claude/` | mcpServers | existsSync(config) | `{command, args, env}`（不需 uvx 桥） | 无 | 无 |
| **Windsurf** | **global**（仅全局可靠） | `~/.codeium/windsurf/mcp_config.json`（Win 用 `%USERPROFILE%`） | mcpServers | existsSync(config) | `{command, args, env}` | 无 | 无 |
| **Cline** | **global**（VS Code globalStorage） | `{APPDATA}/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | mcpServers | existsSync(config) | `{command, args, env}` | `disabled`,`autoApprove` | 无（仅远程 HTTP 才需 type） |
| **Zed** | **global**（项目级有读取 bug） | Win `{APPDATA}/Zed/settings.json` / unix `~/.config/zed/settings.json` | **context_servers** | existsSync(config) | `{command, args, env}` | 无 | 无 |
| **Gemini CLI** | **project** | `{project}/.gemini/settings.json` | mcpServers | existsSync / `gemini --version` | `{command, args, env}` | `trust`,`timeout`,`includeTools`,`excludeTools` | 无 |
| **Antigravity** | **global** | `~/.gemini/config/mcp_config.json`（新，旧 `~/.gemini/antigravity/` 兼容）；工作区 `.agents/mcp_config.json` | mcpServers | existsSync(双路径) | `{command, args, env}` | `disabled`,`disabledTools` | 无 |
| **Trae** | **global**（项目级未文档化） | Win `{APPDATA}/Trae/User/mcp.json` / mac `~/Library/Application Support/Trae/User/` | mcpServers | existsSync(config) | `{command, args, env}` | 无 | **待实机验证**（保守不加） |
| **Cherry Studio** | **global**（仅全局，GUI 无项目概念） | Win `{APPDATA}/CherryStudio/mcp_servers.json` / mac `~/Library/Application Support/CherryStudio/` | mcpServers | existsSync(config) | `{command, args, env}` | `isActive`,`installSource` | **`type:"stdio"`**（schema 强制，小写） |
| **Qwen Code** | **project** | `{project}/.qwen/settings.json` | mcpServers | existsSync / `qwen --version` | `{command, args, env}` | `trust`,`includeTools`,`excludeTools`,`timeout`,`description` | 无 |

> **scope 核实结论（2026-07-26 plan 前置核实，3 并行子代理官方文档 + Godot AI 源码三方交叉）**：9 新 client 中 **global 7 个** + **project 2 个**。强制 global 理由：Claude Desktop（GUI 全局配置）、Cline（VS Code globalStorage 唯一稳定路径）、Windsurf（官方仅文档化全局，社区称项目级 "limited"）、Zed（项目级 `.zed/settings.json` 有 devcontainer/folder 读取 bug，issue #47701/#16684）、Antigravity（当前官方路径 `~/.gemini/config/`，旧 `~/.gemini/antigravity/` 兼容）、Trae（VS Code fork，项目级路径未文档化）、Cherry Studio（Electron GUI 无项目概念，仅全局 app data）。project：Gemini CLI / Qwen Code（官方 `--scope` 默认 project，Godot AI 反而漏配 project scope 是其缺口）。13 client 共 **global 8 / project 5**。

## §3 边界与错误处理

### 3.1 user-state 字段保留（per-client 白名单）

下列 client 的 godot entry 内含用户态字段，reconfigure 重写 entry 时**必须保留旧值**，否则清空用户设置：

- **Cline**：`disabled`(bool)、`autoApprove`(string[])
- **Cherry Studio**：`isActive`(bool)、`installSource`(enum)
- **Antigravity**：`disabled`(bool)、`disabledTools`(string[])
- **Gemini CLI**：`trust`(bool)、`timeout`(number ms)、`includeTools`(string[])、`excludeTools`(string[])
- **Qwen Code**：`trust`(bool)、`includeTools`(string[])、`excludeTools`(string[])、`timeout`(number)、`description`(string)
- **OpenCode**：`enabled`(bool)

ClaudeCode / Cursor / Claude Desktop / Windsurf / Zed / Trae 无 entry 级 user-state（不强制回补）。

**机制**：per-client 白名单（每 adapter 声明自己的 `USER_STATE_KEYS: string[]`）。configure 重写 `godot` entry 时，读旧 entry，从中挑出白名单字段 merge 进新 entry。比通用集合干净（不会把 Cline 的 `disabled` 套到 Cherry）。**首次创建** entry 时，user-state 字段 seed 默认值（Cline `{disabled:false, autoApprove:[]}`、Cherry `{isActive:true}`、Antigravity `{disabled:false}`、OpenCode `{enabled:true}` 等，对齐各 client 官方示例 + Godot AI `entry_initial_fields`）。

### 3.2 type pin stdio 策略 [已核实]

默认 `{command, args, env:{GODOT_PATH}}` **无 type**（多数 client stdio 默认，传输由字段存在性推断：有 `command`→stdio，有 `url`→SSE，有 `httpUrl`→Streamable HTTP）。例外：

- **OpenCode** 保留 `type:"local"`（现状）
- **Cherry Studio** 必须 `type:"stdio"`（小写）——schema enum 强制 `{stdio, sse, streamableHttp, inMemory}`，缺 type 破坏传输协商（zread CherryHQ/cherry-studio 源码铁证）
- **Trae** type 字段**未确认**（官方 docs.trae.ai 页面 JS 渲染抓不到正文，结论基于搜索摘要 + VS Code fork 模式推断）——保守**不加 type**，plan 留实机验证 step；若验证失败再加 `type:"stdio"`

**Cline / Windsurf 核实结论：不需要 type**（Cline 仅远程 HTTP/SSE 才显式 type，stdio 默认；Windsurf schema 同 Claude Desktop，stdio 无 type）。Godot AI 的 `streamableHttp`/`serverUrl`/`url`/`httpUrl` 是 HTTP server 字段，enhanced stdio **一律不写**。

### 3.3 跨平台路径 [已审查确认 + plan 前置核实]

`os.homedir()` 在 Windows 返回 `%USERPROFILE%`（`C:\Users\wgt`），**不是** `%APPDATA%`；Claude Desktop 等全局配置在 `%APPDATA%\Claude`（`C:\Users\wgt\AppData\Roaming`）。全局路径须 env 优先：

- **Windows 全局**：`process.env.APPDATA`（优先）→ `process.env.LOCALAPPDATA` → 回退 `join(os.homedir(), 'AppData/Roaming')`
- **macOS 全局**：`join(os.homedir(), 'Library/Application Support')`（注意 "Application Support" 含空格，`path.join` 无碍）
- **Linux 全局**：`process.env.XDG_CONFIG_HOME`（优先）→ 回退 `join(os.homedir(), '.config')`
- **project 级**：`projectDir` 拼接（与现状一致）

**路径核实修正（plan 前置）**：

- **Antigravity**：全局当前官方路径 `~/.gemini/config/mcp_config.json`（Antigravity 2.0/IDE/CLI/SDK 共享），旧 IDE 路径 `~/.gemini/antigravity/mcp_config.json` 仍被部分老用户使用——adapter **写入新路径**，`detect`/`isConfigured` **同时检查两个路径**兼容；工作区级 `.agents/mcp_config.json`（注意是 `.agents/` 非 `.antigravity/`）。`~/.gemini/antigravity-cli/` **不是** MCP 配置目录（是 plugin/skills/cache），勿写。
- **Cherry Studio**：全局 app data 目录是 `CherryStudio`（**驼峰**，Win `{APPDATA}/CherryStudio/mcp_servers.json`），**不是** `.cherrystudio`（小写点前缀——`~/.cherrystudio/bin/` 是 MCP 二进制工具目录，非配置，勿混淆）。
- **Gemini CLI / Qwen Code**：stdio entry 的 `env` 字段值支持 `$VAR`/`${VAR}` 引用（Gemini 还支持 Win `%VAR%`），enhanced adapter **直接写值**（如 `GODOT_PATH: "C:/..."`），不用插值语法。
- **Windsurf**：改 `mcp_config.json` 后须**完全退出重启**（关窗口不够）；有 100 tools 硬上限（enhanced 33 工具无影响）。

参考 Godot AI `_path_template.gd`（expand 列表含 `$APPDATA`/`$LOCALAPPDATA`/`$XDG_CONFIG_HOME`/`$USERPROFILE`）——但 Godot AI 的 Antigravity 路径用的是旧 `antigravity/`（已过时），enhanced 以官方当前 `config/` 为准。

### 3.4 Codex 保留 CLI 模式

现状 `codex mcp add`（CLI）避开手写 TOML 的 array-of-tables / subtable 陷阱（Godot AI `_toml_strategy.gd:remove` 须清 subtable 否则 duplicate-key 错）。stdio `{command,args,env}` 字段多，CLI 已封装好，保留。

### 3.5 BOM 防御 [已审查确认]

**审查核心发现**：现状有两套独立读取——`readJsonConfigWithBackup`（configure 用，`json-config.ts:16`）+ 各 adapter `isConfigured` 内联（如 `claude-code.ts:19` `JSON.parse(readFileSync(...))`）。**只在 `readJsonConfigWithBackup` 加 BOM strip 不够**：带 BOM 的合法配置文件，`isConfigured` 内联读仍 throw→catch→返 false → doctor 误报 "not configured" + setup 不 skip 重新 configure → **破坏幂等**。

**机制**：抽共享 `stripBom`，两个上层读取函数都复用：

```ts
// json-config.ts
function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
}

// configure 用（现状改造）：parse 失败备份 raw 后返 {}（保留现有 F3 语义）
export function readJsonConfigWithBackup(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(stripBom(raw)) as Record<string, unknown>;
  } catch {
    const backupPath = `${filePath}.corrupt.${randomUUID()}.bak`;
    writeFileSync(backupPath, raw, 'utf-8');
    console.warn(`[godot-mcp] ${filePath} contained invalid JSON — backed up to ${backupPath} before overwriting.`);
    return {};
  }
}

// isConfigured 用（新增）：not_found 返 null，parse 失败（含 BOM 已 strip 后仍损坏）返 null，调用方返 false
export function readJsonForCheck(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(path, 'utf-8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

13 个 adapter 的 `isConfigured` 改用 `readJsonForCheck`（不再内联 `JSON.parse(readFileSync)`）。**写回一律不带 BOM**（标准 JSON 不应带）。

> advisory（既存问题，非本设计引入）：`readJsonForCheck` 保持 `isConfigured` 现状不抛语义（返 null→false）。`doctor.ts:12-19` `checkClientConfig` 的 catch 分支（A-09 "config parse error" 诊断）依赖 `isConfigured` 抛错来报损坏，但现状 `isConfigured` 是 `try{...}catch{return false}` 吞错不抛，A-09 catch 现状已是死代码。本设计不使情况变差，留作未来改进。

### 3.6 setup 行为（advisory 2）

默认配所有已装 client（project + global 混合），日志标 `(global)`/`(project)` 让用户知情改了哪些全局配置。**不加 `--global/--project` flag**（YAGNI）——scope 由 client 能力决定，flag 增复杂度无收益。`setup.ts:52` `process.cwd()` 隐含"项目级"假设随混合 scope 失效，但日志 scope 标注提供透明度。

## §4 验收标准

1. 13 adapter 各自单测（文件型 `mkdtempSync` 真实 tmpdir / CLI 型 mock `execFile`），含 `adapter.scope === 'project'|'global'` 断言（按 §2 表：**project 5** = Claude Code/Cursor/OpenCode/Gemini CLI/Qwen Code；**global 8** = Codex/Claude Desktop/Windsurf/Cline/Zed/Antigravity/Trae/Cherry Studio）
2. **反向断言**：configure 后 `isConfigured` 返 true（防假绿，对齐 `claude-code.test.ts` 现有模式）
3. user-state reconfigure 保留（per-client 各 1 测试）：Cline `disabled`/`autoApprove`、Cherry `isActive`/`installSource`、Antigravity `disabled`/`disabledTools`、**Gemini CLI `trust`/`timeout`/`includeTools`/`excludeTools`**、**Qwen Code `trust`/`includeTools`/`excludeTools`/`timeout`/`description`**、OpenCode `enabled`
4. 损坏 JSON 备份（文件型复用 `readJsonConfigWithBackup`，现有 F3 行为）
5. 原子 tmp+rename（现有模式）
6. **BOM 防御**（对齐 §3.5）：带 BOM 的合法 JSON 文件 → `isConfigured` 返 true、`configure` 不误判损坏、不触发 `.corrupt.*.bak` 备份
7. **跨平台 mock 含 env**（对齐 §3.3）：mock `process.platform`（win32/darwin/linux）**且** mock `process.env.APPDATA`/`XDG_CONFIG_HOME`/`USERPROFILE`，否则测不到真路径逻辑；8 个 global adapter 各至少一条 win32 路径断言（Claude Desktop/Cline/Windsurf/Zed/Antigravity/Trae/Cherry Studio + Codex CLI）
8. **global 幂等**：连续 configure 两次不重复添加 godot entry（依赖 `isConfigured` 先 skip，`setup.ts:63-67` 现有逻辑覆盖，global 路径下显式断言一条）
9. setup/doctor 日志标 scope（现有 `setup.test.ts`/`doctor.test.ts` 加断言）
10. 全量 vitest 绿 + tsc 0 + eslint 0
11. `types.ts:5-6` 注释修正（§1.2）
12. **type 字段**：Cherry Studio entry 含 `type:"stdio"` 断言；Trae entry 不含 type（保守）+ 注释标「实机验证待定」
13. **Antigravity 双路径兼容**：`detect`/`isConfigured` 检查新 `~/.gemini/config/mcp_config.json` + 旧 `~/.gemini/antigravity/mcp_config.json`，`configure` 写新路径（测试模拟旧路径存在仍能识别为已配置）
14. CHANGELOG 记录（client adapter 是 CLI 侧配置，**不进 capability-matrix**——不是 MCP 工具能力）

## 实现产物清单

- `src/cli/clients/types.ts`（加 `scope` + 注释修正）
- `src/cli/clients/json-config.ts`（加 `stripBom` + `readJsonForCheck`，`readJsonConfigWithBackup` 改用 stripBom）
- `src/cli/clients/{claude-desktop,windsurf,cline,zed,gemini-cli,antigravity,trae,cherry-studio,qwen-code}.ts` × 9 新
- `src/cli/clients/{claude-code,cursor,opencode,codex}.ts` × 4 现有改造（补 `scope`、`isConfigured` 改 `readJsonForCheck`、文件型加 per-client user-state 白名单 merge）
- `src/cli/clients/index.ts`（注册 9 新）
- `src/cli/setup.ts` + `doctor.ts`（日志标 scope）
- `test/cli/clients/{9 新}.test.ts` + 现有 4 改（scope 断言 + BOM + user-state）
- `test/cli/setup.test.ts` + `doctor.test.ts`（scope 日志断言）
- `CHANGELOG.md`

## plan 前置核实结论（2026-07-26，3 并行子代理）

3 项「待 plan 阶段核实」已全部完成（官方文档全文 + Godot AI 源码三方交叉，整体高信心；Trae 单项中信心）。结论已并入 §2 表 / §3.1-3.3 / §4：

1. **stdio type 字段**：仅 **Cherry Studio** 必须 `type:"stdio"`（schema enum 强制）；**Trae 未确认**（docs.trae.ai JS 渲染抓不到正文，保守不加，plan 留实机验证）；**Cline/Windsurf 不需要**（Cline 仅远程 HTTP 才 type，stdio 默认；Windsurf schema 同 Claude Desktop）；其余 stdio 默认无 type。Godot AI 的 `streamableHttp`/`serverUrl`/`url`/`httpUrl` 是 HTTP 字段，enhanced stdio 一律不写。
2. **global detect 方式**：全部用 `existsSync(配置文件/目录路径)`（参考 Godot AI `_base.gd::is_installed()` 的 `detect_paths = path_template.values()` 全平台路径任一存在即安装）。Codex 例外（CLI `codex --version`）。GUI 应用 client 无 `--version`（GUI 无 CLI）。
3. **project 级支持核实（推翻 spec 原「7 project*」假设）**：
   - **真支持 project（2 个）**：Gemini CLI、Qwen Code（官方 `--scope` 默认 project；Godot AI 反漏配 project scope 是其缺口）
   - **改 global（5 个）**：Windsurf（官方仅全局，社区称项目级 "limited"）、Zed（项目级 `.zed/settings.json` 有 devcontainer/folder 读取 bug，issue #47701/#16684）、Antigravity（当前官方全局 `~/.gemini/config/`，工作区 `.agents/`）、Trae（VS Code fork，项目级路径未文档化）、Cherry Studio（Electron GUI 无项目概念，仅全局 app data）
   - **已确认 global（2 个）**：Claude Desktop、Cline
   - **结论**：9 新 client = **global 7 + project 2**；13 client 共 **global 8 / project 5**。spec 原 §2 表「project*」假设除 Gemini CLI/Qwen Code 外全部修正为 global。

**中等不确定项**（plan 实机验证兜底）：

- **Trae type 字段**：保守不加，验证失败再加 `type:"stdio"`
- **Cherry Studio `mcp_servers.json` 可读写性**：zread schema 说运行时存 IndexDB，但 Godot AI 用此文件路径 + issue #8254 暗示文件可读写；adapter 实施前实机查 `%APPDATA%\CherryStudio\` 实际文件名（mcp_servers.json vs 别的）
- **Antigravity 新旧路径并存**：写新 `~/.gemini/config/`，检测兼容旧 `~/.gemini/antigravity/`
