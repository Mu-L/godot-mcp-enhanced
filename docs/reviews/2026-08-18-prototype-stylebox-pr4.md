# PR-4 终审归档:原型翻译层单 spawn 合成(2026-08-18)

- **分支**:`feat/prototype-stylebox-pr4`(750dc8c..bb66ecb,6 commits:8344ddf plan / fb8a00b 模板 / fc18299 handler 切换 / 60c3e61 注释补丁 / d6ebdce 集成验收 / bb66ecb 双副本+0.32.4)
- **spec**:`docs/superpowers/specs/2026-08-17-prototype-stylebox-loop-design.md` §6(单进程优化)+ §7 PR-4 行 + §9 版本策略
- **plan**:`docs/superpowers/plans/2026-08-18-prototype-stylebox-pr4.md`(4 task,SDD 子代理执行,每 task 独立审查)
- **审查者**:fresh context code-reviewer(diff 包 138KB 全读+plan/spec 全读+源码实测,不预设前序声明为真)

## 总体判定:**SHIPPED WITH NITS**(0 Blocking / 0 Important / 5 Minor 全留档级)

## 核心交付

1. **单 spawn 合成**:`ui_import_prototype` 内部链 build→persist→reload→measure 由两次 Godot spawn(首版实测 ~6s)合成单 spawn——新独立模板 `src/tools/ui/ui-import-single.ts`(二轮审阅 N-2 拍板:不扩 ui-measure、不动共享 `_mcp_load_scene`);组装三段沿 buildThenMeasure 真跑先例(build 尾 `layout_built+_mcp_done` 替换为 `call_deferred("_measure_go")` + measure 核心截取剥离 `_initialize` + `_measure_go` 追加),三重锚点守卫生成期 fail fast。
2. **CACHE_MODE_IGNORE reload**(spec §6 B-1):`ResourceLoader.load(path, "", CACHE_MODE_IGNORE)` 绕过 ResourceCache——同进程裸 load 二载命中缓存旧实例 → verify 全红。
3. **篡改磁盘断言**(spec §6 验收):集成 2 例——换 Hacked 100x50 场景被 reload 测出(判定力经独立推演:裸 load 退化 → 拿到缓存 1280x720 原场景 → 100x50 断言必红);非场景资源篡改 → reload 失败错误内嵌「build 已持久化,可重跑 ui_measure_layout」恢复语义端到端验证。
4. **实测耗时**:RTS 23 节点一次调用 2935ms(vs 两次 spawn 基线 ~6s,降约 51%);绊线 `<10_000ms` 落位。
5. **双副本 M-1/M-2/M-7**(PR-3 终审留档顺手项):内缩公式 `max(0,·)` 下限 / `alpha<0.999` 窄界 / 未映射控件采样预期红——两文件 grep 实测逐字一致(仅 `\`` 转义差异),version 0.32.4(8 文件零残留)。

## spec §6 符合性(终审逐条)

| 条款 | 结论 |
|---|---|
| 合成顺序 load→建树→pack→tmp→rename→IGNORE reload→等帧稳定→measure→_mcp_done | ✅(ui-layout.ts:728-748 persistBlock / ui-import-single.ts:53-69) |
| 新独立模板,不扩 ui-measure | ✅(genStyleExpectInit 纯 refactor,模板串逐字一致) |
| 共享 `_mcp_load_scene` 零改动 | ✅(gdscript-templates.ts 不在 diff) |
| 篡改磁盘断言防 reload 假绿 | ✅(判定力成立,见上) |
| reload 阶段错误恢复语义 | ✅(模板内嵌:40/:57;TS 侧 hint-append 随第二次 spawn 删除) |
| capture 不并入 | ✅(ui_pixel_verify/screenshot.ts 零改动) |
| B-1 契约 persist 先于 measure | ✅ |

## 仓库级约束独立核查(AGENTS.md 强制项)

| 约束 | 核查方式 | 结论 |
|---|---|---|
| 双副本逐字一致 | grep 实测 3 处措辞两文件命中(M-1 `max(0, min` 各 1 / 旧 `alpha<1，` 各 0 / M-7 各 1) | ✅ |
| 版本链 0.32.4 | 8 文件 grep(package/lock×2/manifest/server×2/Dockerfile/使用指南/plugin.cfg/matrix.json),0.32.3 元数据零残留 | ✅ |
| check-rules-version-bump 前提 | rule-templates.ts 变更+package.json bump 同 commit | ✅ |
| capability-matrix 生成产物 | build-matrix 生成进 commit(仅版本行),md 无版本字段零变化自洽;diff-matrix no drift | ✅ |
| build/ 不在 diff;规约禁改项(screenshot.ts/spec §10.5/README 遗留债) | stat 清单确认 | ✅ |
| 八门禁 | lint 0 / build 0 / npm test 5766 passed 35 skipped / matrix 43 tools / no drift / budget 0err 3warn 既有 / STRICT 9 一致 / version-check 0.32.4 | ✅(按报告采信,关键数字与 diff 交叉自洽) |

## Minor 清单(triage,全留档不阻断)

| # | 项 | 判定 |
|---|---|---|
| M-1 | uiErrorMapper 谓词('not found'→NODE_NOT_FOUND)失去 handler 链直接断言(T2 brief 取舍;shared.test.js:84-91 属实但用自定义 mapper) | 留档,下次触碰该文件顺手补一行 error_code 断言 |
| M-2 | mock `buildOutputs()` 保留已死键 `layout_built`(真实合成脚本已不输出,handler 不消费) | 留档,mock shape 对齐候选 |
| M-3 | 集成新用例 1/2 的 `find(o=>o.key==='measure')!.` 无守卫(缺失时 TypeError 而非可读断言;失败仍红) | 留档,两行守卫顺手修候选 |
| M-4 | executor `timeout: 30` 未随单次双倍工作量调整(实测 2935ms 余量 ~10x) | 留档观察 |
| M-5 | CHANGELOG/README 0.32.4 段半角括号与全角标点混排 | 留档排版 nit |

另(终审新发现,留档):measureCore 剥离 regex 非贪婪,若未来 ui-measure 在 `_initialize` 与 `_on_measure_frame` 之间插新函数会被误剥——锚点契约注释已声明,集成真跑兜底。

## 工程教训(已登 memory)

1. **「截取拼装」型代码生成的守卫边界**:三重锚点守卫能抓「替换未命中」,抓不到「非贪婪 regex 误删两锚点间新增函数」——生成期守卫只覆盖已知失败模式,真跑集成分层兜底不可省。
2. **mock 契约随执行拓扑变更时死键不清理会累积 shape 偏差**:两段→一段合并时直接复用 buildOutputs() 最省事,但被淘汰的输出键留在 mock 里是「mock shape ≠ real bridge」教训的慢性起点。
3. **brief 行号区间圈定替换范围会漏区间外的语义同步点**(Task 2 :470 分发处「两次 executor」注释,审查抓到后修复):语义同步点应以 grep 关键词兜底,不能只信行号。

## 流程交付物

- 本审查文档(终审归档)
- memory:`feature-decision-log: stylebox-single-spawn-pr4` + 教训
- Obsidian 日志:`D:\workspace\Obsidian\GodotMCP\开发日志\2026-08-18 PR-4 单 spawn 合成.md`
- ledger 交接行(`.superpowers/sdd/progress.md`)
- Pre-push review(全新上下文)后 push + 开 PR(merge 留用户)
