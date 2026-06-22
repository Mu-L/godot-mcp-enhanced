// src/tools/rules-manifest.ts
// 规则文件清单（manifest）的纯函数模块：hash 计算、adopt 构建、二维判定、reconcile 规划。
// 零 IO 依赖（不读写文件系统），所有文件读写由 project.ts 编排，本模块只做决策。

import { createHash } from 'crypto';

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** 单个规则文件在 manifest 中的条目 */
export interface RuleManifestEntry {
  /** 内容来源：'base' = GODOT_MCP_RULES，'detail' = DETAILED_RULE_TEMPLATES */
  source: 'base' | 'detail';
  /** 安装时文件内容的 hash（CRLF 归一化后），格式 'sha256:<hex>' */
  hash: string;
}

/** manifest 文件结构 */
export interface RulesManifest {
  /** 清单格式版本，留作未来迁移 */
  manifest_version: number;
  /** 规则文件安装时的 server 版本（仅代表规则文件，非整个 MCP 安装） */
  rules_installed_at_version: string;
  /** 安装时间 ISO 字符串 */
  installed_at: string;
  /** 文件名 → 条目 */
  rules: Record<string, RuleManifestEntry>;
}

/** 逐文件二维判定的四种分类（见 spec §3.3） */
export type FileClassification =
  | 'pure-upgrade'          // 版本过时 + 用户未动过 → update 应覆盖
  | 'stale-and-modified'    // 版本过时 + 用户动过 → update 保留并警告
  | 'latest'                // 版本同 + 未动过 → 不动
  | 'local-modified';       // 版本同 + 动过 → 保留并报告

/** reconcile 执行模式 */
export type RulesMode = 'check' | 'update' | 'overwrite';

// ─── hash ────────────────────────────────────────────────────────────────────

/** CRLF / 裸 CR 归一化为 LF。仅用于算 hash，不用于写磁盘。 */
export function normalizeForHash(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 计算内容的 SHA-256 hash（CRLF 归一化后），返回 'sha256:<hex>'。 */
export function hashContent(content: string): string {
  const normalized = normalizeForHash(content);
  const hex = createHash('sha256').update(normalized, 'utf-8').digest('hex');
  return `sha256:${hex}`;
}
