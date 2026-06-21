# M3b-PR: Scoring PR Comment(CI 贴评分摘要)

- **日期**: 2026-06-21
- **状态**: design r2(审查修订版,待用户确认 → writing-plans)
- **里程碑**: scoring M3b-PR
- **前置**: M3b 报告+门禁已完成(`coverage/score.json` + `score-report.md` + `score:gate` + CI check job gate)
- **范围**: CI 把评分摘要贴到 PR comment(sticky,更新同一条);**status check 已隐含**(check job gate 失败 PR 红,M3b 已实现),本里程碑只做 comment

## 背景与动机

M3b 后,score.json 数据底座 + score-report.md + gate 都就绪,CI check job gate 失败会让 PR check 红(status check 已隐含)。但 review 者**看不到评分详情**(分数/各维/失败原因)——需点 artifact 或本地跑。M3b-PR 补这一层:把摘要表格直接贴到 PR comment,review 一眼定位回归。

## 目标

- `npm run score:pr-comment` 读 score.json → 生成 `coverage/pr-comment.md`(PR 专用摘要,比 score-report.md 简短)
- CI 用 `sticky-pull-comment` 贴到 PR(更新同一条,不堆积)
- gate 失败也贴(`if: always`,展示 fail 原因 + 各维分数,帮 review 定位回归)

## 非目标(YAGNI)

- ❌ status check(M3b 已隐含:check job gate 失败 PR 红)
- ❌ artifact 链接(comment 自含摘要,详情看 score.json artifact 或本地)
- ❌ 趋势图(M3b-HTML 范围,需历史快照基建)
- ❌ 非 PR 触发(push master 不贴 comment)
- ❌ score.json 缺失时的降级评论(根因在上游 M1 `continue-on-error`,留后续;M3b-PR 不降级避免内联 JS 不可测)

## 设计决策

- **渲染复用 evaluateGate**(M3b Task 1):renderPrComment 调 `evaluateGate(score)` 得 `{passed, reasons}`,渲染 reasons(失败时)。避免与 gate 双真相源重复 `total < PASS_LINE` 逻辑(M3b M-1 教训)。
- **DIM_ORDER 移 dimensions.ts 共享**(DRY):report.ts + pr-comment.ts 共用同一 `DIM_ORDER`(纯结构性)。**STATUS 图标映射不共享**——report 用 `'✅ pass'`(emoji+文字,详细 artifact),pr-comment 用 `'✅'`(纯 emoji,简短摘要),值不同、未来分化,强行共享会绑死两个方向。
- **sticky-pull-comment**:更新同一条 comment(用 header 标识),避免每次 CI 跑堆积新 comment。
- **matrix 限制**:check job `matrix: [22,24]` = 2 实例,comment 只在 `node-version=='22'` 贴(避免重复 2 条)。
- **PR only**:`github.event_name == 'pull_request'`(push master 不贴)。
- **permissions**:check job 级 `contents: read, pull-requests: write`(显式列,避免覆盖破坏其他 step)。
- **comment 层 `continue-on-error`**:与 gate status check 隔离——评论渲染/sticky 失败**不拖红 PR**(comment 是附加层,不应污染 gate 的 status check)。

## 架构

新增 1 纯函数 + 1 共享常量 refactor + 3 接线:

```
src/scoring/
├─ pr-comment.ts     [新] renderPrComment(score) → string     纯函数
├─ dimensions.ts     [改] 加 DIM_ORDER 导出(共享)
├─ report.ts         [改] 删局部 DIM_ORDER,import 共享        refactor(修订 4)
├─ cli.ts            [改] 加 pr-comment 子命令(读 score.json → 写 pr-comment.md)
└─ (gate/generate-score/collectors/types 不变)

package.json         [改] 加 score:pr-comment 脚本
.github/workflows/ci.yml  [改] check job 加 permissions + 2 step(生成 + sticky 贴,均 continue-on-error)
```

数据流:
```
CI check job(PR 触发)
  ├─ npm run score(M3b)→ score.json + score-report.md
  ├─ npm run score:gate(M3b)→ exit 0/1(status check,无 continue-on-error)
  ├─ npm run score:pr-comment(M3b-PR)→ coverage/pr-comment.md   [if:always, continue-on-error]
  └─ sticky-pull-comment(M3b-PR)→ 贴 PR comment                   [if:always && matrix22 && PR, continue-on-error]
```

## 详细设计

### dimensions.ts — DIM_ORDER 共享(修订 4)

`src/scoring/dimensions.ts` 加导出:

```ts
import type { DimensionName } from './types.js';
// ...existing WEIGHTS/HARD_FAILOUTS/PASS_LINE/NA_SCORE...

/** 维度渲染顺序(所有渲染器共用,避免 report/pr-comment 双真相源) */
export const DIM_ORDER: DimensionName[] = ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript'];
```

### report.ts — refactor(修订 4)

`src/scoring/report.ts` 删 L11 局部 `const DIM_ORDER`,改 `import { NA_SCORE, DIM_ORDER } from './dimensions.js'`。其余不变(STATUS_BADGE 保持局部,值与 pr-comment 不同)。

### pr-comment.ts — renderPrComment

纯函数,`src/scoring/pr-comment.ts`:

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

输出示例(pass):
```
## 📊 质量评分:85.8 ✅ PASS · 3/6 维已验证(其余 M3c-e 待接入)

| 维度 | 分数 | 状态 |
|---|---|---|
| integration | 100 | ✅ |
| coverage | 70.2 | ✅ |
| security | 80 | ✅ |
| flaky | — | ⊘ na |
| performance | — | ⊘ na |
| gdscript | — | ⊘ na |
```

输出示例(fail):
```
## 📊 质量评分:60.0 ❌ FAIL · 3/6 维已验证(其余 M3c-e 待接入)

- 总分 60 < 75(pass 线)

| 维度 | 分数 | 状态 |
|---|---|---|
...
```

### cli.ts — pr-comment 子命令

`src/scoring/cli.ts` 在 gate 分支后加 pr-comment 分支(复用 gate 的结构守卫,M3b I-1 教训):

```ts
if (cmd === 'pr-comment') {
  const scorePath = resolve(process.cwd(), 'coverage/score.json');
  if (!existsSync(scorePath)) {
    console.error('score.json 不存在,先跑 npm run score');
    process.exit(1);
  }
  let score: ScoreJson;
  try { score = JSON.parse(readFileSync(scorePath, 'utf8')); }
  catch { console.error('score.json 解析失败,重新跑 npm run score'); process.exit(1); }
  if (!score || typeof score.total !== 'number' || !Array.isArray(score.hardFails)) {
    console.error('score.json 结构异常(total/hardFails 缺失或类型错),重新跑 npm run score');
    process.exit(1);
  }
  const outPath = resolve(process.cwd(), 'coverage/pr-comment.md');
  writeFileSync(outPath, renderPrComment(score), 'utf8');
  process.stdout.write(`PR comment 写入: ${outPath}\n`);
}
```

### ci.yml — permissions + 2 step(均 continue-on-error,修订 1)

`.github/workflows/ci.yml` check job:

1. 加 `permissions`(job 级):
```yaml
  check:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
```

2. 在 `Score gate` 步骤后加 2 step(**均 `continue-on-error: true`**,隔离 comment 层失败):
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
```

> `continue-on-error: true` 让 comment 层(渲染/sticky)失败不拖红 PR——comment 是附加层,gate 的 status check(M3b)不受影响。`if: always()` 让 gate 失败后仍生成 + 贴 comment(展示 fail 原因);`matrix.node-version == '22'` 避免 node 24 重复贴;`github.event_name == 'pull_request'` 排除 push master。sticky 用 `header: scoring-pr-comment` 标识,更新同一条。

### package.json

```json
"score:pr-comment": "node build/scoring/cli.js pr-comment",
```

## 测试策略

| 文件 | 覆盖 |
|---|---|
| `test/scoring/pr-comment.test.ts` | renderPrComment 各状态:pass(头部 PASS + partial 标注 + 维度表)/ fail 总分不足(FAIL + reason)/ fail hardFails(硬否决列出)/ partial 不影响(pass=true)/ na 维 ⊘ na / **unknown status fallback**(STATUS_ICON 缺 → 原值,修订 5) |
| `test/scoring/report.test.ts`(已有,回归) | DIM_ORDER refactor 后不回归(现有 8 用例,验证 report 仍用共享 DIM_ORDER) |

纯函数无 IO,与 gate/report 同构。

## 错误处理

| 情况 | 行为 |
|---|---|
| cli pr-comment:score.json 不存在 | exit 1,"先跑 npm run score" |
| cli pr-comment:score.json 解析失败 | exit 1,"重新跑 npm run score" |
| cli pr-comment:score.json 结构异常 | exit 1(结构守卫,复用 gate I-1 修复) |
| CI:pr-comment step 失败 | `continue-on-error` 吞,不污染 gate status check |
| CI:sticky action 失败 | `continue-on-error` 吞,不污染 gate |
| CI:score.json 缺失(score 步骤失败) | pr-comment.md 不生成 → sticky path 缺失失败(**被 continue-on-error 吞,job 状态仍由 gate 决定**)→ 不贴评论。**已知 gap**:score.json 生成失败(M1 步骤 `continue-on-error`)是根因,根本修复在 M1/M3a 上游,M3b-PR 范围不降级 |

## 验收标准

1. `npm run score:pr-comment` 产 `coverage/pr-comment.md`,含分数徽章 + **partial 标注** + 各维表(+ 失败时 reasons)
2. renderPrComment 复用 evaluateGate(不重复 total<PASS_LINE)+ DIM_ORDER(从 dimensions.ts 共享,report.ts 同源)
3. CI check job:permissions 含 pull-requests:write;**两 comment step 均 continue-on-error**;pr-comment step if:always;sticky step 限 matrix 22 + PR
4. `pr-comment.test.ts`(含 unknown status fallback)+ `report.test.ts`(DIM_ORDER refactor 不回归)全过;全量不回归
5. tsc exit 0;eslint exit 0
6. 端到端:本地 `npm run score && npm run score:pr-comment` 产 pr-comment.md(pass 表格 + partial 标注)

## 后续(不在 M3b-PR)

- **M3b-HTML**:HTML dashboard(趋势图需历史快照基建)
- **M3c/M3d/M3e**:gdscript / performance / flaky 维度接入
- **score.json 缺失降级评论**(CI-2 gap):根因上游 M1 score 步骤 continue-on-error,留后续

## 风险

- **sticky-pull-comment 第三方 action**:需版本 pin + 信任。`marocchino/sticky-pull-comment@v2` 广泛使用(GitHub Marketplace),可接受。若顾虑可用 `actions/github-script` 替代(方案 B,但内联 JS 不可测)。
- **comment 层失败污染 gate**:已用 `continue-on-error: true` 隔离(修订 1)。gate(无 continue-on-error)失败→PR 红;comment(有)失败→不拖红。
- **permissions 收紧**:`pull-requests: write` 仅本 job;`contents: read` 显式声明避免 upload/checkout 受影响。
- **matrix 漂移**:若未来 matrix 改(如加 node 26),`== '22'` 需同步改。

## 修订记录

- **r1**(初稿):两 comment step 无 continue-on-error;头部无 partial 标注;DIM_ORDER 局部定义;测试缺 unknown status
- **r2**(审查修订,5 项全采纳):
  - CI-1(IMPORTANT):两 comment step 加 `continue-on-error: true`,隔离 gate status check
  - CI-2(IMPORTANT):score.json 缺失记为已知 gap(根因上游 M1),非目标节 + 错误处理表显式标注,不降级
  - UX-1(ADVISORY):头部加 `· verified/total 维已验证(partial 标注)`
  - DRY-1(ADVISORY):DIM_ORDER 移 dimensions.ts(report.ts + pr-comment.ts 共享;STATUS 映射不共享)
  - TEST-1(ADVISORY):pr-comment.test.ts 补 unknown status fallback 分支
