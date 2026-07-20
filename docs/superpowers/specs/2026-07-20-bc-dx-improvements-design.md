# Spec — B/C 档 DX 改进（4 限制）

**日期**：2026-07-20
**范围**：prior brainstorming 分出的 B/C 档 4 个限制的 DX 改进——C6（call_method TS :634 message 引导正确调用语法）+ B2（screenshot BLANK message 对齐 core.md）+ C5（运行时工具不持久化提示，公共 helper）+ B1（editor Ctrl+S 反向覆盖，文档补强）。均为 DX 提示/引导/文档，非核心逻辑改动。
**前置**：F1+F3+F2 完成（master `e622f81`）。来源 prior brainstorming（2026-07-19 插件限制盘点 6 类限制的 B/C 部分，A 档 + F1+F3+F2 已闭环）。
**修订**：2026-07-20 spec eng-review（`D:\workspace\review\.claude\reviews\2026-07-20-bc-dx-improvements-spec-eng-review.md`）C1-C7 反馈纳入。C6 方案重构（原"提示设 env"前提错——TS :634 不读 env）。

## 4 限制 design

### C6 — call_method TS :634 message 引导正确调用语法（方向 b）

**reviewer C1 CRITICAL（核实成立）**：TS 层 `game-bridge.ts` method 集合（QUERY_METHODS/WRITE_METHODS 含 `call_method`/INPUT_METHODS）是**编译期硬编码 Set**，`grep EXTRA_METHODS|process.env|GODOT_MCP_BRIDGE` 零命中——TS 层不读 env。`EXTRA_METHODS` env 只作用 bridge 运行时层 `mcp_bridge.gd:764-775 _cmd_call_method`，且 bridge :775 拒绝 message **已提示 env**：`Method not allowed: %s (set env GODOT_MCP_BRIDGE_EXTRA_METHODS to allow)`。

**两条调用路径**：
- 正确用法 `game_write method=call_method params={method:"take_damage"}`：`:634` 不拦（`call_method ∈ WRITE_METHODS`）→ bridge `_cmd_call_method` → 业务方法走 ALLOWED_METHODS/EXTRA_METHODS → `:775` 拒绝已提示 env ✅（**无需改**）
- 错误用法 `game_write method=take_damage`（业务方法当桥接命令）：`:634` 拦（`take_damage ∉ WRITE_METHODS`）→ 现 message `Error: Unknown method "take_damage". Supported: set_node_property, call_method` **不引导正确语法**，用户不知该走 `call_method params`

**方案（b）**：`:634` message 引导正确调用语法 + env context（env 作用 bridge 层 call_method 路径）：
```
Error: Unknown bridge method "${method}". Supported: ${[...allowed].join(', ')}. 业务方法（如 take_damage/emit_signal）请用 game_write method=call_method params={method:"业务方法名", args:[...]}（bridge 运行时白名单校验，可通过 GODOT_MCP_BRIDGE_EXTRA_METHODS env 扩展）
```

**env 提示准确性**：`:634` 不读 env，但引导 `call_method params` 路径后，env 在 bridge 层（`:764-775`）有效。修正原 spec 直接提 env 的误导（原暗示 `:634` 读 env）。

**改动**：`game-bridge.ts:633` 一行 message。**不含 game_wait**（独立 handler `:455+` TS 轮询，不经 `:634`，reviewer C2 核实）。

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

**reviewer C4**：message 宣传的 `screenshot(action=analyze)` 有 open 安全 finding（screenshot-analyze-path-leak，analyze 读本地 `image_path` 路径校验）。本 spec **不顺带修**（独立安全工作，超 B2 范围），B2 message 保留 analyze 替代，path-leak 留独立 follow-up。

### C5 — 运行时工具不持久化提示（公共 helper）

**现状**：运行时工具（`audio_play`/`particles_create`/`signal_connect`/`tilemap_*`/`animation_*` 等）返回无"不持久化"提示。`.claude/rules/godot-mcp-core.md` 有"运行时 vs 持久化"段。用户不知运行时工具改动 headless 进程退出后丢失，反复踩。

**reviewer C3**：`src/tools/shared.ts` 是 7 行 barrel（仅 re-export），helper 不应落此。

**方案 A（公共 helper，用户选）**：
- 新建 `src/tools/shared/persistence-warning.ts`，导出 `runtimePersistWarning(action: string): string`：
  ```
  ⚠ ${action} 是运行时操作，headless 进程退出后丢失。持久化须 add_node + save_scene 写入 .tscn（运行时工具仅用于验证/测试）
  ```
- `src/tools/shared.ts` barrel 加 `export * from './shared/persistence-warning'`
- 关键运行时工具返回包装加 warning（5 个核心）：`audio-ops.ts`/`particles.ts`/`signal-ops.ts`/`tilemap-ops.ts`/`animation/`

**reviewer C5 finding（验证预警）**：包装 warning 可能 break 现有返回断言测试（工具返回结构/text 变）。包装策略：warning 追加到返回 text 末尾（不破坏结构化 result 字段），尽量不 break。plan 验证步骤须跑相关工具测试，断言可能需同步。

**实际实现偏差（`92537b7` fix，2026-07-20）**：原"warning 追加 text 末尾"假设**错**——5 工具 `parseGdscriptResult` 返回 `textResult(JSON.stringify(opsSuccess(...)))`，**text 是 JSON 字符串**，末尾追加 warning 破坏 `JSON.parse(content[0].text)` 消费契约（项目 146 处消费者）。fix 改用 `appendRuntimePersistWarning(result, action)` helper **追加独立 content 元素**（`content[1]` = warning text，不动 `content[0]` JSON）+ mutation testing 铁证（回退 mutate → 7 测试失败）。task reviewer CRITICAL 抓到（详见 `.superpowers/sdd/task-3-c5-report.md`）。**未来读此 spec 勿走"text 末尾"老路**。

**改动**：新文件 `persistence-warning.ts` + barrel + 5 工具返回包装。

**不含**：`node-3d-ops`/`physics-ops`/`material-ops`/`navigation`/`recording` 等其他运行时工具（留 follow-up，YAGNI 先核心 5）。

### B1 — editor Ctrl+S 反向覆盖（文档补强，用户选方案 B）

**现状**：`checkEditorSceneSave` 守卫（`src/core/ToolDispatcher.ts:657`）防 MCP 改盘时 editor 脏（MCP→editor 方向）。**反向（editor Ctrl+S 覆盖 MCP 改动）没防**——引擎行为不可控（用户在编辑器手动 Ctrl+S 用旧内存覆盖磁盘 MCP 改动）。

**方案 B（文档补强，reviewer C7 措辞明确触发条件）**：`.claude/rules/godot-mcp-editor.md` 加一段：
> headless 改盘后，**若编辑器开着同一场景**，编辑器内存的旧版本 Ctrl+S 会覆盖 MCP 改动——须 Project→Reload 场景（或 File→Close Scene）。`checkEditorSceneSave` 守卫只防 MCP→editor 脏方向；反向（editor→MCP）是引擎行为（用户手动 Ctrl+S），MCP 端不可控。

**改动**：`editor.md` 加一段（常见陷阱段）。

## 验证

1. `npm run check:gdscript`（无 GD 改动，应 errors=0 warnings=0）
2. `npx tsc --noEmit`（TS 改动编译）
3. `npm run lint`（0 errors）
4. `npx vitest run`（回归，4 pre-existing T11 elicitation 遗留不计；**C5 包装 warning 后跑 audio/particles/signal/tilemap/animation 工具测试，断言可能需同步**——reviewer C5 预警）
5. `npm run build`
6. 用户端到端（可选）：
   - C6：`game_write method=take_damage`（错误用法）→ message 引导 `call_method params` + env 提示；`game_write method=call_method params={method:"take_damage"}`（正确用法）→ bridge :775 message 提示 env
   - B2：headless `screenshot capture` 空白场景 → BLANK message 含 Bridge/editor 替代
   - C5：`audio_play`/`particles_create` → 返回含"不持久化"提示
   - B1：读 `editor.md`（文档）

## 不含

- C6 方向 (a)（TS 集合读 env，放大安全攻击面）/(c)（取消，:634 错误用法 message 不友好）
- B1 方案 A（守卫扩展 warning，用户选 B 文档）
- C5 方案 B（元数据架构改，用户选 A helper）
- screenshot-analyze-path-leak 修复（reviewer C4，独立安全 follow-up）
- 其他运行时工具（node-3d/physics/material/nav/recording）持久化提示（留 follow-up）
- 运行时工具实际持久化（设计如此，不改）
- call_method 白名单实际扩展（设计如此，只引导正确语法 + env 提示）
- screenshot 实际 GPU 渲染（引擎限制，只引导替代）

## 协作分工

- code + 文档 + build + 门禁：我（enhanced session）
- 用户端到端验证（可选）：用户配合
