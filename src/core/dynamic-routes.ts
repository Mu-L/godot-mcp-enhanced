// src/core/dynamic-routes.ts
/**
 * Dynamic route derivation + error classification (Phase 3)
 *
 * These utilities enable lazy tool discovery — new Godot-side tools can be
 * called through godot_advanced_tool without MCP-side code changes.
 */

// ─── Route derivation ─────────────────────────────────────────────────────────

/** Known irregular tool→route mappings that don't follow convention. */
const ROUTE_OVERRIDES: Record<string, string> = {
  // Add known overrides here as needed
};

/**
 * Convert a tool name to a Godot-side API route.
 *
 * Convention: godot_category_action → category/action
 * Examples:
 *   godot_custom_light_bake → custom/light-bake
 *   godot_terrain_sculpt → terrain/sculpt
 *   godot_animation_play → animation/play
 *
 * Only accepts tool names with the 'godot_' prefix.
 * Returns null for names that don't match.
 */
export function toolNameToRoute(toolName: string): string | null {
  if (ROUTE_OVERRIDES[toolName]) return ROUTE_OVERRIDES[toolName];

  if (!toolName.startsWith('godot_')) return null;

  const withoutPrefix = toolName.slice(6); // strip 'godot_'
  const parts = withoutPrefix.split('_');
  if (parts.length < 2) return null; // need at least category + action

  const category = parts[0];
  const action = parts.slice(1).join('-');
  return `${category}/${action}`;
}

// ─── Error classification ─────────────────────────────────────────────────────

export type ErrorClass = 'permanent' | 'transient';

/**
 * Classify an HTTP status code for retry decisions.
 *
 * - 4xx (client errors): permanent — don't retry
 * - 5xx (server errors): transient — retry with backoff
 * - Other: permanent — conservative default
 */
export function classifyError(status: number): ErrorClass {
  if (status >= 500) return 'transient';
  return 'permanent'; // 4xx and everything else
}

// ─── Unknown-route detection (Phase 1,对标 unity-mcp-server capabilities.js:42-50) ──

/**
 * 判断一个工具调用结果是否表示"路由不存在"(unknown route)。
 *
 * 对标 unity-mcp-server 的 isUnknownRouteResult,兼容多种 GD addon 版本的错误签名:
 *   - HTTP 404 字样(新版 addon 用 HTTP 404 表 unknown route)
 *   - "Unknown route" 字样
 *   - "Unknown API endpoint" / "Unknown method" / "Unknown command" 字样(更老版本)
 *
 * 用途:advanced-proxy 动态路由失败时,区分"路由不存在"(可建议 did-you-mean)
 * 和"路由存在但执行失败"(不该建议)。
 *
 * @param result 工具调用结果(对象或 Error 或字符串)
 */
export function isUnknownRouteResult(result: unknown): boolean {
  if (!result) return false;

  const texts: string[] = [];

  if (result instanceof Error) {
    texts.push(result.message);
  } else if (typeof result === 'string') {
    texts.push(result);
  } else if (typeof result === 'object') {
    const o = result as Record<string, unknown>;
    // 直接 error 字段(string)
    if (typeof o.error === 'string') texts.push(o.error);
    // 嵌套 data.error(string)
    if (o.data && typeof o.data === 'object') {
      const dataErr = (o.data as Record<string, unknown>).error;
      if (typeof dataErr === 'string') texts.push(dataErr);
    }
    // message 字段(advanced-proxy opsError 形态)
    if (typeof o.message === 'string') texts.push(o.message);
  }

  // 匹配多种版本的表达(对齐 unity isUnknownRouteResult 的正则)
  return texts.some((t) => /HTTP 404|Unknown route|Unknown API endpoint|Unknown method|Unknown command/i.test(t));
}
