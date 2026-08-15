# 第三方审查:P0 接线零验证测试补全

- **审查对象**:commit `66d84ad`(分支 `feat/multi-instance-receiver-and-e2e-asset-harness`)
- **审查日期**:2026-08-11
- **审查者**:code-reviewer 子 agent(隔离视角,所有声明 grep/read 实测)+ 协调者落盘
- **被审查改动**:3 文件 +318 行,纯测试补全无产品代码改动
- **背景**:2026-08-11 测试覆盖缺口审查发现 3 条 P0,均为"删掉被测代码不会让任何测试红"的接线零验证类型(memory `wiring-zero-verification-test-gap` 判别法)

## 总体判定

**SHIPPED** — 审查初判 SHIPPED WITH NITS,N.1/N.2 已在同批次补丁修复(commit 含 `runtime-assert-actions.test.ts` +2 测试)。

三条 P0 接线零验证判别核心目标**全部达成**:删掉被测代码的关键逻辑,对应测试会变红。**无 Blocking Issues**。

## 审查维度

### A. 接线零验证判别(核心)— 通过

逐条做"删码红测"推演(假设删掉被测逻辑,测试是否变红):

**P0-1 runtime-assert 4 action**(`src/tools/runtime-assert.ts`):

| action | 被删逻辑 | 变红的断言 | 判定 |
|--------|---------|-----------|------|
| node_state (:141-150) | 整个 mismatch for 循环 | mismatch 测试期望 `passed:false`+`mismatch.health` → 实际 `passed:true`+`undefined` | 红 ✓ |
| node_state (:144-146) | number tolerance 内层 if | mismatch.health 断言变 `undefined`(number 不 fall-through 到 else if) | 红 ✓ |
| scene_structure (:174) | exists 计算 | happy1 期望 `passed:true` → 实际 `passed:false` | 红 ✓ |
| screen_text (:202) | found 计算 | happy1 期望 `passed:true` → 进 else fail | 红 ✓ |
| perf (:232) | ratio 计算 | mismatch1 期望 `passed:false` → 实际 `passed:true` | 红 ✓ |
| perf (:236-238) | else 分支 missing 处理 | mismatch2 `memory_mb` 断言变 `undefined` | 红 ✓ |
| perf (:216) | `?? 0.1` 默认值 | mismatch1:tolerance=undefined → `ratio>undefined`=false → 不 mismatch | 红 ✓ |

**P0-2 ACTION_GATED 接线**(`src/core/ToolDispatcher.ts:273-275`):

- 删整个 if 块 → 测试 1(blocks)三条断言全红:`isError=true`→实际 falsy;`handleToolSpy` 未调→实际调了;`error_code='ACTION_GATED'`→实际 `{status:'ok'}` 无 error_code。✓
- **关键验证**:`ToolDispatcher.test.ts` 的 `vi.mock('../../src/core/tool-registry.js')`(:47-59)**未 mock action-gate.js**,而 ToolDispatcher.ts:20 真实 import。故 action-gate 真实加载,测试注释"真集成测(非 mock)"声明属实。`isActionGated('script','execute_gdscript')`→`ALL_GATED.has('script.execute_gdscript')`(action-gate.ts:22)→ 接线链路完整。✓

**P0-3 timeout 路径**(`src/gdscript-executor.ts:1294-1304`):

| 删除 | 结果 | 测试 |
|------|------|------|
| 整个 timer 块 | proc 不 emit close → promise 永悬 → 10000ms 超时 | 红 ✓ |
| `reject(...)` (:1303) | timer 触发但不 reject → `expect(promise).rejects` 超时 | 红 ✓ |
| `releaseShortRunningSlot()` (:1301) | reject 仍发生但 `releaseSpy` 未调 | 红 ✓ |
| `unregisterSpawn()` (:1298) | reject 仍发生但 `unregisterSpy` 未调 | 红 ✓ |

`audit-runtime.test.js:9` 确有"不测 timeout 路径"显式声明,P0-3 gap 真实存在。

### B. 范围完整性 — 通过

- **行号核实**:全部准确(grep 实测 `assertNodeState:125`/`assertSceneStructure:158`/`assertScreenText:188`/`assertPerf:214`、ToolDispatcher `:273-275`、gdscript-executor timer `:1294-1304`)
- **screenshot_diff 未被误测**:`runtime-assert-screenshot-diff.test.ts` 已有 3 测试覆盖 NOT_IMPLEMENTED;本次 actions.test.ts 只测 4 action,`grep "action.*screenshot_diff"` 零命中
- **perf tolerance 默认值 0.1 隐式锁定**:mismatch1 不传 tolerance→默认 0.1,若改 ≥0.5→不 mismatch→测试红

### C. 仓库级约束核查(AGENTS.md)— 不涉及(已实测)

三个测试文件 grep `rule-templates|capability-matrix` 零命中。本次纯测试补全,不动工具清单/规则/产品代码,不触发:`rule-templates.ts` 独立副本同步 / `build-matrix` / `build/` 产物 / `.claude/rules/` / `check-rules-version-bump`。

### D. 验证完整性

- **静态验证**:`it(` 计数 P0-1 18(含 N.1/N.2)+ P0-2 2 + P0-3 1;import 均带 `.js`;无 `as any`(grep 零命中)
- **⚠️ 方法学发现**:`tsconfig.json:17` `include: ["src/**/*"]`,**tsc 不含 test/**;`package.json:33` lint 也只查 src/;`vitest.config.ts` 无 typecheck 配置。故 **test/ 的类型错误静默通过 lint+build 两道门禁**,只靠 vitest 运行时 + IDE。本次三个测试文件静态核查无异常,但此 gap 须记 memory(审查流程引用"X 命令检查 Y 范围"类声明时必须 grep `package.json`+`tsconfig.json` 实测,不能照搬 AGENTS.md 措辞)

## Blocking Issues

无。

## Nits(均已修)

### N.1 [Important] scene_structure absent+present 子分支 — 已修

- **位置**:`src/tools/runtime-assert.ts:175-176` `if (node.absent) { if (exists) mismatch[...expected:'absent',actual:'present'] }`
- **问题**:原三个 scene_structure 测试只测 absent+!exists→pass 和 present+!exists→mismatch,**漏 absent+exists→mismatch**(场景清理失败/残留节点应报警却静默 pass)
- **删码验证**:删 :176 内层 if,三个测试仍全绿 = 子分支级接线零验证
- **修复**:补 1 测试 `nodes:[{path:'存在于树中',absent:true}]`→期望 `passed:false`+`mismatch[path]={expected:'absent',actual:'present'}`。补后删 :176 该测试红。✓

### N.2 [Minor] screen_text !present+found 输入组合 — 已修

- **位置**:`src/tools/runtime-assert.ts:204-210` else 分支
- **问题**:else 分支整体被触发(mismatch 测试 present+!found 进 else fail),但 !present+found 输入从未测;若有人改 :204 为 `if(found) return pass`,测试仍全绿
- **修复**:补 1 测试 `present:false`+文本实际存在→期望 `passed:false`+`mismatch.text={expected:'absent',actual:'present'}`。✓

## 工程教训(值得进 memory)

1. **审查流程措辞 vs 实测事实**:本次审查要求称"build 含 test/ 类型检查",实测 `tsconfig.json` `include:["src/**/*"]` 不含 test/,lint 也只 src/。**审查者依赖 build 把关 test/ 类型是错误前提**——test/ 类型错误会静默通过两道门禁。→ methodology-lesson:`审查流程引用"X 命令检查 Y 范围"类声明时,必须 grep package.json scripts + tsconfig.json include 实测,不能照搬 AGENTS.md 措辞`

2. **接线零验证判别的粒度陷阱**:P0-1 整体达标(删整个 mismatch 计算会让测试红),但 scene_structure 的 absent+present 子分支(:176)仍是接线零验证——删它测试全绿。说明"逐 action 补 happy/mismatch/error 三路径"能覆盖主干,但**单一 if 分支内的两侧(if 体 + else 体)可能只测了一侧**。→ testing-lesson:`接线测试补全时,每个 if/else if/else 分支都要有"删该分支会让某断言红"的独立验证,不能只看 describe 整体变红`

3. **行号漂移在测试注释中无害但需警惕**:`gdscript-executor-audit-runtime.test.js:9` 注释写 `:1249`,实际 timer 已漂移到 `:1294`。应 grep 函数名/关键词而非行号。

## 相关文件(绝对路径)

被测代码:
- `D:\GitHub\godot-mcp-enhanced\src\tools\runtime-assert.ts`(P0-1)
- `D:\GitHub\godot-mcp-enhanced\src\core\ToolDispatcher.ts`(P0-2,:273-275)
- `D:\GitHub\godot-mcp-enhanced\src\core\action-gate.ts`(P0-2 真实 import 源)
- `D:\GitHub\godot-mcp-enhanced\src\gdscript-executor.ts`(P0-3,:1294-1304)

测试代码:
- `D:\GitHub\godot-mcp-enhanced\test\runtime-assert-actions.test.ts`(P0-1,18 测试含 N.1/N.2)
- `D:\GitHub\godot-mcp-enhanced\test\core\ToolDispatcher.test.ts`(P0-2,+2)
- `D:\GitHub\godot-mcp-enhanced\test\gdscript-executor-timeout.test.ts`(P0-3,1 测试)

配置(D 节方法学发现证据):
- `D:\GitHub\godot-mcp-enhanced\tsconfig.json:17`(include 不含 test/)
- `D:\GitHub\godot-mcp-enhanced\package.json:33`(lint 只查 src/)
- `D:\GitHub\godot-mcp-enhanced\vitest.config.ts`(无 typecheck 配置)
