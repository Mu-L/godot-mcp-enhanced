import { randomBytes } from 'crypto';

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

// Map: merged tool name → Set of guarded actions (null = entire tool is guarded)
//
// IMPORTANT: This guard relies on GodotServer.ts routing by MERGED tool name (e.g. 'scene',
// 'script', 'game') rather than legacy individual names. If a caller bypasses the merged-name
// router and uses the old name directly (e.g. 'remove_node'), the guard WILL NOT catch it.
// GodotServer.handleToolCall() is the single entry point and always resolves to merged names.
export const GUARDED: Record<string, Set<string> | null> = {
  // CRITICAL-1 (2026-06-26 review, issue #15): GUARDED 扩到所有写/删除/执行类 action。
  // 原 confirm-token-trust-broken fix-forward 要求。读/查询不守;边界(input/monitor/click_button/
  // signal_connect/audio_play 等运行时输入/短期控制)不守。详见 docs/review-fix-backlog-2026-06-26.md。
  scene: new Set([
    'create_scene', 'quick_scene', 'add_node', 'batch_add_nodes', 'edit_node',
    'remove_node', 'save_scene', 'load_sprite', 'instance_scene',
    'set_instance_property', 'detach_instance', 'merge_scene', 'create_3d_node', 'commit',
  ]),
  // script: edit_script 的 search_and_replace 模式在 requiresConfirmation 内豁免(非破坏性,内容匹配)
  script: new Set(['write_script', 'edit_script', 'execute_gdscript', 'project_replace', 'generate_test', 'create_test_scene']),
  animation: new Set(['create', 'delete', 'update_props', 'add_track', 'remove_track', 'add_keyframe', 'remove_keyframe', 'update_keyframe', 'ik_modifier_create', 'ik_modifier_set']),
  tilemap: new Set(['tilemap_set_cell', 'tilemap_erase_cell', 'tilemap_fill_rect', 'tilemap_clear', 'tilemap_paste', 'tilemap_set_transform']),
  game: new Set(['game_bridge_install', 'game_bridge_uninstall', 'game_write']),  // game_write: set_node_property/call_method(任意方法 RPC,最高危,不经 execute_gdscript 沙箱)
  material: new Set(['set_params', 'create', 'save', 'load', 'shader_write', 'shader_load_file', 'shader_save_file', 'shader_apply_template']),
  particles: new Set(['particles_create', 'particles_set_emission', 'particles_set_process', 'particles_load_preset', 'particles_set_material']),
  signal: new Set(['signal_emit']),  // connect/disconnect 边界不守;emit 触发已连接回调
  nav: new Set(['create_region', 'bake_mesh', 'create_agent', 'set_params', 'create_link']),
  audio: new Set(['audio_set_param']),  // play/stop 短期执行不守
  ui: new Set(['ui_create_control', 'ui_set_layout', 'ui_anchor_preset', 'ui_set_theme', 'ui_container_add', 'theme_create', 'theme_set_property', 'ui_draw_recipe', 'ui_build_layout']),
  physics: new Set(['collision_overlay']),  // raycast/body_info/diagnose/query_spatial 读
  runtime: new Set(['run_project', 'launch_editor', 'stop_project', 'run_tests', 'record_start', 'record_stop', 'record_play', 'record_save']),
  android: new Set(['deploy']),  // list_devices/get_preset_info 读不守;deploy install 改设备
};

export function requiresConfirmation(toolName: string, args?: Record<string, unknown>): boolean {
  const guarded = GUARDED[toolName];
  if (guarded === undefined) return false;
  if (guarded === null) return true;
  const action = (args?.action ?? args?.method) as string | undefined;
  if (action == null || !guarded.has(action)) return false;

  // Fine-grained exemptions: search_and_replace is non-destructive (content-matched, CRLF-safe)
  const sr = args?.search_and_replace;
  if (toolName === 'script' && action === 'edit_script' && sr && typeof sr === 'object' && 'search' in sr) {
    return false;
  }

  return true;
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

/** Whether a tool has ANY guarded action (null or Set). Used by capability matrix. */
export function isGuardedTool(toolName: string): boolean {
  return GUARDED[toolName] !== undefined;
}
