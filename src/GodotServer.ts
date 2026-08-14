import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";
import type { Tool } from "@modelcontextprotocol/server";

// P1-3: legacy era 版本列表(SDK core SUPPORTED_PROTOCOL_VERSIONS 的快照,避免测试 mock 耦合)。
// SDK 更新此列表时需同步(低频,约每年新版本);核实命令:
//   node -e "console.log(require('@modelcontextprotocol/server').SUPPORTED_PROTOCOL_VERSIONS)"
// 追加 '2026-07-28' 实现双时代 opt-in(modern era)。
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07',
] as const;
import { join } from 'path';
import { readInstructions } from './core/instructions.js';
import { waitForEditorSecret } from './core/editor-auth.js';
import { registerBridgePushHandler, setBridgeProjectDir } from './tools/game-bridge.js';
import {
  listResources as listMcpResources,
  listResourceTemplates as listMcpResourceTemplates,
  readResource as readMcpResource,
} from './resources.js';
import { listPrompts, getPrompt, handleCompletion } from './prompts.js';

// ─── Import and register tool modules ────────────────────────────────────────
// C-ARCH-01: All tool modules centralized in module-loader.ts
import { registerAllModules } from './core/module-loader.js';
import { setToolCallDelegate, setDynamicSender } from './tools/advanced-proxy.js';
import { setMcpServer, clearMcpServer } from './core/tool-registry.js';
registerAllModules();


import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkgVersion = require('../package.json').version;
import { ReadOnlyGuard } from './core/ReadOnlyGuard.js';
import { ToolDispatcher } from './core/ToolDispatcher.js';
import * as guard from './core/guard.js';
import { EditorConnection } from './core/EditorConnection.js';
import { EditorToolExecutor } from './core/EditorToolExecutor.js';
import { dynamicSchema } from './core/dynamic-schema.js';
import { getAllToolNames, registerDynamicTools } from './core/tool-registry.js';
import { findGodot, clearGodotPathCache, getCachedGodotPath } from './core/godot-finder.js';
import { setOnGroupsChanged, setConnectionStatusProvider, setReconnectEditor, buildConnectionStatus, buildReconnectEditor } from './tools/manage-tools.js';
import { setGetContextConnectionProvider, setEditorSceneProvider } from './tools/get-context.js';
import { InstanceManager, buildInstanceInfo } from './core/instance-manager.js';
import { InstanceRouter, type RouterDependencies } from './core/instance-router.js';
import { setInstanceManager, setInstanceRouter } from './tools/instance-tools.js';
import { buildAuthHeaders } from './core/instance-api-auth.js';
import { InstanceHttpServer } from './core/instance-http-server.js';
import { isFeatureEnabled } from './core/feature-flags.js';
import * as ps from './core/process-state.js';
import { killProcess } from './core/process-state.js';
import { getLogger, setLoggerServer, setLoggerClientReady } from './core/logger.js';
import { setProgressSender, setProgressClientReady } from './core/progress.js';
import { setElicitServer } from './core/elicit.js';
import { resolveProjectPath, safeRealPath } from './core/path-utils.js';
import { setAllowedRootsFromClient, hasDynamicRoots, parseFileRootUris } from './core/path-utils.js';
import { AgentContextManager } from './core/agent-context.js';
import { FileStateStore } from './core/state-store.js';

// Re-export for backward compatibility (tests import from GodotServer)
export { clearGodotPathCache, getCachedGodotPath };

const DEBUG = process.env.DEBUG === 'true';
const EDITOR_SECRET_TIMEOUT_MS = 5000;

// 编辑器重连参数（env 可覆盖，默认对齐 EditorConnection 构造默认）。
// 运行时读（非 module-level 固化）：连接是低频操作，且避免测试需在 import 前设 env。
// 主要为集成测试可注入低 attempts/interval 跑真实重连耗尽（默认 20 次 × backoff 到 60s 不可测）。
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function log(...args: unknown[]): void {
  if (!DEBUG) return;
  getLogger().debug('godot-mcp', args.map(a => String(a)).join(' '));
}

// ─── GodotServer class ───────────────────────────────────────────────────────

// ─── Server options ───────────────────────────────────────────────────────────

export interface ServerOptions {
  mode?: string;
  connectionMode?: 'headless' | 'editor';
  readOnly?: boolean;
  noFallback?: boolean;
  /** P2-1: --overrides CLI flag 指定的默认 override 脚本路径列表,graceful shutdown 时批量卸载 */
  overrides?: string[];
}

export class GodotServer {
  private server: Server;
  private opsScript: string;
  private options: ServerOptions;
  private readOnlyGuard: ReadOnlyGuard;
  private dispatcher: ToolDispatcher | null = null;
  private editorConn: EditorConnection | null = null;
  private editorExecutor: EditorToolExecutor | null = null;
  // P2-1R (2026-08-11 CMP-1 TOCTOU): 自动重连校验期 flag,传给 EditorToolExecutor 作 gate。
  // true 期间 editor 工具入口返 VERIFICATION_IN_PROGRESS,防 TOCTOU 窗口期写操作作用错误项目。
  private _editorVerifying = false;
  private connectionMode: 'headless' | 'editor';
  /** B-T5: pingFn catch 保留 err.code,供 onStateChange 分流——
   *  REQUEST_TIMEOUT(TCP OPEN 主线程卡死)→ 降级;
   *  NOT_CONNECTED/CONNECTION_LOST(下线)→ 让 EditorConnection 自动重连兜底,不抢占。 */
  private _lastPingErrCode: string | undefined;
  // 方案B: 供 rebuildEditorConnection() 重建降级后的 editor 连接(port 存实例,secret 重建时重读)
  private editorPort: number | null = null;
  private editorProjectPath: string | null = null;
  private noFallback: boolean;
  private agentCtx: AgentContextManager;
  private stateStore: FileStateStore | null = null;
  // 报告②P0：周期性 orphan 扫描定时器。60s 间隔（规避 killOrphanGodotProcesses 内部 30s 节流）。
  // unref 不阻塞进程退出；close() 时 clearInterval。参考 agent-context.ts:46 / health-monitor.ts:320。
  private orphanScanTimer: ReturnType<typeof setInterval> | null = null;
  // 行225 MULTI_INSTANCE 接收端：HTTP server + 心跳 + 本实例 id（initMultiInstance 启动，close 清理）。
  private httpReceiver: InstanceHttpServer | null = null;
  private instanceHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private selfInstanceId: string | null = null;

  constructor(opsScript: string, options: ServerOptions = {}) {
    this.opsScript = opsScript;
    this.options = options;
    this.readOnlyGuard = new ReadOnlyGuard(options.readOnly ?? false);
    this.connectionMode = options.connectionMode ?? 'headless';
    this.noFallback = options.noFallback ?? false;
    this.agentCtx = new AgentContextManager();
    this.server = new Server(
      { name: 'godot-mcp-enhanced', version: pkgVersion },
      {
        // P1-4: 补全 listChanged 声明。enhanced 实际会发 notifications/tools/list_changed
        // (manage_tools activate/deactivate 触发),但此前 capabilities 未声明 → 客户端可能
        // 忽略通知。声明后客户端才会订阅,配合 ttlMs 让缓存能在切组时立即失效。
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
          completions: {},
          // P1-7 (SEP-2577): emit notifications/message 的 server MUST 声明 logging capability。
          // 此前未声明 → SDK sendLoggingMessage 静默 no-op(logger.ts:155 warn/error 推送失效),
          // 且 GodotServer 直发 notification(notifications/message) 抛 SdkError 被 catch 吞。
          logging: {},
          // P2-5 (SEP-2133): extensions 声明让 modern-era 客户端发现 enhanced 的 runtime-bridge 能力。
          // ⚠️ era-gated:extensions 是 2026-07-28 引入,legacy-era 客户端不认识 → SDK encode 时 strip,对 legacy 无害。
          // runtime-bridge:TCP 通道(game_query/input/write/wait + 确定性 playtest 四原语 P2-4)。
          // 注:具体 method(如 bridge.status)待 SDK extensions method routing 成熟后补,当前为发现性声明。
          extensions: {
            'io.godot-mcp/runtime-bridge': {
              description: 'Godot runtime bridge: TCP channel for game queries/inputs/asserts and deterministic playtest (seed/fixed_delta/step/snapshot/restore)',
              version: '1',
              capabilities: ['game_query', 'game_input', 'game_write', 'game_wait', 'game_playtest', 'install_override'],
            },
          },
        },
        instructions: readInstructions(),
        // P1-4 (SEP-2549): 为 cacheable result 提供 ttlMs/cacheScope 提示。
        // ⚠️ era-gated:SDK v2 的 fillCacheFields 只在 modern-era(2026-07-28+)encodeResult 跑。
        // enhanced 当前默认 supportedProtocolVersions 仅 legacy era,故 cacheHints 当前对客户端是 no-op
        // (配置合法,SDK 不报错;面向未来准备 —— enhanced opt-in modern era 或 SDK 默认支持 modern 版本后生效)。
        // 策略依据:工具/prompts/模板清单启动后基本静态(仅 manage_tools 主动切组时变,
        // 已配 listChanged 通知立即失效缓存);resources 依赖 project_path 且文件可变,短 TTL + private。
        cacheHints: {
          'tools/list': { ttlMs: 300_000, cacheScope: 'public' },         // 5min,工具清单所有用户相同
          'prompts/list': { ttlMs: 600_000, cacheScope: 'public' },        // 10min,prompts 启动后静态
          'resources/list': { ttlMs: 60_000, cacheScope: 'private' },      // 1min,依赖 project_path(用户特定)
          'resources/templates/list': { ttlMs: 600_000, cacheScope: 'public' }, // 10min,模板静态
          'resources/read': { ttlMs: 30_000, cacheScope: 'private' },      // 30s,读取特定资源,短 TTL
          'server/discover': { ttlMs: 300_000, cacheScope: 'public' },     // 5min,服务器能力静态
        },
        // P1-3 (SEP-2575): opt-in modern era(2026-07-28)。SDK 检测到 modern 版本后:
        // 1) 自动注册 server/discover handler(_ondiscover,返 supportedVersions+capabilities)
        // 2) 启用 modern codec → fillCacheFields(cacheHints 上 wire)+ envelope lift(logLevel 等 reserved key 搬到 ctx.mcpReq.envelope)
        // 双时代自动:legacy 客户端仍走 initialize 握手 + oninitialized;modern 客户端走 server/discover + per-request _meta。
        // Roots 影响:modern era 无连接级状态,oninitialized 不触发 → Roots 走 env baseline(ALLOWED_PROJECT_PATHS),
        // 这是预期降级(modern 无状态与 enhanced 连接级安全白名单语义有根本张力,详见 initRootsIntegration 注释)。
        supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS, '2026-07-28'],
      }
    );
    setMcpServer(this.server);
    setLoggerServer(this.server);
    setProgressSender(this.server);
    setElicitServer(this.server);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    const dispatcher = new ToolDispatcher({
      readOnly: this.options.readOnly ?? false,
      mode: this.options.mode ?? 'full',  // G7 审查 O1 defer: 兜底保持 full(godot-server.test 假设;生产经 index.ts 默认 basic,O1 一致性 defer 到未来统一)
      readOnlyGuard: this.readOnlyGuard,
      connectionMode: this.connectionMode,
      noFallback: this.noFallback,
      opsScript: this.opsScript,
      findGodot,
      toolCallDelegate: setToolCallDelegate,
      agentContext: this.agentCtx,
    });
    this.dispatcher = dispatcher;

    this.server.setRequestHandler('tools/list', async () => {
      // CMP-16-B (2026-08-08): merge 动态工具(live schema 从 editor addon 拉取)。
      // 静态工具先过滤(getFilteredTools),再追加动态工具(经 isToolAllowed 在调用层放行)。
      const staticTools = dispatcher.getFilteredTools();
      const dynamicTools = await mergeDynamicTools(staticTools);
      return { tools: [...staticTools, ...dynamicTools] };
    });

    this.server.setRequestHandler('tools/call', (request, ctx) =>
      dispatcher.handleCall(request, ctx)
    );

    // ── MCP Resources handlers ──────────────────────────────────────────────
    this.server.setRequestHandler('resources/list', async () => {
      const projectPath = resolveProjectPath();
      const resources = listMcpResources(projectPath);
      return { resources };
    });

    this.server.setRequestHandler('resources/templates/list', async () => {
      const templates = listMcpResourceTemplates();
      return { resourceTemplates: templates };
    });

    this.server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params;
      const projectPath = resolveProjectPath();
      const content = await readMcpResource(uri, projectPath);
      return { contents: [content] };
    });

    // Connect manage-tools notification callback
    setOnGroupsChanged(() => this.sendToolListChanged());
    setConnectionStatusProvider(() => buildConnectionStatus(this.editorConn, this.dispatcher?.getHealthMonitor() ?? null));
    setGetContextConnectionProvider(() => buildConnectionStatus(this.editorConn, this.dispatcher?.getHealthMonitor() ?? null));
    setEditorSceneProvider(async () => {
      if (!this.editorConn?.isConnected()) return null;
      try {
        const result = await this.editorConn.request('editor_get_scene_stats', {});
        return (result as { stats?: { path: string; root: string; nodeCount: number; typeTopN?: Array<{ type: string; n: number }>; truncated?: boolean } | null })?.stats ?? null;
      } catch {
        return null;  // editor error（如 NO_SCENE -32005）→ null 降级
      }
    });
    // CMP-16-B (2026-08-08): 注入 dynamic-schema fetcher(live schema 从 editor addon 拉 param docs)。
    // editor 离线时 fetcher 返回 null → dynamicSchema 降级空数组(只留 godot_advanced_tool 兜底)。
    dynamicSchema.setFetcher(async () => {
      if (!this.editorConn?.isConnected()) return null;
      try {
        const result = await this.editorConn.request('list_param_docs', {});
        return (result as { result?: Record<string, unknown> } | null)?.result as Record<string, { description: string; params: Array<{ name: string; type: string; required: boolean; desc: string }> }> ?? null;
      } catch {
        return null;  // editor 离线/超时 → null 降级
      }
    });
    setReconnectEditor(buildReconnectEditor(
      () => this.editorConn,
      () => this.rebuildEditorConnection(), // 方案B: editor 降级后重建连接(重读 secret + new EditorConnection)
    ));

    // ── MCP Prompts handlers (Phase 5b) ────────────────────────────────────────
    this.server.setRequestHandler('prompts/list', async () => ({
      prompts: listPrompts(),
    }));

    this.server.setRequestHandler('prompts/get', async (request) => {
      const { name, arguments: promptArgs } = request.params;
      return getPrompt(name, (promptArgs ?? {}) as Record<string, string>);
    });

    // ── MCP Prompt Completion handler（Phase P2-6）──────────────────────────
    this.server.setRequestHandler('completion/complete', async (request) => {
      const { ref, argument } = request.params;
      return handleCompletion(
        ref as { type: string; name: string },
        argument as { name: string; value: string },
        resolveProjectPath(),
      );
    });

    // P3-6: Subscriptions/listen — bridge 事件主动推送
    // resources/subscribe: 客户端订阅(SDK 返回 EmptyResult,实际推送由 notification 完成)
    // bridge/event push:addon 侧 watch/monitor push 模式产生的事件 → 转发为 MCP notification
    this.server.setRequestHandler('resources/subscribe', async () => ({}));
    this.server.setRequestHandler('resources/unsubscribe', async () => ({}));
    registerBridgePushHandler((params) => {
      // bridge push 消息 → MCP notification(notifications/resources/updated 携带事件数据)
      // 客户端订阅 bridge://events 后,事件到达即推送(无需轮询 watch_poll/monitor_poll)
      try {
        this.server.notification({
          method: 'notifications/resources/updated',
          params: { uri: 'bridge://events', ...params },
        });
      } catch {
        // notification 发送可能因 client 未订阅/断连而抛 SdkError,吞掉不中断
      }
    });

    // Phase 2b: Multi-instance initialization moved to initMultiInstance() (async fs)

    // 批 P0: MCP Roots 动态授权集成（oninitialized + list_changed）
    this.initRootsIntegration();
  }

  /**
   * MCP Roots 动态授权集成（批 P0）。
   * oninitialized 检测 client 能力 → listRoots 拉取 → parseFileRootUris 解析 → setAllowedRootsFromClient 注入。
   * list_changed 热更新。initial 失败 fail-to-env-baseline；re-fetch 失败 + 已有 roots 保留旧（不静默切作用域）。
   * SDK oninitialized: () => void（非 Promise），async 赋值后 SDK 不 await——首次 fetch 完成前工具调用走 env baseline（fail-safe 朝收紧方向）。
   *
   * P1-3 (SEP-2575): modern era(2026-07-28)降级行为:
   * - oninitialized 不触发(modern 无 initialize 握手)→ Roots 走 env baseline(ALLOWED_PROJECT_PATHS)
   * - listRoots() 在 modern era 抛错(_assertPushApiInServedEra)→ 被 try/catch 兜底,降级 env baseline
   * - getClientCapabilities() 在 modern era 是 per-request 快照(非连接级)→ oninitialized 不触发故不影响
   * - notifications/roots/list_changed 移除(modern 用 subscriptions/listen)→ legacy 客户端仍工作
   * 这是预期降级:modern era 的无状态特性与 enhanced 的"连接级安全白名单"语义有根本张力。
   * 用户通过 ALLOWED_PROJECT_PATHS 环境变量配置 modern era 的路径白名单。
   */
  private async initRootsIntegration(): Promise<void> {
    const applyRoots = async (isRefetch: boolean): Promise<void> => {
      try {
        const resp = await this.server.listRoots();
        const valid = parseFileRootUris(resp.roots ?? []);
        if (valid.length > 0) {
          setAllowedRootsFromClient(valid);
          getLogger().info('security', `Authorized ${valid.length} root(s) from MCP client`);
        } else {
          if (isRefetch && hasDynamicRoots()) {
            getLogger().warn('security', 'Roots re-fetch returned empty/invalid — keeping previous roots');
          } else {
            setAllowedRootsFromClient(null);
            getLogger().info('security', 'No valid client roots — using ALLOWED_PROJECT_PATHS baseline');
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRefetch && hasDynamicRoots()) {
          getLogger().warn('security', `Roots re-fetch failed — keeping previous roots: ${msg}`);
        } else {
          setAllowedRootsFromClient(null);
          getLogger().warn('security', `Initial roots fetch failed — using env baseline: ${msg}`);
        }
      }
    };

    this.server.oninitialized = async () => {
      setLoggerClientReady(true);
      setProgressClientReady(true);
      const caps = this.server.getClientCapabilities();
      if (caps?.roots) {
        await applyRoots(false);
      } else {
        getLogger().info('security', 'Client does not support MCP Roots — using ALLOWED_PROJECT_PATHS baseline');
      }
    };

    this.server.setNotificationHandler('notifications/roots/list_changed', async () => {
      await applyRoots(true);
    });
  }

  /** Phase 2b: Multi-instance initialization (async fs — C-02).
   *  2026-08-10 行225：补全接收端 HTTP server——此前 send-side only，现 verifyApiToken 闭环。 */
  private async initMultiInstance(): Promise<void> {
    if (!isFeatureEnabled('MULTI_INSTANCE')) return;
    const projectDir = ps.getProjectDir();
    const manager = new InstanceManager({
      projectRegistryDir: projectDir
        ? join(projectDir, '.godot', 'mcp-instances')
        : undefined,
    });
    // 行225：启动 HTTP 接收端（verifyApiToken 闭环）。
    // 分配端口 → 注册自己到 registry → 启动 InstanceHttpServer → 30s 心跳。
    // 失败不阻断发送端（sendToInstance 仍可工作，只是本实例不被发现/不可被 route 到）。
    try {
      const instances = await manager.loadFromRegistry();
      const usedPorts = instances.map(i => i.port);
      const port = manager.allocatePort(usedPorts);
      const projectPath = resolveProjectPath() ?? projectDir ?? process.cwd();
      const projectName = projectPath.split(/[\\/]/).pop() ?? 'unknown';
      const selfInfo = buildInstanceInfo({ port, projectPath, projectName });
      this.selfInstanceId = selfInfo.id;
      await manager.registerSelf(selfInfo);
      if (this.dispatcher) {
        this.httpReceiver = new InstanceHttpServer({
          port,
          instanceId: selfInfo.id,
          dispatcher: this.dispatcher,
        });
        await this.httpReceiver.start();
      }
      // 30s 心跳刷 lastSeen（stale timeout 70s，留余量）。unref 不阻塞退出。
      this.instanceHeartbeatTimer = setInterval(() => {
        if (this.selfInstanceId) {
          void manager.updateLastSeen(this.selfInstanceId).catch(() => { /* best-effort */ });
        }
      }, 30_000);
      this.instanceHeartbeatTimer.unref?.();
      getLogger().info('instance', `Multi-instance receiver started on 127.0.0.1:${port} (id=${selfInfo.id}, HMAC auth verified via verifyApiToken)`);
    } catch (err) {
      getLogger().warn('instance', `Multi-instance receiver failed to start (send-side still works): ${err instanceof Error ? err.message : err}`);
    }
    const sendToInstance: RouterDependencies['sendToInstance'] = async (instance, toolName, args) => {
      // 安全：拒绝非法 tool name（防路径注入）
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(toolName)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid tool name: ${toolName}` }],
          isError: true,
        };
      }
      const url = `http://127.0.0.1:${instance.port}/api/${toolName}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: buildAuthHeaders(instance.id),
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          return {
            content: [{ type: 'text' as const, text: `Instance ${instance.id} error: HTTP ${response.status}` }],
            isError: true,
          };
        }
        const data = await response.json();
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Instance ${instance.id} unreachable: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    };
    const router = new InstanceRouter({
      instances: await manager.loadFromRegistry(),
      sendToInstance,
    });
    setInstanceManager(manager);
    setInstanceRouter(router);
    // Phase 3: Wire dynamic route sender — resolves selected instance and POSTs to route
    setDynamicSender(async (route: string, toolArgs: Record<string, unknown>) => {
      // C-01 安全：校验 route 仅含安全字符（防路径注入）
      if (!/^[a-zA-Z0-9\-/]+$/.test(route)) {
        return { content: [{ type: 'text' as const, text: 'Invalid route: access denied' }], isError: true };
      }
      const selected = router.getSelectedInstance();
      if (!selected) {
        return { content: [{ type: 'text' as const, text: 'No instance selected for dynamic routing.' }], isError: true };
      }
      const url = `http://127.0.0.1:${selected.port}/api/${route}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(selected.id),
        body: JSON.stringify(toolArgs),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        return { content: [{ type: 'text' as const, text: `Dynamic route ${route} error: HTTP ${response.status}` }], isError: true };
      }
      const data = await response.json();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    });
    getLogger().info('instance', 'Multi-instance mode enabled');
  }

    /** Send tools/list_changed notification to client. Called when active groups change. */
  sendToolListChanged(): void {
    this.server.notification({
      method: 'notifications/tools/list_changed',
    });
  }

  
  // ─── Run ───────────────────────────────────────────────────────────────────

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log('Godot MCP Enhanced server running on stdio');

    // 报告②P0：周期性 orphan 扫描。killOrphanGodotProcesses 内部有 30s 节流，故 60s 间隔保证每次
    // tick 真正扫描。第一层只扫本会话 _spawnedGodotPids（不误杀用户 Godot）。unref 不阻塞退出。
    this.orphanScanTimer = setInterval(() => {
      void ps.killOrphanGodotProcesses(ps.getProjectDir() || undefined).catch(() => { /* best-effort */ });
    }, 60_000);
    this.orphanScanTimer.unref?.();

    // 状态持久化 — 加载已保存的 agent 状态
    const projectPath = resolveProjectPath();

    // 报告②P1：启动时清理上一会话残留 Godot 进程（opt-in，默认关）。
    // 2026-08-07 审查 P1 修复：原 STARTUP_CLEANUP 单独开启时是 no-op（_spawnedGodotPids
    // 新会话为空 → 第一层 0 kill，需 FULL_SYSTEM_SCAN 才触发第二层）。用户按文档开
    // STARTUP_CLEANUP 期望清理崩溃残留，实际无效果（虚假安全感）。
    // 修复：STARTUP_CLEANUP 启用时传 { fullSystemScan: true }，让第二层
    // fullSystemScanGodot 也跑（只扫命令行含 projectPath 的 Godot，跳过 --editor，15s
    // 超时，unref 不阻塞，安全过滤在 process-state.ts fullSystemScanGodot 内置）。
    // IPC-R1/R5 (2026-08-08): 原实现临时设 process.env + finally 恢复(进程级全局状态),
    // 与 60s 周期 orphan 扫描 tick 存在竞态(全系统扫跑满 15s 时 env 污染周期 tick)。
    // 改用显式 options 参数,消除 env 隐式全局状态。
    if (isFeatureEnabled('STARTUP_CLEANUP') && projectPath) {
      void ps.killOrphanGodotProcesses(projectPath, { fullSystemScan: true }).catch(() => { /* best-effort */ });
    }
    if (projectPath) {
      this.stateStore = new FileStateStore(projectPath);
      const saved = await this.stateStore.load();
      if (saved) {
        for (const [id, agentState] of Object.entries(saved.agents)) {
          const state = this.agentCtx.getOrCreate(id);
          state.selectedInstance = agentState.selectedInstance;
          state.activeProfile = agentState.activeProfile;
          state.isEphemeral = false;
        }
        this.markStateDirty();
      }
    }

    // Phase 2b: Multi-instance initialization (async fs — C-02)
    await this.initMultiInstance();

    // Phase 5d: Project context notification
    // P1-7 (SEP-2577): 改用 sendLoggingMessage(走 SDK 正规 logging 路径)。
    // 此前用 notification({method:'notifications/message'}) 直发,被 SDK assertNotificationCapability
    // 抛 SdkError(因 capabilities 未声明 logging)→ 被 catch 吞,通知没发出。
    // 声明 logging capability + 改用 sendLoggingMessage 后,SDK 正常发通知。
    setImmediate(() => {
      try {
        const maybePromise = this.server.sendLoggingMessage({
          level: 'info',
          logger: 'server',
          data: '[Godot MCP] Project context available at godot://project-context. Read it for coding guidelines and architecture notes.',
        });
        if (maybePromise && typeof maybePromise === 'object' && 'catch' in maybePromise) {
          (maybePromise as Promise<void>).catch(() => {});
        }
      } catch { /* best-effort */ }
    });

    if (this.connectionMode === 'editor') {
      const port = parseInt(process.env.GODOT_EDITOR_PORT ?? '9090', 10);
      this.editorPort = port; // 方案B: 存实例字段供 rebuild 重建
      const projectPath = resolveProjectPath();
      this.editorProjectPath = projectPath ?? null; // 方案B: 归一化 undefined → null
      let secret: string | undefined;
      if (projectPath) {
        secret = (await waitForEditorSecret(projectPath, EDITOR_SECRET_TIMEOUT_MS)) ?? undefined;
      }
      if (!secret) {
        getLogger().warn('auth', 'No editor secret found — plugin may not be running');
        if (this.noFallback) {
          getLogger().error('auth', 'Editor auth required but no secret available. Install the editor plugin.');
          // I-CQ-01: Graceful cleanup before exit
          getLogger().close();
          process.exit(1);
        }
        getLogger().warn('godot-mcp', 'Running in Headless mode (no editor auth).');
        this.dispatcher?.markEditorFallback();
        this.connectionMode = 'headless';
        this.dispatcher?.setConnectionMode('headless');
      } else {
        // 建立连接 + executor 接线 + 降级 handler 提取到 establishEditorConnection(rebuild 复用)
        const result = await this.establishEditorConnection(port, secret);
        if (result.connected) {
          log('Editor: %s', result.detail);
        } else {
          if (this.noFallback) {
            getLogger().error('auth', `Editor mode required but connection failed: ${result.detail}`);
            getLogger().error('auth', 'Set GODOT_MCP_NO_FALLBACK=false to allow fallback, or install the plugin.');
            process.exit(1);
          }
          getLogger().warn('godot-mcp', `${result.detail}.`);
          getLogger().warn('godot-mcp', 'Running in Headless mode. UndoRedo disabled, no scene state persistence.');
          this.dispatcher?.markEditorFallback();
          this.connectionMode = 'headless';
          this.dispatcher?.setConnectionMode('headless');
        }
      }
    }
  }

  /** 编辑器不可用时的统一降级动作（WS 重连耗尽 / 心跳检测卡死 共用）。
   *  2026-07-12 P0：抽公共逻辑，reconnectExhausted handler 与 onStateChange 回调共用。 */
  private handleEditorStall(): void {
    // B2: 清 zombie——旧 EditorConnection 的 WS 仍 OPEN + reconnectEnabled=true,
    // 不 disconnect 则闭包重连耗尽后跨实例触发 reconnectExhausted 再降级。
    try { this.editorConn?.disconnect(); } catch { /* best-effort */ }
    this.dispatcher?.markEditorFallback();
    this.connectionMode = 'headless';
    // I-04: atomic degradeToHeadless() 避免 two separate _pendingModeSwitch writes racing
    this.dispatcher?.degradeToHeadless();
    // 降级后停心跳：editorConn 置 null 后 pingFn 必返 false，继续 recordFailure 是噪声。
    // rebuild 成功后 establishEditorConnection 会重新 startHeartbeat。
    this.dispatcher?.getHealthMonitor().stopHeartbeat();
    this.editorConn = null;
    // CMP-16-B: editor 降级 → 清 dynamic schema 缓存(下次 tools/list 返空,降级到 godot_advanced_tool 兜底)
    dynamicSchema.invalidate();
  }

  /**
   * 建立 editor 连接:new EditorConnection + connect + executor 接线 + 挂降级 handler。
   * 成功 → connectionMode='editor' + setConnectionMode('editor');失败 → 清理 editorConn,返回 {connected:false}。
   * 不含 noFallback exit / headless 降级(那是 run() 初始化语义);rebuild 复用此方法(失败不 exit,保持 headless)。
   * I-04: 降级用专用 reconnectExhausted handler(非 disconnect handler——后者每次 ws.close 触发会过早降级)。
   */
  private async establishEditorConnection(port: number, secret: string): Promise<{ connected: boolean; detail: string }> {
    // 清理旧连接(rebuild 场景:降级后可能有残留或并发重建)
    // 2026-08-07 审查 P2 修复：显式 destroy 旧 editorExecutor，防 handler 残留。
    // 当前 disconnect 的 clear() 兜底清了 handler set，但耦合脆弱——若未来 disconnect
    // 不再 clear，旧 executor handler 会残留指向已废弃 conn。显式 destroy 是防御性加固。
    if (this.editorExecutor) {
      try { this.editorExecutor.destroy(); } catch { /* best-effort */ }
      this.editorExecutor = null;
    }
    if (this.editorConn) {
      try { this.editorConn.disconnect(); } catch { /* best-effort */ }
      this.editorConn = null;
    }
    this.editorConn = new EditorConnection({
      port,
      reconnect: true,
      secret,
      maxReconnectAttempts: readPositiveIntEnv('GODOT_MCP_EDITOR_RECONNECT_ATTEMPTS', 20),
      reconnectInterval: readPositiveIntEnv('GODOT_MCP_EDITOR_RECONNECT_INTERVAL', 1000),
      maxReconnectInterval: readPositiveIntEnv('GODOT_MCP_EDITOR_RECONNECT_MAX_INTERVAL', 60000),
    });
    try {
      await this.editorConn.connect();
      // CMP-1 (2026-08-08): 连接成功后立即校验 editor 对应的项目根,防跨项目误操作。
      // 发 editor_get_project_path RPC 读 editor 的 res:// 绝对路径,与 this.editorProjectPath
      // (resolveProjectPath 结果)归一化比对。mismatch → disconnect + 返回失败(走降级路径)。
      // editorProjectPath=null(resolveProjectPath 返 undefined,无 project.godot 上下文)→ 跳过,不阻断。
      const projectCheck = await this.verifyEditorProject();
      if (!projectCheck.ok) {
        try { this.editorConn.disconnect(); } catch { /* best-effort */ }
        this.editorConn = null;
        const expected = projectCheck.expected ?? '(unknown)';
        const actual = projectCheck.actual ?? '(unreadable)';
        return { connected: false, detail: `Editor project mismatch: expected ${expected}, got ${actual}` };
      }
      // B-T3: hm 提前到 EditorToolExecutor 构造前复用，注入 _executeInner 半开 HOL 预检
      // （reconnecting 时即时返 NOT_CONNECTED，跳过 30s conn.request 等待，避免串行 executeChain ×30s 放大）。
      const hm = this.dispatcher?.getHealthMonitor();
      this.editorExecutor = new EditorToolExecutor(this.editorConn, hm, () => this._editorVerifying);
      this.dispatcher?.setEditorExecutor(this.editorExecutor);
      // CMP-16-B (2026-08-08): editor (重)连接成功 → 清 dynamic schema 缓存,下次 tools/list 重新拉取。
      // 这修复竞品"只 fetch 一次不刷新"缺陷(editor 重装 addon 后工具集更新)。
      dynamicSchema.invalidate();
      this.editorConn.addOnReconnectExhaustedHandler(() => {
        getLogger().warn('godot-mcp', 'Editor reconnect attempts exhausted — degrading to headless mode.');
        this.handleEditorStall();
      });
      // B-T5: 编辑器重连成功 → 即刻复位 hm state=connected + 清 heartbeat 失败计数。
      // 避免 refused 不抢占后 hm 卡 reconnecting(下次 ping 要等 probeIntervalMs=60s 才纠正),
      // 期间 B-T3 半开 HOL 预检(_executeInner getState===reconnecting)会拦所有 editor 工具致卡顿。
      // 链完整性:refused→hm reconnecting 但不降级→EditorConnection 20 次退避重连→重连成功→
      // 本 handler 复位 hm→恢复;重连耗尽→上面 reconnectExhausted handler→handleEditorStall 兜底降级。
      this.editorConn.addOnReconnectHandler(() => {
        if (hm) hm.reset();
        // CMP-1 NIT-1 (2026-08-08 第三方审查): 自动重连后重新校验项目匹配。
        // editor 可能重连后对应不同项目(如端口被另一个项目的 editor 接管),需重校验。
        // fire-and-forget:不阻塞重连流程;mismatch 则 handleEditorStall 降级。
        // P2-1R (2026-08-11): 校验期设 _editorVerifying=true,EditorToolExecutor 入口
        // 即时返 VERIFICATION_IN_PROGRESS,防 TOCTOU 窗口期写操作作用错误项目场景树。
        this._editorVerifying = true;
        void this.verifyEditorProject().then((check) => {
          if (!check.ok) {
            getLogger().warn('auth', `Editor project changed after reconnect: expected ${check.expected ?? '(unknown)'}, got ${check.actual ?? '(unreadable)'} — degrading to headless.`);
            this.handleEditorStall();
          }
        }).finally(() => {
          this._editorVerifying = false;
        });
        // IPC-R4 (2026-08-08): 重连后通知客户端场景树可能 stale。
        // 重连期间 editor 侧场景可能已切换/节点增删,客户端缓存的 scene tree 状态失效。
        // 用 sendLoggingMessage(走 SDK 正规 logging 路径,对齐 P1-7 范式 :477)。
        // best-effort:通知失败不影响重连流程。
        try {
          const maybePromise = this.server.sendLoggingMessage({
            level: 'warning',
            logger: 'server',
            data: 'Editor reconnected — scene tree may be stale. Re-run editor_get_scene_tree to refresh cached node paths.',
          });
          if (maybePromise && typeof maybePromise === 'object' && 'catch' in maybePromise) {
            (maybePromise as Promise<void>).catch(() => {});
          }
        } catch { /* best-effort:通知失败不影响重连 */ }
      });
      // ipc P0-2 fix: 接线 HealthMonitor 心跳 — 检测编辑器卡死(TCP OPEN 但主线程阻塞时 ping 超时 → 降级)。
      // 间隔 15s < 编辑器侧 INACTIVITY_TIMEOUT(30s), 避免边界竞争误杀; 心跳维持 activity 亦间接缓解长操作误杀(P0-3)。
      if (hm) {
        hm.startHeartbeat(
          () => (this.editorConn
            ? this.editorConn.request('ping', {}, { timeoutMs: 5000 })
                .then(() => { this._lastPingErrCode = undefined; return true; })
                .catch((err: unknown) => {
                  // B-T5: 保留 err.code 供 onStateChange 分流(旧实现毯式 catch `() => false` 丢 code)。
                  const e = err as { code?: string } | null | undefined;
                  this._lastPingErrCode = e?.code;
                  return false;
                })
            : Promise.resolve(false)),
        );
        // 2026-07-12 P0 控制回路接线 + B-T5 分流:
        // - REQUEST_TIMEOUT(TCP OPEN 主线程卡死)→ handleEditorStall 降级。WS 不 close, ws.on('close')→scheduleReconnect
        //   不触发,自动重连救不了;必须主动降级让用户用 headless 工作 + 手动 reconnect。
        // - NOT_CONNECTED/CONNECTION_LOST(下线/重启/瞬时不可达)→ 不降级,让 EditorConnection ws.close 已触发的
        //   scheduleReconnect(20 次退避)自动兜底。disconnect 会杀重连(reconnectEnabled=false),抢占致用户须手动 reconnect。
        //   重连成功后 addOnReconnectHandler 即时复位 hm;重连耗尽 reconnectExhausted handler 最终兜底降级。
        hm.onStateChange((_from, to) => {
          if (to === 'reconnecting' && this.connectionMode === 'editor') {
            if (this._lastPingErrCode === 'REQUEST_TIMEOUT') {
              getLogger().warn('godot-mcp', 'Heartbeat REQUEST_TIMEOUT (editor main thread blocked) — degrading to headless.');
              this.handleEditorStall();
            } else {
              getLogger().info('godot-mcp', `Heartbeat ${this._lastPingErrCode || 'unknown'} (editor down/refused) — letting auto-reconnect handle, not degrading.`);
            }
          }
        });
        // B6: 重建(rebuild)成功后 hm.state 可能残留 'reconnecting'(上次 stall 留下),
        // 首个心跳要等 heartbeatIntervalMs 才纠正——期间 onStateChange 不再触发降级但状态错。
        // 显式 setState('connected') 即刻复位。首次连接 hm 本就 connected,此处为 no-op。
        // B1 兼容：connected 态下工具失败(TOOL_ERROR)只进 degraded 不进 reconnecting,
        // 故此复位不会被 TOOL_ERROR 误触发再次降级。
        hm.setState('connected');
      }
      this.connectionMode = 'editor';
      this.dispatcher?.setConnectionMode('editor');
      return { connected: true, detail: `Connected to Godot plugin on port ${port}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.editorConn = null;
      return { connected: false, detail: `Editor connection failed: ${msg}` };
    }
  }

  /**
   * CMP-1 (2026-08-08): 校验 editor 连接对应的项目根与当前配置一致。
   * 发 editor_get_project_path RPC 读 editor 的 res:// 绝对路径,与 this.editorProjectPath
   * (resolveProjectPath 结果)归一化比对。mismatch → ok:false(调用方 disconnect + 降级)。
   * editorProjectPath=null(无 project.godot 上下文)→ 跳过校验(ok:true,不阻断)。
   */
  private async verifyEditorProject(): Promise<{ ok: boolean; expected?: string; actual?: string }> {
    if (this.editorProjectPath === null) {
      // 无期望路径(不在项目内 / resolveProjectPath 返 undefined)→ 无法对照,不阻断。
      return { ok: true };
    }
    if (!this.editorConn) {
      return { ok: false, expected: this.editorProjectPath, actual: '(no connection)' };
    }
    try {
      const resp = await this.editorConn.request('editor_get_project_path', {}, { timeoutMs: 5000 }) as Record<string, unknown> | null;
      const actual = String(resp?.project_path ?? '');
      if (!actual) {
        return { ok: false, expected: this.editorProjectPath, actual: '(empty)' };
      }
      if (normalizeForCompare(actual) !== normalizeForCompare(this.editorProjectPath)) {
        // NIT-3 (2026-08-08 第三方审查): 字面比对不等时,再做一次 realpath 归一化比對。
        // 防junction/symlink启动 editor 致两端返回不同表示(D:\projects vs C:\real\projects)。
        // safeRealPath 走 realpathSync(失败则 walk-up 找祖先解析),对存在的路径必成功。
        try {
          const realActual = safeRealPath(actual);
          const realExpected = safeRealPath(this.editorProjectPath);
          if (normalizeForCompare(realActual) === normalizeForCompare(realExpected)) {
            return { ok: true };
          }
        } catch { /* realpath 失败则用字面比对结果(保守拒绝) */ }
        return { ok: false, expected: this.editorProjectPath, actual };
      }
      return { ok: true };
    } catch (err) {
      // RPC 超时 / error → 保守拒绝(读不到 project_path 不应静默通过)。
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, expected: this.editorProjectPath, actual: `(unreadable: ${msg})` };
    }
  }

  /**
   * 方案B: editor 降级后(editorConn=null),manage_tools reconnect 触发重建连接。
   * 重新读 secret(editor 可能重启换密钥)+ establishEditorConnection。失败保持 headless(不 exit)。
   */
  private async rebuildEditorConnection(): Promise<{ connected: boolean; detail: string }> {
    if (this.editorPort === null || !this.editorProjectPath) {
      return { connected: false, detail: 'editor 连接信息丢失(未初始化),重启 MCP 服务端恢复' };
    }
    const secret = (await waitForEditorSecret(this.editorProjectPath, EDITOR_SECRET_TIMEOUT_MS)) ?? undefined;
    if (!secret) {
      return { connected: false, detail: '未找到 editor secret(插件未运行?),用 launch_editor / F5 启动编辑器后重试 reconnect' };
    }
    return this.establishEditorConnection(this.editorPort, secret);
  }

  /** 标记状态为脏，触发防抖刷盘。 */
  private markStateDirty(): void {
    if (!this.stateStore) return;
    this.stateStore.markDirty(() => ({
      version: 1,
      savedAt: Date.now(),
      agents: Object.fromEntries(
        this.agentCtx.getPersistableAgents()
          .map(([id, s]) => [id, {
            selectedInstance: s.selectedInstance,
            activeProfile: s.activeProfile,
            contextMeta: null,
          }]),
      ),
      globalProfile: 'full',
      lastConnectedPort: null,
    }));
  }

  async close(): Promise<void> {
    // P2: 整体 try/finally 兜底，finally 保证 server.close + 模块级引用清理必执行。
    // 各步骤虽多 best-effort，但 agentCtx.destroy()/server.close() 抛错会中断后续清理 →
    // 模块级引用残留（影响测试隔离与重启）。finally 用 serverClosed 标志防重复 close。
    let serverClosed = false;
    try {
      // P2-1: 自动卸载 overrides(graceful shutdown 时清理,防半装状态)。
      // 仅对已知项目路径卸载(editorProjectPath);headless 模式下项目路径不持久化,
      // agent 须手动调 uninstall_override action。
      if (this.options.overrides && this.options.overrides.length > 0 && this.editorProjectPath) {
        try {
          const { uninstallAllOverrides } = await import('./core/overrides.js');
          const n = uninstallAllOverrides(this.editorProjectPath);
          if (n > 0) getLogger().info('godot-mcp', `Auto-uninstalled ${n} overrides from ${this.editorProjectPath}`);
        } catch (err) {
          getLogger().warn('godot-mcp', `Override auto-uninstall failed (best effort): ${err instanceof Error ? err.message : err}`);
        }
      }
      // 报告②P0：先停周期扫描，防与下方 kill 逻辑竞争。
      if (this.orphanScanTimer) {
        clearInterval(this.orphanScanTimer);
        this.orphanScanTimer = null;
      }
      // 行225：停 MULTI_INSTANCE 接收端（HTTP server + 心跳 + 清 registry）。
      if (this.instanceHeartbeatTimer) {
        clearInterval(this.instanceHeartbeatTimer);
        this.instanceHeartbeatTimer = null;
      }
      if (this.httpReceiver) {
        try { await this.httpReceiver.stop(); } catch { /* best-effort */ }
        this.httpReceiver = null;
      }
      if (this.selfInstanceId) {
        const projectDir = ps.getProjectDir();
        const mgr = new InstanceManager({
          projectRegistryDir: projectDir
            ? join(projectDir, '.godot', 'mcp-instances')
            : undefined,
        });
        try { await mgr.unregisterSelf(this.selfInstanceId); } catch { /* best-effort */ }
        this.selfInstanceId = null;
      }
      if (this.editorConn) {
        this.editorConn.disconnect();
        this.editorConn = null;
        this.dispatcher?.setEditorExecutor(null);
        log('Editor connection closed');
      }
      const proc = ps.getRunningProcess();
      if (proc && !proc.killed) {
        await killProcess(proc);
        ps.setProcessBusy(false);
        ps.setRunningProcess(null);
        log('Running Godot process killed');
      }
      // B-T4: 清理 in-flight short-running gdscript spawn（gdscript-executor 注册）。
      // 原 close 只 kill run_project 长进程,挂起脚本 + close → 孤儿无兜底。
      // getSpawnedGodotPids 此时通常已空（exit/error/timeout 三路径均 unregister），
      // 仅异常路径（注册后 close 抢占 / forceKillTree 后 exit 未触发）残留 PID → best-effort kill。
      for (const pid of ps.getSpawnedGodotPids()) {
        try {
          ps.killPidTree(pid);
          ps.unregisterSpawnedGodotPid(pid);
        } catch { /* best-effort: 已退出 / killPidTree 内部吞错 */ }
      }
      // Clean up guard cleanup timer and pending tokens
      guard.cleanup();
      // Stop health monitor heartbeat
      this.dispatcher?.getHealthMonitor().stopHeartbeat();
      // 状态持久化 — 刷盘并清理
      if (this.stateStore) {
        await this.stateStore.flush();
        this.stateStore.destroy();
      }
      try { this.agentCtx.destroy(); } catch { /* best-effort: 不阻断 server.close + 引用清理 */ }
      await this.server.close();
      serverClosed = true;
    } finally {
      // 必执行：模块级引用清理（防测试隔离泄漏 / 重启残留）+ server.close 兜底
      if (!serverClosed) {
        try { await this.server.close(); } catch { /* best-effort: 已损坏或重复关闭 */ }
      }
      setOnGroupsChanged(null);
      setConnectionStatusProvider(null);
      setGetContextConnectionProvider(null);
      setEditorSceneProvider(null);
      setReconnectEditor(null);
      clearMcpServer();
      setLoggerServer(null);          // 批 P1: MCP Logging 干净关闭 + 测试隔离
      setLoggerClientReady(false);
      setProgressSender(null);
      setProgressClientReady(false);
      setElicitServer(null);
      setAllowedRootsFromClient(null);  // 批 P0: 回落 env，干净关闭 + 测试隔离
      // 架构修复 P0-2: 补齐 tools 侧模块级引用清理(close 原本漏清这 5 个,
      // 致 instance-tools/advanced-proxy/game-bridge 持有上一 server 闭包 → 测试隔离泄漏 / 热重启残留)
      setInstanceManager(null);
      setInstanceRouter(null);
      setDynamicSender(null);
      setToolCallDelegate(null);
      setBridgeProjectDir(null);
      log('Server shut down');
    }
  }
}

/**
 * CMP-1 (2026-08-08): 路径归一化用于跨端比对(editor 返回的 res:// 绝对路径 vs resolveProjectPath 结果)。
 * 反斜杠→正斜杠;去尾部分隔符;Windows 下 lowerCase(盘符大小写不敏感);Linux/macOS 保留大小写。
 */
function normalizeForCompare(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') s = s.toLowerCase();
  return s;
}

/**
 * CMP-16-B (2026-08-08): 拉取动态工具(live schema)并注册到 tool-registry,返回要 merge 进 tools/list 的工具列表。
 *
 * 流程:
 * 1. 设置静态工具名集合(冲突检测:动态工具名撞静态工具名则跳过)
 * 2. 拉取动态工具(dynamicSchema.getDynamicTools,带缓存+降级)
 * 3. 注册到 tool-registry(registerDynamicTools,让 isToolAllowed 放行)
 * 4. 返回工具列表(调用方 merge 进 tools/list)
 *
 * editor 离线时返回空数组(降级,只留 godot_advanced_tool 兜底代理)。
 */
async function mergeDynamicTools(staticTools: Tool[]): Promise<Tool[]> {
  // 静态工具名集合(含 inline 工具如 confirm_and_execute + 所有注册工具)
  const staticNames = new Set<string>(staticTools.map(t => t.name));
  for (const name of getAllToolNames()) {
    staticNames.add(name);
  }
  dynamicSchema.setStaticToolNames(staticNames);

  // 拉取动态工具(带缓存;editor 离线返空)
  const dynamicTools = await dynamicSchema.getDynamicTools();

  // 注册到 tool-registry(让 isToolAllowed 在 dynamic 组激活时放行)
  registerDynamicTools(dynamicTools.map(t => t.name));

  return dynamicTools;
}

