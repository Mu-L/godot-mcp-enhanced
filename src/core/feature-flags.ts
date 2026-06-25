// src/core/feature-flags.ts

// A-3 (2026-06-24 审查): 删除 3 个死 flag——PATH_SECURITY/OFFLINE_MODE/ADVANCED_PROXY。
// 全 src 零引用(路径安全硬编码启用、另两个无对应功能),仅占 getAllFeatureFlags 的 log 输出 → 误导。
// TOOL_GROUPS 保留并接线到 ToolDispatcher(原直接读 env 绕过 flag 系统,见 ToolDispatcher:165)。
const FEATURES = {
  TOOL_GROUPS:     { env: 'GODOT_MCP_TOOL_GROUPS',     default: true },
  MULTI_INSTANCE:  { env: 'GODOT_MCP_MULTI_INSTANCE',   default: false },
  RESPONSE_LIMIT:  { env: 'GODOT_MCP_RESPONSE_LIMIT',   default: true },
  HEALTH_MONITOR:  { env: 'GODOT_MCP_HEALTH_MONITOR',   default: true },
  ELICITATION:     { env: 'GODOT_MCP_ELICITATION',      default: true },
} as const;

export type FeatureKey = keyof typeof FEATURES;

/** Check if a feature is enabled. Reads from env var, falls back to default. */
export function isFeatureEnabled(key: FeatureKey): boolean {
  const feature = FEATURES[key];
  const envVal = process.env[feature.env];
  if (envVal === undefined) return feature.default;
  return envVal.toLowerCase() === 'true';
}

let flagsCache: Record<FeatureKey, boolean> | null = null;

/** Get all feature flags with their current values. Result is cached (flags don't change at runtime). */
export function getAllFeatureFlags(): Record<FeatureKey, boolean> {
  if (flagsCache) return flagsCache;
  const result = {} as Record<FeatureKey, boolean>;
  for (const key of Object.keys(FEATURES) as FeatureKey[]) {
    result[key] = isFeatureEnabled(key);
  }
  flagsCache = result;
  return flagsCache;
}
