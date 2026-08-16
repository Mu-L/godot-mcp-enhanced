# 布局保真闭环(Layout Fidelity Loop)设计文档

- 日期:2026-08-16
- 状态:**v2(已按第三方审查修订,待用户确认进 writing-plans)**
- 修订记录:v2 修复审查 B-1~B-4(执行链路选型/space-around 配比/rect 父约束/改动面清单)+ N-1~N-3;审查报告见 `docs/reviews/2026-08-16-ui-layout-fidelity-spec.md`
- 来源:2026-08-16 布局保真调研(用户拍板方案①立项)
- 版本目标:v0.31 主菜
- 调研依据:`D:\workspace\Obsidian\godot-mcp-enhanced\开发日志\2026-08-16 布局保真调研-Figma与Pascal设计软件MCP参考.md`

## 1. 问题与目标

**问题**:不开编辑器用 AI 开发时,UI 布局与原型偏差大,多次调教仍不收敛。

**第一性根因**(调研结论,A-F 六条):AI 拿不到任何节点最终的 computed 矩形——每次调整都是概率重猜,不是数值收敛过程。翻译语义有损(`src/tools/ui/ui-layout.ts:268-279` 等)是偏差来源,无反馈闭环是不收敛来源。

**目标**:把布局调教从"盲调"变成"测量驱动的数值收敛"——AI 每轮拿到逐节点 Δx/Δy/Δw/Δh 数字,按数字修正,直到容差内。

**验收标准**:
1. 给定目标 rect 的 spec,通过 build→measure→verify 闭环,全部节点 |Δ| ≤ 2px(容差可配);
2. `space-between/space-around/space-evenly` 布局语义正确实现(不再静默近似),判定式可计算:between = 首尾子节点贴容器边 + 相邻间距方差为 0;around = 边距恰为相邻间距之半;evenly = 全部相邻间距(含首尾)相等;
3. `persist` 后 .tscn 重新加载,measure 结果与持久化前一致(anchors/offsets/separation 等属性重载后容器重排结果一致)。

**明确排除**(defer):视觉像素 diff(方案③)、Figma 导入(方案②)、editor 层改动。

## 2. 借鉴来源

| 来源 | 借什么 |
|------|--------|
| Figma 官方 MCP | 结构化几何真值哲学:每节点给 absoluteBoundingBox + 约束语义,不给猜测;视觉基准为辅 |
| Pascal (pascalorg/editor) MCP | `measure` 独立测量工具 + `verify_scene` 结构化问题清单 + 校验闭环 |
| Builder.io Figma-Context-MCP | 喂模型前先简化翻译(auto-layout→容器心智模型,非流节点才 absolute) |

## 3. 架构设计

三层架构不变,全部落在 **Headless CLI 层**(测量不需要 GPU、不需要 editor/bridge)。

### 3.1 `ui_measure_layout`(新 action,ui 工具族)

**做什么**:加载场景 → 等布局稳定 → 整树输出每个 Control 的 computed 几何。

- **执行链路(v2 B-1 选型)**:走 ui 工具族现有 `executeGdscriptTrusted` executor 链,**不**仿 screenshot 的独立 spawn 链(`src/screenshot.ts:131-253` 无 marker 防伪造/并发槽,安全设施降级)。技术依据:`src/gdscript-executor.ts:1117-1122` 对 full-class `extends SceneTree` 脚本走 `injectHelpers` 而非 wrapSnippet,**不会**被追加同步 `_mcp_done()`——脚本可自行等帧后输出。因此 `ui_measure_layout` 生成 full-class SceneTree 脚本(同 SCENE_TREE_HEADER 风格),`_initialize()` 内加载场景后 `process_frame.connect(_on_frame)` 回调计数等帧(仿 `src/scripts/screenshot_capture.gd:60` 的连接模式,已验证先例;不用 `await` 以规避引擎回调协程语义风险),稳定后收集 rect → `_mcp_done()` 输出 → `quit(0)`。
- 参数(scene_path/node_path/depth)内嵌生成进脚本,不走命令行;`expect_tree` **不进 GD**,GD 只回传全树几何,diff 由 TS 侧做。
- 布局稳定判定:连续 2 帧 rect 快照不变即稳定;上限 5 帧 + 超时放弃(防死等)。
- 每节点输出:`{path, type, global_rect{x,y,w,h}, anchors{4}, offsets{4}, visible, text?}`(text 限 Label/Button/LineEdit 等文本控件,供 AI 对照原型文案)。
- 可选参数 `expect_tree`:同 `UiNodeSpec`(含 §3.2 新增 rect 字段);提供时输出直接带逐节点 diff(TS 侧做,不再跑第二次 Godot)。
- 原理依据:Container 布局计算不依赖 GPU 渲染,headless 下 `get_global_rect()` 照常可用(与 screenshot 空白问题的本质区别,调研根因 D)。

### 3.2 `ui_build_layout` absolute 模式(增强)

**做什么**:UiNodeSpec 支持"绝对几何"节点,并对整棵容器树支持目标 rect。

- `UiNodeSpec` 新字段(`src/tools/ui/types.ts`):
  - `rect?: {x, y, w, h}` —— 相对**父节点**左上角的矩形;
  - 无 `layout` 字段的节点:rect 生效路径 = 锚点求解(见下);
  - 有 `layout` 字段的容器:rect 作为**目标尺寸**(容器语义不变,verify 时对照)。
- **锚点求解**(TS 纯函数,核心算法):给定父 rect 与子 rect,按 Figma constraints→Godot anchors 同构映射反解:
  - `anchor = (child_edge - parent_edge) / parent_size`(比例锚点),offsets 取整;
  - 特例:中心元素 → center 锚点 + 偏移;贴边元素 → 离散锚点预设(16 种中匹配);
  - 求解器输出同时写入 `anchors+offsets`,保证不同窗口尺寸下相对布局保真(不只像素平移)。
  - 注意:显式写 anchors+offsets 四值,不用 `set_anchors_preset`(它不重置 offsets,引擎陷阱已记录于 `.claude/rules/godot-mcp-engine-quirks.md`)。
- **父节点约束(v2 B-3)**:rect 仅对**父为非 Container 的 Control**(普通 Control/Panel/TextureRect 等)生效——BoxContainer 等容器父会强制重排子 Control 的 offsets(仓库引擎陷阱记录:Control position 受父 Container 布局影响)。生成器强制校验:无 `layout` 字段且带 rect 的节点,若父为 Container → 发 warning 并**跳过 rect 赋值**(不静默失效);该规则同步进 rule 文件(§7 改动面)。需要"容器内绝对定位"的场景,文档引导用容器外的兄弟节点或 CenterContainer/Marker 组合,不在本期支持 CSS `position:absolute`-in-flex 等价物。
- 生成脚本路径不变(SCENE_TREE_HEADER 生成式),仅新增 rect 赋值行。

### 3.3 justify 有损映射修复(P0 快赢,先行单独提交)

现状:`space-between→BEGIN(0)`、`space-around/space-evenly→CENTER(1)` 语义丢失(`src/tools/ui/ui-layout.ts:268-279`)。

方案:**spacer 注入**(推荐)——
- `space-between`:children 之间插 N-1 个 `SIZE_EXPAND` spacer(`_spacer_N` 节点,复用 `_margin_N` 包装先例 `src/tools/ui/ui-layout.ts:436-451` 的注入模式);
- `space-evenly`:children 前后 + 之间共 N+1 个等比 expand spacer;
- `space-around`:**每元素前后各 0.5 比例 spacer(共 2N 个)**(v2 B-2 修正——CSS 规范 around = 2N 个半格:边距 = free/2N、间距 = free/N;v1 原方案"N+1 个 0.5 比例 spacer"得边距 = free/(N+1)、间距 = 2free/(N+1),N≥2 时配比错误,数值可验:N=2 时 free/3 ≠ free/4);
- 注入节点计入 warnings 输出(AI 可见树结构变化);
- `wrap`(FlowContainer)下 justify 维持现状忽略(FlowContainer 无 alignment,`src/tools/ui/ui-layout.ts:264-266`),warning 继续提示(N-1 文档化,不扩 scope)。
- 备选(拒绝):改用 `MarginContainer+alignment` 组合无法覆盖三语义;显式报错会破坏既有调用方。

### 3.4 持久化(`persist` 参数)

- `ui_build_layout` 增 `persist?: boolean`(默认 `false`,非 BREAKING):脚本末尾对加载的场景实例 `save_scene`。
- **写盘语义(v2 N-2)**:复用 `src/tools/scene/scene-commit.ts:207-209` 的 pack→tmp→rename 原子写模式;pack 序列化的是**属性**(anchors/offsets/separation/custom_minimum_size)而非排版结果,重载后容器按属性重排——因此验收 3 用"重载后 measure 一致"而非字节级 .tscn 一致。
- 解决根因 E:调教闭环完成后一次 persist,不再要求 AI 另走 add_node/save_scene 手工重建。

### 3.5 收敛编排(不新增运行时)

闭环由 AI 在工具调用层完成(每步都是已有/新增的 headless 工具):

```
ui_build_layout(spec 含目标 rect)
  → ui_measure_layout(expect_tree=spec)   # 一次调用返回几何+逐节点 diff
  → AI 按 Δ 数字修正 spec(gap/padding/rect/size_flags)
  → 重复直到 diff 全绿
  → ui_build_layout(persist=true)
```

不建独立 `layout_refine_loop` 运行时(简约:YAGNI,measure 的 diff 输出已把修正所需数字全给到;后续若高频迭代再考虑进 dev_loop acceptance)。

## 4. 数据流示例(measure 输出形态)

```json
{
  "stable_after_frames": 2,
  "viewport": "1280x720",
  "nodes": [
    {"path": "MainMenu", "type": "VBoxContainer", "global_rect": {"x": 0, "y": 0, "w": 1280, "h": 720}, "anchors": {...}, "offsets": {...}},
    {"path": "MainMenu/Title", "type": "Label", "global_rect": {"x": 490, "y": 40, "w": 300, "h": 48}, "text": "游戏标题"}
  ],
  "diff": [
    {"path": "MainMenu/Title", "target": {"x": 490, "y": 24, "w": 300, "h": 48}, "actual": {"x": 490, "y": 40, "w": 300, "h": 48}, "delta": {"dx": 0, "dy": 16, "dw": 0, "dh": 0}, "ok": false}
  ],
  "overlaps": [], "out_of_bounds": []
}
```

重叠检测(兄弟 rect 相交且无容器语义)与越界检测(子超出父 rect)由 TS 侧从 measure 数据推导(Pascal `verify_scene` 模式)。

## 5. 测试策略

- **单元(TS)**:锚点求解纯函数——fast-check 属性测试:随机父/子 rect → 反解 → 前向重放计算,误差 ≤ 1px;justify spacer 注入的 GD 生成快照;diff/重叠/越界推导函数(含负向用例:不误报)。
- **justify 语义数值断言(v2 B-2/N-3,快照测不出配比错误,必须跑真布局)**:fixture 项目 + GODOT_PATH 集成,HBox 三按钮分别设 between/around/evenly,断言:between 首尾贴边 + 相邻间距方差 0;around 边距 = 间距/2;evenly 全间距(含首尾)相等。
- **集成(GODOT_PATH)**:fixture 项目建 VBox 三按钮场景 → 跑 `ui_measure_layout` → 断言 rect 顺序/间距数值;headless 与窗口模式结果一致性。
- **负向用例**:`ui_measure_layout` 场景不存在 / node_path 无效 / 等帧超时路径;rect 节点父为 Container 时 warning + 跳过(不静默)。
- **回归**:现有 `test/ui-tools.test.js` 全绿;`npm run build` 同步(若新增 bundled .gd——v2 选型后 measure 走生成式脚本,无新增 bundled 文件,此条保留给 P0 无关项核验)。
- **风险标注**:Label 等 font-metric 依赖尺寸在 headless 的可用性需集成测试实测(布局计算预期可用,但须证据,不假设)。

## 6. 实施切分

| 批次 | 内容 | 预估 |
|------|------|------|
| P0 快赢 | justify spacer 注入修复(§3.3)+ 测试 | ~0.5d |
| P1 | `ui_measure_layout`(§3.1)+ 集成测试 | ~2-3d |
| P2 | absolute 模式 + 锚点求解(§3.2)+ 属性测试 | ~3-5d |
| P3 | diff/重叠/越界(§3.1 expect_tree)+ persist(§3.4) | ~3d |

每批次独立可交付(P0/P1 不依赖 P2)。按仓库流程:每批 spec→plan→实现→验证→第三方审查文档(`docs/reviews/`)+ memory 登记。

## 7. 改动面清单(v2 B-4 补,实施时逐项核销)

按 AGENTS.md 仓库级约束,本 feature 需动的登记点(不止 spec 功能代码):

| 登记点 | 文件 | 内容 |
|--------|------|------|
| ui 工具注册 | `src/tools/ui/index.ts` | inputSchema 新参数(rect/persist/expect_tree/max_depth)+ handler 新 case(`ui_measure_layout`)+ `TOOL_META` actionRisks(satisfies 强制,含新 action 只读风险声明) |
| UiNodeSpec 类型 | `src/tools/ui/types.ts` | ACTIONS 追加 `ui_measure_layout`;UiNodeSpec 增 rect 字段 |
| 工具组登记 | `src/core/module-loader.ts:226` 附近 | descHint 同步新 action |
| capability-matrix | `npm run build-matrix` 重建 | 工具清单变更强制(AGENTS.md) |
| token 预算 | `npm run check:budget` | 新参数描述增量核验 |
| 规则双副本 | `.claude/rules/godot-mcp-ui.md` + `src/tools/rule-templates.ts`(:380 附近 UI 段) | rect 父约束/warning 行为/measure 用法,**两处同步改** + `npm version patch --no-git-tag-version`(check-rules-version-bump 拦截) |
| GDScript 校验 | (本 feature 无 bundled .gd 变更) | `check:gdscript` 只编译 fixture 静态 .gd,核验不了运行时生成的脚本;生成脚本的正确性由 §5 集成测试真跑覆盖 |
| 完成门禁 | `npm run lint` + `npm run build` + `npm test` | 每批次提交前 |

## 8. 开放问题(实现前需确认)

1. ~~`ui_measure_layout` 放 ui 工具族还是 analysis 工具族~~ → **已定:ui 工具族**(v2 改动面清单,ACTIONS 追加,`src/tools/ui/types.ts:8-19`)。
2. 锚点求解的输出形态:比例锚点(浮点)vs 离散预设+偏移的优先级——倾向"预设优先、比例兜底"(可读性)。
3. headless font-metric 可用性(§5 风险标注)若不成立,Label 尺寸测量 fallback 是否需要 `custom_minimum_size` 提示——留待 P1 实测后定。
