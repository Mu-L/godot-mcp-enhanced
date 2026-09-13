# 2026-09-01 竞品启发加固批审查报告(competitor-inspired-hardening)

> 审查对象:分支 `feat/competitor-inspired-hardening`,commit 范围 e9f41f2..HEAD(6 commits:2125a67 / 661f088 / f252597 / 932ddea / 审查处置 commit)。
> 审查者:code-reviewer 子代理(隔离视角,静态实测;实现者声明的运行时验证由实现者在主会话实跑并贴出)。
> 背景:源自 `D:\GitHub\_notes\2026-09-01-竞品与头部仓库更新跟踪.md` 复审后提炼的三方向——①satelliteoflove 输出可解释性攻势对标;②godot-ai GODOT_BIN 目录拒绝;③官方 servers 原子写对齐。复核修正了报告原判断:profiler 窗口自述已达标无需改、undo/batch/validate 三能力 enhanced 均有对应物、bridge UTF-8 实现已免疫(仅固化)。

## 总体判定:SHIPPED WITH NITS

无 Blocking Issue。1 项 Important(CHANGELOG 漏登,已处置)+ 4 Nits(2 已处置、2 挂账)。

## 逐维度结论(审查者实测证据摘要)

### 1. 设计正确性 — 通过

- `_monitor_summary` 类型判断:GDScript 4 的 Variant `is` 是精确类型匹配,`true is int` 为 false → bool 属性正确跳过;`elif` 分支在 `v < min` 时跳过 max 检查数学安全(`v < min ≤ max` 蕴含 `v > max` 不可能);同值极值首现承诺成立(`src/scripts/mcp_bridge.gd:1979-1993`)。
- `properties` 语义变化(原始→filtered)消费方全查无破坏:game-bridge.ts:610-612 转发原始请求参数;断线重发链 `src/core/bridge-client.ts:197-200` 登记请求 params 浅拷贝;qa/runner.ts:597-604 只判成败。全仓 grep `dropped_blocked|min_at_frame` 在 src/ 仅命中工具描述文本。
- finder 目录 throw 行为变化安全:全测试目录无既有用例依赖"目录→静默 fallback";src 侧 40+ `findGodot()` 调用方均为"取路径或抛错"语义;错误消息 PII-safe。
- fs-atomic 委托后 json-config 消费链语义变化(rename 失败:抛→Windows 降级直写)在 `src/cli/clients/json-config.ts:172-177` 诚实披露,与 project.ts I-1 先例一致。

### 2. TS-GD 一致性 — 通过

- 契约测试 12 锚点全部实测定位;push 模式不带 summary 是合理取舍(单帧推送无累计语义,热路径开销;工具描述承诺的是 stop/poll,文档与实现自洽)。

### 3. 测试质量 — 通过

- 契约测试正/负双向锚点(回退谎报写法必红);fs-atomic 单测平台切换可靠、直接断言调用序列(删实现必红);回归谓词更新自洽(四要素:core 实现+mode 保持+re-export 链+adapter 调用计数)。

### 4. 部署同步/仓库级约束(独立核查)— 通过

- build/scripts/mcp_bridge.gd 与源逐行对齐、build/core/fs-atomic.js 存在(build 已跑实证);mcp_bridge.gd 全仓单副本(分发走运行时拷贝,不涉三副本);双副本约束未触发(未改 rule-templates.ts/.claude/rules,不 bump,符合"默认不发版"定规);capability-matrix 从源生成且版本一致;分层门禁合规(fs-atomic 仅 import fs/path/crypto/logger)。

### 5. 验证完整性

- 实现者主会话实跑:lint 0 错 / build 0 TS 错 / npm test **6165 passed 0 failed** / check:gdscript errors=0 warnings=0 / check:budget 0 error / check:command-docs-drift 0 未映射 / headless 真跑摘要算法 7/7 PASS。
- 审查者静态核查无反证(其环境无命令执行工具,已声明)。

## Issues 处置

| # | 级别 | 内容 | 处置 |
|---|------|------|------|
| I-1 | Important | CHANGELOG [Unreleased] 漏登本批 3 个 feat(违反 2026-08-19"默认不发版"定规) | ✅ 已补登三条(根因-改动-验证),check:changelog-sync ✓ |
| N-1 | Nit | fs-atomic 头注释"必须走本函数"与存量未收口点(scene-instance/translation-ops/game-bridge/overrides 自写 tmp+rename)自相矛盾 | ✅ 措辞改"逐步迁移中,新增写点必须走";存量收口挂账后续批次 |
| N-2 | Nit | 契约测试缺 -7 全过滤分支用例 | ✅ 补 M-b2(13/13 绿) |
| N-3 | Nit | bridge 规则文档两副本(rule-templates.ts ↔ .claude/rules/godot-mcp-bridge.md)monitor 行未提 dropped_blocked/summary——两副本一致故 CI 不红,但分发文档滞后 | 🟡 挂账:**同步 rule-templates.ts 会触发 check-rules-version-bump 硬门禁(需 bump 0.32.12 + version-sync + CHANGELOG 定版 + README 版本行,按 N-C 条款)**,是否走版本链待用户裁决 |
| N-4 | Nit | 非 GODOT_PATH 来源的目录候选仅 warn 落日志,tried 列表(死代码)不进最终错误消息 | 🟡 挂账:tried 死代码清理留后续批次 |

## 值得进 memory 的工程教训(审查者提炼)

1. GD 行为难测时的契约测试范式第二次成型:源码字符串锚点+区间切片+正/负双向断言,锚点缺失即红,天然防"接线零验证";结构缺口由 check:gdscript 兜住。U 组"固化性质而非实现"(禁止对整个缓冲 raw 先解码)是好样本。
2. 共享原语上移低风险三步法:实现上移(并集语义)→ 旧位置薄委托/re-export 保签名 → 委托处注释显式披露语义差异,13 消费方零改动。

## 分支状态(2026-09-02 挂账清偿后终态)

- **8 commits 未 push**,待用户决定 push/PR(建议 PR 标题:`feat: 竞品启发加固批——monitor 可解释性/GODOT_PATH 目录报错/原子写收口(0.32.12)`)。
- 挂账清偿(用户批准"2,3"后执行):
  - ✅ **N-3**(38ee293+57bf513):双副本规则文件 monitor 行同步新字段(dropped_blocked/summary/max_samples,含示例对齐真实产出),触发版本硬门禁按 N-C 条款走完整版本链 **0.32.11→0.32.12**(version-sync A 类 manifest/plugin.cfg/server.json/Dockerfile + build-matrix + gen:tool-docs + CHANGELOG 定版 + README 版本行;npm publish/tag 仍待用户)。STRICT=1 check:rules-sync 9 模板双向一致 ✓。
  - ✅ **N-1**(38ee293):fs-atomic 存量七处收口(scene-instance detach 写 .tscn/translation-ops project.godot+CSV/game-bridge install+uninstall/overrides 三处)——覆盖用户资产的自写 tmp+rename 清零;定向 139/139。
  - ✅ **N-4**(38ee293):godot-finder tried 死代码清除(22 处 push 从不消费,签名+声明全删,行为零变化)。
- 全量门禁终态:lint 0 错 / build 0 TS 错 / npm test **6166 passed 0 failed** / version-check ✓ 0.32.12 / rules-version-bump 门禁 ✓。
