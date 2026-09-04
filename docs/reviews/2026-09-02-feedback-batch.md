<!-- 审查者: code-reviewer 子代理(隔离视角,72 次工具调用实测);本文件由主 agent 代落盘(审查者环境无 Write) -->
<!-- 处置记录(2026-09-02 主 agent): NIT-1/NIT-2/NIT-3/NIT-4/NIT-5/NIT-6 全部本批清偿,见收尾 commit;真机复验见文末附录 -->

# 审查报告：fix/feedback-batch-20260902（ca68d56 / 6f997b4 / 746eb61，基 e9f41f2）

## 审查方式与限制声明（验证方式）

- commit 链经 `.git/logs/HEAD:2706-2710` 实测确认：e9f41f2 → ca68d56 → 6f997b4 → 746eb61（HEAD），工作区即分支终态。
- **本环境无 Bash 工具**：`git diff/show` 与 `npm run lint / build / test / check:command-docs-drift` 无法复跑。替代手段：全部引用行号均经 Read/Grep 本次实测；改动面以「工作区终态 + reflog + `.git/COMMIT_EDITMSG` + 代码内反馈注释」交叉核对，报告对无法复跑项如实标注。
- **本环境无 Write 工具**且系统指令禁止审查 agent 落盘报告文件：任务要求的 `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\reviews\2026-09-02-feedback-batch.md` 无法由我写入，全文在此返回，请父 agent（具备写文件能力）落盘。

## 总体判定：SHIPPED WITH NITS

3 个 commit 的六项核心修复（remove_node 持久化链、_exit_with 退出码登记、batch failed_props 根治、send_drag 类型归一、take_screenshot path 豁免、installOverride 内容漂移更新 + PathError 结构化）设计正确、TS-GD 一致、测试真实锚定行为、生成产物已同步。存在 2 个 Important 级发现（退出码收口遗漏 add_node/batch 的 save/pack 失败分支；CHANGELOG 未记本批）与若干 nit，均不阻断合并。

---

## A. 设计正确性

**A1. remove_node handler（`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\godot_operations.gd:609-662`）— 通过**
- 路径规范化链（:624-635）：三段前缀剥离（`/root/`→`root/`→`/`）与 edit_node（:559-565）逐字一致，并额外做 `scene_root.name + "/"` 剥离（:633-634，对齐 add_node parent 特判 :496-509，注释说明 query_scene_tree 拷贝路径场景）+ 根名拒绝（:635-638，`""`/`"."`/根名三种形态均拦截）。边界推演：根名恰为 "root" 时 `"/root"` 剥前导斜杠后等于根名 → 正确拒绝；根 Main 下有同名子树 `Main/X` 时会被剥前缀误指向根的直接子节点 X——该歧义与 add_node 既有 parent 特判同源（非本批引入），置信不足 80 不作 issue。
- `node.free()`（:647）在 `parent.remove_child(node)`（:646）之后调用：node 已脱离树，无帧循环的 `--script` 模式下立即 free 是正确做法（queue_free 悬置正是反馈根因）；`node_name` 在 free 前拷贝为 String（:645），free 后零引用，无悬垂风险。
- save/pack 失败分支有 `cleanup_and_quit([scene_root], 1)`（:656/:660），对齐 edit_node（:591-597）。

**A2. _exit_with 退出码收口（同文件 :285-316）— 通过**
- 全文 grep `quit`：唯一直接 `quit(code)` 在 `_exit_with` 内部（:309）；`_init` 尾部 `call_deferred("quit", _requested_exit_code)`（:289）按登记值重放。三态推演自洽：成功路径登记值保持 0 → deferred quit(0)；handler 失败路径 `_exit_with(1)` 登记 + 立即 quit(1)，重放同为 1，不再被无参 deferred quit 覆盖回 0。`cleanup_and_quit` 统一走 `_exit_with`（:311-315）。无遗漏的裸 quit 调用点。
- **但见 NIT-1（Important）**：收口只覆盖「调用了 quit(N) 的路径」，从未调用 _exit_with 的失败分支仍退出码 0。

**A3. batch_add_nodes（:665-769）— 主体通过，save/pack 失败分支见 NIT-1**
- 原子性语义正确：任一属性失败 → `failed_props` 收集（:728-736）→ `failed_count += 1` + `new_node.free()` + `continue`（:737-742），未 add_child 的节点 free 安全；`failed_nodes` per-node 上报链完整（:739 append → :759-760 输出）；`failed_count > 0` 时 `_exit_with(1)`（:757-764），TS 侧 `exitCode !== 0` 判定（`src/tools/scene/index.ts:364`）能抓到。
- node_name 缺失守卫（:689-694）覆盖反馈形态 3。

**A4. installOverride（`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\overrides.ts:86-183`）— 通过**
- 沙箱扫描上移至幂等检查之前（:100-118），:104 注释明确「重复 install 走内容更新路径时同样重扫（新内容 = 新威胁面）」——有意设计。成本：完全幂等路径（内容一致返 null）也会扫一次，安全上「宁可多扫」合理；顺带小低效见 NIT-4（同文件读两次）。
- 内容比对异常路径：`destContent` 读取失败会抛原生 Error，但 MCP 入口 `game-bridge.ts:474-499` 有 try/catch → `OVERRIDE_INSTALL_FAILED` 结构化错误，不落笼统 INTERNAL。
- 漂移分支 `copyFileSync` + `updated: true`（:138-140），TS 壳 `game-bridge.ts:480-489` 接线完整，dest 以 `res://` 相对形式回显（:486）。

**A5. validateBridgePath 可选 method 参数（`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\game-bridge.ts:291-303`）— 通过**
- 全部调用点核查：game-bridge.ts :323/:541/:570 传 method；`src/tools/qa/runner.ts:473/:480`（set/call 步骤）不传 method，可选参数下行为同旧版（path 照常校验），向后兼容成立。
- 豁免仅对 `key === 'path'`（:296），`node_path` 键在 take_screenshot 下仍校验——与测试 :57-61 契约一致。

**A6. _vec2_from_param（`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\mcp_bridge.gd:1760-1767`）— 通过**
- 三形态归一：Array（越界/空数组回 fallback，:1761-1764）、Dictionary（缺 key 回 fallback，:166）、其他（null/字符串/数字）回 fallback。~~GDScript `float()` 对数字字符串与 null 均安全转换不崩~~（**2026-09-03 作废**：全面维度审查真机实证 `float(null)`/`float([1,2])`/`float({"x":1})` 是运行时 SCRIPT ERROR，见 `docs/reviews/2026-09-03-full-dimension-review.md` I-C——元素级守卫缺失已由 commit 9f1d379 补 `_num()` 白名单修复；仅数字字符串安全成立）。时间线回放路径复用同一函数（:2723-2724），录制序列化的 `{x,y}` 形态走 Dictionary 分支，双路径覆盖。修复了原 `Array` 类型化变量接 Dictionary 的 SCRIPT ERROR（:1757-1759 注释）。

**A7. throwPathNotAllowed（`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\screenshot.ts:18-23`）— 主体通过，roots 提示见 NIT-2**
- `never` 返回类型用法正确（函数体恒 throw）。`PathError extends ToolError`（`src/core/tool-errors.ts:62-67`），`classifyError` 对 ToolError 白名单外传 safeMessage（:123-131），原生 Error 才落笼统 'Internal error'（:132-133）——修复描述与代码行为自洽。被拒路径仅回显 `basename(p)`，对齐 P2-17；allowlist 是 env 配置非用户探测输入，外传无 P2-17 顾虑。

## B. TS-GD 一致性

**通过。**
- `src/tools/scene/index.ts:438` 传 `{ scene_path, node_path }`，GD handler 读 `params.scene_path`（:610/:611）与 `params.node_path`（:624）名称/格式一致；`normalizeNodePath`（`src/tools/shared/value-serializer.ts:89-95`）输出 `"/X/Y"` 带前导斜杠，GD `begins_with("/")` → `substr(1)` 剥离链（:629-630）正确匹配。node_path 缺失时 normalizeNodePath throw，finally 释放 slot 后冒泡为工具错误，无 slot 泄漏。
- batch 双层防御：TS 侧 `nodes` 数组/上限 100/node_type `^[A-Za-z0-9_]+$`/node_name 禁特殊字符（scene/index.ts:347-349，注入面拦截），GD 侧 node_name 缺失守卫（:689-694，JSON 形态残缺兜底）——层次互补。
- editor 路由不受影响：`src/core/editor-method-map.ts:72` remove_node 有 editor 映射，本批只改 headless fallback 链，且 headless case 带 `checkEditorSceneSave` 守卫（scene/index.ts:432-435）。
- 工具描述与 capability-matrix 一致（见 D）。

## C. 测试质量

**通过。接线零验证判别（静态推演「删被测代码是否红」）：**
- `test/overrides.test.ts:85-104`（内容漂移）：若恢复旧「hasNewKey 直接 return null」逻辑，`expect(re).not.toBeNull()`（:93）与目标文件刷新断言（:97）红；:100 断言 autoload 行数不重复、:103 断言幂等不受影响，行为锚定完整。
- `test/overrides.test.ts:106-114`（漂移重扫）：若把沙箱扫描移回幂等检查之后，危险内容已注册 → 不 throw → `toThrow(/sandbox/i)`（:113）红——锚定「扫描上移」设计本身。
- `test/game-bridge-validation.test.ts:52-67`：删 :294 skipPathKey 则 :53-54 红；豁免误扩到 node_path 则 :57-61 红；把豁免做成「按 user:// 值判断」的偷懒实现则 :63-67（非豁免 method 同形态仍拒）红——三向防伪。
- `test/scene-validation-concurrency.test.js:130-149`：断言 spawnGodot 参数含 `remove_node` op 与 `godot_operations.gd`（:147-148），回退内联脚本路径必红；:162-178 断言 exitCode 1 透传为 isError。
- 删守卫红测抽查（batch failed_props）：删 :737-742 防护后属性失败节点照常 add + failed_count 不增 → `failed_count > 0` 分支不触发 → exit 0 假成功；`test/scene-uid-preserve.test.ts:27-32` 从源码契约层覆盖 remove_node 的 uid 保留（4 调用点计数断言）。GD 侧行为级红测依赖真机/e2e（本批声称已跑，见 E），单测层以 mock + 源码契约为主，可接受。

## D. 仓库级约束独立核查

- **独立副本同步**：规则文件（`.claude/rules/` 与 `src/tools/rule-templates.ts`）grep send_drag 零匹配、take_screenshot 命中均为使用指导（GPU vs headless），不含本批行为细节（参数校验豁免/双形态），无同步义务。无 BLOCKING。
- **分发产物**：`docs/capability-matrix.json:1995` 的 game method 描述含「send_drag (relative/speed 支持 [x,y] 数组或 {x,y} 对象)」与 `game-bridge.ts:112` 逐字一致，:1953/:4276 顶层描述同步——生成产物与源一致，非手改痕迹。capability-matrix.md 为高层矩阵不含参数描述，形态正常。
- **fixture 副本**：`test/fixtures/gdscript-check/src/scripts/godot_operations.gd` 由 `src/scoring/check-gdscript.ts:69` 幂等覆盖拷贝（非独立副本）；token 计数 761=761、抽查段落（:660-789、:940-984）逐字一致，mcp_bridge.gd :1760 行号对齐——同步成立。
- **check:command-docs-drift 静态评估**：该脚本（`scripts/check-command-docs-drift.mjs`）只比对 `addons/godot_mcp_server/commands/*.gd` 的 get_command_docs 参数名与 `build/tools/*.js` inputSchema 参数名（:305-312）。本批改动面（godot_operations.gd headless、mcp_bridge.gd、描述文本、PathError）不新增/删除参数名，静态推演不会引入 drift；复跑验证因无 Bash 未执行。
- **CHANGELOG（NIT-3，Important）**：`CHANGELOG.md` `[Unreleased]` 段（:7-25）只有此前 3 条 issue 修复，本批 3 个 commit 零记录。AGENTS.md「发版前额外门禁」明文要求 fix 批「变更记录进 CHANGELOG `[Unreleased]` 段」。
- **eslint/tsc 复跑**：无法执行（无 Bash），代码静态审读未发现 `any`/未用变量/类型问题（抽查改动文件）；此项以 commit 声称为准，标注未独立复核。

## E. 验证完整性

- **_exit_with 三态路径推演**（E 维度核心）：成功=0、handler 显式失败=登记重放 1、batch 部分失败=1，三态在代码层自洽，与「退出码三态」验证声明相符；唯一破口是 NIT-1 的未登记路径。
- **真机验证声明（Godot 4.6.3：remove 落盘/unique_name_in_owner/root 拒绝）**：逻辑自洽——落盘=pack+`_save_atomic`（:648-651，A5 uid 回填入契约测试）；unique_name_in_owner 失败走 failed_props→整节点失败（:735-740，反馈形态 2 的修复点）；root 拒绝=：635-638。无矛盾证据。
- **6155 passed**：无法复跑（无 Bash）。三个被点名测试文件均在（scene-uid-preserve / overrides / game-bridge-validation），结构完整。
- 本审查自身验证方式：全部 file:line 引用为本次 Read/Grep 实测（快照护栏），commit 链为 reflog 实读。

---

## Blocking Issues

无。

## Nits（按重要性排序）

1. **[Important，置信 88] batch_add_nodes / add_node 的 save/pack 失败分支退出码 0 假成功，与「退出码收口」主题不完整落地**
   `src/scripts/godot_operations.gd:765-768`（batch）与 `:535-538`（add_node）：save 失败/pack 失败仅 `log_error` 后落到 `scene_root.free()`（:769/:539），从不登记 `_requested_exit_code`，_init 尾部 deferred 重放 0 → TS 侧 `src/tools/scene/index.ts:364` 按 `exitCode !== 0` 判定 → **返回 success 并把含 ERROR 行的 stdout 当成功文本**。同文件 5 个写盘 handler 中 create_scene（:469-471）/edit_node（:589-597）/remove_node（:654-661）/save_scene（:967-971，2026-08-07 P1 修复）均处理了，唯 add_node/batch 遗漏；:969 注释还点名「对照 batch_add_nodes 的失败分支处理」。add_node 部分为 pre-existing，但 batch_add_nodes 是本批大改函数。修法：两处 else 分支对齐 edit_node（`scene_root.free()` 前后补 `_exit_with(1)` + return）。触发罕见（磁盘满/权限/pack 失败）但属数据丢失假成功，建议本批顺手补。
2. **[Important-low，置信 85] throwPathNotAllowed 的 Allowed roots 提示与实际判定语义不一致**
   `src/tools/screenshot.ts:19` 无条件把 `process.cwd()` 拼入提示列表，但 `src/core/path-utils.ts:265-276`：配置了 ALLOWED_PROJECT_PATHS 时 **cwd 不放行**（cwd 仅在 allowlist 为空时 fallback，:251-263）。配置 allowlist 的部署（AGENTS.md 示例即如此）下，用户按指引把文件移到 cwd 仍被拒——与本批「消除误导排查方向」的目标相悖。`.git/COMMIT_EDITMSG` 自述「含允许根列表(含 cwd)」说明是有意写，但与判定函数语义错位。修法：allowlist 非空时不附加 cwd，或让 isPathInAllowedRoots 语义对齐。
3. **[流程，置信 90] CHANGELOG `[Unreleased]` 缺本批 3 条记录**（见 D）。修法：补 Fixed 段，按仓库既有格式（根因/修复/验证）。
4. **[微优化，置信 90] installOverride 幂等路径双读源文件**：`src/core/overrides.ts:109`（沙箱扫描读）与 `:130`（内容比对读）对同一文件两次 readFileSync。可复用变量；纯低效无正确性问题。
5. **[一致性观察，置信 80] edit_node 无根名前缀剥离而 remove_node 有**：`godot_operations.gd:559-565` vs `:633-634`。反馈场景「用户从 query_scene_tree 拷的路径含场景根名」对 edit_node 同样成立（传 "Main/X" 报 not found）。同工具内 node_path 宽容度不一致，建议后续统一（非本批义务）。
6. **[pre-existing 提及] installOverrides 批量原子性声明与实现不符**：`overrides.ts:287-303` 注释称「全装或全不装」，但预校验只覆盖越权+存在性，单条沙箱扫描/project.godot 改写失败时已装条目不回滚。非本批改动，留档。

## 值得进 memory 的工程教训

1. 「退出码收口」类修复要按失败路径清单全量对账而非按调用点替换：本批把 `quit(N)` 机械替换为 `_exit_with(N)` 后，**从未调用过 quit 的失败分支**（add_node/batch save/pack 失败）依旧假成功——替换式收口会漏掉「本来就没走到收口点」的路径；核查手段应是「每个写盘 handler 的每个 else 分支是否有非零登记」，而非「grep 裸 quit 是否清零」（`src/scripts/godot_operations.gd:765-768` vs `:967-971`）。
2. 错误消息里的「修复指引」是行为面而非文案面：`screenshot.ts:19` 展示的 allowed roots 与 `path-utils.ts:265-276` 的实际判定语义脱节，指引本身变成新误导源。凡在 safeMessage 里写「允许 X」类提示，必须与判定函数同源生成。
3. `call_deferred("quit")` 无参 = quit(0) 会覆盖此前 quit(N)——Godot `--script` SceneTree 模式下退出码须经模块级登记变量重放（`godot_operations.gd:285-289` 注释已固化此认知，值得跨会话保留）。

**关键文件**：`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\godot_operations.gd`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\scene\index.ts`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\overrides.ts`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\game-bridge.ts`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\scripts\mcp_bridge.gd`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\screenshot.ts`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\path-utils.ts`、`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md`。