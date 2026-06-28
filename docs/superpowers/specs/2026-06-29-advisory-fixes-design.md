# R3 ADVISORY 批量修复设计（11 条）

**日期**：2026-06-29
**HEAD**：b559feb（v0.19.1+，CRITICAL+IMPORTANT 修复后）
**来源**：R3 报告 §三（Android 5 ADVISORY）/§四（非 Android 2）/§六（工具实现 4）
**范围**：11 条 ADVISORY（多为无害/可读性/@deprecated，用户选全修）
**关联**：`2026-06-28-critical-fixes-design.md` + `2026-06-28-important-fixes-design.md`

## 背景

R3 CRITICAL（2）+ IMPORTANT（7）已闭环。本 spec 处理 11 条 ADVISORY。源码部分确认（#1/#3/#4/#6），其余执行时 TDD 逐条核实。多数 1-3 行改 + 测试。

## 11 条修复

### #1 device_serial 注释澄清（android.ts:227）
report 误判"对 execFileSync 冗余"——device_serial 实际防 adb shell 设备端注入（adb 把 args join 传设备 `sh -c`）。注释已准确（:227"协议层注入防护"），保留检查作纵深防御。修复：补注释说明 execFileSync 自身无 shell，检查针对 adb shell 设备端。

### #2 spawnGodot mock 测试（test/android.test.ts）
deploy 测试 mock spawnGodot，未验证 export 参数构造。补断言 `spawnGodot` 调用参数含 export preset 名/platform/debug 标志。

### #3 check_template XDG_DATA_HOME（android.ts:130）
Linux `godotConfigDir` 硬编码 `join(home,'.local','share','godot')`，不读 XDG_DATA_HOME。修复：`join(process.env.XDG_DATA_HOME || join(home,'.local','share'), 'godot')`。

### #4 TOOL_META long_running 注释（android.ts:318）
TOOL_META per-tool 级（无法 per-action 细化）。android `long_running:true`（deploy/export 慢需等待提示）保留；list/get 被错标但无害（客户端多显等待提示，操作秒回）。修复：注释说明粒度限制 + 错标无害。

### #5 裸 as 断言（全局 grep 确认）
CRITICAL ts-args-as-cast-no-validation 已修（validateArgs 前置）。grep 残留高风险裸 `as`（如用户输入直接 `as` 类型断言），改 schema/typeof 校验。执行时 grep 确认范围。

### #6 isGodotVersionSignature 收紧（godot-finder.ts:66）
`:66 return (hasGodotWord && hasMajorMinor) || hasThreePartVersion || hasVersionStatus`——`hasThreePartVersion`（`/\d+\.\d+\.\d+/`）单独 OR，纯数字串 "4.6.0"（无 godot 字样）可绕过。修复：`hasThreePartVersion` → `(hasGodotWord && hasThreePartVersion)`，纯数字串不再单独放行。合法 godot 输出含 "godot" 字样或 .stable/.rc 等 status（hasVersionStatus 覆盖）。

### #7 _doConnect 显式 _invalidateSocket（game-bridge.ts:144）
auth 失败 reject 依赖开头 _invalidateSocket 调用顺序（隐式）。修复：reject 前显式 `this._invalidateSocket()`（可读性，逻辑不变）。

### #8 advanced-proxy 动态路由 size 上限 + 审计（advanced-proxy.ts:179-187）
动态路由 `arguments` 裸 `type:object` 无 additionalProperties，任意结构透传 Godot 端。修复：toolArgs 加 `JSON.stringify` 字节数上限检查（防超大 payload DoS）+ 路由名/参数键审计日志。

### #9 instance-tools 脱敏 projectPath（instance-tools.ts:117-123）
select_instance 错误消息回显未脱敏 projectPath（本地无害，但多用户/日志场景泄露路径）。修复：错误消息用 basename 或脱敏。

### #10 load-skill validateLibraryPath path 段匹配（load-skill-search.ts:82）
`p.includes('..')` 子串匹配误拒含 `..` 的合法目录名（如 `my..lib`）。修复：path 段匹配（`p.split(sep).includes('..')`），realpath 兜底保留。

### #11 test-framework assert 双重编码（test-framework.ts:146-147）
`gdEscape(JSON.stringify(args.expected))` 双重编码致字符串期望值比较恒不等。修复：`gdEscape(String(args.expected))`。模块 @deprecated 但 validation 可能引用，确认无同样问题。

## 验证门禁

- `npm test` 全绿（基线 2973 + 本次新增）
- `tsc --noEmit` exit 0

## defects 知识库同步

11 条 ADVISORY 多未立 defects.md 条目（report 摘要级）。本次修复后视情况立条/status 更新（ADVISORY 级，知识库维护）。

## 不在本次范围

- confirm-token 子项2/3（架构级 YAGNI）
- defects.md status 滞后顽疾批量（随修随改）
