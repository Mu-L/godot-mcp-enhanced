// src/capability/diff-matrix.ts
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { registerAllModules } from '../core/module-loader.js';
import { extractCapabilities } from './extract.js';
import type { SecurityLevel, ToolCapability } from './schema.js';

/** 漂移报告：对比基线与当前矩阵的四维差异。 */
export interface DriftReport {
  added: string[];
  removed: string[];
  contractChanges: string[]; // requiredParams 增减
  securityLevelDowngrades: { name: string; from: SecurityLevel; to: SecurityLevel }[];
  hasDrift: boolean;
}

/** 安全等级危险度排名：值越大越危险。降级 = rank 升高。 */
const LEVEL_RANK: Record<SecurityLevel, number> = {
  safe: 0,
  guarded: 1,
  'danger-api': 2,
};

/**
 * 纯函数：对比两份能力矩阵，产出漂移报告。
 * 只查 4 维：added / removed / contractChanges / securityLevelDowngrades。
 * 不查 gdScriptImpl（editor 实现路径属元数据，非契约字段，不参与 drift）。
 */
export function diffMatrices(prev: ToolCapability[], curr: ToolCapability[]): DriftReport {
  const prevMap = new Map(prev.map((c) => [c.name, c]));
  const currMap = new Map(curr.map((c) => [c.name, c]));

  const added = [...currMap.keys()].filter((n) => !prevMap.has(n)).sort();
  const removed = [...prevMap.keys()].filter((n) => !currMap.has(n)).sort();

  const contractChanges: string[] = [];
  const securityLevelDowngrades: { name: string; from: SecurityLevel; to: SecurityLevel }[] = [];

  for (const [name, c] of currMap) {
    const p = prevMap.get(name);
    if (!p) continue;
    // 契约变更：requiredParams 集合不同（排序后字符串比较）
    const pReq = [...p.requiredParams].sort().join(',');
    const cReq = [...c.requiredParams].sort().join(',');
    if (pReq !== cReq) contractChanges.push(name);
    // 安全降级：危险度排名升高
    if (LEVEL_RANK[c.securityLevel] > LEVEL_RANK[p.securityLevel]) {
      securityLevelDowngrades.push({ name, from: p.securityLevel, to: c.securityLevel });
    }
  }

  const hasDrift =
    added.length + removed.length + contractChanges.length + securityLevelDowngrades.length > 0;

  return { added, removed, contractChanges, securityLevelDowngrades, hasDrift };
}

/** 从 git HEAD 读取已提交的基线矩阵；无基线（首次/未提交）返回 null，不阻断。 */
function readBaseline(projectRoot: string): ToolCapability[] | null {
  try {
    const json = execSync('git show HEAD:docs/capability-matrix.json', {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(json) as { tools?: ToolCapability[] };
    return parsed.tools ?? null;
  } catch {
    return null;
  }
}

/** 入口：对比 HEAD 基线与实时提取的矩阵，漂移时 exit(1)（CI 门）。 */
function main(): void {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const baseline = readBaseline(projectRoot);
  if (!baseline) {
    console.log('[diff-matrix] no committed baseline, skip');
    return;
  }
  registerAllModules();
  const curr = extractCapabilities(projectRoot);
  const report = diffMatrices(baseline, curr);
  console.log(JSON.stringify(report, null, 2));
  if (report.hasDrift) {
    console.error(
      '[diff-matrix] DRIFT DETECTED — run `npm run build-matrix` and commit to update baseline',
    );
    process.exit(1);
  }
  console.log('[diff-matrix] no drift');
}

// 仅当直接执行（非 import）时跑 main。
// Windows 下 import.meta.url 是 file:///D:/.../diff-matrix.js（正斜杠+三斜杠），
// process.argv[1] 是 D:\...\diff-matrix.js（反斜杠），字符串不相等。
// 用 fileURLToPath 把两侧都转 native path 再比较。
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
