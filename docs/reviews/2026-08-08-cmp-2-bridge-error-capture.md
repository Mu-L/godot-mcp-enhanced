# CMP-2 game bridge runtime error 捕获 — 第三方审查报告

> **审查日期**: 2026-08-08
> **审查对象**: CMP-2(game bridge 通道 runtime error 捕获)
> **审查者**: code-reviewer 子 agent(隔离视角,静态分析 + Grep/WebFetch 实测)
> **基线**: 改动未提交,master HEAD `90eea14`

---

## 总体判定: SHIPPED

初次审查判定 **SHIPPED WITH NITS**(5 NIT,无 BLOCKING)。5 NIT 中 4 个修复(含 1 个超越竞品的改进),1 个 deferred(GD 侧无 bridge 测试基础设施)。修复后重跑验证全绿,升级为 **SHIPPED**。

---

## 改动概述

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/scripts/mcp_bridge.gd` | +70 行 | `_ErrorCapture` Logger 子类(ring buffer 200 + re-entrancy guard + 4 种 error_type + substr 截断) + `_ready`/`_exit_tree` 注册注销 + 2 个 method case + 2 个 handler |
| `src/tools/game-bridge.ts` | +6 行 | QUERY_METHODS + BRIDGE_READ_ONLY_METHODS 加 `get_errors`/`clear_errors` + method/params 描述更新 |
| `src/tools/rule-templates.ts` | +2 行 | bridge method 表补 `get_errors`/`clear_errors`(NIT-2 修复) |
| `test/regression/bridge-error-capture-contract.test.ts` | 新建 135 行 | 12 个 GD 契约测试 |
| `test/game-bridge.test.js` | +2 处 | readMethods 列表更新 |
| `test/workflow.test.js` | +3 行 | BRIDGE_READ_ONLY_METHODS size 7→9 |
| `CHANGELOG.md` + `README.md` | 版本表更新 | v0.25.9 |
| `package.json` + manifest + plugin.cfg 等 | version-sync | 0.25.8→0.25.9 |

---

## 初次审查 NIT 及处理

### NIT-1 [重要度:中] — error_type 过滤漏 ERROR_TYPE_ERROR — ✅ 已修(超越竞品)
- **位置**: `src/scripts/mcp_bridge.gd:1911-1913`
- **修复**: 补 `error_type == ERROR_TYPE_ERROR` 捕获 + `kind = "error"`。覆盖引擎层运行时错误(null 解引用/API 误用/FileAccess 失败/callv 参数错误)。竞品只捕 SCRIPT/SHADER/WARNING,我们超越。
- **验证**: CMP-2g 契约测试断言 4 种 error_type 全捕获

### NIT-2 [重要度:中] — rule-templates.ts bridge method 表漂移 — ✅ 已修
- **位置**: `src/tools/rule-templates.ts:132-133`
- **修复**: bridge method 表补 `get_errors`/`clear_errors` 两行 + 触发 version bump(0.25.8→0.25.9,check-rules-version-bump 通过)
- **验证**: version-check + check-rules-version-bump 全绿

### NIT-3 [重要度:低] — _exit_tree 注释"野指针"不精确 — ✅ 已修
- **位置**: `src/scripts/mcp_bridge.gd:114`
- **修复**: "防 Node free 后被 Godot logger 链引用成野指针" → "Logger 是 RefCounted,remove_logger 让引擎 logger 链释放引用,避免 Node 销毁后 logger 回调访问已失效上下文"

### NIT-4 [重要度:低] — message/code 无长度上限 — ✅ 已修
- **位置**: `src/scripts/mcp_bridge.gd:1922-1931`
- **修复**: 加 `MAX_TEXT_LEN = 4096` 常量,message/code/function/file 各 `substr(0, MAX_TEXT_LEN)` 截断
- **验证**: CMP-2g2 契约测试断言 substr 截断存在

### NIT-5 [重要度:低] — 无真实增量查询行为测试 — deferred
- GD 侧无 bridge handler 测试基础设施,字面量契约是合理折中。poll() 纯函数逻辑可考虑用 GDScript headless 单测覆盖(留 follow-up)。

---

## 验证证据(NIT 修复后实跑)

```
npm run lint              → 0 error
npm run build             → 0 error (tsc + .gd 拷贝到 build/scripts/)
npm test                  → 4571 passed / 0 failed (314 test files)
  - bridge-error-capture-contract.test.ts: 12 passed
  - game-bridge.test.js: 16 passed (readMethods 含 get_errors/clear_errors)
  - workflow.test.js: BRIDGE_READ_ONLY_METHODS.size=9
npm run check:gdscript    → errors=0 / warnings=0
npm run version-check     → ✓ 版本元数据一致 (0.25.9)
check-rules-version-bump  → ✓ 规则模板变更已伴随 version bump
```

---

## 值得进 memory 的工程教训

1. **Godot Logger 是 RefCounted 不是 Object** — `_log_error` 虚函数 8 参,error_type 用 ErrorType 枚举(4 值:ERROR=0/WARNING=1/SCRIPT=2/SHADER=3)。注册 `OS.add_logger()`,remove_logger 后置 null 自动释放。

2. **push_error() 的 error_type 路由** — GDScript `push_error()` 触发 `ERROR_TYPE_SCRIPT`;引擎 native 错误/API 误用触发 `ERROR_TYPE_ERROR`。只捕 SCRIPT 覆盖核心场景但漏引擎层错误;补 ERROR_TYPE_ERROR 超越竞品。

3. **_log_error 不被普通 print 触发** — 普通 print() 走 `_log_message` 虚函数(非 `_log_error`)。

4. **bridge 层同步边界** — bridge 新增 method 需同步 3 处 mcp_bridge.gd 副本(src/scripts → build/scripts → test/fixtures/gdscript-check) + rule-templates.ts bridge method 表(分发到目标项目 AI 规则)。不触碰 editor-method-map.ts / capability-matrix。
