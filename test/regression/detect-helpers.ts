// test/regression/detect-helpers.ts
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_ROOT: string = fileURLToPath(new URL('../../', import.meta.url));
/** 项目根（绝对）。默认从 test/regression/ 上两级定位 godot-mcp-enhanced 根。
 *  ESM live binding：_setProjectRootForTest 赋值后，import 侧（defects.ts）与函数内读取均见最新值；真实 string（非 Proxy），可安全传 extractCapabilities。 */
export let PROJECT_ROOT: string = DEFAULT_ROOT;
/** @internal 测试用：覆盖项目根到 tmp fixture。传 undefined 恢复默认。 */
export function _setProjectRootForTest(root: string | undefined): void {
  PROJECT_ROOT = root ?? DEFAULT_ROOT;
}

/** 读取项目根下相对路径文件全文。缺失返回 ''。 */
export function readSrc(relPath: string): string {
  const abs = join(PROJECT_ROOT, relPath);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}

/** 单文件内 pattern 命中数（全局计数，跨行）。缺失文件返回 0。 */
export function countMatchesInFile(relPath: string, pattern: RegExp): number {
  const src = readSrc(relPath);
  if (!src) return 0;
  const matches = src.match(pattern);
  return matches ? matches.length : 0;
}

/** 文件是否含 pattern 命中。 */
export function fileContains(relPath: string, pattern: RegExp): boolean {
  return pattern.test(readSrc(relPath));
}

/** 递归扫描 relDir 下所有路径命中 fileFilter 的文件，合计 pattern 命中数。 */
export function countMatchesInDir(relDir: string, pattern: RegExp, fileFilter: RegExp): number {
  const abs = join(PROJECT_ROOT, relDir);
  if (!existsSync(abs)) return 0;
  let total = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = full.replace(/\\/g, '/');
      if (statSync(full).isDirectory()) walk(full);
      else if (fileFilter.test(rel)) {
        const src = readFileSync(full, 'utf8');
        const m = src.match(pattern);
        if (m) total += m.length;
      }
    }
  };
  walk(abs);
  return total;
}
