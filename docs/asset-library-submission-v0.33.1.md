# Godot Asset Library 提交材料 — v0.33.1

> 提交入口：https://godotengine.org/asset-library/asset/edit （需 Godot 账号登录）
> **本次为编辑已有条目 5193**：更新 Version string + Download URL 两处必改；Description 更新计数与亮点。提交后进入审核队列（初列 Testing，编辑审核后转 Community）。
>
> Download URL 惯例（2026-08-19 纠偏后沿用）：**GitHub commit 归档直链**（非 release zip）：
> `https://github.com/wgt19861219/godot-mcp-enhanced/archive/<完整40位SHA>.zip`
> SHA 取自 `git rev-parse v0.33.1^{commit}`（已实测）。

## 表单字段对照

| 字段 | 填写值 | 本次是否改动 |
|------|--------|------------|
| **Title** | `godot-mcp-enhanced — MCP Server for AI` | 不变 |
| **Category** | Tools | 不变 |
| **Godot version** | 4.5 | 不变（插件兼容 4.5–4.7） |
| **License** | MIT | 不变 |
| **Version string** | `0.33.1` | **必改**（原 0.32.11） |
| **Download provider** | GitHub | 不变 |
| **Download URL** | `https://github.com/wgt19861219/godot-mcp-enhanced/archive/9ff97cc69260f5fc842cc7a91ff1baa16eafd5f2.zip` | **必改** |
| **Repository / Browse URL** | `https://github.com/wgt19861219/godot-mcp-enhanced` | 不变 |
| **Issues URL** | `https://github.com/wgt19861219/godot-mcp-enhanced/issues` | 不变 |
| **Icon URL** | `https://raw.githubusercontent.com/wgt19861219/godot-mcp-enhanced/master/icon.png`（256×256 PNG） | 不变 |
| **Previews** | 主图 `https://raw.githubusercontent.com/wgt19861219/godot-mcp-enhanced/master/store-thumbnail.png`（1280×720） | 不变 |

**归档内容校验（已实测）**：commit `9ff97cc6` 归档内 `addons/godot_mcp_server/plugin.cfg` 的 `version="0.33.1"`（`git show v0.33.1:addons/godot_mcp_server/plugin.cfg` 核实）；工具计数 46 tools / 271 actions（`node scripts/check-tool-count.mjs` 权威值，24 处文档校验一致，matrix version=0.33.1）。

## Description（BBCode，直接粘贴）

> 相比在库版本更新：工具计数 45→46 / 248→271（新增 dap 第 46 工具与大量新 action）；亮点列表补 DAP 直连调试/热加载自定义命令/弱网注入/多人状态同步/帧定时输入时间线；其余不变。

```bbcode
[b]godot-mcp-enhanced[/b] — a production-grade [b]Model Context Protocol (MCP)[/b] server bridging AI coding agents (Claude Code, Cursor, CodeBuddy, Cline, Codex CLI, ...) to the Godot editor.

This editor plugin is the Godot-side companion of the [url=https://github.com/wgt19861219/godot-mcp-enhanced]godot-mcp-enhanced[/url] npm package — together they give your AI agent:

[list]
[*][b]Live editor integration[/b] — real-time scene tree sync, undo/redo integration, multi-instance routing
[*][b]Native DAP debugger[/b] — the MCP server speaks Godot's built-in Debug Adapter Protocol directly: breakpoints, stack traces, variable inspection, stepping, REPL
[*][b]Deterministic playtest control[/b] — freeze/unfreeze/step_until with structured conditions, snapshot/restore, seed locking, frame-timed input timelines (L3 true determinism)
[*][b]Game bridge[/b] — query/write running games, input simulation, watch/monitor with explainable output (per-property drop naming + numeric min/max summaries), UI discovery, network condition emulation for multiplayer testing
[*][b]Hot-reloadable project commands[/b] — drop a .gd into res://mcp_commands/ to extend the bridge at runtime, plus multi-instance state snapshots for sync verification
[*][b]Systematic safety guards[/b] — GDScript sandbox scanning (regex + tokenizer), dangerous-API deny-lists, path whitelisting, untrusted-output envelopes, self-asset write protection, operation-level audit log
[*][b]46 tools / 271 actions[/b] — scenes, scripts, animation, TileMap, navigation, particles, audio, UI layout, recording, profiler, and more
[/list]

[b]Requirements[/b]
Godot 4.5–4.7 (tested on 4.6.3 & 4.7.2). The MCP server itself runs on Node.js: [code]npm i -g godot-mcp-enhanced[/code]

[b]Quick start[/b]
1. Enable this plugin: Project Settings → Plugins → [i]MCP Server[/i]
2. Install the server: [code]npx godot-mcp-enhanced setup[/code] (auto-configures your MCP client)
3. Ask your AI agent to open a scene, run the game, or set a breakpoint — in natural language

中文说明与完整文档见 [url=https://github.com/wgt19861219/godot-mcp-enhanced#readme]README[/url]（简体中文为主）。
```

## 备选（若表单 Provider 无 GitHub 项）

download_provider 选 Custom link，Download URL 不变（同一归档直链）。

## 提交后跟进

- 审核期间状态为 Testing；被编辑批准后转 Community
- 本次变更说明（若表单有 notes 字段可附）：
  - **v0.32.12–v0.32.21（P0–P10 系列，42 仓尽调清单全落地）**：第 46 工具 dap（DAP 直连断点调试）；sync_state 多人状态快照/比对；send_input_sequence 帧定时输入时间线（L3 确定性）；network_conditioner 弱网注入；mcp_commands 热加载；函数级 profiling；GDScript tokenizer 沙箱补盲；语义观察层（debug/player 档位+字段投影）；monitor 游戏时间调度
  - **v0.33.0**：全仓功能审查修复批——2 BLOCKING（project_replace 沙箱绕过/step_until AND 语义破坏）+ 14 IMPORTANT
  - **v0.33.1**：竞品启发加固批——monitor 输出可解释性（dropped_blocked 点名+极值摘要）、共享原子写 fs-atomic 收口、GODOT_PATH 误配显性报错
