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
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EditorConnection } from '../src/core/EditorConnection.js';
import { readEditorSecret } from '../src/core/editor-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
 * spawn editor 非 detached(拿可 kill 的 pid)+ 等就绪。
 * 就绪信号:mcp_editor.key 生成 = plugin _ready 跑完 + WS 9090 LISTEN。
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
  // 轮询 secret 文件 = plugin _ready 已跑 + WS 监听
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (readEditorSecret(REAL_PROJECT)) return child;
    // 子进程可能在 secret 生成前就崩溃(端口冲突/插件编译失败)——提早失败
    if (child.exitCode !== null) {
      throw new Error(`editor 启动后立即退出(exitCode=${child.exitCode}),检查插件编译/端口占用`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error('editor 30s 内未就绪(mcp_editor.key 未生成)');
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
