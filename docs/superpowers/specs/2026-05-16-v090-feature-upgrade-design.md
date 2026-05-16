# v0.9.0 功能升级设计文档

> **版本**: v0.9.0 | **日期**: 2026-05-16 | **状态**: 已批准

## 目标

godot-mcp-enhanced v0.9.0：三线并行（功能补齐 + 质量提升 + 性能优化），工具数 100 → ~123，测试覆盖 0.12:1 → 0.20:1，零新依赖。

## 当前基线

- **工具数**: 100 个，20 个模块，13,533 行 TypeScript
- **运行时依赖**: `@modelcontextprotocol/sdk` + `ws`
- **已有能力**: Editor WebSocket, Game Bridge, GDScript 代码生成, API 内省
- **测试**: 1,614 行，0.12:1 覆盖率

---

## P1 — UI/Theme 系统（+8 工具）

### 新建模块: `src/tools/ui-tools.ts`（~650 行）

| 工具 | 职责 |
|------|------|
| `ui_create_control` | 创建 Control 节点（20+ 类型白名单），自动设锚点/尺寸 |
| `ui_set_layout` | 设置锚点/边距/最小尺寸/自定义最小尺寸/增长方向 |
| `ui_set_theme` | 创建/附加/保存 Theme 资源，设置主题属性（字体/颜色/样式盒） |
| `ui_get_layout` | 读取 Control 节点的布局信息（锚点/边距/全局矩形） |
| `ui_anchor_preset` | 一键应用 16 种锚点预设（Full Rect/Center/Left Wide 等） |
| `ui_container_add` | 向 Container 节点添加子节点并设置容器特定属性 |
| `theme_create` | 创建空 Theme 或从节点提取 Theme |
| `theme_set_font_color` | 批量设置 Theme 的默认字体/颜色/常量/样式盒 |

### Control 类型白名单

Button, Label, Panel, LineEdit, TextEdit, HSlider, VSlider, CheckBox, CheckButton, OptionButton, SpinBox, ProgressBar, TextureRect, ColorPickerButton, TabContainer, Tree, ItemList, MarginContainer, HBoxContainer, VBoxContainer, GridContainer, CenterContainer, ScrollContainer, PanelContainer, HSplitContainer, VSplitContainer, NinePatchRect

### 锚点预设

映射 Godot `LayoutPreset` 枚举（0-15），提供名称到值映射：
`top_left, top_right, bottom_left, bottom_right, center_left, center_top, center_right, center_bottom, center, left_wide, top_wide, right_wide, bottom_wide, vcenter_wide, hcenter_wide, full_rect`

### Theme 操作

- `set_default_font(font)` — 设置默认字体
- `set_color(name, type, color)` — 设置颜色项
- `set_constant(name, type, value)` — 设置常量项
- `set_stylebox(name, type, stylebox)` — 设置样式盒

### 质量配套

- 拆分 `godot-ops.ts`：将 signal 操作提取到 `src/tools/signal-ops.ts`，将 node_create_3d/collision_overlay 提取到 `src/tools/node-3d-ops.ts`，将 physics_raycast/body_info 提取到 `src/tools/physics-ops.ts`
- godot-ops.ts 从 1112 行降至约 700 行

---

## P2 — 高级动画编辑（+6 工具）

### 扩展模块: `src/tools/animation-ops.ts` + `src/tools/animtree.ts`

| 工具 | 职责 | 模块 |
|------|------|------|
| `animation` (重构) | 现有 12 action + 新增 create/delete/update_props | animation-ops.ts |
| `animation_track` | 添加/移除/查询轨道（9 种类型） | animation-ops.ts |
| `animation_keyframe` | 添加/移除/更新关键帧（时间/值/过渡曲线） | animation-ops.ts |
| `animation_curve` | 创建/编辑贝塞尔曲线轨道，设置控制点 | animation-ops.ts |
| `animation_blend` | 混合两个动画 | animation-ops.ts |
| `animtree_state_edit` | 编辑 AnimationTree 状态机的状态位置/混合值 | animtree.ts |

### Track 类型枚举

映射 Godot TrackType：value(0), position_3d(1), rotation_3d(2), scale_3d(3), blend_shape(4), method(5), bezier(6), audio(7), animation(8)

### 关键帧操作

- `Animation.add_track(type, at_position)` — 添加轨道
- `Animation.track_insert_key(track_idx, time, value, transition)` — 插入关键帧
- `Animation.track_remove_key(track_idx, key_idx)` — 移除关键帧
- `Animation.track_set_key_transition(track_idx, key_idx, transition)` — 设置过渡曲线
- `Animation.track_set_key_value(track_idx, key_idx, value)` — 更新关键帧值

### 贝塞尔曲线

- `track_set_key_in_handle(track_idx, key_idx, in_handle)` — 入控制点
- `track_set_key_out_handle(track_idx, key_idx, out_handle)` — 出控制点

### 性能配套

- **API 文档缓存**: `godot-docs.ts` 添加 LRU 缓存层，首次加载 `extension_api.json` 后复用解析结果
- **Godot 路径缓存**: `findGodot()` 结果缓存，进程生命周期内只搜索一次文件系统

---

## P3 — 录制/回放系统（+5 工具）

### 新建模块: `src/tools/recording.ts`（~500 行）

| 工具 | 职责 |
|------|------|
| `recording_start` | 开始录制输入事件（键鼠），通过 Game Bridge 连接 |
| `recording_stop` | 停止录制，返回事件序列 JSON |
| `recording_save` | 将事件序列保存为 JSON 文件 |
| `recording_load` | 加载已保存的录制文件 |
| `recording_play` | 按原始时间间隔回放录制的事件序列 |

### 事件序列格式

```json
{
  "version": 1,
  "duration_ms": 5230,
  "events": [
    {"type": "key", "keycode": 87, "pressed": true, "time_ms": 0},
    {"type": "mouse_click", "position": [400, 300], "button": 1, "pressed": true, "time_ms": 1200},
    {"type": "mouse_move", "position": [450, 310], "time_ms": 1250}
  ]
}
```

### 录制实现

- 通过 GDScript 在 Game Bridge 侧注册 `_input()` 回调
- 捕获 `InputEventKey/InputEventMouseButton/InputEventMouseMotion` 事件
- 每个事件记录相对录制开始的毫秒时间戳

### 回放实现

- 通过 `Input.parse_input_event()` 发送事件
- 使用 Timer 按原始时间间隔精确调度
- 支持速度倍率（0.5x / 1.0x / 2.0x）

### 持久化

- 保存为 JSON 文件到 `res://recordings/` 目录
- 文件名格式：`recording_YYYYMMDD_HHMMSS.json`

### 性能配套

- **GDScript 预热池**: 保持 1 个空闲 headless Godot 进程，复用执行后续 GDScript
  - 最大空闲进程数: 1
  - 空闲超时: 30 秒自动关闭
  - autoload 需求时不复用（需要完整场景加载）
  - 预计减少 50%+ 冷启动时间

---

## P4 — 编辑器插件扩展 + 质量收尾（+4 同步命令模块）

### 编辑器同步命令模块

| 模块文件 | 对应工具 | 命令数 |
|----------|---------|--------|
| `addons/mcp_bridge/commands/ui_commands.gd` | ui_* 8 工具 | 8 |
| `addons/mcp_bridge/commands/animation_commands.gd` | animation_track/keyframe/curve/blend | 4 |
| `addons/mcp_bridge/commands/recording_commands.gd` | recording_* 5 工具 | 3 |

同步命令允许编辑器内直接操作，与 headless 工具共享参数格式。

### 质量收尾

| 项目 | 目标 |
|------|------|
| 版本号 | package.json + GodotServer.ts VERSION 变为 0.9.0 |
| 测试覆盖 | 新增约 120 测试用例，0.12:1 变为 0.20:1 |
| 大文件拆分 | godot-ops.ts 1112 变为约 700（P1 已完成） |
| ROADMAP.md | 添加 v0.9.0 完成记录 |

---

## 架构影响

### 新增文件

```
src/tools/ui-tools.ts         — P1 UI/Theme 工具（约 650 行）
src/tools/recording.ts        — P3 录制/回放工具（约 500 行）
src/tools/signal-ops.ts       — P1 从 godot-ops.ts 拆出（约 200 行）
src/tools/node-3d-ops.ts      — P1 从 godot-ops.ts 拆出（约 200 行）
src/tools/physics-ops.ts      — P1 从 godot-ops.ts 拆出（约 200 行）
test/ui-tools.test.js         — P1 测试
test/recording.test.js        — P3 测试
test/animation-track.test.js  — P2 测试
addons/mcp_bridge/commands/ui_commands.gd          — P4
addons/mcp_bridge/commands/animation_commands.gd   — P4
addons/mcp_bridge/commands/recording_commands.gd   — P4
```

### 修改文件

```
src/tools/animation-ops.ts    — P2 新增 5 工具
src/tools/animtree.ts         — P2 新增 animtree_state_edit
src/gdscript-executor.ts      — P3 预热池机制
src/godot-docs.ts             — P2 LRU 缓存
src/GodotServer.ts            — 注册新模块 + VERSION 更新
src/helpers.ts                — Godot 路径缓存
package.json                  — version 变为 0.9.0
```

### 零新依赖

所有新功能通过 GDScript 代码生成 + headless 执行实现，不引入新的 npm 依赖。

---

## 错误处理

### UI/Theme 错误码

```typescript
const UI_ERROR_CODES = {
  INVALID_CONTROL_TYPE: 'INVALID_CONTROL_TYPE',
  INVALID_ANCHOR_PRESET: 'INVALID_ANCHOR_PRESET',
  THEME_NOT_FOUND: 'THEME_NOT_FOUND',
  INVALID_THEME_PROPERTY: 'INVALID_THEME_PROPERTY',
};
```

### 录制/回放错误码

```typescript
const RECORDING_ERROR_CODES = {
  BRIDGE_NOT_CONNECTED: 'BRIDGE_NOT_CONNECTED',
  RECORDING_IN_PROGRESS: 'RECORDING_IN_PROGRESS',
  NO_RECORDING: 'NO_RECORDING',
  RECORDING_FILE_NOT_FOUND: 'RECORDING_FILE_NOT_FOUND',
  INVALID_RECORDING_FORMAT: 'INVALID_RECORDING_FORMAT',
};
```

---

## 测试策略

### 每阶段新增测试

| 阶段 | 新增测试 | 重点场景 |
|------|---------|---------|
| P1 | 约 35 | Control 白名单校验、锚点预设、Theme 创建/保存/加载 |
| P2 | 约 30 | Track 添加/删除、关键帧操作、曲线控制点、混合 |
| P3 | 约 30 | 录制启停、事件序列格式、回放时间间隔、文件持久化 |
| P4 | 约 25 | Editor 命令格式、参数传递、错误处理 |

总计约 120 新测试用例，测试代码从 1,614 行增至约 3,200 行，覆盖率达到 0.20:1。

---

## Godot 版本要求

最低支持 Godot 4.2+。所有新 API（Theme 操作、Animation 轨道操作、InputEvent 回放）在 4.0+ 可用。
