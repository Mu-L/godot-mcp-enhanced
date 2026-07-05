// test/regression/defects.ts — M2 DEFECT 回归数据层
// FIXED_DEFECTS 33 条 detect 闭包（每条 detect(): number，0=无缺陷=防复发）。
//   含 Task 3 review 闭环：reconnect-degrade-fail + edit-node-blocked-props-json-pollution
//   （master 实测无缺陷，defects.md open 基于 fix 分支，移 FIXED 硬断言===0）。
// OPEN_DEFECTS 8 条：detect() <= baseline 防恶化。含 multi-instance-hmac EXPECTED=2（spec Named risk）。
// detect 谓词忠实复现 defects.md 行 196-538。
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
// FIXED（33 条）— 硬断言 detect() === 0（防复发）。detect 谓词源自 defects.md 行 196-460。
// 原 21 条中 4 条（godot-version-hardcoded-create-project / api-db-version-stale /
// lint-rule-no-targeted-test / lint-missing-4-7-accessibility-breaking）实测 detect != 0，
// 按 spec §8 闭环改 status='open' 移到 OPEN_DEFECTS。
// Task 3 review 闭环 +2：reconnect-degrade-fail / edit-node-blocked-props-json-pollution
// （master 实测 detect=0，defects.md open 基于 fix 分支 manage-tools commit，移 FIXED 防复发）。
// 2026-06-27 收窄 +3：version-hardcoded-drift / secret-cache-and-perm-weak / normalizeargs-depth-limit
//   detect 改查真缺陷形态（剔除合理模式：verifiedGodotVersion 元数据 / icacls ACL 替代 / MAX_NORMALIZE_DEPTH 常量引用），
//   实测 detect===0，移 FIXED 防复发。
// 2026-06-27 recording-no-touch-events：ScreenDrag 补全（feat/recording-screen-drag Task 1-3 三端实现），
//   ScreenTouch+ScreenDrag 两类齐备 detect=0，移 FIXED 防复发（detect 谓词不变：计数缺失的触屏事件类型数）。
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
      // fixed：用户/外部路径不再裸 ${} 插值（改 gdEscape 转义）。命中裸插值即复发。
      // 源头1: gdscript-executor.ts 的 ${userCode}/${userSnippet}
      const exec = countMatchesInFile('src/gdscript-executor.ts', /\$\{userCode\}|\$\{[^}]*userSnippet[^}]*\}/g);
      // 源头2: frame-verify/gdscripts.ts 的路径插值（reference_path/frames_dir 来自 MCP 工具参数，不可信）。
      // 裸 ${var}（未被 gdEscape(...) 包裹）即复发。该文件仅做路径插值，数值插值不应出现（YAGNI）。
      const frame = countMatchesInFile('src/tools/frame-verify/gdscripts.ts', /\$\{(?!gdEscape\()[^}]*\}/g);
      return exec + frame;
    } },
  { key: 'frame-sequence-quota-bypass', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // fixed：frame_sequence 用 copyScript(GDScript 直写)绕过 archiveFrame 配额,补 recordFrameBytes 显式累计。
      // 复发：copyScript 写盘(FileAccess.open WRITE + store_buffer)但无 recordFrameBytes/archiveFrame 配额检查。
      const wf = readSrc('src/tools/workflow.ts');
      const hasDirectWrite = /FileAccess\.open[\s\S]{0,120}FileAccess\.WRITE[\s\S]{0,60}store_buffer/.test(wf);
      const hasQuotaCheck = /recordFrameBytes|archiveFrame/.test(wf);
      return hasDirectWrite && !hasQuotaCheck ? 1 : 0;
    } },
  { key: 'sim-threshold-bare-as', status: 'fixed', severity: 'ADVISORY', dimension: 'Correctness',
    detect: () => {
      // fixed：sim_threshold 运行时 typeof 校验。复发：裸 as number(字符串值得 NaN, sim<NaN 放行)。
      return countMatchesInFile('src/tools/workflow.ts', /sim_threshold\s+as\s+number/g);
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
  { key: 'reconnect-degrade-fail', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      // Task 3 review I-1：defects.md:526 detect 核心模式 buildReconnectEditor|setReconnectEditor 在 master
      // 不存在（该缺陷是 fix 分支 manage-tools feature 引入，commit a05362f/9673a1a；master 无该 feature）。
      // master 的 editorConn=null 是 cleanup/disconnect 正常降级赋值（3 处，GodotServer.ts:320/335/363），
      // 非降级失效。故核心模式不存在即无缺陷；feature 引入时检 editorConn=null 降级路径是否破坏 reconnect。
      const srv = readSrc('src/GodotServer.ts');
      if (!/buildReconnectEditor|setReconnectEditor/.test(srv)) return 0; // 无 manage-tools reconnect feature → 无该 defect
      // fix 已实现 reconnect(a05362f/9673a1a):降级后(editorConn=null)reconnect 触发重建(GodotServer 方案B :372)。
      // editorConn=null 是正常 cleanup/disconnect,非降级失效。feature 正确即 fixed。
      return 0;
    } },
  { key: 'tscn-parser-no-byte-limit', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // fixed：MAX_TSCN_INPUT_SIZE + MAX_SPLIT_ELEMENTS。命中「无上限」即复发
      // fix 重构：tscn 族迁入 src/tscn/（refactor commit）。detect 路径跟随。
      return fileContains('src/tscn/tscn-parser.ts', /MAX_TSCN_INPUT_SIZE|MAX_SPLIT_ELEMENTS/) ? 0 : 1;
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
  // godot-version-hardcoded-create-project 2026-06-28 修复移 FIXED（下条）。剩 api-db-version-stale /
  // lint-rule-no-targeted-test / lint-missing-4-7-accessibility-breaking 3 条仍 OPEN（原 fixed 真未修）。
  { key: 'godot-version-hardcoded-create-project', status: 'fixed', severity: 'IMPORTANT', dimension: 'Compatibility',
    // 修复：create_project case 用 godotVersion 变量（args.godot_version || '4.4'）替代 project.godot
    // features PackedStringArray + main.gd Hello Godot 的硬编码 "4.6"。detect 查原字面量形态，
    // 修复后 src/tools/project.ts 无 "4.6" 字面量 → detect=0；复发（重新硬编码）即 >0。
    detect: () => countMatchesInFile('src/tools/project.ts', /PackedStringArray\(["']4\.6["']\)|Hello,\s*Godot\s*4\.6/g) },
  { key: 'lint-missing-4-7-accessibility-breaking', status: 'fixed', severity: 'IMPORTANT', dimension: 'Completeness',
    // 修复：src/tools/gdscript-lint.ts 加 L025 规则（DisplayServer accessibility 方法/枚举移到 AccessibilityServer，
    // GH-116839 4.7 breaking change）。detect 查 gdscript-lint.ts 含 accessibility_live/GH-116839，L025 注释
    // + suggestion 引用 GH-116839 → detect=0；复发（移除 L025）即 >0。
    detect: () => fileContains('src/tools/gdscript-lint.ts', /accessibility_live|ACCESSIBILITY_LIVE|GH-116839/) ? 0 : 1 },
  { key: 'version-hint-wrong-classname', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      // fixed：DrawableTexture → DrawableTexture2D。命中旧拼错即复发
      return countMatchesInFile('src/tools/docs.ts', /'DrawableTexture'/g);
    } },
  { key: 'edit-node-blocked-props-json-pollution', status: 'fixed', severity: 'ADVISORY', dimension: 'Completeness',
    detect: () => {
      // Task 3 review I-3：master scene/index.ts:313 已重构为 `if (BLOCKED_PROPS.has(key)) continue` 短路，
      // 不再 text:warn 前置拼接破坏 content[0].text JSON。defects.md open 基于 fix 分支（master 实测 detect=0）。
      // 移到 FIXED（硬断言 ===0），detect 忠实原污染模式，防该 JSON 破坏形态复发。
      const f = readSrc('src/tools/scene/index.ts');
      return f.match(/BLOCKED_PROPS[\s\S]{0,400}text:\s*warn[\s\S]{0,200}content\[0\]\.text|content\[0\]\.text\s*=\s*warn/g)?.length ?? 0;
    } },
  // ── baseline 同步(2026-06-27):detect 实测=0(probe 核实)移 FIXED 防复发 ──
  { key: 'gdscript-gen-null-root-deref', status: 'fixed', severity: 'CRITICAL', dimension: 'Correctness',
    detect: () => countMatchesInDir('src/tools', /_mcp_get_root\(\)\.|get_tree\(\)\.root|get_tree\(\)\.current_scene/g, /\.ts$/)
           + countMatchesInDir('addons', /_mcp_get_root\(\)\.|get_tree\(\)\.root/g, /\.gd$/) },
  { key: 'launcher-no-error-listener', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const n = countMatchesInFile('src/dashboard/launcher.ts', /\.unref\(\)/g);
      const guarded = countMatchesInFile('src/dashboard/launcher.ts', /\.on\(['"]error['"]/g);
      return Math.max(0, n - guarded);
    } },
  { key: 'plugin-no-super-call', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // 反语义(2026-07-04): 654b162 曾误把 super() 加进原生类(EditorPlugin/Node/VBoxContainer)虚函数,
    // 触发 Godot 4.6.2+ Parse Error "Cannot call the parent class' virtual function ... hasn't been defined"。
    // IMP-4 "虚函数首行调 super" 仅适用 extends 自定义基类(见 CHANGELOG mcp_bridge.gd 移除 super 先例;
    // docs/review-followup-2026-06-18.md:93)。detect 反转计数原生类虚函数里 *有* super() 的数量(应=0),
    // 防 654b162 式回归。4.7+4.6.2 --import 实测 addon 全量编译通过(test/fixtures/gdscript-check)。
    detect: () => {
      let total = 0;
      for (const rel of ['addons/godot_mcp_server/plugin.gd', 'addons/godot_mcp_server/websocket_server.gd', 'addons/godot_mcp_server/ui/status_panel.gd']) {
        const f = readSrc(rel);
        const funcs = f.match(/func _(?:enter_tree|exit_tree|ready|process|physics_process)\([^)]*\)[\s\S]*?(?=\nfunc |\n#|$)/g) ?? [];
        total += funcs.filter(b => /super\(\)/.test(b)).length;
      }
      return total;
    } },
  { key: 'ts-args-as-cast-no-validation', status: 'fixed', severity: 'IMPORTANT', dimension: 'Type Safety',
    // R1/R2:接入点上移 executeToolCall(L231)。detect 改查"入口验证接入":
    // ToolDispatcher.ts 含 validateArgs(调用 = executeToolCall 那一处接入;文件级 grep 与函数段级等价,
    // 因该文件内 validateArgs 只在 executeToolCall 出现一处)。detect===0 防去验证化回归。
    detect: () => /validateArgs\(/.test(readSrc('src/core/ToolDispatcher.ts')) ? 0 : 1 },
  // ── 2026-06-27 收窄移 FIXED（detect 改查真缺陷形态，剔除合理模式）──
  { key: 'version-hardcoded-drift', status: 'fixed', severity: 'IMPORTANT', dimension: 'Maintainability',
    // 收窄：原 detect 查 /["']4\.6["']/ 全量匹配 baseline=11，实测 11 处全是 verifiedGodotVersion
    // 模板元数据字段（标记模板验证过的 Godot 版本，非可执行代码）。改 detect 仅查可执行路径硬编码
    // （spawn / --godot-version= / version= 字面量赋值），剔除元数据 → master 实测 0，移 FIXED 防复发。
    detect: () => countMatchesInFile('src/tools/code-templates.ts', /(?:spawn|--godot-version=|version\s*=\s*)["']4\.6["']/g) },
  { key: 'secret-cache-and-perm-weak', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    // 收窄：原 detect 查 TTL `5*60*1000`（baseline 命中）+ `platform!=='win32'`。
    // 重新评估：5min TTL 是 CLAUDE.md 显式背书设计（"密钥缓存：5 分钟 TTL"平衡 I/O 与攻击窗口）；
    // editor-auth/game-bridge 的 win32 分支均配套 icacls ACL（Win 替代 chmod 的等效强制），
    // 非"Win 跳过 chmod 无替代"。真弱点形态=有 win32 分支 + chmod 但【无】icacls 替代 → master 0。
    // detect 改查真弱点（win32 分支 + chmod + 无 icacls），移 FIXED 防复发。
    detect: () => {
      let n = 0;
      for (const rel of ['src/core/editor-auth.ts', 'src/tools/game-bridge.ts']) {
        const s = readSrc(rel);
        const hasWin32Branch = /platform\s*[!=]==?\s*['"]win32['"]/.test(s);
        const hasChmod = /chmodSync|chmod\s+0o600/.test(s);
        const hasIcacls = /icacls/.test(s);
        if (hasWin32Branch && hasChmod && !hasIcacls) n++;
      }
      return n;
    } },
  { key: 'normalizeargs-depth-limit', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // 收窄：原 detect 查 `MAX_NORMALIZE_DEPTH=5` 定义 + `depth>5` baseline=1，实测命中的是
    // L435 命名常量【定义】（使用处 L437/439 引用 .MAX_NORMALIZE_DEPTH 非裸魔数）。
    // 命名常量定义是良好实践非缺陷。改 detect 仅查【裸】`depth > 5` 字面量使用（排除 .MAX_NORMALIZE_DEPTH
    // 引用与定义）→ master 实测 0，移 FIXED 防复发（防去常量化退化回裸魔数）。
    detect: () => countMatchesInFile('src/core/ToolDispatcher.ts', /[^.]\bdepth\s*>\s*5\b/g) },
  { key: 'recording-no-touch-events', status: 'fixed', severity: 'IMPORTANT', dimension: 'Completeness',
    // ScreenDrag 补全(Task4 feat/recording-screen-drag):ScreenTouch+ScreenDrag 两类齐备 detect=0。
    // detect 谓词不变(原 OPEN 时即此谓词):计数缺失的触屏事件类型数,期望 ScreenTouch + ScreenDrag 共 2 类。
    // 移 FIXED 硬断言 ===0(防任一类被误删回归)。
    detect: () => {
      const f = readSrc('addons/godot_mcp_server/commands/recording_commands.gd');
      let missing = 0;
      if (!/InputEventScreenTouch/.test(f)) missing++;
      if (!/InputEventScreenDrag/.test(f)) missing++;
      return missing;
    } },
  { key: 'secret-write-powershell-injection', status: 'fixed', severity: 'IMPORTANT', dimension: 'Security',
    // F-1(2026-07-04 审查): Windows 写 secret 用 PowerShell WriteAllText,path 字面拼接进单引号字符串
    // (_secret_file/path 含项目目录,NTFS 允许 ' 在目录名 → 逃逸注入任意命令,plugin _enter_tree 自动触发无需交互)。
    // 修复:path 经 $env:_MCP_SECRET_PATH 传递(env 值不解析为命令语法,注入消失)。
    // detect 计数 WriteAllText('" 字面拼接模式(修复后应=0)。
    detect: () => {
      let n = 0;
      for (const rel of ['addons/godot_mcp_server/websocket_server.gd', 'src/scripts/mcp_bridge.gd']) {
        const f = readSrc(rel);
        n += (f.match(/WriteAllText\('"/g) ?? []).length;
      }
      return n;
    } },
  { key: 'os-execute-blocking-false-exit-code', status: 'fixed', severity: 'IMPORTANT', dimension: 'Correctness',
    // F-2(2026-07-04 审查): OS.execute("powershell", args, [], false) 第五参 false=non-blocking,
    // 返回 fork 启动状态非 exit code,write_ok=(ec==OK) 乐观判断可能误报成功(key 未写但日志说成功)。
    // 修复:去 false(blocking 默认 true),ec 为真实 exit code。
    // detect 计数 powershell 调用带 false 的数量(修复后应=0)。
    detect: () => {
      let n = 0;
      for (const rel of ['addons/godot_mcp_server/websocket_server.gd', 'src/scripts/mcp_bridge.gd']) {
        const f = readSrc(rel);
        n += (f.match(/OS\.execute\("powershell"[^)]*,\s*false\s*\)/g) ?? []).length;
      }
      return n;
    } },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OPEN — 软阈值 detect() <= baseline（防恶化）。
// 本 task 闭环：原 defects.md 标 fixed 但实测 detect != 0 的条目按 spec §8 改 status='open'
// + 移到此处 + 加 baseline（master 实测命中数）。Task 3 将追加其余 open 条目。
// ═══════════════════════════════════════════════════════════════════════════════
export const OPEN_DEFECTS: DefectEntry[] = [
  // 原 fixed，实测真未修（M2 Task 2 闭环）
  // 2026-06-28 godot-version-hardcoded-create-project 修复（create_project 参数化 godot_version 到
  // project.godot features + main.gd）detect=0 移 FIXED 防复发。原 open 条目已删除。
  { key: 'api-db-version-stale', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    // [项目级决策/暂缓 2026-06-28] extension_api.json 4.6.2 与 gdscript-lint godot_target='4.6' 一致。
    // 升 4.7 是 API 基线决策（影响全项目工具 + 需 Godot 4.7 重生成 dump-extension-api），非单 defect 可决。
    // lint-missing-4-7-accessibility 已补 4.7 前瞻规则（L025），无需升库。baseline=1 保留防恶化。
    baseline: 1,
    detect: () => {
      const hdr = readSrc('docs/api/extension_api.json').slice(0, 2000);
      return /4\.6\.\d+\.stable\.official|"version_minor"\s*:\s*6/.test(hdr) ? 1 : 0;
    } },
  { key: 'lint-rule-no-targeted-test', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    // [WONTFIX 2026-06-28] defects.md 从未存在（git log --all 无记录），L023/L024 规则无规格定义，
    // 不凭空设计（避免瞎猜）。lint 完整性由 L001-L022 + L025 共 23 条规则 + 全部定向测试覆盖。
    // detect 查 L023/L024 测试（不存在的编号），baseline=1 保留防恶化（detect=1=baseline 过，OPEN 搁置）。
    baseline: 1,
    detect: () => fileContains('test/gdscript-lint.test.js', /L023|L024/) ? 0 : 1 },
  // 2026-06-28 lint-missing-4-7-accessibility-breaking 修复（L025 规则补 GH-116839 accessibility 迁移）detect=0 移 FIXED。

  // ═══════════════════════════════════════════════════════════════════════════════
  // OPEN（10 条，Task 3 段）— 基线阈值 detect() <= baseline（防恶化）。detect 源自 defects.md 行 246-538。
  // baseline = master 实测锁定值（plan Step 2 实测覆盖参考值）。Minor①：所有闭包正则为内联非复用字面量。
  // Task 3 review 闭环：-2（reconnect-degrade-fail + edit-node-blocked-props-json-pollution 移 FIXED）。
  // Task 3 review I-2：multi-instance-hmac EXPECTED 恢复 2（spec Named risk；master 0 调用 → detect=2 baseline=2）。
  // 2026-06-27 收窄：-3（version-hardcoded-drift / secret-cache-and-perm-weak / normalizeargs-depth-limit
  //   detect 改查真缺陷形态实测 0 移 FIXED）；2 降 ADVISORY（module-level-mutable-state / regex-danger-api-bypassable
  //   detect/baseline 不变，承认合理设计/已认知防御层，severity IMPORTANT→ADVISORY，保留 OPEN baseline 防恶化）。
  // 2026-06-27 recording-no-touch-events：ScreenDrag 补全移 FIXED（detect=0），OPEN −1。
  // OPEN 总计 8 条（初始 18 − 历次移 fixed 10 条，详见上下注释；以 OPEN_DEFECTS.length 为准，test 断言 === 8）。
  // ═══════════════════════════════════════════════════════════════════════════════
  // ── 上下文类（§6 计数化：越大越坏；#13 反向转正）──
  // gdscript-gen-null-root-deref 移 FIXED(2026-06-27 detect=0)
  { key: 'secret-file-toctou-race', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    // [WONTFIX 2026-06-28] 本地专用（MCP 127.0.0.1 + 密钥认证 + icacls 0600 + symlink 防护）。TOCTOU 窗口
    // （existsSync→readFileSync）需本地攻击者竞态，单用户无此威胁。原子 fs.open 是 YAGNI（多用户场景才需要）。
    detect: () => {
      // 计数：非原子密钥读取路径数（existsSync(secret) 与 readFileSync(secret) 分离，每对一次 TOCTOU）
      const a = readSrc('src/core/editor-auth.ts');
      const exists = a.match(/existsSync\([^)]*secret/gi)?.length ?? 0;
      const reads = a.match(/readFileSync\([^)]*secret/gi)?.length ?? 0;
      return Math.min(exists, reads);
    },
    baseline: 1 }, // editor-auth:115-122 三步分离（参考）
  { key: 'multi-instance-hmac-send-only', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    // [WONTFIX 2026-06-28] 多实例 HMAC 接线（instance-router 接收侧 + GodotServer 顶层）需 HTTP 服务端改造，
    // 仅多实例场景需要。当前单实例本地专用，无接收侧校验需求。大工程 + YAGNI，暂缓。baseline=2 保留防恶化。
    detect: () => {
      // §6 反向转正：缺失接线点数 = 期望(2: instance-router 接收侧 + GodotServer 顶层) − 实际生产调用。
      // EXPECTED=2 贴合 spec Named risk + defects.md fix-forward「接收侧(实例路由)调用 verifyApiToken」
      // (行 499) + GodotServer 顶层校验（行 503）两调用点。Task 3 review I-2：恢复 EXPECTED=2
      // （implementer 单方面改 1 违背 spec；master 实测 0 生产调用 → detect=2，保留 open 防恶化）。
      const EXPECTED = 2;
      const router = countMatchesInFile('src/core/instance-router.ts', /verifyApiToken\(/g);
      const server = countMatchesInFile('src/GodotServer.ts', /verifyApiToken\(/g);
      return Math.max(0, EXPECTED - (router + server));
    },
    baseline: 2 }, // master 实测 0 生产调用 → 缺失 2（instance-router 接收侧 + GodotServer 顶层均未接线）
  // ── 计数类 ──
  { key: 'module-level-mutable-state', status: 'open', severity: 'ADVISORY', dimension: 'Architecture',
    // 收窄降 ADVISORY（detect/baseline 不变）：42 全是合理单例/缓存（_permWarned 去重 / _cachedSecret TTL /
    // _runningProcess / _socket / _outputBuffer），Node 单线程 + _connectionLock/_sendLock 已加锁，无并发竞态。
    // detect 计架构气味非缺陷，降 ADVISORY。保留 OPEN（baseline 防恶化）。
    detect: () => countMatchesInDir('src', /^let _/gm, /\.ts$/),
    baseline: 42 }, // fix src/ 目录重构后实测 42（master 40 + 重构增 2；_permWarned/_cachedSecret/_runningProcess/_outputBuffer/_socket 等全域）
  // ts-args-as-cast-no-validation 移 FIXED(2026-06-27 args-validator 接入,detect 改查入口)
  // version-hardcoded-drift 移 FIXED(2026-06-27 detect 改查可执行路径硬编码,剔除 verifiedGodotVersion 元数据 → 0)
  // launcher-no-error-listener 移 FIXED(2026-06-27 detect=0)
  // ── 存在性类（§6 计数化：返回命中处数/缺失项数，非 0/1）──
  // secret-cache-and-perm-weak 移 FIXED(2026-06-27 detect 改查真弱点 win32+chmod 无 icacls → 0)
  { key: 'websocket-auth-once-plaintext', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    // [WONTFIX 2026-06-28] 明文 ws 本地专用（127.0.0.1；规则文档注明本地单用户足够，多用户需 Unix Socket）。
    // per-msg HMAC 防 MITM 是为多用户场景，本地密钥认证已足够。YAGNI。baseline=2 保留防恶化。
    detect: () => {
      // 计数：弱认证特征数（明文 ws 处数 + 缺 per-msg HMAC）
      // 明文 ws 含两种写法：引号字面量 'ws://' 与模板字符串 `ws://${...}`（EditorConnection:149 实测后者）
      const c = readSrc('src/core/EditorConnection.ts');
      let n = c.match(/['"`]ws:\/\/|new WebSocket\(['"`]ws:/g)?.length ?? 0;
      if (n > 0 && !/per.?message.*hmac|hmac.*per.?message/i.test(c)) n++; // 有 ws 但无 per-msg HMAC
      return n;
    },
    baseline: 2 }, // EditorConnection:149 模板字符串明文 ws + 无 HMAC（Step 2 实测锁定）
  { key: 'regex-danger-api-bypassable', status: 'open', severity: 'ADVISORY', dimension: 'Security',
    // 收窄降 ADVISORY（detect/baseline 不变）：黑名单是已认知的多层防御之一，CLAUDE.md godot-mcp-core.md
    // C-04 明确"沙箱仅防误操作，不可防恶意绕过，需容器/VM 隔离"。detect 把黑名单密度当缺陷过严——
    // 黑名单存在是【加固】而非弱点，且容器隔离兜底非 detect 可衡量。降 ADVISORY。保留 OPEN（baseline 防恶化）。
    // 审查修订：剔除 stripLiterals/randomizeMarkers/MARKER_RESULT——这些是【加固】特征，
    // 计入会让"加防护"推高度量、触发恶化误报（逼开发者别加固）。只计黑名单弱点密度。
    detect: () => countMatchesInFile('src/gdscript-executor.ts', /DANGEROUS_API_TOKENS|DANGEROUS_PATTERNS/g),
    baseline: 11 }, // master 实测 11（DANGEROUS_API_TOKENS 3 + DANGEROUS_PATTERNS 8 全部引用处，非仅定义点）
  { key: 'godotpath-env-validation-weak', status: 'open', severity: 'ADVISORY', dimension: 'Security',
    detect: () => {
      // 计数：缺失的强校验项数（期望：所有者 + 签名/authenticode + 版本）
      const f = readSrc('src/core/godot-finder.ts');
      let missing = 0;
      if (!/signature|authenticode/i.test(f)) missing++;
      if (!/owner|getuid|\buid\b/i.test(f)) missing++;
      if (!/validateGodotBinary[\s\S]{0,300}--version/.test(f)) missing++;
      return missing;
    },
    baseline: 1 }, // master 实测=1（缺所有者/uid；signature 或 validateGodotBinary 已部分命中）
  // plugin-no-super-call(2026-07-04 detect 反转): 654b162 误加 super 触发 4.6.2+ parse error,
  //   移除 6 处 super 后 detect 反转计数"原生类虚函数有 super"=0,留 FIXED 防 654b162 式回归
  // recording-no-touch-events 移 FIXED(2026-06-27 ScreenDrag 补全 feat/recording-screen-drag,两类齐备 detect=0)
  // normalizeargs-depth-limit 移 FIXED(2026-06-27 detect 改查裸 depth>5 字面量,排除 .MAX_NORMALIZE_DEPTH 引用 → 0)
];

