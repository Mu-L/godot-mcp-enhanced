# E-101 e2e-scene/.godot 缓存清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `test/e2e-p1-p5.test.ts` 每次本地运行以 CI fresh-checkout 的干净 `.godot/` 状态起步，防过期导入缓存致 P3-import 断言假绿。

**Architecture:** 在现有 `beforeAll` 顶部加一行 `rmSync(resolve(E2E_DIR,'.godot'),{recursive:true,force:true})`，递归清整个 `.godot/`。`force:true` 保证路径不存在（CI/首跑）不抛错。无新依赖（`rmSync`/`resolve` 已 import）。P3-import 随后重新 warmup 生成 `.godot/imported`，P3-skip 第二次跳过 import（绝对耗时阈值 30s，不受 wipe 影响）。

**Tech Stack:** Node.js `fs`（`rmSync`）、vitest `beforeAll`、Godot 4.7（e2e 实跑，`GODOT_PATH=D:\godot\Godot_v4.7-stable_win64.exe`）。

**Spec:** `docs/superpowers/specs/2026-07-30-e-101-e2e-scene-cache-cleanup-design.md`（commit `4851ed9`）

## Global Constraints

- **基线（实测，HEAD a581b6d）**：全量 `npm test` = **4277 passed | 24 skipped（4301）**，290 test files passed | 3 skipped，112s。改动后须 ≥ 此（无新增 fail/skip）。
- **GODOT_PATH 必须可用**（本机 `D:\godot\Godot_v4.7-stable_win64.exe`），否则 e2e-p1-p5 `describe.skipIf(!hasGodot)` 跳过、无法本地验证（须靠 CI godot-matrix job）。
- **不动** `.gitignore`（:36 已正确）、ci.yml（CI fresh checkout 已干净）、`defects.ts`（测试工程治理非代码缺陷）。
- **CHANGELOG 入**（用户 override）：在 `[Unreleased]` 加 `### Fixed — Test Quality` 子段补一行。grep 证实同族 `:95`/`:97b`/`:98` 均未入 CHANGELOG（惯例＝内部测试改进不入），但用户拍板 `:101` 入 → 首个 test-quality 条目。
- **出范围（Option 1）**：`test/e2e-scene/NVIDIA Corporation/` 残留、CI 防御性 rm-rf。
- **提交惯例**：直接 commit master 本地、不 push（[[user-prefers-local-ahead-no-push]]）；commit message 带 `Co-Authored-By: Claude` trailer。
- **路径**：所有引用用绝对路径（`D:\GitHub\godot-mcp-enhanced\...`），shell 命令在仓库根 `D:/GitHub/godot-mcp-enhanced` 下跑（Git Bash，正斜杠）。

> **CHANGELOG 决定（用户 override）**：plan 初稿据同族先例（`:95`/`:97b`/`:98` 未入 CHANGELOG）建议不入；用户拍板 **入**（首个 test-quality 条目）。故 plan 保留 CHANGELOG 步骤（Step 8），提交含 `CHANGELOG.md`。

## File Structure

- **Modify** `D:\GitHub\godot-mcp-enhanced\test\e2e-p1-p5.test.ts`（`beforeAll`，行 48-51）— 顶部加 wipe 行 + 4 行注释。单消费者，不抽 helper（YAGNI）。
- **Modify** `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md` — `[Unreleased]` 末尾、`## [0.24.1]` 前加 `### Fixed — Test Quality` 子段一行。
- 不新增文件、不动其他文件。

---

### Task 1: beforeAll 加 .godot 清理 + CHANGELOG

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\test\e2e-p1-p5.test.ts:48`（现有 `beforeAll` 顶部插入）
- Modify: `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md`（`[Unreleased]` 末尾加 `### Fixed — Test Quality` 子段）

**Interfaces:**
- Consumes: `rmSync`（已 import 行 12 `from 'fs'`）、`resolve`（已 import 行 13 `from 'path'`）、`E2E_DIR`（行 23 = `resolve(__dirname, 'e2e-scene')`）
- Produces: `beforeAll` 副作用——每次文件运行开始清空 `test/e2e-scene/.godot/`，让 P3-import（行 168-178）的 `.godot/imported` 存在断言（行 176-177）命中本次 warmup 生成而非上次残留。

- [ ] **Step 1: 读 beforeAll 现状确认放置点**

Run: `sed -n '48,51p' D:/GitHub/godot-mcp-enhanced/test/e2e-p1-p5.test.ts`
Expected（4 行）：
```
beforeAll(() => {
  _snap3d = readFileSync(SCENE_3D, "utf-8");
  _snap2d = readFileSync(SCENE_2D, "utf-8");
});
```

- [ ] **Step 2: RED 演示——确认当前 beforeAll 不清 .godot（放 sentinel，跑后仍在）**

```bash
cd D:/GitHub/godot-mcp-enhanced
# .godot/ 根目录放 sentinel（Godot 不会动根目录的随机文件）
mkdir -p test/e2e-scene/.godot && echo stale > test/e2e-scene/.godot/STALE_SENTINEL
# 跑 e2e-p1-p5（当前 beforeAll 无 wipe）
npx vitest run test/e2e-p1-p5.test.ts
# 跑完后 sentinel 应仍在 = 未被清理（RED）
test -f test/e2e-scene/.godot/STALE_SENTINEL && echo "RED: sentinel 仍在 → beforeAll 未清理" || echo "意外：sentinel 已消失"
```
Expected: 测试全绿（P1-P5）+ 末行 `RED: sentinel 仍在 → beforeAll 未清理`（证明当前无清理 → 假绿入口存在）。

- [ ] **Step 3: 实现——beforeAll 顶部加 wipe + 注释**

把 `test/e2e-p1-p5.test.ts` 的 `beforeAll`（行 48-51）改为：

```ts
beforeAll(() => {
  // :101（报告4 P2-10）: 清理上次运行的 .godot 缓存（imported/uid_cache/editor 状态），
  // 让本地运行以 CI fresh-checkout 的干净状态起步，防过期导入缓存致假通过。
  // 无此清理时 P3-import 的 `.godot/imported` 存在断言会命中残留目录而假绿。
  // .godot/ 已 gitignore（行 36），CI fresh checkout 本就无此目录——清理纯为本地一致性。
  rmSync(resolve(E2E_DIR, '.godot'), { recursive: true, force: true });
  _snap3d = readFileSync(SCENE_3D, "utf-8");
  _snap2d = readFileSync(SCENE_2D, "utf-8");
});
```

（编辑方式：本文件是 `.ts`（非 `.gd`），内置 Edit 工具可用——`old_string` = 原 4 行 beforeAll 体，`new_string` = 上面的完整块。）

- [ ] **Step 4: GREEN 演示——wipe 生效（放 sentinel，跑后已被 beforeAll 清掉）**

```bash
cd D:/GitHub/godot-mcp-enhanced
mkdir -p test/e2e-scene/.godot && echo stale > test/e2e-scene/.godot/STALE_SENTINEL
npx vitest run test/e2e-p1-p5.test.ts
# 跑完后 sentinel 应已被 beforeAll 清掉（GREEN）
test -f test/e2e-scene/.godot/STALE_SENTINEL && echo "意外：sentinel 仍在" || echo "GREEN: sentinel 已被 beforeAll 清掉"
```
Expected: 测试全绿（含 P3-import 重新 warmup / P3-skip 第二次跳过）+ 末行 `GREEN: sentinel 已被 beforeAll 清掉`。

- [ ] **Step 5: 确认 P3-skip 耗时断言形态不被 wipe 干扰（读代码确认）**

Run: `sed -n '180,197p' D:/GitHub/godot-mcp-enhanced/test/e2e-p1-p5.test.ts`
Expected: P3-skip 的耗时断言为 `expect(duration).toBeLessThan(30_000)`，其中 `duration = Date.now() - start`（行 181 `start` / 行 188 `duration`）只包**第二次** executeGdscript，是**绝对阈值**（非"第二次<第一次"相对比较）。第二次因 `.godot/imported` 已被 P3-import 重新生成而 skip import → ~4s（行 192 注释自述 3.87s），wipe 不影响。形态符合则继续；若已被改成相对比较，停下评估。

- [ ] **Step 6: 全量回归对比基线**

Run: `cd D:/GitHub/godot-mcp-enhanced && npm test 2>&1 | tail -8`
Expected: `Tests  4277 passed | 24 skipped (4301)`（与基线一致，无新增 fail/skip）。若数字下降或有 failed，停下排查，不盲提交。
> stderr 的 `[gdscript] cleanup stale dirs ... EPERM/EBUSY` 是 pre-existing Windows 句柄占用（P3-skip 注释已载），忽略。

- [ ] **Step 7: tsc 类型检查**

Run: `cd D:/GitHub/godot-mcp-enhanced && npx tsc --noEmit`
Expected: 0 errors。
> IDE new-diagnostics 报的 `security-paths.test.js` unused `resolve` / `helpers.test.js` `allowOutsideProjectPaths` deprecated 是 **E-95 遗留 pre-existing**（非本次引入），以 tsc 实测为准 [[new-diagnostics-stale-transient]]。

- [ ] **Step 8: CHANGELOG 入（用户 override，首个 test-quality 条目）**

在 `D:\GitHub\godot-mcp-enhanced\CHANGELOG.md` 的 `[Unreleased]` 段末尾、`## [0.24.1] - 2026-07-27` 之前插入新子段：

```
### Fixed — Test Quality

- **e2e beforeAll 清理 `.godot` 缓存**：`test/e2e-p1-p5.test.ts` 的 `beforeAll` 加 `rmSync(test/e2e-scene/.godot, recursive)`，本地运行以 CI fresh-checkout 干净状态起步，防过期导入缓存致 P3-import 的 `.godot/imported` 存在断言命中残留目录而假绿（:101，报告4 P2-10）。
```

- [ ] **Step 9: 提交（测试文件 + CHANGELOG）**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add test/e2e-p1-p5.test.ts CHANGELOG.md
git commit -m "$(cat <<'EOF'
test(e2e): E-101 e2e-p1-p5 beforeAll 清理 .godot 缓存（报告4 :101）

- beforeAll 顶部加 rmSync(resolve(E2E_DIR,'.godot'),{recursive,force})
- 让本地运行以 CI fresh-checkout 干净状态起步，防过期导入缓存致假通过
- P3-import 的 .godot/imported 存在断言（行 176-177）不再命中残留目录而假绿
- 范围核实收窄：不入库已真（gitignore:36）/ CI rm-rf 无必要（fresh checkout）
  → 仅做 beforeAll 清理（Option 1）
- CHANGELOG 入（用户 override，首个 test-quality 条目；同族惯例本不入）
- 不进 defects.ts；基线 4277 passed | 24 skipped 实测无回归

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```
Expected: `2 files changed`（`test/e2e-p1-p5.test.ts` + `CHANGELOG.md`）。

---

## Self-Review

**1. Spec coverage：**
- spec Goal（beforeAll wipe）→ Task 1 Step 3 ✅
- spec「三条策略收窄到一条」→ Global Constraints + commit message ✅
- spec 验收 #1（beforeAll 含 wipe 行）→ Step 3/4 ✅
- spec 验收 #2（tsc 0 + 全量绿 vs 基线 4277/24）→ Step 6/7 ✅
- spec 验收 #3（P3-import 过期 marker 场景仍绿且命中本次 warmup）→ Step 2/4 RED-GREEN sentinel ✅
- spec 验收 #4（.gitignore/ci.yml 无回归，diff 只动测试文件 + CHANGELOG）→ Step 9 `git add` 仅两文件 ✅
- spec「CHANGELOG 补一行」→ Step 8（用户 override：入，首个 test-quality 条目）✅
- spec 出范围（NVIDIA/CI rm-rf 不动）→ Global Constraints ✅

**2. Placeholder scan：** 无 TBD/TODO/"适当处理"。所有 step 含具体命令/代码/期望输出。无占位符。

**3. Type consistency：** `rmSync(resolve(E2E_DIR, '.godot'), { recursive: true, force: true })` 在 Step 3/4/commit message 全一致；`E2E_DIR` 一致。✅

**结论：** 覆盖完整，CHANGELOG 已按用户决定纳入（Step 8）。可执行。
