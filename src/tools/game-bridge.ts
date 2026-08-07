import { createConnection, Socket } from 'net';
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, chmodSync, statSync, lstatSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { userInfo } from 'os';
import { execFileSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { Tool } from "@modelcontextprotocol/server";
import type { ToolContext, ToolResult } from '../types.js';
import { textResult, errorResult, getErrorMessage } from '../types.js';
import { opsErrorResult } from './shared.js';
import { requireProjectPath } from '../helpers.js';
import { launchDashboardOnce } from '../dashboard/launcher.js';
import type { RiskLevel } from '../core/tool-registry.js';
import { getLogger } from '../core/logger.js';

const BRIDGE_PORT = 9081;
const BRIDGE_HOST = 'localhost';
const BRIDGE_SCRIPT_NAME = 'mcp_bridge.gd';
const AUTOLOAD_KEY = 'autoload/MCPBridge';
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

/** Clamp a millisecond timeout value. Returns default on invalid/zero input. */
function clampTimeoutMs(value: unknown, min = 1000, max = 60000, def = 10000): number {
  if (value === undefined || value === null) return def;
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ─── TCP client for Bridge communication ────────────────────────────────────

export interface BridgeResponse {
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

let _nextRequestId = 1;
let _permWarned = false;
let _cachedSecret: string | null = null;
let _projectDir: string | null = null;
let _cachedSecretPath: string | null = null;
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

/** Find the bridge secret file in project .godot dir. Throws if project dir not set. */
function findBridgeSecretPath(): string {
  if (_cachedSecretPath) return _cachedSecretPath;
  if (!_projectDir) {
    throw new Error('Bridge secret path requested before game_bridge_install set project directory');
  }
  _cachedSecretPath = join(_projectDir, '.godot', `mcp_bridge_${BRIDGE_PORT}.secret`);
  return _cachedSecretPath;
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
    // Tighten permissions: owner-only read
    if (process.platform === 'win32') {
      try {
        // C-ARC-01: Use os.userInfo().username (no env spoofing), strict regex (no backslash)
        const username = userInfo().username;
        if (username && /^[A-Za-z0-9_-]+$/.test(username)) {
          execFileSync('icacls', [secretPath, '/inheritance:r', '/grant:r', `${username}:R`], { stdio: 'ignore' });
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
    const sock = createConnection({ port: BRIDGE_PORT, host: BRIDGE_HOST }, () => {
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
export function setBridgeProjectDir(projectDir: string): void {
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
  _cachedSecretPath = null;
  _cachedSecret = null;
  _connectionLock = null;
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
      description: '游戏桥接操作。安装/卸载: game_bridge_install, game_bridge_uninstall。P2-1 overrides 注入: install_override/uninstall_override (启动游戏前注入任意调试脚本到项目 autoload,如日志钩子/状态快照)。查询: game_query (ping, get_tree, find_nodes, get_node_properties, get_performance, get_viewport_info, take_screenshot)。写入: game_write (set_node_property, call_method)。输入: game_input (send_key, send_mouse_click, send_mouse_move, send_text, send_touch, send_drag)。等待: game_wait (wait_for_node, wait_for_property)。P2-4 确定性 playtest: game_playtest (playtest.seed 锁随机, playtest.fixed_delta 锁步长, playtest.step 单步推进, playtest.snapshot/restore 状态快照)。监控: monitor_start/stop/poll (属性时间线采样)。信号: watch_start/stop/poll (信号事件记录)。UI: find_ui_elements/click_button (UI元素发现+按钮点击)。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          project_path: { type: 'string', description: 'Godot 项目目录路径（可选，默认使用 GODOT_PROJECT_PATH 环境变量或当前目录）' },
          action: {
            type: 'string',
            enum: [...ACTIONS],
            description: '操作类型',
          },
          port: { type: 'number', description: 'game_bridge_install: 桥接监听端口（当前忽略，始终 9081）', default: 9081 },
          source_script_path: { type: 'string', description: 'install_override/uninstall_override: 源调试脚本绝对路径（必须在 ALLOWED_PROJECT_PATHS 白名单内,拷贝到项目根注册为 autoload/MCPOVERRIDE_<basename>）' },
          method: {
            type: 'string',
            description: 'game_query/game_write/game_input/game_wait/game_playtest 的具体方法。game_query: ping, get_tree, find_nodes, get_node_properties, get_node_layout, get_performance, get_viewport_info, take_screenshot。game_write: set_node_property, call_method。game_input: send_key, send_mouse_click, send_mouse_move, send_text, send_touch, send_drag。game_wait: wait_for_node, wait_for_property。game_playtest: playtest.seed (锁全局 RNG,仅覆盖 randi/randf), playtest.fixed_delta (锁 physics 步长,delta=1/hz), playtest.step (单步推进 N 帧,走 coroutine 延迟响应), playtest.snapshot (快照场景树属性,不保信号/物理/已free节点), playtest.restore (从快照恢复属性)',
          },
          params: {
            type: 'object',
            description: '方法参数。game_query: 因方法而异。game_write: set_node_property {path, property, value}, call_method {path, method, args}。game_input: send_key {key, pressed}, send_mouse_click {x, y, button, pressed}, send_mouse_move {x, y}, send_text {text}, send_touch {x, y, pressed, index}, send_drag {x, y, index, relative, speed}。game_wait: wait_for_node {path}, wait_for_property {path, property, value}。game_playtest: playtest.seed {seed:int}, playtest.fixed_delta {hz:int}, playtest.step {frames:int(1-60)}, playtest.snapshot/restore 无参数',
          },
          timeout: { type: 'number', description: 'game_query/game_write/game_input/game_wait: 超时时间（毫秒，默认 10000）。game_wait 的 timeout 用作整个轮询窗口的总预算（在窗口内反复探测直到条件成立）' },
          interval_ms: { type: 'number', description: 'game_wait 专用：轮询探测间隔（毫秒，默认 200，范围 50-2000）。仅 wait_for_node/wait_for_property 生效', default: 200 },
          node_path: { type: 'string', description: 'monitor_start: 要监控的节点路径（如 root/Player）' },
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
]);

/** Read-only query methods excluding take_screenshot (handled separately via bridge.screenshot). */
export const BRIDGE_READ_ONLY_METHODS = new Set([
  'ping', 'get_tree', 'find_nodes', 'get_node_properties', 'get_node_layout',
  'get_performance', 'get_viewport_info',
]);

const WRITE_METHODS = new Set([
  'set_node_property', 'call_method',
]);

const INPUT_METHODS = new Set([
  'send_key', 'send_mouse_click', 'send_mouse_move', 'send_text',
  'send_touch', 'send_drag',
]);

const WAIT_METHODS = new Set([
  'wait_for_node', 'wait_for_property',
]);

// P2-4 确定性 playtest 四原语(snapshot/restore 同步;step 走 coroutine 延迟响应)
export const PLAYTEST_METHODS = new Set([
  'playtest.seed', 'playtest.fixed_delta', 'playtest.snapshot', 'playtest.restore', 'playtest.step',
]);

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
 *  返回错误消息或 null(校验通过)。 */
function validateBridgePath(params: Record<string, unknown>): string | null {
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
        const port = (args.port as number) || 9081;
        const scriptsDir = dirname(ctx.opsScript);
        const bridgeSrc = join(scriptsDir, BRIDGE_SCRIPT_NAME);

        if (!existsSync(bridgeSrc)) {
          return textResult(`Error: Bridge script not found at ${bridgeSrc}`);
        }

        const destScript = join(projectPath, BRIDGE_SCRIPT_NAME);
        copyFileSync(bridgeSrc, destScript);

        const configPath = join(projectPath, 'project.godot');
        if (!existsSync(configPath)) {
          return textResult(`Error: project.godot not found at ${configPath}`);
        }

        let config = readFileSync(configPath, 'utf-8');
        if (config.includes(AUTOLOAD_KEY)) {
          return textResult(`MCP Bridge autoload already registered. Script copied to ${destScript}.`);
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
          message: `MCP Bridge installed. Autoload registered on port ${port}.`,
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
        if (!config.includes(AUTOLOAD_KEY)) {
          return textResult('MCP Bridge autoload not found in project.godot.');
        }

        const lines = config.split('\n').filter(line => !line.startsWith(AUTOLOAD_KEY + '='));
        const tmpPath = configPath + '.mcp-tmp';
        writeFileSync(tmpPath, lines.join('\n'), 'utf-8');
        renameSync(tmpPath, configPath);

        const scriptPath = join(projectPath, BRIDGE_SCRIPT_NAME);
        if (existsSync(scriptPath)) {
          unlinkSync(scriptPath);
        }

        // A-07: Clean up secret file on uninstall
        const secretPath = join(projectPath, '.godot', `mcp_bridge_${BRIDGE_PORT}.secret`);
        if (existsSync(secretPath)) {
          try { unlinkSync(secretPath); } catch { /* best effort */ }
        }
        _cachedSecret = null;
        _cachedSecretPath = null;
        _invalidateSocket();

        return textResult(JSON.stringify({ success: true, message: 'MCP Bridge uninstalled.' }));
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
        const timeout = Math.min(rawTimeout, 60000);
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

        // I-2 (审查 follow-up): wait_for_property 还需 property + value(T-1 只校验 path)。
        // wait_for_node 只需 path,不校验。
        if (method === 'wait_for_property') {
          if (typeof params.property !== 'string' || !params.property) {
            return opsErrorResult('INVALID_PARAMS', 'wait_for_property requires a non-empty "property" string in params');
          }
          if (params.value === undefined) {
            return opsErrorResult('INVALID_PARAMS', 'wait_for_property requires a "value" in params');
          }
        }

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
        if (!PLAYTEST_METHODS.has(method)) {
          return textResult(`Error: Unknown playtest method "${method}". Supported: ${[...PLAYTEST_METHODS].join(', ')}`);
        }
        const rawParams = args.params;
        const params = (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
          ? rawParams as Record<string, unknown>
          : {};
        // step 走 coroutine 延迟响应,需要更长 timeout(N 帧推进)
        const isStep = method === 'playtest.step';
        const rawTimeout = clampTimeoutMs(args.timeout);
        const timeout = Math.min(isStep ? Math.max(rawTimeout, 10000) : rawTimeout, 60000);
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
  _nextRequestId = 1;
  _permWarned = false;
  _cachedSecret = null;
  _projectDir = null;
  _cachedSecretPath = null;
  _cachedSecretAt = 0;
  // Note: active socket connections are NOT closed here — use _invalidateSocket() for that
  _socketAuthenticated = false;
  _socketBuffer = '';
  _connectionLock = null;
  _sendLock = Promise.resolve();
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

/** 单次 TCP auth 探测(独立 socket,即建即毁)。成功返回 true。 */
function probeOnce(secretPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let secret: string;
    try {
      secret = readFileSync(secretPath, 'utf-8').trim();
    } catch {
      resolve(false);
      return;
    }
    const sock = createConnection({ port: BRIDGE_PORT, host: BRIDGE_HOST }, () => {
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
  const secretPath = join(projectDir, '.godot', `mcp_bridge_${BRIDGE_PORT}.secret`);
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
      if (existsSync(secretPath) && await probeOnce(secretPath)) {
        return { ready: true, reason: 'bridge ready' };
      }
      return { ready: false, reason: 'process exited during probe' };
    }
    if (existsSync(secretPath)) {
      if (await probeOnce(secretPath)) return { ready: true, reason: 'bridge ready' };
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
