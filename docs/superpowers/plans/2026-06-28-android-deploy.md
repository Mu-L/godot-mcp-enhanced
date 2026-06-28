# Android Deploy 工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新 `src/tools/android.ts` 提供 3 action（list_devices / get_preset_info / deploy），TS child_process 实现 Android deploy 闭环。

**Architecture:** 合并 tool `android`，`execFileSync` 跑 adb（存在性校验，env `ANDROID_ADB`→PATH），`spawnGodot` 跑 godot 导出（`timeoutMs: 300_000`，复用 spawn-helper，禁裸 spawn）。安全：package/deviceSerial 白名单 + apk 路径校验（adb shell 协议层注入防护，独立于 GUARDED）。

**Tech Stack:** TypeScript, Node `child_process`, vitest。

## Global Constraints

- Create: `src/tools/android.ts` + `test/android.test.ts`; Modify: `src/core/module-loader.ts`（注册）+ `src/guard.ts`（GUARDED.android）
- adb: `execFileSync`（存在性校验 `env.ANDROID_ADB`→PATH `'adb'`，不需 `--version`）；godot 导出: **必须 `spawnGodot`**（spawn-helper.ts:19，内部 buildSafeEnv），`timeoutMs: 300_000`，禁裸 `spawn`
- 安全（独立于 GUARDED）：package `/^[a-zA-Z][a-zA-Z0-9_.]*$/` + deviceSerial `/^[a-zA-Z0-9_-]+$/` + apk 路径禁 shell 元字符(`;&|`$()`) + `..` 穿越
- INI 解析 `export_presets.cfg`：两级 section（`[preset.N]` + `[preset.N.options]`）+ 去引号 + key 含 `/`（`package/name` 整体）
- GUARDED.android：`deploy` 守（install 改设备），`list_devices`/`get_preset_info` 读不守
- 错误码：`ADB_NOT_FOUND`/`NO_DEVICES`/`NO_ANDROID_PRESET`/`EXPORT_FAILED`/`INSTALL_FAILED`/`LAUNCH_FAILED`
- TDD；MEMORY 约束：mock `child_process` Windows 验证（Linux 可能 mock 失效，同 game-bridge）
- spec：`docs/superpowers/specs/2026-06-28-android-deploy-design.md`

## File Structure

- `src/tools/android.ts` — 单文件，含 ERROR_CODES/常量/resolveAdb/runAdb/INI 解析/安全校验/handleTool/getToolDefinitions/TOOL_META
- `test/android.test.ts` — mock child_process + spawn-helper + fs
- `src/core/module-loader.ts` — import + ALL_MODULES 注册
- `src/guard.ts` — GUARDED.android

---

## Task 1: 骨架 + 注册 + list_devices

**Files:**
- Create: `src/tools/android.ts`、`test/android.test.ts`
- Modify: `src/core/module-loader.ts:52,64`

**Interfaces:**
- Produces: `handleTool`/`getToolDefinitions`/`TOOL_META`（module-loader 注册用）、`ERROR_CODES`、`resolveAdb`、`runAdb`
- Consumes: `execFileSync`（child_process）、`opsErrorResult`（shared）

- [ ] **Step 1: 写 list_devices 红测试**

Create `test/android.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExec, mockExists } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExists: vi.fn((p: string) => p === '/fake/cfg' || true),
}));

vi.mock('child_process', () => ({ execFileSync: mockExec }));
vi.mock('fs', () => ({
  existsSync: mockExists,
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(), copyFileSync: vi.fn(), unlinkSync: vi.fn(),
  chmodSync: vi.fn(), statSync: vi.fn(), lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
  renameSync: vi.fn(),
}));
vi.mock('../src/tools/spawn-helper.js', () => ({ spawnGodot: vi.fn() }));
vi.mock('../src/dashboard/launcher.js', () => ({ launchDashboardOnce: vi.fn() }));

import { handleTool } from '../src/tools/android.js';

describe('android list_devices', () => {
  beforeEach(() => { vi.clearAllMocks(); mockExists.mockReturnValue(true); });

  it('list_devices 解析 adb devices -l 输出', async () => {
    mockExec.mockReturnValue('List of devices attached\nR58M123 device usb:3-1 product:foo model:Pixel_5\nemulator-5554 device product:sdk\n');
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'list_devices', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.devices.length).toBe(2);
    expect(parsed.devices[0].serial).toBe('R58M123');
    expect(parsed.devices[0].state).toBe('device');
    expect(parsed.devices[1].model).toBe('sdk');
  });

  it('list_devices 无设备 → NO_DEVICES', async () => {
    mockExec.mockReturnValue('List of devices attached\n');
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'list_devices', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('NO_DEVICES');
  });

  it('adb 不存在(ENOENT) → ADB_NOT_FOUND', async () => {
    const err: any = new Error('adb not found');
    err.code = 'ENOENT';
    mockExec.mockImplementation(() => { throw err; });
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'list_devices', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('ADB_NOT_FOUND');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts`
Expected: FAIL（`Cannot find module '../src/tools/android.js'`）

- [ ] **Step 3: 创建 android.ts 骨架 + list_devices**

Create `src/tools/android.ts`:
```ts
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult, getErrorMessage } from '../types.js';
import { opsErrorResult } from './shared.js';
import { spawnGodot } from './spawn-helper.js';
import { requireProjectPath } from '../helpers.js';

const ERROR_CODES = {
  ADB_NOT_FOUND: 'ADB_NOT_FOUND',
  NO_DEVICES: 'NO_DEVICES',
  NO_ANDROID_PRESET: 'NO_ANDROID_PRESET',
  EXPORT_FAILED: 'EXPORT_FAILED',
  INSTALL_FAILED: 'INSTALL_FAILED',
  LAUNCH_FAILED: 'LAUNCH_FAILED',
} as const;

const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_.]*$/;
const SERIAL_RE = /^[a-zA-Z0-9_-]+$/;
const EXPORT_TIMEOUT_MS = 300_000;

/** adb 路径:env ANDROID_ADB(存在性校验) → PATH 'adb' fallback。adb 是系统工具,不需 --version 探测。 */
function resolveAdb(): string {
  const fromEnv = process.env.ANDROID_ADB;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return 'adb';
}

/** 跑 adb,捕获 exit/stdout。ENOENT(adb 不存在)抛特殊标记。 */
function runAdb(adb: string, args: string[]): { stdout: string; exitCode: number; notFound: boolean } {
  try {
    const stdout = execFileSync(adb, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, exitCode: 0, notFound: false };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { stdout: '', exitCode: -1, notFound: true };
    return { stdout: err.stdout ?? '', exitCode: err.status ?? -1, notFound: false };
  }
}

/** 解析 `adb devices -l` 输出为设备数组。 */
function parseDevices(stdout: string): Array<Record<string, string>> {
  const devices: Array<Record<string, string>> = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('* daemon')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const dev: Record<string, string> = { serial: parts[0], state: parts[1] };
    for (let i = 2; i < parts.length; i++) {
      const eq = parts[i].indexOf(':');
      if (eq > 0) dev[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
    }
    devices.push(dev);
  }
  return devices;
}

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | null> {
  if (name !== 'android') return null;
  const action = args.action as string;
  switch (action) {
    case 'list_devices': {
      const adb = resolveAdb();
      const r = runAdb(adb, ['devices', '-l']);
      if (r.notFound) {
        return opsErrorResult(ERROR_CODES.ADB_NOT_FOUND, 'adb not found. Install Android platform-tools or set ANDROID_ADB env.', {
          suggestion: 'Install Android platform-tools (Android Studio SDK Manager) or set ANDROID_ADB to the adb binary path.',
        });
      }
      const devices = parseDevices(r.stdout);
      if (devices.length === 0) {
        return opsErrorResult(ERROR_CODES.NO_DEVICES, 'No Android devices attached.', {
          suggestion: 'Connect a device with USB debugging enabled, or start an emulator.',
        });
      }
      return textResult(JSON.stringify({ devices, count: devices.length, adb_path: adb }));
    }
    default:
      return null;  // get_preset_info/deploy 后续 task 实现
  }
}

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'android',
    description: 'Android Deploy 工具。list_devices: adb 设备列表。get_preset_info: 读 export_presets.cfg Android preset。deploy: export APK + adb install + launch(可选)。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_devices', 'get_preset_info', 'deploy'] },
        project_path: { type: 'string', description: 'Godot 项目目录' },
        preset_name: { type: 'string', description: 'get_preset_info/deploy: preset 名' },
        preset_index: { type: 'number', description: 'deploy: preset 索引' },
        device_serial: { type: 'string', description: 'deploy: 设备 serial(adb -s)' },
        debug: { type: 'boolean', description: 'deploy: --export-debug(默认 true)' },
        launch: { type: 'boolean', description: 'deploy: 安装后启动(默认 true)' },
        skip_export: { type: 'boolean', description: 'deploy: 跳过导出(已有 APK)' },
      },
      required: ['action'],
    },
  }];
}

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean }> = {
  android: { readonly: false, long_running: true },
};
```

- [ ] **Step 4: 运行验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts`
Expected: PASS（3 个 list_devices 测试绿）

- [ ] **Step 5: 注册到 module-loader.ts**

`src/core/module-loader.ts:52`（loadSkill import 后）加:
```ts
import * as androidOps from '../tools/android.js';
```
`:64`（loadSkill 后）ALL_MODULES 末尾加 `androidOps`:
```ts
  loadSkill,
  androidOps,
];
```

- [ ] **Step 6: 验证注册(全量测试无回归 + tool 被发现)**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts test/core/tool-registry-groups.test.ts 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 7: commit**

```bash
git add src/tools/android.ts test/android.test.ts src/core/module-loader.ts
git commit -m "feat(android): 骨架 + list_devices + 注册(module-loader)" -m "Task1/4" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: INI 解析 + get_preset_info

**Files:**
- Modify: `src/tools/android.ts`（加 parsePresetsCfg + get_preset_info action）
- Test: `test/android.test.ts`

**Interfaces:**
- Produces: `parsePresetsCfg`（deploy 也用）

- [ ] **Step 1: 写 get_preset_info 红测试**

在 `test/android.test.ts` 末尾加 describe:
```ts
describe('android get_preset_info (INI 解析)', () => {
  const CFG = `[preset.0]
name="Windows Desktop"
platform="Windows Desktop"
[preset.1]
name="Android"
platform="Android"
runnable=true
export_path="res://export/android.apk"
[preset.1.options]
package/name="com.example.game"
custom_template/debug=""
`;
  it('按 platform=Android 找到 preset', async () => {
    vi.mocked(readFileSyncMock).mockReturnValue(CFG);  // 见 mock 注:readFileSync 在 Task1 mock 里是 vi.fn()
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'get_preset_info', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.name).toBe('Android');
    expect(parsed.platform).toBe('Android');
    expect(parsed.package_name).toBe('com.example.game');
    expect(parsed.export_path).toBe('res://export/android.apk');
  });

  it('preset_name 精确匹配 + 非 Android preset 报 NO_ANDROID_PRESET', async () => {
    vi.mocked(readFileSyncMock).mockReturnValue(CFG);
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'get_preset_info', project_path: '/fake/p', preset_name: 'Windows Desktop' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('NO_ANDROID_PRESET');
  });

  it('无 export_presets.cfg → NO_ANDROID_PRESET', async () => {
    mockExists.mockReturnValue(false);
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'get_preset_info', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('NO_ANDROID_PRESET');
  });
});
```

> 注：Task 1 的 fs mock 里 `readFileSync: vi.fn(() => '')`。在 android.test.ts 顶部 mock hoisted 区导出 `readFileSyncMock`，改 Task 1 mock 为 `readFileSync: readFileSyncMock`。

- [ ] **Step 2: 运行验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts -t "get_preset_info"`
Expected: FAIL（action 返回 null，content[0] undefined）

- [ ] **Step 3: 实现 parsePresetsCfg + get_preset_info**

在 `src/tools/android.ts` `parseDevices` 后加:
```ts
interface PresetInfo {
  index: number; name: string; platform: string;
  runnable: boolean; exportPath: string; packageName: string;
}

/** 解析 export_presets.cfg(Godot ConfigFile/INI)。两级 section:[preset.N] 主 + [preset.N.options] 子;值去引号。 */
function parsePresetsCfg(content: string): PresetInfo[] {
  const sectionData: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { current = sec[1]; sectionData[current] = sectionData[current] ?? {}; continue; }
    const eq = line.indexOf('=');
    if (eq < 0 || !current) continue;
    const key = line.slice(0, eq).trim();  // key 含 '/'(如 package/name)是整体 key,非 section 分隔
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
    sectionData[current][key] = value;
  }
  const presets: PresetInfo[] = [];
  for (const sec of Object.keys(sectionData)) {
    const m = sec.match(/^preset\.(\d+)$/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const main = sectionData[sec];
    const opts = sectionData[`preset.${idx}.options`] ?? {};
    presets.push({
      index: idx, name: main.name ?? '', platform: main.platform ?? '',
      runnable: main.runnable === 'true', exportPath: main.export_path ?? '',
      packageName: opts['package/name'] ?? '',
    });
  }
  return presets;
}

/** 找 Android preset:按 name/index/platform 优先级。 */
function findAndroidPreset(cfgPath: string, presetName?: string, presetIndex?: number): PresetInfo | null {
  if (!existsSync(cfgPath)) return null;
  const presets = parsePresetsCfg(readFileSync(cfgPath, 'utf-8'));
  for (const p of presets) {
    if (p.platform !== 'Android') continue;
    if (presetName) { if (p.name === presetName) return p; else continue; }
    if (presetIndex !== undefined && presetIndex >= 0) { if (p.index === presetIndex) return p; else continue; }
    return p;  // 无过滤:第一个 Android preset
  }
  return null;
}
```

在 handleTool switch 加 case（list_devices 后）:
```ts
    case 'get_preset_info': {
      const projectDir = requireProjectPath(args, ctx);
      const cfgPath = join(projectDir, 'export_presets.cfg');
      const preset = findAndroidPreset(cfgPath, args.preset_name as string | undefined, args.preset_index as number | undefined);
      if (!preset) {
        return opsErrorResult(ERROR_CODES.NO_ANDROID_PRESET, 'No Android export preset found.', {
          suggestion: "Configure an Android preset in Godot Project > Export, then retry.",
        });
      }
      return textResult(JSON.stringify({
        index: preset.index, name: preset.name, platform: preset.platform,
        runnable: preset.runnable, export_path: preset.exportPath, package_name: preset.packageName,
      }));
    }
```

- [ ] **Step 4: 运行验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts`
Expected: PASS（Task 1 + 3 个 get_preset_info 测试绿）

- [ ] **Step 5: commit**

```bash
git add src/tools/android.ts test/android.test.ts
git commit -m "feat(android): get_preset_info + INI 解析(两级 section/去引号/key含/)" -m "Task2/4" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: deploy + 安全校验 + GUARDED

**Files:**
- Modify: `src/tools/android.ts`（安全校验 + deploy action）、`src/guard.ts`（GUARDED.android）
- Test: `test/android.test.ts`

**Interfaces:**
- Consumes: `spawnGodot`（spawn-helper）、`findAndroidPreset`（Task 2）

- [ ] **Step 1: 写 deploy 红测试**

在 `test/android.test.ts` 末尾加:
```ts
describe('android deploy', () => {
  const CFG = `[preset.1]\nname="Android"\nplatform="Android"\nrunnable=true\nexport_path="res://build/android.apk"\n[preset.1.options]\npackage/name="com.example.game"\n`;
  // 注:android.test.ts 顶部(Task1 mock 区)加 `import { spawnGodot } from '../src/tools/spawn-helper.js';`(被 vi.mock 接管,供 vi.mocked 用)

  beforeEach(() => { vi.clearAllMocks(); mockExists.mockReturnValue(true); });

  it('package 含 shell 元字符(com.x;rm) → 拒绝 launch(LAUNCH_FAILED)', async () => {
    vi.mocked(readFileSyncMock).mockReturnValue(CFG.replace('com.example.game', 'com.x;rm -rf /tmp'));
    vi.mocked(spawnGodot).mockResolvedValue({ stdout: '', stderr: '', output: '', exitCode: 0, timedOut: false });
    mockExec.mockReturnValue('Success');  // install ok
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'deploy', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('LAUNCH_FAILED');
    expect(parsed.error).toContain('package');
  });

  it('deviceSerial 含元字符 → 拒绝(INSTALL_FAILED)', async () => {
    vi.mocked(readFileSyncMock).mockReturnValue(CFG);
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'deploy', project_path: '/fake/p', device_serial: 'a;rm' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('INSTALL_FAILED');
  });

  it('export 失败(exit≠0) → EXPORT_FAILED', async () => {
    vi.mocked(readFileSyncMock).mockReturnValue(CFG);
    vi.mocked(spawnGodot).mockResolvedValue({ stdout: '', stderr: 'template missing', output: '', exitCode: 1, timedOut: false });
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'deploy', project_path: '/fake/p', launch: false }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('EXPORT_FAILED');
    expect(spawnGodot).toHaveBeenCalledWith(expect.anything(), expect.any(Array), expect.objectContaining({ timeoutMs: 300_000 }));
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts -t "deploy"`
Expected: FAIL（deploy action 返回 null）

- [ ] **Step 3: 加安全校验函数**

在 `src/tools/android.ts` `findAndroidPreset` 后加:
```ts
const SHELL_META_RE = /[;&|`$()]/;
const validatePackage = (p: string): boolean => PACKAGE_RE.test(p);
const validateSerial = (s: string): boolean => SERIAL_RE.test(s);
const validateApkPath = (p: string): boolean => !SHELL_META_RE.test(p) && !p.includes('..');
```

- [ ] **Step 4: 实现 deploy action**

在 handleTool switch 加 case（get_preset_info 后）:
```ts
    case 'deploy': {
      const projectDir = requireProjectPath(args, ctx);
      const cfgPath = join(projectDir, 'export_presets.cfg');
      const preset = findAndroidPreset(cfgPath, args.preset_name as string | undefined, args.preset_index as number | undefined);
      if (!preset) {
        return opsErrorResult(ERROR_CODES.NO_ANDROID_PRESET, 'No Android export preset found.', {
          suggestion: 'Configure an Android preset in Godot Project > Export first.',
        });
      }
      // apk 路径:res:// → projectDir 拼接 + 安全校验
      const apkAbs = preset.exportPath.startsWith('res://')
        ? join(projectDir, preset.exportPath.slice('res://'.length))
        : preset.exportPath;
      if (!validateApkPath(apkAbs)) {
        return opsErrorResult(ERROR_CODES.EXPORT_FAILED, `Invalid apk path: ${apkAbs}`);
      }
      const deviceSerial = args.device_serial as string | undefined;
      if (deviceSerial && !validateSerial(deviceSerial)) {
        return opsErrorResult(ERROR_CODES.INSTALL_FAILED, `Invalid device_serial: ${deviceSerial}`);
      }
      const skipExport = args.skip_export === true;
      const launch = args.launch !== false;
      const serialArgs = deviceSerial ? ['-s', deviceSerial] : [];

      // Step 1: export(必须 spawnGodot:buildSafeEnv + timeoutMs 300s,Android 导出 2-5 分钟)
      if (!skipExport) {
        const godotPath = await ctx.findGodot();
        const r = await spawnGodot(godotPath, ['--headless', '--path', projectDir, '--export-debug', preset.name, apkAbs], { timeoutMs: EXPORT_TIMEOUT_MS });
        if (r.exitCode !== 0) {
          return opsErrorResult(ERROR_CODES.EXPORT_FAILED, r.stderr || r.stdout || `godot export exit ${r.exitCode}`, {
            suggestion: 'Export failed. Install the Android export template (Godot Editor > Manage Export Templates), or check stderr.',
          });
        }
      }
      if (!existsSync(apkAbs)) {
        return opsErrorResult(ERROR_CODES.EXPORT_FAILED, `APK not found at ${apkAbs} after export.`);
      }

      // Step 2: install
      const adb = resolveAdb();
      const ir = runAdb(adb, [...serialArgs, 'install', '-r', apkAbs]);
      if (ir.notFound) return opsErrorResult(ERROR_CODES.ADB_NOT_FOUND, 'adb not found.', { suggestion: 'Set ANDROID_ADB or install platform-tools.' });
      if (ir.exitCode !== 0) {
        return opsErrorResult(ERROR_CODES.INSTALL_FAILED, ir.stdout || `adb install exit ${ir.exitCode}`, {
          suggestion: 'Install failed. Check device storage, signature, or uninstall the old version first.',
        });
      }

      // Step 3: launch(可选)——package 白名单防 adb shell 协议层注入(adb 把 args join 传设备 sh -c)
      if (launch) {
        if (!validatePackage(preset.packageName)) {
          return opsErrorResult(ERROR_CODES.LAUNCH_FAILED, `Invalid package name: ${preset.packageName}`, {
            suggestion: 'package/name in preset must match /^[a-zA-Z][a-zA-Z0-9_.]*$/.',
          });
        }
        const lr = runAdb(adb, [...serialArgs, 'shell', 'monkey', '-p', preset.packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
        if (lr.exitCode !== 0) {
          return opsErrorResult(ERROR_CODES.LAUNCH_FAILED, lr.stdout || `adb shell exit ${lr.exitCode}`);
        }
      }

      return textResult(JSON.stringify({
        preset: preset.name, apk_path: apkAbs,
        device: deviceSerial ?? '(default)', package_name: preset.packageName,
      }));
    }
```

- [ ] **Step 5: 加 GUARDED.android**

`src/guard.ts` 的 `GUARDED` 对象（`runtime` 后）加:
```ts
  android: new Set(['deploy']),  // list_devices/get_preset_info 读不守;deploy install 改设备
```

- [ ] **Step 6: 运行验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts`
Expected: PASS（含 3 个 deploy 安全测试，spawnGodot 被调 timeoutMs 300_000）

- [ ] **Step 7: commit**

```bash
git add src/tools/android.ts src/guard.ts test/android.test.ts
git commit -m "feat(android): deploy 闭环 + 安全校验(package/deviceSerial/apk 白名单)" -m "spawnGodot timeoutMs 300_000(禁裸 spawn);adb shell 协议层注入防护独立于 GUARDED。Task3/4" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 验证 + ROADMAP 收尾

- [ ] **Step 1: tsc 类型检查**

Run: `node.exe node_modules/typescript/bin/tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: eslint**

Run: `node.exe node_modules/eslint/bin/eslint.js src/tools/android.ts src/core/module-loader.ts src/guard.ts`
Expected: 无错误

- [ ] **Step 3: 全量 vitest 回归**

Run: `node.exe node_modules/vitest/vitest.mjs run`
Expected: 全绿（含 android 9 个新测试 + 既有不回归）

- [ ] **Step 4: 更新 ROADMAP M4 #7 💤→✅**

`ROADMAP.md` M4 表格 `#7` 行:
old: `| 7 | Android Deploy / 导出模板校验 | 💤 | 社区痛点「能装不能跑」([QQ 频道 Godot 社区调研](https://github.com/wgt19861219/godot-mcp-enhanced)) |`
new: `| 7 | Android Deploy | ✅ | list_devices/get_preset_info/deploy;TS child_process+spawnGodot;spec: 2026-06-28-android-deploy-design.md |`

「路线图变更记录」追加:
```
- 2026-06-28 — M4 #7 完成:Android Deploy 工具(3 action + INI 解析 + 安全校验 package/deviceSerial 白名单 + spawnGodot timeoutMs 300s)
```

- [ ] **Step 5: commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): M4 #7 Android Deploy 完成(💤→✅)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 核对（spec 覆盖）

| spec 要求 | 落点 task |
|---|---|
| §2 架构（android.ts + 合并 tool + execFileSync adb + spawnGodot 导出） | Task 1（骨架/list_devices/注册）+ Task 3（deploy spawnGodot） |
| §2 adb 路径存在性校验（env→PATH，无 --version） | Task 1 resolveAdb |
| §3.1 package 白名单 + apk 路径校验 + deviceSerial 白名单 | Task 3（validatePackage/validateSerial/validateApkPath + deploy 内校验） |
| §3.1 adb shell 协议层注入说明 + GUARDED 不防注入独立叠加 | Task 3 deploy launch 注释 + GUARDED.android（deploy 守） |
| §3.2 spawnGodot buildSafeEnv（禁裸 spawn） | Task 3 deploy 用 spawnGodot |
| §4.1 deploy 三步 + timeoutMs 300_000 + res:// 转换 | Task 3 deploy |
| §4.2 复用 spawnGodot（DRY，不与 export_build 重复） | Task 3 |
| §5 INI 两级 section + 去引号 + key 含/ | Task 2 parsePresetsCfg |
| §6 错误码 6 类 + suggestion | Task 1（ADB_NOT_FOUND/NO_DEVICES）+ Task 2（NO_ANDROID_PRESET）+ Task 3（EXPORT/INSTALL/LAUNCH_FAILED） |
| §7 测试（mock child_process + 注入拒绝） | Task 1（list_devices）+ Task 2（INI）+ Task 3（package/serial 注入拒绝 + spawnGodot timeoutMs） |
| §8 YAGNI（无 logcat/template-check/release 签名） | 不实现（spec §8） |
| §9 验收（注册/GUARDED/安全/INI/DRY/测试/tsc/ROADMAP） | Task 1（注册）+ Task 3（GUARDED）+ Task 4（验证/ROADMAP） |
