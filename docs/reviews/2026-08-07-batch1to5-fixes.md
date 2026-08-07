# 2026-08-07 批次1-5 修复第三方审查

> **审查对象**:`fix/batch5-docs-cleanup` 分支 5 个 commit(50ec7d5 / 2519099 / aeb0b96 / 23599f8 / 10e91c6)
> **基线**:master `e0dc692`(fix/review-nits 第三方审查 NIT 修复)
> **审查者**:独立 code-reviewer agent(无 Bash 工具,所有结论 Read/Grep 实测)
> **审查日期**:2026-08-07
> **总体判定**:**BLOCKING ISSUES → 修复后 SHIPPED WITH NITS**

## 初审判定:BLOCKING ISSUES

5 批 26 项新代码修复设计正确、核心逻辑实测无误。但发现 1 BLOCKING(部署同步漏改致 CI 必挂)+ 2 Important(门控修复无测试守护 + 独立副本 drift 扩大)+ 5 Nit。

### Blocking Issues

#### B-1 — README.md 版本表缺 v0.25.8 行,CI version-check 必挂(置信度 95)

- **位置**:`README.md:636`
- **实测**:`README.md:636` 第一行 `| **v0.25.7** |`,无 v0.25.8 行;`version-sync.mjs:34` `CHECK_ONLY=['changelog','readme']`;`:82` readme 正则匹配第一行读到 0.25.7;`:187` 不一致 exit 1;`ci.yml:47` `Check version metadata consistency` 必跑门禁
- **根因**:version bump 时 A 类 5 文件由 version-sync 自动写入,B 类 CHANGELOG 作者手动补了,但 B 类 README 版本表漏补。`version-sync.test.ts` 用自造 fixture 测脚本逻辑不读真实仓库,本地 `npm test` 绿 ≠ CI `version-check` 通过
- **影响**:推送此分支到 CI 会确定性在 `Check version metadata consistency` 步骤 exit 1

### Important Issues

#### I-1 — rule-templates.ts 新增 launch_editor 段未同步 .claude/rules(置信度 85)

- **位置**:`rule-templates.ts:335`(有 launch_editor 崩溃恢复段) vs `.claude/rules/godot-mcp-editor.md:93-94`(缺失该段)
- **违反**:AGENTS.md「独立副本同步约束」"改动规则时必须手动同步两处"。源于 2026-07-27 get_node_layout PR 教训,本次重蹈覆辙

#### I-2 — update-checker 门控语义修复无单元测试守护(置信度 85)

- **位置**:`update-checker.ts:84` `/^(false|0|no|off)$/i`
- **实测**:`update-checker.test.ts` 14 个 case 无任何门控语义测试。若改回 `=== 'false'` 或漏 `i` flag,测试不会变红

### Nits(5 项)

| # | 问题 | 建议 |
|---|------|------|
| N-1 | recording MAX_ZERO_DELAY 修复无回归测试 | 补静态 grep 守护或注释明示依赖人工 review |
| N-2 | check:rules-sync / check:protocol-versions 注册 package.json 但**未在 ci.yml 接线** | ci.yml 加 check:protocol-versions(阻断) + check:rules-sync(advisory continue-on-error) |
| N-3 | CHANGELOG.md:15 "4 项 deferred" 未展开清单 | 子条目列 4 项具体内容 |
| N-4 | update-checker.ts:81 注释"对齐 feature-flags 标准化逻辑"措辞夸大 | 改为"借鉴标准化方向,识别 falsy 变体" |
| N-5 | _sanitize_scene_path 3 份独立副本无 defects.ts detect 兜底 | 参照 BLOCKED_PROPERTIES detect 模式补守护 |

## 修复落地(本轮审查后)

### B-1 修复(本审查周期内)
- `README.md:636` 前插入 v0.25.8 行(5 批修复闭环描述)
- **验证**:`npm run version-check` ✓ 版本元数据一致 (0.25.8)(从 exit 1 变 exit 0)

### I-1 修复(本审查周期内)
- `.claude/rules/godot-mcp-editor.md:93` 后补 launch_editor 崩溃恢复段(对齐 rule-templates.ts:335-338)
- **验证**:`check-rules-content-sync` editor.md drift 内容变化(launch_editor 段已同步,剩余 drift 是历史遗留 S4-editor 等段)

### I-2 修复(本审查周期内)
- `update-checker.test.ts` 加 describe 块覆盖门控语义:
  - 8 种关闭值(false/0/no/off/False/FALSE/Off/NO)→ 关闭外传不查网(15 个 it.each case)
  - force:true 绕门控(self_update 主动查询)
  - 6 种非关闭值(true/1/yes/on/空/random)→ 正常查网
- **验证**:`npx vitest run test/update-checker.test.ts` 29/29 passed(原 14 + 新 15)

### N-2 修复(本审查周期内)
- `ci.yml:49` 后加 check:protocol-versions(阻断) + check:rules-sync(continue-on-error advisory)

### N-3 修复(本审查周期内)
- `CHANGELOG.md:15` "4 项 deferred" 展开为子条目明细

### N-1 / N-4 / N-5 未改(留 follow-up)
- N-1:recording MAX_ZERO_DELAY 修复无回归测试——补静态 grep 守护留 follow-up(当前靠人工 review)
- N-4:注释措辞夸大——非功能问题,留 follow-up
- N-5:_sanitize_scene_path 3 份副本无 detect——参照 BLOCKED_PROPERTIES detect 模式留 follow-up

## 设计正确性核实(初审逐项结论)

所有 26 项新代码修复**设计正确、实现无误**:

| 项 | 结论 | 关键证据 |
|----|------|---------|
| save_scene/load_sprite quit(1) | ✅ 真改 | godot_operations.gd:601-603 / :730-734,注释诚实标注 P1 修复 + 对照 create_scene |
| _cmd_playtest_restore Resource 反向转换 | ✅ 逻辑正确 | mcp_bridge.gd:1768-1780:占位识别 + 空 path 跳过 + load 失败跳过 + Node 引用跳过 |
| MAX_ZERO_DELAY 回退 index | ✅ 无 off-by-one | recording_commands.gd:178-187:撤销自增让 timer timeout 正常 fire |
| resetBridgeState 清 push 子系统 | ✅ 真改 | game-bridge.ts:953 _invalidateSocket() + :954 _pushMessageHandler=null |
| STARTUP_CLEANUP.finally 时序 | ✅ 正确 | GodotServer.ts:448-455:L449 存 prevFullScan、L450 设 'true'、L451 .finally 恢复 |
| health-monitor degraded 不卡死 | ✅ 双向正确 | health-monitor.ts:328-333:reconnecting→connected / degraded→evaluateState |
| playtest owner_pid 多 peer | ✅ 守卫到位 | mcp_bridge.gd:1535 `if pid == _playtest_owner_pid`;还原后清 -1 |
| FileAccess READ 拦截 | ✅ 不误报内部脚本 | gdscript-executor.ts:65 正则;内部模板不经扫描 |
| 网络回连 API 完整 | ✅ 覆盖全 | gdscript-executor.ts:104-107;不误报 StreamPeerBuffer |
| stripLiterals 扩 GODOT_PROTOCOLS | ✅ 不破坏 res:// | gdscript-executor.ts:290 数组 + 305-311/333-339 遍历 |
| P3-6 socket 竞态测试 | ✅ 真守护 | game-bridge.test.ts:274-316 双向断言 |
| C# 回滚测试 | ✅ 真守护 | script-csharp.test.ts:212-251 文件回滚断言 |
| update-checker 门控 | ✅ 行为正确 | update-checker.ts:84 正则(I-2 已补测试) |

## 值得进 memory 的工程教训

1. **version-sync --check 是 CI 必跑门禁,B 类 README/CHANGELOG 需人工同步**:`npm run version-sync` 只写 A 类,B 类仅校验。version bump 时易"心智上以为 version-sync 全包了"漏改 README。核查必须跑 `npm run version-check` 而非只看 `npm test` 绿——version-sync.test.ts 用自造 fixture 不读真实仓库。memory 候选:`version-sync-class-B-manual-sync-ci-blindspot`
2. **"独立副本同步约束"是易踩反复踩的坑(2 次重蹈)**:2026-07-27 get_node_layout PR + 2026-08-07 launch_editor 段两次漏同步。check-rules-content-sync advisory 只让 drift 可见不消除。根治:应改为 codegen 单向生成关系。memory 候选:`independent-copy-sync-recurring-pitfall`
3. **"声称修复 X 但无测试守护 X"是诚实但有缺陷的模式**:update-checker 门控(I-2)、MAX_ZERO_DELAY(N-1)都属此类。修一次 → 用一次 → 半年后被人改回 → 测试不抓 → bug 复活。每个修复 commit 应同步补反向测试。memory 候选:`fix-without-test-short-half-life`
4. **"npm scripts 注册 ≠ CI 接线"**:批次4 称"4 个 CI 守门脚本",实际 2/4 未接 ci.yml。审查者不能信 commit message "CI 守门" 字样,必须 grep workflows 实测。memory 候选:`npm-script-registration-not-ci-wiring`

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初版,初审 BLOCKING ISSUES(B-1+I-1+I-2+5 NIT),B-1/I-1/I-2/N-2/N-3 本周期修复,N-1/N-4/N-5 留 follow-up |
