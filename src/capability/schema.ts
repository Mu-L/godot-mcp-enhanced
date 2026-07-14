// src/capability/schema.ts
import type { RiskLevel } from '../core/tool-registry.js';

/**
 * 安全敏感度分层，驱动 L2 安全回归优先级（spec §3.1）。
 *
 * securityLevel 按 group 级聚合（extract.ts 的 dangerGroups：组内任一源文件命中危险 API → 整组 danger-api）。
 * meta-tool（如 manage_tools）虽自身源文件不命中危险 API，但因控制危险工具（script/project）的启停，
 * 归入 danger-api。这是"组级风险面"语义，非"工具级"——测试资源按此优先级分配。
 */
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
  /** 该工具各 action 的 risk 分布（read/write/destructive/process 计数）。无 actionRisks 的工具为 undefined。 */
  riskDistribution?: Record<RiskLevel, number>;
  /** 标 read 但实际启进程/有副作用、项目有意信任不确认的 action（如 validation.run_and_verify 启 Godot headless）。 */
  trustedNonRead?: string[];
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
  // ── E. 体积预算（token budget）──
  /** tools/list 推送体积度量（UTF-8 字节）。schemaBytes 用 JSON.stringify 紧凑序列化（下界估计）。 */
  size: {
    descBytes: number;
    schemaBytes: number;
    totalBytes: number;
  };
}

/** 按优先级定级：danger-api > guarded > safe（spec §3.1）。 */
export function classifySecurityLevel(input: { dangerApiHit: boolean; guarded: boolean }): SecurityLevel {
  if (input.dangerApiHit) return 'danger-api';
  if (input.guarded) return 'guarded';
  return 'safe';
}
