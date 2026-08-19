# 原型翻译层大迭代(StyleBox 通道 / 收敛闭环)设计文档

- 日期:2026-08-17
- 状态:**v4(经两轮独立第三方审查 + 实现期实测修订——Task 4 集成实测推翻 v3 三处声明,见 §11.3)**
- 审查记录:本会话内派 code-reviewer 子代理独立审查(判定 REVISE:1 Blocking + 8 Important + 10 Nit),随后设计者对审查意见逐条专业复核——**其中 5 处对审查意见本身再修正**(见 §11),全部消解后形成本文。
- 来源:用户立项「原型翻译层大迭代(StyleBox 通道/收敛闭环)」,四项收敛闭环含义全选 + 卡片三件套 + 三控件全盖 + 串行四批拆分(方案 A)
- 版本目标:v0.32.0 起(PR-1 为 minor bump,依据见 §9 版本策略)
- 前置:2026-08-16 原型翻译层已上线(`ui_import_prototype`,spec: `docs/superpowers/specs/2026-08-16-prototype-import-design.md`)

## 1. 问题与目标

上轮原型翻译层打通了「AI 写 HTML 原型 → 几何 JSON → 翻译 → build→measure→verify → persist」闭环,但有两块系统性缺口:

1. **视觉样式通道缺失**:proto JSON 的 `bg` 走 `modulate` 近似染色(`src/tools/ui/prototype-import.ts:278-280`,warning 声明缺陷:乘性叠加子树、与实际底色有偏差);border/radius 完全无通道;`valueToGd` 不支持 StyleBoxFlat 资源构造,仓库内零 StyleBox 相关代码(全仓 grep `StyleBoxFlat|theme_override_styleboxes|get_theme_stylebox` 0 命中)。
2. **视觉无数字收敛**:几何有 `layout_verify` 逐节点 Δx/Δy/Δw/Δh 数字驱动收敛,但样式(bg/圆角/边框)零反馈;flow 直接子节点丢 rect 完全不受几何 verify 覆盖(上轮 B-2 盲区);像素级验证只有粗粒度 screenshot diff(抗锯齿底噪、阈值宽松)。

**验收标准**:
1. **PR-1**:proto JSON 携带 `bg/fill/borderRadius/border` 的 fixture 一次 `ui_import_prototype` 调用,落盘 .tscn 含 StyleBoxFlat 子资源(非 modulate 行),Panel/ProgressBar(background+fill)/Button(normal)/Label(normal)四类槽位正确;`bg` 缺省但 border/borderRadius 存在时 `draw_center=false`(CSS 透明底语义);
2. **PR-2**:同一调用返回 `style_verify`(逐节点逐槽位逐属性 target/actual/delta)与 `flow_verify`(flow 直接子节点期望 rect vs 实测 global_rect)数字清单;未设上的 override 以「回落默认主题的数值 diff」暴露;
3. **PR-3**:`ui_pixel_verify` 对 bg 节点采样中心+四角内缩点,与目标色 RGB 距离判定,给出逐节点采样结果(Windows 窗口模式);
4. **PR-4**:`ui_import_prototype` 单 spawn 完成 build→persist→reload→measure(现两次 spawn ~6s),reload 绕过 ResourceCache 且「篡改磁盘后 reload 测出差异」断言通过。

**明确排除**:hover/pressed 交互态样式翻译(Button 只 override normal)、per-side border(CSS 四边不同时取 top+warning)、shadow/渐变背景、Figma 生产者、VLM 视觉断言工具化、editor 层改动。

## 2. 总体拆分(五块,串行四批)

| 块 | 内容 | 依赖 |
|---|---|---|
| ① StyleBox 通道 | bg 语义升级 StyleBoxFlat + 新字段 + 序列化基建 + 四控件槽位 + evaluate 模板扩展 | 无 |
| ② style_verify | measure 读回样式生效值与目标 diff | ① |
| ③ flow 子树 verify | flow 直接子节点期望 rect(视口绝对)vs 实测直接对比,消解 B-2 盲区 | 无 |
| ④ 像素采样验证 | capture → PNG decode → 节点 rect 采样 → 目标色比对 | ① |
| ⑤ 单进程优化 | build+persist→measure 合成单 spawn | ②③④ 稳定后(纯优化) |

PR-1=①;PR-2=②+③(同属 measure/verify 层);PR-3=④;PR-4=⑤。每批独立 spec→plan→实现→验证→`docs/reviews/` 第三方审查文档 + memory 登记(AGENTS.md 强制流程)。

## 3. PR-1:StyleBox 通道

### 3.1 proto JSON 字段变更

```json
{
  "name": "Card", "rect": { "x": 0, "y": 0, "w": 200, "h": 80 },
  "bg": "#1a1f2e",
  "fill": "#3ddc84",
  "borderRadius": 8,
  "border": { "width": 2, "color": "#3ddc84" }
}
```

- `bg`:**语义升级为 BREAKING**——从 modulate 近似改为 StyleBoxFlat `bg_color`,modulate 近似路径从翻译层整体删除(工具 2026-08-16 才上线,无外部依赖者,直接替换);
- `fill`:新增,ProgressBar 专用(`fill` 槽色);evaluate 模板读 `[data-fill]` 子元素 backgroundColor;
- `borderRadius`:新增,统一四角 `number`,支持 `{tl,tr,br,bl}` per-corner 对象(Godot 侧天然四独立属性);
- `border`:`{ width, color }`,统一四边;CSS 四边不同时取 top + warning(不静默丢三边)。

### 3.2 StyleBoxFlatSpec 走 UiNodeSpec 独立字段(不动 valueToGd)

`properties` 语义是「直接 `node.set()` 的基本类型值」,StyleBox 是「资源构造 + set」,分层:

```ts
// src/tools/ui/types.ts UiNodeSpec 新增
styleboxes?: Array<{ slot: StyleBoxSlot; box: StyleBoxFlatSpec }>
type StyleBoxSlot = 'panel' | 'normal' | 'background' | 'fill' | 'hover' | 'pressed' | 'disabled';
type StyleBoxFlatSpec = {
  bg_color?: [number, number, number, number];       // 0-1
  corner_radius?: number | { tl?: number; tr?: number; br?: number; bl?: number };
  border_width?: number;                              // 统一四边
  border_color?: [number, number, number, number];
  draw_center?: boolean;
};
```

生成器(`src/tools/ui/ui-layout.ts`)为每节点拼构造块,变量名 **复用生成器既有 nextId 全局命名空间**(整树拼进单个 `_initialize()` 作用域,同名 var 是 GDScript 编译错;实现期落地为专属 1-based `_sb_N` 计数器——共享 nextId 是 0-based 且被 `_saved_N` 交错消耗,与测试序号断言矛盾,唯一性目标经机制达成):

```gdscript
var _sb_1 := StyleBoxFlat.new()
_sb_1.bg_color = Color(0.1, 0.12, 0.18, 1.0)
_sb_1.corner_radius_top_left = 8
_sb_1.border_width_left = 2
node.add_theme_stylebox_override("panel", _sb_1)
```

> **⚠️ 实测修订(v4,§11.3)**:stylebox 类 override 的序列化属性名是 `theme_override_styles/<slot>`(本 spec v1-v3 误写为 `theme_override_styleboxes/`,仓库 `src/tscn/tscn-parser.ts:316` 存量注释可佐证真名);且 `node.set("theme_override_styles/<slot>", sb)` 路径即使属性名正确,`PackedScene.pack()` 落盘也会丢 override(Task 4 A/B 实测)——**唯一可靠路径是 `add_theme_stylebox_override(slot, sb)` API**。

`valueToGd` 完全不动(box 内全是基本类型,单值序列化照旧复用)。

### 3.3 slot 强制枚举白名单(安全)

slot 是 AI 可控字符串拼进生成的 GDScript(`add_theme_stylebox_override("<slot>", …)` 的 API 参数位,v1-v3 曾误写为 `node.set("theme_override_styleboxes/<slot>")` 键)——**入口枚举拒绝比静默失效便宜**。`validateUiNodeSpec` 层校验(覆盖 `ui_build_layout` 手写树入口与翻译链两个入口)。白名单 7 值(§3.2);`focus`/`read_only` 等**显式不进**(YAGNI:每扩一槽须定义语义边界+测试面,首版四类映射用不到;后续需要时随测试面一起扩)。**白名单定位声明**:hover/pressed/disabled 仅供 `ui_build_layout` 手写树入口使用,翻译器永不产出(§1 明确排除交互态翻译)——白名单是入口校验不是翻译能力声明;slot×控件类型联合校验(如 fill 给 Label 时静默无效)留后续,首版由 §4.1 读回的 StyleBoxEmpty 类型字段部分暴露。

现状安全交叉核实:`theme_override_styles/*` 不在 BLOCKED_PROPS 精确集合内(properties 通道现状放行该键前缀,但 valueToGd 不支持资源对象传不进 StyleBox),新通道不构成对既有审计面的绕过。

### 3.4 控件槽位映射

| 控件 | 槽位/通道 | 说明 |
|---|---|---|
| Panel 系(推断/显式/降级) | `panel` | |
| ProgressBar | `background`(bg)+ `fill`(fill 字段) | HP 条 track/fill 两色 |
| Button | `normal` | hover/pressed/disabled 留默认主题(静态原型够用);override 后丢默认主题 content margin,取舍见 §10 开放问题 1 |
| Label | `normal` | CSS badge/chip:Godot 4 Label 主题有 normal stylebox 槽,text+bg 一比一映射,无需外包 Panel |
| ~~显式 ColorRect~~ | **不设映射** | 第二轮审阅修正:ColorRect 不在 CONTROL_TYPES(29 种)白名单,显式 `type: "ColorRect"` 走既有「降级 Panel + warning」,bg 落 `panel` 槽渲染等价。**不为此扩 CONTROL_TYPES**——涟漪面(node_type/child_type 的 MCP enum 与 validateUiNodeSpec 同源、ui_create_control/ui_container_add 连带、capability-matrix 与文档「29 种」措辞)远超一行收益,违背简约 |
| **其余控件带 bg/fill/border** | **warning + 忽略** | 与规则 11(非白名单 type 降级 + warning)同哲学:降级不阻断,AI 从 warning 看见样式丢失自行决策(换映射控件/外包 Panel)。不 INVALID_PARAMS(一个 LineEdit 带 bg 就让整次导入失败,摩擦过大);不扩槽位表(LineEdit 多态槽族/CheckBox 是 texture 不是 color,映射质量差) |

### 3.5 翻译规则变更

- **规则 9(modulate 近似)删除**;modulate 从翻译层消失(properties 里用户显式给 modulate 仍可,BLOCKED_PROPS 之外不受影响);
- **新规则:bg 缺省但 border/borderRadius 存在 → `draw_center=false`**(StyleBoxFlat 默认 `draw_center=true`+灰底,CSS「有边框无背景」是透明底,不处理则系统性渲染翻转且 style_verify 无从暴露——期望值没设,diff 无目标);
- **规则 7(ProgressBar 27px 钳制预警)最终语义(v4 实测修订)**:**无条件预警**(h < `PROGRESS_BAR_MIN_HEIGHT=27` 一律警,文案分档)。实测依据(Task 4,Godot 4.7.1 headless):h=16 时无 override→27、bg-only→23、fill-only→27、bg+fill→23——**所有组合都被钳**,v3 的「有 override 不预警」收窄会静默漏掉带 override 的被钳场景。预警是所有情形的正确或保守信号(实测各组合钳制值写入 warning 文案)。
- 规则 4(透明壳)判定不变:bg 缺省=透明壳契约不变(bg 现在走 stylebox,「有无 bg」判定输入相同);
- 显式 Panel 无 bg 灰底翻转 warning(审查遗留①)不变。

### 3.6 evaluate 模板扩展(规则双副本)

追加读 `getComputedStyle`:`borderTopLeftRadius` 等四角独立属性(不解析简写)、`borderTopWidth`/`borderTopColor`、`[data-fill]` 的 backgroundColor。**颜色输出从 toHex(`#rrggbb`)改为 `[r,g,b,a]` 0-1 数组格式**——顺手消解 toHex 丢 alpha 的既有缺陷(半透明 bg/毛玻璃/遮罩层被当全不透明),proto ProtoColor 本就支持该格式。

## 4. PR-2:verify 层(style_verify + flow_verify)

### 4.1 style_verify

- measure 脚本扩展:对每 Control **按需**读回样式生效值——仅「expect 树中该节点有 styleboxes 期望」或「槽位 override 非空」的节点(禁止全树盲读:2000 节点上限 × 4-7 槽 × 5 属性,返回体膨胀数倍);
- **判定信息传递机制(第二轮审阅 I-B 拍板)**:两个判定输入分居两侧——期望在 TS 侧(expect 树),override 存在性在 GD 侧(运行时)。**期望清单(path→slots)由 TS 侧序列化内嵌进 measure 生成脚本**(沿 `nodePath` 内嵌生成先例,`ui-measure.ts:28-34`);运行时 `has_theme_stylebox_override` 仅作**补充并集条件**(手写树/手动 override 的节点无期望清单也能被读到)。**禁止**反向设计(GD 侧纯自判 override 存在性):「override 没设上」的节点——恰恰是最需要暴露的——`has_override` 为 false 就不读不 diff,§4.1 核心防线(「没设上 override 以默认主题数值 diff 暴露」)会被静默架空;
- 读回 `get_theme_stylebox(slot)`:override 优先,回落默认主题——「没设上 override」以默认主题数值 diff 暴露(这正是 modulate 级联类问题的数字版防线);
- **读回先判 `sb is StyleBoxFlat`**:非 Flat(Label 未 override 时 normal 槽返回 StyleBoxEmpty)输出类型字段、不进 diff(bg_color 读 null 会崩/误判);
- 读回属性:bg_color / corner_radius×4 / border_width×4 / border_color;
- TS 侧:翻译目标(StyleBoxFlatSpec,corner_radius 展开为四属性)vs 实测 diff → `style_verify: [{path, slot, field, target, actual, delta, ok}]`;
- 挂两处:`ui_import_prototype` 返回;`ui_measure_layout`(expect_tree 是 UiNodeSpec,天然带 styleboxes,同构复用);
- 布局稳定机制(2 帧稳定/5 帧上限)对 stylebox 读回足够:override 同步可读,不依赖帧。

### 4.2 flow_verify(消解上轮 B-2 盲区)

- **载体机制(构建树与期望分离)**:`TranslateResult` 新增 `flow_expect: Array<{path, rect}>`——path 为最终树内路径(翻译时可算出,含 `_Flow` 容器层;**path 必须用最终树 name——含 `_PrototypeRoot` 被 `uniqueName` 改名后的实际名字,禁止硬编码 `ROOT_NAME` 常量**),rect 为**输入视口绝对坐标**。构建树维持现状(flow 直接子节点仍 `delete rect`)——若简单恢复 rect,生成器对「有 rect 但父为 Container」每节点发 warning(`src/tools/ui/ui-layout.ts:450-452`),污染 build_warnings;
- import 链:flow_expect 与 measure 实测(`global_position`,`src/tools/ui/ui-measure.ts:88` 确为视口绝对)直接 diff → `flow_verify: [{path, target, actual, delta, ok}]`;
- **范围收窄:仅 flow 直接子节点层**(丢 rect 的那层,即现 `countDroppedRects` 统计层)。flow 孙层维持既有近似覆盖(「相对输入父原点」期望,容器排布后天然带偏移)——把孙层纳入 flow_expect 会产出稳定系统性偏差报警,是噪声不是缺陷信号。B-2 声明文案(`prototype-import.ts:368-374` warning / `ui/index.ts:676` `_note`)同步改为「flow 直接子层受 flow_verify 覆盖,孙层为近似覆盖」;
- 挂载原点对齐前提显式继承既有约束(`parent_path` 须原点对齐,descHint 已声明);
- 偏差即价值:HTML flex 默认 align stretch vs Godot size_flags 默认 fill+shrink begin,直接子层 dh 可能系统性偏差——flow_verify 暴露后 AI 按 Δ 加 size_flags 修正,这正是数字收敛闭环的意图。

## 5. PR-3:像素采样验证(`ui_pixel_verify`)

- ui 工具族新 action:入参同 import(geometry/geometry_path 二选一)→ translate 得期望 → `captureScreenshot` → `decodePng` → 采样 → 判定;
- **渲染前提(实测核实)**:Windows headless=dummy renderer 截图空白(`src/screenshot.ts:63-65`),capture 实走窗口模式(会弹窗,文档化);**Linux headless 2D CanvasItem 内容必空白**(`src/screenshot.ts:259-265` blank hint)→ 集成测试 Windows-only skip(沿 `test/integration/ui-import-integration.test.ts:25` 先例),coverage 排除决策照 game-bridge 先例;
- 采样点:每 bg 节点 rect 中心 + 四角内缩点;**内缩量 clamp**:min(borderRadius + border.width, rect 短边/2 − 2),防 borderRadius > 短边一半时采样点越界;
- 判定:RGB 欧氏距离容差(中心点严格、角点宽松,具体阈值集成实测校准);
- **PNG 中间产物**:落项目内临时名,try/finally 保证失败路径也清理;
- **使用模式约束(规则文档写明)**:定位为**终验**而非迭代反馈——几何 + style_verify 全绿后才跑一次(每次 capture 弹窗 + 秒级耗时,迭代每轮跑会拖垮收敛循环);
- 接线:ACTIONS 追加 + TOOL_META actionRisks **`'write'`**(写 PNG 产物)+ module-loader SLIM descHint + build-matrix + check:budget。

## 6. PR-4:单进程优化

- **实现形态拍板(第二轮审阅 N-2):新建独立脚本模板,不扩展 ui-measure**——build 走 `_initialize` 同步语义、measure 走 `process_frame` 异步稳定语义(`ui-measure.ts:23-47`),两种生命周期混进一个函数过载;PR-2 已给 ui-measure 加 style 读回,再叠 build 职责违反单一职责。`_mcp_load_scene` 共享模板(`gdscript-templates.ts`)**不动**——合成脚本自带 CACHE_MODE_IGNORE load 分支,不影响全部既有调用方;
- 合成单 spawn:full-class SceneTree 脚本顺序 load → 建树 → pack→tmp→rename 原子写(复用 scene-commit 模式)→ **reload 用 `ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)`** → 等帧稳定 → measure 输出 → `_mcp_done`;
- **B-1 依据(审查 Blocking)**:`_mcp_load_scene` 是裸 `load(sp)`(`src/core/shared/gdscript-templates.ts:102`),同进程内第二次 load 同路径命中 ResourceCache 返回旧实例(无新子树)→ verify 全红。全仓无 CACHE_MODE 处理先例。IGNORE 模式从磁盘取新实例且不接管缓存路径;依赖子资源(font 等)仍享缓存,对 measure 无影响反而更稳;
- **验收断言含「篡改磁盘后 reload 测出差异」**(防 reload 假绿:确认真的绕过了缓存);
- measure 失败错误信息保留「build 已持久化,可重跑」恢复语义(save 先于 measure 的既有顺序);
- capture **不并入**(窗口模式 driver 参数不同),`ui_pixel_verify` 保持独立调用;
- 现状耗时数据已留档:`test/integration/ui-import-integration.test.ts:30-31/:57`(两次 spawn 实测记录,正是本批决策依据)。

## 7. 测试策略

- **翻译纯函数单测**:新字段正例(四控件槽位映射/ColorRect color/borderRadius number 与 per-corner 对象/fill)/负例(borderRadius 负值、border.color 坏格式、slot 白名单外、fill 给非 ProgressBar 警告)/快照锁 UiNodeSpec 产出;
- **生成器单测**:stylebox 构造块 GD 快照(含 `_sb_N` 命名与 nextId 不冲突);
- **BREAKING 改写面(实测核实)**:`test/prototype-import.test.ts:309-314`(bg→modulate+「近似」warning)/`:354-357`(显式 Panel bg)/`:481-483`(bg 归一)三处断言改写为 styleboxes 断言;
- **集成(GODOT_PATH,Windows)**:
  - fixture 升级:`rts-hud.json` 加三件套字段(5 个显式 Panel bg 节点:Bg/TopBar/Minimap/CmdPanel/UnitPanel,.tscn 文本断言从 modulate 行改 StyleBoxFlat sub_resource);
  - **新 CSS 卡片 fixture**:覆盖 Label badge(normal 槽)/HP 条 fill/圆角边框/draw_center=false(border 无 bg)。**方法论声明**:该 fixture 无上轮全绿树可反推,期望值由集成测试首次实测校准(跑红→修绿,过程留档),不伪装有程序化真值来源;
  - **Label normal 槽 headless 实测命令附进验收**(AGENTS.md 验证优先:引擎事实虽有文档依据,spec 落盘附 `add_theme_stylebox_override("normal", StyleBoxFlat.new())` + `get_theme_stylebox` 读回的实测验证方式);
  - ProgressBar 钳制三组合(bg-only/fill-only/bg+fill)实测校准,同步 `:129-132` fixture 校准注释;
  - flow_verify:fixture flow 直接子层配错 spacer → flow_verify 红;配对 → 绿;集成用例 2 的 `targets===2` 断言(`:216-219`)随 ③ 改写;
  - **跨批次测试演进声明**:PR-2 的测试改写(用例 2/fixture 断言)在 **PR-1 产出基础上**继续改写——plan 作者勿按 PR-1 时点的快照写 PR-2 断言,串行批次间同文件连续演进;
  - PR-4:篡改磁盘断言 + 耗时对比记录;
- **ui_pixel_verify**:Windows-only skip + 同图全绿/构造差异 PNG 精确计数/路径白名单负向。

## 8. 改动面清单(实施时逐项核销,跨四批)

| 登记点 | 文件 | 内容 | 批次 |
|--------|------|------|------|
| UiNodeSpec 类型 | `src/tools/ui/types.ts` | styleboxes 字段 + StyleBoxSlot/StyleBoxFlatSpec + ACTIONS(`ui_pixel_verify`) | PR-1 / PR-3 |
| 翻译器 | `src/tools/ui/prototype-import.ts` | 规则 9 删/新规则/规则 7 修正/flow_expect 产出/槽位映射 | PR-1 / PR-2 |
| 生成器 | `src/tools/ui/ui-layout.ts` | stylebox 构造块 + slot 白名单校验(validateUiNodeSpec 层) | PR-1 |
| measure | `src/tools/ui/ui-measure.ts` | 样式按需读回(判 StyleBoxFlat) | PR-2 |
| diff | `src/tools/ui/layout-diff.ts` | style diff / flow diff 推导函数 | PR-2 |
| 工具接线 | `src/tools/ui/index.ts` | import 链返回 style_verify/flow_verify;ui_pixel_verify case + TOOL_META actionRisks `'write'`;`_note` 改写 | PR-2 / PR-3 |
| 单 spawn | `src/tools/ui/`(**新建独立脚本模板**,第二轮审阅拍板,不扩 ui-measure) | build+persist+reload(CACHE_MODE_IGNORE,自带 load 分支不动共享模板)+measure 合成 | PR-4 |
| 像素采样 | `src/tools/ui/`(新文件)+ `src/screenshot.ts` 复用 | capture→decode→采样→判定 | PR-3 |
| descHint | `src/tools/ui/index.ts` + `src/core/module-loader.ts` | 新字段/新 action 说明 + SLIM_CONFIG | PR-1~3 各自 |
| 规则双副本 | **9+ 处段落,两文件逐字同步**:`.claude/rules/godot-mcp-ui.md`(`:133` 翻译规则要点 bg→modulate 措辞 / `:134` 引擎下限预警 ProgressBar 27px 段联动规则 7 修正 / `:139` verify_coverage+flow 盲区段 / `:197` evaluate 要点 toHex)+ `.claude/rules/godot-mcp-engine-quirks.md`(`:65` modulate 级联段「bg 近似染色除外」措辞成假话须改 / `:68` ProgressBar 27px 段「翻译器对 rect.h<27 发 warning」行为描述联动)+ `src/tools/rule-templates.ts` 对应镜像段(`:612` 字段清单加 fill/borderRadius/border / `:613` 颜色格式 / `:615` / `:616` / `:621` / `:679` / `:636-639` toHex→数组输出 / `:933-935` UI 渲染段 modulate 措辞镜像)。**engine-quirks 亦属双副本体系**(AGENTS.md `.claude/rules/godot-mcp-*.md` 通配),单侧修改会被 `STRICT=1 npm run check:rules-sync` 阻断(2026-07-27 同型踩坑) | PR-1 / PR-2 |
| 测试改写 | `test/prototype-import.test.ts` 3 断言 + `test/integration/ui-import-integration.test.ts`(用例 2 改写/fixture 校准注释/.tscn 断言) | BREAKING 联动;PR-2 在 PR-1 产出基础上继续改写 | PR-1 / PR-2 |
| fixture | `test/fixtures/prototype-geometry/rts-hud.json` + 新卡片 fixture | 三件套字段 | PR-1 |
| claudemd-builder | — | 实测确认无 bg→modulate 措辞,**无需改**(两轮审查核实) | — |
| matrix/budget | `npm run build-matrix` + `check:budget` | 工具/参数描述变更 | 各批 |
| CHANGELOG | 各批独立版本段 | PR-1 含 BREAKING 标注 | 各批 |
| 完成门禁 | lint + build + test 全绿 + **`STRICT=1 npm run check:rules-sync`(需先 build;本迭代为双副本改动密度最高批次,显式列进门禁而非隐含)** | 每批提交前 | 各批 |
| 审查+memory | `docs/reviews/` + memory 登记 | 每 PR 交付物 | 各批 |

## 9. 版本策略

规则双副本变更强制 patch bump(check-rules-version-bump),但 PR-1 的 `bg` 语义变更是 **BREAKING**——取大者:PR-1 定 **minor(0.31.x → 0.32.0)**,CHANGELOG 标注 BREAKING;PR-2/3/4 常规 patch(各含双副本变更时按门禁 bump)。

## 10. 开放问题(实测后校准)

1. Button override normal 后丢默认主题 content margin → 文字贴边。实测若不可接受,翻译 Button 时补 `content_margin = border.width + 校准值`(校准值实测定,不编造 CSS 没有的数);可接受则仅文档声明取舍;
2. 像素采样容差:中心点/角点阈值(抗锯齿底噪)集成实测校准;
3. Label normal 槽 headless 实测(§7 已列验收命令)——若引擎行为与文档不符(如 override 不渲染),badge 映射降级为外包 Panel 方案;
4. ~~ProgressBar 有 override 时的实际钳制值~~ **已答(v4,Task 4 实测)**:no override→27 / bg-only→23 / fill-only→27 / bg+fill→23(所有组合都被钳);规则 7 已据此恢复无条件预警,实测数据写入 warning 文案与集成测试断言(`test/integration/ui-import-integration.test.ts` 三组合用例);
5. ~~flow_verify 容差:直接子层 Δ 的合理阈值(容器排布 vs flex 排布的固有数值差)实测校准,可能大于几何 verify 的 2px~~ **已答(2026-08-18,生产路径 genUiImportSingleScript 真跑 Godot 4.7.1 实测)**:
   - **flow FILL h=39 根因**:Holder 外层 Panel 比例锚点 float32 残差(anchor_top=100/720=0.138888895511627)→ 容器实测 h=39.9999923706055;HBoxContainer 给 FILL 子的高度整数截断 → floor(39.9999924)=**39(精确整数,而位置保留浮点残差 y=100.0000076)**。dh=+7 为系统性 FILL 拉伸(32→39)非噪声;修正渠道 = 原型侧等高输入或后续翻译规则垂直 size_flags 映射(维持开放,非本层);
   - **flow 容差维持 2**:系统性偏差是 flow_verify 的价值(如实红),加宽容差只会隐藏;1px 锚点截断噪声成分已在 2px 内。

## 11. 审查消解记录(第三方审查 + 专业再修正)

第三方审查(code-reviewer 子代理,30 次工具调用实测取证)判定 **REVISE**。消解对照:

| 意见 | 处置 |
|------|------|
| B-1 ResourceLoader 缓存 | 采纳:PR-4 reload 用 CACHE_MODE_IGNORE + 篡改磁盘断言(§6) |
| I-1 未映射控件 bg 空白 | 采纳:warning+忽略,与规则 11 同哲学;另补显式 ColorRect→color 直属性映射(§3.4) |
| I-2 border 无 bg 灰底翻转 | 采纳:draw_center=false 新规则(§3.5) |
| I-3 ProgressBar 钳制语义分裂 | **再修正后采纳**:审查称「带 bg 钳制消失」不准确——fill 槽默认主题 margin 仍顶开,minimum_size 取两槽最大值;修订为「无任何 override 才静态预警」+ 三组合实测校准(§3.5/§10.4) |
| I-4 BREAKING 测试影响面 | 采纳:3 单元断言 + 集成用例 2 + fixture 断言 + 声明文案全部列入 §7/§8 |
| I-5 双副本 6 处段落 | 采纳:逐处列进 §8 |
| I-6 flow 期望载体缺失 | 采纳机制(构建树与期望分离),**再修正范围**:仅直接子层,孙层维持近似覆盖防噪声(§4.2) |
| I-7 ui_pixel_verify CI/接线 | 采纳:Windows-only skip/coverage 先例/actionRisks 'write'/PNG try-finally 清理(§5) |
| I-8 slot 枚举 | 采纳:7 值白名单 + YAGNI 显式声明(§3.3) |
| N-1 Label 槽实测 | 采纳:验收附实测命令(§7/§10.3) |
| N-2 content margin | 升级:声明 + 开放问题校准钩子(§10.1) |
| N-3 border 四边 warning | 采纳(§3.1) |
| N-4 toHex 丢 alpha | **升级为顺手修**:evaluate 颜色输出改 [r,g,b,a] 数组(§3.6) |
| N-5 StyleBoxEmpty 判型 | 采纳(§4.1) |
| N-6 采样内缩 clamp | 采纳(§5) |
| N-7 _sb_N 命名空间 | 采纳(§3.2) |
| N-8 批次依赖核验通过 | 无改动 |
| N-9 每 PR 审查+memory | 采纳(§2/§8) |
| N-10 claudemd-builder 无需改 | 实测确认,无需改动 |

**设计者自查新增 4 盲区**(审查与修订初稿均未覆盖):style 读回按需禁全树盲读(§4.1)、版本策略 minor 裁决(§9)、新 fixture 方法论声明(§7)、ui_pixel_verify 终验定位(§5)。

**实测口径修正**:CONTROL_TYPES 实测 **29** 种(node 实数,审查报告记 28)。

## 11.3 实现期实测修订记录(Task 4,v4)

Task 4 集成验收真跑 Godot 推翻 v3 三处声明,修正如下(全部有实测数据与仓库佐证):

| v3 声明 | 实测事实 | 修正 |
|---------|---------|------|
| override 属性名 `theme_override_styleboxes/<slot>` | 真名 `theme_override_styles/<slot>`(`src/tscn/tscn-parser.ts:316` 存量注释佐证);且 `node.set()` 该路径即使名字正确,`PackedScene.pack()` 落盘也丢 override(A/B 实测) | 生成器改 `add_theme_stylebox_override(slot, sb)` API(commit 54a6e20);§3.2 示例已更正 |
| §3.5/§11「有 override 不预警(钳制不可静态预知)」 | h=16:无 override→27 / bg-only→23 / fill-only→27 / bg+fill→23,**全组合被钳** | 规则 7 恢复无条件预警,文案分档含实测数据(commit c4f543d);§3.5 已重写 |
| §11 I-3 再修正中「bg+fill 都 override 才完全消失」的推断 | bg+fill 仍钳到 23(StyleBoxFlat 默认 content_margin=-1 继承主题) | §11 I-3 行的推断链以此为准修正;开放问题 4 标记已答 |

**过程教训**:三处全部是「单测/生成快照全绿、真跑引擎才暴露」——集成验收(真 Godot spawn)不可被生成快照替代,后继 PR-2(style_verify 读回)/PR-4(单进程 reload)同理。

## 11.2 第二轮审阅消解记录(落盘文档审查)

第二轮独立 code-reviewer 子代理审阅落盘 spec(不采信 §11 消解声明;查 Godot 官方文档 + master 源码 + 仓库实测 11 组引用)。判定 **REVISE(无 Blocking)**:B-1(ResourceLoader API 签名/CacheMode 枚举/篡改磁盘断言有效性)、I-3 再修正(ProgressBar `get_minimum_size()` 确为 background 与 fill 两 stylebox 取 max,master 源码 progress_bar.cpp 确认)、I-6 再修正(countDroppedRects 确统计直接子层)、11 组 file:line 引用零漂移、fixture 5 个 bg 节点属实——**核心声明全部独立成立**。消解 4 Important + 5 Nit:

| 意见 | 处置 |
|------|------|
| I-A 双副本清单漏 3 处(消解部分不成立) | 采纳并实测核实行号:§8 补 `godot-mcp-ui.md:134`(ProgressBar 27px 段,首版只在 rule-templates 侧列 :616 造成单侧修改必被 STRICT 拦断)+ `engine-quirks.md:65`(modulate 段「bg 近似染色除外」措辞成假话)与 `:68`(will be clamped 行为描述)+ `rule-templates.ts:933-935` 镜像段;清单 6 处 → **9+ 处** |
| I-B style_verify 按需读回判定信息分居两侧 | 采纳:§4.1 拍板「期望清单 TS 侧序列化内嵌进 measure 脚本(沿 nodePath 内嵌先例),运行时 override 存在性仅作补充并集条件;禁止 GD 纯自判(会架空『没设上 override 以默认主题 diff 暴露』防线)」 |
| I-C 显式 ColorRect 映射不可达 | 采纳且拍板**删映射**:ColorRect 不在 CONTROL_TYPES(29 种),扩白名单涟漪(MCP enum/validate/matrix/文档联动)超一行收益;§3.4 改为诚实声明「走既有降级 Panel + bg stylebox,渲染等价」 |
| I-D 门禁漏 check:rules-sync | 采纳:§8 门禁行显式补 `STRICT=1 npm run check:rules-sync`(本迭代双副本改动密度最高,历史踩坑直接针对对象) |
| Nit:slot 定位/PR-4 二选一/CHANGELOG/path 硬编码/跨批次测试演进 | 全部采纳:§3.3 白名单定位声明、§6 拍板新独立模板(生命周期不混+不动共享 `_mcp_load_scene`)、§8 CHANGELOG 行、§4.2 path 用最终树名禁硬编码、§7 跨批次演进声明 |
