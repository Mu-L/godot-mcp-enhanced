# Godot Asset Library 提交材料 — v0.32.11

> 提交入口：https://godotengine.org/asset-library/asset/edit （需 Godot 账号登录）
> **本次为编辑已有条目 5193**：更新 Version string + Download URL 两处必改；Description 顺手更新计数。提交后进入审核队列（初列 Testing，编辑审核后转 Community）。
>
> Download 惯例（2026-08-21 API 实测条目 5193 终版）：**表单不填完整 URL**——
> Download provider 选 `GitHub`，在 **commit 字段**填 tag 对应的**完整 40 位 SHA**
> （`git rev-parse <tag>^{commit}`），系统自动拼接 download_url。
> 实测依据：`curl https://godotengine.org/asset-library/api/asset/5193` 返回
> `download_commit: cfcca84f3296...`（= v0.32.6 tag commit，40 位）、download_provider: GitHub。
> 即从完整 URL `archive/<SHA>.zip` 里**截取那串 SHA 字符串**填 commit 字段即可。

## 表单字段对照

| 字段 | 填写值 | 本次是否改动 |
|------|--------|------------|
| **Title** | `godot-mcp-enhanced — MCP Server for AI`（库内现值 `Godot MCP Enhanced`） | 不变 |
| **Category** | Tools | 不变 |
| **Godot version** | 4.5 | 不变（插件兼容 4.5–4.7；库内现值 4.3，如顺手可改 4.5） |
| **License** | MIT | 不变 |
| **Version string** | `0.32.11` | **必改**（原 0.32.6） |
| **Download provider** | GitHub | 不变 |
| **Download commit** | `3f611ce6f5b57fe7d1214674dd3843646ac51785` | **必改**（完整 40 位；原 cfcca84f...；URL 由系统拼接，无需手填） |
| **Repository / Browse URL** | `https://github.com/wgt19861219/godot-mcp-enhanced` | 不变 |
| **Issues URL** | `https://github.com/wgt19861219/godot-mcp-enhanced/issues` | 不变 |
| **Icon URL** | `https://raw.githubusercontent.com/wgt19861219/godot-mcp-enhanced/master/icon.png`（256×256 PNG） | 不变 |
| **Previews** | 主图 `https://raw.githubusercontent.com/wgt19861219/godot-mcp-enhanced/master/store-thumbnail.png`（1280×720） | 不变 |

**归档内容校验（已实测）**：commit `3f611ce` 归档内 `addons/godot_mcp_server/plugin.cfg` 的 `version="0.32.11"`（`git show v0.32.11:addons/godot_mcp_server/plugin.cfg` 核实）；系统拼接的归档直链 `archive/3f611ce...zip` curl 实测 302 → codeload → 200；工具计数 45 tools / 248 actions（`node scripts/check-tool-count.mjs` 权威值，24 处文档校验一致）。

## Description（BBCode，直接粘贴）

> 相比在库版本更新两处：工具计数 41→45 / 230+→248；tested 4.7.1→4.7.2（本次 CI 矩阵实测 4.6.3 & 4.7.2）。

```bbcode
[b]godot-mcp-enhanced[/b] — a production-grade [b]Model Context Protocol (MCP)[/b] server bridging AI coding agents (Claude Code, Cursor, CodeBuddy, Cline, Codex CLI, ...) to the Godot editor.

This editor plugin is the Godot-side companion of the [url=https://github.com/wgt19861219/godot-mcp-enhanced]godot-mcp-enhanced[/url] npm package — together they give your AI agent:

[list]
[*][b]Live editor integration[/b] — real-time scene tree sync, undo/redo integration, multi-instance routing
[*][b]Interactive debugger[/b] — breakpoints, stack traces, variable inspection, expression evaluation, step control
[*][b]Deterministic playtest control[/b] — freeze/unfreeze/step_until with structured conditions, snapshot/restore, seed locking, frame-timed input timeline
[*][b]Game bridge[/b] — query/write running games, input simulation, watch/monitor with auto-reconnect, UI discovery
[*][b]Systematic safety guards[/b] — GDScript sandbox scanning, dangerous-API deny-lists, path whitelisting, operation-level audit log, confirmation gates for destructive ops
[*][b]45 tools / 248 actions[/b] — scenes, scripts, animation, TileMap, navigation, particles, audio, UI layout, recording, profiler, and more
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

download_provider 选 Custom link，此时无 commit 字段，Download URL 手填完整归档直链：
`https://github.com/wgt19861219/godot-mcp-enhanced/archive/3f611ce6f5b57fe7d1214674dd3843646ac51785.zip`

## 提交后跟进

- 审核期间状态为 Testing；被编辑批准后转 Community
- 本次变更说明（若表单有 notes 字段可附）：bridge 反馈三坑收口（find_nodes root 限定 / install_override 段末尾 / call_method 协程双模式）、bridge 端口竞态缓解（起始候选随机化 + secret 窗口扫描）、CI e2e 并行竞态修复
