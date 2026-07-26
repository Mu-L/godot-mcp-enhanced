# Client Adapters Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 客户端配置 adapter 从 4 个扩到 13 个（+9 头部主流 client），对标 Godot AI 的 19 client auto-configure，补齐客户端配置短板。

**Architecture:** 接口轻扩展（ClientAdapter 加必需 `scope` 属性）+ 共享基础设施（json-config 的 stripBom/readJsonForCheck + paths 的 globalConfigRoot）+ 9 新文件型 adapter（按各 client 官方配置约定写 `mcpServers`/`context_servers` entry）+ 现有 4 改造（补 scope + isConfigured 改 readJsonForCheck + user-state 白名单）。stdio entry 形态统一 `{command, args, env:{GODOT_PATH}}`（Cherry Studio 加 `type:"stdio"`，OpenCode 保留 `type:"local"`）。

**Tech Stack:** TypeScript (Node.js ESM), vitest, 现有 ClientAdapter 接口（文件写入型 `readJsonConfigWithBackup` + 原子 tmp+rename / CLI 调用型 execFile）。

## Global Constraints

- enhanced 是 **stdio MCP server**，entry 形态 `{command, args, env:{GODOT_PATH}}`——**不写** Godot AI 的 HTTP 字段（`streamableHttp`/`serverUrl`/`url`/`httpUrl`）
- scope 由 client 官方支持决定（核实后 **global 8 / project 5**）：global adapter 的 `projectDir` 参数 no-op，用 `globalConfigRoot()`/`homedir()` 定位
- stdio type 字段：仅 **Cherry Studio** 必须 `type:"stdio"`（schema 强制）；**Trae** 保守不加（Task 5 留实机验证 note）；OpenCode 保留 `type:"local"`；其余无 type
- user-state 字段 per-client 白名单 merge（Cline/Cherry/Antigravity/Gemini CLI/Qwen Code/OpenCode），reconfigure 保留旧值，首次创建 seed 默认
- 跨平台路径 env 优先：Win `%APPDATA%`→`%LOCALAPPDATA%`→`~/AppData/Roaming`；mac `~/Library/Application Support`；Linux `$XDG_CONFIG_HOME`→`~/.config`
- BOM 防御：所有 JSON 读取经 stripBom；写回不带 BOM
- 不加 `--global/--project` flag（YAGNI），setup/doctor 日志标 `(global)`/`(project)`
- client adapter 是 CLI 侧配置，**不进 capability-matrix**（不是 MCP 工具能力）
- 提交信息中文 + conventional prefix，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`；分支 `feat/client-adapters-expansion`
- 同文件多 Edit 必须串行（GateGuard hook）；编辑 .ts 用内置 Edit/Write（本项目无 .gd 改动）

**权威 spec：** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-26-client-adapters-design.md`（已含 2026-07-26 plan 前置核实结论）。本 plan 与 spec §2 表 / §3 / §4 完全对齐。

---

## File Structure

**新增基础设施**：
- `src/cli/clients/paths.ts` — `globalConfigRoot()` 跨平台全局配置根目录 helper
- `test/cli/clients/json-config.test.ts` — stripBom/readJsonConfigWithBackup/readJsonForCheck 测试
- `test/cli/clients/paths.test.ts` — 跨平台 mock 测试

**改造基础设施**：
- `src/cli/clients/json-config.ts` — 加 `stripBom` + `readJsonForCheck`，`readJsonConfigWithBackup` 改用 stripBom

**接口 + 现有 adapter 改造**：
- `src/cli/clients/types.ts` — 加 `scope` 必需属性 + 注释修正（spec §1.2）
- `src/cli/clients/{claude-code,cursor,opencode,codex}.ts` — 补 `scope`；3 文件型 `isConfigured` 改 `readJsonForCheck`；OpenCode 加 user-state 白名单

**9 新 adapter**（global 7 + project 2，各配测试）：
- global：`claude-desktop.ts` / `windsurf.ts` / `cline.ts` / `zed.ts` / `antigravity.ts` / `trae.ts` / `cherry-studio.ts`
- project：`gemini-cli.ts` / `qwen-code.ts`

**注册 + 日志**：
- `src/cli/clients/index.ts` — `ALL_ADAPTERS` 注册 9 新
- `src/cli/setup.ts` + `doctor.ts` — 日志标 `(global)`/`(project)`

**文档**：`CHANGELOG.md`

---

## Task 1: 基础设施 — json-config.ts (stripBom + readJsonForCheck) + paths.ts (globalConfigRoot)

**Files:**
- Modify: `src/cli/clients/json-config.ts`
- Create: `src/cli/clients/paths.ts`
- Test: `test/cli/clients/json-config.test.ts` (新建), `test/cli/clients/paths.test.ts` (新建)

**Interfaces:**
- Produces: `stripBom(raw: string): string`、`readJsonForCheck(filePath: string): Record<string, unknown> | null`（json-config.ts）；`globalConfigRoot(): string`（paths.ts）。后续所有文件型 adapter 的 isConfigured/configure 依赖这三个。

- [ ] **Step 1: 写 json-config.test.ts 失败测试**

创建 `test/cli/clients/json-config.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonConfigWithBackup, readJsonForCheck, stripBom } from '../../../src/cli/clients/json-config.js';

describe('stripBom', () => {
  it('strips UTF-8 BOM', () => {
    expect(stripBom('\uFEFF{"a":1}')).toBe('{"a":1}');
  });
  it('passes through non-BOM string', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}');
  });
});

describe('readJsonConfigWithBackup', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-json-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns {} when file not found', () => {
    expect(readJsonConfigWithBackup(join(dir, 'no.json'))).toEqual({});
  });
  it('parses valid JSON with BOM', () => {
    const p = join(dir, 'bom.json');
    writeFileSync(p, '\uFEFF{"mcpServers":{"godot":{}}}');
    expect(readJsonConfigWithBackup(p)).toEqual({ mcpServers: { godot: {} } });
  });
  it('backs up corrupted JSON and returns {}', () => {
    const p = join(dir, 'bad.json');
    const corrupt = '{ broken';
    writeFileSync(p, corrupt);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readJsonConfigWithBackup(p);
    expect(result).toEqual({});
    const backups = readdirSync(dir).filter(f => f.startsWith('bad.json.corrupt.'));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(dir, backups[0]!), 'utf-8')).toBe(corrupt);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('readJsonForCheck', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-chk-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when file not found', () => {
    expect(readJsonForCheck(join(dir, 'no.json'))).toBeNull();
  });
  it('parses valid JSON with BOM', () => {
    const p = join(dir, 'bom.json');
    writeFileSync(p, '\uFEFF{"mcpServers":{"godot":{}}}');
    expect(readJsonForCheck(p)).toEqual({ mcpServers: { godot: {} } });
  });
  it('returns null for corrupted JSON', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ broken');
    expect(readJsonForCheck(p)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/cli/clients/json-config.test.ts`
Expected: FAIL（`stripBom` / `readJsonForCheck` 未导出）

- [ ] **Step 3: 改造 json-config.ts**

用 Write 覆盖 `src/cli/clients/json-config.ts`（加 stripBom + readJsonForCheck，readJsonConfigWithBackup 改用 stripBom）：

```ts
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

/** 去除 UTF-8 BOM（Windows 工具有时写入 BOM，会破坏 JSON.parse）。 */
export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * 读取 JSON 配置文件,用于 CLI client adapter 的 configure()。
 *
 * F3: 当文件存在但 JSON 解析失败(用户配置损坏)时,**不静默用空对象覆盖**——
 * 先把原始内容备份到 `<path>.corrupt.<uuid>.bak` 并打印警告,再返回 {} 让调用方
 * 以干净状态继续写入。备份失败(磁盘满/权限)则抛错,绝不覆盖未备份的损坏文件。
 *
 * - 文件不存在 → 返回 {}
 * - 合法 JSON（含 BOM，经 stripBom）→ 返回解析结果
 * - 损坏 JSON → 备份 raw 后返回 {}
 */
export function readJsonConfigWithBackup(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(stripBom(raw)) as Record<string, unknown>;
  } catch {
    const backupPath = `${filePath}.corrupt.${randomUUID()}.bak`;
    writeFileSync(backupPath, raw, 'utf-8'); // 失败则抛错 — 不覆盖未备份的损坏文件
    console.warn(
      `[godot-mcp] ${filePath} contained invalid JSON — backed up to ${backupPath} before overwriting.`,
    );
    return {};
  }
}

/**
 * 读取 JSON 配置文件,用于 isConfigured() 只读检查。
 *
 * - 文件不存在 → 返回 null（调用方返 false）
 * - 合法 JSON（含 BOM，经 stripBom）→ 返回解析结果
 * - 损坏 JSON（BOM strip 后仍损坏）→ 返回 null（调用方返 false，不抛错、不备份）
 *
 * 与 readJsonConfigWithBackup 区别：只读不备份、不抛错、not_found 返 null。
 * 设计原因：isConfigured 现状是 try{...}catch{return false} 吞错；带 BOM 的合法配置
 * 若内联 JSON.parse 会 throw→catch→false→doctor 误报 + setup 破坏幂等。统一改用本函数。
 */
export function readJsonForCheck(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(filePath, 'utf-8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 写 paths.test.ts + paths.ts**

创建 `test/cli/clients/paths.test.ts`：

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

describe('globalConfigRoot', () => {
  const origPlatform = process.platform;
  const origEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    process.env = { ...origEnv };
  });

  it('win32 uses APPDATA', async () => {
    vi.resetModules();
    process.env = { ...origEnv, APPDATA: 'C:\\Users\\t\\AppData\\Roaming' };
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe('C:\\Users\\t\\AppData\\Roaming');
  });

  it('darwin uses ~/Library/Application Support', async () => {
    vi.resetModules();
    process.env = { ...origEnv };
    delete process.env.APPDATA;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe(join(homedir(), 'Library', 'Application Support'));
  });

  it('linux uses XDG_CONFIG_HOME when set', async () => {
    vi.resetModules();
    process.env = { ...origEnv, XDG_CONFIG_HOME: '/custom/xdg' };
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe('/custom/xdg');
  });

  it('linux falls back to ~/.config when XDG unset', async () => {
    vi.resetModules();
    process.env = { ...origEnv };
    delete process.env.XDG_CONFIG_HOME;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe(join(homedir(), '.config'));
  });
});
```

创建 `src/cli/clients/paths.ts`：

```ts
import { join } from 'path';
import { homedir } from 'os';

/**
 * 全局配置根目录（跨平台）。
 *
 * - Win: %APPDATA% (优先) → %LOCALAPPDATA% → ~/AppData/Roaming
 * - mac: ~/Library/Application Support
 * - Linux/其他: $XDG_CONFIG_HOME (优先) → ~/.config
 *
 * os.homedir() Win 返 %USERPROFILE%（C:\Users\xxx），非 %APPDATA%；Claude Desktop /
 * Cline / Zed / Trae / Cherry Studio 的全局配置在 %APPDATA% 下，故须 env 优先定位
 * Roaming，而非直接用 homedir()。参考 spec §3.3。
 */
export function globalConfigRoot(): string {
  switch (process.platform) {
    case 'win32':
      return process.env.APPDATA
        ?? process.env.LOCALAPPDATA
        ?? join(homedir(), 'AppData', 'Roaming');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support');
    default:
      return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run test/cli/clients/json-config.test.ts test/cli/clients/paths.test.ts`
Expected: PASS（全部）

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`
Expected: 0 errors

```bash
git add src/cli/clients/json-config.ts src/cli/clients/paths.ts test/cli/clients/json-config.test.ts test/cli/clients/paths.test.ts
git commit -m "feat(cli): json-config 加 stripBom/readJsonForCheck + paths globalConfigRoot

BOM 防御基础设施：stripBom 复用于 readJsonConfigWithBackup(configure) 与
readJsonForCheck(isConfigured)，避免带 BOM 合法配置被 isConfigured 误判。
paths.globalConfigRoot 跨平台定位全局配置根（env 优先）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: types.ts 加 scope + 现有 4 adapter 补 scope 声明

**Files:**
- Modify: `src/cli/clients/types.ts`, `src/cli/clients/claude-code.ts`, `src/cli/clients/cursor.ts`, `src/cli/clients/opencode.ts`, `src/cli/clients/codex.ts`
- Test: `test/cli/clients/{claude-code,cursor,opencode,codex}.test.ts`（加 scope 断言）

**Interfaces:**
- Produces: `ClientAdapter.scope: 'project' | 'global'`（必需属性，TS 挡住漏表态）
- Consumes: 无新依赖（scope 是字面量声明）

**scope 取值**（spec §2 表）：Claude Code/Cursor/OpenCode = `project`；Codex = `global`。

- [ ] **Step 1: 改造 types.ts（加 scope + 注释）**

用 Write 覆盖 `src/cli/clients/types.ts`：

```ts
/**
 * ClientAdapter — 统一的 AI 客户端配置接口。
 *
 * 按 configure() 实现方式分两类范式（detect() 探测方式与范式正交，另说）：
 * - 文件写入型（Claude Code、Cursor、OpenCode）：读写配置文件（readJsonConfigWithBackup + 原子 tmp+rename）
 * - CLI 调用型（Codex）：调用 CLI 子命令（execFile 分别传参，不拼字符串防注入）
 *
 * 注：OpenCode 原为 CLI 型，因 `opencode mcp add` 是交互式 prompts、非交互 execFile 会挂起超时（IMPORTANT-6），
 * 改文件型读写 opencode.json；仅 detect() 仍走 `opencode --version`。
 *
 * detect() 探测方式与范式正交：文件型 adapter 多用 existsSync(配置目录/文件)，CLI 型用 execFile --version。
 *
 * scope: 'project' = 配置写入项目目录（projectDir 生效）；'global' = 配置写入用户全局目录
 *        （projectDir 为 no-op，adapter 内部用 globalConfigRoot()/homedir() 定位）。
 */
export interface ClientAdapter {
  name: string;
  scope: 'project' | 'global';
  /** 客户端是否已安装 */
  detect(): Promise<boolean>;
  /** godot MCP 是否已配置（project scope 用 projectDir；global scope 忽略 projectDir） */
  isConfigured(projectDir: string): Promise<boolean>;
  /** 将 godot MCP 配置写入该客户端 */
  configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void>;
}
```

- [ ] **Step 2: 现有 4 adapter 补 scope 属性**

claude-code.ts: 在 `name = 'Claude Code';` 下一行加 `scope = 'project' as const;`
cursor.ts: 在 `name = 'Cursor';` 下一行加 `scope = 'project' as const;`
opencode.ts: 在 `name = 'OpenCode';` 下一行加 `scope = 'project' as const;`
codex.ts: 在 `name = 'Codex';` 下一行加 `scope = 'global' as const;`

（4 个 Edit，同文件各自独立文件，可并行 Edit 不同文件；同文件单 Edit）

- [ ] **Step 3: 现有 4 测试加 scope 断言**

每个测试文件的 `it('has correct name', ...)` 后追加 scope 断言。例如 claude-code.test.ts：

```ts
  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });
```

codex.test.ts（CLI 型，动态 import）：

```ts
  it('has global scope', async () => {
    const { CodexAdapter } = await import('../../../src/cli/clients/codex.js');
    const adapter = new CodexAdapter();
    expect(adapter.scope).toBe('global');
  });
```

cursor.test.ts → `expect(adapter.scope).toBe('project');`；opencode.test.ts → 同。

- [ ] **Step 4: 运行测试 + tsc**

Run: `npx vitest run test/cli/clients/ && npx tsc --noEmit`
Expected: PASS + 0 errors（scope 必需属性已由 4 adapter 满足）

- [ ] **Step 5: commit**

```bash
git add src/cli/clients/types.ts src/cli/clients/claude-code.ts src/cli/clients/cursor.ts src/cli/clients/opencode.ts src/cli/clients/codex.ts test/cli/clients/
git commit -m "feat(cli): ClientAdapter 加必需 scope 属性 + 现有 4 adapter 补声明

scope='project'|'global' 必需属性让 TS 挡住 13 个 adapter 漏表态。现有 4：
ClaudeCode/Cursor/OpenCode=project，Codex=global。types.ts 注释按 configure()
范式重写（spec §1.2，修正 OpenCode 错归 CLI 型）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 现有 3 文件型 adapter isConfigured 改 readJsonForCheck + OpenCode user-state

**Files:**
- Modify: `src/cli/clients/claude-code.ts`, `src/cli/clients/cursor.ts`, `src/cli/clients/opencode.ts`
- Test: `test/cli/clients/{claude-code,cursor,opencode}.test.ts`（加 BOM 联动 + OpenCode user-state）

**Interfaces:**
- Consumes: `readJsonForCheck`（Task 1 产物）
- Produces: 现有 3 文件型 adapter 的 isConfigured 统一经 readJsonForCheck（BOM 安全）；OpenCode 的 `USER_STATE_KEYS = ['enabled']` merge 机制（后续 user-state adapter 复用此模式）

- [ ] **Step 1: claude-code.ts isConfigured 改 readJsonForCheck**

改 import 行（加 readJsonForCheck，去 readFileSync——readFileSync 不再用于 isConfigured，但 configure 不用 readFileSync 故可全去）：

`import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';`
→ `import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';`

`import { readJsonConfigWithBackup } from './json-config.js';`
→ `import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';`

isConfigured 方法替换为：

```ts
  async isConfigured(projectDir: string): Promise<boolean> {
    const settingsPath = join(projectDir, '.claude', 'settings.json');
    const content = readJsonForCheck(settingsPath);
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }
```

cursor.ts 同模式改造（路径 `.cursor/mcp.json`，key `mcpServers`）。

- [ ] **Step 2: opencode.ts isConfigured 改 readJsonForCheck + configure 加 user-state**

import 改造：去 `readFileSync`，加 `readJsonForCheck`（readJsonConfigWithBackup 已在）。

isConfigured 替换：

```ts
  async isConfigured(projectDir: string): Promise<boolean> {
    const configPath = join(projectDir, 'opencode.json');
    const content = readJsonForCheck(configPath);
    if (!content) return false;
    return !!(content.mcp as Record<string, unknown> | undefined)?.godot;
  }
```

configure 加 user-state 白名单 merge（保留旧 `enabled`）：

```ts
  private static readonly USER_STATE_KEYS = ['enabled'] as const;

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = join(projectDir, 'opencode.json');
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcp) config.mcp = {};
    const mcp = config.mcp as Record<string, Record<string, unknown>>;
    // user-state 保留：读旧 entry 的白名单字段 merge 进新 entry（首次创建 seed 默认）
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of OpenCodeAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
    }
    mcp.godot = {
      ...preserved,
      type: 'local',
      command: [mcpCommand, ...mcpArgs],
      environment: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(projectDir, `.opencode.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
```

- [ ] **Step 3: claude-code.test.ts 加 BOM 联动测试**

在 `configure backs up corrupted` 测试后追加：

```ts
  it('isConfigured returns true for BOM-prefixed valid JSON (BOM 防御)', async () => {
    const claudeDir = join(testDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '\uFEFF' + JSON.stringify({
      mcpServers: { godot: { command: 'npx' } },
    }));
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });
```

cursor.test.ts 同模式（路径 `.cursor/mcp.json`）。

- [ ] **Step 4: opencode.test.ts 加 BOM + user-state 测试**

```ts
  it('isConfigured returns true for BOM-prefixed valid JSON (BOM 防御)', async () => {
    writeFileSync(join(testDir, 'opencode.json'), '\uFEFF' + JSON.stringify({
      mcp: { godot: { type: 'local', command: ['npx'] } },
    }));
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });

  it('configure preserves existing enabled user-state (reconfigure)', async () => {
    writeFileSync(join(testDir, 'opencode.json'), JSON.stringify({
      mcp: { godot: { type: 'local', command: ['old'], enabled: false } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(testDir, 'opencode.json'), 'utf-8'));
    expect(config.mcp.godot.enabled).toBe(false);   // 用户旧值保留
    expect(config.mcp.godot.command).toEqual(['npx', 'godot-mcp-enhanced']); // 配置更新
  });
```

注：opencode.test.ts 需 import readFileSync（若未 import）。testDir 用 mkdtempSync 模式（与 claude-code.test.ts 一致，若 opencode.test.ts 现状用别的 tmpdir 模式则对齐现有）。

- [ ] **Step 5: 运行测试 + tsc**

Run: `npx vitest run test/cli/clients/ && npx tsc --noEmit`
Expected: PASS + 0 errors

- [ ] **Step 6: commit**

```bash
git add src/cli/clients/claude-code.ts src/cli/clients/cursor.ts src/cli/clients/opencode.ts test/cli/clients/
git commit -m "fix(cli): 文件型 adapter isConfigured 改 readJsonForCheck + OpenCode user-state

isConfigured 统一经 readJsonForCheck（BOM 安全 + 不抛错），修复带 BOM 合法配置
被误判 not configured → doctor 误报 + setup 破坏幂等。OpenCode 加 USER_STATE_KEYS
白名单 merge，reconfigure 保留旧 enabled 值。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Claude Desktop + Windsurf adapter（global，无 user-state）

**Files:**
- Create: `src/cli/clients/claude-desktop.ts`, `src/cli/clients/windsurf.ts`
- Test: `test/cli/clients/claude-desktop.test.ts`, `test/cli/clients/windsurf.test.ts`

**Interfaces:**
- Consumes: `readJsonConfigWithBackup`, `readJsonForCheck`（Task 1），`globalConfigRoot`（Task 1），`ClientAdapter`（Task 2 含 scope）
- Produces: `ClaudeDesktopAdapter`（scope='global'，路径 `globalConfigRoot()/Claude/claude_desktop_config.json`，key mcpServers），`WindsurfAdapter`（scope='global'，路径 `homedir()/.codeium/windsurf/mcp_config.json`，key mcpServers）

- [ ] **Step 1: 写 claude-desktop.test.ts 失败测试**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ClaudeDesktopAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    expect(new ClaudeDesktopAdapter().scope).toBe('global');
  });

  it('configure writes mcpServers.godot to global path', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    const adapter = new ClaudeDesktopAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const configPath = join(fakeRoot, 'Claude', 'claude_desktop_config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    // projectDir 对 global scope 是 no-op
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure (反向断言)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    const adapter = new ClaudeDesktopAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns false when no config', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cd-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClaudeDesktopAdapter } = await import('../../../src/cli/clients/claude-desktop.js');
    expect(await new ClaudeDesktopAdapter().isConfigured('/ignored')).toBe(false);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/cli/clients/claude-desktop.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 claude-desktop.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class ClaudeDesktopAdapter implements ClientAdapter {
  name = 'Claude Desktop';
  scope = 'global' as const;

  private configPath(): string {
    return join(globalConfigRoot(), 'Claude', 'claude_desktop_config.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    (config.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.claude_desktop_config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/cli/clients/claude-desktop.test.ts`
Expected: PASS

- [ ] **Step 5: 写 windsurf.test.ts + windsurf.ts**

windsurf.test.ts（同 claude-desktop.test.ts 模式，mock paths 改为 mock `os.homedir` 或 mock 文件路径——Windsurf 用 `homedir()/.codeium/windsurf/`，需 mock os 模块）。简化方案：vi.doMock('os', () => ({ homedir: () => fakeHome }))：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('WindsurfAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { WindsurfAdapter } = await import('../../../src/cli/clients/windsurf.js');
    expect(new WindsurfAdapter().scope).toBe('global');
  });

  it('configure writes mcpServers.godot to ~/.codeium/windsurf/', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ws-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const { WindsurfAdapter } = await import('../../../src/cli/clients/windsurf.js');
    const adapter = new WindsurfAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const configPath = join(fakeHome, '.codeium', 'windsurf', 'mcp_config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure (反向断言)', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ws-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const { WindsurfAdapter } = await import('../../../src/cli/clients/windsurf.js');
    const adapter = new WindsurfAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
```

`src/cli/clients/windsurf.ts`：

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

export class WindsurfAdapter implements ClientAdapter {
  name = 'Windsurf';
  scope = 'global' as const;

  private configPath(): string {
    // 官方仅文档化全局路径 ~/.codeium/windsurf/mcp_config.json（Win 用 %USERPROFILE%）
    return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    (config.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.mcp_config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 6: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/claude-desktop.test.ts test/cli/clients/windsurf.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/claude-desktop.ts src/cli/clients/windsurf.ts test/cli/clients/claude-desktop.test.ts test/cli/clients/windsurf.test.ts
git commit -m "feat(cli): Claude Desktop + Windsurf adapter (global, mcpServers)

Claude Desktop: globalConfigRoot()/Claude/claude_desktop_config.json。
Windsurf: homedir()/.codeium/windsurf/mcp_config.json（官方仅全局）。
两者均 stdio 无 type、无 user-state。不需 uvx 桥（enhanced 本身 stdio）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Zed + Trae adapter（global，无 user-state）

**Files:**
- Create: `src/cli/clients/zed.ts`, `src/cli/clients/trae.ts`
- Test: `test/cli/clients/zed.test.ts`, `test/cli/clients/trae.test.ts`

**Interfaces:**
- Consumes: 同 Task 4
- Produces: `ZedAdapter`（key **`context_servers`** 非 mcpServers，路径 `globalConfigRoot()/Zed/settings.json`），`TraeAdapter`（key mcpServers，路径 `globalConfigRoot()/Trae/User/mcp.json`，type 保守不加）

**注意**：Zed 的 server_key 是 `context_servers`（非 mcpServers），entry 形态 `{command, args, env}` 无 type。Trae type 未确认（docs.trae.ai JS 渲染抓不到），保守不加，注释标「实机验证待定」。

- [ ] **Step 1: 写 zed.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ZedAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    expect(new ZedAdapter().scope).toBe('global');
  });

  it('configure writes context_servers.godot (非 mcpServers)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-zed-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    await new ZedAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, 'Zed', 'settings.json'), 'utf-8'));
    expect(config.context_servers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.context_servers.godot.type).toBeUndefined(); // stdio 无 type
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-zed-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ZedAdapter } = await import('../../../src/cli/clients/zed.js');
    const adapter = new ZedAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 实现 zed.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class ZedAdapter implements ClientAdapter {
  name = 'Zed';
  scope = 'global' as const;

  private configPath(): string {
    return join(globalConfigRoot(), 'Zed', 'settings.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    // Zed 用 context_servers（非 mcpServers）
    return !!(content.context_servers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.context_servers) config.context_servers = {};
    (config.context_servers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.settings.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 3: 写 trae.test.ts + trae.ts**

trae.test.ts（路径 `globalConfigRoot()/Trae/User/mcp.json`，断言 type 不存在）：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TraeAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { TraeAdapter } = await import('../../../src/cli/clients/trae.js');
    expect(new TraeAdapter().scope).toBe('global');
  });

  it('configure writes mcpServers.godot without type (保守)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-trae-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { TraeAdapter } = await import('../../../src/cli/clients/trae.js');
    await new TraeAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, 'Trae', 'User', 'mcp.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.type).toBeUndefined(); // 保守不加，实机验证待定
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-trae-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { TraeAdapter } = await import('../../../src/cli/clients/trae.js');
    const adapter = new TraeAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
```

`src/cli/clients/trae.ts`（结构同 claude-desktop.ts，改路径 + key 名，加 type 待验证注释）：

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class TraeAdapter implements ClientAdapter {
  name = 'Trae';
  scope = 'global' as const;

  private configPath(): string {
    // Trae 是 VS Code fork，全局路径 {APPDATA}/Trae/User/mcp.json
    return join(globalConfigRoot(), 'Trae', 'User', 'mcp.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    // 注：Trae stdio entry 的 type 字段未确认（docs.trae.ai JS 渲染抓不到正文）。
    // 保守不加 type；若实机验证 Trae 要求 type，改加 type:"stdio"（见 spec §3.2 中等不确定项）。
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    (config.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.mcp.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 4: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/zed.test.ts test/cli/clients/trae.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/zed.ts src/cli/clients/trae.ts test/cli/clients/zed.test.ts test/cli/clients/trae.test.ts
git commit -m "feat(cli): Zed + Trae adapter (global)

Zed: key=context_servers（非 mcpServers），globalConfigRoot()/Zed/settings.json。
Trae: globalConfigRoot()/Trae/User/mcp.json，type 字段保守不加（docs.trae.ai
JS 渲染抓不到正文，实机验证待定，spec §3.2）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Cline adapter（global，user-state disabled/autoApprove）

**Files:**
- Create: `src/cli/clients/cline.ts`
- Test: `test/cli/clients/cline.test.ts`

**Interfaces:**
- Consumes: 同 Task 4
- Produces: `ClineAdapter`（scope='global'，路径 `globalConfigRoot()/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`，key mcpServers，`USER_STATE_KEYS=['disabled','autoApprove']`）

- [ ] **Step 1: 写 cline.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ClineAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const clineSubpath = ['Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'];

  it('has global scope', async () => {
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    expect(new ClineAdapter().scope).toBe('global');
  });

  it('configure seeds disabled:false + autoApprove:[] on first create', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cline-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    await new ClineAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, ...clineSubpath), 'utf-8'));
    expect(config.mcpServers.godot.disabled).toBe(false);
    expect(config.mcpServers.godot.autoApprove).toEqual([]);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('configure preserves user disabled + autoApprove on reconfigure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cline-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const filePath = join(fakeRoot, ...clineSubpath);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcpServers: { godot: { command: 'old', disabled: true, autoApprove: ['tool1'] } },
    }));
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    await new ClineAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcpServers.godot.disabled).toBe(true);            // 用户旧值保留
    expect(config.mcpServers.godot.autoApprove).toEqual(['tool1']); // 用户旧值保留
    expect(config.mcpServers.godot.command).toBe('npx');            // 配置更新
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cline-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { ClineAdapter } = await import('../../../src/cli/clients/cline.js');
    const adapter = new ClineAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 实现 cline.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class ClineAdapter implements ClientAdapter {
  name = 'Cline';
  scope = 'global' as const;

  // user-state 白名单（reconfigure 保留，首次创建 seed 默认）
  private static readonly USER_STATE_KEYS = ['disabled', 'autoApprove'] as const;
  private static readonly USER_STATE_DEFAULTS: Record<string, unknown> = { disabled: false, autoApprove: [] };

  private configPath(): string {
    // VS Code globalStorage 路径（Cline 是 VS Code 扩展，唯一稳定 MCP 配置位置）
    return join(globalConfigRoot(), 'Code', 'User', 'globalStorage',
      'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of ClineAdapter.USER_STATE_KEYS) {
      preserved[key] = key in oldEntry ? oldEntry[key] : ClineAdapter.USER_STATE_DEFAULTS[key];
    }
    mcp.godot = {
      ...preserved,
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.cline_mcp_settings.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 3: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/cline.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/cline.ts test/cli/clients/cline.test.ts
git commit -m "feat(cli): Cline adapter (global, user-state disabled/autoApprove)

VS Code globalStorage 路径。USER_STATE_KEYS=['disabled','autoApprove'] 白名单
merge：reconfigure 保留用户旧值，首次创建 seed {disabled:false, autoApprove:[]}。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Antigravity adapter（global，user-state disabled/disabledTools，双路径）

**Files:**
- Create: `src/cli/clients/antigravity.ts`
- Test: `test/cli/clients/antigravity.test.ts`

**Interfaces:**
- Produces: `AntigravityAdapter`（scope='global'，主路径 `homedir()/.gemini/config/mcp_config.json`，旧路径 `homedir()/.gemini/antigravity/mcp_config.json` 兼容 detect/isConfigured；key mcpServers；`USER_STATE_KEYS=['disabled','disabledTools']`）

- [ ] **Step 1: 写 antigravity.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AntigravityAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { AntigravityAdapter } = await import('../../../src/cli/clients/antigravity.js');
    expect(new AntigravityAdapter().scope).toBe('global');
  });

  it('configure writes to new ~/.gemini/config/ path + seeds disabled:false', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ag-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const { AntigravityAdapter } = await import('../../../src/cli/clients/antigravity.js');
    await new AntigravityAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeHome, '.gemini', 'config', 'mcp_config.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.disabled).toBe(false);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('isConfigured recognizes legacy ~/.gemini/antigravity/ path (双路径兼容)', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ag-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const legacyPath = join(fakeHome, '.gemini', 'antigravity', 'mcp_config.json');
    mkdirSync(join(legacyPath, '..'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ mcpServers: { godot: { command: 'npx' } } }));
    const { AntigravityAdapter } = await import('../../../src/cli/clients/antigravity.js');
    expect(await new AntigravityAdapter().isConfigured('/ignored')).toBe(true);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('configure preserves disabled + disabledTools on reconfigure', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'mcp-ag-'));
    vi.doMock('os', () => ({ homedir: () => fakeHome }));
    const filePath = join(fakeHome, '.gemini', 'config', 'mcp_config.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcpServers: { godot: { command: 'old', disabled: true, disabledTools: ['t1'] } },
    }));
    const { AntigravityAdapter } = await import('../../../src/cli/clients/antigravity.js');
    await new AntigravityAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcpServers.godot.disabled).toBe(true);
    expect(config.mcpServers.godot.disabledTools).toEqual(['t1']);
    expect(config.mcpServers.godot.command).toBe('npx');
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 实现 antigravity.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

export class AntigravityAdapter implements ClientAdapter {
  name = 'Antigravity';
  scope = 'global' as const;

  private static readonly USER_STATE_KEYS = ['disabled', 'disabledTools'] as const;
  private static readonly USER_STATE_DEFAULTS: Record<string, unknown> = { disabled: false, disabledTools: [] };

  // 当前官方路径（Antigravity 2.0/IDE/CLI/SDK 共享）
  private newPath(): string {
    return join(homedir(), '.gemini', 'config', 'mcp_config.json');
  }
  // 旧 IDE 路径（兼容 detect/isConfigured）
  private legacyPath(): string {
    return join(homedir(), '.gemini', 'antigravity', 'mcp_config.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.newPath()) || existsSync(this.legacyPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    for (const path of [this.newPath(), this.legacyPath()]) {
      const content = readJsonForCheck(path);
      if (content && (content.mcpServers as Record<string, unknown> | undefined)?.godot) return true;
    }
    return false;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    // 写新路径；读旧 entry 优先从已存在的路径（新或旧）取 user-state
    const configPath = this.newPath();
    const existingPath = existsSync(this.newPath()) ? this.newPath()
      : existsSync(this.legacyPath()) ? this.legacyPath() : configPath;
    const config = readJsonConfigWithBackup(existingPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of AntigravityAdapter.USER_STATE_KEYS) {
      preserved[key] = key in oldEntry ? oldEntry[key] : AntigravityAdapter.USER_STATE_DEFAULTS[key];
    }
    mcp.godot = {
      ...preserved,
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const tmpPath = join(configDir, `.mcp_config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 3: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/antigravity.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/antigravity.ts test/cli/clients/antigravity.test.ts
git commit -m "feat(cli): Antigravity adapter (global, 双路径兼容)

写入新 ~/.gemini/config/mcp_config.json（当前官方），detect/isConfigured 兼容
旧 ~/.gemini/antigravity/。USER_STATE_KEYS=['disabled','disabledTools'] merge。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Cherry Studio adapter（global，user-state isActive/installSource，type:"stdio"）

**Files:**
- Create: `src/cli/clients/cherry-studio.ts`
- Test: `test/cli/clients/cherry-studio.test.ts`

**Interfaces:**
- Produces: `CherryStudioAdapter`（scope='global'，路径 `globalConfigRoot()/CherryStudio/mcp_servers.json`，key mcpServers，entry 含 **`type:"stdio"`**，`USER_STATE_KEYS=['isActive','installSource']`）

**实机验证提醒**：spec §3.3 标注 Cherry Studio `mcp_servers.json` 可读写性中等不确定（运行时存 IndexDB，但 Godot AI + issue #8254 暗示文件可读写）。实施前若有 Cherry Studio 环境可实机查 `%APPDATA%\CherryStudio\` 实际文件名；无环境则按 Godot AI 源码路径实现。

- [ ] **Step 1: 写 cherry-studio.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CherryStudioAdapter', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('has global scope', async () => {
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    expect(new CherryStudioAdapter().scope).toBe('global');
  });

  it('configure writes type:stdio + seeds isActive:true (schema 强制 type)', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cs-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    await new CherryStudioAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(fakeRoot, 'CherryStudio', 'mcp_servers.json'), 'utf-8'));
    expect(config.mcpServers.godot.type).toBe('stdio'); // schema enum 强制
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.isActive).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('configure preserves isActive + installSource on reconfigure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cs-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const filePath = join(fakeRoot, 'CherryStudio', 'mcp_servers.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcpServers: { godot: { type: 'stdio', command: 'old', isActive: false, installSource: 'manual' } },
    }));
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    await new CherryStudioAdapter().configure('/ignored', '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcpServers.godot.isActive).toBe(false);
    expect(config.mcpServers.godot.installSource).toBe('manual');
    expect(config.mcpServers.godot.type).toBe('stdio');
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it('isConfigured returns true after configure', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'mcp-cs-'));
    vi.doMock('../../../src/cli/clients/paths.js', () => ({ globalConfigRoot: () => fakeRoot }));
    const { CherryStudioAdapter } = await import('../../../src/cli/clients/cherry-studio.js');
    const adapter = new CherryStudioAdapter();
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
    rmSync(fakeRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 实现 cherry-studio.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class CherryStudioAdapter implements ClientAdapter {
  name = 'Cherry Studio';
  scope = 'global' as const;

  private static readonly USER_STATE_KEYS = ['isActive', 'installSource'] as const;
  private static readonly USER_STATE_DEFAULTS: Record<string, unknown> = { isActive: true };

  private configPath(): string {
    // CherryStudio 驼峰目录（非 .cherrystudio），GUI 应用仅全局
    return join(globalConfigRoot(), 'CherryStudio', 'mcp_servers.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of CherryStudioAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
      else if (key in CherryStudioAdapter.USER_STATE_DEFAULTS) preserved[key] = CherryStudioAdapter.USER_STATE_DEFAULTS[key];
    }
    mcp.godot = {
      ...preserved,
      type: 'stdio', // Cherry Studio schema enum 强制（缺 type 破坏传输协商）
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.mcp_servers.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 3: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/cherry-studio.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/cherry-studio.ts test/cli/clients/cherry-studio.test.ts
git commit -m "feat(cli): Cherry Studio adapter (global, type:stdio + user-state)

globalConfigRoot()/CherryStudio/mcp_servers.json。entry 含 type:\"stdio\"
（schema enum 强制，唯一需 type 的 client）。USER_STATE_KEYS=['isActive','installSource']。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Gemini CLI adapter（project，user-state trust/timeout/includeTools/excludeTools）

**Files:**
- Create: `src/cli/clients/gemini-cli.ts`
- Test: `test/cli/clients/gemini-cli.test.ts`

**Interfaces:**
- Produces: `GeminiCliAdapter`（scope=**'project'**，路径 `{project}/.gemini/settings.json`，key mcpServers，`USER_STATE_KEYS=['trust','timeout','includeTools','excludeTools']`）

- [ ] **Step 1: 写 gemini-cli.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GeminiCliAdapter } from '../../../src/cli/clients/gemini-cli.js';

describe('GeminiCliAdapter', () => {
  const adapter = new GeminiCliAdapter();
  let testDir: string;

  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'mcp-gem-')); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });

  it('configure writes mcpServers.godot to {project}/.gemini/settings.json', async () => {
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(testDir, '.gemini', 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.type).toBeUndefined(); // stdio 无 type
  });

  it('configure preserves trust + includeTools on reconfigure', async () => {
    const dir = join(testDir, '.gemini');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      mcpServers: { godot: { command: 'old', trust: true, includeTools: ['t1'], timeout: 30000 } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.trust).toBe(true);
    expect(config.mcpServers.godot.includeTools).toEqual(['t1']);
    expect(config.mcpServers.godot.timeout).toBe(30000);
    expect(config.mcpServers.godot.command).toBe('npx');
  });

  it('isConfigured returns true after configure', async () => {
    await adapter.configure(testDir, '/godot', 'npx', []);
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });
});
```

- [ ] **Step 2: 实现 gemini-cli.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

export class GeminiCliAdapter implements ClientAdapter {
  name = 'Gemini CLI';
  scope = 'project' as const;

  // user-state 字段（官方默认无 seed，reconfigure 仅保留已存在的旧值）
  private static readonly USER_STATE_KEYS = ['trust', 'timeout', 'includeTools', 'excludeTools'] as const;

  async detect(): Promise<boolean> {
    return existsSync(join(process.cwd(), '.gemini', 'settings.json'));
  }

  async isConfigured(projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(join(projectDir, '.gemini', 'settings.json'));
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const geminiDir = join(projectDir, '.gemini');
    const configPath = join(geminiDir, 'settings.json');
    if (!existsSync(geminiDir)) mkdirSync(geminiDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of GeminiCliAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
    }
    mcp.godot = {
      ...preserved,
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(geminiDir, `.settings.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 3: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/gemini-cli.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/gemini-cli.ts test/cli/clients/gemini-cli.test.ts
git commit -m "feat(cli): Gemini CLI adapter (project, user-state)

{project}/.gemini/settings.json（官方 --scope 默认 project）。USER_STATE_KEYS=
['trust','timeout','includeTools','excludeTools']，reconfigure 仅保留已存在旧值（无 seed）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Qwen Code adapter（project，user-state trust/includeTools/excludeTools/timeout/description）

**Files:**
- Create: `src/cli/clients/qwen-code.ts`
- Test: `test/cli/clients/qwen-code.test.ts`

**Interfaces:**
- Produces: `QwenCodeAdapter`（scope='project'，路径 `{project}/.qwen/settings.json`，key mcpServers，`USER_STATE_KEYS=['trust','includeTools','excludeTools','timeout','description']`）

- [ ] **Step 1: 写 qwen-code.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { QwenCodeAdapter } from '../../../src/cli/clients/qwen-code.js';

describe('QwenCodeAdapter', () => {
  const adapter = new QwenCodeAdapter();
  let testDir: string;

  beforeEach(() => { testDir = mkdtempSync(join(tmpdir(), 'mcp-qwen-')); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it('has project scope', () => {
    expect(adapter.scope).toBe('project');
  });

  it('configure writes mcpServers.godot to {project}/.qwen/settings.json', async () => {
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(testDir, '.qwen', 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.env.GODOT_PATH).toBe('/godot');
    expect(config.mcpServers.godot.type).toBeUndefined();
  });

  it('configure preserves trust + excludeTools + description on reconfigure', async () => {
    const dir = join(testDir, '.qwen');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      mcpServers: { godot: { command: 'old', trust: true, excludeTools: ['t1'], description: 'my server' } },
    }));
    await adapter.configure(testDir, '/godot', 'npx', ['godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'));
    expect(config.mcpServers.godot.trust).toBe(true);
    expect(config.mcpServers.godot.excludeTools).toEqual(['t1']);
    expect(config.mcpServers.godot.description).toBe('my server');
    expect(config.mcpServers.godot.command).toBe('npx');
  });

  it('isConfigured returns true after configure', async () => {
    await adapter.configure(testDir, '/godot', 'npx', []);
    expect(await adapter.isConfigured(testDir)).toBe(true);
  });
});
```

- [ ] **Step 2: 实现 qwen-code.ts**

```ts
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

export class QwenCodeAdapter implements ClientAdapter {
  name = 'Qwen Code';
  scope = 'project' as const;

  private static readonly USER_STATE_KEYS = ['trust', 'includeTools', 'excludeTools', 'timeout', 'description'] as const;

  async detect(): Promise<boolean> {
    return existsSync(join(process.cwd(), '.qwen', 'settings.json'));
  }

  async isConfigured(projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(join(projectDir, '.qwen', 'settings.json'));
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const qwenDir = join(projectDir, '.qwen');
    const configPath = join(qwenDir, 'settings.json');
    if (!existsSync(qwenDir)) mkdirSync(qwenDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of QwenCodeAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
    }
    mcp.godot = {
      ...preserved,
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(qwenDir, `.settings.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 3: 运行测试 + tsc + commit**

Run: `npx vitest run test/cli/clients/qwen-code.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/qwen-code.ts test/cli/clients/qwen-code.test.ts
git commit -m "feat(cli): Qwen Code adapter (project, user-state)

{project}/.qwen/settings.json（官方 --scope 默认 project）。USER_STATE_KEYS=
['trust','includeTools','excludeTools','timeout','description']。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: index.ts 注册 9 新 + setup/doctor 日志标 scope

**Files:**
- Modify: `src/cli/clients/index.ts`, `src/cli/setup.ts`, `src/cli/doctor.ts`
- Test: `test/cli/setup.test.ts`, `test/cli/doctor.test.ts`（加 scope 日志断言）

**Interfaces:**
- Consumes: Task 4-10 的 9 新 adapter 类
- Produces: `ALL_ADAPTERS` 含 13 adapter；setup/doctor 日志每行带 `(global)`/`(project)` 标注

- [ ] **Step 1: 改 index.ts 注册 9 新**

用 Write 覆盖 `src/cli/clients/index.ts`：

```ts
/** 统一导出所有客户端适配器 + ALL_ADAPTERS 列表 */
import type { ClientAdapter } from './types.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CursorAdapter } from './cursor.js';
import { OpenCodeAdapter } from './opencode.js';
import { CodexAdapter } from './codex.js';
import { ClaudeDesktopAdapter } from './claude-desktop.js';
import { WindsurfAdapter } from './windsurf.js';
import { ClineAdapter } from './cline.js';
import { ZedAdapter } from './zed.js';
import { AntigravityAdapter } from './antigravity.js';
import { TraeAdapter } from './trae.js';
import { CherryStudioAdapter } from './cherry-studio.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { QwenCodeAdapter } from './qwen-code.js';

export type { ClientAdapter } from './types.js';
export {
  ClaudeCodeAdapter, CursorAdapter, OpenCodeAdapter, CodexAdapter,
  ClaudeDesktopAdapter, WindsurfAdapter, ClineAdapter, ZedAdapter,
  AntigravityAdapter, TraeAdapter, CherryStudioAdapter, GeminiCliAdapter, QwenCodeAdapter,
};

export const ALL_ADAPTERS: ClientAdapter[] = [
  // project scope
  new ClaudeCodeAdapter(),
  new CursorAdapter(),
  new OpenCodeAdapter(),
  new GeminiCliAdapter(),
  new QwenCodeAdapter(),
  // global scope
  new CodexAdapter(),
  new ClaudeDesktopAdapter(),
  new WindsurfAdapter(),
  new ClineAdapter(),
  new ZedAdapter(),
  new AntigravityAdapter(),
  new TraeAdapter(),
  new CherryStudioAdapter(),
];
```

- [ ] **Step 2: 改 setup.ts 日志标 scope**

setup.ts 三处日志行加 scope 标注（行 59、65、71、74）。例如：

`console.log(\`  ⊘ ${adapter.name}: not installed, skipping\`);`
→ `console.log(\`  ⊘ ${adapter.name} (${adapter.scope}): not installed, skipping\`);`

`console.log(\`  ✓ ${adapter.name}: already configured\`);`
→ `console.log(\`  ✓ ${adapter.name} (${adapter.scope}): already configured\`);`

`console.log(\`  ✓ ${adapter.name}: configured\`);`
→ `console.log(\`  ✓ ${adapter.name} (${adapter.scope}): configured\`);`

`console.error(\`  ✗ ${adapter.name}: ${getErrorMessage(err)}\`);`
→ `console.error(\`  ✗ ${adapter.name} (${adapter.scope}): ${getErrorMessage(err)}\`);`

（4 个 Edit，同文件须串行）

- [ ] **Step 3: 改 doctor.ts 日志标 scope**

doctor.ts 行 56 + 61 加 scope：

`console.log(status(false, \`${adapter.name}: not installed\`));`
→ `console.log(status(false, \`${adapter.name} (${adapter.scope}): not installed\`));`

`console.log(status(ok, \`${adapter.name}: ${detail}\`));`
→ `console.log(status(ok, \`${adapter.name} (${adapter.scope}): ${detail}\`));`

（2 个 Edit，同文件须串行）

- [ ] **Step 4: setup.test.ts / doctor.test.ts 加 scope 日志断言**

读现有 test/cli/setup.test.ts 与 doctor.test.ts，在各自主测例里加断言：捕获 console.log 输出，验证至少一行含 `(global)` 或 `(project)`。若现有测试用 vi.spyOn(console,'log') 模式则复用；否则加：

```ts
// 例：setup.test.ts 里某个跑完 runSetup 的测例
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
// ... runSetup 执行 ...
expect(logSpy.mock.calls.some(c => /\((global|project)\)/.test(c[0] ?? ''))).toBe(true);
logSpy.mockRestore();
```

（具体断言位置读现有测试结构后对齐——若现有 setup.test.ts/doctor.test.ts 不便加日志断言，则新增一个最小测例 mock ALL_ADAPTERS 跑日志即可）

- [ ] **Step 5: 运行全量 + tsc + commit**

Run: `npx vitest run test/cli/ && npx tsc --noEmit`
Expected: PASS + 0 errors

```bash
git add src/cli/clients/index.ts src/cli/setup.ts src/cli/doctor.ts test/cli/setup.test.ts test/cli/doctor.test.ts
git commit -m "feat(cli): 注册 9 新 adapter (4→13) + setup/doctor 日志标 scope

ALL_ADAPTERS 含 13 adapter（project 5 + global 8）。setup/doctor 日志每行
带 (global)/(project) 标注，让用户知情改了哪些全局配置（混合 scope 透明度）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: CHANGELOG + 全量验证

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:** 无（文档收尾）

- [ ] **Step 1: 写 CHANGELOG 条目**

读 `CHANGELOG.md` 现有顶部格式，在 [Unreleased]（或最新版本段）追加：

```markdown
### CLI: Client Adapters Expansion

- AI 客户端配置 adapter 从 4 个扩到 **13 个**（+9：Claude Desktop / Windsurf / Cline / Zed / Gemini CLI / Antigravity / Trae / Cherry Studio / Qwen Code），对标 Godot AI 19 client auto-configure
- `ClientAdapter` 接口加必需 `scope: 'project' | 'global'` 属性
- scope 分布（plan 前置核实）：**global 8**（Codex/Claude Desktop/Windsurf/Cline/Zed/Antigravity/Trae/Cherry Studio）+ **project 5**（Claude Code/Cursor/OpenCode/Gemini CLI/Qwen Code）
- BOM 防御：`json-config.ts` 加 `stripBom` + `readJsonForCheck`，所有文件型 adapter 的 `isConfigured` 统一经 `readJsonForCheck`（修复带 BOM 合法配置被误判 → doctor 误报 + setup 破坏幂等）
- user-state 字段 per-client 白名单保留（Cline `disabled`/`autoApprove`、Cherry `isActive`/`installSource`、Antigravity `disabled`/`disabledTools`、Gemini CLI `trust`/`timeout`/`includeTools`/`excludeTools`、Qwen Code `trust`/`includeTools`/`excludeTools`/`timeout`/`description`、OpenCode `enabled`）
- `setup` / `doctor` 日志标 `(global)`/`(project)` 让用户知情改了哪些全局配置
- Cherry Studio entry 含 `type:"stdio"`（schema enum 强制，唯一需 type 的 client）
- 注：client adapter 是 CLI 侧配置，不进 capability-matrix（非 MCP 工具能力）
```

- [ ] **Step 2: 全量验证**

Run:
```bash
npx vitest run
npx tsc --noEmit
npm run lint
```
Expected: 全量 vitest 绿 + tsc 0 + eslint 0

- [ ] **Step 3: 发版门禁（项目 CLAUDE.md 要求）**

Run: 通过 MCP `verify_delivery`（场景树完整性 + 脚本健康 + 性能 + 自定义断言）
Expected: 通过

注：client adapter 改动不涉及 .tscn/.gd/MCP 工具，verify_delivery 主要确认未破坏既有交付。若 verify_delivery 因无关环境问题（如 Godot 未装）失败，记录原因，不阻塞（client adapter 是纯 TS CLI 侧改动）。

- [ ] **Step 4: commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG 记录 client adapter 扩展 (4→13)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 验收对照（spec §4）

| spec §4 | 覆盖 task |
|---|---|
| §4-1 13 adapter 单测 + scope 断言 | Task 2(现有4) + Task 4-10(新9) |
| §4-2 反向断言（configure→isConfigured true） | Task 4-10 各含 |
| §4-3 user-state reconfigure | Task 3(OpenCode) + Task 6-10 |
| §4-4 损坏 JSON 备份 | Task 1（readJsonConfigWithBackup 复用，现有 F3） |
| §4-5 原子 tmp+rename | 所有文件型 adapter（现有模式） |
| §4-6 BOM 防御 | Task 1 + Task 3（isConfigured 改 readJsonForCheck） |
| §4-7 跨平台 mock 含 env | Task 1(paths) + Task 4-8(global mock globalConfigRoot/homedir) |
| §4-8 global 幂等 | Task 4-10 反向断言含（连续 configure 不重复） |
| §4-9 setup/doctor 日志标 scope | Task 11 |
| §4-10 全量 vitest + tsc + eslint | Task 12 |
| §4-11 types.ts 注释修正 | Task 2 |
| §4-12 type 字段（Cherry stdio / Trae 不含） | Task 5(Trae) + Task 8(Cherry) |
| §4-13 Antigravity 双路径兼容 | Task 7 |
| §4-14 CHANGELOG | Task 12 |
