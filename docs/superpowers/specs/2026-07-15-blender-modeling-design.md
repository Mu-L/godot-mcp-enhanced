# execute_bpy — headless Blender 程序化建模（设计）

- 日期：2026-07-15
- 状态：设计已批准（经 brainstorming 三问 + 代码级设计审查），待 spec 审阅
- 流程：superpowers brainstorming → writing-plans
- 关联 memory：user-prefers-local-ahead-no-push、verify-implementation-by-source

---

## 1. 背景与目标

godot-mcp-enhanced 当前若要用 Blender 建模，需挂外部 `blender-mcp`（uvx），链路为 `Claude → blender-mcp(MCP) → TCP addon(9876) → bpy`——两个 MCP server 并存，且 `blender-mcp` 的 `execute_code` 是裸 `exec` 0 防护（见 `D:\workspace\Obsidian\GitHub项目\BlenderMCP 代码级深化与Bug清单.md`）。

本设计在 godot-mcp-enhanced 内部新增 headless Blender 建模能力，**省去中转**：用户只挂 godot-mcp 一个 MCP，AI 写 bpy 片段 → godot-mcp 包装 → headless spawn blender → 导 glb 到 res://。无 addon、无 GUI、无中转 MCP，与现有 headless Godot 管道同构。

核心决策（brainstorming 三问 + 设计审查敲定）：

| 维度 | 决策 |
|------|------|
| 使用场景 | **程序化资产生成**（非有机/sculpt）→ headless 可行，真省中转 |
| 资产落点 | **只导 glb 到 res://**，不耦合 scene 工具 |
| 工具形态 | **单工具 `execute_bpy`，片段模式 + 自动导出** |

## 2. 非目标（YAGNI）

- ❌ 结构化高层工具（create_primitive / set_material / apply_modifier）——按需后续
- ❌ 完整脚本模式 / 双模式（A 片段模式够用）
- ❌ 自动 import 到 Godot 场景 / 触发 Godot import（glb 落盘即止，`.import` 由 Godot 自理）
- ❌ bpy 语法沙箱（backlog，见 §7）
- ❌ blender-finder 的 project override 层（`.godot/mcp-godot.json` 的 `blender_path`）——env + PATH + 单值缓存够用

## 3. 架构与数据流

```
Claude → execute_bpy(project_path, export_path, code)
  ├─ blender-finder.findBlender()               （单值缓存）
  ├─ isPathInAllowedRoots(project_path)         （ALLOWED_PROJECT_PATHS 白名单）
  ├─ fsExport = resolveWithinRoot(
  │      projectRoot,
  │      normalizeUserProjectPath(export_path))  （剥 res:// → join project → 文件系统落点校验）
  ├─ 包装 code → 完整 .py（import + 空场景 + code + export argv 行）
  ├─ 写临时 .py（系统 temp，非项目内）
  ├─ spawn blender --background --factory-startup --python tmp.py -- <fsExport>
  │     { env: buildSafeEnv() }，超时 60s，args 数组形式（不经 shell）
  ├─ 校验 fsExport 文件存在 + size > 0
  └─ 返回 { status, export_path, glb_size, blender_stdout }
```

## 4. 组件

### 新增

| 文件 | 职责 |
|------|------|
| `D:\GitHub\godot-mcp-enhanced\src\core\blender-finder.ts` | 找 blender.exe（`GODOT_BLENDER_PATH` env → PATH 搜索 → 单值缓存）+ `validateBlenderBinary` |
| `D:\GitHub\godot-mcp-enhanced\src\core\blender-spawn.ts` | spawn `blender --background --python`（对称 `godot-spawn.ts` 的进程/超时/stdout 捕获） |
| `D:\GitHub\godot-mcp-enhanced\src\tools\blender.ts` | `execute_bpy` 工具实现（单文件，对称 `script.ts` 单文件模式） |

### 复用（经设计审查核实，均生产接线）

| API | 位置 | 用途 |
|-----|------|------|
| `resolveWithinRoot(root, userPath)` | `src\core\path-utils.ts:154` | export_path 文件系统落点校验（realpathSync，TOCTOU accepted-risk） |
| `normalizeUserProjectPath(input)` | `src\core\path-utils.ts:192` | 剥 `res://` 前缀 |
| `isPathInAllowedRoots(requestedPath)` | `src\core\path-utils.ts:258` | project_path 白名单 |
| `getAllowedProjectPaths()` | `src\core\path-utils.ts:234` | 读取白名单 |
| `buildSafeEnv()` | `src\helpers.ts:145` | 所有 spawn 传，防继承敏感 env |
| `feature-flags.ts` / `action-response.ts` / `error-codes.ts` | `src\core\` | 工具组 gating / 统一响应 / 错误码 |

> ❌ 不复用 `src\core\path-security.ts` 的 `sanitizePath`——该文件自述 UNWIRED(I-SEC-6, `:4-7`)，grep 全 src 零调用点，且做的是 `res://` 字符串前缀匹配而非文件系统落点校验，语义不符。

**零新 npm 依赖**（blender 是外部可执行，`child_process` 内置）。

## 5. execute_bpy 工具规格

### 入参

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `project_path` | string | 是 | Godot 项目根 |
| `export_path` | string | 是 | 相对项目根的路径，可带可选 `res://` 前缀（如 `assets/models/rock.glb`），经 `normalizeUserProjectPath` 统一剥前缀 |
| `code` | string | 是 | bpy 建模片段（无 import、无 export） |
| `timeout?` | number | 否 | 默认 60s |

### 包装模板（AI 只写 `<code>`）

```python
import bpy, bmesh, mathutils, math, sys
bpy.ops.wm.read_factory_settings(use_empty=True)   # 干净空场景
bpy.context.scene.unit_settings.system = 'METRIC'
# ===== AI 片段 =====
<code>
# ===== 自动导出（godot-mcp 注入，filepath 走 argv 不插值）=====
bpy.ops.export_scene.gltf(
    filepath=sys.argv[sys.argv.index("--") + 1],
    export_format='GLB', export_apply=True)
```

### spawn（数组形式，不经 shell，空格安全）

```
blender --background --factory-startup --python <tmp.py> -- <fsExport>
  { env: buildSafeEnv(), timeout: 60s }
```

**argv 解析**：`sys.argv[sys.argv.index("--") + 1]` 取「-- 后第一个参数」（Blender 官方 idiom，`--` 保留在 `sys.argv`），抗未来加参数。AI 的 `code` 片段仍字符串插值（信任模型内、本地用户所写可接受）；**godot-mcp 注入的 export 行 filepath 走 argv**，消除 Windows 反斜杠 / 引号注入面。

## 6. blender-finder 规格

- `findBlender()`：`GODOT_BLENDER_PATH` env → PATH 搜索（`blender` / `blender.exe`）→ **单值缓存**（模块级 `_blenderPath`，非 `Map<projectPath>`——MVP 砍多项目层）
- `validateBlenderBinary(candidate)`：spawn `blender --version`（`env: buildSafeEnv()`），校验 stdout 含 `Blender` + 版本号——**对称 `isGodotVersionSignature`（C-SEC-2）防伪造二进制 RCE**。否则 `GODOT_BLENDER_PATH` 指向的伪造二进制被 spawn = 直达 RCE
- **所有 spawn 传 `buildSafeEnv()`**（防子进程继承敏感 env，memory `spawn-without-buildsafeenv`）

## 7. 安全模型

bpy 是全功能 Python，**无语言层沙箱，威胁面 = 宿主 RCE**（读 / 删任意文件、执行任意命令、网络）——**高于 `execute_gdscript` 的 GDScript 沙箱一个量级**（GDScript 语言层有约束，逃逸才到宿主）。不与 GDScript 沙箱并列称"同类 fail-model"。

MVP 诚实边界：

1. **glb 导出落点硬约束**：`export_path` 经 `resolveWithinRoot`——**仅约束 godot-mcp 注入的 export 行 filepath，不约束 bpy 代码内部的 `open()` / `os.remove()` / `os.system()`**
2. **本地单用户信任模型声明 + warning**（响应附 `[SECURITY]` 提示）
3. **不做 bpy 语法沙箱**（正则防不住动态构造 = 假绿），列 backlog，与 GDScript 沙箱统一 fail-model 显式声明

> ~~headless 隔离~~ **不作为安全控制**——`--background` 仅不开 GUI 窗口，进程仍是全权限宿主 Python，`import os; os.system(...)` 照跑。不声明不存在的能力。

**对外卖点表述**（与 BlenderMCP 对比）：不是"我们防住了它们没防住的"，而是"我们显式声明 fail-model + glb 落点硬约束 + 本地信任模型，BlenderMCP 既无约束也无声明"。

## 8. 错误处理

| 错误码 | 触发 | 附加信息 |
|--------|------|----------|
| `BLENDER_NOT_FOUND` | finder 找不到 blender | 安装指引 |
| `PATH_NOT_ALLOWED` | project_path 不在 ALLOWED_PROJECT_PATHS | — |
| `EXPORT_PATH_TRAVERSAL` | export_path 逃出 res://（`resolveWithinRoot` 拒绝） | — |
| `BLENDER_EXIT_NONZERO` | 进程非 0 退出 | stderr |
| `EXPORT_FILE_MISSING` | 进程成功但 glb 未生成（AI 片段可能未建对象） | stdout |
| `TIMEOUT` | 超时 | 杀进程 |

## 9. 测试

### 单元（无 blender 依赖）
- blender-finder mock：`GODOT_BLENDER_PATH` / PATH 搜索 / 单值缓存命中
- export_path 穿越 case：`../`、符号链接、绝对路径逃逸 → `EXPORT_PATH_TRAVERSAL`
- 包装模板拼接正确性：import 头 / 空场景 / `<code>` / export argv 行齐整
- `res://` → fs 路径转换 + `resolveWithinRoot` 集成

### 集成（`hasBlender` gating，对称 `check:gdscript` 的 `hasGodot`）
- 「创建立方体」片段 → 校验 glb 生成 + size > 0
- **argv 契约验证**：跑打印 `sys.argv` 的探针脚本，确认 `--` 保留 + `index("--")+1` 取到 export_path（防 Blender 版本差异，不盲信约定）
- `validateBlenderBinary`：真 `blender --version` 通过 / 伪造二进制（打印假版本串）拒绝

### 回归
- path-utils 复用边界（TOCTOU accepted-risk 不回归）

## 10. feature-flag 与工具组

- blender 工具组在 `manage_tools sync` 报 `requires: blender`
- blender 不存在时 `execute_bpy` 返回 `BLENDER_NOT_FOUND` + 安装指引（不隐藏工具，让 AI 知道要装）

## 11. 验收标准

- [ ] `execute_bpy` 跑「创建立方体」片段生成有效 glb 到 res:// 指定路径
- [ ] export_path 穿越（`../`、符号链接）被 `resolveWithinRoot` 拒绝
- [ ] project_path 不在白名单被拒
- [ ] `validateBlenderBinary` 拒绝伪造二进制（假版本串）
- [ ] 所有 spawn 传 `buildSafeEnv`
- [ ] export filepath 走 argv（不字符串插值）
- [ ] 单元 + 集成测试绿（`hasBlender` gating）
- [ ] `tsc` / `eslint` / `vitest` 全绿
- [ ] 安全模型文档化（README 或 `docs/capability-matrix.md` 一节，含宿主 RCE 量级声明）
