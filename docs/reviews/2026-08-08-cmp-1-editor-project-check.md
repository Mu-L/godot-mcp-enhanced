# CMP-1 editor 项目匹配检查 — 第三方审查报告

> **审查日期**: 2026-08-08
> **审查对象**: CMP-1(editor 连接建立后校验项目匹配)
> **审查者**: code-reviewer 子 agent(隔离视角,独立 grep/read 实测)
> **实现者**: 主 agent(竞品 godot-mcp-go 深度对标产出 P0 安全修复)
> **基线**: commit `90eea14`(master HEAD),改动未提交

---

## 总体判定: SHIPPED

初次审查判定 **SHIPPED WITH NITS**(4 NIT,无 BLOCKING)。4 NIT 全部修复后重跑验证全绿,升级为 **SHIPPED**。

---

## 改动概述

| 文件 | 改动 | 说明 |
|------|------|------|
| `addons/godot_mcp_server/command_handler.gd:247-251` | +5 行 | 新增 `editor_get_project_path` RPC,`ProjectSettings.globalize_path("res://")` |
| `src/GodotServer.ts:51` | +1 行 | import `safeRealPath`(NIT-3 修复) |
| `src/GodotServer.ts:577-589` | +13 行 | `establishEditorConnection` 插入校验(disconnect + 返回失败) |
| `src/GodotServer.ts:604-615` | +12 行 | `addOnReconnectHandler` 追加重校验(NIT-1 修复) |
| `src/GodotServer.ts:664-700` | +37 行 | `verifyEditorProject()` 私有方法(含 NIT-3 realpath fallback) |
| `src/GodotServer.ts:811-817` | +7 行 | `normalizeForCompare()` 模块级 helper |
| `src/capability/static-grep.ts:137-139` | +3 行 | ROUTING 登记 `editor_get_project_path` |
| `test/editor-project-check.test.ts` | 新建 153 行 | 10 个契约测试(原 8 + NIT 修复后 +2) |
| `test/editor-fallback-integration.test.js` | +16 行 | 4 处 WSS mock 加 `editor_get_project_path` 响应 |
| `test/godot-server.test.js` | +4 行 | 2 处 mockEditorConn 加 `request` 方法 |
| `CHANGELOG.md` | +9 行 | Security 节记录 |

---

## 逐维度结论

### 1. 设计正确性 — ✅ 通过

- `GodotServer.ts:577-589`: 校验在 `connect()` 成功后、`EditorToolExecutor` 接线前调用,顺序正确
- 校验失败时 `disconnect()` + `editorConn = null` + 返回 `connected:false`,资源清理彻底
- `editorProjectPath===null` 跳过(行 672-675)语义正确——无 `project.godot` 上下文时无法对照,不阻断
- 5s 超时(`timeoutMs: 5000`,行 680)合理:本地 127.0.0.1 RPC 远小于 30s 业务超时
- RPC 失败保守拒绝(行 693-696)正确

### 2. TS-GD 一致性 — ✅ 通过

- GD 侧 `ProjectSettings.globalize_path("res://")` + `rstrip("/")` 与 `websocket_server.gd:_get_project_dir()` 完全同款
- `normalizeForCompare` 反斜杠→正斜杠 + 去尾分隔符 + win32 lowerCase,跨平台归一化充分

### 3. 测试质量 — ✅ 通过(初次审查 NIT,修复后加强)

- 10 个契约测试覆盖:校验位置、失败分支清理、null 跳过、rebuild 复用、归一化关键逻辑、realpath fallback(NIT-3)、自动重连重校验(NIT-1)、GD RPC 契约
- mock 更新正确:WSS/mock 回 `{project_path: process.cwd()}` 与 `resolveProjectPath()` 一致
- **诚实评估**:字面量契约测试能锁结构防回归,但无法捕获运行时算法 bug。对安全护栏可接受,未来可补真行为测试

### 4. 部署同步 — ✅ 通过(逐项核查)

| 项 | 结论 | 理由 |
|---|---|---|
| `build/scripts/` | 无需同步 | build 只拷贝 `src/scripts/*.gd`;`command_handler.gd` 在 `addons/`(分发插件,不进 build) |
| `capability-matrix` | 无需重建 | `editor_get_project_path` 非工具(内部 RPC),matrix 工具条目不受影响 |
| `editor-method-map.ts` | 无需登记 | 直发 method,不经 tool/action 二级路由 |
| `rule-templates.ts` | 无需同步 | 无规则改动 |
| ROUTING drift 检测 | ✅ 已处理 | `static-grep.ts:139` 加了 key,双向匹配 |
| version bump | 发版时需 bump | CHANGELOG 在 `[Unreleased]` 下 |

### 5. 仓库级约束 — ✅ 通过(独立核查)

独立 Grep `editor_get_project_path|项目匹配|CMP-1` 核查:
- `rule-templates.ts`: 零命中(正确,无规则改动)
- `docs/capability-matrix.json`: 零命中(正确,非工具)
- `build/scripts/`: 不含 `command_handler.gd`(正确,设计上不进 build)

### 6. 边界情况与并发 — ✅ 通过(初次审查 NIT-1,修复后闭环)

- **并发安全**: 校验期间 `editorExecutor` 未创建、`connectionMode` 仍 headless,并发工具走 headless 路由不命中未校验连接
- **rebuild 路径**: 调 `establishEditorConnection`,校验自动覆盖
- **自动重连路径(NIT-1 已修)**: `addOnReconnectHandler` 回调追加 `verifyEditorProject()` + `handleEditorStall()` 降级,fire-and-forget 不阻塞重连流程

### 7. 安全性 — ✅ 通过

- 不引入新攻击面:`editor_get_project_path` 只返 `res://` 路径,WS 已鉴权(127.0.0.1 only)
- mismatch 时 `disconnect()` 彻底清理(EditorConnection.disconnect 清 pending/handlers)

---

## 初次审查 NIT 及处理

### NIT-1(测试盲区): 自动重连路径无重校验 — ✅ 已修
- **位置**: `GodotServer.ts:604-615`
- **修复**: `addOnReconnectHandler` 回调追加 `verifyEditorProject()` + mismatch 则 `handleEditorStall()`
- **验证**: CMP-1g3 契约测试断言 reconnect handler 含 verifyEditorProject + handleEditorStall

### NIT-2(测试脆弱): CMP-1f 断言过弱 — ✅ 已修
- **位置**: `test/editor-project-check.test.ts:97-103`
- **修复**: 从 `slice.includes("')")` 改为精确正则字面量断言 `'/\\\\/g'` 和 `"/\\/+$/"`
- **验证**: 测试通过,断言能真正验证反斜杠替换 + 去尾分隔符逻辑

### NIT-3(junction 场景): normalizeForCompare 无 realpath — ✅ 已修
- **位置**: `GodotServer.ts:687-695`
- **修复**: 字面比对不等时,对两端做 `safeRealPath()` 二次归一化比對(防 junction/symlink 启动 editor 致路径表示差异)
- **验证**: CMP-1g2 契约测试断言 verifyEditorProject 含 safeRealPath

### NIT-4(变量命名): GD 局部变量 `_res_root` 前缀违和 — ✅ 已修
- **位置**: `command_handler.gd:250`
- **修复**: `_res_root` → `res_root`(局部变量不加 `_` 前缀)

---

## 验证证据(NIT 修复后重跑)

```
npm run lint          → 0 error
npm run build         → 0 error (tsc + .gd 拷贝)
npm test              → 4559 passed / 0 failed (313 test files)
  - editor-project-check.test.ts: 10 passed (原 8 + NIT 修复 +2)
  - editor-fallback-integration.test.js: 4 passed (Path A-D 全绿)
  - godot-server.test.js: 全绿 (2 个 mockEditorConn 更新)
  - static-grep.test.ts: 全绿 (ROUTING drift 检测通过)
npm run check:gdscript → errors=0 / warnings=0
```

---

## 值得进 memory 的工程教训

1. **连接级校验需覆盖三条路径**: 首次连接(`establishEditorConnection`)、显式 rebuild(`rebuildEditorConnection`)、自动重连(`addOnReconnectHandler`)。前两条共用 establishEditorConnection 自动覆盖;自动重连是 EditorConnection 内部循环,需在 handler 里单独追校验。补连接级校验时必须三条路径全覆盖,否则安全闭环有 gap。

2. **字面量契约测试 vs 行为测试的安全护栏权衡**: 安全关键逻辑用字面量契约测试能快速锁结构防回归且成本低,但无法捕获运行时算法 bug。对安全护栏,建议字面量契约 + 至少 1 个真行为测试(跑函数验证 mismatch/匹配)双覆盖。

3. **build/ 同步边界**: `addons/**/*.gd`(分发插件)与 `src/scripts/*.gd`(打包进 build)是两条独立路径。`command_handler.gd` 属前者不进 build。审查时易误判"改了 .gd 必须同步 build/",实际只 `src/scripts/` 进 build。

4. **junction/symlink 对路径比对的干扰**: 即使 normalizeForCompare 做了反斜杠/大小写归一化,junction 启动 editor 仍可能致两端返回不同物理路径表示。字面比对不等时需 fallback 到 realpath 二次归一化,与 `isPathInAllowedRoots` 已用的 `safeRealPath` 同款逻辑。

---

## 相关文件(绝对路径)

- `D:\GitHub\godot-mcp-enhanced\src\GodotServer.ts`(核心: verifyEditorProject:670-700, establishEditorConnection:555-653, normalizeForCompare:811-817, reconnect handler:604-615)
- `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\command_handler.gd`(editor_get_project_path RPC:247-251)
- `D:\GitHub\godot-mcp-enhanced\src\capability\static-grep.ts`(ROUTING 登记:137-139)
- `D:\GitHub\godot-mcp-enhanced\test\editor-project-check.test.ts`(10 契约测试)
- `D:\GitHub\godot-mcp-enhanced\test\editor-fallback-integration.test.js`(WSS mock 更新)
- `D:\GitHub\godot-mcp-enhanced\test\godot-server.test.js`(mockEditorConn 更新)
