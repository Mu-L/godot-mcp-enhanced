import { createConnection, Socket } from 'net';
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, chmodSync, statSync, lstatSync, renameSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { userInfo } from 'os';
import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { Tool } from "@modelcontextprotocol/server";
import type { ToolContext, ToolResult } from '../types.js';
import { textResult, errorResult, getErrorMessage } from '../types.js';
import { opsErrorResult } from './shared.js';
import { requireProjectPath } from '../helpers.js';
import { launchDashboardOnce } from '../dashboard/launcher.js';
import { parseAutoloadNames } from '../gdscript-executor.js';
import type { RiskLevel } from '../core/tool-registry.js';
import { getLogger } from '../core/logger.js';
import { getDefaultRegistryDir } from '../core/instance-manager.js';

const BRIDGE_PORT = 9081;
const BRIDGE_HOST = 'localhost';
const BRIDGE_SCRIPT_NAME = 'mcp_bridge.gd';
// G-5 (2026-08-14 批D实测发现): autoload 段的键名就是 Godot 节点名,不得带 'autoload/' 前缀 —
// 旧版(≤0.23.x)误写 'autoload/MCPBridge',Godot 截断为同名 "autoload" 节点(MCPBridge 与
// MCPOVERRIDE_* 冲突 → override 未加载)。写入键已去前缀;LEGACY 常量仅用于识别/迁移旧键。
const AUTOLOAD_KEY = 'MCPBridge';
const AUTOLOAD_KEY_LEGACY = 'autoload/MCPBridge';
const DEFAULT_TIMEOUT = 10000;

/** Bridge 连不上 / 未正常工作(游戏未运行、未装 autoload、认证失败)。agent 自愈:启动游戏 / 确认安装。 */
export class BridgeNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeNotConnectedError';
  }
}
/** Bridge 连上 + 认证成功后请求无响应(游戏被 runtime error 卡住)。agent 自愈:查游戏报错 / 加大 timeout。 */
export class BridgeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeTimeoutError';
  }
}

const ERROR_CODES = {
  BRIDGE_NOT_CONNECTED: 'BRIDGE_NOT_CONNECTED',
  BRIDGE_TIMEOUT: 'BRIDGE_TIMEOUT',
  BRIDGE_ERROR: 'BRIDGE_ERROR',
} as const;

/** Clamp a millisecond timeout value. Returns default on invalid/zero input.
 *  Exported for pure-function unit tests (game-bridge-validation.test.ts)。 */
export function clampTimeoutMs(value: unknown, min = 1000, max = 60000, def = 10000): number {
  if (value === undefined || value === null) return def;
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ─── TCP client for Bridge communication ────────────────────────────────────

// ─── A1 (2026-08-19 反馈 bridge 9081 多实例劫持): 实际端口解析 ────────────────
// GD 侧 mcp_bridge.gd 启动时把 projectPath/port/pid/lastSeen 写入 machine-level
// registry(30s 心跳,退出删除),端口被占时自动递增避让。TS 侧按 projectPath 匹配
// 最新存活条目取实际端口;registry 不可读/无匹配/条目全部超龄(崩溃残留)时回落 9081,
// 对旧版 GD(不写 machine registry)完全兼容。
const BRIDGE_REGISTRY_MAX_AGE_MS = 5 * 60 * 1000;  // 心跳 30s,容 10 个心跳周期

/** 镜像 GD 侧 machine registry 目录。GD: OS.get_data_dir().get_base_dir().get_base_dir()/
 *  .godot-mcp/instances —— 实测三平台(Win %APPDATA%/Linux ~/.local/share/mac ~/Library/
 *  Application Support)两次 base_dir 都归一到用户主目录,与 instance-manager.getDefaultRegistryDir
 *  (既有实现,~/.godot-mcp/instances)一致,直接复用防两处推导漂移。 */
export function machineRegistryInstancesDir(): string {
  return getDefaultRegistryDir();
}

/** 项目路径归一化(分隔符统一 + Windows 大小写不敏感)用于跨进程 projectPath 匹配。 */
export function normalizeProjectKey(p: string): string {
  const r = resolve(p).replace(/[/\\]+/g, '/');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** 解析 projectPath 对应 bridge 实例的实际监听端口(见区块注释);失败回落 BRIDGE_PORT。
 *  registryDir 参数仅供单测注入,生产走 machineRegistryInstancesDir()。 */
export function resolveBridgePort(projectPath: string, registryDir: string = machineRegistryInstancesDir()): number {
  if (!projectPath) return BRIDGE_PORT;
  try {
    const dir = registryDir;
    const want = normalizeProjectKey(projectPath);
    const now = Date.now();
    let best: { port: number; lastSeen: number } | null = null;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      let entry: { projectPath?: unknown; port?: unknown; lastSeen?: unknown; capabilities?: unknown };
      try {
        entry = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as typeof entry;
      } catch { continue; }  // 损坏条目(崩溃 .tmp 残留等)容错跳过
      if (typeof entry.port !== 'number') continue;
      // 同目录还住着 server 自注册条目(capabilities=['ts-http-receiver']),只认 bridge 心跳条目
      if (!Array.isArray(entry.capabilities) || !entry.capabilities.includes('registry-heartbeat')) continue;
      if (typeof entry.projectPath !== 'string' || normalizeProjectKey(entry.projectPath) !== want) continue;
      // GD Time.get_datetime_string_from_system() 输出无时区 ISO 串,JS 按本地时区解析,同机一致。
      const lastSeen = typeof entry.lastSeen === 'string' ? Date.parse(entry.lastSeen) : NaN;
      if (!Number.isFinite(lastSeen) || now - lastSeen > BRIDGE_REGISTRY_MAX_AGE_MS) continue;
      if (!best || lastSeen > best.lastSeen) best = { port: entry.port, lastSeen };
    }
    return best?.port ?? BRIDGE_PORT;
  } catch {
    return BRIDGE_PORT;  // 目录不存在(旧版 GD / bridge 未跑过)
  }
}

/** 按实际端口拼 secret 文件路径(GD 侧 secret 文件名含避让后的端口)。 */
function bridgeSecretPathFor(projectDir: string, port: number): string {
  return join(projectDir, '.godot', `mcp_bridge_${port}.secret`);
}

export interface BridgeResponse {
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

let _nextRequestId = 1;
let _permWarned = false;
let _cachedSecret: string | null = null;
let _projectDir: string | null = null;
let _cachedSecretAt: number = 0;
// A-06: 5-minute TTL balances file I/O overhead vs attack window exposure.
// Shorter TTL increases fs reads; longer TTL extends the window if secret is compromised.
// For local-only TCP (127.0.0.1), this is an acceptable tradeoff.
const SECRET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Persistent connection state
let _socket: Socket | null = null;
let _socketAuthenticated = false;
let _socketBuffer = '';
let _connectionLock: Promise<Socket> | null = null;

// P3-6: push 模式。常驻 data handler 收到 bridge/event 消息时调此回调。
// 由 GodotServer 注册(转发为 MCP notification)。null 时 push 消息被忽略。
let _pushMessageHandler: ((params: Record<string, unknown>) => void) | null = null;
// 常驻 push handler 的缓冲区(独立于 sendToBridge 的临时 buffer,避免互相消费)
let _pushBuffer = '';

// Request serialization: ensures only one sendToBridge uses the socket at a time.
// Without this, concurrent calls register overlapping 'data' handlers on the shared
// socket, causing each handler to see partial/mixed response data.
let _sendLock: Promise<unknown> = Promise.resolve();

// G-1 (2026-08-14 审查 :935 P1): 订阅登记表 — bridge 断线重连后自动重发 watch/monitor 订阅。
// 根因: GD 侧 mcp_bridge.gd 60s idle 断线(_cleanup_peer_state 清 per-peer 订阅状态)或 TS 侧
// 请求超时销毁 socket → 重连后无机制重发 watch.start/monitor.start → push 事件从此静默消失、
// watch_poll 返 not watching 无报错。登记成功订阅,_doConnect 成功后重发,恢复推送语义。
interface BridgeSubscription {
  method: 'watch.start' | 'monitor.start';
  params: Record<string, unknown>;
}
let _subscriptions: BridgeSubscription[] = [];
let _resendInFlight: Promise<void> | null = null;

/** 登记订阅(同 method 仅保留最新一条 — GD 侧 per-peer 单例,重复 start 覆盖;登记表同步覆盖防重发重复订阅) */
function _registerSubscription(method: 'watch.start' | 'monitor.start', params: Record<string, unknown>): void {
  _subscriptions = _subscriptions.filter(s => s.method !== method);
  _subscriptions.push({ method, params: { ...params } });
}

/** 移除订阅登记(watch_stop/monitor_stop 成功或重发被游戏侧拒绝时) */
function _removeSubscription(method: 'watch.start' | 'monitor.start'): void {
  _subscriptions = _subscriptions.filter(s => s.method !== method);
}

/** 重发登记表中的订阅。fire-and-forget: 经 _sendLock 排队(不与当前 in-flight 请求死锁),
 *  单条失败仅 warn;游戏侧返回 error(节点已销毁等永久失败)时移除登记,防重连重试风暴。 */
function _resendSubscriptions(): void {
  if (_subscriptions.length === 0) return;
  if (_resendInFlight) return;  // 重发自身触发的重连不再叠加
  const pending = [..._subscriptions];
  _resendInFlight = (async () => {
    for (const sub of pending) {
      try {
        const resp = await sendToBridge(sub.method, sub.params, DEFAULT_TIMEOUT);
        if (resp.error) {
          getLogger().warn('bridge', `Resend ${sub.method} after reconnect rejected (${resp.error.code}): ${resp.error.message} — dropping subscription`);
          _removeSubscription(sub.method);
        }
      } catch (err) {
        getLogger().warn('bridge', `Resend ${sub.method} after reconnect failed: ${getErrorMessage(err)} — keeping subscription for next reconnect`);
      }
    }
  })().finally(() => { _resendInFlight = null; });
}

// G-1: 30s ping keepalive — 连接空闲时定期发轻量请求,刷新游戏侧 idle 计时
// (mcp_bridge.gd INACTIVITY_TIMEOUT=60s 无字节即断连),防长 idle 后订阅静默丢失。
const KEEPALIVE_INTERVAL_MS = 30_000;
let _keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function _startKeepalive(): void {
  if (_keepaliveTimer) return;
  _keepaliveTimer = setInterval(() => {
    if (!_socket || !_socketAuthenticated || _socket.destroyed || !_socket.writable) return;
    // 失败由 error/close 路径自愈(_invalidateSocket → 下次业务调用重连 + 重发订阅)
    sendToBridge('ping', {}, 5000).catch(() => { /* best-effort: 断线自愈 */ });
  }, KEEPALIVE_INTERVAL_MS);
  _keepaliveTimer.unref?.();  // 不阻塞进程退出
}

function _stopKeepalive(): void {
  if (_keepaliveTimer) {
    clearInterval(_keepaliveTimer);
    _keepaliveTimer = null;
  }
}

/** Find the bridge secret file in project .godot dir. Throws if project dir not set.
 *  A1: 不缓存路径 —— 多实例起停会使 registry 解析出的端口变化,每次按 resolveBridgePort 现算
 *  (secret 内容缓存见 readBridgeSecret,不受影响)。 */
function findBridgeSecretPath(): string {
  if (!_projectDir) {
    throw new Error('Bridge secret path requested before game_bridge_install set project directory');
  }
  return bridgeSecretPathFor(_projectDir, resolveBridgePort(_projectDir));
}

function readBridgeSecret(): string | null {
  if (_cachedSecret !== null && Date.now() - _cachedSecretAt < SECRET_CACHE_TTL) return _cachedSecret;
  _cachedSecret = null;
  const secretPath = findBridgeSecretPath();
  try {
    // A4 (2026-07-23 审查): symlink 检查必须在权限收紧之前——否则 secretPath 若是 symlink
    // 指向受害者文件,icacls/chmod 已篡改其 ACL/mode 才被拒(DoS)。对齐 editor-auth.ts:75-81。
    const lstat = lstatSync(secretPath);
    if (lstat.isSymbolicLink()) {
      getLogger().error('security', `Bridge secret file ${secretPath} is a symlink — refusing to read.`);
      return null;
    }
    // Tighten permissions: owner-only
    if (process.platform === 'win32') {
      try {
        // C-ARC-01: Use os.userInfo().username (no env spoofing), strict regex (no backslash)
        // K-4 (2026-08-15): :R → :M。三副本同步漏改——GD 侧 mcp_bridge.gd/websocket_server.gd
        // 的 _restrict_secret_permissions 已从 :R 改 :M(R 是 anti-pattern: e2e 结束后清理删不掉
        // R-only secret → beforeAll 清 .godot 报 EPERM → 后续 e2e L2 整 suite 静默 skip,本地复现),
        // 本读路径每次 readBridgeSecret 都把 ACL 收紧回 R,把 GD 侧的 M 白改了。:M 与
        // editor-auth.ts:32 / instance-api-auth 对齐(M=Read+Write+Delete,owner 可删,其他用户无 ACE)。
        const username = userInfo().username;
        if (username && /^[A-Za-z0-9_-]+$/.test(username)) {
          execFileSync('icacls', [secretPath, '/inheritance:r', '/grant:r', `${username}:M`], { stdio: 'ignore' });
        }
      } catch (err) { getLogger().debug('bridge', `restrict Windows file permissions: ${err}`); }
    } else {
      try {
        chmodSync(secretPath, 0o600);
      } catch (err) { getLogger().debug('bridge', `chmod secret file: ${err}`); }
    }
    const stat = statSync(secretPath);
    if (!_permWarned && process.platform !== 'win32' && (stat.mode & 0o007) !== 0) {
      _permWarned = true;
      getLogger().error('security', `Bridge secret file ${secretPath} is world-readable. Attempted chmod 0600.`);
    }
    _cachedSecret = readFileSync(secretPath, 'utf-8').trim();
    _cachedSecretAt = Date.now();
    return _cachedSecret;
  } catch (err) {
    // ENOENT is normal (bridge not installed yet); other errors are serious
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      getLogger().debug('bridge', `bridge secret not found (expected before install): ${secretPath}`);
    } else {
      getLogger().error('bridge', `read bridge secret failed (${getErrorMessage(err)}): ${secretPath}`);
    }
    return null;
  }
}

function _invalidateSocket(): void {
  if (_socket) {
    try { _socket.destroy(); } catch (err) { getLogger().debug('bridge', `destroy socket: ${err}`); }
    _socket = null;
  }
  _socketAuthenticated = false;
  _socketBuffer = '';
  _pushBuffer = '';  // P3-6: 清理 push buffer
}

/**
 * P3-6: 注册 push 消息回调。Bridge addon 在 watch/monitor push 模式下,
 * 事件产生时主动推送 {method:"bridge/event", params:{type, data}} 消息。
 * 此回调由 GodotServer 注册,将 push 事件转发为 MCP notification。
 * 传 null 注销回调。
 */
export function registerBridgePushHandler(handler: ((params: Record<string, unknown>) => void) | null): void {
  _pushMessageHandler = handler;
}

/** Perform the actual TCP connection and auth handshake. */
async function _doConnect(timeout: number): Promise<Socket> {
  _invalidateSocket();

  // CMP-5 (2026-08-08): autoload 健康预检——读磁盘 project.godot 的 [autoload] 段,
  // 确认 MCPBridge 在里面。防"游戏进程未加载 bridge autoload"的静默失败
  // (secret 文件存在但 autoload 被 git revert/checkout 删了)。
  if (_projectDir) {
    const autoloads = parseAutoloadNames(_projectDir);
    // G-4 (批D实测发现): 旧版 install 写入带 'autoload/' 前缀的键 → parseAutoloadNames 返回
    // 原始键名(带前缀),裸 includes('MCPBridge') 恒不匹配 → BRIDGE_NOT_CONNECTED 误报
    // (疑致 e2e L2 suite 静默 skip)。去前缀比较,新旧两种写入形态都正确判定。
    if (autoloads.length > 0 && !autoloads.some(name => name.replace(/^autoload\//, '') === AUTOLOAD_KEY)) {
      throw new BridgeNotConnectedError(
        `Bridge autoload 'MCPBridge' missing from ${_projectDir}/project.godot [autoload] section. ` +
        'The game may have started without the Bridge autoload. Run game_bridge_install or re-run the game.',
      );
    }
  }

  const secret = readBridgeSecret();
  if (!secret) {
    if (!_projectDir) {
      throw new BridgeNotConnectedError(
        'Bridge project directory not set. Use run_project to start the game, or pass project_path parameter. ' +
        'Manual F5 launch requires project_path to locate the Bridge secret.'
      );
    }
    throw new BridgeNotConnectedError(
      `Bridge secret not found at ${findBridgeSecretPath()}. ` +
      'Ensure the game is running with the MCP Bridge autoload installed.'
    );
  }

  return new Promise((resolve, reject) => {
    // A1: 实际端口来自 registry 解析(多实例避让后可能非 9081)
    const port = resolveBridgePort(_projectDir ?? '');
    const sock = createConnection({ port, host: BRIDGE_HOST }, () => {
      sock.write(JSON.stringify({ id: 0, method: 'auth', params: { secret } }) + '\n');
    });

    let authDone = false;
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new BridgeNotConnectedError(`Bridge auth timed out after ${timeout}ms`));
    }, timeout);

    sock.on('data', (data: Buffer) => {
      _socketBuffer += data.toString();
      let idx: number;
      while ((idx = _socketBuffer.indexOf('\n')) !== -1) {
        const line = _socketBuffer.substring(0, idx).trim();
        _socketBuffer = _socketBuffer.substring(idx + 1);
        if (!line) continue;
        try {
          const resp = JSON.parse(line);
          if (!authDone && resp.result?.authenticated) {
            authDone = true;
            clearTimeout(timer);
            _socket = sock;
            _socketAuthenticated = true;
            // Detach per-auth handlers — response handling moves to sendToBridge
            sock.removeAllListeners('data');
            sock.removeAllListeners('error');
            sock.removeAllListeners('close');
            // P3-6: 注册常驻 push data handler(与 sendToBridge 临时 handler 共存)。
            // 只处理 method 字段存在的 push 消息(bridge/event);有 id 的响应由 sendToBridge
            // 的临时 handler 处理(两者各自维护独立 buffer,EventEmitter 广播不互相消费)。
            _pushBuffer = '';
            sock.on('data', (data: Buffer) => {
              if (_socket !== sock) return;  // P1-8 守卫
              _pushBuffer += data.toString();
              let idx: number;
              while ((idx = _pushBuffer.indexOf('\n')) !== -1) {
                const line = _pushBuffer.substring(0, idx).trim();
                _pushBuffer = _pushBuffer.substring(idx + 1);
                if (!line) continue;
                try {
                  const msg = JSON.parse(line) as { method?: string; params?: Record<string, unknown>; id?: number };
                  // 只处理 push 消息(有 method 无 id);响应消息(id 存在)交给 sendToBridge
                  if (msg.method && msg.id === undefined && _pushMessageHandler) {
                    _pushMessageHandler(msg.params ?? {});
                  }
                } catch {
                  // 非 JSON 或部分数据,忽略(sendToBridge 的临时 handler 会处理响应行)
                }
              }
            });
            // Register persistent monitors so a dead/lost connection is detected automatically
            // P1-8: 守卫 _socket === sock — 防止已废弃 socket 的延迟 close/error 事件错误 invalidate
            // 新 socket(A 被 B 替换后,A.destroy() 的 close 异步触发,此时 _socket 已是 B,无守卫会 destroy B)。
            sock.on('close', () => { if (_socket === sock) _invalidateSocket(); });
            sock.on('error', () => { if (_socket === sock) _invalidateSocket(); });
            // G-1: 连接成功 → 启动 keepalive(防 60s idle 断连) + 重发登记的订阅(恢复 push/轮询语义)。
            // 重发经 _sendLock 排队(当前请求 settle 后执行),不与 in-flight 请求死锁。
            _startKeepalive();
            _resendSubscriptions();
            // 首次 Bridge 连接成功时自动在新终端启动 Dashboard TUI
            launchDashboardOnce();
            resolve(sock);
            return;
          }
          // Auth failure response
          clearTimeout(timer);
          sock.destroy();
          if (resp.error?.code === -32001 || resp.error?.code === -32002) {
            _cachedSecret = null;
          }
          reject(new BridgeNotConnectedError(`Bridge auth failed (${resp.error?.code}): ${resp.error?.message}`));
          return;
        } catch {
          clearTimeout(timer);
          sock.destroy();
          reject(new Error(`Invalid JSON from bridge: ${line}`));
          return;
        }
      }
    });

    sock.on('error', (err) => {
      clearTimeout(timer);
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ECONNREFUSED') {
        reject(new BridgeNotConnectedError(
          'Cannot connect to MCP Bridge. Is the game running with the bridge autoload installed?'
        ));
      } else {
        reject(new Error(`Bridge connection error: ${err.message}`));
      }
    });

    sock.on('close', () => {
      clearTimeout(timer);
      if (!authDone) reject(new BridgeNotConnectedError('Bridge connection closed during auth'));
    });
  });
}

/** Ensure we have an authenticated persistent connection, serializing concurrent attempts. */
function _ensureConnection(timeout: number): Promise<Socket> {
  if (_socket && _socketAuthenticated && !_socket.destroyed && _socket.writable) {
    return Promise.resolve(_socket);
  }
  if (_connectionLock) return _connectionLock;
  _connectionLock = _doConnect(timeout)
    .then(sock => {
      if (_socket !== sock || !_socketAuthenticated) {
        throw new Error('Connection invalidated during setup');
      }
      return sock;
    })
    // P1-8: 删除 catch 内冗余 _connectionLock=null(finally 必执行已覆盖;catch 仅 re-throw 等价无操作,整个 catch 块移除)。
    .finally(() => { _connectionLock = null; });
  return _connectionLock;
}

/** Set the project directory for bridge secret lookup. Invalidates all cached bridge state.
 *
 * 2026-08-06 审查测试-P2（可靠性 §setBridgeProjectDir race）：
 * 若 _sendLock 链上有 in-flight sendToBridge 请求（未 settle），直接 _invalidateSocket 会销毁
 * in-flight 请求持有的 socket → 响应丢失 → 该请求在 timer 后 reject。跨项目切换的并发场景
 * （client A 调 P1，client B 调 setBridgeProjectDir(P2)）下，A 失败但 B 可继续，无原子性保证。
 *
 * 本修复：检测到 in-flight 时记录 warn（可视化），仍 invalidate（保持现有契约——bridge 是
 * per-server 单项目，跨项目切换是异常用法，由调用方保证不并发）。彻底修复需引入 per-project
 * 锁 + per-project socket 状态，属架构级改造，超本轮 scope（留 follow-up）。
 */
export function setBridgeProjectDir(projectDir: string | null): void {
  if (_projectDir === projectDir) return;
  // 检测 in-flight：_sendLock 未 settle 意味着有 sendToBridge 正在用 _socket
  // （_sendLock 在 sendToBridge:385-388 获取，.finally(resolveLock) 释放）
  // Promise.resolve() === _sendLock 时表示无 in-flight（初始 settled state）
  const inflightDetected = !(_sendLock as unknown as Promise<void> === Promise.resolve());
  if (inflightDetected) {
    getLogger().warn('bridge',
      `setBridgeProjectDir('${projectDir}') called while sendToBridge in-flight — ` +
      `in-flight request will be invalidated (socket destroyed). ` +
      `Ensure no concurrent cross-project bridge calls (bridge is per-server single-project).`);
  }
  _projectDir = projectDir;
  _cachedSecret = null;
  _connectionLock = null;
  // G-1: 切项目 = 旧连接语义终结 — 清订阅登记(旧项目订阅对新项目无意义) + 停 keepalive
  _subscriptions = [];
  _stopKeepalive();
  _invalidateSocket();
}

export function sendToBridge(method: string, params: Record<string, unknown> = {}, timeout = DEFAULT_TIMEOUT): Promise<BridgeResponse> {
  // Serialize requests so only one uses the shared socket at a time.
  // Each call chains onto _sendLock, preventing concurrent data handlers.
  const run = () => {
    // Fast-fail if socket is known dead — skip reconnection queue
    if (_socket && _socket.destroyed) {
      _invalidateSocket();
    }
    return _ensureConnection(timeout).then(sock => {
      return new Promise<BridgeResponse>((resolve, reject) => {
      const id = _nextRequestId++;
      let settled = false;
      let buffer = '';

      function doResolve(resp: BridgeResponse) { if (!settled) { settled = true; clearTimeout(timer); resolve(resp); } }
      function doReject(err: Error) { if (!settled) { settled = true; clearTimeout(timer); reject(err); } }

      const timer = setTimeout(() => {
        if (_socket === sock) _invalidateSocket();  // P1-8: 只在 sock 仍是当前 socket 时 invalidate
        doReject(new BridgeTimeoutError(`Bridge request timed out after ${timeout}ms`));
      }, timeout);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, idx).trim();
          buffer = buffer.substring(idx + 1);
          if (!line) continue;
          try {
            const resp = JSON.parse(line) as BridgeResponse;
            // P3-6 修复: push 消息(method 存在、id 为空)不是响应,跳过(由常驻 push handler 处理)。
            // 原逻辑 resp.id != null 在 push(无 id)时为 false → 不 continue → 误把 push 当响应 resolve。
            // 修正:响应必须有 id 且匹配当前 request id;无 id 的消息(push/通知)一律跳过。
            if (resp.id == null || resp.id !== id) continue;
            sock.removeListener('data', onData);
            // N-1 (2026-06-24 审查): 成功 resolve 后移除本次 once 监听器。持久 _socket 上 error/close
            // 健康时永不触发,once 不移除 → 每请求泄漏 2 listener → 长连接累积至 MaxListenersExceededWarning。
            // reject 路径(onError/onClose/timeout)由 once 自动移除 + _invalidateSocket 废弃 sock,不累积。
            sock.removeListener('error', onError);
            sock.removeListener('close', onClose);
            // If bridge returns auth error, invalidate cached secret
            if (resp.error?.code === -32001 || resp.error?.code === -32002) {
              _cachedSecret = null;
              _invalidateSocket();
            }
            doResolve(resp);
            return;
          } catch {
            // Log unparseable lines instead of silently discarding (I-10)
            getLogger().warn('bridge', `sendToBridge: unparseable JSON line (request ${id}): ${line.substring(0, 120)}`);
            continue;
          }
        }
      };

      const onError = (err: Error) => {
        if (_socket === sock) _invalidateSocket();  // P1-8: 只在 sock 仍是当前 socket 时 invalidate
        doReject(new Error(`Bridge connection error: ${err.message}`));
      };

      const onClose = () => {
        if (_socket === sock) _invalidateSocket();  // P1-8: 只在 sock 仍是当前 socket 时 invalidate
        doReject(new Error('Bridge connection closed before response'));
      };

      sock.on('data', onData);
      sock.once('error', onError);
      sock.once('close', onClose);

      sock.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }).catch(err => {
    // 子类(BridgeNotConnectedError / BridgeTimeoutError)从 _doConnect / sendToBridge 穿透,原样抛
    return Promise.reject(err);
  });
  };

  // Chain onto the send lock — next request waits for this one to settle
  const prev = _sendLock;
  let resolveLock: () => void = () => {};
  _sendLock = new Promise<void>(r => { resolveLock = r; });
  return prev.then(() => run()).finally(resolveLock);
}

// ─── Tool definitions ──────────────────────────────────────────────────────

const ACTIONS = [
  'game_bridge_install',
  'game_bridge_uninstall',
  'install_override',
  'uninstall_override',
  'game_query',
  'game_write',
  'game_input',
  'game_wait',
  'game_playtest',
  'monitor_start',
  'monitor_stop',
  'monitor_poll',
  'watch_start',
  'watch_stop',
  'watch_poll',
  'find_ui_elements',
  'click_button',
] as const;

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'game',
      description: '游戏桥接操作。安装/卸载: game_bridge_install, game_bridge_uninstall。P2-1 overrides 注入: install_override/uninstall_override (启动游戏前注入任意调试脚本到项目 autoload,如日志钩子/状态快照)。查询: game_query (ping, get_tree, find_nodes, get_node_properties, get_performance, get_viewport_info, take_screenshot)。写入: game_write (set_node_property, call_method)。输入: game_input (send_key, send_mouse_click, send_mouse_move, send_text, send_touch, send_drag, send_input_sequence 帧定时输入时间线)。等待: game_wait (wait_for_node, wait_for_property)。P2-4 确定性 playtest: game_playtest (playtest.seed 锁随机, playtest.fixed_delta 锁步长, playtest.step 单步推进, playtest.snapshot/restore 状态快照)。G1 control 层: playtest.freeze (冻结游戏循环,bridge 仍响应), playtest.unfreeze (解冻), playtest.step_until (条件满足/帧尽/wall 超时即停,结构化条件 {path,property,op,value}[] AND)。监控: monitor_start/stop/poll (属性时间线采样)。信号: watch_start/stop/poll (信号事件记录)。UI: find_ui_elements/click_button (UI元素发现+按钮点击)。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          project_path: { type: 'string', description: 'Godot 项目目录路径（可选，默认使用 GODOT_PROJECT_PATH 环境变量或当前目录）' },
          action: {
            type: 'string',
            enum: [...ACTIONS],
            description: '操作类型',
          },
          port: { type: 'number', description: 'game_bridge_install: 期望的起始监听端口(实际端口由游戏侧 env GODOT_MCP_BRIDGE_PORT 设起点,被占自动递增避让;此参数不影响行为,保留兼容)。实际端口见 ping 响应与实例 registry', default: 9081 },
          source_script_path: { type: 'string', description: 'install_override/uninstall_override: 源调试脚本绝对路径（必须在 ALLOWED_PROJECT_PATHS 白名单内,拷贝到项目根注册为 MCPOVERRIDE_<basename> autoload）' },
          method: {
            type: 'string',
            description: 'game_query/game_write/game_input/game_wait/game_playtest 的具体方法。game_query: ping, get_tree, find_nodes, get_node_properties, get_node_layout, get_performance, get_viewport_info, take_screenshot, get_errors (查询游戏运行时错误,支持 since_seq 增量 + clear 读即焚), clear_errors (清空错误 buffer)。game_write: set_node_property, call_method。game_input: send_key, send_mouse_click, send_mouse_move, send_text, send_touch, send_drag, send_input_sequence (帧定时时间线,延迟响应)。game_wait: wait_for_node, wait_for_property。game_playtest: playtest.seed (锁全局 RNG,仅覆盖 randi/randf), playtest.fixed_delta (锁 physics 步长,delta=1/hz), playtest.step (单步推进 N 帧,走 coroutine 延迟响应), playtest.snapshot (快照场景树属性,不保信号/物理/已free节点), playtest.restore (从快照恢复属性)。G1 control 层: playtest.freeze (冻结 tree.paused), playtest.unfreeze (解冻), playtest.step_until (推进至 conditions 满足/帧尽/wall 超时,结构化条件 {path,property,op,value}[] AND,不引入 Expression)',
          },
          params: {
            type: 'object',
            description: '方法参数。game_query: 因方法而异。get_errors {since_seq?:int(默认0,只返回 seq>since_seq 的), clear?:bool(默认false,查询后清空 buffer)}。game_write: set_node_property {path, property, value}, call_method {path, method, args}。call_method 默认只读白名单(get/has_*/get_meta 等),env GODOT_MCP_BRIDGE_EXTRA_METHODS=method1,method2 可扩展(含写方法如 take_damage);EXTRA_METHODS_BLOCKLIST(free/queue_free/set_script/call/emit_signal 等)是不可覆盖硬底线。args 按方法声明类型自动强转(传 [1,2,3] 给 Vector3 参数会正确转换)。方法不存在时返回 did-you-mean 建议。response 含 undoable=false(call 不可 undo)。game_input: send_key {key, pressed}, send_mouse_click {x, y, button, pressed}, send_mouse_move {x, y}, send_text {text}, send_touch {x, y, pressed, index}, send_drag {x, y, index, relative, speed}, send_input_sequence {timeline:[{at_frame:1-600(开窗后第N帧),type:action|key|mouse_click|mouse_move|touch|drag,...事件参数}], settle_frames?:int, wall_budget_ms?:int}(action 字段 name/pressed/strength?,其余 type 字段同各 send_*;frozen 下自动开窗播放+完成 refreeze)。game_wait: wait_for_node {path}, wait_for_property {path, property, value}。game_playtest: playtest.seed {seed:int}, playtest.fixed_delta {hz:int}, playtest.step {frames:int(1-60)}, playtest.snapshot/restore 无参数。G1 control: playtest.freeze/unfreeze 无参数, playtest.step_until {conditions:[{path:String,property:String,op:String(==/!=/</>/<=/>=),value:标量/几何}], max_frames?:int(1-600,默认600), wall_budget_ms?:int(1000-50000,默认30000)}',
          },
          timeout: { type: 'number', description: 'game_query/game_write/game_input/game_wait: 超时时间（毫秒，默认 10000）。game_wait 的 timeout 用作整个轮询窗口的总预算（在窗口内反复探测直到条件成立）。send_input_sequence 为延迟响应,未显式传 timeout 时自动放宽为 wall_budget_ms+10000（上限 60000）' },
          interval_ms: { type: 'number', description: 'game_wait 专用：轮询探测间隔（毫秒，默认 200，范围 50-2000）。仅 wait_for_node/wait_for_property 生效', default: 200 },
          node_path: { type: 'string', description: 'monitor_start: 要监控的节点路径（如 /root/Player）' },
          properties: { type: 'array', items: { type: 'string' }, description: 'monitor_start: 要监控的属性名列表（如 ["position", "health"]）' },
          interval_frames: { type: 'number', description: 'monitor_start: 采样间隔帧数（默认 10，最小 1，最大 300）' },
          signal_name: { type: 'string', description: 'watch_start: 要监听的信号名（如 "pressed"、"health_changed"）' },
          max_events: { type: 'number', description: 'watch_start: 最大记录事件数（默认 1000，最大 5000）' },
          push: { type: 'boolean', description: 'P3-6 watch_start/monitor_start: 启用 push 模式（事件/采样产生时主动推送 MCP notification，无需 poll）。client 需订阅 resources/subscribe 才能收到' },
          pattern: { type: 'string', description: 'find_ui_elements: 名称/文字匹配模式（Godot match 语法）' },
          type: { type: 'string', description: 'find_ui_elements: 按类型过滤（如 "Button"、"Label"）' },
          visible_only: { type: 'boolean', description: 'find_ui_elements: 仅返回可见元素（默认 true）' },
          limit: { type: 'number', description: 'find_ui_elements: 最大返回数（默认 200，上限 500）' },
          text: { type: 'string', description: 'click_button: 按钮文字（和 path 二选一）' },
          path: { type: 'string', description: 'click_button: 按钮节点路径（和 text 二选一）' },
          godot_path: { type: 'string', description: '覆盖 Godot 二进制路径（可选，优先于项目配置和环境变量）' },
        },
        required: ['action'],
      },
    },
  ];
}

// ─── Tool handler ───────────────────────────────────────────────────────────

export const QUERY_METHODS = new Set([
  'ping', 'get_tree', 'find_nodes', 'get_node_properties', 'get_node_layout',
  'get_performance', 'get_viewport_info', 'take_screenshot',
  // CMP-2 (2026-08-08): runtime error 捕获——查询/清除游戏运行时错误
  'get_errors', 'clear_errors',
]);

/** Read-only query methods excluding take_screenshot (handled separately via bridge.screenshot). */
export const BRIDGE_READ_ONLY_METHODS = new Set([
  'ping', 'get_tree', 'find_nodes', 'get_node_properties', 'get_node_layout',
  'get_performance', 'get_viewport_info',
  // CMP-2: get_errors/clear_errors 只操作 bridge 内部 buffer 不影响游戏,归只读集合
  'get_errors', 'clear_errors',
]);

const WRITE_METHODS = new Set([
  'set_node_property', 'call_method',
]);

export const INPUT_METHODS = new Set([
  'send_key', 'send_mouse_click', 'send_mouse_move', 'send_text',
  'send_touch', 'send_drag',
  // H1 (2026-08-20) 帧定时输入时间线:开窗+逐帧 at_frame 注入,延迟响应(同 step_until)
  'send_input_sequence',
]);

const WAIT_METHODS = new Set([
  'wait_for_node', 'wait_for_property',
]);

// P2-4 确定性 playtest 四原语(snapshot/restore 同步;step 走 coroutine 延迟响应)
export const PLAYTEST_METHODS = new Set([
  'playtest.seed', 'playtest.fixed_delta', 'playtest.snapshot', 'playtest.restore', 'playtest.step',
]);

// G1 (2026-08-13) control-first satellite 层(附录 F.1):freeze/unfreeze/step_until
// 与 determinism-first(PLAYTEST_METHODS)正交叠加。step_until 走同款 coroutine 延迟响应(条件多帧满足)。
export const CONTROL_METHODS = new Set([
  'playtest.freeze', 'playtest.unfreeze', 'playtest.step_until',
]);

/**
 * G-3 (:942② + 批D移交): 计算 game_playtest 各 method 的 TS 侧请求 timeout(纯函数,无 IO)。
 *
 * step_until 的竞态根因: 原 `min(max(raw,30000),60000)` 与 GD 侧 idle 60s(mcp_bridge.gd
 * INACTIVITY_TIMEOUT)同界 — wall_budget_ms=60000 时 TS 先到期销毁常驻 socket(响应丢失 +
 * 订阅断线)。批 D 已把 GD 侧 wall_budget clamp 到 50s,TS 侧对齐:
 * `wall_budget + 5s 余量`(默认 30000 → 35000;wall=60000 超界入参 → 65000 不再先到期),
 * 并与用户显式 timeout 取 max(用户显式更长时尊重显式意图,不被 wall 公式压短)。
 *
 * 其余 method 保持原行为: step 走 max(raw,30000) cap 60000;非长跑 method 原样。
 */
export function computePlaytestTimeoutMs(method: string, wallBudgetMs: unknown, rawTimeoutMs: number): number {
  const base = (method === 'playtest.step' || method === 'playtest.step_until')
    ? Math.min(Math.max(rawTimeoutMs, 30000), 60000)
    : Math.min(rawTimeoutMs, 60000);
  if (method !== 'playtest.step_until') return base;
  const n = Number(wallBudgetMs);
  const wall = (wallBudgetMs === undefined || wallBudgetMs === null || !Number.isFinite(n))
    ? 30000
    : Math.max(0, Math.round(n));
  // wall + 5s 余量,clamp 到 [1000,65000](65000 上界容纳 GD 侧超界入参 60000+5000)
  const byBudget = clampTimeoutMs(wall + 5000, 1000, 65000, 35000);
  return Math.max(byBudget, base);
}

/**
 * CRITICAL-3 fix: poll a Bridge wait condition until it holds or the budget
 * runs out. Bridge (`mcp_bridge.gd` `_cmd_wait_for_node`/`_cmd_wait_for_property`)
 * is a single synchronous snapshot, so "waiting" must be implemented by the
 * caller polling within a time window.
 *
 * `probe` is parameterized so tests can inject a mock without touching the
 * real socket. Each probe call should return the BridgeResponse from a single
 * `wait_for_node`/`wait_for_property` snapshot.
 *
 * Condition resolution:
 *   - `wait_for_node`   → holds when result.exists === true
 *   - `wait_for_property` → holds when result.match === true
 *   - any result.error  → abort immediately, surface the error
 *
 * The returned object spreads the last Bridge result and augments it with
 * `wait_completed` / `elapsed_ms` / `timed_out`, so existing fields stay
 * backward compatible.
 */
export async function pollWaitCondition(
  method: 'wait_for_node' | 'wait_for_property',
  probe: () => Promise<BridgeResponse>,
  totalMs: number,
  intervalMs: number,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const isNode = method === 'wait_for_node';

  let last: BridgeResponse;
  for (;;) {
    last = await probe();

    // Hard errors abort immediately — never swallow a real failure as "not yet".
    if (last.error) {
      return {
        ...(last.result as Record<string, unknown> | undefined),
        error: last.error,
        wait_completed: false,
        elapsed_ms: Date.now() - startedAt,
      };
    }

    const result = (last.result ?? {}) as Record<string, unknown>;
    const satisfied = isNode ? result.exists === true : result.match === true;
    if (satisfied) {
      return { ...result, wait_completed: true, elapsed_ms: Date.now() - startedAt };
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= totalMs) {
      return { ...result, wait_completed: false, timed_out: true, elapsed_ms: elapsed };
    }

    // Sleep the interval, but never past the remaining budget.
    const remaining = totalMs - elapsed;
    await sleep(Math.min(intervalMs, remaining));
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** 确保项目目录已设置：优先用 ctx.projectDir，回退到 args.project_path */
function ensureProjectDir(ctx: ToolContext, args: Record<string, unknown>): void {
  if (ctx.projectDir) {
    setBridgeProjectDir(ctx.projectDir);
  } else if (!_projectDir) {
    try { if (args.project_path) setBridgeProjectDir(requireProjectPath({ project_path: args.project_path })); } catch (e) { getLogger().debug('bridge', `project_path fallback failed: ${e instanceof Error ? e.message : e}`); }
  }
}

/** T-1 (2026-06-24 审查): game_write/wait/query 的 path 参数须 /root/ 绝对路径(文档 godot-mcp-bridge.md
 *  声称必须,原 TS 端下放 GDScript 端)。无 path 的 method(ping/get_tree/get_performance 等)不校验。
 *  返回错误消息或 null(校验通过)。纯函数,无 IO/socket,测试见 game-bridge-validation.test.ts。 */
export function validateBridgePath(params: Record<string, unknown>): string | null {
  // I-1 (审查反馈): 节点路径字段名混用——game_write/wait/query 用 path,monitor/watch 用 node_path,
  // click_button 用 path。统一检查两者。无节点路径的方法(ping/get_tree/find_ui_elements 的 pattern)不校验。
  for (const key of ['path', 'node_path'] as const) {
    const p = params[key];
    if (typeof p === 'string' && p.length > 0 && p !== '/root' && !p.startsWith('/root/')) {
      return `${key} must be an absolute path starting with "/root/" (got "${p}"). game tools require /root/-prefixed node paths; see godot-mcp-bridge.md.`;
    }
  }
  return null;
}

/** I-2 (审查 follow-up): wait_for_property 需 property + value;wait_for_node 只需 path 不校验。
 *  返回错误消息或 null(校验通过)。纯函数,无 IO/socket,测试见 game-bridge-validation.test.ts。
 *  抽自 handleTool case 'game_wait' 内联逻辑(2026-08-09 待办 #3,恢复 Linux CI 覆盖)。 */
export function validateWaitPropertyParams(method: string, params: Record<string, unknown>): string | null {
  if (method === 'wait_for_property') {
    if (typeof params.property !== 'string' || !params.property) {
      return 'wait_for_property requires a non-empty "property" string in params';
    }
    if (params.value === undefined) {
      return 'wait_for_property requires a "value" in params';
    }
  }
  return null;
}

/** Shared helper: set project dir, send to bridge, format response. */
async function bridgeAction(method: string, params: Record<string, unknown>, ctx: ToolContext, timeout: number): Promise<ToolResult> {
  ensureProjectDir(ctx, params);
  const pathErr = validateBridgePath(params);  // I-1(审查): 覆盖 monitor/watch/click_button 的 node_path/path
  if (pathErr) return opsErrorResult('INVALID_PATH', pathErr);
  const resp = await sendToBridge(method, params, timeout);
  // T-2 (2026-06-24 审查): bridge 返回 error 时(密钥失效 -32001/-32002/方法不存在等)用 errorResult
  // (isError=true),否则 MCP 客户端误判成功吞掉错误。原 textResult 默认 isError=false。
  if (resp.error) {
    return errorResult(`Bridge error (${resp.error.code}): ${resp.error.message}`);
  }
  // G-1: 订阅登记表维护 — start 成功登记(重连后重发),stop 成功移除(不再重发)
  if (method === 'watch.start' || method === 'monitor.start') {
    _registerSubscription(method, params);
  } else if (method === 'watch.stop' || method === 'monitor.stop') {
    _removeSubscription(method === 'watch.stop' ? 'watch.start' : 'monitor.start');
  }
  return textResult(JSON.stringify(resp.result, null, 2));
}

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | null> {
  if (name !== 'game') return null;

  const action = args.action as string;
  if (!action) return opsErrorResult('INVALID_PARAMS', 'action is required');

  try {
    switch (action) {
      case 'game_bridge_install': {
        const projectPath = requireProjectPath(args);
        const scriptsDir = dirname(ctx.opsScript);
        const bridgeSrc = join(scriptsDir, BRIDGE_SCRIPT_NAME);

        if (!existsSync(bridgeSrc)) {
          return textResult(`Error: Bridge script not found at ${bridgeSrc}`);
        }

        const configPath = join(projectPath, 'project.godot');
        if (!existsSync(configPath)) {
          return textResult(`Error: project.godot not found at ${configPath}`);
        }

        let config = readFileSync(configPath, 'utf-8');
        // G-5: 幂等/迁移检查用行首精确匹配(键名短,裸 includes 会误命中注释等文本)。
        // 新键存在 → 已注册跳过;仅旧带前缀键存在 → 迁移(删旧行写新行,旧项目自愈)。
        const hasNewKey = new RegExp(`^${AUTOLOAD_KEY}\\s*=`,'m').test(config);
        const hasLegacyKey = new RegExp(`^${AUTOLOAD_KEY_LEGACY}\\s*=`,'m').test(config);

        // A2 (2026-08-18 反馈): mcp_bridge.gd 托管语义 —— 目标已存在且内容与工具自带版本不同
        // (项目自管/git tracked + 本地修改)时**不覆盖**,保留现有文件并明确告知;内容一致
        // (工具拷贝的原样)才覆盖刷新(升级场景)。拷贝放在幂等检查前只做一次,已注册同样遵守。
        const destScript = join(projectPath, BRIDGE_SCRIPT_NAME);
        let scriptNote = '';
        if (existsSync(destScript)) {
          if (readFileSync(bridgeSrc, 'utf-8') !== readFileSync(destScript, 'utf-8')) {
            scriptNote = `existing ${BRIDGE_SCRIPT_NAME} differs from bundled version — kept as-is (not overwritten); delete it manually to force refresh.`;
          } else {
            copyFileSync(bridgeSrc, destScript);
          }
        } else {
          copyFileSync(bridgeSrc, destScript);
        }

        if (hasNewKey) {
          return textResult(`MCP Bridge autoload already registered. ${scriptNote || `Script copied to ${destScript}.`}`);
        }
        if (hasLegacyKey) {
          config = config.split('\n').filter(line => !line.startsWith(AUTOLOAD_KEY_LEGACY + '=')).join('\n');
        }

        const autoloadEntry = `${AUTOLOAD_KEY}="*res://${BRIDGE_SCRIPT_NAME}"`;
        const autoloadRegex = /^\[autoload\]/m;
        if (autoloadRegex.test(config)) {
          config = config.replace(autoloadRegex, `[autoload]\n${autoloadEntry}`);
        } else {
          config += `\n[autoload]\n${autoloadEntry}\n`;
        }

        // Atomic write: write to temp file then rename
        const tmpPath = configPath + '.mcp-tmp';
        writeFileSync(tmpPath, config, 'utf-8');
        renameSync(tmpPath, configPath);
        return textResult(JSON.stringify({
          success: true,
          // A1: 端口自动避让(起点 9081,被占递增至 9090;实际端口见 instance registry + ping 响应 pid/project 指纹)
          message: `MCP Bridge installed. Listens on ${BRIDGE_PORT}+ (auto-increments when occupied; ping response carries pid/project to verify target instance).${scriptNote ? ' ' + scriptNote : ''}`,
          script_path: `res://${BRIDGE_SCRIPT_NAME}`,
          autoload_key: AUTOLOAD_KEY,
        }));
      }

      case 'game_bridge_uninstall': {
        const projectPath = requireProjectPath(args);
        const configPath = join(projectPath, 'project.godot');

        if (!existsSync(configPath)) {
          return textResult(`Error: project.godot not found at ${configPath}`);
        }

        const config = readFileSync(configPath, 'utf-8');
        // G-5: 新键与旧带前缀键任一存在即可卸载(双键兼容,旧行为只认旧长键)
        const hasNewKey = new RegExp(`^${AUTOLOAD_KEY}\\s*=`,'m').test(config);
        const hasLegacyKey = new RegExp(`^${AUTOLOAD_KEY_LEGACY}\\s*=`,'m').test(config);
        if (!hasNewKey && !hasLegacyKey) {
          return textResult('MCP Bridge autoload not found in project.godot.');
        }

        // 双键清理:新键行 + 旧带前缀键行都移除
        const lines = config.split('\n').filter(line =>
          !line.startsWith(AUTOLOAD_KEY + '=') && !line.startsWith(AUTOLOAD_KEY_LEGACY + '='));
        const tmpPath = configPath + '.mcp-tmp';
        writeFileSync(tmpPath, lines.join('\n'), 'utf-8');
        renameSync(tmpPath, configPath);

        // A2 (2026-08-18 反馈): 仅当脚本内容与工具自带版本一致(工具托管拷贝)才删除;
        // 内容不同(项目自管/git tracked + 用户修改)则保留并提示,防 uninstall 删掉 tracked 文件。
        // N-5(审查): bundled 脚本缺失(工具安装损坏)时无法证明是工具托管 → 保守不删。
        const scriptPath = join(projectPath, BRIDGE_SCRIPT_NAME);
        let uninstallNote = '';
        if (existsSync(scriptPath)) {
          const bundledScript = join(dirname(ctx.opsScript), BRIDGE_SCRIPT_NAME);
          const toolManaged = existsSync(bundledScript)
            && readFileSync(bundledScript, 'utf-8') === readFileSync(scriptPath, 'utf-8');
          if (toolManaged) {
            unlinkSync(scriptPath);
          } else {
            uninstallNote = ` ${BRIDGE_SCRIPT_NAME} differs from bundled version (or bundled copy missing) — kept (delete manually if unwanted).`;
          }
        }

        // A-07 + A1: 清理所有端口的 secret(端口避让后 9081..909x 均可能有残留)
        const godotDir = join(projectPath, '.godot');
        if (existsSync(godotDir)) {
          try {
            for (const name of readdirSync(godotDir)) {
              if (name.startsWith('mcp_bridge_') && name.endsWith('.secret')) {
                try { unlinkSync(join(godotDir, name)); } catch { /* best effort */ }
              }
            }
          } catch { /* best effort */ }
        }
        _cachedSecret = null;
        _invalidateSocket();

        return textResult(JSON.stringify({ success: true, message: `MCP Bridge uninstalled.${uninstallNote}` }));
      }

      // P2-1: Autoload overrides —— 启动游戏前注入任意调试脚本(日志钩子/状态快照等)
      case 'install_override': {
        const projectPath = requireProjectPath(args);
        const sourceScriptPath = args.source_script_path as string | undefined;
        if (!sourceScriptPath) {
          return opsErrorResult('INVALID_PARAMS', 'install_override requires source_script_path (absolute path to .gd script)');
        }
        try {
          const { installOverride } = await import('../core/overrides.js');
          const entry = installOverride(sourceScriptPath, projectPath);
          if (entry === null) {
            return textResult(JSON.stringify({ success: true, message: 'Override already registered, skipped.', already_installed: true }));
          }
          return textResult(JSON.stringify({
            success: true,
            message: `Override installed: ${entry.autoloadKey}`,
            autoload_key: entry.autoloadKey,
            dest_script: `res://${entry.destScriptName}`,
            project_root: entry.projectRoot,
          }));
        } catch (err) {
          return opsErrorResult('OVERRIDE_INSTALL_FAILED', getErrorMessage(err));
        }
      }

      case 'uninstall_override': {
        const projectPath = requireProjectPath(args);
        const sourceScriptPath = args.source_script_path as string | undefined;
        if (!sourceScriptPath) {
          return opsErrorResult('INVALID_PARAMS', 'uninstall_override requires source_script_path (absolute path to .gd script)');
        }
        try {
          const { uninstallOverride, deriveOverrideEntry } = await import('../core/overrides.js');
          const removed = uninstallOverride(sourceScriptPath, projectPath);
          const entry = deriveOverrideEntry(sourceScriptPath, projectPath);
          return textResult(JSON.stringify({ success: true, removed, autoload_key: entry.autoloadKey }));
        } catch (err) {
          return opsErrorResult('OVERRIDE_UNINSTALL_FAILED', getErrorMessage(err));
        }
      }

      case 'game_query':
      case 'game_write':
      case 'game_input': {
        // Always update project dir so switching projects between calls works
        ensureProjectDir(ctx, args);
        const methodSets: Record<string, Set<string>> = {
          game_query: QUERY_METHODS,
          game_write: WRITE_METHODS,
          game_input: INPUT_METHODS,
        };
        const allowed = methodSets[action]!;
        const method = args.method as string;
        if (!allowed.has(method)) {
          return textResult(`Error: Unknown bridge method "${method}". Supported: ${[...allowed].join(', ')}. 业务方法（如 take_damage/emit_signal）请用 game_write method=call_method params={method:"业务方法名", args:[...]}（bridge 运行时白名单校验，可通过 GODOT_MCP_BRIDGE_EXTRA_METHODS env 扩展）`);
        }
        const rawParams = args.params;
        const params = (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
          ? rawParams as Record<string, unknown>
          : {};
        const rawTimeout = clampTimeoutMs(args.timeout);
        let timeout = Math.min(rawTimeout, 60000);
        // H1 (2026-08-20): send_input_sequence 延迟响应(bridge 侧 wall_budget 默认 30s),
        // 默认 10s 会先超时导致响应丢失。未显式传 timeout 时按 wall_budget+10s 放宽(仍受 60s 硬钳)。
        if (method === 'send_input_sequence' && args.timeout === undefined) {
          const wallBudget = typeof params.wall_budget_ms === 'number' && Number.isFinite(params.wall_budget_ms)
            ? params.wall_budget_ms
            : 30000;
          timeout = Math.min(Math.max(timeout, wallBudget + 10000), 60000);
        }
        const pathErr = validateBridgePath(params);
        if (pathErr) return opsErrorResult('INVALID_PATH', pathErr);  // T-1: path /root/ 前置校验
        const response = await sendToBridge(method, params, timeout);
        if (response.error) {
          // Clear cached secret on auth failure so next call re-reads from disk
          // Bridge error codes: -32001 (auth required), -32002 (locked out)
          if (response.error.code === -32001 || response.error.code === -32002) {
            _cachedSecret = null;
          }
          return errorResult(`Bridge error (${response.error.code}): ${response.error.message}`);  // T-2: textResult→errorResult(isError=true)
        }
        return textResult(JSON.stringify(response.result, null, 2));
      }

      case 'game_wait': {
        // CRITICAL-3 fix: Bridge wait_for_* is a single snapshot; poll within
        // the timeout window so "wait" actually waits for the condition.
        ensureProjectDir(ctx, args);
        const method = args.method as string;
        if (!WAIT_METHODS.has(method)) {
          return textResult(`Error: Unknown method "${method}". Supported: ${[...WAIT_METHODS].join(', ')}`);
        }
        const rawParams = args.params;
        const params = (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
          ? rawParams as Record<string, unknown>
          : {};
        const totalMs = clampTimeoutMs(args.timeout);
        const intervalMs = clampTimeoutMs(args.interval_ms, 50, 2000, 200);

        const pathErr = validateBridgePath(params);  // T-1: path /root/ 前置校验
        if (pathErr) return opsErrorResult('INVALID_PATH', pathErr);

        // I-2: wait_for_property 还需 property + value;wait_for_node 不校验(纯函数抽离,见模块顶)。
        const waitParamErr = validateWaitPropertyParams(method, params);
        if (waitParamErr) return opsErrorResult('INVALID_PARAMS', waitParamErr);

        const result = await pollWaitCondition(
          method as 'wait_for_node' | 'wait_for_property',
          () => sendToBridge(method, params, Math.min(intervalMs * 2, totalMs)),
          totalMs,
          intervalMs,
        );

        if (result.error) {
          const code = (result.error as { code?: number }).code;
          if (code === -32001 || code === -32002) {
            _cachedSecret = null;
          }
          return errorResult(`Bridge error (${code}): ${(result.error as { message?: string }).message ?? 'wait failed'}`);  // T-2: textResult→errorResult(isError=true)
        }
        return textResult(JSON.stringify(result, null, 2));
      }

      // P2-4 确定性 playtest 四原语:seed/fixed_delta/snapshot/restore 同步;step 走 coroutine 延迟响应
      case 'game_playtest': {
        ensureProjectDir(ctx, args);
        const method = args.method as string;
        if (!PLAYTEST_METHODS.has(method) && !CONTROL_METHODS.has(method)) {
          return textResult(`Error: Unknown playtest method "${method}". Supported: ${[...PLAYTEST_METHODS, ...CONTROL_METHODS].join(', ')}`);
        }
        const rawParams = args.params;
        const params = (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
          ? rawParams as Record<string, unknown>
          : {};
        // step/step_until 走 coroutine 延迟响应,需要更长 timeout(N 帧推进 / 条件多帧才满足)。
        // G-3: step_until 的 timeout 由 wall_budget + 5s 余量决定(防 TS 先于 GD idle 60s 到期销毁 socket)
        const timeout = computePlaytestTimeoutMs(method, params.wall_budget_ms, clampTimeoutMs(args.timeout));
        const response = await sendToBridge(method, params, timeout);
        if (response.error) {
          if (response.error.code === -32001 || response.error.code === -32002) {
            _cachedSecret = null;
          }
          return errorResult(`Bridge error (${response.error.code}): ${response.error.message}`);
        }
        return textResult(JSON.stringify(response.result, null, 2));
      }

      case 'monitor_start': {
        if (!args.node_path || typeof args.node_path !== 'string') {
          return opsErrorResult('INVALID_PARAMS', 'node_path is required for monitor_start');
        }
        if (!Array.isArray(args.properties) || (args.properties as string[]).length === 0) {
          return opsErrorResult('INVALID_PARAMS', 'properties must be a non-empty array');
        }
        return await bridgeAction('monitor.start', {
          node_path: args.node_path as string,
          properties: args.properties as string[],
          interval_frames: (args.interval_frames as number) ?? 10,
          push: args.push === true,  // P3-6: 传递 push 模式标志到 addon
        }, ctx, clampTimeoutMs(args.timeout));
      }
      case 'monitor_stop':
        return await bridgeAction('monitor.stop', {}, ctx, clampTimeoutMs(args.timeout));
      case 'monitor_poll':
        return await bridgeAction('monitor.poll', {}, ctx, clampTimeoutMs(args.timeout));
      case 'watch_start': {
        if (!args.node_path || typeof args.node_path !== 'string') {
          return opsErrorResult('INVALID_PARAMS', 'node_path is required for watch_start');
        }
        if (!args.signal_name || typeof args.signal_name !== 'string') {
          return opsErrorResult('INVALID_PARAMS', 'signal_name is required for watch_start');
        }
        return await bridgeAction('watch.start', {
          node_path: args.node_path as string,
          signal_name: args.signal_name as string,
          max_events: (args.max_events as number) ?? 1000,
          push: args.push === true,  // P3-6: 传递 push 模式标志到 addon
        }, ctx, clampTimeoutMs(args.timeout));
      }
      case 'watch_stop':
        return await bridgeAction('watch.stop', {}, ctx, clampTimeoutMs(args.timeout));
      case 'watch_poll':
        return await bridgeAction('watch.poll', {}, ctx, clampTimeoutMs(args.timeout));
      case 'find_ui_elements':
        return await bridgeAction('find_ui_elements', {
          pattern: (args.pattern as string) ?? '',
          type: (args.type as string) ?? '',
          visible_only: args.visible_only !== false,
          limit: (args.limit as number) ?? 200,
        }, ctx, clampTimeoutMs(args.timeout));
      case 'click_button': {
        const hasText = args.text && typeof args.text === 'string';
        const hasPath = args.path && typeof args.path === 'string';
        if (!hasText && !hasPath) {
          return opsErrorResult('INVALID_PARAMS', 'click_button requires "text" or "path" parameter');
        }
        return await bridgeAction('click_button', {
          text: (args.text as string) ?? '',
          path: (args.path as string) ?? '',
        }, ctx, clampTimeoutMs(args.timeout));
      }

      default:
        return opsErrorResult('UNKNOWN_ACTION', `Unknown action: ${action}`);
    }
  } catch (err) {
    const msg = getErrorMessage(err);
    if (err instanceof BridgeNotConnectedError) {
      return opsErrorResult(ERROR_CODES.BRIDGE_NOT_CONNECTED, msg, {
        suggestion: '游戏未运行或 Bridge 未正确响应。先 run_project 启动游戏,确认 game_bridge_install 已执行',
      });
    }
    if (err instanceof BridgeTimeoutError) {
      return opsErrorResult(ERROR_CODES.BRIDGE_TIMEOUT, msg, {
        suggestion: '游戏在运行但无响应(可能被 runtime error 卡住)——这不是连接问题。检查游戏是否报错,或加大 timeout 重试',
      });
    }
    return opsErrorResult(ERROR_CODES.BRIDGE_ERROR, msg);
  }
}

export const TOOL_META: Record<
  string,
  { readonly: boolean; long_running: boolean; actionRisks?: Record<string, RiskLevel> }
> = {
  game: {
    readonly: false,
    long_running: false,
    actionRisks: {
      game_query: 'read',
      game_input: 'read',
      game_wait: 'read',
      monitor_start: 'read',
      monitor_stop: 'read',
      monitor_poll: 'read',
      watch_start: 'read',
      watch_stop: 'read',
      watch_poll: 'read',
      find_ui_elements: 'read',
      click_button: 'read',
      game_bridge_install: 'write',
      game_bridge_uninstall: 'write',
      install_override: 'write',
      uninstall_override: 'write',
      game_write: 'process',
      game_playtest: 'process',  // P2-4: playtest 改引擎时间/帧推进/snapshot restore
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
};

/** Reset all module state — for test isolation and service restart. */
export function resetBridgeState(): void {
  // 2026-08-07 审查 P1 修复：P3-6 引入的 push 子系统状态（_pushBuffer/_pushMessageHandler/_socket）
  // 与 socket 独立，原注释"active socket NOT closed here"误导——这三者是模块级状态非 active socket。
  // 不清会导致：(1) 测试隔离泄漏（旧 push handler 持有已销毁 mock server 引用，push 事件错误路由）；
  // (2) _pushBuffer 残留半行 JSON 致下次连接解析异常；(3) _socket 句柄泄漏（FD/内存）。
  // _invalidateSocket() 统一清 _socket + _socketBuffer + _pushBuffer（见 :142-150）。
  _invalidateSocket();
  _pushMessageHandler = null;
  _nextRequestId = 1;
  _permWarned = false;
  _cachedSecret = null;
  _projectDir = null;
  _cachedSecretAt = 0;
  _connectionLock = null;
  _sendLock = Promise.resolve();
  // G-1: 订阅登记表 + keepalive timer 一并清(服务重启语义:旧订阅不复存在;timer 防测试隔离泄漏)
  _subscriptions = [];
  _resendInFlight = null;
  _stopKeepalive();
}

// ─── Bridge readiness probe (M4) ────────────────────────────────────────────
// 零接触:自读 secret + 独立短 socket,绝不碰模块级 _projectDir/_cachedSecret/_socket。
// 供 run_project(wait_for_bridge=true) 使用。

export interface BridgeReadyResult {
  ready: boolean;
  reason: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/** 单次 TCP auth 探测(独立 socket,即建即毁)。成功返回 true。
 *  A1: port 由调用方传入(registry 解析的实际端口,secret 文件与监听端口必须一致)。 */
function probeOnce(secretPath: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let secret: string;
    try {
      secret = readFileSync(secretPath, 'utf-8').trim();
    } catch {
      resolve(false);
      return;
    }
    const sock = createConnection({ port, host: BRIDGE_HOST }, () => {
      sock.write(JSON.stringify({ id: 0, method: 'auth', params: { secret } }) + '\n');
    });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; sock.destroy(); resolve(false); }
    }, 1000);
    // M2: 累积 buffer 按 \n 分割,防 auth 响应跨 TCP 包(partial)导致 JSON.parse 失败
    let buffer = '';
    sock.on('data', (data: Buffer) => {
      if (settled) return;
      buffer += data.toString();
      const idx = buffer.indexOf('\n');
      if (idx === -1) return; // 等待完整行(bridge 响应以 \n 结尾)
      try {
        const resp = JSON.parse(buffer.substring(0, idx).trim());
        if (resp?.result?.authenticated) {
          settled = true; clearTimeout(timer); sock.destroy(); resolve(true);
        }
      } catch { /* 部分/非 JSON 数据,忽略 */ }
    });
    sock.on('error', () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
    });
  });
}

/**
 * 探测 bridge autoload 是否已启动并接受 auth。轮询直到就绪/进程退出/超时。
 * 全程零接触模块级缓存:secret 由 projectDir 自拼路径自读。
 */
export async function isBridgeReady(
  projectDir: string,
  timeoutMs: number,
  opts?: { proc?: ChildProcess; isCancelled?: () => boolean },
): Promise<BridgeReadyResult> {
  // A1: 实际端口来自 registry 解析(避让端口下 secret 文件名同步变化)。
  const port = resolveBridgePort(projectDir);
  const secretPath = bridgeSecretPathFor(projectDir, port);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const interval = 500;

  for (;;) {
    if (opts?.proc?.killed) {
      return { ready: false, reason: 'process exited during probe' };
    }
    if (opts?.isCancelled?.()) {
      // ctx 状态变化(runningProcess !== proc)不等于 bridge 不可用:当前 proc 可能仍活。
      // 多 godot/端口冲突场景:新 spawn 的 proc 因 bind 失败 exit 触发 close,但另一 godot 的 bridge
      // 仍服务 9081。先 probeOnce 探测实际可用性,避免误报 process exited 而漏判 bridge ready。
      if (existsSync(secretPath) && await probeOnce(secretPath, port)) {
        return { ready: true, reason: 'bridge ready' };
      }
      return { ready: false, reason: 'process exited during probe' };
    }
    if (existsSync(secretPath)) {
      if (await probeOnce(secretPath, port)) return { ready: true, reason: 'bridge ready' };
    }
    if (Date.now() >= deadline) {
      return existsSync(secretPath)
        ? { ready: false, reason: 'bridge auth did not succeed within timeout' }
        : { ready: false, reason: 'secret not found (bridge not installed?)' };
    }
    await sleep(Math.min(interval, deadline - Date.now()));
  }
}

/** 测试专用:模块缓存快照,用于断言 isBridgeReady 零接触。 */
export function _testBridgeCacheState(): {
  projectDir: string | null;
  cachedSecret: string | null;
  socketNotNull: boolean;
} {
  return { projectDir: _projectDir, cachedSecret: _cachedSecret, socketNotNull: _socket !== null };
}
