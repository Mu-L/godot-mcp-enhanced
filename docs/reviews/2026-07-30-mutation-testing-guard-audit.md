# Stryker 可行性评估 + 一次性 guard 审计(delete-red)

> **日期**:2026-07-30
> **类型**:评估备忘 + 审计报告(一次性,非 CI 常驻)
> **范围**:TS 侧纯单测 guard(8 项);GDScript 侧 / Godot-spawn guard 出范围
> **方法论**:delete-red(neuter guard → 跑测试 → 红绿判定 → git checkout 还原)
> **回归验证**:`npm test` 4277 passed / 24 skipped / 0 failed(审计前后一致,零回归)

---

## 一、Stryker 可行性结论

### 1.1 全量 Stryker:**不可行**

- 测试规模:290 测试文件 / 4277 tests,其中 **44 个 spawn Godot**(慢 e2e,单文件 ~2.6s)。
- 全量 mutation = 4277 测试 × N mutant/文件 × Godot spawn 开销 ≈ **数天级**,CI 不可承受。
- 装机成本:新增 Stryker 依赖 + config + runner,与项目"轻量 CI"定位冲突。

### 1.2 Scoped Stryker(纯单测模块):**理论可行但价值受限**

- 纯单测模块(如 path-utils)可跑 Stryker,但**覆盖不到最该测的 Godot-spawn 安全模块**(gdscript 沙箱、ToolDispatcher 路由)。
- 讽刺的张力:**mutation testing 最有价值的地方恰是最不可行的地方**——安全 guard 多在 spawn 路径上。

### 1.3 现阶段建议:**不采用 Stryker**

- 低成本替代已存在:`scripts/check-test-quality.mjs` 三检测器(死文件 / mock drift / 弱断言上限),可扩展第 4 检测器。
- 本备忘的 delete-red 审计证明:手动策定高价值 guard 做 neuter 审计,**同样能发现假绿**,且无新依赖、git 可还原、一次性完成。
- 若未来 CI 要常驻 mutation 检测,优先扩 `check-test-quality.mjs`(本项目原生),而非引入 Stryker。

---

## 二、delete-red 审计发现(8 项 guard)

判定符号:🔴 红 = guard 移除后测试失败 = **真覆盖**;🟢 绿 = guard 移除后测试仍过 = **假保护/无保护**。

| # | Guard | 源码定位 | 目标测试 | neuter 后 | 判定 |
|---|-------|---------|---------|----------|------|
| G1 | `scanGdscriptSandbox` BLOCK | `src/gdscript-executor.ts:396` | `test/gdscript-executor-core.test.js` | 10 failed / 84 passed | 🔴 **真覆盖** |
| G2 | `resolveWithinRoot` traversal(6 处) | `src/core/path-utils.ts:154` | `test/core/path-security.test.ts` + `test/helpers.test.js` | 11 failed / 54 passed | 🔴 **真覆盖** |
| G3 | `isToolAllowed` deny | `src/core/tool-registry.ts:262` | `test/core/tool-registry-groups.test.ts` | 1 failed / 20 passed | 🔴 **真覆盖(较薄)** |
| G4 | `createElicitFn` accept 路径 | `src/core/elicit.ts:39` | `test/core/elicit.test.ts` | 1 failed / 5 passed | 🔴 **真覆盖(语义弱)** |
| G5 | `requiresConfirmation` | `src/guard.ts:63` | `test/guard.test.js` | 32 failed / 40 passed | 🔴 **真覆盖(扎实)** |
| G6 | `MAX_TSCN_INPUT_SIZE` 10MB | `src/tscn/tscn-parser.ts:306` | `test/tscn-parser.test.js` | 1 failed / 19 passed | 🔴 **真覆盖** |
| G7a | `writeTmpCsv` P3 不变量 | `src/tools/data-import.ts:250` | `test/tools/data-import.test.ts:128` | 1 failed | 🔴 **真覆盖** |
| G7b | handleTool F-7 主守卫 | `src/tools/data-import.ts:334` | `test/tools/data-import.test.ts:203` | **0 failed** | 🟢 **假保护(测试无效)** |
| G8 | `MAX_FILE_COUNT`/`MAX_FILE_SIZE` | `src/tools/batch-tools.ts:92,95` | `test/batch-tools.test.js` | 0 failed / 20 passed | 🟢 **无保护(零测试)** |

### 2.1 总体结论

- **6 项 guard 真覆盖**(G1/G2/G3/G4/G5/G6/G7a)——现有测试扎实,尤其 G1(沙箱)、G2(traversal)、G5(确认门含 RCE 链)覆盖深度好。
- **2 项问题发现**:
  - **G7b(F-7 测试无效)**:`csv_content 超 10MB → INVALID_PARAMS` 测试,移除守卫后**仍 passed**。断言未真正绑定 guard 行为,是假绿。**建议修测试或核查归因**(见 §三)。
  - **G8(零测试)**:`batch-tools` 的文件数(50)和单文件字节(1MB)OOM 防护,**完全无测试**。建议补拒绝路径测试。

### 2.2 覆盖强度分级(诚实标注)

- **强**(多 failed,deny 路径充分):G5(32)、G1(10)、G2(11)
- **中**(少 failed,但关键 deny 被覆盖):G6、G7a
- **弱**(仅 1 failed / 语义非安全拦截):G3(1)、G4(1)

---

## 三、需深查 / 建议行动项

### 3.1 🔴 G7b:F-7 测试为何无效(优先)

**现象**:neuter `data-import.ts:334`(csv_content 字节守卫)后,F-7 测试(`data-import.test.ts:203` "csv_content 超 10MB → INVALID_PARAMS")仍 passed。

**初步归因线索**(未完全定论):
- 测试运行日志出现 `GODOT_MCP_UNRESTRICTED=true — all path restrictions bypassed`,疑似测试环境全局设了 UNRESTRICTED。
- 推测:`resolveWithinRoot` 在 UNRESTRICTED 下放行后,handleTool 的某条**非 neutered** 后续路径恰好也返回了满足 `expect(r).not.toBeNull()` + `error_code === 'INVALID_PARAMS'` 的结果(可能是别的参数校验),使断言意外通过。
- 即:测试的 `INVALID_PARAMS` 可能并非来自字节守卫,而是来自别的早退——断言绑定错了 guard。

**建议行动**:
1. 在 F-7 测试里加精确断言:`expect(payload.error).toMatch(/csv_content exceeds.*bytes/)`(当前只 `exceeds.*bytes`,过宽)。
2. 或核查 handleTool 在 `:334` 前是否还有别的 INVALID_PARAMS 早退点。
3. 此项是本次审计最有价值的发现——典型"看似测了实则没绑定"。

### 3.2 🟡 G8:补 batch-tools OOM 防护测试

`batch-tools.ts:89-98` 的 `MAX_FILE_COUNT=50` / `MAX_FILE_SIZE=1MB` 是 H-06 防 OOM guard,但 `batch-tools.test.js` **零拒绝路径测试**(只测 empty/missing/正常创建)。

**建议**:补 2 条测试——51 文件拒绝、单文件 >1MB 拒绝。对齐 G7a 的 P3 不变量测试风格。

### 3.3 G3 覆盖较薄(可选强化)

`isToolAllowed` 仅 1 条断言(`:85` 未激活组拒绝)守住 deny 路径。可补:未知工具名拒绝、多个组切换后的边界。

### 3.4 G4 语义标注(无需行动,仅记录)

`createElicitFn` 的"失败安全 → null"是**正常设计**(client 拒绝不崩),非安全拦截。本次审计测出的是 accept 成功路径被覆盖,不代表 elicit 作为"确认门"的安全语义被验证。5 条失败安全测试 neuter 后仍绿是**正确的**。

---

## 四、审计方法论教训(值得进 memory)

1. **neuter 必须彻底**:G2 初审"全绿=假保护"是假阳性——只 neuter 了 6 处 traversal 检查中的 2 处,剩余 4 处仍拦截。重做(全 neuter)后 11 failed,翻转为真覆盖。**教训:移除 guard 必须覆盖其所有拦截路径,否则产生假阳性。**

2. **静态断言测试不适用 delete-red**:G4 候选最初定的 `elicit-wiring.test.ts` 是 `readFileSync` + `toMatch` 静态断言,neuter 运行时行为对它无效。真实靶子是 `core/elicit.test.ts`(运行时单测)。**教训:审计前必须确认测试是运行时断言而非源码文本 grep。**

3. **grep 命中数 ≠ 慢测试**:复核阶段前序 agent 用 spawn/godot grep 命中数(68/29)推断"非纯单测",实测全部 < 1.2s 且无真 spawn(命中全是 import 和被测函数名)。**教训:耗时假设必须实测,不能从 grep 命中数推测。**

4. **delete-red 是 Stryker 的有效廉价替代**:对纯单测 guard,手动 neuter + 跑测试能以零依赖、秒级、git 可还原的方式发现假绿(G7b、G8),无需 Stryker 装机成本。

---

## 五、验证记录

| 验证项 | 命令 | 结果 |
|--------|------|------|
| 审计前工作区干净 | `git status --porcelain` | 空 |
| 每项审计后还原 | `grep -c NEUTERED <file>` | 全部 0 |
| 审计后工作区干净 | `git status --porcelain` | 空 |
| 全量回归 | `npm test` | 4277 passed / 24 skipped / 0 failed |
| 测试耗时实测(纯单测) | `npx vitest run <file>` | 全部 < 1.2s,无 Godot spawn |

---

## 六、出范围事项

- **GDScript 侧 guard**(沙箱运行时、godot_operations.gd 路由):需 headless/Godot,另立项。
- **全量 Stryker**:见 §一,不可行。
- **data-import/workflow 等 Godot-spawn guard 审计**:慢,可选追加,本次未做。
- **G7b 归因深挖**:本文给出初步线索,完整定论需单独 trace handleTool 执行路径(建议作为独立小任务)。
