# 全面维度审查报告：fix/feedback-batch-20260902（e9f41f2 → 8b10489）

<!-- 审查方式：5 维度并行子代理（headless / bridge / TS 质量 / 安全 / 测试覆盖）+ 主 agent 实跑构建验证与对抗核实 -->
<!-- 与上轮（2026-09-02-feedback-batch.md）的差异：上轮审查者无 Bash（未能跑 diff/构建/测试）；本轮全部命令实跑 + 真机探针 5 轮 -->
<!-- 处置记录(2026-09-03): 第一批 f80e964 处置 C-1+I-A/I-B/I-C;第二批处置 I-D/I-E/I-F+Minor 1/2/3/5/6/7/8/9/10/11/13+L-2/L-3+规则沉淀(见 CHANGELOG 第二批条目)。
     不处置: Minor-12(safeMessage 携 allowlist,本地单用户设计取舍,多用户部署时回收)、F-1(flaky 治理,需立项复现矩阵)。
     处置中新发现并同批修复: _resolve_parent_node 剥后根名再判定边界(否则 "/root/<根名>" 误报 not found)。 -->

## 总体判定：SHIPPED WITH NITS（5/5 子审查一致，无阻断合并项）

四项核心修复（remove_node 持久化链、`_exit_with` 退出码机制、send_drag 顶层形态归一、installOverride 漂移更新 + PathError 收口）与上轮 6 个 NIT 处置全部验证为真实到位。新发现 1 个 Critical（pre-existing 但属本批主题覆盖面）+ 6 个 Important（合并去重后），均有小改动修法。

## 主 agent 实跑验证矩阵（上轮审查的验证缺口，本轮全补）

| 验证项 | 结果 |
|--------|------|
| `npm run lint` | ✅ exit 0 |
| `npm run build`（tsc） | ✅ 0 错 |
| 定向测试（本批 5 文件） | ✅ 94 passed（含 GODOT_PATH 门控真机 e2e 1 例 291ms） |
| 全量 `vitest run`（3 次） | ⚠️ 1 failed（ui-layout）→ 5 failed（remove_node × 5）→ **6155 passed 全绿**——flaky，见「F-1」 |
| `check:gdscript` | ✅ errors=0 warnings=0 |
| `check:command-docs-drift` | ✅ 60 method、0 未映射 |
| `check:changelog-sync` | ✅ advisory exit 0（c2da07 为 master 既有，与本批无关） |
| 文档产物对账 | ✅ CHANGELOG 三段补登与提交一致；capability-matrix.json schema +146B 与 .md 数字（94391→94537）吻合 |
| fixture 副本 | ✅ godot_operations.gd / mcp_bridge.gd 与源逐字节一致 |
| 真机探针（Godot 4.7 stable） | ✅ 5 轮：`JSON.stringify(Vector2)` 输出 `"(100.0, 50.0)"`；`float(null)`/`float([1,2])` SCRIPT ERROR 实证；`Node.name` 保留控制字符；take_screenshot 段检查五形态推演 |

## 上轮 NIT 处置核验（全部落地）

NIT-1（add_node/batch save 失败 `_exit_with(1)`）✅ / NIT-2（roots 与判定同源）✅ / NIT-3（CHANGELOG）✅ / NIT-4（单读复用）✅ / NIT-5（edit_node 前缀剥离）✅ / NIT-6（注释措辞）✅。退出码全量对账在活跃 handler 层通过（`_init` 4 / create_scene 6 / edit_node 6 / remove_node 6 / batch 8 / load_sprite 6 / save_scene 5 条失败分支均有非零登记）。

---

## 发现清单（五维度合并去重，按严重度）

### Critical

**C-1. add_node GD fallback 路径属性设置失败 = 静默假成功（属性丢失 + 零错误痕迹）**【主 agent 对抗核实 CONFIRMED】
- `src\scripts\godot_operations.gd:518-523` + `src\tools\scene\index.ts:205`
- `_set_property_with_coerce` 失败仅 `log_error`（printerr → **stderr**），不计数不失败继续执行——节点照常 add_child + pack + save，打印 "added successfully"，exit 0；TS 成功路径只返回 `stdout.trim()`，stderr 错误行整体丢失。
- 失败场景：`add_node(properties={"position":[100]})`——数组属性走 TS 纯文本路径被拒（canSerializeProperty）→ fallback 走 GD → 分量 coerce 失败 → log_error → 继续落盘 → exit 0 假成功。凡属性含数组/对象（数学类型最常见形态）即走此路径，拼错属性名/分量缺失/res:// 路径错误均触发。
- 不一致铁证：同一属性集走 `batch_add_nodes` = 整节点失败 + exit 1（本批 ca68d56 根治）；走 `add_node` = 假成功。上轮 memory 教训 1「替换式收口漏掉没走到收口点的路径」的再次发生——NIT-1 处置只补了 save/pack else 分支，漏了这条「log_error 后继续」路径。
- 定性：pre-existing 行为（非本批引入），但属本批「静默失败根治 + 退出码全量对账」主题的自然覆盖面，触发面远比 NIT-1 的磁盘满场景常见。
- 修法：对齐 batch 的 `failed_props` 模式（收集失败属性 → `new_node.free()` + `cleanup_and_quit([scene_root], 1)`），TS 侧 `:205` 同时拼 stderr。

### Important

**I-A. batch/edit_node/remove_node 的 TS 失败呈现丢弃 stderr——GD 侧全部错误详情不可见**【主 agent 对抗核实 CONFIRMED；security Info-2 同源】
- `src\tools\scene\index.ts:364/:411/:442` 三处 `errorResult(...):\n${result.stdout}` 只拼 stdout；GD 的 `log_error` 全走 stderr（spawn-helper 分离收集）。"Node not found"、per-node 失败清单（gd :767-768）全部不可见——本批「per-node 清单上报」在 headless 路径未真正到达用户。
- 同文件 `:203`（add_node fallback）与 `:272`（create_scene）均正确拼了 stderr——三处是遗漏非惯例。
- 佐证：`test\scene-validation-concurrency.test.js:162-178` 的 mock 把 "Node not found" 放在 **stdout**（`stderr: ''`）——mock 形态与真实 GD 输出通道漂移，测试锚定了理想化行为。
- 修法：三处补拼 `${result.stderr ? '\n' + result.stderr : ''}`（照抄 :203 模式）。remove_node 是本批全新接线、batch/edit_node 是本批大改路径，属本批改动面。

**I-B. send_drag 响应体的 relative/speed 为裸 Vector2，JSON.stringify 退化为字符串——本批引入的对外契约退化**【主 agent 真机探针 CONFIRMED】
- `src\scripts\mcp_bridge.gd:1784`：`return {..., "relative": relative, "speed": speed}`，relative/speed 是 Vector2；分发出口 `:1032` `JSON.stringify` 无 `_jsonify` 递归。真机实测输出 `"relative":"(100.0, 50.0)"` 字符串。旧版 Array 输出 `[100, 50]` 可结构化消费——本批归一后回显退化为不可解析字符串。
- 失败场景：AI 调 send_drag 后读响应自检 → JSON path 断言失败或误判。
- 修法：`"relative": _jsonify(relative), "speed": _jsonify(speed)`（一行，对齐 :1823 先例）。

**I-C. `_vec2_from_param` 元素级类型守卫缺失——嵌套容器/null 仍 SCRIPT ERROR，重现本批要根治的 bridge 卡死形态**【security 真机实证】
- `src\scripts\mcp_bridge.gd:1760-1767`（+ 同函数上游 :1771-1772 的 x/y、:1731 本批新增的 button_mask）。
- 真机实测（4.7 stable）：`float([1,2])`、`float({"x":1})`、`float(null)`、`int({"a":1})` 全部 `SCRIPT ERROR: Nonexistent constructor`。传 `relative: [[1,2],[3,4]]` / `{"x": null}` / `button_mask: {"a":1}` → 同步分发层无异常隔离 → 响应不发 → TS 超时 → Debugger Break 冻结——正是本批 send_drag 修复自述要根治的形态：顶层形态修了，元素级没修。
- **修正上轮审查 A6 错误结论**：「float() 对 null 安全转换不崩」实测不成立（null 会崩），上轮报告该句需作废。
- 修法（~20 行）：`_num()` 白名单守卫（`is int or is float or (is String and is_valid_float())`，对齐 :2733 `_compare_values` / :1695 `_is_valid_touch_index` 先例），覆盖 `_vec2_from_param` 两分支、send_drag x/y、button_mask。
- 定级说明：security 定 Medium、bridge 定 Minor；合并后升 Important——真机实证 + 本批修复主题的完整性缺口 + 后果为 bridge 会话堵死需重启游戏。

**I-D. 三处同语义白名单拒绝仍抛原生 Error——两条链路重新产生 746eb61 刚修掉的误导形态**【主 agent 对抗核实 CONFIRMED】
- `src\core\overrides.ts:41-45`（assertSourceAllowed）/ `:54-58`（assertProjectAllowed）/ `src\helpers.ts:110-116`（requireProjectPath）。
- 链 a（install_override）：越权 → 原生 Error（含绝对路径）→ `game-bridge.ts:497-499` catch 用 `getErrorMessage(err)` 直拼外传——同时违反结构化目标与 P2-17（绝对路径回显）。
- 链 b（screenshot capture，最常用 action）：`project_path` 越权 → `requireProjectPath` → 原生 Error → classifyError 兜底 `Internal error`（INTERNAL）——同工具行为分裂：`output_path` 越权有 PATH_NOT_ALLOWED + 修复指引，`project_path` 越权是笼统 INTERNAL，反馈 2026-08-19 描述的误导原样重现。
- pre-existing 边界遗漏，属「白名单拒绝结构化收口」主题完整性欠账，建议下批收口并留档（requireProjectPath 是全仓共享 helper，影响面大可理解分批）。

**I-E. NIT-2 处置是「复刻判定摘要」而非共享函数，且无回归测试锁定**【ts-reviewer + test-analyzer mutation 实测】
- `src\tools\screenshot.ts:22-23` 本地复刻分支逻辑，与判定侧 `path-utils.ts:249-276` 残余差异：判定侧 cwd fallback 走 `normalize(safeRealPath(...))` 归一化、提示侧裸 `process.cwd()`；判定侧 realpath 失败的 allowlist 条目被跳过永不放行、提示侧无差别列出（残余误导窗口）。
- mutation 实测：把 roots 改回无条件 cwd，`screenshot-analyze-path-leak.test.ts` **4/4 仍绿**——NIT-2 处置零锚定。
- 修法：path-utils 导出 `describeAllowedRoots(): string`（内部走同一归一化链），screenshot.ts 调用；补「allowlist 非空时消息不含 cwd」红测。上轮 memory 教训 2「指引必须与判定函数同源生成」防的正是这个结构。

**I-F. GD 侧五项修复零自动化锚定——「修复未验证即失效」坑已踩两次，第三次无护栏**【test-analyzer】
- 零测试锚定：`_vec2_from_param`（崩溃级）、batch 失败计数三形态、NIT-1 处置（`_exit_with` 在 test/ 零命中）、NIT-2（mutation 实证）、NIT-5（edit_node :572）、button_mask。
- `check:gdscript` 编译层抓不到运行时类型错（`var x: Array = params.get(...)` 编译通过运行时崩）——这正是 send_drag 事故与 I-C 的共同盲区。
- 真机 e2e 基建已存在（`test\scene-uid-preserve.test.ts:52-84` 的 GODOT_PATH skipIf 模式，单例 291ms），CHANGELOG 声称的「真机十项验证」一项没沉淀。TS mock 层接线测试则全部为真红测（mutation 四组实测全红）。
- 建议：仿该模式补 3 件——batch 失败注入 → exit 1 + 清单 + 场景不变；remove_node 真机落盘 + root 拒绝；NIT-2 roots 同源负向断言。

### Minor（择要，全文见各子报告）

1. **部分失败「已落盘 + exit 1」无提示**（gd :758-776 batch / :591-609 edit_node）：成功节点已写盘 + exit 1，TS 笼统 error 不区分——AI 整批重试 → 重复节点（add_node 无同级重名检测是 defects.md 已知 OPEN）。修法：错误消息注明 `added N/M persisted`。
2. **installOverride TOCTOU**（overrides.ts:108 扫描内容 ≠ :137/:148 copyFileSync 落盘内容）：毫秒级窗口内换文件则未扫描内容成为 autoload。修法一行：`writeFileSync(entry.destScriptPath, srcContent)`（扫描即落盘原子化，顺带消灭 copyFileSync 语义）。
3. **内容比对 utf-8 解码相等 vs 字节拷贝不对称**（overrides.ts:130-133）：GBK 等非 UTF-8 源两份字节不同可解码出相同 U+FFFD → 漂移静默漏检。修法：Buffer.equals 比对。
4. **take_screenshot 段检查 `substr(8)` off-by-one**（mcp_bridge.gd:1835，"user://" 是 7 字符）：实测五形态无实际逃逸（`..` 段仍拒 + 引擎 user 目录沙箱兜底），pre-existing，本批豁免后成唯一路径防线，建议顺手 `substr(7)`。
5. **node_name 黑名单不拦换行/tab**（scene/index.ts:349 黑名单制 + gd :713 原样保留控制字符）：stdout 展示层注入（伪造 `[ERROR]`/成功行）。判定层安全（exitCode 不可由 stdout 驱动，`_requested_exit_code` 唯一写点在 `_exit_with`）。修法：黑名单补 `\r\n\t`。
6. **路径规范化三个集群不同构**：edit_node/remove_node 剥 `/root/`+根名前缀；add_node/batch 的 parent 只特判整体 `root`/裸根名——同一输入 `"/root/Foo"` 两路径行为分叉。留档统一方向：四操作共用一段规范化函数。
7. **死 op 退出码缺口**（gd :923-931 export_mesh_library / :1107-1147 resave_resources）：失败落 exit 0，但 grep 确认无 TS 调用方（用户不可达），建议删死 op 或顺手补登记。
8. **TS blocked 警告分支死代码 + BLOCKED_PROPS 两端清单漂移**（index.ts:413-416/:375-378 不可达；TS 独有 parent/children/tree，GD 独有 4 项）。
9. **timeline 深预检不含 drag 的 relative/speed 键名**（gd :2675-2684）：拼错键登记期不拒、注入期静默 fallback (0,0) → E2E 假绿。
10. **归一 fallback 静默无警示**（gd :1776-1777）：`{"speed":"fast"}` 静默零速 success:true，回显归一后值无法区分「用户传 0」与「形态错归零」。
11. **录制链路不记 button_mask**（gd :2792-2793 / recording.ts:359-365）：「按住拖动」录制回放丢按键态——与本批新增 button_mask 注入能力不对称（pre-existing 显性化）。
12. **safeMessage 携带 allowlist 绝对路径与 tool-errors.ts:31 PII 护栏文档契约冲突**：本地单用户可接受（client=配置者本人），多用户部署需回收。
13. 风格：`screenshot.ts:18-27` 函数定义夹在 import 之间；add_node 用 `cleanup_and_quit` 而 batch 手写 `free()+_exit_with` 语义等价但不同构；installOverrides 返回类型擦除 updated 标记。

### 流程发现

**F-1. flaky 测试真实存在（4 次观测 3 次失败、失败集各异、单跑均绿）**
- 全量 #1：1 failed（ui-layout-integration）；#2：5 failed（remove_node 相关 × 5，跨 scene-operations-mock 与 scene-validation-concurrency 两文件）；#3：6155 passed 全绿。security reviewer 另观测 1 次 overrides 漂移首跑失败。失败测试单跑/组合跑均全绿。
- 非本批确定性回归（本批 diff 与 ui-layout 无交集；remove_node 测试单跑稳定），但 CI 可靠性风险真实——建议立项治理（单 worker 复现矩阵 / retry 策略 / 隔离污染源）。注意 `npx vitest run 2>&1 | tail` 管道会吞真实退出码（本次 exit 0 实为 1 failed）。

---

## 积极观察

- 上轮 6 NIT 处置全部落地且质量合格；NIT-4 双读消除顺带缩小 TOCTOU 窗口。
- remove_node 迁移是**净安全增益**：旧链 escapeForGdLiteral 字符串拼接（转义面）→ 新链 JSON.stringify 作 argv 直传 spawn（无 shell）。
- validateBridgePath 豁免面精确闭合（`key==='path' && method==='take_screenshot'`），全部调用点核查无遗漏拦截面、无误放；qa runner 不传 method 与旧行为逐字节一致。
- button_mask 与 Godot MOUSE_BUTTON_MASK_* 常量精确一致，默认 0 零回归；capability-matrix 与源逐字同步。
- TS mock 层新增测试全部为真红测（test-analyzer mutation 四组实测），take_screenshot 三向含防偷懒实现向。
- `_exit_with` 机制三态自洽，退出码欺骗不成立（唯一写点 + stdout 无法驱动 exitCode）。

## 处置建议（按优先级）

1. **本批顺手清偿（小改动、直接堵住下一轮反馈确定来源）**：C-1（~15 行）+ I-A（3 行）+ I-B（1 行）+ I-C（~20 行）——四项合计约 40 行，全部对齐既有先例。
2. **下批收口并留档**：I-D（requireProjectPath 影响面大可分批）、I-E（describeAllowedRoots 共享函数 + 红测）、I-F 三件真机 e2e 沉淀、Minor-1/2/3。
3. **立项治理**：F-1 flaky。
4. **文档修正**：上轮报告 A6「float() 对 null 安全」结论作废；「check:gdscript 抓不到运行时类型错」建议写入 `.claude\rules\godot-mcp-engine-quirks.md`。

## 审查方式与凭证

- 5 维度并行子代理：headless-reviewer（godot_operations.gd 全文 1-1274 + scene/index.ts 全文）/ bridge-reviewer（game-bridge.ts 全文 + mcp_bridge.gd 关键段）/ ecc:typescript-reviewer（diff + tsc + eslint 实跑）/ ecc:security-reviewer（全 16 文件 diff + 真机探针 3 轮）/ ecc:pr-test-analyzer（mutation 红测实测四组）。
- 主 agent：构建矩阵实跑（上表）+ 8b10489 增量 diff 独立审查 + C-1/I-A/I-B/I-D 对抗核实（含 JSON.stringify(Vector2) 真机探针）+ 全量三跑 flaky 观测。
