# M3b-HTML: Scoring HTML 报告(静态 dashboard)

- **里程碑**: scoring M3b-HTML
- **前置**: M3b 报告+门禁 + M3b-PR + **M3c gdscript**(渲染层 dimMetric gdscript case 已落地)
- **范围**: 第三种渲染 `renderScoreHtml` → 自包含 HTML 报告(静态 + 轻量内联 CSS)。**砍趋势**(趋势图需历史 score 快照基建,留独立 milestone)
- **范围决策**: 方案 A(静态 + 轻量内联 CSS),否决 B(富视觉仪表盘 over-engineering)/ C(轻交互,砍趋势后价值低)
- **实施顺序依赖**(**关键**): M3b-HTML 依赖 M3c scoring 代码(`src/scoring` 全套),当前只在 `m3c-gdscript` worktree(`fix/review-verification` 分支),**master 主树无 `src/scoring`**。故 M3b-HTML 在 `m3c-gdscript` worktree 接着做(同分支,合并时 M3c+M3b-HTML 一起进 master)。在 master 新开 worktree 会找不到 scoring 代码。

## 背景

现有渲染层:`renderScoreReport`(markdown, `score-report.md`)+ `renderPrComment`(PR comment)。markdown 在 GitHub 渲染好,但 CI artifact 下载 `.md` 需渲染器。M3b-HTML 补 HTML 版:**自包含单文件**,CI artifact 下载即浏览器看,状态色视觉更直观。

## 方案选择

| 方案 | 样式 | 复杂度 | 选 |
|------|------|--------|-----|
| A 静态 + 轻量内联 CSS | 状态色 + 表格,无 JS,单文件 | 低 | ✅ |
| B 静态 + 富视觉 | 进度条/卡片,CSS 重 | 中高 | ✗ over-engineering(砍趋势后无需富视觉) |
| C 轻交互(内联 JS) | 折叠/tooltip | 中 | ✗ 砍趋势后交互价值低 |

## 数据流

```
[CI check job]
  npm run score → score.json(现有)
  → npm run score:html: cli html 子命令 → renderScoreHtml(score) → coverage/score-report.html
  → upload artifact(score-report.html)
```

## 核心设计

### `renderScoreHtml(score: ScoreJson): string`(`src/scoring/html.ts`,纯函数)

纯函数,输入 ScoreJson,输出**自包含 HTML 字符串**(`<!DOCTYPE html>` + `<style>内联CSS</style>` + `<body>报告</body>`)。内联 CSS(无外部依赖,artifact 单文件)。

HTML 结构:
- **头部**:总分(大字)+ PASS/FAIL 徽章(色块)+ partial 标注 + generatedAt
- **维度表**:维度/分数/权重/状态徽章/关键指标(复用 shared `dimMetric`)
- **硬否决**段(hardFails 非空)
- **未验证**段(unverified)

状态色 class:pass `#16a34a` / warn `#ca8a04` / fail `#dc2626` / na `#71717a`。

### HTML 转义(硬约束,`src/scoring/html.ts` `escapeHtml`)

项目无现成 HTML escape(gdEscape=GDScript 語境 / tscn-editor-shared.ts=.tscn 語境,都不是 HTML),新写。

- **全字符集**:`& < > " '` 五个(`' "` 常被漏;纵深防御全转,即使当前只进文本节点)
- **所有字符串插值都过 escapeHtml**:hardFails.reason / generatedAt / godotVersion / DimensionName / detail / dimMetric 返回值,全部
- **数字直接插值**(total/score/weight),**status 是固定枚举映射 class 名**(不过 escape)
- **`&` 必须先转**(否则 `<` 转出的 `&lt;` 里的 `&` 被二次转义成 `&amp;lt;`)。顺序:`& → < → > → " → '`

```ts
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')   // 必须先(否则后续 &lt; 的 & 二次转义)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### DRY: shared `dimMetric`(`src/scoring/metric.ts`)

`report.ts:16-32` `dimMetric`(私有,未 export)当前 1 处用。HTML 表格同需求(关键指标列)→ 第 2 处。

- **抽 shared `dimMetric` + `round1`** 到 **`src/scoring/metric.ts`**(不塞 `dimensions.ts`——那是权重/阈值/哨兵配置,渲染提取混进去混淆职责)
- `report.ts` import `metric.ts`(`dimMetric` + `round1`),行为不变(`report.test.ts` 现有测试绿)
- `html.ts` import `metric.ts` `dimMetric`
- **HTML 指标列纯文本**(方案 A);将来 HTML 想富指标(errors>0 红 badge)再分化——当前抽 shared 零副作用

### DRY: `loadScore` helper(`cli.ts`)

`cli.ts` 读 score.json + 结构守卫(`total: number` + `hardFails: array`)将 3 处重复:gate(`cli.ts:16-32`)/ pr-comment(`:40-55`)/ score:html(新增)。

- **抽 `loadScore(scorePath): ScoreJson`** helper(读文件 + JSON.parse + 结构守卫,失败 throw 带清晰 message)到 `cli.ts` 顶部(或 helper 文件)
- 3 处复用(gate/pr-comment/html),同 dimMetric DRY 节奏
- gate/pr-comment 现有 `cli-gate.test.ts` 行为不变

## cli + CI 接入

- **cli.ts** 加 `html` 子命令(对齐 pr-comment:`loadScore` → `renderScoreHtml` → 写 `coverage/score-report.html`)
- **package.json** 加 `"score:html": "node build/scoring/cli.js html"`
- **ci.yml check job** 加 step `npm run score:html`(score step 后,`continue-on-error: true`,对齐 pr-comment)+ upload artifact step(`score-report.html`,对齐 `ci.yml:50-56` score-json 模式)

## 测试

### `renderScoreHtml` 单测(`test/scoring/html.test.ts`)

纯函数,inline 造 ScoreJson(对齐 `report.test.ts` `makeScore` fixture 模式):
- 头部含总分 + PASS/FAIL + generatedAt
- 维度表(DIM_ORDER 全 6 维,含 gdscript 关键指标 "X err / Y warn")
- 状态色 class(pass/warn/fail/na 各一)
- 硬否决/未验证渲染
- **HTML 转义(XSS)**:detail 含 `<script>alert(1)</script>` → 输出含 `&lt;script&gt;`(**不含**原始 `<script>`)
- **`&` 顺序锁**:detail 含单独 `&` → 输出 `&amp;`(锁 `&` 先转,不出现 `&amp;lt;` 二次转义)
- 自包含:输出以 `<!DOCTYPE html>` 开头 + 含 `<style>`

### `escapeHtml` 单测

- `& < > " '` 五字符各转
- `&` 先转顺序(`&` 单独 → `&amp;`;`<` → `&lt;` 非 `&amp;lt;`)
- 空字符串 → 空

### `metric.ts` 单测(dimMetric 抽出后)

- 各维度关键指标提取(integration `ran/passed` / coverage `pct` / security `deduction` / gdscript `err/warn`)
- na 维 → "未接入"
- `round1` 精度

### `loadScore` 单测(抽 helper 后)

- 正常 score.json → ScoreJson
- 文件缺失 → throw(清晰 message)
- 结构异常(`hardFails: null` / `total` 非 number)→ throw

## 非目标(不在 M3b-HTML)

- ❌ **趋势图**(需历史 score 快照基建——存储/版本/清理/读取,留独立 milestone;砍趋势已决)
- ❌ 富视觉仪表盘(进度条/卡片,方案 B 否决)
- ❌ 交互(折叠/tooltip/JS,方案 C 否决)
- ❌ 外部 CSS/JS/图片(破坏单文件自包含)
- ❌ dashboard 站点/持续部署(需快照基建 + 部署,远超 M3b-HTML)

## 后续里程碑

- **趋势图 milestone**(独立):历史 score 快照基建(`score-history.json` 存储/版本/清理)+ HTML 趋势渲染。M3b-HTML 的 HTML 框架可扩展接入(`<canvas>`/`<svg>` 趋势位预留可选)。
- **M3d** performance / **M3e** flaky 维度接入
