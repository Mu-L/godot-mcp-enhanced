# 第三方审查：8e23c38 3 条低危 nit 闭环

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查对象：`8e23c38 fix: 闭环两天批次审查 3 条低危 nit（代码洁癖/对称性/权限收紧）`
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 总体判定

**SHIPPED WITH NITS** — 三条 nit 的核心改动全部 grep/read 实测通过，无 Blocking。仅 1 条测试覆盖缺口（nit#4 chmodSync 无单元测试守护）和若干无法实测项需诚实标注。N1/N2 由主 agent 在审查后顺手闭环。

---

## 逐维度结论（带 file:line 证据）

### nit#1 _record_prop 迁移 — SHIPPED
- **本地副本删除**：`addons/godot_mcp_server/commands/particle_commands.gd` 全文（231 行）无 `func _record_prop` 定义，仅留注释 `:18-19` 说明迁移。✅
- **21 个调用点全改**：`particle_commands.gd:95,102,105,108,112,116,139,142,145,148,151,155,187,188,189,190,192,196,198,200,202` 共 **21 处** `CommandHelpers._record_prop`，与声明一致；grep `_record_prop` 在该文件无任何不带 `CommandHelpers.` 前缀的调用残留。✅
- **签名一致**：`command_helpers.gd:220` `static func _record_prop(do_ops: Array, undo_ops: Array, target: Object, prop: String, new_val) -> void:` — 参数顺序/类型与历史本地版（command_helpers.gd:218 注释自证"对齐 particle_commands.gd:19"）完全一致。✅
- **依赖可达**：particle_commands.gd 大量调用 `CommandHelpers.get_edited_scene_root`（:37/:81/:124/:163/:210）、`CommandHelpers.find_node`（:47/:85/:128/:167/:214），证明 CommandHelpers 已被本文件 preload/全局可达。✅
- **跨文件复用已落地**：nav_commands.gd（10 处）、ui_commands.gd（17 处）同样调用 `CommandHelpers._record_prop`，证明共享层抽取得当，无重复定义。✅

### nit#3 close handler unregisterSpawn 对称 — SHIPPED
- **close handler 已补**：`src/gdscript-executor.ts:1273` `unregisterSpawn();  // B-T4 对称补全：exit/error/timeout/pipe 均已调，close 也补`。✅
- **闭包定义幂等**：`:1199` `const unregisterSpawn = () => { if (proc.pid) unregisterSpawnedGodotPid(proc.pid); };`，底层 `unregisterSpawnedGodotPid`（`src/core/process-state.ts:145-147`）= `_spawnedGodotPids.delete(pid)`，**Set.delete 天然幂等**，重复调用零副作用。✅
- **五路径对称**：exit(`:1200`)/error(`:1201`)/pipe-stdout(`:1225`)/pipe-stderr(`:1250`)/timeout(`:1261`)/close(`:1273`)，每条结束路径都至少调一次 unregisterSpawn。close 顶部 `:1270 if (settled) return;` 守卫不影响正确性——settled=true 时必由 timeout/pipe 路径已调过。✅
- **测试守护存在**：`test/gdscript-spawn-orphan.test.ts:43-47` 用正则 `\bunregisterSpawn\s*\(\s*\)` 统计调用数 `>=4`；加 close 后实际匹配 4 处（1225/1250/1261/1273），断言通过。✅
- **第二 error handler 无冲突**：`:1350` 另有 `proc.on('error', ...)` 业务 handler，Node.js 允许同事件多 handler，1201 的 unregisterSpawn 仍正常触发，设计正确。✅

### nit#4 chmodSync 0o600 权限收紧 — SHIPPED
- **import 已含 chmodSync**：`src/core/update-checker.ts:4` `import { ..., chmodSync } from 'fs';`。✅
- **顺序正确**：`writeCache`（`:54-65`）流程 `writeFileSync(tmp)`(`:59`) → `chmodSync(tmp, 0o600)`(`:62`) → `renameSync(tmp, cachePath)`(`:63`)。POSIX rename 保留源 inode 权限，故目标文件继承 0o600。✅
- **try/catch 双层覆盖**：chmodSync 在独立内层 try/catch（`:62`），整体又在 writeCache 外层 try/catch（`:55-64`）内。chmod 失败被内层 catch 吞掉，rename 仍执行——功能不破坏，仅权限未收紧（可接受的降级，cache 是版本/时间戳非凭证）。✅
- **Windows 兼容**：注释 `:62` 明确 `/* Windows/受限环境 chmod 无效，忽略 */`，与项目其他 chmod 用法（`editor-auth.ts:59`、`game-bridge.ts`）模式一致。✅

### 仓库级约束 — SHIPPED
- **fixture 同步**：`.gitignore:43-45` 排除 `test/fixtures/gdscript-check/addons/` 和 `test/fixtures/real-project/addons/`（运行时复制生成，不进 git）。当前工作树中两份 fixture 的 particle_commands.gd **均已同步**为新版（含 `:18` 迁移注释 + 全部 `CommandHelpers._record_prop` 调用），证明运行时复制机制已生效。无需 commit fixture。✅
- **AGENTS.md「独立副本同步约束」**：本 commit 不涉及 `.claude/rules/` 或 `src/tools/rule-templates.ts`，不适用。✅
- **AGENTS.md「分发产物边界」**：不改 `build/`、`capability-matrix`、`scoring`。`addons/` 是分发模板源，直接改源正确。✅

### TS-GD 一致性 + 验证完整性
- **改动量小**：每项 < 10 行，静态层面回归风险低。✅
- **诚实标注（未能实测）**：
  - AGENTS.md §6「改动 GDScript 后」`validate_scripts`：**无 Bash/MCP 工具，未能实测 Godot 完整编译**。
  - AGENTS.md「完成前强制检查」lint/build/test 三件套：**未能实测**。
  - commit message 声明"npm test 295 文件 4325 passed"：**未能实测**，但相关测试文件（gdscript-spawn-orphan.test.ts、update-checker.test.ts）断言与改动一致，间接可信。

---

## Blocking Issues

无。

---

## Nits

**N1（confidence 80）— nit#4 chmodSync 缺单元测试守护**
- 位置：`src/core/update-checker.ts:62`
- 问题：`test/core/update-checker.test.ts` 只测 readCache 字节上限，`test/update-checker.test.ts` 无任何 chmod/mockChmod 匹配。writeCache 的 chmodSync 顺序/存在性**无直接断言守护**。若未来误删 `:62` 或把 chmodSync 挪到 renameSync 之后，测试不会 RED。
- 对比：同样模式在 `test/cli/clients/json-config.test.ts:73-84` 和 `test/cli/clients/claude-code.test.ts:110-117` 都有"before/after mode === 0o600"的硬断言；`test/regression/defects.ts:1316` 的 `adapter-no-mode-preserve` 也守护 adapter 路径。update-checker 是唯一缺守护的 chmod 落地点。
- **已由主 agent 在审查后补测闭环**（见文末更新）。

**N2（confidence 50，仅记录）— gdscript-spawn-orphan.test.ts 注释与断言不一致**
- 位置：`test/gdscript-spawn-orphan.test.ts:45-47`
- 问题：注释说"闭包实现：... = 6"，但断言是 `toBeGreaterThanOrEqual(4)`。加 close handler 后实际匹配 4（1225/1250/1261/1273），刚好踩线通过。注释数字陈旧（未含 close 分支），易误导未来维护者。
- **已由主 agent 在审查后更新注释**（见文末更新）。

---

## 值得进 memory 的工程教训

1. **`Set.delete` 幂等性是对称补全的安全网**：nit#3 能放心在 close handler 补 unregisterSpawn，底层是 `process-state.ts:146` 的 `_spawnedGodotPids.delete(pid)` 天然幂等。设计多路径清理时，优先选幂等原语（Set.delete/Map.delete）而非计数式状态机，可大幅降低对称性论证成本。

2. **"运行时复制" fixture 的 gitignore 边界**：`test/fixtures/{gdscript-check,real-project}/addons/` 被 gitignore 排除但仍存在工作树——审查 fixture 同步时不能只看 git diff，必须直接 read fixture 内容（gitignore 排除 ≠ 不存在）。本次两份 fixture 均已是新版，证明复制机制生效，但若复制脚本失效，CI diff 不会暴露（盲区）。

3. **chmodSync 三种模式的语义边界**（本仓库出现 3 种，易混淆）：
   - `writeFileAtomicWithMode`（adapter 配置）：stat 原文件 mode → 保持（用户已 chmod 0o600 时防覆盖丢失）
   - `writeFileSync + chmodSync(tmp,0o600) + renameSync`（update-checker cache）：无条件收紧（新建文件，强制 0o600）
   - `chmodSync(path, 0o600)` 直接调（editor-auth/game-bridge）：现有文件补权限
   选错模式是潜在 bug 源，值得在 rule 里固化决策树。

---

## 相关文件（绝对路径）

- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\particle_commands.gd`
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\command_helpers.gd`
- `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts`
- `D:\GitHub\godot-mcp-enhanced\src\core\process-state.ts`
- `D:\GitHub\godot-mcp-enhanced\src\core\update-checker.ts`
- `D:\GitHub\godot-mcp-enhanced\test\gdscript-spawn-orphan.test.ts`
- `D:\GitHub\godot-mcp-enhanced\test\core\update-checker.test.ts`
- `D:\GitHub\godot-mcp-enhanced\.gitignore`
- `D:\GitHub\godot-mcp-enhanced\AGENTS.md`

## 诚实声明

审查者无 Bash/MCP 工具，所有"声称"的运行结果（validate_scripts / npm test / lint / build）均**未能实测**，仅做了静态 grep/read 推断与既有测试断言的交叉核对。落盘由主 agent 代为执行。

---

## 主 agent 门禁复跑确认（2026-07-31）

主 agent（有 Bash）已实测复跑，补充审查者未能实测维度：

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| validate_scripts | ✅ particle_commands.gd 零错误（1 既有 add_child warning 非本次引入） | MCP `validate_scripts` 工具 |
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误） | `npm run build` |
| Vitest | ✅ **295 文件 / 4325 用例 passed**（无回归） | `npm test` |

审查者所有静态推断与主 agent 实测结果一致，无出入。
