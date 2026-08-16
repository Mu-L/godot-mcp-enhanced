---
description: "ui ui_create_control ui_build_layout ui_measure_layout ui_set_layout ui_get_layout ui_anchor_preset ui_set_theme ui_container_add ui_draw_recipe theme_create theme_set_property CSS flexbox grid 布局 测量 容器 锚点 rect Control HBoxContainer VBoxContainer GridContainer 全屏 居中"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced v0.17.0+

## 概述与架构

UI 布局工具将 **CSS Flexbox/Grid 语义**翻译为 Godot Container 树，让 AI 用熟悉的布局概念构建 Godot UI。

- **三种入口**：单节点操作（ui_create_control）/ 批量布局（ui_build_layout）/ HTML 原型还原（ui_import_prototype，几何 JSON 一次调用，固定持久化）
- **运行时工具**：操作在 headless 进程中执行，默认不持久化到 .tscn（例外：`ui_build_layout` 支持 `persist=true` 原子写；`ui_import_prototype` 无 persist 参数、固定持久化）。详见 godot-mcp-core.md "运行时 vs 持久化"。
- **互补关系**：ui_import_prototype 适合"HTML 原型→Godot"还原（原型是唯一真源）；ui_build_layout 适合手写树整体布局；ui_create_control + ui_set_layout 适合精确定位

## 工具清单

| 工具 | 说明 |
|------|------|
| `ui_build_layout` | 声明式批量布局，CSS Flexbox/Grid → Godot Container 树；支持 rect 绝对几何与 persist 原子写 |
| `ui_import_prototype` | HTML 原型几何 JSON 一次调用：翻译→build（固定 persist）→measure→layout_verify；返回 verify_coverage 覆盖率（v0.31.0） |
| `ui_measure_layout` | headless 整树 computed rect 测量（等布局稳定后输出，可带 expect_tree diff） |
| `ui_create_control` | 创建单个 Control 节点（29 种类型） |
| `ui_set_layout` | 设置锚点/偏移/最小尺寸 |
| `ui_get_layout` | 查询节点布局信息 |
| `ui_anchor_preset` | 应用 16 种锚点预设 |
| `ui_container_add` | 向 Container 添加子 Control |
| `ui_draw_recipe` | 声明式 2D 绘图（7 种操作） |
| `ui_set_theme` | 设置/创建/保存/加载 Theme |
| `theme_create` | 创建空 Theme 或从节点提取 |
| `theme_set_property` | 设置 Theme 属性（font/color/constant/stylebox） |

### 支持的 29 种 Control 子类

Button, Label, Panel, LineEdit, TextEdit, RichTextLabel, LinkButton, HSlider, VSlider, CheckBox, CheckButton, OptionButton, SpinBox, ProgressBar, TextureRect, ColorPickerButton, TabContainer, Tree, ItemList, MarginContainer, HBoxContainer, VBoxContainer, GridContainer, CenterContainer, ScrollContainer, PanelContainer, HSplitContainer, VSplitContainer, NinePatchRect

## 使用指南

### ui_build_layout — 声明式布局

`tree` 参数定义布局结构，支持递归嵌套（最大深度 10）：

```json
{
  "type": "VBoxContainer",
  "name": "MainMenu",
  "layout": { "direction": "column", "gap": 10, "padding": 20 },
  "children": [
    { "type": "Label", "name": "Title", "properties": { "text": "游戏标题" } },
    {
      "type": "HBoxContainer",
      "name": "ButtonRow",
      "layout": { "direction": "row", "justify": "center", "gap": 8 },
      "children": [
        { "type": "Button", "name": "StartBtn", "properties": { "text": "开始" } },
        { "type": "Button", "name": "QuitBtn", "properties": { "text": "退出" } }
      ]
    }
  ]
}
```

### layout 字段

| 字段 | 值 | 对应 Godot |
|------|-----|-----------|
| `direction` | row/column/grid | HBoxContainer/VBoxContainer/GridContainer |
| `justify` | flex-start/center/flex-end/space-between/space-around/space-evenly | Container alignment |
| `align` | stretch/flex-start/center/flex-end | Cross-axis alignment |
| `gap` | number | Theme 默认间距 override |
| `padding` | number 或 [上,右,下,左] | MarginContainer |
| `columns` | number | GridContainer columns（仅 grid 方向） |

### flex 字段（控制子节点在容器中的行为）

| 字段 | 说明 | 对应 Godot |
|------|------|-----------|
| `grow` | 扩展比例（0=不扩展） | size_flags_stretch_ratio |
| `min_width` / `min_height` | 最小尺寸 | custom_minimum_size |
| `align_self` | 单独对齐覆盖 | size_flags + alignment |

### anchor_preset 锚点预设

16 种预设：top_left, top_right, bottom_left, bottom_right, center_left, center_top, center_right, center_bottom, center, left_wide, top_wide, right_wide, bottom_wide, vcenter_wide, hcenter_wide, **full_rect**（最常用）

### rect 绝对几何（v0.30.3 语义修正）

无 `layout` 字段的节点支持 `rect: {x, y, w, h}`——**相对父节点左上角**（不是视口绝对坐标），按**父尺寸**反解为 anchors+offsets：

- **求解基准**：根节点（挂 parent_path 下）的 rect 相对 **`viewport` 参数**求解（默认 1280x720）；子节点的 rect 相对**父节点的 rect.w/h** 求解；父节点未声明 rect 时降级用 viewport 求解并发 warning（`parent's size is unknown`，结果可能不准）。
- **viewport 参数**：`ui_build_layout` 顶层参数 `{w, h}`（须为正数），与项目 `display/window/size` 一致时根 rect 即视口绝对几何。
- **父必须非 Container**：HBoxContainer 等容器父会强制重排子节点，rect 会被运行时跳过并给出 warning（需要容器内定位请重构为非容器父或兄弟节点）。
- `rect` 优先于 `anchor_preset`；显式写四值 anchors+offsets，不用 set_anchors_preset（引擎陷阱：preset 不重置 offsets）。
- 锚点值吸附 0/0.5/1（可读性优先），其余位置保持比例锚点兜底。
- **带 `layout` 的容器节点自身 rect 不落地布局**：仅作为 `ui_measure_layout(expect_tree)` 的对照目标（diff 会报告实际偏差）；容器实际几何由 `anchor_preset`（默认 full_rect）与子节点内容/`custom_minimum_size` 撑开决定。

### justify space-* 行为（v0.30.3）

非 wrap 非 grid 的 row/column 下，`space-between/around/evenly` 通过注入 `_spacer_N` Control 节点实现（SIZE_EXPAND + stretch_ratio），**不再是近似映射**。`wrap: "wrap"` 时 justify 被忽略（FlowContainer 无对齐）、`grid` 方向时同样忽略——这两种情况**不注入 spacer、也不发 spacer 注入 warning**。与子节点 `flex.grow` 并存时，spacer 与 grow 子节点瓜分剩余空间，分配语义与 CSS 不同，会有 warning。

### 布局收敛闭环

`ui_build_layout(tree 含 rect)` → `ui_measure_layout(expect_tree=同一棵 tree，**不带 node_path**)` → 按 `data.layout_verify.diff` 的 Δ 数值修 tree → 循环至全绿 → `ui_build_layout(persist=true)` 原子写 .tscn（pack → tmp → rename）。

- `layout_verify` 结构：`targets`（期望 rect 清单）/ `diff`（逐节点 Δ，容差默认 2px）/ `overlaps`（兄弟节点重叠）/ `out_of_bounds`（溢出父边界）/ `viewport`（measure 输出的根参照系透传）。
- **坐标系语义（v0.30.3）**：rect 相对父节点左上角；`diff` 的 actual 为**父相对坐标**（measured 子 global − 父 global，与 target 同构可直接比 Δ）；根级 target（树根自身 rect）以视口原点为参照；父不在测量集（未渲染/不可见）时该条目 delta 为 NaN。
- `ui_measure_layout` 单独使用时：`node_path` 可选（省略则从场景根整树测），`max_depth` 默认 16（上限 64），等布局稳定（连续帧快照一致或最多 5 帧）后输出；输出含 `viewport`（项目声明视口尺寸）与 `stalled`（5 帧上限内未达 2 帧稳定时 true，布局可能未收敛）。

### ui_import_prototype — HTML 原型还原（v0.31.0）

**工作流（AI 全链路，原型是唯一真源）**：AI 写 HTML 原型（每个待还原元素标 `data-name`）→ 浏览器 MCP 一条 evaluate 提取几何 JSON（模板见下节）→ `ui_import_prototype` **一次调用**完成 翻译→build→measure→layout_verify → **不绿回 HTML 改原型**（不在 Godot 侧调 rect）→ 绿后 `screenshot(action=diff)` 像素级双图验收（要点见本节末）。

**入参**：`geometry`（inline JSON）或 `geometry_path`（文件路径，相对项目、支持 `res://` 前缀；二选一，同时给时 `geometry` 优先 + warning）/`viewport`（可选，默认取 geometry.viewport）/`tolerance`（默认 2px）/`parent_path`（默认 root）。**没有 persist 参数——固定持久化**（内部 measure 是第二次 Godot spawn 从磁盘 load 场景，不落盘则 verify 全部 actual:null）。

**proto-geometry JSON**（strict schema，未知字段拒绝——字段拼错（如 `font-size`）早暴露，不静默丢）：

```json
{
  "viewport": { "w": 1280, "h": 720 },
  "nodes": [
    { "name": "TopBar", "rect": { "x": 0, "y": 0, "w": 1280, "h": 56 },
      "type": "Panel", "text": "标题", "fontSize": 16, "color": "#e8ecf5",
      "bg": "#10141f", "align": "center", "value": 0.72,
      "flow": "row", "justify": "space-between", "interactive": true }
  ]
}
```

- **扁平列表，视口绝对坐标**（rect 为浏览器/原型视口绝对值）；树由翻译器按 rect 包含关系自动推导（容差 1px，≤500 节点）；**两节点 rect 交叉重叠（互不包含）或完全相等 → INVALID_PARAMS**（不静默落平级）。
- 字段全可选（除 name/rect）：`type`（CONTROL_TYPES 白名单）/`text`/`fontSize`（px）/`color`/`bg`/`align`（left|center|right，缺省 center）/`value`（0-1，ProgressBar）/`flow`（row|column，容器排布语义）/`justify`/`interactive`（text+interactive→Button）。
- **颜色仅三种格式**：`#rrggbb` / `[r,g,b]` 0-255 / `[r,g,b,a]` 0-1。CSS `rgb()/rgba()` 字符串**不支持**——evaluate 模板已内置转换（见下节）。
- **bg 缺省 = 透明壳契约（责任归 JSON 生产者）**：无 text 无 bg 无 flow 的纯布局节点 → `self_modulate:[1,1,1,0]`（禁 modulate，级联陷阱见 godot-mcp-engine-quirks.md）。**该有背景的面板务必在原型侧显式填 bg**，否则被当透明壳。
- **翻译规则要点**（12+1 条）：类型推断（显式 type > flow > value→ProgressBar > text+interactive→Button > text→Label > Panel）；视口坐标逐层减父原点转相对父 rect（进锚点求解链）；Label 全部 `vertical_alignment:1`；bg→modulate 近似染色（warning 声明非 StyleBox，叠加子树与实际底色有偏差）；非白名单 type 降级 Panel + warning；深度 cap 10；name 非法字符清洗。
- **引擎下限预警（只警不修，修在原型侧）**：文本控件 rect.h < fontSize*1.5 → "可能被字体最小行高钳制" warning；ProgressBar rect.h < 27（Godot 4.7 默认主题 stylebox 最小高，实测 rect.h=16 落地 27px）→ "will be clamped" warning。应对：调大原型 rect.h 或调小字号，勿指望 Godot 侧硬压。
- **容差模糊带**：verify 容差（默认 2px）内兄弟关系与偏移不可区分——**避免构造 ≤2px 宽的相邻独立节点**（工具返回也带此提示）。

**返回**：`{ tree, build_warnings, measure: {stable_after_frames, stalled, viewport}, verify_coverage, layout_verify: {targets, diff, overlaps, out_of_bounds, viewport}, persist }`。

- **verify_coverage 覆盖率语义**：`targets` 为受几何 verify 覆盖的节点数（**含合成根 `_PrototypeRoot`——无 flow 时 = 输入节点数 + 1**）。**flow 直接子节点丢 rect、不在覆盖内**——flow 子树（spacer/min_size/justify 映射）出错时 verify 仍绿，唯一补偿防线是 `screenshot(action=diff)` 像素验收。
- measure 阶段失败时错误信息附 `(build 已持久化,可重跑 ui_measure_layout)`——场景已在磁盘，无需重新 import。

**像素验收要点（`screenshot(action=diff)`）**：`image_a`/`image_b` 两 PNG（白名单内，尺寸必须一致）、`threshold` 默认 0.12（per-pixel RGB 欧氏距离 / (√3×255)，严格大于才计差、忽略 alpha）、可选 `diff_path` 输出红染差异图；返回 `{width, height, diff_pixels, diff_ratio, bbox}`。

- **capture 的 viewport 必须与原型 viewport 一致**（用法契约）：原型 1280x720 则 capture 也用 1280x720，否则几何比例全错、diff 全图皆红。
- **diff_ratio 含字体抗锯齿底噪**——对 diff_ratio **设区间断言而非精确值**（如"好图 < 0.25、坏图 > 0.4"）。实测参考：上轮历史图对（web-prototype vs godot-hud，同布局不同渲染器）threshold=0.12 时 diff_ratio≈0.1762——同源渲染仍有 17% 量级像素差，精确值断言必 flaky。

### 浏览器 evaluate 取数脚本模板（chrome-devtools / playwright 通用）

HTML 原型侧约定：每个待还原元素标 `data-name`（=Godot 节点名，须唯一）；flex 容器标 `data-flow="row|column"`（可选 `data-justify`）；整页视口容器标 `data-viewport`（可选，缺省取窗口尺寸）。在浏览器 MCP（如 chrome-devtools 的 evaluate_script / playwright 的 browser_evaluate）执行：

```js
() => {
  const toHex = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
    if (!m) return null;                                  // 非 rgb()/rgba() 不填(翻译器仅认 #rrggbb)
    if (m[4] !== undefined && Number(m[4]) === 0) return null;  // alpha 0 = 透明
    return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
  };
  const vpEl = document.querySelector('[data-viewport]');
  const vpRect = vpEl ? vpEl.getBoundingClientRect() : { width: innerWidth, height: innerHeight };
  const out = { viewport: { w: Math.round(vpRect.width), h: Math.round(vpRect.height) }, nodes: [] };
  for (const el of document.querySelectorAll('[data-name]')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const node = {
      name: el.dataset.name,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
    const text = (el.dataset.text ?? el.textContent ?? '').trim();  // 嵌套容器建议用 data-text 标注,避免吞子元素文本
    if (text) node.text = text;
    const fs = parseFloat(cs.fontSize);
    if (Number.isFinite(fs)) node.fontSize = fs;
    const fg = toHex(cs.color);
    if (fg && fg !== '#000000') node.color = fg;          // 文本色:跳过浏览器默认黑(CSS 未设 color 时 computed 恒黑)
    const bg = toHex(cs.backgroundColor);                 // 背景色:非透明才填(v2 N-3——该有背景的面板被当透明壳是高频误判)
    if (bg) node.bg = bg;
    const flow = el.dataset.flow;
    if (flow === 'row' || flow === 'column') {
      node.flow = flow;
      if (el.dataset.justify) node.justify = el.dataset.justify;
    }
    if (el.dataset.value !== undefined) node.value = Number(el.dataset.value);  // ProgressBar 0-1
    if (el.dataset.interactive === 'true') node.interactive = true;
    if (el.dataset.type) node.type = el.dataset.type;     // 显式类型覆盖推断(29 种白名单内)
    out.nodes.push(node);
  }
  return out;  // → 直接作 geometry 入参,或写文件后走 geometry_path
}
```

要点：**bg 只在 `getComputedStyle().backgroundColor` 非透明时填**（透明壳契约由翻译器兜底）；**颜色经 toHex 转 `#rrggbb`**（翻译器不认 CSS `rgb()` 原文）；`viewport` 取 `[data-viewport]` 容器或窗口尺寸，**必须与 Godot 项目 `display/window/size` 及后续 `screenshot(capture)` 的 viewport 参数一致**（不一致则几何比例全错）。

### draw_recipe 声明式绘图

7 种绘图操作：`rect`（矩形）、`circle`（圆形）、`line`（线段）、`arc`（弧线）、`polygon`（多边形）、`polyline`（折线）、`string`（文本）

每种操作支持 `color`（[r,g,b] 或 [r,g,b,a]，0-1 范围）、`filled`（是否填充）、`width`（线宽）。

## 调用示例

### Flexbox 行布局

```
ui_build_layout(
  project_path="D:/game",
  scene_path="res://scenes/main.tscn",
  parent_path="root",
  tree={
    "type": "HBoxContainer",
    "name": "Toolbar",
    "layout": { "direction": "row", "gap": 4, "padding": [0, 8, 0, 8] },
    "children": [
      { "type": "Button", "name": "NewBtn", "properties": { "text": "新建" } },
      { "type": "Button", "name": "OpenBtn", "properties": { "text": "打开" } },
      { "type": "Button", "name": "SaveBtn", "properties": { "text": "保存" } }
    ]
  }
)
```

### draw_recipe HP 条

```
ui_draw_recipe(
  project_path="D:/game",
  scene_path="res://scenes/main.tscn",
  node_path="root/HUD/HealthBar",
  ops=[
    { "kind": "rect", "position": [0, 0], "size": [200, 20], "color": [0.2, 0.2, 0.2] },
    { "kind": "rect", "position": [0, 0], "size": [140, 20], "color": [0, 0.8, 0] },
    { "kind": "string", "text": "70/100", "position": [80, 14], "color": [1, 1, 1], "font_size": 12 }
  ]
)
```

### 错误：无效 Control 类型

```
ui_create_control(
  project_path="D:/game",
  scene_path="res://scenes/main.tscn",
  node_type="MyCustomWidget",    // ❌ 不在白名单中
  node_name="CustomWidget"
)
// → { error: "INVALID_CONTROL_TYPE", message: "MyCustomWidget is not a supported control type" }
// 解决：使用 29 种支持的类型之一，或通过 execute_gdscript 注册自定义场景
```

## 常见陷阱

- **运行时默认不持久化**：UI 布局工具创建的节点在 headless 进程退出后丢失。`ui_build_layout(persist=true)` 可原子写 .tscn（pack → tmp → rename，默认 false）；其余持久化替代方案：`add_node` + `save_scene` 逐个写入，或 `scene_commit`（批量 node_property/node_add 操作）直接编辑 .tscn。
- **Container 子节点必须是 Control**：向 HBoxContainer/VBoxContainer 等容器添加非 Control 子节点会报错。
- **CSS 属性回退**：`wrap`、`order`、`flex-shrink`、`max-width/height` 等 CSS 属性在 Godot 中无对应，会被忽略。
- **grid 方向必须指定 columns**：使用 `direction: "grid"` 时必须同时指定 `columns` 数量。
- **ui_build_layout vs ui_create_control**：build_layout 一次创建整棵树，适合初始布局。create_control + set_layout 适合精确控制单个节点。
