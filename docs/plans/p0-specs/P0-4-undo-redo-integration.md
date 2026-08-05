# P0-4 EditorUndoRedoManager 集成（补全 + 强化）

> **状态**：spec（待实施）
> **优先级**：P0
> **来源**：heren-mcp 的 `addons/heren/undo_redo_wrapper.gd`（<100 行）
> **基线**：enhanced v0.25.3
> **重要修正**：调研报告称"enhanced addon 无 undo_redo_wrapper"——**实测已存在** `addons/godot_mcp_server/undo_manager.gd`（75 行）+ 完整测试套件 `test_undo_manager.gd`。本 spec 聚焦"补全未接入的 handler + 强化语义"，非从零移植。

---

## 1. 目标

所有 AI 触发的 mutation（add_node / set_property / connect_signal / scene_instance / particle_set 等）经 `EditorUndoRedoManager`，用户在编辑器 Ctrl+Z 可逐步撤销。这是 UX 信任问题——AI 改场景后用户失去控制感是 adoption 阻塞。

---

## 2. 现状基线（实测，非调研报告）

### 2.1 已有 wrapper（`undo_manager.gd`，75 行）

```
addons/godot_mcp_server/undo_manager.gd
├── setup(plugin)                              # 绑定 EditorPlugin
├── create_action_mixed(name, do_ops, undo_ops)  # 主入口
├── _add_method(undo_redo, mode, target, method, args)  # callv spread vararg
├── _add_method_call(undo_redo, mode, m)
└── _apply_op(undo_redo, mode, op)             # 分发 method/property/reference
```

**已解决的关键 bug**（注释明确）：
- varargs 用 `callv` spread，避免 `add_do_method(cb)` Callable 风格静默不注册
- `add_do_reference` 仅限 Node，对 Resource 推 warning 跳过
- null/freed target 守卫

### 2.2 handler 接入度（grep 实测）

> [!warning] 修订（2026-08-05，依据 N-4）
> 原表格数字系统性虚高 2-3 倍（spec 称 ui=25/particle=16/animation=15，实测 ui=14/particle=5/animation=7）。已用 `grep -c create_action_mixed addons/godot_mcp_server/commands/**/*.gd` 重新统计。同时补列原表漏掉的 `asset/asset_commands.gd`（1 引用）和 `asset/asset_placer.gd`（7 引用）。

| command 文件 | `create_action_mixed` 引用数 | 状态 |
|------|------|------|
| ui_commands.gd | 14 | 已接入 |
| animation_commands.gd | 7 | 已接入 |
| node_commands.gd | 6 | 已接入 |
| particle_commands.gd | 5 | 已接入 |
| nav_commands.gd | 5 | 已接入 |
| animtree_commands.gd | 4 | 已接入 |
| scene_commands.gd | 3 | 已接入（部分） |
| **asset/asset_placer.gd** | **7** | **已接入**（原表漏列） |
| **asset/asset_commands.gd** | **1** | **已接入**（原表漏列） |
| command_helpers.gd | 1 | 辅助 |
| export_commands.gd | 0 | 未接入 |
| recording_commands.gd | 0 | 未接入（见 §3.1，editor 路径禁用，**删除接入项**） |
| sync_commands.gd | 0 | 未接入（见 §3.1，纯观察者无 mutation，**删除接入项**） |
| **test_commands.gd** | **0** | **未接入**（见 §3.1，原表"4"为误判，实测仅注入 undo_manager 到 test 上下文，0 个 `create_action_mixed` 调用） |

**实测命令**（供复审者验证）：
```bash
for f in addons/godot_mcp_server/commands/*.gd addons/godot_mcp_server/commands/asset/*.gd; do
  n=$(grep -c "create_action_mixed" "$f"); echo "$n  $f"
done | sort -rn
```

### 2.3 已有测试

`addons/godot_mcp_server/testing/suites/test_undo_manager.gd`（208 行）覆盖：setup / add+remove node / null target 守卫 / property do+undo / unknown type 警告。

---

## 3. 工作范围（本 spec 实际要做的事）

### 3.1 补全未接入 handler（删除误判项后的实际范围）

> [!warning] 修订（2026-08-05，依据 B-5/B-6/N-5）
> 原表列了 3 个待接入项（export / recording / sync）。**经实测复核，全部删除**：
> - **sync_commands.gd（B-5）**：grep 实测全文 186 行**无任何场景树 mutation**（`add_child`/`remove_child`/`set_owner`/`queue_free` 等 0 命中）。其职责是 connect/disconnect SceneTree 信号 + 只读序列化 + notification，**纯观察者，无 undo 语义**。把信号 connect 接入 EditorUndoRedoManager 无意义。
> - **recording_commands.gd（B-6）**：`recording_commands.gd:23,92,117` 在 `Engine.is_editor_hint()` 为 true 时直接拒绝（return）。EditorUndoRedoManager 是 editor-only API，而 recording 在 editor 路径被禁用强制走 Bridge——接入 editor-only 的 UndoRedoManager 逻辑矛盾。
> - **test_commands.gd（N-5）**：原表"已接入"标注错误。实测 0 个 `create_action_mixed` 调用，仅注入 undo_manager 到 test 上下文。**修正为"未接入"**，但 test 命令本身不产生需要 undo 的场景 mutation，无需接入。

| handler | 文件 | 状态 | 决策 |
|---------|------|------|------|
| export 操作 | `export_commands.gd` | 未接入 | **不可逆**（落盘文件，无 undo 语义）→ 文档说明，不接入 |
| recording 操作 | `recording_commands.gd` | 未接入 | **删除接入项**（B-6：editor 路径禁用，与 EditorUndoRedoManager 矛盾） |
| sync 操作 | `sync_commands.gd` | 未接入 | **删除接入项**（B-5：纯观察者，无 mutation，无 undo 语义） |
| test 操作 | `test_commands.gd` | 未接入 | **修正标注**（N-5：原"已接入"误判），无需接入 |

**结论**：本 spec 的"补全未接入 handler"工作项**全部删除**。§3 的工作范围收缩为仅 §3.2（审查已接入 handler）+ §3.3（wrapper 强化，可选）。

### 3.2 审查已接入 handler 的 undo 正确性

调研报告的"heren 移植"对 enhanced 不适用（已有实现）。重点改为审查：

- **undo_ops 是否对称**：`handle_add_node` 的 do 是 `add_child`+`set_owner`+`reference`，undo 是 `remove_child`——但 `remove_child` 后节点是否被 `queue_free`？（注释明确"不 queue_free，reference 让 UndoRedo 管理生命周期"——正确）
- **property coerce 失败时的部分回滚**：`handle_add_node:67-74` property 失败时 `failed.append` 但节点已 add——是否应在 action 前预校验全部 property？

> [!warning] 修订（2026-08-05，依据审查 N-4 配套）
> 原表第 2 行"多步操作的事务边界：`handle_batch_add_nodes` 是否一个 action 包多 do_op"作为**审查项保留**，但**删除"事务边界"作为验收标准**（见 §6 验收 3 修订）。事务边界是设计选择（一个 action vs 多个 action），不是 undo 正确性的硬性要求——逻辑倒置会强求 handler 改写。审查时只需**记录现状**，不强求统一。

### 3.3 wrapper 强化（可选，看实测）

heren wrapper 是单文件 <100 行，enhanced 已 75 行，结构相当。可借鉴的点：
- heren 可能有的 `begin_action`/`commit_action` 显式分步 API（enhanced 现在是 `create_action_mixed` 一次性提交）——若某些 handler 需要在 do/undo 之间插入运行时计算，需补分步 API
- 版本兼容性 shim（见 §5）

---

## 4. 改动清单

> [!warning] 修订（2026-08-05，依据 B-5/B-6）
> 删除原表前两行 `sync_commands.gd` 和 `recording_commands.gd` 的"接入 undo"改动项（见 §3.1 决策）。删除 `test_sync_undo.gd` 新建项（sync 不接入，无需回归）。删除 `undo_manager.gd` 的 `begin_action/commit_action` 分步 API（该需求源自 sync handler，sync 不接入则不需要）。

| 文件 | 类型 | 改动 |
|------|------|------|
| `addons/godot_mcp_server/commands/scene_commands.gd` | 改（审查） | 审查 `handle_open_scene`/`handle_save_scene` 是否需 undo（语义存疑，见 §7）。**预期决策：不接入**（场景级 open/save 不应被 Ctrl+Z 跨场景切换） |
| `addons/godot_mcp_server/commands/command_helpers.gd` | 改（可选） | 抽取公共 undo op 构造 helper（减少重复，仅当审查发现显著重复时） |
| `addons/godot_mcp_server/undo_manager.gd` | 改（文档） | 顶部注释明确"哪些 handler 接入、哪些不接入、为什么"（含 sync/recording/test/export 不接入的理由） |
| `addons/godot_mcp_server/testing/suites/test_undo_manager.gd` | 改 | 补充 asset_placer / asset_commands 的 undo 回归用例（原 spec 漏列这两个已接入文件） |
| `CHANGELOG.md` | 改 | 记录审查范围 + 修正 handler 接入度表格 |

---

## 5. 向后兼容

### 5.1 addon 版本化

enhanced 的 addon 是分发给目标项目的（用户项目 `addons/godot_mcp_server/`）。补全 undo 接入是**纯增量**改动（新增 `_undo_manager` 调用），不改 wrapper 公共 API。老项目升级路径：

1. 用 `godot-mcp-enhanced self-update`（已有 `self_update` 工具）拉新版 addon
2. 老 wrapper 的 `create_action_mixed` 签名不变 → 已接入的 handler 无需改
3. 新接入的 handler（sync/recording）自动获得 undo 能力

### 5.2 Godot 版本兼容

| Godot 版本 | EditorUndoRedoManager API | 实测状态 |
|-----------|--------------------------|---------|
| 4.4 | 稳定（enhanced 当前基线） | 已验证（test_undo_manager 通过） |
| 4.5 | 同 4.4（无破坏性变更） | 需实测 |
| 4.6 | 同 4.4 | 需实测 |
| 4.7（如发布） | 待观察 | 兜底：wrapper 内 try/catch + 降级为直接 mutation（不 undo） |

**关键风险点**：`add_do_method` 的 varargs 行为。wrapper 已用 `callv` 规避（注释 `undo_manager.gd:30-34`），但 Godot 小版本可能收紧 varargs 类型检查。spec 实施时必须在 4.5/4.6 各跑一遍 `test_undo_manager.gd`。

### 5.3 降级路径

`_undo_manager == null` 时（如 headless 模式或 plugin 未加载），所有 handler 已有 else 分支直接 mutation（见 `node_commands.gd:85-89`）。补全 sync/recording 时必须保留这条降级路径。

---

## 6. 验收标准

> [!warning] 修订（2026-08-05，依据 B-4 + 删除基于误判的验收）
> **新增 `npm run check:gdscript` 硬门禁**（B-4，AGENTS.md §6 强制项）。**删除验收 2**（AI sync 操作后 Ctrl+Z，基于 B-5 误判，sync 无 mutation 不接入 undo）。**删除验收 5**（headless 降级 sync handler，基于 B-5 误判）。**修正验收 4**：原"property 失败的部分回滚"保留为审查项但**不强求改写**（§3.2 已说明）。**删除验收 3 的"事务边界"硬性要求**（事务边界是设计选择，逻辑倒置会强求 handler 改写，详见 §3.2 修订）。

1. **AI add_node 后 Ctrl+Z**：节点从场景树消失（已有用例 `test_create_action_mixed_adds_and_removes_node` 验证）
2. **property 失败的审查**：审查 `handle_add_node:67-74` 当前行为并**记录现状**；若 property coerce 失败导致节点已 add，文档说明是否需改为"先校验全部 property，再 create_action"（不强求改写，留 P1 评估）
3. **多步 AI 操作**：连续 3 次 mutation 后，Ctrl+Z 三次可逐步撤销（验证 undo 栈不被合并；不强求 handler 改写事务边界，仅记录现状）
4. **headless 降级**：`_undo_manager == null` 时已接入 handler（node_commands 等）仍工作（直接 mutation，不 crash）
5. **回归**：现有 `test_undo_manager.gd` 全绿；补充的 asset_placer / asset_commands 用例全绿
6. **`npm run check:gdscript` 必须通过**（B-4，AGENTS.md §6 硬门禁）：
   ```
   npm run check:gdscript
   ```
   AGENTS.md §6 明确：`validate_scripts` 逐文件 parse **有盲区**（2026-08-01 P2-12 教训：animation_commands else 缩进 bug 经 validate_scripts 0 error 漏网）。**`check:gdscript` 是项目级完整编译**（fixture 项目 `test/fixtures/gdscript-check` 启用 plugin 跑 `godot --headless --import`），能抓 validate_scripts 漏的块缩进/结构 bug。本 spec 改 `addons/godot_mcp_server/undo_manager.gd` 和多个 `commands/*.gd`，**必须跑 `check:gdscript` 而不只是 `validate_scripts`**。

---

## 7. 风险评估

> [!warning] 修订（2026-08-05，依据 B-6）
> 删除原表"`recording_commands` 落盘文件不可逆"风险行（recording 不再接入 undo，无需评估此风险）。

| 风险 | 等级 | 缓解 |
|------|------|------|
| `handle_open_scene`/`handle_save_scene` 的 undo 语义不明 | 高 | **spec 决策**：场景级 open/save 不接入 undo（Ctrl+Z 不应跨场景切换），仅 in-scene mutation 接入。文档明确 |
| `EditorUndoRedoManager` varargs 在 4.5/4.7 行为差异 | 中 | CI 矩阵增加 4.5/4.6 跑 `test_undo_manager`；wrapper 兜底 try/catch |
| addon 老用户升级后 wrapper 行为变 | 低 | wrapper 公共 API 不变；本 spec 不新增 handler 接入，纯审查 + 文档 |
| `queue_free` 与 UndoRedo 生命周期冲突 | 中 | 已有规则（注释）：undo 路径不 queue_free，靠 reference 管生命周期。审查已接入 handler 时复核 |
| heren 的 Rust 宣传虚假（调研注明） | — | 不影响：heren 的 GDScript wrapper 是真实的，enhanced 已有等价实现，本 spec 不依赖 heren 任何 Rust 组件 |

---

## 8. 实施顺序建议

> [!warning] 修订（2026-08-05，依据 B-5/B-6）
> 删除原步骤 2（接入 sync_commands）和步骤 3（接入 recording state 切换）。工作范围大幅收缩。

1. **先实测 4.5/4.6 兼容性**（跑现有 `test_undo_manager.gd`）——决定 wrapper 是否需版本 shim
2. **审查已接入 handler 的 undo 正确性**（§3.2）：asset_placer、asset_commands、ui_commands、animation_commands 等
3. **审查 scene_commands.gd 的 open/save 边界**（决策：不接入）
4. **补充回归测试**（asset_placer / asset_commands undo 用例，原 spec 漏列）
5. **跑 `npm run check:gdscript`**（B-4 硬门禁，改任何 `addons/**/*.gd` 后必跑）
6. **文档**：在 `undo_manager.gd` 顶部注释明确"哪些 handler 接入、哪些不接入、为什么"（含 sync/recording/test/export 不接入的理由）

---

## 修订记录

| 日期 | 修订项 | 对应审查 Issue |
|------|--------|---------------|
| 2026-08-05 | §2.2 handler 接入度表格用 `grep -c` 实测重新统计（数字系统性降低 2-3 倍），补列 `asset/asset_commands.gd` 和 `asset/asset_placer.gd` | **N-4**（数字虚高） |
| 2026-08-05 | §3.1 删除 sync_commands.gd 接入项（纯观察者，无 mutation，无 undo 语义） | **B-5** |
| 2026-08-05 | §3.1 删除 recording_commands.gd 接入项（editor 路径被禁用，与 EditorUndoRedoManager 矛盾） | **B-6** |
| 2026-08-05 | §2.2/§3.1 修正 test_commands.gd "已接入"标注（实测 0 个 `create_action_mixed` 调用） | **N-5** |
| 2026-05-05 | §3.2 删除"事务边界"作为验收标准（维度 4，逻辑倒置，事务边界是设计选择） | §3.2 审查项修正 |
| 2026-08-05 | §4 改动清单删除 sync_commands/recording_commands/`begin_action`/`commit_action`/`test_sync_undo.gd` 接入项 | **B-5** + **B-6** |
| 2026-08-05 | §6 新增 `npm run check:gdscript` 硬门禁验收（AGENTS.md §6 强制项，validate_scripts 有盲区） | **B-4** |
| 2026-08-05 | §6 删除验收 2（AI sync 操作后 Ctrl+Z，基于 B-5 误判） | **B-5** |
| 2026-08-05 | §6 删除验收 5（headless 降级 sync handler，基于 B-5 误判） | **B-5** |
| 2026-08-05 | §7 删除"recording 落盘不可逆"风险行 | **B-6** |
| 2026-08-05 | §8 实施顺序删除 sync/recording 接入步骤，工作范围收缩 | **B-5** + **B-6** |
