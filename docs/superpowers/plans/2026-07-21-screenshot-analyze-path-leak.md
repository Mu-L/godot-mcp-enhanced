# screenshot analyze path-leak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧 `screenshot(action=analyze)` 路径校验对齐 capture——补两处 `isPathInAllowedRoots` 堵 #1（projectPath 默认模式可读任意目录）+ #2（allowOutside imagePath 可读 allowed roots 外）。

**Architecture:** 方案 A 内联补 `isPathInAllowedRoots`，对齐 capture 现有模式（`:60` requireProjectPath + `:68` isPathInAllowedRoots 守卫）。`screenshot.ts:9` 已 import `isPathInAllowedRoots`，无需改 import。不抽 helper。

**Tech Stack:** TypeScript / vitest / godot-mcp-enhanced（`src/tools/screenshot.ts` + 新 `test/screenshot-analyze-path-leak.test.ts`）

## Global Constraints

- **不 break capture**：capture（`:59-122`）已正确，不动
- **#1 projectPath 可选**：analyze projectPath 仅传 image_path 时可缺，**不能**直接换 `requireProjectPath`（强制必填）——改"提供时补 isPathInAllowedRoots"
- **测试 env 隔离**：`test/setup.js` 全局设 `GODOT_MCP_UNRESTRICTED='true'`。两个 leak 测试都须 `vi.stubEnv('GODOT_MCP_UNRESTRICTED','')` 清掉 + `_resetPathAllowWarned()`，否则 isPathInAllowedRoots 总返 true 无法触发校验
- **#1 用 cwd 控 roots**：清 UNRESTRICTED + 无 ALLOWED_PROJECT_PATHS → isPathInAllowedRoots 回落 cwd（`path-utils.ts:291`），`process.chdir(allowedDir)` 控 allowed root
- **#2 用 ALLOWED_PROJECT_PATHS 控 roots**：清 UNRESTRICTED + 设 `ALLOWED_PROJECT_PATHS=allowedDir` → allowOutsideProjectPaths()=true（走 :132-136）但 isPathInAllowedRoots 限 roots
- **afterEach 清理**：`process.chdir(origCwd)` + `vi.unstubAllEnvs()`（恢复 UNRESTRICTED='true'）+ `delete process.env.ALLOWED_PROJECT_PATHS` + `_resetPathAllowWarned()` + `rmSync` 临时目录
- **不 mock analyze 文件读**：analyze 走 existsSync/readFileSync（非 captureScreenshot），测试建真实临时 PNG 文件
- **PNG 签名字节**：`Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])`——screenshot.ts 不校验 PNG magic（只按 extname 定 mimeType），但用真签名更真实
- **不改**：capture / analyze 非路径逻辑 / #3 绝对路径返回 / 非_allowOutside 分支 resolveWithinRoot / 不抽 helper
- **验证命令**：`npx tsc --noEmit` / `npx vitest run test/screenshot-analyze-path-leak.test.ts` / `npx vitest run`
- **不 push**：commit master 不 push origin（prior 惯例）

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `src/tools/screenshot.ts` | Modify `:127`（#1 projectPath 校验）+ `:136`（#2 allowOutside imagePath 校验）| 两处补 isPathInAllowedRoots 对齐 capture |
| `test/screenshot-analyze-path-leak.test.ts` | Create（新文件，.ts）| #1 + #2 leak TDD 复现 + 反向不误拒 |

---

## Task 1: #1 projectPath 校验 + TDD

**Files:**
- Create: `test/screenshot-analyze-path-leak.test.ts`（文件头 + makeCtx + PNG_BYTES + #1 describe）
- Modify: `src/tools/screenshot.ts:127`（projectPath 提供时补 isPathInAllowedRoots）

**Interfaces:**
- Consumes: `handleTool` from `'../src/tools/screenshot.js'`；`_resetPathAllowWarned` from `'../src/core/path-utils.js'`；`isPathInAllowedRoots`（screenshot.ts:9 已 import）
- Produces: `handleTool('screenshot',{action:'analyze',project_path:<外部>,image_path:<相对>},ctx)` 在默认模式（cwd 回落）throw `not in ALLOWED_PROJECT_PATHS`；project_path=<cwd> 不误拒

- [ ] **Step 1: 写失败测试（文件头 + makeCtx + PNG_BYTES + #1 describe）**

创建 `test/screenshot-analyze-path-leak.test.ts`：
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleTool } from '../src/tools/screenshot.js';
import { _resetPathAllowWarned } from '../src/core/path-utils.js';

// analyze 走 existsSync/readFileSync（非 captureScreenshot），无需 mock screenshot.js

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn(async () => '/usr/bin/godot'),
    runningProcess: null, setRunningProcess: vi.fn(),
    outputBuffer: [], setOutputBuffer: vi.fn(),
    processStartTime: 0, setProcessStartTime: vi.fn(),
    projectDir: '', setProjectDir: vi.fn(),
    parseGodotConfig: vi.fn(() => ({})),
    ...overrides,
  } as any;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ─── #1: projectPath 默认模式可读任意目录（leak）──────────────────────────────
describe('screenshot analyze path-leak #1: projectPath 校验（默认模式）', () => {
  let allowedDir: string;
  let outsideDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');   // 清 setup.js 设的 UNRESTRICTED
    delete process.env.ALLOWED_PROJECT_PATHS;    // 默认模式（无白名单）
    process.chdir(allowedDir);                    // cwd 回落 = allowed root
    _resetPathAllowWarned();
  });

  afterEach(() => {
    process.chdir(origCwd);
    vi.unstubAllEnvs();
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('修复后: project_path=outside image_path=相对 → throw（默认模式防任意目录读）', async () => {
    const result = handleTool('screenshot', {
      action: 'analyze',
      project_path: outsideDir,
      image_path: 'secret.png',
    }, makeCtx());
    // 修复前（leak）: resolveWithinRoot(outsideDir,'secret.png') 读成功（rejects.toThrow 失败 = RED）
    // 修复后: :127 isPathInAllowedRoots(outsideDir)=false（不在 cwd=allowedDir）→ throw
    await expect(result).rejects.toThrow(/not in ALLOWED_PROJECT_PATHS/);
  });

  it('反向: project_path=allowed(cwd) 不误拒', async () => {
    writeFileSync(join(allowedDir, 'shot.png'), PNG_BYTES);
    const result = await handleTool('screenshot', {
      action: 'analyze',
      project_path: allowedDir,
      image_path: 'shot.png',
    }, makeCtx());
    expect(result).not.toBeNull();
    expect(result!.content.some((c: any) => c.type === 'image')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败（RED）**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts -t "#1"`
Expected: FAIL——"修复后"用例 rejects.toThrow 失败（修复前 handleTool 读 outsideDir/secret.png 成功返回，非 throw）。反向用例此时也跑（应 PASS，因 allowedDir=cwd 合法）。

- [ ] **Step 3: 改实现（`screenshot.ts:127` 后补 isPathInAllowedRoots）**

`src/tools/screenshot.ts:124-127` 原：
```ts
    case 'analyze': {
      let imagePath = args.image_path as string | undefined;
      const projectPathRaw = typeof args.project_path === 'string' ? args.project_path : undefined;
      const projectPath = projectPathRaw?.trim() ? validatePath(projectPathRaw) : undefined;
```
改为（:127 后加校验块）：
```ts
    case 'analyze': {
      let imagePath = args.image_path as string | undefined;
      const projectPathRaw = typeof args.project_path === 'string' ? args.project_path : undefined;
      const projectPath = projectPathRaw?.trim() ? validatePath(projectPathRaw) : undefined;
      // #1 path-leak: projectPath 提供时校验 isPathInAllowedRoots（对齐 capture :60 requireProjectPath）。
      // analyze projectPath 可选（仅 image_path 时缺），不能直接换 requireProjectPath（强制必填）。
      if (projectPath && !isPathInAllowedRoots(projectPath)) {
        throw new Error(`project_path not in ALLOWED_PROJECT_PATHS: ${projectPath}. Check your ALLOWED_PROJECT_PATHS setting.`);
      }
```

- [ ] **Step 4: 跑测试确认通过（GREEN）**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts -t "#1"`
Expected: PASS——"修复后"用例 throw（isPathInAllowedRoots(outsideDir)=false）；反向用例不误拒。

- [ ] **Step 5: commit**

```bash
git add src/tools/screenshot.ts test/screenshot-analyze-path-leak.test.ts
git commit -m "fix(screenshot): analyze projectPath 补 isPathInAllowedRoots 堵默认模式任意目录读（#1 path-leak）" -m "analyze :127 用 validatePath（不校验 root）非 capture :60 的 requireProjectPath，默认模式 project_path 可指向任意目录读文件。补 isPathInAllowedRoots 校验（projectPath 可选，提供时校验，不强制必填）。TDD RED→GREEN。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: #2 allowOutside imagePath 校验 + TDD

**Files:**
- Modify: `test/screenshot-analyze-path-leak.test.ts`（末尾追加 #2 describe）
- Modify: `src/tools/screenshot.ts:136`（allowOutside 分支 imagePath 补 isPathInAllowedRoots）

**Interfaces:**
- Consumes: 同 Task 1（makeCtx/PNG_BYTES/_resetPathAllowWarned 已定义）
- Produces: `handleTool('screenshot',{action:'analyze',image_path:<allowed roots 外绝对路径>},ctx)` 在 ALLOWED_PROJECT_PATHS 模式 throw `outside allowed project roots`；image_path=<allowed 内> 不误拒

- [ ] **Step 1: 写失败测试（末尾追加 #2 describe）**

在 `test/screenshot-analyze-path-leak.test.ts` 末尾追加：
```ts
// ─── #2: allowOutside imagePath 可读 allowed roots 外（leak）──────────────────
describe('screenshot analyze path-leak #2: allowOutside imagePath 校验', () => {
  let allowedDir: string;
  let outsideDir: string;

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');        // 清 setup.js 设的 UNRESTRICTED
    process.env.ALLOWED_PROJECT_PATHS = allowedDir;   // 白名单模式 → allowOutside=true 但限 roots
    _resetPathAllowWarned();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('修复后: allowOutside image_path=outside 绝对路径 → throw（防 allowed roots 外读）', async () => {
    const result = handleTool('screenshot', {
      action: 'analyze',
      image_path: join(outsideDir, 'secret.png'),
    }, makeCtx());
    // 修复前（leak）: :136 validatePath 不校验 → 读 outside（rejects.toThrow 失败 = RED）
    // 修复后: :136 isPathInAllowedRoots(outside)=false（不在 ALLOWED=allowedDir）→ throw
    await expect(result).rejects.toThrow(/outside allowed project roots/);
  });

  it('反向: image_path=allowed 内不误拒', async () => {
    writeFileSync(join(allowedDir, 'shot.png'), PNG_BYTES);
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: join(allowedDir, 'shot.png'),
    }, makeCtx());
    expect(result).not.toBeNull();
    expect(result!.content.some((c: any) => c.type === 'image')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败（RED）**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts -t "#2"`
Expected: FAIL——"修复后"用例 rejects.toThrow 失败（修复前 :136 validatePath 不校验，读 outsideDir/secret.png 成功）。反向用例应 PASS。

- [ ] **Step 3: 改实现（`screenshot.ts:136` 后补 isPathInAllowedRoots，对齐 capture :68）**

`src/tools/screenshot.ts:132-136` 原：
```ts
      if (imagePath) {
        if (allowOutsideProjectPaths()) {
          if (!isAbsolute(imagePath) && projectPath) {
            imagePath = resolve(projectPath, normalizeUserProjectPath(imagePath));
          }
          imagePath = validatePath(imagePath);
```
改为（:136 后加守卫）：
```ts
      if (imagePath) {
        if (allowOutsideProjectPaths()) {
          if (!isAbsolute(imagePath) && projectPath) {
            imagePath = resolve(projectPath, normalizeUserProjectPath(imagePath));
          }
          imagePath = validatePath(imagePath);
          // #2 path-leak: allowOutside 分支补 isPathInAllowedRoots（对齐 capture :68 守卫）。
          // validatePath 只 resolve 不校验 root，allowOutside 模式可读 ALLOWED_PROJECT_PATHS 外任意绝对路径。
          if (!isPathInAllowedRoots(imagePath)) {
            throw new Error(`Image path is outside allowed project roots: ${imagePath}`);
          }
```

- [ ] **Step 4: 跑测试确认通过（GREEN）**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts -t "#2"`
Expected: PASS——"修复后"用例 throw；反向用例不误拒。

- [ ] **Step 5: commit**

```bash
git add src/tools/screenshot.ts test/screenshot-analyze-path-leak.test.ts
git commit -m "fix(screenshot): analyze allowOutside imagePath 补 isPathInAllowedRoots 堵 roots 外读（#2 path-leak，C4）" -m "analyze :136 allowOutside 分支用 validatePath 缺 isPathInAllowedRoots，capture :68 同分支有守卫。ALLOWED_PROJECT_PATHS 模式下可读白名单外任意绝对路径。补守卫对齐 capture。reviewer C4（2026-07-20 BC DX spec）open finding。TDD RED→GREEN。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 最终验证（全任务完成后）

- [ ] **Step 1: 类型绿**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 2: path-leak 测试全绿**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts`
Expected: 全 PASS（#1 + #2 各 2 用例 = 4 用例）

- [ ] **Step 3: screenshot 现有测试不 break**

Run: `npx vitest run test/screenshot-tools.test.js test/screenshot-core.test.js test/screenshot-2d.test.ts`
Expected: 全 PASS（现有 analyze 测试 `:110-122` 不传 project_path/image_path 走 :146 error 路径，不触发 #1/#2 校验）

- [ ] **Step 4: 全量回归**

Run: `npx vitest run`
Expected: 全 PASS（除 4 个 pre-existing T11 ToolDispatcher elicitation failed，基准已验证非本 follow-up 引入）

- [ ] **Step 5: grep 守卫确认两处校验就位**

Run:
```bash
grep -n "isPathInAllowedRoots" src/tools/screenshot.ts
```
Expected: ≥4 处（`:9` import + capture `:68` 守卫 + analyze `:127`后 #1 + analyze `:136`后 #2）

---

## Self-Review

**1. Spec coverage**（spec 各节 → task 映射）：
- spec 背景 #1（projectPath validatePath 非 requireProjectPath，默认模式可读任意目录）→ Task 1 ✅
- spec 背景 #2（allowOutside imagePath 缺 isPathInAllowedRoots）→ Task 2 ✅
- spec 方案 A（内联补 isPathInAllowedRoots，:9 已 import）→ Task 1 Step 3 + Task 2 Step 3 ✅
- spec 测试（RED leak 复现 + GREEN + 反向不误拒）→ Task 1/2 各 2 用例 ✅
- spec 不改（capture/#3/resolveWithinRoot/不抽 helper）→ Global Constraints ✅
- spec 风险（env 隔离 _resetPathAllowWarned + cwd 依赖 chdir + 现有测试 grep）→ Global Constraints + Task 1 beforeEach chdir + 最终验证 Step 3 ✅

**2. Placeholder scan**: 无 TBD/TODO/"add appropriate"。改动 1/2 完整代码块；测试代码完整（含 makeCtx/PNG_BYTES/beforeEach/afterEach/用例）。

**3. Type consistency**: `isPathInAllowedRoots` 签名一致；`makeCtx` Task 1 定义 Task 2 复用；`PNG_BYTES` 同；throw 消息与 `rejects.toThrow(/regex/)` 匹配（#1 `/not in ALLOWED_PROJECT_PATHS/`，#2 `/outside allowed project roots/`）。

**潜在执行风险（执行者留意）**：
- **vi.unstubAllEnvs 恢复 UNRESTRICTED**：setup.js 用 `process.env.GODOT_MCP_UNRESTRICTED='true'`（直接赋值）。vi.stubEnv 记录 stub 前值='true'，unstubAllEnvs 恢复='true'。若 vi.stubEnv 不记录 setup.js 的赋值（视 stubEnv 时 process.env 当前值为基线），基线='true'，恢复正确。若实际行为异常（unstub 后 UNRESTRICTED 非 'true'），改 afterEach 显式 `process.env.GODOT_MCP_UNRESTRICTED='true'`。
- **process.chdir 跨测试污染**：Task 1 beforeEach chdir(allowedDir)，afterEach chdir(origCwd)。若某用例 throw 中断 afterEach 不执行——vitest afterEach 即使 it 抛错也执行，安全。但 origCwd 须在 describe 作用域捕获（已做 `const origCwd = process.cwd()`）。
- **handleTool 非 await 的 rejects.toThrow**：handleTool 返 Promise（async）。`rejects.toThrow` 须 `await expect(promise).rejects.toThrow()`。Task 1/2 "修复后"用例 `const result = handleTool(...)`（非 await）+ `await expect(result).rejects.toThrow()`——result 是 Promise，rejects.toThrow 接 Promise ✅。
- **#1 反向用例 resolveWithinRoot**：projectPath=allowedDir（cwd），image_path='shot.png'。allowOutsideProjectPaths()=false（清 UNRESTRICTED + 无 ALLOWED）→ :137-142 非 allowOutside 分支 → resolveWithinRoot(allowedDir,'shot.png')=allowedDir/shot.png。isPathInAllowedRoots(allowedDir)=（cwd=allowedDir）true → :127 不 throw → 读成功 ✅。
- **现有 screenshot-tools.test.js :94-108 capture 测试**：用 `project_path:'/tmp/test-project'` + UNRESTRICTED=true（setup 默认）→ requireProjectPath → isPathInAllowedRoots（UNRESTRICTED）true → 不 throw → captureScreenshot mock success。本 follow-up 不改 capture，不影响 ✅。
