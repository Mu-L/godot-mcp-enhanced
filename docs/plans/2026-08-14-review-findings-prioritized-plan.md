# 审查 Findings 分批修复计划（2026-08-14 六批次 36 条）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 P0→P1→P2→P3 优先级 + 子系统聚簇，把 `D:\workspace\Obsidian\GodotMCP\项目待办.md` 中 2026-08-14 产出的 36 条待办（34 条行动项 + 1 条独立观察 + 1 条非行动盲区记录）分 11 批（A–K）修完，全程分支开发、批次门禁、双波第三方审查，最终发版。

**Architecture:** 单 feature 分支多 commit。每批 = 一个子系统聚簇（同文件/同主题的待办合并），批内每条待办独立 commit 或同主题小组合并 commit。批 A–G 覆盖全部 P0/P1（第一波，审查一次）；批 H–K 覆盖 P2/P3 与发版（第二波，审查一次）。每条待办的技术规格（file:line / 根因 / 修复方案 / 核查命令）以 `项目待办.md` 对应条目为权威，本计划补充分批顺序、依赖、门禁与验收。

**Tech Stack:** TypeScript(ES2022/strict) + GDScript(Godot 4.5–4.7) + Vitest + ESLint + MCP SDK；验证命令 npm run lint / build / test / check:gdscript / check:budget / verify_delivery。

## Global Constraints（全批次强制）

- **分支**：master 不开 commit；统一分支 `fix/review-findings-batch-20260814`（基于 master `592dc60`）。
- **每批完成门禁**：`npm run lint` + `npm run build` + `npm test` 三绿才可 commit 批内最后一条。
- **改 `.gd`**（含 `src/scripts/*.gd` 与 `addons/**/*.gd`）：批门禁追加 `npm run check:gdscript`（需 GODOT_PATH），0 error 0 warning。
- **改工具描述**（如批 J blender.ts）：追加 `npm run build-matrix` + `npm run gen:tool-docs` + `npm run check:budget`。
- **改 `src/tools/rule-templates.ts`**：追加 `npm version patch --no-git-tag-version`（本计划各条均不预期触及，触及即触发）。
- **每条待办修完**：立即在 `项目待办.md` 勾选该条（mcp__obsidian__edit_file），勾选依据 = 该条自带核查命令实测通过。
- **每波完成**：登 memory（feature-decision-log + engineering-lesson）+ 出第三方审查文档 `docs/reviews/`（code-reviewer 子 agent）。
- **发版门禁**（批 K）：三绿 + `check:gdscript` + `check:budget` + `verify_delivery`(MCP 工具) 全过才 tag/publish。
- 待办条目行号会漂移：执行时以条目标题前缀 grep 重新定位，本计划行号是 2026-08-14 快照。

---

## 优先级总览

| 批 | 主题 | 覆盖待办（项目待办.md 行号） | 严重度构成 | 预估 |
|----|------|------------------------------|-----------|------|
| A | editor 重连链生命周期 | :932 :936 :937 | **P0×1** P1×2 | 中高 |
| B | 安全 RCE 面（沙箱旁路+deny-list+路径） | :42 :933 :43 :940 | P1×2 P2×2 | 中高 |
| C | audit 生产 bug + 测试守护 | :81 :82 :938 :86 | P1×2 P2×1 P3×1 | 中 |
| D | G1 playtest 控制层（mcp_bridge.gd 聚簇） | :62 :63 :64 :101 :66①② | P1×1 P2×3 P3×2 | 中 |
| E | 属性 coerce 三路对齐（no-op 假成功） | :99 :100 | P1×1 P2×1 | 中 |
| F | scene-commit 写守卫+假成功 | :934 :941 | P1×1 P2×1 | 低 |
| G | bridge/Server 生命周期与订阅 | :935 :65 :66④ :942② :942③ | P1×1 P2×2 P2小修×2 | 中 |
| — | **第一波审查节点**（批 A–G） | — | — | — |
| H | 测试覆盖补强（debug e2e + GD 套件） | :83 :84 :85 | P2×2 P3×1 | 中高 |
| I | GD server 杂项与可疑项 | :102 :103(=:942⑤) :939 :66③ :66⑤ :66⑥ :44 | P2×2 可疑×2 P3×4 | 低中 |
| J | 文档漂移快批（隐私披露） | :29 :30 :31 | P3×3 | 低 |
| K | 收尾小修 + M1 发版 | :942① :942④ :696 | P2小修×2 + 发版 | 中 |
| — | **第二波审查节点**（批 H–K）+ 发版 | — | — | — |

独立观察项（不入批）：:67 editor-e2e daily 首跑——08-15 00:00 UTC 后 `gh run list --workflow=editor-e2e.yml --limit=3` 查首跑结果，失败则调 xvfb 软渲染超时参数，结论登记回待办。非行动项：:338（Windows GUI 盲区记录，保持记录态）。

去重说明：`:103`（reload_scripts 取 `sessions[0]`）与 `:942⑤` 为同一问题（debug_commands.gd:532），只在批 I 修一次，两处 checkbox 同批勾选。

---

## 批 A：editor 重连链生命周期（P0 + 2×P1）

**目标**：修通"编辑器重启后重连链死"，同时清掉同在 EditorConnection/Manager 的并发竞态与遗留 timer。三条互相关联（都动 reconnect 状态机），必须同批：:936 的并发 rebuild 修复会影响 :932 的 rebuild 可达路径。

**Files:**
- Modify: `src/core/EditorConnection.ts`（:226 auth 失败置 reconnectEnabled=false、:489 scheduleReconnect 静默 return、:516-526 遗留 timer、:534/:566 清理点）
- Modify: `src/core/EditorConnectionManager.ts`（:268 handleStall、:126 rebuild 可达条件、:253/:284-285/:176 并发 catch 误清）
- Modify: `src/tools/manage-tools.ts`（:274-292 reconnect 走 stale secret 的死循环）
- Test: `test/editor-connection.test.js`、`test/core/editor-connection-manager.test.ts`（若无则新建）

**任务（每条 = TDD：先写失败测试再修）：**

- [ ] A-1 [:937] 遗留 reconnectTimer：connect open 成功段（与 reconnectAttempt=0 同处）clearTimeout。测试：mock backoff 挂起 → 手动 connect 成功 → advance timer → 断言无第二次 connect 且 ws 未被 terminate。
- [ ] A-2 [:936] 并发 rebuild 竞态：①catch/mismatch 仅在 `this.conn === 本次 conn` 才清理；②rebuild 加 `_rebuildPromise` in-flight 去重（对齐 game-bridge `_connectionLock` 模式）。测试：并发两次 rebuild，断言胜者 conn 存活、无 "(no connection)" 假 mismatch、败者 ws 被断。
- [ ] A-3 [:932 P0] 重连链死：auth 失败路径同样 fire reconnectExhaustedHandlers，让 handleStall 置 conn=null 使 rebuild()（重读 secret）可达；manage_tools(reconnect) 在 authFailed 且未连接时走 rebuild 而非 ec.connect()。测试：模拟旧 secret auth 失败 → reconnect → 断言 rebuild 被调且新 secret 生效、connected:true。核查：`grep -n "reconnectEnabled = false" src/core/EditorConnection.ts` 附近有 exhaustion fire。
- [ ] A-4 批门禁：lint + build + test 三绿 → commit（3 条可合 1-2 个 commit，建议 :932 单独 commit 因是 P0）。

## 批 B：安全 RCE 面（2×P1 + 2×P2）

**目标**：堵 write_script 沙箱 3 旁路入口 + deny-list 拼写固化错误，顺带同安全面的 load_skill 范围与 nonces symlink。

**Files:**
- Modify: `src/tools/script.ts`（沙箱扫描函数导出/上移 shared）
- Create/Modify: `src/tools/shared/`（scanScriptSandboxOrThrow 落位处，若上移）
- Modify: `src/tools/scene/index.ts:286`、`src/tools/batch-tools.ts:122`、`src/tools/code-templates.ts:836`（三旁路接线；顺带清 :762 死标签 templates readonly）
- Modify: `addons/godot_mcp_server/commands/engine_commands.gd:25` + `src/scripts/mcp_bridge.gd:104`（deny-list 两副本补 `call_thread_safe`/`propagate_call` + deny 命中后查 args[0] ∈ deny-list）
- Modify: `src/tools/load-skill-search.ts:80-85`（validateLibraryPath 追加 isPathInAllowedRoots）
- Modify: `src/core/instance-api-auth.ts:214-228`（抽 safeWriteNoSymlink() 两处共用，读侧同检）
- Test: 沙箱旁路负向测试 + deny-list 负向测试（从 `data/godot-classes.json` 生成真实方法名核对）+ load_skill 越界测试

**任务：**

- [ ] B-1 [:42 P1] 沙箱 3 旁路：scanScriptSandboxOrThrow 上移 shared 并导出 → quick_scene/create_files/apply_template 三处写 `.gd` 前统一调用（函数内部已限 .gd 后缀与双 opt-in，非 .gd 不动）。核查：`grep -n "scanScriptSandboxOrThrow" src/tools/scene/index.ts src/tools/batch-tools.ts src/tools/code-templates.ts`（修复前 0 → 修复后 ≥3）。测试：三入口传含危险 API 的 .gd 内容断言被拒（SbxScanError/等价 error_code），非 .gd 文件不受影响。
- [ ] B-2 [:933 P1] deny-list 拼写：两副本补 `call_thread_safe` + `propagate_call` + deny 命中后内层 args[0] 检查；`node -e` 对 `data/godot-classes.json` 核对两方法名存在性（防再次照抄拼写）；负向测试：`call_method(node,"call_thread_safe",["set_script",...])` 与 `propagate_call` 被拒。fixture 副本同步（test/fixtures/gdscript-check）。改 .gd → check:gdscript。
- [ ] B-3 [:43 P2] load_skill 范围：validateLibraryPath 追加 isPathInAllowedRoots 或限定 env 已配置目录及子路径，越界进 `missing_libraries` 不硬崩。测试：传 `libraries:["C:/Users"]`（假设不在白名单）断言进 missing 且无正文泄露。
- [ ] B-4 [:940 P2] nonces symlink：抽 safeWriteNoSymlink()（lstatSync 预检 + 拒写 symlink），_persistNonces 与 .api-secret 写入两处共用，_loadPersistedNonces 读侧同检。核查：`grep -c "lstatSync" src/core/instance-api-auth.ts` ≥2。测试：预置 symlink 路径断言写入被拒。
- [ ] B-5 批门禁：lint + build + test + check:gdscript 四绿 → commit（B-1 单独 commit，B-2 单独，B-3/B-4 可合）。

## 批 C：audit 生产 bug + 测试守护（2×P1 + P2 + P3）

**目标**：让 0.28.3 的 G3 audit 特性真正对客户端可见（当前死代码），并给审计链路补上 dispatcher 级测试。

**Files:**
- Modify: `src/core/tool-registry.ts`（TOOL_GROUPS 补 audit 或 ALWAYS_ALLOWED 追加）
- Modify: `src/tools/audit.ts`（导出 TOOL_NAMES）
- Modify: `scripts/check-tool-groups.mjs:49-58`（正则 → require build 产物枚举 getToolDefinitions()）
- Modify: `src/core/ToolDispatcher.ts:526-556`（audit middleware 接 resolveDynamicTool 反查，复用 :282 既有解析）+ `:764-790`（_auditConfirmedExecution 同接）
- Test: `test/core/tool-registry-groups.test.ts`（注册集不变量）、`test/core/ToolDispatcher.test.ts`（audit 4 场景）、`test/audit-tool.test.ts`（wrapper，若无则新建）

**任务：**

- [ ] C-1 [:81 P1] audit 游离 TOOL_GROUPS：①registry 补 audit + audit.ts 导出 TOOL_NAMES；②tool-registry-groups.test.ts 加不变量——`registerAllModules()` 后逐工具断言 `isToolAllowed(name)===true`（防第 5 次同类）；③check-tool-groups.mjs 改读 build 产物。核查：`node -e "require('./build/core/tool-registry.js').isToolAllowed('audit')"` 修复前 false → 后 true。
- [ ] C-2 [:82 P1] audit 零测试：dispatcher 集成测 4 场景——①write 类工具成功 → `.godot/mcp_audit.jsonl` 落盘含 {tool,action,risk}；②confirm_and_execute 确认后 → 走 _auditConfirmedExecution 落盘；③token 拒绝 → 无虚假 ok 条目；④appendFile 失败 → 工具结果不受影响。验证：临时注释 _auditConfirmedExecution 调用 → 场景②红（接线零验证判别法）。
- [ ] C-3 [:938 P2] 审计动态工具盲：audit middleware 与 _auditConfirmedExecution 两处接 resolveDynamicTool 反查。核查：`grep -n "resolveDynamicTool" src/core/ToolDispatcher.ts` audit 段命中。测试并入 C-2 场景：engine.call_method 写操作落盘。
- [ ] C-4 [:86 P3] audit.ts wrapper 直接测试：get_log limit/since 过滤、suggest_rollback entry_index 越界、project_path 解析失败路径，各 1-2 用例。
- [ ] C-5 批门禁：lint + build + test 三绿 → commit。

## 批 D：G1 playtest 控制层（mcp_bridge.gd 聚簇，P1 + 3×P2 + 2×P3）

**目标**：一次改完 `src/scripts/mcp_bridge.gd` 的 playtest/control 全部 6 条（含 :101 待办自述"建议同批处理"），一次 check:gdscript + bridge 实测收口。

**Files:**
- Modify: `src/scripts/mcp_bridge.gd`（:2084-2091 unfreeze、:1979/:2013/:1949-1955 snapshot/seed owner、:1800/:1952/:2013-2054 _playtest_active、:2075-2091/:2125/:1811 paused 保存、:2117-2119 wall_budget、:2056-2064 step 假成功）

**任务（顺序按依赖，owner 机制先行）：**

- [ ] D-1 [:62 P1] unfreeze 补 `_control_step_until_pending.clear()`（与 owner 断线路径 :1810-1812 对齐）。验证：freeze → step_until(长 max_frames + 不可满足条件) → unfreeze → 推进帧 → 断言 paused==false 且 _control_frozen==false。
- [ ] D-2 [:101 P2] paused 保存-还原：freeze 时记 `_control_paused_saved = get_tree().paused`，unfreeze(:2090)/step_until 完成还原(:2125)/owner 断线(:1811) 三处恢复原值而非硬 false，还原点清除。验证：游戏 `_ready` 里 paused=true → freeze → unfreeze → 断言 paused==true。
- [ ] D-3 [:63 P2] snapshot/seed owner 互斥：snapshot 时若 `_playtest_owner_pid==-1` 则登记 pid；断线清理条件加 `or not _playtest_snapshot.is_empty()`；seed/fixed_delta 加 owner 校验（对齐 freeze :2076-2078 模式）。验证：双 peer 抢占被拒 + snapshot-only peer 断开断言快照已清。
- [ ] D-4 [:64 P2] _playtest_active 复位移出 fixed_delta 分支（与 `_playtest_snapshot.clear()` 同级）+ restore 完成时复位。验证：seed→restore→recording.start→模拟输入→断言录到事件（修复前 0 条）。
- [ ] D-5 [:66① P3] step_until wall_budget 压到 50s（或等待期 keepalive），避免与 idle 断连 60s 同界。
- [ ] D-6 [:66② P3] playtest.step 入口加 `_control_frozen` 守卫，freeze 期间不再假成功。
- [ ] D-7 批门禁：check:gdscript 0/0 + lint + build + test + bridge 实测（run_project + game_write 断言 D-1/D-2/D-4 场景）→ commit（建议 D-1+D-2 一个 commit（control 层）、D-3+D-4 一个（playtest 状态）、D-5+D-6 一个（低危））。

## 批 E：属性 coerce 三路对齐（P1 + P2）

**目标**：消灭"属性 set 静默 no-op + 假成功"。:100 修复直接复用 :99 的 coerce 实现思路，同批处理。

**Files:**
- Modify: `src/scripts/godot_operations.gd:110-126`（数学类型分支补真转换）
- Modify: `src/scripts/mcp_bridge.gd:1017-1032`（coerce_value_for_property 副本 + set 前存在性校验）
- Test: `test/`（headless 属性落地回归，参照 scene-operations-mock 范式 + gdscript-unit 真跑）

**任务：**

- [ ] E-1 [:99 P1] headless 数学转换：数学分支对齐 editor `coerce_value_for_property`（command_helpers.gd:99-128），按 prop_type 构造 Vector2/2i/3/3i/4/4i/Color/Plane/Quaternion/Rect2，Array 与 Dict{x,y,z} 两种输入都支持。验证：headless edit_node `{"position":[10,20,30]}` → 重新 load 场景断言 Vector3(10,20,30)；Dict 输入同验。
- [ ] E-2 [:100 P2] bridge 裸 set：mcp_bridge.gd 加 coerce 副本（独立 script context DUPLICATE 同步模式，对齐 :2196-2198 safe_values 做法）+ `if not (prop in node): return error`。验证：bridge set_node_property `{"property":"position","value":[1,2,3]}` → get_node_properties 读回断言；拼错属性名返 error。
- [ ] E-3 批门禁：check:gdscript + lint + build + test → commit（E-1、E-2 各一个）。

## 批 F：scene-commit 写守卫 + 假成功（P1 + P2）

**Files:**
- Modify: `src/tools/scene/scene-commit-tool.ts:57-115`（补 ctx.checkEditorSceneSave）
- Modify: `src/tools/scene/scene-commit.ts:204`（saveBlock success 改 `err == OK`，handleCommitAction saved:false 时置 isError）

**任务：**

- [ ] F-1 [:934 P1] commit 补 checkEditorSceneSave（对齐 edit_node :378 模式）。核查：`grep -rn "checkEditorSceneSave" src/tools/scene/` 由 3 处 → 4 处。测试：editor 打开场景时 commit → 断言被守卫拦截。
- [ ] F-2 [:941 P2] 假成功：saveBlock `success: err == OK` + handleCommitAction `saved:false` 时 isError。测试：mock 写盘失败 → 断言 isError=true。
- [ ] F-3 批门禁：三绿 → commit（两条合一 commit）。

## 批 G：bridge/Server 生命周期与订阅（P1 + 2×P2 + 2 小修）

**目标**：GodotServer.close() 三条问题（:65 push handler、:66④ 逐项 try、:942③ 漏清两注入点）同源合并；game-bridge 侧订阅重发与 step_until 超时竞态同批。

**Files:**
- Modify: `src/GodotServer.ts`（:643-666 close 清单补 registerBridgePushHandler(null) + dynamicSchema.setFetcher(null) + :610-639 逐项 try 对齐 :576-585 模式 + :117/:267-268 resources/subscribe 相关暂不动——subscribe 空壳留批 K）
- Modify: `src/tools/game-bridge.ts`（订阅登记表 + _doConnect 后重发 watch/monitor start + 30s ping keepalive；:862-865 step_until timeout=clamp(wall_budget+5000)）

**任务：**

- [ ] G-1 [:935 P1] 订阅断线重发：TS 侧订阅登记表（watch_start/monitor_start/push 成功时登记，stop 时移除）+ 重连成功后自动重发 + 30s ping keepalive 保活。测试：mock 断连重连 → 断言 watch.start 重发且 watch_poll 恢复数据。
- [ ] G-2 [:65 + :942③ P2] close 清理：close() finally 段加 `registerBridgePushHandler(null)` + `dynamicSchema.setFetcher(null)`；close 全链逐项 try（editorMgr.close()/stateStore.flush 等），单点抛错不阻断 killProcess/PID 兜底。测试：server→close→断言 pushHandler/fetcher 均 null；mock flush 抛错→断言后续 killProcess 仍执行。
- [ ] G-3 [:942② P2小] step_until TS 超时竞态：timeout=clamp(wall_budget_ms+5000)，wall_budget 60000 时不再 TS 先到期销毁常驻 socket。测试：wall_budget 60s 断言 TS timeout ≥65s。
- [ ] G-4 批门禁：三绿 → commit（G-1 单独，G-2+G-3 合一）。

## ⏸ 第一波审查节点（批 A–G 完成后）

- [ ] W1 code-reviewer 子 agent 独立审查 → `docs/reviews/2026-08-15-review-findings-wave1.md`（P0×1 + P1×10 + P2×12 + P3×4，含 6 小修项）
- [ ] W2 memory 登记：feature-decision-log（批 A–G commits + 关键决策）+ engineering-lesson（如 :933 教训已登过，本轮补充"计划级聚簇"经验）
- [ ] W3 Obsidian 待办勾选核对：批 A–G 涉及 ~22 条 checkbox 全勾，含 :942⑤（随批 I 修但登记在此说明）

## 批 H：测试覆盖补强（2×P2 + P3）

**Files:**
- Create: `test/e2e-debug-tools.test.ts`（debug e2e，仿 e2e-resilience-editor 自 spawn 范式）
- Modify: `.github/workflows/editor-e2e.yml`（vitest 命令行加 e2e-debug-tools）
- Create: `addons/godot_mcp_server/testing/suites/test_batch_add_nodes.gd`（B5 回归套件）
- Modify: `test/e2e-full-tool-verification.test.ts:137`（beforeAll 加 .godot 清理，对齐 e2e-p1-p5 模式）

**任务：**

- [ ] H-1 [:83 P2] debug e2e：断点→stack_trace 非空→inspect_frame→evaluate 链 + 两并发 debug 请求第二个被拒断言（A2 互斥回归守护）。验证：`E2E_EDITOR=1 npx vitest run test/e2e-debug-tools.test.ts` 真跑绿；删 `_debug_in_flight` 守卫 → 互斥测试红。
- [ ] H-2 [:84 P2] McpTestSuite 补套件：优先 B5 回归（batch_add_nodes `added` == is_inside_tree 真实计数而非 validated.size）。验证：故意改回 `validated.size()` → 套件红。check:gdscript。
- [ ] H-3 [:85 P3] e2e-full 缓存清理：beforeAll rmSync .godot；本地连跑两次对比实证无假绿/假红漂移。
- [ ] H-4 批门禁：三绿 + check:gdscript → commit。

## 批 I：GD server 杂项与可疑项（2 P2 + 2 可疑 + 4 P3 项）

**Files:**
- Modify: `addons/godot_mcp_server/commands/node_commands.gd`（或 undo_manager.gd，按 :102 方案落点）
- Modify: `addons/godot_mcp_server/undo_manager.gd:48`
- Modify: `addons/godot_mcp_server/commands/debug_commands.gd:532`（+ :112/:124 breakpoint 穿越）
- Modify: `addons/godot_mcp_server/websocket_server.gd:277`（协程 reply 兜底）+ `:268-282`（STATE_CONNECTING 握手超时）
- Modify: `src/scripts/mcp_bridge.gd`（STATE_CONNECTING 同款）
- Modify: `src/core/instance-http-server.ts:200-204`
- Modify: `src/tools/project.ts:98-99`

**任务：**

- [ ] I-1 [:103 + :942⑤] reload_scripts 改 resolve_session()（对齐三件套多 session 拒绝）。验证：双 run 下调 reload_scripts 报 "Multiple debugger sessions"。
- [ ] I-2 [:939 P2] set/clear breakpoint 补 `contains("..")` 拒绝（对齐 reload_scripts :522-526）。核查：`grep -c 'contains("\.\.")' addons/godot_mcp_server/commands/debug_commands.gd` 由 1 → 3。fixture 副本同步。
- [ ] I-3 [:102 可疑] undo_manager _add_method 在 callv 前对 args 中 Object 参数做 is_instance_valid 过滤（freed 的 push_warning 跳过该 op）。验证：构造 parent 已 freed 的 batch + editor Ctrl+Z，console 无 "previously freed instance"。（可疑项：若构造不出复现场景，降级为防御性修复+记录验证局限。）
- [ ] I-4 [:66③ P3] websocket_server.gd:277 协程 script error 兜底 reply（或文档化限制）。
- [ ] I-5 [:66⑤ P3] STATE_CONNECTING 握手超时（两 server 同款：websocket_server.gd:268-282 + mcp_bridge.gd）。
- [ ] I-6 [:66⑥ P3] instance-http-server 转发孤儿：req close log + AbortController 评估（与 N-2 同源，评估结论写注释）。
- [ ] I-7 [:44 P3] list_projects max_depth 钳制 ≤10（`search_dir` 是否加 root 校验**待用户定夺**——搜索语义天然跨目录，默认只钳 depth，root 校验需配套显式 opt-in）。测试：传 max_depth=999 断言被钳制。
- [ ] I-8 批门禁：三绿 + check:gdscript → commit（I-1+I-2 合一，其余按主题合 2-3 个）。

## 批 J：文档漂移快批（3×P3）

**Files:**
- Modify: `docs/telemetry.md:28`（:181）
- Modify: `src/tools/blender.ts:38-39`（工具描述）
- 生成: `docs/tools/*.md`（gen:tool-docs）+ `docs/capability-matrix.*`（build-matrix）

**任务：**

- [ ] J-1 [:29] telemetry.md:28 改「失败时附加：固定枚举 `TOOL_ERROR`（不采集 `Error.name`，原白名单脱敏方案已随 T1 删除）」。核查：`grep -n "白名单脱敏" docs/telemetry.md` 改后仅 :143 或零命中。
- [ ] J-2 [:31] telemetry.md:181 改「截图数据：PNG 先降采样至最长边 1024px 再外传；JPEG 超 1MB 拒传并 fallback 本地 detail；<1MB JPEG 以原文外传」。核查：`grep -n "降采样\|1024" docs/telemetry.md` Vision 段 ≥1 命中。
- [ ] J-3 [:30] blender.ts 描述改「bpy 代码经沙箱扫描（已知危险 API 模式，清单不列举）+ 双 opt-in 旁路，对齐 execute_gdscript 哲学；glb 导出落点另有 resolveWithinRoot 约束」+ build-matrix + gen:tool-docs + check:budget。核查：`grep -n "不约束" src/tools/blender.ts` 修复后 0。
- [ ] J-4 批门禁：三绿 + check:budget → commit（三条合一 docs commit）。

## 批 K：收尾小修 + M1 发版

**Files:**
- Modify: `src/GodotServer.ts:117/:267-268`（resources/subscribe capabilities 声明 subscribe:true 或文档化空壳）、`:123`（logging setLevel handler 或去声明）
- Modify: `CHANGELOG.md`（全部批次登记进 [Unreleased] → 发版段落）
- Modify: `package.json`（version bump）

**任务：**

- [ ] K-1 [:942①] resources/subscribe：实现最小 handler 或 capabilities 去 subscribe 声明 + push 只发已订阅客户端（二选一，倾向最小实现：声明 subscribe:true + 记录已订阅 client）。
- [ ] K-2 [:942④] logging：补 setLevel handler 或从 capabilities 去掉 `logging: {}` 声明（择一，倾向补 handler，~10 行）。
- [ ] K-3 CHANGELOG 归档：按批 A–J 逐条登记（改什么/为什么），版本建议 0.28.4（patch：安全修复+bug fix 为主，无新 API；若用户希望突出安全批次可 0.29.0——发版前与用户确认）。`npm run version-check` 绿。
- [ ] K-4 发版门禁：lint + build + test + check:gdscript + check:budget + **verify_delivery**（MCP 工具）全绿 → tag v0.28.4。
- [ ] K-5 [:696 M1] npm publish（含 mcpName）→ MCP Registry 渠道 2 重试；awesome-mcp PR #9067 保持 OPEN 等审（`gh pr view` 记录状态）。push 分支 + 开 PR 合并 master（branch protection 三 job 全绿）。

## ⏸ 第二波审查节点（批 H–K 完成后）

- [ ] W4 code-reviewer 子 agent → `docs/reviews/2026-08-15-review-findings-wave2.md`
- [ ] W5 memory 登记（批 H–K）
- [ ] W6 Obsidian 全量核对：36 条 checkbox 状态与仓库实际一致（:338 保持未勾记录态、:67 观察结论登记）

---

## 覆盖核对（36/36）

| 待办 | 批 | 待办 | 批 | 待办 | 批 |
|------|----|------|----|------|----|
| :29 | J | :67 | 独立观察 | :932 | A |
| :30 | J | :81 | C | :933 | B |
| :31 | J | :82 | C | :934 | F |
| :42 | B | :83 | H | :935 | G |
| :43 | B | :84 | H | :936 | A |
| :44 | I | :85 | H | :937 | A |
| :62 | D | :86 | C | :938 | C |
| :63 | D | :99 | E | :939 | I |
| :64 | D | :100 | E | :940 | B |
| :65 | G | :101 | D | :941 | F |
| :66①② | D | :102 | I | :942① | K |
| :66③⑤ | I | :103 | I(=:942⑤) | :942② | G |
| :66④ | G | :338 | 非行动 | :942③ | G |
| :696 | K | — | — | :942④ | K |

## Self-Review 结论

- **覆盖**：36 条全映射（34 行动 + 1 观察 + 1 非行动），无遗漏；:103/:942⑤ 去重说明明确。
- **优先级**：P0 在批 A 首位；10 条 P1 全部落在批 A–G（第一波）；文档类 P3 全在批 J 不阻塞。
- **类型一致性**：批 D/E 的 mcp_bridge.gd 改动跨批（D 改 control 段、E 改属性 set 段、I 改 STATE_CONNECTING 段），段不相交，无冲突；批 G 与批 I 都涉及 GodotServer/websocket_server 但函数不同段。
- **风险点**：批 A 是连接状态机核心改动，若测试环境 mock 不足需先补 editor-connection-manager 测试基建；:44 的 search_dir root 校验留给用户定夺（I-7 默认只钳 depth）。
