# 批次 A 安全修复实施计划（RCE + 路径穿越）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 10 条安全 finding（1 RCE + 4 路径越权/穿越 + 1 symlink 顺序 + 4 纵深/脱敏），堵 class_path RCE 与路径越权。

**Architecture:** 纯加固——对齐已有防御模式（`resolveWithinRoot` / `has_path_traversal` / `coerce_property_value` / `sanitizeMsg`），不改工具签名与正常路径行为。A11（find_node traversal）经 eng-review 否决移除（范畴错误）。

**Tech Stack:** TypeScript（src/）、GDScript（addons/）、vitest、defects.ts 静态 detect。

**Spec:** `docs/superpowers/specs/2026-07-23-batchA-security-design.md`（含 eng-review 修订）。

## Global Constraints

- 行号以 grep 实测为准（spec 行号基于 2026-07-23，可能漂移）。
- `resolveWithinRoot(root, userPath)` 抛 `Error('Path traversal detected: ...')`（path-utils.ts:154），越界由 ToolDispatcher 捕获。
- `normalizeUserProjectPath(input)` 剥 `res://` 前缀（path-utils.ts:192）。
- 统一模式：`resolveWithinRoot(projectPath, normalizeUserProjectPath(x))`。
- GDScript 用 tab 缩进，edit_script search_and_replace。
- 每个 task 结束：`npx tsc --noEmit` exit 0 + 相关测试绿，再 commit。
- 不破现有测试（pre-existing failed 需标注，参考基线 `npx vitest run` 当前状态）。

## File Structure

| 文件 | 改动 | Task |
|---|---|---|
| `src/tools/data-import.ts` | classPath 补 resolveWithinRoot | 1 |
| `src/tools/validation.ts` | run_and_verify scene + captureTree 补 resolveWithinRoot | 2 |
| `src/tools/workflow.ts` | batch_validate scripts + user:// 三处 .. 拒绝 | 2, 3 |
| `src/tools/scene/index.ts` | create_scene/save_scene/load_sprite 补 resolveWithinRoot | 2 |
| `src/tools/delivery.ts` `game-design.ts` `batch-tools.ts` | resolveWithinRoot 前先 normalize | 2 |
| `src/tools/game-bridge.ts` | symlink 检查移到 icacls/chmod 前 | 4 |
| `addons/.../asset/asset_factory.gd` | material load 补 has_path_traversal | 5 |
| `addons/.../commands/ui_commands.gd` `scene_commands.gd` | 改走 coerce_property_value + 删本地 blocked | 6 |
| `src/core/logger.ts` `call-recorder.ts` | export sanitizeMsg + error/msg 脱敏 | 7 |
| `test/regression/defects.ts` | A5/A10 detect 守卫 + :55 回标 | 8 |
| `CHANGELOG.md` | Security 段 + A11 否定论证 | 8 |

---

## Task 1: A1 class_path RCE（最高危，先做）

**Files:**
- Modify: `src/tools/data-import.ts`（:298 classPath + :356 generateImportScript 调用）
- Test: `test/tools/data-import.test.js`（或就近现有测试文件，grep `class_path` 定位）

**Interfaces:**
- Consumes: `resolveWithinRoot`、`normalizeUserProjectPath`（path-utils.ts，已 export）
- Produces: classPath 经 root 校验，拦 `..` 段与项目外路径

- [ ] **Step 1: 写失败测试**

在 data-import 测试文件加：
```js
it('class_path 越权（.. 段）被 resolveWithinRoot 拦截', async () => {
  // 构造合法 csv_content + 合法 output_dir/filename_column，仅 class_path 越权
  const args = { project_path: PROJECT, class_path: 'res://../../evil.gd', output_dir: 'out', filename_column: 'name', csv_content: 'name\na\n' };
  await expect(handleTool('csv_to_resources', args, ctx)).rejects.toThrow(/Path traversal/);
});
```

- [ ] **Step 2: 跑确认失败**

Run: `npx vitest run test/tools/data-import.test.js -t "class_path 越权"`
Expected: FAIL（当前 classPath 无校验，不抛错而是走 load）

- [ ] **Step 3: 实现**

`src/tools/data-import.ts` :298 `const classPath = args.class_path as string;` 后补：
```ts
// A1 (2026-07-23 安全): classPath 经 root 校验——经 executeGdscriptTrusted 跳沙箱 + load() + Class.new()，
// 越权路径 = RCE（gdscript-template-injection 复发实例，defects.ts:55）。对齐 outputDir :350 模式。
const safeClassPath = resolveWithinRoot(projectPath, normalizeUserProjectPath(classPath));
```
:356 `generateImportScript({ classPath, ... })` 改 `classPath: safeClassPath`。

确认 import：文件顶部应已有 `resolveWithinRoot`/`normalizeUserProjectPath`（:321/350 已用，grep 确认）。

- [ ] **Step 4: 跑确认通过**

Run: `npx vitest run test/tools/data-import.test.js -t "class_path 越权"`
Expected: PASS

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`（exit 0）
```bash
git add src/tools/data-import.ts test/tools/data-import.test.js
git commit -m "fix(security): A1 data-import class_path 补 root 校验（堵 RCE）"
```

---

## Task 2: 组1 TS 路径校验统一（A2/A6/A7/A9）

**Files:**
- Modify: `src/tools/validation.ts`、`src/tools/workflow.ts`、`src/tools/scene/index.ts`、`src/tools/delivery.ts`、`src/tools/game-design.ts`、`src/tools/batch-tools.ts`
- Test: 对应 test 文件补越权拒绝用例

**Interfaces:**
- Consumes: `resolveWithinRoot`、`normalizeUserProjectPath`
- Produces: 4 类路径参数统一 root 校验

- [ ] **Step 1: A2 validation.ts run_and_verify scene**

grep 定位 `run_and_verify` 的 `cmdArgs.push(scene)` 与 captureTree `scene_path: scene`。两处前补：
```ts
const safeScene = resolveWithinRoot(projectPath, normalizeUserProjectPath(scene));
```
后续用 safeScene（push safeScene / JSON.stringify({ scene_path: safeScene })）。

- [ ] **Step 2: A6 workflow.ts batch_validate scripts**

grep 定位 batch_validate `const rel = ...; const full = join(projectPath, rel);`。改：
```ts
const full = resolveWithinRoot(projectPath, normalizeUserProjectPath(s));
```
（删 rel 中间变量或保留无害；join 越界探测被 resolveWithinRoot 抛错替代）

- [ ] **Step 3: A7 scene/index.ts create_scene/save_scene/load_sprite**

grep 定位 :227/239/242 的 `normalizeUserProjectPath(...)`（无 resolveWithinRoot 包裹）。改为：
```ts
const sceneAbs = resolveWithinRoot(p, normalizeUserProjectPath(args.scene_path as string));
```
对齐同文件 read_scene(:126)/add_node(:399)。

- [ ] **Step 4: A9 delivery/game-design/batch-tools 先 normalize**

`delivery.ts:232/239`、`game-design.ts:329`、`batch-tools.ts:218-219` 当前 `resolveWithinRoot(projectPath, args.xxx_path)`，改 `resolveWithinRoot(projectPath, normalizeUserProjectPath(args.xxx_path as string))`。

- [ ] **Step 5: 补测试（每处 1 越权用例）**

各文件对应测试补：传 `..` 段期望 throw（resolveWithinRoot 抛错）。

- [ ] **Step 6: 验证 + commit**

Run: `npx vitest run test/tools/validation.test.js test/tools/workflow.test.js test/tools/scene.test.js test/tools/delivery.test.js` + `npx tsc --noEmit`
```bash
git add src/tools/validation.ts src/tools/workflow.ts src/tools/scene/index.ts src/tools/delivery.ts src/tools/game-design.ts src/tools/batch-tools.ts test/
git commit -m "fix(security): A2/A6/A7/A9 TS 路径参数统一 resolveWithinRoot 校验"
```

---

## Task 3: 组2 user:// `..` 段拒绝（A3）

**Files:**
- Modify: `src/tools/workflow.ts`（:381 bridge.screenshot.path / :505 reference_path / :570 frames_dir）
- Test: `test/tools/workflow.test.js`

**Interfaces:**
- Produces: `hasTraversalSegments(p)` helper（module-internal 或 path-utils export）

- [ ] **Step 1: 写失败测试**

```js
it('dev_loop bridge.screenshot.path user://.. 写逃逸被拒', async () => {
  const args = { /* 合法 dev_loop 参数 */ bridge: { screenshot: { path: 'user://../../evil.png' } } };
  const r = await handleTool('dev_loop', args, ctx);
  expect(r.step2_bridge?.screenshot?.success).toBe(false); // 或 error 含 traversal
});
// 同样为 screenshot_diff reference_path 与 frame_degradation frames_dir 补用例
```

- [ ] **Step 2: 跑确认失败**

Run: `npx vitest run test/tools/workflow.test.js -t "user://"`
Expected: FAIL

- [ ] **Step 3: 实现 hasTraversalSegments + 三处用**

workflow.ts 顶部（或 path-utils export）加：
```ts
/** A3: user:// 分支 .. 段拒绝（对齐 command_helpers.gd has_path_traversal 语义）。统一 resolveWithinRoot 会破坏 user:// 语义，故最小补 .. 拒绝。 */
function hasTraversalSegments(p: string): boolean {
  return p.includes('/../') || p.startsWith('../') || p.endsWith('/..') || p === '..';
}
```
三处 `startsWith('user://')`（含 res://）分支内，放行前加：
```ts
if (hasTraversalSegments(rawPath)) { /* bridge: success:false error / assertion: passed:false error 'path traversal blocked' */ }
```

- [ ] **Step 4: 跑确认通过 + commit**

Run: `npx vitest run test/tools/workflow.test.js -t "user://"` + `npx tsc --noEmit`
```bash
git add src/tools/workflow.ts test/tools/workflow.test.js
git commit -m "fix(security): A3 workflow user://.. 穿越×3 补段级拒绝"
```

---

## Task 4: 组4 symlink 顺序（A4）

**Files:**
- Modify: `src/tools/game-bridge.ts`（readBridgeSecret，icacls ~:97 / chmod ~:106 / lstatSync ~:110）
- Test: `test/tools/game-bridge.test.js`（或 game-bridge 相关测试）

**Interfaces:**
- Produces: symlink 检查在权限收紧之前（对齐 editor-auth.ts:75-81）

- [ ] **Step 1: 写失败测试**

mock `lstatSync` 返 symlink（`isSymbolicLink: true`），调 readBridgeSecret，断言 `execFileSync('icacls', ...)` 与 `chmodSync` **未被调用**（顺序正确则副作用未发生）。用 vi.spyOn 计数。

- [ ] **Step 2: 跑确认失败**

Expected: FAIL（当前顺序 icacls/chmod 在 lstatSync 前，symlink 时副作用已发生）

- [ ] **Step 3: 实现**

readBridgeSecret 重排：lstatSync + symlink 拒绝移到 icacls/chmod **之前**。或抽 `assertNotSymlink(path)` helper（对齐 editor-auth.ts）两处复用。

- [ ] **Step 4: 跑确认通过 + commit**

Run: `npx vitest run test/tools/game-bridge.test.js` + `npx tsc --noEmit`
```bash
git add src/tools/game-bridge.ts test/tools/game-bridge.test.js
git commit -m "fix(security): A4 game-bridge symlink 检查移到权限收紧之前"
```

---

## Task 5: 组5 A5 asset_factory load traversal

**Files:**
- Modify: `addons/godot_mcp_server/commands/asset/asset_factory.gd`（:131 create_material material load）
- Test: `test/regression/defects.ts`（静态 detect 守卫，见 Task 8）

**Interfaces:**
- Consumes: `CommandHelpers.has_path_traversal`（command_helpers.gd:49）

- [ ] **Step 1: 实现**

asset_factory.gd:131 当前 `if s.begins_with("res://"): ... load(s)`，补 traversal 拒绝（对齐 command_helpers.gd:205 / ui_commands:283 / scene_commands:105）：
```gdscript
if CommandHelpers.has_path_traversal(s):
	return MaterialPresets.create("default")
```
（在 begins_with 检查后、load 前）

- [ ] **Step 2: GD 编译验证**

Run: `npx vitest run test/regression/check-gdscript.test.js`（或 `--import` 全量编译，参考 rule godot-mcp-editor.md）

- [ ] **Step 3: commit**

```bash
git add addons/godot_mcp_server/commands/asset/asset_factory.gd
git commit -m "fix(security): A5 asset_factory material load 补 has_path_traversal"
```

---

## Task 6: 组6 A10 instance coerce 全统一（最复杂）

**Files:**
- Modify: `addons/godot_mcp_server/commands/ui_commands.gd`（:68 ui_create_control / :326 ui_container_add / 删 :6-10 BLOCKED_PROPS）
- Modify: `addons/godot_mcp_server/commands/scene_commands.gd`（:131 instance_scene / :200 set_instance_property / 删 :115-119, :187-191 本地 blocked）
- Maybe: `addons/godot_mcp_server/commands/command_helpers.gd`（老 property_exists_and_type_ok 若无其他调用方则删）
- Test: `test/regression/defects.ts`（detect 守卫，见 Task 8）

**Interfaces:**
- Consumes: `CommandHelpers.coerce_property_value(obj, prop, val) -> {ok, value, error}`（command_helpers.gd:187）
- **关键约束**：coerce_property_value **只 coerce 不 set**，set 由 handler 经 undo do_op 执行（per-property undo：do=set new / undo=set old）。改 handler 须保留此 do_op set 流程。

- [ ] **Step 1: ui_commands ui_create_control（:68）改 coerce**

读当前 :68 用 `property_exists_and_type_ok` 的上下文。改为：
```gdscript
var coerced = CommandHelpers.coerce_property_value(node, key, val)
if not coerced.ok:
	return {"error": {"code": -32004, "message": coerced.error}}
# do_op set coerced.value（保留现有 undo do_op 流程）
```

- [ ] **Step 2: ui_commands ui_container_add（:326）同样改**

- [ ] **Step 3: scene_commands instance_scene（:131）+ set_instance_property（:200）同样改**

- [ ] **Step 4: 删本地 blocked 列表**

删 `ui_commands.gd:6-10` BLOCKED_PROPS + `scene_commands.gd:115-119` 和 `:187-191` 本地列表。统一用 `CommandHelpers.BLOCKED_PROPERTIES`（command_helpers.gd:174，含 instance）。

- [ ] **Step 5: grep 确认老函数去留**

`grep -rn "property_exists_and_type_ok" addons/`。若仅这 4 处（已改）+ 定义，删定义；若还有调用方，保留并注明 deprecated。

- [ ] **Step 6: GD 编译 + 手动验**

Run: GD `--import` 全量编译（addons）。
手动验（或 e2e）：ui_create_control 传 theme res:// 期望加载成功；传 instance 期望被拒（BLOCKED）。

- [ ] **Step 7: commit**

```bash
git add addons/godot_mcp_server/commands/ui_commands.gd addons/godot_mcp_server/commands/scene_commands.gd addons/godot_mcp_server/commands/command_helpers.gd
git commit -m "fix(security): A10 ui/scene property 改走 coerce_property_value + 删本地 blocked（instance 纵深统一）"
```

---

## Task 7: 组7 A8 凭证脱敏

**Files:**
- Modify: `src/core/logger.ts`（:129 sanitizeMsg 改 export + :413 error 字段套）
- Modify: `src/core/call-recorder.ts`（:49/57 msg 套 sanitizeMsg + import）
- Test: `test/core/logger.test.js` 或新增

**Interfaces:**
- Produces: `sanitizeMsg` 从 logger.ts export，call-recorder import 复用

- [ ] **Step 1: 写失败测试**

```js
it('call-recorder msg 经 sanitizeMsg 脱敏（secret pattern 不入库）', () => {
  const rec = getCallRecorder();
  rec.record('tool', false, 10, 'ERR', 'password=SECRET123 api_key=abc');
  const stats = rec.getStats();
  expect(JSON.stringify(stats.recentErrors)).not.toContain('SECRET123');
  expect(JSON.stringify(stats.recentErrors)).not.toContain('api_key=abc');
});
```

- [ ] **Step 2: 跑确认失败**

Expected: FAIL（当前 msg 原样入 recentErrors）

- [ ] **Step 3: export sanitizeMsg**

logger.ts:129 `function sanitizeMsg(msg: string): string {` 改 `export function sanitizeMsg(msg: string): string {`。

- [ ] **Step 4: logger.ts error 字段套**

logger.ts:413 `entry.error = err;` 改 `entry.error = sanitizeMsg(err instanceof Error ? err.message : String(err));`

- [ ] **Step 5: call-recorder.ts import + msg 套**

call-recorder.ts 顶部加 `import { sanitizeMsg } from './logger.js';`
:49 `this.recent.push({ ..., msg });` 改 `msg: sanitizeMsg(msg ?? '')`
:57 `this.recentErrors.push({ ..., msg: msg ?? '' });` 改 `msg: sanitizeMsg(msg ?? '')`

- [ ] **Step 6: 跑确认通过 + commit**

Run: `npx vitest run test/core/logger.test.js` + `npx tsc --noEmit`
```bash
git add src/core/logger.ts src/core/call-recorder.ts test/
git commit -m "fix(security): A8 logger error + call-recorder msg 套 sanitizeMsg"
```

---

## Task 8: defects.ts detect 守卫 + CHANGELOG（含 A11 否定论证）

**Files:**
- Modify: `test/regression/defects.ts`（A5/A10 detect 守卫 + :55 gdscript-template-injection 回标）
- Modify: `CHANGELOG.md`（Security 段 + A11 否定论证）

- [ ] **Step 1: A5 detect 守卫**

defects.ts 加（参照现有 countMatchesInFile 模式）：
```ts
{ key: 'asset-factory-load-traversal', status: 'fixed', severity: 'HIGH', dimension: 'Security',
  detect: () => readSrc('addons/godot_mcp_server/commands/asset/asset_factory.gd').includes('has_path_traversal'),
  desc: 'A5: asset_factory material load 前必须 has_path_traversal（2026-07-23 批次 A）' },
```

- [ ] **Step 2: A10 detect 守卫（本地 blocked 应消失）**

```ts
{ key: 'ui-scene-local-blocked-removed', status: 'fixed', severity: 'MEDIUM', dimension: 'Security',
  detect: () => !readSrc('addons/godot_mcp_server/commands/ui_commands.gd').match(/BLOCKED_PROPS\b/) &&
               !readSrc('addons/godot_mcp_server/commands/scene_commands.gd').match(/const.*BLOCKED/),
  desc: 'A10: ui/scene 本地 blocked 列表应删除，统一用 CommandHelpers.BLOCKED_PROPERTIES' },
```

- [ ] **Step 3: :55 gdscript-template-injection 回标**

defects.ts:55 该条 desc 补：`复发实例：data-import class_path（2026-07-23 批次 A1 修复，resolveWithinRoot 校验）`。

- [ ] **Step 4: CHANGELOG**

CHANGELOG.md `[Unreleased]` Security 段加批次 A 条目（A1-A10 修复），并加 A11 否定论证：
```markdown
### Fixed — Security（批次 A：RCE + 路径穿越，2026-07-23）

- A1 data-import `class_path` 补 root 校验（堵 RCE，gdscript-template-injection 复发实例）
- A2/A6/A7/A9 TS 路径参数统一 resolveWithinRoot
- A3 workflow user://.. 穿越×3 段级拒绝
- A4 game-bridge symlink 检查移到权限收紧前
- A5 asset_factory material load 补 has_path_traversal
- A8 logger error + call-recorder msg 套 sanitizeMsg
- A10 ui/scene property 改走 coerce_property_value + 删本地 blocked（instance 纵深统一）

### Not Fixed — 经审查否决

- ~~A11 find_node traversal~~：eng-review 否决（范畴错误）。find_node 唯一出口 `root.get_node_or_null` 纯内存，返 Node 零流入 load/DirAccess；NodePath `..` 是 Godot 父节点引用语法不逃逸场景树。若需禁 node_path `..` 应走 schema 契约变更（归 D 工具治理批次）。
```

- [ ] **Step 5: 跑全量 + 验收**

Run: `npx vitest run`（全量，确认不新增 failed；pre-existing 标注）+ `npx tsc --noEmit`
确认验收标准（spec §验收）：10 条修复 + detect 绿 + CHANGELOG 完整。

- [ ] **Step 6: commit**

```bash
git add test/regression/defects.ts CHANGELOG.md
git commit -m "test(security): 批次 A defects detect 守卫 + CHANGELOG（含 A11 否定论证）"
```

---

## Self-Review（plan 写完后自查）

1. **Spec 覆盖**：10 条 finding（A1-A10）每条有对应 task。A11 不立 task（eng-review 否决）。✓
2. **类型一致**：coerce_property_value 返回 {ok,value,error}（Task 6 用 coerced.ok/coerced.value/coerced.error，与 command_helpers.gd:187 一致）。✓
3. **依赖顺序**：Task 7 export sanitizeMsg 在 call-recorder import 前（同 task 内）。Task 8 detect 依赖 Task 5/6 改完。✓
4. **A1 defects 回标**：Task 8 Step 3 回标 defects.ts:55。✓
5. **A11 否定论证**：Task 8 Step 4 CHANGELOG 留否定论证。✓

## Execution Handoff

Plan 完成保存到 `docs/superpowers/plans/2026-07-23-batchA-security.md`。两个执行选项：

1. **Subagent-Driven（推荐）**：每个 task 派 fresh subagent，task 间 review，快速迭代。
2. **Inline Execution**：本会话 executing-plans，批量执行 + checkpoint。

哪个？
