/** doctor 命令 — 环境诊断 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { findGodot } from '../core/godot-finder.js';
import { ALL_ADAPTERS } from './clients/index.js';
import { readJsonForCheck } from './clients/json-config.js';

function status(ok: boolean, msg: string): string {
  return ok ? `  ✓ ${msg}` : `  ✗ ${msg}`;
}

// warn 标记(审查 Nit #2):OUT OF SYNC 是 non-blocking 提示,用 ! 而非 ✗(✗ 暗示 error 但 exit 0)
function warn(msg: string): string {
  return `  ! ${msg}`;
}

// ─── Addons 同步检查纯函数(可单测,对齐 check-gdscript.ts listGd 模式) ───

/** 递归列 addons 目录下所有文件(非仅 .gd,含 plugin.cfg/.tscn)。
 *  跳过 symlink 目录(check-gdscript B6 防逃逸,防 symlink 跳出 root)。 */
export function listAddonFiles(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;  // B6:不跟随 symlink(防逃逸出 root)
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...listAddonFiles(p));
    else out.push(p);
  }
  return out;
}

export interface AddonSyncResult {
  inSync: boolean;
  fileCount: number;    // 上游文件数(基准)
  missing: string[];    // 上游有目标无(相对路径)
  differing: string[];  // 两边有但内容不同(相对路径)
  extra: string[];      // 目标有上游无(信息项,不报为不同步)
}

/** 对比上游 vs 目标 addons 目录。内容对比用 readFileSync + ===(addons 文件小无需 hash)。 */
export function compareAddons(upstream: string, target: string): AddonSyncResult {
  const upstreamFiles = listAddonFiles(upstream).map(f => relative(upstream, f).replace(/\\/g, '/'));
  const targetFiles = listAddonFiles(target).map(f => relative(target, f).replace(/\\/g, '/'));
  const upstreamSet = new Set(upstreamFiles);
  const targetSet = new Set(targetFiles);

  const missing = upstreamFiles.filter(f => !targetSet.has(f));
  const extra = targetFiles.filter(f => !upstreamSet.has(f));
  const differing: string[] = [];
  for (const f of upstreamFiles) {
    if (!targetSet.has(f)) continue;  // 已在 missing
    // 行尾归一(审查 Nit #1):仓库 .gitattributes 强制 LF,但目标项目不受管辖,
    // Windows 用户 cp/编辑器写回可能 CRLF。字节级 === 会误报,先统一 \r\n → \n。
    const upContent = readFileSync(join(upstream, f), 'utf-8').replace(/\r\n/g, '\n');
    const tgtContent = readFileSync(join(target, f), 'utf-8').replace(/\r\n/g, '\n');
    if (upContent !== tgtContent) differing.push(f);
  }
  // differing 排序保证输出稳定(测试可断言顺序)
  differing.sort();
  return {
    inSync: missing.length === 0 && differing.length === 0,
    fileCount: upstreamFiles.length,
    missing, differing, extra,
  };
}

// A-09: 区分"未配置"和"配置损坏"两种状态
async function checkClientConfig(adapter: { name: string; isConfigured(projectDir: string): Promise<boolean> }, projectDir: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const ok = await adapter.isConfigured(projectDir);
    return { ok, detail: ok ? 'configured' : 'not configured' };
  } catch {
    return { ok: false, detail: 'config parse error (file may be corrupted)' };
  }
}

export async function runDoctor(_args: string[]): Promise<void> {
  let hasError = false;

  // 上游 addon 定位:从 build/cli/doctor.js 回溯到包根(对齐 router.ts:6 __rootDir 模式)
  const __cliDir = dirname(fileURLToPath(import.meta.url));
  const __pkgRoot = join(__cliDir, '..', '..');
  const UPSTREAM_ADDON = join(__pkgRoot, 'addons', 'godot_mcp_server');

  // 1. Node.js 版本
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]!, 10);
  console.log(status(nodeMajor >= 18, `Node.js ${nodeVersion}${nodeMajor >= 18 ? '' : ' (requires >= 18)'}`));
  if (nodeMajor < 18) hasError = true;

  // 2. Godot 发现
  const projectDir = process.cwd();
  try {
    const godotPath = await findGodot();
    console.log(status(true, `Godot found: ${godotPath}`));
  } catch {
    console.log(status(false, 'Godot not found (set GODOT_PATH)'));
    hasError = true;
  }

  // 2.5. 项目级 Godot 覆盖
  const mcpConfigPath = join(projectDir, '.godot', 'mcp-godot.json');
  const config = readJsonForCheck(mcpConfigPath) as { godot_path?: string } | null;
  if (config?.godot_path) {
    console.log(status(existsSync(config.godot_path), `Project Godot override: ${config.godot_path}`));
  }

  // 3. AI 客户端
  console.log('\nAI Clients:');
  for (const adapter of ALL_ADAPTERS) {
    const installed = await adapter.detect();
    if (!installed) {
      console.log(status(false, `${adapter.name} (${adapter.scope}): not installed`));
      continue;
    }
    // A-09: 区分配置状态
    const { ok, detail } = await checkClientConfig(adapter, projectDir);
    console.log(status(ok, `${adapter.name} (${adapter.scope}): ${detail}`));
  }

  // 4. 项目结构
  console.log('\nProject:');
  const hasProject = existsSync(join(projectDir, 'project.godot'));
  console.log(status(hasProject, `project.godot ${hasProject ? 'found' : 'not found'}`));

  const hasClaudeMd = existsSync(join(projectDir, 'CLAUDE.md'));
  console.log(status(hasClaudeMd, `CLAUDE.md ${hasClaudeMd ? 'found' : 'not found'}`));

  // 5. Addons 同步(上游包 vs 目标项目)— 项目待办 :150
  // warn 不 fail:同步漂移是"可能的问题提示"非环境错误,用户改 addon 后理应手动 cp,不阻断 doctor
  console.log('\nAddons sync:');
  const targetAddon = join(projectDir, 'addons', 'godot_mcp_server');
  if (!existsSync(targetAddon)) {
    console.log(status(true, 'addons/godot_mcp_server not in project (skip sync check)'));
  } else if (!existsSync(UPSTREAM_ADDON)) {
    console.log(status(true, 'upstream addon not accessible (dev mode without package root, skip)'));
  } else {
    const result = compareAddons(UPSTREAM_ADDON, targetAddon);
    if (result.inSync) {
      console.log(status(true, `addons/godot_mcp_server in sync (${result.fileCount} files)`));
    } else {
      // warn 非 fail(审查 Nit #2):用 ! 标记 non-blocking,hasError 不置 true
      console.log(warn(`addons/godot_mcp_server OUT OF SYNC (${result.missing.length} missing, ${result.differing.length} modified, ${result.extra.length} extra) — non-blocking`));
      for (const f of result.missing) console.log(`      - ${f} (missing in project)`);
      for (const f of result.differing) console.log(`      ~ ${f} (content differs from upstream)`);
    }
  }

  if (hasError) process.exit(1);
}
