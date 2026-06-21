# M3b-PR: Scoring PR Comment(CI 贴评分摘要)

- **日期**: 2026-06-21
- **状态**: design(待用户审阅 → writing-plans)
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

## 设计决策

- **渲染复用 evaluateGate**(M3b Task 1):renderPrComment 调 `evaluateGate(score)` 得 `{passed, reasons}`,渲染 reasons(失败时)。避免与 gate 双真相源重复 `total < PASS_LINE` 逻辑(M3b M-1 教训)。
- **sticky-pull-comment**:更新同一条 comment(用 header 标识),避免每次 CI 跑堆积新 comment。
- **matrix 限制**:check job `matrix: [22,24]` = 2 实例,comment 只在 `node-version=='22'` 贴(避免重复 2 条)。
- **PR only**:`github.event_name == 'pull_request'`(push master 不贴)。
- **permissions**:check job 级 `contents: read, pull-requests: write`(显式列,避免覆盖破坏其他 step)。

## 架构

新增 1 纯函数 + 3 接线(与 gate/report 同构):

```
src/scoring/
├─ pr-comment.ts     [新] renderPrComment(score) → string     纯函数
├─ cli.ts            [改] 加 pr-comment 子命令(读 score.json → 写 pr-comment.md)
└─ (gate/report/generate-score/collectors/types 不变)

package.json         [改] 加 score:pr-comment 脚本
.github/workflows/ci.yml  [改] check job 加 permissions + 2 step(生成 + sticky 贴)
```

数据流:
```
CI check job(PR 触发)
  ├─ npm run score(M3b)→ score.json + score-report.md
  ├─ npm run score:gate(M3b)→ exit 0/1(status check)
  ├─ npm run score:pr-comment(M3b-PR)→ coverage/pr-comment.md   [if: always]
  └─ sticky-pull-comment(M3b-PR)→ 贴 PR comment                   [if: always && matrix22 && PR]
```

## 详细设计

### pr-comment.ts — renderPrComment

纯函数,`src/scoring/pr-comment.ts`:

```ts
import type { ScoreJson, DimensionName } from './types.js';
import { NA_SCORE } from './dimensions.js';
import { evaluateGate } from './gate.js';

const DIM_ORDER: DimensionName[] = ['integration', 'coverage', 'security', 'flaky', 'performance', 'gdscript'];
const STATUS_ICON: Record<string, string> = { pass: '✅', warn: '⚠️', fail: '❌', na: '⊘ na' };

/**
 * 渲染 PR comment 摘要 markdown(比 score-report.md 简短,适合 PR 显示)。
 * 复用 evaluateGate 得 reasons(失败时渲染),避免与 gate 双真相源。
 * 自含(不链接 artifact);na 维显示 ⊘ na;未知 status 显示原值。
 */
export function renderPrComment(score: ScoreJson): string {
  const { passed, reasons } = evaluateGate(score);
  const overall = passed ? '✅ PASS' : '❌ FAIL';
  const lines: string[] = [];
  lines.push(`## 📊 质量评分:${score.total} ${overall}`);
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
## 📊 质量评分:85.8 ✅ PASS

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
## 📊 质量评分:60.0 ❌ FAIL

- 总分 60 < 75(pass 线)

| 维度 | 分数 | 状态 |
|---|---|---|
...
```

### cli.ts — pr-comment 子命令

`src/scoring/cli.ts` 在 gate 分支后加 pr-comment 分支(复用 gate 的结构守卫,I-1 教训):

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

### ci.yml — permissions + 2 step

`.github/workflows/ci.yml` check job:

1. 加 `permissions`(job 级,在 `runs-on` 前/后):
```yaml
  check:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
```

2. 在 `Score gate` 步骤后加 2 step:
```yaml
      - name: Score gate (M3b)
        run: npm run score:gate
      - name: Score pr-comment (M3b-PR)
        if: always()
        run: npm run score:pr-comment
      - name: Sticky PR comment (M3b-PR)
        if: always() && matrix.node-version == '22' && github.event_name == 'pull_request'
        uses: marocchino/sticky-pull-comment@v2
        with:
          header: scoring-pr-comment
          path: coverage/pr-comment.md
```

> `if: always()` 让 gate 失败后仍生成 + 贴 comment(展示 fail 原因);`matrix.node-version == '22'` 避免 node 24 重复贴;`github.event_name == 'pull_request'` 排除 push master。sticky 用 `header: scoring-pr-comment` 标识,更新同一条。

### package.json

```json
"score:pr-comment": "node build/scoring/cli.js pr-comment",
```

## 测试策略

| 文件 | 覆盖 |
|---|---|
| `test/scoring/pr-comment.test.ts` | renderPrComment 各状态:pass(头部 PASS + 维度表)/ fail 总分不足(FAIL + reason)/ fail hardFails(硬否决列出)/ partial 不影响(pass=true)/ na 维 ⊘ na |

纯函数无 IO,与 gate/report 同构。

## 错误处理

| 情况 | 行为 |
|---|---|
| cli pr-comment:score.json 不存在 | exit 1,"先跑 npm run score" |
| cli pr-comment:score.json 解析失败 | exit 1,"重新跑 npm run score" |
| cli pr-comment:score.json 结构异常 | exit 1(结构守卫,复用 gate I-1 修复) |
| CI:pr-comment.md 未生成(score 步骤失败) | sticky step path 不存在 → step 失败,但 if:always 已跑;comment 不贴(step 失败),不影响 gate 的 status check |

## 验收标准

1. `npm run score:pr-comment` 产 `coverage/pr-comment.md`,含分数徽章 + 各维表(+ 失败时 reasons)
2. renderPrComment 复用 evaluateGate(不重复 total<PASS_LINE 逻辑)
3. CI check job:permissions 含 pull-requests:write;pr-comment step if:always;sticky step 限 matrix 22 + PR
4. `pr-comment.test.ts` 全过;全量不回归
5. tsc exit 0;eslint exit 0
6. 端到端:本地 `npm run score && npm run score:pr-comment` 产 pr-comment.md(pass 表格)

## 后续(不在 M3b-PR)

- **M3b-HTML**:HTML dashboard(趋势图需历史快照基建)
- **M3c/M3d/M3e**:gdscript / performance / flaky 维度接入

## 风险

- **sticky-pull-comment 第三方 action**:需版本 pin + 信任。`marocchino/sticky-pull-comment@v2` 广泛使用(GitHub Marketplace),可接受。若顾虑可用 `actions/github-script` 替代(方案 B,但内联 JS 不可测)。
- **permissions 收紧**:`pull-requests: write` 仅本 job;`contents: read` 显式声明避免 upload/checkout 受影响。
- **matrix 漂移**:若未来 matrix 改(如加 node 26),`== '22'` 需同步改。替代:独立 job(只跑一次),但增加 job 依赖复杂度。当前 matrix 稳定,用 `== '22'`。
