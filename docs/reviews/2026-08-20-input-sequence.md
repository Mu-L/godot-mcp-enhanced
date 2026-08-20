# H1 批次(send_input_sequence 帧定时输入时间线)第三方审查

- **日期**:2026-08-20
- **审查者**:code-reviewer 子代理(独立上下文,不预设实现声明为真)
- **对象**:分支 `feat/deterministic-input-timeline` commit 2(feat(bridge) send_input_sequence)
- **判定**:**SHIPPED WITH NITS** → I-1/N-1/N-2 已修 → **SHIPPED**
- **方式声明**:审查环境无 Bash,`vitest`/`check:rules-sync`/`build-matrix`/e2e 未复跑(主会话已全量复跑补齐,见文末);结论基于逐行 Read+Grep 实测,静态证据带 file:line。

## 审查结论摘要(六维)

| 维度 | 结论 |
|---|---|
| 设计正确性 | 通过——延迟通道与 step_until 逐点对称(哨兵三件套/pending/轮询/refreeze);帧计数语义(`at_frame=N`=开窗后第 N 帧,登记帧不计数)与注释一致;`frames_budget = max_at+settle+1` 严格大于任何合法 at_frame 保证全注入;wall_timeout 如实上报;两 pending 数组并发交互的 paused 还原互查逻辑正确;`_control_paused_saved_valid` 不变量在所有路径保持 |
| TS-GD 一致性 | 通过——timeout 特判两处与 GD clamp 50s 逐档验算安全(默认 30000→TS 40000;超界 60000→GD 50000/TS 60000;非法入参 fallback 一致);INPUT_METHODS 7 法与 GD dispatch/`_INPUT_SEQ_TYPES` 六类对齐;事件字段与 `_cmd_send_*` 读取字段逐一对齐 |
| 测试质量 | 通过——断言强度核验(删守卫必红):e2e 负向三连锚定 GD 预检行;主用例行为级(probe first_seen_frame/action_pressed/frames_run/refrozen);契约计数断言强(owner 互斥恰 4 处/clear 恰 2 处/`_INPUT_SEQ_*` 逐字) |
| 仓库级约束 | 通过——双副本新增行逐字一致(仅转义差);生成物三处(matrix/tools/game.md/build)与源逐字一致;gdscript-check fixture 副本同步(12/12 锚点);D-2g 契约 1→2 为精确 `toBe(2)`,实测全文件恰 2 处开窗点,未来第三处硬设 false 仍会红(**不掩盖回归**);版本链 0.32.8 完整(README.en 无版本表系既有惯例) |
| 验证完整性 | 静态替代(未复跑)——静态比对均吻合;e2e 采信未复验 |
| 安全面 | 通过——timeline 纯结构化校验无 Expression/eval 面;owner 互斥第 4 处入口即查;auth 前置;mouse 子参数无预检系继承既有行为非新增面 |

## Important

**I-1:qa input 步骤对 send_input_sequence 的 wall_timeout 假绿**(置信度 85)→ **已修**
- 位置:`src/tools/qa/runner.ts` input case(修复前 :402-404)
- 根因:GD 侧延迟响应由 `_process` 直推,**不走 `_handle_message` 的 error promote**——wall_timeout 截断时顶层无 JSON-RPC error,只有 result 层 `success:false`。runner 只查 `resp.error`(顶层)→ 截断报 PASSED,诊断字段全丢。
- 修复:显式判 `seqResult.success === false` 返 FAILED(带 wall_timeout/applied_count/total_events/frames_elapsed)+ detail 改 `condense(resp.result)` 暴露诊断;加契约断言 `seqResult.success === false` 锁定。
- **教训(step_until 为何无此问题)**:其 GD 响应 `success` 恒 true(语义推给 `predicate_met`)——新增延迟通道必须同步定义"TS 侧如何判定软失败"。

## Nits

- **N-1 schema 描述范围不完备**(settle/wall/事件数未标范围)→ **已修**(补 `0-600`/`1000-50000`/`≤256`,同步压缩 timeout 描述抵消字节,budget 维持 5 warn 0 error)
- **N-2 还原条件 `includes` 对相同字符串只锁任一**(:317/:378 两处字符串互含,删 input_seq 侧不红)→ **已修**(新增计数断言 `match(/_control_input_seq_pending\.is_empty\(\) and not _control_frozen/g).length === 2`)
- **N-3 e2e 无 wall_timeout 正向场景**(time_scale=0 饿死触发截断)→ 留后续(该分支有 GD 实现+文本契约锁定)
- **N-4 超时公式两套并存**(step_until 走 computePlaytestTimeoutMs wall+5s/上界 65000,input_sequence 内联 wall+10s/上界 60000;各档位数学安全)→ 留后续收敛

## 修复后主会话复验(审查未跑部分补齐)

- `npm run lint` 0 错;`npm run build`/`build-matrix`/`gen:tool-docs` 重建 ✓
- 定向 104/104(`game-bridge-input-sequence` 18 + `g1-playtest-control-contract` 22 + `qa-runner` 64)
- 全量 `npm test`:**5999 passed / 0 failed** / 40 skipped
- `check:budget` 5 warn 0 error;`check:gdscript` errors=0 warnings=0(此前已跑)
- e2e 真机 5/5(I-1 修复不触 bridge 路径,无需重跑;qa-runner 行为由 64 用例套件回归)

## 值得进 memory 的工程教训

1. **延迟通道响应的 success 语义断层**:`_process` 直推的延迟响应不走 error promote,result 层 `success:false` 是 TS 侧不可见的"软失败"——自动判定引擎(qa runner)必须显式查 result.success,只查顶层 error 会假绿(file:line `src/tools/qa/runner.ts` input case + `src/scripts/mcp_bridge.gd` isq_result 段)。
2. **`includes` 契约对重复字符串的盲区**:预期出现 N 次的模式应计数断言(D-2g `toBe(2)` 正面示范),对称分支误删才不会静默绿。
