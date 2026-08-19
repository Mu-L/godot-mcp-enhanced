# Godot Asset Library 提交材料 — v0.29.0

> 提交入口：https://godotengine.org/asset-library/asset/edit （需 Godot 账号登录）
> 本文档为逐字段对照材料，提交后进入审核队列（初列 Testing，编辑审核后转 Community）。

> [!warning] Download URL 约定纠偏(2026-08-19,用户确认)
> 本文记录的 release addon.zip 直链**不是实际惯例**——AssetLib 条目 5193 历次更新用的都是
> **GitHub commit 归档直链**:`https://github.com/wgt19861219/godot-mcp-enhanced/archive/<完整40位SHA>.zip`
> (SHA = 对应 tag 的 commit,`git rev-parse <tag>^{commit}`)。后续版本更新照此格式,勿再建议 release zip 链接。

## 表单字段对照

| 字段 | 填写值 |
|------|--------|
| **Title** | `godot-mcp-enhanced — MCP Server for AI` |
| **Category** | Tools |
| **Godot version** | 4.5 |
| **License** | MIT |
| **Version string** | `0.29.0` |
| **Download provider** | GitHub |
| **Download URL** | `https://github.com/wgt19861219/godot-mcp-enhanced/releases/download/v0.29.0/godot-mcp-enhanced-addon.zip` |
| **Repository / Browse URL** | `https://github.com/wgt19861219/godot-mcp-enhanced` |
| **Issues URL** | `https://github.com/wgt19861219/godot-mcp-enhanced/issues` |
| **Icon URL** | `https://raw.githubusercontent.com/wgt19861219/godot-mcp-enhanced/master/icon.png`（256×256 PNG） |
| **Previews**（可选） | 主图 `https://raw.githubusercontent.com/wgt19861219/godot-mcp-enhanced/master/store-thumbnail.png`（1280×720） |

**下载包校验**（已验证）：zip 顶层 `addons/godot_mcp_server/`，37 文件，`plugin.cfg` version=0.29.0，附 `.sha256`。tag push 由 release.yml 自动构建，后续发版无需手动打包。

## Description（BBCode，直接粘贴）

```bbcode
[b]godot-mcp-enhanced[/b] — a production-grade [b]Model Context Protocol (MCP)[/b] server bridging AI coding agents (Claude Code, Cursor, CodeBuddy, Cline, Codex CLI, ...) to the Godot editor.

This editor plugin is the Godot-side companion of the [url=https://github.com/wgt19861219/godot-mcp-enhanced]godot-mcp-enhanced[/url] npm package — together they give your AI agent:

[list]
[*][b]Live editor integration[/b] — real-time scene tree sync, undo/redo integration, multi-instance routing
[*][b]Interactive debugger[/b] — breakpoints, stack traces, variable inspection, expression evaluation, step control
[*][b]Deterministic playtest control[/b] — freeze/unfreeze/step_until with structured conditions, snapshot/restore, seed locking
[*][b]Game bridge[/b] — query/write running games, input simulation, watch/monitor with auto-reconnect, UI discovery
[*][b]Systematic safety guards[/b] — GDScript sandbox scanning, dangerous-API deny-lists, path whitelisting, operation-level audit log, confirmation gates for destructive ops
[*][b]41 tools / 230+ actions[/b] — scenes, scripts, animation, TileMap, navigation, particles, audio, UI layout, recording, profiler, and more
[/list]

[b]Requirements[/b]
Godot 4.5–4.7 (tested on 4.6.3 & 4.7.1). The MCP server itself runs on Node.js: [code]npm i -g godot-mcp-enhanced[/code]

[b]Quick start[/b]
1. Enable this plugin: Project Settings → Plugins → [i]MCP Server[/i]
2. Install the server: [code]npx godot-mcp-enhanced setup[/code] (auto-configures your MCP client)
3. Ask your AI agent to open a scene, run the game, or set a breakpoint — in natural language

中文说明与完整文档见 [url=https://github.com/wgt19861219/godot-mcp-enhanced#readme]README[/url]（简体中文为主）。
```

## 备选（若表单 Provider 无 GitHub 项）

download_provider 选 Custom link，Download URL 不变（同一 release 直链）。

## 提交后跟进

- 审核期间状态为 Testing；被编辑批准后转 Community
- 后续发版：编辑已有 asset，更新 version_string + download URL 到新 tag，无需重新提交
- 同材料可复用于后续版本（release.yml 自动出新 zip）
