/**
 * Path security utilities — I-ARCH-03 (extracted from helpers.ts)
 *
 * Path traversal protection, symlink resolution, allowed roots validation.
 */

import { isAbsolute, resolve, relative, sep, basename, dirname, normalize } from 'path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'fs';
import { join } from 'path';
import { getLogger } from './logger.js';
import { PathError } from './tool-errors.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_DECODE_ITERATIONS = 20;

/** Windows device names that must never be used as file names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) */
const WINDOWS_DEVICE_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

// ─── Iterative URL decode ─────────────────────────────────────────────────────

/** A-15: Iterative URL decode — defeats multi-layer encoding. */
export function iterativeDecode(raw: string, maxIterations = MAX_DECODE_ITERATIONS): string {
  let decoded = raw;
  let prev = '';
  let iterations = 0;
  while (decoded !== prev && iterations < maxIterations) {
    prev = decoded;
    decoded = decodeURIComponent(decoded);
    iterations++;
  }
  return decoded;
}

// ─── Path resolution ──────────────────────────────────────────────────────────

/** Resolve a path to absolute. Does NOT validate security — use resolveWithinRoot for that. */
export function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

/** Validate and resolve a project root path. */
export const validatePath = resolvePath;

/** Validate that a path is a valid Godot project root (contains project.godot). */
export function validateProjectRoot(p: string): string {
  const resolved = resolvePath(p);
  if (!existsSync(join(resolved, 'project.godot'))) {
    throw new PathError('Not a valid Godot project (no project.godot found)');
  }
  return resolved;
}

// ─── Project path resolution (shared with ToolDispatcher) ────────────────────

/** 5min TTL cache — project path rarely changes mid-session */
let _resolvedProjectPath: string | undefined;
let _resolvedProjectPathTime = 0;
const PROJECT_PATH_CACHE_TTL_MS = 300_000;

/**
 * Resolve project path with priority chain:
 * 1. explicitPath (tool call argument) → use directly, no validation
 * 2. GODOT_PROJECT_PATH env → validate project.godot exists
 * 3. cwd upward search → find project.godot (max 30 levels)
 * 4. None → return undefined (caller decides error handling)
 *
 * Results are cached for 30s (PROJECT_PATH_CACHE_TTL_MS).
 */
export function resolveProjectPath(explicitPath?: string): string | undefined {
  if (explicitPath) return explicitPath;

  const now = Date.now();
  if (_resolvedProjectPathTime > 0 && now - _resolvedProjectPathTime < PROJECT_PATH_CACHE_TTL_MS) {
    return _resolvedProjectPath;
  }

  const rawEnvPath = process.env.GODOT_PROJECT_PATH;
  if (rawEnvPath) {
    const envPath = resolvePath(rawEnvPath); // normalize relative → absolute
    if (existsSync(join(envPath, 'project.godot'))) {
      _resolvedProjectPath = envPath;
      _resolvedProjectPathTime = now;
      return envPath;
    }
    getLogger().warn('godot-mcp', `GODOT_PROJECT_PATH="${rawEnvPath}" does not contain project.godot, ignoring`);
  }

  let dir = process.cwd();
  const searchedPaths: string[] = [];
  for (let i = 0; i < 30; i++) {
    if (existsSync(join(dir, 'project.godot'))) {
      _resolvedProjectPath = dir;
      _resolvedProjectPathTime = now;
      return dir;
    }
    searchedPaths.push(dir);
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  getLogger().warn('godot-mcp', `resolveProjectPath: no project.godot found. Searched: ${searchedPaths.join(' → ')}`);
  _resolvedProjectPath = undefined;
  _resolvedProjectPathTime = now;
  return undefined;
}

/** Reset cache state (test-only). */
export function _resetProjectPathCache(): void {
  _resolvedProjectPath = undefined;
  _resolvedProjectPathTime = 0;
}

// ─── Symlink-safe path resolution ─────────────────────────────────────────────

/** Safely resolve real path — walks up to find existing ancestor for symlink resolution. */
export function safeRealPath(p: string, base?: string): string {
  try { return realpathSync(p); } catch {
    let current = resolvePath(p);
    const trailing: string[] = [];
    while (!existsSync(current)) {
      trailing.unshift(basename(current));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    let resolvedAncestor: string;
    try { resolvedAncestor = realpathSync(current); } catch (err) {
      // PII 护栏:err.message(可能含路径)只 log 到 server 端,不进 client 响应(safeMessage 是固定文本)。
      getLogger().debug('path-utils', `realpath failed: ${err instanceof Error ? err.message : err}`);
      throw new PathError('Cannot resolve real path during symlink resolution');
    }
    const resolved = trailing.length > 0 ? join(resolvedAncestor, ...trailing) : resolvedAncestor;
    if (base) {
      const rel = relative(base, resolved);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new PathError('Path traversal detected in fallback resolution');
      }
    }
    return resolved;
  }
}

// ─── Path traversal protection ────────────────────────────────────────────────

/**
 * Resolve userPath within root, blocking traversal attacks.
 *
 * Security layers: UNC path reject → Windows device name reject →
 * iterative URL decode → `..` segment reject → realpath + relative check.
 *
 * NOTE: TOCTOU window exists between symlink check and actual use —
 * accepted risk for local-only scenarios.
 */
export function resolveWithinRoot(root: string, userPath: string): string {
  const base = safeRealPath(resolvePath(root));

  if (/^\\\\[^\\]/.test(userPath)) {
    throw new PathError('Path traversal detected');
  }

  const leafName = userPath.replace(/\\/g, '/').split('/').pop() || '';
  const baseName = leafName.replace(/\.[^.]*$/, '');
  if (WINDOWS_DEVICE_RE.test(baseName)) {
    throw new PathError('Path traversal detected');
  }

  let decoded: string;
  try {
    decoded = iterativeDecode(userPath);
  } catch {
    throw new PathError('Path traversal detected');
  }

  const normalizedPath = decoded.replace(/\\/g, '/');
  // F-4: 段级精确匹配,避免误拒含 ".." 的合法文件名(my..file.txt、..hidden、foo/..bar)
  // 子串匹配会 over-block;第180行 realpath+relative 兜底仍保留作纵深防御
  const segments = normalizedPath.split('/');
  if (segments.some(s => s === '..')) {
    throw new PathError('Path traversal detected');
  }
  const resolved = resolve(base, normalizedPath);
  const realResolved = safeRealPath(resolved, base);
  const rel = relative(base, realResolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathError('Path traversal detected');
  }
  return realResolved;
}

// ─── Project path utilities ───────────────────────────────────────────────────

export function normalizeUserProjectPath(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('res://')) return trimmed.slice('res://'.length);
  return trimmed;
}

// 动态 Roots 授权源（client 经 MCP Roots 协议注入，GodotServer.oninitialized 调用）。
// null = 未注入 → getAllowedProjectPaths() 回落 env。
//
// 命中 DEFECT.module-level-mutable-state(open, ADVISORY) 形态（test/regression/defects.ts:483，
// detect = countMatchesInDir('src', /^let _/gm, /\.ts$/)）。同步单线程访问无真实竞态，
// 参照 src/core/call-recorder.ts:30 注释块先例（CallRecorder._instance 单例同模式，已标注）。
let _dynamicRoots: string[] | null = null;

/**
 * 注入 client Roots 授权源。非空 → 整体替换 env；null/空 → 清空回落 env。
 * 注入期只按 URI scheme 过滤（file://，见 parseFileRootUris），不过滤路径存在性——
 * 存在性延迟到 isPathInAllowedRoots 的 safeRealPath（与 env 分支对齐，兼容"待创建新项目"）。
 */
export function setAllowedRootsFromClient(roots: string[] | null): void {
  _dynamicRoots = roots && roots.length > 0 ? roots : null;
}

/** 查询是否处于 client Roots 注入态（区别于 env 非空）。GodotServer re-fetch 决策用。 */
export function hasDynamicRoots(): boolean {
  return _dynamicRoots !== null;
}

/**
 * 解析 MCP Roots 的 URI 为本地路径。只接受 file:// scheme，跳过非法 URI。
 * 不过滤路径存在性（与 env 注入期一致，存在性交 check 期 safeRealPath）。
 */
export function parseFileRootUris(roots: Array<{ uri: string }>): string[] {
  const out: string[] = [];
  for (const r of roots) {
    if (typeof r?.uri !== 'string' || !r.uri.startsWith('file://')) continue;
    try { out.push(fileURLToPath(r.uri)); } catch { /* 非法 URI 跳过 */ }
  }
  return out;
}

export function getAllowedProjectPaths(): string[] {
  if (_dynamicRoots !== null) return _dynamicRoots;  // 动态 Roots 优先（整体替换 env）
  const env = process.env.ALLOWED_PROJECT_PATHS;     // 兜底（不支持 Roots 的客户端）
  if (!env) return [];
  return env.split(';').filter(Boolean).map(p => resolvePath(p));
}

const _pathAllowLogged = new Set<string>();

function ensureSep(p: string): string {
  return p.endsWith(sep) ? p : p + sep;
}

/**
 * Check whether a requested path is within allowed project roots.
 *
 * Priority (highest wins):
 * 1. GODOT_MCP_UNRESTRICTED=true → allow everything (dev mode)
 * 2. ALLOWED_PROJECT_PATHS=/path1;/path2 → allow only listed roots + children
 * 3. No config → restrict to process.cwd() (deny-by-default)
 *
 * C-07: Changed from allow-by-default to deny-by-default.
 * Users must explicitly opt in via ALLOWED_PROJECT_PATHS or GODOT_MCP_UNRESTRICTED.
 */
export function isPathInAllowedRoots(requestedPath: string): boolean {
  if (process.env.GODOT_MCP_UNRESTRICTED === 'true') {
    if (!_pathAllowLogged.has('unrestricted')) {
      getLogger().info('security', 'GODOT_MCP_UNRESTRICTED=true — all path restrictions bypassed');
      _pathAllowLogged.add('unrestricted');
    }
    // A-10: Debug-level audit log for every path access in unrestricted mode
    getLogger().debug('security', `UNRESTRICTED path access: ${requestedPath}`);
    return true;
  }
  // C-1 (2026-06-24 审查 Critical) + C-SEC-1: requestedPath 与 allowlist 条目都先 realpath
  // 归一化,再 normalize 消除 ".." 与混合分隔符。原实现只 normalize 不解析 reparse 点——
  // allowlist 内建 junction(Windows 普通用户权限即可,区别于 symlink)指向外部目录时,
  // startsWith(root) 前缀匹配放行;而下游 resolveWithinRoot 的 base=safeRealPath(root) 又把
  // base realpath 成 reparse 目标,relative(target, target/child) 不以 ".." 开头 → 读写
  // allowlist 外任意文件。两层 realpath 后:requestedPath 的 junction 解析到外部 → 不在
  // allowlist → 拒绝;allowlist 条目若本身是 junction 也解析到真实目标,避免合法访问被误拒。
  // safeRealPath 对不存在路径向上找存在祖先再 realpath(尾部字面拼接),兼顾"待创建新文件"场景。
  // TOCTOU(I-3 审查补注):同 resolveWithinRoot(:150 注释),safeRealPath 归一化后到实际写文件前,
  // 父段仍可能被换 symlink。本检查是本地单用户信任场景的安全边界,非多用户/不可信输入硬隔离。
  const requested = normalize(safeRealPath(resolvePath(requestedPath)));
  const allowed = getAllowedProjectPaths();
  if (allowed.length === 0) {
    // C-07: deny-by-default — restrict to cwd when no explicit allowlist configured.
    // Users must set ALLOWED_PROJECT_PATHS=/path1;/path2 or GODOT_MCP_UNRESTRICTED=true
    // to access paths outside cwd.
    if (!_pathAllowLogged.has('cwd-fallback')) {
      getLogger().warn('security',
        'ALLOWED_PROJECT_PATHS not configured — restricting to process.cwd(). ' +
        'Set ALLOWED_PROJECT_PATHS=/path1;/path2 for explicit control, ' +
        'or GODOT_MCP_UNRESTRICTED=true to disable restrictions.');
      _pathAllowLogged.add('cwd-fallback');
    }
    const cwd = normalize(safeRealPath(resolvePath('.')));
    return requested === cwd || requested.startsWith(ensureSep(cwd));
  }
  return allowed.some(p => {
    let normP: string;
    try {
      normP = normalize(safeRealPath(resolvePath(p)));
    } catch (err) {
      // I-4 (审查反馈): allowlist 条目祖先 realpathSync 失败(权限/reparse)时 safeRealPath :128 throw,
      // 原冒泡到 ToolDispatcher:464 导致整个校验抛错。该条目视为不匹配,不影响其他条目。
      getLogger().warn('security', `Allowlist entry realpath failed, skipping: ${p} — ${err instanceof Error ? err.message : err}`);
      return false;
    }
    return requested === normP || requested.startsWith(ensureSep(normP));
  });
}

/** Reset log state (test-only). */
export function _resetPathAllowWarned(): void { _pathAllowLogged.clear(); }
