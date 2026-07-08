# asset-forge 整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 asset-forge 的几何体工厂/路径阵列/材质库下沉为 mcp-enhanced 的 1 个 merged `asset` MCP 工具（7 action），走 editor 层持久化，v0.22.0 发版。

**Architecture:** asset-forge 的纯计算层（AssetFactory/CustomMeshes/MaterialLibrary/PathGenerator/ScenePlacer）移植为 `addons/godot_mcp_server/commands/asset/` 下 6 个 `@tool` GD 文件（去 `class_name` 改 `preload`）；新增 `asset_commands.gd` 入口挂在 `command_handler.gd`；TS 侧新增 `src/tools/asset/`（asset-ops.ts + schema.ts）注册 1 个 merged 工具。create/path/batch/undo/save 走 `ToolDispatcher` 全工具盲转 editor → `command_handler` match → asset_commands 持久化（`undo_manager.create_action_mixed` 聚合 batch 原子 undo）；list_shapes/list_materials TS 静态返回（-32601 回退）。方案 A：continuous ramp（make_ramp）+ v6 阻塞。

**Tech Stack:** Godot 4.6 Forward+（兼容 4.5–4.7）/ GDScript @tool / TypeScript Node 18+ / MCP SDK / Vitest + E2E（真 Godot）。

## Global Constraints

- **Godot 版本**：4.6（Forward+），须过 4.5/4.6/4.7 兼容矩阵（`cross-version-3d-verification` 设施）
- **Node.js** ≥ 18
- **工具合并惯例**：1 个 merged `asset` 工具，7 action（create/path/batch/undo/save/list_shapes/list_materials），工具总数 32 → 33
- **GD 模块**：`addons/godot_mcp_server/commands/asset/` 目录（6 文件，职责分组）；每个 .gd 顶格 `@tool`；**去 `class_name` 改 `preload`**（对齐 command_handler.gd:26 既有惯例，避免全局命名空间污染）
- **method 命名**：`asset_create`/`asset_path`/`asset_batch`/`asset_undo`/`asset_save`（对齐 `particles_create` 同构）
- **安全**：node name 白名单 `^[A-Za-z0-9_]+$`（复用 `node_commands.gd:41`）；parent 路径 `CommandHelpers.has_path_traversal`；save resource_path 经 `isPathInAllowedRoots` + `resolveWithinRoot`(realpathSync) + `normalizeUserProjectPath`（TS）+ `has_path_traversal` + res://（GD）；TS 入参**禁裸 `as`**（requireString/zod 前置校验，对齐 DEFECT.project.godot-mcp-enhanced.ts-args-as-cast-no-validation）
- **batch 原子 undo**：一次 `undo_manager.create_action_mixed` 聚合同 batch 全部节点 ops（零改 undo_manager）；batch 预校验原子（item N 失败→零节点落地）
- **`_vec3` 不保留副本**：复用 `command_helpers.gd` 既有向量解析（兼容 Array + PackedFloat64Array），不引入第 3-4 份副本
- **方案 A（ramp 阻塞）**：continuous ramp（`CustomMeshes.make_ramp` 手写 wedge）+ v6 衔接**不移植**——上游有 2 个 open CRITICAL（`ramp-winding-mixed-convention` + `ramp-height-chord-as-arc`，见 `D:\workspace\review\.claude\knowledge\projects\godot-asset-forge\defects.md`）；单件 PrismMesh ramp（create action）+ discrete path ramp 不受影响；continuous path 模式 shape=ramp 返 `UNSUPPORTED_SHAPE`
- **移植源**：`D:\GitHub\godot-asset-forge\addons\asset_forge\`（asset_factory.gd / custom_meshes.gd / material_library.gd / scene_placer.gd / asset_forge_plugin.gd 的 path+v5 逻辑）
- **版本**：v0.22.0（plugin.cfg + package.json + README + capability-matrix）
- **LICENSE**：保留 AssetForge Contributors MIT 声明 + 酌情 Tripo3D 致谢（asset-forge LICENSE 本身无 Tripo3D 声明，仅 README/CLAUDE.md 致谢）
- **测试**：TS Vitest（单测）+ E2E L2（真 Godot editor）。**不引入 GUT**（mcp-enhanced 无 GUT 设施，`test/**/*.gd` 零文件；spec §9 的 GUT suite 移植调整为 TS 单测 + E2E 覆盖几何体正确性）

## File Structure

### 创建（13 文件）

**GD（`addons/godot_mcp_server/commands/asset/`，6 文件）**
| 文件 | 职责 | 来源 |
|---|---|---|
| `asset_commands.gd` | 命令入口 extends Node：`setup(plugin, undo_manager)` + `handle_create/path/batch/undo/save(params, request_id)`，编排工厂+阵列+放置 | 新写（仿 `node_commands.gd`） |
| `asset_factory.gd` | shape→mesh 调度：6 PrimitiveMesh 分发（box/cylinder/sphere/prism/wall/ramp）+ 5 手写转 `custom_meshes.gd`（cone/tube/torus/stairs/fence）+ `create_material(spec)` 三态（预设/dict 含 emissive/res://） | 移植 asset-forge `asset_factory.gd`（去 class_name） |
| `custom_meshes.gd` | 5 手写 ArrayMesh：`make_cone/make_tube/make_torus/make_stairs/make_fence` + `_post_xs`（v5 端柱 x 坐标纯函数）+ `_add_box/_add_face/_add_cylinder` 辅助。**不含 make_ramp** | 移植 asset-forge `custom_meshes.gd`（去 class_name） |
| `material_presets.gd` | 10 预设 StandardMaterial3D 工厂 | 移植 asset-forge `material_library.gd`（去 class_name） |
| `path_generator.gd` | 路径阵列：`resolve_points`（Path3D baked_points / 数组）、`sample`（discrete/continuous + v4 align_vertices）、朝向。**不含 v5/v6** | 移植 asset-forge path 逻辑（在 `asset_forge_plugin.gd` 内，抽为独立模块） |
| `asset_placer.gd` | 放置：`resolve_parent`/`unique_name`（含 `-`→`_` sanitize）/transform/owner/挂材质 + v5 fence 端柱注入 + `place_many`（batch 聚合 `create_action_mixed` + 预校验原子） | 移植 asset-forge `scene_placer.gd` + `asset_forge_plugin.gd` v5 注入逻辑 |

**TS（`src/tools/asset/`，2 文件）**
| 文件 | 职责 |
|---|---|
| `asset-ops.ts` | merged `asset` 工具：`getToolDefinitions()`（7 action enum + inputSchema）、`handleTool(name,args,ctx)`（list_* 静态返回；create/path/batch/undo/save 转 `ctx` 的 editorExecutor + headless `EDITOR_ONLY` 守卫）、`TOOL_META`（actionRisks） |
| `schema.ts` | 11 shape 名 + 各 params 默认值/类型 + fence 完整参数（post_radius/rail_thickness）、10 材质预设名、material 三态规则——list_* 数据源 + 入参校验依据 |

**测试（TS）**
| 文件 | 职责 |
|---|---|
| `test/tools/asset-ops.test.ts` | asset-ops schema 校验 / action 路由 / 错误码 / 裸 as 计数 |
| `test/e2e-asset-tools.test.ts` | E2E L2：create/path/batch/undo/save 真 Godot editor 验证 |

### 修改（4 文件）
| 文件 | 改动 |
|---|---|
| `addons/godot_mcp_server/command_handler.gd` | setup() 加 `_asset_commands` 实例化 + add_child；handle() match 加 5 分支（asset_create/path/batch/undo/save）；cleanup() 加 `_asset_commands` |
| `src/core/module-loader.ts` | import asset + ALL_MODULES 追加 `asset` |
| `src/capability/static-grep.ts` | `EDITOR_COMMAND_ROUTING` 加 5 映射（asset_create 等→commands/asset/asset_commands.gd） |
| `package.json` + `addons/godot_mcp_server/plugin.cfg` + `README.md` + `docs/capability-matrix.md` | 版本 v0.22.0 + capability-matrix（`npm run build-matrix`） |

### 不修改
- `src/core/ToolDispatcher.ts`（盲转 + -32601 回退已存在，asset 无需改 TS 路由层）
- `addons/godot_mcp_server/undo_manager.gd`（batch 用既有 `create_action_mixed`）

---

## Task 1: 路由接入确认 + 命令模块骨架（T1，已降级，可与 T6 合并的前置）

**Files:**
- Modify: `addons/godot_mcp_server/command_handler.gd`
- Create: `addons/godot_mcp_server/commands/asset/asset_commands.gd`（骨架）

**Interfaces:**
- Produces: `asset_commands.gd::setup(plugin, undo_manager)` + 5 个 `handle_*(params, request_id) -> Dictionary`（本任务返桩 dict，后续 task 填实现）

- [ ] **Step 1: 写 asset_commands.gd 骨架**

创建 `addons/godot_mcp_server/commands/asset/asset_commands.gd`：

```gdscript
@tool
extends Node

var _plugin: EditorPlugin
var _undo_manager: Node

func setup(plugin: EditorPlugin, undo_manager: Node) -> void:
	_plugin = plugin
	_undo_manager = undo_manager

# 占位返回，后续 task 替换为真实实现
func _stub(action: String) -> Dictionary:
	return {"error": {"code": -32601, "message": "asset_%s not implemented" % action}}

func handle_create(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("create")

func handle_path(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("path")

func handle_batch(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("batch")

func handle_undo(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("undo")

func handle_save(params: Dictionary, request_id: int) -> Dictionary:
	return _stub("save")
```

- [ ] **Step 2: command_handler.gd 挂载 + match 分支**

`command_handler.gd` 顶部成员变量区（L15 `_ui_commands` 后）加：
```gdscript
var _asset_commands: Node
```

`setup()`（L66 `_ui_commands` 块后）加：
```gdscript
	_asset_commands = preload("commands/asset/asset_commands.gd").new()
	_asset_commands.setup(plugin, _undo_manager)
	add_child(_asset_commands)
```

`handle()` match（L188 `theme_set_property` 分支后、`guard_text_resource_write` 前）加：
```gdscript
		# --- asset -----------------------------------------------------
		"asset_create":
			return _asset_commands.handle_create(params, request_id)
		"asset_path":
			return _asset_commands.handle_path(params, request_id)
		"asset_batch":
			return _asset_commands.handle_batch(params, request_id)
		"asset_undo":
			return _asset_commands.handle_undo(params, request_id)
		"asset_save":
			return _asset_commands.handle_save(params, request_id)
```

`cleanup()` modules 列表（L72）加 `_asset_commands`，置 null 区加 `_asset_commands = null`。

- [ ] **Step 3: 跑 GD 校验**

Run: `"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" --headless --path "D:/GitHub/godot-mcp-enhanced" --check-only --script addons/godot_mcp_server/plugin.gd 2>&1 | head -20`
Expected: 无 SCRIPT ERROR / PARSE ERROR（骨架语法正确；占位返 -32601 不影响加载）。若报 preload 路径错，确认文件在 `commands/asset/` 子目录。

- [ ] **Step 4: static-grep.ts 加映射**

读 `src/capability/static-grep.ts`，在 `EDITOR_COMMAND_ROUTING`（约 L66）加 5 行（仿既有 add_node 映射格式）：
```typescript
  asset_create: 'commands/asset/asset_commands.gd',
  asset_path: 'commands/asset/asset_commands.gd',
  asset_batch: 'commands/asset/asset_commands.gd',
  asset_undo: 'commands/asset/asset_commands.gd',
  asset_save: 'commands/asset/asset_commands.gd',
```

- [ ] **Step 5: Commit**

```bash
git add addons/godot_mcp_server/command_handler.gd addons/godot_mcp_server/commands/asset/asset_commands.gd src/capability/static-grep.ts
git commit -m "feat(asset): T1 命令模块骨架 + command_handler 路由接入 5 method"
```

---

## Task 2: 几何体工厂移植——内置 6 shape + create_material（T2a）

**Files:**
- Create: `addons/godot_mcp_server/commands/asset/asset_factory.gd`
- Create: `addons/godot_mcp_server/commands/asset/material_presets.gd`

**Interfaces:**
- Produces: `AssetFactory.create_mesh(shape: String, params: Dictionary) -> ArrayMesh`（6 内置 PrimitiveMesh 分发；未知 shape 返 null）、`AssetFactory.create_material(spec: Variant) -> Material`（三态：String 预设名→material_presets；Dictionary PBR 含 color/alpha/emissive；String res://→load；null→default）、`MaterialPresets.create(preset_name: String) -> StandardMaterial3D`（10 预设，未知→default）

- [ ] **Step 1: 移植 material_presets.gd**

从 `D:\GitHub\godot-asset-forge\addons\asset_forge\material_library.gd` 复制全部内容到 `addons/godot_mcp_server/commands/asset/material_presets.gd`。改动：
1. 顶格保留 `@tool`，**删除 `class_name MaterialLibrary` 行**（改 preload 引用）
2. `extends RefCounted` 保留
3. 静态方法 `create`/预设工厂原样保留（10 预设 wood/metal/stone/glass/gold/coral/sand/seaweed/water/default）

- [ ] **Step 2: 移植 asset_factory.gd 的内置 mesh 分发 + create_material**

从 `D:\GitHub\godot-asset-forge\addons\asset_forge\asset_factory.gd` 复制到 `addons/godot_mcp_server/commands/asset/asset_factory.gd`。改动：
1. `@tool` 保留，**删除 `class_name AssetFactory`**
2. 顶部加 `const MaterialPresets = preload("material_presets.gd")`
3. `create_mesh` 的 match：保留 box/cylinder/sphere/prism/wall/ramp 6 内置 PrimitiveMesh 分支（原样）；**删除/注释 cone/tube/torus/stairs/fence 转 custom_meshes 的 5 分支**（Task 3 接回，本任务先不引用 custom_meshes）
4. `create_material(spec)` 原样移植（含 `d.has("emissive")` → `mat.emission` 分支，`asset_factory.gd:137-139`）
5. `_safe_html`/`_vec3` 等辅助原样移植

- [ ] **Step 3: 写 TS 单测验证 create_material 三态（先于 GD，因 mcp-enhanced 无 GUT，create_material 纯逻辑用 TS 反射验证不现实——改为 E2E 在 Task 10 覆盖，本步跳过单测，靠 GD 语法校验 + 移植忠实度）**

Run: `"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" --headless --path "D:/GitHub/godot-mcp-enhanced" --check-only --script addons/godot_mcp_server/commands/asset/asset_factory.gd 2>&1 | head`
Expected: 仅 PARSE 通过的提示（或无错误）。确认 preload 路径、无 class_name 残留。

- [ ] **Step 4: 4.7 兼容冒烟（GD 4.7 无 PrimitiveMesh API 漂移）**

Run: `"/d/Godot/Godot_v4.7<你的路径>" --headless --check-only --script addons/godot_mcp_server/commands/asset/asset_factory.gd 2>&1 | head`
Expected: 无错误。（若无 4.7 二进制，记 TODO 在 Task 11 矩阵补）

- [ ] **Step 5: Commit**

```bash
git add addons/godot_mcp_server/commands/asset/material_presets.gd addons/godot_mcp_server/commands/asset/asset_factory.gd
git commit -m "feat(asset): T2a 移植内置 6 shape 工厂 + create_material 三态 + 10 材质预设"
```

---

## Task 3: 几何体工厂移植——手写 5 shape（T2b，不含 make_ramp）

**Files:**
- Create: `addons/godot_mcp_server/commands/asset/custom_meshes.gd`
- Modify: `addons/godot_mcp_server/commands/asset/asset_factory.gd`

**Interfaces:**
- Produces: `CustomMeshes.make_cone/make_tube/make_torus/make_stairs/make_fence(params: Dictionary) -> ArrayMesh` + `_post_xs(length, posts, start_post, end_post) -> Array`（v5 端柱纯函数）；asset_factory.create_mesh 接回 5 手写分发

- [ ] **Step 1: 移植 custom_meshes.gd（5 手写，不含 make_ramp）**

从 `D:\GitHub\godot-asset-forge\addons\asset_forge\custom_meshes.gd` 复制到 `addons/godot_mcp_server/commands/asset/custom_meshes.gd`。改动：
1. `@tool` 保留，**删除 `class_name CustomMeshes`**
2. 保留：`make_cone`/`make_tube`/`make_torus`/`make_stairs`/`make_fence` + `_post_xs` + `_add_box`/`_add_face`/`_add_cylinder`/`_torus_vertex`
3. **删除整个 `make_ramp` 函数**（L221-250）及其注释（方案 A 阻塞——上游 ramp-winding-mixed-convention / ramp-height-chord-as-arc 两个 open CRITICAL）
4. `make_fence` 的 `start_post`/`end_post`/`_post_xs` v5 逻辑原样保留（放置层 Task 6 注入参数）

- [ ] **Step 2: asset_factory.create_mesh 接回 5 手写**

`asset_factory.gd` 顶部加 `const CustomMeshes = preload("custom_meshes.gd")`。`create_mesh` match 恢复 cone/tube/torus/stairs/fence 5 分支转 `CustomMeshes.make_xxx`（从源文件 `asset_factory.gd` 复制对应分支原样）。

- [ ] **Step 3: GD 语法校验**

Run: `"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" --headless --path "D:/GitHub/godot-mcp-enhanced" --check-only --script addons/godot_mcp_server/commands/asset/custom_meshes.gd 2>&1 | head`
Expected: 无 PARSE ERROR。确认无 make_ramp 残留（`grep -n make_ramp addons/godot_mcp_server/commands/asset/` 应空）。

- [ ] **Step 4: 确认 fence 单 surface（不变量 7）+ _post_xs 纯函数保留**

人工核对：`make_fence` 全部部件（柱循环 + 上下横档）进同一 SurfaceTool 后一次 `commit()`（单 surface）。`_post_xs` 是 static func 纯函数（无副作用）。

- [ ] **Step 5: Commit**

```bash
git add addons/godot_mcp_server/commands/asset/custom_meshes.gd addons/godot_mcp_server/commands/asset/asset_factory.gd
git commit -m "feat(asset): T2b 移植 5 手写 shape（cone/tube/torus/stairs/fence），make_ramp 阻塞"
```

---

## Task 4: 路径阵列移植——discrete/continuous + v4（T3a，不含 v5/v6）

**Files:**
- Create: `addons/godot_mcp_server/commands/asset/path_generator.gd`

**Interfaces:**
- Produces: `PathGenerator.resolve_points(root: Node, path: Array, path_node: String) -> Array[Vector3]`（path_node 读场景 Path3D.curve.baked_points；path 直用 [[x,y,z]...]）、`PathGenerator.sample(points: Array, mode: String, spacing: float, count: int, align: String, align_vertices: bool) -> Array[Dictionary]`（每项 `{position: Vector3, rotation: Vector3, length: float, params: Dictionary}`；continuous 模式 length 自适应段长；v4 align_vertices 折线顶点强制段边界）。**不含 v5（放置层）v6（阻塞）**

- [ ] **Step 1: 抽取 path 算法到独立模块**

asset-forge 的 path 逻辑在 `D:\GitHub\godot-asset-forge\addons\asset_forge\asset_forge_plugin.gd`（非独立文件——CLAUDE.md 说 10 文件扁平，path 在 plugin 内）。读该文件，定位 path 相关函数（采样/朝向/continuous/align_vertices，约 `_generate_path`/`_sample_*`/`_align_*`）。

创建 `addons/godot_mcp_server/commands/asset/path_generator.gd`：
```gdscript
@tool
extends RefCounted
```
把 plugin 内的 path 纯算法函数搬入（**去掉对 plugin/scene_placer 的依赖，改为接收 points + 参数返 segment 列表**）。保留：
- discrete 采样（spacing 或 count）
- continuous 采样（栏板首尾相连，length 自适应段长）
- align（none/path/normal 朝向）
- **v4 align_vertices**（折线顶点强制段边界）

**删除**：
- v5 端柱去重逻辑（属放置层，Task 6 在 asset_placer 做）
- v6 ramp 高度衔接（`_compute_seg_heights`——方案 A 阻塞，不移植）

- [ ] **Step 2: resolve_points 实现（Path3D baked_points）**

```gdscript
static func resolve_points(root: Node, path: Array, path_node: String) -> Array:
	var pts: Array = []
	if path_node != "":
		var pn: Node = root.get_node_or_null(path_node)
		if pn == null or not (pn is Path3D):
			return []  # 调用方返 PARENT_NOT_FOUND
		var baked: PackedVector3Array = (pn as Path3D).curve.get_baked_points()
		for p in baked:
			pts.append(p)
	elif path.size() >= 2:
		for p in path:
			pts.append(Vector3(float(p[0]), float(p[1]), float(p[2])))
	return pts
```

- [ ] **Step 3: GD 语法校验**

Run: `"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" --headless --path "D:/GitHub/godot-mcp-enhanced" --check-only --script addons/godot_mcp_server/commands/asset/path_generator.gd 2>&1 | head`
Expected: 无错误。确认无 `_compute_seg_heights`（v6）残留。

- [ ] **Step 4: Commit**

```bash
git add addons/godot_mcp_server/commands/asset/path_generator.gd
git commit -m "feat(asset): T3a 移植路径阵列（discrete/continuous + v4 align_vertices），v5/v6 不含"
```

---

## Task 5: 放置层 + batch 原子 undo + v5 端柱注入（T5）

**Files:**
- Create: `addons/godot_mcp_server/commands/asset/asset_placer.gd`

**Interfaces:**
- Consumes: `AssetFactory.create_mesh/create_material`、`PathGenerator.sample`、`_undo_manager.create_action_mixed`、`CommandHelpers.has_path_traversal`
- Produces: `AssetPlacer.place_one(root, shape, params, material, name, parent, transform) -> Dictionary`（`{node_path}` 或 `{error}`）、`AssetPlacer.place_path(root, shape, params, material, segments, batch_id) -> Dictionary`（`{node_paths:[], count}`）、`AssetPlacer.place_batch(root, items, batch_id) -> Dictionary`（预校验原子 + 聚合 undo）、`AssetPlacer.unique_name(parent, base) -> String`（碰撞自增 `_001`，含 `-`→`_` sanitize）

- [ ] **Step 1: 移植 scene_placer 放置逻辑 + unique_name sanitize**

从 `D:\GitHub\godot-asset-forge\addons\asset_forge\scene_placer.gd` 复制放置逻辑到 `asset_placer.gd`（`@tool extends RefCounted`，去 class_name）。改动：
1. **`_vec3` 删除**——改用 `command_helpers.gd` 既有向量解析（兼容 Array + PackedFloat64Array）。顶部 `const CommandHelpers = preload("../command_helpers.gd")`，调其向量解析；若 command_helpers 无，本任务补一个 `static func parse_vec3(v) -> Vector3` 到 command_helpers（兼容 Array + PackedFloat64Array），不建第 3 份副本
2. `resolve_parent`：复用 `CommandHelpers.has_path_traversal`（对齐 node_commands.gd:52）；绝对路径剥首段（若=root.name）+ 相对路径都吃；无效返 `PARENT_NOT_FOUND`
3. `unique_name`：base 名先 sanitize（非 `[A-Za-z0-9_]` → `_`，含 asset-forge `_sanitize_name` 允许的 `-`），再碰撞自增 `_001`

- [ ] **Step 2: place_one（单件放置 + undo action）**

```gdscript
static func place_one(root: Node, undo_mgr: Node, shape: String, params: Dictionary,
		material: Variant, node_name: String, parent_path: String, request_id: int) -> Dictionary:
	var parent := _resolve_parent(root, parent_path)
	if parent == null:
		return {"error": {"code": "PARENT_NOT_FOUND", "message": "parent: %s" % parent_path}}
	var mesh := AssetFactory.create_mesh(shape, params)
	if mesh == null:
		return {"error": {"code": "UNSUPPORTED_SHAPE", "message": shape}}
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.name = unique_name(parent, node_name if node_name != "" else shape)
	node.material_override = AssetFactory.create_material(material)
	# transform 由 params position/rotation/scale 设（用 command_helpers 向量解析）
	_apply_transform(node, params)
	var do_ops := [
		{"type":"method","target":parent,"method":"add_child","args":[node]},
		{"type":"method","target":node,"method":"set_owner","args":[root]},
		{"type":"reference","value":node},
	]
	var undo_ops := [{"type":"method","target":parent,"method":"remove_child","args":[node]}]
	undo_mgr.create_action_mixed("asset_create_%d" % request_id, do_ops, undo_ops)
	return {"result": {"node_path": str(node.get_path())}}
```

- [ ] **Step 3: place_batch（预校验原子 + 聚合 undo）**

```gdscript
static func place_batch(root: Node, undo_mgr: Node, items: Array, request_id: int) -> Dictionary:
	if items.size() > 64:
		return {"error": {"code": "BATCH_LIMIT_EXCEEDED", "message": "batch > 64: %d" % items.size()}}
	# 预校验全部 item（原子）：任一失败零节点落地
	for item in items:
		var v := _validate_item(root, item)  # shape∈10/params/material/parent
		if v != "":
			return {"error": {"code": "INVALID_PARAMS", "message": v}}
	# 全过才执行：累积所有 ops 进一次 create_action_mixed（batch 原子 undo）
	var do_ops: Array = []
	var undo_ops: Array = []
	var node_paths: Array = []
	for item in items:
		var parent := _resolve_parent(root, item.get("parent", ""))
		var mesh := AssetFactory.create_mesh(item["shape"], item.get("params", {}))
		var node := MeshInstance3D.new()
		node.mesh = mesh
		node.name = unique_name(parent, item.get("name", item["shape"]))
		node.material_override = AssetFactory.create_material(item.get("material", null))
		_apply_transform(node, item.get("params", {}))
		_inject_fence_posts(node, item)  # v5 端柱（若 shape=fence）
		do_ops.append_array([
			{"type":"method","target":parent,"method":"add_child","args":[node]},
			{"type":"method","target":node,"method":"set_owner","args":[root]},
			{"type":"reference","value":node},
		])
		undo_ops.append({"type":"method","target":parent,"method":"remove_child","args":[node]})
		node_paths.append("<pending>")  # commit 后回填真实 path
	undo_mgr.create_action_mixed("asset_batch_%d" % request_id, do_ops, undo_ops)
	# 注：node.get_path() 在 add_child 后才有效；上面 do_ops 已 add_child，commit 后节点已挂载
	# 回填真实 path（遍历 do_ops 的 reference 取 node）
	var idx := 0
	for op in do_ops:
		if op.get("type") == "reference" and op.get("value") is MeshInstance3D:
			node_paths[idx] = str((op.value).get_path())
			idx += 1
	return {"result": {"node_paths": node_paths}}
```

- [ ] **Step 4: v5 fence 端柱注入**

从 `D:\GitHub\godot-asset-forge\addons\asset_forge\asset_forge_plugin.gd:334-338`（v5 端柱注入逻辑）移植到 `asset_placer.gd::_inject_fence_posts`：连续 fence 段共享端柱（前段 end_post=false / 后段 start_post=false），调 `CustomMeshes._post_xs`。single fence（非 path）默认 start_post=end_post=true（零回归）。

```gdscript
static func _inject_fence_posts(node: MeshInstance3D, item: Dictionary) -> void:
	# 仅 path continuous fence 由 place_path 调用前设 item.start_post/end_post
	# single fence 默认 true（零回归）
	pass  # 实现按 asset_forge_plugin.gd:334-338 的 start_post/end_post 传递逻辑
```
（实现细节从源文件 334-338 行精确复制；连续段首段 end_post=false、末段 start_post=false、中间段两端 false。）

- [ ] **Step 5: place_path（调 PathGenerator.sample + place 批量 + v5 注入）**

```gdscript
static func place_path(root: Node, undo_mgr: Node, shape: String, params: Dictionary,
		material: Variant, points: Array, mode: String, spacing: float, count: int,
		align: String, align_vertices: bool, request_id: int) -> Dictionary:
	if mode == "continuous" and shape == "ramp":
		return {"error": {"code": "UNSUPPORTED_SHAPE", "message": "continuous ramp 阻塞（方案 A）"}}
	var segments := PathGenerator.sample(points, mode, spacing, count, align, align_vertices)
	if segments.is_empty():
		return {"error": {"code": "INVALID_PARAMS", "message": "path 采样空"}}
	# 构造 items（每段 position/rotation/length），连续 fence 注入 v5 端柱
	var items: Array = []
	for i in segments.size():
		var seg: Dictionary = segments[i]
		var item := {"shape": shape, "params": params.duplicate(), "material": material,
			"position": seg.position, "rotation": seg.rotation}
		item.params.length = seg.length
		if shape == "fence" and mode == "continuous":
			item.start_post = (i == 0)
			item.end_post = (i == segments.size() - 1)
		items.append(item)
	return place_batch(root, undo_mgr, items, request_id)
```

- [ ] **Step 6: GD 语法校验**

Run: `"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" --headless --path "D:/GitHub/godot-mcp-enhanced" --check-only --script addons/godot_mcp_server/commands/asset/asset_placer.gd 2>&1 | head`
Expected: 无错误。确认 `_vec3` 无副本（grep `_vec3` asset_placer 应空，用 command_helpers）。

- [ ] **Step 7: Commit**

```bash
git add addons/godot_mcp_server/commands/asset/asset_placer.gd addons/godot_mcp_server/commands/command_helpers.gd
git commit -m "feat(asset): T5 放置层 + batch 原子 undo + v5 端柱注入 + _vec3 复用 command_helpers"
```

---

## Task 6: asset_commands 编排 + command_handler 接线（T6）

**Files:**
- Modify: `addons/godot_mcp_server/commands/asset/asset_commands.gd`

**Interfaces:**
- Consumes: Task 2-5 全部工厂/阵列/放置
- Produces: 5 个 handle_* 真实实现（替换 Task 1 桩）

- [ ] **Step 1: 顶部 preload + 编排 handle_create**

替换 Task 1 的 `_stub`，`asset_commands.gd` 顶部加：
```gdscript
const AssetFactory = preload("asset_factory.gd")
const CustomMeshes = preload("custom_meshes.gd")
const MaterialPresets = preload("material_presets.gd")
const PathGenerator = preload("path_generator.gd")
const AssetPlacer = preload("asset_placer.gd")
```

`handle_create` 实现：
```gdscript
func handle_create(params: Dictionary, request_id: int) -> Dictionary:
	var ei := _get_ei()
	if ei == null:
		return {"error": {"code": "NO_ACTIVE_SCENE", "message": "EditorInterface unavailable"}}
	var root := ei.get_edited_scene_root()
	if root == null:
		return {"error": {"code": "NO_ACTIVE_SCENE", "message": "no active scene"}}
	return AssetPlacer.place_one(root, _undo_manager,
		params.get("shape", ""), params.get("params", {}),
		params.get("material", null), params.get("name", ""),
		params.get("parent", ""), request_id)

func _get_ei() -> EditorInterface:
	if _plugin == null:
		return null
	return _plugin.get_editor_interface()
```

- [ ] **Step 2: handle_path / handle_batch / handle_undo / handle_save**

```gdscript
func handle_path(params: Dictionary, request_id: int) -> Dictionary:
	var root := _get_root()
	if root == null: return {"error": {"code": "NO_ACTIVE_SCENE", "message": "no active scene"}}
	var points := PathGenerator.resolve_points(root, params.get("path", []), params.get("path_node", ""))
	if points.is_empty():
		return {"error": {"code": "PARENT_NOT_FOUND", "message": "path_node 无效或 path <2 点"}}
	return AssetPlacer.place_path(root, _undo_manager, params.get("shape", ""),
		params.get("params", {}), params.get("material", null), points,
		params.get("mode", "discrete"), params.get("spacing", 1.0), params.get("count", 0),
		params.get("align", "path"), params.get("align_vertices", false), request_id)

func handle_batch(params: Dictionary, request_id: int) -> Dictionary:
	var root := _get_root()
	if root == null: return {"error": {"code": "NO_ACTIVE_SCENE", "message": "no active scene"}}
	return AssetPlacer.place_batch(root, _undo_manager, params.get("items", []), request_id)

func handle_undo(params: Dictionary, request_id: int) -> Dictionary:
	var ur := _plugin.get_undo_redo()
	# Godot UndoRedo 全局栈：undo() 弹栈顶 action（通常最近 asset 批次）
	if ur.get_action_name() == "":
		return {"error": {"code": "NOTHING_TO_UNDO", "message": "undo stack empty"}}
	ur.undo()
	return {"result": {"undone": true}}

func handle_save(params: Dictionary, request_id: int) -> Dictionary:
	var root := _get_root()
	if root == null: return {"error": {"code": "NO_ACTIVE_SCENE", "message": "no active scene"}}
	# path 白名单：GD 侧 has_path_traversal + res:// 复核（TS 侧 realpathSync 在 Task 8）
	var node := root.get_node_or_null(params.get("node_path", ""))
	if node == null:
		return {"error": {"code": "PARENT_NOT_FOUND", "message": "node_path: %s" % params.get("node_path", "")}}
	var res_path: String = params.get("resource_path", "")
	if not res_path.begins_with("res://") or CommandHelpers.has_path_traversal(res_path):
		return {"error": {"code": "INVALID_PATH", "message": "resource_path 须 res:// 且无遍历"}}
	var pkg := PackedScene.new()
	var err := pkg.pack(node)
	if err != OK:
		return {"error": {"code": "RESOURCE_SAVE_FAILED", "message": "pack failed: %d" % err}}
	DirAccess.make_dir_recursive_absolute(res_path.get_base_dir())
	err = ResourceSaver.save(pkg, res_path)
	if err != OK:
		return {"error": {"code": "RESOURCE_SAVE_FAILED", "message": "save failed: %d" % err}}
	return {"result": {"resource_path": res_path}}

func _get_root() -> Node:
	var ei := _get_ei()
	if ei == null: return null
	return ei.get_edited_scene_root()
```
（顶部加 `const CommandHelpers = preload("../command_helpers.gd")`）

- [ ] **Step 3: GD 语法校验 + editor 加载冒烟**

Run: `"/d/Godot/Godot_v4.6.3-stable_win64_console.exe" --headless --path "D:/GitHub/godot-mcp-enhanced" --check-only --script addons/godot_mcp_server/plugin.gd 2>&1 | head`
Expected: 无错误（全链 preload 通）。

- [ ] **Step 4: Commit**

```bash
git add addons/godot_mcp_server/commands/asset/asset_commands.gd
git commit -m "feat(asset): T6 asset_commands 编排 5 action（create/path/batch/undo/save）"
```

---

## Task 7: TS merged asset 工具 + schema + 注册（T7）

**Files:**
- Create: `src/tools/asset/schema.ts`、`src/tools/asset/asset-ops.ts`
- Modify: `src/core/module-loader.ts`

**Interfaces:**
- Consumes: `EditorToolExecutor`（经 ctx）、`requireString`/`requireStringArray`/`isNumberArray`（helpers.ts）
- Produces: merged `asset` 工具（7 action），注册到 module-loader

- [ ] **Step 1: schema.ts（11 shape 元数据 + 材质清单）**

```typescript
export const SHAPES = [
  { name: 'box', params: { size: [1, 1, 1] } },
  { name: 'cylinder', params: { height: 1, radius: 0.5 } },
  { name: 'sphere', params: { radius: 0.5 } },
  { name: 'prism', params: { size: [1, 1, 1], left_to_right: 0.5 } },
  { name: 'wall', params: { length: 2, height: 1, thickness: 0.1 } },
  { name: 'ramp', params: { length: 2, height: 1, width: 1, start_height: 0, end_height: 1 } },
  { name: 'cone', params: { height: 1, radius: 0.5, segments: 24 } },
  { name: 'tube', params: { height: 1, radius: 0.5, thickness: 0.1 } },
  { name: 'torus', params: { major_radius: 0.5, minor_radius: 0.2 } },
  { name: 'stairs', params: { steps: 5, step_height: 0.2, step_depth: 0.3, width: 1.2 } },
  { name: 'fence', params: { length: 3, height: 1.2, posts: 4, post_radius: 0.05, rail_thickness: 0.04, start_post: true, end_post: true } },
] as const;
export const SHAPE_NAMES = SHAPES.map(s => s.name);
export const MATERIAL_PRESETS = ['wood', 'metal', 'stone', 'glass', 'gold', 'coral', 'sand', 'seaweed', 'water', 'default'] as const;
export const RAMP_BLOCKED_IN_CONTINUOUS = true;  // 方案 A
```

- [ ] **Step 2: asset-ops.ts（getToolDefinitions + handleTool，禁裸 as）**

仿 `src/tools/material-ops.ts` 结构。关键：`handleTool` 用 `requireString` 等前置校验（**禁 `args.x as T`**）；list_shapes/list_materials 静态返回；create/path/batch/undo/save 调 `ctx.editorExecutor.execute('asset_<action>', args)`（若 ctx 无 editorExecutor → 返 `EDITOR_ONLY`，仿 test-framework.ts:79）。

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../../types.js';
import type { RiskLevel } from '../../core/tool-registry.js';
import { opsErrorResult } from '../shared.js';
import { SHAPES, SHAPE_NAMES, MATERIAL_PRESETS } from './schema.js';

const ACTIONS = ['create','path','batch','undo','save','list_shapes','list_materials'] as const;

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'asset',
    description: '参数化 3D shape 生成（11 shape）+ 路径阵列 + batch + undo + save 预制件。create/path/batch/undo/save 经 editor 持久化（视口可见、可 undo）；list_shapes/list_materials 静态返回。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string', description: 'Godot 项目目录' },
        action: { type: 'string', enum: [...ACTIONS], description: '操作类型' },
        shape: { type: 'string', enum: [...SHAPE_NAMES], description: 'create/path: shape 名' },
        params: { type: 'object', description: 'shape 参数（见 list_shapes）' },
        material: { type: ['string','object','null'], description: '预设名 / PBR dict（color,alpha,emissive,metallic,roughness）/ res://.tres / null' },
        name: { type: 'string', description: '节点名（碰撞自增 _001）' },
        parent: { type: 'string', description: '父节点路径（绝对/相对）' },
        position: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
        rotation: { type: 'array', items: { type: 'number' }, description: '[x,y,z] 弧度' },
        scale: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
        items: { type: 'array', description: 'batch: [{shape,params,material,name,...}] ≤64' },
        path: { type: 'array', description: 'path: [[x,y,z],...] ≥2 点' },
        path_node: { type: 'string', description: 'path: 场景 Path3D 节点路径（与 path 互斥）' },
        mode: { type: 'string', enum: ['discrete','continuous'], description: 'path 采样模式' },
        spacing: { type: 'number', description: 'path discrete 等间距' },
        count: { type: 'number', description: 'path discrete 等数量' },
        align: { type: 'string', enum: ['none','path','normal'], description: 'path 朝向（默认 path）' },
        align_vertices: { type: 'boolean', description: 'path continuous+spacing 折线顶点段边界' },
        node_path: { type: 'string', description: 'save: 要存的子树节点路径' },
        resource_path: { type: 'string', description: 'save: res://xxx.tscn 输出路径' },
      },
      required: ['action'],
    },
  }];
}

const TOOL_NAMES = ['asset'] as const;

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | null> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return null;
  const action = args.action as string;  // 唯一允许的裸 as（action 已 enum 校验）
  if (!action) return opsErrorResult('INVALID_PARAMS', 'action required');

  // list_* 静态返回（不经 editor）
  if (action === 'list_shapes') {
    return { content: [{ type: 'text', text: JSON.stringify({ shapes: SHAPES }) }] };
  }
  if (action === 'list_materials') {
    return { content: [{ type: 'text', text: JSON.stringify({ presets: MATERIAL_PRESETS, custom_rule: '{color(hex),alpha?,emissive?,metallic?,roughness?}', external: 'res://*.tres' }) }] };
  }

  // create/path/batch/undo/save 经 editor（ctx.editorExecutor 由 ToolDispatcher 注入）
  const editorExecutor = (ctx as unknown as { editorExecutor?: { execute: (n: string, a: Record<string, unknown>) => Promise<ToolResult> } }).editorExecutor;
  // 注：实际 ctx 暴露方式以 ToolDispatcher.ts:601 checkEditorTextResourceWrite 注入模式为准——
  // editorExecutor 不直接在 ctx，故改走 dispatchTool 的工具自身不调 editorExecutor，
  // 而是依赖 ToolDispatcher 的 editor 模式盲转（executeToolCall L347 自动转发 asset_<action> 到 editor）。
  // 因此本工具 handleTool 在 editor 模式根本不会被调（已被 ToolDispatcher 转发），
  // 只有 headless 模式才到此处 → 返 EDITOR_ONLY。
  return opsErrorResult('EDITOR_ONLY', `asset action "${action}" requires Editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin.`);
}

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean; actionRisks?: Record<string, RiskLevel> }> = {
  asset: {
    readonly: false,
    long_running: false,
    actionRisks: {
      list_shapes: 'read', list_materials: 'read',
      create: 'write', path: 'write', batch: 'write', undo: 'write', save: 'write',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
};
```

**关键设计**（对齐 IMPORTANT-1 修订）：asset 的 create/path/batch/undo/save **不**在 handleTool 内调 editorExecutor——`ToolDispatcher.executeToolCall` editor 模式对全工具盲转（L347），asset_create 等 method 在 command_handler match 命中即持久化；headless 模式不到 editor，handleTool 返 `EDITOR_ONLY`。list_* 在 editor 模式会被盲转到 editor、command_handler 无 match → -32601 → ToolDispatcher 回退 dispatchTool → 到本 handleTool 返回静态数据（多 1 次 WS 往返，功能正确）。

- [ ] **Step 3: module-loader 注册**

`src/core/module-loader.ts` import 区（L56 `getContext` 后）加：
```typescript
import * as asset from '../tools/asset/asset-ops.js';
```
`ALL_MODULES`（L72 `getContext,` 后）加 `asset,`。

- [ ] **Step 4: 裸 as 计数 = 0 检查**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && grep -rnE "args\.[a-z_]+ as " src/tools/asset/ | wc -l`
Expected: `1`（仅 action 那一处 enum 校验后的 as，允许）。若 >1，改用 requireString/zod。

- [ ] **Step 5: TS 编译**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && npm run build`
Expected: 无 TS 错误。

- [ ] **Step 6: Commit**

```bash
git add src/tools/asset/ src/core/module-loader.ts
git commit -m "feat(asset): T7 merged asset 工具（7 action）+ schema + 注册"
```

---

## Task 8: save 路径白名单 TS 侧 realpathSync（T8）

**Files:**
- Modify: `src/tools/asset/asset-ops.ts`

**Interfaces:**
- Produces: asset save action 的 TS 侧 resource_path 前置校验（realpathSync + isPathInAllowedRoots + normalizeUserProjectPath）

- [ ] **Step 1: 在 handleTool 加 save 的 TS 侧校验**

asset-ops.ts 的 handleTool，在 `EDITOR_ONLY` 返回前，对 `action === 'save'` 做前置校验（即使 editor 模式由 command_handler 执行，TS 侧前置校验防绕过）：

```typescript
  if (action === 'save') {
    const { isPathInAllowedRoots } = await import('../../helpers.js');
    const { resolveWithinRoot, normalizeUserProjectPath } = await import('../../path-utils.js');
    const resourcePath = requireString(args.resource_path, 'resource_path');
    if (!resourcePath.startsWith('res://')) {
      return opsErrorResult('INVALID_PATH', 'resource_path must start with res://');
    }
    const projectPath = requireProjectPath(args);
    const absPath = normalizeUserProjectPath(projectPath, resourcePath);  // res:// → 绝对
    const resolved = resolveWithinRoot(projectPath, absPath);  // realpathSync 归一，防符号链接/TOCTOU
    if (!isPathInAllowedRoots(resolved)) {
      return opsErrorResult('PATH_NOT_ALLOWED', `save resource_path outside ALLOWED_PROJECT_PATHS: ${resourcePath}`);
    }
  }
```

（`requireString`/`requireProjectPath` 从 helpers.ts import；`resolveWithinRoot`/`normalizeUserProjectPath` 实际签名以 path-utils.ts/helpers.ts 为准——若函数名不符，T8 第一步先 grep 确认真实函数名。）

- [ ] **Step 2: TS 编译 + 单测占位（实际断言在 Task 9）**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && npm run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/tools/asset/asset-ops.ts
git commit -m "feat(asset): T8 save resource_path TS 侧 realpathSync + 白名单校验"
```

---

## Task 9: TS 单测（T9）

**Files:**
- Create: `test/tools/asset-ops.test.ts`

**Interfaces:**
- Produces: asset-ops schema/routing/错误码/裸 as 计数单测全绿

- [ ] **Step 1: 写 asset-ops 单测**

```typescript
import { describe, it, expect } from 'vitest';
import { getToolDefinitions, handleTool } from '../../src/tools/asset/asset-ops.js';
import { SHAPES, SHAPE_NAMES, MATERIAL_PRESETS } from '../../src/tools/asset/schema.js';

describe('asset tool definitions', () => {
  it('注册 1 个 merged asset 工具，7 action', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('asset');
    expect(defs[0].inputSchema.properties.action.enum).toEqual(
      ['create','path','batch','undo','save','list_shapes','list_materials']
    );
  });
  it('11 shape 全在 enum', () => {
    const shapeEnum = getToolDefinitions()[0].inputSchema.properties.shape.enum;
    expect(shapeEnum).toEqual([...SHAPE_NAMES]);
    expect(SHAPES).toHaveLength(11);
  });
});

describe('asset handleTool list_*', () => {
  it('list_shapes 返 11 shape', async () => {
    const r = await handleTool('asset', { action: 'list_shapes' }, {} as never);
    const parsed = JSON.parse(r!.content[0].text);
    expect(parsed.shapes).toHaveLength(11);
  });
  it('list_materials 返 10 预设 + 三态规则', async () => {
    const r = await handleTool('asset', { action: 'list_materials' }, {} as never);
    const parsed = JSON.parse(r!.content[0].text);
    expect(parsed.presets).toEqual([...MATERIAL_PRESETS]);
    expect(parsed.presets).toHaveLength(10);
  });
});

describe('asset handleTool editor-only actions', () => {
  it('create 在无 editor 的 ctx 返 EDITOR_ONLY', async () => {
    const r = await handleTool('asset', { action: 'create', shape: 'box', project_path: '/tmp/p' }, {} as never);
    expect(r?.isError).toBe(true);
    expect(r!.content[0].text).toContain('EDITOR_ONLY');
  });
  it('batch limit >64 应由 GD 侧拦（TS 不重复，但 save 路径校验在 TS）', async () => {
    // save 的 TS 侧 realpathSync 校验
    const r = await handleTool('asset', { action: 'save', node_path: '/Root/X', resource_path: '/etc/passwd', project_path: '/tmp/p' }, {} as never);
    expect(r?.isError).toBe(true);  // 非 res:// 拒
  });
});

describe('asset 裸 as 断言计数', () => {
  it('src/tools/asset/ 内 "args.x as" 出现 ≤1 次（仅 action enum）', async () => {
    const { execSync } = await import('node:child_process');
    const out = execSync('grep -rnE "args\\.[a-z_]+ as " src/tools/asset/ || true', { cwd: 'D:/GitHub/godot-mcp-enhanced' }).toString();
    const count = out.trim().split('\n').filter(Boolean).length;
    expect(count).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 跑单测**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && npx vitest run test/tools/asset-ops.test.ts`
Expected: 全 PASS。

- [ ] **Step 3: Commit**

```bash
git add test/tools/asset-ops.test.ts
git commit -m "test(asset): T9 asset-ops schema/routing/错误码/裸as 单测"
```

---

## Task 10: E2E L2（真 Godot editor）（T10）

**Files:**
- Create: `test/e2e-asset-tools.test.ts`

**Interfaces:**
- Produces: create/path/batch/undo/save 真 editor 端到端验证全绿

- [ ] **Step 1: 写 E2E（仿 test/e2e-full-tool-verification.test.ts 模式）**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
// 复用 e2e harness 的 editor 连接 + 真实 Godot（GODOT_PATH 未设则 [E2E-SKIP]）

describe('asset E2E（editor）', () => {
  beforeAll(() => { /* 启 editor + 连 WS，仿 e2e-full-tool-verification */ });

  it('create box → MeshInstance3D 出现', async () => {
    const r = await callTool('asset', { action: 'create', shape: 'box', params: { size: [2,1,1] }, name: 'e2e_box', project_path: PROJ });
    expect(r.node_path).toContain('e2e_box');
    const tree = await callTool('editor', { action: 'get_scene_tree' });
    expect(tree).toContain('e2e_box');  // 视口可见
  });

  it('path fence continuous → N 节点 + 朝向', async () => {
    const r = await callTool('asset', { action: 'path', shape: 'fence', params: { length: 3, height: 1.2 },
      path: [[0,0,0],[6,0,0]], mode: 'continuous', spacing: 3, project_path: PROJ });
    expect(r.node_paths.length).toBeGreaterThanOrEqual(2);
  });

  it('path continuous ramp → UNSUPPORTED_SHAPE（方案 A）', async () => {
    const r = await callTool('asset', { action: 'path', shape: 'ramp', params: {},
      path: [[0,0,0],[4,0,0]], mode: 'continuous', spacing: 2, project_path: PROJ });
    expect(r.error?.code ?? JSON.parse(r.content[0].text).error?.code).toBe('UNSUPPORTED_SHAPE');
  });

  it('batch 3 items → 3 节点 + 一次 undo 全消', async () => {
    const r = await callTool('asset', { action: 'batch', items: [
      { shape: 'box', name: 'b1' }, { shape: 'cone', name: 'c1' }, { shape: 'torus', name: 't1' },
    ], project_path: PROJ });
    expect(r.node_paths).toHaveLength(3);
    await callTool('asset', { action: 'undo', project_path: PROJ });
    const tree = await callTool('editor', { action: 'get_scene_tree' });
    expect(tree).not.toContain('b1');  // batch 原子 undo 全消
    expect(tree).not.toContain('c1');
    expect(tree).not.toContain('t1');
  });

  it('batch item 2 非法 shape → 零节点落地（预校验原子）', async () => {
    const before = await callTool('editor', { action: 'get_scene_tree' });
    const r = await callTool('asset', { action: 'batch', items: [
      { shape: 'box', name: 'ok1' }, { shape: 'NONEXISTENT', name: 'bad' },
    ], project_path: PROJ });
    expect(JSON.parse(r.content[0].text).error).toBeTruthy();  // UNSUPPORTED_SHAPE
    const after = await callTool('editor', { action: 'get_scene_tree' });
    expect(after).not.toContain('ok1');  // 零落地
  });

  it('save → res://GeneratedAssets/xx.tscn 落盘 + undo 不删', async () => {
    await callTool('asset', { action: 'create', shape: 'box', name: 'pillar', project_path: PROJ });
    const r = await callTool('asset', { action: 'save', node_path: '<pillar path>', resource_path: 'res://GeneratedAssets/pillar.tscn', project_path: PROJ });
    expect(r.resource_path).toBe('res://GeneratedAssets/pillar.tscn');
    // 文件存在（fs check）
    await callTool('asset', { action: 'undo', project_path: PROJ });
    // undo 后文件仍在（不变量 1）
    expect(fs.existsSync(path.join(PROJ, 'GeneratedAssets/pillar.tscn'))).toBe(true);
  });

  it('11 shape create 全部成功（ramp 仅单件）', async () => {
    for (const s of ['box','cylinder','sphere','prism','wall','ramp','cone','tube','torus','stairs','fence']) {
      const r = await callTool('asset', { action: 'create', shape: s, name: `e2e_${s}`, project_path: PROJ });
      expect(r.node_path ?? JSON.parse(r.content[0].text).node_path).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: 跑 E2E（需 GODOT_PATH + editor 启动）**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && GODOT_PATH="D:/Godot/Godot_v4.6.3-stable_win64_console.exe" npx vitest run test/e2e-asset-tools.test.ts`
Expected: 全 PASS（未设 GODOT_PATH 则 `[E2E-SKIP]`）。

- [ ] **Step 3: Commit**

```bash
git add test/e2e-asset-tools.test.ts
git commit -m "test(asset): T10 E2E L2 create/path/batch/undo/save + 11 shape 真 editor"
```

---

## Task 11: 收尾——版本 + capability-matrix + LICENSE（T11）

**Files:**
- Modify: `package.json`、`addons/godot_mcp_server/plugin.cfg`、`README.md`、`LICENSE`、`docs/capability-matrix.md`（自动生成）

- [ ] **Step 1: 版本号 v0.22.0**

`package.json` version → `0.22.0`；`addons/godot_mcp_server/plugin.cfg` version → `0.22.0`；README 顶部版本 + changelog 加一行。

- [ ] **Step 2: capability-matrix 重建**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && npm run build-matrix && npm run diff-matrix`
Expected: 工具总数 33（含 asset）；diff-matrix 无漂移。

- [ ] **Step 3: LICENSE 致谢**

`LICENSE` 保留既有 Copyright；追加 AssetForge Contributors MIT 声明 + Tripo3D 致谢一行（fork 来源，asset-forge LICENSE 本身无 Tripo3D 声明）。

- [ ] **Step 4: verify_delivery**

Run: `cd "D:/GitHub/godot-mcp-enhanced" && npx vitest run && npm run build`
Expected: 全套测试不回归 + 构建通过。

- [ ] **Step 5: Commit**

```bash
git add package.json addons/godot_mcp_server/plugin.cfg README.md LICENSE docs/capability-matrix.md
git commit -m "chore(asset): T11 v0.22.0 收尾（capability-matrix 33 + LICENSE + verify_delivery）"
```

---

## 任务依赖与并行

- **串行链**：T1 → T2a → T2b →（T3a ∥ T2b 后）→ T5 → T6 → T7 → T8 → T9 → T10 → T11
- **可并行**：T2b（手写 shape）与 T3a（路径阵列）互不依赖，T2a 完成后可并行
- **T5 依赖** T2（工厂）+ T3a（阵列）+ command_helpers（_vec3）
- **T6 依赖** T1-T5 全部
- **T7（TS）** 可与 T2-T6（GD）并行（接口已锁 spec §4）

## Self-Review

**1. Spec coverage**：
- §1-§2 架构 → Global Constraints + Architecture + T1/T7 路由 ✓
- §3 数据流（create/path/batch/undo/save/list）→ T6（GD 编排）+ T7（TS 路由）+ T10（E2E 各 action）✓
- §4 工具契约（7 action）→ T7 schema/asset-ops ✓
- §5 错误处理 + 安全 → T5（PARENT_NOT_FOUND/NO_ACTIVE_SCENE/UNSUPPORTED_SHAPE/BATCH_LIMIT_EXCEEDED）+ T6（NOTHING_TO_UNDO/INVALID_PATH/RESOURCE_SAVE_FAILED）+ T8（save realpathSync）+ T9（错误码单测）✓
- §6 组件结构（13 文件）→ File Structure + T1-T7 ✓
- §7 batch 原子 undo → T5 place_batch（create_action_mixed 聚合 + 预校验）+ T10（batch undo E2E）✓
- §8 材质库定位 → T2a（material_presets + create_material）✓
- §9 测试策略 → **订正**：mcp-enhanced 无 GUT，改 TS Vitest（T9）+ E2E L2（T10），spec §9 GUT suite 不适用 ✓
- §10 风险 1（已消解）→ T1 降级 ✓；风险 2（4.7 兼容）→ T2a Step 4 ✓；风险 3（Path3D）→ T4 Step 2 + T10 path_node E2E；风险 4（undo 全局栈）→ T6 handle_undo 注释 + T10 ✓
- §11 验收标准 → T9/T10/T11 各步骤 + E2E 断言 ✓
- §12 T1-T11 → Task 1-11 一一对应 ✓

**2. Placeholder scan**：
- T5 Step 4 `_inject_fence_posts` 的 `pass` + 注释「从源 334-338 精确复制」——这是移植指令（源文件行号明确），非占位；但执行时须落实真实代码。T5 Step 1「若 command_helpers 无 parse_vec3 则补一个」——条件分支，执行时确认。
- T7 Step 2 `ctx as unknown as {editorExecutor}` 的探索性注释——已说明改走 ToolDispatcher 盲转（不依赖 ctx.editorExecutor），handleTool 仅 headless 返 EDITOR_ONLY。设计明确。
- 无 "TBD/TODO/implement later/add error handling" 等空泛占位。

**3. Type consistency**：
- `AssetFactory.create_mesh(shape, params) -> ArrayMesh` / `create_material(spec) -> Material`：T2 定义，T5/T6 消费 ✓
- `PathGenerator.resolve_points/sample`：T4 定义，T5/T6 消费 ✓
- `AssetPlacer.place_one/place_path/place_batch/unique_name`：T5 定义，T6 消费 ✓
- `handle_create/path/batch/undo/save(params, request_id) -> Dictionary`：T1 桩、T6 实现，签名一致 ✓
- TS `handleTool(name, args, ctx) -> ToolResult | null` + `getToolDefinitions() -> Tool[]` + `TOOL_META`：T7 定义，对齐 material-ops 范式 ✓
- 错误码字符串：UNSUPPORTED_SHAPE/PARENT_NOT_FOUND/NO_ACTIVE_SCENE/NOTHING_TO_UNDO/BATCH_LIMIT_EXCEEDED/INVALID_PARAMS/INVALID_PATH/RESOURCE_SAVE_FAILED——T5/T6/T7/T9 一致 ✓

**订正说明（plan 对 spec 的偏差）**：
- spec §9「GUT suite 移植」不适用（mcp-enhanced `test/**/*.gd` 零文件、无 GUT 设施）。plan 改为 TS Vitest（T9）+ E2E L2（T10）覆盖几何体正确性。**建议后续在 spec §9 补一条 patch 记录此订正**。
- spec §6「_vec3 helper 保留」已在 patch IMPORTANT-7 订正 为「不保留副本」，plan T5 Step 1 落实（复用 command_helpers）✓。
