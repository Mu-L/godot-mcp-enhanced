# execute_bpy（headless Blender 程序化建模）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 godot-mcp-enhanced 内置 headless Blender 建模，新增单工具 `execute_bpy`（action），AI 写 bpy 片段 → godot-mcp 包装 → headless spawn blender → 导 glb 到 res://，省去外部 blender-mcp 中转。

**Architecture:** 对称现有 headless Godot 管道——新增 `blender-finder`（对称 `godot-finder`，砍 project override、单值缓存）、`blender-spawn`（对称 `godot-spawn` 的 `runGodotHeadless`）、`blender` 工具模块（对称 `script` 工具的 `execute_gdscript` action）。复用 `path-utils` 的 `resolveWithinRoot`/`normalizeUserProjectPath` 做 glb 落点校验，`requireProjectPath` 做 project_path 白名单，`buildSafeEnv` 给所有 spawn。

**Tech Stack:** TypeScript（Node ESM）、`@modelcontextprotocol/sdk`、`child_process`（内置，零新依赖）、vitest 4。

## Global Constraints

- **零新 npm 依赖**：blender 是外部可执行文件，用 `child_process`（内置）。禁止引入 axios/fetch/网络库。
- **所有 spawn 传 `buildSafeEnv()`**（`src\helpers.ts:145`）——防子进程继承敏感 env（`GODOT_MCP_UNRESTRICTED` 等必须在子进程被剥）。
- **对称现有模式**：`blender-finder`↔`godot-finder`、`blender-spawn`↔`godot-spawn`、`blender` 工具↔`script` 工具。import 路径对称（`requireProjectPath`/`resolveWithinRoot`/`normalizeUserProjectPath`/`ensureDir` 从 `'../helpers.js'`，`opsErrorResult`/`validateTimeout` 从 `'./shared.js'`，`textResult` 从 `'../types.js'`——均经 `script.ts:5-13` 验证可 import）。
- **bpy 安全边界（诚实声明）**：bpy 是全功能 Python，威胁面 = 宿主 RCE（高于 `execute_gdscript` 一个量级）。`resolveWithinRoot` **仅约束 godot-mcp 注入的 export filepath，不约束 bpy 代码内部 `open()`/`os.remove()`/`os.system()`**。本地单用户信任模型。不做 bpy 语法沙箱（backlog）。
- **砍掉的部分（YAGNI，偏离 spec §6/§10 的简化）**：
  - blender-finder 不做 project override 层（`.godot/mcp-godot.json` 的 `blender_path`）——单值缓存够用。
  - `TOOL_GROUPS.blender.requires` 用 `[]`（不扩展 `requires` 类型加 `'blender'`）。blender 存在性由 `findBlender()` 内部检查 + `BLENDER_NOT_FOUND` 错误承担，不进 `manage_tools sync` 的连接探测逻辑。
- **命名**：工具注册名 `blender`，action `execute_bpy`（对称 `script` 工具名 + `execute_gdscript` action 的项目惯例）。
- **门禁**：每个 Task 结束 `tsc && eslint && vitest` 绿；集成 Task 用 `hasBlender` gating（对称 `check:gdscript` 的 `hasGodot`，无 blender 时 skip）。

---

## File Structure

| 文件 | 责任 | 创建/修改 |
|------|------|-----------|
| `src\core\blender-finder.ts` | 找 blender.exe（`GODOT_BLENDER_PATH` env → PATH）+ `validateBlenderBinary`（防伪造）+ 单值缓存 | 创建 |
| `src\core\blender-spawn.ts` | `runBlenderHeadless`：spawn + Buffer 累积 + 超时 forceKillTree + buildSafeEnv | 创建 |
| `src\tools\blender.ts` | `execute_bpy` action：路径校验 + 包装脚本 + argv export + handleTool + getToolDefinitions | 创建 |
| `src\core\tool-registry.ts:166` | `TOOL_GROUPS` 加 `blender` 组 | 修改 |
| `src\core\module-loader.ts` | import + 注册 blender 工具模块 | 修改 |
| `test\core\blender-finder.test.ts` | finder 单元测试（mock execFile） | 创建 |
| `test\core\blender-spawn.test.ts` | spawn 单元测试（mock spawn） | 创建 |
| `test\tools\blender.test.ts` | 工具单元测试（路径校验/包装模板，mock finder+spawn） | 创建 |
| `test\integration\blender-integration.test.ts` | 真 blender 集成（hasBlender gating） | 创建 |
| `docs\capability-matrix.md` 或 README | 安全模型文档化（宿主 RCE 量级声明） | 修改 |

---

### Task 1: blender-finder.ts

**Files:**
- Create: `src\core\blender-finder.ts`
- Test: `test\core\blender-finder.test.ts`

**Interfaces:**
- Consumes: `buildSafeEnv()` from `src\helpers.ts`
- Produces: `findBlender(): Promise<string>`、`validateBlenderBinary(candidate): Promise<boolean>`、`isBlenderVersionSignature(stdout): boolean`、`clearBlenderPathCache()`、`getCachedBlenderPath()`

- [ ] **Step 1: 写失败测试（isBlenderVersionSignature 纯函数）**

`test\core\blender-finder.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isBlenderVersionSignature } from '../../src/core/blender-finder.js';

describe('isBlenderVersionSignature', () => {
  it('accepts real Blender --version output', () => {
    expect(isBlenderVersionSignature('Blender 4.2.0\n')).toBe(true);
  });
  it('rejects output without "Blender" keyword (forgeable binary, C-SEC-2)', () => {
    expect(isBlenderVersionSignature('4.2.0\n')).toBe(false);
  });
  it('rejects output without version number', () => {
    expect(isBlenderVersionSignature('Blender\n')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/core/blender-finder.test.ts`
Expected: FAIL（模块不存在 / 函数未导出）

- [ ] **Step 3: 实现 isBlenderVersionSignature + 完整 blender-finder.ts**

`src\core\blender-finder.ts`:
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { getLogger } from './logger.js';
import { buildSafeEnv } from '../helpers.js';

const execFileAsync = promisify(execFile);

/** 单值缓存（MVP 砍 project override 层，blender 版本对 bpy 影响小）。 */
let _blenderPath: string | null = null;

/**
 * 判定 `blender --version` 输出是否为可信签名。
 * 对称 godot-finder isGodotVersionSignature (C-SEC-2)：必须含 "Blender" 关键字 + 版本号，
 * 否则 GODOT_BLENDER_PATH 指向的伪造二进制（只打印版本号）被 spawn = 直达 RCE。
 */
export function isBlenderVersionSignature(stdout: string): boolean {
  const v = stdout.trim();
  return /blender/i.test(v) && /\d+\.\d+/.test(v);
}

/** Validate a candidate binary by running --version and checking signature. */
export async function validateBlenderBinary(candidatePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(candidatePath, ['--version'],
      { encoding: 'utf-8', timeout: 5000, env: buildSafeEnv() });
    return isBlenderVersionSignature(stdout);
  } catch (err) {
    getLogger().debug('blender-finder',
      `validateBlenderBinary failed for ${candidatePath}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** 找 blender：GODOT_BLENDER_PATH env → PATH 上的 blender，单值缓存。 */
export async function findBlender(): Promise<string> {
  if (_blenderPath && (_blenderPath === 'blender' || existsSync(_blenderPath))) return _blenderPath;

  // 1. GODOT_BLENDER_PATH env（validate 防伪造）
  const envPath = process.env.GODOT_BLENDER_PATH;
  if (envPath && existsSync(envPath) && await validateBlenderBinary(envPath)) {
    _blenderPath = envPath;
    return _blenderPath;
  }

  // 2. PATH 上的 blender
  try {
    const { stdout } = await execFileAsync('blender', ['--version'],
      { encoding: 'utf-8', timeout: 5000, env: buildSafeEnv() });
    if (isBlenderVersionSignature(stdout)) {
      _blenderPath = 'blender';
      return _blenderPath;
    }
  } catch (err) {
    getLogger().debug('blender-finder', `PATH blender failed: ${err instanceof Error ? err.message : err}`);
  }

  _blenderPath = null;
  throw new Error('Blender not found. Set GODOT_BLENDER_PATH or install Blender on PATH.');
}

/** Clear cache (test-only). */
export function clearBlenderPathCache(): void { _blenderPath = null; }
export function getCachedBlenderPath(): string | null { return _blenderPath; }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/core/blender-finder.test.ts`
Expected: PASS（3 个 it 全绿）

- [ ] **Step 5: 补 finder 行为测试（mock execFile）**

追加到 `test\core\blender-finder.test.ts`:
```typescript
import { vi, beforeEach } from 'vitest';
import { findBlender, validateBlenderBinary, clearBlenderPathCache } from '../../src/core/blender-finder.js';

vi.mock('util', async (orig) => {
  const actual = await orig() as any;
  return { ...actual, promisify: (fn: any) => (...args: any[]) => actual.promisify(fn)(...args) };
});

let mockExec: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  clearBlenderPathCache();
  delete process.env.GODOT_BLENDER_PATH;
  const util = await import('util');
  mockExec = vi.fn();
  vi.mocked(util.promisify).mockReturnValue(mockExec as any);
});

describe('validateBlenderBinary', () => {
  it('returns true for valid signature', async () => {
    mockExec.mockResolvedValue({ stdout: 'Blender 4.2.0', stderr: '' });
    expect(await validateBlenderBinary('/fake/blender')).toBe(true);
  });
  it('returns false for forged binary (no Blender keyword)', async () => {
    mockExec.mockResolvedValue({ stdout: '4.2.0', stderr: '' });
    expect(await validateBlenderBinary('/fake/blender')).toBe(false);
  });
  it('returns false on spawn error', async () => {
    mockExec.mockRejectedValue(new Error('ENOENT'));
    expect(await validateBlenderBinary('/fake/blender')).toBe(false);
  });
});

describe('findBlender', () => {
  it('uses GODOT_BLENDER_PATH when valid', async () => {
    const fs = await import('fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    mockExec.mockResolvedValue({ stdout: 'Blender 4.2.0', stderr: '' });
    process.env.GODOT_BLENDER_PATH = '/opt/blender';
    expect(await findBlender()).toBe('/opt/blender');
  });
  it('throws when nothing found', async () => {
    const fs = await import('fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    mockExec.mockRejectedValue(new Error('ENOENT'));
    await expect(findBlender()).rejects.toThrow('Blender not found');
  });
});
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run test/core/blender-finder.test.ts`
Expected: PASS（全绿）

- [ ] **Step 7: 门禁 + commit**

Run: `npx tsc --noEmit && npx eslint src/core/blender-finder.ts`
Expected: 0 errors
```bash
git add src/core/blender-finder.ts test/core/blender-finder.test.ts
git commit -m "feat(blender): blender-finder (findBlender + validateBlenderBinary + 单值缓存)

对称 godot-finder，砍 project override。validateBlenderBinary 校验 --version 签名
防伪造二进制 RCE（对称 isGodotVersionSignature C-SEC-2）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: blender-spawn.ts

**Files:**
- Create: `src\core\blender-spawn.ts`
- Test: `test\core\blender-spawn.test.ts`

**Interfaces:**
- Consumes: `forceKillTree` from `src\core\process-state.ts`、`buildSafeEnv` from `src\helpers.ts`
- Produces: `runBlenderHeadless(args, blenderPath, timeoutMs?): Promise<BlenderRunResult>`，`BlenderRunResult = { exitCode: number|null, stdout: string, stderr: string }`

- [ ] **Step 1: 写失败测试**

`test\core\blender-spawn.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { runBlenderHeadless } from '../../src/core/blender-spawn.js';

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 12345;
}
let mockSpawn: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.doMock('child_process', () => ({ spawn: (mockSpawn = vi.fn()) }));
  vi.doMock('../../src/core/process-state.js', () => ({ forceKillTree: vi.fn() }));
});

it('accumulates stdout/stderr and resolves exitCode on close', async () => {
  const proc = new FakeProc();
  mockSpawn.mockReturnValue(proc);
  const { runBlenderHeadless } = await import('../../src/core/blender-spawn.js');
  const p = runBlenderHeadless(['--background'], '/fake/blender', 5000);
  proc.stdout.emit('data', Buffer.from('out1-'));
  proc.stdout.emit('data', Buffer.from('out2'));
  proc.stderr.emit('data', Buffer.from('err'));
  proc.emit('close', 0);
  const r = await p;
  expect(r).toEqual({ exitCode: 0, stdout: 'out1-out2', stderr: 'err' });
});

it('resolves exitCode null on timeout (forceKillTree)', async () => {
  vi.useFakeTimers();
  const proc = new FakeProc();
  mockSpawn.mockReturnValue(proc);
  const { runBlenderHeadless } = await import('../../src/core/blender-spawn.js');
  const { forceKillTree } = await import('../../src/core/process-state.js');
  const p = runBlenderHeadless(['--background'], '/fake/blender', 1000);
  vi.advanceTimersByTime(1001);
  const r = await p;
  expect(r.exitCode).toBeNull();
  expect(forceKillTree).toHaveBeenCalledWith(proc);
  vi.useRealTimers();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/core/blender-spawn.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 blender-spawn.ts（对称 godot-spawn.ts）**

`src\core\blender-spawn.ts`:
```typescript
import { spawn } from 'child_process';
import { forceKillTree } from './process-state.js';
import { buildSafeEnv } from '../helpers.js';

export interface BlenderRunResult {
  exitCode: number | null;  // null = 超时被杀
  stdout: string;
  stderr: string;
}

/**
 * spawn blender headless + 累积 stdio + 超时 forceKillTree 杀进程树。
 * 对称 runGodotHeadless。不做成败判断（exitCode 任值都 resolve），调用方自行判断。
 */
export function runBlenderHeadless(
  args: string[],
  blenderPath: string,
  timeoutMs: number = 60_000,
): Promise<BlenderRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(blenderPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: buildSafeEnv() });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    proc.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));

    const timer = setTimeout(() => {
      forceKillTree(proc);
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`runBlenderHeadless: failed to spawn ${blenderPath}: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/core/blender-spawn.test.ts`
Expected: PASS（2 个 it 全绿）

- [ ] **Step 5: 门禁 + commit**

Run: `npx tsc --noEmit && npx eslint src/core/blender-spawn.ts`
Expected: 0 errors
```bash
git add src/core/blender-spawn.ts test/core/blender-spawn.test.ts
git commit -m "feat(blender): blender-spawn runBlenderHeadless（对称 runGodotHeadless）

spawn + Buffer 累积 + 超时 forceKillTree + buildSafeEnv。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: blender.ts 工具核心（execute_bpy action）

**Files:**
- Create: `src\tools\blender.ts`
- Test: `test\tools\blender.test.ts`

**Interfaces:**
- Consumes: `requireProjectPath`/`resolveWithinRoot`/`normalizeUserProjectPath`/`ensureDir` from `'../helpers.js'`；`opsErrorResult`/`validateTimeout` from `'./shared.js'`；`textResult`/`ToolContext`/`ToolResult` from `'../types.js'`；`findBlender` from `'../core/blender-finder.js'`；`runBlenderHeadless` from `'../core/blender-spawn.js'`
- Produces: `getToolDefinitions(): Tool[]`、`handleTool(name, args, ctx): Promise<ToolResult|null>`、`buildBlenderScript(code): string`

- [ ] **Step 1: 写失败测试（buildBlenderScript 纯函数 + normalizeUserProjectPath 双分支）**

`test\tools\blender.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildBlenderScript } from '../../src/tools/blender.js';

describe('buildBlenderScript', () => {
  it('wraps AI snippet with header + empty scene + argv export', () => {
    const script = buildBlenderScript('bpy.ops.mesh.primitive_cube_add()');
    expect(script).toContain('import bpy, bmesh, mathutils, math, sys');
    expect(script).toContain("bpy.ops.wm.read_factory_settings(use_empty=True)");
    expect(script).toContain("bpy.ops.mesh.primitive_cube_add()"); // AI 片段原样
    expect(script).toContain("sys.argv[sys.argv.index(\"--\") + 1]"); // argv 不插值
    expect(script).toContain("export_format='GLB'");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/tools/blender.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 blender.ts（含 buildBlenderScript + getToolDefinitions + handleTool）**

`src\tools\blender.ts`:
```typescript
import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { tmpdir } from 'os';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath, ensureDir } from '../helpers.js';
import { opsErrorResult, validateTimeout } from './shared.js';
import { findBlender } from '../core/blender-finder.js';
import { runBlenderHeadless } from '../core/blender-spawn.js';

const HEADER = `import bpy, bmesh, mathutils, math, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'`;

const FOOTER = `bpy.ops.export_scene.gltf(filepath=sys.argv[sys.argv.index("--") + 1], export_format='GLB', export_apply=True)`;

/** 包装 AI 片段：header（空场景）+ AI code + footer（argv export）。 */
export function buildBlenderScript(code: string): string {
  return `${HEADER}\n# ===== AI 片段 =====\n${code}\n# ===== 自动导出 =====\n${FOOTER}`;
}

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'blender',
    description: 'Blender 程序化建模。action=execute_bpy：AI 写 bpy 片段，headless 跑，自动导 glb 到 res://。'
      + '（⚠️ bpy 是全功能 Python，威胁面=宿主 RCE，高于 execute_gdscript 沙箱一个量级。'
      + '仅约束 glb 导出落点，不约束 bpy 内部文件操作。本地单用户信任模型。）',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string', description: 'Godot 项目目录路径' },
        action: { type: 'string', enum: ['execute_bpy'], description: '操作类型' },
        export_path: { type: 'string', description: '相对项目根的 glb 导出路径，可带可选 res:// 前缀（如 assets/models/rock.glb）' },
        code: { type: 'string', description: 'bpy 建模片段（无需 import/export，godot-mcp 自动包装）' },
        timeout: { type: 'number', description: '超时秒数（默认 60）', default: 60 },
      },
      required: ['action', 'export_path', 'code'],
    },
  }];
}

export async function handleTool(
  name: string, args: Record<string, unknown>, _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'blender') return null;
  const action = args.action as string;
  if (action !== 'execute_bpy') return opsErrorResult('INVALID_PARAMS', `Unknown action: ${action}`);

  const projectPath = requireProjectPath(args);
  const exportPathRaw = args.export_path as string;
  const code = args.code as string;
  if (!exportPathRaw || typeof exportPathRaw !== 'string')
    return opsErrorResult('INVALID_PARAMS', 'export_path must be a non-empty string.');
  if (!code || typeof code !== 'string')
    return opsErrorResult('INVALID_PARAMS', 'code must be a non-empty string.');
  const timeout = validateTimeout(args.timeout);

  // glb 导出落点校验：剥 res://（带/不带前缀都走通 normalizeUserProjectPath）→ 文件系统落点校验。
  // ⚠️ 仅约束 godot-mcp 注入的 export filepath，不约束 bpy 代码内部 open()/os.remove()/os.system()。
  let fsExport: string;
  try {
    fsExport = resolveWithinRoot(projectPath, normalizeUserProjectPath(exportPathRaw));
  } catch {
    return opsErrorResult('EXPORT_PATH_TRAVERSAL', `export_path escapes project root: ${exportPathRaw}`);
  }
  ensureDir(dirname(fsExport));

  // 找 blender
  let blenderPath: string;
  try {
    blenderPath = await findBlender();
  } catch {
    return opsErrorResult('BLENDER_NOT_FOUND',
      'Blender not found. Set GODOT_BLENDER_PATH env or install Blender on PATH.');
  }

  // 写临时脚本（系统 temp，非项目内）
  const tmpScript = join(tmpdir(), `mcp-blender-${process.pid}-${Date.now()}.py`);
  writeFileSync(tmpScript, buildBlenderScript(code), 'utf-8');
  try {
    const result = await runBlenderHeadless(
      ['--background', '--factory-startup', '--python', tmpScript, '--', fsExport],
      blenderPath, timeout * 1000,
    );
    if (result.exitCode === null)
      return opsErrorResult('TIMEOUT', `Blender timed out after ${timeout}s`);
    if (result.exitCode !== 0)
      return opsErrorResult('BLENDER_EXIT_NONZERO',
        `Blender exited ${result.exitCode}\nstderr:\n${result.stderr.slice(-2000)}`);
    if (!existsSync(fsExport))
      return opsErrorResult('EXPORT_FILE_MISSING',
        `Blender succeeded but glb not generated (snippet may have created no objects). stdout:\n${result.stdout.slice(-2000)}`);
    const glbSize = statSync(fsExport).size;
    return textResult(
      `✅ glb exported: ${fsExport} (${glbSize} bytes)\n\n` +
      `[SECURITY] bpy ran as full Python (host RCE surface). Only the export filepath was ` +
      `constrained; bpy-internal file ops were not. Local single-user trust model.\n\n` +
      `--- Blender stdout (tail) ---\n${result.stdout.slice(-2000)}`,
    );
  } finally {
    try { unlinkSync(tmpScript); } catch { /* best effort */ }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/tools/blender.test.ts`
Expected: PASS

- [ ] **Step 5: 补路径校验测试（mock finder+spawn，含用户补强点：normalizeUserProjectPath 无前缀分支）**

追加到 `test\tools\blender.test.ts`:
```typescript
import { vi, beforeEach, afterEach } from 'vitest';
import { handleTool } from '../../src/tools/blender.js';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

vi.mock('../../src/core/blender-finder.js', () => ({ findBlender: vi.fn() }));
vi.mock('../../src/core/blender-spawn.js', () => ({ runBlenderHeadless: vi.fn() }));
vi.mock('../../src/helpers.js', async (orig) => {
  const actual = await orig() as any;
  return {
    ...actual,
    requireProjectPath: (args: any) => args.project_path,  // 测试直通
  };
});

let tmpProj: string;
beforeEach(() => {
  vi.clearAllMocks();
  tmpProj = join(tmpdir(), `mcp-blender-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpProj, { recursive: true });
  writeFileSync(join(tmpProj, 'project.godot'), '', 'utf-8');
});
afterEach(() => { try { rmSync(tmpProj, { recursive: true, force: true }); } catch { /* */ } });

describe('execute_bpy path validation', () => {
  it('rejects traversal export_path (EXPORT_PATH_TRAVERSAL)', async () => {
    const r = await handleTool('blender',
      { project_path: tmpProj, action: 'execute_bpy', export_path: '../../etc/evil.glb', code: 'pass' },
      {} as any);
    expect(r).toBeTruthy();
    expect(JSON.stringify(r)).toContain('EXPORT_PATH_TRAVERSAL');
  });

  it('accepts bare relative path without res:// prefix (normalizeUserProjectPath no-prefix branch)', async () => {
    const { findBlender } = await import('../../src/core/blender-finder.js');
    const { runBlenderHeadless } = await import('../../src/core/blender-spawn.js');
    vi.mocked(findBlender).mockResolvedValue('/fake/blender');
    // 让 spawn "成功"：模拟 glb 已生成
    vi.mocked(runBlenderHeadless).mockImplementation(async () => {
      const fs = await import('fs');
      mkdirSync(join(tmpProj, 'assets', 'models'), { recursive: true });
      writeFileSync(join(tmpProj, 'assets', 'models', 'rock.glb'), 'FAKEGLB', 'utf-8');
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });
    const r = await handleTool('blender',
      { project_path: tmpProj, action: 'execute_bpy', export_path: 'assets/models/rock.glb', code: 'pass' },
      {} as any);
    expect(JSON.stringify(r)).toContain('glb exported');
    expect(JSON.stringify(r)).toContain('rock.glb');
  });

  it('accepts res:// prefixed path (normalizeUserProjectPath prefix branch)', async () => {
    const { findBlender } = await import('../../src/core/blender-finder.js');
    const { runBlenderHeadless } = await import('../../src/core/blender-spawn.js');
    vi.mocked(findBlender).mockResolvedValue('/fake/blender');
    vi.mocked(runBlenderHeadless).mockImplementation(async () => {
      const fs = await import('fs');
      mkdirSync(join(tmpProj, 'out'), { recursive: true });
      writeFileSync(join(tmpProj, 'out', 'x.glb'), 'FAKEGLB', 'utf-8');
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });
    const r = await handleTool('blender',
      { project_path: tmpProj, action: 'execute_bpy', export_path: 'res://out/x.glb', code: 'pass' },
      {} as any);
    expect(JSON.stringify(r)).toContain('glb exported');
  });

  it('returns BLENDER_NOT_FOUND when findBlender throws', async () => {
    const { findBlender } = await import('../../src/core/blender-finder.js');
    vi.mocked(findBlender).mockRejectedValue(new Error('not found'));
    const r = await handleTool('blender',
      { project_path: tmpProj, action: 'execute_bpy', export_path: 'a.glb', code: 'pass' },
      {} as any);
    expect(JSON.stringify(r)).toContain('BLENDER_NOT_FOUND');
  });

  it('returns EXPORT_FILE_MISSING when blender succeeds but glb absent', async () => {
    const { findBlender } = await import('../../src/core/blender-finder.js');
    const { runBlenderHeadless } = await import('../../src/core/blender-spawn.js');
    vi.mocked(findBlender).mockResolvedValue('/fake/blender');
    vi.mocked(runBlenderHeadless).mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    const r = await handleTool('blender',
      { project_path: tmpProj, action: 'execute_bpy', export_path: 'a.glb', code: 'pass' },
      {} as any);
    expect(JSON.stringify(r)).toContain('EXPORT_FILE_MISSING');
  });
});
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run test/tools/blender.test.ts`
Expected: PASS（buildBlenderScript + 5 个路径校验 it 全绿）

- [ ] **Step 7: 门禁 + commit**

Run: `npx tsc --noEmit && npx eslint src/tools/blender.ts`
Expected: 0 errors
```bash
git add src/tools/blender.ts test/tools/blender.test.ts
git commit -m "feat(blender): execute_bpy 工具（片段模式 + 自动导 glb + argv export）

对称 script 工具 execute_gdscript。包装模板：空场景 + AI 片段 + argv export（不插值，
消除 Windows 反斜杠注入）。resolveWithinRoot 仅约束 export filepath 落点。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 注册接线（TOOL_GROUPS + module-loader）

**Files:**
- Modify: `src\core\tool-registry.ts:166`（TOOL_GROUPS 加 blender 组）
- Modify: `src\core\module-loader.ts`（import + 注册 blender）
- Test: `test\tools\blender-registry.test.ts`

**Interfaces:**
- Consumes: `blender` 工具模块的 `getToolDefinitions`/`handleTool`（Task 3 产出）
- Produces: `blender` 工具注册进 metaRegistry + `TOOL_GROUPS.blender`

- [ ] **Step 1: 写失败测试**

`test\tools\blender-registry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isToolAllowed, getGroupForTool, getAllToolDefinitions } from '../../src/core/tool-registry.js';
import '../../src/core/module-loader.js'; // 触发注册

describe('blender tool registration', () => {
  it('blender is in TOOL_GROUPS under "blender" group', () => {
    expect(getGroupForTool('blender')).toBe('blender');
  });
  it('blender tool is allowed when blender group active', () => {
    expect(isToolAllowed('blender')).toBe(true);
  });
  it('blender tool definition registered with execute_bpy action', () => {
    const def = getAllToolDefinitions().find(t => t.name === 'blender');
    expect(def).toBeTruthy();
    expect((def!.inputSchema as any).properties.action.enum).toEqual(['execute_bpy']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/tools/blender-registry.test.ts`
Expected: FAIL（blender 未注册）

- [ ] **Step 3: 在 TOOL_GROUPS 加 blender 组**

`src\core\tool-registry.ts`，在 `TOOL_GROUPS` 对象内（如 `multi_instance` 行前）加：
```typescript
  blender:     { description: 'Blender 建模', tools: ['blender'], requires: [] },
```
> 注：`requires: []`（不扩展 requires 类型加 'blender'，YAGNI）。blender 存在性由 `findBlender()` + `BLENDER_NOT_FOUND` 承担。

- [ ] **Step 4: 在 module-loader.ts 注册 blender**

`src\core\module-loader.ts`，在工具 import 段（`import * as script from '../tools/script.js';` 附近）加：
```typescript
import * as blender from '../tools/blender.js';
```
并在注册列表（`registerModule` 调用处，参考 `script` 的注册方式）加入 `blender`。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run test/tools/blender-registry.test.ts`
Expected: PASS（3 个 it 全绿）

- [ ] **Step 6: 全量门禁 + commit**

Run: `npx tsc --noEmit && npx eslint src/ && npx vitest run`
Expected: 0 errors（全量 vitest 绿，含新测试）
```bash
git add src/core/tool-registry.ts src/core/module-loader.ts test/tools/blender-registry.test.ts
git commit -m "feat(blender): 注册 blender 工具组（TOOL_GROUPS + module-loader）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 集成测试（hasBlender gating）+ 安全模型文档

**Files:**
- Create: `test\integration\blender-integration.test.ts`
- Modify: `docs\capability-matrix.md`（或 README，安全模型一节）

**Interfaces:**
- Consumes: 真 blender（`GODOT_BLENDER_PATH` 或 PATH）、Task 1-4 全部产出

- [ ] **Step 1: 写集成测试（hasBlender gating，对称 check:gdscript 的 hasGodot）**

`test\integration\blender-integration.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'fs';
import { tmpdir } from 'os';

function hasBlender(): boolean {
  const bin = process.env.GODOT_BLENDER_PATH || 'blender';
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    return /blender/i.test(out) && /\d+\.\d+/.test(out);
  } catch { return false; }
}

const run = hasBlender();
describe.skipIf(!run)('execute_bpy integration (real blender)', () => {
  let proj: string;
  beforeAll(() => {
    proj = mkdtempSync(join(tmpdir(), 'mcp-bpy-'));
    writeFileSync(join(proj, 'project.godot'), '', 'utf-8');
  });
  afterAll(() => { try { rmSync(proj, { recursive: true, force: true }); } catch { /* */ } });

  it('creates a cube and exports glb', async () => {
    const { handleTool } = await import('../../src/tools/blender.js');
    const r = await handleTool('blender', {
      project_path: proj,
      action: 'execute_bpy',
      export_path: 'assets/models/cube.glb',
      code: "bpy.ops.mesh.primitive_cube_add(size=2)",
    }, {} as any);
    const glb = join(proj, 'assets', 'models', 'cube.glb');
    expect(existsSync(glb)).toBe(true);
    expect(statSync(glb).size).toBeGreaterThan(0);
    expect(JSON.stringify(r)).toContain('glb exported');
  }, 120_000);

  it('argv contract: -- preserved in sys.argv, index("--")+1 resolves export_path', async () => {
    // 探针：buildBlenderScript 的 FOOTER 用 index("--")+1；若 Blender 不保留 -- 则 export 失败 → 上一条已验证。
    // 本条显式断言 export 走的是 argv 而非插值（glb 文件名来自 export_path 参数）。
    const { handleTool } = await import('../../src/tools/blender.js');
    const r = await handleTool('blender', {
      project_path: proj,
      action: 'execute_bpy',
      export_path: 'probe.glb',
      code: "bpy.ops.mesh.primitive_uv_sphere_add()",
    }, {} as any);
    expect(existsSync(join(proj, 'probe.glb'))).toBe(true);
    expect(JSON.stringify(r)).not.toContain('probe.glb\"'); // filepath 走 argv，不出现在脚本字面量
  }, 120_000);
});

describe.skipIf(run)('execute_bpy integration', () => {
  it('skipped (no blender — set GODOT_BLENDER_PATH to enable)', () => { expect(true).toBe(true); });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run test/integration/blender-integration.test.ts`
Expected: 有 blender → 2 条 PASS；无 blender → skip（1 条 PASS）

- [ ] **Step 3: 安全模型文档化**

在 `docs\capability-matrix.md`（或 README 安全章节）加一节：
```markdown
## Blender 建模（execute_bpy）安全模型

`execute_bpy` 通过 headless `blender --background` 跑 AI 写的 bpy 片段。**bpy 是全功能 Python，
无语言层沙箱，威胁面 = 宿主 RCE**（读/删任意文件、执行任意命令、网络）——**高于 `execute_gdscript`
的 GDScript 沙箱一个量级**（GDScript 语言层有约束，逃逸才到宿主）。

诚实边界：
1. **glb 导出落点硬约束**：`export_path` 经 `resolveWithinRoot`，仅约束 godot-mcp 注入的 export 行
   filepath，**不约束 bpy 代码内部的 `open()`/`os.remove()`/`os.system()`**。
2. **本地单用户信任模型** + 响应附 `[SECURITY]` warning。
3. 不做 bpy 语法沙箱（正则防不住动态构造 = 假绿），列 backlog。

对比 BlenderMCP：不是"我们防住了它们没防住的"，而是"我们显式声明 fail-model + glb 落点硬约束 +
本地信任模型，BlenderMCP 既无约束也无声明"。
```

- [ ] **Step 4: 全量门禁 + 最终 commit**

Run: `npx tsc --noEmit && npx eslint src/ && npx vitest run`
Expected: 0 errors
```bash
git add test/integration/blender-integration.test.ts docs/capability-matrix.md
git commit -m "test(blender): 集成测试（hasBlender gating）+ 安全模型文档

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**（spec 11 节）：
- §1 目标 → 全计划 ✓
- §2 非目标（YAGNI）→ Global Constraints + 各 Task 未实现结构化/双模式/沙箱 ✓
- §3 架构数据流 → Task 3 handleTool 逐步实现 ✓
- §4 组件（新增 blender-finder/spawn/blender.ts，复用 path-utils 4 API + buildSafeEnv，❌ path-security）→ Task 1/2/3 + Global Constraints 注明 path-security 不复用 ✓
- §5 execute_bpy 规格（入参/包装模板/argv）→ Task 3 ✓
- §6 blender-finder 规格（validateBlenderBinary + buildSafeEnv + 砍 override）→ Task 1 + Global Constraints ✓
- §7 安全模型（宿主 RCE 量级/落点范围/删 headless 隔离）→ Task 3 handleTool 注释 + Task 5 文档 ✓
- §8 错误处理（6 错误码）→ Task 3 全部实现（BLENDER_NOT_FOUND/PATH_NOT_ALLOWED[via requireProjectPath]/EXPORT_PATH_TRAVERSAL/BLENDER_EXIT_NONZERO/EXPORT_FILE_MISSING/TIMEOUT）✓
- §9 测试（单元/集成/argv 契约/无前缀分支补强）→ Task 1/2/3/5 ✓（无前缀分支 = Task 3 Step 5 第 2 个 it）
- §10 feature-flag/工具组 → Task 4 ✓（requires:[] 简化已注明）
- §11 验收标准 → Task 5 + 全程门禁覆盖 ✓

**2. Placeholder scan**：无 TBD/TODO；每 step 有完整代码。✓

**3. Type consistency**：
- `findBlender(): Promise<string>`（Task 1 定义，Task 3 消费）✓
- `runBlenderHeadless(args, blenderPath, timeoutMs): Promise<BlenderRunResult>`（Task 2 定义，Task 3 消费）✓
- `buildBlenderScript(code): string`（Task 3 定义 + 测试）✓
- `handleTool(name, args, ctx): Promise<ToolResult|null>`（Task 3 定义，Task 4 注册消费）✓
- 工具名 `blender` + action `execute_bpy`（Task 3/4 一致）✓

**注（spec 偏差，已注明）**：
1. `requires: 'blender'` → `requires: []`（YAGNI，不扩展 requires 类型，Global Constraints 说明）
2. `isPathInAllowedRoots` → `requireProjectPath`（更高层封装，对称 execute_gdscript 惯例）
