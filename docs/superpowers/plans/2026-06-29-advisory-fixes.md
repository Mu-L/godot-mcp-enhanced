# R3 ADVISORY 批量修复实施计划（11 条）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 R3 报告 11 条 ADVISORY（device_serial 注释/spawnGodot 测试/XDG/TOOL_META 注释/裸 as/isGodotVersionSignature/_doConnect/advanced-proxy/instance 脱敏/includes('..')/test-framework 双重编码）。

**Architecture:** 按文件聚合 8 代码 task + defects 同步 + 验证。纯小改（注释/正则/路径段/脱敏/size 上限），无新模块。

**Tech Stack:** TypeScript（src）、vitest（test）、Godot MCP。

## Global Constraints

- 项目 root：`D:\GitHub\godot-mcp-enhanced`；**master 直接提交**（CRITICAL/IMPORTANT 已确认）
- **每个 commit 前 `git branch --show-current` 确认在 master**（教训：并发会话共享 HEAD 曾致 commit 落错 feature，见 memory `concurrent-claude-sessions-shared-worktree`）
- commit message 中文 + 尾部 `Co-Authored-By: Claude <noreply@anthropic.com>`
- TDD：失败测试 → 修复 → 通过 → commit
- 单测：`node node_modules/vitest/dist/cli.js run <file> -t "<name>"`；全量 `... run`
- tsc：`node node_modules/typescript/bin/tsc --noEmit`
- .ts 用内置 Edit；同文件多 Edit 串行
- defects.md（review repo）用 Edit（Bash node -e 被权限拒）
- spec：`docs/superpowers/specs/2026-06-29-advisory-fixes-design.md`

---

## File Structure

| 文件 | 改动 |
|------|------|
| `src/tools/android.ts` | #1 注释 / #3 XDG / #4 TOOL_META 注释 |
| `test/android.test.ts` | #2 spawnGodot export 参数断言 |
| `src/core/godot-finder.ts` | #6 isGodotVersionSignature 收紧 |
| `src/tools/game-bridge.ts` | #7 _doConnect 显式 _invalidateSocket |
| `src/tools/advanced-proxy.ts` | #8 toolArgs size 256KB + 审计（dynamic + delegate） |
| `src/tools/instance-tools.ts` | #9 select_instance 脱敏 projectPath |
| `src/tools/load-skill-search.ts` + `recording.ts` + `scene/scene-instance.ts` | #10 includes('..') → 段级（3 处） |
| `src/tools/test-framework.ts` | #11 gdEscape(String(expected)) |
| 全局 | #5 裸 as grep + 高风险改 |
| `defects.md`（review repo） | #10 复发立条 + status |

---

## Task 1: android（#1 注释 + #3 XDG + #4 TOOL_META + #2 测试）

**Files:** `src/tools/android.ts`（:130/:193-199/:318）; Test `test/android.test.ts`

- [ ] **Step 1: 写失败测试**（test/android.test.ts 末尾加）
  - #2：deploy 测试断言 `spawnGodot` 调用参数含 preset 名（mock spawnGodot，调 deploy，`expect(spawnGodot).toHaveBeenCalledWith(expect.stringMatching(/godot/), expect.arrayContaining(['--export']), ...)` 或类似——执行时读 spawnGodot 签名 + deploy 调用确认精确断言）
- [ ] **Step 2: 运行验证失败**（#2 断言缺失）
- [ ] **Step 3: 修复 android.ts**
  - #3 `:130` `return join(home, '.local', 'share', 'godot')` → `return join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'godot')`
  - #1 `:193-199`（validateDeviceSerial）补注释：`// 纵深防御: execFileSync 自身无 shell, 此检查针对 adb shell 设备端注入(adb 把 args join 传设备 sh -c)`
  - #4 `:318` TOOL_META 补注释：`// per-tool 粒度: deploy/export 慢需 long_running=true; list_devices/get_preset_info 秒级被错标但无害(客户端多显等待提示)`
  - #2 测试：补 spawnGodot export 参数断言
- [ ] **Step 4: 运行验证通过** + **Step 5: commit**（确认 master）

---

## Task 2: godot-finder isGodotVersionSignature（#6）

**Files:** `src/core/godot-finder.ts:64-66`; Test `test/godot-finder.test.js`（确认路径）

- [ ] **Step 1: 写失败测试**（3 形态）
  - `"4.6.2.stable"` → true（status）；`"Godot v4.6.2"` → true（godot+version）；`"4.6.2"`（纯数字）→ **false**（修复前 true）
- [ ] **Step 2: 运行验证失败**（纯数字断言）
- [ ] **Step 3: 修复**（`:66`）
  - `(hasGodotWord && hasMajorMinor) || hasThreePartVersion || hasVersionStatus` → `(hasGodotWord && hasMajorMinor) || (hasGodotWord && hasThreePartVersion) || hasVersionStatus`
- [ ] **Step 4: 运行验证通过** + **Step 5: commit**（确认 master）

> 注：isGodotVersionSignature 若非 export，测试通过 validateGodotBinary/detectGodotVersion 间接调（执行时确认）。

---

## Task 3: game-bridge _doConnect 显式 _invalidateSocket（#7）

**Files:** `src/tools/game-bridge.ts:144`（auth 失败 reject 路径）

- [ ] **Step 1-5: TDD**。执行时读 :144 reject 块，reject 前 + `this._invalidateSocket()`（显式，逻辑不变）。测试：auth 失败后 socket invalidated（若可测；否则代码审查 + 既有连接测试无回归）。

---

## Task 4: advanced-proxy size 上限 + 审计（#8）

**Files:** `src/tools/advanced-proxy.ts:179-187`（dynamic route）+ `:202`（delegateCall）

- [ ] **Step 1-5: TDD**。执行时读 :179/:202，toolArgs 加 `JSON.stringify` 字节数 > 256KB 拒绝 + 路由名/键审计 log。两处共用 size 检查。测试：超大 toolArgs 拒绝（dynamic + delegate）。

---

## Task 5: instance-tools 脱敏 projectPath（#9）

**Files:** `src/tools/instance-tools.ts:117-123`（select_instance 错误消息）

- [ ] **Step 1-5: TDD**。执行时读 :117-123，错误消息回显 projectPath → 改 basename 或 `<redacted>`。测试：错误消息不含完整 projectPath。

---

## Task 6: includes('..') 三处段级匹配（#10）

**Files:** `src/tools/load-skill-search.ts:82` + `src/tools/recording.ts:58` + `src/tools/scene/scene-instance.ts:209`

- [ ] **Step 1: 写失败测试**（3 处各一）
  - load-skill: `my..lib` 路径不被误拒（含 `..` 子串但非遍历）
  - recording: `my..rec` 名不被误拒
  - scene-instance: `my..scene` 源路径不被误拒
- [ ] **Step 2: 运行验证失败**
- [ ] **Step 3: 修复**（3 处 `p.includes('..')` → `p.split(/[/\\]/).includes('..')`，段级匹配）
- [ ] **Step 4: 运行验证通过** + **Step 5: commit**（确认 master）

---

## Task 7: test-framework gdEscape 双重编码（#11）

**Files:** `src/tools/test-framework.ts:146`

- [ ] **Step 1: 写失败测试**（property_equals 字符串期望）
  - 构造节点属性 = "foo"，assert property_equals expected="foo" → passed=true（修复前 gdEscape(JSON.stringify) 致恒不等 → passed=false）
- [ ] **Step 2: 运行验证失败**（修复前 passed=false）
- [ ] **Step 3: 修复**（`:146`）
  - `gdEscape(JSON.stringify(args.expected))` → `gdEscape(String(args.expected))`
- [ ] **Step 4: 运行验证通过** + **Step 5: commit**（确认 master）

> 注：模块 @deprecated 但 validation.ts:16 活引用。修复后基线 2973 测试数可能变动（原本恒不等的 assert 变真比较），执行时确认。

---

## Task 8: 裸 as 断言 grep + 高风险改（#5）

**Files:** 全局 src/

- [ ] **Step 1: grep** ` as [A-Z]\w+` in src/，列清单
- [ ] **Step 2: 判定高风险**：用户输入（`args.x`）直接 `as Type` 无 typeof/schema 前置校验（CRITICAL validateArgs 已前置，残留的是绕过 validateArgs 的直接 as）
- [ ] **Step 3: 高风险处改** typeof/schema 校验（低风险 trusted 数据保留）
- [ ] **Step 4: 全量测试无回归** + **Step 5: commit**（确认 master；若无高风险残留，本 task 仅 grep 记录，无代码改）

---

## Task 9: defects.md 同步（review repo，不进项目 commit）

**Files:** `D:\workspace\review\.claude\knowledge\projects\godot-mcp-enhanced\defects.md`

- [ ] #10 复发立条：`instance-manager-path-traversal-substring` 同源复发（load-skill/recording/scene-instance），标复发 + 本次 fixed
- [ ] 其他 ADVISORY 视情况立条/status（多为 report 摘要级，未立条）

---

## Task 10: 验证收尾

- [ ] **Step 1: 全量测试** `node node_modules/vitest/dist/cli.js run`（基线 2973 ± #11 变动）
- [ ] **Step 2: tsc** `node node_modules/typescript/bin/tsc --noEmit` exit 0
- [ ] **Step 3: 确认 commits**（git log + 每个 commit 前确认 master）

---

## Self-Review

**1. Spec coverage**：#1/#3/#4/#2→Task1 / #6→Task2 / #7→Task3 / #8→Task4 / #9→Task5 / #10→Task6 / #11→Task7 / #5→Task8；defects→Task9；验证→Task10 ✅

**2. Placeholder scan**：#3/#4/#6/#10/#11 含精确代码；#1（注释）/#2（断言）/#7/#8/#9 标"执行时读源码确认精确"（grep 目标明确，非 TBD）✅

**3. Type consistency**：isGodotVersionSignature / gdEscape / spawnGodot / _invalidateSocket 跨任务一致 ✅
