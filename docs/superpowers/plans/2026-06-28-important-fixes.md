# R3 IMPORTANT 批量修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 R3 报告 7 个剩余 IMPORTANT 项（android INI OOM + 测试覆盖 / physics raycast get_node + color 正则 / response-limiter nonArray + :99 早退还逃逸 / normalizeargs-deep）。

**Architecture:** 4 处源码改动（合并同文件项）+ 配套 TDD 测试 + defects 同步 + 验证。纯 bugfix，无新模块。

**Tech Stack:** TypeScript（src）、vitest（test，.js/.ts 混用）、Godot .tscn/GDScript 生成。

## Global Constraints

- 项目 root：`D:\GitHub\godot-mcp-enhanced`；master 直接提交（不 push）
- commit message 中文 + 尾部 `Co-Authored-By: Claude <noreply@anthropic.com>`
- TDD：先写失败测试 → 实现 → 通过 → 提交
- 单测：`node node_modules/vitest/dist/cli.js run <file> -t "<name>"`（绕过 npx PATH 陷阱）；全量 `node node_modules/vitest/dist/cli.js run`
- tsc：`node node_modules/typescript/bin/tsc --noEmit`
- .ts 用内置 Edit；同文件多 Edit 串行（memory `gateguard-parallel-edit-halfchanged`）
- defects.md（`D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`）不在项目 repo，用 Edit（Bash node -e 被权限拒）
- spec：`docs/superpowers/specs/2026-06-28-important-fixes-design.md`

---

## File Structure

| 文件 | 改动 |
|------|------|
| `src/tools/physics-ops.ts` | 项2 :45 get_node→_mcp_get_node；项3 :418 正则去 -? |
| `src/core/response-limiter.ts` | 项4 result 加 _sizeWarning；项5 :99 真实复检 + :84-85 均匀采样 |
| `src/tools/android.ts` | 项1 :2 import statSync + :157/:172 前置 size 检查 |
| `src/core/ToolDispatcher.ts` | 项7 :436 深度 20 + 超深抛错 + :186 catch |
| `test/physics-ops.test.js` | 项2/3 测试 |
| `test/core/response-limiter.test.ts` | 项4/5 测试 |
| `test/android.test.ts` | 项1/6 测试 |
| `test/core/ToolDispatcher.test.ts` | 项7 测试 |
| `defects.md`（review repo） | 6 条同步（不进项目 commit） |

---

## Task 1: physics-ops raycast get_node + color_override 正则（项2+3）

**Files:** Modify `src/tools/physics-ops.ts:45,:418`; Test `test/physics-ops.test.js`

**Interfaces:** Consumes `genRaycastScript(from,to,mask?,excludePaths?)`、`handleTool(name,args,ctx)`（既有 export）

- [ ] **Step 1: 写失败测试**

在 `test/physics-ops.test.js` 末尾追加（import 行 :2-10 已含 `genRaycastScript`；补 `handleTool`）：

```js
import { genRaycastScript, genBodyInfoScript, genDiagnosePhysicsScript, genQuerySpatialScript, genCollisionOverlayScript, handleTool, getToolDefinitions, TOOL_META } from '../src/tools/physics-ops.js';
```

末尾追加：

```js
describe('physics-ops CRITICAL-fix 项2+3', () => {
  it('项2: raycast exclude 块用 _mcp_get_node(headless 兼容)', () => {
    const script = genRaycastScript({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, undefined, ['root/Foo']);
    expect(script).toContain('_mcp_get_node(ep)');
    expect(script).not.toMatch(/[^_]get_node\(ep\)/);  // 裸 get_node 不残留
  });
  it('项3: color_override "5." 被拒(正则收紧非负)', async () => {
    const ctx = { findGodot: async () => '/fake/godot' };
    const r = await handleTool('physics', { action: 'collision_overlay', parent_path: 'root', color_override: '5.,0,0', project_path: '.' }, ctx);
    expect(r.isError).toBe(true);
  });
  it('项3: color_override 合法值通过(非负小数)', async () => {
    const ctx = { findGodot: async () => '/fake/godot' };
    const r = await handleTool('physics', { action: 'collision_overlay', parent_path: 'root', color_override: '1,0.5,0,1', project_path: '.' }, ctx);
    expect(r.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node node_modules/vitest/dist/cli.js run test/physics-ops.test.js -t "项2|项3"`
Expected: 项2 FAIL（脚本含裸 `get_node(ep)`）；项3 "5." FAIL（当前正则 `/^[\d.]+$/` 接受 `5.`，isError false）

- [ ] **Step 3: 修复 physics-ops.ts**

Edit `:45`（genRaycastScript exclude 块）：

```ts
\t\tvar n = _mcp_get_node(ep)
```

Edit `:418`（collision_overlay color_override 校验）：

```ts
          if (parts.length < 3 || parts.length > 4 || !parts.every(p => /^\d+(\.\d+)?$/.test(p) && isFinite(Number(p)))) {
```

- [ ] **Step 4: 运行验证通过**

Run: `node node_modules/vitest/dist/cli.js run test/physics-ops.test.js`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/physics-ops.ts test/physics-ops.test.js
git commit -m "fix(r3): IMPORTANT physics raycast _mcp_get_node + color_override 正则收紧

项2: raycast 排除块 get_node(ep)→_mcp_get_node(ep)(headless 兼容,对齐文件内 3 处)
项3: color_override 正则 /^[\d.]+$/→/^\d+(\.\d+)?$/ (拒 5. 漏网, RGBA 非负去 -?)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: response-limiter :99 早退还逃逸 + nonArray warning + 均匀采样（项4+5）

**Files:** Modify `src/core/response-limiter.ts:84-85,:99,:146-149`; Test `test/core/response-limiter.test.ts`

**Interfaces:** Consumes `trimToArrayLimit`（既有）

- [ ] **Step 1: 写失败测试**

在 `test/core/response-limiter.test.ts` 末尾追加（helpers `makeArrayResult`/`resultSize` 既有 :21-38）：

```ts
describe('response-limiter CRITICAL-fix 项4+5', () => {
  it('项5: 前 100 小对象 + 后续大对象 不再 :99 早退还超限(真实复检拦截)', () => {
    // 前 100 个小对象(采样低估 estimatedItemSize→estimatedFit 高估→旧 :99 误判全装下早退→超限)
    const smallItems = Array.from({ length: 100 }, () => `{"d":"x"}`);
    const bigItems = Array.from({ length: 200 }, () => `{"d":"${'y'.repeat(500)}"}`);
    const json = `{"nodes":[${[...smallItems, ...bigItems].join(',')}],"status":"ok"}`;
    const result = { content: [{ type: 'text' as const, text: json }] };
    const limited = trimToArrayLimit(result, 5000);
    const size = resultSize(limited);
    expect(size).toBeLessThanOrEqual(6000);  // 不超限(:99 复检拦截走二分截断, 非原样返回)
  });
  it('项4: nonArrayFields 自身超 limit → result 含 _sizeWarning', () => {
    // nonArrayFields(非 nodes 字段)自身超大, 数组清空仍超
    const hugeMeta = 'z'.repeat(8000);
    const json = `{"nodes":[],\"meta\":\"${hugeMeta}\"}`;
    const result = { content: [{ type: 'text' as const, text: json }] };
    const limited = trimToArrayLimit(result, 4000);
    const text = (limited.content[0] as { text: string }).text;
    expect(text).toContain('_sizeWarning');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node node_modules/vitest/dist/cli.js run test/core/response-limiter.test.ts -t "项4|项5"`
Expected: 项5 FAIL（旧 :99 早退还超限）；项4 FAIL（无 _sizeWarning）

- [ ] **Step 3: 修复 response-limiter.ts**

Edit `:84-85`（均匀采样）：

```ts
  const sampleSize = Math.min(100, originalArray.length);
  const step = Math.ceil(originalArray.length / sampleSize) || 1;
  const sample = originalArray.filter((_, i) => i % step === 0);
```

Edit `:99`（早退前真实复检）：

```ts
  if (estimatedFit >= originalArray.length) {
    // 项5: 防采样偏差致 estimatedFit 高估误判全装下→原样返回超限; 真实字节数复检才早退
    const fullObj = { ...nonArrayFields, [largestKey]: originalArray };
    if (Buffer.byteLength(JSON.stringify(fullObj), 'utf-8') <= limitBytes) return data;
    estimatedFit = originalArray.length;  // 真实超限: clamp 让下方二分在 [0,length] 收敛
  }
```

Edit result 构建处（:146-149 后追加 _sizeWarning 复检）：

```ts
  const result: Record<string, unknown> = { ...nonArrayFields };
  result[largestKey] = originalArray.slice(0, best);
  result[`${largestKey}_truncatedAt`] = best;
  result[`${largestKey}_totalNodeCount`] = originalArray.length;
  // 项4: nonArrayFields 自身超 limit(数组已清空仍超)时加 warning(不裁 nonArrayFields 保数据完整性)
  const finalBytes = Buffer.byteLength(JSON.stringify(result), 'utf-8');
  if (finalBytes > limitBytes) {
    result._sizeWarning = `non-array fields exceed budget (${finalBytes} > ${limitBytes} bytes); response may exceed size limit`;
  }
```

- [ ] **Step 4: 运行验证通过**

Run: `node node_modules/vitest/dist/cli.js run test/core/response-limiter.test.ts`
Expected: 全 PASS（含既有 + 新增）

- [ ] **Step 5: 提交**

```bash
git add src/core/response-limiter.ts test/core/response-limiter.test.ts
git commit -m "fix(r3): IMPORTANT response-limiter :99 早退还逃逸 + nonArray warning + 均匀采样

项5(根因): :99 早退前真实字节数复检(防采样偏差致 estimatedFit 高估误判全装下→原样返回超 4MB);
  均匀采样(i%step)辅助提高估算精度
项4: nonArrayFields 自身超 limit 时 result 加 _sizeWarning(数据完整性优先不裁 nonArrayFields)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: android INI OOM + 测试覆盖（项1+6）

**Files:** Modify `src/tools/android.ts:2,:157,:172`; Test `test/android.test.ts`

**Interfaces:** Consumes `findAndroidPreset`（:110）、`opsErrorResult`/`ERROR_CODES`（既有）

- [ ] **Step 1: 写失败测试**

在 `test/android.test.ts` 末尾追加（确认既有 mock 模式：adb execFileSync + godot spawnGodot mock；项目路径 fixture）：

```ts
describe('android CRITICAL-fix 项1+6', () => {
  it('项1: export_presets.cfg >1MB 拒绝解析(防 OOM)', async () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 2_000_000 } as any);
    const r = await handleTool('android', { action: 'get_preset_info', project_path: '/fake/proj' }, mockCtx);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).toMatch(/too large|1MB/i);
    vi.mocked(fs.statSync).mockRestore();
  });
  it('项6: apk 非 res:// 绝对路径拒绝', async () => {
    // 构造 preset.exportPath = 'C:\\evil\\payload.apk' → resolveWithinRoot 拒绝
    // 复用既有 deploy mock 模式; 详见既有 android.test.ts deploy 用例
    const r = await handleTool('android', { action: 'deploy', project_path: '/fake/proj', apk_path: 'C:\\evil\\payload.apk' }, mockCtx);
    expect(r.isError).toBe(true);
  });
  it('项6: INI 畸形(无 =)不崩', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('[preset.0]\nname no equals\ngarbage line\n');
    const r = await handleTool('android', { action: 'get_preset_info', project_path: '/fake/proj' }, mockCtx);
    // 不抛未捕获异常(返回 ToolResult, 可能 isError 或空 presets)
    expect(r).toBeDefined();
    vi.mocked(fs.readFileSync).mockRestore();
  });
});
```

> 注：`handleTool`/`mockCtx`/`fs` mock 名以既有 `android.test.ts` 为准（实施时读确认 import + mock setup）。statSync mock 须在 size 检查前。

- [ ] **Step 2: 运行验证失败**

Run: `node node_modules/vitest/dist/cli.js run test/android.test.ts -t "项1|项6"`
Expected: 项1 FAIL（当前无 size 检查，大文件不拒）；项6 部分可能 PASS（既有 resolveWithinRoot 已拒绝对路径——确认覆盖）

- [ ] **Step 3: 修复 android.ts**

Edit `:2`（import 加 statSync）：

```ts
import { existsSync, readFileSync, statSync } from 'fs';
```

Edit deploy action（:157 `findAndroidPreset` 调用前，:155 project_path 检查后）：

```ts
      const cfgStat = statSync(cfgPath);
      if (cfgStat.size > 1_000_000) {
        return opsErrorResult(ERROR_CODES.INVALID_PARAMS, `export_presets.cfg too large (${(cfgStat.size / 1_000_000).toFixed(1)}MB > 1MB), refuse to parse`);
      }
      const preset = findAndroidPreset(cfgPath, args.preset_name as string | undefined, args.preset_index as number | undefined);
```

get_preset_info action（:172 同样前置）同上。

> 注：确认 `ERROR_CODES.INVALID_PARAMS` 存在（grep `INVALID_PARAMS` in android.ts/shared.js）；若 android 的 ERROR_CODES 无此码，新增或用现有码。

- [ ] **Step 4: 运行验证通过**

Run: `node node_modules/vitest/dist/cli.js run test/android.test.ts`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```bash
git add src/tools/android.ts test/android.test.ts
git commit -m "fix(r3): IMPORTANT android INI OOM statSync 上限 + 测试覆盖

项1: get_preset_info/deploy 调用 findAndroidPreset 前 statSync size<1MB 检查(防 200MB cfg OOM, 复发 tscn-parser 模式)
项6: 补 apk 绝对路径/INI 畸形用例

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: normalizeargs-deep 提深度+超深抛错+catch 位置（项7）

**Files:** Modify `src/core/ToolDispatcher.ts:436-441,:186`; Test `test/core/ToolDispatcher.test.ts`

**Interfaces:** Consumes `ToolDispatcher.handleCall`（既有）、`opsErrorResult`（既有 import）

- [ ] **Step 1: 写失败测试**

在 `test/core/ToolDispatcher.test.ts` 末尾追加（既有 `createDispatcherForHandleCall` + mock setup）：

```ts
describe('ToolDispatcher CRITICAL-fix 项7 normalizeargs-deep', () => {
  it('项7: >20 层嵌套 args → isError(超深抛错被 :186 catch, 非逃逸/非 silently 绕过)', async () => {
    const guard = createMockGuard(false);
    const dispatcher = createDispatcherForHandleCall({ readOnlyGuard: guard });
    // 构造 25 层嵌套
    let nested: Record<string, unknown> = { camelKey: 1 };
    for (let i = 0; i < 25; i++) nested = { outerKey: nested };
    const result = await dispatcher.handleCall({ params: { name: 'project', arguments: nested } });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/depth limit|normalization failed/i);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node node_modules/vitest/dist/cli.js run test/core/ToolDispatcher.test.ts -t "项7"`
Expected: FAIL（当前超深 silently return rawArgs，不抛错；或抛错逃逸非 isError 格式）

- [ ] **Step 3: 修复 ToolDispatcher.ts**

Edit `:436-441`（MAX_DEPTH 5→20 + 超深抛错）：

```ts
  private static readonly MAX_NORMALIZE_DEPTH = 20;
  private normalizeArgs(rawArgs: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
    if (!rawArgs) {
      return {};
    }
    if (depth > ToolDispatcher.MAX_NORMALIZE_DEPTH) {
      throw new Error(`normalizeArgs depth limit (${ToolDispatcher.MAX_NORMALIZE_DEPTH}) exceeded — flatten nested args`);
    }
```

Edit `:186`（catch 包 normalizeArgs）：

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

> 注：确认 `log` + `opsErrorResult` 在 ToolDispatcher.ts 已 import（既有 catch :354 已用）。删除原 :440 的 log 行（移到 :186 catch）。

- [ ] **Step 4: 运行验证通过**

Run: `node node_modules/vitest/dist/cli.js run test/core/ToolDispatcher.test.ts`
Expected: 全 PASS（含既有 + 项7）

- [ ] **Step 5: 提交**

```bash
git add src/core/ToolDispatcher.ts test/core/ToolDispatcher.test.ts
git commit -m "fix(r3): IMPORTANT normalizeargs-deep 提深度+超深抛错+catch 位置

项7: MAX_NORMALIZE_DEPTH 5→20 + 超深抛 Error(不 silently return rawArgs camelCase);
  catch 放 handleCall :186(normalizeArgs 在 executeToolCall:202 之外, 原 :207 catch 捕不到→逃逸 MCP SDK);
  → opsErrorResult(TOOL_ERROR) 明确拒绝, 不绕过 snake_case 校验

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: defects.md 知识库同步（review repo，不进项目 commit）

**Files:** Modify `D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`

- [ ] **Step 1: 新增 android-ini-parser-no-byte-limit 条目**

在 defects.md 末尾 2026-06-28 工具实现区块（:799+）追加新条目（title/severity=IMPORTANT/dimension=Security(D-DoS)/detect/fix-forward/status=fixed）。

- [ ] **Step 2: 6 条 status → fixed**

Grep 定位各条目 status 行，Edit → fixed：
- `physics-raycast-exclude-bare-getnode`（:800 区）→ fixed
- `physics-color-override-loose-regex`→ fixed
- `response-limiter-nonarray-overflow-silent`→ fixed
- `response-limiter-head-sample-bias`→ fixed（detect 须含 :99 早退，不止采样）
- `normalizeargs-deep-silent-bypass`→ fixed
- `android-ini-parser-no-byte-limit`（新增）→ fixed

- [ ] **Step 3: 验证（无项目 commit）**

确认 defects.md 改动落盘。不产生项目 git commit。

---

## Task 6: 验证收尾

- [ ] **Step 1: 全量测试**

Run: `node node_modules/vitest/dist/cli.js run 2>&1 | tail -10`
Expected: 全绿（基线 2966 + 本次新增）

- [ ] **Step 2: tsc 类型检查**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 确认 commits**

Run: `git log --oneline -6`
Expected: Task 1-4 的 4 个 fix 提交在 master

---

## Self-Review

**1. Spec coverage**：项1→Task3 / 项2→Task1 / 项3→Task1 / 项4→Task2 / 项5→Task2 / 项6→Task3 / 项7→Task4；defects→Task5；验证→Task6 ✅

**2. Placeholder scan**：每 step 含完整代码或精确 Edit；Task3/Task4 标注"确认 ERROR_CODES/log import"为实施核对项，非占位 ✅

**3. Type consistency**：`genRaycastScript(from,to,mask?,excludePaths?)`、`handleTool(name,args,ctx)`、`trimToArrayLimit`、`MAX_NORMALIZE_DEPTH` 跨任务一致 ✅
