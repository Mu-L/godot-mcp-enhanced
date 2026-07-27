# batch F 测试覆盖加固第三方审查报告

**日期**：2026-07-27（补审查，实现于 2026-07-25）
**审查对象**：batch F 测试覆盖深度加固（6 task：F1 假绿修复 / F2 config-parser 单测 / F3 editor-auth args[3] / F4 clampParam / F5 spy NIT / F6 测试基建 warn）
**审查者**：独立 code-reviewer 子 agent（隔离视角）+ 主 agent 复核 splitRespectingQuotes 限制
**审查范围**：spec / plan / 8 个实现 commit / 测试质量 / 平台兼容 / 文档同步

## 审查对象 commit 清单

> **说明**：主 agent 给的 commit 范围（6377892/f4b4679/2542354/fa7b4a6）不完整，子 agent 自行核查发现实际 8 个 commit：

| commit | 说明 |
|--------|------|
| `6377892` | docs(spec): batch F eng-review 修订（F3 args[3] + F2 depth + F5 spy NIT） |
| `f4b4679` | docs(plan): batch F 测试覆盖深度加固实施计划 |
| `2542354` | test(动画): 修复两处假绿断言（includes('1') 恒真）— F1 |
| `c7f4e1c` | F2 config-parser 单测（首次提交，含 depth 假绿） |
| `c4ba1e3` | F3 editor-auth args[3] 修订 |
| `ad4fc65` | F4 clampParam |
| `874365a` | F5 spy NIT |
| `bc617d3` | F6 测试基建 warn |
| `c2b8f20` | **final fix：重写 F2 depth 假绿断言**（final review 抓到） |
| `fa7b4a6` | fix(ci): F3 editor-auth icacls 测试加平台 skipIf |

---

## 总体判定

**SHIPPED WITH NITS**（已交付，无 Blocking）

6 个 task 均有真实测试加强（非文档修改），假绿修复有效，平台兼容正确，文档三层基本同步。唯一值得记录的实质问题是 **F2 的 depth 测试首次提交引入了新的"假绿"**（与 F1 同一模式：`typeof r === 'string' || typeof r === 'object'` 对几乎所有合法返回值为真），但被 final review 捕获并在 `c2b8f20` 重写修复。当前 worktree 已含修复版本。

---

## A. 测试质量 — ✅ 整体有效（F2 首次假绿已修）

### F1 假绿修复 — ✅ 真修了且修对了

- 旧断言 `expect(script.includes('1')).toBeTruthy()` 已删，新断言定位到具体字面值
- `animation-track.ts:151` 模板生成 `track_insert_key(0, 1, Vector3(1, 2, 3), 1)`，新断言 `includes('track_insert_key(0, 1, Vector3(1, 2, 3), 1)')` 精确匹配，非恒真
- 防假绿验证：临时改 `transition ?? 0.5` → 断言 RED；临时改 `${speed}` → `${speed+1}` → 断言 RED（task-F1-report.md:38-46）
- implementer 还发现 plan 提示的 bug：plan 写 `_ap.play("idle", 0.5, 1.0`（错误，JS `${1.0}` 字符串化为 `"1"` 非 `"1.0"`），implementer 据实校准 —— 正面工程判断

### F2 config-parser 单测 — ⚠️ 首次提交假绿，已修

- 17 个用例覆盖 parseConfigValue(8) / parseGodotConfig(3) / parseMcpScriptOutput(6)，断言精确
- **首次提交 (c7f4e1c) 的 depth 用例是假绿**：`expect(typeof r === 'string' || typeof r === 'object').toBeTruthy()` —— parseConfigValue 对嵌套 array 返 array（typeof==='object'），对 raw fallback 返 string（typeof==='string'），该断言对几乎所有合法返回值都为真，**删掉 `config-parser.ts:34` 的 `if (depth > 8) return raw` 守卫也会 GREEN**。讽刺地复现了 F1 在修的假绿模式
- **已修复 (c2b8f20)**：当前 worktree `:32-46` 改为递归验证 —— 循环 9 次断言 `Array.isArray(cur)`，最后断言最内层 `expect(cur).toBe('[1]')`。临时改 `depth > 8` → `depth > 100` 会 RED。修复后断言有效

### F3 args[3] 修订 — ✅ 真改对了

- `editor-auth.ts:32` 确为 4 元素 args：`execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', \`${username}:M\`])`
- 测试断言 `grantCall[3]` 为 `${_TEST_USER}:M`（:123），索引正确（args[0]=filePath / args[1]=`/inheritance:r` / args[2]=`/grant:r` / args[3]=`${username}:M`）
- 触发路径核实：implementer 发现 plan 猜的 `writeEditorSecret` 不存在，改用真实链 `readEditorSecret → checkFilePermissions → restrictFileWindows`
- 防假绿验证：临时改 `:M` → `:R` → 断言 RED（report:81）

### F4 clampParam — ✅ 有效

- 5 边界用例 + 2 静态守卫。源 `validation.ts:20-25` 行为与断言一致（严格 `<`/`>`，`==min`/`==max` 不 clamp）
- 静态守卫 grep `/clampParam\(/g` 实测 audio-ops.ts 2 处 + particles.ts 4 处，import 行 `clampParam,` 不含 `(` 不误命中

### F5 spy NIT — ✅ spy 真生效

- `registerSpawnedGodotPid` 在 `:70` 从 mock 后的 `process-state.js` import（vi.mock 在 :21-34 替换为 vi.fn()），module 加载时绑定
- 反向断言 `not.toHaveBeenCalled()`（:220）有效，beforeEach `vi.clearAllMocks()`（:182）隔离
- 防回归验证：临时注入 `registerSpawnedGodotPid(child.pid)` → 新测试 RED（report:62）
- 还加了三重 `detached` 锁定（spawnOptions.detached/stdio/proc.unref，:225-227）—— 超 spec 加固

---

## B. 平台兼容性 — ✅ F3 skipIf 正确

- `test\editor-auth.test.js:115` `describe.skipIf(process.platform !== 'win32')` 在 Linux CI 自动跳过 icacls 测试
- 源 `editor-auth.ts:55` checkFilePermissions 内 `process.platform === 'win32'` guard 保证 Linux 走 chmodSync 不调 icacls —— 测试与生产 guard 双重对齐
- **该 skipIf 是后续 fix (fa7b4a6)，不在 F3 首次提交 (c4ba1e3)**：SDD diff 显示 F3 首次提交是裸 describe 无 skipIf，会污染 Linux CI。fa7b4a6 是必要的 CI 修复（见 N-5）

---

## C. 文档同步 — ✅ 三层基本一致

| 维度 | 实测 |
|------|------|
| spec 6 task → plan 6 task 全覆盖 | ✅ plan :467-469 Self-Review 自证 |
| spec defer 2（undo E2E / tool-context）→ plan/实现均不含 | ✅ |
| spec 实仓行号 → plan/实现引用一致 | ✅ F1/F3/F5 行号均核对一致 |
| 文档与实现偏离（均已记录） | ✅ F1 plan 提示断言错误被校准 / F2 import 路径 barrel 等价 / F3 触发链改真实 / F6 console.warn → stderr.write —— 每条偏离都在 task report 记录 |
| capability-matrix 未被改动 | ✅ 本 batch 全是测试加固，不动工具清单（正确） |

---

## D. 验证完整性 — ✅ TDD 大体落实，final review 抓到关键假绿

| 维度 | 实测 |
|------|------|
| F1/F3/F5 RED→GREEN 证据 | ✅ 三处都做了对照实验（改值→RED） |
| F2/F4 新测试文件 | ⚠️ 纯函数已存在，测试直接 GREEN；但 F2 depth 首次弱断言使 GREEN 失去意义，被 final fix 重写补 RED 验证 |
| F6 测试基建 warn | ✅ plan Step 3 标注 spy 可选，implementer 据 itIfGodot 无消费者判断 ROI 低，合理偏离 |
| final review 质量 | ✅ **关键正例**：final review（opus, c2b8f20）抓到 F2 depth 假绿并修复 —— 正是第三方审查的价值 |
| defer 项 | ⚠️ 累积 5 Minor + 1 新发现（progress.md:580,585），其中 **F2 M3 `splitRespectingQuotes` 嵌套限制是真生产 defect**（见 N-2） |

---

## Blocking Issues

**无。** F2 depth 假绿已修复（c2b8f20，当前 worktree 已含），其余均为 Minor/Advisory。

---

## Nits

### N-1：F6 `itIfGodot console.warn` 是死代码

- **证据**：`test\helpers\integration-setup.js:32`，全仓 grep `itIfGodot` 仅命中定义文件本身，无任何测试 import/调用
- **影响**：warn 接线正确（针对未来消费者），但当前零效果
- **修复方向**：要么删掉 itIfGodot（无消费者），要么补一个 import 它的集成测试让它真正生效

### N-2（潜在生产 defect，主 agent 复核确认）：`splitRespectingQuotes` 不支持嵌套方括号

- **证据**：`src\core\config-parser.ts:10-28` 的 `splitRespectingQuotes` 只看引号和逗号，遇到 `[1,[2,3]]` 会按逗号切成 `["1","[2","3]"]` 而非 `["1","[2,3]"]`
- **影响**：config-parser 解析 Godot 配置里的嵌套数组（如 `[1,[2,3]]`）会得到错误结果
- **主 agent 复核**：已读 `:10-28` 函数实现，确认不处理嵌套方括号
- **为何 defer**：batch F 是测试加固 batch，按"不改生产"约束 defer（progress.md:585 记录）
- **修复方向**：另开 issue/plan 处理（若 Godot 配置真有嵌套数组场景）；或文档明示"config-parser 不支持嵌套数组"

### N-3：F4 静态守卫双刃性未加注释

- **证据**：`test\clamp-param.test.ts:30-40`，`expect(matches.length).toBe(2)`/`.toBe(4)` 在新增合法 clampParam 调用点时会 RED
- **修复方向**：加注释"新增 clampParam 调用点时同步更新此期望值"

### N-4：F2 import 路径与生产 barrel 不一致

- **证据**：测试用 `../src/tools/shared/gdscript-templates.js`，生产 `config-parser.ts:103` 用 `../tools/shared.js`（barrel）
- **影响**：功能等价（shared.ts re-export），但测试直连内部路径略脆（若 gdscript-templates.ts 重命名需同步改测试）
- **修复方向**：defer 合理

### N-5：F3 首次提交漏 skipIf 导致 Linux CI 红

- **证据**：c4ba1e3 首次提交是裸 describe，fa7b4a6 才补 skipIf
- **修复方向**：首次提交即加平台 guard，避免 CI 红→fix 来回

---

## 值得记忆的工程教训（→ 待主 agent 集中登记）

1. **"防假绿"任务本身会引入新假绿**：F2 depth 用例首次提交用 `typeof r === 'string' || typeof r === 'object'` —— 和 F1 的 `includes('1')` 同一病（断言对几乎所有合法返回值为真）。final review 抓到了，但代价是多一个 fix commit。**教训：纯函数测试的断言要问"如果删掉被测的那行代码，这个断言还会 GREEN 吗？"——depth 用例删掉 depth guard 仍 GREEN，就是假绿**
2. **JS `${1.0}` 字符串化为 `"1"` 而非 `"1.0"`**：F1 implementer 据此校准了 plan 提示的错误断言。模板字面量里 Number 字符串化是常见陷阱
3. **plan 的触发路径猜测需 implementer 核实 export**：F3 plan 猜的 `writeEditorSecret` 在源里不存在，F5 plan 猜的 `registerSpawnedGodotPid` export 自 process-state.ts 而非 runtime.ts —— 两处 implementer 都正确 push back。**教训：plan 写"implementer 据 export 确认"是必要的留白，不是偷懒**
4. **vitest 在文件顶层（describe 外）吞掉 `console.warn`**：F6 改用 `process.stderr.write` 对齐仓库现有 `[E2E-SKIP]` 模式
5. **既有 module mock 复用优于新 spy**：F5 直接用 runtime.test.js 已有的 vi.mock，import 出 mock fn 做反向断言 —— 比新 spy 更抗重构
6. **静态 grep 守卫是双刃剑**：F4 的 `expect(src.match(/clampParam\(/g).length).toBe(N)` 防调用点被删，但新增合法调用点也会 RED。守卫测试要配注释提示
7. **`splitRespectingQuotes` 类解析器的嵌套限制是真生产 defect 风险**：测试能 GREEN 不代表生产正确，纯函数测试要覆盖真嵌套场景（本次 defer，需后续跟进）

---

## 相关文件（绝对路径）

- 测试：`D:\GitHub\godot-mcp-enhanced\test\animation-track.test.js`（F1）/ `test\animation-advanced.test.js`（F1）/ `test\config-parser.test.ts`（F2，含 c2b8f20 修复）/ `test\editor-auth.test.js`（F3，含 fa7b4a6 skipIf）/ `test\clamp-param.test.ts`（F4）/ `test\runtime.test.js`（F5，:209-228）/ `test\e2e-full-tool-verification.test.ts`（F6）/ `test\helpers\integration-setup.js`（F6 死代码 :32）
- 生产代码（核实用）：`D:\GitHub\godot-mcp-enhanced\src\tools\animation\animation-track.ts:127,151`（F1）/ `src\core\editor-auth.ts:32,55`（F3）/ `src\core\config-parser.ts:10-28,31-62,105`（F2，**N-2 defect 点**）/ `src\tools\shared\validation.ts:20-25`（F4）/ `src\tools\runtime.ts:128,224`（F5）
- SDD 记录：`D:\GitHub\godot-mcp-enhanced\.superpowers\sdd\progress.md:571-585`（batch F 闭环）/ `review-2542354..c7f4e1c.diff`（F2 首次假绿 diff）

---

## 审查者署名

- **独立审查**：code-reviewer 子 agent（agent_ae43b892，已完成）
- **复核**：主 agent（读 `config-parser.ts:10-28` 复核 splitRespectingQuotes 嵌套限制成立）
- **限制声明**：vitest/tsc/eslint 是否全绿无法独立核实（无运行环境），但 plan Task 12 要求全绿才 commit，代码层面未见会导致失败的问题
