# self-update 机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 enhanced 增加双组件自更新能力——启动时提示 npm 包新版 + AI 经 MCP 工具检查/更新各项目 addon（Godot AI 追赶子项目 3/3）。

**Architecture:** 5 组件——`src/core/update-checker.ts`（npm registry 查询+24h 缓存+容错）、`src/core/addon-version.ts`（plugin.cfg 版本读取+cp 覆盖安装）、`src/tools/self-update.ts`（单工具 self_update + action enum=[check,update]）、`src/index.ts` 启动挂载、tool-registry/module-loader 注册。单工具粒度是关键约束——避 `guard.ts:65` action==null 时 confirm 门旁路。

**Tech Stack:** TypeScript（Node16 module / ES2022）、Node >=18 全局 fetch、vitest、MCP SDK。零新依赖（deps 维持 sdk+ws）。

## Global Constraints

- **Node >=18.0.0**（package.json:70-72）——全局 fetch 可用，不加 node-fetch/axios
- **零新依赖**——版本比较手写 `compareVersion`（不加 semver）；deps 维持 `@modelcontextprotocol/sdk` + `ws`
- **单工具 self_update + action enum=[check,update]**——避 `guard.ts:65` `action==null → return false` confirm 门旁路；actionRisks 按 action 名 key（非 `'_'`）
- **TOOL_META.self_update.readonly 不可设 true**——否则 update action 在 readOnly 模式放行绕过保护；须 false/省略
- **actionRisks**: `check:'read'`（免确认）、`update:'write'`（cpSync 覆盖安装语义，非 destructive）
- **路径校验三层**（path-utils.ts）：`isPathInAllowedRoots`(:258) → `validateProjectRoot`(:46) → `safeRealPath`(:118)
- **不碰 path-security.ts**——`sanitizePath` 是 UNWIRED 预留原语（:4-7 注释），防护由 path-utils 承担
- **scripts/install-plugin.js 不动**——TS/JS 边界不共享代码，靠测试+注释保一致
- **ALLOWED_PROJECT_PATHS 进程级固化**——改白名单须重启 MCP 服务端；本地测试 `GODOT_MCP_UNRESTRICTED=true` 绕过
- **缓存**：`~/.godot-mcp/update-cache.json`（复用 instance-manager.ts:71-72 机器级目录惯例），24h TTL，fetch 5s 超时，失败静默
- **commit 风格**：中文 message + `Co-Authored-By: Claude <noreply@anthropic.com>`；master 不 push（用户惯例）

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/update-checker.ts` | 新建 | `compareVersion` + `checkForUpdateCached`（fetch+缓存+容错） |
| `src/core/addon-version.ts` | 新建 | `readAddonVersion` + `updateAddon`（三层路径校验+cp+verify） |
| `src/tools/self-update.ts` | 新建 | `self_update` 工具（getToolDefinitions+handleTool+TOOL_META） |
| `src/index.ts` | 改 :115-123 | 启动 `import().then().catch()` 挂 npm 检查 |
| `src/core/tool-registry.ts` | 改 TOOL_GROUPS | 加 `selfupdate` 组 |
| `src/core/module-loader.ts` | 改 :56/:74 | `import * as selfUpdate` + ALL_MODULES 加项 |
| `test/update-checker.test.ts` | 新建 | compareVersion+缓存+fetch 容错 |
| `test/addon-version.test.ts` | 新建 | readAddonVersion 三态+updateAddon |
| `test/self-update.test.ts` | 新建 | check/update action+TOOL_META+readOnly 锚点 |
| `test/risk-coverage.test.ts` | 改 :17 GUARDED_KEYS | 加 `'self_update'` |
| `CHANGELOG.md` | 改 [Unreleased] | Added 条目 |
| `test/regression/defects.ts` | 可选 | detect 防复发 |

---

## Task 1: update-checker.ts（npm 检查器）

**Files:**
- Create: `src/core/update-checker.ts`
- Test: `test/update-checker.test.ts`

**Interfaces:**
- Produces: `compareVersion(a:string,b:string): number`（-1/0/1）、`checkForUpdateCached(opts?:{force?:boolean; cacheDir?:string}): Promise<{current,latest,updateAvailable,fromCache}>`（`cacheDir` 测试注入，默认 `~/.godot-mcp/`）

- [ ] **Step 1: 写失败测试** `test/update-checker.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { compareVersion, checkForUpdateCached } from '../src/core/update-checker.js';

describe('compareVersion', () => {
  it.each([
    ['0.23.0', '0.24.0', -1],
    ['0.24.0', '0.23.0', 1],
    ['0.23.0', '0.23.0', 0],
    ['0.23', '0.23.0', 0],      // 补零
    ['0.23.0', '0.23', 0],
    ['1.2.3', '1.2.4', -1],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(compareVersion(a, b)).toBe(expected);
  });
});

describe('checkForUpdateCached', () => {
  let cacheDir: string;
  const realFetch = globalThis.fetch;
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'uc-')); });
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
  });

  it('查网成功返回 latest + 写缓存', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ version: '0.24.0' }),
    }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.24.0');
    expect(r.fromCache).toBe(false);
    expect(r.updateAvailable).toBe(compareVersion(r.latest, r.current) > 0);
    const cached = JSON.parse(readFileSync(join(cacheDir, 'update-cache.json'), 'utf-8'));
    expect(cached.latest).toBe('0.24.0');
    expect(typeof cached.lastCheck).toBe('number');
  });

  it('缓存命中不查网', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'),
      JSON.stringify({ lastCheck: Date.now(), latest: '0.24.0' }));
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '9.9.9' }) });
    vi.stubGlobal('fetch', spy);
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.24.0');
    expect(r.fromCache).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('缓存过期(>24h)重新查网', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'),
      JSON.stringify({ lastCheck: Date.now() - 25 * 3600 * 1000, latest: '0.24.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.25.0' }) }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.25.0');
    expect(r.fromCache).toBe(false);
  });

  it('force:true 绕缓存', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'),
      JSON.stringify({ lastCheck: Date.now(), latest: '0.24.0' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.25.0' }) }));
    const r = await checkForUpdateCached({ cacheDir, force: true });
    expect(r.latest).toBe('0.25.0');
    expect(r.fromCache).toBe(false);
  });

  it('网络失败静默返当前版本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.updateAvailable).toBe(false);
    expect(r.fromCache).toBe(false);
  });

  it('非 200 静默', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.updateAvailable).toBe(false);
  });

  it('缓存损坏当 miss', async () => {
    writeFileSync(join(cacheDir, 'update-cache.json'), 'not json{');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.24.0' }) }));
    const r = await checkForUpdateCached({ cacheDir });
    expect(r.latest).toBe('0.24.0');
    expect(r.fromCache).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/update-checker.test.ts`
Expected: FAIL（`Cannot find module '../src/core/update-checker.js'`）

- [ ] **Step 3: 写实现** `src/core/update-checker.ts`

```ts
// src/core/update-checker.ts
// npm registry 最新版查询 + 24h 缓存 + 网络容错。
// 启动被动提示（index.ts）与 check_update 工具共用同一函数。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// src/core/ → 上两级包根 → package.json
const pkgVersion: string = require('../../package.json').version;

const REGISTRY_URL = 'https://registry.npmjs.org/godot-mcp-enhanced/latest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** 手写 semver 比较（零依赖，假设纯数字 x.y.z，非数字段 fallback 0）。返回 -1/0/1。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0);
  const pb = b.split('.').map(n => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function getDefaultCacheDir(): string {
  return join(homedir(), '.godot-mcp');  // 复用 instance-manager.ts:72 机器级目录
}

function getCachePath(cacheDir?: string): string {
  return join(cacheDir ?? getDefaultCacheDir(), 'update-cache.json');
}

interface CacheData { lastCheck: number; latest: string; }

function readCache(cachePath: string): CacheData | null {
  try {
    if (!existsSync(cachePath)) return null;
    const obj = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (typeof obj.lastCheck === 'number' && typeof obj.latest === 'string') return obj;
    return null;
  } catch { return null; }  // 损坏当 miss
}

function writeCache(cachePath: string, data: CacheData): void {
  try {
    const dir = join(cachePath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = cachePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    renameSync(tmp, cachePath);  // 原子 rename
  } catch { /* 缓存写失败静默 */ }
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
  fromCache: boolean;
}

/** 查 npm 最新版。force:true 绕缓存（供 check action）；cacheDir 测试注入。失败绝不抛。 */
export async function checkForUpdateCached(opts?: { force?: boolean; cacheDir?: string }): Promise<UpdateCheckResult> {
  const cachePath = getCachePath(opts?.cacheDir);
  if (!opts?.force) {
    const cached = readCache(cachePath);
    if (cached && Date.now() - cached.lastCheck < CACHE_TTL_MS) {
      return {
        current: pkgVersion,
        latest: cached.latest,
        updateAvailable: compareVersion(cached.latest, pkgVersion) > 0,
        fromCache: true,
      };
    }
  }
  let latest: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const obj = (await res.json()) as { version?: string };
      if (typeof obj.version === 'string') latest = obj.version;
    }
  } catch { /* 网络/超时/解析失败静默 */ }
  if (latest == null) {
    return { current: pkgVersion, latest: pkgVersion, updateAvailable: false, fromCache: false };
  }
  writeCache(cachePath, { lastCheck: Date.now(), latest });
  return {
    current: pkgVersion,
    latest,
    updateAvailable: compareVersion(latest, pkgVersion) > 0,
    fromCache: false,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/update-checker.test.ts`
Expected: PASS（全部用例绿）

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`（预期 0 error）
```bash
git add src/core/update-checker.ts test/update-checker.test.ts
git commit -m "feat(self-update): update-checker npm 检查器（fetch+24h缓存+容错）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: addon-version.ts（addon 版本/更新 helper）

**Files:**
- Create: `src/core/addon-version.ts`
- Test: `test/addon-version.test.ts`

**Interfaces:**
- Consumes: `validateProjectRoot`/`isPathInAllowedRoots`/`safeRealPath` from `./path-utils.js`
- Produces: `readAddonVersion(projectPath): {version:string|null, installed:boolean}`、`updateAddon(projectPath): {dest:string, verifyOk:boolean}`

- [ ] **Step 1: 写失败测试** `test/addon-version.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readAddonVersion, updateAddon } from '../src/core/addon-version.js';
import { _resetPathAllowWarned } from '../src/core/path-utils.js';

let tmpProject: string;
let savedUnrestricted: string | undefined;

beforeEach(() => {
  savedUnrestricted = process.env.GODOT_MCP_UNRESTRICTED;
  process.env.GODOT_MCP_UNRESTRICTED = 'true';  // 测试绕白名单（memory: test-setup 全局 UNRESTRICTED）
  _resetPathAllowWarned();
  tmpProject = mkdtempSync(join(tmpdir(), 'av-'));
});
afterEach(() => {
  if (savedUnrestricted === undefined) delete process.env.GODOT_MCP_UNRESTRICTED;
  else process.env.GODOT_MCP_UNRESTRICTED = savedUnrestricted;
  _resetPathAllowWarned();
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('readAddonVersion', () => {
  it('已安装返回版本', () => {
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      'config_version=5\n[plugin]\nname="MCP Server"\nversion="0.22.0"\nscript="plugin.gd"');
    expect(readAddonVersion(tmpProject)).toEqual({ version: '0.22.0', installed: true });
  });

  it('未安装返回 installed:false', () => {
    expect(readAddonVersion(tmpProject)).toEqual({ version: null, installed: false });
  });

  it('malformed（有 cfg 无 version 行）返回 installed:true version:null', () => {
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'), '[plugin]\nname="X"');
    const r = readAddonVersion(tmpProject);
    expect(r.installed).toBe(true);
    expect(r.version).toBeNull();
  });
});

describe('updateAddon', () => {
  it('cp 包内 addon + verifyOk=true', () => {
    const { dest, verifyOk } = updateAddon(tmpProject);
    expect(verifyOk).toBe(true);
    const cfg = readFileSync(join(dest, 'plugin.cfg'), 'utf-8');
    expect(cfg).toContain('[plugin]');
    expect(cfg).toContain('script="plugin.gd"');
    expect(existsSync(join(dest, 'plugin.gd'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/addon-version.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** `src/core/addon-version.ts`

```ts
// src/core/addon-version.ts
// 复刻 scripts/version-sync.mjs:57（读版本正则）+ scripts/install-plugin.js:17-65（cp+verify）。
// 改进：MCP 场景加 deny-by-default 白名单门（CLI 是用户主动信任，MCP 是 AI 调用）。
import { readFileSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateProjectRoot, isPathInAllowedRoots, safeRealPath } from './path-utils.js';

const ADDON_REL = ['addons', 'godot_mcp_server'] as const;
// build/core/addon-version.js → 上两级包根 → addons/godot_mcp_server
// tsconfig outDir=build/rootDir=src；开发时同理指仓库根/addons
const addonSource = join(dirname(fileURLToPath(import.meta.url)), '..', '..', ...ADDON_REL);

/** 读目标项目 addon 版本。正则复刻 version-sync.mjs:57。 */
export function readAddonVersion(projectPath: string): { version: string | null; installed: boolean } {
  if (!isPathInAllowedRoots(projectPath)) {
    throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS（deny-by-default）');
  }
  const cfg = join(projectPath, ...ADDON_REL, 'plugin.cfg');
  if (!existsSync(cfg)) return { version: null, installed: false };
  const m = readFileSync(cfg, 'utf-8').match(/^version="([^"\r]*)"/m);
  return { version: m?.[1] ?? null, installed: true };
}

/** 包内 addon 源 cp 到目标项目。复刻 install-plugin.js:17-65 + 加门。 */
export function updateAddon(projectPath: string): { dest: string; verifyOk: boolean } {
  if (!isPathInAllowedRoots(projectPath)) {
    throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS（deny-by-default）');
  }
  const real = safeRealPath(validateProjectRoot(projectPath));  // project.godot 检查 + symlink 归一
  const dest = join(real, ...ADDON_REL);
  cpSync(addonSource, dest, { recursive: true });
  const content = readFileSync(join(dest, 'plugin.cfg'), 'utf-8');
  const verifyOk = content.includes('[plugin]') && content.includes('script="plugin.gd"');
  return { dest, verifyOk };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/addon-version.test.ts`
Expected: PASS

> ⚠️ 测试前需确保 tmpProject 含 `project.godot`（`validateProjectRoot` 检查）。若 updateAddon 测试因无 project.godot 失败，在 beforeEach 补 `writeFileSync(join(tmpProject,'project.godot'), '')`。

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/core/addon-version.ts test/addon-version.test.ts
git commit -m "feat(self-update): addon-version helper（读版本+cp覆盖安装，三层路径校验）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: self-update.ts（MCP 工具）

**Files:**
- Create: `src/tools/self-update.ts`
- Test: `test/self-update.test.ts`

**Interfaces:**
- Consumes: `checkForUpdateCached`/`compareVersion` from `../core/update-checker.js`、`readAddonVersion`/`updateAddon` from `../core/addon-version.js`、`getAllowedProjectPaths` from `../core/path-utils.js`、`opsSuccess`/`opsErrorResult` from `./shared.js`、`textResult` from `../types.js`
- Produces: `self_update` 工具（getToolDefinitions + handleTool + TOOL_META）

- [ ] **Step 1: 写失败测试** `test/self-update.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getToolDefinitions, handleTool, TOOL_META } from '../src/tools/self-update.js';
import { _resetPathAllowWarned } from '../src/core/path-utils.js';

const anyCtx = {} as any;
let tmpProject: string;
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.GODOT_MCP_UNRESTRICTED = 'true';
  _resetPathAllowWarned();
  tmpProject = mkdtempSync(join(tmpdir(), 'su-'));
  writeFileSync(join(tmpProject, 'project.godot'), '');  // validateProjectRoot 需要
});
afterEach(() => {
  delete process.env.GODOT_MCP_UNRESTRICTED;
  _resetPathAllowWarned();
  rmSync(tmpProject, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('getToolDefinitions', () => {
  it('工具名 self_update + action enum', () => {
    const def = getToolDefinitions()[0];
    expect(def.name).toBe('self_update');
    expect((def.inputSchema as any).properties.action.enum).toEqual(['check', 'update']);
    expect((def.inputSchema as any).required).toEqual(['action']);
  });
});

describe('TOOL_META', () => {
  it('check=read / update=write', () => {
    expect(TOOL_META.self_update.actionRisks.check).toBe('read');
    expect(TOOL_META.self_update.actionRisks.update).toBe('write');
  });
});

function parse(r: any) { return JSON.parse(r.content[0].text); }

describe('handleTool check', () => {
  it('返回 npm + addons 结构，project_path 指定只查该个', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.24.0' }) }));
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      '[plugin]\nversion="0.22.0"\nscript="plugin.gd"');
    const r = await handleTool('self_update', { action: 'check', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(true);
    expect(parsed.data.npm.latest).toBe('0.24.0');
    expect(parsed.data.addons[0]).toMatchObject({
      project_path: tmpProject, installed_version: '0.22.0', installed: true, matches: false,
    });
  });

  it('未安装 addon → installed:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '0.24.0' }) }));
    const r = await handleTool('self_update', { action: 'check', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.data.addons[0].installed).toBe(false);
    expect(parsed.data.addons[0].installed_version).toBeNull();
  });
});

describe('handleTool update', () => {
  it('降级拒绝（installed > 包版本）', async () => {
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      '[plugin]\nversion="9.9.9"\nscript="plugin.gd"');
    const r = await handleTool('self_update', { action: 'update', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('DOWNGRADE_REFUSED');
  });

  it('null 分支（未安装）直 cp', async () => {
    const r = await handleTool('self_update', { action: 'update', project_path: tmpProject }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(true);
    expect(parsed.data.updated_from).toBeNull();
    expect(parsed.data.verifyOk).toBe(true);
  });

  it('缺 project_path 报 INVALID_PARAMS', async () => {
    const r = await handleTool('self_update', { action: 'update' }, anyCtx);
    const parsed = parse(r);
    expect(parsed.success).toBe(false);
    expect(parsed.error_code).toBe('INVALID_PARAMS');
  });

  it('未知 action 报 UNKNOWN_ACTION', async () => {
    const r = await handleTool('self_update', { action: 'bogus' }, anyCtx);
    const parsed = parse(r);
    expect(parsed.error_code).toBe('UNKNOWN_ACTION');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/self-update.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** `src/tools/self-update.ts`

```ts
// src/tools/self-update.ts
// 单工具 self_update + action enum=[check,update]。
// ⚠️ 粒度选择：不能用两个独立无-action工具——guard.ts:65 action==null → return false
//    会导致 update 的 confirm 门静默失效。action enum 让 args.action='update' 命中确认门。
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { opsSuccess, opsErrorResult } from './shared.js';
import { checkForUpdateCached, compareVersion } from '../core/update-checker.js';
import { readAddonVersion, updateAddon } from '../core/addon-version.js';
import { getAllowedProjectPaths } from '../core/path-utils.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkgVersion: string = require('../package.json').version;  // src/tools/ → 上一级包根

const ACTIONS = ['check', 'update'] as const;

// readonly 不可设 true（否则 update 在 readOnly 模式放行绕过保护）。
// 见 spec §5：ReadOnlyGuard 工具级判定，readonly=false → readOnly 拒整工具（check 也拒）。
export const TOOL_META = {
  self_update: {
    readonly: false,
    long_running: false,
    actionRisks: {
      check: 'read' as const,
      update: 'write' as const,
    },
  },
};

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'self_update',
    description: '检查/更新 enhanced 自身。check：查 npm 最新版 + 各项目 addon 版本漂移（只读）。update：更新指定项目 addon 到包版本（覆盖安装，需确认）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'update'],
          description: 'check=查版本状态（只读）/ update=更新项目 addon（破坏性，需确认）',
        },
        project_path: {
          type: 'string',
          description: '目标 Godot 项目路径（update 必填；check 可选，缺省扫 ALLOWED_PROJECT_PATHS 全部）',
        },
      },
      required: ['action'],
    },
  }];
}

export async function handleTool(
  name: string, args: Record<string, unknown>, _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'self_update') return null;
  const action = args.action as string;
  if (!(ACTIONS as readonly string[]).includes(action as 'check' | 'update')) {
    return opsErrorResult('UNKNOWN_ACTION', `Unknown action: ${action}`);
  }
  return action === 'check' ? handleCheck(args) : handleUpdate(args);
}

async function handleCheck(args: Record<string, unknown>): Promise<ToolResult> {
  const npm = await checkForUpdateCached({ force: true });
  const targetPaths = args.project_path
    ? [String(args.project_path)]
    : getAllowedProjectPaths();
  const addons = targetPaths.map(p => {
    try {
      const { version, installed } = readAddonVersion(p);
      return {
        project_path: p,
        installed_version: version,
        expected_version: installed ? pkgVersion : null,
        matches: installed ? version === pkgVersion : false,
        installed,
      };
    } catch (e) {
      return { project_path: p, installed: false, installed_version: null,
        expected_version: null, matches: false,
        error: e instanceof Error ? e.message : String(e) };
    }
  });
  return textResult(JSON.stringify(opsSuccess({ npm, addons })));
}

async function handleUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const projectPath = args.project_path;
  if (typeof projectPath !== 'string' || !projectPath) {
    return opsErrorResult('INVALID_PARAMS', 'update action 需要 project_path 参数');
  }
  // 降级保护：null（未安装/malformed）直 cp 修复；非 null 且 >包版本 才拒绝
  const { version: installed, installed: isInstalled } = readAddonVersion(projectPath);
  if (isInstalled && installed != null && compareVersion(installed, pkgVersion) > 0) {
    return opsErrorResult('DOWNGRADE_REFUSED',
      `项目 addon 版本 ${installed} 比包版本 ${pkgVersion} 新，疑似降级，拒绝`);
  }
  try {
    const { dest, verifyOk } = updateAddon(projectPath);
    if (!verifyOk) {
      return opsErrorResult('VERIFY_FAILED', `addon 更新后 plugin.cfg 校验失败：${dest}`);
    }
    return textResult(JSON.stringify(opsSuccess({
      project_path: projectPath,
      updated_from: installed,
      updated_to: pkgVersion,
      verifyOk,
      dest,
    })));
  } catch (e) {
    return opsErrorResult('UPDATE_FAILED', e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/self-update.test.ts`
Expected: PASS

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/tools/self-update.ts test/self-update.test.ts
git commit -m "feat(self-update): self_update 工具（check+update action，单工具避 confirm 门旁路）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 工具注册 + risk-coverage 测试门

**Files:**
- Modify: `src/core/tool-registry.ts`（TOOL_GROUPS 加 selfupdate 组）
- Modify: `src/core/module-loader.ts`（import + ALL_MODULES）
- Modify: `test/risk-coverage.test.ts`（GUARDED_KEYS 加 self_update）
- Test: `test/self-update.test.ts`（补 isReadOnly 锚点）

**Interfaces:**
- Consumes: Task 3 的 self-update 模块导出

- [ ] **Step 1: tool-registry.ts 加组**（找到 `android: {...}` 行后，在 `dynamic:` 前加）

```ts
  selfupdate: { description: '自更新', tools: ['self_update'], requires: [] },
```

> 定位：`src/core/tool-registry.ts:193`（android 行）后插入。ToolGroupDef 结构 `{description, tools, requires, protected?}`（:159-162）。

- [ ] **Step 2: module-loader.ts 登记**（两步，对齐 :56 import 区 + :74 ALL_MODULES 区）

在 import 区（`import * as getContext from '../tools/get-context.js';` 附近）加：
```ts
import * as selfUpdate from '../tools/self-update.js';
```
在 `const ALL_MODULES: ToolModule[] = [` 数组内（`getContext,` 后）加：
```ts
  selfUpdate,
```

- [ ] **Step 3: risk-coverage.test.ts 加 GUARDED_KEYS**（:17-22 Set）

```ts
const GUARDED_KEYS = new Set([
  'scene', 'script', 'animation', 'animation_track', 'tilemap', 'game', 'material', 'particles',
  'signal', 'nav', 'audio', 'ui', 'physics', 'runtime', 'android', 'workflow',
  'validation', 'manage_tools', 'project', 'cpp', 'csv_to_resources', 'asset',
  'blender',
  'self_update',  // 新增（update action 非 read）
]);
```

- [ ] **Step 4: 补 isReadOnly 锚点测试**（追加到 `test/self-update.test.ts`）

```ts
import { isReadOnly } from '../src/core/tool-registry.js';
import { registerAllModules } from '../src/core/module-loader.js';
registerAllModules();

describe('self_update 注册 + readOnly 锚点', () => {
  it('isReadOnly(self_update)===false（未误标 readonly:true）', () => {
    expect(isReadOnly('self_update')).toBe(false);
  });
});
```

- [ ] **Step 5: 跑测试验证**

Run: `npx vitest run test/risk-coverage.test.ts test/self-update.test.ts`
Expected: PASS（risk-coverage 不再因 self_update 失败；isReadOnly 锚点绿）

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/core/tool-registry.ts src/core/module-loader.ts test/risk-coverage.test.ts test/self-update.test.ts
git commit -m "feat(self-update): 注册 self_update 工具组 + GUARDED_KEYS（避游离+确认门不变量）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 启动挂载 + 文档

**Files:**
- Modify: `src/index.ts`（:115-123 Dashboard launcher 区段后加 npm 检查挂载）
- Modify: `CHANGELOG.md`（[Unreleased] 加 Added）
- Optional: `test/regression/defects.ts`

- [ ] **Step 1: index.ts 加启动挂载**（在 :115-123 Dashboard `import('./dashboard/launcher.js')...` 块后加，对齐其异步非阻塞模式）

```ts
  // self-update: 异步查 npm 最新版，有更新 stderr 提示（失败静默，不阻塞 stdio 握手）
  import('./core/update-checker.js')
    .then(({ checkForUpdateCached }) => checkForUpdateCached())
    .then(r => {
      if (r.updateAvailable) {
        getLogger().warn('godot-mcp',
          `Update available: ${r.current} → ${r.latest}. Run: npm i -g godot-mcp-enhanced`);
      }
    })
    .catch(() => { /* 网络失败静默 */ });
```

> 定位：`src/index.ts:115-123`（`// Auto-launch Dashboard TUI` 块之后，函数闭括 `}` 之前）。

- [ ] **Step 2: CHANGELOG.md 加 Added 条目**（[Unreleased] 段顶部，`### Added` 下，若无 Added 段则新建）

```markdown
### Added — Self-update（Godot AI 追赶 3/3）

- 新增 `self_update` 工具（action=check/update）：check 查 npm 最新版 + 各项目 addon 版本漂移（只读，免确认）；update 覆盖安装包内 addon 到指定项目（需确认，三层路径校验 + 降级保护）
- MCP 服务端启动异步查 npm registry，有新版 stderr 提示（24h 缓存，失败静默）
- 单工具 + action enum 设计避 `guard.ts:65` confirm 门旁路；readOnly 模式拒整工具
```

- [ ] **Step 3: 全套门禁验证**

Run:
```bash
npx tsc --noEmit
npx eslint src/
npx vitest run test/update-checker.test.ts test/addon-version.test.ts test/self-update.test.ts test/risk-coverage.test.ts
```
Expected: tsc 0 error / eslint 0 error / vitest 全绿

- [ ] **Step 4: 全量回归（确认无副作用）**

Run: `npx vitest run`
Expected: 全量绿（除已知 4 个 pre-existing T11 elicitation 失败，baseline 一致）

- [ ] **Step 5: commit**

```bash
git add src/index.ts CHANGELOG.md
git commit -m "feat(self-update): 启动 npm 检查挂载 + CHANGELOG

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage**：
- §1 目标（npm 提示 + addon 检查/更新）→ Task 1（npm）+ Task 2/3（addon）✓
- §3 5 组件 → Task 1-5 全覆盖 ✓
- §4.1 update-checker → Task 1 ✓
- §4.2 addon-version → Task 2 ✓
- §4.3 self_update 工具（含 null 降级三分支）→ Task 3 handleUpdate ✓
- §4.4 index 挂载 → Task 5 ✓
- §4.5 注册 → Task 4 ✓
- §5 两道门（(a) guard.ts 运行时声明式 + (b) risk-coverage GUARDED_KEYS）→ Task 3（TOOL_META actionRisks）+ Task 4（GUARDED_KEYS）✓
- §5 readOnly 工具级 → Task 4 isReadOnly 锚点 ✓
- §6 测试策略 → Task 1-4 测试全覆盖 ✓

**2. Placeholder scan**：无 TBD/TODO/"add error handling"，每步含实际代码 ✓

**3. Type consistency**：
- `compareVersion(a,b):number` Task 1 定义，Task 3 import 使用 ✓
- `checkForUpdateCached(opts?):Promise<UpdateCheckResult>` Task 1 定义，Task 3/5 使用 ✓
- `readAddonVersion`/`updateAddon` Task 2 定义，Task 3 使用 ✓
- `TOOL_META.self_update.actionRisks.{check,update}` Task 3 定义，Task 4 测试断言 ✓
- `opsSuccess`/`opsErrorResult` from `./shared.js`（范本 project.ts:9 确认）✓

**4. spec 行号准确性**：plan 引用的所有行号（guard.ts:65、path-utils.ts:258/46/118/234、tool-registry.ts:159-162、module-loader.ts:56/74、index.ts:115-123、instance-manager.ts:72、get-context.ts:257、risk-coverage.test.ts:17）均 brainstorming 阶段 grep/read 实测 ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-self-update-mechanism.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每 task 派新子代理实现 + 两阶段审查，快速迭代
**2. Inline Execution** — 本会话内批量执行 + checkpoint 审查

Which approach?
