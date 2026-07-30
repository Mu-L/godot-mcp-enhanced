# E-95 路径测试 env 隔离四件套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `test/helpers/path-isolation.ts` 三件套 helper，重构 5 个路径安全测试文件改用 helper（行为不变只换手法），统一碎片化的 env 隔离姿态。

**Architecture:** 单一 helper 文件提供三姿态函数（`isolatePathEnv` 隔离 / `asUnrestrictedPath` 刻意 unrestricted / `expectPathDenied` deny 断言），cwd 用闭包捕获（非模块级单例），内部注册 afterEach 自动恢复。5 文件重构纯手法替换，测试用例/断言/覆盖不变。

**Tech Stack:** TypeScript + Vitest（`globals: true` 已确认，`vi` 全局可用）。

**Spec:** `docs/superpowers/specs/2026-07-30-e-95-path-test-env-isolation-design.md`（commit dcfe4ca）

## Global Constraints

- 工作仓库 `D:\GitHub\godot-mcp-enhanced`；master 本地 commit 不 push。
- helper TS（`test/helpers/path-isolation.ts`），对齐 `test/helpers/` 现有 `fixtures.js`/`tool-context.js`——plan Task 1 核实 vitest 对 `test/helpers/*.ts` 编译（tsconfig include）。
- TDD 红线：重构行为不变——重构前后该文件测试计数 + 全量 vitest 必须一致绿。
- 改测试后须 `npm run build`（pretest 钩子已强制，E-P1 Task2），测试 import `build/` 产物。
- 核实驱动（[[plan-baseline-verify-grep]][[verify-implementation-by-source]]）：行号/计数改动前 grep 实测。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `test/helpers/path-isolation.ts` | 三件套 helper（env 隔离 + deny 断言） | Create |
| `test/helpers/path-isolation.test.ts` | helper 自测 | Create |
| `test/screenshot-analyze-path-leak.test.ts` | screenshot leak deny 测试 | Modify（契合度最高） |
| `test/addon-version.test.ts` | addon deny + bypass 测试 | Modify |
| `test/security-paths.test.js` | C-SEC-1/C-1 path traversal deny | Modify |
| `test/helpers.test.js` | isPathInAllowedRoots + allowOutsideProjectPaths describe | Modify |
| `test/core/path-utils-roots.test.ts` | dynamic roots + deny 契约 | Modify（最复杂） |

---

## Task 1: helper 三件套 + 自测（定 afterEach 方案）

**Files:**
- Create: `test/helpers/path-isolation.ts`
- Test: `test/helpers/path-isolation.test.ts`

**Interfaces:**
- Consumes: `_resetPathAllowWarned` from `src/core/path-utils.js`（已 export，path-utils.ts:309）；vitest 全局 `vi`/`expect`/`afterEach`（globals:true）
- Produces: `isolatePathEnv(opts?: {allowed?: string[]; cwd?: string})` / `asUnrestrictedPath()` / `expectPathDenied(fn)` —— 后续 task 全部依赖这三个函数名

- [ ] **Step 1: 核实 test/helpers/*.ts 编译**

Run: `grep -n "include" tsconfig.json` + `cat vitest.config.ts | head -20`
Expected: tsconfig include 含 `test/**/*`（或 vitest 直接跑 .ts）。若 test/helpers/*.ts 不被编译，helper 改用 `.js`（对齐 fixtures.js）。

- [ ] **Step 2: 写 helper 自测（RED）**

Create `test/helpers/path-isolation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isolatePathEnv, asUnrestrictedPath, expectPathDenied } from './path-isolation.js';
import { isPathInAllowedRoots } from '../../src/core/path-utils.js';

describe('isolatePathEnv', () => {
  beforeEach(() => { isolatePathEnv(); });

  it('清 GODOT_MCP_UNRESTRICTED（setup.js 默认 true 被覆盖）', () => {
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('');
  });

  it('触发 deny-by-default（isPathInAllowedRoots 对 cwd 外返 false）', () => {
    const outside = process.platform === 'win32' ? 'C:/Windows/System32' : '/etc';
    expect(isPathInAllowedRoots(outside)).toBe(false);
  });

  it('afterEach 自动恢复 UNRESTRICTED（后续 describe 不受污染）', () => {
    // 本 it 内仍隔离态；恢复验证在下方 describe（afterEach 已跑）
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('');
  });
});

describe('isolatePathEnv afterEach 恢复验证', () => {
  it('前一个 describe 的 afterEach 已恢复 UNRESTRICTED（非空=setup.js 默认 true）', () => {
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('true');
  });
});

describe('isolatePathEnv allowed', () => {
  let allowed: string;
  beforeEach(() => {
    allowed = require('os').tmpdir();
    isolatePathEnv({ allowed: [allowed] });
  });

  it('设 ALLOWED_PROJECT_PATHS（allowed 内放行，外拒绝）', () => {
    expect(process.env.ALLOWED_PROJECT_PATHS).toContain(allowed);
    expect(isPathInAllowedRoots(allowed)).toBe(true);
    expect(isPathInAllowedRoots(allowed + '/../../outside')).toBe(false);
  });
});

describe('asUnrestrictedPath', () => {
  beforeEach(() => { asUnrestrictedPath(); });

  it('设 UNRESTRICTED=true（测 bypass 姿态）', () => {
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('true');
    expect(isPathInAllowedRoots('/anywhere')).toBe(true);
  });
});

describe('expectPathDenied', () => {
  it('匹配中文路径拒绝错误', () => {
    expectPathDenied(() => { throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS'); });
  });

  it('匹配 PATH_NOT_ALLOWED', () => {
    expectPathDenied(() => { throw new Error('PATH_NOT_ALLOWED: foo'); });
  });

  it('非路径错误不匹配（防泛化）', () => {
    expect(() => expectPathDenied(() => { throw new Error('some other error'); })).toThrow();
  });
});
```

- [ ] **Step 3: 运行自测确认 FAIL（helper 未实现）**

Run: `npx vitest run test/helpers/path-isolation.test.ts`
Expected: FAIL（`Cannot resolve './path-isolation.js'`）

- [ ] **Step 4: 实现 helper（默认内部注册 afterEach 方案）**

Create `test/helpers/path-isolation.ts`:

```ts
/**
 * 路径安全测试 env 隔离 helper（E-95）。
 * 三件套：isolatePathEnv（deny-by-default 姿态）/ asUnrestrictedPath（刻意 bypass）/ expectPathDenied（deny 断言）。
 * 约定在 beforeEach 内调用——afterEach 自动注册恢复 env/cwd/reset。
 */
import { afterEach } from 'vitest';
import { _resetPathAllowWarned } from '../../src/core/path-utils.js';

export function isolatePathEnv(opts: { allowed?: string[]; cwd?: string } = {}): void {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
  const origCwd = opts.cwd ? process.cwd() : undefined;
  if (opts.allowed !== undefined) {
    if (opts.allowed.length) process.env.ALLOWED_PROJECT_PATHS = opts.allowed.join(';');
    else delete process.env.ALLOWED_PROJECT_PATHS;
  }
  if (opts.cwd) process.chdir(opts.cwd);
  _resetPathAllowWarned();
  afterEach(() => {
    vi.unstubAllEnvs();
    if (origCwd !== undefined) process.chdir(origCwd);
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
  });
}

export function asUnrestrictedPath(): void {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
  _resetPathAllowWarned();
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetPathAllowWarned();
  });
}

export function expectPathDenied(fn: () => unknown): void {
  expect(fn).toThrow(/PATH_NOT_ALLOWED|ALLOWED_PROJECT_PATHS|outside allowed|escapes allowed|不在.*ALLOWED|越界/i);
}
```

- [ ] **Step 5: 运行自测确认 PASS（含 afterEach 恢复验证）**

Run: `npx vitest run test/helpers/path-isolation.test.ts`
Expected: 全 PASS。**关键判据**：`isolatePathEnv afterEach 恢复验证` describe 的 it（expect UNRESTRICTED=='true'）必须 PASS——这证明内部注册 afterEach 在 beforeEach 调用 isolatePathEnv 后正确执行。

**若该 it FAIL（UNRESTRICTED 仍 ''）**：说明 vitest afterEach 内部注册 scope 不生效 → 切换 **fallback 方案**（返回 restore 函数）。helper 改为：

```ts
export function isolatePathEnv(opts: { allowed?: string[]; cwd?: string } = {}): () => void {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
  const origCwd = opts.cwd ? process.cwd() : undefined;
  // ... 同上设置 ...
  return () => {
    vi.unstubAllEnvs();
    if (origCwd !== undefined) process.chdir(origCwd);
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
  };
}
// 调用方：const restore = isolatePathEnv(); afterEach(restore);
```

fallback 时自测相应改 `const restore = isolatePathEnv(); afterEach(restore);`。**后续 task 跟随 Task 1 选定的方案**（本 plan 默认写内部注册方案；若 fallback，各 task 的 `isolatePathEnv()` 调用改为 `afterEach(isolatePathEnv())`）。

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`
Expected: 0 errors

```bash
git add test/helpers/path-isolation.ts test/helpers/path-isolation.test.ts
git commit -m "feat(test): E-95 路径测试 env 隔离 helper 三件套（isolatePathEnv/asUnrestrictedPath/expectPathDenied）"
```

---

## Task 2: 重构 screenshot-analyze-path-leak.test.ts（契合度最高）

**Files:**
- Modify: `test/screenshot-analyze-path-leak.test.ts`

**Interfaces:**
- Consumes: `isolatePathEnv` / `expectPathDenied` from Task 1

**现状关键片段**（行号基准 git HEAD dcfe4ca）：
- describe #1（:26-71）：beforeEach stubEnv('') + delete ALLOWED + chdir(allowedDir) + reset；afterEach chdir(origCwd) + unstubAllEnvs + delete ALLOWED + reset + rmSync
- describe #2（:74-114）：beforeEach stubEnv('') + ALLOWED=allowedDir + reset；afterEach unstubAllEnvs + delete ALLOWED + reset + rmSync

- [ ] **Step 1: 基线测试计数**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts 2>&1 | tail -3`
Expected: 记录 passed 数（基线，重构后须一致）。

- [ ] **Step 2: 改写 import + describe #1**

import 行（:1-7）追加 `import { isolatePathEnv, expectPathDenied } from './helpers/path-isolation.js';`，移除 `_resetPathAllowWarned` import（不再手动调，下同）。

describe #1 beforeEach（:31-39）改为：

```ts
beforeEach(() => {
  allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
  outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
  isolatePathEnv({ cwd: allowedDir });   // 清 UNRESTRICTED + chdir(allowedDir) + reset；afterEach 自动恢复
});
```

describe #1 afterEach（:41-48）改为（仅保留 rmSync，env/cwd/reset 由 helper）：

```ts
afterEach(() => {
  rmSync(allowedDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});
```

移除 `const origCwd = process.cwd();`（:29，helper 内部闭包捕获）。

deny 断言（:58）改用 helper：`await expectPathDenied(async () => { await result; });`——⚠️ 注意 `expectPathDenied` 签名是同步 `() => unknown`，而 result 是 Promise。**保留原 `await expect(result).rejects.toThrow(/not in ALLOWED_PROJECT_PATHS/)`**（async rejects 不能套同步 expectPathDenied）。本文件 deny 断言**不改**（已是精确 toThrow），仅 env 隔离改 helper。

- [ ] **Step 3: 改写 describe #2**

beforeEach（:78-85）改为：

```ts
beforeEach(() => {
  allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
  outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
  isolatePathEnv({ allowed: [allowedDir] });   // 清 UNRESTRICTED + 设 ALLOWED + reset
});
```

afterEach（:87-93）改为仅 rmSync（同上）。

- [ ] **Step 4: 运行测试确认计数一致**

Run: `npx vitest run test/screenshot-analyze-path-leak.test.ts 2>&1 | tail -3`
Expected: passed 数 == Step 1 基线，0 failed。

- [ ] **Step 5: commit**

```bash
git add test/screenshot-analyze-path-leak.test.ts
git commit -m "refactor(test): screenshot-leak 改用 path-isolation helper（行为不变）"
```

---

## Task 3: 重构 addon-version.test.ts

**Files:**
- Modify: `test/addon-version.test.ts`

**Interfaces:**
- Consumes: `isolatePathEnv` / `asUnrestrictedPath` / `expectPathDenied`

**现状**（:29-42）：beforeEach save UNRESTRICTED + 设 true + reset + tmpProject；afterEach restore + reset + rmSync。多数 it 在 unrestricted 下测功能；deny it（:64-76/:78-103/:129）临时清 '' 测 throw。

- [ ] **Step 1: 基线计数**

Run: `npx vitest run test/addon-version.test.ts 2>&1 | tail -3`

- [ ] **Step 2: 改写顶层 beforeEach/afterEach**

import 追加 helper，移除手动 `_resetPathAllowWarned`（保留 import 若仍有手动调用点）。

beforeEach（:29-36）改为：

```ts
beforeEach(() => {
  asUnrestrictedPath();   // 刻意 UNRESTRICTED=true（多数测试绕白名单用 tmpProject）+ reset
  tmpProject = mkdtempSync(join(tmpdir(), 'av-'));
  writeFileSync(join(tmpProject, 'project.godot'), '');
});
```

afterEach（:37-42）改为仅 rmSync：

```ts
afterEach(() => {
  rmSync(tmpProject, { recursive: true, force: true });
});
```

移除 `let savedUnrestricted`（:27）。

- [ ] **Step 3: 改写 deny it（:64-76）**

```ts
it('isPathInAllowedRoots 拒绝时 throw（UNRESTRICTED 未设）', () => {
  isolatePathEnv();   // 清 UNRESTRICTED 触发 deny-by-default
  // tmpProject 在 os.tmpdir()，不在 cwd 子树 → deny
  expectPathDenied(() => readAddonVersion(tmpProject));
});
```

⚠️ `isolatePathEnv()` 在 it 内调用（非 beforeEach）——afterEach 仍注册到该 it 后。Task 1 已验证此模式可行。但注意：顶层 beforeEach 的 `asUnrestrictedPath()` 也注册了 afterEach，此 it 内 `isolatePathEnv()` 再注册一个——两个 afterEach 都会跑（vitest 栈式）。验证 env 最终态正确（Step 4）。

- [ ] **Step 4: 其余 deny it（:78-103/:129）同步改 isolatePathEnv + expectPathDenied**

:78（S1 symlink）保留 vi.stubEnv('ALLOWED_PROJECT_PATHS', allowedRoot) 改为 `isolatePathEnv({ allowed: [allowedRoot] })`；:129 同理。throw 断言改 `expectPathDenied(() => readAddonVersion(...))` 或 `updateAddon(...)`。

- [ ] **Step 5: 运行确认计数一致**

Run: `npx vitest run test/addon-version.test.ts 2>&1 | tail -3`
Expected: passed == Step 1 基线。

- [ ] **Step 6: commit**

```bash
git add test/addon-version.test.ts
git commit -m "refactor(test): addon-version 改用 path-isolation helper（行为不变）"
```

---

## Task 4: 重构 security-paths.test.js

**Files:**
- Modify: `test/security-paths.test.js`

**现状**（:152-299）：两个 describe（C-SEC-1 / C-1），各自 save ALLOWED+UNRESTRICTED + beforeEach delete UNRESTRICTED + reset；afterEach restore + reset + rmSync tmpRoots。**it 内动态设 ALLOWED（process.env.ALLOWED_PROJECT_PATHS = root，每个 it 的 root 不同）**——helper 只能清初始态，it 内 ALLOWED 保留手动。

- [ ] **Step 1: 基线计数**

Run: `npx vitest run test/security-paths.test.js 2>&1 | tail -3`

- [ ] **Step 2: 改写 C-SEC-1 describe（:152-210）**

import 追加 `import { isolatePathEnv } from './helpers/path-isolation.js';`（.js 文件 import .js helper）。

beforeEach（:158-164）改为：

```js
beforeEach(() => {
  isolatePathEnv();   // 清 UNRESTRICTED + reset（ALLOWED 由各 it 内 makeRoot 后手动设）
  tmpRoots = [];
});
```

afterEach（:166-175）改为仅 rmSync tmpRoots：

```js
afterEach(() => {
  for (const r of tmpRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
```

移除 `let savedAllowed; let savedUnrestricted;`（:154-155）。it 内 `process.env.ALLOWED_PROJECT_PATHS = root`（:185 等）**保留不动**（动态 root，helper 不管）。

- [ ] **Step 3: 改写 C-1 describe（:214-299）**——同 Step 2 模式（beforeEach isolatePathEnv + afterEach rmSync，it 内 ALLOWED 保留）。

- [ ] **Step 4: 运行确认计数一致**

Run: `npx vitest run test/security-paths.test.js 2>&1 | tail -3`
Expected: passed == Step 1 基线。

- [ ] **Step 5: commit**

```bash
git add test/security-paths.test.js
git commit -m "refactor(test): security-paths 改用 path-isolation helper（行为不变）"
```

---

## Task 5: 重构 helpers.test.js（isPathInAllowedRoots + allowOutsideProjectPaths）

**Files:**
- Modify: `test/helpers.test.js`（:191-301 两个 describe）

**现状特殊**：用 `const originalEnv = process.env` + beforeEach `process.env = {...originalEnv}`（整体替换）+ afterAll restore。isPathInAllowedRoots describe 还 delete ALLOW_OUTSIDE + reset。

- [ ] **Step 1: 基线计数**

Run: `npx vitest run test/helpers.test.js 2>&1 | tail -3`

- [ ] **Step 2: 改写 allowOutsideProjectPaths describe（:191-222）**

beforeEach（:194-198）改为：

```js
beforeEach(() => {
  isolatePathEnv();   // 清 UNRESTRICTED + 删 ALLOWED + reset（替代 process.env 整体替换）
});
```

⚠️ 现状用 `process.env = {...originalEnv}` 整体替换（保留其他 env）。helper 的 isolatePathEnv 只清 UNRESTRICTED+ALLOWED，**不整体替换**。若该 describe 的 it 依赖"其他 env 被清空"→ 保留 originalEnv 模式（不强套 helper）。**先试 isolatePathEnv，Step 4 验证；若有 it 因其他 env 残留失败，回退 originalEnv 模式**。

移除 `const originalEnv = process.env`（:192）+ afterAll（:200-202）——helper afterEach 替代。

- [ ] **Step 3: 改写 isPathInAllowedRoots describe（:226-301）**

beforeEach（:229-235）改为：

```js
beforeEach(() => {
  isolatePathEnv();
  delete process.env.ALLOW_OUTSIDE_PROJECT_PATHS;   // helper 不管此变量，保留手动
});
```

注意 `should log warning only once`（:274-283）依赖 `_resetPathAllowWarned` + warn spy——isolatePathEnv 已调 reset，spy 测试行为应不变（Step 4 验证）。移除手动 `_resetPathAllowWarned()` 调用（:234/:251/:277，helper 已管）。

- [ ] **Step 4: 运行确认计数一致**

Run: `npx vitest run test/helpers.test.js 2>&1 | tail -3`
Expected: passed == Step 1 基线。**若有 it 失败**（env 残留/warn 计数变化），核查是否 originalEnv 整体替换语义丢失，针对性保留手动段。

- [ ] **Step 5: commit**

```bash
git add test/helpers.test.js
git commit -m "refactor(test): helpers.test isPathInAllowedRoots 改用 path-isolation helper（行为不变）"
```

---

## Task 6: 重构 path-utils-roots.test.ts（最复杂：dynamic roots）

**Files:**
- Modify: `test/core/path-utils-roots.test.ts`

**现状特殊**：测 dynamic roots 子系统，隔离含 `setAllowedRootsFromClient(null)`（helper 不管）。两个 describe（Task1 :11-79 / Task2 :81-122）各自 beforeEach delete ALLOWED+UNRESTRICTED + setAllowedRootsFromClient(null)；afterEach restore env + setAllowedRootsFromClient(null)。

- [ ] **Step 1: 基线计数**

Run: `npx vitest run test/core/path-utils-roots.test.ts 2>&1 | tail -3`

- [ ] **Step 2: 改写 Task 1 describe（:11-79）**

beforeEach（:15-19）改为：

```ts
beforeEach(() => {
  isolatePathEnv({ allowed: [] });   // 清 UNRESTRICTED + 删 ALLOWED + reset
  setAllowedRootsFromClient(null);    // dynamic roots 状态 helper 不管，保留手动
});
```

afterEach（:20-25）改为仅 dynamic roots restore：

```ts
afterEach(() => {
  setAllowedRootsFromClient(null);    // env restore 由 helper afterEach
});
```

移除 `const origEnv/origUnrestricted`（:12-13）。**补 reset**（现状此文件 0 次 reset，helper 补上——修复 spec 审阅偏差1）。

- [ ] **Step 3: 改写 Task 2 describe（:81-122）**——同 Step 2 模式。

- [ ] **Step 4: 运行确认计数一致**

Run: `npx vitest run test/core/path-utils-roots.test.ts 2>&1 | tail -3`
Expected: passed == Step 1 基线。**关键验证**：`UNRESTRICTED 仍最高优先`（:56-60）测 bypass——isolatePathEnv 清 UNRESTRICTED 后，该 it 内 `process.env.GODOT_MCP_UNRESTRICTED='true'` 手动设回（:58）仍生效（isolatePathEnv 只清初始，不锁）。

- [ ] **Step 5: commit**

```bash
git add test/core/path-utils-roots.test.ts
git commit -m "refactor(test): path-utils-roots 改用 path-isolation helper（行为不变，补 reset）"
```

---

## Task 7: 全量验证 + final review

**Files:** 无新改动，验证整支。

- [ ] **Step 1: 全量 vitest**

Run: `npm test 2>&1 | tail -5`
Expected: 全绿，0 failed。对比 E-P2 基线（4262 passed，以实跑为准），重构不应改变总数（纯手法替换）。

- [ ] **Step 2: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint test/helpers/path-isolation.ts test/helpers/path-isolation.test.ts`
Expected: 0 errors。（eslint src/ 不含 test/，但 helper 新文件手动 lint。）

- [ ] **Step 3: 抽查 afterEach 恢复无跨文件污染**

Run: `npx vitest run test/helpers/path-isolation.test.ts test/security-paths.test.js test/helpers.test.js 2>&1 | tail -3`
Expected: 全绿（验证多文件混跑 helper afterEach 不互相污染）。

- [ ] **Step 4: final review opus（整支）**

调 superpowers:requesting-code-review，审查范围：helper 实现 + 5 文件重构 diff。重点：行为不变（计数一致）+ afterEach 恢复无污染 + dynamic roots/ALLOW_OUTSIDE 等手动段保留正确。

- [ ] **Step 5: 项目待办 :95 回标 + master 状态**

`D:\workspace\Obsidian\GodotMCP\项目待办.md` 第 95 行 `[ ]` → `[x]` + commit hash + 一句话 hook。`git rev-list --count origin/master..master` 确认领先数（惯例不 push）。

---

## Self-Review

**1. Spec coverage：** spec §设计/helper → Task 1；spec §设计/重构 5 文件表 → Task 2-6（逐文件，契合度排序）；spec §验收（全量绿/计数一致/tsc/final review/待办回标）→ Task 7。spec §实现不确定性（afterEach scope）→ Task 1 Step 5 判据 + fallback 代码。全覆盖。

**2. Placeholder scan：** 无 TBD。Task 1 Step 5 的 fallback 是条件分支（带完整代码 + 判据），非占位。各 task 行号基准 git HEAD dcfe4ca（改动前 grep 核实）。

**3. Type consistency：** `isolatePathEnv`/`asUnrestrictedPath`/`expectPathDenied` 三函数名在 Task 1 定义，Task 2-6 消费——签名一致（`isolatePathEnv(opts?: {allowed?:string[]; cwd?:string})` 返回 void 或 restore 函数视 Task 1 选定）。Task 2 的 async deny 断言保留原 `rejects.toThrow`（expectPathDenied 同步不适用）——已在 Task 2 Step 2 注明，非签名不一致。

**4. 风险点：** Task 5（helpers.test.js process.env 整体替换语义）/ Task 6（dynamic roots）契合度中等，plan 已注明"先试 helper，失败回退手动段"。Task 3 的 it 内 isolatePathEnv + 顶层 asUnrestrictedPath 双 afterEach 交互——Task 7 Step 3 抽查验证。
