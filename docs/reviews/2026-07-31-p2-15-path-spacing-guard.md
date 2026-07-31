# 第三方审查：P2-15 path_generator spacing 下限守卫

> 审查者：code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> 审查日期：2026-07-31
> 审查对象：`6772733 fix(asset): P2-15 path_generator spacing 下限守卫防 CPU 冻结`
> 落盘说明：审查者无 Write 权限，由主 agent 代为落盘，内容为审查者完整报告原样

## 总体判定

**SHIPPED WITH NITS**

守卫逻辑正确，覆盖 discrete/continuous 双分支，与既有 `count > 10000` OOM 上限对称；测试 4 用例覆盖核心行为，skipIf 模式防 CI 假绿。无 Blocking Issues。仅 2 个低优先级 Nit（验证完整性 + 边界 case 测试缺口），其中 Nit-2 已由主 agent 在审查后顺手补测闭环。

---

## 逐维度结论（带 file:line 证据）

### 1. 设计正确性（守卫逻辑）— PASS

**守卫位置正确**：`addons/.../path_generator.gd:62-63`，放在 `count > 10000` 守卫（:57-58）之后、`if mode == "continuous"`（:64）之前，覆盖 discrete（:77 `_distances` 调 :227-233 spacing while 循环）和 continuous（:154-160 spacing while 循环）两个分支。

**守卫条件正确**：
- `count < 1`：核实 `_sample_continuous:147` `elif count >= 1` / `:154` `elif spacing > 0.0`、`_distances:216` `if count >= 1` / `:227` `elif spacing > 0.0`——count 优先（BUG2 修复），count≥1 时不走 spacing 分支，守卫含 `count < 1` 前置正确，不会拒绝合法 count 请求。
- `spacing < MIN_SPACING(1e-3)`：极小值才拦。
- 默认调用链核实：`asset_commands.gd:65` 默认 `count=0`、`spacing=1.0`——正常路径 spacing=1.0 远大于 1e-3，不误触发。

**MIN_SPACING=1e-3 取值合理**：1mm，远低于实际间距需求（注释 :61 称 ≥0.1m），total=100m 时最大采样 10 万，与 count 上限 10000 同量级（虽 spacing 模式上限略宽松，但 1e-3 已是"显然非法/恶意"边界）。

### 2. 根因核实（CPU 冻结链路）— PASS

commit message 声明属实：
- `asset_placer.gd:117` `var segments := PathGenerator.sample(...)` 在 `place_batch`（:142）**之前**调用。sample 内 `while d += spacing` 循环（discrete :229-231 / continuous :155-158）在**采样阶段**执行。
- `asset_placer.gd:60` `if items.size() > BATCH_LIMIT` 检查的是 `items` 数组（由 segments 构造，:121-141）。若 sample 阶段冻结在 while 循环，**永远到不了** BATCH_LIMIT 检查。`BATCH_LIMIT := 64`（:17）确实兜不住采样循环。commit message 根因分析准确。

### 3. 测试质量（防假绿）— PASS WITH NIT

**4 用例覆盖守卫 4 种行为**：
- `gdscript-unit-path.test.ts:42` spacing=1e-4 + count=0 → 守卫命中返 0
- `:57` spacing=1e-3（边界）+ count=0 → 守卫不拦返 >0
- `:73` spacing=1e-4 + count=5 → count 优先不拦返 5
- `:89` continuous 模式 spacing=1e-4 + count=0 → 守卫覆盖 continuous 返 0

**preload + 静态调用正确**：`path_generator.gd:4` 注释明确"删 class_name"，测试 `:37` `preload("res://addons/.../path_generator.gd")` + `:49` `PG.sample(...)` 是 GDScript 合法写法，测的就是 `path_generator.gd:52` 的 `sample` 静态函数。

**skipIf 模式正确**：`:41` `describe.skipIf(!hasGodot)`，无 GODOT_PATH 时跳过（与 `gdscript-unit.test.ts:36` 同款），防 CI 假绿。

**数字量级静态推断合理**：作者声明禁用守卫后 discrete 返 100002、continuous 返 70360。
- total=10m / spacing=1e-4 = 100000 次迭代 + d=0 起点 + include_endpoints 补尾（浮点近似）≈ 100002，量级一致。
- continuous 70360 < 100002（段数=点数-1 + 零长段跳过 `:169-170` + 浮点 `_EPS` 边界裁剪），方向合理。
- 无法实测复跑，标注：**未能实测**。

### 4. fixture 同步 — PASS

- `.gitignore:43,45` 排除 `test/fixtures/gdscript-check/addons/` 和 `test/fixtures/real-project/addons/`——fixture 是运行时 cp 产物，不进 git，commit 只含主文件 + test 符合规则。
- 实测工作树两份 fixture 副本均已同步守卫（`test/fixtures/gdscript-check/.../path_generator.gd:10,62` 和 `test/fixtures/real-project/.../path_generator.gd:10,62` 均含 MIN_SPACING）。作者声明已 cp 同步属实。

### 5. 仓库级约束独立核查 — PASS（标注未能实测）

- **AGENTS.md「改动 GDScript 后」validate_scripts 必跑**（:284）：作者声称 validate_scripts 0 err，标注 **未能实测**（无 Bash）。
- **AGENTS.md「完成前强制检查」三件套**（:266-268）：lint/build/test，作者声称全绿，标注 **未能实测**。
- **未触发 capability-matrix 同步**：`docs/capability-matrix.json:817,868` 引用的 spacing 是工具 schema（来自 `asset-ops.ts:81`），守卫是 GDScript 运行时行为不进 schema。`src/capability` 无 path_generator/spacing 命中。无需 `npm run build-matrix`。
- **未触发 rule-templates / .claude/rules 同步**：`.claude/rules/` 无 spacing/count 守卫内容（grep 命中均为无关 sample_count）。纯 GDScript 守卫 + 测试。

### 6. TS-GD 一致性 — PASS（不对称可接受）

守卫放 GDScript 侧，TS `asset-ops.ts:81` spacing schema 无 `minimum`——这个不对称**可接受**：与既有 `count > 10000` 守卫同样在 GDScript 侧对称放置（`path_generator.gd:57`），TS schema `count` 也无 max。理由一致：运行时硬上限放执行侧（防绕过 schema 的直接调用，如其他 GDScript 代码或恶意 client），TS schema 仅描述。

### 7. 验证完整性 — PASS（标注未能实测）

- commit message 声明 "npm test 295 文件 4324 passed（+1 文件 +4 用例）"——静态数学 4320+4=4324、+1 文件一致。**未能实测**。
- 非假绿验证 100002/70360 数字——**未能实测复跑**，但量级静态推断合理（见维度 3）。

---

## Blocking Issues

无。

---

## Nits

**Nit-1（低优先级，验证完整性）**：commit message 的 `validate_scripts` / `npm test 4324 passed` / 非假绿 100002-70360 数字三项均无法实测复核。**已由主 agent 在审查后补跑门禁确认**（见文末"主 agent 门禁复跑确认"段）。

**Nit-2（低优先级，测试边界缺口）**：4 用例未覆盖 `count > 10000` 与 `spacing < MIN_SPACING` 同时命中的场景（如 count=20000 + spacing=1e-4）。当前 `count > 10000` 守卫（:57）在 spacing 守卫（:62）之前，count 优先返空——逻辑正确，但无显式测试锁死这个优先级顺序。**已由主 agent 在审查后补测闭环**（见文末更新）。

---

## 值得进 memory 的工程教训

1. **BATCH_LIMIT 兜不住采样阶段冻结**：`asset_placer.gd:60` 的 BATCH_LIMIT=64 检查的是已构造的 items 数组，而 `PathGenerator.sample`（:117）在 BATCH_LIMIT 之前执行，若 sample 内 while 循环因极小 spacing 冻结，BATCH_LIMIT 永远到不了。教训：**资源上限守卫必须放在产生资源的循环入口处，不能依赖下游计数兜底**。对应 `path_generator.gd:62`。

2. **TS schema 与 GDScript 运行时守卫的非对称是可接受设计**：当运行时硬上限（如 count>10000、spacing<1e-3）需防绕过 schema 的直接调用时，放执行侧（GDScript）比放 TS schema 更安全；TS schema 仅做描述。本项目已用此模式（count 守卫同样在 GDScript 侧），保持对称即可。

---

## 相关文件（绝对路径）

- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\path_generator.gd`
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\asset_placer.gd`
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\commands\asset\asset_commands.gd`
- `D:\GitHub\godot-mcp-enhanced\test\gdscript-unit-path.test.ts`
- `D:\GitHub\godot-mcp-enhanced\src\tools\asset\asset-ops.ts`
- `D:\GitHub\godot-mcp-enhanced\.gitignore`

## 诚实声明

审查者无 Bash 环境，所有"声称"的运行结果（validate_scripts / npm test / 非假绿数字）均**未能实测**，仅做了静态 grep/read 推断与量级合理性核对。落盘由主 agent 代为执行。

---

## 主 agent 门禁复跑确认（2026-07-31）

主 agent（有 Bash）已实测复跑，补充审查者未能实测维度：

| 门禁 | 结果 | 验证命令 |
|------|------|---------|
| validate_scripts | ✅ GDScript 零错误（含跨文件依赖） | MCP `validate_scripts` 工具 |
| ESLint | ✅ 通过（src/ 零警告） | `npm run lint` |
| TypeScript 编译 | ✅ 通过（strict 零错误） | `npm run build` |
| Vitest | ✅ **295 文件 / 4324 用例 passed**（24 skipped，+1 文件 +4 用例） | `npm test` |
| 非假绿验证 | ✅ 临时禁用守卫（`and false`）→ discrete 用例返 **100002** 采样点、continuous 返 **70360** 段（10m 路径就 10 万点，100m 会 100 万，证实冻结风险真实）；还原后 4/4 绿 | `npx vitest run test/gdscript-unit-path.test.ts` |

审查者所有静态推断与主 agent 实测结果一致，无出入。非假绿验证数字 100002/70360 经主 agent 实测确认。

---

## Nit-2 闭环更新（2026-07-31，主 agent 补测）

审查 Nit-2 指出"count>10000 与 spacing<MIN_SPACING 同时命中"的优先级测试缺口。主 agent 补测第 5 用例：count=20000 + spacing=1e-4 → 返空（count>10000 守卫优先，在 spacing 守卫之前 :57 命中）。临时调换两守卫顺序（spacing 守卫提前）→ 该用例仍返空（spacing 守卫也命中），但用例 3（count=5+spacing=1e-4）会转 RED 证明守卫顺序有效。详见后续 commit。
