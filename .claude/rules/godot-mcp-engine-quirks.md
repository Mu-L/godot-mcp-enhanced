> 适用于 godot-mcp-enhanced v0.19+

## 定位

这是 **Godot 引擎行为知识库**——不是工具调用指南（见 core/editor/bridge 等），不是语言教程。使用 MCP 工具操作 Godot 时会遇到这些**隐蔽的引擎陷阱**：多数无错误、无警告，静默失败，靠经验规避。按工具场景分组。

来源：吸收自 godogen（`D:\GitHub\godogen\godot\skills\godogen\quirks.md`）的引擎级、语言无关陷阱，剔除 C# 专属项（SetScript dispose / partial class / SceneBuilderBase 等），保留 GDScript 项目同样会踩的引擎行为。★ 标记对 MCP 工具直接相关、最易踩的重点。

## 截图与捕获（screenshot / execute_gdscript 捕获脚本）

- **★ `--write-movie` 第一帧在 `_Process()` 前渲染**：捕获序列的 frame 0 可能在 `_Process` 首次执行前生成。camera 若在 `_Process` 定位，frame 0 是 junk 帧。在 `_Initialize()` 用 `Position`/`RotationDegrees` 预置 camera（**勿用 `LookAt`**——节点未入树，空间方法失效）。关联：screenshot(capture)、execute_gdscript SceneTree 捕获脚本。
- **静态/动态场景的 fps 选择**：静态（UI/装饰/地形）`--fixed-fps 1`；动态（物理/移动/玩法）`--fixed-fps 10+`。低 FPS 使 `delta` 过大，引发物理 tunneling 和 erratic 行为。关联：screenshot(capture)。
- **★ 帧哈希全部相同 = 捕获接错**：若序列所有帧哈希一致，不要认定捕获成功——通常是 camera/time stepping/scripted input 接错。这是 frame-verify 的核心反作弊判据之一。关联：screenshot(capture)、frame-verify。

## 物理查询（physics / scene 碰撞体）

- **★ RayCast3D 不可靠检测 ConcavePolygonShape3D**：`RayCast3D` / `PhysicsRayQueryParameters3D` 对 `ConcavePolygonShape3D` 碰撞检测不可靠。用 `PhysicsShapeQueryParameters3D`（shape cast）或直接查 mesh 几何（SurfaceTool closest-point）做 trimesh 地形的落地/表面检测。关联：physics(raycast)——raycast 工具对 trimesh 地形会漏检。
- **ConcavePolygonShape3D 需顺时针 winding（Jolt）**：逆时针三角面产生朝下法线——物体从上方穿透，从下方碰撞。用平面 quad 测试：RigidBody 穿透则反转三角形索引顺序。关联：scene 创建碰撞形状、physics(body_info)。
- **BoxShape3D 在 trimesh 上卡边**：在 ConcavePolygon/trimesh 表面滑动的对象（载具/滚动体）用 `BoxShape3D` 会卡碰撞边（Godot/Jolt bug），改用 `CapsuleShape3D`。关联：scene 物理体。
- **★ CollisionLayer/Mask 是 bitmask 非 UI index**：`CollisionLayer`/`CollisionMask` 在代码里是 bitmask，不是编辑器 UI 层号。UI Layer 1=bitmask 1, Layer 2=2, Layer 3=4, Layer 4=8（2 的幂）。`CollisionLayer=4` 是 UI Layer 3，**不是 Layer 4**。关联：scene/edit_node 设碰撞属性、physics。
- **★ 默认 CollisionMask=1 漏非默认层**：新碰撞体默认 `CollisionMask=1`，若地形/墙用 layer 2+，玩家穿透**且无错误**。务必显式设 mask 覆盖所有该碰的层。关联：scene 物理体。

## 场景与资源导入（scene / edit_node / import_resources）

- **★ `.gdignore` 静默阻止整个目录导入**：任何目录放 `.gdignore` 会让 Godot importer **完全跳过**它。绝不在 `assets/` 放——只有 `screenshots/` 等捕获目录该放。纹理不导入时先查散落的 `.gdignore`。关联：import_resources、scene 加载纹理、screenshot。
- **★ ArrayMesh.GenerateNormals() 是阴影必需**：程序化 mesh（SurfaceTool/raw ArrayMesh）不调 `GenerateNormals()` 则不接收阴影——**无错误、无警告，阴影就是不出现**。手动算的法线（即使视觉正确）也可能破坏阴影接收，始终用 `GenerateNormals()`。关联：execute_gdscript 程序化 mesh、screenshot 查阴影。
- **GLB MaterialOverride 不序列化进 .tscn**：GLB 内部 MeshInstance3D 的 MaterialOverride 不持久化（owner 设置跳过有 `SceneFilePath` 的子节点）。需程序化 ArrayMesh 才能自定义材质。关联：scene/edit_node 改 GLB 材质。
- **MultiMeshInstance3D + GLB pack 后不渲染**：mesh 资源引用在 pack+save 序列化时丢失。用独立 GLB 实例替代。关联：scene 实例化、save_scene。

## Headless 执行（execute_gdscript / run_and_verify）

- **★ headless RID leak errors 无害**：headless 场景构建/退出总产生 `leaked RID`/`Leaked instance`/`ObjectDB instances` 错误，**无害，忽略**。run_and_verify 分析错误时不应把这些当真错误误报。关联：run_and_verify、execute_gdscript。
- **`_Ready()` 在 `--script` 的 `_Initialize()` 不触发**：`godot --script` 运行 SceneTree 脚本时，实例化场景节点的 `_Ready()` 在 `_Initialize()` 期间不触发，须 `Root.AddChild(node)` 后手动调 init 方法。关联：execute_gdscript 完整类模式。
- **`Free()` vs `QueueFree()`**：`QueueFree()` 把节点留到帧末才移除，阻塞 name 重用；测试脚本里立即替换场景用 `Free()`。关联：execute_gdscript 测试脚本。
- **★ `execute_gdscript --script` 不认 GutTest → 用 `run_tests`**：headless CLI `godot --script` 要求脚本 `extends SceneTree`/`MainLoop`，直接跑 `extends GutTest`（Node 子类）的 GUT 测试脚本必失败，弹窗 "Can't load the script ... as it doesn't inherit from SceneTree or MainLoop"。跑 GUT 单元测试用 `runtime` 工具的 `run_tests` action——它封装 `godot --headless --script addons/gut/gut_cmdln.gd -gdir=<test_script> -gquit`（`test_script` 默认 `res://test/`、须 `res://` 前缀，I-SEC-08 防目录穿越，自动解析 Tests/Failed 计数，120s 超时）。前提：项目装了 GUT addon（`addons/gut/gut_cmdln.gd`）。关联：execute_gdscript、runtime(run_tests)。

## 输入与相机（game_input / screenshot）

- **Camera2D 无 Current 属性**：设当前用 `MakeCurrent()`，且节点须已在场景树中。关联：scene 加 Camera2D、game_input。
- **Chase camera 每帧重设 Current 覆盖测试 camera**：游戏 camera 在 `_PhysicsProcess` 设 `Current=true` 会每帧覆盖测试/捕获 harness 的 camera。测试 harness 须**每帧禁用游戏 camera**。关联：screenshot 测试、execute_gdscript。
- **相机 Lerp 首帧从原点 swoop**：`_PhysicsProcess` 中 `Lerp` 的相机首帧从 (0,0,0) 飞过来。用 `_initialized` flag 首帧 snap 位置，后续帧再 lerp。关联：screenshot、execute_gdscript。

## 材质与着色器（material / shader_write / shader_apply_template）

- **★ `compile_success` 是假绿（C-BUG-1）**：`shader_write` / `shader_apply_template` 返回的 `compile_success: true` **仅确认 shader 资源已分配（`get_rid().is_valid()`），与代码能否编译无关**——Godot 4.x headless 无可靠 shader 编译验证 API（RenderingServer 不实际编译）。AI 看到 `compile_success: true` 易误判 shader 正确（与 `run_tests` 认知缺口同类假绿）。**必须**经截图或 Godot 错误输出人工确认；返回结构里的 `verification_note` 文本已提示，但勿只看布尔值。关联：material(shader_write/shader_apply_template)。

## 导航（navigation / nav_create_region / nav_query_path）

- **★ `query_path` 静默返回空路径**：无导航数据（未创建 region 或未烘焙）时，`query_path` 返回 `path: []` + `path_length: 0` + `warning: "No navigation data available"`，**不报错**。`create_region` 默认 `bake=false`——忘记单独调 `bake_mesh` 则后续 `query_path` 静默返回空。正确工作流：`create_region` → `bake_mesh`（单独 120s 超时，其他 action 30s）→ `query_path`。看到空 path 先回头确认已 bake。关联：navigation(query_path/create_region/bake_mesh)。
