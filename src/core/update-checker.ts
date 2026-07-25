// src/core/update-checker.ts
// npm registry 最新版查询 + 24h 缓存 + 网络容错。
// 启动被动提示（index.ts）与 check_update 工具共用同一函数。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
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

function readCache(cachePath: string): CacheData | null {
  try {
    if (!existsSync(cachePath)) return null;
    const obj = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (typeof obj.lastCheck === 'number' && typeof obj.latest === 'string') return obj;
    return null;
  } catch { return null; }  // 损坏当 miss
}

function writeCache(cachePath: string, data: CacheData): void {
  try {
    const dir = dirname(cachePath);
    mkdirSync(dir, { recursive: true });  // recursive 对已存在目录是 noop，避免 existsSync+mkdirSync TOCTOU
    const tmp = cachePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(data), 'utf-8');
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
