// src/telemetry/sanitize.ts
// 出进程前匿名化脱敏。红线：绝不发原始路径/项目名/错误文本（可能含 PII）。
import { createHash } from 'crypto';
import { getInstallUUID } from './config.js';

/** 加盐 sha256 项目路径取前 8 hex。salt=installUUID 防字典反推 + 跨安装关联。 */
export function hashProject(projectPath: string): string {
  return createHash('sha256').update(getInstallUUID() + projectPath).digest('hex').slice(0, 8);
}

/** version 白名单（防注入 + 防路径泄漏）。失败 fallback 哨兵 'unknown'。 */
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
export function sanitizeVersion(v: string): string {
  return VERSION_RE.test(v) ? v : 'unknown';
}
