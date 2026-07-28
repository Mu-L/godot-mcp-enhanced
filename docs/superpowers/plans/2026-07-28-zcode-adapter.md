# ZCode Client Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `ZCodeAdapter`（global scope），让 `setup` 一键配置 / `doctor` 诊断自动覆盖 ZCode 客户端，补齐 review 识别的真实缺口（`docs/使用指南-ZCode.md` 有文档、`src/cli/clients/` 无 adapter，用户实际在用 ZCode）。

**Architecture:** 抄 `cherry-studio.ts` 模板（同为 global scope + schema 强制 `type:"stdio"` + user-state 白名单保留 + 原子 tmp+rename）。三处关键差异：① 路径用 `homedir()/.zcode/cli/config.json`（**非** `globalConfigRoot()` 的 `%APPDATA%`——ZCode 配置在用户家目录，实测确认）；② 嵌套键 `mcp.servers.godot`（**非**顶层 `mcpServers`）；③ 顶层共存的 `plugins`/`hooks` 等键必须保留（readJsonConfigWithBackup 读全量 → 改 mcp.servers → 原子写回，天然保留）。

**Tech Stack:** TypeScript (Node.js ESM), vitest, 现有 `ClientAdapter` 接口（`src/cli/clients/types.ts`）+ 共享 `readJsonConfigWithBackup`/`readJsonForCheck`（`json-config.ts`）。

## Global Constraints（对齐 `2026-07-26-client-adapters-expansion.md` 惯例）

- **stdio entry 形态**：`{ type:'stdio', command, args?, env:{ GODOT_PATH } }`——ZCode 与 Cherry Studio 同属 schema 强制 `type` 一类（实测 `~/.zcode/cli/config.json` 每条 server 都有 `type: stdio|http`，缺则传输协商失败）。
- **scope = global**：ZCode 用户级配置在 `~/.zcode/cli/config.json`（实测用户在用此路径）；`projectDir` 参数 no-op。
- **路径定位**：`join(homedir(), '.zcode', 'cli', 'config.json')`——**用 `os.homedir()`，不用 `globalConfigRoot()`**（后者 Win 走 `%APPDATA%`，ZCode 不在那）。
- **user-state 白名单**：`['enable']`——ZCode 用 `mcp.servers.<name>.enable = false` 禁用 server（实测 figma 条目）；reconfigure 保留旧值，无默认 seed。
- **BOM 防御**：读写经 `json-config.ts` 的 `stripBom`/`readJsonConfigWithBackup`（已含）；写回不带 BOM。
- **顶层键保留**：`readJsonConfigWithBackup` 读全量对象 → 仅改 `config.mcp.servers.godot` → 原子写回；`plugins`/`hooks`/其他 servers 天然保留。
- **client adapter 不进 capability-matrix**（不是 MCP 工具能力）；新增 `src/cli/clients/zcode.ts` **不需要** `npm run build-matrix`，但需要 `npm run build`（产物入 `build/`，AGENTS.md:360）。
- **编辑 .ts 用内置 Edit/Write**（非 .gd）；同文件多 Edit 串行（GateGuard hook）。
- **提交**：中文 + conventional prefix，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。本地 master 提交，不 push origin（除非用户显式要求）。
- **TDD**：Task 1 先写失败测试 → 实现 → 通过 → commit。

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `src/cli/clients/zcode.ts` | `ZCodeAdapter`（global scope，`mcp.servers.godot` 嵌套键 + `type:stdio` + enable user-state 保留） | 新增 |
| `src/cli/clients/index.ts` | `ALL_ADAPTERS` 注册（追加 `new ZCodeAdapter()` + import + 导出） | 改 |
| `test/cli/clients/zcode.test.ts` | `ZCodeAdapter` 单测（scope/detect/configure/isConfigured/user-state/顶层键保留） | 新增 |
| `README.md` / `README.en.md` | 客户端清单加 ZCode（若已有 13 客户端列表） | 改（按需） |

---

## Task 1: ZCodeAdapter 类 + 单元测试（TDD）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\cli\clients\zcode.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\cli\clients\zcode.test.ts`

**Interfaces:**
- Consumes: `ClientAdapter`（`src/cli/clients/types.ts:16-25`，`{ name, scope:'global', detect(), isConfigured(projectDir), configure(projectDir, godotPath, mcpCommand, mcpArgs) }`）；`readJsonConfigWithBackup`/`readJsonForCheck`（`json-config.ts:20,46`）；`homedir`（`os`）。
- Produces: `export class ZCodeAdapter implements ClientAdapter`（供 `index.ts` 注册消费）。

- [ ] **Step 1: 写失败测试**

Create `D:\GitHub\godot-mcp-enhanced\test\cli\clients\zcode.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ZCodeAdapter', () => {
  let fakeHome: string;

  beforeEach(() => {
    vi.resetModules();
    fakeHome = mkdtempSync(join(tmpdir(), 'mcp-zcode-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  // mock os.homedir → fakeHome（ZCode 配置在 ~/.zcode，定位靠 homedir 非 globalConfigRoot）
  async function importAdapter() {
    vi.doMock('os', async (importActual) => {
      const actual = await importActual<typeof import('os')>();
      return { ...actual, homedir: () => fakeHome };
    });
    return (await import('../../../src/cli/clients/zcode.js')).ZCodeAdapter;
  }

  it('has global scope', async () => {
    const ZCodeAdapter = await importAdapter();
    expect(new ZCodeAdapter().scope).toBe('global');
  });

  it('detect returns true when ~/.zcode exists', async () => {
    const ZCodeAdapter = await importAdapter();
    const adapter = new ZCodeAdapter();
    expect(await adapter.detect()).toBe(false); // fakeHome 下尚无 .zcode
    mkdirSync(join(fakeHome, '.zcode'), { recursive: true });
    expect(await adapter.detect()).toBe(true);
  });

  it('configure writes mcp.servers.godot + type:stdio (嵌套键 + schema 强制 type)', async () => {
    const ZCodeAdapter = await importAdapter();
    await new ZCodeAdapter().configure('/ignored', '/godot', 'npx', ['-y', 'godot-mcp-enhanced']);
    const config = JSON.parse(
      readFileSync(join(fakeHome, '.zcode', 'cli', 'config.json'), 'utf-8'),
    );
    expect(config.mcp.servers.godot.type).toBe('stdio'); // schema 强制
    expect(config.mcp.servers.godot.command).toBe('npx');
    expect(config.mcp.servers.godot.args).toEqual(['-y', 'godot-mcp-enhanced']);
    expect(config.mcp.servers.godot.env.GODOT_PATH).toBe('/godot');
  });

  it('configure preserves enable user-state on reconfigure', async () => {
    const filePath = join(fakeHome, '.zcode', 'cli', 'config.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcp: { servers: { godot: { type: 'stdio', command: 'old', enable: false } } },
    }));
    const ZCodeAdapter = await importAdapter();
    await new ZCodeAdapter().configure('/ignored', '/godot', 'npx', ['-y', 'godot-mcp-enhanced']);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcp.servers.godot.enable).toBe(false); // 用户禁用状态保留
    expect(config.mcp.servers.godot.command).toBe('npx'); // 同时 command 被更新
    expect(config.mcp.servers.godot.type).toBe('stdio');
  });

  it('configure preserves sibling servers + top-level plugins/hooks keys', async () => {
    const filePath = join(fakeHome, '.zcode', 'cli', 'config.json');
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      mcp: { servers: { memory: { type: 'stdio', command: 'npx' } } },
      plugins: { enabledPlugins: { foo: true } },
      hooks: { enabled: true },
    }));
    const ZCodeAdapter = await importAdapter();
    await new ZCodeAdapter().configure('/ignored', '/godot', 'npx', []);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(config.mcp.servers.memory.command).toBe('npx'); // 其他 server 保留
    expect(config.mcp.servers.godot.type).toBe('stdio'); // godot 写入
    expect(config.plugins.enabledPlugins.foo).toBe(true); // 顶层 plugins 保留
    expect(config.hooks.enabled).toBe(true); // 顶层 hooks 保留
  });

  it('isConfigured returns true after configure, false before', async () => {
    const ZCodeAdapter = await importAdapter();
    const adapter = new ZCodeAdapter();
    expect(await adapter.isConfigured('/ignored')).toBe(false); // 文件不存在
    await adapter.configure('/ignored', '/godot', 'npx', []);
    expect(await adapter.isConfigured('/ignored')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败（类不存在）**

Run: `npx vitest run test/cli/clients/zcode.test.ts`
Expected: FAIL — `Failed to resolve import '../../../src/cli/clients/zcode.js'`（文件未创建）。

- [ ] **Step 3: 写 ZCodeAdapter 实现**

Create `D:\GitHub\godot-mcp-enhanced\src\cli\clients\zcode.ts`：

```typescript
import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

/**
 * ZCodeAdapter — 智谱 ZCode (GLM ADE) 客户端配置 adapter。
 *
 * 与 CherryStudio 同属「global scope + schema 强制 type:stdio + user-state 白名单」一类，
 * 但三点关键差异（实测 ~/.zcode/cli/config.json 确认）：
 *  1. 路径用 homedir()/.zcode/cli/config.json（非 globalConfigRoot 的 %APPDATA%）
 *  2. 嵌套键 mcp.servers.godot（非顶层 mcpServers）
 *  3. 顶层与 plugins/hooks 共存 → readJsonConfigWithBackup 读全量后只改 mcp.servers.godot，
 *     原子写回时 plugins/hooks/其他 servers 天然保留
 */
export class ZCodeAdapter implements ClientAdapter {
  name = 'ZCode';
  scope = 'global' as const;

  // ZCode 用 mcp.servers.<name>.enable=false 禁用 server（实测 figma 条目），
  // 属用户可变状态，reconfigure 保留；type/command/args/env 由 configure 覆写。
  private static readonly USER_STATE_KEYS = ['enable'] as const;

  private configPath(): string {
    return join(homedir(), '.zcode', 'cli', 'config.json');
  }

  async detect(): Promise<boolean> {
    // ZCode 已安装 → ~/.zcode 目录存在（config.json 可能尚未生成，故探测目录非文件）
    return existsSync(join(homedir(), '.zcode'));
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    const mcp = content.mcp as Record<string, Record<string, unknown>> | undefined;
    return !!mcp?.servers?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcp) config.mcp = {};
    const mcp = config.mcp as Record<string, unknown>;
    if (!mcp.servers) mcp.servers = {};
    const servers = mcp.servers as Record<string, Record<string, unknown>>;
    const oldEntry = servers.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of ZCodeAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
    }
    servers.godot = {
      ...preserved,
      type: 'stdio', // ZCode schema：每条 server 必填 type(stdio|http)，缺则传输协商失败
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/cli/clients/zcode.test.ts`
Expected: PASS — 6 tests passed。

- [ ] **Step 5: tsc 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0（无类型错误）。

- [ ] **Step 6: Commit**

```bash
git add src/cli/clients/zcode.ts test/cli/clients/zcode.test.ts
git commit -m "feat(clients): ZCodeAdapter — global scope, mcp.servers.godot 嵌套键 + type:stdio

抄 cherry-studio 模板，三处差异（实测 ~/.zcode/cli/config.json 确认）：
路径 homedir/.zcode/cli（非 %APPDATA%）、嵌套键 mcp.servers.godot、
顶层 plugins/hooks 保留。enable user-state 白名单 reconfigure 保留。

补 review 识别的真实缺口（docs/使用指南-ZCode.md 有文档无 adapter，用户在用）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 注册进 ALL_ADAPTERS + 全量验证 + 客户端清单

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\cli\clients\index.ts`（import + export + ALL_ADAPTERS 追加）
- Modify（按需）: `D:\GitHub\godot-mcp-enhanced\README.md` / `README.en.md`（客户端清单）

**Interfaces:**
- Consumes: `ZCodeAdapter`（Task 1 产出）。
- Produces: `ALL_ADAPTERS` 含 ZCode（`setup.ts` / `doctor.ts` for-loop 自动消费，无需改这两处）。

- [ ] **Step 1: index.ts 注册 ZCodeAdapter**

Modify `D:\GitHub\godot-mcp-enhanced\src\cli\clients\index.ts`——三处改动：

① import 段（在 `QwenCodeAdapter` import 后追加）：
```typescript
import { ZCodeAdapter } from './zcode.js';
```

② export 段（在 `QwenCodeAdapter` 后追加）：
```typescript
  AntigravityAdapter, TraeAdapter, CherryStudioAdapter, GeminiCliAdapter, QwenCodeAdapter, ZCodeAdapter,
```

③ `ALL_ADAPTERS` global scope 段（在 `new CherryStudioAdapter(),` 后追加，保持 global 注释分组）：
```typescript
  new ZCodeAdapter(),
```

- [ ] **Step 2: 跑全量 client adapter 测试（确认注册无破坏）**

Run: `npx vitest run test/cli/clients/`
Expected: 全部 PASS（原 15 文件 + 新 zcode.test.ts = 16 文件）。

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: tsc exit 0；build 成功（`build/cli/clients/zcode.js` 生成）。

- [ ] **Step 4: 客户端清单更新（按需）**

Grep README 客户端列表：`grep -n -i "claude code\|cursor\|cline\|cherry" README.md README.en.md | head`
- 若 README 有客户端清单段落且未列 ZCode → 追加 ZCode 行（参照现有格式）。
- 若 README 无清单（仅 setup/doctor 自动消费）→ 跳过本步。

- [ ] **Step 5: Commit**

```bash
git add src/cli/clients/index.ts README.md README.en.md
git commit -m "feat(clients): ALL_ADAPTERS 注册 ZCodeAdapter

setup/doctor for-loop 自动消费，无需改这两处。README 客户端清单补 ZCode。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

（若 README 无改动，`git add` 仅 `src/cli/clients/index.ts`，commit message 去掉 README 那句。）

---

## Self-Review

**1. Spec 覆盖**：
- Zcode 配置形态（嵌套键 + type + global scope + homedir 路径）→ Task 1 全覆盖（实测 `~/.zcode/cli/config.json` 为准，推翻文档 §6.3 的误导性简化 JSON）。
- ClientAdapter 接口四方法（detect/isConfigured/configure + name/scope）→ Task 1 全实现。
- 注册自动消费 setup/doctor → Task 2 验证。
- user-state 保留 + 顶层键保留 + BOM 防御 → Task 1 测试覆盖（enable/sibling servers/plugins/hooks）。

**2. 占位符扫描**：无 TBD/TODO；所有代码块完整；测试有断言；命令有 expected。

**3. 类型一致性**：`ZCodeAdapter` 类名、`USER_STATE_KEYS = ['enable']`、`configPath()`、嵌套键 `mcp.servers.godot` 在 Task 1 实现 + 测试一致；Task 2 注册引用 `ZCodeAdapter` 与 Task 1 产出一致。

**4. 已知偏离**：
- 文档 `docs/使用指南-ZCode.md` §6.3 的 JSON 示例（顶层 `{"godot":{...}}`）与实测（`mcp.servers.godot`）不符——adapter 以**实测为准**（嵌套键）。plan 不改文档（文档那段是「摘录 godot 条目」的简化展示，非完整文件结构），但执行者知晓此差异。
- Warp adapter 不在本 plan（review 建议 Zcode first、Warp 第二批，另立 plan）。
