# godot_get_context readScene 真实采集（批 2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** readScene 三态真实采集（editor/bridge/headless），GDScript 端迭代聚合 nodeCount/typeTopN，TS 端零聚合透传 SceneSnapshot。

**Architecture:** editor 直连 `editorConn.request('editor_get_scene_stats')`（绕过 EditorToolExecutor，只读）→ 插件 `sync_commands.get_scene_stats` 迭代聚合；bridge `sendToBridge('get_scene_stats')` → `mcp_bridge._cmd_get_scene_stats` 迭代聚合（基于 current_scene）；headless null。TS readScene 透传 `{path, root, nodeCount, typeTopN?, truncated?}`。

**Tech Stack:** GDScript（Godot 4.7 + 4.6.2）/ TypeScript / Vitest / bridge TCP / editor WebSocket

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-get-context-readscene-design.md`
**Base:** master `db59903`（批 2 spec 落盘）

## Global Constraints

- GDScript **迭代（非递归）**单遍聚合，规避爆栈（spec §4.1/§9.5）
- `TYPE_WINDOW=2000`（typeTopN 字典窗口）/ `HARD_STOP=50000`（OOM 硬停），**独立于** `_serialize_node` 的 `max_nodes=2000`（序列化上限，mcp_bridge.gd:608）
- editor 入口 `EditorInterface.get_edited_scene_root()`（经 `_get_ei()`）；bridge 入口 `get_tree().current_scene`（**非 root**）
- bridge 分发走 `_handle_command` match（mcp_bridge.gd:522 旁），**不动 `ALLOWED_METHODS`**（:55 是 call_method 白名单）
- editor 分发走 `command_handler.gd` match（:153 旁，`return _sync_commands.xxx()`）
- `EditorConnection.request(method, params)` resolve `msg.result`（裸 result，成功）/ **throw on error**（EditorConnection.ts:276 reject）→ 接线用 try/catch；`isConnected(): boolean`（:523）
- GDScript **无 gut/gdUnit 单测框架**（test/ 全 TS/JS）→ GDScript task 靠 `--headless --import` 编译验证 + Task 3/5 TS 集成测试间接覆盖
- 4.7 + 4.6.2 addon `godot --headless --import --path test/fixtures/gdscript-check` 编译验证（**`--check-only` 假绿，必须 `--import`**；memory [[enhanced-editor-plugin-4.7-incompatible]]）
- `sync_commands.gd:1 extends Node`（原生类）—— 新方法是普通方法不受 super() 限制，但**勿给 `_ready`/`_exit_tree` 等虚函数加 `super()`**（4.6.2 Parse error）
- import 用 `.js` 后缀（ESM）；commit conventional + 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/scripts/mcp_bridge.gd` | `_cmd_get_scene_stats`（迭代，current_scene）+ `_handle_command` :522 分发 | Modify |
| `addons/godot_mcp_server/commands/sync_commands.gd` | `get_scene_stats`（迭代，EditorInterface）+ 顺带修 `_serialize_tree` truncated | Modify |
| `addons/godot_mcp_server/command_handler.gd` | :153 旁加 `editor_get_scene_stats` 分发 | Modify |
| `src/tools/get-context.ts` | `readScene` async 三态 + `setEditorSceneProvider` + `SceneSnapshot` + 改 :184 注释 | Modify |
| `src/GodotServer.ts` | :148 接线 `setEditorSceneProvider` + cleanup 清理 | Modify |
| `test/tools/get-context.test.ts` | readScene 三态 + 降级 + 边界测试 | Modify |

**依赖顺序**：Task 1（bridge GDScript）→ Task 2（editor GDScript）→ Task 3（TS readScene TDD，mock）→ Task 4（GodotServer 接线）→ Task 5（边界 + 全量 + 编译验证）。Task 3 mock 不依赖 GDScript 真跑，但逻辑顺序保持。

---

### Task 1: bridge `_cmd_get_scene_stats`（GDScript 迭代聚合）

**Files:**
- Modify: `src/scripts/mcp_bridge.gd`（`_cmd_get_tree` :596 后加 `_cmd_get_scene_stats`；`_handle_command` :522 后加分发）

**Interfaces:**
- Consumes: `get_tree().current_scene`（非 root）
- Produces: `_cmd_get_scene_stats(params)` 返 `{"stats": {path, root, nodeCount, typeTopN?, truncated?}}` 或 `{"stats": null}`（no current_scene）；`_handle_command` match 加 `"get_scene_stats": result = _cmd_get_scene_stats(params)`

**注意**：GDScript 无单测框架。本 task 验证 = grep 确认改动位置 + GDScript 语法人工 review + Task 3 TS 集成（mock sendToBridge）+ Task 5 bridge 真跑。mcp_bridge.gd 是 `src/scripts/`（运行时 autoload 加载，非 addon --import 范围）。

- [ ] **Step 1: 加 `_cmd_get_scene_stats`（迭代算法，基于 current_scene）**

在 `src/scripts/mcp_bridge.gd` `_cmd_get_tree` 函数后（:605 后、`_serialize_node` :608 前）加：
```gdscript
# 批 2 readScene：基于 current_scene 的场景统计（迭代单遍 stack DFS，无爆栈）。只聚合不传树。
# TYPE_WINDOW: typeTopN 字典维护窗口（>2000 停维护字典省内存，nodeCount 仍准确）
# HARD_STOP: OOM 硬停止（nodeCount 绝对上限）。独立于 _serialize_node max_nodes（序列化上限）。
const TYPE_WINDOW: int = 2000
const HARD_STOP: int = 50000

func _cmd_get_scene_stats(_params: Dictionary) -> Variant:
	var scene := get_tree().current_scene
	if scene == null:
		return {"stats": null}  # no current_scene → TS 透传 null 降级
	var node_count: int = 0
	var type_count: Dictionary = {}
	var truncated: bool = false
	var stack: Array = [scene]
	while stack.size() > 0:
		if node_count >= HARD_STOP:
			truncated = true
			break
		var node: Node = stack.pop_back()
		node_count += 1
		if node_count <= TYPE_WINDOW:
			var cls: String = node.get_class()
			type_count[cls] = int(type_count.get(cls, 0)) + 1
		for c in node.get_children():
			stack.push_back(c)
	var type_top_n: Variant = null
	if node_count <= TYPE_WINDOW:
		var entries: Array = []
		for key in type_count.keys():
			entries.append({"type": key, "n": int(type_count[key])})
		entries.sort_custom(func(a, b): return int(a["n"]) > int(b["n"]))
		type_top_n = entries.slice(0, 5)
	return {
		"stats": {
			"path": scene.scene_file_path,
			"root": scene.name,
			"nodeCount": node_count,
			"typeTopN": type_top_n,
			"truncated": truncated,
		}
	}
```

- [ ] **Step 2: `_handle_command` 加分发（不动 ALLOWED_METHODS）**

在 `src/scripts/mcp_bridge.gd` :522（`"get_tree": result = _cmd_get_tree(params)` 后）加：
```gdscript
		"get_scene_stats":
			result = _cmd_get_scene_stats(params)
```

- [ ] **Step 3: 确认改动位置**

Run: `grep -n "get_scene_stats\|_cmd_get_scene_stats\|TYPE_WINDOW\|HARD_STOP" src/scripts/mcp_bridge.gd`
Expected: ≥4 命中（分发 match + 函数定义 + 2 常量）

- [ ] **Step 4: Commit**

```bash
git add src/scripts/mcp_bridge.gd
git commit -m "feat(bridge): _cmd_get_scene_stats 迭代聚合场景统计（批 2 readScene）

基于 current_scene（非 root）单遍迭代（stack DFS），TYPE_WINDOW=2000
typeTopN 窗口 + HARD_STOP=50000 OOM 硬停。no current_scene → {stats:null}。
_handle_command :522 加分发（不动 ALLOWED_METHODS）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: editor `get_scene_stats` + `command_handler` 分发 + 顺带修 `_serialize_tree` truncated

**Files:**
- Modify: `addons/godot_mcp_server/commands/sync_commands.gd`（:64 `get_scene_tree` 后加 `get_scene_stats`；:123 `_serialize_tree` 顺带加 truncated）
- Modify: `addons/godot_mcp_server/command_handler.gd`（:153 旁加分发）

**Interfaces:**
- Consumes: `EditorInterface.get_edited_scene_root()`（经 `_get_ei()`，参照 :59-63）
- Produces: `get_scene_stats()` 返 `{"result": {success, stats}}` 或 `{"error": {code:-32005, message:"No current scene"}}`；`command_handler.gd` :153 旁加 `"editor_get_scene_stats": return _sync_commands.get_scene_stats()`

- [ ] **Step 1: 加 `get_scene_stats`（迭代算法，基于 EditorInterface）**

在 `sync_commands.gd` :64（`get_scene_tree` 函数后、`_cache_paths_recursive` :67 前）加：
```gdscript
# 批 2 readScene：场景统计（迭代单遍 stack DFS，无爆栈）。只聚合不传树。
# 与 bridge mcp_bridge.gd _cmd_get_scene_stats 同算法（各自实现，跨文件共享成本高 YAGNI）。
const TYPE_WINDOW: int = 2000
const HARD_STOP: int = 50000

func get_scene_stats() -> Dictionary:
	var ei := _get_ei()
	if ei == null:
		return {"error": {"code": -32004, "message": "EditorInterface not available"}}
	var root: Node = ei.get_edited_scene_root()
	if root == null:
		return {"error": {"code": -32005, "message": "No current scene"}}
	var node_count: int = 0
	var type_count: Dictionary = {}
	var truncated: bool = false
	var stack: Array = [root]
	while stack.size() > 0:
		if node_count >= HARD_STOP:
			truncated = true
			break
		var node: Node = stack.pop_back()
		node_count += 1
		if node_count <= TYPE_WINDOW:
			var cls: String = node.get_class()
			type_count[cls] = int(type_count.get(cls, 0)) + 1
		for c in node.get_children():
			stack.push_back(c)
	var type_top_n: Variant = null
	if node_count <= TYPE_WINDOW:
		var entries: Array = []
		for key in type_count.keys():
			entries.append({"type": key, "n": int(type_count[key])})
		entries.sort_custom(func(a, b): return int(a["n"]) > int(b["n"]))
		type_top_n = entries.slice(0, 5)
	return {
		"result": {
			"success": true,
			"stats": {
				"path": root.scene_file_path,
				"root": root.name,
				"nodeCount": node_count,
				"typeTopN": type_top_n,
				"truncated": truncated,
			}
		}
	}
```

- [ ] **Step 2: 顺带修 `_serialize_tree` truncated（ADVISORY 拍板②，一行 elif）**

`sync_commands.gd` :123-134 `_serialize_tree` 当前 depth>=max_depth 截断无标记。改 :133-134（`if depth < max_depth` 块后加 elif）：

当前：
```gdscript
	if depth < max_depth:
		var children = []
		for child in node.get_children():
			children.append(_serialize_tree(child, depth + 1, max_depth))
		result["children"] = children
	return result
```

改：
```gdscript
	if depth < max_depth:
		var children = []
		for child in node.get_children():
			children.append(_serialize_tree(child, depth + 1, max_depth))
		result["children"] = children
	elif node.get_child_count() > 0:
		result["truncated"] = true  # 批 2 顺带修：depth 截断标记（调用方可判断树被截）
	return result
```

> additive（现有消费者读 name/type/path/children，忽略 truncated），不破坏 editor_get_scene_tree 现有行为。

- [ ] **Step 3: `command_handler.gd` 加分发**

`command_handler.gd` :153（`"editor_get_scene_tree": return _sync_commands.get_scene_tree()` 后）加：
```gdscript
		"editor_get_scene_stats":
			return _sync_commands.get_scene_stats()
```

- [ ] **Step 4: 同步 addon 到 fixture + `--import` 编译验证（4.7）**

核实 fixture 同步：`test/fixtures/gdscript-check/addons/godot_mcp_server/` 是 addon 副本。同步改动后跑 --import。

Run:
```bash
cp -r addons/godot_mcp_server/* test/fixtures/gdscript-check/addons/godot_mcp_server/
godot --headless --import --path test/fixtures/gdscript-check 2>&1 | grep -iE "parse error|script error|failed to load" | grep -iv "leaked rid\|_ready" || echo "NO_PARSE_ERROR"
```
Expected: `NO_PARSE_ERROR`（4.7。若有 4.6.2 godot 二进制，再跑一次验证 4.6.2 super() 陷阱无复发）

- [ ] **Step 5: Commit**

```bash
git add addons/godot_mcp_server/commands/sync_commands.gd addons/godot_mcp_server/command_handler.gd test/fixtures/gdscript-check/addons/godot_mcp_server/commands/sync_commands.gd test/fixtures/gdscript-check/addons/godot_mcp_server/command_handler.gd
git commit -m "feat(editor-plugin): get_scene_stats 迭代聚合 + command_handler 分发（批 2）

sync_commands.get_scene_stats 基于 EditorInterface.get_edited_scene_root()
单遍迭代（与 bridge 同算法）。command_handler :153 加 editor_get_scene_stats
分发。顺带修 _serialize_tree depth 截断加 truncated 标记（ADVISORY，additive）。
4.7 --import 编译验证通过。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: TS `readScene` async + `setEditorSceneProvider` + `SceneSnapshot`（TDD）

**Files:**
- Modify: `src/tools/get-context.ts`（`readScene` :189-192 真实化；加 `setEditorSceneProvider` setter + `SceneSnapshot` export；改 :184 注释；`handleGetContext` :69-70 scene 调用）
- Test: `test/tools/get-context.test.ts`

**Interfaces:**
- Consumes: `sendToBridge`（bridge 模式）；`setEditorSceneProvider`（editor 模式，Task 4 注入）；`BridgeResponse.result.stats` 结构
- Produces: `readScene` async 返 `SceneSnapshot | null`；`setEditorSceneProvider` export；`SceneSnapshot` type export（供 Task 4 GodotServer import）

- [ ] **Step 1: 写失败测试（mock editorSceneProvider / sendToBridge，三态 + 降级 + 边界）**

在 `test/tools/get-context.test.ts` import 区（:9 旁）加 `setEditorSceneProvider`：
```ts
import { handleTool, getToolDefinitions, setGetContextConnectionProvider, setEditorSceneProvider } from '../../src/tools/get-context.js';
```

文件末尾加新 describe（`fakeCs` 已在 :15 定义）：
```ts
const fakeStats = (over: Partial<{ path: string; root: string; nodeCount: number; typeTopN: Array<{ type: string; n: number }> | null; truncated: boolean }> = {}) => ({
  path: 'res://scenes/main.tscn', root: 'Main', nodeCount: 5,
  typeTopN: [{ type: 'Node3D', n: 3 }], truncated: false, ...over,
});

describe('readScene real (Task 3)', () => {
  beforeEach(() => { getCallRecorder().reset(); vi.clearAllMocks(); setGetContextConnectionProvider(null); setEditorSceneProvider(null); });

  it('editor mode → editorSceneProvider stats 透传', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: true }));
    setEditorSceneProvider(async () => fakeStats());
    (sendToBridge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, result: { status: 'ok' } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx());
    const scene = JSON.parse((r!.content[0] as { text: string }).text).data.scene;
    expect(scene).toEqual(fakeStats());
  });

  it('bridge mode → sendToBridge(get_scene_stats) stats 透传', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 1, result: { status: 'ok' } })
      .mockResolvedValueOnce({ id: 2, result: { stats: fakeStats({ nodeCount: 10 }) } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const scene = JSON.parse((r!.content[0] as { text: string }).text).data.scene;
    expect(scene.nodeCount).toBe(10);
  });

  it('bridge no current_scene → stats null → scene null', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 1, result: { status: 'ok' } })
      .mockResolvedValueOnce({ id: 2, result: { stats: null } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.scene).toBeNull();
  });

  it('include_scene=false → scene null（不调 provider）', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: true }));
    const provider = vi.fn(async () => fakeStats());
    setEditorSceneProvider(provider);
    const r = await handleTool('godot_get_context', { project_path: '/p', include_scene: false }, mockCtx());
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.scene).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('editorSceneProvider 抛错 → scene null + status partial', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: true }));
    setEditorSceneProvider(async () => { throw new Error('boom'); });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx());
    const payload = JSON.parse((r!.content[0] as { text: string }).text).data;
    expect(payload.scene).toBeNull();
    expect(payload.failedFields).toContain('scene');
    expect(payload.status).toBe('partial');
  });

  it('headless mode → scene null', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no bridge'));
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    expect(JSON.parse((r!.content[0] as { text: string }).text).data.scene).toBeNull();
  });

  it('>2000 nodeCount → typeTopN undefined + truncated（GDScript typeTopN:null）', async () => {
    setGetContextConnectionProvider(() => fakeCs({ connected: false }));
    (sendToBridge as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 1, result: { status: 'ok' } })
      .mockResolvedValueOnce({ id: 2, result: { stats: { path: 'x', root: 'r', nodeCount: 3000, typeTopN: null, truncated: true } } });
    const r = await handleTool('godot_get_context', { project_path: '/p' }, mockCtx({ projectDir: '/p' } as any));
    const scene = JSON.parse((r!.content[0] as { text: string }).text).data.scene;
    expect(scene.nodeCount).toBe(3000);
    expect(scene.typeTopN).toBeUndefined();
    expect(scene.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tools/get-context.test.ts -t "readScene real"`
Expected: FAIL — `setEditorSceneProvider` 未 export / readScene 仍 null

- [ ] **Step 3: 实现 `SceneSnapshot` + `setEditorSceneProvider` + `readScene` async + `handleGetContext` 改 + :184 注释**

Modify `src/tools/get-context.ts`：

(a) `ConnectionStatus` import 后（:15 旁）加 `SceneSnapshot` type（export，供 Task 4）：
```ts
export type SceneSnapshot = {
  path: string;
  root: string;
  nodeCount: number;
  typeTopN?: Array<{ type: string; n: number }>;
  truncated?: boolean;
};
```

(b) `setGetContextConnectionProvider`（:22）后加 setter + 模块变量：
```ts
let _editorSceneProvider: ((projectPath: string) => Promise<SceneSnapshot | null>) | null = null;

/** 注入 editor 场景快照 provider（内部 editorConn.request('editor_get_scene_stats')）。 */
export function setEditorSceneProvider(provider: ((projectPath: string) => Promise<SceneSnapshot | null>) | null): void {
  _editorSceneProvider = provider;
}
```

(c) 改 `:184` 注释 + `readScene` :189-192（null 占位 → 真实 async）。当前：
```ts
/**
 * 场景快照：editor 用 editor_get_scene_tree，bridge 用 game_query(get_tree)。
 * headless 不调（外层已 null）。
 * MVP 占位：始终返回 null。真实采集（editor-sync 场景树 / game-bridge get_tree
 * + 递归统计 typeTopN，>2000 节点只返回 nodeCount）待 follow-up（批 2）。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function readScene(_mode: string, _ctx: ToolContext): { path: string; root: string; nodeCount: number; typeTopN: Array<{ type: string; n: number }> } | null {
  return null;
}
```
改：
```ts
/**
 * 场景快照：editor 走 editorSceneProvider（editorConn → editor_get_scene_stats），
 * bridge 走 sendToBridge('get_scene_stats')。headless null。TS 零聚合透传。
 * SceneSnapshot typeTopN/truncated optional（>2000 节点 typeTopN 缺省）。
 */
async function readScene(mode: 'headless' | 'editor' | 'bridge', projectPath: string | undefined, ctx: ToolContext): Promise<SceneSnapshot | null> {
  if (mode === 'headless') return null;
  if (mode === 'editor') {
    if (!_editorSceneProvider) return null;
    return await _editorSceneProvider(projectPath ?? '');
  }
  // bridge
  const dir = ctx.projectDir || projectPath;
  if (!dir) return null;
  const r = await sendToBridge('get_scene_stats', {}, 2000);
  if (!r || r.error) return null;
  const stats = (r.result as { stats?: SceneSnapshot | null })?.stats ?? null;
  if (!stats) return null;
  // 规范化：GDScript typeTopN:null → undefined（optional 字段）
  const { typeTopN, ...rest } = stats;
  return { ...rest, ...(typeTopN && typeTopN.length > 0 ? { typeTopN } : {}) };
}
```

(d) `handleGetContext` 改 scene 调用（:69-70 区域）。当前：
```ts
  const scene = null; // 批 2：editor 插件协议 + bridge 树深度
  void includeScene; // 批 2 接 readScene 时用
```
改：
```ts
  const scene = (!includeScene || mode === 'headless' || mode === null)
    ? null
    : await safeAsync(() => readScene(mode as 'editor' | 'bridge', projectPath, ctx), 'scene', failedFields);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tools/get-context.test.ts`
Expected: PASS（批 1 用例 + Task 3 新 7 用例全绿）

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npm run lint` → exit 0
```bash
git add src/tools/get-context.ts test/tools/get-context.test.ts
git commit -m "feat(get-context): readScene async 三态真实采集 + setEditorSceneProvider

editor 走 editorSceneProvider（Task 4 注入 editorConn.request），
bridge 走 sendToBridge('get_scene_stats')，headless null。TS 零聚合透传。
SceneSnapshot typeTopN?/truncated? optional（批 1 契约修正）。
改 :184 过时复用注释。7 新测试 + 批 1 回归。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: GodotServer 接线 `setEditorSceneProvider`

**Files:**
- Modify: `src/GodotServer.ts`（:148 setGetContextConnectionProvider 后接线；cleanup :439 旁清理）

**Interfaces:**
- Consumes: Task 3 `setEditorSceneProvider` + `SceneSnapshot`（get-context.js export）；`EditorConnection.request`（resolve msg.result / throw）；`isConnected()`
- Produces: 生产路径 editorSceneProvider 真注入

- [ ] **Step 1: 核实 + 加 import**

核实 GodotServer.ts 是否已 import get-context.js（批 1 setGetContextConnectionProvider 应已 import）。
Run: `grep -n "from './tools/get-context" src/GodotServer.ts`
- 若已 import `setGetContextConnectionProvider`：同一 import 加 `setEditorSceneProvider` + type `SceneSnapshot`
- 若未 import：加 `import { setEditorSceneProvider } from './tools/get-context.js';`（SceneSnapshot 用 inline 结构类型，避免 type-only import 噪音）

实际接线用 inline 结构类型（不需 import SceneSnapshot）：
```ts
const stats = (result as { stats?: { path: string; root: string; nodeCount: number; typeTopN?: Array<{ type: string; n: number }>; truncated?: boolean } | null })?.stats ?? null;
```

- [ ] **Step 2: :148 接线 + cleanup 清理**

`GodotServer.ts` :148（`setGetContextConnectionProvider(...)` 后）加：
```ts
    setEditorSceneProvider(async (_projectPath: string) => {
      if (!this.editorConn?.isConnected()) return null;
      try {
        const result = await this.editorConn.request('editor_get_scene_stats', {});
        return (result as { stats?: { path: string; root: string; nodeCount: number; typeTopN?: Array<{ type: string; n: number }>; truncated?: boolean } | null })?.stats ?? null;
      } catch {
        return null;  // editor error（如 NO_SCENE -32005）→ null 降级
      }
    });
```

cleanup（`setGetContextConnectionProvider(null)` 旁，:439 区域）加：
```ts
    setEditorSceneProvider(null);
```

- [ ] **Step 3: 跑测试确认接线 + 回归**

Run: `npx vitest run test/core/ToolDispatcher.test.ts test/tools/get-context.test.ts`
Expected: PASS（接线不破坏现有 + get-context mock 测试隔离）

- [ ] **Step 4: 全量 + tsc + lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 全绿，exit 0

- [ ] **Step 5: Commit**

```bash
git add src/GodotServer.ts
git commit -m "feat(get-context): GodotServer 接线 setEditorSceneProvider

:148 注入 editorSceneProvider（内部 editorConn.request('editor_get_scene_stats')，
try/catch 降级 null，绕过 EditorToolExecutor 因只读）+ cleanup 清理。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 边界 + 全量回归 + 4.7/4.6.2 编译验证

**Files:** 无新文件（验证 task）

- [ ] **Step 1: 算法边界 TS 覆盖确认（ADVISORY 4）**

Task 3 已含 `>2000 nodeCount → typeTopN undefined + truncated`（HARD_STOP 路径同测）。确认：
Run: `npx vitest run test/tools/get-context.test.ts -t "2000"`
Expected: PASS

- [ ] **Step 2: 全量门禁**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 全绿（批 1 + 批 2 用例 + 现有 3570+ 不破坏）

- [ ] **Step 3: addon `--import` 编译验证（4.7，复跑确认 Task 2 改动）**

Run:
```bash
godot --headless --import --path test/fixtures/gdscript-check 2>&1 | grep -iE "parse error|script error|failed to load" | grep -iv "leaked rid\|_ready" || echo "NO_PARSE_ERROR"
```
Expected: `NO_PARSE_ERROR`

- [ ] **Step 4: capability 不回归**

Run: `npx vitest run test/capability`
Expected: PASS（get_context 仍归 core，securityLevel 不变）

- [ ] **Step 5: 集成快照（人工核验，可选）**

若环境有 editor/bridge 运行：跑 `godot_get_context` 确认 scene 真实（非 null）。若无 editor/bridge，确认 headless scene=null + Task 3 mock 测试覆盖（editor/bridge 三态 + 降级 + 边界）即合格。

- [ ] **Step 6: Commit（若有测试微调）+ 收尾**

```bash
# 若无代码改动，跳过 commit
git add -A
git commit -m "test(get-context): 批 2 全量回归 + 编译验证"
```

---

## Self-Review

**1. Spec 覆盖**：
- readScene editor 真实（editorSceneProvider + editorConn）→ Task 3/4 ✅
- readScene bridge 真实（sendToBridge get_scene_stats）→ Task 1/3 ✅
- readScene headless null → Task 3 ✅
- GDScript 迭代聚合（editor + bridge）→ Task 1/2 ✅
- SceneSnapshot typeTopN?/truncated? optional → Task 3 ✅（批 1 契约修正）
- editor 直连 editorConn.request（绕过 EditorToolExecutor）→ Task 4 ✅
- bridge _handle_command match（不动 ALLOWED_METHODS）→ Task 1 ✅
- TYPE_WINDOW=2000/HARD_STOP=50000 独立常量 → Task 1/2 ✅
- 顺带修 _serialize_tree truncated（ADVISORY 拍板②）→ Task 2 Step 2 ✅
- 改 get-context.ts:184 注释（调整1）→ Task 3 (c) ✅
- ADVISORY 1（EditorConnection.request resolve msg.result / throw）→ Task 4 try/catch ✅
- ADVISORY 2（bridge no current_scene → {stats:null}）→ Task 1 ✅
- ADVISORY 4（边界单测）→ Task 3 >2000 用例 + Task 5 ✅

**2. Placeholder 扫描**：无 TBD/TODO。Task 4 Step 1 标"核实 import 是否已存在"（grep 命令 + 两分支处理），非 placeholder。

**3. 类型一致性**：`SceneSnapshot`（Task 3 export）↔ Task 4 inline 结构类型一致；`readScene(mode, projectPath, ctx): Promise<SceneSnapshot | null>` ↔ `handleGetContext await safeAsync` 一致；`setEditorSceneProvider`（Task 3 export）↔ Task 4 接线一致；GDScript stats 结构（Task 1/2）↔ TS 透传（Task 3）字段对齐（path/root/nodeCount/typeTopN/truncated）。

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-07-get-context-readscene.md`。

**执行方式**：Subagent-Driven（推荐，与批 1 一致）或 Inline。
