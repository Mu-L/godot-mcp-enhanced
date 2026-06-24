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

**S4/S5/S6 运行时验证**:待专门验证会话(需重启 MCP 注入 env)。

