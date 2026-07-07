# godot_get_context readScene 真实采集（批 2）Design

> **日期**: 2026-07-07
> **状态**: draft（待用户审 + plan）
> **前置**: 批 1 已 merge master（`9142939`..`b65deaf`，5 字段真实采集完成，readScene 留批 2 占位 null）
> **前 spec**: `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-get-context-real-collection-design.md`（批 1 r2）

## 1. 背景与动机

批 1 把 godot_get_context 的 mode/project/connections/rules/performance 5 字段补成真实采集，readScene 保持 null 占位。批 2 补 readScene 真实采集。

### 1.1 为何新建 stats method 而非复用现有命令（根因，已源码核实）

批 1 get-context.ts:184 注释写"editor 用 editor_get_scene_tree，bridge 用 game_query(get_tree)"——批 1 原决策复用。批 2 改新建，根因如下：

- **editor_get_scene_tree 硬截断**：`sync_commands.gd:64` `_serialize_tree(root, 0, 5)` depth=5 硬上限，**截断无 truncated 标记** → 拿不到全树 nodeCount，typeTopN 失真。
- **bridge _cmd_get_tree 载荷大 + root 偏大**：`mcp_bridge.gd:596` 用 `get_tree().root`（含 autoload/window 节点，非 current_scene）+ `_serialize_node` max_nodes=2000 截断（`:608`）+ **序列化整棵树**（每节点 name/type/path/visible/position，载荷大）→ 拿不到 current_scene 全树准确 nodeCount + 小载荷。
- **readScene 只需聚合 stats（nodeCount + typeTopN），不需要整棵树**。现有两命令都"传树"，对 readScene 是过度载荷。
- 故新建"只聚合不传树"的 stats method（editor + bridge 各一）。**与 duplication-across-layers defect 不冲突**——那是"跨层重复实现"，此处是"不同抽象（聚合 vs 传树），刻意不共用"。
- 实现时改 get-context.ts:184 过时注释（"复用 editor_get_scene_tree"→ stats method）。

## 2. 目标

- readScene 三态真实采集（editor / bridge / headless）
- SceneSnapshot = `{ path, root, nodeCount, typeTopN?, truncated? }`（typeTopN/truncated optional，**批 2 修正批 1 契约**）
- GDScript 端聚合（用户选"最准"方案），TS 端零聚合只透传
- 字段降级保持（safeAsync + 永不抛，status ok/partial）

## 3. 架构（三态分流）

```
readScene(mode, projectPath, ctx):
  editor  → editorSceneProvider(projectPath)  [注入]
            → editorConn.request('editor_get_scene_stats')  [直连，绕过 EditorToolExecutor]
            → 插件 sync_commands.get_scene_stats()
  bridge  → sendToBridge('get_scene_stats')
            → mcp_bridge._cmd_get_scene_stats(params)
  headless → null
```

TS 端零聚合，只透传 GDScript 返回的 `{ path, root, nodeCount, typeTopN?, truncated? }`。

### 3.1 editor 直连 editorConn.request（拍板①，已认可）

readScene 走 `editorConn.request('editor_get_scene_stats')` 直连，**绕过 EditorToolExecutor**。理由：
- readScene 是**只读**场景统计，不改 undo 栈 → 与 EditorToolExecutor 串行化（P1#2，防并发 editor 写操作乱序 undo）目标正交，不走串行化可接受。
- EditorConnection.request 是 public（`src/core/EditorConnection.ts:306`）。
- 比走 EditorToolExecutor（需加 handleGetSceneStats 方法）更简。

**前提约束**（spec 显式）：readScene 只读。若未来 get_context 加 editor 写操作，必须重走 EditorToolExecutor 串行化。

## 4. GDScript 新增

### 4.1 单遍递归聚合算法（editor 与 bridge 共用逻辑，各自实现）

```
# 常量（独立于 _serialize_node 的 max_nodes=2000）
const TYPE_WINDOW: int = 2000   # typeTopN 字典维护窗口（仅前 2000 节点维护 typeCount，省内存）
const HARD_STOP: int = 50000    # OOM 硬停止（nodeCount 绝对上限）

var nodeCount: int = 0
var typeCount: Dictionary = {}  # {class_name: count}
var truncated: bool = false

func _walk_stats(node: Node) -> void:
    if nodeCount >= HARD_STOP:
        truncated = true
        return
    nodeCount += 1
    if nodeCount <= TYPE_WINDOW:
        var cls: String = node.get_class()
        typeCount[cls] = int(typeCount.get(cls, 0)) + 1
    for c in node.get_children():
        _walk_stats(c)

# 输出：
#   nodeCount  全程准确（仅 HARD_STOP 截断；不受 TYPE_WINDOW 限制）
#   typeTopN   (nodeCount <= TYPE_WINDOW) ? top5(typeCount) : null（>2000 不维护字典，缺省）
#   truncated  HARD_STOP 触发时 true
```

**关键语义区分**（调整3，必写清防实现者复用错常量）：
- `TYPE_WINDOW=2000`：**typeTopN 字典维护窗口**。>2000 仍继续递归数 nodeCount，只停维护 typeCount 字典（省内存）。**不是 nodeCount 上限**。
- `HARD_STOP=50000`：**OOM 硬停止**（nodeCount 绝对上限，防超大场景递归爆栈）。
- 与 `mcp_bridge.gd:608` `_serialize_node` 的 `max_nodes=2000`（**序列化节点数上限**，控制序列化整树载荷）**语义完全不同** —— 新方法用独立 TYPE_WINDOW/HARD_STOP，**不复用** max_nodes 常量。

### 4.2 editor 插件（`addons/godot_mcp_server/commands/sync_commands.gd` + `command_handler.gd`）

新增 `get_scene_stats()` 方法（sync_commands.gd，参照 :58 `get_scene_tree()` 模式）：
- 入口：`EditorInterface.get_edited_scene_root()`（经 `_get_ei()`，参照 :59-63）
- 无场景 → `{"error": {"code": -32005, "message": "No current scene"}}`（复用 :63 错误码）
- 有场景 → 单遍递归（§4.1 算法）→ `{"result": {"success": true, "stats": {"path": root.scene_file_path, "root": root.name, "nodeCount": ..., "typeTopN": [...] or null, "truncated": bool}}}`
- command_handler.gd 分发（参照 :148-153 `editor_get_scene_tree` match）：加 `"editor_get_scene_stats": result = _sync_commands.get_scene_stats()`

**4.6.2 super() 陷阱**（澄清2）：`sync_commands.gd:1 extends Node`（原生类）。新 `get_scene_stats` 是普通方法，不受 super() 限制。但**勿给 `_ready`/`_exit_tree` 等原生类虚函数加 `super()`**（4.6.2 Parse error "Cannot call the parent class' virtual function"，memory [[enhanced-editor-plugin-4.7-incompatible]] + 2026-07-04 修复 654b162 回归先例）。

### 4.3 bridge（`src/scripts/mcp_bridge.gd`）

新增 `_cmd_get_scene_stats(params: Dictionary) -> Variant`（参照 :596 `_cmd_get_tree` 模式）：
- 入口：`get_tree().current_scene`（**非 root**，避免 autoload/window 节点）
- 无 current_scene → `{"error": {"code": <现有 no-scene 码>, "message": "No current scene"}}`
- 有 → 单遍递归（§4.1 算法）→ `{"result": {"stats": {...}}}`（含 path = current_scene.scene_file_path）
- **分发：在 `_handle_command` match 加分支**（mcp_bridge.gd:521 `"get_tree"` 旁）：`"get_scene_stats": result = _cmd_get_scene_stats(params)`
- **不要动 `ALLOWED_METHODS`（:55）**（调整2）：那是 `call_method` 的只读方法白名单，不是 command 分发表。新 method 走 `_handle_command` match，与 call_method 白名单无关。混淆会复发 ts-gdscript-tool-drift。

## 5. TS 侧

- `readScene(mode, projectPath, ctx)` async（批 1 :190 null 占位 → 真实）
  - editor：`await editorSceneProvider(projectPath)` → stats（透传）
  - bridge：`const r = await sendToBridge('get_scene_stats', {}, 2000); if (!r || r.error) return null; return r.result?.stats ?? null`（可选链降级）
  - headless：null
- 新 `setEditorSceneProvider(provider)` setter + 模块变量（避撞 manage-tools，同批 1 `setGetContextConnectionProvider` 模式）
- GodotServer :149 旁接线（批 1 setGetContextConnectionProvider 旁）：
  ```ts
  setEditorSceneProvider(async (_projectPath: string) => {
    if (!this.editorConn?.isConnected()) return null;
    const r = await this.editorConn.request('editor_get_scene_stats', {});
    if (r.error) return null;
    return (r.result as { stats?: SceneSnapshot })?.stats ?? null;
  });
  ```
  + :439 cleanup `setEditorSceneProvider(null);`
- SceneSnapshot 类型（**批 2 修正批 1 契约**，调整4）：
  ```ts
  type SceneSnapshot = {
    path: string;
    root: string;
    nodeCount: number;
    typeTopN?: Array<{ type: string; n: number }>;  // 批 2 改 optional（>2000 缺省）
    truncated?: boolean;                              // 批 2 新增
  };
  ```
- 字段降级：readScene 内部 try/catch（safeAsync 包裹），失败返 null + scene 进 failedFields

## 6. 批 1 契约修正（调整4）

批 1 spec（`get-context-real-collection-design.md:61`）SceneSnapshot `typeTopN` 必填。批 2 改 optional（>2000 跳 typeTopN）+ 新增 `truncated?`。
- **改批 1 spec :61 那处**（typeTopN 改 optional + 加 truncated?），避免两 spec 打架（ts-gdscript-tool-drift 温床）。
- get-context.ts:190 readScene 返回类型同步改（批 2 实现时）。

## 7. 顺带修复（ADVISORY，拍板②，非 readScene 核心 scope）

批 2 反正动 sync_commands.gd，顺带修 `:64` `_serialize_tree` depth=5 截断无标记的小隐患：
- `_serialize_tree` 返回加 `truncated` 标记（递归到 depth 上限时 true）
- 一行小改（递归函数加 truncated 追踪 + 返回结构加字段），提升 editor_get_scene_tree 调用方健壮性（调用方可判断树是否被截断）
- **标注为批 2 顺带**（非 readScene 核心 scope），reviewer 知悉

## 8. 测试

- **TS 侧**：mock `editorSceneProvider` / `sendToBridge` 返 stats，断言 readScene 透传 + 三态（editor/bridge/headless）+ 降级（provider 抛错/返 null → scene null + status partial）
- **契约**：>2000 场景 typeTopN 缺省 + truncated（mock sendToBridge 返 sparse stats）
- **GDScript 单遍算法**：editor + bridge 各自实现，需测试对齐（同输入同 nodeCount/typeTopN）—— 受限于 Godot headless 可测性，至少集成验证（真场景跑一次）
- **4.7 + 4.6.2 `--headless --import` 编译验证**（`godot --headless --import --path test/fixtures/gdscript-check`，启用 plugin 建全局类缓存；memory [[enhanced-editor-plugin-4.7-incompatible]] + super() 陷阱 + 2026-07-04 修复先例：`--check-only <file>` 假绿，必须 `--import`）
- **回归**：批 1 用例 + 现有 editor_get_scene_tree / get_tree 不破坏（顺带 truncated 标记是 additive，不破坏现有消费者）

## 9. 风险与开放问题

1. **GDScript 两份算法一致性**：editor（sync_commands.gd）+ bridge（mcp_bridge.gd）各自实现单遍递归。跨文件 GDScript 共享（autoload/util）有成本，YAGNI 各自实现 + 测试对齐。风险：两边漂移。缓解：算法简单（~15 行）+ 测试对齐。
2. **bridge current_scene 可能 null**：游戏未加载场景（菜单/启动期）→ stats null 降级（readScene 返 null，正常）。
3. **HARD_STOP=50000 OOM**：超大场景（>5万节点）truncated。可接受（readScene 是概览，非精确统计）。
4. **editor 4.7 EditorInterface API**：用 `_get_ei()`（:23，已 4.7 适配 `EditorPlugin.get_editor_interface()`）+ `get_edited_scene_root()`（标准 API，4.x 稳定）。

## 10. 不做（YAGNI）

- 不抽 GDScript 公共聚合函数（editor/bridge 跨文件共享成本高，各自 ~15 行可接受）
- 不改 editor_get_scene_tree / get_tree 现有序列化行为（除 §7 顺带 truncated 标记）
- 不加 scene 树深度参数（readScene 只需 stats，固定全树聚合，HARD_STOP 保护）
- 不走 EditorToolExecutor（readScene 只读，§3.1 已论证）

## 11. 关键决策溯源（防 reviewer 质疑）

| 决策 | 依据 |
|------|------|
| 新建 stats method 不复用 editor_get_scene_tree/get_tree | §1.1 根因（depth=5 截断 / root 偏大 / 载荷大） |
| GDScript 端聚合（非 TS） | 用户 brainstorm 选"最准"方案；typeTopN 全项目零现成 |
| editor 直连 editorConn.request | §3.1（只读，绕过串行化可接受） |
| bridge 走 _handle_command match 不动 ALLOWED_METHODS | §4.3（ALLOWED_METHODS 是 call_method 白名单） |
| typeTopN/truncated optional | §6（>2000 跳 typeTopN 契约） |
| TYPE_WINDOW=2000 / HARD_STOP=50000 独立常量 | §4.1（与 _serialize_node max_nodes 语义区分） |
