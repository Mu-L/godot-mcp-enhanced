# PR-1a(QA 断言四件套)最终全分支第三方审查

- **日期**:2026-08-17
- **审查对象**:`feat/qa-assert-batch` 分支 13 commits(722f74f..f118719)
- **审查者**:独立 code-reviewer 子 agent(隔离视角;全量 diff 逐段精读 + 最终态源文件行号实测 + `mcp_bridge.gd` GD 契约独立核对 + args-validator 注入面核对,不预设 plan 作者声明为真)
- **上游文档**:spec `docs/plans/2026-08-17-qa-deepening-spec.md`(含第三方审查处置记录)/ plan `docs/plans/2026-08-17-qa-deepening-pr1a-plan.md`
- **执行台账**:`.superpowers/sdd/progress.md`(qa-assert-batch 段;8 任务全过 task reviewer 门,2 轮 Important 修复)
- **限制声明**:审查环境无 Bash,未逐 commit diff;commit 序列核对基于全量 diff(最终态视角)+ progress 台账 + controller 全量测试三源交叉验证

## 总体判定

**SHIPPED WITH NITS** —— 0 Blocking / 3 Important(处置后可合并)/ Minor 8 项 triage(2 必修 2 建议顺手修 4 留)。

核心交付(4 控制步骤 + 4 断言 + runtime-assert 真实现 + 描述重构)设计正确、跨任务零裂缝、GD 契约核对吻合、测试抽查全部通过"删实现必红"判别;但存在 1 项白名单绕过(写面)安全问题与 2 项 spec 验收/测试策略缺口,合并前由 fixer 处置。

Controller 侧门禁证据(审查者未重跑):`npm run lint` 0 错、`npm run build` 通过、`npm test` 5586 passed/0 failed/34 skipped;e2e 全工具冒烟(真 Godot v4.6.3):75 passed/6 skipped/0 failed;matrix 重建,qa descBytes 773→407(schema 1487/total 1894),check:budget 0 error。

## 维度一:跨任务一致性 —— 通过,零裂缝

| 衔接点 | 证据 | 结论 |
|---|---|---|
| Task 1→6/7 解环 | `src/tools/game-fs.ts`(48 行,原样搬移)+ `runner.ts` re-export 保旧 import 路径兼容 | ✓ |
| Task 2→3 schema→runner | `spec.ts:82` assert enum 8 值、`:149` QA_STEP_TYPES +4;`runner.ts:368` execStep 六参签名、四控制步骤分支 | ✓ |
| Task 4/5 取数→断言 | `runner.ts` collectWatchEvents / collectMonitorSamples / execSignalAssert / execErrorsAssert / execMonitorAssert,RunState 贯穿 | ✓ |
| Task 6→7 导出→接线 | `runtime-assert.ts:286` export;`runner.ts` fn 表、args 字段白名单与 assertStep 新字段逐一吻合、project_path/evidence_path 注入 | ✓ |
| Task 7/8 evidence 回填 | runtime-assert pass/fail 第三参均落 details 并回显 evidence_path,与 runner PASSED(f118719 前为 PASSED,f118719 起 FAILED 同步)一致 | ✓ |
| Task 8 描述重构 | qa/index.ts description + schema 迁移,matrix 实测 descBytes 407 | ✓ |
| 中间态污染 | Task 4 fix(7a04da7)/Task 6 fix(a2fa09a)/f118719 均为后续 commit 收敛,最终态自洽 | ✓ 无残留 |

细节佐证:Task 4 修复的 Important①(空缓存 `[]` falsy 误判)在 collectWatchEvents 用 `!== null` 判缓存并有专项测试锁定;execMonitorAssert 的 `property` optional + 运行时守卫(注释说明 zod 未按 assert 值差异化必填的 TS strict 兼容处理)诚实且可行动。

## 维度二:仓库级约束独立核查(不对照 plan 改动面清单)

| 约束 | 独立核查结论 | 证据 |
|---|---|---|
| 双副本同步(rule-templates ↔ .claude/rules) | **不触发**。`rule-templates.ts:80` 与 `.claude/rules/godot-mcp-core.md:66` 同文(均描述 dev_loop 余弦入口)且本批两文件均未改;runtime-assert 无 qa 段。无需版本 bump | grep 实测 |
| capability-matrix | 完整。qa 407/1487/1894,f9fd61b/39642b7 两次重建,check:budget 0 error | matrix diff + controller 证据 |
| TOOL_META/actionRisks | runtime_assert 5 action(含 screenshot_diff)已声明,`risk-coverage.test.ts:38-50` 动态遍历所有工具所有 action,无新 action 不触发义务;qa 无新 action。**但 screenshot_diff 的 'read' 声明因 I-1 写面而名不副实,修 I-1 后恢复成立** | read 实测 |
| build:skills 产物 | skill-builder.ts 与 `.claude/skills/screenshot-verify/SKILL.md` 同步改且内容一致(字符串严格相等 DRY 断言 + 全量绿佐证);NOT_IMPLEMENTED 过时文案已清(a2fa09a) | read |
| 双白名单校验(reference/project_path) | 实现顺序正确:先过 `isPathInAllowedRoots` 再截图,无绕过 | `runtime-assert.ts:286` 起 |
| **evidence_path 写面** | **发现绕过,见 Important-1** | `runtime-assert.ts:341-347` |
| GDScript / CLI | 本批无 .gd 改动(check:gdscript 不适用);diff 无 `src/cli/` | diff 文件清单 |

## 维度三:GD 契约一致性(B-2 取数路径)—— 通过

- `watch.poll` 返回全量复制不清缓冲(`mcp_bridge.gd:1922-1933`,`duplicate(true)`,poll 后不 erase)——signal 断言多次 poll 不丢事件,实现假设正确;
- `monitor.poll` 非 active 时返回 `stopped_reason`(`:1713-1727`),与 collectMonitorSamples 补 stop 路径衔接;`monitor.stop` 对 auto-stopped 的全量返回含 node_lost 样本(`:1672-1690` I-03),判据"stopped_reason 或样本含 error → ERROR"吻合;
- `_jsonify` 键序固定(`:1237-1255`:Vector2→{x,y}、Color→{r,g,b,a} 字面序)——args_match 键序敏感实际影响降级(见 Minor②);
- threshold 语义"严格大于才计差"(`screenshot-detail.ts:55-56/:85`)与 schema 描述一致;染红图以参考图原色为底稿(`:58`)——与 Important-1 内容受控度相关。

## 维度四:测试质量抽查(接线零验证判别)—— 通过

抽 5 个关键新测试做"删实现是否红"推演,全部有效:B-2 signal 补 stop、套件外订阅拒绝、FAILED evidence 回填、同图 diff_ratio=0(退占位必红)、空缓存判据(回退 truthy 必红)。

弱点:s4/m5 仅断言 status(Minor③)、since_seq 传值不锁(Minor④)、单调四档仅 1/4 档覆盖(Important-3)。

## 维度五:spec §5 验收对照

| 条款 | 结论 |
|---|---|
| §5.1 lint/build/test + matrix + budget + descBytes<600 | **通过**(0 错/通过/5586 绿;407/1487/1894) |
| §5.2 含 4 新断言套件真 Godot 冒烟 + 人为破坏 FAILED | **未交付**(Important-2) |
| §5.3/§5.4 async/BUSY | PR-1b 范围,不适用 ✓ |
| §5.5 tasks wire + cancel audit | PR-2 范围,不适用 ✓ |
| §5.6 审查文档 + memory | 本文档即产出;memory 处置后由 Controller 登记 |
| §4 fast-check 属性测试 | **零交付**(Important-3) |

## Blocking Issues

无。

## Important Issues(合并前处置)

### I-1(安全/白名单绕过·写面)evidence_path 可从外部 MCP args 注入,任意路径写文件

- 链路(全实测):`src/core/args-validator.ts:5` 与 `:70` 明确"未知字段允许"(不 strip 不拒绝)→ `runtime-assert.ts:88` handleTool 原样透传 args → `:341` `const evidencePath = args.evidence_path as string | undefined`(schema 不暴露该字段,但外部调用者可传)→ `:344-347` `mkdirSync(dirname(evidencePath), {recursive:true}) + writeFileSync(evidencePath, PNG)` **无任何路径校验**。
- 内容受控度:染红图以参考图原色为底稿(`screenshot-detail.ts:58`),reference 在白名单内可由调用方自建任意 PNG,截图与参考接近时输出近似无损 → 相当于"把白名单内文件写到任意路径"的复制原语 + 任意建目录。
- 加重因素:screenshot_diff 声明 'read' 风险即无 confirm 门,agent 直调畅通;本仓"路径白名单 deny-by-default"是核心护城河定位(参照 2026-07-21 screenshot-analyze-path-leak 批次修读面泄漏的先例,本批引入同级写面)。
- 修复:evidence_path 存在时校验 `resolve(evidencePath)` 必须位于 `qaReportsDir()` 目录内(前缀比较),越界返 `{success:false, error_code:'INVALID_PATH'}`。**不可直接用 `isPathInAllowedRoots`**——qa-reports 在 `~/.godot-mcp/` 下不在项目白名单;qa runner 内部调用(`runner.ts:453` 拼的路径)天然满足前缀不受影响。同步更新 `:81` 风险注释(Nit-B)与测试(补注入拒绝用例)。

### I-2(验收缺口)spec §5.2 真 Godot 冒烟未交付

4 新断言与 B-2 取数路径仅有 mock 单测;`test/e2e-full-tool-verification.test.ts` 无 qa 用例(仅 game 工具 watch/monitor 原语级既有用例 `:874/:878`)。处置:合并前补 `GODOT_MCP_E2E_L2=1` 下含 4 新断言的小套件冒烟(PASSED + 至少一次人为破坏 FAILED 带 mismatch 证据);或用户显式裁定 defer 并登记为 PR-1b 硬前置。

### I-3(测试策略缺口)spec §4 fast-check 属性测试零交付

spec §4 明列"signal 计数区间、monitor 单调四档、min/max 越界首个样本定位";plan 未排任何 task 却在 Self-Review 声称"spec 覆盖无缺口"。实际风险:`execMonitorAssert` 单调判定是 every+findIndex 双段逻辑,手写用例仅覆盖 non_increasing 一档,其余三档写错(如 `>` 误为 `>=`)现有测试全绿。处置:补 fast-check 属性测试,或最低限度每档正反手写用例(约 6 个)。

## Minor triage(任务审查累积 8 项 + 本审查新增 3 项)

| # | 内容 | 判定 | 理由 |
|---|---|---|---|
| ① | QA_STEP_TYPES 无测试快照锁定 | 留 | zod discriminatedUnion 是权威源;间接锁定已够,快照属冗余 |
| ② | jsonEqual 键序敏感 | 留 | GD `_jsonify` 键序固定,按文档写法必匹配;建议 schema 注释注明 |
| ③ | s4/m5 只断言 status 未断言 detail | **建议顺手修** | 各补 1 行 |
| ④ | e1 未断言 get_errors 两次调用的 since_seq 值 | **必须修** | baseline 锚点是防假红核心:恒传 0 现测试全绿(游戏历史错误计入→假红) |
| ⑤ | diffPngBuffers catch 全归"尺寸不一致 FAILED" | **建议顺手修** | 坏图(非 PNG)也落 dimensions 分支,误导排错;按 message 含 'dimensions mismatch' 区分,否则 ASSERT_ERROR |
| ⑥ | 白名单拒绝用例未断言 sendToBridge 未被调用 | **必须修** | 锁"先校验后截图"顺序,防未来重排产生副作用 |
| ⑦ | qa-screenshot-diff-step.test.ts 窄 mock factory | 留 | 当前用例不触发;扩用例时改 importOriginal |
| ⑧ | PASSED/FAILED evidence 表达式 3 行重复 | 留 | 纯风格 |
| 新 A | monitor 空样本 vacuous PASS(monotonic + 0/1 样本 → every 空转 PASSED) | 留(记录) | spec 未定义此边界;后续加 min_samples 概念或文档注明 |
| 新 B | TOOL_META `:81` 注释过时("写临时文件到 user://"未反映本机写) | 随 I-1 修 | |
| 新 C | plan 自检与 spec §4 不符 | 留(流程教训) | 教训进 memory |

**triage 结论:必须修 ④⑥;建议顺手修 ③⑤;①②⑦⑧与新 A 可留。**

## 值得进 memory 的工程教训

1. **"内部参数 schema 不暴露"不是安全边界**:args-validator 未知字段允许(不 strip 不拒绝),handleTool 层从 args 直取的内部参数(如 evidence_path)对外部 MCP 调用完全可注入——schema 隐藏只是文档层约定。凡 args 直取路径做 IO 的,必须在函数体内独立校验。
2. **plan 自检"spec 覆盖无缺口"需逐条对 spec 测试策略清单打勾**:fast-check 这类"非功能主线"项最易被 plan 漏排,Self-Review 的覆盖声明本身要被 final review 复核。
3. **B-2 类"非 active 返回空"契约的 mock 极限**:单测 mock 只能验证 qa 侧分支逻辑,GD 侧真实行为需 L2 e2e 兜底——"mock 真实 shape≠真实契约"在本批再次适用;mock 契约假设恰好全部正确只能说明 spec F7 扎实,不能省略 e2e。

## 验证方式声明

本审查全部结论来自:全量 diff(235KB)逐段精读;最终态源文件 grep/read 实测行号(runner.ts/runtime-assert.ts/spec.ts/game-fs.ts/args-validator.ts/screenshot-detail.ts/skill-builder.ts/risk-coverage.test.ts/e2e-full-tool-verification.test.ts);GD 契约独立核对(`mcp_bridge.gd:1237-1255/1672-1727/1922-1933`);spec/plan/progress 台账交叉。未重跑 controller 已验证的门禁。

---

## 修复后记(2026-08-17,Controller 侧)

终审 3 Important + Minor ③④⑤⑥ 已全部处置(2 commits):
- `12ecc2e` fix(assert): evidence_path 前缀校验锁 qa-reports 目录内(I-1,含兄弟目录伪装防护与不写盘测试)+ 解码失败与尺寸不一致分流(Minor⑤)+ 白名单拒绝用例锁"先校验后截图"(Minor⑥)
- `24ddd2a` test(qa): monitor 单调四档正反 8 用例 + 首违规定位(I-3)+ e2e-qa-assert-batch L2 真 Godot 全链(I-2:monitor/signal/errors/screenshot_diff 四断言 PASSED + 破坏断言 FAILED 带 mismatch `≥ 99999`)+ since_seq 锚点断言(Minor④)+ s4/m5 detail 断言(Minor③)

修复后验证:`npm run lint` 0 错、`tsc --noEmit` 0 错、`npm test` **5598 passed / 0 failed / 35 skipped**(+12 用例对账吻合);e2e 新文件 `GODOT_MCP_E2E_L2=1`(Godot v4.6.3 真 bridge)1 passed。红绿验证:I-1/Minor⑤ stash 实验 3 红、I-3 mutation(`>`→`>=`)精确红、Minor④ 恒传 0 红。聚焦复审 PASS(7 项逐项落地,无新问题)。

**修复中新发现的清单外既有缺陷(登记 PR-1b 修复)**:真 bridge `get_node_properties` 返回嵌套 `{properties:{...}, node}` shape,`assertNodeState`(`runtime-assert.ts:148` 附近)按平铺 shape 取值 → node_state 断言在真 bridge 上 actual 恒 undefined(单测 mock 全平铺从未暴露,与 2026-08 v0.30 F-3 同模式)。本批未修(不改清单外代码),I-2 e2e 破坏断言已绕开该缺陷并在测试注释记录。

**遗留(留档不修)**:①`qaReportsDir()` 参与 evidence 前缀比较未 resolve 归一化——与 `readReport` 同款既有模式,默认路径不触发,后续统一收紧时两处一起改;②Minor ①②⑦⑧与新 A(monitor 空样本 vacuous PASS)按 triage 留档。

**判定升级:SHIPPED WITH NITS → 修复后收口(0 Blocking / 0 Important 未处置)。**

---

## push 前全面复审(2026-08-17,第二轮,独立复跑)

用户要求的 push 前最后一道门:全新审查者(带命令执行能力)对最终全量(16 commits,722f74f..b2c8777)完整视角复审,独立复跑门禁而非采信既往声明。完整报告:`.superpowers/sdd/pre-push-full-review-report.md`(本地)。

**总体判定:PUSH_READY(0 Blocking / 0 Important / 3 Nit)**

- **门禁七项独立复跑全绿**:lint 0 错 / tsc --noEmit 0 错 / npm test 5598 passed 0 failed / check:budget 0 error / diff-matrix no drift / `STRICT=1 check:rules-sync` 9 模板一致 / L2 e2e 真 Godot v4.6.3 复现 1 passed。
- **上轮 3 Important 完整视角复核全成立**:I-1 攻击者视角实测 13 种路径变体(`..` 逃逸/兄弟目录/大小写盘符/UNC/后缀点伪装等)全部 DENIED 无绕过,qa 内部不自伤根因双重确认(runId 经 sanitizeSuiteName 清理 + 校验兜底);I-2 e2e 四断言真链核对无误且独立复现;I-3 单调四档 mutation 推演证实精确锁定。
- **逐 commit 核对**:16 commits 全部 Conventional Commits、无大文件、无敏感信息、GDScript 与 `.claude/rules/` 零改动;skill 双副本同步一致;game-fs.ts 上移纯移动;清单外缺陷(assertNodeState 嵌套 shape)确实未动、PR-1b 登记在案。
- **新 3 Nit(不阻断,留档)**:①monotonic fail 用例 mismatch 未锁具体数值对(findIndex 段误改只影响报告质量);②evidence_path 尾斜杠变体 ALLOWED 但写目录 EISDIR 被吞(无实害);③小写盘符假拒绝(fail-safe 方向)。
- **上轮 6 项留档 Minor 复议全部维持**(新 A vacuous PASS 最值得修但属语义变更需 spec 定义,push 前抢改反违流程,归 PR-1b spec 补定义)。
