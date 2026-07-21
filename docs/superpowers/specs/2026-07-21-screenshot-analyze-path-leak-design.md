# screenshot analyze path-leak 修复设计

> 适用于 godot-mcp-enhanced master（2026-07-21）
> 来源：reviewer C4（2026-07-20 BC DX spec review）open 安全 finding + 源码核实发现更深的 #1
> 关联 spec：`docs/superpowers/specs/2026-07-20-bc-dx-improvements-design.md:41/92`（C4 当时留独立 follow-up）

## 背景

`screenshot(action=analyze)` 读本地 `image_path` 文件返回 base64（供客户端视觉分析）。源码核实发现 analyze 路径校验有**两个 leak**——capture 已正确，analyze 与 capture 不一致：

- **#1（默认模式可触发，更深；C4 未指出）**：analyze 的 `projectPath`（`src/tools/screenshot.ts:127`）用 `validatePath`，而 `validatePath = resolvePath`（`src/core/path-utils.ts:43`，注释明示 "Does NOT validate security"）。capture（`screenshot.ts:60`）用 `requireProjectPath`（`src/helpers.ts:110-116`，含 `isPathInAllowedRoots`）。默认模式（无 `ALLOWED_PROJECT_PATHS` / `GODOT_MCP_UNRESTRICTED`）下，analyze 的 `project_path` 可指向任意目录——`resolveWithinRoot`（`:141`）只校验 `image_path` 不穿越 `projectPath`，不校验 `projectPath` 是否在 allowed roots——读该目录下文件 base64 返回，**绕过 cwd 限制**。capture 同参数会被 `requireProjectPath` 拒。
- **#2（C4 指出，allowOutside 模式）**：analyze allowOutside 分支 imagePath（`:136`）用 `validatePath` 缺 `isPathInAllowedRoots` 守卫；capture 同分支（`:68`）有守卫。`GODOT_MCP_UNRESTRICTED=true` 或 `ALLOWED_PROJECT_PATHS` 配置时可读 allowed roots **外**任意绝对路径并 base64 返回。

## 目标

收紧 analyze 路径校验对齐 capture，堵 #1 + #2。最小改动、不抽 helper、不改 capture。

## 方案

**方案 A：内联补 `isPathInAllowedRoots`，对齐 capture 现有模式。** `screenshot.ts:9` 已 import `isPathInAllowedRoots`（无需改 import）。

### 改动 1：#1 projectPath 校验（`screenshot.ts:127` 后补）

analyze 的 `projectPath` 可选（仅传 `image_path` 时可缺），**不能**直接换 `requireProjectPath`（其内部 `requireString` 强制 `project_path` 必填）。改：`projectPath` 提供时补 `isPathInAllowedRoots`，throw 对齐 `requireProjectPath` 风格：

```ts
const projectPath = projectPathRaw?.trim() ? validatePath(projectPathRaw) : undefined;
if (projectPath && !isPathInAllowedRoots(projectPath)) {
  throw new Error(`project_path not in ALLOWED_PROJECT_PATHS: ${projectPath}. Check your ALLOWED_PROJECT_PATHS setting.`);
}
```

### 改动 2：#2 allowOutside imagePath 校验（`screenshot.ts:136` 后补，对齐 capture `:68`）

```ts
if (allowOutsideProjectPaths()) {
  if (!isAbsolute(imagePath) && projectPath) {
    imagePath = resolve(projectPath, normalizeUserProjectPath(imagePath));
  }
  imagePath = validatePath(imagePath);
  if (!isPathInAllowedRoots(imagePath)) {
    throw new Error(`Image path is outside allowed project roots: ${imagePath}`);
  }
}
```

## 测试（TDD）

新文件 `test/screenshot-analyze-path-leak.test.ts`（或扩 `test/screenshot-core.test.js`，plan 阶段定）。

### RED：leak 复现

1. **#1 默认模式 leak**：清 env（无 `ALLOWED_PROJECT_PATHS` / `UNRESTRICTED`），控制 cwd（`process.chdir` 到临时项目目录 A）。建外部目录 B（含 `secret.png`）。`analyze project_path=B image_path=secret.png` → 修复前读 `B/secret.png` 成功（leak）；修复后 throw `project_path not in ALLOWED_PROJECT_PATHS`。
2. **#2 allowOutside leak**：`vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true')` + `_resetPathAllowWarned()`，`analyze image_path=<allowed roots 外绝对路径>` → 修复前读成功；修复后 throw `Image path is outside allowed project roots`。

### GREEN：修复后两 leak 测试转 throw

### 反向：合法路径不误拒

- `analyze project_path=<cwd/allowed 目录> image_path=相对` → 读成功（不误拒）
- allowOutside 模式 `image_path=<allowed roots 内绝对路径>` → 读成功

## 不改

- capture（已正确：`:60` requireProjectPath + `:68` isPathInAllowedRoots）
- analyze 非路径逻辑（existsSync `:149` / size `:154` / base64 `:163` / mimeType `:165`）
- #3 绝对路径返回（`Image not found: ${imagePath}` `:150` / `Screenshot saved to: ${result.imagePath}` `:108`）——通用 error message 模式，所有工具都有，非 analyze 特有 leak
- 非 allowOutside 分支 `resolveWithinRoot`（`:141`，已防穿越）
- 不抽 helper（用户选内联对齐 capture）

## 验证

- `npx tsc --noEmit`（exit 0）
- screenshot-analyze-path-leak 测试全绿
- 全量 `npx vitest run`（确保不 break 现有 screenshot 测试——若现有 analyze 测试用外部 project_path，修复后会 throw，须同步）

## 风险

- **测试 env 隔离**：`isPathInAllowedRoots` 读 `process.env` + 缓存 `_pathAllowLogged`（`path-utils.ts:241`）。测试须 `vi.stubEnv` + `_resetPathAllowWarned()`（`beforeEach` 清状态）防跨测试污染。
- **cwd 依赖**：默认模式 `isPathInAllowedRoots` 回落 `process.cwd()`（`path-utils.ts:291`）。#1 测试须 `process.chdir` 控 cwd 或 mock。
- **现有 screenshot 测试**：`test/screenshot-core.test.js` / `screenshot-tools.test.js` 若已有 analyze 测试用外部 `project_path`，修复后会 throw，须同步断言。plan 阶段 grep 确认。
