// src/core/ToolDispatcher.ts
import type { ToolResult, ToolContext, DispatchContext, Middleware, ToolCallDelegate } from '../types.js';
import type { ChildProcess } from 'child_process';
import type { ReadOnlyGuard } from './ReadOnlyGuard.js';
import type { EditorToolExecutor } from './EditorToolExecutor.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeMiddleware, createRateLimitMiddleware, createElicitationMiddleware } from './middleware.js';
import { createElicitFn, type ElicitFn } from './elicit.js';
import { getCallRecorder, extractErrorMessage } from './call-recorder.js';
import { HealthMonitor } from './health-monitor.js';
import { isFeatureEnabled } from './feature-flags.js';
import {
  requiresConfirmation,
  createPendingToken,
  consumeToken,
  TOKEN_TTL_MS,
} from '../guard.js';
import {
  getAllToolDefinitions,
  getModuleForTool,
  getToolDefinition,
  isToolAllowed,
  LITE_TOOLS,
  MINIMAL_TOOLS,
  registerInlineTool,
  resolveProfile,
  skipProjectPath,
  tryLegacyMapping,
} from './tool-registry.js';
import { validateArgs } from './args-validator.js';
import { isPathInAllowedRoots, parseGodotConfig } from '../helpers.js';
import { opsErrorResult, COMMON_ERROR_CODES } from '../tools/shared.js';
import { truncateResponse } from './response-limiter.js';
import * as ps from './process-state.js';
import { getLogger } from './logger.js';
import { resolveProjectPath } from './path-utils.js';
import type { AgentContextManager } from './agent-context.js';
import { createProgressEmitter, type ProgressEmitter, type ProgressToken } from './progress.js';

/** Known profile names for IDE autocomplete. Unknown strings fall through to resolveProfile(). */
type KnownProfile = 'full' | 'lite' | 'minimal' | 'bridge_dev' | '3d_dev';

const DEBUG = process.env.DEBUG === 'true';
function log(...args: unknown[]): void {
  if (DEBUG) getLogger().debug('dispatcher', args.map(a => String(a)).join(' '));
}

export interface DispatcherOptions {
  // 模式控制
  readOnly: boolean;
  mode: KnownProfile | string;  // 'full' | 'lite' | 'minimal' | profile name | comma-separated groups
  connectionMode: 'headless' | 'editor';
  noFallback: boolean;

  // 依赖注入
  readOnlyGuard: ReadOnlyGuard;
  editorExecutor?: EditorToolExecutor;
  opsScript: string;
  findGodot: (projectPath?: string) => Promise<string>;
  toolCallDelegate: (fn: ToolCallDelegate | null) => void;
  agentContext?: AgentContextManager;
  /** CRITICAL(2026-07-13 安全): out-of-band 用户确认函数(堵 AI 自确认 token)。默认 createElicitFn()。 */
  elicitFn?: ElicitFn;
}

export class ToolDispatcher {
  private readonly options: DispatcherOptions;
  private readonly readOnlyGuard: ReadOnlyGuard;
  private connectionMode: 'headless' | 'editor';
  private editorExecutor: EditorToolExecutor | null;
  private readonly ctx: ToolContext;
  private _editorFallback = false;
  private _editorFallbackWarned = false;
  private healthMonitor: HealthMonitor;
  private readonly middleware: Middleware[];

  /** CRITICAL(2026-07-13 安全): out-of-band elicitation — confirm_and_execute 强制用户确认(堵 AI 自确认)。 */
  private readonly elicitFn: ElicitFn;

  /** Deferred mode switch — applied at the start of the next handleCall. Prevents
   *  editor disconnect callbacks from switching mode mid-request (C-01). */
  private _pendingModeSwitch: { mode: 'headless' | 'editor'; executor: EditorToolExecutor | null } | null = null;

  constructor(options: DispatcherOptions) {
    this.options = options;
    this.readOnlyGuard = options.readOnlyGuard;
    this.connectionMode = options.connectionMode;
    this.editorExecutor = options.editorExecutor ?? null;
    this.elicitFn = options.elicitFn ?? createElicitFn();

    // 构建 ctx — 直接 import process-state（内部实现细节）
    this.ctx = {
      opsScript: options.opsScript,
      findGodot: options.findGodot,
      get runningProcess() { return ps.getRunningProcess(); },
      setRunningProcess(proc: ChildProcess | null, skipBusyCheck?: boolean) { ps.setRunningProcess(proc, skipBusyCheck); },
      get outputBuffer() { return ps.getOutputBuffer(); },
      setOutputBuffer(buf: string[]) { ps.setOutputBuffer(buf); },
      get processStartTime() { return ps.getProcessStartTime(); },
      setProcessStartTime(t: number) { ps.setProcessStartTime(t); },
      get projectDir() { return ps.getProjectDir(); },
      setProjectDir(d: string) { ps.setProjectDir(d); },
      parseGodotConfig,
    };

    // 注册内联工具的元数据（confirm_and_execute 不属于任何 ToolModule）
    registerInlineTool('confirm_and_execute', { readonly: true, long_running: false });

    // Health monitor for middleware pipeline
    this.healthMonitor = new HealthMonitor({ heartbeatIntervalMs: 15_000 });  // ipc P0-2: 心跳 15s < 编辑器侧 INACTIVITY_TIMEOUT(30s), 避免边界竞争误杀
    this.middleware = this.buildMiddleware();

    // Phase 3a: Wire proxy delegate through handleCall for full middleware chain
    // (ReadOnlyGuard, path validation, confirmation tokens, etc.)
    this.options.toolCallDelegate(async (targetTool, toolArgs) => {
      // Recursion guard: proxy must not delegate to itself
      if (targetTool === 'godot_advanced_tool') {
        return opsErrorResult('PROXY_RECURSION', 'Cannot proxy godot_advanced_tool through itself');
      }
      return this.handleCall({ params: { name: targetTool, arguments: toolArgs } });
    });
  }

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  getFilteredTools(): Tool[] {
    let allTools = getAllToolDefinitions();

    // 内联工具: confirm_and_execute
    allTools.push({
      name: 'confirm_and_execute',
      description: 'Execute a previously blocked tool using a confirmation token. Use this when a tool returns a confirmation_token.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          token: { type: 'string', description: 'Confirmation token from the blocked tool response' },
        },
        required: ['token'],
      },
    });

    // READ_ONLY_MODE 过滤
    if (this.options.readOnly) {
      allTools = allTools.filter(t => !this.readOnlyGuard.check(t.name).blocked);
      log('READ_ONLY_MODE: %d tools available', allTools.length);
    }

    // LITE / MINIMAL / PROFILE 模式过滤
    if (this.options.mode === 'lite') {
      allTools = allTools.filter(t => LITE_TOOLS.has(t.name));
      log('LITE mode: %d tools available', allTools.length);
    } else if (this.options.mode === 'minimal') {
      allTools = allTools.filter(t => MINIMAL_TOOLS.has(t.name));
      log('MINIMAL mode: %d tools available', allTools.length);
    } else if (this.options.mode !== 'full') {
      // Profile mode: resolve profile name or comma-separated groups
      const profileTools = resolveProfile(this.options.mode);
      if (profileTools.size > 0) {
        allTools = allTools.filter(t => profileTools.has(t.name));
        log('PROFILE mode (%s): %d tools available', this.options.mode, allTools.length);
      } else {
        // R2 slim-profile-silent-full-fallback: 未知/拼写错 profile 解析空集时 fail-closed 回退 minimal(非 full),
        // 防 --profile=slim 等配置失效时静默暴露全部写/执行工具(违反最小权限 + fail-open)。
        getLogger().warn('dispatcher', `Profile "${String(this.options.mode)}" resolved to empty set — failing closed to MINIMAL. Check for typos.`);
        allTools = allTools.filter(t => MINIMAL_TOOLS.has(t.name));
      }
    }

    // slim mode: ensure proxy tool is always present (it belongs to core group,
    // but guard against edge cases where filtering might exclude it)
    if (this.options.mode === 'slim') {
      const hasProxy = allTools.some(t => t.name === 'godot_advanced_tool');
      if (!hasProxy) {
        allTools.push(...getAllToolDefinitions().filter(t => t.name === 'godot_advanced_tool'));
      }
    }

    // activeGroups 过滤（Phase 1 动态管理）。A-3(审查): 改用 flag 系统(原直接读 env 绕过 isFeatureEnabled)
    if (isFeatureEnabled('TOOL_GROUPS')) {
      allTools = allTools.filter(t => isToolAllowed(t.name));
      log('activeGroups filter: %d tools available', allTools.length);
    }

    return allTools;
  }

  async handleCall(request: { params: { name: string; arguments?: Record<string, unknown> } }): Promise<ToolResult> {
    // Apply deferred mode switch before processing
    this._applyPendingModeSwitch();

    const { name, arguments: rawArgs } = request.params;
    const startTime = Date.now();
    let args: Record<string, unknown> = {};
    try {
      args = this.normalizeArgs(rawArgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('normalizeArgs error:', name, msg);
      return opsErrorResult('TOOL_ERROR', `Argument normalization failed: ${msg}`);
    }

    // 从 _meta 中提取 agent 身份标识
    // 注意：agentId / agent_id 是对未文档化客户端行为的假设——MCP 规范未定义
    // tools/call._meta 中的 caller 身份字段，主流客户端亦未承诺注入。
    // 跟踪 anthropics/claude-code#32514；落地前此值通常为 undefined（多 Agent 路径不可用）。
    const meta = (request as { params?: { _meta?: Record<string, unknown> } }).params?._meta;
    const agentId = (meta?.agentId ?? meta?.agent_id) as string | undefined;
    if (this.options.agentContext) {
      this.options.agentContext.getOrCreate(agentId);
    }
    // Task 3: 提取 progressToken → 创建 per-request emitter（C-CONC-1：局部变量，照抄 findGodotOverride 透传）
    const progressToken = meta?.progressToken as ProgressToken | undefined;
    const progressEmitter: ProgressEmitter | undefined =
      progressToken !== undefined ? createProgressEmitter(progressToken) : undefined;

    const ctx: DispatchContext = { toolName: name, args, startTime, phase: 'before' };

    return executeMiddleware(this.middleware, ctx, async () => {
      return this.executeToolCall(name, args, startTime, progressEmitter);
    });
  }

  private async executeToolCall(name: string, args: Record<string, unknown>, startTime: number, progressEmitter?: ProgressEmitter): Promise<ToolResult> {
    // Snapshot current mode + executor for consistent routing throughout this call
    const currentMode = this.connectionMode;
    const currentExecutor = this.editorExecutor;

    try {
      // ── 0.5. Default project_path injection ──
      // issue #11: list_projects/list_templates 是搜索/列表语义,不需 project_path。
      // skipProjectPath 按工具名(无法区分 project 工具的 action),故此处 action 级豁免。
      if (!args.project_path && !skipProjectPath(name) && !(name === 'project' && (args.action === 'list_projects' || args.action === 'list_templates'))) {
        const resolved = resolveProjectPath();
        if (!resolved) {
          return opsErrorResult(
            COMMON_ERROR_CODES.INVALID_PARAMS,
            'project_path is required but not provided, and no default could be resolved. ' +
            'Set GODOT_PROJECT_PATH env var, run from a Godot project directory, or pass project_path explicitly.',
          );
        }
        args.project_path = resolved;
      }

      // ── 0.6. Project-aware findGodot injection ──
      // C-CONC-1: findGodot override 作为局部变量,沿调用链显式传入 dispatchTool。
      // 不能用实例字段 — MCP SDK 经 Promise.resolve().then(handler) 异步派发多个 tools/call,
      // 请求并发执行,实例字段会被互相覆盖(旧注释"MCP serializes so no race"为错误前提)。
      // CR-2: confirm_and_execute 分支须基于 pending.args(原始工具 args)重算,而非
      // confirm_and_execute 自身 args(只有 token)—— 见该分支内 resolveFindGodotOverride 调用。
      const { override: findGodotOverride, error: findGodotErr } = await this.resolveFindGodotOverride(args);
      if (findGodotErr) return findGodotErr;

      // ── 0. Common arg type validation ──
      const typeErr = this.validateCommonArgs(args);
      if (typeErr) return typeErr;

      // ── 0.x Schema validation (args vs inputSchema) ──
      // spec §3:normalizeArgs 后 args key 已 snake_case,与 inputSchema 一致。
      // inline tool(confirm_and_execute)getToolDefinition 返 undefined → 跳过;godot_advanced_tool 实为完整 ToolModule(advanced-proxy),正常走 validateArgs(inputSchema 宽松:tool_name required / arguments 可选)。
      const schemaDef = getToolDefinition(name);
      if (schemaDef?.inputSchema) {
        const { ok, errors } = validateArgs(args, schemaDef.inputSchema);
        if (!ok) {
          return opsErrorResult(
            COMMON_ERROR_CODES.INVALID_PARAMS,
            `参数校验失败: ${errors.join('; ')}`,
          );
        }
      }

      // ── 1. ReadOnlyGuard ──
      const guardResult = this.readOnlyGuard.check(name);
      if (guardResult.blocked) {
        return opsErrorResult(String(guardResult.errorCode ?? 'READ_ONLY'), guardResult.message ?? 'Operation blocked in read-only mode');
      }

      // ── 1.5. Path allowlist validation (all modes) ──
      const pathErr = this.validatePathArgs(args);
      if (pathErr) return pathErr;

      // ── 2. confirm_and_execute 分支 ──
      if (name === 'confirm_and_execute') {
        const token = args.token as string;
        if (!token || typeof token !== 'string') {
          return opsErrorResult('MISSING_TOKEN', 'confirmation_token is required');
        }
        const pending = consumeToken(token);
        if (!pending) {
          return opsErrorResult('INVALID_TOKEN', 'Invalid or expired confirmation token');
        }

        // I-07: Refuse execution if args were truncated — the code/data would be incomplete
        if (pending.wasTruncated) {
          return opsErrorResult('ARGS_TRUNCATED',
            `Confirmation token args were truncated (exceeded 10KB limit). ` +
            `Please call the original tool again — the server will re-generate a fresh token with the full args.`);
        }

        // CRITICAL(2026-07-13 安全 P0): out-of-band 用户确认 — 堵 AI 自读自确认 token。
        // confirm_and_execute 由 AI in-band 调用,token 在原工具返回值明文回传 AI,故 consumeToken
        // 只验 token 值无法区分 AI 自确认 vs 用户授权(单客户端下 caller/session 绑定无效:AI 产生
        // 与消费 token 同 session)。此处经 MCP elicitInput(server→client→user UI) 请求用户
        // out-of-band 确认,AI 无法伪造响应(非其 tools/call 通道)。elicitFn 返回 null(client 不支持
        // elicitation / decline / cancel / throw)或 confirm!==true 一律拒绝 — 强制 out-of-band,
        // 无降级(审查威胁模型拒绝本地可信,堵 AI 自确认优先于兼容不支持 elicitation 的 client)。
        // I-1(security review): 消息含 args 预览(>500 字截断),让用户知情确认而非盲批
        // (防 AI 构造恶意 args 如删关键节点/写恶意 class_name — 07-12 RCE 复合链场景)。
        const argsJson = JSON.stringify(pending.args);
        const argsPreview = argsJson.length > 500 ? argsJson.slice(0, 500) + '...(截断)' : argsJson;
        const consent = await this.elicitFn(
          { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] },
          `确认执行 "${pending.toolName}" (action: ${String(pending.args.action ?? 'n/a')})?\n参数摘要: ${argsPreview}\n此操作经 confirm_and_execute,需用户 out-of-band 确认(防 AI 自确认)。拒绝请点 cancel/decline。`,
        );
        if (!consent || consent.confirm !== true) {
          // I-2(security review): opt-in 降级 — 不支持 elicitation 的 client(简单 CLI/CI/自动化)
          // 显式设 GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true 时跳过 gate 走旧 token 路径(token 已
          // consumeToken 验证)。默认 fail-closed(堵 AI 自确认)。降级记 console.warn 审计。
          // 与仓库 GODOT_MCP_UNRESTRICTED/BRIDGE_PERSISTENT_SECRET/BRIDGE_EXTRA_METHODS 惯例一致。
          if (process.env.GODOT_MCP_ALLOW_UNSAFE_CONFIRM === 'true') {
            console.warn(`[SECURITY] GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true — confirm_and_execute 降级跳过 elicitation (token:${String(token).slice(0, 8)} tool:${pending.toolName})。仅可信本地/CI,生产保持默认未设。`);
          } else {
            return opsErrorResult('ELICITATION_DENIED',
              `执行 "${pending.toolName}" 需用户经 elicitation out-of-band 确认。Elicitation 被 decline/cancel/不支持或返回非确认,中止(堵 AI 自确认)。可信环境可设 GODOT_MCP_ALLOW_UNSAFE_CONFIRM=true 降级。`);
          }
        }

        // 二次 guard 检查
        const confirmedGuardResult = this.readOnlyGuard.check(pending.toolName);
        if (confirmedGuardResult.blocked) {
          return opsErrorResult(String(confirmedGuardResult.errorCode ?? 'READ_ONLY'), confirmedGuardResult.message ?? 'Operation blocked in read-only mode');
        }

        // 二次路径校验（pending.args 可能包含与外层 args 不同的 project_path）
        const confirmedPathErr = this.validatePathArgs(pending.args);
        if (confirmedPathErr) return confirmedPathErr;

        // CR-2: 基于 pending.args(原始工具 args)重新计算 findGodotOverride,而非复用入口处
        // 基于 confirm_and_execute 自身 args(只有 token)算出的 override。godot_path 校验
        // 在产生 token 的那次调用里已执行过(第 229-234 行),token 有 3min TTL + 单次消费
        // + 服务端生成,客户端无法伪造,故此处无需重新 validateGodotBinary。
        const { override: confirmedFindGodotOverride, error: confirmedFindGodotErr } =
          await this.resolveFindGodotOverride(pending.args);
        if (confirmedFindGodotErr) return confirmedFindGodotErr;

        // 复用同一 editor/headless 分支逻辑
        log('[CONFIRM] Executing confirmed tool: %s', pending.toolName);
        if (currentMode === 'editor' && currentExecutor) {
          const logger = getLogger();
          const confirmCallId = logger.toolStart(pending.toolName, pending.args);
          const editorResult = await currentExecutor.execute(pending.toolName, pending.args);
          // P1-1b (2026-07-11): confirm 路径同样检测 -32601 回退（与下方普通 dispatch 的
          // _isUnknownMethod 分支对齐）。confirm_and_execute 经 confirm 的写工具（scene
          // add_node/edit_node/remove_node 等未登记 editor-method-map 的）editor 转发
          // command_handler 命中兜底 -32601，此前 confirm 分支直接返回 editorResult 致无回退
          // headless（bug：scene editor -32601 失效）。检测到 -32601 则回退 dispatchTool 走文件/headless 路径。
          if (editorResult.isError === true && this._isUnknownMethod(editorResult)) {
            logger.toolEnd(confirmCallId, pending.toolName, Date.now() - startTime, 'editor_unknown_method_fallback');
            return this.attachFallbackWarning(await this.dispatchTool(pending.toolName, pending.args, startTime, confirmedFindGodotOverride, progressEmitter));
          }
          const duration = Date.now() - startTime;
          logger.toolEnd(confirmCallId, pending.toolName, duration);
          // I-08: Only append _duration_ms if the editor plugin didn't already include it
          const hasDuration = editorResult.content?.some((c: { type?: string; text?: string }) =>
            typeof c.text === 'string' && c.text.startsWith('_duration_ms:'));
          const content = hasDuration
            ? editorResult.content
            : [...editorResult.content, { type: 'text' as const, text: `_duration_ms: ${duration}` }];
          return this.attachFallbackWarning(truncateResponse({ ...editorResult, content }));
        }
        return this.attachFallbackWarning(await this.dispatchTool(pending.toolName, pending.args, startTime, confirmedFindGodotOverride, progressEmitter));
      }

      // ── 3. 确认令牌检查（IMP-6: 前置 legacy 映射，防 legacy name 如 remove_node 绕过 guard）──
      const legacyMap = tryLegacyMapping(name);
      const guardName = legacyMap?.tool ?? name;
      const guardArgs = legacyMap ? { ...args, action: legacyMap.action } : args;
      if (requiresConfirmation(guardName, guardArgs)) {
        const token = createPendingToken(name, args);  // 原始 name/args(confirm_and_execute 执行用)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              requires_confirmation: true,
              tool: name,
              confirmation_token: token,
              message: `Tool "${name}" requires confirmation. Call confirm_and_execute with this token to proceed.`,
              ttl_seconds: TOKEN_TTL_MS / 1000,
            }),
          }],
        };
      }

      // ── 4. editor 模式 dispatch ──
      if (currentMode === 'editor' && currentExecutor) {
        const logger = getLogger();
        const callId = logger.toolStart(name, args);
        const editorResult = await currentExecutor.execute(name, args);
        // P1-1 (2026-07-06 review): editor 模式盲目路由 — command_handler 只认扁平 method
        // (add_node/open_scene/...), TS 工具是 (tool,action) 命名(script/screenshot/project/...),
        // 转发后落到 -32601 Unknown method 静默失效。检测到 -32601 自动回退 headless dispatchTool,
        // 让非编辑器原生工具在 editor 模式仍可用; 编辑器认的工具照常走 editor(保留 undo/sync)。
        // isError 前置：只在 editor 报错时才检测 -32601，避免未来 plugin 成功响应顶层带数字 code
        // 被误判为 unknown method 触发静默降级 headless（见 ToolDispatcher.test「isError guard」负面用例）。
        if (editorResult.isError === true && this._isUnknownMethod(editorResult)) {
          logger.toolEnd(callId, name, Date.now() - startTime, 'editor_unknown_method_fallback');
          return this.attachFallbackWarning(await this.dispatchTool(name, args, startTime, findGodotOverride, progressEmitter));
        }
        const duration = Date.now() - startTime;
        logger.toolEnd(callId, name, duration);
        // I-08: Only append _duration_ms if the editor plugin didn't already include it
        const hasDuration = editorResult.content?.some((c: { type?: string; text?: string }) =>
          typeof c.text === 'string' && c.text.startsWith('_duration_ms:'));
        const content = hasDuration
          ? editorResult.content
          : [...editorResult.content, { type: 'text' as const, text: `_duration_ms: ${duration}` }];
        return this.attachFallbackWarning(truncateResponse({ ...editorResult, content }));
      }

      // ── 5. headless dispatch ──
      // CR-1: 必须传入 findGodotOverride,否则 perCallCtx 回退到 this.ctx.findGodot,
      // 导致 godot_path 参数和项目感知 findGodot 在最常用路径失效。
      return this.attachFallbackWarning(await this.dispatchTool(name, args, startTime, findGodotOverride, progressEmitter));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('Tool error:', name, msg);
      return opsErrorResult('TOOL_ERROR', msg);
    }
  }

  private buildMiddleware(): Middleware[] {
    const mw: Middleware[] = [];

    // Health sample middleware (after hook — runs on both success and failure)
    mw.push({
      name: 'healthSample',
      before: async () => ({ passed: true }),
      after: async (ctx, result) => {
        const duration = Date.now() - ctx.startTime;
        const isError = result.isError === true || this.checkJsonSuccessFalse(result);
        const recorder = getCallRecorder();
        if (isError) {
          this.healthMonitor.recordFailure('TOOL_ERROR', `Tool ${ctx.toolName} failed`);
          recorder.record(ctx.toolName, false, duration, 'TOOL_ERROR', extractErrorMessage(result));
        } else {
          this.healthMonitor.recordSuccess(duration);
          recorder.record(ctx.toolName, true, duration);
        }
        return result;
      },
    });

    // IMPORTANT-5: 全局 rate limit(防 AI 失控循环耗尽资源)。默认 60 次/秒软限。
    mw.push(createRateLimitMiddleware());

    // B2: 接线 elicitation 强制顶层 required 校验。elicitFn=createElicitFn()(GodotServer
    //     注入 server 后经 MCP elicitInput 协议问用户;未注入时降级纯 required 强制→
    //     顶层 required 缺失返回 MISSING_PARAM)。补 validateCommonArgs 漏检的 action 键
    //     完全缺失 + 为新增工具提供 required 兜底。条件分支 required (oneOf/anyOf)不在此
    //     校验,仍由各工具 handler 自行处理。
    mw.push(createElicitationMiddleware(
      (name: string) => getAllToolDefinitions().find(t => t.name === name) ?? null,
      createElicitFn(),
    ));

    return mw;
  }

  /** Schedule a connection mode change. Applied at the start of the next handleCall
   *  to prevent mid-request mode switches from editor disconnect callbacks (C-01). */
  setConnectionMode(mode: 'headless' | 'editor'): void {
    this._pendingModeSwitch = { mode, executor: this._resolvePendingExecutor() };
  }

  /** Schedule an executor change. Destroys the old executor immediately to release
   *  resources (WebSocket listeners, etc.), but defers the instance assignment to the
   *  next handleCall entry (C-01). This ensures a running handleCall keeps its snapshot
   *  executor reference stable throughout the async operation. */
  setEditorExecutor(executor: EditorToolExecutor | null): void {
    // Destroy old executor immediately — no point keeping dead listeners around
    const currentExec = this._resolvePendingExecutor();
    if (currentExec) {
      currentExec.destroy();
    }
    this._pendingModeSwitch = { mode: this.connectionMode, executor };
  }

  /** I-04: Atomically degrade to headless mode. Avoids two separate calls to
   *  setConnectionMode + setEditorExecutor racing on _pendingModeSwitch. */
  degradeToHeadless(): void {
    const currentExec = this._resolvePendingExecutor();
    if (currentExec) {
      currentExec.destroy();
    }
    this._pendingModeSwitch = { mode: 'headless', executor: null };
  }

  /** Get the effective executor: pending switch takes precedence over current instance. */
  private _resolvePendingExecutor(): EditorToolExecutor | null {
    return this._pendingModeSwitch?.executor ?? this.editorExecutor;
  }

  /** Apply any deferred mode switch. Called at the top of handleCall, outside of any await. */
  private _applyPendingModeSwitch(): void {
    if (this._pendingModeSwitch) {
      this.connectionMode = this._pendingModeSwitch.mode;
      this.editorExecutor = this._pendingModeSwitch.executor;
      this._pendingModeSwitch = null;
    }
  }

  /** 标记 editor fallback 状态（由 GodotServer.run() 调用） */
  markEditorFallback(): void {
    this._editorFallback = true;
  }

  /** I-05: Convert camelCase arg keys to snake_case, recursively for nested plain objects. */
  private static readonly MAX_NORMALIZE_DEPTH = 20;
  private normalizeArgs(rawArgs: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
    if (!rawArgs) {
      return {};
    }
    if (depth > ToolDispatcher.MAX_NORMALIZE_DEPTH) {
      throw new Error(`normalizeArgs depth limit (${ToolDispatcher.MAX_NORMALIZE_DEPTH}) exceeded — flatten nested args`);
    }
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawArgs)) {
      const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      // M-2: 原型污染防护。JSON.parse 会把 {"__proto__":{...}} 作为自有属性保留，Object.entries
      // 列出后 args[snake]=value 对 __proto__ 触发原型 setter（改写对象原型链）；constructor/prototype
      // 同属经典污染入口。直接丢弃这些键（无工具以它们为合法参数名），纵深防御。
      if (snake === '__proto__' || snake === 'constructor' || snake === 'prototype') {
        continue;
      }
      // Recursively normalize nested plain objects (e.g. layout/flex params in UI tools)
      // A-16: Skip class instances (Error, etc.) — only recurse into plain objects
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
          && Object.getPrototypeOf(value) === Object.prototype) {
        args[snake] = this.normalizeArgs(value as Record<string, unknown>, depth + 1);
      } else {
        args[snake] = value;
      }
    }
    return args;
  }

  /** Validate common arg types (project_path, action). Returns error ToolResult or null. */
  private validateCommonArgs(args: Record<string, unknown>): ToolResult | null {
    if ('project_path' in args) {
      const v = args.project_path;
      if (typeof v !== 'string' || v.trim() === '') {
        return opsErrorResult(
          COMMON_ERROR_CODES.INVALID_PARAMS,
          `project_path must be a non-empty string, got: ${typeof v === 'string' ? '""' : JSON.stringify(v)}`,
        );
      }
    }
    if ('action' in args) {
      const v = args.action;
      if (typeof v !== 'string' || v.trim() === '') {
        return opsErrorResult(
          COMMON_ERROR_CODES.INVALID_PARAMS,
          `action must be a non-empty string, got: ${typeof v === 'string' ? '""' : JSON.stringify(v)}`,
        );
      }
    }
    return null;
  }

  /**
   * A-10 (advisory): 仅校验根级路径字段(project_path/search_dir)是否在 ALLOWED_PROJECT_PATHS。
   * 其余路径参数(file_path/script_path/scene_path 等)语义多样(res://、项目内相对、绝对路径),
   * 由各工具自行调 resolveWithinRoot 校验——**新增工具须确保其路径参数经过 resolveWithinRoot**,
   * 否则绕过根限制。未做通用扩展因 file_path 等字段语义不一,通用 isPathInAllowedRoots 会误伤。
   */
  private validatePathArgs(args: Record<string, unknown>): ToolResult | null {
    if (typeof args.project_path === 'string' && !isPathInAllowedRoots(args.project_path)) {
      return opsErrorResult('PATH_NOT_ALLOWED', `Path not in ALLOWED_PROJECT_PATHS: ${args.project_path}. Check your ALLOWED_PROJECT_PATHS setting.`);
    }
    if (typeof args.search_dir === 'string' && !isPathInAllowedRoots(args.search_dir)) {
      return opsErrorResult('PATH_NOT_ALLOWED', `Search directory not in ALLOWED_PROJECT_PATHS: ${args.search_dir}. Check your ALLOWED_PROJECT_PATHS setting.`);
    }
    return null;
  }

  /**
   * CR-1/CR-2: 基于 args 计算本次调用的 findGodot override。
   * - 有 godot_path → 校验绝对路径 + Godot 二进制后返回固定值
   * - 无 godot_path → 返回项目感知 findGodot(基于 project_path)
   * 抽取为独立方法以便 executeToolCall 入口和 confirm_and_execute 分支
   * (后者须基于 pending.args 而非 confirm_and_execute 自身 args)各自调用。
   */
  private async resolveFindGodotOverride(
    args: Record<string, unknown>,
  ): Promise<{ override: ((projectPath?: string) => Promise<string>) | undefined; error: ToolResult | null }> {
    const godotOverride = typeof args.godot_path === 'string' ? args.godot_path.trim() : undefined;
    const projectPathForGodot = typeof args.project_path === 'string' ? args.project_path : undefined;
    if (godotOverride) {
      // H-02: Validate godot_path is an absolute path (security — prevent relative path tricks)
      // Absolute paths on Windows start with drive letter (C:\), on POSIX with /
      const isAbsolute = godotOverride.startsWith('/') || /^[A-Za-z]:[\\/]/.test(godotOverride);
      if (!isAbsolute) {
        return {
          override: undefined,
          error: opsErrorResult('INVALID_PARAMS', `godot_path must be an absolute path, got: "${godotOverride}"`),
        };
      }
      // H-01: Validate the binary is actually Godot before allowing override
      const { validateGodotBinary } = await import('../core/godot-finder.js');
      if (!(await validateGodotBinary(godotOverride))) {
        return {
          override: undefined,
          error: opsErrorResult('INVALID_PARAMS', `godot_path failed validation (not a valid Godot binary): ${godotOverride}`),
        };
      }
      return { override: () => Promise.resolve(godotOverride), error: null };
    }
    // Project-aware findGodot — uses .godot/mcp-godot.json, project.godot [godot_mcp], etc.
    return { override: () => this.options.findGodot(projectPathForGodot), error: null };
  }

  private async dispatchTool(toolName: string, args: Record<string, unknown>, startTime: number, findGodotOverride?: ((projectPath?: string) => Promise<string>), progressEmitter?: ProgressEmitter): Promise<ToolResult> {
    let targetMod = getModuleForTool(toolName);
    let effectiveToolName = toolName;
    let effectiveArgs = args;

    // ── Legacy fallback: 旧工具名 → 新 (tool, action) ──
    if (!targetMod) {
      const legacy = tryLegacyMapping(toolName);
      if (legacy) {
        effectiveToolName = legacy.tool;
        effectiveArgs = { ...args, action: legacy.action };
        targetMod = getModuleForTool(effectiveToolName);
      }
    }

    if (!targetMod) {
      return opsErrorResult('UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
    }

    const logger = getLogger();
    const callId = logger.toolStart(effectiveToolName, effectiveArgs);

    let result: ToolResult | null;
    try {
      // C-CONC-1: per-call findGodot 经参数传入(局部变量),避免实例字段被并发请求覆盖
      // 用 buildPerCallCtx(Object.create)而非 spread,保留 ctx getter(见该函数注释)
      const perCallCtx = buildPerCallCtx(this.ctx, findGodotOverride, progressEmitter);
      // P1-2 (2026-07-06 review): editor 文本资源/场景写守卫注入。editorExecutor 可用(非 null)时
      // 注入回调; script.ts/scene 写前调, 经 WS 调编辑器 guard_text_resource_write/guard_offline_scene_save,
      // 防 TS writeFileSync 绕过编辑器内存状态守卫致磁盘/内存版本撕裂。headless 模式 editorExecutor=null 不注入。
      if (this.editorExecutor) {
        perCallCtx.checkEditorTextResourceWrite = (p: string) => this._checkEditorGuard('guard_text_resource_write', p);
        perCallCtx.checkEditorSceneSave = (p: string) => this._checkEditorGuard('guard_offline_scene_save', p);
      }
      result = await targetMod.handleTool(effectiveToolName, effectiveArgs, perCallCtx);
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.toolEnd(callId, effectiveToolName, duration, err instanceof Error ? err.message : String(err));
      throw err;
    }

    const duration = Date.now() - startTime;

    if (result !== null) {
      // 判断是否有错误（使用 MCP 标准的 isError 字段）
      const hasError = result.isError === true;
      logger.toolEnd(callId, effectiveToolName, duration, hasError ? 'tool_error' : undefined);
      return truncateResponse({ ...result, content: [...result.content, { type: 'text' as const, text: `_duration_ms: ${duration}` }] });
    }
    logger.toolEnd(callId, effectiveToolName, duration, 'handler_null');
    return opsErrorResult('HANDLER_NULL', `Tool "${effectiveToolName}" registered but handler returned null`);
  }

  /** P1-1 (2026-07-06 review): 检测 editor 返回是否 -32601 Unknown method
   * (command_handler 不认此 method — TS (tool,action) 工具转发后常见)。 */
  private _isUnknownMethod(result: ToolResult): boolean {
    for (const block of result.content ?? []) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      try {
        const parsed = JSON.parse(block.text) as { error?: { code?: number }; code?: number };
        // 认嵌套 {error:{code}} 与平铺 {error,code}（后者是 EditorToolExecutor I-12
        // 对 WS error 的结构化拍平形态，见 EditorToolExecutor.ts catch 分支）。
        if (parsed.error?.code === -32601 || parsed.code === -32601) return true;
      } catch { /* not JSON */ }
    }
    return false;
  }

  /**
   * P1-2 (2026-07-06 review): 经 WS 调编辑器 guard, 返回是否阻塞写。
   * - editorExecutor 不可用(null) → 放行(headless 无编辑器状态可守)
   * - 编辑器返回 -32009(状态冲突: 打开的脚本/缓存 Resource/打开的场景) → 阻塞
   * - 其他(guard 放行 ok / -32003 guards 不可用 / 连接错误) → 放行(不静默吞, 调用方据 blocked 决定)
   */
  private async _checkEditorGuard(
    method: 'guard_text_resource_write' | 'guard_offline_scene_save',
    path: string,
  ): Promise<{ blocked: boolean; code?: number; message?: string }> {
    if (!this.editorExecutor) return { blocked: false };
    try {
      const result = await this.editorExecutor.execute(method, { path });
      const first = result.content?.[0];
      const text = first?.type === 'text' ? first.text : '{}';
      const parsed = JSON.parse(text) as { error?: { code?: number; message?: string } };
      if (parsed.error?.code === -32009) {
        return { blocked: true, code: -32009, message: parsed.error.message };
      }
      return { blocked: false };
    } catch {
      return { blocked: false };
    }
  }

  private attachFallbackWarning(result: ToolResult): ToolResult {
    if (this._editorFallback && !this._editorFallbackWarned) {
      this._editorFallbackWarned = true;
      const first = result.content?.[0];
      if (first?.type === 'text') {
        // H-04: Create new content array and text block instead of mutating original
        return {
          ...result,
          content: [
            { type: 'text' as const, text: first.text + '\n\n⚠️ [EDITOR_FALLBACK] Running in Headless mode — Editor features (UndoRedo, live scene sync) unavailable.' },
            ...result.content.slice(1),
          ],
        };
      }
    }
    return result;
  }

  /** Parse content blocks as JSON and check for success === false. */
  private checkJsonSuccessFalse(result: ToolResult): boolean {
    if (!result.content) return false;
    for (const block of result.content) {
      if ("text" in block && typeof block.text === "string") {
        try {
          const parsed = JSON.parse(block.text);
          if (parsed && typeof parsed === "object" && parsed.success === false) return true;
        } catch { /* not JSON */ }
      }
    }
    return false;
  }
}

/**
 * 构建每次工具调用的 ctx 副本(覆盖 findGodot)。
 *
 * 必须用 Object.create(继承 this.ctx 原型),而非 spread {...this.ctx}:ctx 上的
 * runningProcess/outputBuffer/processStartTime/projectDir 是连 process-state 模块的 getter,
 * spread 会把它们展平成调用时刻的快照。dispatch 入口 _runningProcess=null,spread 后
 * perCallCtx.runningProcess 被冻结成 null —— 即便 run_project 内 setRunningProcess(proc) 改了
 * 模块 state,perCallCtx.runningProcess 仍为 null,isCancelled(runningProcess !== proc)永远 true,
 * 导致 wait_for_bridge 误报 "process exited during probe"。Object.create 让 perCallCtx 继承 getter,
 * runningProcess 实时反映模块 state。
 */
export function buildPerCallCtx(
  baseCtx: ToolContext,
  findGodotOverride?: (projectPath?: string) => Promise<string>,
  progressEmitter?: ProgressEmitter,
): ToolContext {
  const perCallCtx = Object.create(baseCtx) as ToolContext;
  perCallCtx.findGodot = findGodotOverride ?? baseCtx.findGodot;
  // Task 3: 注入 per-request progress emitter（progress 是新增字段非 getter，不破坏 Object.create 继承机制）
  if (progressEmitter) {
    perCallCtx.progress = progressEmitter;
  }
  return perCallCtx;
}
