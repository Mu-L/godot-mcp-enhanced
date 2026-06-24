import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { join } from 'path';
import { waitForEditorSecret } from './core/editor-auth.js';
import {
  listResources as listMcpResources,
  listResourceTemplates as listMcpResourceTemplates,
  readResource as readMcpResource,
} from './resources.js';
import { listPrompts, getPrompt } from './prompts.js';

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
import { InstanceManager } from './core/instance-manager.js';
import { InstanceRouter, type RouterDependencies } from './core/instance-router.js';
import { setInstanceManager, setInstanceRouter } from './tools/instance-tools.js';
import { buildAuthHeaders } from './core/instance-api-auth.js';
import { isFeatureEnabled } from './core/feature-flags.js';
import * as ps from './core/process-state.js';
import { killProcess } from './core/process-state.js';
import { getLogger } from './core/logger.js';
import { resolveProjectPath } from './core/path-utils.js';
import { AgentContextManager } from './core/agent-context.js';
import { FileStateStore } from './core/state-store.js';

// Re-export for backward compatibility (tests import from GodotServer)
export { clearGodotPathCache, getCachedGodotPath };

const DEBUG = process.env.DEBUG === 'true';
const EDITOR_SECRET_TIMEOUT_MS = 5000;

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
  // 方案B: 供 rebuildEditorConnection() 重建降级后的 editor 连接(port 存实例,secret 重建时重读)
  private editorPort: number | null = null;
  private editorProjectPath: string | null = null;
  private noFallback: boolean;
  private agentCtx: AgentContextManager;
  private stateStore: FileStateStore | null = null;

  constructor(opsScript: string, options: ServerOptions = {}) {
    this.opsScript = opsScript;
    this.options = options;
    this.readOnlyGuard = new ReadOnlyGuard(options.readOnly ?? false);
    this.connectionMode = options.connectionMode ?? 'headless';
    this.noFallback = options.noFallback ?? false;
    this.agentCtx = new AgentContextManager();
    this.server = new Server(
      { name: 'godot-mcp-enhanced', version: pkgVersion },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );
    setMcpServer(this.server);
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

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: dispatcher.getFilteredTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, (request) =>
      dispatcher.handleCall(request)
    );

    // ── MCP Resources handlers ──────────────────────────────────────────────
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const projectPath = resolveProjectPath();
      const resources = listMcpResources(projectPath);
      return { resources };
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const templates = listMcpResourceTemplates();
      return { resourceTemplates: templates };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const projectPath = resolveProjectPath();
      const content = await readMcpResource(uri, projectPath);
      return { contents: [content] };
    });

    // Connect manage-tools notification callback
    setOnGroupsChanged(() => this.sendToolListChanged());
    setConnectionStatusProvider(() => buildConnectionStatus(this.editorConn, this.dispatcher?.getHealthMonitor() ?? null));
    setReconnectEditor(buildReconnectEditor(
      () => this.editorConn,
      () => this.rebuildEditorConnection(), // 方案B: editor 降级后重建连接(重读 secret + new EditorConnection)
    ));

    // ── MCP Prompts handlers (Phase 5b) ────────────────────────────────────────
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: listPrompts(),
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: promptArgs } = request.params;
      return getPrompt(name, (promptArgs ?? {}) as Record<string, string>);
    });

    // Phase 2b: Multi-instance initialization moved to initMultiInstance() (async fs)
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

    // 状态持久化 — 加载已保存的 agent 状态
    const projectPath = resolveProjectPath();
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
    setImmediate(() => {
      try {
        const maybePromise = this.server.notification({
          method: 'notifications/message',
          params: {
            level: 'info',
            data: '[Godot MCP] Project context available at godot://project-context. Read it for coding guidelines and architecture notes.',
          },
        });
        // Handle both sync and async notification returns
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
    this.editorConn = new EditorConnection({ port, reconnect: true, secret });
    try {
      await this.editorConn.connect();
      this.editorExecutor = new EditorToolExecutor(this.editorConn);
      this.dispatcher?.setEditorExecutor(this.editorExecutor);
      this.editorConn.addOnReconnectExhaustedHandler(() => {
        getLogger().warn('godot-mcp', 'Editor reconnect attempts exhausted — degrading to headless mode.');
        this.dispatcher?.markEditorFallback();
        this.connectionMode = 'headless';
        // I-04: atomic degradeToHeadless() 避免 two separate _pendingModeSwitch writes racing
        this.dispatcher?.degradeToHeadless();
        this.editorConn = null;
      });
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
    // Clean up guard cleanup timer and pending tokens
    guard.cleanup();
    // Stop health monitor heartbeat
    this.dispatcher?.getHealthMonitor().stopHeartbeat();
    // 状态持久化 — 刷盘并清理
    if (this.stateStore) {
      await this.stateStore.flush();
      this.stateStore.destroy();
    }
    this.agentCtx.destroy();
    await this.server.close();
    setOnGroupsChanged(null);
    setConnectionStatusProvider(null);
    setReconnectEditor(null);
    clearMcpServer();
    log('Server shut down');
  }
}
