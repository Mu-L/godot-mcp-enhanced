# MCP 工具 backlog 次要项收尾(M4 + manage_tools)+ S4/S5/S6 运行时验证

**日期**:2026-06-24
**分支**:`fix/mcp-tools-s1-s3-s4`
**来源**:`docs/review-followup-2026-06-23-mcp-tools.md` 的 🟡 中/🟢 轻项收尾,承接 S1/S3/S4/S5/S6/M2/M3/M5/M6 已修批次

---

## 1. 背景与范围

backlog 次要项共 3 个子项,源码核查后范围收敛:

| 子项 | 核查结论 | 本次处理 |
|------|---------|---------|
| **M4** run_project 后 bridge 未就绪 | 真问题:`runtime.ts:148-187` spawn 后立即返回,无 bridge 就绪探测 | ✅ 改代码 |
| **manage_tools** reconnect/sync `NOT_IMPLEMENTED` | `manage-tools.ts:133-139` 纯 stub,模块无连接引用 | ✅ 改代码 |
| 默认引擎 4.7(非 GODOT_PATH) | `godot-finder.ts:252-279` 已是 GODOT_PATH env 优先,"默认 4.7"= env 未注入 fallback PATH,**= M3 文档化已覆盖,无代码 bug** | ❌ 剔除 |

**外加**:S4/S5/S6 运行时交互验证(代码已修,但 backlog 标注"留给用户 F5 实测")。本次用 MCP `run_project` 驱动 + bridge 工具验证,顺带验证 M4。

**非目标**(YAGNI):不重构 runtime/bridge 架构;不引入 bridge 持久连接;不改 findGodot(env 注入是配置层,见 M3)。

---

## 2. M4 — run_project bridge 就绪探测(方案 A)

### 2.1 目标行为

`run_project` 加两个可选参数,把 bridge 就绪探测收进同一调用,工作流最自然:

| 参数 | 类型 | 默认 | 语义 |
|------|------|------|------|
| `wait_for_bridge` | bool | `false` | true 时 spawn 后轮询 bridge 就绪 |
| `bridge_timeout` | number(秒) | `10` | 轮询总预算 |

- `wait_for_bridge=true`:spawn 游戏后,在 `bridge_timeout` 内轮询(每 500ms)bridge 是否就绪(secret 文件存在 + TCP auth 成功)。就绪 → 返回含 `bridge ready`;超时 → 返回 **warning**(`bridge 未在 {N}s 内就绪,后续 game_query 可能失败`),**不阻塞、不报错**
- `wait_for_bridge=false`(默认)→ 行为完全不变,向后兼容
- 非 bridge 项目传 true → secret 不存在 → 立即 warning(`未安装 bridge,跳过探测`),不报错
- **进程早退失败模式**:`timeout < bridge_timeout`(如 timeout=3/bridge_timeout=10)时游戏被 autoStopTimer 提前杀,isBridgeReady 短路返回 `process exited during probe`,run_project 给 warning(`游戏进程在探测期间退出`),不傻等满 bridge_timeout

返回文本(成功):`Running project at {p} (timeout: {N}s). Bridge ready. Use get_debug_output...`
返回文本(超时):`Running project at {p} (timeout: {N}s). ⚠ Bridge not ready after {M}s — game_query may fail. Use...`

### 2.2 改动点

**`src/tools/game-bridge.ts`** — 新增导出函数:
```ts
export async function isBridgeReady(
  projectDir: string,
  timeoutMs: number,
  opts?: { proc?: ChildProcess; isCancelled?: () => boolean },
): Promise<{ ready: boolean; reason: string }>
```
- 用**独立短 socket** 探测(不碰模块级 `_socket` / `_socketAuthenticated` / `_socketBuffer`,避免污染后续真实请求的连接缓存)
- **零接触缓存**:用传入 projectDir 自拼 `join(projectDir, '.godot', 'mcp_bridge_' + BRIDGE_PORT + '.secret')` 自读 secret,全程不碰模块级 `_projectDir` / `_cachedSecret` / `_cachedSecretAt`(自读不污染缓存)
- 流程:在 timeoutMs 内每 500ms 重试 —— secret 文件存在? → 尝试 TCP createConnection 到 9081 + 发 auth + 等 `result.authenticated` → 成功即 ready=true 并立即 `socket.destroy()`
- **进程早退短路**(真实失败模式:用户传 `timeout=3` + `wait_for_bridge=true`,游戏 3s 被 autoStopTimer 杀 `runtime.ts:163-169`,探测却傻等 `bridge_timeout=10`s):run_project 传 `{ proc, isCancelled: () => ctx.runningProcess !== proc }`,轮询每轮检查 `opts.proc?.killed` / `opts.isCancelled?.()`,命中即 ready=false、reason=`process exited during probe` 提前返回,不等满 timeoutMs
- secret 不存在 → ready=false,reason=`secret not found (bridge not installed?)`
- 连接/auth 失败 → 继续重试直到 timeoutMs

**`src/tools/runtime.ts` run_project case**(`:120-188`):
- 解析新参数:`const waitForBridge = args.wait_for_bridge === true; const bridgeTimeout = Math.max(1, Number(args.bridge_timeout) || 10);`
- spawn 游戏后、返回前:`if (waitForBridge) { const r = await isBridgeReady(p, bridgeTimeout * 1000, { proc, isCancelled: () => ctx.runningProcess !== proc }); warnPrefix += r.ready ? 'Bridge ready. ' : `⚠ Bridge not ready (${r.reason}). `; }`
- 注:探测在 `ctx.setRunningProcess(proc, true)` 之后、return 之前,不阻塞游戏进程

**`src/tools/runtime.ts` 工具 schema**:run_project 的 inputSchema 加 `wait_for_bridge` / `bridge_timeout` 两个可选属性 + 描述。

### 2.3 为什么独立连接不污染

`_doConnect`(game-bridge.ts:121)会 set 模块级 `_socket`。若 isBridgeReady 复用它,探测后留下的 socket 状态会干扰下一个真实 `game_query`。故 isBridgeReady 用独立 `createConnection`,auth 验证后立即 destroy,模块状态零接触。

**接受的重复**:handshake 逻辑(createConnection + auth JSON + 等 `result.authenticated`)与 `_doConnect`(game-bridge.ts:121)有约 20 行偶然重复。语义不同 —— `_doConnect` 建持久连接并注册 close/error monitor,isBridgeReady 即建即毁 —— 故予以接受。`_doConnect` 零改动(守住 §1 非目标"不重构")。

---

## 3. manage_tools — reconnect/sync 接入真实连接状态

### 3.1 注入机制(复用 setOnGroupsChanged 模式)

`GodotServer.ts:143` 已用 `setOnGroupsChanged(() => this.sendToolListChanged())` 把回调注入 manage-tools。同理新增:

**`src/tools/manage-tools.ts`**:
```ts
export interface ConnectionStatus {
  editor: { installed: boolean; connected: boolean; state: ConnectionState | null };
  bridge: { note: string };  // "每请求建连,无持久连接"
}
let _connectionStatusProvider: (() => ConnectionStatus) | null = null;
export function setConnectionStatusProvider(fn: (() => ConnectionStatus) | null): void { _connectionStatusProvider = fn; }

// 重连触发器(editor connect 是 async,单独注入)
let _reconnectEditor: (() => Promise<{ connected: boolean; detail: string }>) | null = null;
export function setReconnectEditor(fn: (() => Promise<{ connected: boolean; detail: string }>) | null): void { _reconnectEditor = fn; }
```

**`src/GodotServer.ts`**:
- `setConnectionStatusProvider(() => ({ editor: { installed: !!this.editorConn, connected: !!this.editorConn?.isConnected(), state: this.dispatcher?.getHealthMonitor().getState() ?? null }, bridge: { note: '每请求建连,无持久连接' } }))`
- `setReconnectEditor(async () => { if (!this.editorConn) return { connected: false, detail: 'editor 未安装,用 launch_editor' }; if (this.editorConn.isConnected()) return { connected: true, detail: '已连接' }; try { await this.editorConn.connect(); return { connected: this.editorConn.isConnected(), detail: '手动重连完成' }; } catch (e) { return { connected: false, detail: `重连失败: ${e}` }; } })`
- `stop()` 里 `setConnectionStatusProvider(null); setReconnectEditor(null);`(对齐 `setOnGroupsChanged(null)` at :385)

> API 已确认:`ToolDispatcher.getHealthMonitor()`(ToolDispatcher.ts:111)→ `HealthMonitor.getState(): ConnectionState`(health-monitor.ts:174)。`EditorConnection.connect()`(EditorConnection.ts:139 async)、`isConnected()`(:511)均已存在。

### 3.2 reconnect action(`handleReconnect` 改 async)

当前 `manage-tools.ts:137-139` 返回 NOT_IMPLEMENTED。改为:
- 若 editor 组 active:
  - `_reconnectEditor` 存在 → 调用,返回 `{ reconnected: result.connected, detail }`
  - 不存在(无 provider)→ 返回当前状态 + "MCP 服务端未注入连接管理,用 launch_editor / F5 启动编辑器"
- bridge → 返回 `{ reconnected: false, detail: "bridge 每请求建连,无需重连;用 game_query(method=ping) 探测" }`(明确 no-op,文档化)
- 返回 opsSuccess 含 editor 结果

### 3.3 sync action

当前 `manage-tools.ts:133-135` 返回 NOT_IMPLEMENTED。改为返回每个 active group 的 `requires`(类型 `('bridge'|'editor'|'headless')[]`,tool-registry.ts:128)实际状态:
```
{
  groups: [
    { name, active, requires: [...], status: "connected"|"disconnected"|"probe-required"|"n/a" }
  ],
  editor: { installed, connected, state },
  bridge: { note }
}
```
- `requires` 含 `'editor'` → `status = provider.editor.connected ? "connected" : "disconnected"`
- `requires` 含 `'bridge'` → `status = "probe-required"`(需 game_query ping)
- `requires` 为空数组(core/animation/audio/visual/physics/navigation/ui/tilemap/signal/profiler/code 等)→ `status = "n/a"`
- provider 不存在 → 回退到 list_groups 行为 + warning

### 3.4 schema 更新

`manage_tools` 描述已含 sync/reconnect(:33-34),无需改 enum。仅在实现后更新描述文案去掉"未实现"暗示(若有)。

---

## 4. S4/S5/S6 运行时验证(第②项,顺带验 M4)

### 4.1 前提

- S4/S5/S6 修复在 `src/scripts/mcp_bridge.gd`(模板)。`D:/GitHub/rpg-mcp-pilot` 的 bridge 是 install 时拷贝的**旧副本**,需重新 install 拿新版
- run_project 是 GUI 模式(`--debug`,弹 Godot 窗口),由 MCP `run_project` 驱动启动

### 4.2 准备步骤

1. `game_bridge_install(project_path="D:/GitHub/rpg-mcp-pilot")` → 拿含 S4 env / S5 extra-methods / S6 physical_keycode 的新 mcp_bridge.gd
2. 配 MCP 服务端 env(写入宿主 settings.json 的 MCP env 段):
   - `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`(S4)
   - `GODOT_MCP_BRIDGE_EXTRA_METHODS=emit_signal`(S5 验证用)
3. **重启 MCP 服务端 / 宿主 Claude Code**(env 进程级固化,见 M3 文档)—— ⚠ 这一步会导致当前会话中断,需在代码改动全部完成后、专门的验证会话执行

### 4.3 验证步骤(MCP 工具驱动)

| 项 | 步骤 | 通过判据 |
|----|------|---------|
| **M4** | `run_project(wait_for_bridge=true)` → 紧接 `game_query(method=ping)` | ping 立即返回 ok(无需手动等) |
| **S4** | 跨 5min TTL 后再 ping;读 `.godot/mcp_bridge_9081.secret` 权限 | secret 不被收紧/删除,反复 ping 不失效 |
| **S5** | `game_write(method=call_method, params={path, method:"emit_signal", args:[...]})` 触发 GameEvents 信号 → `game(action=watch_start, signal_name=...)` | 信号事件被记录(确认 EXTRA_METHODS 生效) |
| **S6** | `game_input(method=send_key, params={key:"D"或"Right"})` → `game_wait(method=wait_for_property, params={path:"/root/Player", property:"position", ...})` | Player 位置变化(确认 physical_keycode 触发 input action) |

### 4.4 已知约束

- S5 需 rpg-mcp-pilot 有可触发的业务信号(Phase2 GameEvents.enemy_encountered 等)
- S6 需 rpg-mcp-pilot 的 input map 用 physical_keycode 映射(Phase1 player_controller);若该项目用 keycode 映射则 S6 验证需调整
- 验证用 run_project GUI 弹窗,需用户机器有显示且未被占用(stop_project 先清理残留进程,见 core rule run_and_verify 残留进程陷阱)

---

## 5. 测试策略

### 5.1 单元测试(TDD:RED→GREEN)

**M4**:
- `game-bridge.test.ts`:isBridgeReady 四态 —— ready(secret 存在 + mock TCP auth 成功)/ secret 不存在 reason / 超时 reason / 进程早退短路 reason(`opts.isCancelled` 或 `opts.proc.killed` 命中即提前返回,不等满 timeoutMs);**零接触断言(进 TDD RED 用例)**:探测前后三者均不变 —— `_socket === null && _projectDir 未改 && _cachedSecret 未改`(自读 secret 不污染缓存,承诺强于"不碰 _socket")
- `runtime.test.ts`(或 run_project 集成):mock isBridgeReady 返回 ready/timeout/no-secret/process-exited,断言 run_project 返回文本含对应 success/warning;`wait_for_bridge=false`(默认)不调 isBridgeReady;进程早退用例:`timeout=3, bridge_timeout=10` 且 isCancelled 在进程被杀后返回 true → isBridgeReady 提前返回 `process exited during probe`,run_project warning 含相关字样

**manage_tools**:
- `manage-tools.test.ts`:注入 mock provider + reconnectEditor;reconnect 三分支(已连接 / 重连成功 / 无 provider);sync 状态映射(editor connected/disconnected、bridge probe-required、core n/a);provider 不存在时回退

### 5.2 运行时验证(非单测)

S4/S5/S6/M4 的运行时交互写进验证 checklist(§4.3),不在 vitest 套件(依赖真实 Godot 进程 + GUI)。

### 5.3 回归

全套 vitest 须通过(当前基线 2718+ passed);tsc 0 错;eslint 0 警告。

---

## 6. 文档更新

- `docs/review-followup-2026-06-23-mcp-tools.md`:追加"M4 / manage_tools 已修"进展段
- `.claude/rules/godot-mcp-core.md` 或 `godot-mcp-bridge.md`:`run_project wait_for_bridge` 参数 + manage_tools reconnect/sync 真实行为(替代"NOT_IMPLEMENTED"描述,若有)
- memory:更新 `mcp-godot-scene-script-pitfalls` 或新增 backlog 收尾记录(M4/manage_tools 修法要点)

---

## 7. 关联

- backlog:`docs/review-followup-2026-06-23-mcp-tools.md`
- 验证项目:`D:/GitHub/rpg-mcp-pilot`(Phase1 骨架 + Phase2 战斗)
- memory:`mcp-godot-scene-script-pitfalls` / `class-name-cache-import-rebuild` / `rpg-mcp-pilot-phase-status`
- 依赖规则:core rule M3(env 进程级固化,需重启 MCP);bridge rule S4/S5/S6 段
