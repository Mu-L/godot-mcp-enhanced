# 第三方审查报告:小白一条龙批 1(分发/声量)

- **日期**:2026-08-20
- **分支**:`feat/xiaobai-batch1-distribution`
- **审查者**:code-reviewer 子代理(独立会话,51 次工具调用;快照数字全部独立复测)
- **spec**:`docs/superpowers/specs/2026-08-20-xiaobai-onestop-roadmap-design.md` §3 批 1
- **原始判定**:**BLOCKING ISSUES**(1 项 B-1)→ 处置后 **SHIPPED**
- **终验**:`npm run lint` ✅ / `npm run build` ✅ / `npm test` 5999 passed(处置后复跑)✅ / `node scripts/check-tool-count.mjs` 24 处 ✅ / `git diff master --stat` 证实改动面仅 `README.md`/`README.en.md`/`CHANGELOG.md` + 新增 `docs/guides/` + spec 文件,`src/`、`addons/`、`.claude/rules/`、`docs/capability-matrix.*` 零触碰 ✅

## 逐维度结论(审查者实测)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| spec 符合性 C-1 | ✅ | 指南三要素(工作流/GDD 大体互通/README 入口×2)齐全,`docs/guides/ccgs-integration.md` |
| spec 符合性 C-2 | ⚠️→✅ | GIF/Web/自动安装/模板库/wizard 全部「尚未支持」限定(README.md:25 / README.en.md:24);undo 53 落实;唯一违例 B-1 已修 |
| spec 符合性 C-3 | ✅ 诚实降级 | GitHub Sponsors 实测未开通(profile 无 Sponsors 标签),不落无效 FUNDING.yml;README 双版零 sponsor 残留 |
| 小白叙事工具声明 | 9 真 1 假→**10 真** | 逐一 grep `src/tools/` + capability-matrix 实测;`capture_screenshot` 旧名违例(B-1)已修 |
| 快照数字 | ✅ | undo 53(10 文件逐文件计数)/49 agents/73 skills(Glob)/24225★+pushed_at(GitHub API)/GDD 8 段逐字同序(`game-design.ts:21-30` vs CCGS `design/CLAUDE.md:7-15`)全部独立复测吻合 |
| 链接可达 | ✅ | 全部相对链接目标 + `#快速开始` 锚点存在;安装命令与 README:513 逐字一致 |
| 措辞红线 | ✅ | B-1/B-2 硬约束(GIF/Web 不得写成已支持)完整守住,中英双版 grep 零违规 |
| 仓库级约束 | ✅ | src/addons/rules/matrix 关键词零命中 + git diff --stat 终验(审查者无 Bash 由实现者补跑) |
| CHANGELOG 质量 | ✅ | [Unreleased] 风格一致;「对照 7 条」实测恰 7 行 |

## Blocking Issues 与处置

### B-1:小白叙事引用已废弃工具名 `capture_screenshot`(已修)

- **事实链**(审查者实测):`src/` 全域 grep 仅 `src/tools/claudemd-builder.ts:95` 一处残留(分发规则文本,既有);`docs/capability-matrix.json` 权威清单零命中;现行截图入口是顶层工具 `screenshot`(action `capture`/`analyze`/`diff`)。`capture_screenshot` 是 merged 架构合并前旧名。实现者从 README:186 旧工具表抄名,把既有改名残留复制进了「小白第一屏」——违反 C-2「只写已真能做的」验收标准,对最无纠错能力的目标读者伤害最大。
- **处置**:①叙事节改名 `screenshot`(action `capture`)(README.md:18 / README.en.md:17);②顺带消同源既有漂移:README.md:186-187 工具表两行合并为 `screenshot` 截图三件套一行(capture/analyze/diff)、README.md 平台说明段旧名同步改;③指南对照表同款旧名一并修(`ccgs-integration.md:85`)。修复后全仓 grep `capture_screenshot|analyze_screenshot` 仅剩 CHANGELOG/README 历史版本行(历史快照,保留)。
- **未随批修(挂账)**:`src/tools/claudemd-builder.ts:95` 分发规则文本的同款旧名残留——属 src/ 代码改动,超出本批「近零代码」范围(spec 批 1 约束「不动 src/」),留后续批处理。

### N-1:指南「v1.0.0 后无提交」口径混用(已修)

- `gh api .pushed_at`(全仓任何分支,2026-05-21)与 `git log -1`(默认分支,2026-05-13)是两个时间戳,原表述自相缠绕。已改为双口径明示(`ccgs-integration.md:97`)。

### N-2(既有问题披露,不计入本批)

README 工具表与 claudemd-builder 分发文本的旧名残留系 merged 架构改名后的历史漂移;README 侧已随 B-1 处置顺带清零,src 侧留挂账(见 B-1 处置)。

## 工程教训(登 memory)

1. **叙事文档引用工具名,不能以自家 README 工具表为真相源,必须对照 capability-matrix 或 src/tools/ 实测**——merged tool 架构改名后,旧名会同时残留在 README 表格与 claudemd-builder 分发文本两处,新增叙事引用前 grep matrix 一遍即可拦截。
2. **「上游停滞」类快照要声明数据口径**:`gh api .pushed_at` 与 `git log -1` 是两个时间戳,混用产出「v1.0.0 后无提交(2026-05-21 实测)」这类自相缠绕的表述。
