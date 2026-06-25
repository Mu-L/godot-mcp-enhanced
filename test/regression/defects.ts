// test/regression/defects.ts — M2 DEFECT 回归数据层
// FIXED_DEFECTS 17 条 detect 闭包（每条 detect(): number，0=无缺陷=防复发）。
// OPEN_DEFECTS 4 条：原 defects.md 标 fixed 但实测真未修（M2 Task 2 spec §8 闭环），含 baseline。
// Task 3 将追加其余 open 条目。detect 谓词忠实复现 defects.md 行 196-460。
import { countMatchesInFile, countMatchesInDir, fileContains, readSrc, PROJECT_ROOT } from './detect-helpers.js';
// ts-gdscript-tool-drift 复用 M1
import { diffMatrices } from '../../src/capability/diff-matrix.js';
import { extractCapabilities } from '../../src/capability/extract.js';
import { registerAllModules } from '../../src/core/module-loader.js';
import type { ToolCapability } from '../../src/capability/schema.js';

export type DefectStatus = 'open' | 'fixed';
export interface DefectEntry {
  key: string;
  status: DefectStatus;
  severity: 'CRITICAL' | 'IMPORTANT' | 'ADVISORY';
  dimension: string;
  /** 缺陷命中度量，0=无缺陷。忠实复现 defects.md 的 detect 谓词。 */
  detect: () => number;
  /** 仅 open：提交时 master 实测命中数，防恶化基线。 */
  baseline?: number;
}

// ─── ts-drift 预注册（detect 复用 M1 diff-matrix）─────────────────────────────
let _tsDriftReady = false;
function ensureTsDriftReady(): void {
  if (_tsDriftReady) return;
  registerAllModules();
  _tsDriftReady = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIXED（17 条）— 硬断言 detect() === 0（防复发）。detect 谓词源自 defects.md 行 196-460。
// 原 21 条中 4 条（godot-version-hardcoded-create-project / api-db-version-stale /
// lint-rule-no-targeted-test / lint-missing-4-7-accessibility-breaking）实测 detect != 0，
// 按 spec §8 闭环改 status='open' 移到 OPEN_DEFECTS。
// ═══════════════════════════════════════════════════════════════════════════════
export const FIXED_DEFECTS: DefectEntry[] = [
  // ── CRITICAL 安全（行 196-264）──
  { key: 'execute-gdscript-sandbox-default-off', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    detect: () => {
      // detect: scanGdscriptSandbox 返回 [] 早退 + 仅 console.warn 不 return 的路径已消除
      // fixed 核心：命中危险模式即 return failure（gdscript-executor.ts）。校验该阻断分支存在
      return fileContains('src/gdscript-executor.ts', /sandboxWarnings\.length\s*>\s*0\s*&&\s*!safetyDisabled/) ? 0 : 1;
    } },
  { key: 'gdscript-template-injection', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    detect: () => {
      // fixed：用户代码不再经 `${userCode}` 模板插值（改数组 join / 转义）。命中裸插值即复发
      return countMatchesInFile('src/gdscript-executor.ts', /\$\{userCode\}|\$\{[^}]*userSnippet[^}]*\}/g);
    } },
  { key: 'spawn-without-buildsafeenv', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    detect: () => {
      // detect: 裸 spawn Godot 二进制处（runtime.ts/scene.ts/batch-tools.ts/workflow.ts 未走 buildSafeEnv）
      const bare = countMatchesInDir('src/tools', /spawn\(/g, /(runtime|scene|batch-tools|workflow)\.ts$/);
      const safe = countMatchesInDir('src/tools', /buildSafeEnv/g, /(runtime|scene|batch-tools|workflow)\.ts$/);
      return Math.max(0, bare - safe); // 有 spawn 但无 buildSafeEnv 配对即复发
    } },
  { key: 'windows-secret-acl-silent-failure', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    detect: () => {
      // fixed：icacls 失败不再被吞（checkFilePermissions 不恒 true）。命中「win32 恒 return true」即复发
      // 复发模式：`platform !== 'win32') ... return true`（旧版跳过 win32 直接放行）
      const auth = readSrc('src/core/editor-auth.ts');
      return /platform\s*!==\s*['"]win32['"]\s*\)[\s\S]{0,40}return\s+true/.test(auth) ? 1 : 0;
    } },
  { key: 'confirm-token-trust-broken', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    detect: () => {
      // fixed：GUARDED 扩展 + token TTL。命中「substring(0, 200) 截断 + 明文回传」即复发
      return countMatchesInFile('src/guard.ts', /substring\(0,\s*200\)/g);
    } },
  { key: 'ts-gdscript-tool-drift', status: 'fixed', severity: 'CRITICAL', dimension: 'Architecture',
    detect: () => {
      // 复用 M1 diff-matrix：实时提取 vs committed 基线，hasDrift 即复发。
      // capability-matrix.json 的 tools 是完整 ToolCapability[]（build-matrix 写入），
      // diffMatrices 比 requiredParams/securityLevel 需完整结构，故 committed 类型为 ToolCapability[]，不用 as never
      // （否则 committed 字段 undefined 会误报所有工具 contractChange）。
      ensureTsDriftReady();
      const live = extractCapabilities(PROJECT_ROOT);
      let committed: ToolCapability[] = [];
      try { committed = (JSON.parse(readSrc('docs/capability-matrix.json')).tools ?? []) as ToolCapability[]; } catch { return 1; }
      return diffMatrices(committed, live).hasDrift ? 1 : 0;
    } },
  { key: 'gdscript-gen-mixed-indent', status: 'fixed', severity: 'CRITICAL', dimension: 'Correctness',
    detect: () => {
      // fixed：TS 拼接 GDScript 统一 \t。defects.md 行 254「rg ^    [^\s] src/tools/*.ts 找 4 空格缩进」+
      // 「header 辅助函数块最易中招」。原命令会把正常 TS 4 空格缩进也算进（false positive），故忠实缺陷
      // 意图：仅查 GDScript 生成器（gdscript-templates/gdscript-executor/gdscript-lint）模板字符串字面量
      // 内出现「行首 4 空格 + GD 关键字」即复发（生成代码改回空格缩进）。claudemd-builder 等非 GD 生成器不计。
      const gdKw = /\b(func|var|const|pass|return|elif|class_name|extends|enum|match)\b/;
      const targets = ['src/tools/shared/gdscript-templates.ts', 'src/gdscript-executor.ts', 'src/tools/gdscript-lint.ts'];
      let total = 0;
      for (const rel of targets) {
        const src = readSrc(rel);
        if (!src) continue;
        const literals = src.match(/`[\s\S]*?`/g);
        if (!literals) continue;
        for (const lit of literals) {
          for (const line of lit.split('\n')) {
            if (/^ {4}\S/.test(line) && gdKw.test(line)) total++;
          }
        }
      }
      return total;
    } },
  { key: 'set-prop-no-type-whitelist', status: 'fixed', severity: 'CRITICAL', dimension: 'Security',
    detect: () => {
      // fixed：ClassDB.instantiate 加类型白名单。命中「ClassDB.instantiate( 吃用户串无白名单」即复发
      const addons = countMatchesInDir('addons', /ClassDB\.instantiate\s*\(/g, /\.gd$/);
      const whitelist = countMatchesInDir('addons', /_validate_node_type|ALLOWED_BASE_TYPES|ALLOWED_CONTROL_TYPES|is_safe_class/g, /\.gd$/);
      return addons > 0 && whitelist === 0 ? 1 : 0; // 有 instantiate 调用但无任何类型白名单守卫即复发
    } },
  // ── IMPORTANT 架构/安全（行 282-381）──
  { key: 'allow-by-default-missing-config', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // fixed：未设白名单 return false。命中「allowed.length === 0 ?? false」放行即复发
      return countMatchesInDir('src', /allowed\.length\s*===\s*0\s*\?\?\s*false|this\.enabled\s*\?\?\s*true/g, /\.ts$/);
    } },
  { key: 'path-sandbox-touctou-bypass', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // fixed：resolveWithinRoot 改 realpathSync。命中「用 resolve 而非 realpathSync」即复发
      const helpers = readSrc('src/helpers.ts');
      const usesResolve = /function\s+(resolveWithinRoot|isSafePath)[\s\S]*?resolve\(/m.test(helpers);
      const usesRealpath = /realpathSync/.test(helpers);
      return (usesResolve && !usesRealpath) ? 1 : 0;
    } },
  { key: 'swallowed-empty-catch', status: 'fixed', severity: 'IMPORTANT', dimension: 'Completeness',
    detect: () => {
      // fixed：空 catch 块消除。命中「catch (e) {}」空块即复发
      return countMatchesInDir('src', /catch\s*\([^)]*\)\s*\{\s*\}/g, /\.ts$/);
    } },
  { key: 'godotserver-responsibility-bloat', status: 'fixed', severity: 'IMPORTANT', dimension: 'Architecture',
    detect: () => {
      // fixed：职责拆分到 ToolDispatcher/module-loader 等。GodotServer.ts 不再聚合 dispatchTool/camelCase
      const srv = readSrc('src/GodotServer.ts');
      const hasDispatch = /\bdispatchTool\b|normalizeArgs\s*\(/.test(srv);
      return hasDispatch ? 1 : 0;
    } },
  { key: 'tscn-parser-no-byte-limit', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // fixed：MAX_TSCN_INPUT_SIZE + MAX_SPLIT_ELEMENTS。命中「无上限」即复发
      return fileContains('src/tscn-parser.ts', /MAX_TSCN_INPUT_SIZE|MAX_SPLIT_ELEMENTS/) ? 0 : 1;
    } },
  { key: 'duplication-across-layers', status: 'fixed', severity: 'ADVISORY', dimension: 'Maintainability',
    detect: () => {
      // fixed：_get_edited_scene_root/_find_node 抽基类仅 1 处。命中 >1 处即复发
      return countMatchesInDir('addons', /func _get_edited_scene_root|func _find_node/g, /\.gd$/);
    } },
  { key: 'array-shift-ring-buffer', status: 'fixed', severity: 'IMPORTANT', dimension: 'Performance',
    detect: () => {
      // fixed：treeChangeBuffer/outputBuffer 改环形或 slice 截断（defects.md 行 371「重点 treeChangeBuffer.shift()」）。
      // 仅盯 tree/output 缓冲的 .shift()；drainEngineQueue / dashboard stateQueue 等非该缺陷范围（不在复发判定内）。
      const tgt = readSrc('src/core/process-state.ts') + readSrc('src/types.ts');
      const shiftHit = /\b(?:treeChangeBuffer|outputBuffer|_outputBuffer)\b[\s\S]{0,200}\.shift\(\)/.test(tgt);
      return shiftHit ? 1 : 0;
    } },
  { key: 'incomplete-cleanup-command-nodes', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      // fixed：command_handler.cleanup 遍历 modules 数组调子命令 cleanup（defects.md 行 379「对照 var _.*_commands 声明核对覆盖」）。
      // 忠实复现：cleanup 函数 + modules 数组 + 循环调 .cleanup()。命中任一缺失即复发
      const ch = readSrc('addons/godot_mcp_server/command_handler.gd');
      const hasCleanup = /func\s+cleanup\s*\(\s*\)\s*->\s*void:/.test(ch);
      const hasModulesLoop = /var\s+modules\s*=\s*\[/.test(ch) && /for\s+\w+\s+in\s+modules:/.test(ch);
      const callsChildCleanup = /has_method\(\s*["']cleanup["']\s*\)[\s\S]*?\.cleanup\(\)/.test(ch);
      return (hasCleanup && hasModulesLoop && callsChildCleanup) ? 0 : 1;
    } },
  // godot-version-hardcoded-create-project / api-db-version-stale / lint-rule-no-targeted-test /
  // lint-missing-4-7-accessibility-breaking：原 defects.md 标 fixed 但实测 detect != 0（真未修），
  // 按 spec §8 闭环改 status='open' 移到 OPEN_DEFECTS（含 baseline）。
  { key: 'version-hint-wrong-classname', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      // fixed：DrawableTexture → DrawableTexture2D。命中旧拼错即复发
      return countMatchesInFile('src/tools/docs.ts', /'DrawableTexture'/g);
    } },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OPEN — 软阈值 detect() <= baseline（防恶化）。
// 本 task 闭环：原 defects.md 标 fixed 但实测 detect != 0 的条目按 spec §8 改 status='open'
// + 移到此处 + 加 baseline（master 实测命中数）。Task 3 将追加其余 open 条目。
// ═══════════════════════════════════════════════════════════════════════════════
export const OPEN_DEFECTS: DefectEntry[] = [
  // 原 fixed，实测真未修（M2 Task 2 闭环）
  { key: 'godot-version-hardcoded-create-project', status: 'open', severity: 'IMPORTANT', dimension: 'Compatibility',
    baseline: 2,
    detect: () => countMatchesInFile('src/tools/project.ts', /config_version\s*=\s*5|PackedStringArray\(["']4\.6["']\)/g) },
  { key: 'api-db-version-stale', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    baseline: 1,
    detect: () => {
      const hdr = readSrc('docs/api/extension_api.json').slice(0, 2000);
      return /4\.6\.\d+\.stable\.official|"version_minor"\s*:\s*6/.test(hdr) ? 1 : 0;
    } },
  { key: 'lint-rule-no-targeted-test', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    baseline: 1,
    detect: () => fileContains('test/gdscript-lint.test.js', /L023|L024/) ? 0 : 1 },
  { key: 'lint-missing-4-7-accessibility-breaking', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    baseline: 1,
    detect: () => fileContains('src/tools/gdscript-lint.ts', /accessibility_live|ACCESSIBILITY_LIVE|GH-116839/) ? 0 : 1 },
];

