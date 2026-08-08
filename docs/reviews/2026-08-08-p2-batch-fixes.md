# 2026-08-08 P2 批次 + CMP-7 修复 — 第三方审查报告

> **审查日期**: 2026-08-08
> **审查对象**: P2 批次 11 项修复（4 批），分支 `feat/cmp-1-2-competitor-benchmark`，改动未提交
> **审查者**: code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> **总体判定**: 初审 **BLOCKING ISSUES**（1 BLOCKING + 2 IMPORTANT + 3 NIT）→ 全部修复后 **SHIPPED**

---

## 总体判定: SHIPPED

初审发现 1 个 BLOCKING（CMP-7 lastSeen 类型不一致致 editor discovery 全失效）+ 2 IMPORTANT + 3 NIT。全部修复后重跑验证全绿。补了跨语言格式契约测试彻底闭环 B-1 根因。

---

## Blocking Issues（初审，均已修复）

### B-1: CMP-7 lastSeen 写 number，TS 守卫要 string → editor discovery 全失效 — ✅ 已修

**根因**: `instance_registry.gd:59` 用 `Time.get_unix_time_from_system() * 1000`（number），TS `isInstanceInfo`（`instance-manager.ts:49`）要求 `typeof lastSeen === 'string'` → editor 实例 JSON 被 `continue` 静默跳过。headless 写入器（`mcp_bridge.gd:476`）用 ISO 8601 string，格式不一致。4664 测试全绿因测试没覆盖"GD 写 JSON → TS 读"跨语言链路。

**修复**: GD 侧改用 `Time.get_datetime_string_from_system()`（ISO 8601，对齐 headless）。补 2 个跨语言格式契约测试（ISO 接受 + number 拒绝），防 B-1 回归。

---

## Important Issues（初审，均已修复）

### I-1: CMP-7 写盘非原子（竞态） — ✅ 已修
`instance_registry.gd` 直写目标文件，TS 读 registry 可能读到半写 JSON。修复：抽 `_write_json_atomic` helper（tmp+rename，对齐 headless `mcp_bridge.gd:480-489`）。

### I-2: dead-pid→unreachable 核心逻辑零测试 — ✅ 已修
CMP-7 的核心价值（pid liveness probe）零测试覆盖。修复：补 `isPidAlive:()=>false` 用例验证 dead pid 标 unreachable。

---

## Nits（初审，均已修复）

| # | 问题 | 处置 |
|---|------|------|
| N-1 | GD-R9 注释"try 守护"失真（GDScript 无 try/catch） | ✅ 改为"靠 JSON.stringify 返空串检测降级" |
| N-3 | defaultIsPidAlive 与 process-state.ts:52 重复 | ✅ 注释标注"同语义，改动需同步" |

---

## 逐维度结论（初审已核实通过）

### 设计正确性 — ✅

| 修复 | 判定 | 证据 |
|------|------|------|
| GD-R4 enum 补值 | ✅ | `engine_commands.gd:85-103`：class_get_enum_constants + class_get_integer_constant，ENUM_CONSTANTS_LIMIT=50 |
| GD-R5 Resource 显式 | ✅ | `undo_manager.gd:85-99`：区分 Node/Resource/其他三类 skip |
| GD-R6 search 排序 | ✅ | `engine_commands.gd:113-131`：先 collect 全部再 sort_custom 再 slice。性能核实：~1000 类 substring 匹配 <1ms |
| GD-R7 debug 错误 | ✅ | `debug_commands.gd:117-126`：_get_current_code_edit 返 Dictionary{code_edit,reason} |
| GD-R8 scene 诊断 | ✅ | `scene_commands.gd:83-88`：save_scene_as 路径补诊断 |
| GD-R9 export JSON | ✅ | `export_commands.gd:62-73`：JSON.stringify+parse_string 还原原生结构 |
| GD-R10 recording 路由删 | ✅ | `command_handler.gd:199-201` + `static-grep.ts:114-115`：3 路由+3 登记同步删 |
| IPC-R6 baseline 离群 | ✅ | `health-monitor.ts:124,136,392-399`：trimmedMean(trimRatio=0.1) 替代 avg |
| IPC-R4 重连 stale | ✅ | `GodotServer.ts:601-625`：sendLoggingMessage 通知，logging capability 已声明 |
| CMP-7 addon registry | ✅（修 B-1/I-1 后） | `instance_registry.gd`：ISO 8601 lastSeen + 原子写 + 30s 心跳 |
| CMP-7 TS pid probe | ✅（修 I-2 后） | `instance-manager.ts:157-161`：process.kill(pid,0)，isPidAlive 可注入 |

### 部署同步 — ✅
- build/scripts/ 不含 addons/（instance_registry.gd 不需进 build）
- static-grep.ts 与 command_handler.gd 路由一致（GD-R10）

---

## 验证证据（审查修复后实跑）

```
npm run lint:          0 error
npm run build:         0 error
npm test:              4667 passed / 0 failed / 27 skipped (320 test files)
npm run check:gdscript: errors=0 / warnings=0
npm run check:tool-count: 40 tools / 220 actions / 20 处通过
npm run version-check: ✓ 0.25.11
```

---

## 值得进 memory 的工程教训

1. **跨语言 JSON 契约必须有"写→读"端到端测试**：GD 写 number / TS 守卫要 string 这类 drift，单元测试（手构对象、mock 注入）抓不到，必须有用真实 GD 输出格式喂给 TS 解析器的契约测试。4664 测试全绿仍漏 B-1。
2. **"对齐范式"声明必须 diff 实现细节**：instance_registry 注释自称"对齐 headless"，但 lastSeen 格式 + 写盘方式都没真对齐。
3. **核心功能必须有 happy-path 测试**：CMP-7 核心 dead-pid→unreachable 零测试覆盖。
