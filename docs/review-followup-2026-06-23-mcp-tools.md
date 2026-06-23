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
