// src/telemetry/config.ts
// 遥测 opt-in 配置 + install UUID 管理。
// 设计原则：disabled 零副作用（不读不写不调度）；opt-in 反向（默认 false，与 godot-ai opt-out 反向）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { isFeatureEnabled } from '../core/feature-flags.js';

function dataDir(): string {
  // 与 update-checker.ts:31-33 / instance-manager.ts 同惯例：机器级 ~/.godot-mcp/
  return join(homedir(), '.godot-mcp');
}

function uuidPath(): string {
  return join(dataDir(), 'telemetry-uuid.txt');
}

/** 遥测是否启用。CI 强制 false（防 CI 触发合成事件）。否则走 FEATURES.TELEMETRY（opt-in）。 */
export function isTelemetryEnabled(): boolean {
  if (process.env.CI === 'true') return false;
  return isFeatureEnabled('TELEMETRY');
}

let _uuidCache: string | null = null;

/** 读取或生成 install UUID（缺失则 mint + 立即写回，godot-ai #529 身份收敛）。 */
export function getInstallUUID(): string {
  if (_uuidCache) return _uuidCache;
  const p = uuidPath();
  let uuid = '';
  if (existsSync(p)) {
    uuid = readFileSync(p, 'utf-8').trim();
  }
  if (!uuid) {
    uuid = randomUUID();
    try {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(p, uuid, { mode: 0o600 });  // POSIX 0o600（Windows 忽略 mode）
    } catch { /* 写失败静默，下次 mint 再试；不影响运行 */ }
  }
  _uuidCache = uuid;
  return uuid;
}

/** opt-out 时清理内存缓存（不删 UUID 文件，保留身份稳定性）。 */
export function cleanupLocalFiles(): void {
  _uuidCache = null;
}
