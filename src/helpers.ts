import { isAbsolute, resolve, dirname, relative, sep } from 'path';
import { existsSync, mkdirSync } from 'fs';

// ─── Path helpers ────────────────────────────────────────────────────────────

export function validatePath(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

export function resolveWithinRoot(root: string, userPath: string): string {
  const base = validatePath(root);
  const resolved = resolve(base, userPath);
  const rel = relative(base, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }
  return resolved;
}

export function ensureDir(p: string): void {
  if (!existsSync(dirname(p))) {
    mkdirSync(dirname(p), { recursive: true });
  }
}
