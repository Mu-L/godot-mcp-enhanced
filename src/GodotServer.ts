import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { Server } from "@modelcontextprotocol/server";

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
import * as guard from './guard.js';
import { EditorConnection } from './core/EditorConnection.js';
import { EditorToolExecutor } from './core/EditorToolExecutor.js';
import { findGodot, clearGodotPathCache, getCachedGodotPath } from './core/godot-finder.js';
import { setOnGroupsChanged, setConnectionStatusProvider, setReconnectEditor, buildConnectionStatus, buildReconnectEditor } from './tools/manage-tools.js';
import { setGetContextConnectionProvider, setEditorSceneProvider } from './tools/get-context.js';
import { InstanceManager } from './core/instance-manager.js';
import { InstanceRouter, type RouterDependencies } from './core/instance-router.js';
import { setInstanceManager, setInstanceRouter } from './tools/instance-tools.js';
import { buildAuthHeaders } from './core/instance-api-auth.js';
import { isFeatureEnabled } from './core/feature-flags.js';
import * as ps from './core/process-state.js';
import { killProcess } from './core/process-state.js';
import { getLogger, setLoggerServer, setLoggerClientReady } from './core/logger.js';
import { setProgressSender, setProgressClientReady } from './core/progress.js';
import { setElicitServer } from './core/elicit.js';
import { resolveProjectPath } from './core/path-utils.js';
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
}

export class GodotServer {
  private server: Server;
  private opsScript: string;
  private options: ServerOptions;
  private readOnlyGuard: ReadOnlyGuard;
  private dispatcher: ToolDispatcher | null = null;
  private editorConn: EditorConnection | null = null;
  private editorExecutor: EditorToolExecutor | null = null;
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
      mode: this.options.mode ?? 'full',
      readOnlyGuard: this.readOnlyGuard,
      connectionMode: this.connectionMode,
      noFallback: this.noFallback,
      opsScript: this.opsScript,
      findGodot,
      toolCallDelegate: setToolCallDelegate,
      agentContext: this.agentCtx,
    });
    this.dispatcher = dispatcher;

    this.server.setRequestHandler('tools/list', async () => ({
      tools: dispatcher.getFilteredTools(),
    }));

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

  /** Phase 2b: Multi-instance initialization (async fs — C-02). */
  private async initMultiInstance(): Promise<void> {
    if (!isFeatureEnabled('MULTI_INSTANCE')) return;
    // IMPORTANT-4 (review): MULTI_INSTANCE 的 HMAC 认证(instance-api-auth.ts)当前是发送端 only —
    // generateApiToken 发签名,但 TS server 不启动 HTTP 接收端,verifyApiToken 零生产调用。
    // 即发送的 HMAC 签名不被验证,任何能访问 127.0.0.1:<port> 的本地进程可调 /api/<tool>。
    // 接线 verifyApiToken 前请勿视为端到端认证。详见 instance-api-auth.ts 注释。
    console.warn('[MCP] MULTI_INSTANCE enabled: HMAC auth is send-side only (verifyApiToken not wired to any HTTP server). Do NOT treat as end-to-end authentication.');
    const projectDir = ps.getProjectDir();
    const manager = new InstanceManager({
      projectRegistryDir: projectDir
        ? join(projectDir, '.godot', 'mcp-instances')
        : undefined,
    });
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
    // 默认只跑第一层（毫秒级、安全）；不 await 避免拖慢启动。
    if (isFeatureEnabled('STARTUP_CLEANUP') && projectPath) {
      void ps.killOrphanGodotProcesses(projectPath).catch(() => { /* best-effort */ });
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
  }

  /**
   * 建立 editor 连接:new EditorConnection + connect + executor 接线 + 挂降级 handler。
   * 成功 → connectionMode='editor' + setConnectionMode('editor');失败 → 清理 editorConn,返回 {connected:false}。
   * 不含 noFallback exit / headless 降级(那是 run() 初始化语义);rebuild 复用此方法(失败不 exit,保持 headless)。
   * I-04: 降级用专用 reconnectExhausted handler(非 disconnect handler——后者每次 ws.close 触发会过早降级)。
   */
  private async establishEditorConnection(port: number, secret: string): Promise<{ connected: boolean; detail: string }> {
    // 清理旧连接(rebuild 场景:降级后可能有残留或并发重建)
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
      // B-T3: hm 提前到 EditorToolExecutor 构造前复用，注入 _executeInner 半开 HOL 预检
      // （reconnecting 时即时返 NOT_CONNECTED，跳过 30s conn.request 等待，避免串行 executeChain ×30s 放大）。
      const hm = this.dispatcher?.getHealthMonitor();
      this.editorExecutor = new EditorToolExecutor(this.editorConn, hm);
      this.dispatcher?.setEditorExecutor(this.editorExecutor);
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
    // 模块级单例引用残留（影响测试隔离与重启）。finally 用 serverClosed 标志防重复 close。
    let serverClosed = false;
    try {
      // 报告②P0：先停周期扫描，防与下方 kill 逻辑竞争。
      if (this.orphanScanTimer) {
        clearInterval(this.orphanScanTimer);
        this.orphanScanTimer = null;
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
      log('Server shut down');
    }
  }
}
