# M3b: Scoring 报告与发版门禁

- **日期**: 2026-06-21
- **状态**: design(审查修订版 r2,待用户确认 → writing-plans)
- **里程碑**: scoring M3b
- **前置**: M1 coverage + M2 integration + M3a security(均已完成,`coverage/score.json` 已是完整数据底座)
- **范围决策**: 方案 A = markdown 报告 + score:gate 门禁(PR 展示 / HTML dashboard 作为后续 M3b-PR / M3b-HTML)

## 背景与动机

M1/M2/M3a 完成后,`coverage/score.json` 已是完整数据底座(`total` / 各维 `score+weight+status+raw` / `hardFails` / `unverified`)。实测发现两个缺口:

1. **只写不读**:`score.json` 除 `src/scoring/cli.ts` 写入外**无任何消费方**。`hardFails` / pass 线算出却无人用——死数据。
2. **无人读呈现**:数据底座完整,但没有任何"人能直接看"的渲染层。开发者必须手动解读 JSON。

M3b 补这两层:**markdown 报告**(人读)+ **score:gate**(发版门禁,让 score 真正生效)。

## 目标

- `npm run score` 自动产出 `coverage/score-report.md`(人读 markdown)
- `npm run score:gate` 读 score.json,未过门禁则 exit 1
- CI check job 接入 gate,质量回归阻断 PR 合并

## 非目标(YAGNI)

- ❌ PR comment / status check → M3b-PR 后续
- ❌ HTML 可视化 dashboard → M3b-HTML 后续(趋势图需历史 score 快照基建)
- ❌ 嵌入 verify_delivery(见下"设计纠正")
- ❌ partial 阻断(M3c-e 未接入前 3 维 na,强制非 partial 会永远卡门禁)

## 设计纠正:为何不嵌入 verify_delivery

初拟"verify_delivery 读 score.json 门禁",深入 `src/tools/delivery.ts` 后证伪:

- `delivery.ts` `@deprecated v0.18.0`,逻辑已合并 `validation.ts`(仅留 handler 供 re-export)
- `handleTool` 第一步检查 `project.godot`(delivery.ts:215)——它是给**目标 Godot 项目**的交付验证工具
- `score.json` 评分的是 **enhanced 自己**(coverage/integration/security 全是 enhanced 指标)
- 项目错位:enhanced 的质量分不该塞进"验证用户 Godot 项目"的工具

**修正**:门禁独立为 `score:gate` 脚本 + CI,不碰 verify_delivery。

## 架构

新增 2 个纯函数文件 + 4 处接线:

```
src/scoring/
├─ report.ts           [新] renderScoreReport(score) → string          纯函数
├─ gate.ts             [新] evaluateGate(score) → {passed, reasons}     纯函数
├─ generate-score.ts   [改] 写 score.json 后顺带写 score-report.md
├─ cli.ts              [改] 串联 report;新增 gate 子命令
└─ (aggregate / collectors / types / dimensions 不变)

.github/workflows/ci.yml  [改] check job: score 步骤去 || true;新增 gate 步骤(不加 continue-on-error)
package.json              [改] 加 score:gate script
```

数据流:

```
npm run score ─→ generateScore(opts)
                  ├─ collectCoverage/Integration/Security
                  ├─ computeScore → score.json               [M1-M3a 数据底座]
                  └─ renderScoreReport → score-report.md     [M3b 新]

npm run score:gate ─→ 读 score.json ─→ evaluateGate ─→ exit 0/1   [M3b 新]

CI check job ─→ npm run score(去||true) && npm run score:gate ─→ 失败则 PR check 红
```

## 详细设计

### report.ts — renderScoreReport

纯函数,`src/scoring/report.ts`:

```ts
import type { ScoreJson } from './types.js';

export function renderScoreReport(score: ScoreJson): string
```

输出结构:

```
# 质量评分报告
**总分 85.8 / 100**  ✅ PASS  (partial: 3/6 维已验证)  · 2026-06-21T02:06Z

## 维度明细
| 维度 | 分数 | 权重 | 状态 | 关键指标 |
|---|---|---|---|---|
| integration | 100 | 0.30 | ✅ pass | 45/45 passed |
| coverage | 70.2 | 0.20 | ✅ pass | 70.2% (7945/11325) |
| security | 80 | 0.20 | ✅ pass | 2 high (-20) |
| flaky | — | 0.10 | ⊘ na | 未接入(M3e) |
| performance | — | 0.10 | ⊘ na | 未接入(M3d) |
| gdscript | — | 0.10 | ⊘ na | 未接入(M3c) |

## 硬否决
(无)

## 未验证维度
flaky, performance, gdscript — M3c-e 接入
```

各维"关键指标"按维度从 `raw` 提取(需类型 narrowing,实现细节 plan 阶段定):
- integration → `${raw.passed}/${raw.ran} passed`(`ran = passed + failed`,排除 pending/skip;与 collector 的 `pct = passed/ran` 一致,**不用含 skip 的 `total`**)
- coverage → `${raw.pct}% (${raw.hit}/${raw.found})`
- security → `${raw.high + raw.critical} high/critical (-${raw.deduction})`
- na 维 → "未接入(M3x)"

**时间戳**:头部时间取自 `score.generatedAt`(已是 ISO),不重复 `new Date()`,保证报告时间与 score 时间一致。

**容错**:未知 status 显示原值;raw 缺失显示 "—"。

**产物追踪**:`coverage/score-report.md` 在 `coverage/` 下,已被 `.gitignore` 的 `coverage/` 覆盖(产物,无需 git 追踪)。

### gate.ts — evaluateGate

纯函数,`src/scoring/gate.ts`:

```ts
import type { ScoreJson } from './types.js';
import { PASS_LINE } from './dimensions.js';

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

export function evaluateGate(score: ScoreJson): GateResult {
  const reasons: string[] = [];
  if (score.total < PASS_LINE) reasons.push(`总分 ${score.total} < ${PASS_LINE}(pass 线)`);
  for (const hf of score.hardFails) {
    reasons.push(`硬否决 ${hf.dimension}: ${hf.reason}(${hf.actual} < ${hf.threshold})`);
  }
  return { passed: reasons.length === 0, reasons };
}
```

规则:`passed = reasons.length === 0`(等价 total≥PASS_LINE 且无硬否决)。直接判 `score.total < PASS_LINE` 而非聚合 `score.pass`,以**区分"总分不足"与"硬否决"两种 fail 原因**(若用 `!score.pass` 会混淆二者,因 score.pass=false 可能源于任一)。用 `PASS_LINE` 常量(`dimensions.ts:20` 导出)而非硬编码 75。**partial 不阻断**(`unverified` 维度只影响报告完整度,不影响门禁)。

### cli.ts — gate 子命令

`src/scoring/cli.ts` 扩展:

- 现有:无参 → generateScore(写 score.json + score-report.md)
- 新增:`gate` 子命令 → 读 `coverage/score.json` → evaluateGate → exit code

```ts
const cmd = process.argv[2];  // 'gate' | undefined
if (cmd === 'gate') {
  const scorePath = resolve(cwd, 'coverage/score.json');
  if (!existsSync(scorePath)) {
    console.error('score.json 不存在,先跑 npm run score');
    process.exit(1);
  }
  let score: ScoreJson;
  try { score = JSON.parse(readFileSync(scorePath, 'utf8')); }
  catch { console.error('score.json 解析失败,重新跑 npm run score'); process.exit(1); }
  const { passed, reasons } = evaluateGate(score);
  if (!passed) { console.error('质量门禁未过:\n' + reasons.join('\n')); process.exit(1); }
  console.log(`质量门禁通过: total=${score.total}`);
}
```

### generate-score.ts — 写报告

`src/scoring/generate-score.ts` 写完 score.json 后追加(报告路径从 outPath 派生,不新增 option):

```ts
writeFileSync(opts.outPath, JSON.stringify(score, null, 2) + '\n', 'utf8');
const reportPath = opts.outPath.replace(/score\.json$/, 'score-report.md');
writeFileSync(reportPath, renderScoreReport(score), 'utf8');
```

### CI 接入

**现状**(ci.yml:29-33):score 步骤是 `npm run score || true` + `continue-on-error: true`(双 non-blocking——`|| true` 吞掉 score 失败的 exit code,步骤伪装成功)。

**改动**:
1. score 步骤:去 `|| true`,**保留 `continue-on-error: true`**(仍允许 score 失败不阻断 CI 其他步骤,但诚实标记步骤失败)
2. 新增 gate 步骤(**不加** continue-on-error,失败即阻断):

```yaml
  - name: Generate score.json (M1, non-blocking)
    run: |
      npm run build
      npm run score          # ← 去掉 || true
    continue-on-error: true   # ← 保留(允许 score 失败继续)
  - name: Score gate
    run: npm run score:gate   # ← 不加 continue-on-error(失败即阻断 PR)
```

**机制**:score 是 gate 的前提。score 生成失败 → score.json 缺失 → gate 读不到 → gate exit 1 → PR check 红 → 阻断合并。score 生成失败须**让 gate 抓到**,而非 `|| true` 静默吞掉 exit code。

### npm scripts

`package.json` scripts 加:

```json
"score:gate": "node build/scoring/cli.js gate"
```

## 测试策略

| 文件 | 覆盖 |
|---|---|
| `test/scoring/report.test.ts` | renderScoreReport 各状态:pass / partial / hardFails 非空 / 全 na / 未知 status 容错 |
| `test/scoring/gate.test.ts` | evaluateGate 三种 reason 组合:total<PASS_LINE(纯总分不足)/ 纯硬否决(total≥线但 hardFails 非空)/ 两者皆有;partial(pass=true 且有 unverified)→ passed=true |
| `test/scoring/cli-gate.test.ts`(新) | spawn 子进程跑 `cli.js gate`,断言 exit code 三分支:score.json 不存在→exit 1 / 解析失败(损坏 json)→exit 1 / 全过→exit 0 |
| `aggregate.test.ts`(已有) | pass 线 / hardFails / 权重重分配——gate 复用 `PASS_LINE`/`hardFails`,不重复测聚合 |

report / gate 均纯函数,单测无 IO。cli gate 的 exit code 用 `node:child_process` spawn 集成测试(成本低,覆盖 `process.exit` 分支)。

## 错误处理

| 情况 | 行为 |
|---|---|
| gate:score.json 不存在 | exit 1,"先跑 npm run score" |
| gate:score.json 解析失败 | exit 1,"重新跑 npm run score" |
| report:未知维度 status | 显示原值 |
| report:raw 缺失 | 显示 "—" |

## 验收标准

1. `npm run score` 产出 `coverage/score-report.md`,含总分/各维表格/硬否决/未验证
2. `npm run score:gate` 在 total≥PASS_LINE 且无 hardFails 时 exit 0,否则 exit 1 + reasons(区分总分不足/硬否决)
3. CI check job:score 步骤去 `|| true`,新增 gate 步骤(不加 continue-on-error)
4. `report.test.ts` + `gate.test.ts` + `cli-gate.test.ts` 全过;全量测试不回归
5. tsc exit 0;eslint exit 0
6. 端到端:当前 enhanced score.json(85.8 pass,hardFails=[])→ gate 通过

## 后续里程碑(不在 M3b)

- **M3b-PR**:CI 把 score-report.md 贴 PR comment + status check(依赖本 markdown 底座)
- **M3b-HTML**:HTML dashboard(趋势图需历史 score 快照基建,先建快照 or 砍趋势)
- **M3c / M3d / M3e**:gdscript / performance / flaky 维度接入(各独立 brainstorming)

## 风险

- **coverage 波动误伤**:gate 用综合 `total`(非单维),小波动不触发;仅 total<PASS_LINE 或硬否决才阻断
- **score.json 陈旧**:gate 读上次 score 产物,CI 每次 PR 重跑 score 保证新鲜;本地手动 gate 前需先 score

## 修订记录

- r1(初稿):gate 用 `!score.pass` + 硬编码 75;CI 仅"加 gate 步骤"未处理 score 现有 non-blocking
- r2(审查修订):① CI score 步骤去 `|| true`(保留 continue-on-error),gate 不加 continue-on-error;② gate 改用 `PASS_LINE` 常量 + `score.total < PASS_LINE`,区分总分不足/硬否决;③ `passed = reasons.length === 0`(消除 `&& hardFails.length===0` 冗余);④ integration 指标用 `raw.ran` 不用含 skip 的 `total`;⑤ 时间戳取 `score.generatedAt` + 注明 score-report.md 已被 gitignore;补 cli exit code spawn 集成测试
