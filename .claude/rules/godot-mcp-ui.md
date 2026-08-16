---
description: "ui ui_create_control ui_build_layout ui_measure_layout ui_set_layout ui_get_layout ui_anchor_preset ui_set_theme ui_container_add ui_draw_recipe theme_create theme_set_property CSS flexbox grid 布局 测量 容器 锚点 rect Control HBoxContainer VBoxContainer GridContainer 全屏 居中"
alwaysApply: false
---

> 适用于 godot-mcp-enhanced v0.17.0+

## 概述与架构

UI 布局工具将 **CSS Flexbox/Grid 语义**翻译为 Godot Container 树，让 AI 用熟悉的布局概念构建 Godot UI。

- **两种使用方式**：单节点操作（ui_create_control）vs 批量布局（ui_build_layout）
- **运行时工具**：操作在 headless 进程中执行，默认不持久化到 .tscn（例外：`ui_build_layout` 支持 `persist=true` 原子写）。详见 godot-mcp-core.md "运行时 vs 持久化"。
- **两种方式互补**：ui_build_layout 适合整体布局，ui_create_control + ui_set_layout 适合精确定位

## 工具清单

| 工具 | 说明 |
|------|------|
| `ui_build_layout` | 声明式批量布局，CSS Flexbox/Grid → Godot Container 树；支持 rect 绝对几何与 persist 原子写 |
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

### rect 绝对几何（spec v0.31）

无 `layout` 字段的节点支持 `rect: {x, y, w, h}`（相对**父节点**左上角；父为场景根时即视口绝对几何，默认视口 1280x720），由锚点求解器反解为 anchors+offsets：

- **父必须非 Container**：HBoxContainer 等容器父会强制重排子节点，rect 会被运行时跳过并给出 warning（需要容器内定位请重构为非容器父或兄弟节点）。
- `rect` 优先于 `anchor_preset`；显式写四值 anchors+offsets，不用 set_anchors_preset（引擎陷阱：preset 不重置 offsets）。
- 锚点值吸附 0/0.5/1（可读性优先），其余位置保持比例锚点兜底。

### justify space-* 行为（v0.31）

`space-between/around/evenly` 通过注入 `_spacer_N` Control 节点实现（SIZE_EXPAND + stretch_ratio），**不再是近似映射**；注入节点计入 warnings。与子节点 `flex.grow` 并存时，spacer 与 grow 子节点瓜分剩余空间，分配语义与 CSS 不同，会有 warning。

### 布局收敛闭环

`ui_build_layout(tree 含 rect)` → `ui_measure_layout(expect_tree=同一棵 tree，**不带 node_path**)` → 按 `data.layout_verify.diff` 的 Δ 数值修 tree → 循环至全绿 → `ui_build_layout(persist=true)` 原子写 .tscn（pack → tmp → rename）。

- `layout_verify` 结构：`targets`（期望 rect 清单）/ `diff`（逐节点 target vs actual 的 Δ，容差默认 2px）/ `overlaps`（兄弟节点重叠）/ `out_of_bounds`（溢出父边界）。
- **坐标系前提**：rect 为视口绝对几何；measured 的 `global_position` 与之同构要求"树挂场景根下且根在原点"——expect_tree 用 build 的同一棵树、measure 不带 node_path 即满足（路径同构约定，两种 path 逐一对齐）。
- `ui_measure_layout` 单独使用时：`node_path` 可选（省略则从场景根整树测），`max_depth` 默认 16（上限 64），等布局稳定（连续帧快照一致或最多 5 帧）后输出。

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
