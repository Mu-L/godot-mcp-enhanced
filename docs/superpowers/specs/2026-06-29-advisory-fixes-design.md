# R3 ADVISORY 批量修复设计（11 条）

**日期**：2026-06-29
**HEAD**：b559feb（v0.19.1+，CRITICAL+IMPORTANT 修复后）
**来源**：R3 报告 §三/§四/§六 + spec reviewer 修正（`2026-06-29-advisory-fixes-design-spec-eng-review.md`）
**范围**：11 条 ADVISORY（用户选全修）

## 背景

R3 CRITICAL（2）+ IMPORTANT（7）已闭环。本 spec 处理 11 条 ADVISORY。spec 经独立 reviewer 审查，2 必改（#6 论证/#11 措辞与场景）+ 4 建议补（#1 行号/#5 grep 标准/#8 size+delegate/#10 复发扩展）已纳入。

## 11 条修复

### #1 device_serial 注释澄清（android.ts validateDeviceSerial :193-199 + launch 块）
report 标 :227 实为 launch package 注释；device_serial 校验在 `validateDeviceSerial`（:193-199）。device_serial 防 adb shell 设备端注入（adb 把 args join 传设备 `sh -c`），**非**对 execFileSync 冗余（execFileSync 自身无 shell）。修复：补注释说明检查针对 adb shell 设备端 + execFileSync 无 shell，保留作纵深防御。

### #2 spawnGodot mock 测试（test/android.test.ts）
deploy 测试 mock spawnGodot，未验证 export 参数构造。补断言 `spawnGodot` 调用参数含 export preset 名/platform/debug 标志。

### #3 check_template XDG_DATA_HOME（android.ts:130）
Linux `godotConfigDir` 硬编码 `join(home,'.local','share','godot')`。修复：`join(process.env.XDG_DATA_HOME || join(home,'.local','share'), 'godot')`。

### #4 TOOL_META long_running 注释（android.ts:318）
TOOL_META per-tool 级（无法 per-action 细化）。android `long_running:true`（deploy/export 慢需等待提示）保留；list/get 被错标但无害（客户端多显等待提示，操作秒回）。修复：注释说明粒度限制。改 per-action 需 TOOL_META 结构改动，超 ADVISORY 范围。

### #5 裸 as 断言（全局 grep + 判定标准）
grep ` as [A-Z]\w+` in src/。**判定高风险**：用户输入（`args.x`）直接 `as Type` 断言且无 typeof/schema 前置校验（CRITICAL ts-args 已修 validateArgs 前置，残留的是绕过 validateArgs 的直接 as）。执行时 grep 列清单，人工判定高风险处改 typeof/schema 校验；低风险（内部 trusted 数据）保留。

### #6 isGodotVersionSignature 收紧（godot-finder.ts:66）
`:66 (hasGodotWord && hasMajorMinor) || hasThreePartVersion || hasVersionStatus`——`hasThreePartVersion`（`/\d+\.\d+\.\d+/`）单独 OR，纯数字串 "4.6.0"（无 godot 字样）可绕过。

**修复**：`hasThreePartVersion` → `(hasGodotWord && hasThreePartVersion)`，纯数字串不再单独放行。

**论证（reviewer 必改）**：godot `--version` 标准输出必含 status 后缀（`.stable`/`.dev`/`.rc`/`.beta`/`.alpha`/`.custom`/`.mono`/`.official` 等，hasVersionStatus 覆盖）或 "godot" 字样（hasGodotWord 覆盖）；自定义构建含 `.custom`。纯 `4.6.2`（无 status/godot）非标准 godot 输出，收紧不会误拒合法输出。

**TDD 覆盖 3 形态**：`"4.6.2.stable"`（status→通过）/ `"Godot v4.6.2"`（godot+version→通过）/ `"4.6.2"`（纯数字→拒绝）。

### #7 _doConnect 显式 _invalidateSocket（game-bridge.ts:144）
auth 失败 reject 依赖开头 _invalidateSocket 调用顺序（隐式）。修复：reject 前显式 `this._invalidateSocket()`（可读性，逻辑不变）。

### #8 advanced-proxy size 上限 + 审计（advanced-proxy.ts:179-187 dynamic route + :202 delegateCall）
**修复**：动态路由 `toolArgs` 加 `JSON.stringify` 字节数上限 **256KB**（dynamic route 场景，小于 android 1MB；防超大 payload DoS）+ 路由名/参数键审计日志。

**delegateCall（:202）同源透传**：同样加 size 上限（一致性，delegate 也透传 Godot 端）。两处共用 size 检查 helper。

### #9 instance-tools 脱敏 projectPath（instance-tools.ts:117-123）
select_instance 错误消息回显未脱敏 projectPath（本地无害，多用户/日志场景泄露）。修复：错误消息用 basename 或固定占位（不回显完整路径）。

### #10 load-skill + recording + scene-instance `includes('..')` 段级匹配（reviewer 复发扩展）
全局 grep `includes('..')` 发现 **4 处**：
- `load-skill-search.ts:82`（report #10）
- `instance-manager.ts:172`（**已修**段级，C-02 注释）
- `recording.ts:58`（name.includes('..')，**同源复发**）
- `scene-instance.ts:209`（sourceRel.includes('..')，**同源复发**）

**修复**：3 处未修的（load-skill/recording/scene-instance）`includes('..')` → path 段匹配（`split(/[/\\]/).includes('..')`），realpath 兜底保留。

**defects 立条**：`instance-manager-path-traversal-substring` 的同源复发（按 review-protocol「复发即升级」），defects.md 标复发 + 全局 grep 确认。

### #11 test-framework assert 双重编码（test-framework.ts:146，validation 活引用）
**reviewer 必改措辞**：`validation.ts:16` **确定** `import { handleTestAction }`（非"可能引用"），:1055 调用。模块 @deprecated 但活引用，bug 影响 `assert(property_equals)`。

**bug 场景**：`:146 var _expected = str(${gdEscape(JSON.stringify(args.expected))})`——JSON.stringify 给字符串加引号（"foo"→`"foo"`），gdEscape 再转义，str() 包裹；而 `_val = str(_n.get(_prop))` 实际值无引号 → 字符串期望值比较**恒不等**。

**修复**：`gdEscape(JSON.stringify(args.expected))` → `gdEscape(String(args.expected))`（标量直接字符串化，无引号差异）。对象 expected 用 String 会得 `[object Object]`，但 property_equals 比较节点标量属性，expected 是标量。

**修复影响**：原本恒不等的 assert 变真比较，依赖 bug 行为的测试（若有）需更新；基线 2973 测试数可能变动，执行时确认。

## 验证门禁

- `npm test` 全绿（基线 2973 ± #11 修复可能变动）
- `tsc --noEmit` exit 0

## defects 知识库同步

- `instance-manager-path-traversal-substring` 同源复发立条（#10）
- 11 条 ADVISORY 多未立 defects.md 条目（report 摘要级），视情况立条/status 更新

## 不在本次范围

- confirm-token 子项2/3（架构级 YAGNI）
- defects.md status 滞后顽疾批量（随修随改）
