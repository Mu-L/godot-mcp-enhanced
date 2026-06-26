# 审查修复 Backlog（2026-06-26 full review）

| 项 | 值 |
|---|---|
| 来源审查 | `D:\workspace\review\.claude\reviews\2026-06-26-godot-mcp-enhanced-full-review.md` |
| HEAD / 版本 | `f6cd7d4`（Merge PR #14）/ v0.18.2 |
| 独立核码 | CRITICAL-1 + 8 新 IMPORTANT（IMP-1/2/3/4/5/6/9/11）**全属实，0 反例**；主审修正子代理正确；defects 闭环真实 |
| 关联 | reviewer `defects.md`（`D:\workspace\review\.claude\knowledge\defects.md`）+ 项目 `test/regression/defects.ts` |

## 合并状态

PR #14 已合并 master（`f6cd7d4`）。**本地单用户 MCP 场景可合并**（与项目信任模型一致，guard.ts:127-130 单客户端假设）。**多用户/容器/CI 部署前必修 P0**。

---

## P0 — 多用户/容器/CI 部署前必修

### CRITICAL-1  guard.ts GUARDED 扩展（confirm-token-trust-broken 未完成修复）
- **文件**: `src/guard.ts:52-68`
- **核实**: ✅ GUARDED 仅 scene(4)/script(6)/animation(1)/tilemap(1)/game(2)/runtime(3)。`game_write`(含 `call_method` 任意方法 RPC)/scene 写类(add_node/edit_node/set_instance_property/commit/create_3d_node/instance_scene)/material\|particles\|signal\|nav\|audio\|ui\|physics **整类**无确认门。`requiresConfirmation('game',{action:'game_write'})`→false。
- **修法**: GUARDED 扩到所有写/删除/执行类。至少：
  - `game` 加 `game_write`（set_node_property/call_method）
  - `scene` 加 `add_node/edit_node/set_instance_property/commit/create_scene/create_3d_node/instance_scene`
  - 新增 `material/particles/signal/nav/audio/ui/physics` 的写动作
- **effort**: 中（GUARDED 扩展 + requiresConfirmation 测试 + capability matrix 同步）
- **关联 defect**: `confirm-token-trust-broken`(fixed→open)、`set-prop-no-type-whitelist`(call_method 运行时通道)

### P0-复发-1  spawn-without-buildsafeenv（launcher.ts:46）— IMP-9
- **文件**: `src/dashboard/launcher.ts:46`
- **核实**: ✅ `childEnv = {...process.env, GODOT_MCP_NO_DASHBOARD:'1'}` 未 buildSafeEnv 过滤 → 敏感 env（GODOT_MCP_DISABLE_SAFETY/UNRESTRICTED/token）透传 dashboard 子进程
- **修法**: `{ ...buildSafeEnv(), GODOT_MCP_NO_DASHBOARD:'1' }`（一行）
- **effort**: 小
- **关联**: `spawn-without-buildsafeenv`(部分修复→复发)

### P0-复发-2  duplication-across-layers（GDScript 安全函数双份）— IMP-10
- **文件**: `addons/godot_mcp_server/websocket_server.gd` + `commands/*.gd`
- **核实**: 审查称 `_constant_time_compare`/`_generate_secret`/`_restrict_secret_permissions` 三处双份（82%）。**待独立核码**（本轮未核 addons/）。
- **修法**: 抽 `shared/security.gd` preload，三函数唯一化
- **effort**: 中
- **关联**: `duplication-across-layers`(部分修复→复发)

### P0-复发-3  set-prop-no-type-whitelist（material + scene-commit node_add）— IMP-1 + IMP-4
- **文件**: `src/tools/material-ops.ts:678-693`（IMP-1）+ `src/tools/scene/scene-commit.ts:236`（IMP-4）
- **核实**: ✅ material-ops 未用 BLOCKED_PROPS（grep 确认 scene 子系统有、material 无）；scene-commit node_add :236 `isSafeIdentifier(op.type)` 不限 Node 子类白名单
- **修法**:
  - material：BLOCKED_PROPS 抽 `shared` 复用 + set_params 覆盖
  - scene-commit：`_validate_node_type`（仅 Node 子类 + 阻断 HTTPRequest/Thread/Engine 等敏感基类）
- **effort**: 中
- **关联**: `set-prop-no-type-whitelist`(部分修复→复发)

---

## P1 — 新 IMPORTANT（独立核码全属实，建议修）

| # | 文件 | 核实 | 修法 | effort |
|---|------|------|------|--------|
| IMP-2 | `shared/value-serializer.ts:13-24` gdEscape | ✅ 未转义 ` `/` `(LS/PS)，未与 serializeGdValue 同步 | gdEscape 加 LS/PS 转义，两处统一 | 小 |
| IMP-3 | `tscn/tscn-editor-shared.ts:35,61` escapeTscnAttr/Value | ✅ 转义 `]` 不转义 `[`，换行已拒、单行 `[` 污染残留 | 加 `.replace(/\[/g,'\\[')`（一行） | 小 |
| IMP-5 | `tools/navigation.ts:371,385` nodeName | ✅ 仅检查存在、无字符校验，含 `/` 破坏 NodePath | 加 `isSafeIdentifier(nodeName)`（与 scene 一致） | 小 |
| IMP-6 | `guard.ts:48-51` + `core/ToolDispatcher.ts:510-527` | ✅ 注释自承认 legacy name 绕过 guard；当前单入口总 merged name，legacy 路径存在即风险 | guard 在 legacy 映射后判，或 legacy 路径默认拒 | 中 |
| IMP-11 | `addons/.../recording_commands.gd:13` _input | ✅ 仅 InputEventKey + InputEventMouseButton；回放仅 mouse_click/mouse_move。无 ScreenTouch → 触屏失效 | _input 加 ScreenTouch 分支 + 回放 touch 类型 | 中 |

**未独立核（采信审查 80-82%）**：IMP-7（instance-api-auth HMAC 零调用）/ IMP-8（EditorConnection 标志组合）/ IMP-12（plugin.gd super 需运行时确认）。

---

## P2 — 历史 open 确认（符合 status，长期/场景驱动）

`ts-args-as-cast-no-validation`(326 处 as) ｜ `version-hardcoded-drift`(14 处 4.6) ｜ `secret-cache-and-perm-weak`(TTL 5min 未达 60s) ｜ `websocket-auth-once-plaintext`(明文 ws) ｜ `regex-danger-api-bypassable`(黑名单本质，多用户需容器) ｜ `module-level-mutable-state`(19 处) ｜ `secret-file-toctou-race`(三步分离) ｜ 12 ADVISORY（见审查报告 §ADVISORY）

---

## 建议执行顺序

1. **P0 小 effort 先**：复发-1（launcher 一行）→ CRITICAL-1（GUARDED 扩展，最大安全收益）→ 复发-3（material/scene-commit）→ 复发-2（GDScript 安全函数）
2. **P1 小 effort 先**：IMP-3（escapeTscn `[` 一行）→ IMP-2（gdEscape LS/PS）→ IMP-5（navigation nodeName）→ IMP-6/11（中）
3. **P2**：长期，按部署场景驱动（多用户/公开部署时优先 regex-danger + websocket-auth）

## 备注

- 审查报告自身局限：无 Godot 运行时，GDScript 正确性靠静态分析；plugin.gd super() 边界需运行时确认。
- 本 backlog 的"核实 ✅"均为本轮独立读码确认（非转述审查）。
- IMP-10（GDScript 双份）+ IMP-7/8/12 + 全部 ADVISORY 未独立核码，标"采信审查"。
