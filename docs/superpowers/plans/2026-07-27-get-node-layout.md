# get_node_layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 game_query method `get_node_layout`，一次返回全类型节点布局快照（type + 成对 position/global_position + Control anchor/offset + Sprite2D centered + Node3D Vector3，全走 `_jsonify`），治"三种坐标系混算"。

**Architecture:** GD 端 `mcp_bridge.gd` 新增 `_cmd_get_node_layout`（按 CanvasItem/Control/Sprite2D/Node3D 独立 `if` 分层，走 `_jsonify`）+ `match` 分支 + 默认分支友好错误；TS 端 `game-bridge.ts` 三处白名单 + schema description；返回 `{layout:{字段}, node:path}`。

**Tech Stack:** TypeScript（MCP server, vitest 单测）+ GDScript（Godot 4 bridge autoload）+ L2 E2E（运行时游戏，`GODOT_MCP_E2E_L2=1`）。

## Global Constraints

- GDScript tab 缩进（`mcp_bridge.gd`）
- 变换字段全走 `_jsonify`（float 走 default 透传，与 Node3D rotation 口径统一）
- `position` + `global_position` 成对返回（所有有 position 的类型）
- `visible` 横切（`if node is CanvasItem or node is Node3D`）
- 变换字段按 Node2D/Control/Node3D 实际定义类归属（非 CanvasItem 基类属性）
- Sprite2D 独立 `if` 非 `elif`（叠加 Node2D 变换层）
- `rotation` 统一 radians（2D float / 3D Vector3）
- Control 的 `rect` 用 local `get_rect()`
- wrapper `{layout:{字段}, node:path}`，layout 内**不含 path**
- PATH 校验复用 `validateBridgePath`（game-bridge.ts:644，不新增校验代码）
- 不重构 `_extract_ui_data`（YAGNI）
- L2 测试本地 `GODOT_MCP_E2E_L2=1`，**不在 CI**
- `mcp_bridge.gd` 部署到**项目根**（非 addons/），由 `game_bridge_install` 拷贝

---

## Task 0: Control 属性前提核实（Step 0，实现前 gate）

**Files:** 无（核实步骤，不写产品代码）

**Interfaces:** 无

- [ ] **Step 1: 用 execute_gdscript 打印 Control 的关键属性**

跑（headless，`load_autoloads=false`）：
```gdscript
var c = Control.new()
add_child(c)
c.position = Vector2(10, 20)
c.size = Vector2(64, 32)
var want = ["position","global_position","rotation","scale","size","anchor_left","anchor_right","anchor_top","anchor_bottom","offset_left","offset_right","offset_top","offset_bottom","pivot_offset"]
var found: Array = []
for p in c.get_property_list():
	if p["name"] in want:
		found.append(p["name"])
_mcp_output("found", found)
_mcp_output("missing", want.filter(func(n): return n not in found))
_mcp_done()
```

- [ ] **Step 2: 确认 14 个属性全部命中**

Expected: `missing: []`（14 个全部 found）。
若有缺失 → 停，从 spec §3.2 Control 分支移除缺失属性 + 同步本 plan Task 2 Step 4 的函数代码，再继续。

---

## Task 1: TS 白名单 + schema description + 单测 + build-matrix

**Files:**
- Modify: `src/tools/game-bridge.ts:413`（QUERY_METHODS 加 export）、`:414`（加 method）、`:420`（BRIDGE_READ_ONLY_METHODS 加 method）、`:384`（schema description）
- Test: `test/game-bridge-get-node-layout.test.ts`（新建）

**Interfaces:**
- Produces: TS 端 `allowed.has("get_node_layout")` 通过（game-bridge.ts:635），method 能经 game_query 通到 GD

**背景**（已核实）：`:413` `const QUERY_METHODS`（**未 export**），`:419` `export const BRIDGE_READ_ONLY_METHODS`（已 export）。两者都是 `Set`（用 `.has`，非数组 `.toContain`）。本任务给 QUERY_METHODS 加 export 让测试可守护两个集合。

- [ ] **Step 1: 写失败测试**

新建 `test/game-bridge-get-node-layout.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { QUERY_METHODS, BRIDGE_READ_ONLY_METHODS } from '../src/tools/game-bridge';

describe('get_node_layout whitelist', () => {
  it('get_node_layout 在 QUERY_METHODS（game_query allowed 集合）', () => {
    expect(QUERY_METHODS.has('get_node_layout')).toBe(true);
  });
  it('get_node_layout 在 BRIDGE_READ_ONLY_METHODS（只读）', () => {
    expect(BRIDGE_READ_ONLY_METHODS.has('get_node_layout')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/game-bridge-get-node-layout.test.ts`
Expected: FAIL（`QUERY_METHODS` 未 export → import 报错；且 method 不在两集合）

- [ ] **Step 3: 加 export + 白名单 + schema description**

`game-bridge.ts:413`：`const QUERY_METHODS = new Set([` → `export const QUERY_METHODS = new Set([`
`game-bridge.ts:414`：`'get_node_properties',` 后加 `'get_node_layout',`
`game-bridge.ts:420`：`'get_node_properties',` 后加 `'get_node_layout',`
`game-bridge.ts:384`：schema description 文本 `get_node_properties` 后加 `, get_node_layout`

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/game-bridge-get-node-layout.test.ts`
Expected: PASS（两个 has 都 true）

- [ ] **Step 5: 重建 capability-matrix**

Run: `npm run build-matrix`
验证：`grep -n get_node_layout docs/capability-matrix.json` 应命中（schema description 含 → matrix 文本自动同步）

- [ ] **Step 6: tsc + 全量单测回归**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 0 errors；vitest 全绿（pre-existing 4 failed 除外——ToolDispatcher T11 elicitation 等，非本任务引入）

- [ ] **Step 7: commit**

```bash
git add src/tools/game-bridge.ts test/game-bridge-get-node-layout.test.ts docs/capability-matrix.json docs/capability-matrix.md
git commit -m "feat(bridge): get_node_layout TS 白名单 + schema + matrix

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: GD `_cmd_get_node_layout` + match 分支 + 默认分支友好错误 + L2 字段测试

**Files:**
- Modify: `src/scripts/mcp_bridge.gd:531`（match 加 get_node_layout 分支，在 get_node_properties 分支后）、`:578-579`（默认分支友好错误）、新增 `_cmd_get_node_layout` 函数（在 `_cmd_get_node_properties` 函数后）
- Test: `test/e2e-bridge-get-node-layout.test.ts`（L2，新建）

**Interfaces:**
- Consumes: Task 1 的 TS 白名单（method 经 game_query 通到 GD）
- Produces: `game_query(method="get_node_layout", params={path:"/root/..."})` 返回 `{layout:{...}, node:path}`

- [ ] **Step 1: 写 L2 字段级测试（失败）**

新建 `test/e2e-bridge-get-node-layout.test.ts`。用 `find_nodes` 动态发现各类型节点路径（不硬编码），对齐现有 L2 模式（`test/e2e-full-tool-verification.test.ts` 的 run_project + bridge 调用 + `GODOT_MCP_E2E_L2` skipIf + afterEach stopProject + `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true` env，记忆 `l2-bridge-test-pitfalls`）：
```typescript
/**
 * 契约：本 method 字段级守护在 L2（本地），不在 CI。
 * 改 mcp_bridge.gd 字段分层后须本地跑 L2 回归（GODOT_MCP_E2E_L2=1）。
 * CI 绿不代表字段正确性通过。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
// 对齐现有 L2 helper import（runProject/stopProject/callTool）

const RUN = process.env.GODOT_MCP_E2E_L2 === '1';

async function findNodePath(type: string): Promise<string | undefined> {
  const r = await callTool('game', { action: 'game_query', method: 'find_nodes', params: { type, limit: 1 } });
  return r?.nodes?.[0]?.path;
}

describe.skipIf(!RUN)('get_node_layout 字段级 (L2)', () => {
  let controlPath: string | undefined;
  let spritePath: string | undefined;
  let node3dPath: string | undefined;

  beforeAll(async () => {
    // setup：game_bridge_install + run_project(wait_for_bridge=true) + PERSISTENT_SECRET env
    controlPath = await findNodePath('Control');
    spritePath = await findNodePath('Sprite2D');
    node3dPath = await findNodePath('Node3D');
  });
  // afterEach: stopProject（kill 进程；单 it 串行，记忆 l2-bridge-test-pitfalls）

  it('Control: visible/z_index + position+global_position 成对 + size/rect/anchor/offset/pivot', async () => {
    if (!controlPath) return; // 测试游戏无 Control 则跳过
    const L = (await callTool('game', { action: 'game_query', method: 'get_node_layout', params: { path: controlPath } })).layout;
    expect(typeof L.visible).toBe('boolean');
    expect(L.z_index).toEqual(expect.any(Number));
    expect(L.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(L.global_position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(L.size).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(L.rect).toMatchObject({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) });
    ['anchor_left','anchor_right','anchor_top','anchor_bottom','offset_left','offset_right','offset_top','offset_bottom'].forEach(k => expect(L[k]).toEqual(expect.any(Number)));
    expect(L.pivot_offset).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('Sprite2D: Node2D 变换层 + centered/offset 叠加', async () => {
    if (!spritePath) return;
    const L = (await callTool('game', { action: 'game_query', method: 'get_node_layout', params: { path: spritePath } })).layout;
    expect(L.type).toBe('Sprite2D');
    expect(L.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) }); // Node2D 变换层
    expect(L.global_position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(L.rotation).toEqual(expect.any(Number));   // float radians
    expect(L.centered).toEqual(expect.any(Boolean));  // Sprite2D 层
    expect(L.offset).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('Node3D: 有 visible、无 z_index、Vector3 position+global_position 成对', async () => {
    if (!node3dPath) return;
    const L = (await callTool('game', { action: 'game_query', method: 'get_node_layout', params: { path: node3dPath } })).layout;
    expect(typeof L.visible).toBe('boolean');
    expect(L.z_index).toBeUndefined();
    expect(L.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
    expect(L.global_position).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
    expect(L.rotation).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }); // Vector3 radians
  });

  it('Vector2/Vector3/Rect2 正确序列化（非 "(x,y)" 字符串）', async () => {
    if (!controlPath) return;
    const L = (await callTool('game', { action: 'game_query', method: 'get_node_layout', params: { path: controlPath } })).layout;
    expect(typeof L.position).toBe('object'); // 非 "(120, 80)" 字符串
    expect(L.rect).toMatchObject({ w: expect.any(Number), h: expect.any(Number) });
  });
});
```

- [ ] **Step 2: 跑 L2 确认失败**

Run: `GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-bridge-get-node-layout.test.ts`
Expected: FAIL（GD 返 `-32601 Method not found: get_node_layout`，match 无分支）

- [ ] **Step 3: 加 match 分支**

`src/scripts/mcp_bridge.gd:531`（`"get_node_properties"` 分支后）加：
```gdscript
		"get_node_layout":
			result = _cmd_get_node_layout(params)
```

- [ ] **Step 4: 加 `_cmd_get_node_layout` 函数**

在 `_cmd_get_node_properties` 函数体后新增（spec §3.2，含 nit 1 修正——rotation 走 `_jsonify`）：
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
	# 变换字段（P2）：Node2D/Control 各自定义，读取代码相同合并；Node3D 在下面用 Vector3 覆盖。
	if node is Node2D or node is Control:
		data["position"] = _jsonify(node.position)
		data["global_position"] = _jsonify(node.global_position)
		data["rotation"] = _jsonify(node.rotation)
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
		data["position"] = _jsonify(node.position)
		data["global_position"] = _jsonify(node.global_position)
		data["rotation"] = _jsonify(node.rotation)
		data["scale"] = _jsonify(node.scale)
	# 注：global_position 节点未入树时引擎静默返 ZERO（Node3D.xml 原文），调用方见 0 须警惕未入树。
	return {"layout": data, "node": path}
```

- [ ] **Step 5: 改默认分支友好错误**

`src/scripts/mcp_bridge.gd:578-579`：
```gdscript
		_:
			error = {"code": -32601, "message": "Method not found: %s. 若为新增 method（如 get_node_layout），项目根 mcp_bridge.gd 可能版本过旧，请重新 game_bridge_install 或同步上游 src/scripts/mcp_bridge.gd。" % method}
```

- [ ] **Step 6: check:gdscript 语法**

Run: `npm run check:gdscript`
Expected: errors=0（含 `mcp_bridge.gd` 改动）

- [ ] **Step 7: 跑 L2 确认通过**

Run: `GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-bridge-get-node-layout.test.ts`
Expected: PASS（4 个 it 全过；若测试游戏缺某类型节点，对应 it 因 `if (!path) return` 跳过——这是可接受的 L2 项目相关性，但 CardGame2 应同时有 Control/Sprite2D/Node3D）

- [ ] **Step 8: commit**

```bash
git add src/scripts/mcp_bridge.gd test/e2e-bridge-get-node-layout.test.ts
git commit -m "feat(bridge): get_node_layout GD 实现 + L2 字段测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 文档（bridge rule method 表 + engine-quirks）

**Files:**
- Modify: `.claude/rules/godot-mcp-bridge.md`（game_query method 表加 `get_node_layout`）
- Modify: `.claude/rules/godot-mcp-engine-quirks.md`（「节点定位与坐标实测」段补 `get_node_layout` + Node3D.scale ADVISORY）

**Interfaces:** 无

- [ ] **Step 1: bridge rule method 表加行**

`godot-mcp-bridge.md` game_query method 表，在 `get_node_properties` 行后加：
```
| `get_node_layout` | 获取节点完整布局快照（type + position/global_position 成对 + Control anchor/offset + Sprite2D centered + Node3D Vector3，全走 _jsonify） |
```

- [ ] **Step 2: engine-quirks 节点定位段补 get_node_layout**

`godot-mcp-engine-quirks.md`「节点定位与坐标实测」段的"定位类问题先实测不纸面猜"bullet 内补一句："`get_node_layout` method 一次返全布局（含 `global_position` 成对），优先于手动拼 `get_node_properties` 扁平 dump。"

- [ ] **Step 3: engine-quirks 补 Node3D.scale ADVISORY**

`godot-mcp-engine-quirks.md`「节点定位与坐标实测」段末加：
```
- **Node3D.scale 对部分节点无效**：Node3D.xml 原文 "The behavior of some 3D node types is not affected by this property. These include Light3D, Camera3D, AudioStreamPlayer3D"。`get_node_layout` 照读这些节点的 scale 值，但引擎忽略——AI 勿用 scale 对这几类节点做布局推断。关联：game_query(get_node_layout) Node3D 分支。
```

- [ ] **Step 4: commit**

```bash
git add .claude/rules/godot-mcp-bridge.md .claude/rules/godot-mcp-engine-quirks.md
git commit -m "docs(bridge): get_node_layout method 表 + engine-quirks 补强

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 部署同步 + 反馈回标 + 开发日志（收尾）

**Files:**
- Modify: `D:\workspace\projects\CardGame2\mcp_bridge.gd`（cp 上游）
- Modify: `D:\workspace\projects\messenger-godot\mcp_bridge.gd`（cp 上游，**仅若**该项目根存在该文件——先确认）
- Modify: `D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md`（bridge 分区 2026-07-26 那条 🔴 回标 🟢 + commit hash）
- Create: `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-27 get_node_layout 实现.md`

**Interfaces:** 无（收尾）

- [ ] **Step 1: cp mcp_bridge.gd 到分发项目**

```bash
cp D:/GitHub/godot-mcp-enhanced/src/scripts/mcp_bridge.gd D:/workspace/projects/CardGame2/mcp_bridge.gd
# messenger-godot：先 ls D:/workspace/projects/messenger-godot/mcp_bridge.gd，存在才 cp
```

- [ ] **Step 2: CardGame2 实跑验证（教训闭环）**

在 CardGame2 会话：确认 `mcp_bridge.gd` autoload → `run_project`（bridge 连上）→ `game_query(method="get_node_layout", params={path:"/root/.../<角标节点>"})` → 确认 `type` + `global_position` 一次拿到，复现教训场景一次定位成功（对照 2026-07-26 反复改 lock 4 次的弯路）。

- [ ] **Step 3: 反馈回标**

`D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md` bridge 分区 2026-07-26 那条：
- 状态 🔴 → 🟢
- "工具方文档已补强" → "工具方已实现 `get_node_layout` 治本（commit `<Task 2 GD commit hash>`）"
- frontmatter `last-updated` 更新

- [ ] **Step 4: 开发日志**

新建 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-27 get_node_layout 实现.md`，含 frontmatter（date/project/systems/status）+ `> [!summary]` + `> [!check] 修改的文件` + `> [!todo]`（messenger-godot 是否同步、其他项目）。

- [ ] **Step 5: verify_delivery（可选）+ 收尾**

本仓库 Task 4 无新改动（都在仓库外）。可选跑 `verify_delivery` 确认场景树 + 脚本健康。Obsidian 文件不在本仓库 git，无需 commit。
