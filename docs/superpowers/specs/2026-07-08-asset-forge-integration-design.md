# asset-forge → godot-mcp-enhanced 整合 设计

> **Date**: 2026-07-08
> **Status**: Design v1
> **Type**: 新功能（新 merged MCP 工具 `asset` + editor 命令模块，v0.22.0）
> **关联**: 上游仓库 `D:\GitHub\godot-asset-forge`（保留活跃、独立演进）；本 design 基于对其 README/CLAUDE.md/源码与本仓库源码的探索

## 1. 背景与目标

### 痛点
本仓库 32 个 MCP 工具（v0.21.0）覆盖场景/脚本/UI/动画/物理/粒子/导航/音频等，但**缺参数化几何体工厂与形状阵列**：AI 经 MCP 搭建场景骨架（墙/台阶/栅栏/管道/装饰物）只能逐个 `add_node` + 手算 mesh，无程序化批量生成能力。

`godot-asset-forge` 已实现这套能力：11 种参数化 shape（6 PrimitiveMesh + 5 手写 ArrayMesh；其中 ramp 单件=PrismMesh 可用，continuous 模式手写 wedge 待上游修复）、路径阵列（discrete/continuous + v4 align-vertices + v5 端柱去重；**v6 ramp 衔接待上游**）、batch、batch 原子 undo、10 预设材质、存 `.tscn` 预制件。但它走独立 bash + WebSocket(60650) + token + python 客户端 + Dock UI 通道，与本仓库的 MCP stdio + editor WebSocket 通路**并行冗余**。

### 目标
把 asset-forge 的**几何体工厂 / 路径阵列 / 材质库**核心计算能力下沉为本仓库 1 个 merged MCP 工具 `asset`（7 个 action），走 **editor 层**持久化（视口可见、可 undo、可存 PackedScene），复用本仓库现有放置 / `undo_manager` / `save_scene` 基础设施。**丢弃** asset-forge 自有 WS/token/py 客户端/Dock（被 MCP + editor 层取代）。源仓库 `godot-asset-forge` 保留活跃、独立演进，本仓库为独立实现。

### 核心场景（AI 驱动）
- **程序化铺设场景骨架**：AI 调 `asset` action=path 生成整段栅栏/栏板/斜坡；action=batch 批量摆装饰；action=create 单个精确放置
- **迭代式生成**：AI 生成 → `run_and_verify`/截图检查 → `asset` action=undo 撤销最近批次 → 调整参数重生成
- **可复用预制件**：action=save 把生成子树存为 `res://GeneratedAssets/xxx.tscn`，后续 `instance_scene` 复用

主调用者 = AI（MCP 客户端）。

### 非目标（YAGNI，v0.22.0 不做）
- 保留 asset-forge 的 bash 客户端 / WS 60650 / token / Dock UI（被取代）
- 新增 shape（移植 10 种；ramp 仅单件 PrismMesh，continuous 模式阻塞——见下条）
- path 阵列新算法（移植 v1–v5 全特性；v6 ramp 衔接阻塞——见下条）
- continuous ramp（`CustomMeshes.make_ramp` 手写 wedge）暂不移植：上游有两个 open CRITICAL（绕序混约定 + 弦长当弧长），见 `D:\workspace\review\.claude\knowledge\projects\godot-asset-forge\defects.md` 的 ramp-winding-mixed-convention / ramp-height-chord-as-arc；待上游 ramp-height-continuity 落地再补。单件 PrismMesh ramp（create action）与 discrete path ramp 不受影响
- 双仓库双向同步（源仓库独立演进，几何体代码两处维护是既定取舍）
- 运行时（game bridge）层生成——生成语义是「编辑器持久化场景」，非运行时临时节点
- 把 asset 材质预设合并进 `material-ops`（二者职责互补，见 §8）

## 2. 架构（editor 层持久化，不走 headless NON_PERSIST）

本仓库工具分两条执行通路：
- **headless `executeGdscriptTrusted`**：如 `material-ops`，标 `NON_PERSIST`（不写 `.tscn`），运行时临时态
- **editor 路由**：editor 模式下 `ToolDispatcher.executeToolCall` 对**所有工具**盲目调 `currentExecutor.execute(toolName, args)` → `EditorConnection.request` → editor WS → `command_handler.handle(method)`；GD 侧 `command_handler` 的 match method 表决定是否持久化，**未匹配的 method 返 -32601，TS 侧 `_isUnknownMethod` 检测后自动回退 headless `dispatchTool`**（`ToolDispatcher.ts:347-357`）。即「全工具先试 editor，-32601 回退 headless」，**无 editor-only 白名单**。`asset_create`/`path`/`batch`/`undo`/`save` 在 `command_handler` match 加 5 分支即获 editor 持久化；`list_shapes`/`list_materials` 不加分支则 -32601 回退到 TS 静态返回（editor 模式多 1 次 WS 往返，功能正确）

`asset` 的 create/path/batch/undo/save **必须经 `command_handler` match 路由持久化**（视口可见 + 可 undo），与 `add_node`/`save_scene` 同类（editor 持久化命令）；**不**走 `material-ops` 那种 headless `executeGdscriptTrusted` + `NON_PERSIST`。注：`particles_*` 是 headless+editor 双实现（TS 文件本身是 headless NON_PERSIST 实现），非 editor-only，不作为 asset 的类比。`list_shapes`/`list_materials` 是只读静态数据，由 TS 直接返回（不经 editor，headless 也可用）。

`EditorToolExecutor` 内置**串行化**（`executeChain` Promise 链，防并发 `ws.send` 致 undo 栈 LIFO 错乱）——asset 的 batch 放置天然受益。

```
AI(Claude) ──MCP stdio──> GodotServer [TS]
  └─ asset 工具 handleTool (src/tools/asset/asset-ops.ts)
       ├─ action=list_shapes/list_materials → TS 静态返回（只读；editor 模式仍先盲转 editor，-32601 回退后到 TS，多 1 次 WS 往返）
       └─ action=create/path/batch/undo/save → editorExecutor.execute("asset_<action>")
            └─ EditorConnection.request ──editor WS──> command_handler.handle(method)
                  └─ _asset_commands.handle_create/path/batch/undo/save
                       ├─ AssetFactory.create_mesh + CustomMeshes（搬入的几何体工厂）
                       ├─ PathGenerator（搬入的路径阵列算法，path action 用）
                       ├─ MaterialPresets.create（搬入的材质库）
                       └─ AssetPlacer.place → 复用 node_commands 防御 + undo_manager.create_action_mixed
```

## 3. 数据流

### create（单个 shape）
```
asset {action:"create", shape:"box", params:{size:[2,1.5,1.2]}, material:"wood",
       name:"crate_01", parent:"", position:[0,0,0]}
  → TS asset-ops: 校验 shape∈11 / params schema / material spec 三态
  → editorExecutor.execute("asset_create", args)
  → command_handler → _asset_commands.handle_create:
      root = EditorInterface.get_edited_scene_root()  # null → NO_ACTIVE_SCENE
      parent = asset_placer.resolve_parent(root, parent)  # traversal 检查 + get_node_or_null
      mesh = AssetFactory.create_mesh("box", {size:...})  # 含 custom_meshes 分发
      node = MeshInstance3D.new(); node.mesh = mesh
      name = asset_placer.unique_name(parent, "crate_01")  # 碰撞自增 _001
      node.material_override = MaterialPresets.create("wood")  # 或 dict / res://
      node.transform = ...  # position/rotation/scale
      undo_manager.create_action_mixed("asset_create", do_ops, undo_ops)  # batch=1
  → 返回 {node_path:"/Root/crate_01"}
```

### path（路径阵列）
```
asset {action:"path", shape:"fence", params:{length:3,height:1.2},
       material:"wood", path_node:"/Root/FencePath", mode:"continuous", spacing:2, align_vertices:true}
  → _asset_commands.handle_path:
      pts = PathGenerator.resolve_points(root, path | path_node)
        # path_node: 读场景 Path3D.curve.baked_points（editor 层可访问场景树）
        # path: 直接用 [[x,y,z],...]
      segments = PathGenerator.sample(pts, mode, spacing|count, align_vertices, align)
        # discrete: 等间距/等数量采样；continuous: 栏板首尾相连铺满
        # v4 align_vertices: 折线顶点强制为段边界（PathGenerator 采样层）
        # v5 fence 端柱去重：放置层 asset_placer 注入 start_post/end_post + custom_meshes._post_xs（非 PathGenerator）
        # v6 ramp 衔接：阻塞（方案 A，待上游 ramp-height-continuity）
      nodes = []
      for seg in segments:
        mesh = AssetFactory.create_mesh("fence", seg.params)  # length 自适应段长
        node = ... # 同 create 的放置逻辑，transform 含 seg.position + seg.rotation(朝向)
        nodes.append(node)
      undo_manager.create_action_mixed("asset_path_<bid>", 聚合所有 nodes 的 ops, ...)  # 一次 undo
  → 返回 {node_paths:[...], count:N}
```

### batch（多 items 一次）
```
asset {action:"batch", items:[{shape,params,material,name,...}, ...]}  # limit≤64
  → _asset_commands.handle_batch:
      if items.size() > 64 → BATCH_LIMIT_EXCEEDED
      # 预校验全部 item（原子）：shape∈10/params schema/material 三态/parent 存在
      for item in items: 校验，任一失败立即返错（零节点落地，不入 undo 栈）
      # 全过才执行
      for item in items: 复用 create 单件逻辑，累积 nodes + ops
      undo_manager.create_action_mixed("asset_batch_<bid>", 聚合 ops, ...)
  → 返回 {node_paths:[...]}  # 语义适配：MCP 同步返数组（见 §7 不变量 4）
  # 原子语义：item N 失败 → 零节点落地 + undo 栈空（预校验保证，与 batch undo 原子性对称）
```

### undo（程序化撤销）
```
asset {action:"undo"}
  → _asset_commands.handle_undo:
      ur = _plugin.get_undo_redo()
      # Godot UndoRedo 全局栈，undo() 弹栈顶 action（通常是最近一次 asset 批次）
      # 无法区分 action 来源——tool description 注明此全局语义
      ur.undo()
  → 返回 {undone:true} 或 {error:NOTHING_TO_UNDO}（栈空）
```

### save（存子树为 PackedScene 预制件）
```
asset {action:"save", node_path:"/Root/crate_01", resource_path:"res://GeneratedAssets/crate_01.tscn"}
  → _asset_commands.handle_save:
      node = root.get_node_or_null(node_path)  # 未找到 → PARENT_NOT_FOUND
      # resource_path 经 ALLOWED_PROJECT_PATHS 白名单 + res:// 校验（TS pre + GD 复核）
      var pkg = PackedScene.pack(node)  # 仅 pack 该子树
      DirAccess.make_dir_recursive_absolute(dir)
      ResourceSaver.save(pkg, resource_path)  # 失败 → RESOURCE_SAVE_FAILED
      # 注意：save 不入 undo 栈（写文件非场景树变更）；undo 不删该 .tscn（不变量 1）
  → 返回 {resource_path:"res://GeneratedAssets/crate_01.tscn"}
```

### list_shapes / list_materials（TS 静态）
```
asset {action:"list_shapes"} → {shapes:[{name:"box", params:{size:[1,1,1]}}, ...11 项]}
asset {action:"list_materials"} → {presets:["wood","metal",...10], custom_rule:"{color,alpha,metallic,roughness}", external:"res://*.tres"}
```

## 4. MCP 工具契约

```
工具名: asset                      # 工具数 32 → 33
inputSchema.required: [action]
action enum: create | path | batch | undo | save | list_shapes | list_materials
actionRisks:
  list_shapes, list_materials → read
  create, path, batch, undo, save → write
```

| action | 关键入参 | 返回 |
|---|---|---|
| `create` | shape, params, material?, name?, parent?, position?, rotation?, scale? | `{node_path}` |
| `path` | shape, params, material?, path\|path_node, mode, spacing?\|count?, align?, align_vertices? | `{node_paths:[], count}` |
| `batch` | items:[{shape,params,material?,name?,...}]（≤64） | `{node_paths:[]}` |
| `undo` | — | `{undone:true}` \| `NOTHING_TO_UNDO` |
| `save` | node_path, resource_path | `{resource_path}` |
| `list_shapes` | — | `{shapes:[{name, params}, ×11]}` |
| `list_materials` | — | `{presets:[×10], custom_rule, external}` |

**shape（11）**：box / cylinder / sphere / prism / wall / ramp（6 内置 PrimitiveMesh）+ cone / tube / torus / stairs / fence（5 手写 ArrayMesh）。**ramp 单件=PrismMesh 可用；continuous path 模式不支持 shape=ramp（返 `UNSUPPORTED_SHAPE`，make_ramp 未移植——方案 A）**。各 params 默认值见 asset-forge `docs/shapes-reference.md`（移植入 `schema.ts`，含 fence 完整参数 post_radius/rail_thickness）。

**material 三态 + null**：String 预设名（未知回退 `default`）/ Dictionary 自定义 PBR（`color` hex 如 `"FF0000"`，`alpha<1` 自动透明，可选 `emissive` 自发光 hex）/ `"res://*.tres"` 外部 / null → default。注：dict PBR 处理在 `AssetFactory.create_material`（`asset_factory.gd:121-139`，移植 `material_presets.gd` 须连 `create_material` 一起搬）。

**path 模式**：`discrete`（等间距 spacing 或等数量 count 采样）/ `continuous`（栏板 wall/fence 首尾相连铺满；**continuous 不支持 shape=ramp，待上游 v6 修复**）。`align`: none/path/normal（默认 path，沿切线）。`align_vertices`: 仅 continuous+spacing 生效，折线顶点强制段边界。`count` 与 `align_vertices` 互斥。

## 5. 错误处理 + 安全防护

### 错误码（对齐本仓库惯例 + asset-forge 语义）
| 场景 | 错误码 | 对齐 |
|---|---|---|
| 未知 shape | `UNSUPPORTED_SHAPE` | — |
| 参数非法 | `INVALID_PARAMS` | — |
| 父节点无效/遍历 | `PARENT_NOT_FOUND` | node_commands `-32002` |
| 无活动场景 | `NO_ACTIVE_SCENE` | node_commands `-32003` No scene loaded |
| 栈空 undo | `NOTHING_TO_UNDO` | — |
| batch > 64 | `BATCH_LIMIT_EXCEEDED` | — |
| save 路径越界（TS 侧 realpathSync 白名单外） | `PATH_NOT_ALLOWED` | ToolDispatcher 惯例（`isPathInAllowedRoots` 恒返 true 的测试环境该分支不可达，留 E2E） |
| save resource_path 非 res:// / 含 `..`（GD 侧复核） | `INVALID_PATH` | ALLOWED_PROJECT_PATHS |
| ResourceSaver 失败 | `RESOURCE_SAVE_FAILED` | material-ops 同名码 |

> **save 路径越界错误码双侧差异**：TS 侧 `asset-ops` 前置校验（`requireProjectPath` → `isPathInAllowedRoots`）返 `PATH_NOT_ALLOWED`（对齐 ToolDispatcher 全工具惯例）；GD editor 侧 `handle_save` 复核（`begins_with("res://")` + `has_path_traversal`）返 `INVALID_PATH`。两码语义不同层：TS 拦符号链接/allowlist 外写（`PATH_NOT_ALLOWED`），GD 拦非 `res://` 前缀与 `..` 遍历（`INVALID_PATH`）。AI 收 `PATH_NOT_ALLOWED` 须改 `resource_path` 到允许根内；收 `INVALID_PATH` 须确保 `res://` 前缀且无遍历段。

TS 侧 `opsErrorResult(code, msg)` + `isError:true`；GD 侧返 `{"error":{"code","message"}}`，结构化错误经 `EditorToolExecutor` 透传（`EditorToolExecutor.ts:76-84`）。

### 安全防护（复用本仓库既有防御层）
- **node name 白名单**：`asset_placer._sanitize_name` 保留 `[A-Za-z0-9_-]`（含 `-`，忠实 asset-forge 上游 `_sanitize_name` 惯例），非白名单字符替 `_`，空回 `"asset"`，再经 `unique_name` 碰撞自增 `_001`。与 `node_commands.gd` 的 `^[A-Za-z0-9_]+$`（不含 `-`）存在差异：asset 忠实上游且 Godot Node.name 合法接受 `-`，**非安全面差异**——name 经 Godot `Node.name` setter 赋值（非字符串拼进 GDScript 源码），特殊字符无注入路径。
- **parent 路径遍历**：复用 `CommandHelpers.has_path_traversal`（`node_commands.gd:52`），拒 `..` 段
- **node_type 固定 MeshInstance3D**：asset 生成的节点类型固定（不接用户传入的任意 type），天然规避 `node_commands` 的 `ALLOWED_NODE_TYPES` 注入面（asset 不实例化任意 ClassDB 类型，只 `MeshInstance3D.new()`）
- **save resource_path 白名单**：TS pre 经 ALLOWED_PROJECT_PATHS（`isPathInAllowedRoots`）+ `resolveWithinRoot`（**realpathSync 归一**，防符号链接/TOCTOU）+ res://（`normalizeUserProjectPath`）校验，GD 侧 `CommandHelpers.has_path_traversal` + res:// 前缀复核（对齐 `scene_commands.gd:30-33` 既有模式）；防 `../` 与符号链接写出项目根。注：GD 侧无 `sanitizeResPath` 函数（仅 `value-serializer.ts:68` TS 辅助函数，用于 texture_path）
- **params 不进 GDScript 源码字符串**：asset 走 editor 命令路由（JSON-RPC params 反序列化为 Dictionary），非 `executeGdscriptTrusted` 拼字符串，**无 GDScript 注入面**（与 `material-ops` 拼 GDScript 的注入风险本质不同）
- **TS 入参校验策略**：asset-ops.handleTool 用 `requireString`/`requireStringArray`/`isNumberArray`（`helpers.ts`）或 zod schema 前置校验所有入参，**禁裸 `as` 断言**（对齐 DEFECT.project.godot-mcp-enhanced.ts-args-as-cast-no-validation fix-forward）；batch items 嵌套深度 ≤5（asset 自收紧；ToolDispatcher 全局 `MAX_NORMALIZE_DEPTH=20`，见 `ToolDispatcher.ts:467`）

## 6. 组件结构

### TS 侧（`src/tools/asset/`，2 文件——符合 CLAUDE.md「≥2 文件建同名目录」）
- `asset-ops.ts`：merged `asset` 工具——`getToolDefinitions()`（inputSchema + 7 action enum）、`handleTool(name,args,ctx)`（action 路由：list_* 静态返回；create/path/batch/undo/save 校验入参后调 `ctx` 暴露的 editorExecutor）、`TOOL_META`（`actionRisks`，对齐 `risk-level-field` 迁移后惯例）
- `schema.ts`：11 shape 名 + 各 params 默认值/类型、10 材质预设名、material 三态规则——`list_shapes`/`list_materials` 数据源 + create/path/batch 入参校验依据

### TS 侧改动（注册 + 路由）
- `src/core/module-loader.ts`：`import * as asset from '../tools/asset/asset-ops.js'` + `ALL_MODULES` 追加 `asset`
- `src/core/ToolDispatcher.ts` / `GodotServer.ts`：`asset_create`/`asset_path`/`asset_batch`/`asset_undo`/`asset_save` 加入 editor-only 路由表（实施时查表确认接入点；headless 模式这些 action 返 `EDITOR_ONLY` 错，仿 `test-framework.ts:76-79`）

### GD 侧（`addons/godot_mcp_server/commands/asset/`，6 文件——目录）
| 文件 | 职责 | 来源 |
|---|---|---|
| `asset_commands.gd` | 命令入口 extends Node：`setup(plugin, undo_manager)` + `handle_create/path/batch/undo/save(params, request_id)`，编排工厂+阵列+放置 | 新写（仿 `node_commands.gd`） |
| `asset_factory.gd` | shape→mesh 调度：6 PrimitiveMesh 分发 + 5 手写转 `custom_meshes.gd` | 移植 asset-forge `AssetFactory` |
| `custom_meshes.gd` | 5 手写 ArrayMesh（cone/tube/torus/stairs/fence，单 SurfaceTool commit 保不变量 7） | 移植 `CustomMeshes` |
| `material_presets.gd` | 10 预设 StandardMaterial3D + dict 自定义 PBR（含 emissive）+ res:// 加载 | 移植 `MaterialLibrary` + `AssetFactory.create_material`（dict 三态处理在上游位于 AssetFactory 非 MaterialLibrary） |
| `path_generator.gd` | 路径阵列：points 解析（Path3D baked_points / 数组）、discrete/continuous 采样、朝向、v4 align-vertices（**不含 v5/v6**——v5 在放置层、v6 阻塞） | 移植 asset-forge `PathGenerator` |
| `asset_placer.gd` | 放置：parent 解析、name 自增（含 `-` → `_` sanitize）、transform、owner、挂材质 + **v5 fence 端柱注入（start_post/end_post，移植自 `asset_forge_plugin.gd:334-338`）** + **batch undo 聚合**（一次 `create_action_mixed`）+ batch 预校验原子 | 移植 `ScenePlacer` + `asset_forge_plugin` 的 v5 注入逻辑，接 `node_commands` 防御 + `undo_manager` |

### GD 侧改动（`command_handler.gd`）
- `setup()`：实例化 `_asset_commands = preload("commands/asset/asset_commands.gd").new()` + `_asset_commands.setup(plugin, _undo_manager)` + `add_child`
- `handle()` match 追加 5 分支：`"asset_create"/"asset_path"/"asset_batch"/"asset_undo"/"asset_save"` → `_asset_commands.handle_xxx(params, request_id)`
- `cleanup()`：`_asset_commands` 入 modules 列表 + 置 null

### 移植约定（asset-forge → 本仓库）
- **去 `class_name`**：asset-forge 靠 `class_name X extends RefCounted` 全局注册（因其无 autoload）。本仓库命令模块惯例是 `preload(...)` 引用（`command_handler.gd:26`）。移植时去掉 `class_name`，改 `asset_commands.gd` 内 `const AssetFactory = preload("asset_factory.gd")` 引用静态方法（GDScript `static func` 可经 preload 脚本直接调），避免全局命名空间污染 + 贴本仓库惯例
- **`@tool` 保留**：所有 .gd 顶格 `@tool`（编辑器内运行）
- **`_vec3` 不保留副本**：复用 `command_helpers.gd` 既有向量解析（或抽 `shared_vec.gd`），须兼容 Array + PackedFloat64Array（吸收 asset-forge `scene_placer` 的 packed array 缺陷修复，见 DEFECT.project.godot-asset-forge.scene-placer-vec3-no-packed-array）；对齐 DEFECT.project.godot-mcp-enhanced.duplication-across-layers fix-forward，不引入第 3-4 份 `_vec3` 副本
- **保留注释标记**：asset-forge 注释里的 `IMPORTANT-N`/`Q-N`/`A-N` 设计 spec 标记原样保留

## 7. batch 原子 undo（零改 undo_manager）

asset-forge 核心不变量 3（同 batch_id 一次 undo）天然映射 Godot 原生 `UndoRedo`：`undo_manager.create_action_mixed(name, do_ops, undo_ops)` **一次调用 = 一个 Ctrl+Z action**。把同 batch 所有节点的 ops 聚合进一次调用即可，`undo_manager` **无需改动**（比预估更干净）：

```gdscript
# asset_placer.gd
var do_ops := []; var undo_ops := []
for item in items:
    var node := _make_node(item)  # mesh + material + name + transform
    do_ops.append_array([
        {"type":"method","target":parent,"method":"add_child","args":[node]},
        {"type":"method","target":node,"method":"set_owner","args":[root]},
        {"type":"reference","value":node},
    ])
    undo_ops.append({"type":"method","target":parent,"method":"remove_child","args":[node]})
_undo_manager.create_action_mixed("asset_batch_%d" % batch_id, do_ops, undo_ops)
```

### asset-forge 7 条不变量在整合后的处置
| # | 不变量 | 整合后 |
|---|---|---|
| 1 | undo 不删 `res://GeneratedAssets/*.tscn` | `save` 写预制件，undo 只 `remove_child`，不删文件 ✓ |
| 2 | undo 不跨编辑器会话 | Godot `UndoRedo` 本就不跨会话 ✓ |
| 3 | batch 原子 undo | 一次 `create_action_mixed`（上）✓ |
| 4 | batch per-item 散回执 | **语义适配**：MCP 同步模型返 `node_paths[]`（无流式回执需求；asset-forge 的 WS 散回执是其异步多客户端协议产物，MCP 单调用同步返回更自然） |
| 5 | 无活动场景 → error 不自动建 | 复用 `node_commands` `-32003` ✓ |
| 6 | `_resolve_parent` 双向兼容不建中间节点 | `asset_placer.resolve_parent` 复用 `node_commands` parent 解析（traversal 检查 + `get_node_or_null`），无效 → `PARENT_NOT_FOUND` ✓ |
| 7 | stairs/fence 单 ArrayMesh（单 surface） | `custom_meshes.gd` 原样移植（单 SurfaceTool commit）✓ |

## 8. 材质库定位（与 material-ops 互补，不合并）

| | `material-ops`（既有） | `material_presets.gd`（新增） |
|---|---|---|
| 通路 | headless `executeGdscriptTrusted`，`NON_PERSIST` | editor 路由，持久化 |
| 职责 | 读写**已有**材质属性 / shader | **创建时**按预设名/dict/res:// 生成 StandardMaterial3D 挂到新 MeshInstance3D |
| 时机 | 节点已存在后改 | asset 生成节点时一次性挂 |

两者不冲突：asset 负责「生」，material 负责「改」。`list_materials` action 暴露 10 预设给 AI 构造 `material` 入参。

## 9. 测试策略（TDD）

### GUT（GD 单测，`addons/godot_mcp_server/tests/` 或 asset-forge suite 适配路径）
- `AssetFactory`：11 shape 全覆盖（mesh 非空 + 顶点数/surface 数符合预期，stairs/fence 断言单 surface 保不变量 7）
- `CustomMeshes`：5 手写几何参数边界（cone segments、torus 半径、stairs step_height 等）
- `PathGenerator`：discrete/continuous 采样、align 朝向、v4 align_vertices 转角断开、v5 端柱去重、v6 ramp 衔接
- 移植 asset-forge 3 个 suite（AssetFactory/CustomMeshes/PathGenerator），**去掉** CommandServer suite（WS 层废弃）与 ScenePlacer suite 的 WS 耦合（放置逻辑改经 `asset_placer` + `undo_manager`，重写断言）

### Vitest（TS 单测，`test/`）
- `asset-ops` schema 校验：11 shape 各 params 合法/非法、material 三态、batch limit 边界（63/64/65）
- action 路由：list_* 静态返回内容、create/path/.../save 转发 editorExecutor 的调用契约（mock editorExecutor）
- 错误码：各错误场景返回正确 code + isError

### E2E（`test/e2e-*.test.ts`，L2 opt-in，真 Godot + editor）
- `asset create box` → editor → 断言 MeshInstance3D 出现 + transform 正确
- `asset path fence continuous` → 断言 N 个节点 + 朝向
- Ctrl+Z / `asset undo` → 断言节点消失（batch 原子）
- `asset save` → 断言 `res://GeneratedAssets/xxx.tscn` 落盘 + undo 不删文件（不变量 1）
- headless 模式调 create → 断言返 `EDITOR_ONLY`

## 10. 风险与备选

### 风险 1：editor 路由接入点（已消解）
核实结论（2026-07-08 审查）：`ToolDispatcher` editor 模式对全工具盲转 `editorExecutor`，无 editor-only 路由表；`test-framework.ts:76` 注释「dispatcher 前置分流」不准确（实际是 `_isUnknownMethod` 检测 -32601 后回退，`ToolDispatcher.ts:347-357`）。asset 无需改 TS 路由层。
**接入方式**：GD `command_handler.gd` match 加 5 分支 + `src/capability/static-grep.ts:66` `EDITOR_COMMAND_ROUTING` 加 5 映射 + `module-loader.ts` 注册。T1 从「核实路由表」降级为「确认 command_handler match + static-grep 接入」。

### 风险 2：几何体工厂移植兼容性
asset-forge 基于 Godot 4.6 Forward+；本仓库已测 4.5–4.7。手写 ArrayMesh（SurfaceTool）跨版本应稳定，但需验证 4.7 无 API 漂移。
**缓解**：T2 移植后跑 11 shape GUT suite 全绿 + 4.7 矩阵验证（本仓库 `cross-version-3d-verification` 设施）。

### 风险 3：path 的 Path3D 节点读取
asset-forge `--path-node` 读场景 Path3D.curve.baked_points。editor 层 `EditorInterface.get_edited_scene_root()` 可访问场景树，Path3D 读取应可行；但需确认 owner/活动场景语义。
**缓解**：T3 单独验证 path_node 取点 + 坐标系（asset-forge 已注释「建议 parent 留空，非 root parent 坐标错位」，移植保留该约束并在 tool description 注明）。

### 风险 4：undo 全局栈语义
`asset_undo` 调 `get_undo_redo().undo()` 弹编辑器全局栈顶（不区分来源）。若用户在 asset 生成后又手动编辑场景，`asset_undo` 会先撤手动编辑。
**缓解**：tool description 明示「undo 弹编辑器栈顶 action，通常为最近一次 asset 批次」；不承诺只撤 asset 操作。AI 使用时应在生成后立即 undo 或依赖节点 path 精确管理。
**增强（可选）**：asset_placer 维护 `_asset_batch_ids` LIFO 栈，asset_undo 前 `get_undo_redo().get_action_name()` 校验栈顶是否 `asset_batch_<id>`/`asset_path_<id>`，非则 content 加 warning「栈顶非 asset 批次，将撤最近一次编辑」并仍执行（保留用户最终控制权）。

## 11. 验收标准

- [ ] merged `asset` 工具注册成功（工具数 32 → 33，capability-matrix 同步，`npm run diff-matrix` 过）
- [ ] 10 shape 全部生成正确 + ramp 仅单件 PrismMesh（GUT + E2E 验证 mesh 非空 + 参数生效；continuous ramp 不在验收范围，TODO 待上游）
- [ ] path 阵列：discrete/continuous + v4 align_vertices + v5 端柱去重 + v6 ramp 衔接 全工作
- [ ] batch：≤64 items 一次生成 + 一次 undo（不变量 3）；>64 返 `BATCH_LIMIT_EXCEEDED`
- [ ] batch 原子 undo：Ctrl+Z 一次撤整批（`create_action_mixed` 聚合，零改 undo_manager）
- [ ] `asset_undo` 程序化撤销工作（栈空返 `NOTHING_TO_UNDO`）
- [ ] `asset_save` 存子树为 `res://GeneratedAssets/*.tscn`，undo 不删文件（不变量 1）
- [ ] 材质三态：预设名 / dict（hex color + alpha 透明）/ res:// / null→default
- [ ] 错误码全场景正确（UNSUPPORTED_SHAPE/INVALID_PARAMS/PARENT_NOT_FOUND/NO_ACTIVE_SCENE/NOTHING_TO_UNDO/BATCH_LIMIT_EXCEEDED/INVALID_PATH/RESOURCE_SAVE_FAILED）
- [ ] 安全：node name 白名单 + parent traversal + save resource_path 白名单 单测过
- [ ] headless 模式 create/path/batch/undo/save 返 `EDITOR_ONLY`；list_* 在 headless 可用
- [ ] TDD：GUT（AssetFactory/CustomMeshes/PathGenerator）+ Vitest（asset-ops）+ E2E L2 全过
- [ ] 全套测试不回归（`verify_delivery`）
- [ ] batch 部分失败原子性：item N 失败 → 零节点落地 + undo 栈空（预校验，GUT/Vitest 断言）
- [ ] asset-ops 裸 `as` 断言计数 = 0（`src/tools/asset/` 内 `args.<field> as <type>` 模式 grep 应为空）
- [ ] save resource_path 经 realpathSync：符号链接/路径遍历测试过（对齐 path-sandbox-touctou-bypass）
- [ ] `_vec3` 无新副本（复用 command_helpers 或 shared_vec）
- [ ] v5 fence 端柱去重 + make_ramp 阻塞 均已落实（T2/T3 核实修正）
- [ ] actionRisks 声明（module-loader injectTags 派生 MCP hints 正确）
- [ ] LICENSE 保留 AssetForge Contributors MIT 声明 + 酌情新增 Tripo3D 致谢（fork 来源；注：asset-forge LICENSE 本身无 Tripo3D 声明，仅 README/CLAUDE.md 致谢）
- [ ] 版本 v0.22.0（plugin.cfg + package.json + README + capability-matrix + static-grep 映射）

## 12. 实现任务拆分（供 writing-plans）

- **T1 路由接入确认（已降级）**：核实结论——无 editor-only 路由表，dispatcher 全工具盲转。T1 实际工作：`command_handler.gd` match 加 5 分支占位 + `static-grep.ts` `EDITOR_COMMAND_ROUTING` 加 5 映射（drift 测试须过）。可与 T6 合并。
- **T2 几何体工厂移植**：`asset_factory.gd` + `custom_meshes.gd`（**5 手写 cone/tube/torus/stairs/fence，不含 make_ramp——方案 A 阻塞**；去 class_name 改 preload）+ GUT 10 shape 全绿（ramp 仅 PrismMesh 单件）+ 4.7 矩阵（风险 2）
- **T3 路径阵列移植**：`path_generator.gd`（discrete/continuous + v4 align-vertices；**不含 v5/v6**）+ `asset_placer` 移植 v5 fence 端柱注入（`asset_forge_plugin.gd:334-338` + `custom_meshes._post_xs`）+ continuous shape=ramp 返 `UNSUPPORTED_SHAPE`（方案 A）+ Path3D 读取验证（风险 3）+ GUT
- **T4 材质库移植**：`material_presets.gd`（10 预设 + dict + res://）+ GUT
- **T5 放置 + batch undo**：`asset_placer.gd`（parent 解析/name 自增含 `-`→`_` sanitize/transform/owner/材质挂载 + v5 端柱注入 + `create_action_mixed` 聚合 + **batch 预校验原子：item N 失败→零节点落地**）+ 复用 node_commands 防御 + `_vec3` 复用 command_helpers
- **T6 命令入口 + 注册**：`asset_commands.gd`（handle_create/path/batch/undo/save）+ `command_handler.gd` setup/handle/cleanup 改动
- **T7 TS 工具**：`asset-ops.ts`（requireString/zod 禁裸 `as`）+ `schema.ts`（11 shape 元数据 + fence 完整参数）+ module-loader 注册 + actionRisks（仿 `particles.ts:517`）+ headless `EDITOR_ONLY` 守卫（仿 `test-framework.ts:79`）
- **T8 save 预制件 + 路径白名单**：`asset_save`（PackedScene.pack + ResourceSaver 返回值检查）+ ALLOWED_PROJECT_PATHS + `resolveWithinRoot`(realpathSync) + `normalizeUserProjectPath`（TS）+ `CommandHelpers.has_path_traversal` + res:// 复核（GD）
- **T9 TS 单测**：asset-ops schema/action 路由/错误码 Vitest
- **T10 E2E L2**：create/path/batch/undo/save 真编辑器验证 + headless EDITOR_ONLY
- **T11 收尾**：capability-matrix（`npm run build-matrix` + `diff-matrix` 过）+ static-grep `EDITOR_COMMAND_ROUTING` 5 映射 + actionRisks injectTags 派生 MCP hints + LICENSE（AssetForge Contributors + 酌情 Tripo3D 致谢）+ v0.22.0 版本号（plugin.cfg + package.json + README）+ `verify_delivery`
