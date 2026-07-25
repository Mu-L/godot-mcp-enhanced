---
date: 2026-07-25
project: godot-mcp-enhanced
topic: batch F 测试覆盖深度加固（batch E 剩余 12 项 → 6 task）
status: spec（待 writing-plans）
systems:
  - "[[M2-defect-regression]]"
  - "[[ROADMAP]]"
---

# batch F 测试覆盖深度加固

> 子项目 2/3 深度覆盖（规模已达成 enhanced 4004 > Godot AI 2128，做**深度**）。batch E 2026-07-22 审查「未入 top 10 但值得关注」12 项，经 2026-07-25 核实 Agent Read/Grep 实测 → 6 task 做 + 2 defer。每项行号已实测（非 07-22 旧值）。

## 范围

batch E 剩余 12 项核实结果：
- **已做剔除**：① connectGeneration（`test/editor-connection.test.js:194-238` 闭环，注释自述"审查可疑项闭环"）② 重连退避（`:325-350` exhaustedCalls 断言）③ fullSystemScan（`test/process-state.test.js:622` T3c opt-in 触发 + `:641` T8 Windows + `:271/317` pkill spawn error 基本闭环；剩余 15s timeout 直接触发 + fullSystemScanGodot 自身 spawn error 边角，**低优先 defer**）
- **batch F 做 6 task**（§6 task）
- **defer 2**（§defer）

## 6 task

### F1 假绿修复（animation includes('1')）
- **文件**：`test/animation-track.test.js:198` + `test/animation-advanced.test.js:201`
- **问题**：`expect(script.includes('1')).toBeTruthy()` 对几乎所有 GDScript 成立（行号/Vector3/时间戳任意数字都含 '1'）——假绿，断言损坏也不被发现
- **改**：具体断言定位 default 参数——如 `expect(script).toMatch(/track_insert_key\([^)]*1[^)]*\)/)` 或精确 `track_insert_key(0, 0.5, 100, 1)` / `match(/transition.*1\.0/)`
- **难度**：易 | **类别**：可信度

### F2 config-parser 单测
- **文件**：新 `test/config-parser.test.ts`；源 `src/core/config-parser.ts:31`（parseConfigValue）/`:70`（parseGodotConfig）/`:105`（parseMcpScriptOutput）
- **覆盖**：
  - `parseGodotConfig`：section 段 / comment 行 / quote 值
  - `parseMcpScriptOutput`：marker 混入 log 行 / JSON parse 失败 / exitCode≠0 无 marker
  - `parseConfigValue`：dict/array/quote 解析 + depth 边界（limit 8 = 0-8 共 9 层，depth=9 即 `>8` 触发 raw fallback 防递归爆栈，config-parser.ts:34）
- **难度**：易（纯函数）| **类别**：覆盖广度

### F3 icacls :M 动态断言
- **文件**：`test/editor-auth.test.js`；源 `src/core/editor-auth.ts:32`（`/grant:r ${username}:M`）
- **问题**：现有 mock（`editor-auth.test.js:13`）在 `args.length===1` 走 read-back 分支、其余返空字符串——grant 调用走空分支**无断言**；`defects.ts:506-511` 静态查 `${username}:R` 反模式（:M/:F 算 fixed，但运行时未验证 spawn 真传 :M）
- **改**：grant 调用是 `execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', \`${username}:M\`])` —— **4 元素 args**，spy/mock 捕获断言 **`args[3] === \`${username}:M\``**（不是 args.length===3，那是误读——read-back 是 args.length===1，grant 是 4 元素）。防回退 :R/:F
- **难度**：易（spy 断言 args）| **类别**：安全

### F4 clampParam 单测
- **文件**：新 `test/clamp-param.test.ts` 或加 `validation` 相关；源 `src/tools/shared/validation.ts:20` + 6 调用点（`audio-ops.ts:196,197` vol/pitch + `particles.ts:430,447,461,462` amount/spread/explosiveness/randomness）
- **覆盖**：`clampParam` 边界（min/max/NaN/undefined/negative/clamp 方向）+ 6 调用点静态 grep 守卫（防漏接，对齐 path_generator validate 先例）
- **难度**：易（纯函数）| **类别**：覆盖广度

### F5 launch_editor PID 多会话契约（防回归）
- **文件**：`test/runtime.test.js`（或新）；源 `src/tools/runtime.ts:128`（`spawn(..., { detached: true, stdio: 'ignore' })` + `child.unref()`，**不**调 `registerSpawnedGodotPid`）
- **覆盖**：断言 `launch_editor` 后 `_spawnedGodotPids` Set 不含 detached editor PID + `killOrphanGodotProcesses` 不杀它（防 07-22 P1 修复回归）。**或** spy `registerSpawnedGodotPid` 断言 launch_editor 路径 callCount===0（更抗重构，不依赖 Set 内部——eng-review NIT）
- **难度**：易（断言 Set 内容）| **类别**：安全/多会话

### F6 skip 静默 warn（L2 + itIfGodot 双处）
- **文件**：`test/e2e-full-tool-verification.test.ts:802,868`（L2 `describe.skipIf(!hasGodot||!hasRealProject||process.env.CI||!OPT_IN_L2)`）+ `test/helpers/integration-setup.js:28-33`（`itIfGodot` `_godotAvailable=false` 时 `it.skip`）
- **问题**：静默 skip 让人误以为跑过（CI 绿但 L2/真 Godot 没跑）
- **改**：skipIf 时 `console.warn`（"Godot/L2 not available, N tests skipped — set GODOT_MCP_E2E_L2=1 / install Godot to enable"）；可选导出 skipCount 供 CI 汇总
- **难度**：易（加 warn）| **类别**：覆盖广度/DX

## Defer（不做，附理由）

- **undo E2E**（项 1）：真 undo 逻辑全在 GD（`addons/.../undo_manager.gd`、`asset_factory.gd`），TS 侧只能静态字面 detect。要真测得起 editor + 触发 do/undo，跨架构成本高（属维度① e2e 真跑）。`defects.ts:444/458/494/938/957` 已有静态字面 detect 兜底。性价比低。
- **tool-context setter no-op**（项 10）：`helpers/tool-context.js:16-20` 是设计约定（helper mock，各 test 自行 `vi.fn()` 覆盖）。改约定（throw/warn）要触动所有用 helper 的测试文件，引回归风险。ROI 低。

## 测试策略

每 task TDD 闭环：
- **F1/F3**：改现有断言（假绿→真断言）——先 RED（改断言后旧实现若错会失败）→ 修实现/确认→ GREEN
- **F2/F4**：新测试文件（纯函数）——写测试→失败（函数在但边界未测）→ 确认实现→ 通过
- **F5**：防回归断言——写测试（断言 Set 不含 detached PID）→ 通过（当前实现正确）→ 防未来回归
- **F6**：加 warn + 测试 warn 触发——写测试（spy console.warn）→ 加 warn→ 通过

batch E 模式：一个 plan 多 task，subagent-driven-development 执行。

## 实仓依据（2026-07-25 核实 Agent Read/Grep 实测）

| task | 关键行号 |
|------|---------|
| F1 | animation-track.test.js:198 / animation-advanced.test.js:201 |
| F2 | config-parser.ts:31,70,105 |
| F3 | editor-auth.ts:32 / editor-auth.test.js:13 / defects.ts:506-511 |
| F4 | validation.ts:20 / audio-ops.ts:196,197 / particles.ts:430,447,461,462 |
| F5 | runtime.ts:128 |
| F6 | e2e-full-tool-verification.test.ts:802,868 / integration-setup.js:28-33 |
