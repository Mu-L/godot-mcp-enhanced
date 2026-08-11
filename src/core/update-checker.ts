// src/core/update-checker.ts
// npm registry 最新版查询 + 24h 缓存 + 网络容错。
// 启动被动提示（index.ts）与 check_update 工具共用同一函数。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// src/core/ → 上两级包根 → package.json
const pkgVersion: string = require('../../package.json').version;

const REGISTRY_URL = 'https://registry.npmjs.org/godot-mcp-enhanced/latest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** 手写 semver 比较（零依赖，假设纯数字 x.y.z，非数字段 fallback 0）。返回 -1/0/1。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(n => Number(n) || 0);
  const pb = b.split('.').map(n => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function getDefaultCacheDir(): string {
  return join(homedir(), '.godot-mcp');  // 复用 instance-manager.ts getDefaultRegistryDir 的 ~/.godot-mcp/ 父目录惯例（机器级，非项目级）
}

function getCachePath(cacheDir?: string): string {
  return join(cacheDir ?? getDefaultCacheDir(), 'update-cache.json');
}

interface CacheData { lastCheck: number; latest: string; }

export function readCache(cachePath: string): CacheData | null {
  try {
    if (!existsSync(cachePath)) return null;
    // S2: 防大文件 OOM（64KB 上限）
    if (statSync(cachePath).size > 64 * 1024) return null;
    const obj = JSON.parse(readFileSync(cachePath, 'utf-8'));
    // S2: latest 长度上限（64 字符）
    if (typeof obj.lastCheck === 'number' && typeof obj.latest === 'string'
        && obj.latest.length <= 64) return obj;
    return null;
  } catch { return null; }  // 损坏当 miss
}

function writeCache(cachePath: string, data: CacheData): void {
  try {
    const dir = dirname(cachePath);
    mkdirSync(dir, { recursive: true });  // recursive 对已存在目录是 noop，避免 existsSync+mkdirSync TOCTOU
    const tmp = cachePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(data), 'utf-8');
    // S2(2026-07-31 nit#4): 显式收紧到 0o600（writeFileSync 默认 0o666 & ~umask，umask 022 → 0o644，
    // cache 含版本/时间戳信息，收紧无害；chmodSync 在 rename 前对 tmp 设置，rename 后目标继承权限）
    try { chmodSync(tmp, 0o600); } catch { /* Windows/受限环境 chmod 无效，忽略 */ }
    renameSync(tmp, cachePath);  // 原子 rename
  } catch { /* 缓存写失败静默 */ }
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
  fromCache: boolean;
}

/** 查 npm 最新版。force:true 绕缓存（供 check action）；cacheDir 测试注入。失败绝不抛。 */
export async function checkForUpdateCached(opts?: { force?: boolean; cacheDir?: string }): Promise<UpdateCheckResult> {
  // 2026-08-06 审查 P3：env 门控（用户可设 GODOT_MCP_UPDATE_CHECK=false 关闭启动外传，
  // 对齐 telemetry opt-in 哲学——telemetry 都 opt-in 了 update-checker 也应可关）。
  // 注：force=true 时仍走（self_update check action 经 force:true 短路门控，且 risk='read'
  // 不经确认令牌，AI 可自主调用触发外传——对齐 docs/telemetry.md 诚实披露段）。
  // 2026-08-07 审查 P1：语义健壮化——原 === 'false' 严格字符串相等，大小写敏感 + 不认 falsy 变体
  // （用户写 =0/=no/=off/=False/=FALSE 都不触发关闭）。改为认 false/0/no/off + 大小写不敏感，
  // 对齐 feature-flags.ts isFeatureEnabled 的标准化逻辑（方向相反：update-checker 是 opt-out 默认开，
  // telemetry 是 opt-in 默认关，但标准化逻辑对齐）。
  const updateCheckEnv = process.env.GODOT_MCP_UPDATE_CHECK ?? '';
  const isUpdateCheckDisabled = /^(false|0|no|off)$/i.test(updateCheckEnv);
  if (!opts?.force && isUpdateCheckDisabled) {
    return {
      current: pkgVersion,
      latest: pkgVersion,
      updateAvailable: false,
      fromCache: false,
    };
  }
  const cachePath = getCachePath(opts?.cacheDir);
  if (!opts?.force) {
    const cached = readCache(cachePath);
    if (cached && Date.now() - cached.lastCheck < CACHE_TTL_MS) {
      return {
        current: pkgVersion,
        latest: cached.latest,
        updateAvailable: compareVersion(cached.latest, pkgVersion) > 0,
        fromCache: true,
      };
    }
  }
  let latest: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(REGISTRY_URL, { signal: ctrl.signal });
      if (res.ok) {
        const obj = (await res.json()) as { version?: string };
        if (typeof obj.version === 'string') latest = obj.version;
      }
    } finally {
      clearTimeout(timer);  // M1: fetch throw 时也确保清理，避免 timer dangling 5s
    }
  } catch { /* 网络/超时/解析失败静默 */ }
  if (latest == null) {
    return { current: pkgVersion, latest: pkgVersion, updateAvailable: false, fromCache: false };
  }
  writeCache(cachePath, { lastCheck: Date.now(), latest });
  return {
    current: pkgVersion,
    latest,
    updateAvailable: compareVersion(latest, pkgVersion) > 0,
    fromCache: false,
  };
}
