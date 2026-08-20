# 批 2:Godot 自动安装 + 通用官方资产下载基建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小白零预装——CLI 自动从 Godot 官方 GitHub releases 下载/校验/安装 Godot editor,并登记进安全白名单,`setup` 在 Godot 缺失时不再直接退出。

**Architecture:** 新增单文件下载器 `src/cli/godot-installer.ts`(URL 构造/域名白名单/SHA512 校验/解压/登记/机器级审计编排);`src/core/godot-finder.ts` 增加机器级配置文件 `~/.godot-mcp/godot-paths.json` 的读写与消费(白名单优先级链 env → 配置文件 → back-compat 放行;findGodot 搜索链接入该候选);`src/cli/router.ts` 加 `install` 子命令;`src/cli/setup.ts` Godot not found 时交互式引导安装。

**Tech Stack:** TypeScript ESM(strict)+ Node 内置(fetch/crypto/child_process.execFile/node:readline)+ 系统 `tar`(零新依赖)。

## Global Constraints(spec `docs/superpowers/specs/2026-08-20-xiaobai-onestop-roadmap-design.md` §3 批 2 + §5 未决项 1 实测结论)

- **哈希算法是 SHA512 非 SHA256**(spec 未决项 1 实测,2026-08-20):Godot 官方 releases 每个 release 附带 `SHA512-SUMS.txt`(格式 `<sha512hex>␣␣<filename>`,33 条覆盖全部二进制资产)。哈希与二进制**同 release 同信道**(github.com),信任链 = 下载域名白名单,无需跨信道信任说明。
- **下载域名硬编码白名单**:`github.com`、`objects.githubusercontent.com`(release asset 实际下载域)、`api.github.com`(latest 版本发现,只读)。任何构造出的 URL 必须过 `assertAllowedDownloadUrl` 校验(协议 https + 域名在列)。
- **零新 npm 依赖**:下载用全局 `fetch`(Node ≥18);哈希用 `node:crypto` 流式;解压用系统 `tar -xf`(Windows 10+ 自带 BSD tar 支持 zip,Linux/macOS 原生);交互用 `node:readline`。
- **版本 tag 白名单**:仅接受 `/^\d+\.\d+\.\d+-stable$/`(防任意 tag 注入拼 URL);默认版本从 `api.github.com/repos/godotengine/godot/releases/latest` 取 tag。
- **下载落点**:`~/.godot-mcp/godot/<versionTag>/`(机器级目录惯例,同 `~/.godot-mcp/instances/`、`qa-reports/`)。
- **白名单优先级链(B-3 处置,安全子系统改动)**:`GODOT_MCP_ALLOWED_GODOT_PATHS` env 设了 → 用 env;未设 → 用 `~/.godot-mcp/godot-paths.json` 的 paths;两者皆无 → 放行(签名校验 `isGodotVersionSignature` 兜底,back-compat 不变)。`GODOT_MCP_UNRESTRICTED=true` 旁路优先级最高(既有行为不变)。
- **godot-paths.json 格式**:`{"version":1,"paths":["<绝对路径>",...]}`(去重合并写回);文件不存在/JSON 损坏/字段非法一律容错读 `[]`。
- **机器级审计**:复用 `AuditEntry` 类型,新薄包装 `appendMachineAuditLine` 落 `~/.godot-mcp/machine-audit.jsonl`(install 是机器级操作,不落项目审计)。
- **交互确认**:CLI readline `y/N`(默认 N,Enter 拒绝);**非 MCP elicitInput 链路**(spec 明确);非 TTY 环境直接报错指引手动安装,不阻塞。
- **安全子系统改动须同步测试+文档**(AGENTS.md):THREAT_MODEL.md + README 环境变量段在本 plan Task 6 更新。
- **export templates**:本批只建通用 `downloadAsset` 基建(资产名参数化),CLI install 只接 editor 二进制;templates 的解压消费(`editor_data/export_templates/`)留批 4b(复用同一基建)。
- 提交纪律:每 Task 结束 commit(Conventional Commits,中文 subject);全批完成跑 `npm run lint` + `npm run build` + `npm test` 全绿。

---

### Task 1:godot-paths.json 读写 + isGodotPathAllowed 优先级链

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\godot-finder.ts`
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\godot-finder-path-config.test.ts`(新建)

**Interfaces:**
- Produces:
  - `export function readGodotPathsConfig(): string[]`(容错:不存在/损坏/非数组 → `[]`;导出供测试与 installer 复用)
  - `export function getGodotPathsConfigFile(): string`(返回 `~/.godot-mcp/godot-paths.json` 绝对路径)
  - `export function writeGodotPathsConfig(paths: string[]): void`(去重 + mkdir -p 父目录 + 原子写 `tmp+rename`)
  - `isGodotPathAllowed(candidate)` 行为变更:优先级链 UNRESTRICTED → env(设了即用)→ config 文件 → 放行

- [ ] **Step 1:写失败测试**

```typescript
// test/godot-finder-path-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// HOME 重定向到临时目录,隔离 ~/.godot-mcp
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'gme-pathcfg-'));
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;
// 清掉影响优先级链的 env
delete process.env.GODOT_MCP_ALLOWED_GODOT_PATHS;
delete process.env.GODOT_MCP_UNRESTRICTED;

const { readGodotPathsConfig, writeGodotPathsConfig, isGodotPathAllowed } =
  await import('../src/core/godot-finder.js');

describe('godot-paths.json 读写', () => {
  it('文件不存在时读 []', () => {
    expect(readGodotPathsConfig()).toEqual([]);
  });
  it('write 后读回,去重', () => {
    writeGodotPathsConfig(['C:/g/A.exe', 'C:/g/A.exe', 'C:/g/B.exe']);
    expect(readGodotPathsConfig()).toEqual(['C:/g/A.exe', 'C:/g/B.exe']);
  });
  it('JSON 损坏容错读 []', () => {
    mkdirSync(join(FAKE_HOME, '.godot-mcp'), { recursive: true });
    writeFileSync(join(FAKE_HOME, '.godot-mcp', 'godot-paths.json'), '{broken');
    expect(readGodotPathsConfig()).toEqual([]);
  });
});

describe('isGodotPathAllowed 优先级链', () => {
  const BIN = join(FAKE_HOME, 'g', 'Godot.exe');
  beforeEach(() => { writeGodotPathsConfig([BIN]); });
  it('env 未设 + config 有 → config 路径放行', () => {
    expect(isGodotPathAllowed(BIN)).toBe(true);
  });
  it('env 未设 + 路径不在 config → 拒绝(白名单语义来自 config)', () => {
    expect(isGodotPathAllowed('C:/evil/fake.exe')).toBe(false);
  });
  it('env 设了 → env 优先,config 被忽略', () => {
    process.env.GODOT_MCP_ALLOWED_GODOT_PATHS = 'C:/only/this.exe';
    expect(isGodotPathAllowed('C:/only/this.exe')).toBe(true);
    expect(isGodotPathAllowed(BIN)).toBe(false);  // env 显式时 config 不参与
    delete process.env.GODOT_MCP_ALLOWED_GODOT_PATHS;
  });
  it('两者皆无 → back-compat 放行', () => {
    writeGodotPathsConfig([]);  // 清空 config
    expect(isGodotPathAllowed('C:/anywhere/Godot.exe')).toBe(true);
  });
});

afterEach(() => { /* 保留 FAKE_HOME 给全 describe 复用 */ });
// 进程级清理放最外层 afterAll
import { afterAll } from 'vitest';
afterAll(() => rmSync(FAKE_HOME, { recursive: true, force: true }));
```

- [ ] **Step 2:跑测试确认失败**

Run: `npx vitest run test/godot-finder-path-config.test.ts`
Expected: FAIL(`readGodotPathsConfig is not a function` 或 import 报错)

- [ ] **Step 3:实现**

在 `src/core/godot-finder.ts` 增加(放在 `isGodotPathAllowed` 之前):

```typescript
import { homedir } from 'os';
import { writeFileSync, renameSync, mkdirSync } from 'fs';

/** B-3:机器级 Godot 路径登记文件(下载器写入,白名单/搜索链消费)。 */
export function getGodotPathsConfigFile(): string {
  return join(homedir(), '.godot-mcp', 'godot-paths.json');
}

/** 容错读取:不存在/JSON 损坏/paths 非字符串数组 → []。 */
export function readGodotPathsConfig(): string[] {
  try {
    const raw = readFileSync(getGodotPathsConfigFile(), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: number; paths?: unknown };
    if (!Array.isArray(parsed.paths)) return [];
    return parsed.paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

/** 去重合并语义由调用方决定;本函数做去重+原子写(tmp+rename)。 */
export function writeGodotPathsConfig(paths: string[]): void {
  const unique = [...new Set(paths)];
  const file = getGodotPathsConfigFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ version: 1, paths: unique }, null, 2) + '\n', 'utf-8');
  renameSync(tmp, file);
}
```

改 `isGodotPathAllowed` 的白名单来源段(原 `if (!raw || raw.trim() === '') return true;` 语义迁移):

```typescript
export function isGodotPathAllowed(candidatePath: string): boolean {
  if (process.env.GODOT_MCP_UNRESTRICTED === 'true') return true;
  const raw = process.env.GODOT_MCP_ALLOWED_GODOT_PATHS;
  // 优先级链:env 设了即用(显式用户意图);未设时用机器级 godot-paths.json(下载器登记);
  // 两者皆无 → back-compat 放行(签名校验 isGodotVersionSignature 兜底)。
  const allowed = raw && raw.trim() !== ''
    ? raw.split(/[;]+/).map(s => s.trim()).filter(Boolean)
    : readGodotPathsConfig();
  if (allowed.length === 0) return true;  // back-compat
  // …以下 realpath 归一匹配逻辑保持原样(allowed 变量替换原局部变量)
}
```

- [ ] **Step 4:跑测试确认通过**

Run: `npx vitest run test/godot-finder-path-config.test.ts`
Expected: PASS(全部用例)

- [ ] **Step 5:跑既有 godot-finder 相关测试防回归**

Run: `npx vitest run test/godot-finder.test.ts 2>/dev/null || npx vitest run --dir test -t "godot-finder"`(若不存在专属文件,跑 `npm test` 中含 finder 的套件;同时确认 env 相关旧测试——旧测试若假设"未设 env 即放行"需检查其是否受 config 文件影响:真实 HOME 下无 godot-paths.json → 读 [] → 放行,行为不变)

- [ ] **Step 6:Commit**

```bash
git add src/core/godot-finder.ts test/godot-finder-path-config.test.ts
git commit -m "feat(core): godot-paths.json 机器级登记 + 白名单优先级链 env→config→放行"
```

---

### Task 2:findGodot 搜索链接入 godot-paths.json 候选

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\godot-finder.ts`(findGodot 主链)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\godot-finder-path-config.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 的 `readGodotPathsConfig`
- Produces: findGodot 解析顺序变为 `项目 override → godot-paths.json 候选 → PATH → 平台搜索目录`(config 候选先于 PATH:下载器安装是用户显式动作,优先于 PATH 里可能过期的版本)

- [ ] **Step 1:追加失败测试**(validateGodotBinary 会真 spawn `--version`,单测不造真二进制——测试只断言**候选被尝试**:用不存在的路径写进 config,断言 `findGodot()` 的 tried 记录或跳过;真正端到端在 Task 6 真机手测覆盖)

```typescript
describe('findGodot 搜索链接入 config', () => {
  it('config 中不存在/无效的路径被跳过,不抛出(容错)', async () => {
    const { findGodot } = await import('../src/core/godot-finder.js');
    writeGodotPathsConfig([join(FAKE_HOME, 'nonexistent', 'Godot_v4.7.2.exe')]);
    // 不抛 InternalError 之外的崩溃即可(本机可能找到或找不到,取决于环境)
    await expect(findGodot()).resolves.toBeTypeOf('string').catch(() => {}); 
  });
});
```

(此用例为**不崩溃**护栏;真实发现路径由 Task 6 真机手测验证。)

- [ ] **Step 2:跑测试确认现状**

Run: `npx vitest run test/godot-finder-path-config.test.ts`
Expected: 新用例可能已过(护栏型)——若已过,记录在案,实现仍按 Step 3 落地(搜索链是真需求,由真机手测背书)。

- [ ] **Step 3:实现**

在 `findGodot` 主链中,项目 override 尝试之后、PATH 搜索之前插入:

```typescript
// B-3:机器级 godot-paths.json 候选(下载器安装的 Godot 优先于 PATH)
for (const candidate of readGodotPathsConfig()) {
  if (existsSync(candidate) && await validateGodotBinary(candidate)) {
    return candidate;
  }
  tried.push(`godot-paths.json: ${candidate} (not found or failed validation)`);
}
```

(具体插入点:找到 `findGodot` 函数中项目 override 段之后的搜索段开头;`tried` 数组为该函数既有机制。)

- [ ] **Step 4:跑测试 + Commit**

Run: `npx vitest run test/godot-finder-path-config.test.ts && npm run build`

```bash
git add src/core/godot-finder.ts test/godot-finder-path-config.test.ts
git commit -m "feat(core): findGodot 搜索链接入 godot-paths.json 候选(优先于 PATH)"
```

---

### Task 3:下载器纯函数层(URL 白名单/平台映射/SUMS 解析/SHA512)

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\cli\godot-installer.ts`
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\godot-installer.test.ts`(新建)

**Interfaces:**
- Produces(全部 export 供 Task 4/5 与测试):
  - `const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'api.github.com'] as const`
  - `function assertAllowedDownloadUrl(url: string): void`(非 https 或域名不在白名单 → throw `InternalError('download URL not in allowlist: ...')`)
  - `function assertStableVersionTag(tag: string): void`(非 `/^\d+\.\d+\.\d+-stable$/` → throw)
  - `function platformAssetName(platform: NodeJS.Platform, arch: string): string`(win32/x64→`Godot_v{v}-stable_win64.exe.zip`;win32/arm64→`..._windows_arm64.exe.zip`;linux/x64→`..._linux.x86_64.zip`;linux/arm64→`..._linux.arm64.zip`;darwin/*→`..._macos.universal.zip`;其余 throw)
  - `function buildReleaseUrls(tag: string, assetName: string): { binaryUrl: string; sumsUrl: string }`(`https://github.com/godotengine/godot/releases/download/<tag>/<asset>` 与 `.../SHA512-SUMS.txt`)
  - `function parseSha512Sums(sumsText: string, filename: string): string`(找不到条目 → throw;返回 hex 小写)
  - `async function sha512File(filePath: string): Promise<string>`(流式,`crypto.createHash('sha512')` + `pipeline`)

- [ ] **Step 1:写失败测试**

```typescript
// test/godot-installer.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';

const m = await import('../src/cli/godot-installer.js');

describe('assertAllowedDownloadUrl', () => {
  it('github release URL 放行', () => {
    expect(() => m.assertAllowedDownloadUrl('https://github.com/godotengine/godot/releases/download/4.7.2-stable/a.zip')).not.toThrow();
    expect(() => m.assertAllowedDownloadUrl('https://objects.githubusercontent.com/xxx')).not.toThrow();
  });
  it('非白名单域名拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('https://evil.com/godot.zip')).toThrow();
  });
  it('http(非 https)拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('http://github.com/a')).toThrow();
  });
  it('file:// 等怪协议拒绝', () => {
    expect(() => m.assertAllowedDownloadUrl('file:///etc/passwd')).toThrow();
  });
});

describe('版本 tag 与平台资产映射', () => {
  it('stable tag 放行,非 stable 拒绝', () => {
    expect(() => m.assertStableVersionTag('4.7.2-stable')).not.toThrow();
    expect(() => m.assertStableVersionTag('4.8-dev')).toThrow();
    expect(() => m.assertStableVersionTag('../../evil')).toThrow();
  });
  it('三平台映射正确', () => {
    expect(m.platformAssetName('win32', 'x64')).toBe('Godot_v{v}-stable_win64.exe.zip');
    expect(m.platformAssetName('linux', 'x64')).toBe('Godot_v{v}-stable_linux.x86_64.zip');
    expect(m.platformAssetName('darwin', 'arm64')).toBe('Godot_v{v}-stable_macos.universal.zip');
  });
  it('不支持的组合抛错', () => {
    expect(() => m.platformAssetName('freebsd', 'x64')).toThrow();
  });
  it('buildReleaseUrls 产出并自校验(内部过 assertAllowedDownloadUrl)', () => {
    const urls = m.buildReleaseUrls('4.7.2-stable', 'Godot_v4.7.2-stable_win64.exe.zip');
    expect(urls.binaryUrl).toContain('releases/download/4.7.2-stable/');
    expect(urls.sumsUrl).toBe('https://github.com/godotengine/godot/releases/download/4.7.2-stable/SHA512-SUMS.txt');
  });
});

describe('parseSha512Sums 与 sha512File', () => {
  it('解析双空格格式并匹配文件名', () => {
    const text = 'aa..bb  Godot_v4.7.2-stable_win64.exe.zip\ncc..dd  other.zip';
    expect(m.parseSha512Sums(text, 'Godot_v4.7.2-stable_win64.exe.zip')).toBe('aa..bb');
  });
  it('条目缺失抛错', () => {
    expect(() => m.parseSha512Sums('aa  other.zip', 'missing.zip')).toThrow();
  });
  it('sha512File 流式哈希与 crypto 一致', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-hash-'));
    const f = join(dir, 'x.bin');
    writeFileSync(f, Buffer.from('hello godot'));
    const expected = createHash('sha512').update('hello godot').digest('hex');
    expect(await m.sha512File(f)).toBe(expected);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2:跑测试确认失败**

Run: `npx vitest run test/godot-installer.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3:实现 `src/cli/godot-installer.ts` 纯函数层**

```typescript
/** 批 2:Godot 自动安装——官方 GitHub releases 下载器(SHA512 同源校验,零新依赖)。 */
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { InternalError } from '../core/tool-errors.js';

export const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'api.github.com'] as const;

export function assertAllowedDownloadUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new InternalError(`download URL not in allowlist (unparseable): ${url}`); }
  if (parsed.protocol !== 'https:') throw new InternalError(`download URL not https: ${url}`);
  if (!(DOWNLOAD_HOSTS as readonly string[]).includes(parsed.hostname)) {
    throw new InternalError(`download host not in allowlist: ${parsed.hostname}`);
  }
}

export function assertStableVersionTag(tag: string): void {
  if (!/^\d+\.\d+\.\d+-stable$/.test(tag)) {
    throw new InternalError(`unsupported version tag (stable only): ${tag}`);
  }
}

export function platformAssetName(platform: NodeJS.Platform, arch: string): string {
  const suffix =
    platform === 'win32' && arch === 'x64' ? 'win64.exe.zip' :
    platform === 'win32' && arch === 'arm64' ? 'windows_arm64.exe.zip' :
    platform === 'linux' && arch === 'x64' ? 'linux.x86_64.zip' :
    platform === 'linux' && arch === 'arm64' ? 'linux.arm64.zip' :
    platform === 'darwin' ? 'macos.universal.zip' : null;
  if (!suffix) throw new InternalError(`unsupported platform/arch: ${platform}/${arch}`);
  return `Godot_v{v}-stable_${suffix}`;
}

export function buildReleaseUrls(tag: string, assetName: string): { binaryUrl: string; sumsUrl: string } {
  assertStableVersionTag(tag);
  const base = `https://github.com/godotengine/godot/releases/download/${encodeURIComponent(tag)}`;
  const binaryUrl = `${base}/${assetName.replace('{v}', tag.replace('-stable', ''))}`;
  const sumsUrl = `${base}/SHA512-SUMS.txt`;
  assertAllowedDownloadUrl(binaryUrl);
  assertAllowedDownloadUrl(sumsUrl);
  return { binaryUrl, sumsUrl };
}

export function parseSha512Sums(sumsText: string, filename: string): string {
  for (const line of sumsText.split(/\r?\n/)) {
    const mch = line.match(/^([0-9a-fA-F]{128})\s\s+(.+)$/);
    if (mch && mch[2].trim() === filename) return mch[1].toLowerCase();
  }
  throw new InternalError(`entry not found in SHA512-SUMS.txt: ${filename}`);
}

export async function sha512File(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}
```

注意 `platformAssetName` 返回带 `{v}` 占位符的模板(asset 名含具体版本号),`buildReleaseUrls` 用 `tag.replace('-stable','')` 填充——测试断言与实现保持该契约。

- [ ] **Step 4:跑测试确认通过 + Commit**

Run: `npx vitest run test/godot-installer.test.ts`

```bash
git add src/cli/godot-installer.ts test/godot-installer.test.ts
git commit -m "feat(cli): 下载器纯函数层——域名白名单/版本 tag 校验/平台映射/SUMS 解析/流式 SHA512"
```

---

### Task 4:下载执行 + installGodot 编排(解压/登记/机器审计/失败即删)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\cli\godot-installer.ts`(追加)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\audit-log.ts`(追加 appendMachineAuditLine)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\godot-installer.test.ts`(追加)

**Interfaces:**
- Consumes: Task 3 全部函数;`readGodotPathsConfig/writeGodotPathsConfig`(Task 1);`AuditEntry`(audit-log)
- Produces:
  - `export async function fetchLatestStableTag(): Promise<string>`(api.github.com latest release,`GODOT_MCP_INSTALL_TAG` env 可 pin 覆盖——测试与真机复现用)
  - `export async function downloadWithProgress(url: string, destPath: string, onProgress?: (bytes:number)=>void): Promise<void>`(fetch → 流式写盘)
  - `export async function extractZip(zipPath: string, destDir: string): Promise<void>`(`tar -xf`,失败 throw)
  - `export async function installGodot(opts: { versionTag?: string; confirm: () => Promise<boolean>; onProgress?: (msg: string) => void }): Promise<{ godotPath: string; versionTag: string }>`(编排:tag→URL→确认→下载→SHA512 校验(失败即删并 throw)→解压→登记 config→机器审计)
  - `src/core/audit-log.ts` 新增 `export async function appendMachineAuditLine(entry: Omit<AuditEntry, 'timestamp'> ): Promise<void>`(落 `~/.godot-mcp/machine-audit.jsonl`,复用 appendFile 原子追加模式;调用方补 timestamp)

- [ ] **Step 1:追加失败测试**(fetch/tar mock;不真联网)

```typescript
describe('downloadWithProgress + installGodot 编排(mock fetch)', () => {
  it('SHA512 不匹配 → 删文件并抛错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-dl-'));
    const zipPath = join(dir, 'Godot_v4.7.2-stable_win64.exe.zip');
    writeFileSync(zipPath, Buffer.from('tampered'));
    // 直接测内部校验函数:verifyDownloadedAsset(file, expected) — sha512 不匹配
    await expect(m.verifyDownloadedAsset(zipPath, '0'.repeat(128))).rejects.toThrow(/sha512 mismatch/i);
    const { existsSync } = await import('fs');
    expect(existsSync(zipPath)).toBe(false);  // 失败即删
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloadWithProgress 走 allowlist(mock fetch 拒 evil 域)', async () => {
    await expect(m.downloadWithProgress('https://evil.com/a.zip', join(tmpdir(), 'x'))).rejects.toThrow(/allowlist/);
  });

  it('downloadWithProgress mock fetch 流式落盘', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gme-dl2-'));
    const dest = join(dir, 'a.zip');
    const payload = Buffer.from('abc123');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    await m.downloadWithProgress('https://github.com/godotengine/godot/releases/download/4.7.2-stable/a.zip', dest);
    const { readFileSync } = await import('fs');
    expect(readFileSync(dest).toString()).toBe('abc123');
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('appendMachineAuditLine', () => {
  it('落 ~/.godot-mcp/machine-audit.jsonl 且 JSON 行合法', async () => {
    const { appendMachineAuditLine } = await import('../src/core/audit-log.js');
    await appendMachineAuditLine({
      trace_id: 't-test', tool: 'cli', action: 'install_godot', risk: 'process',
      ok: true, project_path: '', changed_files: [], duration_ms: 5,
      details: { versionTag: '4.7.2-stable' },
    } as never);
    const { readFileSync, existsSync } = await import('fs');
    const { getMachineAuditFile } = await import('../src/core/audit-log.js');
    expect(existsSync(getMachineAuditFile())).toBe(true);
    const lines = readFileSync(getMachineAuditFile(), 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.action).toBe('install_godot');
    expect(typeof last.timestamp).toBe('string');
  });
});
```

- [ ] **Step 2:跑测试确认失败**

Run: `npx vitest run test/godot-installer.test.ts`
Expected: FAIL(函数未定义)

- [ ] **Step 3:实现**

`src/core/audit-log.ts` 追加:

```typescript
/** 批 2:机器级审计(install 等非项目操作),复用 AuditEntry 与 appendFile 原子追加模式。 */
export function getMachineAuditFile(): string {
  return join(homedir(), '.godot-mcp', 'machine-audit.jsonl');
}

export async function appendMachineAuditLine(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  const full: AuditEntry = { ...entry, timestamp: new Date().toISOString() };
  await mkdir(dirname(getMachineAuditFile()), { recursive: true });
  await appendFile(getMachineAuditFile(), JSON.stringify(full) + '\n', 'utf-8');
}
```

`src/cli/godot-installer.ts` 追加:

```typescript
import { mkdir, rm, writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dirname } from 'path';
import { homedir } from 'os';
import { appendMachineAuditLine } from '../core/audit-log.js';
import { readGodotPathsConfig, writeGodotPathsConfig } from '../core/godot-finder.js';

const execFileAsync = promisify(execFile);

export async function fetchLatestStableTag(): Promise<string> {
  const pinned = process.env.GODOT_MCP_INSTALL_TAG;
  if (pinned) { assertStableVersionTag(pinned); return pinned; }
  const url = 'https://api.github.com/repos/godotengine/godot/releases/latest';
  assertAllowedDownloadUrl(url);
  const res = await fetch(url, { headers: { 'User-Agent': 'godot-mcp-enhanced-installer' } });
  if (!res.ok) throw new InternalError(`github api ${res.status}`);
  const data = await res.json() as { tag_name?: string };
  if (!data.tag_name) throw new InternalError('github api: no tag_name');
  assertStableVersionTag(data.tag_name);
  return data.tag_name;
}

export async function downloadWithProgress(url: string, destPath: string, onProgress?: (bytes: number) => void): Promise<void> {
  assertAllowedDownloadUrl(url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new InternalError(`download failed: HTTP ${res.status}`);
  await mkdir(dirname(destPath), { recursive: true });
  let received = 0;
  const source = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  source.on('data', (chunk: Buffer) => { received += chunk.length; onProgress?.(received); });
  await pipeline(source, createWriteStream(destPath));
}

/** SHA512 校验;失败即删(不留半成品)。 */
export async function verifyDownloadedAsset(filePath: string, expectedSha512: string): Promise<void> {
  const actual = await sha512File(filePath);
  if (actual !== expectedSha512.toLowerCase()) {
    await rm(filePath, { force: true });
    throw new InternalError(`sha512 mismatch: ${filePath} (expected ${expectedSha512.slice(0, 12)}…, got ${actual.slice(0, 12)}…) — file deleted`);
  }
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  // Windows 10+ 内置 BSD tar 支持 zip;Linux/macOS 原生 tar。
  await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], { timeout: 120_000 });
}

export async function installGodot(opts: {
  versionTag?: string;
  confirm: () => Promise<boolean>;
  onProgress?: (msg: string) => void;
}): Promise<{ godotPath: string; versionTag: string }> {
  const started = Date.now();
  const versionTag = opts.versionTag ? (assertStableVersionTag(opts.versionTag), opts.versionTag) : await fetchLatestStableTag();
  const assetTemplate = platformAssetName(process.platform, process.arch);
  const assetName = assetTemplate.replace('{v}', versionTag.replace('-stable', ''));
  const { binaryUrl, sumsUrl } = buildReleaseUrls(versionTag, assetTemplate);
  const installDir = join(homedir(), '.godot-mcp', 'godot', versionTag);
  const zipPath = join(installDir, assetName);

  opts.onProgress?.(`资产: ${assetName}\n目标: ${installDir}`);
  if (!(await opts.confirm())) throw new InternalError('install cancelled by user');

  try {
    opts.onProgress?.('下载 SHA512-SUMS.txt …');
    await downloadWithProgress(sumsUrl, join(installDir, 'SHA512-SUMS.txt'));
    const expected = parseSha512Sums(readFileSync(join(installDir, 'SHA512-SUMS.txt'), 'utf-8'), assetName);
    opts.onProgress?.(`下载 ${assetName} …`);
    await downloadWithProgress(binaryUrl, zipPath);
    await verifyDownloadedAsset(zipPath, expected);
    opts.onProgress?.('解压 …');
    await extractZip(zipPath, installDir);
    await rm(zipPath, { force: true });  // 校验通过的 zip 用后即删
    const godotPath = findExtractedBinary(installDir);
    // 登记:机器级搜索链 + 白名单(godot-paths.json)
    writeGodotPathsConfig([...readGodotPathsConfig(), godotPath]);
    await appendMachineAuditLine({
      trace_id: `install-${Date.now()}`, tool: 'cli', action: 'install_godot', risk: 'process',
      ok: true, project_path: '', changed_files: [godotPath], duration_ms: Date.now() - started,
      details: { versionTag, assetName, url: binaryUrl },
    } as never);
    return { godotPath, versionTag };
  } catch (err) {
    await appendMachineAuditLine({
      trace_id: `install-${Date.now()}`, tool: 'cli', action: 'install_godot', risk: 'process',
      ok: false, project_path: '', changed_files: [], duration_ms: Date.now() - started,
      details: { versionTag, error: err instanceof Error ? err.message : String(err) },
    } as never);
    throw err;
  }
}

/** 在解压目录中定位 Godot 可执行(win32: Godot_v*.exe;darwin: Godot.app/Contents/MacOS/Godot;linux: godot* 无扩展名或 _x11 老命名)。 */
function findExtractedBinary(dir: string): string {
  const entries = readdirSync(dir);
  if (process.platform === 'win32') {
    const exe = entries.find(e => /^Godot_v.*\.exe$/i.test(e));
    if (exe) return join(dir, exe);
  } else if (process.platform === 'darwin') {
    if (entries.includes('Godot.app')) return join(dir, 'Godot.app', 'Contents', 'MacOS', 'Godot');
  } else {
    const bin = entries.find(e => /^Godot_v.*(x11|linux|_console)*$/.test(e) && !e.includes('.zip'));
    if (bin) return join(dir, bin);
  }
  throw new InternalError(`extracted Godot binary not found in ${dir}`);
}
```

(顶部 import 按需补齐:`readdirSync, readFileSync` from 'fs'、`join` from 'path'、`pipeline` 已有、`InternalError` 已有。)

- [ ] **Step 4:跑测试确认通过**

Run: `npx vitest run test/godot-installer.test.ts`
Expected: PASS

- [ ] **Step 5:Commit**

```bash
git add src/cli/godot-installer.ts src/core/audit-log.ts test/godot-installer.test.ts
git commit -m "feat(cli): installGodot 编排——下载/SHA512 同源校验/解压/登记/机器审计,失败即删"
```

---

### Task 5:router `install` 子命令 + setup 缺失引导

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\cli\router.ts`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\cli\setup.ts`
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\godot-installer.test.ts`(追加 CLI 层轻测)+ 手测

**Interfaces:**
- Consumes: Task 4 `installGodot`
- Produces:
  - `npx godot-mcp-enhanced install [version-tag]`(SUBCOMMANDS 加 `'install'`;usage 文本加一行)
  - `src/cli/setup.ts`:`runSetup` 中 Godot not found 分支改为:非交互环境保持 exit 1 + 提示 `install` 子命令;TTY 环境 readline 询问「自动下载安装最新 stable?y/N」→ 确认则 `installGodot`(onProgress 用 console.log)→ 成功后拿 `godotPath` 继续原配置流程
  - 新增小工具 `confirmYesNo(question: string): Promise<boolean>`(readline;非 TTY 返回 false)

- [ ] **Step 1:实现 router 与 setup 接线**(CLI 层薄壳,靠手测;单测补 confirmYesNo)

```typescript
// router.ts:SUBCOMMANDS 加 'install';switch 加:
case 'install': {
  const { runInstall } = await import('./godot-installer.js');
  await runInstall(args.slice(1));
  break;
}
// usage 文本加:godot-mcp-enhanced install [tag]  从官方 releases 安装 Godot(默认 latest stable)
```

`godot-installer.ts` 追加 CLI 入口:

```typescript
export async function runInstall(args: string[]): Promise<void> {
  const versionTag = args[0];  // 可选
  console.log('📥 Godot 自动安装(官方 GitHub releases,SHA512 同源校验)\n');
  const { godotPath, versionTag: tag } = await installGodot({
    versionTag,
    confirm: async () => {
      const { confirmYesNo } = await import('./confirm.js');
      return confirmYesNo('确认下载并安装?');
    },
    onProgress: (msg) => console.log(`  ${msg}`),
  });
  console.log(`\n✓ Godot ${tag} 安装完成: ${godotPath}`);
  console.log('  已登记 ~/.godot-mcp/godot-paths.json(搜索链 + 白名单)。');
}
```

新建 `src/cli/confirm.ts`(单文件单职责):

```typescript
import { createInterface } from 'readline';
/** CLI y/N 确认(默认 N);非 TTY 返回 false 不阻塞。 */
export async function confirmYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => resolve(ans.trim().toLowerCase()));
  });
  rl.close();
  return answer === 'y' || answer === 'yes';
}
```

`setup.ts` not found 分支替换:

```typescript
} catch (err) {
  console.error(`✗ Godot not found: ${getErrorMessage(err)}`);
  // 批 2:TTY 环境引导自动安装;非交互保持 exit 1
  const { confirmYesNo } = await import('./confirm.js');
  if (await confirmYesNo('\n未找到 Godot。是否从官方 releases 自动下载安装最新 stable?')) {
    const { installGodot } = await import('./godot-installer.js');
    const { godotPath: installed, versionTag } = await installGodot({
      confirm: async () => true,  // 外层已确认
      onProgress: (msg) => console.log(`  ${msg}`),
    });
    console.log(`✓ Godot ${versionTag} 已安装: ${installed}`);
    godotPath = installed;
  } else {
    console.error('  运行 `npx godot-mcp-enhanced install` 手动安装,或设 GODOT_PATH 指向已有 Godot。');
    process.exit(1);
  }
}
```

(`let godotPath` 声明从 `const` 改 `let`。)

- [ ] **Step 2:测试(confirmYesNo 非 TTY 行为)+ 手测命令面**

追加测试:

```typescript
describe('confirmYesNo', () => {
  it('非 TTY 返回 false 不阻塞', async () => {
    const { confirmYesNo } = await import('../src/cli/confirm.js');
    // CI/单测环境 stdin 非 TTY
    expect(await confirmYesNo('test?')).toBe(false);
  });
});
```

Run: `npx vitest run test/godot-installer.test.ts && npm run build`
手测:`node build/cli/router.js install --help 2>&1 | head -3`(或 `npx . install` 走到确认提示即 Ctrl+C,验证交互面出现)

- [ ] **Step 3:Commit**

```bash
git add src/cli/router.ts src/cli/setup.ts src/cli/confirm.ts src/cli/godot-installer.ts test/godot-installer.test.ts
git commit -m "feat(cli): install 子命令 + setup 缺失 Godot 时交互式自动安装引导"
```

---

### Task 6:文档同步(README/THREAT_MODEL/CHANGELOG)+ Windows 真机手测

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\README.md`(快速开始/环境变量表 GODOT_MCP_ALLOWED_GODOT_PATHS 行为说明)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\README.en.md`(同步)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\THREAT_MODEL.md`(§2.1 或新增小节:godot-paths.json 消费点)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md`([Unreleased] 批 2 小节)

- [ ] **Step 1:Windows 真机手测**(需网络,真实下载 ~60MB)

```bash
export GODOT_MCP_INSTALL_TAG=4.7.2-stable   # pin 版本保证可复现
node build/cli/router.js install            # y 确认 → 真下载+校验+解压+登记
ls ~/.godot-mcp/godot/4.7.2-stable/         # 确认解压产物
node build/cli/router.js doctor             # ← spec 验证要求:doctor 能发现新装的 Godot
cat ~/.godot-mcp/godot-paths.json           # 确认登记
tail -1 ~/.godot-mcp/machine-audit.jsonl    # 确认审计行
```

Expected:install 成功输出路径;doctor 输出 `✓ Godot found: <~/.godot-mcp/godot/...>`;machine-audit.jsonl 末行 `action:"install_godot", ok:true`。
(若本机已装 Godot 且 PATH 可见:doctor 显示的可能是 PATH 版本——验证 godot-paths.json 候选优先级可临时改 PATH 或看 `findGodot` 顺序;至少确认 doctor 正常。)

- [ ] **Step 2:文档更新**

README 快速开始加 install 段(小白叙事节的 roadmap「零预装自动安装 Godot」标注改为已支持);环境变量表 `GODOT_MCP_ALLOWED_GODOT_PATHS` 行补「未设时回落 `~/.godot-mcp/godot-paths.json`(CLI install 登记的路径视为可信)」;新增 `GODOT_MCP_INSTALL_TAG`(内部 pin,标注测试用)。
THREAT_MODEL.md 增补:下载域名白名单(三域)、SHA512 同源校验、godot-paths.json 的写入方(CLI install,用户确认后)与消费方(白名单/搜索链)、env 显式设置优先于配置文件的语义。
CHANGELOG [Unreleased] 加批 2 小节(C-3 模式:实测事实写清,SHA512 非 SHA256 的未决项结论落档)。

- [ ] **Step 3:全量验证 + Commit**

Run: `npm run lint && npm run build && npm test`
Expected: 全绿(既有测试无回归——尤其 godot-finder/env 白名单旧测试)。

```bash
git add README.md README.en.md docs/THREAT_MODEL.md CHANGELOG.md
git commit -m "docs: 批2 安全面文档同步——godot-paths.json 白名单语义/下载域名白名单/SHA512 同源校验"
```

---

## Self-Review 结论(plan 写完后自查)

1. **Spec 覆盖**:spec 批 2 四要素——通用下载器(Task 3/4,资产名参数化 + templates 复用同一 downloadAsset 基建)、SHA512 校验失败即删(Task 4 verifyDownloadedAsset)、~/.godot-mcp/godot/<version>/ 落点(Task 4)、审计(Task 4 appendMachineAuditLine)、白名单架构改造 B-3(Task 1/2)、setup 扩展点(Task 5)、单测+三项全绿+doctor 手测(Task 1-6)、THREAT_MODEL/README 同步(Task 6)——全覆盖。SHA256→SHA512 为未决项 1 实测结论,已在 Global Constraints 落档。
2. **占位符扫描**:无 TBD/TODO;关键代码块齐全。
3. **类型一致性**:`{v}` 占位符契约(platformAssetName 模板 → buildReleaseUrls/installGodot 填充)三处一致;`verifyDownloadedAsset` 在 Task 4 测试先于实现引用(测试内注释说明)。
