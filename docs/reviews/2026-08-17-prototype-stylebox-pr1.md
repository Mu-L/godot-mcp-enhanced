# PR-1 StyleBox 通道 终审归档(2026-08-17)

> 分支 `feat/prototype-stylebox-loop-spec`,基线 `d1c0275`(master),12 commits(`28c6bfe..d3281d8`)。
> spec:`docs/superpowers/specs/2026-08-17-prototype-stylebox-loop-design.md`(v4);plan:`docs/superpowers/plans/2026-08-17-prototype-stylebox-pr1.md`。
> 流程:每任务独立实现者+审查者(SDD),关键修复三处(draw_center 注入 8f65d87 / 生成器落盘 API 54a6e20 / 规则 7 无条件预警 c4f543d),全分支终审 MERGE READY(无 Critical/Important)。

## 总判定:SHIPPED(MERGE READY)

- 门禁:lint 0 / build 0 / test 374 文件 5680 passed+35 skipped(含 Godot 4.7.1 win64 集成)/ `STRICT=1 check:rules-sync` 9 模板一致 / budget 0 error。
- 版本:0.31.4 → **0.32.0**(minor,BREAKING:bg 语义从 modulate 近似改为 StyleBoxFlat;十处元数据同步)。

## 交付摘要

proto JSON 三新字段(`fill`/`borderRadius`/`border`)与 `bg` 语义升级,翻译为真正的 StyleBoxFlat,经 `add_theme_stylebox_override` API 落盘;四控件槽位(Panel→`panel`、ProgressBar→`background`+`fill`、Button/Label→`normal`);`UiNodeSpec.styleboxes`(七值 slot 白名单 + draw_center 注入防线)开放给 `ui_build_layout` 手写树;evaluate 模板 toRgba(保留 alpha)+ 三件套采集;规则双副本 9+ 段同步;规则 7 无条件预警。

| Task | Commit | 审查 |
|------|--------|------|
| 1 类型层(slot 白名单/StyleBoxFlatSpec) | `dc4f75b` | ✅(Minor: tree schema → 已由 d3281d8 消解) |
| 2 翻译层(zod/槽位映射/规则 9 重写/规则 7) | `2e4286c` | ✅(偏离 2 处核实正确:ProtoColor zod 收紧等价前移、空 box 不产主槽) |
| 3 生成器 `_sb_N` 构造块 | `629aa2d` + `8f65d87` | ✅(I-1 draw_center 注入→修复后复核消解;裁决:专属 1-based 计数器替代共享 nextId,唯一性经机制达成) |
| 4 集成(fixture 升级/css-card/Label 槽实测/三组合) | `54a6e20` + `c4f543d` | ✅(重大实测发现见下;规则 7 恢复无条件预警) |
| 5 双副本 + 0.32.0 | `b49f528`(+spec v4 `11d2f6c`) | ✅(7 段逐字独立抽查一致;扩围 A 类 5 文件合法) |
| 6 收尾(descHint/matrix/tree schema) | `d3281d8` | ✅ |

## 实现期实测修订(v4,核心工程发现)

单测/生成快照全绿、真跑 Godot 才暴露的三连(v1-v3 spec 声明被推翻):

1. **override 属性名**:真名 `theme_override_styles/<slot>`(spec 误写 `theme_override_styleboxes/`;`src/tscn/tscn-parser.ts:316` 存量注释可佐证);
2. **落盘 API**:`node.set()` 该路径即使名字正确,`PackedScene.pack()` 也丢 override(A/B 实测)——唯一可靠路径 `add_theme_stylebox_override(slot, sb)`;
3. **钳制实测**(h=16,Godot 4.7.1 headless):无 override→27 / bg-only→23 / fill-only→27 / bg+fill→23,**全组合被钳**——「有 override 不预警」收窄被推翻,规则 7 恢复无条件预警,四组合数据写入 warning 文案/规则双副本/集成断言五层。

教训:首跑固化的 dh=+11×3 系 set() bug 期无效数据——**集成验收(真引擎 spawn)不可被生成快照替代**,PR-2(style_verify 读回)/PR-4(单进程 reload)同理。

## Minor triage(7 项跨任务累积)

已消解:tree schema 描述(d3281d8)、fill-only 抑制预警(c4f543d 无条件化)、存量注释措辞(d3281d8)。
留档合理:显式 Panel+fill-only 丢灰底 warning(错误语义输入,PR-2 style_verify 自然暴露)、报告计数过程文档、actualH 断言 Math.round(可选加固)、参数遮蔽/模块级计数器(纯同步拼接无交错)。

## 转 PR-2 顺手处理(2 项)

- M-1:border 四边不同时「取 top + warning」降级为被动声明(strictObject 拒额外字段致 warning 通道受阻)——PR-2 spec 登记显式降级或补通道;
- M-2:validate 层补 `bg_color`/`border_color` 四元 number 数组对称校验(无注入向量,仅错误时机后移;提升 INVALID_PARAMS 早拒质量)。

## 验证方式声明

门禁四连输出关键行见 `.superpowers/sdd/task-6-report.md`;各任务审查均含 diff 级独立核对(不重跑已验测试,采信实现者报告 + 源码静态复核);本归档数字(12 commits/5680/0.32.0/27-23-27-23)经 git log / 测试报告 / grep 交叉核实。
