# token 预算度量门禁 + 错误源码片段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 33 个 MCP 工具建立 description/inputSchema 体积度量与 warn-only CI 门禁（防 tools/list 推送膨胀），并为错误分析器附加出错行源码片段（减少 AI round-trip）。

**Architecture:** 纯增量，零架构变动。(1) 在 capability 提取管线加 `size` 维度（descBytes/schemaBytes/totalBytes），build-matrix 输出体积汇总，独立 `check-token-budget.mjs` 脚本按分层阈值 warn/error，CI 接 `check:budget` step（size 不进 diff-matrix drift）。(2) error-analyzer 的 ParsedError 加可选 `snippet` 字段，复用 `resolveWithinRoot`+`normalizeUserProjectPath` 两步惯例读源码（零新安全面），run_and_verify/execute_gdscript 传 projectPath 启用。

**Tech Stack:** TypeScript ESM（`type: module`）、Node ≥18（Buffer/fs 全局）、vitest、GitHub Actions。

## Global Constraints

- TypeScript ESM，import 路径**必须带 `.js` 扩展**（如 `'./schema.js'`），即使源文件是 `.ts`
- Node ≥18，`Buffer`/`fs` 全局可用，无需 import Buffer
- 测试用 vitest（`describe/it/expect`），跑 `npx vitest run <file>`
- commit message 中文，末尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`
- **本地 commit，不 push**（用户偏好 `[[user-prefers-local-ahead-no-push]]`）
- check:budget 为 **warn-only 基线**：error 阈值极高（当前 0 触发，留 ~70% 增长空间）
- `size` 字段**不纳入 diff-matrix drift**（diff-matrix 只比 added/removed/requiredParams/security 四维）
- snippet 仅当 `file` 以 `res://` 开头 **且** `options.projectPath` 提供 时启用；任何读取失败静默跳过（不影响错误本身的 type/message/suggestion）
- spec：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-14-token-budget-and-error-snippet-design.md`

---

### Task 1: capability size 维度（schema + extract）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\capability\schema.ts:47`（ToolCapability 接口 D 组后加 E 组）
- Modify: `D:\GitHub\godot-mcp-enhanced\src\capability\extract.ts:62-86`（return 前算 size，return 加字段）
- Test: `D:\GitHub\godot-mcp-enhanced\test\capability\extract.test.ts`（加 size 断言）

**Interfaces:**
- Produces: `ToolCapability.size: { descBytes: number; schemaBytes: number; totalBytes: number }`（后续 Task 2/3 依赖）

- [ ] **Step 1: 写失败测试（extract.test.ts 末尾 describe 内加 it）**

在 `D:\GitHub\godot-mcp-enhanced\test\capability\extract.test.ts` 的 `describe('extractCapabilities', ...)` 内最后一个 `it` 后追加：

```typescript
  it('populates E. size fields (descBytes/schemaBytes/totalBytes) for each tool', () => {
    registerAllModules();
    const caps = extractCapabilities(PROJECT_ROOT);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.size).toBeDefined();
      expect(c.size.descBytes).toBe(Buffer.byteLength(c.description, 'utf8'));
      expect(c.size.schemaBytes).toBe(Buffer.byteLength(JSON.stringify(c.inputSchema), 'utf8'));
      expect(c.size.totalBytes).toBe(c.size.descBytes + c.size.schemaBytes);
      expect(c.size.descBytes).toBeGreaterThan(0); // 每个工具有非空描述
    }
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/capability/extract.test.ts`
Expected: FAIL —— `c.size` 为 `undefined`（`expect(c.size).toBeDefined()` 失败）

- [ ] **Step 3: schema.ts 加 E 组 size 字段**

在 `D:\GitHub\godot-mcp-enhanced\src\capability\schema.ts` 的 ToolCapability 接口，`verification: { ... };` 之后（`:47` 行的 `}` 之前）加 E 组：

```typescript
  // ── E. 体积预算（token budget）──
  /** tools/list 推送体积度量（UTF-8 字节）。schemaBytes 用 JSON.stringify 紧凑序列化（下界估计）。 */
  size: {
    descBytes: number;
    schemaBytes: number;
    totalBytes: number;
  };
```

- [ ] **Step 4: extract.ts 计算 size 并填入 return**

在 `D:\GitHub\godot-mcp-enhanced\src\capability\extract.ts` 的 `return {` 之前（当前 `:62` 行 `const trustedNonRead = ...` 之后）加：

```typescript
    const descBytes = Buffer.byteLength(tool.description ?? '', 'utf8');
    const schemaBytes = Buffer.byteLength(JSON.stringify(tool.inputSchema), 'utf8');
```

在 return 对象内（`verification: { ... },` 之后，`:85` 行的 `} satisfies ToolCapability;` 之前）加：

```typescript
      size: { descBytes, schemaBytes, totalBytes: descBytes + schemaBytes },
```

- [ ] **Step 5: 跑测试确认通过 + tsc**

Run: `npx vitest run test/capability/extract.test.ts`
Expected: PASS（4 个 it 全绿）

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 6: Commit**

```bash
git add src/capability/schema.ts src/capability/extract.ts test/capability/extract.test.ts
git commit -m "feat(capability): 工具体积度量 size 维度（descBytes/schemaBytes/totalBytes）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: build-matrix 体积汇总输出 + 重跑 json/md

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\capability\build-matrix.ts:9`（export buildMarkdown + 概览加体积行 + 新增 TOP5 节）
- Test: `D:\GitHub\godot-mcp-enhanced\test\capability\build-matrix.test.ts`（新建）
- Regenerate: `D:\GitHub\godot-mcp-enhanced\docs\capability-matrix.json` + `docs\capability-matrix.md`（npm run build-matrix）

**Interfaces:**
- Consumes: `ToolCapability.size`（Task 1 产出）
- Produces: `export function buildMarkdown(caps)`（供测试）；json 产物自动含 size 字段

- [ ] **Step 1: export buildMarkdown（供测试）**

在 `D:\GitHub\godot-mcp-enhanced\src\capability\build-matrix.ts:9` 把 `function buildMarkdown` 改为 `export function buildMarkdown`。

- [ ] **Step 2: buildMarkdown 加体积计算 + 概览行 + TOP5 节**

在 `buildMarkdown` 函数内，`const lines = [` 之前（当前 `:21` 行 dangerTools 计算之后）加体积计算：

```typescript
  // token 预算（E 组 size 聚合）
  const totalBytes = caps.reduce((s, c) => s + c.size.totalBytes, 0);
  const schemaBytesAll = caps.reduce((s, c) => s + c.size.schemaBytes, 0);
  const descBytesAll = caps.reduce((s, c) => s + c.size.descBytes, 0);
  const schemaPct = totalBytes > 0 ? Math.round((schemaBytesAll / totalBytes) * 100) : 0;
  const top5 = [...caps].sort((a, b) => b.size.totalBytes - a.size.totalBytes).slice(0, 5);
  const top5Lines = top5.map(c =>
    `- \`${c.name}\` (${c.group}): desc ${c.size.descBytes}B / schema ${c.size.schemaBytes}B / total ${c.size.totalBytes}B`
  ).join('\n');
```

在 `lines` 数组的概览节（`- L2 覆盖：...` 行之后，`...(trustedList.length > 0 ? ...)` 之前）加一行：

```typescript
    `- token 预算：tools/list ≈ ${totalBytes}B / ~${Math.round(totalBytes / 4)} tokens（description ${descBytesAll}B / schema ${schemaBytesAll}B，schema 占 ${schemaPct}%）`,
```

在 `lines` 数组末尾（`gdScriptImpl 说明` 节的最后一个字符串之后、return 之前）加 TOP5 节：

```typescript
    ``,
    `## token 预算 TOP 5`,
    ...top5Lines,
```

- [ ] **Step 3: 写测试（build-matrix.test.ts 新建）**

创建 `D:\GitHub\godot-mcp-enhanced\test\capability\build-matrix.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { registerAllModules } from '../../src/core/module-loader.js';
import { extractCapabilities } from '../../src/capability/extract.js';
import { buildMarkdown } from '../../src/capability/build-matrix.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('buildMarkdown token budget', () => {
  it('includes token budget summary line and TOP 5 section', () => {
    registerAllModules();
    const caps = extractCapabilities(PROJECT_ROOT);
    const md = buildMarkdown(caps);
    expect(md).toContain('token 预算：tools/list');
    expect(md).toContain('## token 预算 TOP 5');
    // TOP5 必含体积最大的工具
    const top = [...caps].sort((a, b) => b.size.totalBytes - a.size.totalBytes)[0]!;
    expect(md).toContain(`\`${top.name}\``);
    // schema 占比百分比存在
    expect(md).toMatch(/schema 占 \d+%/);
  });
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/capability/build-matrix.test.ts`
Expected: PASS

- [ ] **Step 5: 重跑 build-matrix 更新 json/md 产物**

Run: `npm run build-matrix`
Expected: 控制台输出 `[build-matrix] N tools → docs/capability-matrix.{json,md}`

- [ ] **Step 6: 验证 json 含 size + diff-matrix 不报 drift**

Run: `node -e "const j=require('./docs/capability-matrix.json');console.log(j.tools[0].size)"`
Expected: 输出 `{ descBytes: ..., schemaBytes: ..., totalBytes: ... }`

Run: `npm run diff-matrix`
Expected: `no drift`（diff-matrix 只比四维硬契约，size 不进 drift）

- [ ] **Step 7: tsc + Commit**

Run: `npx tsc --noEmit`
Expected: 0 error

```bash
git add src/capability/build-matrix.ts test/capability/build-matrix.test.ts docs/capability-matrix.json docs/capability-matrix.md
git commit -m "feat(capability): build-matrix 输出 token 预算汇总 + TOP5

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: check-token-budget.mjs 门禁脚本

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\scripts\check-token-budget.mjs`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scripts\check-token-budget.test.ts`（新建）

**Interfaces:**
- Consumes: `docs/capability-matrix.json`（Task 2 重跑后含 size）
- Produces: `export const THRESHOLDS`、`export function checkBudget(caps)`（main 读 json 调用它，exit 1 当有 error）

- [ ] **Step 1: 写失败测试（check-token-budget.test.ts 新建）**

创建 `D:\GitHub\godot-mcp-enhanced\test\scripts\check-token-budget.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { checkBudget, THRESHOLDS } from '../../scripts/check-token-budget.mjs';

function mkCap(name: string, descBytes: number, schemaBytes: number) {
  return { name, group: 'core', size: { descBytes, schemaBytes, totalBytes: descBytes + schemaBytes } };
}

describe('checkBudget', () => {
  it('clean caps → no warnings, no errors', () => {
    const caps = [mkCap('a', 100, 1000), mkCap('b', 200, 2000)];
    const r = checkBudget(caps as never);
    expect(r.warnings).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.sum).toBe(3300);
  });

  it('per-tool total in warn band → warning, not error', () => {
    const caps = [mkCap('big', 1000, 6100)]; // total 7100 ≥ perToolTotal.warn(7000), < error(14000)
    const r = checkBudget(caps as never);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some(w => w.includes('big'))).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('per-tool schema over error threshold → error', () => {
    const caps = [mkCap('huge', 100, 13000)]; // schema ≥ perToolSchema.error(12000)
    const r = checkBudget(caps as never);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some(e => e.includes('huge'))).toBe(true);
  });

  it('total sum over error threshold → error', () => {
    // 构造 sum ≥ 120KB
    const caps = Array.from({ length: 20 }, (_, i) => mkCap(`t${i}`, 500, 6000)); // 20×6500 = 130000 ≥ 120*1024
    const r = checkBudget(caps as never);
    expect(r.errors.some(e => e.includes('total'))).toBe(true);
  });

  it('THRESHOLDS constants match spec', () => {
    expect(THRESHOLDS.perToolDesc.warn).toBe(800);
    expect(THRESHOLDS.perToolDesc.error).toBe(2000);
    expect(THRESHOLDS.perToolSchema.warn).toBe(6000);
    expect(THRESHOLDS.perToolSchema.error).toBe(12000);
    expect(THRESHOLDS.perToolTotal.warn).toBe(7000);
    expect(THRESHOLDS.perToolTotal.error).toBe(14000);
    expect(THRESHOLDS.totalSum.warn).toBe(80 * 1024);
    expect(THRESHOLDS.totalSum.error).toBe(120 * 1024);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scripts/check-token-budget.test.ts`
Expected: FAIL —— 模块不存在（`Cannot find module '../../scripts/check-token-budget.mjs'`）

- [ ] **Step 3: 实现 check-token-budget.mjs**

创建 `D:\GitHub\godot-mcp-enhanced\scripts\check-token-budget.mjs`：

```javascript
#!/usr/bin/env node
// scripts/check-token-budget.mjs
// MCP 工具 description/inputSchema 体积门禁（warn-only 基线）。
// 读 docs/capability-matrix.json（build-matrix 产出的 committed 快照，非实时），
// 按分层阈值 warn（提醒）/ error（exit 1）。size 不进 diff-matrix drift，由本脚本独立把关。
//
// 用法：node scripts/check-token-budget.mjs
// 退出码：0=无 error（可能有 warn），1=有 error

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THRESHOLDS = {
  perToolDesc:   { warn: 800,        error: 2000 },
  perToolSchema: { warn: 6000,       error: 12000 },
  perToolTotal:  { warn: 7000,       error: 14000 },
  totalSum:      { warn: 80 * 1024,  error: 120 * 1024 },
};

/** @typedef {{name:string,size:{descBytes:number,schemaBytes:number,totalBytes:number}}} CapLike */

/**
 * @param {CapLike[]} caps
 * @returns {{warnings:string[],errors:string[],sum:number}} */
export function checkBudget(caps) {
  const warnings = [];
  const errors = [];
  let sum = 0;

  const checkDim = (cap, bytes, dim, label) => {
    const t = THRESHOLDS[dim];
    if (bytes >= t.error) errors.push(`${cap.name} ${label} ${bytes}B ≥ error ${t.error}B`);
    else if (bytes >= t.warn) warnings.push(`${cap.name} ${label} ${bytes}B ≥ warn ${t.warn}B`);
  };

  for (const cap of caps) {
    const s = cap.size;
    sum += s.totalBytes;
    checkDim(cap, s.descBytes, 'perToolDesc', 'desc');
    checkDim(cap, s.schemaBytes, 'perToolSchema', 'schema');
    checkDim(cap, s.totalBytes, 'perToolTotal', 'total');
  }

  if (sum >= THRESHOLDS.totalSum.error) errors.push(`total ${sum}B ≥ error ${THRESHOLDS.totalSum.error}B`);
  else if (sum >= THRESHOLDS.totalSum.warn) warnings.push(`total ${sum}B ≥ warn ${THRESHOLDS.totalSum.warn}B`);

  return { warnings, errors, sum };
}

function main() {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const matrixPath = join(projectRoot, 'docs', 'capability-matrix.json');
  const { tools } = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const { warnings, errors, sum } = checkBudget(tools);

  // 体积报告（始终打印）
  const top5 = [...tools].sort((a, b) => b.size.totalBytes - a.size.totalBytes).slice(0, 5);
  console.log('[token-budget] 总量 %dB (~%d tokens)，schema 占比见 build-matrix 报告', sum, Math.round(sum / 4));
  console.log('[token-budget] TOP5:');
  for (const t of top5) {
    console.log('  %s: desc %dB / schema %dB / total %dB', t.name, t.size.descBytes, t.size.schemaBytes, t.size.totalBytes);
  }

  for (const w of warnings) console.warn('[token-budget] WARN: ' + w);
  for (const e of errors) console.error('[token-budget] ERROR: ' + e);

  if (errors.length > 0) {
    console.error(`[token-budget] %d error(s), %d warning(s) — 阻塞`, errors.length, warnings.length);
    process.exit(1);
  }
  console.log('[token-budget] %d warning(s), 0 error — 通过', warnings.length);
}

main();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scripts/check-token-budget.test.ts`
Expected: PASS（5 个 it 全绿）

- [ ] **Step 5: 手动跑脚本验证当前基线（1 warn ui，0 error）**

Run: `node scripts/check-token-budget.mjs`
Expected: 打印总量 ~70KB + TOP5（ui 居首），1 行 `WARN: ui schema ...B ≥ warn 6000B`，末行 `[token-budget] 1 warning(s), 0 error — 通过`，exit 0

- [ ] **Step 6: tsc + Commit**

Run: `npx tsc --noEmit`
Expected: 0 error

```bash
git add scripts/check-token-budget.mjs test/scripts/check-token-budget.test.ts
git commit -m "feat(scripts): check-token-budget.mjs warn-only 体积门禁脚本

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: CI + package.json 接线

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json:28-53`（scripts 加 check:budget）
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`（加 Check token budget step）

**Interfaces:**
- Consumes: Task 3 的 `scripts/check-token-budget.mjs` + Task 2 的 json 产物

- [ ] **Step 1: package.json 加 check:budget script**

在 `D:\GitHub\godot-mcp-enhanced\package.json` 的 `"scripts"` 对象内，`"diff-matrix": "npm run build && node build/capability/diff-matrix.js",` 行之后加一行：

```json
    "check:budget": "node scripts/check-token-budget.mjs",
```

注意 JSON 逗号：加在两行之间，前一行末尾要有逗号。

- [ ] **Step 2: 跑 npm run check:budget 确认接线**

Run: `npm run check:budget`
Expected: 同 Task 3 Step 5（1 warn ui，0 error，exit 0）

- [ ] **Step 3: ci.yml 加 Check token budget step**

读 `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`，定位 `diff-matrix` step（或 `npm run build-matrix`/`npm run diff-matrix` 所在 step）。在其后加一个新 step：

```yaml
      - name: Check token budget
        run: npm run build-matrix && npm run check:budget
```

（build-matrix 在前确保 json 是最新 committed 基线；check:budget 读该快照。若 CI 已有 build-matrix step，则 Check token budget step 只需 `run: npm run check:budget` 并置于其后。实施时据实际 ci.yml 结构调整缩进与位置。）

- [ ] **Step 4: 本地模拟 CI 链路**

Run: `npm run build-matrix && npm run check:budget`
Expected: build-matrix 成功 + check:budget 通过（1 warn，0 error，exit 0）

- [ ] **Step 5: 全量测试回归**

Run: `npx vitest run`
Expected: 全绿（现有测试不受影响 + 新增 3 个测试文件通过）

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: 接线 check:budget token 体积门禁 step

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: error-analyzer 源码片段（snippet）

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\error-analyzer.ts:4-11`（ParsedError 加 snippet）、`:29-38`（AnalyzeOptions 加 projectPath/snippetLines）、`:1-3`（加 import）、新增 buildSnippet/enrichWithSnippet、3 处 push 前 enrich（`:256`/`:288`/`:318`）
- Test: `D:\GitHub\godot-mcp-enhanced\test\error-analyzer.test.js`（加 snippet describe）

**Interfaces:**
- Produces: `ParsedError.snippet?: string`、`AnalyzeOptions.projectPath?: string`、`AnalyzeOptions.snippetLines?: number`

- [ ] **Step 1: 写失败测试（error-analyzer.test.js 末尾加 describe）**

在 `D:\GitHub\godot-mcp-enhanced\test\error-analyzer.test.js` 文件顶部 import 区加（现有只 import analyzeOutput）：

```javascript
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

在文件末尾（最后一个 `});` 之前，即顶层 `describe('error-analyzer', ...)` 内）加：

```javascript
  describe('source snippet', () => {
    it('attaches snippet for res:// file when projectPath provided', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcp-snippet-'));
      try {
        writeFileSync(join(dir, 'player.gd'), 'func a():\n\tpass\n\nfunc b():\n\tvar x = y.foo()\n\tpass\n');
        const result = analyzeOutput(
          ['SCRIPT ERROR: Cannot call function "foo" on null instance.', 'at: res://player.gd:4'],
          { projectPath: dir }
        );
        expect(result.errors.length).toBe(1);
        expect(result.errors[0].snippet).toBeDefined();
        expect(result.errors[0].snippet).toContain('> 4:');
        expect(result.errors[0].snippet).toContain('var x = y.foo()');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('omits snippet when projectPath not provided', () => {
      const result = analyzeOutput(['SCRIPT ERROR: x', 'at: res://player.gd:4']);
      expect(result.errors[0].snippet).toBeUndefined();
    });

    it('omits snippet for non-res:// path (execute_gdscript temp wrapper)', () => {
      const result = analyzeOutput(
        ['SCRIPT ERROR: x', 'at: /tmp/session123/wrapper.gd:4'],
        { projectPath: '/some/project' }
      );
      expect(result.errors[0].snippet).toBeUndefined();
    });

    it('omits snippet when file does not exist (silent skip)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcp-snippet-'));
      try {
        const result = analyzeOutput(
          ['SCRIPT ERROR: x', 'at: res://missing.gd:4'],
          { projectPath: dir }
        );
        expect(result.errors[0].snippet).toBeUndefined();
        // 错误本身不受影响
        expect(result.errors[0].type).toBeDefined();
        expect(result.errors[0].suggestion).toBeDefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/error-analyzer.test.js`
Expected: FAIL —— `result.errors[0].snippet` 为 `undefined`（`toBeDefined()` 失败）

- [ ] **Step 3: error-analyzer.ts 加 import**

在 `D:\GitHub\godot-mcp-enhanced\src\error-analyzer.ts` 顶部（`// Godot Error Analyzer Module` 注释后）加：

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { resolveWithinRoot, normalizeUserProjectPath } from './core/path-utils.js';
```

- [ ] **Step 4: ParsedError + AnalyzeOptions 加字段**

在 `src\error-analyzer.ts:4-11` 的 ParsedError 接口，`suggestion: string;` 之后加：

```typescript
  /** 出错行附近源码片段（带行号，出错行标 ">"）。仅当 options.projectPath 提供且 file 为 res:// 时填充。 */
  snippet?: string;
```

在 `:29-38` 的 AnalyzeOptions 接口，`classNames?: string[];` 的注释块之后、接口结束 `}` 之前加：

```typescript
  /** 项目根路径。提供后对 res:// 错误文件读取源码片段附加到 ParsedError.snippet。 */
  projectPath?: string;
  /** snippet 上下文行数（出错行前后各 N 行），默认 3。 */
  snippetLines?: number;
```

- [ ] **Step 5: 新增 buildSnippet + enrichWithSnippet（在 parseLocation 之后、analyzeOutput 之前，约 :225 处插入）**

在 `src\error-analyzer.ts` 的 `parseLocation` 函数结束（`:224` 的 `}`）之后、`// ===== Main analyzer =====` 之前加：

```typescript
// ===== Source snippet =====

/** 读取 res:// 错误文件的出错行附近源码。非 res:// / 文件不存在 / 路径非法 → undefined（静默跳过）。 */
function buildSnippet(file: string | undefined, targetLine: number | undefined, projectPath: string, contextLines: number): string | undefined {
  if (!file || !file.startsWith('res://')) return undefined;
  if (targetLine === undefined || targetLine <= 0) return undefined;

  let absPath: string;
  try {
    absPath = resolveWithinRoot(projectPath, normalizeUserProjectPath(file));
  } catch {
    return undefined; // 路径遍历/非法 → 跳过（resolveWithinRoot 5 层校验兜底）
  }

  let content: string;
  try {
    if (!existsSync(absPath)) return undefined;
    content = readFileSync(absPath, 'utf8');
  } catch {
    return undefined; // 编码/权限异常 → 跳过
  }

  const lines = content.split(/\r?\n/);
  const start = Math.max(0, targetLine - 1 - contextLines);
  const end = Math.min(lines.length, targetLine + contextLines);
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    const num = i + 1;
    const marker = num === targetLine ? '>' : ' ';
    parts.push(`${marker} ${num}: ${lines[i]}`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** 若 options.projectPath 提供，给 error 附加 snippet。无 projectPath 或无法读取时 no-op。 */
function enrichWithSnippet(error: ParsedError, options?: AnalyzeOptions): void {
  if (!options?.projectPath || !error.file || !error.line || error.line <= 0) return;
  const snippet = buildSnippet(error.file, error.line, options.projectPath, options.snippetLines ?? 3);
  if (snippet) error.snippet = snippet;
}
```

- [ ] **Step 6: 在 3 个 push 前调 enrichWithSnippet**

在 `src\error-analyzer.ts` 的 `analyzeOutput` 内，3 处 `errors.push(error);` 之前各加一行 `enrichWithSnippet(error, options);`：

第一处（parse_error 分支，`:256` 附近）：
```typescript
      errors.push(error);
```
改为：
```typescript
      enrichWithSnippet(error, options);
      errors.push(error);
```

第二处（SCRIPT ERROR 分支，`:288` 附近）和第三处（ERROR 分支，`:318` 附近）：同样在各自 `errors.push(error);` 之前加 `enrichWithSnippet(error, options);`。

- [ ] **Step 7: 跑测试确认通过 + tsc**

Run: `npx vitest run test/error-analyzer.test.js`
Expected: PASS（含新增 4 个 snippet it）

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 8: Commit**

```bash
git add src/error-analyzer.ts test/error-analyzer.test.js
git commit -m "feat(error-analyzer): ParsedError.snippet 出错行源码片段（res://+projectPath 时启用）

复用 resolveWithinRoot 两步惯例，零新安全面；纯只读+全 catch，读取失败静默跳过。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: validation + gdscript-executor 接线 projectPath + 全量验证

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\validation.ts:564-586`（run_and_verify 的 analyzeOpts 加 projectPath）
- Modify: `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:1224`（analyzeOutput 传 { projectPath }）

**Interfaces:**
- Consumes: Task 5 的 `AnalyzeOptions.projectPath`

- [ ] **Step 1: validation.ts run_and_verify 传 projectPath**

在 `D:\GitHub\godot-mcp-enhanced\src\tools\validation.ts:564` 的 `const analyzeOpts: AnalyzeOptions = {};` 改为：

```typescript
      const analyzeOpts: AnalyzeOptions = { projectPath };
```

（`projectPath` 在 `:536` 的 `const projectPath = requireProjectPath(args);` 已定义，作用域覆盖 :586 的 analyzeOutput 调用。）

注意：**不改 validate_scripts**（:784-889 走 batchValidateScripts 产 string[] 非 ParsedError，无 snippet 落点，spec 已确认）；**不改 analyze_error**（:630 用户粘贴裸日志无项目上下文）。

- [ ] **Step 2: gdscript-executor.ts 传 projectPath**

在 `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts:1224` 的 `analyzeOutput(logLines)` 改为：

```typescript
    analyzeOutput(logLines, projectPath ? { projectPath } : undefined)
```

（`projectPath` 在 `:948` 作用域可用；execute_gdscript 的临时 wrapper 路径非 res:// 会自动跳过 snippet，但项目脚本 preload 出错时能获得 snippet。三元判断确保 projectPath 未定义时不传。）

- [ ] **Step 3: tsc + 全量测试**

Run: `npx tsc --noEmit`
Expected: 0 error

Run: `npx vitest run`
Expected: 全绿

- [ ] **Step 4: eslint**

Run: `npm run lint`
Expected: 0 errors（既有 warning 非本次引入可忽略）

- [ ] **Step 5: check:gdscript（确认未碰 GDScript）**

Run: `npm run check:gdscript`
Expected: errors=0 warnings=0（本批纯 TS 改动，GDScript 未动）

- [ ] **Step 6: Commit**

```bash
git add src/tools/validation.ts src/gdscript-executor.ts
git commit -m "feat: run_and_verify + execute_gdscript 启用错误源码片段（传 projectPath）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 7: 最终汇总验证**

Run: `npm run build-matrix && npm run check:budget && npx vitest run`
Expected: build-matrix 成功 + check:budget 通过（1 warn ui，0 error）+ vitest 全绿

---

## Self-Review（写计划后自检）

**Spec coverage：**
- token 预算度量（schema/extract）→ Task 1 ✓
- build-matrix 体积输出 → Task 2 ✓
- check-token-budget.mjs 门禁 → Task 3 ✓
- CI + package.json 接线 → Task 4 ✓
- size 不纳入 diff-matrix → Task 2 Step 6 验证 ✓（不改 diff-matrix.ts）
- error-analyzer snippet 字段 + buildSnippet → Task 5 ✓
- 启用范围（run_and_verify + execute_gdscript；validate_scripts/analyze_error/batch 不启用）→ Task 6 ✓（spec 表格已改 ✗）
- 边界（临时路径/user:///空行号/遍历/CRLF/文件不存在）→ buildSnippet 守卫 + Task 5 测试覆盖 ✓
- 验证方式（tsc/vitest/build-matrix/check:budget/diff-matrix/lint/check:gdscript）→ 各 Task step + Task 6 汇总 ✓

**Placeholder scan：** 无 TBD/TODO；Task 4 Step 3 的 ci.yml 改动说明"据实际结构调整缩进"是因 ci.yml 当前内容未读，实施时先读再改——已明确指示，非 placeholder。

**Type consistency：** `ToolCapability.size`（Task 1 定义）↔ buildMarkdown 用 `c.size.totalBytes`（Task 2）↔ checkBudget 用 `cap.size`（Task 3）↔ extract.test 断言 `c.size`（Task 1）—— 一致。`ParsedError.snippet`/`AnalyzeOptions.projectPath`/`enrichWithSnippet` 跨 Task 5/6 一致。
