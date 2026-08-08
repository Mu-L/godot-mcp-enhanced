# 2026-08-08 P1 批次修复 — 第三方审查报告

> **审查日期**: 2026-08-08
> **审查对象**: 7 项 P1 open 项修复（4 批），分支 `feat/cmp-1-2-competitor-benchmark`，改动未提交
> **审查者**: code-reviewer 子 agent（隔离视角，所有声明 grep/read 实测）
> **总体判定**: **SHIPPED WITH NITS** → 4 Nits 全部修复后 **SHIPPED**

---

## 总体判定: SHIPPED

7 项修复全部解决根因，无引入新 bug，无 Blocking Issues。初次审查 4 Nits（单 occurrence 测试缺口 / defects.ts 未登记 / 注释 drift / 注释不准）全部修复后重跑验证全绿。

---

## 逐维度结论

### 1. 设计正确性 — ✅ 全部解决根因

| 修复 | 判定 | 证据 |
|------|------|------|
| **GD-R1** nav status 派生 | ✅ | `nav_commands.gd:199-202`：success 与 status 同源，消除 deadline 耗尽但 mesh 已生成时矛盾 |
| **GD-R2** _ErrorCapture 重构 | ✅ | `mcp_bridge.gd:1910-1926`：有风险操作集中到 `_capture_entry`，主方法两行明确控制 `_in_log` |
| **GD-R3** debug 注释 | ✅ | `debug_commands.gd:13`：注释匹配实现（get_current_script 非 get_open_scripts） |
| **IPC-R1/R5** env 消除 | ✅ | `process-state.ts:382-408`：options 参数门控，3 调用点正确 |
| **IPC-R2** gap 检测删除 | ✅ | `EditorConnection.ts:278-281`：彻底删除，OS 挂起靠 health-monitor 心跳兜底 |
| **IPC-R3** pause/resume | ✅ | `health-monitor.ts:257-273` + `EditorToolExecutor.ts:189-198`：顺序对称，paused+disposed 双守卫 |
| **SEC-P1-1** write/edit 沙箱 | ✅ | `script.ts:76-93` helper + 4 写入点全覆盖，旁路与 executeGdscript 逐字符一致 |

### 2. TS-GD 一致性 — ✅

- GD-R2 `_capture_entry`（:1931-1954）逻辑与重构前内联逻辑逐行对应，行为等价
- GD-R1 async 失败分支用 `bake_timeout`（比 sync 的 `bake_failed` 更精确，async 失败只有 deadline 耗尽路径）

### 3. 测试质量 — ✅ 无假绿

| 测试 | 用例 | 质量 |
|------|------|------|
| bridge-error-capture-contract CMP-2f-GD-R2 | 1 | _capture_entry 存在 + resetIdx > captureIdx 守护 |
| health-monitor IPC-R3 | 3 | pause/resume/disposed 后 no-op |
| script-sandbox SEC-P1-1 | 8 | 阻断/旁路/正常/.cs + occurrence:1 单次路径（N1 补） |

每个"阻断"用例都验证文件未被写入（readFileSync 确认原内容保持）。

### 4. 部署同步 — ✅

- build/scripts/mcp_bridge.gd：GD-R2 已同步
- version bump：不需（不改工具清单/rule-templates）
- capability-matrix：不需重建

### 5. 仓库级约束 — ✅

- defects.ts 登记 3 项 detect（GD-R2/IPC-R3/SEC-P1-1）+ IPC-R1 更新现有条目 + GD-R1 复用现有条目（N2 补）
- 未触碰生成产物 / 锁文件 / VCS 元数据

### 6. IPC-R1 三调用点 — ✅

| 调用点 | fullSystemScan | 正确性 |
|--------|---------------|--------|
| GodotServer.ts:433 周期扫描 | 不传 | ✅ 会话隔离 |
| GodotServer.ts:451 STARTUP_CLEANUP | `{ fullSystemScan: true }` | ✅ 崩溃恢复 |
| runtime.ts:252 stop_project | 不传 | ✅ 会话隔离 |

### 7. SEC-P1-1 四写入点 — ✅

| 写入点 | 守卫位置 | 扫描内容 |
|--------|----------|----------|
| write_script | :509 | 原始 content |
| SAR 全量 | :605 | 替换后 finalContent |
| SAR 单 occurrence | :656 | 替换后 finalContent |
| 行号模式 | :788 | 替换后 result |

---

## Nits 及处理

### N1: SEC-P1-1 单 occurrence 路径测试未覆盖 — ✅ 已修
补 `occurrence:1` 用例（含 2 个匹配的文件，替换第 1 个为 OS.execute，验证阻断+文件未写）。

### N2: defects.ts 未登记 5 项修复 — ✅ 部分修
补 3 项高价值 detect（error-capture-in-log-no-finally / long-op-no-ts-heartbeat-pause / write-edit-script-no-sandbox-scan）。GD-R3 纯注释 + IPC-R2 删除代码 detect 价值低，跳过。

### N3: defects-fixed.test.ts:88-90 注释 drift — ✅ 已修
"GODOT_MCP_FULL_SYSTEM_SCAN opt-in 门控" → "options.fullSystemScan 显式 opt-in 门控"。

### N4: 注释不准 — ✅ 已修
- GD-R1 注释"对齐 :162"精确化为"对齐 success 派生逻辑（失败分支 async 用 bake_timeout 区分 deadline 耗尽）"
- IPC-R2 心跳描述精确化"ToolDispatcher 实例化时配 15s，默认 30s 但本项目用 15s"

---

## 验证证据（Nits 修复后实跑）

```
npm run lint:          0 error
npm run build:         0 error
npm test:              4663 passed / 0 failed / 27 skipped (320 test files)
npm run check:gdscript: errors=0 / warnings=0
npm run check:tool-count: 40 tools / 220 actions / 20 处通过
npm run version-check: ✓ 0.25.11
```

---

## 值得进 memory 的工程教训

1. **GDScript 无 try/finally 的 re-entrancy guard 复位模式**：用"有风险操作集中到辅助方法 + 主方法两行明确控制 flag"模式，是 GDScript 无 try/finally 下的通用解法。
2. **env 全局状态与周期 tick 的竞态消除范式**：把"临时设 env + finally 恢复"改为"显式 options 参数"，是消除 env 全局状态与定时器 tick 竞态的标准范式。
3. **删除"检测但不动作"代码优于保留**：IPC-R2 删除 gap 检测——它挂在 message 事件但真正需要它的场景恰好不触发，"检测但不动作"是最差状态（误导性暗示有防护）。
4. **defects.ts 数组位置敏感**：fixed 条目必须加到 FIXED_DEFECTS 数组，加错到 OPEN_DEFECTS 会导致计数断言失败 + 防恶化门误触发。
