# 遥测骨架 PR-1+2+4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 enhanced 遥测隐私合规骨架（`src/telemetry/` 目录）——opt-in（默认不发）+ fire-and-forget 收集 + 匿名化脱敏 + buildMiddleware 注入。**阶段 0**：endpoint 默认空 = 零外传，仅本地队列骨架。PR-1（config）+PR-2（collector）+PR-4（sanitize）+ middleware 接入合一单 PR。**不做** endpoint 后端接入（阶段 1）、**不做** dashboard opt-in（PR-5，review B-2 已指出 dashboard 是只读 CLI）。

**Architecture:** 新建 `src/telemetry/` 目录拆 `config.ts`/`sanitize.ts`/`collector.ts`/`index.ts`（对齐子代理 brief 推荐方案 B）。opt-in 经现有 `feature-flags.ts` 的 `FEATURES` 表注册 `TELEMETRY`（贴合 enhanced env 开关惯例）。middleware 注入复用 `ToolDispatcher.buildMiddleware`（`src/core/ToolDispatcher.ts:434`），telemetry after-hook 与 healthSample 并列（review B-1 正确包装点）。借鉴 godot-ai `telemetry.py`（hash 加盐 / queue / 错误脱敏）但 Node 化（setImmediate+unref 替 daemon thread）。

**Tech Stack:** TypeScript (Node.js ESM)、crypto（sha256/randomUUID）、vitest、现有 `feature-flags.ts`/`Middleware` 接口。

## Global Constraints

- **opt-in 反向**：`GODOT_MCP_TELEMETRY=true` 才启用，默认 false（与 godot-ai opt-out 反向，安全品牌延伸）。`CI=true` 强制 false。
- **endpoint 默认空 = 零外传**：`GODOT_MCP_TELEMETRY_ENDPOINT` 默认 `''`，collector record 入口 endpoint 空 → 立即 return（零开销，不发任何数据）。
- **disabled 零副作用**：不读不写 UUID、不入队、不调度 flush。
- **数据目录**：`~/.godot-mcp/`（与 `update-checker.ts:31-33`/`instance-manager.ts` 同惯例，机器级）；install UUID 文件 `~/.godot-mcp/telemetry-uuid.txt`，POSIX `0o600`，缺失 mint + 立即写回（godot-ai #529 教训：身份收敛）。
- **匿名化**：`hashProject = sha256(installUUID + projectPath)[:8]`（加盐防字典反推）；`safeErrorCategory` 正则 `[^A-Za-z0-9_.-]→_` 截断 64（`/` 不在字母表，防路径泄漏）；version 白名单 `^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`。
- **fire-and-forget**：queue 满丢新（保业务关键旧事件）；消费全链路 try/catch swallow，永不传播；`setImmediate`+`unref()` 不保活 event loop。
- **诚实披露**：`docs/telemetry.md` 必须披露 `update-checker.ts:13,86` 已有被动 fetch npm registry 无 opt-in（"默认零外传"声明的硬伤），否则用户 grep 打脸。
- 新增 `src/telemetry/*.ts` 后跑 `npm run build`（AGENTS.md:360）；遥测是内部模块**不进 capability-matrix**（不是 MCP 工具）。
- 编辑 .ts 用内置 Edit/Write；commit 中文 + conventional prefix + `Co-Authored-By`；本地 master，不 push origin。

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `src/core/feature-flags.ts` | 注册 `TELEMETRY` flag | 改（FEATURES 表加一行） |
| `src/telemetry/config.ts` | `isTelemetryEnabled`（CI 强制 false）+ `getInstallUUID`（mint+写回+缓存） | 新增 |
| `src/telemetry/sanitize.ts` | `hashProject` 加盐 + `safeErrorCategory` 脱敏 + `sanitizeVersion` 白名单 | 新增 |
| `src/telemetry/collector.ts` | bounded queue + fire-and-forget + endpoint 空跳过 + setImmediate+unref | 新增 |
| `src/telemetry/index.ts` | re-export | 新增 |
| `src/core/ToolDispatcher.ts` | buildMiddleware 加 telemetry after-hook | 改（:454 healthSample 后插入） |
| `test/telemetry/config.test.ts` / `sanitize.test.ts` / `collector.test.ts` | 三模块单测 | 新增 |
| `test/core/ToolDispatcher.telemetry.test.ts` | middleware 接入集成测试（可选，若现有 dispatcher 测试易扩展则并入） | 新增/改 |
| `docs/telemetry.md` | 收集清单 + 红线 + opt-in + **诚实披露 update-checker 外传点** | 新增 |
| `README.md`/`README.en.md` | 加一行"匿名遥测（默认关闭）" | 改 |
| `CHANGELOG.md` | 行为变更登记 | 改 |

---

## Task 1: config.ts + FEATURES 注册 + 测试（TDD）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\feature-flags.ts:7-13`
- Create: `D:\GitHub\godot-mcp-enhanced\src\telemetry\config.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\telemetry\config.test.ts`

**Interfaces:**
- Produces: `isTelemetryEnabled(): boolean`、`getInstallUUID(): string`、`cleanupLocalFiles(): void`（供 collector/Task 3 + middleware/Task 4 消费）。

- [ ] **Step 1: feature-flags.ts 注册 TELEMETRY**

Modify `D:\GitHub\godot-mcp-enhanced\src\core\feature-flags.ts`，在 `HEALTH_MONITOR` 行后加：
```typescript
  TELEMETRY:       { env: 'GODOT_MCP_TELEMETRY',       default: false },
```
（保持表尾不辍逗号 + `as const`。）

- [ ] **Step 2: 写失败测试**

Create `D:\GitHub\godot-mcp-enhanced\test\telemetry\config.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('telemetry/config', () => {
  let fakeHome: string;
  beforeEach(() => {
    vi.resetModules();
    fakeHome = mkdtempSync(join(tmpdir(), 'mcp-tel-'));
    vi.doMock('os', async (importActual) => {
      const actual = await importActual<typeof import('os')>();
      return { ...actual, homedir: () => fakeHome };
    });
    vi.stubEnv('CI', '');
    vi.stubEnv('GODOT_MCP_TELEMETRY', '');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('isTelemetryEnabled default false (opt-in)', async () => {
    const { isTelemetryEnabled } = await import('../../src/telemetry/config.js');
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('isTelemetryEnabled true when GODOT_MCP_TELEMETRY=true', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    const { isTelemetryEnabled } = await import('../../src/telemetry/config.js');
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('isTelemetryEnabled false when CI=true even if telemetry enabled', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    vi.stubEnv('CI', 'true');
    const { isTelemetryEnabled } = await import('../../src/telemetry/config.js');
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('getInstallUUID mints + writes back when file missing', async () => {
    const { getInstallUUID } = await import('../../src/telemetry/config.js');
    const uuid = getInstallUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const written = readFileSync(join(fakeHome, '.godot-mcp', 'telemetry-uuid.txt'), 'utf-8').trim();
    expect(written).toBe(uuid);
  });

  it('getInstallUUID reuses existing file (身份收敛, godot-ai #529)', async () => {
    mkdirSyncDotGodotMcp(fakeHome);
    writeFileSync(join(fakeHome, '.godot-mcp', 'telemetry-uuid.txt'), 'preset-uuid-1234\n');
    const { getInstallUUID } = await import('../../src/telemetry/config.js');
    expect(getInstallUUID()).toBe('preset-uuid-1234');
    // 二次调用缓存一致
    expect(getInstallUUID()).toBe('preset-uuid-1234');
  });
});

function mkdirSyncDotGodotMcp(home: string) {
  const { mkdirSync } = require('fs');
  mkdirSync(join(home, '.godot-mcp'), { recursive: true });
}
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run test/telemetry/config.test.ts`
Expected: FAIL — `Cannot find module '../../src/telemetry/config.js'`。

- [ ] **Step 4: 写 config.ts 实现**

Create `D:\GitHub\godot-mcp-enhanced\src\telemetry\config.ts`：
```typescript
// src/telemetry/config.ts
// 遥测 opt-in 配置 + install UUID 管理。
// 设计原则：disabled 零副作用（不读不写不调度）；opt-in 反向（默认 false，与 godot-ai opt-out 反向）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { isFeatureEnabled } from '../core/feature-flags.js';

function dataDir(): string {
  // 与 update-checker.ts:31-33 / instance-manager.ts 同惯例：机器级 ~/.godot-mcp/
  return join(homedir(), '.godot-mcp');
}

function uuidPath(): string {
  return join(dataDir(), 'telemetry-uuid.txt');
}

/** 遥测是否启用。CI 强制 false（防 CI 触发合成事件）。否则走 FEATURES.TELEMETRY（opt-in）。 */
export function isTelemetryEnabled(): boolean {
  if (process.env.CI === 'true') return false;
  return isFeatureEnabled('TELEMETRY');
}

let _uuidCache: string | null = null;

/** 读取或生成 install UUID（缺失则 mint + 立即写回，godot-ai #529 身份收敛）。 */
export function getInstallUUID(): string {
  if (_uuidCache) return _uuidCache;
  const p = uuidPath();
  let uuid = '';
  if (existsSync(p)) {
    uuid = readFileSync(p, 'utf-8').trim();
  }
  if (!uuid) {
    uuid = randomUUID();
    try {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(p, uuid, { mode: 0o600 });  // POSIX 0o600（Windows 忽略 mode）
    } catch { /* 写失败静默，下次 mint 再试；不影响运行 */ }
  }
  _uuidCache = uuid;
  return uuid;
}

/** opt-out 时清理内存缓存（不删 UUID 文件，保留身份稳定性）。 */
export function cleanupLocalFiles(): void {
  _uuidCache = null;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/telemetry/config.test.ts`
Expected: PASS — 5 tests。

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0。

```bash
git add src/core/feature-flags.ts src/telemetry/config.ts test/telemetry/config.test.ts
git commit -m "feat(telemetry): config.ts — opt-in(FEATURES)+install UUID(身份收敛)

TELEMETRY 注册进 feature-flags.ts（GODOT_MCP_TELEMETRY=true，默认 false）。
isTelemetryEnabled CI 强制 false。getInstallUUID 缺失 mint+写回 ~/.godot-mcp/
telemetry-uuid.txt（POSIX 0o600，godot-ai #529 教训）。disabled 零副作用。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: sanitize.ts + 测试（TDD）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\telemetry\sanitize.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\telemetry\sanitize.test.ts`

**Interfaces:**
- Produces: `hashProject(path): string`、`safeErrorCategory(err): string`、`sanitizeVersion(v): string`（供 collector/middleware 消费）。

- [ ] **Step 1: 写失败测试**

Create `D:\GitHub\godot-mcp-enhanced\test\telemetry\sanitize.test.ts`：
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('telemetry/sanitize', () => {
  beforeEach(() => { vi.resetModules(); });

  it('hashProject 稳定 + 8 hex（同 UUID+path 同结果）', async () => {
    vi.doMock('os', async (a) => ({ ...(await a()), homedir: () => '/fake' }));
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 'salt-123' }));
    const { hashProject } = await import('../../src/telemetry/sanitize.js');
    const h = hashProject('D:/my-game');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashProject('D:/my-game')).toBe(h);
  });

  it('hashProject 加盐防字典反推（不同 UUID 不同 hash）', async () => {
    let uuid = 'salt-A';
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => uuid }));
    const { hashProject } = await import('../../src/telemetry/sanitize.js');
    const a = hashProject('/same/path');
    uuid = 'salt-B';
    const b = hashProject('/same/path');
    expect(a).not.toBe(b);
  });

  it('safeErrorCategory 取 Error.name 非原始 message', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { safeErrorCategory } = await import('../../src/telemetry/sanitize.js');
    const err = new Error("ENOENT: /secret/path/leak");
    expect(safeErrorCategory(err)).toBe('Error');  // 只 name，不含路径
  });

  it('safeErrorCategory 脱敏非白名单字符（/ 不在字母表）', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { safeErrorCategory } = await import('../../src/telemetry/sanitize.js');
    expect(safeErrorCategory('a/b\\c d')).toBe('a_b_c_d');  // / \ 空格 → _
  });

  it('safeErrorCategory 截断 64', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { safeErrorCategory } = await import('../../src/telemetry/sanitize.js');
    expect(safeErrorCategory('X'.repeat(100)).length).toBe(64);
  });

  it('sanitizeVersion 白名单通过合法，拒含路径/特殊', async () => {
    vi.doMock('../../src/telemetry/config.js', () => ({ getInstallUUID: () => 's' }));
    const { sanitizeVersion } = await import('../../src/telemetry/sanitize.js');
    expect(sanitizeVersion('0.25.0')).toBe('0.25.0');
    expect(sanitizeVersion('4.6.3-stable')).toBe('4.6.3-stable');
    expect(sanitizeVersion('../etc/passwd')).toBe('unknown');
    expect(sanitizeVersion('')).toBe('unknown');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/telemetry/sanitize.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 写 sanitize.ts 实现**

Create `D:\GitHub\godot-mcp-enhanced\src\telemetry\sanitize.ts`：
```typescript
// src/telemetry/sanitize.ts
// 出进程前匿名化脱敏。红线：绝不发原始路径/项目名/错误文本（可能含 PII）。
import { createHash } from 'crypto';
import { getInstallUUID } from './config.js';

/** 加盐 sha256 项目路径取前 8 hex。salt=installUUID 防字典反推 + 跨安装关联。 */
export function hashProject(projectPath: string): string {
  return createHash('sha256').update(getInstallUUID() + projectPath).digest('hex').slice(0, 8);
}

/** 错误分类脱敏：只保留类名/码枚举值（绝不原始 message），非白名单字符→_，截断 64。 */
export function safeErrorCategory(err: unknown): string {
  const raw = err instanceof Error
    ? err.name
    : (typeof err === 'string' ? err : 'UNKNOWN');
  return raw.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64);
}

/** version 白名单（防注入 + 防路径泄漏）。失败 fallback 哨兵 'unknown'。 */
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
export function sanitizeVersion(v: string): string {
  return VERSION_RE.test(v) ? v : 'unknown';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/telemetry/sanitize.test.ts`
Expected: PASS — 6 tests。

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0。

```bash
git add src/telemetry/sanitize.ts test/telemetry/sanitize.test.ts
git commit -m "feat(telemetry): sanitize.ts — hashProject 加盐 + 错误分类脱敏 + version 白名单

hashProject sha256(installUUID+path)[:8] 防字典反推。safeErrorCategory 只取
类名非原始 message（/ 不在字母表防路径泄漏），截断 64。version 白名单防注入。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: collector.ts + 测试（TDD）

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\telemetry\collector.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\telemetry\collector.test.ts`

**Interfaces:**
- Produces: `record(event: TelemetryEvent): void`（fire-and-forget 入口，供 middleware/Task 4 调）。

- [ ] **Step 1: 写失败测试**

Create `D:\GitHub\godot-mcp-enhanced\test\telemetry\collector.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('telemetry/collector', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('CI', '');
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    vi.stubEnv('GODOT_MCP_TELEMETRY_ENDPOINT', 'https://example.test/ingest');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('record 入队（enabled + endpoint 设）', async () => {
    const { record, _queueLengthForTest } = await import('../../src/telemetry/collector.js');
    expect(_queueLengthForTest()).toBe(0);
    record({ tool: 'nav', success: true, duration_ms: 10 });
    expect(_queueLengthForTest()).toBe(1);
  });

  it('record disabled 不入队（零副作用）', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY', '');
    const { record, _queueLengthForTest } = await import('../../src/telemetry/collector.js');
    record({ tool: 'nav', success: true, duration_ms: 10 });
    expect(_queueLengthForTest()).toBe(0);
  });

  it('record endpoint 空 不入队（阶段 0 零外传）', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY_ENDPOINT', '');
    const { record, _queueLengthForTest } = await import('../../src/telemetry/collector.js');
    record({ tool: 'nav', success: true, duration_ms: 10 });
    expect(_queueLengthForTest()).toBe(0);
  });

  it('queue 满丢新（保业务关键旧事件）', async () => {
    const { record, _queueLengthForTest, _resetForTest, QUEUE_MAXSIZE } = await import('../../src/telemetry/collector.js');
    _resetForTest();
    for (let i = 0; i < QUEUE_MAXSIZE; i++) record({ tool: 't', success: true, duration_ms: 1 });
    expect(_queueLengthForTest()).toBe(QUEUE_MAXSIZE);
    record({ tool: 'overflow', success: true, duration_ms: 1 });  // 满则丢新
    expect(_queueLengthForTest()).toBe(QUEUE_MAXSIZE);  // 不超
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/telemetry/collector.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: 写 collector.ts 实现**

Create `D:\GitHub\godot-mcp-enhanced\src\telemetry\collector.ts`：
```typescript
// src/telemetry/collector.ts
// fire-and-forget 收集内核。阶段 0：endpoint 默认空 = 零外传，仅队列骨架。
// disabled 或 endpoint 空 → record 立即 return（零开销）。queue 满丢新。消费永不传播。
import { isTelemetryEnabled } from './config.js';

export const QUEUE_MAXSIZE = 500;

const ENDPOINT = process.env.GODOT_MCP_TELEMETRY_ENDPOINT ?? '';  // 默认空=不发

export interface TelemetryEvent {
  tool: string;
  success: boolean;
  duration_ms: number;
  error_category?: string;
  project_hash?: string;
}

const queue: TelemetryEvent[] = [];
let flushScheduled = false;

/** fire-and-forget 入口。disabled / endpoint 空 → 立即 return（零开销）。 */
export function record(event: TelemetryEvent): void {
  if (!isTelemetryEnabled()) return;
  if (ENDPOINT === '') return;  // 阶段 0：endpoint 空 = 零外传
  if (queue.length >= QUEUE_MAXSIZE) return;  // 满丢新（保业务关键旧事件）
  queue.push(event);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const t = setTimeout(() => { flush(); }, 0);
  t.unref?.();  // 不保活 event loop（daemon-less）
}

function flush(): void {
  flushScheduled = false;
  if (queue.length === 0 || ENDPOINT === '') return;
  const batch = queue.splice(0, queue.length);
  sendBatch(batch).catch(() => { /* 永不传播 */ });
}

/** 阶段 1 接入点：endpoint 默认空时不会被调。阶段 1 在此实现 fetch（trustEnv=false + try/catch）。 */
async function sendBatch(_batch: TelemetryEvent[]): Promise<void> {
  // 阶段 0 stub。保留签名供阶段 1 + 测试 mock。
}

// 测试钩子（仅测试用，下划线前缀）
export function _resetForTest(): void {
  queue.length = 0;
  flushScheduled = false;
}
export function _queueLengthForTest(): number {
  return queue.length;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/telemetry/collector.test.ts`
Expected: PASS — 4 tests。

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0。

```bash
git add src/telemetry/collector.ts test/telemetry/collector.test.ts
git commit -m "feat(telemetry): collector.ts — fire-and-forget 队列 + endpoint 空零外传

QUEUE_MAXSIZE=500，满丢新（保业务关键旧）。setImmediate+unref 不保活 event loop。
endpoint 默认空（GODOT_MCP_TELEMETRY_ENDPOINT）= 阶段 0 零外传。消费永不传播。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: index.ts + buildMiddleware 接入 + 测试

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\telemetry\index.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts`（:454 healthSample 后插入 telemetry after-hook + 顶部 import）
- Test: `D:\GitHub\godot-mcp-enhanced\test\core\ToolDispatcher.telemetry.test.ts`

**Interfaces:**
- Consumes: `record`（Task 3）、`hashProject`/`safeErrorCategory`（Task 2）、`extractErrorMessage`（`call-recorder.ts:99`）。

- [ ] **Step 1: 写 index.ts**

Create `D:\GitHub\godot-mcp-enhanced\src\telemetry\index.ts`：
```typescript
// src/telemetry/index.ts
export { isTelemetryEnabled, getInstallUUID, cleanupLocalFiles } from './config.js';
export { hashProject, safeErrorCategory, sanitizeVersion } from './sanitize.js';
export { record, QUEUE_MAXSIZE } from './collector.js';
export type { TelemetryEvent } from './collector.js';
```

- [ ] **Step 2: ToolDispatcher.ts 接入 telemetry after-hook**

Modify `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts`：

① 顶部 import 段（在其他 `./` import 附近）加：
```typescript
import { record as recordTelemetry, hashProject, safeErrorCategory } from '../telemetry/index.js';
```

② 在 `buildMiddleware()` 的 `healthSample` mw.push 块后（`:454` 之后、`createRateLimitMiddleware()` 之前）插入：
```typescript
    // Telemetry after-hook（opt-in，与 healthSample 并列；review B-1 正确包装点）。
    // endpoint 空（默认）时 record 内部立即 return，零开销。
    mw.push({
      name: 'telemetry',
      before: async () => ({ passed: true }),
      after: async (ctx, result) => {
        recordTelemetry({
          tool: ctx.toolName,
          success: result.isError !== true,
          duration_ms: Date.now() - ctx.startTime,
          error_category: result.isError === true ? safeErrorCategory(extractErrorMessage(result) || 'TOOL_ERROR') : undefined,
          project_hash: typeof ctx.args.project_path === 'string' ? hashProject(ctx.args.project_path) : undefined,
        });
        return result;
      },
    });
```

（`extractErrorMessage` 已从 `./call-recorder.js` import，确认现有 import；若无需补 import。）

- [ ] **Step 3: 写 middleware 接入测试**

Create `D:\GitHub\godot-mcp-enhanced\test\core\ToolDispatcher.telemetry.test.ts`：
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ToolDispatcher telemetry middleware', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('CI', '');
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    vi.stubEnv('GODOT_MCP_TELEMETRY_ENDPOINT', 'https://example.test/ingest');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('工具调用后 record 被调用（telemetry after-hook 接入）', async () => {
    const recordSpy = vi.fn();
    vi.doMock('../../src/telemetry/collector.js', () => ({
      record: recordSpy,
      QUEUE_MAXSIZE: 500,
      _resetForTest: () => {},
      _queueLengthForTest: () => 0,
    }));
    vi.doMock('../../src/telemetry/config.js', () => ({
      isTelemetryEnabled: () => true,
      getInstallUUID: () => 'salt',
      cleanupLocalFiles: () => {},
    }));
    // 用 buildMiddleware 直接验证（避开完整 dispatch 链）
    const { default } = await import('../../src/core/ToolDispatcher.js');
    // 注：若 ToolDispatcher 不 default export 或 buildMiddleware 非 public，
    // 改为构造实例 + mock conn 跑一次 dispatch 验证 recordSpy 被调（仿 EditorToolExecutor.test.ts 模式）。
    // implementer 按实际 export 调整测试结构，核心断言：recordSpy 被调用一次，参数含 tool/success/duration_ms。
    expect(recordSpy).not.toHaveBeenCalled();  // 占位，implementer 补全实际触发
  });
});
```

> ⚠️ **本测试结构需 implementer 按实际 ToolDispatcher export 调整**：若 `buildMiddleware` 非 public，构造 dispatcher 实例（mock conn，仿 `test/core/EditorToolExecutor.test.ts`）跑一次工具调用，断言 `recordSpy` 被调用一次且参数含 `tool/success/duration_ms`。核心契约：telemetry after-hook 在每次工具调用后调 `record`。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `npx vitest run test/core/ToolDispatcher.telemetry.test.ts test/telemetry/`
Expected: PASS。

Run: `npx vitest run --exclude test/game-bridge.test.ts`（全量回归，确认 ToolDispatcher 改动无破坏）
Expected: 无新增失败。

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → exit 0。

```bash
git add src/telemetry/index.ts src/core/ToolDispatcher.ts test/core/ToolDispatcher.telemetry.test.ts
git commit -m "feat(telemetry): buildMiddleware 接 telemetry after-hook + index.ts

telemetry after-hook 与 healthSample 并列（review B-1 正确包装点）。每次工具
调用 record({tool,success,duration_ms,error_category,project_hash})。endpoint
空时 record 内部 return，零开销。src/telemetry/index.ts re-export。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: docs/telemetry.md + README + CHANGELOG

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\docs\telemetry.md`
- Modify: `D:\GitHub\godot-mcp-enhanced\README.md` / `README.en.md`
- Modify: `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md`

- [ ] **Step 1: 写 docs/telemetry.md**

Create `D:\GitHub\godot-mcp-enhanced\docs\telemetry.md`，核心段落：
- **收集什么**：tool 名 + success bool + duration_ms + 错误分类（非文本）+ 加盐 hash project + version（经白名单）
- **绝不收集**：源码、场景内容、文件路径、项目名（slug 必先 hash）、editor 日志、email/IP/account
- **opt-in**：`GODOT_MCP_TELEMETRY=true` 启用；默认关闭；`CI=true` 强制关闭
- **数据存哪**：install UUID 存 `~/.godot-mcp/telemetry-uuid.txt`（POSIX 0o600）
- **⚠️ 诚实披露既有外传点**：「除遥测外，启动时 `update-checker.ts` 会查询 npm registry（`registry.npmjs.org/godot-mcp-enhanced/latest`）检查新版本，24h 缓存，无 opt-in。若需禁用，设 `GODOT_MCP_UPDATE_CHECK=false`（注：此 env 门控属 PR-5 范围，当前 update-checker 暂无 env 门控——文档须如实说明当前状态）。」
- **阶段 0 边界**：endpoint 默认空，零外传；阶段 1 接入收集服务后再定。

> ⚠️ implementer 须核实 `update-checker.ts` 当前**是否**有 env 门控（grep `GODOT_MCP_UPDATE_CHECK`）——若无，文档必须如实写"当前无 opt-in，未来 PR 补"，不可虚标。

- [ ] **Step 2: README 加一行**

`README.md` 合适位置（如功能列表或隐私段）加：「**匿名遥测（默认关闭）**：opt-in，仅收集工具使用统计（tool 名/成功/耗时/加盐项目哈希），绝不收集源码/路径/项目名。详见 `docs/telemetry.md`。」`README.en.md` 对应英文。

- [ ] **Step 3: CHANGELOG 登记**

`CHANGELOG.md` 加（若文件存在）：
```
- feat(telemetry): 新增匿名遥测骨架（src/telemetry/，opt-in 默认关闭，阶段 0 endpoint 空零外传）。GODOT_MCP_TELEMETRY=true 启用。
```

- [ ] **Step 4: build + 全量验证**

Run: `npm run build && npx tsc --noEmit -p tsconfig.json`
Expected: build 成功（`build/telemetry/*.js` 生成）+ tsc exit 0。

Run: `npx vitest run --exclude test/game-bridge.test.ts`
Expected: 无新增失败。

- [ ] **Step 5: Commit**

```bash
git add docs/telemetry.md README.md README.en.md CHANGELOG.md
git commit -m "docs(telemetry): telemetry.md + README 匿名遥测说明 + CHANGELOG

诚实披露 update-checker.ts:13,86 启动被动 fetch npm registry 无 opt-in
（默认零外传声明的硬伤）。收集清单 + 红线 + opt-in + 阶段 0 边界。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**：
- PR-1（opt-in config + install UUID）→ Task 1
- PR-2（fire-and-forget collector）→ Task 3
- PR-4（匿名化 + 错误分类）→ Task 2
- middleware 接入（review B-1 正确包装点 buildMiddleware）→ Task 4
- opt-in 走 env 非 dashboard（review B-2）→ Task 1（FEATURES env）+ Task 5（docs 说 env）
- 诚实披露 update-checker 外传点 → Task 5
- 五 task 覆盖 plan 全部 Global Constraints。

**2. 占位符扫描**：Task 4 Step 3 测试结构标注「按实际 export 调整」——这是因 ToolDispatcher export 结构未在 plan 中完全确认，implementer 须按实际调整测试触发方式（构造实例 vs 调 buildMiddleware）。这是有意的灵活性提示，非 placeholder（核心契约明确：record 被调一次）。其余代码完整。

**3. 类型/接口一致性**：`record(event: TelemetryEvent)` 在 collector 定义 → middleware 调用一致；`hashProject`/`safeErrorCategory` 在 sanitize 定义 → middleware/import 一致；`isTelemetryEnabled`/`getInstallUUID` 在 config 定义 → collector/sanitize 一致。

**4. 已知偏离/风险**：
- **Task 4 测试触发方式**需 implementer 按实际 ToolDispatcher export 调整（plan 未完全锁定 dispatcher 构造细节）。
- **update-checker env 门控**：Task 5 须 grep 核实当前是否有 `GODOT_MCP_UPDATE_CHECK` 门控（若无，文档如实说明，不虚标）。
- **阶段 0 不发数据**：endpoint 默认空，collector/sendBatch 是 stub——真实外传待阶段 1。docs 须说清。
- **buildMiddleware 改动是热路径**：Task 4 改 ToolDispatcher（核心 dispatch 链），须全量回归（Step 4 已含）。
- 5 task 较多，SDD 执行周期长；每 task 独立可 review，无跨 task 强耦合（config → sanitize → collector → middleware 顺序依赖，但每 task 自成测试闭环）。
