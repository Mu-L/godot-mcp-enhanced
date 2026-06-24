# MCP 工具改进 Backlog(rpg-mcp-pilot Phase 1/2 实操暴露)

**日期**:2026-06-23
**来源**:用 MCP godot 工具(15+)从零搭建 `D:/GitHub/rpg-mcp-pilot`(Godot 4.6 RPG,Phase 1 骨架 + Phase 2 战斗,15 commit)+ bridge 自动验战斗交互尝试
**结论**:MCP 在「文件类静态操作 + autoload 注册 + F5 编译验证」链路可靠;「运行时 bridge 交互验证」链路问题密集

---

## 🔴 严重(阻断或严重误导)

| # | 工具 | 问题 | 影响 | 建议 |
|---|------|------|------|------|
| S1 | `edit_node` | 资源属性(script/texture)**返回 success 但不落盘** .tscn(bool 属性落盘) | 静默失败严重误导;Phase1 player 无 script/Sprite 无 texture,靠 Read .tscn 才发现 | 资源属性要么落盘要么报错;至少文档警告"资源属性用 Write .tscn" |
| S2 | `add_node` | 生成的 .tscn root 子节点 `parent="父名"`(错,应 `parent="."`) | F5 "Parent ./X vanished",子节点丢失 | 修 bug:root 子节点 parent="." |
| S3 | `run_and_verify` | headless 对 autoload/class_name 报假阳性 "not declared"(已知 pitfall) | headless 判据不可靠,干净项目被误诊为 #89399 | 已有 error-analyzer 过滤;文档强化"headless 仅 smoke,F5 判据" |
| S4 | `game` bridge secret | 每次 `_generate_secret` 新生 + `_restrict` 收紧 → 下次写失败 abort;`_exit_tree` 删 secret;MCP 5 分钟 TTL 缓存 → rm 重生后 auth fail | bridge 反复不可用,需改 mcp_bridge.gd 固定 secret 才部分缓解 | 加"固定 secret"选项(或文档治本方案);现状重生+收紧+TTL 是死循环 |
| S5 | `game_write call_method` | 白名单严:`emit_signal` 拒、`_on_xxx`(下划线回调)拒 | 无法绕过遇敌/切场景,自动验链路断 | 白名单文档化(允许/拒绝哪些);或加 escape hatch(信任环境) |
| S6 | `game_input send_key` | 发 keycode,project input 映射 physical_keycode → ui_action 不触发 | 键盘模拟(移动/战斗)失败 | send_key 支持 physical_keycode;或加 send_physical_key |

## 🟡 中(有回退但增负)

| # | 工具 | 问题 | 回退 | 建议 |
|---|------|------|------|------|
| M1 | `write_config` | key 白名单(`application/run/main_scene` 拒) | 手编 project.godot | 扩白名单或文档列允许 key |
| M2 | `write_config` | autoload value 带 `*` 被拒(自动注入,反直觉) | 去 `*` | 文档明示"不带 *,自动注入" |
| M3 | `execute_gdscript` | 默认引擎 4.7(非 settings GODOT_PATH 4.6.2)+ 片段模式 @implicit_new 运行 Nil(compile 过运行错) | 数值验失败 | 默认用 GODOT_PATH;片段模式执行顺序文档 |
| M4 | `run_project` | timeout 语义不明(GUI 跑 32s 但 timeout=15;后 "No project running")+ GUI/MCP 连接时机错位 | bridge 验反复失联 | timeout 语义明确(timeout 是否 kill?GUI 持续多久?)+ GUI 生命周期文档 |
| M5 | `project` | `ALLOWED_PROJECT_PATHS` env 不热重载(改 settings 不生效) | 改路径 D:/GitHub | 文档警告"白名单启动时固化";或支持热重载 |
| M6 | 全局 | 新 class_name 需 `godot --import` 重建 cache(MCP 不自动触发) | 手动 --import | write_script/create 新 class_name 后自动 --import 或提示 |

## 🟢 轻(繁琐)

- **confirm 门高频** + 长 random token 手抄易错(实测 INVALID_TOKEN 一次)→ 减少确认或 token 简化
- `manage_tools` reconnect/sync **NOT_IMPLEMENTED**(无法强制重连/重读 secret)
- `click_button` button_path 空 + "Cannot get path" error(emit 仍工作,非致命)
- `create_scene`/`execute_gdscript` 默认 4.7(非 GODOT_PATH 4.6.2),跨版本混淆 → 默认用 settings GODOT_PATH

---

## 🔬 源码核查裁决(2026-06-23)

对实操结论逐条做源码核查(调试归因铁律)。**2 条误判撤销,9 条确认(多数根因更精确),2 条降级。**

### ❌ 撤销(实操误判,非工具缺陷)

| # | 原结论 | 核查 | 证据 |
|---|--------|------|------|
| **S2** | add_node 生成 `parent="父名"`(错,应 `.`) | 撤销 | `scene\tools\scene\index.ts:152-161`(`root`/`/root`/`''` → `tscnParent='.'`)+ `src\tscn-editor-add.ts:330`(`parent='.'` → `parent="."`)正确处理 root 子节点。实操是手写 .tscn 写错,非工具 bug |
| **M1** | write_config `main_scene` 被拒 | 撤销 | `src\tools\project-config.ts:25` 白名单**含 `run/main_scene`**。实操传错 key(`application/run/main_scene`),正确是 `run/main_scene`(section=[application], prop=run/main_scene) |

### ✅ 确认(根因精确化,带 file:line)

| # | 精确根因 | 证据 |
|---|---------|------|
| **S1** | BLOCKED_PROPS 安全设计(防脚本注入)拦 `script`,静默 `continue` + 返回 success 无提示 | `src\tools\scene\helpers.ts` BLOCKED_PROPS 含 `script`;`src\tools\scene\index.ts:313`(edit_node continue)/ `src\tscn-editor-add.ts:341`(add_node continue) |
| **S3** | error-analyzer 只过滤 autoload 名,**不过滤 class_name 全局类**;`Identifier "X" not found` 命中 script_error 规则被判真实错误 | `src\error-analyzer.ts:75-87`(autoload 过滤,需调用方传 autoloadNames)/ `:89-96`(class_name 命中 script_error) |
| **S4** | 三段叠加死循环:_ready 重生 + 写后收紧权限 + _exit_tree 删除 | `src\scripts\mcp_bridge.gd:183`(重生)/ `:284`(收紧)/ `:387-388`(删除) |
| **S5** | ALLOWED_METHODS 全是只读查询方法,刻意禁状态修改(安全设计);emit_signal/_on_*/业务方法全拒 | `src\scripts\mcp_bridge.gd:55-61`(只读白名单)/ `:653`(非白名单拒) |
| **S6** | InputEventKey 只设 `event.keycode`,不设 `physical_keycode`/`key_label`/`echo` → 物理 input map 不触发 | `src\scripts\mcp_bridge.gd:742-744` |
| **M2** | autoload value 须 `res://` 开头(不带 `*`),写入时自动注入 `*`(反直觉但合理) | `src\tools\project-config.ts:90-96,162` |
| **M3** | findGodot 优先级正确(GODOT_PATH env 第 2),但 `_pathCache` 固化首次结果 → 改 env 需重启 MCP。实操"默认 4.7"= GODOT_PATH env 未注入 + PATH godot=4.7 被缓存 | `src\core\godot-finder.ts:269-279`(GODOT_PATH)/ `:256-258,272`(缓存固化) |
| **M5** | Node 进程 env 启动时固化,`getAllowedProjectPaths` 每次读 env 但 env 不变 → 改 settings 需重启 MCP | `src\core\path-utils.ts:198-201` |
| **M6** | 无任何工具调 `runImport`;import-check 孤立;write_script/create 新 class_name 不重建 `.godot/global_script_class_cache` | `src\tools\import-check.ts:96-108`(runImport 孤立)/ grep runImport 调用点=0 |

### 🟡 降级(部分真实)

| # | 原结论 | 核查 |
|---|--------|------|
| **M4** | "timeout 语义不明" | 语义本清晰(`src\tools\runtime.ts:160-170` timeout=setTimeout 到期 `killProcess`,即自动停止秒数)。真问题:killProcess 异步 + GUI/bridge 握手时机错位 |
| **click_button** | "button_path 空" | TS 侧正确(`src\tools\game-bridge.ts:673-682` text/path 二选一,缺则 INVALID_PARAMS)。"Cannot get path" 在 bridge 侧,次要 |

### 统计与教训

- 确认:9(S1/S3/S4/S5/S6/M2/M3/M5/M6)+ 轻问题 manage_tools `NOT_IMPLEMENTED`(`manage-tools.ts:134,138`)确认
- 撤销:2(**S2 add_node parent、M1 write_config main_scene** = 我手写 .tscn / key 拼写错误,非工具缺陷)
- 降级:2(M4 timeout 语义本清晰、click_button TS 侧 OK)
- **教训**:实操暴露的"bug"必须源码复核——13 条里 2 条是我的手写错误被误归因为工具 bug(再次印证"估算vs实测"铁律)。真实 bug 里多条根因比实操时更精确(S3 class_name 未过滤 / S5 白名单=只读设计 / M3 缓存固化)。

---

## 累积影响

- **战斗交互自动验不可行**:bridge 限制叠加重生(S4 secret + S5 白名单 + S6 send_key + M4 GUI 时机),即使改固定 secret 仍卡运行时连接 → 最终接受"代码就位、运行时未自动验"
- **大量回退成本**:Write .tscn 替 edit_node/add_node、手编 project.godot、--import、icacls+rm secret、改路径——MCP 工具"声明能力"与"实际可靠落盘/执行"有系统性 gap
- **可靠链路**:文件类(list_files/read_scene/write_script/create_scene 持久化部分)+ autoload 注册(write_config no-*)+ F5 编译验证(run_project errors)+ bridge 静态查询(game_query ping/get_node_properties)

## 改进优先级建议

1. **S1 edit_node 资源属性落盘/报错** — 最高(静默失败最误导)
2. **S2 add_node parent="."** — 高(直接 bug)
3. **S4 bridge secret 固定选项** — 高(bridge 可用性)
4. **S5/S6 call_method 白名单文档 + send_key physical** — 中(交互验能力)
5. **M3/M4 execute_gdscript 默认引擎 + run_project timeout 语义** — 中(可预测性)
6. **M6 class_name --import 自动** — 中(避免 not declared 误诊)
7. 轻(confirm/manage_tools/click_button)— 低(摩擦)

---

## 关联
- 实操项目:`D:/GitHub/rpg-mcp-pilot`(Phase 1 骨架 + Phase 2 战斗,15 commit)
- memory:`mcp-godot-scene-script-pitfalls`(7 条陷阱)/ `class-name-cache-import-rebuild` / `rpg-mcp-pilot-phase-status`(含 bridge 固定 secret hack)
- 已知 pitfall memory(workspace-review):`autoload-classname-headless-pitfall`(headless 假性,本 backlog S3 印证)

## ✅ 修复进展(2026-06-23,分支 `fix/mcp-tools-s1-s3-s4`)

最高优先级三条已修(TDD:RED→GREEN,逐条 commit):

| # | commit | 改动 | 验证 |
|---|--------|------|------|
| **S1** | `0635e63` | `AddNodeResult` 加 `blockedProps`;addNode/addNodes 收集被拦属性;add_node 写回后、edit_node executeGdscript 后**前置明确警告** + script 建议(不再静默 drop) | tscn-editor-add 48✓ + scene 集成 57✓ |
| **S3** | `3e94bff` | error-analyzer `AnalyzeOptions` 加 `classNames`;autoload 过滤 pattern 扩展匹配 class_name(同归 headless_limitation);run_and_verify 读 `.godot/global_script_class_cache.cfg` 提取 class names 传入 | error-analyzer 32✓ + validation 54✓ |
| **S4** | `16b59a6` | mcp_bridge.gd env `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`:secret 文件存在则复用(不重生/收紧)+ `_exit_tree` 不删除,打破死循环;bridge rule 加治本文档 | godot parse 无错(validate_scripts "no Parse Error") |

全套 **2718 passed**。7 E2E fails(execute_gdscript/edit_node/create_3d_node/dev_loop)为真实 Godot spawn 环境 timeout,与本次改动无关(edit_node E2E 改 `visible` 非 blocked,S1 不影响)。

**S5+S6**(`56499e0`)已修:`_cmd_call_method` env `GODOT_MCP_BRIDGE_EXTRA_METHODS` 扩展白名单(opt-in,默认只读安全)+ `_cmd_send_key` 补 `physical_keycode`(触发 physical 映射 input action)。验证:game-bridge 16✓ + godot parse 无错。

**M6**(`ce9c9ad`)已修:write_script 创建含 class_name 的 .gd 后自动触发 `--import` 重建 `.godot/global_script_class_cache`(根因:`ASSET_SCAN_DIRS=['assets','scenes','scripts']` 不扫 autoload/combat/data 等自定义目录,needsImport 漏检 → execute_gdscript 不 warm → 新 class_name not declared)。与 S3 配合闭环。验证:4 新测试 + script/executor 63✓。

**M2/M3/M5**(`199a9ab`)已修:M2 autoload value 误带 `*` 错误提示明示去掉(写入自动注入)+ M3/M5 core rule 陷阱段文档化(findGodot `_pathCache` 固化 / ALLOWED_PROJECT_PATHS env 启动固化,改 settings 需重启 MCP)。验证:project-config 29✓ + tsc 无错。

**✅ backlog 全部处理完毕**:S1/S3/S4/S5/S6/M2/M3/M5/M6 已修(8 fix commit);S2/M1 撤销(核查证伪的误判)。剩余仅"手动 F5 集成验证"(S4/S5/S6 运行时交互)—— 自动验证受 bridge 链路自身限制,留给用户 F5 实测。

---

## ✅ 次要项收尾(2026-06-24,分支 `fix/mcp-tools-s1-s3-s4`)

| # | commit | 改动 | 验证 |
|---|--------|------|------|
| **M4** | `a534d7f` (Task 1) + `3dfe7d3` (Task 2) | `run_project` 加 `wait_for_bridge`(默认 false) + `bridge_timeout`(默认 10s);`game-bridge.isBridgeReady` 独立短连接零接触探测 Bridge 就绪 + 进程早退短路优化 | game-bridge-isready 5✓ + runtime wait_for_bridge 3✓ |
| **manage_tools** | `9673a1a` (Task 3) + `a05362f` (Task 4) | `setConnectionStatusProvider`/`setReconnectEditor` 注入 + `buildConnectionStatus`/`buildReconnectEditor` 工厂;`reconnect` 触发 EditorConnection.connect(bridge 无持久连接→no-op);`sync` 返回各组 `requires` 连接状态 | manage-tools 13✓ (9 from Task 3 + 4 factory tests from Task 4) |
| 默认引擎 | — | 剔除(= M3 文档化已覆盖,`godot-finder` 已 GODOT_PATH 优先) | — |

**最终验证(2026-06-24)**:
- final review(opus,`0f3f6b8..8403610`):**Ready to merge**(0 Critical / 0 Important / 8 Minor 全可后续)。跨 task 契约无裂缝 —— `isBridgeReady` 签名 ↔ `run_project` 调用、setter ↔ `build*` 工厂、GodotServer 闭包延迟读 `() => this.editorConn` 正确处理 `:308/:322/:337/:364` 重赋值、向后兼容(`wait_for_bridge` 默认 false → `isBridgeReady` 不调)。零接触 grep 确认 `isBridgeReady`/`probeOnce` 无对 `_projectDir`/`_cachedSecret`/`_socket` 赋值。
- 非 E2E 全套 **2668/2668 全绿** + tsc 0(E2E 3 文件 = Godot spawn 环境已知 flaky,非本次回归)。
- 收尾:finishing Option 3,保留分支 `fix/mcp-tools-s1-s3-s4`(领先 origin/master 36 commit,跨多会话,待批次发布)。

**⚠ 运行环境发现与配置修正(2026-06-24 重启会话)**:

重启后 `manage_tools sync` 仍返回 `NOT_IMPLEMENTED: "Connection-aware sync is not yet implemented"` 旧文案。排查发现**根因不是代码,而是宿主跑错仓库副本**(调试归因铁律:磁盘 build 新 + 运行旧文案 = 运行进程≠磁盘):

- 宿主 `~/.claude.json` 的 godot.args **原本指向 `D:/GitHub/godot-ai-kit/enhanced/build/index.js`**(= v0.18.2 发布点 `9153517`,2026-06-20 旧 build,**零 backlog 修复**),而非本会话一直在改的 `D:/GitHub/godot-mcp-enhanced`。进程列表铁证:运行的是 `node D:/GitHub/godot-ai-kit/enhanced/build/index.js`,无任何进程加载 mcp-enhanced/build。
- 因此整个 S1-S6/M4 backlog(36 commit,在 mcp-enhanced 分支 `fix/mcp-tools-s1-s3-s4`)的**单元测试 2718 全绿,但从未被运行的 MCP 加载过**——Task 6 是首次运行时验证,立刻撞上"运行=旧副本"。sync 旧文案来自 ai-kit/enhanced/build/tools/manage-tools.js(Task 3 改造前的代码)。
- S4/S5 env 原本也改错文件(`mcp-enhanced/.claude/settings.json`,宿主不读它;宿主只读 `~/.claude.json` 顶层 mcpServers)。
- memory `godot-ai-kit-fork-relationship`(6天前)记"权威=ai-kit,勿在 mcp-enhanced 做新工作",但 prior-session 的整个 backlog 全在 mcp-enhanced 做 —— **矛盾待厘清**。

**已修正(本会话,node 脚本原子改写 + JSON.parse 验证)**:`~/.claude.json` godot 段 args → `D:/GitHub/godot-mcp-enhanced/build/index.js`;env 加 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true` + `GODOT_MCP_BRIDGE_EXTRA_METHODS=emit_signal`(DEBUG/GODOT_PATH(4.7)/GODOT_SKILL_LIBRARIES 保留)。**需重启宿主 Claude Code**(MCP stdio 子进程才会重 spawn 加载新 build + 注入 env)。重启后先跑 `manage_tools sync` 确认返回真实 requires 状态(非 NOT_IMPLEMENTED),再走下面 checklist。

> 注:这是**临时验证配置**(用户选路 A,2026-06-24)。验证通过后需决策代码归属:① 同步 mcp-enhanced 的 36 commit 到 ai-kit/enhanced(遵循 memory"权威=ai-kit");② 宿主配置永久指向 mcp-enhanced。env 注入的是**全局 godot mcpServer**(影响所有项目),验证完视情况是否保留。

**Task 6 待运行时验证**(重启宿主后,env 已注入 `~/.claude.json`):
- **M4**:`run_project(wait_for_bridge=true)` → 紧接 `game_query(method=ping)` 立即成功(无需手动等)
- **S4**:跨 5min TTL 后 ping + `.godot/mcp_bridge_9081.secret` 不被收紧/删除(PERSISTENT_SECRET 生效)
- **S5**:`call_method(emit_signal)` 触发 GameEvents 信号(EXTRA_METHODS 生效)
- **S6**:`send_key` physical_keycode 触发 input action(Player 移动)

**8 Minor 留后续**(详见 `.superpowers/sdd/progress.md`):M1 `handleSync` 的 `provider()` N+2 次重复调用(可提循环外,唯一稍实质)/ M2-M8 纯风格·文档·memory 描述,均不阻塞。

---

## 🔴 Task 6 运行时验证发现 buildSafeEnv 截断 env(2026-06-24)

重启后 `manage_tools sync` 返回真实状态(非旧 `NOT_IMPLEMENTED`)+ build/ 全目录含 6 新符号 → **宿主正确加载新 build 确认**。但 `run_project(wait_for_bridge=true)` 探测失败:`Bridge not ready (process exited during probe)`。

**systematic-debugging 四阶段定位根因**:
- ERROR `[MCP Bridge][SECURITY] Failed to write secret ... — aborting`(mcp_bridge.gd:219)。mcp_bridge.gd:207-222 PERSISTENT_SECRET 复用逻辑**正确**(env=true + 文件存在 + ≥32B → 复用跳过写),但 debug output **无 "Reusing persistent secret" 打印** → 复用未触发 → 走写路径 → 撞旧版残留只读 `(R)` secret → abort。
- `execute_gdscript` 探测 godot 子进程 env:`GODOT_MCP_BRIDGE_PERSISTENT_SECRET`/`EXTRA_METHODS`/`GODOT_PATH` **三全空**。
- **根因**:`src/helpers.ts:126 buildSafeEnv()` 白名单(I-04 防凭据泄露)只保留 PATH/HOME/USERPROFILE/LOCALAPPDATA/APPDATA/TEMP/TMP/GODOT/SystemRoot/COMSPEC/OS/PATHEXT/DISPLAY/WAYLAND_DISPLAY/XDG_*/LD_LIBRARY_PATH 共 18 个,**strip 所有其他**。`GODOT_MCP_BRIDGE_*` 不在白名单 → spawn-helper.ts:34 + gdscript-executor.ts:1130 spawn godot 时被丢弃 → mcp_bridge.gd 读不到 → **GDScript 修复永远不触发**。

**prior session 致命盲区**:S4/S5/S6 的 GDScript 修复 + ~/.claude.json env 注入都做了,但**从未验证 env 能穿透 spawn 边界**。buildSafeEnv 在 spawn 时截断了 env,修复永远无法生效——不是"没跑运行时验证",是"env 通路被阻断"。又一次"估算 vs 实测"(prior session 假设 env 能到 godot,实测推翻)。

**fix(TDD)**:`buildSafeEnv` 透传 `GODOT_MCP_BRIDGE_*` 子命名空间(mcp_bridge.gd 运行时配置,非凭据)。**范围刻意窄**(`GODOT_MCP_BRIDGE_` 非 `GODOT_MCP_`)——第 1 次宽透传 `GODOT_MCP_*` 打破现有 `gdscript-executor-core.test.js:217` 安全测试(`does NOT leak GODOT_MCP_UNRESTRICTED`),回 Phase 1 精确化:服务端安全开关 `GODOT_MCP_UNRESTRICTED`/`GODOT_MCP_ALLOW_UNSAFE`/`ALLOW_EXECUTE_GDSCRIPT`/`ALLOWED_PROJECT_PATHS` 仍隔离(子进程不能自行解锁限制)。

**验证**:helpers.test.js 4 新测试(RED 2 fail → GREEN)+ gdscript-executor-core.test.js 现有 UNRESTRICTED/ALLOW_EXECUTE_GDSCRIPT 安全测试仍 pass + 全套非 E2E **2692 passed (159 files)** + tsc 0 + eslint src 干净 + build/helpers.js 含新逻辑。

**⚠️ 待重启宿主验证**(env 注入链 Layer 1/2 未确认):fix 已进 build/,但运行中的 MCP 服务端仍加载旧 build。重启后 `execute_gdscript` 探测 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET`:若仍空 = `~/.claude.json` env 未注入 MCP 服务端(需修宿主配置);若读到 = Layer 1/2/3 全通,重跑 M4/S4/S5/S6。

---

## ✅ Task 6 运行时验证全通过(2026-06-24 重启宿主后)

重启后 `buildSafeEnv` 透传 fix 被运行中的 MCP 加载 + `~/.claude.json` env 注入生效,**Layer 1/2/3 全链路打通**,4 项运行时验证首次完整闭环(prior session 卡"运行时验证不可行"的根因 = env 在 spawn 边界被截断,修复后全部生效)。

**env 探测**(`execute_gdscript` 在 godot 子进程读,项目 rpg-mcp-pilot):
- `GODOT_MCP_BRIDGE_PERSISTENT_SECRET = true` ✅ 读到(Layer 1 ~/.claude.json 注入 + Layer 2 buildSafeEnv 透传 + Layer 3 spawn 继承)
- `GODOT_MCP_BRIDGE_EXTRA_METHODS = emit_signal` ✅ 读到
- `GODOT_MCP_UNRESTRICTED`/`ALLOW_EXECUTE_GDSCRIPT`/`ALLOWED_PROJECT_PATHS = ""` ✅ 安全隔离(服务端开关刻意不透传,子进程不能自行解锁)
- `GODOT_PATH = ""`(白名单只有精确 `GODOT` 不含 `GODOT_PATH` → findGodot 走 PATH=4.7 跑 4.6 项目,非本次范围)

**4 项验证**(GODOT_PATH 被 strip → findGodot fallback PATH=4.7 跑 4.6 项目):

| # | 验证 | 证据 | 结果 |
|---|------|------|------|
| **M4** | bridge 稳定连接 | `game_query(ping)` → `pong=true/fps=120/scene=main_menu`;debug 日志 `[MCP Bridge] Listening on 127.0.0.1:9081` | ✅ |
| **S4** | secret 持久化 | 日志 `[MCP Bridge] Reusing persistent secret (GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true)`(prior session "无此打印→复用未触发",现首次出现);`.godot/mcp_bridge_9081.secret` 权限 `-rw-r--` 未收紧;bridge 未 abort | ✅ |
| **S5** | emit_signal 白名单 | `call_method emit_signal ["combat_log","MCP S5 watch test"]` → `result:0`;`watch_poll` 捕获 combat_log 事件 `args:["MCP S5 watch test"]` | ✅ |
| **S6** | send_key physical_keycode | `send_key "right"` → `watch_poll` 捕获 6 个 player_moved 事件,position.x `643.33→659.99`(+3.33/帧 = 200 SPEED × 1/60s,持续右移 y 不变);移动中触发 combat_encountered 遇敌 | ✅ |

**🔴 新发现 bug:`run_project(wait_for_bridge)` 误报 process exited**:
两次 `run_project(wait_for_bridge=true)` 都返回 `⚠ Bridge not ready (process exited during probe)`,但 `get_debug_output` 显示 `running: true` + `ping` `pong=true` + 日志 `Listening`。根因 = prior session(Task 1,`a534d7f`)加的 `isBridgeReady` "进程早退短路"优化在进程活着时**误判退出**。**M4 验证目标(bridge 可用)实质达成,但 `wait_for_bridge` 工具本身有 bug**——用户用 `wait_for_bridge=true` 会看到假失败,误以为 bridge 不可用。需单独修 `isBridgeReady` 探测逻辑(短连接探测的进程存活判据有误)。

**次要发现**(文档补充,非 bug):
- **send_key key 格式**:`mcp_bridge.gd:_key_from_string` 用**小写单字符/方向名**(`"d"`/`"right"`/`"space"`/`"enter"`),不认 `"Key_D"`(返回 `Unknown key`)。bridge rule 文档例子 `send_key Key_W` 不准,实际要 `"w"`。
- **watch 信号路径**:信号在**声明节点**(GameEvents),不在 emit 调用方(Player)。watch `player_moved` 需 `node_path=/root/GameEvents`(player_controller `GameEvents.player_moved.emit`),`/root/Exploration/Player` 报 `Signal not found`。
- **click_button "Cannot get path"** warning(`mcp_bridge.gd:1320`):已知次要,emit_signal("pressed") 仍工作(场景切换成功,button_path 返回空)。
- **rpg-mcp-pilot 项目自身 bug**(非 MCP):`game_manager._on_player_moved` 参数不匹配(信号 emit 带 Vector2,回调 `Method expected 1 argument(s), but called with 0`)、`combat_engine.gd` enum int 警告。

**结论**:S1-S6/M4/M6 backlog 全部修复 + 运行时验证通过(S2/M1 核查撤销)。**env 通路(buildSafeEnv 透传 GODOT_MCP_BRIDGE_*)是解锁运行时验证的关键**——prior session GDScript 侧 S4/S5/S6 fix 之前因 env 截断永不触发,修复后全部生效。`run_project(wait_for_bridge)` 误报 bug **已修**(见下)。

---

## ✅ run_project(wait_for_bridge) 误报 bug 修复(2026-06-24)

systematic-debugging + TDD 修复(本会话)。

**根因**(代码层确认):`isBridgeReady`(game-bridge.ts:778 原)`if (proc.killed || isCancelled()) return process exited` 早退短路**早于** probeOnce(:781-782)。`isCancelled = () => ctx.runningProcess !== proc`(runtime.ts:196),多次 run_project 时 ctx 互覆盖/前 proc 的 close 使 `ctx.runningProcess !== 当前 proc`,即使当前 bridge(某 godot)可用也立即报 process exited。矛盾证据:`get_debug_output running=true`(ctx.runningProcess≠null)+ isCancelled=true(ctx.runningProcess≠proc)→ ctx 是**另一 proc**(非 null 排除根因 B「proc 自身 exit 设 null → running=false」,确认根因 A「多 godot/ctx 覆盖」)。

**修复**(game-bridge.ts:778):拆分 proc.killed 与 isCancelled——proc.killed 仍立即失败(proc 真死,bridge 同 proc 死);**isCancelled 时先 probeOnce 探测实际 bridge**(ctx 状态变化 ≠ bridge 不可用;多 godot/端口冲突场景另一 godot 仍服务 9081),可用则 ready,不可用才 process exited。

**TDD**(game-bridge-isready.test.ts):RED(新)isCancelled=true + bridge 可用(mockCreate authSuccess)→ ready,修复前 fail(process exited);GREEN 拆分 :778 isCancelled 先 probeOnce;调整原 :74(加 mockCreate stuckSocket 表达 bridge 不可用分支);保留 :67-72(proc killed → process exited)。验证:game-bridge + runtime 27✓ + 全套非 E2E 2743✓ + tsc 0。E2E 6 fail(executeGdscript/workflow Godot spawn)为预存 flaky baseline(git diff 仅 game-bridge.ts + test)。

**待可选运行时验证**(rebuild + 重启 MCP):`run_project(wait_for_bridge=true)` → bridgeMsg 应含 "Bridge ready"(不再 "process exited during probe")。

