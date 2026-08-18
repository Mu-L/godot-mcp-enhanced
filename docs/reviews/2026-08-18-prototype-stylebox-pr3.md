# 原型翻译层 PR-3(ui_pixel_verify 像素终验)终审归档

- 日期:2026-08-18
- 分支:`feat/prototype-stylebox-pr3`(10 commits,`9842193..c2ec270`,基线 a79b65b)
- 版本:0.32.3(0.32.2 为分支内中间 bump 从未发版,不出段;判据 `npm view godot-mcp-enhanced dist-tags` latest=0.29.0)
- Spec:`docs/superpowers/specs/2026-08-17-prototype-stylebox-loop-design.md` §5/§7/§8/§10.2
- Plan:`docs/superpowers/plans/2026-08-18-prototype-stylebox-pr3.md`(SDD 6 任务,逐任务审查全 Approved)
- 终审方式:隔离视角 code-reviewer 子代理,不预设任务审查声明为真;通读 3147 行 diff package + spec/plan 对照 + 仓库级约束独立核查 + **亲跑全部门禁**

## 总体判定

**SHIPPED WITH NITS**(0 Critical / 0 Important / 7 Minor 全留档;1 挂账转独立任务)

## 执行期关键演进(裁决链)

1. **Task 1 裁决**:computeSamplePoints 中心取整 round→floor(0-indexed 像素格左端语义;round(50.5)=51 与测试锚点矛盾,取 floor 自洽)。
2. **Task 4 校准(§10.2 开放问题闭环)**:css-card 真渲染 13/20 采样点 distance=0.0——**零底噪零偏移**,阈值 CENTER_TOL=20/CORNER_TOL=60 维持,无需裕量。发现 4 项语义缺陷,控制器裁决修复:
   - **F1(BLOCKING)** `screenshot_capture.gd` `_detect_blank_image` 步进退化(step=total/100=4800=6×800,采样全落 x=0 单列)→ stdout 误报 BLANK_DETECTED → TS 侧拦截。裁决:**拦截改双条件**(stdout BLANK_DETECTED **AND** PNG 8x8 网格均匀色,两证据独立一致才拦)——`.gd` 根因未修(本批约束禁动,挂账独立任务)。
   - **F2** ProgressBar(bg+fill+value)bg 渲染面被 fill 与百分比文字覆盖 → **skip**(type/value/fill 任一命中;bg 槽依赖 style_verify)。
   - **F3** Label badge 文字水平居中排版,中心点必踩文字 → 带 text 节点 **skip 中心点**(仅采四角)。
   - **F4** inset=0 角点坐标 `x+w` 落在像素格半开区间 `[x, x+w)` 外一像素格(采到节点外背景,d=65.7 假红)→ 角点右/下分量改 **`x+w-1-inset`**。
3. **Version 处置**:7fce9e2(Task 4 顺手修)已 bump 0.32.2(action 240→241 双侧同步)但漏跑 version-sync;Task 5 bump 0.32.3 + A 类 5 文件 sync 收口;CHANGELOG/README 只写 0.32.3 段。
4. **T5a/T5c 随批落地**:border 四边暴露渠道措辞 4 处(style_verify 同源恒绿暴露不了→真渠道 ui_pixel_verify)/孙层措辞+七槽白名单 TS↔GD 双份硬编码互指注释。

## 终审验证证据(亲跑)

```
npx vitest run test/pixel-verify.test.ts                            → 30 passed
npx vitest run test/integration/ui-pixel-verify-integration.test.ts → 2 passed(真跑 Godot 4.6.3 窗口模式,css-card 同图全绿 7.3s)
npx vitest run test/ui-tools.test.js test/prototype-import.test.ts test/ui-measure.test.ts → 230 passed
npm run lint                                                        → 0 error
npm run build + npm run diff-matrix                                 → no drift(43 tools v0.32.3)
STRICT=1 npm run check:rules-sync                                   → OK: 9 个模板双向对账一致
独立抽段脚本(3 段:ui_pixel_verify 新段/T5a border 行/T5c 孙层行,反引号归一化逐字比对) → 全 equal
npm run version-check                                               → ✓ 0.32.3(8 处版本文件全一致)
npm run check:budget                                                → 0 error / 3 既有 warn
npm test(全量)                                                      → 376 files / 5754 passed / 35 skipped
npm view godot-mcp-enhanced dist-tags                               → latest=0.29.0(0.32.x 未发版)
```

## 仓库级约束独立核查(AGENTS.md 强制项)

| 约束 | 核查方式 | 结论 |
|---|---|---|
| 双副本逐字一致(除版本行) | STRICT 门禁之外,独立脚本抽 3 段比对 | ✅ 全 equal |
| capability-matrix 生成产物 | build-matrix 重建 + diff no drift | ✅ |
| 版本链 8 文件 | version-check + 逐文件 grep 0.32.3 | ✅ |
| build/ 不手改 | diff 无 build/ 文件 | ✅ |
| `src/screenshot.ts`/`src/scripts/screenshot_capture.gd` 只复用不改动(plan 约束) | diff 零命中 | ✅ |
| spec §8 改动面 PR-3 行逐项 | ACTIONS/types.ts/index.ts/新文件/SLIM/matrix/budget/CHANGELOG/门禁/审查+memory | ✅ 全落地 |

## Minor 清单(triage)

| # | 项 | 判定 |
|---|---|---|
| M-1 | 规则段内缩公式略 `max(0,·)` 下限(短边<4 回落 0) | 留档,下批双副本变更顺手(单独修强制 bump 不值) |
| M-2 | 规则段 `alpha<1` vs 代码 `<0.999` 窄界 | 留档,与 M-1 同批 |
| M-3 | CHANGELOG 半开区间归 Changed 非 Added(0.32.2 未发版批内修正) | 留档(内容自洽,归类瑕疵) |
| M-4 | toResPath 无跨盘防御(调用链 resolveWithinRoot 结构性保证同盘) | 留档 |
| M-5 | judgeNode 不成对契约靠运行时 TypeError(单测 toThrow 已锁定) | 留档 |
| M-6 | emptySummary `cleaned_up:true` 无产物语义(note 已声明) | 留档 |
| M-7 | 未映射控件采样预期红未进规则文档(仅代码注释) | 留档,与 M-1/M-2 同批顺手 |
| 挂账 | `screenshot_capture.gd` `_detect_blank_image` 步进退化根因:step 整除宽度时采样退化 x=0 单列,screenshot 工具族其余调用方在 800x600 类视口 stdout 误报 BLANK hint | **转独立任务**(本批约束禁动正确;hint 附注性不拦成功结果,低危但应尽快修) |

## 工程教训(已登 memory)

1. **像素采样半开区间陷阱**:rect 覆盖像素 `[x, x+w)`,角点右/下分量必须 `x+w-1-inset`(inset=0 时否则采到节点外背景,d=65.7 实测假红);0-indexed 像素格取 floor 不取 round。
2. **检测层证据独立性模式**:单证据检测器自身退化时(步进采样误报),拦截判定应要求第二独立证据(PNG 内容均匀色)AND——低成本消除假阳/假阴双风险,且不触碰「本批禁动」文件。
3. **npm 版本段跳号惯例**:内部 bump 未发版的版本号可直接跳过出段(判据 `npm view dist-tags` 非本仓文件历史)。

## 流程交付物

- 本审查文档(终审归档)
- memory:`feature-decision-log: stylebox-pixel-verify-pr3` + 教训 3 条
- Obsidian 日志:`D:\workspace\Obsidian\GodotMCP\开发日志\2026-08-18 PR-3 像素终验.md`
- ledger 交接行(`.superpowers/sdd/progress.md`)
- Pre-push review(全新上下文)后 push + 开 PR(merge 留用户)
