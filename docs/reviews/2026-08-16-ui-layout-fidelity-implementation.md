# 实施审查:布局保真闭环(2026-08-16)

- 分支:`feat/ui-layout-fidelity`(c0c8ed1..0c699e1,9 commits,版本 0.30.0→0.30.3)
- 流程:subagent-driven-development——6 任务各自"实现者→任务审查者"两裁定,最后整分支终审 + 修复波 + 复核
- spec:`docs/superpowers/specs/2026-08-16-ui-layout-fidelity-design.md`(v2);plan:`docs/superpowers/plans/2026-08-16-ui-layout-fidelity.md`
- **最终判定:Ready to merge: Yes**(终审复核 @0c699e1)

## 交付面

| 能力 | 入口 | 要点 |
|------|------|------|
| justify space-* 真实现 | `ui_build_layout` | `_spacer_N` 注入(between=N-1/evenly=N+1/around=2N×0.5),集成数值断言 |
| rect 绝对几何 | `ui_build_layout` tree | 相对父 rect;按**父尺寸**求解比例 anchors+offsets(snap 0/0.5/1);父 Container 时 TS warning+运行时跳过;`viewport` 参数(默认 1280×720) |
| 整树测量 | `ui_measure_layout`(新 action) | full-class SceneTree 脚本等帧稳定(连续 2 帧,上限 5)输出 computed rect/anchors/offsets/text;输出含 `viewport` 与 `stalled` |
| 布局校验 | `ui_measure_layout` `expect_tree` | `layout_verify`:逐节点 diff(父相对坐标,容差 2px)/同父重叠/越界 |
| 持久化 | `ui_build_layout` `persist` | pack→tmp→rename 原子写(scene-commit F-2 模式);persist 前游离 owner 归一 |

新增文件:`src/tools/ui/anchor-solver.ts`、`src/tools/ui/layout-diff.ts`、`src/tools/ui/ui-measure.ts`;测试:`test/ui-layout.test.ts`、`test/ui-anchor-solver.test.ts`、`test/ui-layout-diff.test.ts`、`test/ui-measure.test.ts`、`test/integration/ui-layout-integration.test.ts`。

## 任务审查结论(全部 Spec ✅ / Approved)

T1 justify(798aa0b)、T2 rect+求解器(2c74c3d+d6d4b40,守卫时序缺陷已修)、T3 measure(dcc62fa,含登记联动)、T4 diff(9c9aad8)、T5 persist(b5ab366,发现游离期 owner 被拒致 pack 丢子树并修复)、T6 登记(0e19620,双副本 168 行逐字一致)。

## 终审(第一轮):No

- **C1(修)**:rect 嵌套语义不成立——求解恒用 viewport 而非父 rect、diff 父相对 target 与 global measured 直接相减错位、viewport 未暴露、rect 运行时行为零集成覆盖。
- **I1(修)**:wrap/grid+space-* 双 warning 语义矛盾。
- 13 条累积 Minor 逐条 triage:1 条=I1 修,1 条并入 C1,4 条可不修,7 条留后续(详见 `.superpowers/sdd/progress.md` 台账)。

## 修复波(4acfdb3 + 0c699e1)与复核

- 生成侧递归传 `parentSize`(父 rect.w/h;无 rect 父降级 viewport+warning);`viewport` 参数暴露(缺项/NaN/非正→INVALID_PARAMS);diff 改**父相对坐标**比较(actual=子global−父global,根级对视口原点,父缺失 NaN);measure 输出增 `viewport`(`root.content_scale_size`——headless --script 下 Window.size 不反映 project 设置,实测裁定)与 `stalled`。
- **验收 1 集成证据(真跑 Godot 4.7.1)**:Panel rect(100,50,600,400)+Button rect(50,30)→Button global=(150,80)、anchor_left≈50/600,容差 2px 通过。
- 复核:三处裁量(content_scale_size/fixture 根固定 offsets/容器父豁免 unknown warning)均判合理;diff 新语义与规则双副本逐字自洽;最终判定 **Yes**。

## 验证汇总(实施者报告+门禁)

单测 53/53(4 文件)+ 全量 `npm test` 5423 passed 0 failed + 集成 7/7(显式 `GODOT_PATH` 真跑)+ lint 0 + build 0 + build-matrix 43 tools v0.30.3 no-drift + check:budget 0 error + check-rules-version-bump 通过 + 规则双副本归一化 diff 一致。

## 遗留(后续批次,不阻塞)

1. 非 wrap/grid 时 validate/gen 两层注入 warning 冗余(语义一致非矛盾);
2. headless 根级 rect 精度依赖挂载父=viewport 边界(fixture 注释留痕);
3. 属性测试对 anchor 乘性误差无鉴别力(单测精确值+集成数值兜底);
4. CI(Linux)集成恒 skip——PR 附本机跑通证据;
5. check:budget 超 warn 阈值 ~3.5%(历史遗留为主);
6. 8 个历史 rules drift 文件(既有债)。
