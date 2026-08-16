# 第三方审查:布局保真闭环 spec(2026-08-16)

- 审查对象:`D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\superpowers\specs\2026-08-16-ui-layout-fidelity-design.md`(v1)
- 审查者:code-reviewer 子代理(独立视角,所有声明 grep/read 实测)
- 判定:**BLOCKING ISSUES**(4 Blocking + 3 Nits)→ **spec 已修订为 v2,逐项处置见文末**
- 复核:除标注外,审查给出的 file:line 均经派发方抽查(`gdscript-executor.ts:1117-1122` full-class 分支已亲自 Read 核实)

## 审查报告原文

### 逐维度结论

**A. 对现有代码的声明:5/5 属实**
- A1 属实:`src/tools/ui/ui-layout.ts:268-275` justifyMap 确为 space-between→0、space-around/space-evenly→1。
- A2 属实:`src/tools/ui/types.ts:8-19` 为 ACTIONS;`:89-97` UiNodeSpec 无 rect/position/size。
- A3 属实:`src/scripts/screenshot_capture.gd:60` `process_frame.connect(_on_process_frame)`。
- A4 属实:`src/tools/ui/ui-layout.ts:436-451` 有 `_margin_${idx}` 包装注入先例。
- A5 属实:`src/tools/runtime-assert.ts:13` `import { sendToBridge } from './game-bridge.js'`。

**B. 技术假设:3 处不成立/缺口**
1. **执行链路矛盾(实测确认)**:仓库 headless 实有三条链路——screenshot 链(`src/screenshot.ts:131-253` 自行 spawn、位置参数、PNG+stdout 判定,无随机 marker/并发槽/审计);executor 链(ui 工具族所有 action 统一走 `src/tools/ui/index.ts:420` `executeGdscriptTrusted`,marker JSON 协议+随机 marker 防伪造+并发槽,但 `gdscript-executor.ts:854-869` wrapSnippet 在 `_initialize` 末尾同步 print marker+quit(0),等不了帧);opsScript 链(`src/tools/scene/index.ts:260`)。"bundled ui_measure.gd 仿 screenshot 模式"隐含第一条链,与 ui 工具族现有第二条链在参数传递、输出协议、安全设施上全部冲突,spec 未做选型。
2. **space-around 配比数学错误**:CSS around 为 2N 个半格(边距=free/2N、间距=free/N);spec 的 N+1 个 0.5-ratio spacer 得边距=free/(N+1)、间距=2free/(N+1),仅 N=1 时相等。验收标准 2 在当前方案下不成立。
3. **Container 父重排陷阱未提**:仓库自身已记录(`.claude/rules/godot-mcp-engine-quirks.md:53` Control position 受父 Container 布局影响)。BoxContainer 排版强制覆盖子 Control 的 offsets,rect 节点挂在容器父下会被重排。可用"rect 父必须非 Container"规避,但 CSS position:absolute-in-flex 是高频写法,spec 必须显式定规则,否则 rect 静默失效。

锚点求解本身数学成立;`set_anchors_preset` 不改 offset 的陷阱(engine-quirks:56)与显式写 anchors+offsets 方案不冲突。persist 模式有先例(`src/tools/scene/scene-commit.ts:207-209` pack+tmp+rename 原子写),`_initialize` 同步 build 后 pack 保存的是属性而非排版结果,时机可行。

**C. 仓库约束改动面:漏列**。spec 无"改动面"章节,登记点未提:`src/tools/ui/index.ts` inputSchema+handler case+TOOL_META actionRisks(:447-457,satisfies 强制)、`src/core/module-loader.ts:226` descHint、`npm run build-matrix`、`npm run check:budget`、`.claude/rules/godot-mcp-ui.md` 与 `src/tools/rule-templates.ts:380` 双副本+版本 bump。

**D. 测试质量**:验收 1/3 可测;验收 2 无可计算判定式;§5 缺 justify 语义集成数值断言(快照测不出 around 配比错)、缺 ui_measure 负向用例。

### Blocking Issues

- **B-1 执行链路未选型**(spec §3.1)。
- **B-2 space-around 配比错误**(spec §3.3)。
- **B-3 rect 节点父约束缺失**(spec §3.2)。
- **B-4 改动面漏列**。

### Nits

- N-1 wrap(FlowContainer)下 justify 仍被忽略的现状未说明是否维持。
- N-2 persist 未声明复用原子写模式与 pack 序列化语义。
- N-3 验收 2 缺可计算判定式。

### 值得进 memory 的工程教训

1. spec 引"先例"必须连 TS 侧执行链路一起引:"仿 X 的 .gd 模式"若不含 spawn/协议/安全设施,就是隐含错误的基础设施假设。
2. CSS space-* → Godot spacer 配比要按 CSS 规范推导(around=2N 半格),凭直觉 N+1 会错(数值可验:N=2 时 free/3≠free/4)。

## v2 处置对照(派发方修订)

| Issue | 处置 | spec v2 落位 |
|-------|------|--------------|
| B-1 | 已修:选型 executor 链(`executeGdscriptTrusted`),full-class SceneTree 脚本 + process_frame.connect 回调等帧(保留 marker 防伪造/并发槽);派发方已 Read 核实 `gdscript-executor.ts:1117-1122` | §3.1"执行链路(v2 B-1 选型)" |
| B-2 | 已修:space-around 改为每元素前后各 0.5(共 2N 个)+ 集成数值断言 | §3.3、§5 |
| B-3 | 已修:rect 父必须非 Container,违反 warning+跳过;同步 rule 双副本 | §3.2"父节点约束(v2 B-3)"、§7 |
| B-4 | 已修:新增改动面清单 8 登记点 | §7 |
| N-1 | 已文档化:wrap 下 justify 维持忽略 | §3.3 |
| N-2 | 已声明:复用 scene-commit 原子写 + pack 属性语义(验收 3 相应措辞) | §3.4 |
| N-3 | 已补判定式 | 验收标准 2、§5 |

**结论:v2 已消解全部 Blocking;审查发现的 2 条工程教训已登 memory(见下)。**

## 复核(同审查者,v2)

**判定:PASS**——B-1 选型依据二次核实(injectHelpers 只注入 `_mcp_done` 定义不追加调用,随机 marker 由 `gdscript-executor.ts:1139-1140` replaceAll 替换,等帧后手动输出可解析);B-2"2N 个 0.5"数学验算正确;B-3/B-4/N-1~N-3 忠实落实。

复核附 3 个非阻塞瑕疵,已即时修复(N-a:v1 原方案误引,改回"N+1 个 0.5"原文;N-b:check:gdscript 登记点不适用改为集成测试覆盖说明;N-c:§5 重复标题删除)。

## memory 登记

- `spec-precedent-must-include-execution-chain`(教训 1)
- `css-space-around-2n-half-slots`(教训 2)
