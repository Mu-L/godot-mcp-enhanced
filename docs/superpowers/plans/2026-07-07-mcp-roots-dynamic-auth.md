# MCP Roots 动态授权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 MCP Roots 协议，让支持 Roots 的客户端运行时动态声明授权根（替换 `ALLOWED_PROJECT_PATHS` env），免改 env 须重启 MCP 服务端的痛点。

**Architecture:** path-utils 加"动态 Roots"数据源层（`_dynamicRoots` 模块变量 + setter），`getAllowedProjectPaths()` 动态优先、env 兜底；`isPathInAllowedRoots` check 零改（realpath 防御对所有来源统一生效）。GodotServer `oninitialized` 钩子检测 client 能力 → `listRoots()` 拉取 → `parseFileRootUris` 解析 → 注入；监听 `roots/list_changed` 热更新；close 清理。URI 解析提取为 path-utils 纯函数（可独立单测）。

**Tech Stack:** TypeScript / Vitest / @modelcontextprotocol/sdk（Server.oninitialized/getClientCapabilities/listRoots/setNotificationHandler + RootsListChangedNotificationSchema）

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-07-mcp-roots-dynamic-auth-design.md`
**Base:** master `8b3521e`

## Global Constraints

- **check 零改**：`isPathInAllowedRoots`（path-utils.ts:221）签名与 realpath 校验逻辑**完全不变**。Roots 注入只改 `getAllowedProjectPaths` 数据源
- **单数据源**：`getAllowedProjectPaths()` 是唯一授权根读取入口。改它一处，所有下游透明升级（`helpers.ts:104` 等自动一致）
- **信任模型**（spec §2）：Roots 非空 → **整体替换** env（env 是不支持 Roots 客户端的兜底，**非安全硬上限**；硬上限须 OS 沙箱/容器）
- **注入期只验 `file://` scheme**（spec §6）：不过滤路径存在性，与 env 分支（:199-201 `filter(Boolean)+resolvePath`）对齐，存在性交给 check 期 `safeRealPath`（兼容待创建新项目）
- **fail-to-env-baseline + re-fetch 保留**（spec §6）：initial-fetch 失败/空 → 回落 env；re-fetch 失败/空 + 已有 roots → **保留旧 roots + warn**（不静默切作用域）
- **DEFECT baseline drift 目标 45→46**（defects.ts:483，实测 `grep -cE "^let _" src/**/*.ts` = 45；加 `let _dynamicRoots` → 46）。`_dynamicRoots` 声明处加注释引 `DEFECT.module-level-mutable-state`(open, ADVISORY) + `src/core/call-recorder.ts:30` 注释块先例（CallRecorder._instance 同模式）
- **oninitialized async 窗口**（spec review awareness）：SDK `Server.oninitialized: () => void`（非 Promise），赋 async 后 SDK 不 await；首次 roots fetch 完成前工具调用走 env baseline。fail-safe 方向（朝 env/cwd 收紧，从不超 env 放开）。**测试别假设"connect 返回即 roots 已注入"**——oninitialized 由 SDK 在 initialize 握手后触发，测试主动 `__fireInitialized()` 驱动
- **list_changed 并发**：快速连发致多个 `applyRoots(true)` 并发，last-write-wins 良性，MVP 不处理（不串行化）
- **与官方参考的故意分歧**（spec §10 awareness）：官方 filesystem `index.ts:749-753` 在"client 不支持 Roots 且无 args 目录"时 `throw` 拒启动；**本设计不 throw，回落 env/cwd**（保 deny-by-default + headless 兼容）。有意保留既有语义
- import 用 `.js` 后缀（ESM）；commit conventional + 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`；纯 TS 改动无需 GDScript `--import` 编译验证

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/core/path-utils.ts` | `_dynamicRoots` 模块变量 + `setAllowedRootsFromClient` + `hasDynamicRoots` + `parseFileRootUris`；改 `getAllowedProjectPaths` :198-202 动态优先 | Modify |
| `src/GodotServer.ts` | import 加 `RootsListChangedNotificationSchema` + `node:url` + path-utils 两个 export；`initRootsIntegration()` 私有方法；setupHandlers :172 后接线；close :451 区清理 | Modify |
| `test/core/path-utils-roots.test.ts` | 动态授权源 + 双向替换 env 契约 + realpath 归一契约 + `parseFileRootUris` 单测 | Create |
| `test/core/godot-server-roots.test.ts` | GodotServer Roots 集成（mock Server：initial/re-fetch/close + 不支持/抛错/空 各分支） | Create |
| `test/regression/defects.ts` | `module-level-mutable-state` baseline 45→46 + 注释 | Modify |

**依赖顺序**：Task 1（path-utils 动态源 + parseFileRootUris，TDD）→ Task 2（契约测试）→ Task 3（GodotServer 接线，依赖 Task 1 export）→ Task 4（baseline drift + 全量回归）。

---

### Task 1: path-utils 动态授权源 + `parseFileRootUris`（TDD）

**Files:**
- Modify: `src/core/path-utils.ts`（:198 `getAllowedProjectPaths` 前加 `_dynamicRoots` + setter + `hasDynamicRoots` + `parseFileRootUris`；:198-202 改 `getAllowedProjectPaths` 动态优先）
- Test: `test/core/path-utils-roots.test.ts`（Create）

**Interfaces:**
- Produces:
  - `setAllowedRootsFromClient(roots: string[] | null): void` — 非空替换 env；null/空回落 env
  - `hasDynamicRoots(): boolean` — 查询是否处于 Roots 注入态（GodotServer re-fetch 决策用）
  - `parseFileRootUris(roots: Array<{ uri: string }>): string[]` — MCP Root → 本地路径，过滤非 `file://` + 非法 URI，不过滤存在性
  - `getAllowedProjectPaths()` 改为动态优先（`_dynamicRoots ?? env`）

- [ ] **Step 1: 写失败测试（基础：注入/回落/查询/优先级 + parseFileRootUris）**

Create `test/core/path-utils-roots.test.ts`：
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAllowedProjectPaths,
  isPathInAllowedRoots,
  setAllowedRootsFromClient,
  hasDynamicRoots,
  parseFileRootUris,
} from '../../src/core/path-utils.js';

describe('path-utils dynamic roots (Task 1)', () => {
  const origEnv = process.env.ALLOWED_PROJECT_PATHS;
  const origUnrestricted = process.env.GODOT_MCP_UNRESTRICTED;

  beforeEach(() => {
    delete process.env.ALLOWED_PROJECT_PATHS;
    delete process.env.GODOT_MCP_UNRESTRICTED;
    setAllowedRootsFromClient(null);
  });
  afterEach(() => {
    if (origEnv !== undefined) process.env.ALLOWED_PROJECT_PATHS = origEnv;
    else delete process.env.ALLOWED_PROJECT_PATHS;
    if (origUnrestricted !== undefined) process.env.GODOT_MCP_UNRESTRICTED = origUnrestricted;
    setAllowedRootsFromClient(null);
  });

  it('setAllowedRootsFromClient 非空 → getAllowedProjectPaths 返回 roots', () => {
    setAllowedRootsFromClient(['/r1', '/r2']);
    expect(getAllowedProjectPaths()).toEqual(['/r1', '/r2']);
    expect(hasDynamicRoots()).toBe(true);
  });

  it('setAllowedRootsFromClient(null) → 回落 env', () => {
    process.env.ALLOWED_PROJECT_PATHS = '/e1;/e2';
    setAllowedRootsFromClient(null);
    expect(hasDynamicRoots()).toBe(false);
    // env 分支 resolvePath 后（平台相关），断言长度 + 末段
    const got = getAllowedProjectPaths();
    expect(got.length).toBe(2);
    expect(got[0].replace(/\\/g, '/')).toMatch(/\/?e1$/);
  });

  it('setAllowedRootsFromClient([]) 等同 null（回落 env）', () => {
    process.env.ALLOWED_PROJECT_PATHS = '/e1';
    setAllowedRootsFromClient([]);
    expect(hasDynamicRoots()).toBe(false);
    expect(getAllowedProjectPaths().length).toBe(1);
  });

  it('动态优先于 env（同时设两者 → 用 roots）', () => {
    process.env.ALLOWED_PROJECT_PATHS = '/e1';
    setAllowedRootsFromClient(['/r1']);
    expect(getAllowedProjectPaths()).toEqual(['/r1']);
  });

  it('UNRESTRICTED 仍最高优先（绕过 roots + env）', () => {
    setAllowedRootsFromClient(['/r1']);
    process.env.GODOT_MCP_UNRESTRICTED = 'true';
    expect(isPathInAllowedRoots('/anywhere/outside')).toBe(true);
  });

  it('parseFileRootUris: file:// 解析为本地路径，过滤非 file: + 非法 URI', () => {
    const roots = [
      { uri: 'file:///abs/path' },           // Unix 绝对（Windows 上 fileURLToPath 仍解析）
      { uri: 'file:///D:/proj' },            // Windows 绝对
      { uri: 'http://evil.example/x' },      // 非 file: → 过滤
      { uri: 'file://invalid % broken' },    // 非法 → 过滤（fileURLToPath 抛）
    ];
    const got = parseFileRootUris(roots);
    // 至少 2 个有效（Unix + Windows 形式），http 与非法被滤
    expect(got.length).toBe(2);
    expect(got.every(p => !p.startsWith('http'))).toBe(true);
  });

  it('parseFileRootUris: 不过滤路径存在性（待建 root 保留）', () => {
    const got = parseFileRootUris([{ uri: 'file:///this/does/not/exist/yet' }]);
    expect(got.length).toBe(1);  // 不存在但 scheme 合法 → 保留（存在性交 check 期）
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/core/path-utils-roots.test.ts`
Expected: FAIL — `setAllowedRootsFromClient` / `hasDynamicRoots` / `parseFileRootUris` 未 export（`is not a function` / `undefined`）

- [ ] **Step 3: 实现（`_dynamicRoots` + setter + hasDynamicRoots + parseFileRootUris + 改 getAllowedProjectPaths）**

在 `src/core/path-utils.ts` `getAllowedProjectPaths`（:198）**前**插入：
```ts
import { fileURLToPath } from 'node:url';

// 动态 Roots 授权源（client 经 MCP Roots 协议注入，GodotServer.oninitialized 调用）。
// null = 未注入 → getAllowedProjectPaths() 回落 env。
//
// 命中 DEFECT.module-level-mutable-state(open, ADVISORY) 形态（test/regression/defects.ts:483，
// detect = countMatchesInDir('src', /^let _/gm, /\.ts$/)）。同步单线程访问无真实竞态，
// 参照 src/core/call-recorder.ts:30 注释块先例（CallRecorder._instance 单例同模式，已标注）。
let _dynamicRoots: string[] | null = null;

/**
 * 注入 client Roots 授权源。非空 → 整体替换 env；null/空 → 清空回落 env。
 * 注入期只按 URI scheme 过滤（file://，见 parseFileRootUris），不过滤路径存在性——
 * 存在性延迟到 isPathInAllowedRoots 的 safeRealPath（与 env 分支对齐，兼容"待创建新项目"）。
 */
export function setAllowedRootsFromClient(roots: string[] | null): void {
  _dynamicRoots = roots && roots.length > 0 ? roots : null;
}

/** 查询是否处于 client Roots 注入态（区别于 env 非空）。GodotServer re-fetch 决策用。 */
export function hasDynamicRoots(): boolean {
  return _dynamicRoots !== null;
}

/**
 * 解析 MCP Roots 的 URI 为本地路径。只接受 file:// scheme，跳过非法 URI。
 * 不过滤路径存在性（与 env 注入期一致，存在性交 check 期 safeRealPath）。
 */
export function parseFileRootUris(roots: Array<{ uri: string }>): string[] {
  const out: string[] = [];
  for (const r of roots) {
    if (typeof r?.uri !== 'string' || !r.uri.startsWith('file://')) continue;
    try { out.push(fileURLToPath(r.uri)); } catch { /* 非法 URI 跳过 */ }
  }
  return out;
}
```

> 注：`import { fileURLToPath } from 'node:url'` 加到文件顶部 import 区（与现有 `import { join, normalize, resolve, sep } from 'path'` 同区）。

改 `getAllowedProjectPaths`（:198-202）：
```ts
export function getAllowedProjectPaths(): string[] {
  if (_dynamicRoots !== null) return _dynamicRoots;  // 动态 Roots 优先（整体替换 env）
  const env = process.env.ALLOWED_PROJECT_PATHS;     // 兜底（不支持 Roots 的客户端）
  if (!env) return [];
  return env.split(';').filter(Boolean).map(p => resolvePath(p));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/path-utils-roots.test.ts`
Expected: PASS（7 用例全绿）

- [ ] **Step 5: 现有 path 测试回归 + tsc + commit**

Run: `npx vitest run test/core/path-security.test.ts test/security-paths.test.js test/helpers.test.js` → 全绿（check 零改保证）
Run: `npx tsc --noEmit` → exit 0
```bash
git add src/core/path-utils.ts test/core/path-utils-roots.test.ts
git commit -m "feat(path-utils): 动态 Roots 授权源 + parseFileRootUris

动态优先、env 兜底（替换式）。_dynamicRoots 模块变量命中
DEFECT.module-level-mutable-state(ADVISORY)，参照 call-recorder.ts:30
先例注释。parseFileRootUris 提取 URI 解析为纯函数（注入期只验 file://
scheme，不过滤存在性对齐 env）。getAllowedProjectPaths 改为动态优先，
isPathInAllowedRoots check 零改。7 新测试 + 现有 path 回归。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 双向替换 env + realpath 归一契约测试

**Files:**
- Test: `test/core/path-utils-roots.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `setAllowedRootsFromClient` / `getAllowedProjectPaths` / `isPathInAllowedRoots`
- Produces: 安全契约的可执行 spec（防未来 merge 式 refactor 静默改安全模型）

- [ ] **Step 1: 追加契约测试（双向替换 + realpath 归一）**

在 `test/core/path-utils-roots.test.ts` 末尾追加：
```ts
import { resolve } from 'path';

describe('path-utils roots security contracts (Task 2)', () => {
  const origEnv = process.env.ALLOWED_PROJECT_PATHS;
  const origUnrestricted = process.env.GODOT_MCP_UNRESTRICTED;
  beforeEach(() => {
    delete process.env.ALLOWED_PROJECT_PATHS;
    delete process.env.GODOT_MCP_UNRESTRICTED;
    setAllowedRootsFromClient(null);
  });
  afterEach(() => {
    if (origEnv !== undefined) process.env.ALLOWED_PROJECT_PATHS = origEnv;
    else delete process.env.ALLOWED_PROJECT_PATHS;
    if (origUnrestricted !== undefined) process.env.GODOT_MCP_UNRESTRICTED = origUnrestricted;
    setAllowedRootsFromClient(null);
  });

  it('契约1a: roots 窄于 env → env 完全忽略（作用域缩）', () => {
    // env 放宽到 /e1，但 client roots 只授权 /r1 → /e1 下路径必须被拒
    process.env.ALLOWED_PROJECT_PATHS = resolve('/e1');
    setAllowedRootsFromClient([resolve('/r1')]);
    expect(isPathInAllowedRoots(resolve('/e1/inside'))).toBe(false);  // env 被忽略
    expect(isPathInAllowedRoots(resolve('/r1/inside'))).toBe(true);
  });

  it('契约1b: roots 宽于 env → 作用域扩（env 不束缚 client 声明）', () => {
    // env 只授权 /e1，client roots 扩到 /wide → /wide 下路径放行（信任模型：client 是授权权威）
    process.env.ALLOWED_PROJECT_PATHS = resolve('/e1');
    setAllowedRootsFromClient([resolve('/wide')]);
    expect(isPathInAllowedRoots(resolve('/wide/inside'))).toBe(true);
    expect(isPathInAllowedRoots(resolve('/e1/inside'))).toBe(false);  // env 不再生效
  });

  it('契约2: dynamic roots 也走 realpath 归一（绑 path-sandbox-touctou 不复发）', () => {
    // 含 ".." 与混合分隔符的非规范 root → 经 isPathInAllowedRoots 归一后判定，无法绕 check
    const base = resolve('/rnorm');
    setAllowedRootsFromClient([base.replace(/\\/g, '/') + '/sub/../']);  // 非规范
    // 子路径访问须通过归一后的 base 校验（不因非规范写法绕过/误拒）
    const child = base.replace(/\\/g, '/') + '/file.txt';
    expect(isPathInAllowedRoots(child)).toBe(true);
    // 外部路径仍拒
    expect(isPathInAllowedRoots(resolve('/outside'))).toBe(false);
  });
});
```

> 测试用 `resolve('/...')` 生成平台无关绝对路径；Unix/macOS 路径 `/r1` 原样，Windows `resolve('/r1')` → `C:\r1`（当前盘）。`isPathInAllowedRoots` 内部 realpath 不存在路径时 safeRealPath 向上找祖先——`/r1` 等测试根可能不存在，但 safeRealPath 兼容（向上到 `/` 存在）。若 CI 环境因根目录权限 realpath 异常，改用 `os.tmpdir()` 下临时目录（执行者按需调整，契约不变）。

- [ ] **Step 2: 跑测试（应通过——Task 1 实现已满足契约；失败则 Task 1 实现有缺陷需修）**

Run: `npx vitest run test/core/path-utils-roots.test.ts -t "security contracts"`
Expected: PASS（3 契约用例）。若 FAIL：检查 Task 1 `getAllowedProjectPaths` 是否真正 `_dynamicRoots ?? env`（非合并），及 `isPathInAllowedRoots` 是否对 dynamic roots 也走 realpath 归一。

- [ ] **Step 3: commit**

```bash
git add test/core/path-utils-roots.test.ts
git commit -m "test(path-utils): roots 双向替换 env + realpath 归一契约

契约1（双向替换 env）：roots 非空时 env 完全忽略——窄于 env 缩 + 宽于
env 扩各一例。是 spec §2 信任模型的可执行 spec，防未来 merge 式 refactor
静默改安全模型。契约2（realpath 归一）：含非规范路径的 root 经 check 归一，
绑 path-sandbox-touctou 不复发承诺。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: GodotServer `initRootsIntegration` + 集成测试

**Files:**
- Modify: `src/GodotServer.ts`（:3-11 import 加 `RootsListChangedNotificationSchema`；顶部加 `import { fileURLToPath } from 'node:url'` —— 注：fileURLToPath 已在 path-utils 用，GodotServer 不直接用可省；加 `import { setAllowedRootsFromClient, hasDynamicRoots } from './core/path-utils.js'`；加私有方法 `initRootsIntegration`；setupHandlers :172 后接线 `this.initRootsIntegration()`；close :451 `clearMcpServer()` 旁加 `setAllowedRootsFromClient(null)`）
- Test: `test/core/godot-server-roots.test.ts`（Create）

**Interfaces:**
- Consumes: Task 1 `setAllowedRootsFromClient` / `hasDynamicRoots` / `parseFileRootUris`；SDK `Server.oninitialized`（`() => void`）/ `getClientCapabilities()` / `listRoots()` / `setNotificationHandler(schema, fn)`
- Produces: 生产路径 Roots 注入（oninitialized + list_changed 热更新）+ close 清理

- [ ] **Step 1: 写失败测试（mock Server，initial/re-fetch/close + 各分支）**

Create `test/core/godot-server-roots.test.ts`：
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// mock SDK Server 类——可控 oninitialized / getClientCapabilities / listRoots / setNotificationHandler
const fire = { initialized: () => {}, rootsChanged: () => {} };
let mockServerInstance: any;

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: class {
      oninitialized: any = null;
      private notifHandler: any = null;
      private caps: any = {};
      private listRootsResult: any = { roots: [] };
      setRequestHandler() {}
      setNotificationHandler(_schema: unknown, fn: any) { this.notifHandler = fn; }
      getClientCapabilities() { return this.caps; }
      async listRoots() { return this.listRootsResult; }
      async connect() {}
      async close() {}
      async start() {}
      // 测试驱动钩子
      __setCaps(c: any) { this.caps = c; }
      __setListRootsResult(r: any) { this.listRootsResult = r; }
      __setNotifHandler(fn: any) { this.notifHandler = fn; }
      __fireInitialized() { fire.initialized = () => this.oninitialized?.(); }
      __fireRootsChanged() { fire.rootsChanged = () => this.notifHandler?.(); }
    },
  };
});

// mock StdioServerTransport（GodotServer.run 用）
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class { async start() {} async close() {} },
}));

// 其余 GodotServer 重依赖参照 test/godot-server.test.js 的 mock 模式（editorConn/dispatcher/
// module-loader/godot-finder 等免真实启动）。这里给出最小可构造 mock，执行者按 godot-server.test.js 补齐。
// 关键：构造 GodotServer 不应触发真实 editor 连接 / godot 进程 spawn。

import { GodotServer } from '../../src/GodotServer.js';
import { setAllowedRootsFromClient, hasDynamicRoots } from '../../src/core/path-utils.js';

// 注：GodotServer 构造依赖较多（参照 test/godot-server.test.js 既有 mock 套路）。
// 若构造直接 mock 成本高，可在该测试文件顶部追加与 godot-server.test.js 同源的 vi.mock 列表
// （editor-auth / godot-finder / EditorConnection / ToolDispatcher 等）。
// 下面断言假定 GodotServer 可构造 + this.server 为 mockServerInstance。

describe('GodotServer Roots integration (Task 3)', () => {
  let server: GodotServer;

  beforeEach(() => {
    setAllowedRootsFromClient(null);
    delete process.env.ALLOWED_PROJECT_PATHS;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setAllowedRootsFromClient(null);
  });

  it('client 支持 Roots + 返回非空 → 注入（替换 env）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'file:///projA' }] });
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);
  });

  it('client 不支持 Roots → 不注入（用 env baseline）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({});  // 无 roots
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(false);
  });

  it('initial listRoots 抛错 → 回落 env baseline', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.listRoots = async () => { throw new Error('boom'); };
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(false);  // fail-to-env-baseline
  });

  it('initial roots 全部无效（非 file:）→ 回落 env baseline', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'http://x' }] });
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(false);
  });

  it('list_changed re-fetch 成功非空 → 替换', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'file:///initial' }] });
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'file:///updated' }] });
    mockServerInstance.__fireRootsChanged();
    await mockServerInstance.notifHandler();
    expect(hasDynamicRoots()).toBe(true);  // 仍是 roots 态（已替换）
  });

  it('list_changed re-fetch 抛错 + 已有 roots → 保留旧 roots（不静默切）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'file:///initial' }] });
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    mockServerInstance.listRoots = async () => { throw new Error('refetch boom'); };
    mockServerInstance.__fireRootsChanged();
    await mockServerInstance.notifHandler();
    expect(hasDynamicRoots()).toBe(true);  // 保留旧 roots（关键安全契约）
  });

  it('list_changed re-fetch 返回空 + 已有 roots → 保留旧 roots', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'file:///initial' }] });
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();

    mockServerInstance.__setListRootsResult({ roots: [] });
    mockServerInstance.__fireRootsChanged();
    await mockServerInstance.notifHandler();
    expect(hasDynamicRoots()).toBe(true);  // 保留旧 roots
  });

  it('close() → 清理 dynamic roots（回落 env）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = (server as any).server;
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'file:///x' }] });
    mockServerInstance.__fireInitialized();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    await server.close();
    expect(hasDynamicRoots()).toBe(false);  // close 清理
  });
});
```

> **执行者注意**：GodotServer 构造依赖较多（ToolDispatcher / EditorConnection / registerAllModules / godot-finder 等）。`test/godot-server.test.js` 已有成熟的 mock 套路（vi.mock 列表）——**移植该文件的 mock 列表到本测试顶部**，确保 `new GodotServer(...)` 不触发真实 editor 连接 / godot spawn。若某 mock 缺失导致构造抛错，按报错补 vi.mock。测试的核心断言（`hasDynamicRoots` 在各分支的值）不因 mock 细节改变。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/core/godot-server-roots.test.ts`
Expected: FAIL — `initRootsIntegration` 未实现，`oninitialized` 为 null（`oninitialized?.()` 不触发注入），`hasDynamicRoots()` 始终 false

- [ ] **Step 3: 实现 `initRootsIntegration` + import + 接线 + close 清理**

(a) `src/GodotServer.ts` import 区（:3-11 的 types.js import 列表加一项）：
```ts
RootsListChangedNotificationSchema,
```
（加到现有 `GetPromptRequestSchema,` 之后，逗号分隔）

(b) `:39` 区（现有 `import { setGetContextConnectionProvider, setEditorSceneProvider } from './tools/get-context.js';` 旁）加：
```ts
import { setAllowedRootsFromClient, hasDynamicRoots } from './core/path-utils.js';
```

(c) 加私有方法（`initMultiInstance` :178 旁，同类private方法区）：
```ts
  /**
   * MCP Roots 动态授权集成（批 P0）。
   * oninitialized 检测 client 能力 → listRoots 拉取 → parseFileRootUris 解析 → setAllowedRootsFromClient 注入。
   * list_changed 热更新。initial 失败 fail-to-env-baseline；re-fetch 失败 + 已有 roots 保留旧（不静默切作用域）。
   * SDK oninitialized: () => void（非 Promise），async 赋值后 SDK 不 await——首次 fetch 完成前工具调用走 env baseline（fail-safe 朝收紧方向）。
   */
  private async initRootsIntegration(): Promise<void> {
    const applyRoots = async (isRefetch: boolean): Promise<void> => {
      try {
        const resp = await this.server.listRoots();
        const valid = parseFileRootUris(resp.roots ?? []);
        if (valid.length > 0) {
          setAllowedRootsFromClient(valid);
          getLogger().info('security', `Authorized ${valid.length} root(s) from MCP client`);
        } else {
          if (isRefetch && hasDynamicRoots()) {
            getLogger().warn('security', 'Roots re-fetch returned empty/invalid — keeping previous roots');
          } else {
            setAllowedRootsFromClient(null);
            getLogger().info('security', 'No valid client roots — using ALLOWED_PROJECT_PATHS baseline');
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRefetch && hasDynamicRoots()) {
          getLogger().warn('security', `Roots re-fetch failed — keeping previous roots: ${msg}`);
        } else {
          setAllowedRootsFromClient(null);
          getLogger().warn('security', `Initial roots fetch failed — using env baseline: ${msg}`);
        }
      }
    };

    this.server.oninitialized = async () => {
      const caps = this.server.getClientCapabilities();
      if (caps?.roots) {
        await applyRoots(false);
      } else {
        getLogger().info('security', 'Client does not support MCP Roots — using ALLOWED_PROJECT_PATHS baseline');
      }
    };

    this.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      await applyRoots(true);
    });
  }
```

> `parseFileRootUris` 需 import：在 (b) 的 path-utils import 加 `parseFileRootUris`：
> ```ts
> import { setAllowedRootsFromClient, hasDynamicRoots, parseFileRootUris } from './core/path-utils.js';
> ```

(d) setupHandlers 接线（:172 `GetPromptRequestSchema` handler 后、:174 注释前）：
```ts
    // 批 P0: MCP Roots 动态授权集成（oninitialized + list_changed）
    this.initRootsIntegration();
```

(e) close 清理（:451 `clearMcpServer();` 旁加）：
```ts
    setAllowedRootsFromClient(null);  // 批 P0: 回落 env，干净关闭 + 测试隔离
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/core/godot-server-roots.test.ts`
Expected: PASS（8 用例：支持/不支持/initial抛错/initial全无效/re-fetch替换/re-fetch抛错保留/re-fetch空保留/close清理）

- [ ] **Step 5: 现有 GodotServer 回归 + tsc + lint + commit**

Run: `npx vitest run test/godot-server.test.js test/core/ToolDispatcher.test.ts` → 全绿（接线不破坏现有）
Run: `npx tsc --noEmit && npm run lint` → exit 0
```bash
git add src/GodotServer.ts test/core/godot-server-roots.test.ts
git commit -m "feat(godot-server): MCP Roots 动态授权集成（oninitialized + list_changed）

initRootsIntegration：oninitialized 检测 clientCapabilities.roots → listRoots
→ parseFileRootUris（Task1）→ setAllowedRootsFromClient 注入。list_changed
热更新。initial 失败 fail-to-env-baseline；re-fetch 失败 + 已有 roots 保留旧
（不静默切作用域）。close 清理回落 env。8 集成测试 + 现有 GodotServer 回归。
SDK oninitialized 非 Promise，async 不 await，首次 fetch 前走 env（fail-safe）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: DEFECT baseline drift + 全量回归

**Files:**
- Modify: `test/regression/defects.ts:483`（`baseline: 45 → 46` + 注释追加）

**Interfaces:** 无新接口（验证 task）

- [ ] **Step 1: 全量 vitest（path-utils + GodotServer + 现有全量）**

Run: `npx vitest run`
Expected: 全绿（Task 1/2/3 新测试 + 现有 3577+ 不破坏）。注：defects 测试此刻可能 FAIL（detect=46 vs baseline=45），Step 3 修复。

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0

- [ ] **Step 3: DEFECT baseline drift（module-level-mutable-state 45→46）**

`test/regression/defects.ts:483` 当前：
```ts
    baseline: 45 }, // CallRecorder(Task 2 e6188ab)增 _instance 单例 42→43；get-context 批1(9142939 后)增 _connectionStatusProvider DI(同 manage-tools 模式) 43→44；批2 Task 3(f857615)增 setEditorSceneProvider DI(同模式) 44→45
```
改：
```ts
    baseline: 46 }, // CallRecorder(Task 2 e6188ab)增 _instance 单例 42→43；get-context 批1(9142939 后)增 _connectionStatusProvider DI(同 manage-tools 模式) 43→44；批2 Task 3(f857615)增 setEditorSceneProvider DI(同模式) 44→45；MCP Roots 动态授权(Task 1)增 _dynamicRoots(同模式,参照 call-recorder.ts:30 先例) 45→46
```

- [ ] **Step 4: 跑 defects 测试确认 baseline 46 通过**

Run: `npx vitest run test/regression` (或 defects 所属测试文件)
Expected: PASS（detect 实测 46 === baseline 46）

- [ ] **Step 5: capability 不回归 + 集成快照（人工可选）**

Run: `npx vitest run test/capability`
Expected: PASS（Roots 集成不改变工具 capability/securityLevel）
人工可选：若环境有支持 Roots 的 client（如新版 Claude Code / Cursor），跑 `godot_get_context` 确认 connections 字段反映 Roots 注入态。无此类 client 则 Task 3 mock 测试覆盖即合格。

- [ ] **Step 6: commit**

```bash
git add test/regression/defects.ts
git commit -m "test(defects): module-level-mutable-state baseline 45→46

MCP Roots 动态授权(Task 1)增 _dynamicRoots 模块变量命中 detect 形态。
参照 call-recorder.ts:30 先例注释（同步单线程无竞态，ADVISORY 合理设计）。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**：
- §2 信任模型（Roots 替换 env，env 兜底非上限）→ Task 1 `getAllowedProjectPaths` 动态优先 + Task 2 契约1（双向替换）✅
- §3 授权优先级（UNRESTRICTED > Roots > env > cwd）→ Task 1（UNRESTRICTED 测试 + 动态优先）✅
- §3.2 check 零改 + 单数据源 + realpath 统一 → Task 1（isPathInAllowedRoots 不改）+ Task 2 契约2（realpath 归一）✅
- §4.1 `_dynamicRoots` + setter + hasDynamicRoots + 注释引 DEFECT 先例 → Task 1 Step 3 ✅
- §4.1 `parseFileRootUris`（注入期只验 scheme）→ Task 1（提取为纯函数）+ Task 1 测试（不过滤存在性）✅
- §4.1 注释引 call-recorder.ts:30 先例 → Task 1 Step 3 注释 ✅
- §4.2 import + initRootsIntegration + setupHandlers 接线 + close 清理 → Task 3 ✅
- §5 数据流（oninitialized/list_changed/close）→ Task 3 测试覆盖 ✅
- §6 错误处理（initial fail-to-env-baseline + re-fetch 保留 + 注入期不过滤存在性）→ Task 3 测试（initial 抛错/全无效/re-fetch 抛错保留/re-fetch 空保留）✅
- §7.1 path-utils 单测（含两契约）→ Task 1 + Task 2 ✅
- §7.2 GodotServer 集成 mock（8 场景）→ Task 3 Step 1（8 用例）✅
- §7.3 回归 → Task 1/3/4 各 Step 含回归 ✅
- §9 DEFECT baseline drift 45→46 → Task 4 Step 3 ✅
- §10 与官方参考分歧（不 throw 回落 cwd）→ Global Constraints awareness + Task 3 实现（不 throw）✅

**2. Placeholder 扫描**：无 TBD/TODO。Task 3 Step 1 标"执行者参照 test/godot-server.test.js 移植 mock 列表"——给出具体参照文件 + 明确断言不因 mock 细节改变，非 placeholder（GodotServer 构造 mock 是现有成熟模式，移植比 plan 内重写更准）。

**3. 类型一致性**：
- `setAllowedRootsFromClient(roots: string[] | null): void`（Task 1 定义）↔ Task 3 调用一致 ✅
- `hasDynamicRoots(): boolean`（Task 1）↔ Task 3 `applyRoots` isRefetch 决策 + Task 1/3 测试断言一致 ✅
- `parseFileRootUris(roots: Array<{ uri: string }>): string[]`（Task 1）↔ Task 3 `applyRoots` 调用 `parseFileRootUris(resp.roots ?? [])` 一致（SDK `Root` 是 `{ uri: string; name?: string }`，结构兼容 `Array<{ uri: string }>`）✅
- `getAllowedProjectPaths()` 签名不变（返回 `string[]`），仅实现动态优先——下游所有调用者透明 ✅

---

## Execution Handoff

Plan complete and saved to `D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-07-mcp-roots-dynamic-auth.md`。

**执行方式**：Subagent-Driven（推荐，与 get_context 批 1/批 2 一致）或 Inline。
