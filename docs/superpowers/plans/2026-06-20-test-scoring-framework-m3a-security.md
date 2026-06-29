# 测试评分框架 M3a(security 维度接入)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 逐 task 执行。Steps 用 checkbox(`- [ ]`)跟踪。

**Goal:** 给评分层接入 security 维度——`collectors/security.ts` 解析 `npm audit --json` 产出,按漏洞 severity 加权扣分进 score;CI check job 产 audit.json + 上传 artifact。M3a **不动现有代码逻辑**(只加 collector + 接入 + CI 接线),非阻断。

**Architecture:** 复用 M1/M2 的 collectors 模式。`security.ts` = 解析 audit.json(读文件副作用),纯评分逻辑可单测(mock json)。`generate-score.ts` 加可选 `auditJsonPath`,`cli.ts` 默认指向 `coverage/audit.json`。

**Tech Stack:** TypeScript 5.3 · Vitest 4.1.7 · 纯 Node `fs`(零新依赖)。

**关联:** M1 coverage + M2 integration 已接入,本计划接第 3 维 security。M3b dashboard 随后合并 3 维。

## Global Constraints

- `type: "module"`(ESM),import 带 `.js`
- 测试放 `test/scoring/security.test.ts`,自动被 vitest 拾取
- `src/scoring/**/*.ts` 纳入 coverage,不得拉低 thresholds(60/51/69/61)
- 路径引用一律绝对;commit conventional + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`

## 现状校正(执行者必读)

- **npm audit 数据源约束**:`npm audit` 默认用配置的 registry;**npmmirror 镜像返回 404**(不转发 security advisories bulk API)。必须 `--registry=https://registry.npmjs.org` 指定官方源才跑得通。CI(GitHub Actions)默认就是 npmjs.org,无需指定。
- **enhanced 当前漏洞**:2 个 high(hono + vite,均间接依赖)→ 按本计划评分 = 80
- **npm audit json v2 格式**:`metadata.vulnerabilities.{info,low,moderate,high,critical,total}`
- **npm audit 有漏洞时退出码非 0**(exit 1),但 json 仍正常输出到 stdout;CI/本地用 `|| true` 或 `continue-on-error` 包住
- **security 权重 0.20,硬否决线 60**(M1 dimensions.ts 已配)

## security 评分语义(本计划实现)

- **base 100**,按 severity 加权扣分:`critical -30 / high -10 / moderate -5 / low -2 / info -0`
- `score = max(0, 100 - Σ(count_severity × deduction_severity))`
- status 分级:`>=80 pass` / `[60,80) warn` / `<60 fail`(对齐硬否决线 60)
- 文件缺失 / json 解析失败 / 无 metadata → `na`

| 场景 | 计算 | score | status |
|---|---|---|---|
| 0 漏洞 | 100 - 0 | 100 | pass |
| enhanced 现状(2 high) | 100 - 20 | 80 | pass |
| 1 critical | 100 - 30 | 70 | warn |
| 2 critical | 100 - 60 | 40 | fail(< 60 硬否决) |
| 1 critical + 3 high | 100 - 30 - 30 | 40 | fail |

## File Structure

| 文件 | 职责 | 副作用 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\security.ts` | `collectSecurity(auditJsonPath)`:解析 npm audit json → DimensionResult | 读文件 |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts` | **改**:加 `auditJsonPath?`,接入 collectSecurity | 读写文件 |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts` | **改**:默认 `auditJsonPath=coverage/audit.json` | — |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\security.test.ts` | meta-test:security collector 全行为(mock json) | 临时文件 |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts` | **改**:加 security 接入用例(不改现有 4 个) | 临时文件 |
| `D:\GitHub\godot-mcp-enhanced\package.json` | **改**:加 `audit:json` 脚本 | — |
| `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` | **改**:check job 加 npm audit 产 audit.json + 上传 artifact | — |
| `D:\GitHub\godot-mcp-enhanced\docs\scoring.md` | **改**:security 数据源标 done(M3a) | — |

---

## Task 1: security collector + meta-test

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\security.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scoring\security.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\scoring\security.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { collectSecurity } from '../../src/scoring/collectors/security.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_audit__');
const AUDIT = resolve(TMP, 'audit.json');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

/** 写 audit.json,metadata.vulnerabilities 用给定 severity 计数 */
function writeAudit(sev: Record<string, number>): void {
  writeFileSync(AUDIT, JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...sev } },
  }));
}

describe('collectSecurity', () => {
  it('0 漏洞 → score=100, status=pass', () => {
    writeAudit({ total: 0 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(100);
    expect(r.status).toBe('pass');
  });

  it('2 high(enhanced 现状)→ 100-20=80, status=pass', () => {
    writeAudit({ high: 2, total: 2 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(80);
    expect(r.status).toBe('pass');
    expect(r.raw).toMatchObject({ high: 2, total: 2 });
  });

  it('1 critical → 100-30=70, status=warn', () => {
    writeAudit({ critical: 1, total: 1 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(70);
    expect(r.status).toBe('warn');
  });

  it('2 critical → 100-60=40, status=fail(< 60 硬否决线)', () => {
    writeAudit({ critical: 2, total: 2 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(40);
    expect(r.status).toBe('fail');
  });

  it('1 critical + 3 high → 100-30-30=40, fail', () => {
    writeAudit({ critical: 1, high: 3, total: 4 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(40);
    expect(r.status).toBe('fail');
  });

  it('混合 severity 扣分:1 critical+1 high+2 moderate+1 low → 100-30-10-10-2=48', () => {
    writeAudit({ critical: 1, high: 1, moderate: 2, low: 1, total: 5 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(48);
  });

  it('扣分不低于 0(极端:5 critical → 100-150 → clamp 0)', () => {
    writeAudit({ critical: 5, total: 5 });
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(0);
    expect(r.status).toBe('fail');
  });

  it('文件不存在 → na', () => {
    const r = collectSecurity(resolve(TMP, 'nope.json'));
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });

  it('json 解析失败 → na', () => {
    writeFileSync(AUDIT, '{不是合法 json');
    const r = collectSecurity(AUDIT);
    expect(r.score).toBe(-1);
    expect(r.status).toBe('na');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/security.test.ts`
Expected: FAIL(`Cannot find module '../../src/scoring/collectors/security.js'`)

- [ ] **Step 3: 写 security.ts**

创建 `D:\GitHub\godot-mcp-enhanced\src\scoring\collectors\security.ts`:

```ts
import { readFileSync, existsSync } from 'fs';
import type { DimensionResult } from '../types.js';
import { WEIGHTS, NA_SCORE } from '../dimensions.js';

/** npm audit --json v2 的 severity 计数 */
interface AuditVulnCounts {
  info?: number;
  low?: number;
  moderate?: number;
  high?: number;
  critical?: number;
  total?: number;
}
interface AuditReport {
  metadata?: { vulnerabilities?: AuditVulnCounts };
}

/** 各 severity 的扣分权重 */
const DEDUCTION: Record<keyof AuditVulnCounts, number> = {
  critical: 30,
  high: 10,
  moderate: 5,
  low: 2,
  info: 0,
  total: 0,
};

/**
 * 解析 npm audit --json 产出,按漏洞 severity 加权扣分。
 * score = max(0, 100 - Σ(count × deduction));critical -30 / high -10 / moderate -5 / low -2 / info 0。
 * 状态分级:>=80 pass,[60,80) warn,<60 fail(对齐 security 硬否决线 60)。
 * 文件缺失 / 解析失败 / 无 metadata → na。
 */
export function collectSecurity(auditJsonPath: string): DimensionResult {
  if (!existsSync(auditJsonPath)) {
    return { score: NA_SCORE, weight: WEIGHTS.security, status: 'na', detail: `audit json 不存在: ${auditJsonPath}` };
  }
  let report: AuditReport;
  try {
    report = JSON.parse(readFileSync(auditJsonPath, 'utf8'));
  } catch (e) {
    return { score: NA_SCORE, weight: WEIGHTS.security, status: 'na', detail: `audit json 解析失败: ${(e as Error).message}` };
  }
  const v = report.metadata?.vulnerabilities;
  if (!v) {
    return { score: NA_SCORE, weight: WEIGHTS.security, status: 'na', detail: 'audit json 无 metadata.vulnerabilities' };
  }
  const counts = { info: v.info ?? 0, low: v.low ?? 0, moderate: v.moderate ?? 0, high: v.high ?? 0, critical: v.critical ?? 0 };
  const total = v.total ?? (counts.info + counts.low + counts.moderate + counts.high + counts.critical);
  const deduction =
    counts.critical * DEDUCTION.critical +
    counts.high * DEDUCTION.high +
    counts.moderate * DEDUCTION.moderate +
    counts.low * DEDUCTION.low;
  const score = Math.max(0, 100 - deduction);
  const status: DimensionResult['status'] = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return { score, weight: WEIGHTS.security, status, raw: { ...counts, total, deduction } };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/security.test.ts`
Expected: PASS(9 个 it 全绿)

- [ ] **Step 5: 跑全量 + 类型检查 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add src/scoring/collectors/security.ts test/scoring/security.test.ts
git commit -m "feat(scoring): security 采集器解析 npm audit(M3a Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: generate-score 接入 + cli 默认 + audit:json 脚本

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\generate-score.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\test\scoring\generate-score.test.ts`(只加新用例)
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json`(加 `audit:json`)

- [ ] **Step 1: 改 generate-score.ts(加 auditJsonPath + 接入)**

在 import 段加 `import { collectSecurity } from './collectors/security.js';`;`GenerateScoreOptions` 加 `auditJsonPath?: string`;`generateScore` 内 security 用 `collectSecurity` 替换 `na('security')`:

```ts
  const security = opts.auditJsonPath ? collectSecurity(opts.auditJsonPath) : na('security');
  const dims: Record<DimensionName, DimensionResult> = {
    integration,
    coverage,
    security,
    flaky: na('flaky'),
    performance: na('performance'),
    gdscript: na('gdscript'),
  };
```

(其余不变;`integration` 来自 M2)

- [ ] **Step 2: 改 cli.ts(默认 auditJsonPath)**

在 `if (invoked)` 块内加:
```ts
  const auditJsonPath = resolve(process.cwd(), 'coverage/audit.json');
```
并把 `generateScore({ lcovPath, outPath, e2eReportPath })` 改为 `generateScore({ lcovPath, outPath, e2eReportPath, auditJsonPath })`。

- [ ] **Step 3: package.json 加 audit:json 脚本**

在 `"score": "node build/scoring/cli.js",` 之后加:
```json
    "audit:json": "npm audit --json --registry=https://registry.npmjs.org",
```
> 用户/CI 用 `npm run audit:json > coverage/audit.json 2>/dev/null` 重定向 stdout(json)到文件,丢弃 stderr 的 npm warn。脚本本身不含重定向(跨平台)。

- [ ] **Step 4: 在 generate-score.test.ts 末尾追加 security 用例**

```ts
  it('有 audit json → security 维度有值,severity 扣分', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n')); // coverage 100
    const AUD = resolve(TMP, 'audit.json');
    writeFileSync(AUD, JSON.stringify({
      auditReportVersion: 2, vulnerabilities: {},
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
    })); // security 100-20=80
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, auditJsonPath: AUD });
    expect(s.dimensions.security.score).toBe(80);
    expect(s.dimensions.security.status).toBe('pass');
    expect(s.unverified).not.toContain('security');
    expect(s.unverified).not.toContain('coverage');
    expect(s.partial).toBe(true); // integration/flaky/performance/gdscript 仍 na
    expect(s.unverified).toHaveLength(4);
  });
```

- [ ] **Step 5: 跑测试 + 全量 + tsc + 提交**

Run: `npx vitest run test/scoring/generate-score.test.ts && npx vitest run && npx tsc --noEmit`

```bash
git add src/scoring/generate-score.ts src/scoring/cli.ts test/scoring/generate-score.test.ts package.json
git commit -m "feat(scoring): generate-score 接入 security + audit:json 脚本(M3a Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: CI check job 产 audit.json + 上传 artifact

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`(check job,在 `npm run build` 后、`npx vitest run --coverage` 前或后均可;放在 build 后)

- [ ] **Step 1: check job 加 audit step**

在 check job 的 `- run: npm run build` 之后插入:
```yaml
      - name: npm audit (M3a, non-blocking)
        run: npm run audit:json > coverage/audit.json 2>/dev/null || true
        continue-on-error: true
```
> CI 默认 registry=npmjs.org,无需 --registry(但 audit:json 脚本已带,幂等)。`|| true` + `continue-on-error` 双保险(有漏洞 exit 1 不阻断)。upload 复用现有 score step 的 artifact(M2 已上传 coverage/score.json;此处 audit.json 在 coverage/ 下,如需单独上传再加 upload step——M3a 暂不单独上传,score.json 已含 security 维度)。

- [ ] **Step 2: 提交**

Run: `npx tsc --noEmit`(确认无连带)

```bash
git add .github/workflows/ci.yml
git commit -m "ci(scoring): check job 产 audit.json(M3a Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 文档更新 + 本地手验

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\docs\scoring.md`

- [ ] **Step 1: 改 docs/scoring.md 的 6 维表**

security 行改为:`| security | 0.20 | npm audit json✅ | < 60 |`

- [ ] **Step 2: 本地手验(npm audit → score → security 有值)**

Run:
```bash
npx tsc
npm run audit:json > coverage/audit.json 2>/dev/null || true
npm run score
```
Expected:
- 末行 `score: <num> pass=<bool> ...`(security 维度有值:enhanced 当前 2 high → 80)
- `coverage/score.json`:`dimensions.security` score=80, status=pass, raw 含 high:2
- unverified 只剩 3 维(flaky/performance/gdscript;若本地无 e2e/integration 则 unverified 含它们)

- [ ] **Step 3: 跑全量 + 提交**

Run: `npx vitest run && npx tsc --noEmit`

```bash
git add docs/scoring.md
git commit -m "docs(scoring): security 维度 done(M3a Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖**:security collector(9 用例含 0/high/critical/混合/clamp/缺失/解析失败)→ Task 1;generate-score 接入 + cli + audit:json → Task 2;CI check job 产 audit.json → Task 3;文档 + 手验 → Task 4。

**2. 现状风险**:
- npm audit npmmirror 失败 → 必须 npmjs.org(脚本已带 --registry);本地手验用 `2>/dev/null` 丢 warn + `|| true` 兜 exit 1
- npm audit json 有漏洞时 exit 1 → CI/local 用 `|| true` + continue-on-error 包住
- enhanced 当前 2 high(hono+vite)→ security=80(pass,接近 warn 边界,修漏洞后会升)

**3. 类型一致**:`collectSecurity(auditJsonPath): DimensionResult` Task1 定义、Task2 消费;`auditJsonPath?` 可选,现有用例不传→security na,行为不变;security 权重 0.20/硬否决 60 复用 M1 dimensions.ts ✅

**4. 测试隔离**:security.test.ts 用 `test/scoring/__tmp_audit__/`(独立,与 __tmp_lcov__/__tmp_e2e__/__tmp_gen__ 不冲突)✅

无问题,plan 可执行。

---

## 后续(本计划范围外)

- **M3b dashboard**:跨 artifact 合并 coverage(M1)+ integration(M2)+ security(M3a)三维 → 汇总 job 或静态页
- **M3c gdscript / M3d performance / M3e flaky**:各需独立 brainstorming(对象/数据源待定)
