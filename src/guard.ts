import { randomBytes } from 'crypto';
import { getActionRisk, getActionRisks, type RiskLevel } from './core/tool-registry.js';

interface PendingToken {
  token: string;
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
  /** I-07: True if any arg was truncated during creation — consumer must refuse execution. */
  wasTruncated?: boolean;
  // FUTURE: Add clientId field for multi-client isolation.
  // Currently MCP is single-client, so token-to-caller binding is unnecessary.
}

export const TOKEN_TTL_MS = 60_000; // 60s — CRITICAL-3 子项1: 收紧重放窗口(原 180s)
const MAX_TOKENS = 100;
const TOKEN_RATE_LIMIT = 5; // max new tokens per second
const MAX_ARGS_JSON_SIZE = 10_000; // I-02: Truncate args JSON to prevent memory bloat from large GDScript code blocks
const pendingTokens = new Map<string, PendingToken>();
let _recentCreations: number[] = []; // timestamps of recent createPendingToken calls

// I-CQ-06: Prevent timer restart after explicit cleanup/shutdown
let _shutdown = false;

let _cleanupTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now();
  for (const [key, pending] of pendingTokens) {
    if (now - pending.createdAt > TOKEN_TTL_MS) pendingTokens.delete(key);
  }
}, 60_000);
// 允许进程正常退出（不阻塞事件循环）
if (_cleanupTimer.unref) _cleanupTimer.unref();

/** Restart the background cleanup interval if it isn't running. */
function ensureCleanupTimer(): void {
  if (_shutdown) return; // I-CQ-06: Don't restart after explicit cleanup
  if (_cleanupTimer !== null) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, pending] of pendingTokens) {
      if (now - pending.createdAt > TOKEN_TTL_MS) pendingTokens.delete(key);
    }
  }, 60_000);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
}

// IMPORTANT: 本守卫依赖 GodotServer.ts 按 MERGED 工具名（如 'scene'/'script'/'game'）路由，
// 而非旧的独立工具名。若调用方绕过 merged-name 路由器直接用旧名（如 'remove_node'），
// 守卫将捕获不到。GodotServer.handleToolCall() 是单一入口，始终解析为 merged 名。
//
// 判定依据：ToolMeta.actionRisks（每个工具模块的 TOOL_META 声明）。
// risk !== 'read' 的 action 需确认；动态豁免（如 edit_script 的 search_and_replace）见 dynamicRiskOverride。

/** 动态豁免：args 内容决定 risk 的特例（当前仅 script.edit_script 的 search_and_replace 模式）。
 *  search_and_replace 模式为内容匹配、非破坏性（CRLF 安全），故降级为 read。 */
function dynamicRiskOverride(toolName: string, action: string, args: Record<string, unknown> | undefined): RiskLevel | null {
  if (toolName === 'script' && action === 'edit_script') {
    const sr = args?.search_and_replace;
    if (sr && typeof sr === 'object' && 'search' in sr) return 'read';
  }
  return null;
}

export function requiresConfirmation(toolName: string, args?: Record<string, unknown>): boolean {
  const action = (args?.action ?? args?.method) as string | undefined;
  if (action == null) return false;
  const risk = dynamicRiskOverride(toolName, action, args) ?? getActionRisk(toolName, action);
  return risk !== undefined && risk !== 'read';
}

export function createPendingToken(toolName: string, args: Record<string, unknown>): string {
  // I-19: refuse token creation after shutdown — timer is stopped, token would never be cleaned
  if (_shutdown) throw new Error('Token system has been shut down');
  ensureCleanupTimer();
  const now = Date.now();
  // A-05: Rate limit — prevent high-frequency token creation from evicting legitimate tokens
  _recentCreations = _recentCreations.filter(t => now - t < 1000);
  // A-05: 防止数组在高频场景下短暂膨胀，超过 2x 限制时截断
  if (_recentCreations.length > TOKEN_RATE_LIMIT * 2) {
    _recentCreations = _recentCreations.slice(-TOKEN_RATE_LIMIT);
  }
  if (_recentCreations.length >= TOKEN_RATE_LIMIT) {
    throw new Error(`Token creation rate limit exceeded (max ${TOKEN_RATE_LIMIT}/s). Please wait and retry.`);
  }
  _recentCreations.push(now);
  // 清理过期 token
  for (const [key, pending] of pendingTokens) {
    if (now - pending.createdAt > TOKEN_TTL_MS) pendingTokens.delete(key);
  }
  // 超限时移除最旧的（遍历 100 条 < 1μs，逻辑清晰可靠）
  if (pendingTokens.size >= MAX_TOKENS) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, pending] of pendingTokens) {
      if (pending.createdAt < oldestTime) {
        oldestTime = pending.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) pendingTokens.delete(oldestKey);
  }
  const token = randomBytes(18).toString('base64url');
  // I-02: Truncate large args to prevent memory bloat (e.g. GDScript code blocks in execute_gdscript)
  const { args: truncatedArgs, truncated } = truncateArgs(args);
  pendingTokens.set(token, { token, toolName, args: truncatedArgs, createdAt: now, wasTruncated: truncated || undefined });
  return token;
}

/**
 * Consume a pending confirmation token.
 *
 * SECURITY NOTE: This function validates the token value but does NOT verify
 * the caller's identity. In the current single-client MCP architecture this
 * is safe. If multi-client support is added, PendingToken needs a `clientId`
 * field and this function must verify it matches the current caller.
 */
export function consumeToken(token: string): { toolName: string; args: Record<string, unknown>; wasTruncated?: boolean } | null {
  const pending = pendingTokens.get(token);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > TOKEN_TTL_MS) {
    pendingTokens.delete(token);
    return null;
  }
  pendingTokens.delete(token);
  return { toolName: pending.toolName, args: pending.args, wasTruncated: pending.wasTruncated };
}

export function pendingCount(): number {
  return pendingTokens.size;
}

/**
 * Reset all mutable state: clear pending tokens and stop the cleanup interval.
 * Useful for test teardown or hot-reload scenarios.
 * The cleanup interval will be recreated on the next `createPendingToken()` call.
 */
export function resetState(): void {
  pendingTokens.clear();
  _recentCreations = [];
  _shutdown = false; // Allow restart after test reset
  if (_cleanupTimer !== null) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

/**
 * Graceful shutdown: stop the cleanup interval and clear all pending tokens.
 * After calling this, the module is still usable — the interval restarts on
 * the next `createPendingToken()` call.
 */
export function cleanup(): void {
  _shutdown = true; // I-CQ-06: Prevent timer restart after graceful shutdown
  pendingTokens.clear();
  _recentCreations = [];
  if (_cleanupTimer !== null) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

/** @internal Exposed for testing — check whether the cleanup timer is active. */
export function isCleanupTimerRunning(): boolean {
  return _cleanupTimer !== null;
}

/** I-02: Truncate large string values in args to cap memory usage per token.
 *  I-07: Returns whether any value was truncated so consumer can refuse execution. */
function truncateArgs(args: Record<string, unknown>): { args: Record<string, unknown>; truncated: boolean } {
  let truncated = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > MAX_ARGS_JSON_SIZE) {
      out[key] = value.substring(0, MAX_ARGS_JSON_SIZE) + `...[truncated ${value.length - MAX_ARGS_JSON_SIZE} chars]`;
      truncated = true;
    } else {
      out[key] = value;
    }
  }
  return { args: out, truncated };
}

/** Whether a tool has ANY guarded action (任意 action 的 risk 非 read). Used by capability matrix. */
export function isGuardedTool(toolName: string): boolean {
  const risks = getActionRisks(toolName);
  return risks !== undefined && Object.values(risks).some(r => r !== 'read');
}
