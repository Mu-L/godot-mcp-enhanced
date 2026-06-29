import { existsSync, readdirSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runGodotHeadless } from '../core/godot-spawn.js';
import type { GdscriptReport } from './types.js';

// ===== 可单测纯函数 =====

const RE_ERROR = /^(?:SCRIPT ERROR:|.*-\s*(?:Parse|Compile) Error:)/;
const RE_WARN = /^(?:WARNING:|.*-\s*Warning:)/;
const MAX_DETAILS = 20;

/** 解析 Godot stdout+stderr → errors/warnings/details。未知行不计数不崩。 */
export function parseGdscriptOutput(combined: string): { errors: number; warnings: number; details: string[]; detailsTotal: number } {
  const errorLines: string[] = [];
  const warnLines: string[] = [];
  for (const line of combined.split('\n')) {
    if (RE_ERROR.test(line)) errorLines.push(line.trim());
    else if (RE_WARN.test(line)) warnLines.push(line.trim());
  }
  const errors = errorLines.length;
  const warnings = warnLines.length;
  const details = [...errorLines, ...warnLines].slice(0, MAX_DETAILS);
  return { errors, warnings, details, detailsTotal: errors + warnings };
}

/** 从源 .gd 文本(传入文件内容 map,避免 IO)提取 class_name 列表 */
export function extractClassNames(files: string[], contents: Record<string, string>): string[] {
  const names: string[] = [];
  for (const f of files) {
    const m = contents[f]?.match(/^\s*class_name\s+(\w+)/m);
    const name = m?.[1];
    if (name) names.push(name);
  }
  return names;
}

/** 递归 glob .gd */
function listGd(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...listGd(p));
    else if (e.name.endsWith('.gd')) out.push(p);
  }
  return out;
}

// ===== main(IO 层) =====

const SRC_ADDON = resolve(process.cwd(), 'addons', 'godot_mcp_server');
const CHECK_PROJECT = resolve(process.cwd(), 'test', 'fixtures', 'gdscript-check');
const CHECK_ADDON = resolve(CHECK_PROJECT, 'addons', 'godot_mcp_server');
const REPORT_OUT = resolve(process.cwd(), 'coverage', 'gdscript-report.json');

function writeReport(r: GdscriptReport): void {
  mkdirSync(dirname(REPORT_OUT), { recursive: true });
  writeFileSync(REPORT_OUT, JSON.stringify(r, null, 2) + '\n', 'utf8');
  process.stdout.write(`gdscript report → ${REPORT_OUT} (errors=${r.errors} warnings=${r.warnings}${r.incomplete ? ' INCOMPLETE' : ''})\n`);
}

async function main(): Promise<void> {
  const godotPath = process.env.GODOT_PATH || '';

  // ① GODOT_PATH 缺失 → incomplete + stderr 告警(IMPORTANT-9b,非静默跳过)
  if (!godotPath || !existsSync(godotPath)) {
    process.stderr.write(
      `[M3c] GODOT_PATH 缺失或不存在 (${godotPath}) — gdscript 检查未执行,产出 incomplete report。\n` +
      `  设置 GODOT_PATH 启用。未设时 gdscript 维度会硬否决(非静默跳过,防 CI 假绿)。\n`,
    );
    writeReport({ errors: 0, warnings: 0, files: 0, details: [], detailsTotal: 0,
                  incomplete: true, reason: `GODOT_PATH 缺失: ${godotPath}` });
    return;
  }

  const srcFiles = listGd(SRC_ADDON);
  const expected = srcFiles.length;

  // ② 复制 addon 进检查项目(每次新拷最新源)
  mkdirSync(CHECK_ADDON, { recursive: true });
  for (const f of srcFiles) {
    const dst = resolve(CHECK_ADDON + f.slice(SRC_ADDON.length));
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(f, dst);
  }

  // ③ runGodotHeadless --import(复用 helper,继承 forceKillTree)
  let result;
  try {
    result = await runGodotHeadless(['--headless', '--import', '--path', CHECK_PROJECT], godotPath, 120_000);
  } catch (e) {
    writeReport({ errors: 0, warnings: 0, files: expected, details: [], detailsTotal: 0,
                  incomplete: true, reason: `spawn 失败: ${(e as Error).message}` });
    return;
  }

  // ④ 解析 stdout+stderr(部分版本错误走 stdout)
  const parsed = parseGdscriptOutput(result.stdout + '\n' + result.stderr);

  // ⑤ false negative 断言:setup 坏 → incomplete(不产出虚假 0/0)
  // files 断言
  const checkFiles = listGd(CHECK_ADDON);
  if (checkFiles.length !== expected) {
    writeReport({ ...parsed, files: checkFiles.length, incomplete: true,
                  reason: `files 断言失败: 检查项目 ${checkFiles.length} ≠ 源 ${expected}` });
    return;
  }
  // class cache 断言(全部源 class_name 在 cache;当前仅 CommandHelpers)
  const srcContents: Record<string, string> = {};
  for (const f of srcFiles) srcContents[f] = readFileSync(f, 'utf8');
  const srcClassNames = extractClassNames(srcFiles, srcContents);
  if (srcClassNames.length > 0) {
    let cache = '';
    try { cache = readFileSync(resolve(CHECK_PROJECT, '.godot', 'global_script_class_cache.cfg'), 'utf8'); } catch { /* 未生成 */ }
    const missing = srcClassNames.filter(n => !cache.includes(n));
    if (missing.length > 0) {
      writeReport({ ...parsed, files: expected, incomplete: true,
                    reason: `class cache 缺: ${missing.join(', ')}(plugin 未加载?)` });
      return;
    }
  }

  // ⑥ 正常产出
  writeReport({ ...parsed, files: expected });
}

// 仅当直接执行(非 import)时跑 main(ESM 版,对齐 cli.ts:10-13 invoked 模式)
const entry = fileURLToPath(import.meta.url);
const arg1 = process.argv[1];
const invoked = arg1 !== undefined && resolve(arg1) === entry;
if (invoked) {
  main().catch(e => { process.stderr.write(`check-gdscript 失败: ${(e as Error).stack ?? e}\n`); process.exit(1); });
}
