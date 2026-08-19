# 第三方审查报告 — 2026-08-19 反馈批次(fix/feedback-batch-20260819)

> 审查者:code-reviewer 子代理(隔离视角,所有声明 grep/read 实测,TS-GD 一致性经 Godot 引擎源码独立验证)
> 审查对象:5 commit(`8c9cd34` fix(bridge) / `727543c` fix(runtime) / `418bb32` fix(scene) / `2d67f9a` docs / `59ad011` chore(matrix))+ 后续 Nit 修复 commit `1aef11b`
> 审查范围:设计正确性 / TS-GD 一致性 / 测试质量 / 部署同步 / 仓库级约束独立核查 / 验证完整性

## 总体判定:SHIPPED WITH NITS(无 Blocking Issues)

## 逐维度结论

### 1. 设计正确性 — 通过
- **端口探测/TOCTOU**(`src/scripts/mcp_bridge.gd:427-469`):connect 探测先于 listen(顺序经契约测试锁定),listen 失败(保留端口段)同样递增,env 起点 + clampi 防越界,区间 9081-9090 与 instance-manager 对齐。探测→listen 毫秒级 TOCTOU 残余窗口,代码注释诚实声明"缓解而非消除"(N-8,接受)。
- **resolveBridgePort**(`src/tools/game-bridge.ts:83-109`):capabilities 过滤 server 条目、损坏 JSON 容错、5min 超龄忽略、多实例取最新、全失败回落 9081——对旧版 GD 完全兼容。
- **内容比对守卫**:install/uninstall 读写失败走外层 catch;uninstall bundled 缺失分支方向激进(原判工具托管并删,N-5 已修为保守不删)。
- **uid 回填边界**(`src/scripts/godot_operations.gd:1045-1143`):save 前提取(rename 后原文件已替换,正确);已有 uid 不覆盖;非 .tscn 跳过;CRLF 由 strip_edges 兜底;回填失败不阻断 save(注释与实现一致)。
- **uninstall 误删面**:仅 `mcp_bridge_*.secret` 前后缀模式,editor key 与其他文件不受影响,测试锁定(other_cache.bin 保留断言)。

### 2. TS-GD 一致性 — 通过(引擎源码级独立验证)
- machine registry 路径:GD `OS.get_data_dir().get_base_dir().get_base_dir()` ↔ TS `~/.godot-mcp/instances`。**`OS.get_data_dir()` 是 OS 标准全局数据目录(Win %APPDATA% / Linux $XDG_DATA_HOME / macOS ~/Library/Application Support),不是 user:// 父目录**;三平台两次 base_dir 归一到 home,两侧一致。例外:XDG_DATA_HOME 显式设置时漂移(N-2,已加注释)。
- registry 字段:GD 写 8 字段,TS 读 4 字段(capabilities/projectPath/port/lastSeen)逐一匹配;lastSeen 本地时间无时区串 ↔ JS Date.parse 本地解析同机一致(测试专门防 toISOString UTC 陷阱)。
- secret 文件名:`mcp_bridge_%d.secret` 两侧一致,全链路(secret 路径/连接/探测)均走 resolveBridgePort。

### 3. 测试质量 — 通过
- 逐套"删掉被测代码测试仍绿"检查:未发现缺口(删解析主体/守卫/函数/调用点/白名单均会红)。
- 缺口:契约测试未锚定 GD 路径推导表达式(N-3 已补)。

### 4. 部署同步 — 通过
- build/scripts 两个 .gd 已同步;addons 无 mcp_bridge.gd 副本;DUPLICATE(secret 函数族)本批未触碰;check:gdscript fixture 已同步本批改动(覆盖两个改的 .gd)。

### 5. 仓库级约束独立核查 — 通过
- rule-templates.ts 本批未改(无需 bump);matrix 与 schema 一致;CHANGELOG 如实;.claude/rules 未动;version 0.32.6 未 bump(符合 2026-08-19 默认不发版定规);无 any/未用变量。

### 6. 验证完整性 — 基本覆盖
- uid 回填有仓库内可复现 e2e(GODOT_PATH 门控真跑);双实例 e2e 无自动化测试文件(契约测试头明示依赖手动冒烟,证据在 Obsidian 开发日志)——可接受,CI 平台限制。

## Nit 处置表

| # | 问题 | 处置 |
|---|------|------|
| N-1 | rule-templates.ts:365 + .claude/rules/godot-mcp-bridge.md:219 仍写"手动修改端口配置"(A1 后无 const PORT 可改,旧指引必失败) | **留待下批**:修需双副本同步 + version bump,与本批"默认不发版"定规冲突。已记入待办。 |
| N-2 | XDG_DATA_HOME 显式设置时 GD/TS 两侧 registry 路径漂移(容器/Flatpak/CI) | ✅ commit `1aef11b`:GD machine_dir 处加已知限制注释(退化行为无害:回落 9081) |
| N-3 | 契约测试缺 GD 路径推导锚点 | ✅ `1aef11b`:补 `OS.get_data_dir().get_base_dir().get_base_dir()` 断言 |
| N-4 | recording.ts/resources.ts 遗留 9081 固定提示 | ✅ `1aef11b`:更新为避让语义(mcp_bridge_*.secret / 9081-9090) |
| N-5 | uninstall bundled 缺失时把项目文件判为工具托管删除 | ✅ `1aef11b`:改保守——无法证明托管即不删 |
| N-6 | `contains("uid=")` 会误判 `guid=` 类子串 | ✅ `1aef11b`:改 ` uid="` 带前导空格。(修复过程附教训:行内注释吞掉 if 尾冒号致 parse error,check:gdscript 漏检、--script 执行才暴露) |
| N-7 | scene-uid 契约死分支(`func _dir_ensure` 在另一文件) | ✅ `1aef11b`:清理为切片到文件尾 + 注释说明 |
| N-8 | 探测→listen TOCTOU 毫秒窗口 | 接受:代码注释已声明为缓解非消除 |

## 值得进 memory 的工程教训(已登记 `gdscript-import-vs-script-parse-gap`)
1. `OS.get_data_dir()` 心智模型:OS 标准全局数据目录,与 user://(项目特定)是两回事——审查者第一直觉也错,靠查引擎源码纠正。跨语言路径推导一致性必须引擎源码验证,不能凭记忆。
2. GD 本地时间串 ↔ JS Date.parse 时区防御范式(测试注释防回归)。

## 验证证据(审查后 Nit 修复)
- lint 0 错 / check:gdscript errors=0 / 单文件重跑:scene-uid 5 + workspace-guard 7 + 契约 9 + game-bridge 30 + runtime 43 全绿;e2e-full 71 passed(全量并发下 3 个既有 flaky 时序用例单跑即绿,与本批无逻辑关联)

## 增量复审后记(f7b364b 之后)
- **增量复审(commit `1aef11b`/`4318cf8`/`f7b364b`)判定 APPROVE WITH NITS**:8 项 Nit 处置逐项核验吻合(N-5 新用例经红/绿推演确认真锁定新行为;N-6 三副本 src/build/fixture 逐字一致;N-4 未触碰 rule-templates 不触发 bump;matrix 静态比对无漂移),仓库级约束零触碰。
- `f7b364b` 补 N-5 行为缺口用例后 workspace-guard 为 **8 用例**;增量复审建议的三项实测已由实现者补跑:22 tests 全绿 / lint 0 错 / build 绿 / **build-matrix 重建后 0 diff**(证实无漂移结论)。
- 增量复审的 3 个文档级 nit 已处置:CHANGELOG uninstall 条目补 N-5 第三分支(bundled 缺失保守不删);本报告回填此后记。
