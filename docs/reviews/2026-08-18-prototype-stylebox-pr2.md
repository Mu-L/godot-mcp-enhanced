# PR-2 verify 层(style_verify + flow_verify)终审归档

- 日期:2026-08-18
- 分支:`feat/prototype-stylebox-pr2`(基线 `ba8498f`,7+1 commits:`a654174`/`caba227`/`88bf377`/`fcfce2c`/`9bfc641`/`98d7f39`/`64d5cee` + 终审顺手修 `e974472`)
- 终审者:独立 code-reviewer 子代理(隔离视角,不采信 plan/任务报告声明,关键点 grep/read/实跑验证)
- 判定:**MERGE READY**(零 Blocking / 零 Important;1 项 Minor 顺手修已落 `e974472`,其余 Minor 全部 triage 留档)

## 总体判定:MERGE READY

| 维度 | 结论 | 关键证据 |
|------|------|---------|
| 设计正确性 | 通过 | I-B 判定信息传递机制实测符合(期望清单 TS 侧内嵌 `ui-measure.ts:37` ∪ 运行时 override 存在性 `ui-measure.ts:123-127`,无 GD 纯自判路径);「override 没设上以默认主题数值 diff 暴露」防线推演+单测双成立(`layout-diff.ts:226-246`);flow_verify 直接子层/视口绝对坐标正确(`layout-diff.ts:255-273`) |
| TS-GD 一致性 | 通过 | StyleReading 形状逐字段对齐(TS `layout-diff.ts:131-141` vs GD `ui-measure.ts:129-144`);path 双侧核实(生成侧 `containerName`/cleanName 唯一性,消费侧 `get_path_to`);escapeForGdLiteral 转义链 round-trip 闭合;七槽白名单双侧一致 |
| 测试质量 | 通过 | 集成 7 用例真跑 Godot 4.6.3 复验全绿(65.7s);mock 形状=GD 真实形状;负向覆盖充分(M-2/M-5/reading missing/非 Flat/容差边界);flow dh=+7/dy=-4 如实断言 ok:false,不伪装全绿 |
| 部署同步(仓库级约束独立核查) | 通过 | ①`STRICT=1 check:rules-sync` 9 模板一致;②matrix 重建零漂移+diff-matrix no drift;③version-check 0.32.1 全链;④CHANGELOG 0.32.1 五条 vs 7 commits 逐条对应;⑤build/ 未手改;spec §8 PR-2 行逐行核销 |
| 验证完整性 | 通过 | 门禁八项主流程全绿(lint 0/build 0/test 5722 passed/rules-sync/build-matrix/diff-matrix/budget 0 err/version-check 0.32.1);终审本机复跑 9 项全过 |

## 实测校准记录(spec §7 方法论:跑红→修绿即期望值来源)

- **style_verify 条数 = 31**(fixture css-card 六节点按「只比显式字段」手算:CardBg 10 + Title 5 + TagChip 5 + Desc 0 + BorderOnly 9 + HpBar 2)。plan 预估 34、协调者修正 33 均为算术笔误,以真跑 31 固化,测试注释留痕(`test/integration/ui-import-integration.test.ts:381-391`)。
- **flow_verify 直接子层实测**:dx=0(space-between x 精确)/dy=-4(FILL 拉伸 y 从 104→100)/dh=+7(落地 h=39 而非容器 40);ok=false 如实断言 +「HTML align vs Godot fill 固有偏差,偏差即价值」注释——spec §10.5 开放问题(容差/size_flags 翻译规则)的决策输入。
- **ProgressBar 三组合 style_verify**:bg-only 1 条/fill-only 1 条/bg+fill 2 条,期望清单只含产出槽(验证不冒默认主题读回)。

## Minor triage(终审裁定)

| 项 | 判定 | 理由 |
|----|------|------|
| T1c test 未使用导入 | **已修**(e974472) | 本 PR 引入、零风险;34 passed 复验 |
| T1a/T1b diffStyles 防御跳过/corner null 理论崩点 | 留 | GD 契约 flat=true 四组必产已被集成真跑固化;NaN 出红不假绿;可并入 PR-3 |
| T2 灰底文案括号对降级 Panel 不精确 | 留 | 纯文案精度,行动指引不受影响,降级场景另有双保险 warning |
| T3a get_theme_stylebox null 理论崩点 | 留 | 七槽均为基础主题槽必有 fallback |
| T3b parse 失败静默回落空字典 | 留(降级) | 终审推演:全期望出 `(reading missing)` 红条目,**不假绿**——优于任务级审查定性 |
| T3c sp/np gdEscape 同类残留(% 双写理论损坏含 % 路径) | 留 | 既有债(dcc62fa,PR-1 之前);显式报错非静默;建议独立小修批与 I-1 同类清算 |
| T3d LS/PS 有损转义 | 留 | prototype 链 name 已清洗,仅手写树理论可达 |
| T5a M-1 句末「以 style_verify 数值暴露」措辞弱一致(双副本+README+CHANGELOG 4 处) | 留,**PR-3 批次内修** | 期望与 override 同源恒绿,真暴露渠道是 screenshot diff;修须动双副本+版本 bump,不宜 merge 前单独发版 |
| T5b README 240 action 口径 | 留 | 历史漂移(0.31.3→0.31.4),当前值与 matrix 实测一致,非本 PR 引入 |
| T5c 孙层措辞歧义 + 附注(七槽白名单 TS/GD 双份硬编码) | 留,与 T5a 同批 | 措辞精度;扩槽时双侧同步,建议 types.ts 加注释指回 |
| T6a flow FILL h=39 vs 容器 40 根因未挖 | 留 | spec §10.5 决策输入(疑似 HBox separation/theme margin) |

## 值得进 memory 的工程教训(终审提炼)

1. **转义入口按「字符串消费方式」选择,不按文件惯性**:gdEscape(% 格式化场景)与 escapeForGdLiteral(字面量序列化)混用点必须逐一判断消费方式;I-1 与 sp/np 残留同根因,后续批次应全量清算 `ui-measure.ts:21-22`。
2. **「静默回落」要追下游是否有红条目兜底再定性**:parse 失败回落空字典经推演不假绿(reading missing 兜底)——对每个「静默」分支必须推演到最终 diff 输出才能定严重级。
3. **校准循环的计数断言不可信 plan 预估值**:31 条计数在 plan/brief 先后写错 34/33——凡「条目数/实测值」断言一律以集成真跑为准,plan 数字只是占位。
4. **跨文件脆弱锚点**:ui-measure 生成脚本头部声明位置受 `ui-layout-integration.test.ts` 的 `'var _frames := 0'` 截取锚点约束,改动脚本头部时必读 `ui-measure.ts:24-31` 注释。

## 门禁输出(主流程真跑,2026-08-18)

```
npm run lint                     → 零输出通过
npm run build                    → tsc 零错误 + scripts 拷贝
npm test                         → 5722 passed | 35 skipped(374 files)
STRICT=1 npm run check:rules-sync → OK: 9 个模板双向对账一致
npm run build-matrix             → 43 tools (v0.32.1)
npm run diff-matrix              → no drift
npm run check:budget             → 3 warning(s), 0 error(3 warn 为既有)
npm run version-check            → ✓ 版本元数据一致 (0.32.1)
集成(真跑 Godot 4.6.3)           → 7 passed(65.7s,终审本机复验 65.7s)
```
