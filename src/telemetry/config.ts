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
    // T3: readFileSync 包 try-catch（读写对称，对齐 :37 writeFileSync）。
    // 文件存在但读取失败（EBUSY 锁/权限错）时返 '' 走 mint 分支，与"文件不存在"同语义。
    // 兑现 docs/telemetry.md:88「消费侧任何 throw 都被吞掉」承诺于 getInstallUUID 自身。
    // 实际后果被 middleware.ts:60-68 after-hook catch 兜底（无业务破坏），此处更彻底。
    try {
      uuid = readFileSync(p, 'utf-8').trim();
    } catch { /* 读失败视同 uuid 缺失，走 mint 分支 */ }
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
