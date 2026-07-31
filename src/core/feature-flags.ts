// src/core/feature-flags.ts

// A-3 (2026-06-24 审查): 删除 3 个死 flag——PATH_SECURITY/OFFLINE_MODE/ADVANCED_PROXY。
// src 内零引用 + scripts/verify-features.mjs 已同步(路径安全硬编码启用、另两个无对应功能)。
// TOOL_GROUPS 保留并接线到 ToolDispatcher(原直接读 env 绕过 flag 系统,见 ToolDispatcher:165)。
// 注(审查#2):接线使 TOOL_GROUPS 语义收紧——原 env!=='false'(非标准值默认开)→ isFeatureEnabled(只认 'true',非标准值默认关)。
const FEATURES = {
  TOOL_GROUPS:     { env: 'GODOT_MCP_TOOL_GROUPS',     default: true },
  MULTI_INSTANCE:  { env: 'GODOT_MCP_MULTI_INSTANCE',   default: false },
  RESPONSE_LIMIT:  { env: 'GODOT_MCP_RESPONSE_LIMIT',   default: true },
  HEALTH_MONITOR:  { env: 'GODOT_MCP_HEALTH_MONITOR',   default: true },
  ELICITATION:     { env: 'GODOT_MCP_ELICITATION',      default: true },
  TELEMETRY:       { env: 'GODOT_MCP_TELEMETRY',        default: false },
  // 报告②P1：启动时清理上一会话残留 Godot 进程（默认关，opt-in）。
  // 仅跑第一层 PID 集合扫描（毫秒级、安全）；第二层全系统扫描仍需 GODOT_MCP_FULL_SYSTEM_SCAN=true。
  STARTUP_CLEANUP: { env: 'GODOT_MCP_STARTUP_CLEANUP',  default: false },
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
