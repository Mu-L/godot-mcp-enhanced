# R3 IMPORTANT 批量修复设计

**日期**：2026-06-28
**HEAD**：14bc057（v0.19.1+，CRITICAL 修复后）
**来源**：R3 报告 §三（Android）/§六（工具实现）/§五·八（DEFECT 复测）
**范围**：7 个剩余 IMPORTANT 项（android 2 + physics 2 + response-limiter 2 + normalizeargs 1）
**spec 审查**：`D:\workspace\review\.claude\reviews\2026-06-28-important-fixes-design-spec-eng-review.md`（2 IMPORTANT 修正 + 5 ADVISORY 已纳入：项 5 补 :99 真实复检/项 7 修 catch 位置/项 1 调用点前置/项 3 去 -?/项 4 warning 权衡/项 2 _mcp_get_node 3 处）
**关联 spec**：`2026-06-28-critical-fixes-design.md`（CRITICAL 已修）

## 背景

R3 审查 2 个 CRITICAL 已闭环（commit `6e24baa`/`a3dd3f7`/`069ab86`/`14bc057`）。本 spec 处理 7 个剩余 IMPORTANT 项。源码全部核实（HEAD 14bc057 下仍是报告状态）。spec 经独立 reviewer 审查，2 个 IMPORTANT 方案缺口已修正（项 5/7）。

## 7 项修复

### 项 1：android INI 解析 OOM（防 DoS）

**文件**：`src/tools/android.ts`（`get_preset_info` / `deploy` action 调用 `findAndroidPreset` 处）

**问题**：`findAndroidPreset`（`:112`）`readFileSync(cfgPath, 'utf-8')` 全读 + `parsePresetsCfg` `split('\n')` 全量入内存，无 size 上限。复发 `tscn-parser-no-byte-limit` 同源模式。200MB `export_presets.cfg` → Node OOM。

**修复**（reviewer 修正：调用点前置，非 findAndroidPreset 内）：在 `get_preset_info` / `deploy` action 调用 `findAndroidPreset` **之前**，前置 statSync size 检查：
```ts
const cfgStat = statSync(cfgPath);
if (cfgStat.size > 1_000_000) {
  return opsErrorResult('INVALID_PARAMS', `export_presets.cfg too large (${(cfgStat.size/1_000_000).toFixed(1)}MB > 1MB), refuse to parse`);
}
```
（findAndroidPreset 返回 `PresetInfo | null` 非 ToolResult，故 size 检查在其调用点 action handler 内，超限直接 return opsErrorResult）。

**defects**：`android-ini-parser-no-byte-limit`（defects.md 当前**不存在**，本次**新增立条** IMPORTANT）。

**测试**：mock `statSync` 返回 >1MB size → get_preset_info/deploy 返回 INVALID_PARAMS 错误。

### 项 2：physics.raycast 裸 get_node（headless 排除失效）

**文件**：`src/tools/physics-ops.ts:45`

**问题**：生成 GDScript 排除块 `var n = get_node(ep)`，headless 下 `root.get_node()` 可能失败 → 射线排除静默失效。文件内 `_mcp_get_node` 已用于 3 处（body_info/diagnose/collision_overlay），唯 raycast 排除块漏用。

**修复**：`:45` `get_node(ep)` → `_mcp_get_node(ep)`。

**测试**：raycast 带 exclude 参数 → 生成脚本含 `_mcp_get_node`（断言脚本字符串）。

### 项 3：physics collision_overlay color_override 正则（Type Safety）

**文件**：`src/tools/physics-ops.ts:418`

**问题**：`/^[\d.]+$/` 接受 `5.`（`Number('5.')=5` 隐式规整）；`..5`/`1.2.3` 已被 isFinite 兜底，`5.` 漏网。

**修复**（reviewer 修正：去 `-?`，color RGBA 分量非负）：`/^[\d.]+$/` → `/^\d+(\.\d+)?$/`（拒 `5.`、非负，与 validateVector3 严格基线一致；color 不该为负故去 `-?`）。`isFinite` 双重检查保留。

**测试**：`5.`/`1..2` 拒绝；`1,0,0`/`0.5,0,1,1` 通过。

### 项 4：response-limiter nonArray 超限静默（数据完整性）

**文件**：`src/core/response-limiter.ts`（trim 逻辑末段，result 构建处 :146-149）

**问题**：`budgetBytes = limitBytes - nonArrayBytes`，nonArrayFields 自身 > limitBytes → budgetBytes 负 → 数组清空但 nonArrayFields 原样保留（总字节仍 > limitBytes），函数报告截断成功。

**修复**（reviewer 补：权衡 + warning 位置）：trim 后复检总字节数；nonArrayFields 自身超 limitBytes 时，**不裁剪 nonArrayFields**（数据完整性优先——裁剪可能丢关键元数据如 `_totalNodeCount`），改在 result 加 warning 字段：
```ts
const finalBytes = Buffer.byteLength(JSON.stringify(result), 'utf-8');
if (finalBytes > limitBytes) {
  result._sizeWarning = `non-array fields exceed budget (${finalBytes} > ${limitBytes} bytes); response may exceed size limit`;
}
```

**测试**：nonArrayFields 超 limitBytes 输入 → result 含 `_sizeWarning` 字段。

### 项 5：response-limiter 头部采样偏差 + :99 早退还逃逸（数据完整性）

**文件**：`src/core/response-limiter.ts:84-85`（采样）+ `:99`（早退）

**问题（reviewer 修正：真正逃逸点是 :99 早退，非采样本身）**：
- 二分搜索 `:135` 用真实字节 `midTotalBytes` 校正（midTotalBytes ≤ limitBytes 才更新 best），**二分本身不超限**。
- 采样偏差只影响 `estimatedFit` 精度。但 `:99 if (estimatedFit >= originalArray.length) return data;` 早退绕过二分——采样低估 `estimatedItemSize` → `estimatedFit` 高估 → 误判"全装下" → 原样 return data → 超 4MB。
- 均匀采样缓解 :99 误判但不彻底（step 命中的仍可能都偏小）。

**修复（根因 + 辅助）**：
1. **:99 早退前真实字节数复检（根因）**：估算"全装下"时，真实 stringify 全数组复检，真装得下才早退，真超限则走二分截断：
```ts
if (estimatedFit >= originalArray.length) {
  // 防采样偏差致 estimatedFit 高估误判全装下→原样返回超限; 真实复检才早退
  const fullObj = { ...nonArrayFields, [largestKey]: originalArray };
  if (Buffer.byteLength(JSON.stringify(fullObj), 'utf-8') <= limitBytes) return data;
  // 真实超限: 不早退, 落入下方二分(estimatedFit clamp + 二分截断)
}
```
2. **:84-85 均匀采样（辅助优化）**：`slice(0, sampleSize)` → 均匀采样 `step = Math.ceil(len/sampleSize)`，`sample = originalArray.filter((_, i) => i % step === 0)`，提高 `estimatedItemSize` 精度（减少二分迭代），但不能替代 :99 复检。

**测试**：前小后大数组（前 100 小对象 + 后续大对象）→ 不再 :99 早退还超限（真实复检拦截 → 走二分截断）；估算单元素体积接近真实均值。

### 项 6：android 测试覆盖缺口（Completeness）

**文件**：`test/android.test.ts`

**问题**：deploy 3 测试只覆盖 package/serial 元字符拒绝 + export 失败，未测绝对路径拒绝、`res://../../` 遍历、INI 畸形、skip_export。

**修复**：补用例（mock 策略：adb `execFileSync` mock + godot `spawnGodot` mock，对齐既有 android.test.ts mock 模式）：
- apk 非 res:// 绝对路径（`C:\...` / `/etc/...`）拒绝
- `res://../../` 遍历拒绝
- INI 畸形输入（无 `=` / 超大 section）不崩
- skip_export=true + APK 缺失 跳过 install

**测试**：上述 4 用例。

### 项 7：normalizeargs-deep-silent-bypass（Security/校验绕过）

**文件**：`src/core/ToolDispatcher.ts:436-441`（`normalizeArgs`）+ `:186`（handleCall 调用处）

**问题**：`depth > MAX_NORMALIZE_DEPTH(5)` 时 silently `return rawArgs ?? {}`（camelCase 未转 snake_case），:440 仅 log。超深嵌套 args 不转换 → 绕过依赖 snake_case key 的校验。

**修复（reviewer 修正：catch 位置）**：
1. `MAX_NORMALIZE_DEPTH = 5` → `20`（GDScript args 嵌套几乎不超 5，20 充分冗余）。
2. 超深（`depth > 20`）抛 `Error('normalizeArgs depth limit (20) exceeded — flatten nested args')`，**不** `return rawArgs`。
3. **catch 放 handleCall :186 处**（normalizeArgs 在 :186 调用，位于 executeToolCall :202 之外；executeToolCall :207 的 try/catch 捕不到 :186 throw，会逃逸到 MCP SDK 层）：
```ts
let args: Record<string, unknown>;
try {
  args = this.normalizeArgs(rawArgs);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log('normalizeArgs error:', name, msg);
  return opsErrorResult('TOOL_ERROR', `Argument normalization failed: ${msg}`);
}
```

**测试**：构造 >20 层嵌套 args → handleCall 返回 isError + 含 depth limit 消息（验证 :186 catch 捕获，非逃逸）；≤20 层正常转换无回归。

## 验证门禁

- `npm test` 全绿（基线 2966 + 本次新增用例）
- `tsc --noEmit` 干净

## defects 知识库同步

`D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`：
- `android-ini-parser-no-byte-limit`（**新增立条**）→ fixed
- `physics-raycast-exclude-bare-getnode`（:800）→ fixed
- `physics-color-override-loose-regex`→ fixed
- `response-limiter-nonarray-overflow-silent`→ fixed
- `response-limiter-head-sample-bias`→ fixed（detect 须含 :99 早退，不止采样）
- `normalizeargs-deep-silent-bypass`→ fixed

## 不在本次范围

- R3 14 ADVISORY（裸 as / XDG 等）
- defects.md 其余 status 滞后顽疾（本次随修随改 6 条）
