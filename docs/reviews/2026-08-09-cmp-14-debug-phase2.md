# CMP-14 debug Phase 2/3 + CMP-16-B/C + CMP-9 confirm gate — 第三方审查报告

**审查对象**:`feat/cmp-followups-debug-phase2-proxy-driftgate` 分支(CMP-14-A/B + Phase 2/3 + CMP-16-B/C + CMP-9 confirm gate)
**审查者**:独立 code-reviewer 子 agent(隔离视角,所有声明经 grep/read 实测)
**审查日期**:2026-08-09

## 总体判定:SHIPPED WITH NITS

核心交付(CMP-14-A/B、Phase 2/3 七 handler、CMP-16-B/C、CMP-9 confirm gate)设计正确、契约对齐、部署同步到位、安全守卫充分。**无 Blocking Issue**。存在数处运行时风险点(NIT-1/2/5),但测试已诚实标注"需 editor 实测",不构成 SHIPPED 阻塞。建议合并后补一次 editor 实测(尤其 `_capture` 与面板信号重复更新 vars 的可能性)。

---

## 逐维度结论

### 维度 1:设计正确性 — PASS(契约层),运行时需补实测

- `_setup_session`/`_has_capture`/`_capture` 虚方法重写正确;`_capture` match 各消息攒进 `_states[session_id]`。
- step 走"按图标找按钮"(`press()` 用 `get_theme_icon` + `_find_button_by_icon` + `emit_signal("pressed")`),非 `send_message("step")`。注释明确说明 thread id 设不了的理由。设计理由成立(竞品验证)。
- reload_scripts 4 道安全守卫齐备(is_playing_scene + active_sessions + 暂停态拒 + MCP 自身保护)。
- settle/await_new_break 超时对标竞品有界轮询(SETTLE_MS=700/STEP_WAIT_MS=2000)。

### 维度 2:TS-GD 一致性 — PASS

- editor-method-map debug 组 7 新映射与 command_handler.gd handle_debug_async 七分支逐一对应。
- static-grep ROUTING 7 新条目与 GD 路由一致,双向 drift 检测守护(扫四个 handler 块)。
- debug.ts ACTIONS 10 个与 GD handler 数量一致(3 同步 + 7 异步)。

### 维度 3:测试质量 — PASS(诚实标注限制)

- CMP-14 测试 21 个全部真实读源码签约 + 真实 import,无虚假测试。
- 诚实标注限制:测试文件头明确写"运行时行为需 editor 实测,这里验证源码签约 + async 分流"。正确契约测试定位。
- CMP-16-B 测试含注入 fetcher 单测;CMP-16-C 测试实跑脚本。

### 维度 4:部署同步 — PASS

- capability-matrix 重建(debug enum 含 10 action;riskDistribution {read:6, write:4})。
- 规则同步 221→228(rule-templates.ts + .claude/rules/godot-mcp-core.md 两处一致)。
- 版本 bump 0.27.0 → 0.28.0。

### 维度 5:仓库级约束独立核查 — PASS

- check:tool-groups(40 工具)、check:command-docs-drift(64 method)、GUARDED_KEYS 含 debug 均通过。

### 维度 6:关键安全审查 — PASS

- reload_scripts MCP 自身保护(拒绝 res://addons/godot_mcp_server/)。
- step 前置检查(is_breaked/can_debug)。
- `_render_value` 对象只回 stub(防序列化撑爆),Array/Dictionary 截断 50。轻微缺口:超长 String 无截断,概率低。

### 维度 7:重点 bug 排查 — PASS

- `bridge.call()` 按名调方法语法正确,coroutine 用 `await bridge.call()` 正确传播。
- `_plugin.get("_debugger_bridge")` 每次 `_ensure_bridge` 动态取(非 setup 时缓存),规避 setup 时序问题。取成员变量方式可靠。
- 双层 error 字典已修(`_ensure_bridge` 返回完整 JSON-RPC 错误信封,各 handler 直接 return br.error)。

---

## Blocking Issues:无

---

## Nits(非阻塞)

| # | 信心 | 位置 | 问题 | 定性 |
|---|------|------|------|------|
| NIT-1 | 60 | debugger_bridge.gd:94-154 + :384-420 | `_capture` 与面板信号可能重复更新 vars(_capture 返 true 是否阻止面板 emit 信号文档含糊) | 运行时风险,需 editor 实测 |
| NIT-2 | 55 | debugger_bridge.gd:345-357 | `_find_stack_tree` 返回首个 Tree,调试器面板含多个 Tree(栈/变量/监视),可能误选 | 运行时风险,需 editor 实测 |
| NIT-3 | 85 | check-command-docs-drift.mjs:24 | 注释写"57 method"但实际 63 条映射,文档漂移 | 文档小漂移,零功能影响 |
| NIT-4 | 60 | debugger_bridge.gd:23 / debug_commands.gd:1 | 无 @tool 注解(但 editor 上下文运行不阻塞,与同级 command 文件一致) | 风格小问题 |
| NIT-5 | 70 | debugger_bridge.gd:314-323 | select_frame 用 get_next()(同级下一个),栈 Tree 若分层可能漏子项 | 运行时风险,需 editor 实测 |

---

## 值得进 memory 的工程教训

1. **契约测试 + 诚实标注运行时限制 = 合理交付**:无 editor 实测条件下用 21 个源码签约测试锁住基础设施,并在文件头明确标注"运行时行为需 editor 实测"。这是无 Godot 编辑器 CI 环境下的正确范式。

2. **setup 时序问题用"每次动态取"解决**:plugin.gd _enter_tree 里 websocket_server setup 先于 add_debugger_plugin,setup 时取 _debugger_bridge 必为 null。解法是不缓存、每次 _ensure_bridge 动态取。规避初始化时序竞态,比"延迟初始化标志位"更简洁。

3. **drift 检测映射表人工维护成本**:63 条人工映射,计数注释最易过时(NIT-3),应让测试断言计数而非依赖注释。

---

## 附录:父 agent 全链路验证证据(实跑)

```
lint:        0 错误
build:       0 错误
test:        4780 passed / 0 failed(含 21 CMP-14 + 4 CMP-9 gate)
check:gdscript: 0 errors / 0 warnings
check:tool-groups: 40 全归组
check:command-docs-drift: 60 method 校验 / 64 docs / 0 drift
check:tool-count: 228 actions / 20 处一致
version-check: 0.28.0 一致
```

时序 bug 修复(自检发现,审查确认):`_ensure_bridge` 改动态取 `_plugin.get("_debugger_bridge")`,加守护测试 CMP-14l2。
