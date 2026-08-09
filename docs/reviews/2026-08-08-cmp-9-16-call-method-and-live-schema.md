# CMP-9 + CMP-16 第三方审查报告

**审查对象**:`D:\GitHub\godot-mcp-enhanced` 分支 `feat/cmp-9-16-call-method-and-live-schema` 的 CMP-9(editor `engine.call_method` + bridge `_cmd_call_method` 放宽)+ CMP-16(GD param docs + TS live schema + drift CI)实现。

**审查方法**:所有声明用 grep/read 实测,不预设 plan 声明为真。覆盖设计正确性、TS-GD 一致性、测试质量、部署同步、仓库级约束、验证完整性六维度。

**审查受限声明**:本次审查运行在无 Bash 工具的 subagent 环境,无法直接执行 `npm test`/`npm run build`/`check:gdscript`。验证完整性通过 build 产物同步状态、CI 配置、fixture 同步状态、测试逻辑间接确认(详见维度 6)。父 agent 已实跑全链路验证(本文末附录)。

---

## 总体判定:SHIPPED WITH NITS

5 个批次的**核心功能链路完整且安全设计扎实**,无 Blocking 级别的功能缺陷或安全漏洞。CMP-9 deny-list 护城河充分(不照搬竞品"无过滤"缺陷),CMP-16 live schema 缓存/降级/刷新逻辑正确,调用路径(editor 直转)经验证可工作。发现 0 个 Blocking Issue、6 个 Nit(含 1 个部署同步遗漏、1 个测试盲区、若干代码质量瑕疵)。

---

## 逐维度结论

### 维度 1:设计正确性 — PASS

**CMP-9 deny-list 安全设计充分**(`addons/godot_mcp_server/commands/engine_commands.gd:22-28`):
- `DEFAULT_CALL_DENYLIST` 覆盖关键危险方法:`free/queue_free/queue_delete`(销毁)、`add_child/remove_child/set_owner`(结构修改)、`call/callv/call_deferred/call_threadsafe`(间接调用绕 deny-list)、`set_script`(RCE)、`emit_signal/connect/disconnect`(信号拓扑)。
- env 覆盖机制安全(显式 opt-in,`engine_commands.gd:277-291`):env 未设→默认表;env 显式空串→清空(风险自担);env 非空→解析逗号分隔。
- args 类型强转无注入风险(`engine_commands.gd:345-389`):按 Variant.Type 分支强转,String 传 Vector3 走 `Vector3(raw)` 构造(Godot 内置解析,非 eval)。
- 对标竞品"无过滤"缺陷已明确规避(`engine_commands.gd:20` 注释)。

**CMP-16 live schema 缓存/降级/刷新逻辑正确**(`src/core/dynamic-schema.ts:144-188`):
- 懒加载+缓存(`getDynamicTools:162-181`)。
- editor 离线/超时/抛错降级空数组(`:175-180`)。
- editor 重连/降级时 invalidate 刷新(`src/GodotServer.ts:562-563,612-614`)——修竞品"只 fetch 一次不刷新"缺陷。
- 排序保证幂等 + 名字冲突保留先到 + 体积自限 100KB(`dynamic-schema.ts:105-138`)。

**调用路径验证(关键)**:live schema 生成的动态工具(如 `engine_call_method`)被 AI 调用时的路径——`ToolDispatcher.executeToolCall:418` editor 模式下 `EditorToolExecutor.execute(name, args)`,`EditorToolExecutor:89-90` 因 `resolveEditorMethod('engine_call_method')` 未命中(MAP 键是顶层 `engine`,不是扁平 method 名)→ `method = toolName = 'engine_call_method'` → `conn.request('engine_call_method', args)` → `command_handler.gd:246` match 命中 `engine_call_method` 分支。**调用路径工作正常**(前提:editor 模式;headless 模式下动态工具不出现,无调用问题)。

### 维度 2:TS-GD 一致性 — PASS

- `editor-method-map.ts:120` `engine.call_method → engine_call_method` 与 `command_handler.gd:246` `"engine_call_method": return _engine_commands.handle_call_method(params)` 一致。
- `static-grep.ts:149` `engine_call_method: 'commands/engine_commands.gd'` 路由正确。
- `static-grep.ts:139` `list_param_docs: 'command_handler.gd'` 与 `command_handler.gd:282` match 分支一致。
- 13 个 GD command 文件全部实现 `get_command_docs`(实测 `addons/godot_mcp_server/commands/*.gd`,13 文件命中),与 `command_handler.gd:293-298` `get_all_command_docs` 的 modules 数组(13 项,排除 recording 死代码)一致。
- GD docs method 总数 57(`cmp-16-param-docs.test.ts:159` 断言),逐文件计数与实际 handler 数一致。

### 维度 3:测试质量 — PASS WITH NITS

**真实行为测试**(非虚假):
- `test/engine-tools.test.ts` CMP-9c(risk=write 断言)、CMP-9d(EDITOR_ONLY 返回断言)验证真实行为。
- `test/cmp-16-dynamic-schema.test.ts` 验证缓存命中计数、fetcher 抛错降级、isToolAllowed 放行(真实逻辑)。
- `test/cmp-16-command-docs-drift.test.ts:9-18` 用 `execFileSync` 真实执行脚本并断言输出。

**诚实声明**:`cmp-9-bridge-call-method.test.ts:5-7` 明确标注"运行在游戏进程,无法单测运行时行为,验证源码改动落位"——非虚假测试,是合理的契约测试。

**NIT-1(测试盲区)**:CMP-16-B 缺少"动态工具被 AI 调用时经 EditorToolExecutor 转发到 editor"的端到端测试。现有测试只覆盖 schema 构建 + tool-registry 注册,未覆盖调用路由(维度 1 手动验证路径正确,但无自动化测试守护)。建议补一个测试:mock EditorConnection.request,调用 `engine_call_method` 工具,断言转发 method 名 = `engine_call_method`。重要度中等,非阻塞(代码路径正确)。

**NIT-2(无效测试代码)**:`test/cmp-16-dynamic-schema.test.ts:138-147` 的"fetcher 返回 null 时缓存空数组"测试中,`fetchCount` 变量声明并自增但从未 `expect` 断言(dead code),测试注释自己也承认"setFetcher 会 invalidate 所以会重新拉"。该断言实际只验证了第一次 `tools.toEqual([])`,第二次拉取的缓存行为完全未验证。非虚假测试(有有效断言),但测试名与实际验证内容不符。建议清理或补真实缓存断言。

### 维度 4:部署同步 — PARTIAL(1 项遗漏)

- capability-matrix 已重建:`docs/capability-matrix.json:2` version=0.27.0,反映 engine call_method action。PASS。
- version 已 bump:`package.json:3` version=0.27.0。PASS。
- CHANGELOG 完整:`CHANGELOG.md:9-38` 详记 CMP-9-A/B + CMP-16-A/B/C。PASS。
- CI 已接入:`.github/workflows/ci.yml:48` `check:command-docs-drift` 步骤。PASS。
- check:gdscript fixture 已同步:`test/fixtures/gdscript-check/src/scripts/mcp_bridge.gd` 含 CMP-9-B 改动。PASS。
- build 产物完整同步:11 文件含新代码。PASS。

**NIT-3(rule-templates.ts 独立副本未同步 CMP-9-B 新行为)**:`src/tools/rule-templates.ts` grep 仅在 `:165/:235` 提到 `call_method`,**完全未反映** CMP-9-B 新增的 did-you-mean / undoable=false / args 自动强转 / EXTRA_METHODS_BLOCKLIST 硬底线说明。**本次 CMP-9-B 新内容两份独立副本都未同步**(rule-templates.ts 完全没写,.claude/rules/ 也没写)。违反 AGENTS.md「独立副本同步约束」。但 CI `check:rules-sync` 是 advisory(continue-on-error: true),不阻断。重要度中等——rule 文件是给 AI 客户端的运行时指引,缺失会让 AI 不知道 call_method 有 did-you-mean/强转能力,但不破坏功能。

### 维度 5:仓库级约束独立核查 — PASS

- **capability-matrix.json 反映新工具/action**:PASS。
- **check-tool-groups 对动态工具处理**:`scripts/check-tool-groups.mjs` 扫静态 TOOL_GROUPS 顶层工具名(`engine`/`debug`),不扫扁平 method 名,不扫 dynamic 组。动态工具(经 registerDynamicTools 运行时注入)不进静态扫描,不会误报。PASS。
- **module-loader 注册链路**:`src/core/module-loader.ts:62,86` engine 已注册。`dynamic` 组在 `tool-registry.ts:197` 有定义,默认 activeGroups 含 dynamic。PASS。
- **static-grep ROUTING 完整性**:`engine_call_method` + `list_param_docs` 均登记。PASS。

### 维度 6:验证完整性 — PARTIAL(子代理无法实跑,父 agent 补充)

子代理无 Bash 环境,通过 build 产物同步状态间接确认。**父 agent 已实跑全链路验证**(见本文末附录)。

---

## Blocking Issues

无。

---

## Nits(非阻塞)

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| NIT-1 | `test/cmp-16-dynamic-schema.test.ts`(缺失) | CMP-16-B 无"动态工具经 EditorToolExecutor 转发"端到端测试 | 补测试:mock EditorConnection.request |
| NIT-2 | `test/cmp-16-dynamic-schema.test.ts:138-147` | dead code(`fetchCount` 无断言),测试名与内容不符 | 删 dead code 或补真实缓存断言 |
| NIT-3 | `src/tools/rule-templates.ts` + `.claude/rules/godot-mcp-bridge.md` | CMP-9-B 新行为两份独立副本都未同步 | 在 bridge 规则段补 CMP-9-B 说明 |
| NIT-4 | `src/tools/engine.ts:46` | action enum description 残留旧文本漏 `call_method` | 补 `call_method` |
| NIT-5 | `addons/.../engine_commands.gd:313-316` | `filter(...).front()` 类型隐患 | 改为循环赋值 |
| NIT-6 | `addons/.../engine_commands.gd:325` | `da.get("default", null)` 键名与 ClassDB `"default_value"` 不一致 | 删冗余判断 |

---

## 值得进 memory 的工程教训

1. **动态工具调用路由验证**:live schema 生成的动态工具(扁平 method 名)被 AI 调用时,经 `EditorToolExecutor` 的 `resolveEditorMethod 未命中 → method=toolName` fallback 直转 editor,**依赖 command_handler.gd handle() 有对应扁平分支**。新增动态可调用 method 时,三处必须同步:① GD `command_handler.gd` handle() 分支;② `static-grep.ts` ROUTING;③ GD `get_command_docs`(否则 live schema 不广告)。

2. **rule-templates 独立副本同步盲区复发**:本次 CMP-9-B 新行为两份 rule 副本都未同步,CI `check:rules-sync` advisory 模式不阻断。是 AGENTS.md「独立副本同步约束」记录的已知盲区再次复发。

3. **测试覆盖"构建层"易漏"调用层"**:live schema 类功能链路是"GD docs → TS schema 构建 → tools/list 广告 → AI 调用 → editor 转发",测试易在前 3 步止步。建议动态工具类功能必须有"mock editor + 调用转发"端到端测试。

---

## 附录:父 agent 全链路验证证据(实跑)

子代理无 Bash 环境,以下为父 agent 实跑结果(2026-08-08):

```
lint:        0 错误
build:       0 错误
test:        4749 passed / 0 failed
check:gdscript: 0 errors / 0 warnings(项目级完整编译)
check:tool-groups: 40 工具全归组
check:command-docs-drift: 7 method 已校验,50 一期豁免
check:tool-count: 20 处校验全一致(actions=221)
version-check: 0.27.0 全一致
```
