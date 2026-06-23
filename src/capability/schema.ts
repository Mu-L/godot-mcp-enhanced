// src/capability/schema.ts
/** 安全敏感度分层，驱动 L2 安全回归优先级（spec §3.1）。 */
export type SecurityLevel = 'danger-api' | 'guarded' | 'safe';

/** 每个工具一条能力记录，四组维度（spec §3）。 */
export interface ToolCapability {
  // ── A. 真实契约 ──
  name: string;
  group: string;
  description: string;
  inputSchema: object;
  requiredParams: string[];
  optionalParams: string[];
  // ── B. 执行特征 ──
  readonly: boolean;
  longRunning: boolean;
  guarded: boolean;
  securityLevel: SecurityLevel;
  // ── C. 依赖条件 ──
  groupRequires: ('bridge' | 'editor' | 'headless')[];
  offlineCapable: boolean;
  needsGodot: boolean;
  needsEditor: boolean;
  // ── D. 静态 grep + 验证状态 ──
  gdScriptImpl: {
    headless: { exists: boolean; path: string | null };
    editor: { exists: boolean; path: string | null };
  };
  relatedDefects: string[];
  verification: {
    l1: 'extracted';
    l2: 'covered' | 'partial' | 'none';
    l3: 'passed' | 'failed' | 'unverified';
    lastRun: string | null;
  };
}

/** 按优先级定级：danger-api > guarded > safe（spec §3.1）。 */
export function classifySecurityLevel(input: { dangerApiHit: boolean; guarded: boolean }): SecurityLevel {
  if (input.dangerApiHit) return 'danger-api';
  if (input.guarded) return 'guarded';
  return 'safe';
}
