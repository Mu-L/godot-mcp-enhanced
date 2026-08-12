# 第三方审查:全批次安全/隐私/可靠性漏洞修复(commit 链)

- **审查对象**:分支 `feat/multi-instance-receiver-and-e2e-asset-harness` 11 个 commit(9a27af8 / 66d84ad / 6564309 / caba7d2 / 39f7295 / cdbb239 / 17e22a3 / fdf04ec / 9c872ce / 983ea01 / ee8ff98)
- **审查日期**:2026-08-12
- **审查者**:code-reviewer 子 agent(隔离视角,所有声明 grep/read 实测)
- **基线**:package.json version 0.28.1,Node >=20.0.0(closeAllConnections Node 18.2+ 可用)

## 总体判定

**SHIPPED WITH NITS** — 核心 5 审查重点(批次 C 安全 / 批次 D 可靠性 / 批次 B 隐私 / 仓库级约束 / P0 接线)全部达标。**无 Blocking Issues**。

---

## 逐批次结论

### 批次 C(commit `fdf04ec`)— 安全防护:达标

**1. set/set_indexed deny-list 阻断 set_script 绕过 — 有效**

- `addons/godot_mcp_server/commands/engine_commands.gd:22-28` `DEFAULT_CALL_DENYLIST` 含 `"set_script", "set", "set_indexed"`(:26 注释明确"防 `callv("set",["script",val])` 绕 set_script deny")。
- 检查点 `:237` `if method in denylist:` 精确字符串匹配。GDScript 方法名大小写敏感,`engine_call_method(method="set", ...)` / `method="callv"` / `method="set_script"` 三条路径全被拦(`callv` 亦在表 :25)。
- `src/scripts/mcp_bridge.gd:92-95` `EXTRA_METHODS_BLOCKLIST` 同样含 `"set_script", "set", "set_indexed"`。双层防护:`:950-951` 即使 env `GODOT_MCP_BRIDGE_EXTRA_METHODS` 显式列 "set",`EXTRA_METHODS_BLOCKLIST` 二次拦截(不可覆盖硬底线)。
- editor + bridge 两端对称。✓

**2. symlink 预检覆盖 tmp + target,Windows/Linux 范式正确 — 有效**

- `addons/godot_mcp_server/instance_registry.gd:96-106` `_is_symlink`:
  - Windows:`Get-Item -LiteralPath $env:_MCP_SYMLINK_CHK -Force).LinkType` + `exit 3`。`LinkType` 非空覆盖 SymbolicLink/HardLink/Junction 三类。`-NoProfile` 跳 profile 加载防污染。
  - Linux:`readlink path` exit 0 = symlink。
- 调用点 `:112` `if _is_symlink(tmp_file) or _is_symlink(_instance_file):` 同时检查 `.tmp` + 目标文件两处。
- 与 SEC-P2-2 `mcp_bridge.gd:383-413` 对齐(`_write_secret_to_file` 同款范式)。
- **TOCTOU 是固有已知限制**(check-use 时间窗),AGENTS.md「诚实边界」明确这是"防误操作层非不可绕过"——不升 Blocking。

**3. debug.evaluate RCE 双层防护 — 真阻断**

- 第一层(action-gate opt-in):`src/core/action-gate.ts:27` `'debug.evaluate'` ∈ `GATED_ACTIONS['code-execution']`。接入点 `src/core/ToolDispatcher.ts:273` `if (isActionGated(name, _action) && !isActionAllowed(...))` 返 `ACTION_GATED`。未设 `GODOT_MCP_PRIVILEGED_GROUPS=code-execution` 时默认拦截。✓
- 第二层(risk confirm):`src/tools/debug.ts:141` `evaluate: 'write'`(原 'read'→'write')。`src/guard.ts:67` `return risk !== undefined && risk !== 'read';` → 'write' 触发 confirm。✓
- GD 侧无沙箱(诚实 deferred):`addons/godot_mcp_server/commands/debug_commands.gd:360` `session.send_message("evaluate", [expression])` 发任意 expression 到游戏进程执行。debug.ts:146 注释明确"第三层(GD 侧 scanGdscriptSandbox)deferred:GD 侧无现成沙箱"。三层缺一(TS 双层 + GD 零层),但双层已在 TS 侧有效把关,且 opt-in + confirm 是用户显式授权。诚实声明,非 Blocking。

**4. reload_scripts path traversal — 有效(over-blocking)**

- `debug_commands.gd:510` `if path_str.contains(".."):` 拦截任何含连续两点的路径。会误拦 `res://foo..bar.gd`(Godot 资源命名罕见),但安全有效。配套守卫:`:506` `begins_with("res://")` + `:513` 拒 MCP addon。

---

### 批次 D(commit `caba7d2` + `39f7295`)— 可靠性:达标

**1. withTimeout timer 清理 + TimeoutError 区分 — 正确**

- `src/core/instance-http-server.ts:57-69` `withTimeout`:try/finally `clearTimeout(timer)` 防泄漏。无论 promise 先 resolve 还是 timeout 先 reject,finally 都清理。
- `:46-51` `TimeoutError` 模块内 class,catch 用 `instanceof` 区分:
  - 超时 → `:182` body read 408 / `:209` tool forward 504
  - dispatcher 异常 re-throw → 外层 `:218` 500
  - H9 语义保持(超时 504 vs dispatcher 异常 500)。✓

**2. closeAllConnections — 可用 + 用法正确**

- `:120` `this.server.closeAllConnections?.();` 可选链,Node <18.2 静默跳过。package.json `engines.node >=20.0.0`,一定可用。
- 防 in-flight 长请求(nav bake 110s / test_run 290s)致 `server.close()` 延迟回调。✓

**3. CMP-1 TOCTOU 修复(_editorVerifying flag)— 完整覆盖校验期**

- `src/GodotServer.ts:104` `private _editorVerifying = false;`;`:645` 构造 EditorToolExecutor 时注入 `() => this._editorVerifying`。
- 重连 handler `:659-689`:`:666` `_editorVerifying = true`(同步设置)→ `:667` `void this.verifyEditorProject().then(...)` → `:672-674` `.finally(() => { this._editorVerifying = false; })`(无论 ok/mismatch/reject 都复位)。
- gate `src/core/EditorToolExecutor.ts:89` `if (this.isVerifying?.()) return opsErrorResult('VERIFICATION_IN_PROGRESS', ...)`。校验期 editor 工具入口即时返错。✓
- **时序窗口分析**(关键):`EditorConnection.ts:187` `connected=true` → `:210` `await performAuth()` → `:242-245` `fireReconnect()`。`authenticated=true`(performAuth 内 `:460`)到 `fireReconnect` 之间(:211-245)**同步原子执行无 await**,JS 单线程无其他任务插入。fireReconnect 后 `_editorVerifying=true` 覆盖整个 verifyEditorProject async 校验期。performAuth 的 await 期间 authenticated=false,editor 侧拒绝未认证请求。**无 TOCTOU 窗口**。✓

---

### 批次 B(commit `cdbb239` + `17e22a3`)— 隐私披露:达标

**1. vision-router 四处披露一致 — 完整**

- `docs/telemetry.md:174-195`「非 telemetry 外传点:Vision Router」段完整披露:截图 base64 + prompt + groq endpoint(`https://api.groq.com`) + 双重 opt-in 门控 + `GODOT_MCP_VISION_BASE_URL` 覆盖。
- `README.md:78` + `README.en.md:73` + `CHANGELOG.md:12,21` 四处同步。
- **代码侧行号实测一致**:
  - `src/core/vision-router.ts:52` `DEFAULT_BASE_URL`(telemetry.md 称 `:52` ✓)
  - `:149` `image_url: { url: data:${mimeType};base64,... }`(telemetry.md 称 `:149` ✓)
  - `:137-139` apiKey 检查返 `{success:false, error:'No API key'}`(defense-in-depth 第三层)
  - `src/tools/screenshot.ts:217` `if (args.vision_route === true)`(telemetry.md 称 `:217` ✓)+ `:218` `process.env.GODOT_MCP_VISION_KEY`
- **双重 opt-in 门控有效**:per-call `vision_route=true`(默认 false)+ env `GODOT_MCP_VISION_KEY`(未设 fallback 本地 detail,零外传)。无 key 时 `:219-224` fallback 加 note 不阻断。✓

**2. script 措辞 generic(17e22a3)— 达标**

- `src/tools/script.ts:343` description 已含 generic 诚实措辞:"execute_gdscript(⚠️ 沙箱仅防误操作,不可用于不可信输入。高安全场景请用 ALLOW_EXECUTE_GDSCRIPT=false 或容器隔离)"。
- **17e22a3 改的是 `script.ts`(MCP tool description),不触发独立副本同步约束**(独立副本约束是 `.claude/rules/ ↔ rule-templates.ts`,script.ts 不在此范围)。
- `src/tools/rule-templates.ts:759` "GDScript 沙箱是**防误用层非防对抗**" ↔ `.claude/rules/godot-mcp-workflow-safe-edit.md:14` 完全相同内容(workflow-safe-edit 段同步)。✓

---

### 仓库级约束核查(AGENTS.md):基本达标(1 pre-existing drift NIT)

- **capability-matrix**:本会话无工具清单变更(只改 risk/action-gate/内部基础设施 instance-http-server.ts)。`docs/capability-matrix.md` 不记录 per-action risk,不需重建。✓
- **version bump 0.28.0→0.28.1**:本会话 11 commit 均**未改** `rule-templates.ts` 或 `claudemd-builder.ts`。`check-rules-version-bump.mjs` 只在模板源变更时要求 bump,本会话不触发,0.28.1 在 `[Unreleased]` 累积无违规。✓
- **NIT(pre-existing,见下)**:`.claude/rules/godot-mcp-core.md` core 段与 `rule-templates.ts` core 段存在历史 drift。

---

### P0 接线测试(commit `66d84ad` + `6564309`):达标(引用既有审查)

- `docs/reviews/2026-08-11-p0-wiring-tests.md` 已详审 **SHIPPED**:三条 P0 删码红测推演达标,N.1/N.2 子分支已修。
- `9a27af8` looksLikeErrorObject 收紧(`src/core/response-format.ts:77-80` 要求 `message` AND `error_code` 共存):删码红测有效。✓
- `9c872ce` cpp stubEnv 改 `asUnrestrictedPath`:修复跨文件 env 泄漏。✓

---

## Blocking Issues

**无。**

---

## Nits

### N-1 [Low] godot-mcp-core.md ↔ rule-templates.ts core 段 pre-existing drift(历史积累,非本会话引入)

- **位置**:`.claude/rules/godot-mcp-core.md:47-52` / `:54-60` / `:62-67` / `:83-88` / `:99-109` 在 `src/tools/rule-templates.ts` core 段无对应。
- **影响**:`scripts/check-rules-content-sync.mjs` advisory 模式 WARN 不阻断。违反 AGENTS.md「独立副本同步约束」但不阻塞交付。
- **责任**:多 commit 历史积累,非本会话 11 commit 引入。
- **建议**:follow-up 统一同步,或择机启用 `STRICT=1`。

### N-2 [Low] withTimeout 超时后底层 promise 无法取消

- **位置**:`src/core/instance-http-server.ts:57-69`。
- **问题**:超时 reject 后底层 `dispatcher.handleCall` promise 仍在后台执行(JS Promise 不可取消)。注释"避免孤儿请求"略乐观。
- **影响**:JS 固有特性,非 bug。长操作超时后后台继续耗资源。

### N-3 [Low] reload_scripts `contains("..")` over-blocking

- **位置**:`addons/godot_mcp_server/commands/debug_commands.gd:510`。
- **问题**:误拦合法文件名含双点(如 `res://foo..bar.gd`,Godot 罕见)。over-blocking 比 under-blocking 安全。

---

## 工程教训(值得进 memory)

1. **deny-list 精确匹配的有效性边界**:`if method in denylist` 精确字符串匹配对 GDScript 方法名有效,但需配套阻断所有间接调用路径(`call`/`callv`/`call_deferred`/`set`/`set_indexed` 全在表)。审查 deny-list 时不能只看 `set_script` 在表,要验证所有间接调用路径是否都被同表覆盖。→ security-lesson。

2. **symlink 预检的 TOCTOU 固有限制**:所有预检式 symlink 检测都有 check-use 时间窗。审查时不应把 TOCTOU 当 Blocking——AGENTS.md「诚实边界」明确这是"防误操作层非不可绕过,需真正隔离用容器/VM"。→ security-lesson。

3. **action-gate + risk confirm 双层防护接线核查法**:RCE 面 action 需独立验证两层:(1) `GATED_ACTIONS` 表含 `工具名.action` 且 `isActionGated` 在 `executeToolCall` 入口接入;(2) `TOOL_META.actionRisks[action] !== 'read'` 且 `guard.requiresConfirmation` 读此值。单层失效需另一层兜底。→ security-lesson。

4. **重连 TOCTOU flag 的时序核查法**:flag 修复的完整性,关键是核查 flag 设置点与"威胁状态变更点"之间是否同步原子(无 await)。`EditorConnection.ts:211-245` authenticated=true 到 fireReconnect 之间同步执行是修复成立的核心。→ methodology-lesson。

5. **独立副本 drift 的 advisory 陷阱**:`check-rules-content-sync.mjs` 默认 advisory(WARN 不阻断)兼容历史 drift,但新 drift 也静默放过。审查 rule-templates / .claude/rules 改动时必须手动逐段对比,改动后考虑跑 `STRICT=1` 验证。→ methodology-lesson。

---

## 审查者注

本次审查受 code-reviewer 无 Bash 限制,所有行号/内容声明均 grep/read 实测。验证命令(lint/build/test/check:gdscript)由实现者跑全绿:lint 0 / build 0 / npm test 5054 passed / check:gdscript 0 error 0 warning。

批次 A 剩余(P1-3 scene 错误路径 / P2-1 codemod 50 条弱断言 / project-management mockFailureResult 失败分支 / CI P1-1/P1-2)按协调者声明非本会话完成,标 follow-up,未审。
