# 测试评分框架 M3b-PR(PR Comment)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐 task 执行。Steps 用 checkbox(`- [ ]`)跟踪。

**Goal:** CI 把评分摘要贴到 PR comment(sticky,更新同一条)——`renderPrComment` 纯函数生成 PR 专用摘要 markdown,`score:pr-comment` 写文件,ci.yml 用 `sticky-pull-comment` 贴。gate 失败也贴(展示 fail 原因帮 review 定位回归)。status check 已由 M3b gate 隐含,本里程碑只做 comment。

**Architecture:** 1 纯函数(`pr-comment.ts` renderPrComment,复用 evaluateGate + 共享 DIM_ORDER)+ 1 refactor(DIM_ORDER 移 dimensions.ts)+ 3 接线(cli pr-comment 子命令 / package score:pr-comment / ci.yml permissions+2 step)。两 comment step 均 `continue-on-error` 隔离 gate。reviewer 顺序:先 refactor DIM_ORDER(make change easy)→ renderPrComment → 测试 → CI。

**Tech Stack:** TypeScript 5.3 · Vitest 4.1.7 · `marocchino/sticky-pull-comment@v2`(GitHub Marketplace,零新 npm 依赖)。

**关联:** spec r2 `docs/superpowers/specs/2026-06-21-scoring-m3b-pr-design.md`(已审确认,5 修订全采纳)。前置 M3b(报告+门禁)已完成。

## Global Constraints

- `type: "module"`(ESM),import 带 `.js`
- 测试放 `test/scoring/*.test.ts`,自动被 vitest 拾取
- `src/scoring/**/*.ts` 纳入 coverage,不得拉低 thresholds
- 路径引用一律绝对;commit conventional + 中文 + `Co-Authored-By: Claude <noreply@anthropic.com>`
- 纯函数放 `src/scoring/` 根(非 collectors/)
- 复用 `PASS_LINE`/`NA_SCORE`/`DIM_ORDER`(dimensions.ts),不硬编码
- `marocchino/sticky-pull-comment@v2` 第三方 action,需版本 pin

## 现状校正(执行者必读)

- **report.ts 已有局部 DIM_ORDER**(M3b Task 2,L11):`const DIM_ORDER: DimensionName[] = [...]`。Task 1 refactor 移到 dimensions.ts 共享,report.ts 改 import。
- **cli.ts 已有 gate 子命令 + 结构守卫**(M3b):`if (cmd === 'gate') {...} else {generateScore}`。Task 3 在 gate 分支后加 `else if (cmd === 'pr-comment')` 分支,复用同一结构守卫(`total`+`hardFails`)。
- **ci.yml check job 现状**:gate 步骤无 continue-on-error(M3b,失败 PR 红);Upload score.json 有 if:always。无 permissions 段(默认 token)。无 PR comment 基础设施。
- **PASS_LINE=75**(dimensions.ts)。renderPrComment 复用 evaluateGate reasons,reason 文案 `总分 ${total} < ${PASS_LINE}(pass 线)`。
- **score.partial 字段已存在**(types.ts):`boolean`,有 na 维时 true。renderPrComment 头部用它标注 `verified/total`。

## File Structure

| 文件 | 职责 | 副作用 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\src\scoring\dimensions.ts` | **改**:加 `DIM_ORDER` 导出(共享) | — |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts` | **改**:删局部 DIM_ORDER,import 共享 | refactor |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\pr-comment.ts` | `renderPrComment(score): string`,PR 摘要 markdown | 无(纯函数) |
| `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts` | **改**:加 `pr-comment` 子命令 | 读文件 + exit |
| `D:\GitHub\godot-mcp-enhanced\test\scoring\pr-comment.test.ts` | renderPrComment 6 用例(pass/fail×2/partial/na/unknown status) | 无 |
| `D:\GitHub\godot-mcp-enhanced\package.json` | **改**:加 `score:pr-comment` 脚本 | — |
| `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` | **改**:check job 加 permissions + 2 step(均 continue-on-error) | — |
| `D:\GitHub\godot-mcp-enhanced\docs\scoring.md` | **改**:加 M3b-PR 节 | — |

---

## Task 1: refactor DIM_ORDER 共享(修订 4,make change easy)

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\dimensions.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts`
- Test(回归): `D:\GitHub\godot-mcp-enhanced\test\scoring\report.test.ts`(现有 8 用例)

**Interfaces:**
- Produces: `DIM_ORDER: DimensionName[]`(dimensions.ts 导出),供 Task 2 pr-comment.ts + report.ts 共享

- [ ] **Step 1: dimensions.ts 加 DIM_ORDER 导出**

在 `D:\GitHub\godot-mcp-enhanced\src\scoring\dimensions.ts` 末尾(`NA_SCORE` 之后)加:

```ts
/** 维度渲染顺序(所有渲染器共用,避免 report/pr-comment 双真相源) */
export const DIM_ORDER: DimensionName[] = ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript'];
```

(dimensions.ts 顶部已 `import type { DimensionName } from './types.js'`,无需补 import)

- [ ] **Step 2: report.ts 删局部 DIM_ORDER,改 import 共享**

在 `D:\GitHub\godot-mcp-enhanced\src\scoring\report.ts`:

1. 顶部 import 行(原 `import { NA_SCORE } from './dimensions.js';`)改为:
```ts
import { NA_SCORE, DIM_ORDER } from './dimensions.js';
```

2. 删局部定义(原 L11 `const DIM_ORDER: DimensionName[] = [...]` 整行删除)。

(其余不变;`STATUS_BADGE`/`round1`/`dimMetric`/`renderScoreReport` 保持)

- [ ] **Step 3: 跑 report.test.ts 回归(8 用例不破)**

Run: `npx vitest run test/scoring/report.test.ts`
Expected: PASS(8 用例全绿,验证 refactor 后 report 仍用共享 DIM_ORDER 正确渲染)

- [ ] **Step 4: 全量 + tsc + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全量不回归(M3b 后基线 2779 pass),tsc exit 0

```bash
git add src/scoring/dimensions.ts src/scoring/report.ts
git commit -m "refactor(scoring): DIM_ORDER 移 dimensions.ts 共享(M3b-PR Task 1)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: pr-comment.ts renderPrComment 纯函数(修订 3 partial + 修订 5 unknown status)

**Files:**
- Create: `D:\GitHub\godot-mcp-enhanced\src\scoring\pr-comment.ts`
- Test: `D:\GitHub\godot-mcp-enhanced\test\scoring\pr-comment.test.ts`

**Interfaces:**
- Consumes: `evaluateGate(score): {passed, reasons}`(gate.ts,M3b)/ `DIM_ORDER`+`NA_SCORE`(dimensions.ts,Task 1)/ `ScoreJson`(types.ts)
- Produces: `renderPrComment(score: ScoreJson): string`(markdown)。Task 3 cli pr-comment 子命令消费。

- [ ] **Step 1: 写失败测试**

创建 `D:\GitHub\godot-mcp-enhanced\test\scoring\pr-comment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderPrComment } from '../../src/scoring/pr-comment.js';
import { PASS_LINE } from '../../src/scoring/dimensions.js';
import type { ScoreJson } from '../../src/scoring/types.js';

function makeScore(over: Partial<ScoreJson> = {}): ScoreJson {
  return {
    total: 85.8, pass: true, partial: true,
    generatedAt: '2026-06-21T02:06:03.000Z',
    dimensions: {
      integration: { score: 100, weight: 0.3, status: 'pass', raw: {} },
      coverage: { score: 70.2, weight: 0.2, status: 'pass', raw: {} },
      security: { score: 80, weight: 0.2, status: 'pass', raw: {} },
      flaky: { score: -1, weight: 0.1, status: 'na' },
      performance: { score: -1, weight: 0.1, status: 'na' },
      gdscript: { score: -1, weight: 0.1, status: 'na' },
    },
    unverified: ['flaky', 'performance', 'gdscript'],
    hardFails: [],
    ...over,
  };
}

describe('renderPrComment', () => {
  it('pass: 头部 PASS + partial 标注 + 维度表', () => {
    const md = renderPrComment(makeScore());
    expect(md).toContain('85.8');
    expect(md).toContain('✅ PASS');
    expect(md).toContain('3/6 维已验证');
    expect(md).toContain('integration');
  });

  it('fail 总分不足:头部 FAIL + reason 含 pass 线', () => {
    const md = renderPrComment(makeScore({ total: 60, pass: false }));
    expect(md).toContain('❌ FAIL');
    expect(md).toContain(`总分 60 < ${PASS_LINE}(pass 线)`);
  });

  it('fail hardFails:硬否决列出', () => {
    const md = renderPrComment(makeScore({
      total: 90, pass: false,
      hardFails: [{ dimension: 'security', reason: '低于硬否决线', threshold: 60, actual: 40 }],
    }));
    expect(md).toContain('硬否决 security');
    expect(md).toContain('40 < 60');
  });

  it('partial(85.8 + 3 维 na)→ 仍 PASS(partial 不阻断)', () => {
    const md = renderPrComment(makeScore());
    expect(md).toContain('✅ PASS');
  });

  it('na 维显示 ⊘ na', () => {
    const md = renderPrComment(makeScore());
    expect(md).toContain('⊘ na');
  });

  it('unknown status fallback(STATUS_ICON 缺 → 原值 pending)', () => {
    // 'pending' 非 DimensionStatus,用 as never 绕过类型测 fallback(测试专用)
    const score = makeScore({
      dimensions: {
        ...makeScore().dimensions,
        integration: { score: 100, weight: 0.3, status: 'pending' as never, raw: {} },
      },
    });
    const md = renderPrComment(score);
    expect(md).toContain('pending');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/scoring/pr-comment.test.ts`
Expected: FAIL(`Cannot find module '../../src/scoring/pr-comment.js'`)

- [ ] **Step 3: 写 pr-comment.ts**

创建 `D:\GitHub\godot-mcp-enhanced\src\scoring\pr-comment.ts`:

```ts
import type { ScoreJson } from './types.js';
import { NA_SCORE, DIM_ORDER } from './dimensions.js';
import { evaluateGate } from './gate.js';

const STATUS_ICON: Record<string, string> = { pass: '✅', warn: '⚠️', fail: '❌', na: '⊘ na' };

/**
 * 渲染 PR comment 摘要 markdown(比 score-report.md 简短,适合 PR 显示)。
 * 复用 evaluateGate 得 reasons(失败时渲染),避免与 gate 双真相源。
 * 头部含 partial 标注(verified/total);na 维 ⊘ na;未知 status 显示原值(fallback)。
 */
export function renderPrComment(score: ScoreJson): string {
  const { passed, reasons } = evaluateGate(score);
  const overall = passed ? '✅ PASS' : '❌ FAIL';
  const total = Object.keys(score.dimensions).length;
  const verified = total - score.unverified.length;
  const partialTag = score.partial ? `(其余 M3c-e 待接入)` : '';
  const lines: string[] = [];
  lines.push(`## 📊 质量评分:${score.total} ${overall} · ${verified}/${total} 维已验证${partialTag}`);
  lines.push('');
  if (!passed) {
    for (const r of reasons) lines.push(`- ${r}`);
    lines.push('');
  }
  lines.push('| 维度 | 分数 | 状态 |');
  lines.push('|---|---|---|');
  for (const name of DIM_ORDER) {
    const d = score.dimensions[name];
    const s = d.score === NA_SCORE ? '—' : String(d.score);
    lines.push(`| ${name} | ${s} | ${STATUS_ICON[d.status] ?? d.status} |`);
  }
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/scoring/pr-comment.test.ts`
Expected: PASS(6 用例全绿)

- [ ] **Step 5: 全量 + tsc + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全量 2779 + 6 = 2785 pass,tsc exit 0

```bash
git add src/scoring/pr-comment.ts test/scoring/pr-comment.test.ts
git commit -m "feat(scoring): pr-comment 纯函数 renderPrComment(M3b-PR Task 2)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 接线 cli pr-comment 子命令 + score:pr-comment 脚本

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`
- Modify: `D:\GitHub\godot-mcp-enhanced\package.json`

**Interfaces:**
- Consumes: `renderPrComment(score): string`(Task 2)/ gate 的结构守卫模式(M3b)
- Produces: `npm run score:pr-comment` 写 `coverage/pr-comment.md`

- [ ] **Step 1: cli.ts 加 pr-comment 分支**

在 `D:\GitHub\godot-mcp-enhanced\src\scoring\cli.ts`:

1. 顶部 import 加 `renderPrComment`:
```ts
import { renderPrComment } from './pr-comment.js';
```
(现有 import:`generateScore`/`evaluateGate`/`existsSync`/`readFileSync`/`resolve`/`fileURLToPath`/`ScoreJson`)

2. 在 `if (cmd === 'gate') { ... }` 块的结束 `}` 之后、`else {`(generateScore 分支)之前,插入 `else if (cmd === 'pr-comment')` 分支:

```ts
  } else if (cmd === 'pr-comment') {
    const scorePath = resolve(process.cwd(), 'coverage/score.json');
    if (!existsSync(scorePath)) {
      console.error('score.json 不存在,先跑 npm run score');
      process.exit(1);
    }
    let score: ScoreJson;
    try {
      score = JSON.parse(readFileSync(scorePath, 'utf8'));
    } catch {
      console.error('score.json 解析失败,重新跑 npm run score');
      process.exit(1);
    }
    if (!score || typeof score.total !== 'number' || !Array.isArray(score.hardFails)) {
      console.error('score.json 结构异常(total/hardFails 缺失或类型错),重新跑 npm run score');
      process.exit(1);
    }
    const outPath = resolve(process.cwd(), 'coverage/pr-comment.md');
    writeFileSync(outPath, renderPrComment(score), 'utf8');
    process.stdout.write(`PR comment 写入: ${outPath}\n`);
  } else {
```

(复用 gate 分支的结构守卫 `total`+`hardFails`,M3b I-1 教训;需在顶部 import 加 `writeFileSync` —— 检查现有 import,`cli.ts` 现有 `import { existsSync, readFileSync } from 'fs';`,改为 `import { existsSync, readFileSync, writeFileSync } from 'fs';`)

- [ ] **Step 2: package.json 加 score:pr-comment**

在 `D:\GitHub\godot-mcp-enhanced\package.json` 的 `"score:gate": "node build/scoring/cli.js gate",` 之后加:

```json
    "score:pr-comment": "node build/scoring/cli.js pr-comment",
```

- [ ] **Step 3: build + 手验(npm run score:pr-comment 产 pr-comment.md)**

Run:
```bash
npm run build
npm run score:pr-comment
```
Expected:
- 末行 `PR comment 写入: ...coverage/pr-comment.md`
- `coverage/pr-comment.md` 存在,含 `## 📊 质量评分:85.8 ✅ PASS · 3/6 维已验证(其余 M3c-e 待接入)` + 各维表

- [ ] **Step 4: 全量 + tsc + 提交**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全量不回归(2785 pass),tsc exit 0

```bash
git add src/scoring/cli.ts package.json
git commit -m "feat(scoring): cli pr-comment 子命令 + score:pr-comment(M3b-PR Task 3)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: CI check job 接入 comment(修订 1 continue-on-error + 修订 2 gap 标注)+ 文档

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml`
- Modify: `D:\GitHub\godot-mcp-enhanced\docs\scoring.md`

- [ ] **Step 1: ci.yml check job 加 permissions**

在 `D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml` 的 `check:` job 下、`runs-on:` 前加 `permissions`:

```yaml
  check:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
```

- [ ] **Step 2: ci.yml 加 2 step(均 continue-on-error)**

在 `Score gate (M3b)` 步骤之后、`Upload score.json` 之前,插入 2 step:

```yaml
      - name: Score gate (M3b)
        run: npm run score:gate
      - name: Score pr-comment (M3b-PR)
        if: always()
        continue-on-error: true        # 评论层失败不污染 gate status check
        run: npm run score:pr-comment
      - name: Sticky PR comment (M3b-PR)
        if: always() && matrix.node-version == '22' && github.event_name == 'pull_request'
        continue-on-error: true        # sticky action 失败同理隔离
        uses: marocchino/sticky-pull-comment@v2
        with:
          header: scoring-pr-comment
          path: coverage/pr-comment.md
      - name: Upload score.json
        if: always()
        ...
```

> `continue-on-error: true` 隔离 comment 层(渲染/sticky)失败——comment 是附加层,gate(无 continue-on-error)的 status check 不受影响。`if: always()` 让 gate 失败后仍生成 + 贴 comment(展示 fail 原因);`matrix.node-version == '22'` 避免 node 24 重复贴;`github.event_name == 'pull_request'` 排除 push master;`header: scoring-pr-comment` 让 sticky 更新同一条。

- [ ] **Step 3: docs/scoring.md 加 M3b-PR 节**

在 `D:\GitHub\godot-mcp-enhanced\docs\scoring.md` 的"报告与门禁(M3b)"节之后追加:

```markdown
## PR Comment(M3b-PR)

- `npm run score:pr-comment` 读 `coverage/score.json` → 产 `coverage/pr-comment.md`(PR 专用摘要,比 score-report.md 简短)
- CI 用 `marocchino/sticky-pull-comment@v2` 贴到 PR(更新同一条,不堆积)
- gate 失败也贴(`if: always`,展示 fail 原因 + 各维分数,帮 review 定位回归)
- comment 层 `continue-on-error`:与 gate status check 隔离(评论/sticky 失败不拖红 PR)
- 已知 gap:score.json 缺失(score 步骤失败)时不贴评论(根因上游 M1 `continue-on-error`,留后续)
```

- [ ] **Step 4: tsc 确认无连带 + 提交**

Run: `npx tsc --noEmit`
Expected: exit 0

```bash
git add .github/workflows/ci.yml docs/scoring.md
git commit -m "ci(scoring): check job 接入 PR comment + 文档(M3b-PR Task 4)" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec 覆盖(r2)**:
- DIM_ORDER 移 dimensions.ts(修订 4)→ Task 1 ✓
- renderPrComment 纯函数 + 复用 evaluateGate + partial 标注(修订 3)→ Task 2 ✓
- unknown status fallback 测试(修订 5)→ Task 2 Step 1 第 6 用例 ✓
- cli pr-comment 子命令 + 结构守卫 → Task 3 ✓
- score:pr-comment 脚本 → Task 3 ✓
- ci.yml permissions + 2 step continue-on-error(修订 1)→ Task 4 ✓
- score.json 缺失 gap 标注(修订 2)→ Task 4 docs + spec 已记(非目标/错误处理/后续)✓
- 验收标准 1-6 全覆盖 ✓

**2. Placeholder 扫描**:无 TBD/TODO;每步含完整代码;类型/函数名跨 task 一致 ✓

**3. 类型一致**:
- `DIM_ORDER: DimensionName[]`(dimensions.ts)Task 1 定义,Task 2 pr-comment.ts + report.ts 消费 ✓
- `renderPrComment(score: ScoreJson): string` Task 2 定义,Task 3 cli 消费 ✓
- `evaluateGate(score): {passed, reasons}` 复用 gate.ts(M3b)✓
- cli pr-comment 复用 gate 结构守卫(`total`+`hardFails`)✓

**4. 测试隔离**:
- pr-comment.test.ts 无 IO(纯函数 fixture,与 gate/report 同构)✓
- report.test.ts 回归(Task 1 refactor 不破)✓

**5. 现状风险**:
- sticky-pull-comment@v2 第三方 action → 需 CI 首次 PR 验证(comment 真贴);本地无法验 PR comment(只验 pr-comment.md 生成)
- ci.yml matrix [22,24] → sticky 限 node 22(避免重复);若 matrix 变需同步
- continue-on-error 隔离:gate(无)失败 PR 红;comment(有)失败不拖红 ✓

无问题,plan 可执行。

---

## 后续(本计划范围外)

- **M3b-HTML**:HTML dashboard(趋势图需历史快照基建)
- **M3c/M3d/M3e**:gdscript / performance / flaky 维度接入
- **score.json 缺失降级评论**(CI-2 gap):根因上游 M1 score 步骤 continue-on-error,留后续
