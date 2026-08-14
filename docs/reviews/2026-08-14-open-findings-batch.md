# 2026-08-14 open findings 批次第三方审查(2026-08-11 审查 A/B 组 + follow-up 收尾)

- **分支**:`fix/open-findings-batch-20260814`(10 commits,未 push)
- **基线**:`refactor/p0-arch-cleanup` HEAD `790d074`
- **审查者**:code-reviewer 子 agent(独立上下文,不预设实现者声明为真;94 次工具调用逐条 grep/read 实测)
- **审查范围 commit**:`6d711ac`(A1)/`5159d43`(A6)/`ee1be38`(A3+A5)/`12a7dfc`(A2+A4)/`a3b9977`(B1+B2)/`8ce609d`(B3+B4+B5)/`eefe314`(C2+C3)/`9ae0766`(C5)/`222f329`(A7+CHANGELOG)/`87df529`(I-1 修复,审查后补)

## 总体判定:SHIPPED WITH NITS(审查时)→ I-1 已修复(SHIPPED)

9 个 commit 声明的 A1-A7 / B1-B5 / C2 / C3 / C5 修复**全部真实落地且设计正确**。审查发现 1 个 Important(测试资产副本)与 4 个 Nit,无 Blocking。Important 已在审查后修复(commit `87df529`)。

## 逐维度结论(审查原文要点)

### 设计正确性 — 通过

| Finding | 结论 | 证据 |
|---|---|---|
| A1 [P1] | 两道门均接反查;`_confirmExecute` 直接调 `_dispatchEditorOrHeadless` 不回 executeToolCall,**无二次确认死循环**;两个 vi.mock 工厂补 isDynamicToolName 导出 | `src/core/ToolDispatcher.ts:282-289`/`:419-425`/`:736-760`;`src/core/dynamic-risk-map.ts:16-93` |
| A2 [P1] | 互斥释放在 await 后无条件执行,先于 §10 peer 守卫;stale 时间比较方向正确 | `addons/godot_mcp_server/websocket_server.gd:396-411` |
| A3 [P2] | union 起底 + 追加 + 显式空串逃生口;TS 描述同步 | `engine_commands.gd:281-292`;`src/tools/engine.ts:36` |
| A4 [P2] | 三处接线 `resolve_session`,不再 active_sessions()[0];session 与 state 同源;无 session 分支保留原 note 响应形态 | `debug_commands.gd:245-263`/`:310-315`/`:363-369` |
| A5 [P2] | BLOCKLIST 补 3 方法 | `src/scripts/mcp_bridge.gd:98-104` |
| A6 [P2] | 双向时效校验正确;测试隔离安全 | `src/core/instance-api-auth.ts:147-148,194-228,243` |
| B1 [P1] | plugin.gd 无 `_debugger_bridge.free()`(grep 0 命中);dispose 覆盖 session+面板两来源;EditorDebuggerPlugin extends RefCounted 与 Godot 4.x 文档一致 | `plugin.gd:46-53`;`debugger_bridge.gd:103-122,441-454` |
| B2 [P2] | 去重协议推演正确(含混合序列) | `debugger_bridge.gd:130-170,457-466` |
| B3/B4/B5 | `%` 格式化语法正确;_jsonify 分支顺序 Resource→Node→Object 正确;added 计数分支互斥有守卫 | `instance_registry.gd:135,157-176`;`mcp_bridge.gd:1100-1109`;`node_commands.gd:319-327` |
| C5 | e2e 文件 `process.env.CI` 0 命中;xvfb-run 语法对齐既有范式 | `test/e2e-full-tool-verification.test.ts:836,894,953,1029` |

### TS-GD 一致性 — 通过

mjs/TS 双副本 METHOD_TO_TOOL 抽查逐条一致;契约测试全量比对 + GATED_ACTIONS 联动校验。game-bridge.ts BLOCKLIST 描述为开放式「等」,无精确清单漂移。

### 测试质量 — 通过

C2 的 4 处 error_code 断言与 scene-instance.ts 实际返回精确一致;全 test 目录弱断言 0 命中。C3 核实 project.ts/validation.ts 均不调 executeGdscript(实现者声明属实),7 个失败分支文案与源码逐一吻合。

### 部署同步 — Important I-1(已修复)

`test/fixtures/real-project/addons/` 第三份 GD 副本未同步本批改动,且该副本 gitignored + workflow 无拷贝步骤 → **CI 全新 checkout 上 hasProject 恒 false,editor-e2e 工作流静默全跳过(假绿数月)**——比审查报告初判的「滞后一版」更深。
**修复**(commit `87df529`):editor-e2e.yml 运行前从 `addons/` 主副本拷入 fixture(CI 永远测当前源,零滞后);本地副本已同步(`_debug_in_flight` 8 命中核实)。

### 仓库级约束 — 通过

`.claude/rules/` 无本批改动;rule-templates.ts 无 DENYLIST 副本(grep 0 命中,engine 描述改动无独立副本需同步);docs/capability-matrix + docs/tools 已同步(engine 新描述在 matrix `:1752`;audit.md 为 G3 工具补生成,HEAD matrix 本就 41 工具);defects baseline 60 经审查者实测 `^let _` 恰 60 处成立。

### 验证完整性

实现者全量验证声明:lint 0 / build ✓ / npm test **5149 passed 0 failed** / check:gdscript **errors=0 warnings=0**(Godot 4.6.3)/ check:budget 2 既有 warn 0 error / command-docs-drift 60 mapped 0 unmapped / changelog-sync ✓ / tool-count 41/230。审查者静态核对全部对齐(build 产物含新文件、fixture 自动拷贝机制核实);审查环境无执行工具未能复跑 vitest,如实声明。

## Nits(4,处置如下)

1. **A6 nonce 持久化多进程互覆**(instance-api-auth.ts:214-228):multi-instance 多进程共享文件 writeFileSync 全量覆盖,并发写互相丢弃。localhost 低频可接受——**接受现状**(纵深防御层弱化非失效)。
2. **B2 顺序假设无守护**(debugger_bridge.gd:457-466):去重协议隐含「capture 先于面板信号」;顺序颠倒仍翻倍。**留 editor 实测验证**(实现注释已标注,与 NIT-1 原计划一致)。
3. **A1 未映射动态工具 action-gate 层不命中**(仅 confirm 层 fail-closed):契约测试保证映射完整性,实际暴露面小——**接受现状**。
4. **C5 CI 层 L2 首跑 flaky 风险**:fixture 用 gl_compatibility(Mesa 软渲染可行)+ editor-e2e xvfb 先例 + bridge 内 Input API 不依赖 X11;风险点是 2 核软渲染 runner 上 120s/150s 超时偏紧。**首跑后视情况调参**(非设计错误)。

## 值得进 memory 的工程教训(已登)

1. 多副本审查要枚举**全部**副本位置(`test/fixtures/**/godot_mcp_server`),check:gdscript 自动拷贝机制的安全感遮蔽了第三份手动副本 + CI 缺拷贝步骤的假绿。
2. 「设了 env」≠「env 生效」(C5 根因):A 处设置 env、B 处消费 env 的组合,审查时强制沿链路走到最终消费点。
3. RefCounted 子类禁止手动 free(生命周期收尾 = 断开全部信号让引用归零)。

## 处置后的遗留

- B2 的 editor 实测验证(本地无 GUI editor 自动化条件,deferred)
- C5 的 L2 matrix 首跑观察(xvfb + 软渲染超时调参)
- A6 Nit-1 多进程 nonce 文件互覆(低频可接受,如需改 append+compaction 再做)
