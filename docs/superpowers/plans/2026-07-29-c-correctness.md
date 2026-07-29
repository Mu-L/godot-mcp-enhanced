# C-Correctness 正确性修复批次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-07-29 审查 C 批次 7 条正确性 finding（1 P1 + 6 P2）：nav freed 对象访问、nav status 硬编码、doctor BOM、readCache 无上限、updateAddon 非原子、adapter 文件权限丢失、adapter env 覆盖。

**Architecture:** 7 条互相独立，按"简单 GDScript/TS → 中等 → C1 adapter env（最大，13 文件）"排序。每条 TDD（RED→GREEN），正确性类须含反向断言，每修补 `defects.ts` detect 防复发。GDScript 改（N1/N2 nav_commands.gd）须 check:gdscript 双版本。adapter 改（F3/C1）跨 13 文件，C1 抽共享 buildEnv helper。

**Tech Stack:** TypeScript（src/cli/、src/core/）、GDScript（addons/）、vitest、check:gdscript（4.6.3+4.7.1）、defects.ts。

## 关键决策（已与用户对齐）

1. **C1 env 合并**：白名单合并。抽 `buildEnv(godotPath, oldEntry?)` 共享 helper，reconfigure 时白名单保留 `ALLOWED_PROJECT_PATHS` / `GODOT_MCP_BRIDGE_*` / `GODOT_MCP_EDITOR_*` 前缀（对齐 buildSafeEnv 前缀策略），过滤脏值。
2. **S3 原子化**：平台分支 staging+备份+rename。POSIX `renameSync` 真原子；Windows `rmSync(dest)+renameSync(staging,dest)`（非纯原子，但 staging 已校验 + dest.bak 备份回滚）。
3. **F3 mode**：跨平台加 mode 保持。写 tmp 前 `statSync(configPath)` 取旧 mode（不存在跳过），`writeFileSync(tmp, data, { mode: oldMode & 0o777 })`。Windows no-op 无害，Unix 修复 0o600 覆盖。

## Global Constraints

- master 不 push，push 须 AskUserQuestion 显式确认
- 每条补 `test/regression/defects.ts` detect 防复发（行号/计数基线写前 grep 实测）；defects 110→117（+7）
- 正确性类须含**反向断言**（freed 不访问 / status 派生 / BOM 处理 / 上限拒绝 / 原子回滚 / mode 保持 / env 合并保留）
- `.gd` 改后 `validate_scripts` + `check:gdscript` 双版本（4.6.3+4.7.1 --import 真编译）；TS 改后 `tsc` 0
- adapter 改（F3/C1）跨 13 文件，须 grep 确认全覆盖 + 跨文件一致（C1 buildEnv helper 单一数据源）
- 验收门禁：tsc 0 / eslint 0 / check:gdscript 0-0 / vitest 全 passed / defects-fixed 117/117

## File Structure

| 文件 | 职责 | Task |
|---|---|---|
| `addons/.../nav_commands.gd` | freed 分支删信号访问（:137-138/190-191）+ status 派生（:163/199） | T1/T2 |
| `src/cli/doctor.ts` | 改用 readJsonForCheck（:44） | T3 |
| `src/core/update-checker.ts` | readCache 加 statSync 64KB + latest.length≤64（:41-48） | T4 |
| `src/cli/clients/*.ts`（13） | writeFileSync 加 mode 保持（F3）+ env 白名单合并（C1） | T5/T7 |
| `src/cli/clients/json-config.ts` 或新 helper | buildEnv 共享 helper（C1） | T7 |
| `src/core/addon-version.ts` | updateAddon 原子化（:44，A-RCE T1 后基础） | T6 |
| `test/regression/defects.ts` | 7 条 detect | T8 |

---

## Task 1: N1 nav freed 对象访问

**Files:**
- Modify: `addons/godot_mcp_server/commands/nav_commands.gd:136-139`（create_region async）+ `:189-192`（bake_mesh async）
- Test: `test/regression/nav-freed.test.ts`（字面量契约，读 .gd）+ check:gdscript 双版本

**背景**：freed 分支（`if not is_instance_valid(nav)`）后访问 `nav.bake_finished.is_connected/disconnect`——freed 对象属性访问致 -32003 丢失。headless navigation.ts:45 直接 return 不碰信号。

- [ ] **Step 1: 写字面量契约测试（RED）**

```typescript
it('N1: freed branch does not access nav.bake_finished (freed object)', () => {
  const gd = readFileSync(join(__dirname, '../../addons/godot_mcp_server/commands/nav_commands.gd'), 'utf-8');
  // 定位两处 freed 分支（create_region + bake_mesh async）
  const branches = gd.match(/if not is_instance_valid\(nav\):[\s\S]{0,200}?return \{"error"/g);
  expect(branches?.length, '两个 freed 分支').toBe(2);
  // 反向：freed 分支内不得访问 nav.bake_finished（信号随对象释放自动断开）
  for (const b of branches!) {
    expect(b).not.toMatch(/nav\.bake_finished/);
  }
});
```

- [ ] **Step 2: 验证失败**

Run: `npx vitest run test/regression/nav-freed.test.ts`
Expected: FAIL（freed 分支含 nav.bake_finished）

- [ ] **Step 3: 实现（删 freed 分支信号访问）**

`nav_commands.gd` 两处 freed 分支（:136-139 + :189-192）改为直接 return：
```gdscript
# create_region async :136
if not is_instance_valid(nav):
	# N1: freed 对象不碰信号（信号随对象释放自动断开），直接 return（对齐 headless navigation.ts:45）
	return {"error": {"code": -32003, "message": "NavigationRegion3D freed during bake"}}
```
bake_mesh async :189 同理（删 :190-191 的 is_connected/disconnect）。用 edit_script search_and_replace（CRLF/tab 安全）或内置 Edit（完整分支替换）。

- [ ] **Step 4: check:gdscript 双版本 + GREEN**

```bash
npm run check:gdscript   # 0 err 0 warn
npx vitest run test/regression/nav-freed.test.ts
```
Expected: check:gdscript 0-0；测试 PASS

- [ ] **Step 5: 补 detect（T8）+ commit**

key: `nav-freed-access-signal`。commit:
```bash
git commit -m "fix(correctness): N1 nav freed 分支删信号访问(freed 对象)

两处 freed 分支(create_region/bake_mesh async)删 nav.bake_finished.is_connected/
disconnect, 直接 return(对齐 headless navigation.ts:45)。freed 对象属性访问致
-32003 丢失。
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: N2 nav status 动态派生

**Files:**
- Modify: `nav_commands.gd:163`（sync bake_mesh）+ `:199`（async bake_mesh）
- Test: 字面量契约 + check:gdscript

**背景**：:163 sync `status: "bake_completed"` 硬编码但 success 可 false；:199 async 硬编码与 `_bake_state["done"]==false`（deadline exhausted）矛盾。

- [ ] **Step 1: 字面量契约测试（RED）**

```typescript
it('N2: bake status derived from success/_bake_state (not hardcoded)', () => {
  const gd = readFileSync('addons/.../nav_commands.gd', 'utf-8');
  // 反向：不再有硬编码 "status": "bake_completed"（字面量）
  expect(gd).not.toMatch(/"status":\s*"bake_completed"/);
  // 正向：status 按 success 或 _bake_state 派生
  expect(gd).toMatch(/success\s*\?\s*"bake_completed"\s*:\s*"bake_failed"|_bake_state\["done"\]/);
});
```

- [ ] **Step 2-3: 实现 status 派生**

sync `:163`：`"status": "bake_completed"` → `"status": "bake_completed" if success else "bake_failed"`（GDScript 三元）
async `:199`：`"status": "bake_completed"` → `"status": "bake_completed" if _bake_state["done"] else "bake_timeout"`

- [ ] **Step 4: check:gdscript + GREEN + commit**

key: `nav-status-hardcoded`。

---

## Task 3: F5 doctor stripBom

**Files:**
- Modify: `src/cli/doctor.ts:44`
- Test: `test/cli/doctor.test.ts`（若有）或新

**背景**：`:44 JSON.parse(readFileSync(...))` 未 stripBom，带 BOM 的 mcp-godot.json throw→catch 吞错，Godot override 静默不显示。readJsonForCheck（json-config.ts:46，含 stripBom + null）已存在。

- [ ] **Step 1: 写失败测试（RED）** — mock 一个带 BOM 的 mcp-godot.json，断言 doctor 不 throw 且能读到 Godot override。

- [ ] **Step 2-3: 改用 readJsonForCheck**
```typescript
import { readJsonForCheck } from './clients/json-config.js';
// :44
const config = readJsonForCheck(mcpConfigPath);
if (!config) { /* skip — 文件不存在或损坏 */ }
```

- [ ] **Step 4: GREEN + commit**。key: `doctor-no-stripbom`。

---

## Task 4: S2 readCache 字节上限

**Files:**
- Modify: `src/core/update-checker.ts:41-48`
- Test: `test/core/update-checker.test.ts`

**背景**：readCache 无 statSync 上限（大文件 OOM）+ 无 `obj.latest.length<=64`（latest 任意长）。

- [ ] **Step 1: 写失败测试（RED）** — mock cache 文件 >64KB 或 latest.length>64，断言 readCache 返 null（拒绝）。

- [ ] **Step 2-3: 加上限**
```typescript
function readCache(cachePath): CacheData | null {
  if (!existsSync(cachePath)) return null;
  if (statSync(cachePath).size > 64 * 1024) return null;  // S2: 防大文件 OOM
  let obj;
  try { obj = JSON.parse(readFileSync(cachePath, 'utf-8')); } catch { return null; }
  if (typeof obj.lastCheck === 'number' && typeof obj.latest === 'string'
      && obj.latest.length <= 64) return obj;  // S2: latest 长度上限
  return null;
}
```

- [ ] **Step 4: GREEN + commit**。key: `readcache-no-byte-limit`。

---

## Task 5: F3 adapter 文件权限保持

**Files:**
- Modify: `src/cli/clients/*.ts`（13）writeFileSync 加 mode
- Test: `test/cli/clients/*.test.ts`（抽一个 adapter 测 mode 保持）

**背景**：13 adapter `writeFileSync(tmpPath, data, 'utf-8')` 第三参是 encoding 非 mode。tmp 默认 0o666 & ~umask，rename 后覆盖原文件 mode（用户 chmod 600 的配置被破坏）。

**决策**：跨平台加 mode（Windows stat.mode 无意义=no-op，Unix 修复）。

- [ ] **Step 1: 写失败测试（RED）** — mock 原文件 mode 0o600，writeFileSync 后断言 tmp/新文件 mode 保持 0o600（Unix）/ Windows 跳过（process.platform 检查）。

- [ ] **Step 2-3: 13 adapter 加 mode**
每个 adapter 的 writeFileSync 前加：
```typescript
let writeFileMode: number | undefined;
try { writeFileMode = statSync(configPath).mode & 0o777; } catch { /* 不存在跳过 */ }
writeFileSync(tmpPath, data, writeFileMode !== undefined ? { mode: writeFileMode, encoding: 'utf-8' } : 'utf-8');
```
implementer 先 grep `writeFileSync.*'utf-8'` in src/cli/clients 确认 13 处全覆盖。可抽 `writeFileAtomicWithMode(configPath, data)` helper（json-config.ts）复用，13 adapter 调用——DRY 单一数据源。

- [ ] **Step 4: GREEN + commit**。key: `adapter-no-mode-preserve`。

> 注：F3 + C1 都改 adapter。F3 先（mode），C1 后（env），不同行，sequential 无冲突。

---

## Task 6: S3 updateAddon 原子化

**Files:**
- Modify: `src/core/addon-version.ts:44`（A-RCE T1 后的 cpSync）
- Test: `test/addon-version.test.ts`

**背景**：`:44 cpSync(addonSource, dest)` 裸非原子（中断留破损 addon）。A-RCE T1 已加 S1 symlink 校验（:35-42），S3 在其上加原子化。

**决策**：平台分支 staging+备份+rename。

- [ ] **Step 1: 写失败测试（RED）** — mock cpSync 中途失败（staging 不完整），断言 dest 保持原状（备份回滚）+ 不留破损。

- [ ] **Step 2-3: 原子化**
```typescript
// S3: 原子替换。staging 完整 cp + 校验 + 备份 + 平台 rename
const staging = join(real, '.addon-staging-' + process.pid);
rmSync(staging, { recursive: true, force: true });
cpSync(addonSource, staging, { recursive: true });
// 校验 staging 完整
const stagingCfg = readFileSync(join(staging, 'plugin.cfg'), 'utf-8');
if (!stagingCfg.includes('[plugin]') || !stagingCfg.includes('script="plugin.gd"')) {
  rmSync(staging, { recursive: true, force: true });
  throw new Error('updateAddon staging verify failed (plugin.cfg missing/invalid)');
}
// 备份旧 dest（若存在）
let backup: string | null = null;
if (existsSync(dest)) { backup = dest + '.bak'; rmSync(backup, { recursive: true, force: true }); renameSync(dest, backup); }
try {
  if (process.platform === 'win32') {
    // Windows renameSync 不能覆盖非空目录：rm + rename（非纯原子，但 staging 完整 + 备份回滚）
    renameSync(staging, dest);
  } else {
    // POSIX rename 原子
    renameSync(staging, dest);
  }
  if (backup) rmSync(backup, { recursive: true, force: true });  // 成功后清备份
} catch (err) {
  // 回滚：恢复备份
  if (backup) { try { renameSync(backup, dest); } catch { /* best-effort */ } }
  rmSync(staging, { recursive: true, force: true });
  throw err;
}
const verifyOk = readFileSync(join(dest, 'plugin.cfg'), 'utf-8').includes('[plugin]');
return { dest, verifyOk: verifyOk && isPathInAllowedRoots(safeRealPath(join(dest, 'plugin.cfg'))) };
```
⚠ implementer 核实 Windows rmSync(dest) 已删 dest 后 renameSync(staging→dest)：若 rm 与 rename 间中断，dest 丢失但 staging 完整（可手动 rename）。备份 dest.bak 是额外回滚。plan 接受此 best-effort（用户决策）。

- [ ] **Step 4: GREEN + commit**。key: `addon-update-nonatomic`。

> S3 改 updateAddon，A-RCE T1 的 S1 校验（:35-42）保留不动。

---

## Task 7: C1 adapter env 白名单合并（最大，P1）

**Files:**
- Modify: `src/cli/clients/*.ts`（13）env 写入 + 新 `buildEnv` helper
- Test: `test/cli/setup.test.ts`（补真文件级测试，当前全 mock 零覆盖）+ `test/cli/clients/*.test.ts`

**背景**：13 adapter env 写入用 `env: { GODOT_PATH: godotPath }`（覆盖，不合并 oldEntry.env）。用户配的 ALLOWED_PROJECT_PATHS / GODOT_MCP_BRIDGE_* 重跑 setup 静默丢失。复发 DEFECT cli-configure-env-field-overwrite。

**决策**：白名单合并。抽 `buildEnv(godotPath, oldEntry?)` helper。

- [ ] **Step 1: 写失败测试（RED）**

```typescript
it('C1: reconfigure preserves whitelisted user env (ALLOWED_PROJECT_PATHS/GODOT_MCP_BRIDGE_*)', () => {
  // 模拟旧 mcpServers.godot.env 含 ALLOWED_PROJECT_PATHS + GODOT_MCP_BRIDGE_PERSISTENT_SECRET + 脏值
  // configure 后断言：新 env 含 GODOT_PATH(godotPath) + ALLOWED_PROJECT_PATHS(保留) + GODOT_MCP_BRIDGE_*(保留) + 不含脏值
});
```
setup.test.ts 当前全 mock（configure: vi.fn），补真文件级测试（写 settings.json + 读回断言 env）。

- [ ] **Step 2-3: buildEnv helper + 13 adapter 改**

新 helper（json-config.ts 或 clients/helpers.ts）：
```typescript
const ENV_PRESERVE_PREFIXES = ['ALLOWED_PROJECT_PATHS', 'GODOT_MCP_BRIDGE_', 'GODOT_MCP_EDITOR_'];
/** C1: 白名单合并保留用户配的安全相关 env（对齐 buildSafeEnv 前缀策略）。 */
export function buildEnv(godotPath: string, oldEnv?: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = { GODOT_PATH: godotPath };
  if (oldEnv) {
    for (const [k, v] of Object.entries(oldEnv)) {
      if (ENV_PRESERVE_PREFIXES.some(p => k === p || k.startsWith(p)) && typeof v === 'string') {
        env[k] = v;
      }
    }
  }
  return env;
}
```
13 adapter env 写入改：`env: buildEnv(godotPath, oldEntry?.env ?? oldGodotEnv)`。implementer 先 grep 每 adapter 的 env 写入结构（settings.json mcpServers.godot.env / codex --env / opencode environment 等），对齐 oldEnv 来源（读旧配置的 godot.env）。核实 buildSafeEnv（helpers.ts:148 附近）前缀清单对齐。

- [ ] **Step 4: GREEN + commit**。key: `adapter-env-field-overwrite`。

> C1 是 13 文件 + helper + 测试，最大 task。implementer 仔细对齐 13 adapter 的 oldEnv 读取（结构各异）。

---

## Task 8: defects.ts 7 条 detect + 门禁收尾

**Files:**
- Modify: `test/regression/defects.ts`（+7 detect）+ `defects-fixed.test.ts`（length 110→117）+ 头注 + `CHANGELOG.md`

- [ ] **Step 1: 补 7 条 detect**（每条 task 已记 key）：
  - `nav-freed-access-signal`（freed 分支不含 nav.bake_finished）
  - `nav-status-hardcoded`（status 派生非硬编码）
  - `doctor-no-stripbom`（doctor 用 readJsonForCheck）
  - `readcache-no-byte-limit`（readCache 含 statSync 64KB + latest.length）
  - `addon-update-nonatomic`（updateAddon 含 staging + rename 非裸 cpSync）
  - `adapter-no-mode-preserve`（writeFileSync 含 mode 或 writeFileAtomicWithMode）
  - `adapter-env-field-overwrite`（env 用 buildEnv 合并非裸 { GODOT_PATH }）

- [ ] **Step 2: 计数同步**：头注 110→117 + defects-fixed.test.ts:139/141（.toBe 110→117）+ :2 注释 + 头注 C 段描述。跑 defects-fixed 确认 117 绿。

- [ ] **Step 3: 全量门禁**
```bash
npx tsc --noEmit && npx eslint src --max-warnings 999 && npm run check:gdscript && npm test && npm run test:regression
```
Expected: tsc 0 / eslint 0 / check:gdscript 0-0 / vitest 全 passed / defects-fixed 117/117

- [ ] **Step 4: CHANGELOG [Unreleased] Fixed Correctness (C 批次) 段** + final commit + `superpowers:requesting-code-review`（opus）。重点：C1 13 adapter 跨文件一致 / S3 原子回滚 / N1-N2 GDScript 双版本编译 / F3 mode Windows no-op。

---

## Self-Review

**1. Spec coverage**：7 finding（C1/N1/N2/F5/S2/S3/F3）→ T1-T7 各一条 + T8 detect/门禁。✅ 全覆盖。

**2. Type consistency**：
- `buildEnv(godotPath, oldEnv?)`（T7）↔ 13 adapter 调用
- `readJsonForCheck`（T3 复用 json-config.ts:46 既有）
- staging/backup/rename（T6 平台分支）
- ENV_PRESERVE_PREFIXES（T7）↔ buildSafeEnv 前缀对齐

**3. 关键风险（review 重点）**：
- C1（T7）13 adapter oldEnv 读取结构各异（settings.json/codex --env/opencode environment），buildEnv 接入须逐 adapter 核实
- S3（T6）Windows rm+rename 非纯原子，备份回滚链完整
- N1/N2（T1/T2）GDScript 改须 check:gdscript 双版本
- F3（T5）13 adapter mode 写入，DRY helper（writeFileAtomicWithMode）单一数据源
- detect 反假绿（7 条全查"调用/派生"非"字符串存在"）
