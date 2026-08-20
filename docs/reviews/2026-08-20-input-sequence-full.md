# H1 分支完整第三方审查(4 commits,push 前终审)

- **日期**:2026-08-20
- **审查者**:general-purpose 子代理(有 Bash,可复跑验证;补上轮 code-reviewer 无 Bash 的复验缺口)
- **对象**:`feat/deterministic-input-timeline` 全部 4 commits(7f6fa56/bb9de80/f60ed75/1d63a41)vs master
- **方式**:逐行读码 + 全部验证命令真机复跑 + 2 组删守卫红测实验(sed 删守卫→定向测试确认变红→恢复)
- **判定**:**SHIPPED WITH NITS**(1 Important 低危 + 3 Nits,无阻断)

## 六维结论

| 维度 | 结论 |
|---|---|
| A 上轮处置复核 | **通过,无虚报**——I-1/N-1~N-4 逐条实测落地;I-1 与 N-2 各做删守卫红测实验确认断言真锁行为 |
| B N-4 收敛回归检查 | **通过**——即时方法与 master 逐字等价(`git show master` 对照证明);qa 侧等价经 schema max(60000) 上界保证;延迟族恰 3 method 无误入漏出;GD 并发交互(清理三路/双开窗还原/S-V 不变量/PROCESS_MODE_ALWAYS)对称 |
| C 追加批新面 | 通过——resolveOpsScript npm 态经 `npm pack --dry-run` 实证(622 files 含 build/scripts/*.gd);grep 全 cli 目录无同款路径 bug;demo spec 逐字段对照 schema 一致且复现命令真机跑通;fixture 入库干净(3 文件,[autoload] 仅注释) |
| D 动态复验 | **全绿**——lint 0/build ✓/定向 111/111/全量 5999 passed 0 failed/e2e 6/6 真机/demo 复跑 PASSED 5/5/budget 5 warn 0 error/drift ✓/tool-count ✓/version-check ✓/rules-sync STRICT ✓/rules-version-bump ✓(0.32.7→0.32.8 随 bb9de80 落地实证) |
| E 研究报告抽查 | 通过——45 工具/45 处 create_action×8 文件复跑核查命令吻合;README「三层齐备」承诺逐级验证(L2 send_input_sequence/L3 seed 真调 seed() 均在 dispatch 表注册,非纸面) |
| F 安全面 | 通过——timeline 纯结构化校验无 Expression 面;owner 互斥入口即查;auth 前置(per-peer lockout);resolveOpsScript 静态拼接无注入面;**无新增攻击面** |

## 问题清单与处置

- **IMP-1(Important 低危)CLI qa run 残留 fixture [autoload] 段**:既有缺陷(e2e 路径有 afterAll 快照还原,CLI 路径无),demo 文档首次把该路径作为推荐命令放大暴露面。**处置:文档修复**——demo 加「跑后 git checkout 恢复 fixture」提示。不采用代码侧 teardown 自动还原:对真实用户项目 autoload 留存是有意设计(下次 run 幂等复用),且无法区分「qa 装的」vs「用户自装的」bridge,自动还原会误删用户配置。
- **N-A CHANGELOG/README 写 e2e 5 用例(实际 6)**:已改 6(且 16 单测→18 同步修正)。
- **N-B NVIDIA Corporation/ 驱动日志目录未忽略**:gitignore 已加条目。
- **N-C 规则结构性冲突(治理项,留用户裁决)**:AGENTS.md「默认不发版不 bump」vs check-rules-version-bump 硬门禁「模板变更必须 bump」。本批沿用 0.32.7 先例(bump+CHANGELOG 定版+npm 待发),建议 AGENTS.md 补例外条款或门禁加参数。

## 工程教训(进 memory)

1. **红测实验是审查处置的最低标准**:删守卫→测试红→恢复,2 分钟成本,是验证「断言真锁行为」的唯一可靠手段;文本契约+行为级 e2e 两层叠加才完整。
2. **CLI 路径与测试路径的清理不对称是 demo 类文档的隐形暴露面**:凡「推荐用户跑的命令」都应审其运行时足迹(IMP-1 即由此发现)。
