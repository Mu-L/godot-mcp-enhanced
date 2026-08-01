# 全天改动第三方审查（2026-08-01）

> **审查范围**：2026-08-01 全部 11 个提交（195eabc..17a1b89）+ 审查中发现的 BLOCKING 修复（方案 A→升级为方案 B 根治）+ 3 NIT 全部处理 + 运行时实测闭环
> **审查者**：独立 ZCode agent（派 2 个 code-reviewer 子 agent 分维度审 + 主 agent 复核 BLOCKING 证据链 + 主 agent 实施修复 + 运行时验证）
> **方法**：lint/build/test/check:gdscript/build-matrix/check:tool-count 全跑 + 源码逐环 Read 复核 + Godot CLI 运行时对照实验
> **总体判定**：**SHIPPED**（BLOCKING 已根治 + 运行时验证闭环 + 3 NIT 全处理）

---

## 执行的验证命令与结果

| 检查 | 命令 | 结果 |
|------|------|------|
| ESLint | `npm run lint` | 0 错误 |
| TS 编译 | `npm run build` | 0 错误 |
| 全量测试 | `npm test` | 4381 passed / 26 skipped（+4 新测试）|
| GDScript 完整编译 | `npm run check:gdscript` | errors=0 warnings=0 |
| capability-matrix 重建 | `npm run build-matrix` | 重建后 `git diff` 为空（零漂移） |
| 工具数门禁 | `npm run check:tool-count` | 36/205，20/20 通过 |
| **BLOCKING 运行时验证（修复版）** | Godot CLI 脚本 | ✅ arena 跨测试存活，EXIT_CODE=0 |
| **BLOCKING 运行时验证（对照组）** | Godot CLI 脚本（无 meta） | ✅ arena 被误 free，EXIT_CODE=1（根因真实） |

---

## 🔴 BLOCKING（已根治 + 运行时验证闭环）

### `_McpTest` 前缀碰撞致 arena 在测试间被 free

**发现者**：独立 code-reviewer 子 agent（GDScript 维度审查），主 agent 逐环复核证据链

**证据链**（主 agent 独立 Read 源码 5 处确认）：

1. `addons/godot_mcp_server/testing/suites/test_undo_manager.gd:47`（修复前）— suite_setup 创建 arena，`name = "_McpTestUndoArena"`，**未 track(_arena)**
2. `addons/godot_mcp_server/testing/mcp_test_runner.gd:360` — `_free_mcp_test_nodes_recursive` 用 `str(child.name).begins_with("_McpTest")` 匹配，**只看名字不看 meta**
3. `mcp_test_runner.gd:152-153` — 清理函数在每个测试后调用（非套件级）
4. `mcp_test_runner.gd:135` + `test_commands.gd:151` — 二期加的 `await get_tree().process_frame` 让帧结束 → `queue_free` 落地 → arena 被真正 free
5. `test_undo_manager.gd:104,110,133,140` — 第 2 个测试起访问 `_arena` → SCRIPT ERROR

**为何一期没暴露、二期暴露**：一期同步路径下帧不结束，arena 整段 valid。二期改 async 才让 queue_free 落地。

**为何前序两份 review 漏抓**：
- 一期 review 只查 suite_setup 的 null scene 守卫，没追 arena 在测试间存活
- 二期 review 维度 4「兼容性」断言"test_undo_manager 5 测试仍同步无 await"——前提不成立（test_run 默认全链 await）

**修复演进**：方案 A（改 arena 命名）→ 升级为方案 B（清理函数加 `_mcp_test_persistent` meta opt-out + arena 设 meta），从治标改为根治。

**方案 B 实现**：
- `mcp_test_runner.gd:_free_mcp_test_nodes_recursive` 增加 `and not child.has_meta("_mcp_test_persistent")` 条件
- `test_undo_manager.gd` arena 改回 `_McpTestUndoArena`（统一前缀约定）+ 设 `_mcp_test_persistent` meta
- 语义区分：`_mcp_test_owned` = runner 可管理（测试节点+fixture 都设）；`_mcp_test_persistent` = 跨测试保留（仅 suite fixture 设）

**运行时验证（Godot CLI 对照实验）**：

由于 MCP server 以 headless 模式启动（GODOT_MCP_MODE 为空），无法用 `test_run` 工具直测。改用 Godot CLI 跑独立验证脚本（`--script` 模式 + await process_frame 模拟二期 async 时序）：

| 场景 | 脚本逻辑 | 预期 | 实际 | 退出码 |
|------|---------|------|------|--------|
| 修复版 | arena 设 persistent meta + 清理（meta opt-out）+ await process_frame | arena 存活 | `valid=true, in_tree=true, child_count=1` | 0 ✅ |
| 对照组 | arena **无** persistent meta + 旧清理（纯前缀）+ await process_frame | arena 被 free | `valid=false`（帧末 queue_free 落地）| 1 ✅ |

对照组证实：BLOCKING 根因真实（修复前必现，静态推断正确）；修复版证实：方案 B persistent meta 生效。**根因 + 修复双闭环**。

> 诚实边界：验证脚本模拟了 test_run 的关键时序（清理 + await process_frame），但未跑完整 5 测试套件（需 editor 模式 + EditorInterface + EditorUndoRedoManager）。完整套件实测仍建议在真 editor 会话补做，但根因已用对照实验确证。

---

## ✅ 逐维度结论

### 维度 1：TS 代码正确性（PASS + 3 NIT）

- **`src/core/bpy-sandbox.ts`**：detectBpyStringConcatBypass 滑动窗口逻辑正确，与 gdscript-executor:181 对齐。安全限制注释诚实标注非对抗边界。
  - NIT-2：缺 `%` 格式化检测 + `os.exec*` 系列拼接漏报（非 bug，沙箱已声明边界）
- **`src/core/EditorToolExecutor.ts`**：test_run 的 startOperation/endOperation 包裹正确，290s 魔数 < GD clamp 600，注释行号 cross-reference 全部精确命中（heartbeat.gd:69、websocket_server.gd:325）。
  - NIT-3：nav_bake 与 test_run 分支可抽 `runWithOpTimeout` 辅助方法
- **`src/tools/testing.ts`**：editor 分流路径属实（ToolDispatcher.ts:408-431 editor 模式先走 EditorToolExecutor），satisfies 类型约束正确。
  - NIT-1：`import/export { textResult }` 死代码，注释"silences unused-import lint"失实（tsconfig 未启用 noUnusedLocals）
- **`src/capability/static-grep.ts`**：findEditorCommandForTool 三查询逻辑正确，前缀查同前缀多 method 都映射同一文件（确定性 OK），alias 表无遗漏。

### 维度 2：GDScript 代码（修复 BLOCKING 后 PASS）

- `mcp_test_runner.gd`：latch-on-first-failure / 零断言护栏 / SCRIPT ERROR 优先级 / logger 生命周期全正确
- `mcp_test_suite.gd`：track/skip/fail_setup/editor_undo/expect_script_error 全套生命周期齐备
- `script_error_capture.gd`：byte-identical 移植，Mutex 配对正确
- `test_undo_manager.gd`：5 测试断言强度经 N-4 修复后为非假绿（**修复 BLOCKING 后**）
- `test_commands.gd`：N-5 `_last_combined_results` 缓存正确，async 路由 + ctx 线程链完整
- `command_handler.gd` + `websocket_server.gd`：test_run 分流对称，peer 守卫防 orphan reply

### 维度 3：仓库约束合规（全 PASS）

| 项 | 结论 | 证据 |
|----|------|------|
| B-1 独立副本同步 | PASS | `.claude/rules/godot-mcp-core.md:10` 与 `rule-templates.ts:24` 均 36/205；version 0.25.2 三处一致 |
| B-2 capability-matrix | PASS | build-matrix 重建后 git diff 空；editor.exists 修复落地（8 工具均 true）|
| B-3 工具数同步 | PASS | check:tool-count 20/20；36/205 全文档一致 |
| B-4 文档漂移 | PASS | CHANGELOG 如实记录；README 工具数一致；Warp 残留 35 已修 |

### 维度 4：前序 review 文档复核（部分判定不成立）

- `docs/reviews/2026-08-01-p2-12-mcp-test-suite.md`：维度 1-4 认同；维度 5 memory 教训（editor.exists 失真）**已过时**（17a1b89 已修），不应进 memory 或须标注"已修复"；漏抓 BLOCKING（:117 标"待本地实测"从未完成）
- `docs/reviews/2026-08-01-p2-12-phase2-hard-gate.md`：维度 1/2/3/5/6/7 认同；维度 4「兼容性」断言"同步无 await"**前提不成立**，这正是漏抓 BLOCKING 的直接原因；维度 7 yield_count=11 算错（实际 6）

---

## NIT 汇总（全部已处理）

| 编号 | 文件:行 | 问题 | 处理 |
|------|---------|------|------|
| NIT-1 | `src/tools/testing.ts` | textResult 死代码 + 误导注释 | ✅ 已删除 import + export |
| NIT-2 | `src/core/bpy-sandbox.ts` | 缺 `%` 格式化检测 | ✅ 已补 `detectBpyFormatStringBypass`（对齐 C-01-fix）+ 3 新测试 |
| NIT-3 | `src/core/EditorToolExecutor.ts` | nav_bake/test_run 重复结构 | ✅ 已抽 `_runWithOpTimeout` 辅助方法（含 return-await 修复）|

### NIT-3 实施中发现的隐藏 bug（已修）

重构 `_runWithOpTimeout` 时初版用 `return this._runWithOpTimeout(...)`（未 await），导致 request 的 reject 绕过 `_executeInner` 的 try/catch，`finally: endOperation called even when request throws` 测试失败。修复为 `return await this._runWithOpTimeout(...)`，并加回归测试 `NIT-3: test_run request throw is caught by outer try/catch`。这是 async 函数 + try/catch 的经典陷阱（return promise vs return await promise）。

---

## 值得进 memory 的工程教训

1. **async 改造须重验"同步路径下隐式存活的套件级状态"**：把同步路径改 async（加 await process_frame）会让原本"帧不结束故节点整段 valid"的隐式假设失效。复现：`mcp_test_runner.gd:152-153`（每 test 清理）+ `:360`（名字前缀匹配）+ `test_undo_manager.gd:47`（arena 命名碰前缀）。

2. **review 的"兼容性"断言须实测执行路径，不能凭类型推断**：二期 review 漏抓 BLOCKING 的直接原因——只看测试方法体（test_* 函数内无 await）就判"同步执行"，未追调度入口（websocket_server.gd:360-366 默认 await）。

3. **review 文档的 memory 教训会过时，须带状态标记**：一期 review 把 editor.exists 失真写进 memory 教训，但 17a1b89 已修。memory 教训须带"已修复/未修复"标记，否则误导下个 agent。

4. **"待本地实测"待办必须闭环**：前序 review 把 test_run 标"⏳ 待本地实测"从未完成，BLOCKING 正藏在这个未闭环的待办里。
