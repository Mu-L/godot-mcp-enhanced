# 批次 E 测试覆盖缺口加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（inline）。Steps 用 checkbox 跟踪。每 task TDD + 独立 commit。

**Goal:** 修复 2026-07-22 审查的 10 个测试覆盖缺口（4 P0 + 6 P1）——补缺失测试 + 修假绿弱断言 + 修确认门绕过 + CI 集成覆盖。

**Architecture:** 测试加固工程（非代码修复）。分 4 组：E1 假绿修复 / E2 缺失测试 / E3 行为配置 / E4 文档。每 task TDD（写测试→跑红→改→跑绿→commit）。

**Tech Stack:** TypeScript（vitest）/ YAML（ci.yml）/ GDScript（animation 确认门 GD 侧）。

## Global Constraints

- 4.7.1 + 4.6.2 双版本 --import 真编译门禁（涉及 GD 改动的 task）。
- defects.ts FIXED detect 计数（P0-2 涉及）。
- master 本地不 push。
- 4 个 T11 pre-existing（ToolDispatcher elicitation，shell env 污染）不计回归。
- defects-fixed 当前 95。

---

## E1 假绿修复（改测试断言）

### Task 1: P0-3 material/signal includes('null'/'true') 假绿

**Files:** `test/material-ops.test.js:178,182` + `test/signal-ops.test.js:94,98`

**问题:** SCENE_TREE_HEADER 模板自带 9+ null + 1 true，`includes('null'/'true')` 断言恒真，参数序列化损坏也不发现。

- [ ] 改 4 处断言为完整语义表达式（如 `toContain('mat.set_shader_parameter("visible", true)')` / 对应实际生成的语句）
- [ ] vitest material-ops + signal-ops 绿
- [ ] commit

### Task 2: P1-9 gdscript-executor-audit indexOf 命中定义非调用（假绿）

**Files:** `test/gdscript-executor-audit.test.js:64-69`

**问题:** `SRC.indexOf('buildExecAuditEvent(')` 返回函数定义偏移非实际调用，spawn 在后，断言恒真；删调用行测试仍绿。

- [ ] 改运行时验证（mock logger 断言 spawn 前调 EXECUTE_BEGIN）+ 崩溃 e2e（spawn→kill→日志溯源）
- [ ] vitest 绿
- [ ] commit

### Task 3: P1-10 e2e-full 13 it 弱断言 + godot-mock 默认 happy

**Files:** `test/e2e-full-tool-verification.test.ts:445-589` + `test/helpers/godot-mock.ts:12-28`

**问题:** 13 L1 it 全 `length>5` 不辨成功 vs isError；mock 默认 success/compile_success/run_success 全 true 让 error branch 需 per-test override 易遗漏。

- [ ] expectSuccess helper（:103）改 isError.falsy + 成功路径断言
- [ ] godot-mock 加 mockCompileFailure/mockRunError/mockTimeout 预设
- [ ] vitest 绿
- [ ] commit

---

## E2 缺失测试（补新测试）

### Task 4: P0-1 EditorConnection 重连致命路径零 e2e

**Files:** `test/editor-connection.test.js`（补）+ `src/core/EditorConnection.ts:451-458,237-252`

**问题:** 全文 0 处 maxReconnectAttempts/reconnectExhausted，唯一重连测试只覆盖 attempt 1。编辑器崩溃/kill-9 后 MCP 瘫痪且测试无法捕获。

- [ ] 补集成测试：reconnectExhausted 调 1 次 + reconnectEnabled=false + TCP 半开后 connectionMode=headless
- [ ] vitest 绿
- [ ] commit

### Task 5: P1-5 godot-spawn.ts 完全无测试

**Files:** `test/godot-spawn.test.ts`（新建）+ `src/core/godot-spawn.ts:18-57`

**问题:** grep test/ 0 匹配，超时/spawn error/close 三分支无覆盖（对称 blender-spawn 有完整测试）。

- [ ] 复制 blender-spawn.test.ts FakeProc 模式补 3 用例（exitCode=null+forceKillTree / spawn error / close）
- [ ] vitest 绿
- [ ] commit

### Task 6: P1-7 ToolDispatcher godot_path 两层校验零测试

**Files:** `test/core/ToolDispatcher.test.ts`（补）+ `src/core/ToolDispatcher.ts:608,616,596`

**问题:** H-02 绝对路径 + H-01 validateGodotBinary 两层校验，test/ grep 两错误消息零匹配，4 个 godot_path 测试全传绝对路径+mock 成功不触发拒绝。

- [ ] 补相对路径拒绝 + validateGodotBinary false 拒绝用例
- [ ] vitest 绿
- [ ] commit

### Task 7: P1-8 var2str/.get_script 沙箱正则零测试触发

**Files:** `test/gdscript-executor-core.test.js`（补）+ `src/gdscript-executor.ts:86,88`

**问题:** DANGEROUS_PATTERNS 这两个 S-1-review 新增项 test/ 零匹配，对比同文件 str2var 有专门测试。

- [ ] 补 scanGdscriptSandbox get_script/var2str 触发用例
- [ ] vitest 绿
- [ ] commit

---

## E3 行为/配置（涉及代码/CI 改动）

### Task 8: P0-2 animation-track/animtree 破坏性操作标 read 绕确认门 + risk-coverage 固化

**Files:** `src/tools/animation/animation-track.ts:365-376` + `test/risk-coverage.test.ts`（GUARDED_KEYS）+ `test/guard.test.ts`

**问题（已核实）:** animation-track.ts:373/375/376 `remove_track/remove_keyframe/update_keyframe: 'read'`（绕确认门），兄弟模块 animation-ops.ts:691 同名操作标 `'destructive'`（不一致）。risk-coverage.test.ts:54-72「非 GUARDED 须 read」不变量逼 animation-track 标 read。

**修复:** 改 TOOL_META destructive + 加 GUARDED_KEYS + guard.test 加 requiresConfirmation 断言 + risk-coverage 反向检查（read 但 GD 调 mutating API 报 WARNING）。
**行为变更:** remove_track/remove_keyframe/update_keyframe 从免确认→需确认（破坏性操作应确认，修 bug 非feature）。

- [ ] animation-track.ts TOOL_META 改 destructive（对齐 animation-ops）
- [ ] risk-coverage.test.ts GUARDED_KEYS 加 animation-track
- [ ] guard.test.ts 加 requiresConfirmation 断言
- [ ] defects.ts detect（防复发 read 标注）
- [ ] check:gdscript + --import + vitest 绿
- [ ] commit

### Task 9: P0-4 CI 集成覆盖结构性缺陷

**Files:** `.github/workflows/ci.yml:45,128-129`

**问题（已核实）:** check job :45 vitest 在 :46 Godot 安装前（GODOT_PATH 未设→mock 覆盖率）；e2e-godot :129 只白名单 e2e-full-tool-verification 1 文件（data-import-integration 等 CI 不跑）。

**修复:** ① e2e-godot 白名单加 data-import-integration + e2e-p1-p5；② check job GODOT_PATH 前置（谨慎评估副作用——hasGodot() true 后 skipIf 测试变真跑）。

- [ ] ci.yml e2e-godot 白名单扩充
- [ ] ci.yml check job Godot 前置（评估后决定，可能 defer）
- [ ] commit

---

## E4 文档（detect 注明局限）

### Task 10: P1-6 defects.ts 78 条 detect 全静态 grep

**Files:** `test/regression/defects.ts`（注释）

**问题:** 95 fixed 全静态模式匹配，安全/竞态类运行时零覆盖。

- [ ] defects.ts 顶部注释注明静态级局限（运行时行为测试另补）
- [ ] commit

---

## 验收

- 全门禁绿（tsc0/lint0err/build0/check:gdscript 0-0/--import 双版本/全量 vitest passed，4 T11 pre-existing 不计）
- 10 finding 全闭环
- defects-fixed 计数（P0-2 涉及 +1）
- master 本地领先 origin（不 push）
