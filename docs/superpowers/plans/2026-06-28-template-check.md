# template-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** android tool 新增 `check_template` action(校验默认 Android 导出模板)+ 抽 `detectGodotVersion` 共享原语。

**Architecture:** detectGodotVersion(godot-finder.ts,execFileAsync+buildSafeEnv+isGodotVersionSignature,返回完整版本串)→ check_template 提取 major.minor(4.6.2.stable→4.6)→ OS config 路径 → `<config>/export_templates/<majorMinor>/` → existsSync android_debug/release.apk → 诊断。

**Tech Stack:** TypeScript, Node child_process/fs, vitest。

## Global Constraints

- Modify: `src/core/godot-finder.ts`(detectGodotVersion)、`src/tools/android.ts`(check_template action + inputSchema enum)、`test/godot-finder.test.js`、`test/android.test.ts`、`docs/capability-matrix.json/md`、`ROADMAP.md`
- **实现优化(vs spec §2 spawn)**:detectGodotVersion 用 `execFileAsync`(godot-finder 已 import,与 validateGodotBinary DRY)+ `buildSafeEnv`(新增 import) + `isGodotVersionSignature` 校验 + try/catch 区分非零退出 vs 签名无效(审查①)。安全意图(buildSafeEnv)保留;`--version` 1s 级不需 forceKillTree;test 复用 `mockExecFileSuccess`
- **目录名 major.minor(Gap 2 必修)**:`4.6.2.stable`→`4.6`(regex `/^(\d+\.\d+)/`),模板目录 `<config>/export_templates/4.6/`
- config 路径 best-effort:Win `%APPDATA%\Godot`/Linux `~/.local/share/godot`/Mac `~/Library/Application Support/Godot`;不读 XDG_DATA_HOME(已知限制)
- check_template read-only,GUARDED.android 不变(check_template 读不守)
- 错误码:`GODOT_NOT_FOUND`/`VERSION_DETECT_FAILED`/`TEMPLATE_MISSING`(android.ts ERROR_CODES 扩展)
- get_godot_version refactor 标 backlog(不本次)
- TDD;tsc + eslint 净;全量无回归;capability-matrix 同步
- spec:`docs/superpowers/specs/2026-06-28-template-check-design.md`

---

## Task 1: detectGodotVersion 原语

**Files:**
- Modify: `src/core/godot-finder.ts`(import buildSafeEnv + detectGodotVersion)、`test/godot-finder.test.js`

**Interfaces:**
- Produces: `detectGodotVersion(godotPath: string): Promise<string>`(返回完整版本串如 "4.6.2.stable";非零退出/超时/签名无效抛 Error)

- [ ] **Step 1: 写 detectGodotVersion 红测试**

在 `test/godot-finder.test.js` 末尾加(复用现有 mockExecFileSuccess helper):
```js
describe('detectGodotVersion', () => {
  it('返回 --version stdout(trim)', async () => {
    mockExecFileSuccess('4.6.2.stable\n');
    const { detectGodotVersion } = await import('../src/core/godot-finder.js');
    const v = await detectGodotVersion('/fake/godot');
    expect(v).toBe('4.6.2.stable');
  });

  it('非 Godot 签名 → throw(VERSION_DETECT_FAILED)', async () => {
    mockExecFileSuccess('not a godot binary\n');
    const { detectGodotVersion } = await import('../src/core/godot-finder.js');
    await expect(detectGodotVersion('/fake/godot')).rejects.toThrow(/Invalid Godot version signature/);
  });

  it('非零退出(execFile 抛)→ throw(区分签名无效)', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      callback(new Error('exit code 1'), '');
    });
    const { detectGodotVersion } = await import('../src/core/godot-finder.js');
    await expect(detectGodotVersion('/fake/godot')).rejects.toThrow(/godot --version failed/);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/godot-finder.test.js -t "detectGodotVersion"`
Expected: FAIL(`detectGodotVersion is not a function`)

- [ ] **Step 3: 加 import buildSafeEnv**

`src/core/godot-finder.ts:1` import 块加:
```ts
import { buildSafeEnv } from '../helpers.js';
```

- [ ] **Step 4: 实现 detectGodotVersion**

在 `src/core/godot-finder.ts` `validateGodotBinary`(:69)后加:
```ts
/**
 * 跑 `godot --version` 返回完整版本串(如 "4.6.2.stable")。
 * execFileAsync + buildSafeEnv(安全),isGodotVersionSignature 校验防伪造。
 * 非零退出/超时 → "godot --version failed";签名无效 → "Invalid Godot version signature"(区分)。
 * 消费方:check_template(提取 major.minor)、get_godot_version(optional refactor)。
 */
export async function detectGodotVersion(godotPath: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(godotPath, ['--version'], { encoding: 'utf-8', timeout: 10000, env: buildSafeEnv() }));
  } catch (err) {
    throw new Error(`godot --version failed: ${err instanceof Error ? err.message : err}`);
  }
  const v = stdout.trim();
  if (!isGodotVersionSignature(v)) throw new Error(`Invalid Godot version signature: ${v}`);
  return v;
}
```

- [ ] **Step 5: 运行验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/godot-finder.test.js -t "detectGodotVersion"`
Expected: PASS(3 测试)

- [ ] **Step 6: commit**

```bash
git add src/core/godot-finder.ts test/godot-finder.test.js
git commit -m "feat(godot-finder): detectGodotVersion 原语(execFileAsync+buildSafeEnv+isGodotVersionSignature)" -m "Task1/3。返回完整版本串;try/catch 区分非零退出 vs 签名无效(审查①)。check_template/get_godot_version 共享。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: check_template action

**Files:**
- Modify: `src/tools/android.ts`(import detectGodotVersion + check_template case + ERROR_CODES + inputSchema enum)、`test/android.test.ts`

**Interfaces:**
- Consumes: `detectGodotVersion`(Task 1)、`findGodot`(ctx)

- [ ] **Step 1: 写 check_template 红测试**

`test/android.test.ts` 顶部 mock 区加 godot-finder mock(在 spawn-helper mock 后):
```ts
const { mockDetectVersion } = vi.hoisted(() => ({
  mockDetectVersion: vi.fn(async () => '4.6.2.stable'),
}));
vi.mock('../src/core/godot-finder.js', () => ({
  detectGodotVersion: mockDetectVersion,
  // findGodot 由 ctx 提供,不 mock 模块级
}));
```
末尾加 describe:
```ts
describe('android check_template', () => {
  beforeEach(() => { vi.clearAllMocks(); mockExists.mockReturnValue(true); mockDetectVersion.mockResolvedValue('4.6.2.stable'); });

  it('模板齐全 → status=ok + major_minor=4.6', async () => {
    mockExists.mockReturnValue(true);  // android_debug.apk + android_release.apk 都在
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'check_template', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.status).toBe('ok');
    expect(parsed.major_minor).toBe('4.6');
    expect(parsed.godot_version).toBe('4.6.2.stable');
    expect(parsed.android_debug.exists).toBe(true);
    expect(parsed.android_release.exists).toBe(true);
  });

  it('模板缺失 → TEMPLATE_MISSING + suggestion', async () => {
    mockExists.mockReturnValue(false);
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'check_template', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('TEMPLATE_MISSING');
    expect(parsed.suggestion).toBeTruthy();
  });

  it('版本检测失败 → VERSION_DETECT_FAILED', async () => {
    mockDetectVersion.mockRejectedValue(new Error('godot --version failed: exit 1'));
    const ctx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('android', { action: 'check_template', project_path: '/fake/p' }, ctx as any);
    const parsed = JSON.parse(result!.content[0].text);
    expect(parsed.error_code).toBe('VERSION_DETECT_FAILED');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts -t "check_template"`
Expected: FAIL(action 返回 null)

- [ ] **Step 3: android.ts 加 import + ERROR_CODES**

import 区加:
```ts
import { detectGodotVersion } from '../core/godot-finder.js';
```
ERROR_CODES 加:
```ts
  GODOT_NOT_FOUND: 'GODOT_NOT_FOUND',
  VERSION_DETECT_FAILED: 'VERSION_DETECT_FAILED',
  TEMPLATE_MISSING: 'TEMPLATE_MISSING',
```

- [ ] **Step 4: 加 check_template case + 模板路径 helper**

在 `src/tools/android.ts` `validateApkPath` 后加 config 路径 helper:
```ts
/** Godot config 根路径(best-effort,不读 XDG/editor settings 覆盖)。 */
function godotConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'win32') return join(process.env.APPDATA ?? home, 'Godot');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Godot');
  return join(home, '.local', 'share', 'godot');  // Linux(best-effort,不读 XDG_DATA_HOME)
}
```
handleTool switch 加 case(get_preset_info 后):
```ts
    case 'check_template': {
      let godotPath: string;
      try { godotPath = await ctx.findGodot(); }
      catch { return opsErrorResult(ERROR_CODES.GODOT_NOT_FOUND, 'Godot binary not found.', { suggestion: 'Set GODOT_PATH or install Godot.' }); }
      let fullVersion: string;
      try {
        fullVersion = await detectGodotVersion(godotPath);
      } catch (err) {
        return opsErrorResult(ERROR_CODES.VERSION_DETECT_FAILED, (err as Error).message, {
          suggestion: 'godot --version failed. Check Godot binary is valid.',
        });
      }
      const majorMinor = fullVersion.match(/^(\d+\.\d+)/)?.[1] ?? fullVersion;  // 4.6.2.stable → 4.6
      const templateDir = join(godotConfigDir(), 'export_templates', majorMinor);
      const debugApk = join(templateDir, 'android_debug.apk');
      const releaseApk = join(templateDir, 'android_release.apk');
      const debugExists = existsSync(debugApk);
      const releaseExists = existsSync(releaseApk);
      const status = debugExists && releaseExists ? 'ok' : 'missing';
      const out: Record<string, unknown> = {
        godot_version: fullVersion, major_minor: majorMinor, template_dir: templateDir,
        android_debug: { path: debugApk, exists: debugExists },
        android_release: { path: releaseApk, exists: releaseExists },
        status,
      };
      if (status === 'missing') {
        return opsErrorResult(ERROR_CODES.TEMPLATE_MISSING, `Android export template missing for ${majorMinor}.`, {
          suggestion: `In Godot Editor: Editor > Manage Export Templates, download the ${majorMinor} templates. Expected at ${templateDir}.`,
        });
      }
      return textResult(JSON.stringify(out));
    }
```

> 注:opsErrorResult 第三参 opts 目前只支持 `{suggestion}`(shared/errors.ts)。若要附 out 诊断,改用 textResult + isError,或在 suggestion 里含路径。MVP 简化:TEMPLATE_MISSING 用 opsErrorResult(suggestion 含 template_dir),不附 out 结构(status=missing 时)。

- [ ] **Step 5: inputSchema action enum 加 check_template**

`getToolDefinitions` 的 action enum:
old: `enum: ['list_devices', 'get_preset_info', 'deploy']`
new: `enum: ['list_devices', 'get_preset_info', 'deploy', 'check_template']`

- [ ] **Step 6: 运行验证通过**

Run: `node.exe node_modules/vitest/vitest.mjs run test/android.test.ts`
Expected: PASS(原 9 + 3 check_template)

- [ ] **Step 7: commit**

```bash
git add src/tools/android.ts test/android.test.ts
git commit -m "feat(android): check_template action(默认模板校验)" -m "Task2/3。detectGodotVersion→major.minor(4.6.2.stable→4.6)→OS config 路径→existsSync android_debug/release.apk。read-only 不进 GUARDED。3 错误码。" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: capability-matrix 同步 + 验证 + ROADMAP

- [ ] **Step 1: tsc**

Run: `node.exe node_modules/typescript/bin/tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: eslint**

Run: `node.exe node_modules/eslint/bin/eslint.js src/core/godot-finder.ts src/tools/android.ts`
Expected: 无错误

- [ ] **Step 3: 全量 vitest**

Run: `node.exe node_modules/vitest/vitest.mjs run`
Expected: 全绿(若 capability matrix-integrity/defects-fixed 因 enum 变化失败 → Step 4 重生成)

- [ ] **Step 4: capability-matrix 同步(action enum 变)**

Run: `node.exe node_modules/typescript/bin/tsc && node.exe build/capability/build-matrix.js`
Expected: `[build-matrix] 29 tools → docs/capability-matrix.{json,md}`(tool 数不变,android action enum 含 check_template)

- [ ] **Step 5: ROADMAP #7 follow-up 标记**

`ROADMAP.md` 变更记录追加:
```
- 2026-06-28 — #7 follow-up:check_template action(默认 Android 导出模板校验,major.minor 目录名)+ detectGodotVersion 共享原语(DRY)。get_godot_version refactor 标 backlog
```

- [ ] **Step 6: commit**

```bash
git add docs/capability-matrix.json docs/capability-matrix.md ROADMAP.md
git commit -m "feat(template-check): Task3 收尾 — capability-matrix 同步 + ROADMAP follow-up 标记" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 核对（spec 覆盖）

| spec 要求 | 落点 task |
|---|---|
| §2 detectGodotVersion 原语(DRY,复用 isGodotVersionSignature) | Task 1 |
| §2 buildSafeEnv 安全 + 区分非零退出/签名无效(审查①) | Task 1(try/catch) |
| §3 major.minor 目录名(4.6.2.stable→4.6) | Task 2(match + templateDir) |
| §4 check_template action(read-only,OS config 路径,existsSync) | Task 2 |
| §4 GUARDED.android 不变 | Task 2(check_template 读不守,不动 guard.ts) |
| §5 三错误码 | Task 2(GODOT_NOT_FOUND/VERSION_DETECT_FAILED/TEMPLATE_MISSING) |
| §6 测试(mock detectGodotVersion + fs) | Task 1(godot-finder.test.js)+ Task 2(android.test.ts mock godot-finder) |
| §7 YAGNI(editor settings 覆盖/XDG/custom_template 不做)+ get_godot_version refactor backlog | 不实现 + Task 3 ROADMAP 标 backlog |
| §8 验收(detectGodotVersion/major.minor/action/错误码/测试/tsc/capability-matrix) | Task 1 + Task 2 + Task 3 |
