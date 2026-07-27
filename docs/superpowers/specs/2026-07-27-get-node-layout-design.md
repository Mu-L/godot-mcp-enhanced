# get_node_layout：节点布局快照 method 设计

**日期**：2026-07-27
**状态**：设计已认可，待写实施计划
**来源教训**：2026-07-26 CardGame2 坐标/布局定位弯路（`D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-27 坐标定位教训回流与rules补强.md`）

---

## 1. 背景与动机

2026-07-26 在 `D:\workspace\projects\CardGame2` 调试 UI 坐标，据"偏右上"反馈想当然改 lock 4 次无果，bridge 实测才发现偏的是角标。根因：没第一时间用 bridge 实测真实坐标 / 类型。

盘点 bridge 工具实现层（`src/scripts/mcp_bridge.gd`）发现几个**真实缺口**，直接阻碍"实测→改→验证"闭环：

- `_cmd_get_node_properties`（`:715`）漏调 `_jsonify`（`:787`），Vector2/Rect2 被 GDScript `JSON.stringify` 序列化成 `"(x, y)"` 字符串，难解析；且不返回节点类型，AI 无法判断 Control（anchor 体系）vs Sprite2D（centered 体系）坐标系。
- `_node_info`（`:673`）对 Node2D 只给 position、无 rotation/scale/global_position；`_extract_ui_data`（`:1351`）只遍历 Control。
- **无任何 method 一次返回结构化布局快照**（type + position + global_position + size + anchor + offset + …）。

`get_node_properties` 最接近，但是扁平 dump + 序列化瑕疵。新增专用 `get_node_layout` 治本。

---

## 2. 目标 / 非目标

**目标**：
- 新增 game_query method `get_node_layout`，一次返回带 `type` 的结构化布局快照，所有变换字段走 `_jsonify` 正确序列化。
- `position` + `global_position` **成对**返回（治"AI 把局部 position 当全局用"根因）。
- 覆盖 Node2D / Control / Sprite2D / Node3D 全类型。

**非目标（YAGNI）**：
- 不重构 `_extract_ui_data`（字段测试零守护，裸奔重构风险，见 §7）。
- 不修 `_cmd_get_node_properties` 的 `_jsonify` 瑕疵（独立项，本 spec 不含）。
- 不加 `transform`（pos+rot+scale 已覆盖；`_jsonify` 对 Transform 只取 origin 不全）。
- 不加 `texture`（布局快照聚焦几何）。

---

## 3. 设计

### 3.1 字段分层（按实际定义类，P2 语义修正）

- **所有节点**：`type`（`node.get_class()`）
- **横切（P1）**：`visible` —— `if node is CanvasItem or node is Node3D`（CanvasItem.visible 与 Node3D.visible 各自定义，都叫 visible）
- **CanvasItem 专属**：`z_index`（Node2D/Control 有；Node3D 无）
- **变换字段（P2：分属 Node2D/Control/Node3D 各自定义，非 CanvasItem 基类属性）**：
  - Node2D（含 Sprite2D）：`position`{x,y} + `global_position`{x,y} **成对** + `rotation`（float, radians）+ `scale`{x,y}
  - Control：`position`{x,y} + `global_position`{x,y} 成对 + `rotation`（float, radians）+ `scale`{x,y}
  - Node3D：`position`{x,y,z} + `global_position`{x,y,z} 成对 + `rotation`{x,y,z}（radians）+ `scale`{x,y,z}
- **Control 布局**：`size`{x,y} + `rect`{x,y,w,h}（local `get_rect()`）+ `anchor_left/right/top/bottom` + `offset_left/right/top/bottom` + `pivot_offset`{x,y}
- **Sprite2D**：`centered`（bool）+ `offset`{x,y}（纹理偏移，与 Control 的 `offset_*` 不冲突——Sprite2D 不是 Control）

### 3.2 实现轮廓（`_cmd_get_node_layout`，独立 `if` 叠加，P3）

```gdscript
func _cmd_get_node_layout(params: Dictionary) -> Variant:
    var path: String = str(params.get("path", ""))
    var node := get_node_or_null(path)
    if not is_instance_valid(node):
        return {"error": "NODE_NOT_FOUND", "code": -1, "path": path}
    var data: Dictionary = {}
    data["type"] = node.get_class()
    # visible 横切（P1）：CanvasItem 与 Node3D 各自定义 visible
    if node is CanvasItem or node is Node3D:
        data["visible"] = node.visible
    if node is CanvasItem:
        data["z_index"] = node.z_index
    # 变换字段（P2）：Node2D/Control 各自定义 position/global_position/rotation/scale，
    # 读取代码相同合并；Node3D 在下面独立分支用 Vector3 版覆盖。
    if node is Node2D or node is Control:
        data["position"] = _jsonify(node.position)
        data["global_position"] = _jsonify(node.global_position)
        data["rotation"] = _jsonify(node.rotation)  # float 走 _jsonify default 透传，与 Node3D rotation 口径统一
        data["scale"] = _jsonify(node.scale)
    if node is Control:
        data["size"] = _jsonify(node.size)
        data["rect"] = _jsonify(node.get_rect())
        data["anchor_left"] = node.anchor_left
        data["anchor_right"] = node.anchor_right
        data["anchor_top"] = node.anchor_top
        data["anchor_bottom"] = node.anchor_bottom
        data["offset_left"] = node.offset_left
        data["offset_right"] = node.offset_right
        data["offset_top"] = node.offset_top
        data["offset_bottom"] = node.offset_bottom
        data["pivot_offset"] = _jsonify(node.pivot_offset)
    # 独立 if 非 elif（P3）：Sprite2D 同时命中上面的 Node2D 变换层 + 这里的专属层
    if node is Sprite2D:
        data["centered"] = node.centered
        data["offset"] = _jsonify(node.offset)
    if node is Node3D:
        data["position"] = _jsonify(node.position)        # Vector3 覆盖
        data["global_position"] = _jsonify(node.global_position)
        data["rotation"] = _jsonify(node.rotation)        # Vector3
        data["scale"] = _jsonify(node.scale)
    # 注：global_position 在节点未入树时引擎静默返 ZERO（Node3D.xml 原文），调用方见 0 须警惕未入树。
    return {"layout": data, "node": path}
```

### 3.3 返回结构（wrapper，对齐 `_cmd_get_node_properties`）

`_cmd_get_node_properties` 返回 `{properties:{...}, node:path}`（用 wrapper）。`get_node_layout` 是同级"单节点读" method，沿用 `{layout:{字段}, node:path}`。layout 内**不含 path**（避免与顶层 node 重复，对齐 get_node_properties 的 properties 内不含 path）。

**返回示例**：

```jsonc
// TextureRect（Control）
{"layout":{"type":"TextureRect","visible":true,"z_index":0,
  "position":{"x":120,"y":80},"global_position":{"x":120,"y":80},
  "rotation":0,"scale":{"x":1,"y":1},"size":{"x":64,"y":64},
  "rect":{"x":120,"y":80,"w":64,"h":64},
  "anchor_left":0.5,"anchor_right":0.5,"anchor_top":0.5,"anchor_bottom":0.5,
  "offset_left":-32,"offset_right":32,"offset_top":-32,"offset_bottom":32,
  "pivot_offset":{"x":32,"y":32}},"node":"root/UI/Icon"}

// Sprite2D（Node2D 变换层 + Sprite2D 层叠加）
{"layout":{"type":"Sprite2D","visible":true,"z_index":0,
  "position":{"x":0,"y":0},"global_position":{"x":240,"y":160},
  "rotation":1.5708,"scale":{"x":1,"y":1},
  "centered":true,"offset":{"x":0,"y":0}},"node":"root/Player"}

// Camera3D（Node3D，有 visible 横切，无 z_index）
{"layout":{"type":"Camera3D","visible":true,
  "position":{"x":0,"y":5,"z":10},"global_position":{"x":0,"y":5,"z":10},
  "rotation":{"x":-0.3,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1}},"node":"root/Cam"}
```

---

## 4. 改动面

| 文件 | 改动 |
|------|------|
| `src/scripts/mcp_bridge.gd` | `match` 加 `"get_node_layout": result = _cmd_get_node_layout(params)`（`:530` 附近）+ 新 `_cmd_get_node_layout` 函数（§3.2）+ match 默认分支友好错误（§5c） |
| `src/tools/game-bridge.ts` | 三处加 `get_node_layout`：`QUERY_METHODS`(`:414`) + `BRIDGE_READ_ONLY_METHODS`(`:420`) + schema description(`:384`) |
| `.claude/rules/godot-mcp-bridge.md` | game_query method 表加一行 `get_node_layout` / 获取节点完整布局快照 |
| `.claude/rules/godot-mcp-engine-quirks.md` | 「节点定位与坐标实测」段补"用 `get_node_layout` 一次拿全布局" + ADVISORY：Node3D.scale 对 Light3D/Camera3D/AudioStreamPlayer3D 引擎忽略 |
| `docs/capability-matrix.*` | `npm run build-matrix` 自动同步（schema description 改后 matrix 的 method 文本自动含 get_node_layout，**不独立登记**——matrix 记 tool/action 粒度，method 级不计数） |

**PATH 校验复用**：`get_node_layout` 有 `path` 参数，走 game_query 分支统一的 `validateBridgePath`（`game-bridge.ts:644`，校验 `/root/` 前缀），**无需新校验代码**。

---

## 5. 部署与同步（落实点 1：不能只写"cp"）

### mcp_bridge.gd 分发机制（核实 `game-bridge.ts:545-586`）

- **上游源**：`src/scripts/mcp_bridge.gd`
- `game_bridge_install` 拷贝到**项目根** `<project>/mcp_bridge.gd`（`:555` `destScript = join(projectPath, 'mcp_bridge.gd')`），autoload 注册 `*res://mcp_bridge.gd`（`:568`）。
- **不是** addons/ 副本——`addons/godot_mcp_server/` 是 editor 插件，与 bridge 运行时脚本无关。

### (a) 同步

上游改 `mcp_bridge.gd` 后，分发项目需重新 `game_bridge_install`（覆盖项目根 `mcp_bridge.gd`），或手动 `cp <上游>/src/scripts/mcp_bridge.gd → <project>/mcp_bridge.gd`。

### (b) 分发项目清单（已知）

- `D:\workspace\projects\CardGame2`
- `D:\workspace\projects\messenger-godot`

其他用 bridge 的项目同理（凡项目根有 `mcp_bridge.gd` 的）。

### (c) 旧版本兜底（TS/GD 版本错配）

上游 TS 白名单加了 `get_node_layout`（TS 放行），但旧项目根 `mcp_bridge.gd` 没 match 分支 → GD 走默认分支。**现状**（`:578-579`）：`_:` 分支直接赋 top-level `error = {"code": -32601, "message": "Method not found: %s" % method}`（JSON-RPC 标准 Method not found），经 `:589` 直接返回，TS 端 `sendToBridge` 能看到。（`:583-584` 是另一条路径——把 `result.error` 这类 command-level error 提升到 top-level，与 `_:` 分支无关。）

**增强**（保持 `code: -32601` + `error` dict 结构，仅扩 message 加版本同步提示）：

```gdscript
_:
    error = {"code": -32601, "message": "Method not found: %s. 若为新增 method（如 get_node_layout），项目根 mcp_bridge.gd 可能版本过旧，请重新 game_bridge_install 或同步上游 src/scripts/mcp_bridge.gd。" % method}
```

---

## 6. 测试与验证（落实点 2：L2 是字段级唯一硬门禁）

### 6.1 TS 单测（守白名单）

`get_node_layout ∈ QUERY_METHODS` 且 `∈ BRIDGE_READ_ONLY_METHODS`——防 method 被 TS 端 `allowed.has`（`game-bridge.ts:635`）拒。加到 `test/game-bridge*.test.ts`，对齐现有 method 白名单测试。

### 6.2 L2 集成测试（字段级唯一硬门禁）

**断言字段语义**：
- `visible` 横切：CanvasItem 节点 + Node3D 节点都返 visible
- `position` + `global_position` 成对：所有有 position 的类型都成对返回
- `rotation` 是 radians：Node2D float / Node3D Vector3
- Sprite2D 叠加：返 Node2D 变换（position/rotation/scale）+ Sprite2D 字段（centered/offset）
- Node3D 无 z_index、有 visible
- Control 全布局字段（size/rect/anchor_*/offset_*/pivot_offset）
- Vector2/Vector3/Rect2 正确序列化为 `{x,y}` / `{x,y,z}` / `{x,y,w,h}`（非 `"(x,y)"` 字符串）

**跑法**：`GODOT_MCP_E2E_L2=1` 本地（L2 默认 skip，记忆 `l2-bridge-test-pitfalls`）。

**契约声明（写进 L2 测试文件头部注释）**：

> 本 method 字段级守护在 L2（本地），**不在 CI**。改 `mcp_bridge.gd` 字段分层后须本地跑 L2 回归。CI 绿不代表字段正确性通过。

### 6.3 手动验证

- CardGame2 实跑：复现教训场景，用 `get_node_layout` 读角标 vs lock 的真实 `type` + `global_position`，验证一次定位成功（教训闭环）。
- `verify_delivery`。

### 6.4 诚实交代

字段正确性靠 L2/手动，TS 单测只守白名单——与现有 bridge method 同等水平（不 worse，但也没法更好，除非 L2 进 CI）。这是对 P2 揭示的"`_extract_ui_data` 字段零守护"同类问题的正面应对：**至少把门禁位置写进契约**，让未来维护者知道改字段后须本地跑 L2。

---

## 7. 风险与权衡

| 风险 | 缓解 |
|------|------|
| A（独立读）vs 抽 helper（B）：position/size 两处读取 drift | 接受局部 drift（`get_node_layout` 几何快照 vs `_extract_ui_data` UI 发现语义，用途不同）；一行注释标注同源。不重构 `_extract_ui_data`（测试零守护，裸奔风险）。 |
| L2 不在 CI：字段回归无声 | §6.2 契约声明 + 本地 L2 跑 |
| 旧项目调新 method 裸 unknown | §5(c) GD 默认分支友好错误 |
| Node3D.scale 对 Light3D/Camera3D/AudioStreamPlayer3D 引擎忽略（Node3D.xml 原文） | `engine-quirks.md` 补 ADVISORY（布局快照照读 scale 值，AI 勿对这几类节点用 scale 推断） |
| TS/GD 版本错配（TS 放行 GD 不认识） | §5 同步 + 兜底 |
| `global_position` 节点未入树静默返 ZERO | §3.2 注释标注 |

---

## 8. 决策记录

- **方案 A（独立读，不重构 `_extract_ui_data`）** vs B（抽 helper）：选 A。B 的"低回归"论据被证伪（`test/game-bridge-ui-discover.test.js:31-32` Imp-13 删字段假测试，零守护）。A 符合精确编辑。
- **rotation 统一 radians**：2D/3D 一致 + 零换算（`node.rotation` 直接读）。AI 识 1.5708≈90° 是强项。
- **rect local**：anchor/offset 本就是 local 锚点语义；`global_position` 已成对，global 可推。
- **wrapper `{layout, node}`**：对齐 `_cmd_get_node_properties`（method 级返回）；layout 内去 path 重复。
- **texture 不加**：YAGNI，聚焦几何。
- **visible 横切 / 变换按定义类归属 / Sprite2D 独立 if 叠加**：P1/P2/P3 修正。

---

## 9. 反向链接

- 教训来源：`D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-27 坐标定位教训回流与rules补强.md`
- 反馈条目：`D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md`（bridge 分区 🔴，实现后回标 🟢 + commit hash）
- engine-quirks 补强：`D:\GitHub\godot-mcp-enhanced\.claude\rules\godot-mcp-engine-quirks.md`「节点定位与坐标实测」段
