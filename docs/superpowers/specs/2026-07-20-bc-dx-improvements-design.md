# Spec — B/C 档 DX 改进（4 限制）

**日期**：2026-07-20
**范围**：prior brainstorming 分出的 B/C 档 4 个限制的 DX 改进——C6（call_method 拒绝提示 EXTRA_METHODS env）+ B2（screenshot BLANK message 对齐 core.md）+ C5（运行时工具不持久化提示，公共 helper）+ B1（editor Ctrl+S 反向覆盖，文档补强）。均为 DX 提示/引导/文档，非核心逻辑改动。
**前置**：F1+F3+F2 完成（master `e622f81`）。来源 prior brainstorming（2026-07-19 插件限制盘点 6 类限制的 B/C 部分，A 档 + F1+F3+F2 已闭环）。

## 4 限制 design

### C6 — call_method 拒绝提示 EXTRA_METHODS env（最高 ROI）

**现状**：`src/tools/game-bridge.ts:633` 拒绝 message `Error: Unknown method "${method}". Supported: ${[...allowed].join(', ')}`——列支持方法但**没提示扩展方式**。用户被拒不知如何加业务方法（如 `take_damage`），须查源码才发现 `GODOT_MCP_BRIDGE_EXTRA_METHODS` env。

**方案**：message 加 env 提示：
```
Error: Unknown method "${method}". Supported: ${[...allowed].join(', ')}. 如需扩展业务方法，设环境变量 GODOT_MCP_BRIDGE_EXTRA_METHODS=method1,method2（opt-in；注意 emit_signal 等会触发已连接回调，安全降级）
```

**改动**：`game-bridge.ts:633` 一行 message 扩展。

### B2 — screenshot BLANK message 对齐 core.md

**现状**：`src/tools/screenshot.ts:99-104` BLANK message 提"2D rendering limitation in headless mode"+ `screenshot(action=analyze)`，但：
- 措辞旧（"2D rendering"），`.claude/rules/godot-mcp-core.md` 已改"Headless 用 RendererDummy 无渲染后端，2D CanvasItem 与 3D mesh 均不渲染像素"
- 没提 `Bridge take_screenshot`（游戏运行时 GPU viewport）/ editor GUI / 手动 F5 替代

**方案**：message 对齐 core.md + 列全替代：
```
⚠ Screenshot may be blank (headless RendererDummy 无 GPU 渲染，2D/3D 均空白).
替代：① Bridge take_screenshot（游戏运行时 GPU viewport，2D/3D 均可）② editor/GUI 模式截图 ③ 手动 F5 运行后截图 ④ screenshot(action=analyze) 分析本地文件
```

**改动**：`screenshot.ts:99-104` 两处 message（BLANK_DETECTED + 小文件 < 2KB）对齐重写。

### C5 — 运行时工具不持久化提示（公共 helper）

**现状**：运行时工具（`audio_play`/`particles_create`/`signal_connect`/`tilemap_*`/`animation_*` 等）返回无"不持久化"提示。`.claude/rules/godot-mcp-core.md` 有"运行时 vs 持久化"段，但工具返回不含提示。用户不知运行时工具改动 headless 进程退出后丢失，反复踩。

**方案 A（公共 helper，用户选）**：
- `src/tools/shared.ts` 加 `runtimePersistWarning(action: string): string` helper：
  ```
  ⚠ ${action} 是运行时操作，headless 进程退出后丢失。持久化须 add_node + save_scene 写入 .tscn（运行时工具仅用于验证/测试）
  ```
- 关键运行时工具返回包装加 warning（5 个核心）：`audio-ops.ts`/`particles.ts`/`signal-ops.ts`/`tilemap-ops.ts`/`animation/`

**改动**：helper（shared.ts）+ 5 工具返回包装。

**不含**：`node-3d-ops`/`physics-ops`/`material-ops`/`navigation`/`recording` 等其他运行时工具（留 follow-up，YAGNI 先核心 5）。

### B1 — editor Ctrl+S 反向覆盖（文档补强，用户选方案 B）

**现状**：`checkEditorSceneSave` 守卫（`src/core/ToolDispatcher.ts:657`）防 MCP 改盘时 editor 脏（MCP→editor 方向）。**反向（editor Ctrl+S 覆盖 MCP 改动）没防**——引擎行为不可控（用户在编辑器 Ctrl+S 用旧内存覆盖磁盘 MCP 改动）。

**方案 B（文档补强）**：`.claude/rules/godot-mcp-editor.md` 加一段：
> headless 改盘后编辑器须 Project→Reload 场景（或 File→Close Scene），否则编辑器内存的旧版本 Ctrl+S 会覆盖 MCP 改动。`checkEditorSceneSave` 守卫只防 MCP→editor 脏方向，反向（editor→MCP）是引擎行为不可控。

**改动**：`editor.md` 加一段（常见陷阱段）。

## 验证

1. `npm run check:gdscript`（无 GD 改动，应 errors=0 warnings=0）
2. `npx tsc --noEmit`（TS 改动编译）
3. `npm run lint`（0 errors）
4. `npx vitest run`（回归，4 pre-existing T11 elicitation 遗留不计）
5. `npm run build`
6. 用户端到端（可选）：
   - C6：bridge 连接时 `game_write call_method method=未知` → message 含 EXTRA_METHODS 提示
   - B2：headless `screenshot capture` 空白场景 → BLANK message 含 Bridge/editor 替代
   - C5：`audio_play`/`particles_create` → 返回含"不持久化"提示
   - B1：读 `editor.md`（文档）

## 不含

- B1 方案 A（守卫扩展 warning，用户选 B 文档）
- C5 方案 B（元数据架构改，用户选 A helper）
- 其他运行时工具（node-3d/physics/material/nav/recording）持久化提示（留 follow-up）
- 运行时工具实际持久化（设计如此，不改）
- call_method 白名单实际扩展（设计如此，只提示 env）
- screenshot 实际 GPU 渲染（引擎限制，只引导替代）

## 协作分工

- code + 文档 + build + 门禁：我（enhanced session）
- 用户端到端验证（可选）：用户配合
