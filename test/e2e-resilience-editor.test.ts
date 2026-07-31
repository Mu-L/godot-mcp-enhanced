/**
 * E2E Resilience (editor, OPT_IN) — editor 真进程崩溃后 EditorConnection 自动重连。
 *
 * 补 report4 P0-1① + P0-2: EditorConnection.ts 354 行 mock ws 与真 Godot 进程鸿沟。
 * 仿 e2e-asset-tools,但自管 editor pid(spawn/kill/restart),非外部手动启动。
 * E2E_EDITOR=1 opt-in,CI GUI 不可用默认 skip。
 *
 * ─── 主控 spike override（brief 原 reconnect:false 路径行不通,必读)───
 *
 * brief 原 `reconnect:false` + `requestReconnect()` 路径经读源码确认不可行:
 *  - EditorConnection ctor(:147) `shouldReconnect = options.reconnect ?? true`
 *  - reconnect:false → shouldReconnect=false → reconnectEnabled=false
 *  - requestReconnect()(:557) → resetReconnectState()(:545 设 reconnectEnabled=shouldReconnect=仍 false)
 *    → scheduleReconnect() 被 :477 `if(!this.reconnectEnabled) return` 拦截 → 永不重连
 *
 * 改用 `reconnect:true` + `reconnectInterval:300` 让 close handler 自动触发重连循环
 * (ws.on('close') :268 `if(wasConnected && reconnectEnabled) scheduleReconnect()`)。
 * 不调 requestReconnect——让自动机制自己跑。
 *
 * ─── API 真相(brief/override 误用 getState(),源码无此方法)───
 *
 * EditorConnection 公开方法是 `isConnected(): boolean`(:570)——不是 `getState()`。
 * brief 与 override 都误写为 `conn.getState()==='connected'`,源码核实不可用,改为 `isConnected()`。
 *
 * ─── secret 复用(PERSISTENT_SECRET)───
 *
 * spawn editor 时 env 加 GODOT_MCP_EDITOR_PERSISTENT_SECRET=true,websocket_server.gd
 * 复用现有 mcp_editor.key(kill 重启后 secret 不变 → conn 不用重建)。
 * 若不设,kill 后重生 secret → 旧 conn 的 editorSecret 失效 → 重连 auth 失败 → 测试红(非 bug,环境配置)。
 *
 * ─── 运行方式 ───
 *
 *   cd D:/GitHub/godot-mcp-enhanced
 *   GODOT_PATH="D:/Godot/Godot_v4.6.2-stable_win64.exe" \
 *   E2E_EDITOR=1 \
 *   npx vitest run test/e2e-resilience-editor.test.ts
 *
 * 前提 fixture(test/fixtures/real-project):
 *   - addons/godot_mcp_server/(从仓库根 addons/ 复制,.gitignore 排除运行时副本)
 *   - project.godot 含 [editor_plugins] enabled=PackedStringArray("godot_mcp_server")
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { EditorConnection } from '../src/core/EditorConnection.js';
import { EditorToolExecutor } from '../src/core/EditorToolExecutor.js';
import { readEditorSecret } from '../src/core/editor-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ─── 守卫条件 ────────────────────────────────────────────────────────────────
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);

const REAL_PROJECT = resolve(__dirname, 'fixtures', 'real-project');
const hasProject =
  existsSync(REAL_PROJECT) &&
  existsSync(resolve(REAL_PROJECT, 'project.godot')) &&
  existsSync(resolve(REAL_PROJECT, 'addons', 'godot_mcp_server', 'plugin.cfg'));

// editor opt-in(需 GUI 编辑器 + 插件 + 自管 spawn)
const hasEditorFlag = !!process.env.E2E_EDITOR;

const canRun = hasGodot && hasProject && hasEditorFlag;

// ─── 反假绿 stderr 告警(未启用时显式提示,不静默假绿)───
if (!canRun) {
  const reasons: string[] = [];
  if (!hasGodot) reasons.push(`GODOT_PATH 未设或不存在(当前: ${GODOT_PATH || '<空>'})`);
  if (!hasProject) reasons.push(`real-project fixture 不完整(需 project.godot + addons/godot_mcp_server/plugin.cfg): ${REAL_PROJECT}`);
  if (!hasEditorFlag) reasons.push('E2E_EDITOR=1 未设(需 GUI editor + 插件 + 自管 spawn)');
  process.stderr.write(
    `[E2E-SKIP] e2e-resilience-editor 未启用。原因: ${reasons.join('; ')}\n` +
    `  本测试需真实 Godot editor 运行(mcp-enhanced 插件 + WebSocket 9090),\n` +
    `  CI 环境(GUI 不可用)默认跳过。开发者本机运行步骤:\n` +
    `    1. 复制插件到 fixture(若未做): cp -r addons/godot_mcp_server test/fixtures/real-project/addons/\n` +
    `    2. 确认 test/fixtures/real-project/project.godot 含 [editor_plugins] enabled=PackedStringArray("godot_mcp_server")\n` +
    `    3. GODOT_PATH="<godot.exe>" E2E_EDITOR=1 npx vitest run test/e2e-resilience-editor.test.ts\n`,
  );
}

// ─── 常量 ────────────────────────────────────────────────────────────────────
const EDITOR_PORT = parseInt(process.env.GODOT_EDITOR_PORT ?? '9090', 10);
// reconnectInterval:300ms 让重连快(默认 1000+指数退避太慢,30s 窗口内 attempts 不足)
const RECONNECT_INTERVAL_MS = 300;
// 测试用低 maxReconnectAttempts 避免长时间挂起(默认 20,指数退避后期单次 60s)
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * TCP probe 9090 是否 LISTEN（真实 WS 就绪信号）。
 *
 * 比 secret 文件存在更可靠：PERSISTENT_SECRET=true 模式下残留的 secret 文件让
 * 旧的「secret 存在 = _ready 跑完」假设失效（_ready:48 在 PERSISTENT+残留时立即 return，
 * 但 _start_server:49 还没 LISTEN）。直接探端口避开这个陷阱。
 */
function isPortOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
  });
}

/**
 * spawn editor 非 detached(拿可 kill 的 pid)+ 等就绪。
 * 就绪信号:WS 9090 LISTEN(TCP probe)= plugin _ready 跑完 + _start_server 监听。
 * PERSISTENT_SECRET=true 让 secret 文件不被重生(kill 重启后 conn 复用旧 secret)。
 */
async function startEditor(): Promise<ChildProcess> {
  const child = spawn(GODOT_PATH, ['--editor', '--path', REAL_PROJECT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GODOT_MCP_EDITOR_PERSISTENT_SECRET: 'true',
    },
  });
  // 子进程意外退出时打印 stderr 辅助诊断(不阻断测试)
  child.on('exit', (code, signal) => {
    if (child.exitCode !== null && code !== 0) {
      process.stderr.write(
        `[E2E-DIAG] editor 子进程退出 code=${code} signal=${signal}\n`,
      );
    }
  });
  // 轮询 WS 9090 LISTEN = plugin _ready 跑完（_ready:48 secret → :49 _start_server）
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(EDITOR_PORT, '127.0.0.1')) return child;
    // 子进程可能在 WS LISTEN 前就崩溃(端口冲突/插件编译失败)——提早失败
    if (child.exitCode !== null) {
      throw new Error(`editor 启动后立即退出(exitCode=${child.exitCode}),检查插件编译/端口占用`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error('editor 30s 内未就绪(WS 9090 未 LISTEN)');
}

/** 等待 conn 断开(isConnected() === false),最多 timeoutMs。 */
async function waitForDisconnected(conn: EditorConnection, timeoutMs = 5_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!conn.isConnected()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** 等待 conn 重连成功(isConnected() === true),最多 timeoutMs。 */
async function waitForConnected(conn: EditorConnection, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (conn.isConnected()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// E2E: kill -9 editor → 重启 → EditorConnection 自动重连(reconnect:true + PERSISTENT_SECRET)
// ═══════════════════════════════════════════════════════════════════════════════
describe.skipIf(!canRun)('e2e-resilience (editor): 崩溃后 EditorConnection 真自动重连', () => {
  let editor: ChildProcess | null = null;
  let conn: EditorConnection | null = null;

  afterEach(async () => {
    if (conn) {
      try { conn.disconnect(); } catch { /* best effort */ }
      conn = null;
    }
    if (editor) {
      try { editor.kill('SIGKILL'); } catch { /* best effort */ }
      // 给 OS 回收端口的时间
      await new Promise((r) => setTimeout(r, 500));
      editor = null;
    }
  }, 60_000);

  it('kill -9 editor → 重启 → 自动重连成功(onDisconnect + onReconnect 触发)', async () => {
    // ─── 1. 启动 editor + 建立 conn ────────────────────────────────────────
    editor = await startEditor();
    const secret = readEditorSecret(REAL_PROJECT);
    if (!secret) throw new Error('startEditor 返回后 secret 仍为 null(不应发生)');

    conn = new EditorConnection({
      port: EDITOR_PORT,
      host: '127.0.0.1',
      reconnect: true,                              // ← 非 false!让 close handler 自动重连
      reconnectInterval: RECONNECT_INTERVAL_MS,     // ← 低间隔可测(默认 1000+指数退避太慢)
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS, // ← 避免重连耗尽前超时
      secret,
      connectTimeout: 10_000,
      requestTimeout: 30_000,
    });

    // 跟踪 disconnect/reconnect 事件(证明机制工作,非仅看 isConnected)
    let disconnectFired = false;
    let reconnectFired = false;
    conn.addOnDisconnectHandler(() => { disconnectFired = true; });
    conn.addOnReconnectHandler(() => { reconnectFired = true; });

    await conn.connect();
    expect(conn.isConnected(), '初始连接应成功').toBe(true);

    // ─── 2. 崩溃注入:kill -9 editor(非 detached,pid 可控)──────────────────
    expect(editor.pid, 'editor 应有 pid').toBeTruthy();
    editor.kill('SIGKILL');
    const deadPid = editor.pid!;
    editor = null;

    // 等 ws close 传播(isConnected() 翻 false)
    const disconnected = await waitForDisconnected(conn, 5_000);
    expect(disconnected, 'editor 死后应断连(isConnected=false)').toBe(true);
    expect(disconnectFired, 'onDisconnect handler 应触发').toBe(true);

    // 确认进程真死(避免端口占用让重启失败)
    // process.kill(pid, 0) 不存在的进程会抛 ESRCH;存活则成功返回 true。
    let stillAlive = false;
    try { process.kill(deadPid, 0); stillAlive = true; } catch { /* ESRCH = 已死,预期 */ }
    expect(stillAlive, 'SIGKILL 后 editor 进程应已死').toBe(false);
    // 给 OS 回收 9090 端口的时间
    await new Promise((r) => setTimeout(r, 1_000));

    // ─── 3. 重启 editor(secret 不变:PERSISTENT_SECRET=true)──────────────────
    editor = await startEditor();
    const restartedSecret = readEditorSecret(REAL_PROJECT);
    if (!restartedSecret) throw new Error('重启后 secret 为 null(不应发生)');
    expect(restartedSecret, 'PERSISTENT_SECRET=true 应让 secret 复用不变').toBe(secret);

    // ─── 4. 等自动重连(不调 requestReconnect——reconnect:true 让 close handler 自跑)───
    const reconnected = await waitForConnected(conn, 30_000);
    expect(reconnected, '重启后应自动重连成功(reconnect:true + 300ms 间隔)').toBe(true);
    expect(reconnectFired, 'onReconnect handler 应触发(证明 fireReconnect 调用)').toBe(true);
    expect(conn.isConnected(), '重连后 isConnected()=true').toBe(true);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// E2E: executeChain 串行不变量 — N 个并发 execute 的 conn.request 区间两两不相交
// ═══════════════════════════════════════════════════════════════════════════════
//
// 补 report4 P0-1②: EditorToolExecutor.execute (src/core/EditorToolExecutor.ts:47-54)
// 用 Promise 链把每个 _executeInner 接到 this.executeChain.then(...)，故 N 个并发 execute
// 的 conn.request 不重叠（串行）。这是性能/正确性不变量——防并发 ws.send 到达 GDScript 顺序
// 不可靠致 undo 栈 LIFO 错乱（security P1#2 fix）。
//
// 观测方式（主控 spike 结论，勿另寻）: wrap conn.request 记录每个 request 的 [start,end]
// 时序区间，N=5 个并发 edit_node 后验证区间两两不相交（排序后相邻 end ≤ 下一个 start）。
//
// 真实 editor（非 mock ws）— 补 report4 P0-2 mock 鸿沟。edit_node 经 editor-method-map 路由
// 到 GDScript handle_edit_node（node_commands.gd:148），改 ei.get_edited_scene_root() 活动场景
// 的节点属性 + undo_manager commit。先 open_scene 把 main_3d.tscn 设为活动场景。
//
// A0 TDD 形态：测现有串行契约不写生产代码；绿=契约正确，红=bug 记录归批次不修。
describe.skipIf(!canRun)('e2e-resilience (editor): executeChain 串行不变量（N=5 并发 edit_node）', () => {
  let editor: ChildProcess | null = null;
  let conn: EditorConnection | null = null;
  let exec: EditorToolExecutor | null = null;

  afterEach(async () => {
    if (exec) { try { exec.destroy(); } catch { /* best effort */ } exec = null; }
    if (conn) { try { conn.disconnect(); } catch { /* best effort */ } conn = null; }
    if (editor) {
      try { editor.kill('SIGKILL'); } catch { /* best effort */ }
      // 给 OS 回收端口的时间
      await new Promise((r) => setTimeout(r, 500));
      editor = null;
    }
    // 防御性还原 fixture（edit_node 改的是 editor 内存场景不落盘，但意外 save_scene 时兜底）。
    // real-project 测试可脏（e2e-asset-tools 同模式），但本测试不应改盘——此为 no-op safety net。
    try {
      spawnSync('git', ['-C', REPO_ROOT, 'checkout', '--', 'test/fixtures/real-project/scenes/'], { stdio: 'ignore' });
    } catch { /* best effort */ }
  }, 60_000);

  it('N=5 并发 edit_node → conn.request 区间两两不相交（串行证据）', async () => {
    // ─── 1. 启动 editor + 建立 conn（reconnect:false，此测试不涉及重连）──────────
    editor = await startEditor();
    const secret = readEditorSecret(REAL_PROJECT);
    if (!secret) throw new Error('startEditor 返回后 secret 仍为 null(不应发生)');

    conn = new EditorConnection({
      port: EDITOR_PORT,
      host: '127.0.0.1',
      reconnect: false,                  // 此测试不 kill editor，无需重连
      secret,
      connectTimeout: 10_000,
      requestTimeout: 30_000,
    });
    await conn.connect();
    expect(conn.isConnected(), '初始连接应成功').toBe(true);

    // ─── 2. wrap conn.request 记录时序（在 new EditorToolExecutor 之前）──────────
    // 每次 conn.request 调用记 [start,end]；区间相交 = 并发重叠，不相交 = 串行。
    const times: Array<{ start: number; end: number }> = [];
    const origRequest = conn.request.bind(conn);
    (conn as unknown as { request: typeof origRequest }).request = (
      method: string,
      params: Record<string, unknown>,
      options?: { timeoutMs?: number },
    ) => {
      const start = Date.now();
      return origRequest(method, params, options).finally(() => {
        times.push({ start, end: Date.now() });
      });
    };

    exec = new EditorToolExecutor(conn);

    // ─── 3. open_scene 把 main_3d.tscn 设为活动场景（edit_node 操作 get_edited_scene_root）───
    const openRes = await exec.execute('scene', {
      project_path: REAL_PROJECT,
      action: 'open_scene',
      scene_path: 'res://scenes/3d/main_3d.tscn',
    });
    // 不强断言 open_scene 成功文本（实现可能微调文案）；失败时下面 edit_node 会自然报错暴露
    // content 是 Array<TextContent|ImageContent|AudioContent|EmbeddedResource> union，
    // 直接 .text TS 报错（只 TextContent 有），用 type 守卫窄化。
    const c0 = openRes.content[0];
    const openMsg = c0 && c0.type === 'text' ? c0.text : JSON.stringify(c0);
    expect(openRes.isError, `open_scene 不应失败: ${openMsg}`).not.toBe(true);

    // 清空 times — open_scene 的 request 不参与 N=5 串行断言（只计 edit_node）
    times.length = 0;

    // ─── 4. 并发 N=5 个 edit_node（改 Camera3D position，每个不同 value 防互覆盖平凡）───
    // node_path="Camera3D"（find_node 识别 root 子名）；position 用 Array 格式（coerce_value_for_property
    // 只转 Array→Vector3，Dictionary 不支持，见 command_helpers.gd:99-128）。
    const N = 5;
    // ReturnType<typeof exec.execute> 已是 Promise<ToolResult>，再包 Promise 变双层；
    // 用单层 Array<ReturnType<typeof exec.execute>>。
    const promises: Array<ReturnType<typeof exec.execute>> = [];
    for (let i = 0; i < N; i++) {
      promises.push(exec.execute('scene', {
        project_path: REAL_PROJECT,
        action: 'edit_node',
        scene_path: 'res://scenes/3d/main_3d.tscn',
        node_path: 'Camera3D',
        properties: { position: [i, 2, 8] },
      }));
    }
    const results = await Promise.all(promises);

    // ─── 5a. 反假绿断言：N 个 edit_node 都应成功（防 UNKNOWN_ACTION / 笔误假绿，P1-10 教训）───
    expect(results.length, '应收到 N 个结果').toBe(N);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      // 同 open_scene：content union 窄化后取 .text（变量名 c1 避免与外层 c0 冲突）。
      const c1 = r.content[0];
      const rmsg = c1 && c1.type === 'text' ? c1.text : JSON.stringify(c1);
      expect(r.isError, `edit_node[${i}] 不应失败: ${rmsg}`).not.toBe(true);
    }

    // ─── 5b. 核心断言：times 区间两两不相交 = 串行证据 ─────────────────────────────
    expect(times.length, `应记录 ${N} 个 request 时序（实际 ${times.length}，可能 open_scene 未清或 edit_node 未走 conn.request）`).toBe(N);
    const sorted = [...times].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      // 串行 = 前一个 end ≤ 下一个 start（区间不相交）。并行重叠会 curr.start < prev.end。
      expect(
        curr.start,
        `request[${i}] start(${curr.start}) 应 >= 前一个 end(${prev.end})（串行证据；delta=${prev.end - curr.start}ms 重叠）`,
      ).toBeGreaterThanOrEqual(prev.end);
    }
  }, 120_000);
});
