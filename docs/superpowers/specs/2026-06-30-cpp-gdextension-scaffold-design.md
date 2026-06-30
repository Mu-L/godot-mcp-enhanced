# cpp（GDExtension 脚手架生成）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 新增 `cpp` MCP 工具，一键生成完整可编译的 GDExtension（C++）工程脚手架到指定路径，对齐 godot-cpp 官方 example。

**Architecture:** 单 action `scaffold_gdextension` 的纯文件生成器。主入口 `src/tools/cpp.ts` + 专属模板 `src/tools/cpp-templates.ts`（平铺，与 `project.ts` + `code-templates.ts` 同型），不联网、不执行 scons、不 clone godot-cpp——仅在产物里写好引用路径与 README 克隆指引。复用 `requireProjectPath` 做 ALLOWED_PROJECT_PATHS 路径安全校验，`parent_class` 走 Godot 内置类白名单。

**Tech Stack:** TypeScript（ESM / Node 18+）、godot-mcp-enhanced 工具范式（`ACTIONS as const` + `getToolDefinitions` + `handleTool` + `TOOL_META.actionRisks`）、vitest、godot-cpp 4.4–4.6。

## Global Constraints

- **目录规则**（项目 CLAUDE.md）：主入口 + 专属模板辅助文件 → **平铺**在 `src/tools/`（先例：`project.ts` + `code-templates.ts`）；只有主逻辑本身拆分才建子目录（`scene/`、`animation/`）。本工具两文件平铺，**不建 `cpp/` 目录**。
- **路径安全**：路径参数名必须叫 `project_path`，复用 `helpers.ts:requireProjectPath`（自动校验 `ALLOWED_PROJECT_PATHS` + `isPathInAllowedRoots`），与 `ToolDispatcher` 的 `PATH_NOT_ALLOWED` 前置校验一致。不得引入 `target_path` 之类新根级路径字段。
- **actionRisks 完整性**（`test/risk-coverage.test.ts`）：每个 action 必须在 `actionRisks` 声明 risk；`scaffold_gdextension` 写多文件 = `'write'`，而 `'write'` 要求把 `'cpp'` 加入该测试的 `GUARDED_KEYS` 白名单，否则"非 GUARDED 零行为改变"断言会红。
- **capability-matrix 完整性**（`test/capability/matrix-integrity.test.ts`）：committed `docs/capability-matrix.json` 必须与 `extractCapabilities()` live 提取一致。新增工具后必须跑 `npm run build-matrix` 重生成，否则 CI 红。
- **注册只改一处**（`src/core/module-loader.ts` 注释明文）：加 `import * as cpp from '../tools/cpp.js'` + 进 `ALL_MODULES` 数组即可；另外手动维护 `TOOL_GROUPS`（归组）与 `OFFLINE_TOOLS`（是否离线可用）。
- **YAGNI**：不调 scons、不联网、不 clone godot-cpp、不做 `add_cpp_class`/方法绑定宏/热重载/CMake。

---

## 已确认与细化的设计决策

### 用户已确认（2026-06-30）
1. **产物清单**：维持 8 文件（对齐 godot-cpp example）。
2. **parent_class**：白名单（限定 Godot 内置类，非法前置报错）。
3. **下一步**：落盘本 spec + TDD 实现。

### 本 spec 细化（相对最初草案的修正）
| 项 | 草案 | 细化定稿 | 理由 |
|----|------|----------|------|
| 路径参数名 | `target_path` | **`project_path`** | 复用 `requireProjectPath` + `ToolDispatcher` 自动 `PATH_NOT_ALLOWED` 校验，与全项目惯例一致 |
| 目录布局 | `src/tools/cpp.ts` + `cpp-templates.ts` | 同左（**平铺**） | 对照 `project`+`code-templates` 先例，符合 CLAUDE.md 目录规则 |
| `libname` 派生 | `lib + class_lower` | **`class_name.toLowerCase()`**（如 `Example`→`example`） | 与 godot-cpp example 完全一致（`example_library_init` / `libgdexample.so` / `example.gdextension`） |
| 库文件名 | — | **`libgd<libname>`**（如 `libgdexample`） | godot-cpp 约定 `libgd` + 名 |
| `entry_symbol` | — | **`<libname>_library_init`** | example 先例 |
| `compatibility_minimum` | "随 godot_version 变化" | **= `godot_version`**（如 `"4.6"`） | 用户确认的测试点要求其随版本变化；写当前版本保守安全 |
| TOOL_GROUPS 归属 | 未定 | **`code` group**（与 `docs`/`load_skill` 同组） | 语义为"代码工具"；不入 `core` 以免进 minimal/slim profile |
| OFFLINE_TOOLS | 未定 | **加入** | 纯文件生成，不依赖 Godot 连接 |

---

## 文件结构

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/tools/cpp-templates.ts` | 8 个产物文件的模板字符串 + `renderScaffold(ctx)` 渲染函数 + parent_class 白名单 + godot_version 列表 | **新建** |
| `src/tools/cpp.ts` | 主工具：`ACTIONS` / `getToolDefinitions` / `handleTool` / `TOOL_META` | **新建** |
| `src/core/module-loader.ts` | 注册入口：import + `ALL_MODULES` | **修改**（2 处） |
| `src/core/tool-registry.ts` | `TOOL_GROUPS.code.tools` 加 `'cpp'`；`OFFLINE_TOOLS` 加 `'cpp'` | **修改**（2 处） |
| `test/risk-coverage.test.ts` | `GUARDED_KEYS` 加 `'cpp'` | **修改**（1 处） |
| `test/cpp.test.ts` | 工具行为测试（mock fs） | **新建** |
| `docs/capability-matrix.json` / `.md` | 派生产物 | **重生成**（`npm run build-matrix`） |

---

## API 设计

**工具名**：`cpp`
**Action**：`scaffold_gdextension`

```
cpp(scaffold_gdextension, project_path, class_name?, parent_class?, godot_version?, force?)
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `project_path` | string | **必填** | GDExtension 工程生成根目录（须在 `ALLOWED_PROJECT_PATHS` 内） |
| `class_name` | string | `Example` | 主类名，强制 PascalCase 校验 |
| `parent_class` | string | `Node` | 父类，须在白名单 |
| `godot_version` | string | `4.6` | 须在 `["4.4","4.5","4.6"]`；决定 README clone tag + `.gdextension` 的 `compatibility_minimum` |
| `force` | bool | `false` | 目标已存在且非空时是否覆盖 |

**返回**（`textResult` 包 JSON）：
```json
{
  "files": ["src/Example.cpp", "src/Example.h", "src/register_types.cpp",
            "src/register_types.h", "SConstruct", "example.gdextension",
            ".gitignore", "README.md"],
  "gdextension_path": "<project_path>/example.gdextension",
  "godot_cpp_clone_hint": "git clone -b godot-4.6-stable https://github.com/godotengine/godot-cpp"
}
```

### parent_class 白名单（含 godot-cpp include 文件名映射）

godot-cpp 的 class 头文件（`<godot_cpp/classes/<file>.hpp>`）由绑定生成器在用户构建 godot-cpp 时生成，命名遵循 PascalCase→snake_case（尾随单个数字连写如 `node2d`，字母后接数字加分隔如 `character_body_2d`）。`example.h` 的 `#include <godot_cpp/classes/control.hpp>` 证实此规则。

```typescript
const PARENT_CLASS_WHITELIST: Record<string /* PascalCase */, string /* include file */> = {
  Node:            'node',
  Resource:        'resource',
  RefCounted:      'ref_counted',
  Control:         'control',
  Node2D:          'node2d',
  Node3D:          'node3d',
  Sprite2D:        'sprite2d',
  Camera2D:        'camera2d',
  Camera3D:        'camera3d',
  Area2D:          'area2d',
  Area3D:          'area3d',
  CharacterBody2D: 'character_body_2d',
  CharacterBody3D: 'character_body_3d',
  RigidBody2D:     'rigid_body_2d',
  RigidBody3D:     'rigid_body_3d',
};
const SUPPORTED_GODOT_VERSIONS = ['4.4', '4.5', '4.6'] as const;
const CLASS_NAME_RE = /^[A-Z][A-Za-z0-9]*$/; // PascalCase
```

---

## 产物 8 文件模板（完整骨架）

> 以下为 `cpp-templates.ts` 的 `renderScaffold()` 返回内容。变量：`{Cls}`=class_name，`{Parent}`=parent_class，`{parent_inc}`=include 文件名，`{lib}`=libname，`{ver}`=godot_version。全部 CRLF 无关（纯 `\n`）。

### 1. `src/{Cls}.h`
```cpp
#pragma once

#ifdef WIN32
#include <windows.h>
#endif

#include <godot_cpp/classes/{parent_inc}.hpp>
#include <godot_cpp/core/binder_common.hpp>

using namespace godot;

class {Cls} : public {Parent} {
	GDCLASS({Cls}, {Parent});

protected:
	static void _bind_methods();

public:
	{Cls}();
	~{Cls}();
};
```

### 2. `src/{Cls}.cpp`
```cpp
#include "{Cls}.h"

#include <godot_cpp/core/class_db.hpp>

using namespace godot;

void {Cls}::_bind_methods() {
}

{Cls}::{Cls}() {
}

{Cls}::~{Cls}() {
}
```

### 3. `src/register_types.h`
```cpp
#pragma once

#include <godot_cpp/core/class_db.hpp>

using namespace godot;

void initialize_{lib}_module(ModuleInitializationLevel p_level);
void uninitialize_{lib}_module(ModuleInitializationLevel p_level);
```

### 4. `src/register_types.cpp`
```cpp
#include "register_types.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

#include "{Cls}.h"

using namespace godot;

void initialize_{lib}_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
	GDREGISTER_CLASS({Cls});
}

void uninitialize_{lib}_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
}

extern "C" {
GDExtensionBool GDE_EXPORT {lib}_library_init(
		GDExtensionInterfaceGetProcAddress p_get_proc_address,
		GDExtensionClassLibraryPtr p_library,
		GDExtensionInitialization *r_initialization) {
	godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
	init_obj.register_initializer(initialize_{lib}_module);
	init_obj.register_terminator(uninitialize_{lib}_module);
	init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return init_obj.init();
}
}
```

### 5. `SConstruct`
```python
#!/usr/bin/env python
# Auto-generated by godot-mcp-enhanced cpp tool.
# Expects godot-cpp cloned to ./godot-cpp (see README.md).
env = SConscript("godot-cpp/SConstruct")

env.Append(CPPPATH=["src/"])
sources = Glob("src/*.cpp")

library = env.SharedLibrary(
    "bin/libgd{lib}{}{}".format(env["suffix"], env["SHLIBSUFFIX"]),
    source=sources,
)

env.NoCache(library)
Default(library)
```

### 6. `{lib}.gdextension`
```ini
[configuration]

entry_symbol = "{lib}_library_init"
compatibility_minimum = "{ver}"

[libraries]
macos.debug = "res://bin/libgd{lib}.macos.template_debug.framework"
macos.release = "res://bin/libgd{lib}.macos.template_release.framework"
windows.debug.x86_64 = "res://bin/libgd{lib}.windows.template_debug.x86_64.dll"
windows.release.x86_64 = "res://bin/libgd{lib}.windows.template_release.x86_64.dll"
linux.debug.x86_64 = "res://bin/libgd{lib}.linux.template_debug.x86_64.so"
linux.release.x86_64 = "res://bin/libgd{lib}.linux.template_release.x86_64.so"
android.debug.arm64 = "res://bin/libgd{lib}.android.template_debug.arm64.so"
android.release.arm64 = "res://bin/libgd{lib}.android.template_release.arm64.so"
```
> 注：example.gdextension 含全平台（含 32 位/ios/web）。脚手架给主流 5 平台（macos/windows/linux x86_64/android arm64）即可，用户按需扩。`{ver}` 直接取 `godot_version`。

### 7. `.gitignore`
```
# Build artifacts
bin/
*.o
*.obj

# godot-cpp dependency (cloned separately, see README.md)
godot-cpp/

# Godot editor cache
.godot/
```

### 8. `README.md`
```markdown
# {Cls} — GDExtension (Godot {ver})

Auto-generated by **godot-mcp-enhanced** `cpp` tool.

## Build

1. Clone godot-cpp matching Godot **{ver}** into `./godot-cpp`:
   ```bash
   git clone -b godot-{ver}-stable https://github.com/godotengine/godot-cpp godot-cpp
   ```

2. Build the extension (produces `bin/libgd{lib}.*`):
   ```bash
   scons
   ```

3. In your Godot project, enable `{lib}.gdextension` (place or symlink this folder where Godot can reach it, then reload the project).

## Layout
- `src/{Cls}.h` / `{Cls}.cpp` — main class (extends {Parent})
- `src/register_types.cpp` / `.h` — module entry (`{lib}_library_init`)
- `SConstruct` — scons build (references `./godot-cpp`)
- `{lib}.gdextension` — Godot 4 extension descriptor
```

---

## 数据流

```
cpp(scaffold_gdextension, project_path, class_name, parent_class, godot_version, force)
  → requireProjectPath(args)            // ALLOWED_PROJECT_PATHS 校验，越界 throw → 外层转错误
  → 校验 class_name(PascalCase) / parent_class(白名单) / godot_version(列表) // 非法 → return textResult('Error: ...')
  → 检查 project_path 已存在且非空 + 非 force → return Error
  → renderScaffold({Cls,Parent,parent_inc,lib,ver})   // 返回 8 个 {path,content}
  → mkdirSync(project_path/src, recursive)
  → 逐文件 writeFileSync
  → return { files, gdextension_path, godot_cpp_clone_hint }
```

## 安全

- **路径越界**：`requireProjectPath` 复用 `isPathInAllowedRoots`（deny-by-default，`GODOT_MCP_UNRESTRICTED` 旁路同全项目）。
- **白名单前置报错**：非法 `parent_class`/`class_name`/`godot_version` 在写盘前拒绝（fail-fast，不产生半成品）。
- **防误覆盖**：`project_path` 已存在且非空 + 未 `force` → 拒绝（与 `create_project` 检测 `project.godot` 存在即拒的同思路）。
- **actionRisks**：`{ scaffold_gdextension: 'write' }` → `requiresConfirmation` 触发确认令牌（guard.ts 读 actionRisks）。

---

## TDD 任务分解

### Task 1：`cpp-templates.ts` — 模板与渲染（纯函数，先测后写）

**Files:**
- Create: `src/tools/cpp-templates.ts`
- Create: `test/cpp.test.ts`（本任务的渲染断言部分）

**Interfaces:**
- Produces: `renderScaffold(ctx): { path: string; content: string }[]`，`ctx = { className, parentClass, parentInc, lib, godotVersion }`；以及导出 `PARENT_CLASS_WHITELIST`、`SUPPORTED_GODOT_VERSIONS`、`CLASS_NAME_RE`。

- [ ] **Step 1：写失败测试**（追加到 `test/cpp.test.ts`）

```typescript
import { describe, it, expect } from 'vitest';
import {
  renderScaffold, PARENT_CLASS_WHITELIST, SUPPORTED_GODOT_VERSIONS, CLASS_NAME_RE,
} from '../src/tools/cpp-templates.js';

describe('cpp-templates renderScaffold', () => {
  const ctx = { className: 'Example', parentClass: 'Node', parentInc: 'node', lib: 'example', godotVersion: '4.6' };

  it('返回 8 个文件', () => {
    const files = renderScaffold(ctx);
    expect(files).toHaveLength(8);
    expect(files.map(f => f.path).sort()).toEqual(
      ['.gitignore', 'README.md', 'SConstruct', 'example.gdextension',
       'src/Example.cpp', 'src/Example.h', 'src/register_types.cpp', 'src/register_types.h'].sort()
    );
  });

  it('类名/父类/lib 正确替换进头文件', () => {
    const h = renderScaffold(ctx).find(f => f.path === 'src/Example.h')!.content;
    expect(h).toContain('class Example : public Node {');
    expect(h).toContain('GDCLASS(Example, Node)');
    expect(h).toContain('<godot_cpp/classes/node.hpp>');
  });

  it('register_types 含 entry_symbol 与 GDREGISTER_CLASS', () => {
    const cpp = renderScaffold(ctx).find(f => f.path === 'src/register_types.cpp')!.content;
    expect(cpp).toContain('example_library_init');
    expect(cpp).toContain('GDREGISTER_CLASS(Example)');
  });

  it('.gdextension 的 compatibility_minimum 随 godot_version 变化', () => {
    const v46 = renderScaffold({ ...ctx, godotVersion: '4.6' })
      .find(f => f.path === 'example.gdextension')!.content;
    const v44 = renderScaffold({ ...ctx, godotVersion: '4.4' })
      .find(f => f.path === 'example.gdextension')!.content;
    expect(v46).toContain('compatibility_minimum = "4.6"');
    expect(v44).toContain('compatibility_minimum = "4.4"');
    expect(v46).toContain('entry_symbol = "example_library_init"');
  });

  it('SConstruct 引用 ./godot-cpp 且输出 bin/libgdexample', () => {
    const s = renderScaffold(ctx).find(f => f.path === 'SConstruct')!.content;
    expect(s).toContain('SConscript("godot-cpp/SConstruct")');
    expect(s).toContain('libgdexample');
  });

  it('parent 白名单含 CharacterBody2D/3D 且 include 命名正确', () => {
    expect(PARENT_CLASS_WHITELIST.CharacterBody2D).toBe('character_body_2d');
    expect(PARENT_CLASS_WHITELIST.CharacterBody3D).toBe('character_body_3d');
    expect(PARENT_CLASS_WHITELIST.Node2D).toBe('node2d');
  });

  it('CLASS_NAME_RE 接受 PascalCase 拒绝其余', () => {
    expect(CLASS_NAME_RE.test('Example')).toBe(true);
    expect(CLASS_NAME_RE.test('MyClass2D')).toBe(true);
    expect(CLASS_NAME_RE.test('example')).toBe(false);   // 小写开头
    expect(CLASS_NAME_RE.test('My-Class')).toBe(false);   // 连字符
    expect(CLASS_NAME_RE.test('2DThing')).toBe(false);    // 数字开头
  });

  it('SUPPORTED_GODOT_VERSIONS 含 4.4/4.5/4.6', () => {
    expect([...SUPPORTED_GODOT_VERSIONS]).toEqual(['4.4', '4.5', '4.6']);
  });
});
```

- [ ] **Step 2：跑测试确认失败**

Run: `npx vitest run test/cpp.test.ts`
Expected: FAIL（`Cannot find module '../src/tools/cpp-templates.js'`）

- [ ] **Step 3：实现 `src/tools/cpp-templates.ts`**

按"产物 8 文件模板"与"白名单/常量"小节实现：导出 `PARENT_CLASS_WHITELIST`、`SUPPORTED_GODOT_VERSIONS`、`CLASS_NAME_RE`、`renderScaffold(ctx)`。模板字符串用上述 8 段骨架，`.replace(/\{Cls\}/g, …)` 等占位符替换（注意 `lib`/`ver`/`parent_inc` 同名占位全局替换）。

- [ ] **Step 4：跑测试确认通过**

Run: `npx vitest run test/cpp.test.ts`
Expected: PASS（8 个 it 全绿）

- [ ] **Step 5：commit**

```bash
git add src/tools/cpp-templates.ts test/cpp.test.ts
git commit -m "feat(cpp): add gdextension scaffold templates + render tests"
```

---

### Task 2：`cpp.ts` 主工具（scaffold action，端到端 mock fs）

**Files:**
- Create: `src/tools/cpp.ts`
- Modify: `test/cpp.test.ts`（追加 handleTool 断言）

**Interfaces:**
- Consumes: `renderScaffold`、`PARENT_CLASS_WHITELIST`、`SUPPORTED_GODOT_VERSIONS`、`CLASS_NAME_RE` from `./cpp-templates.js`；`requireProjectPath`、`requireString` from `../helpers.js`；`textResult`、`ToolContext`、`ToolResult` from `../types.js`；`RiskLevel` from `../core/tool-registry.js`。
- Produces: `getToolDefinitions()`、`handleTool()`、`TOOL_META`（`actionRisks: { scaffold_gdextension: 'write' }`）。

- [ ] **Step 1：写失败测试**（追加到 `test/cpp.test.ts`）

```typescript
import { vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('fs', () => fsMock);
// 路径校验绕过：强制 ALLOWED_PROJECT_PATHS 命中
vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');

import { handleTool } from '../src/tools/cpp.js';

describe('cpp scaffold_gdextension handleTool', () => {
  beforeEach(() => { vi.clearAllMocks(); fsMock.existsSync.mockReturnValue(false); });

  it('生成全部 8 文件并返回清单', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', class_name: 'Foo', parent_class: 'Node' },
      {} as any);
    const parsed = JSON.parse(r!.content[0].text);
    expect(parsed.files).toHaveLength(8);
    expect(parsed.gdextension_path).toContain('foo.gdextension');
    expect(parsed.godot_cpp_clone_hint).toContain('godot-4.6-stable'); // 默认版本
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('src'), { recursive: true });
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(8);
  });

  it('非法 parent_class → 报错且不写盘', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', parent_class: 'Sprite' /* 不在白名单 */ },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('非法 class_name → 报错', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', class_name: 'lower' },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
  });

  it('非法 godot_version → 报错', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', godot_version: '3.5' },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
  });

  it('目标已存在非空 + 未 force → 拒绝', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['a.cpp'] as any);
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext' },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('force=true 时覆盖已存在非空目录', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['a.cpp'] as any);
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', force: true },
      {} as any);
    const parsed = JSON.parse(r!.content[0].text);
    expect(parsed.files).toHaveLength(8);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(8);
  });
});
```

> **注意**：`vi.stubEnv('GODOT_MCP_UNRESTRICTED','true')` 让 `isPathInAllowedRoots` 放行，使 `requireProjectPath` 不抛——等价于审查侧的"沙箱旁路"，与 `path-security.test.ts` 的测试隔离方式一致。

- [ ] **Step 2：跑测试确认失败**

Run: `npx vitest run test/cpp.test.ts`
Expected: FAIL（`Cannot find module '../src/tools/cpp.js'`）

- [ ] **Step 3：实现 `src/tools/cpp.ts`**

```typescript
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import type { RiskLevel } from '../core/tool-registry.js';
import { textResult } from '../types.js';
import { requireProjectPath } from '../helpers.js';
import {
  renderScaffold, PARENT_CLASS_WHITELIST, SUPPORTED_GODOT_VERSIONS, CLASS_NAME_RE,
} from './cpp-templates.js';

const ACTIONS = ['scaffold_gdextension'] as const;

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'cpp',
    description: 'GDExtension (C++) 脚手架生成。scaffold_gdextension: 在 project_path 下生成完整可编译的 godot-cpp GDExtension 工程骨架（src/类.cpp/.h + register_types + SConstruct + .gdextension + .gitignore + README），不联网/不编译，对齐 godot-cpp 官方 example。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['scaffold_gdextension'], description: '操作类型' },
        project_path: { type: 'string', description: 'GDExtension 工程生成根目录（须在 ALLOWED_PROJECT_PATHS 内）' },
        class_name: { type: 'string', description: '主类名（PascalCase，默认 Example）', default: 'Example' },
        parent_class: { type: 'string', description: '父类（Godot 内置类白名单，默认 Node）', default: 'Node' },
        godot_version: { type: 'string', description: 'Godot 版本（4.4/4.5/4.6，决定 godot-cpp clone tag 与 .gdextension compatibility_minimum，默认 4.6）', default: '4.6', enum: ['4.4', '4.5', '4.6'] },
        force: { type: 'boolean', description: '目标已存在且非空时是否覆盖（默认 false）', default: false },
      },
      required: ['action', 'project_path'],
    },
  }];
}

export async function handleTool(
  name: string, args: Record<string, unknown>, _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'cpp') return null;
  const action = args.action as string;
  if (!(ACTIONS as readonly string[]).includes(action)) return null;

  // 路径安全校验（越界 throw 由外层 ToolDispatcher 统一捕获）
  const projectPath = requireProjectPath(args);

  const className = (args.class_name as string) || 'Example';
  const parentClass = (args.parent_class as string) || 'Node';
  const godotVersion = (args.godot_version as string) || '4.6';
  const force = args.force === true;

  // 白名单前置校验（fail-fast，写盘前拒绝）
  if (!CLASS_NAME_RE.test(className)) {
    return textResult(`Error: class_name "${className}" must be PascalCase (e.g. MyExample).`);
  }
  const parentInc = PARENT_CLASS_WHITELIST[parentClass];
  if (!parentInc) {
    return textResult(`Error: parent_class "${parentClass}" not in whitelist. Allowed: ${Object.keys(PARENT_CLASS_WHITELIST).join(', ')}`);
  }
  if (!(SUPPORTED_GODOT_VERSIONS as readonly string[]).includes(godotVersion)) {
    return textResult(`Error: godot_version "${godotVersion}" not supported. Allowed: ${[...SUPPORTED_GODOT_VERSIONS].join(', ')}`);
  }

  // 防误覆盖
  if (existsSync(projectPath) && readdirSync(projectPath).length > 0 && !force) {
    return textResult(`Error: target directory not empty: ${projectPath}. Use force=true to overwrite.`);
  }

  const lib = className.toLowerCase();
  const files = renderScaffold({ className, parentClass, parentInc, lib, godotVersion });

  mkdirSync(join(projectPath, 'src'), { recursive: true });
  for (const f of files) {
    mkdirSync(join(projectPath, f.path.substring(0, f.path.lastIndexOf('/'))), { recursive: true });
    writeFileSync(join(projectPath, f.path), f.content, 'utf-8');
  }

  return textResult(JSON.stringify({
    files: files.map(f => f.path),
    gdextension_path: join(projectPath, `${lib}.gdextension`),
    godot_cpp_clone_hint: `git clone -b godot-${godotVersion}-stable https://github.com/godotengine/godot-cpp godot-cpp`,
  }, null, 2));
}

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean; actionRisks: Record<string, RiskLevel> }> = {
  cpp: {
    readonly: false,
    long_running: false,
    actionRisks: { scaffold_gdextension: 'write' },
  },
};
```

- [ ] **Step 4：跑测试确认通过**

Run: `npx vitest run test/cpp.test.ts`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add src/tools/cpp.ts test/cpp.test.ts
git commit -m "feat(cpp): scaffold_gdextension action + handler tests"
```

---

### Task 3：注册 + group + OFFLINE + GUARDED_KEYS

**Files:**
- Modify: `src/core/module-loader.ts`
- Modify: `src/core/tool-registry.ts`
- Modify: `test/risk-coverage.test.ts`

**Interfaces:** 无新接口；纯接线。

- [ ] **Step 1：写失败测试**（在 `test/risk-coverage.test.ts` 已有机制下，先改 `GUARDED_KEYS` 再跑，确认 cpp 出现）

把 `'cpp'` 加入 `GUARDED_KEYS`：
```typescript
const GUARDED_KEYS = new Set([
  'scene', 'script', 'animation', 'tilemap', 'game', 'material', 'particles',
  'signal', 'nav', 'audio', 'ui', 'physics', 'runtime', 'android', 'workflow',
  'validation', 'manage_tools', 'project', 'cpp',
]);
```

- [ ] **Step 2：在 `module-loader.ts` 加 import（第 53 行 `androidOps` 后）**

```typescript
import * as androidOps from '../tools/android.js';
import * as cpp from '../tools/cpp.js';   // ← 新增
```

- [ ] **Step 3：把 `cpp` 加入 `ALL_MODULES`（数组末尾 `androidOps,` 后）**

```typescript
  loadSkill,
  androidOps,
  cpp,   // ← 新增
];
```

- [ ] **Step 4：在 `tool-registry.ts` 的 `TOOL_GROUPS.code.tools` 加 `'cpp'`**

```typescript
code: { description: '代码工具', tools: ['docs', 'load_skill', 'cpp'], requires: [] },
```

- [ ] **Step 5：在 `OFFLINE_TOOLS` 加 `'cpp'`**

```typescript
export const OFFLINE_TOOLS = new Set([
  'project', 'script', 'validation', 'confirm_and_execute',
  'manage_tools', 'godot_advanced_tool', 'load_skill', 'cpp',
]);
```

- [ ] **Step 6：跑测试确认通过**

Run: `npx vitest run test/risk-coverage.test.ts test/core/tool-registry-groups.test.ts`
Expected: PASS（`cpp` 的 `scaffold_gdextension: 'write'` 被 GUARDED_KEYS 放行；group 映射命中 `code`）

- [ ] **Step 7：commit**

```bash
git add src/core/module-loader.ts src/core/tool-registry.ts test/risk-coverage.test.ts
git commit -m "feat(cpp): register module + code group + offline + GUARDED_KEYS"
```

---

### Task 4：重生成 capability-matrix + 全量门禁

**Files:**
- Regenerate: `docs/capability-matrix.json` / `docs/capability-matrix.md`

- [ ] **Step 1：重生成 matrix**

Run: `npm run build-matrix`
Expected stdout: `[build-matrix] N tools → docs/capability-matrix.{json,md}`（N 比之前 +1）

- [ ] **Step 2：确认 cpp 已入 matrix（无手改）**

Run: `npx vitest run test/capability/matrix-integrity.test.ts`
Expected: PASS（committed matrix == live extraction；`cpp` 覆盖；riskDistribution 和=1）

- [ ] **Step 3：全量门禁**

Run: `npm run lint`
Expected: exit 0

Run: `npm test`
Expected: 全绿（特别确认 `risk-coverage` / `matrix-integrity` / `tool-registry-groups` 三处不红）

Run: `npm run build`
Expected: tsc exit 0（无类型错误）

- [ ] **Step 4：commit**

```bash
git add docs/capability-matrix.json docs/capability-matrix.md
git commit -m "chore(capability): regenerate matrix for cpp tool"
```

---

## 验收标准（DoD）

1. ✅ `cpp(scaffold_gdextension)` 生成全部 8 文件，模板变量正确替换
2. ✅ `.gdextension` 的 `compatibility_minimum` 随 `godot_version` 变化
3. ✅ 路径越界 → `requireProjectPath` throw（`PATH_NOT_ALLOWED`）
4. ✅ 目标已存在非空：未 force 拒绝 / force 覆盖
5. ✅ 非法 `class_name` / `parent_class` / `godot_version` → 前置报错且不写盘
6. ✅ `actionRisks` 标注正确 + `'cpp'` 在 `GUARDED_KEYS`
7. ✅ `cpp` 在 `code` group + `OFFLINE_TOOLS`
8. ✅ `docs/capability-matrix.{json,md}` 重生成且与 live extraction 一致
9. ✅ `npm run lint` / `npm run build` / `npm test` 全绿

## YAGNI 边界（不做）

- ❌ 不调 scons / 不 `git clone` godot-cpp / 不联网
- ❌ 不做 `add_cpp_class`（追加类）、方法绑定宏生成、热重载
- ❌ 不做 CMake 备选构建（仅 SConstruct）
- ❌ 不做 `editor/` 开发版插件占位
- ❌ 不做 C# / GDScript 之外其它语言

---

## Self-Review

**1. Spec 覆盖**：每条验收标准都能指到 Task——①Task1/2、②Task1、③Task2（requireProjectPath）、④Task2、⑤Task2、⑥Task3、⑦Task3、⑧Task4、⑨Task4。无缺。

**2. 占位符扫描**：8 个模板均给出完整代码（非 "TBD"）；Task 步骤均含真实测试代码/实现代码/命令/预期。`renderScaffold` 的占位符是模板字面量替换标记（运行期设计），非 plan 占位符。

**3. 类型一致**：`renderScaffold` 入参 `{className,parentClass,parentInc,lib,godotVersion}` 在 Task1（定义+测）与 Task2（调用）一致；`TOOL_META.actionRisks.scaffold_gdextension` 在 Task2（定义）、Task3（GUARDED_KEYS 放行）、Task4（riskDistribution 和=1 断言）一致；`lib = className.toLowerCase()` 在 Task1 测试（`example.gdextension`）与 Task2 实现（`gdextension_path`）一致。

**4. 潜在风险点**：
- godot-cpp class 头文件（`node.hpp` 等）由绑定生成器在用户构建时产出，git 仓库不含——白名单 include 命名依赖 godot-cpp 既定规则（`control.hpp` 经 example.h 验证，其余遵循同一 snake_case 规则）。若用户报告某 include 名不对，扩 `PARENT_CLASS_WHITELIST` 即可，不影响已生成工程。
- `vi.stubEnv('GODOT_MCP_UNRESTRICTED','true')` 在 Task2 测试里旁路路径校验——与 `path-security.test.ts` 的隔离手法一致，不污染其他测试套件（vitest 进程级 env，套件结束随进程回收；若担心，可在 `afterAll` 还原）。
