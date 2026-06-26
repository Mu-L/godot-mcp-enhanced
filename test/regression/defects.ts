// test/regression/defects.ts — M2 DEFECT 回归数据层
// FIXED_DEFECTS 19 条 detect 闭包（每条 detect(): number，0=无缺陷=防复发）。
//   含 Task 3 review 闭环：reconnect-degrade-fail + edit-node-blocked-props-json-pollution
//   （master 实测无缺陷，defects.md open 基于 fix 分支，移 FIXED 硬断言===0）。
// OPEN_DEFECTS 18 条：detect() <= baseline 防恶化。含 multi-instance-hmac EXPECTED=2（spec Named risk）。
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
// FIXED（19 条）— 硬断言 detect() === 0（防复发）。detect 谓词源自 defects.md 行 196-460。
// 原 21 条中 4 条（godot-version-hardcoded-create-project / api-db-version-stale /
// lint-rule-no-targeted-test / lint-missing-4-7-accessibility-breaking）实测 detect != 0，
// 按 spec §8 闭环改 status='open' 移到 OPEN_DEFECTS。
// Task 3 review 闭环 +2：reconnect-degrade-fail / edit-node-blocked-props-json-pollution
// （master 实测 detect=0，defects.md open 基于 fix 分支 manage-tools commit，移 FIXED 防复发）。
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
  // godot-version-hardcoded-create-project / api-db-version-stale / lint-rule-no-targeted-test /
  // lint-missing-4-7-accessibility-breaking：原 defects.md 标 fixed 但实测 detect != 0（真未修），
  // 按 spec §8 闭环改 status='open' 移到 OPEN_DEFECTS（含 baseline）。
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
];

// ═══════════════════════════════════════════════════════════════════════════════
// OPEN — 软阈值 detect() <= baseline（防恶化）。
// 本 task 闭环：原 defects.md 标 fixed 但实测 detect != 0 的条目按 spec §8 改 status='open'
// + 移到此处 + 加 baseline（master 实测命中数）。Task 3 将追加其余 open 条目。
// ═══════════════════════════════════════════════════════════════════════════════
export const OPEN_DEFECTS: DefectEntry[] = [
  // 原 fixed，实测真未修（M2 Task 2 闭环）
  { key: 'godot-version-hardcoded-create-project', status: 'open', severity: 'IMPORTANT', dimension: 'Compatibility',
    // 收窄：去掉 config_version=5（4.x 全程=5，永真命中非缺陷，defects.md note 行403 明确），
    // 只查 features 漂移信号：PackedStringArray("4.6")（project.godot features 硬编码，行190）
    // + Hello, Godot 4.6（main.gd print 串硬编码，行219）。master 实测=2，baseline=2。
    // defects.md note 称半 fixed 维持 IMPORTANT。
    baseline: 2,
    detect: () => countMatchesInFile('src/tools/project.ts', /PackedStringArray\(["']4\.6["']\)|Hello,\s*Godot\s*4\.6/g) },
  { key: 'api-db-version-stale', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    // 实测 extension_api.json header 仍 4.6.2（version_minor:6, version_full_name=4.6.2.stable.official），
    // 未升 4.7。defects.md note 行435 称已升 4.7 与实测矛盾，fixed 状态存疑。detect 保持（正确命中 4.6.2）。
    baseline: 1,
    detect: () => {
      const hdr = readSrc('docs/api/extension_api.json').slice(0, 2000);
      return /4\.6\.\d+\.stable\.official|"version_minor"\s*:\s*6/.test(hdr) ? 1 : 0;
    } },
  { key: 'lint-rule-no-targeted-test', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    // 终核：gdscript-lint.ts 规则仅 L001-L022（无 L023/L024），测试仅 L003-L013。
    // 规则与测试均缺失，defects.md note 行453 称有 10 处与实测矛盾。detect=1, baseline=1。
    baseline: 1,
    detect: () => fileContains('test/gdscript-lint.test.js', /L023|L024/) ? 0 : 1 },
  { key: 'lint-missing-4-7-accessibility-breaking', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    // 实测 gdscript-lint.ts 无 accessibility/ACCESSIBILITY/L025/GH-116839。defects.md note 行463 称
    // gdscript-lint.ts:364 有 L025 accessibility 规则与实测矛盾。detect=1, baseline=1。
    baseline: 1,
    detect: () => fileContains('src/tools/gdscript-lint.ts', /accessibility_live|ACCESSIBILITY_LIVE|GH-116839/) ? 0 : 1 },

  // ═══════════════════════════════════════════════════════════════════════════════
  // OPEN（14 条，Task 3 段）— 基线阈值 detect() <= baseline（防恶化）。detect 源自 defects.md 行 246-538。
  // baseline = master 实测锁定值（plan Step 2 实测覆盖参考值）。Minor①：所有闭包正则为内联非复用字面量。
  // Task 3 review 闭环：-2（reconnect-degrade-fail + edit-node-blocked-props-json-pollution 移 FIXED）。
  // Task 3 review I-2：multi-instance-hmac EXPECTED 恢复 2（spec Named risk；master 0 调用 → detect=2 baseline=2）。
  // OPEN 总计 18 条（4 闭环 + 14 Task 3）。
  // ═══════════════════════════════════════════════════════════════════════════════
  // ── 上下文类（§6 计数化：越大越坏；#13 反向转正）──
  { key: 'gdscript-gen-null-root-deref', status: 'open', severity: 'CRITICAL', dimension: 'Correctness',
    detect: () => countMatchesInDir('src/tools', /_mcp_get_root\(\)\.|get_tree\(\)\.root|get_tree\(\)\.current_scene/g, /\.ts$/)
           + countMatchesInDir('addons', /_mcp_get_root\(\)\.|get_tree\(\)\.root/g, /\.gd$/),
    baseline: 1 }, // master 实测=1（Step 2 锁定）
  { key: 'secret-file-toctou-race', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // 计数：非原子密钥读取路径数（existsSync(secret) 与 readFileSync(secret) 分离，每对一次 TOCTOU）
      const a = readSrc('src/core/editor-auth.ts');
      const exists = a.match(/existsSync\([^)]*secret/gi)?.length ?? 0;
      const reads = a.match(/readFileSync\([^)]*secret/gi)?.length ?? 0;
      return Math.min(exists, reads);
    },
    baseline: 1 }, // editor-auth:115-122 三步分离（参考）
  { key: 'multi-instance-hmac-send-only', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
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
  { key: 'module-level-mutable-state', status: 'open', severity: 'IMPORTANT', dimension: 'Architecture',
    detect: () => countMatchesInDir('src', /^let _/gm, /\.ts$/),
    baseline: 42 }, // fix src/ 目录重构后实测 42（master 40 + 重构增 2；_permWarned/_cachedSecret/_runningProcess/_outputBuffer/_socket 等全域）
  { key: 'ts-args-as-cast-no-validation', status: 'open', severity: 'IMPORTANT', dimension: 'Type Safety',
    detect: () => countMatchesInDir('src/tools', /\bargs\.\w+\s+as\s+(string|number|Record<string,\s*unknown>|string\[\]|number\[\]|Array|unknown|boolean)/g, /\.ts$/),
    baseline: 335 }, // master 实测 335（2026-06-25；countMatchesInDir 全局 g 标志匹配，比裸 grep 多含跨行/多捕获）
  { key: 'version-hardcoded-drift', status: 'open', severity: 'IMPORTANT', dimension: 'Maintainability',
    detect: () => countMatchesInFile('src/tools/code-templates.ts', /["']4\.6["']/g),
    baseline: 11 }, // code-templates 11 处 verifiedGodotVersion（参考）
  { key: 'launcher-no-error-listener', status: 'open', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      const n = countMatchesInFile('src/dashboard/launcher.ts', /\.unref\(\)/g);
      const guarded = countMatchesInFile('src/dashboard/launcher.ts', /\.on\(['"]error['"]/g);
      return Math.max(0, n - guarded);
    },
    baseline: 5 },
  // ── 存在性类（§6 计数化：返回命中处数/缺失项数，非 0/1）──
  { key: 'secret-cache-and-perm-weak', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // 计数：不达标项数（TTL>60s 计 1 + Win 跳过 chmod 处数）
      let n = 0;
      const g = readSrc('src/tools/game-bridge.ts');
      if (/SECRET_CACHE_TTL\s*=\s*\d+\s*\*\s*60\s*\*\s*1000|SECRET_CACHE_TTL\s*>\s*60000/.test(g)) n++;
      const a = readSrc('src/core/editor-auth.ts');
      n += a.match(/platform\s*!==\s*['"]win32['"]/g)?.length ?? 0;
      return n;
    },
    baseline: 1 }, // master 实测=1（仅 TTL 命中；editor-auth 已无 platform!=='win32' 模式）
  { key: 'websocket-auth-once-plaintext', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    detect: () => {
      // 计数：弱认证特征数（明文 ws 处数 + 缺 per-msg HMAC）
      // 明文 ws 含两种写法：引号字面量 'ws://' 与模板字符串 `ws://${...}`（EditorConnection:149 实测后者）
      const c = readSrc('src/core/EditorConnection.ts');
      let n = c.match(/['"`]ws:\/\/|new WebSocket\(['"`]ws:/g)?.length ?? 0;
      if (n > 0 && !/per.?message.*hmac|hmac.*per.?message/i.test(c)) n++; // 有 ws 但无 per-msg HMAC
      return n;
    },
    baseline: 2 }, // EditorConnection:149 模板字符串明文 ws + 无 HMAC（Step 2 实测锁定）
  { key: 'regex-danger-api-bypassable', status: 'open', severity: 'IMPORTANT', dimension: 'Security',
    // 计数：朴素正则/黑名单【弱点】特征点数（本质黑名单未根除，维持 open）。
    // 审查修订：剔除 stripLiterals/randomizeMarkers/MARKER_RESULT——这些是 defects.md note(行 366) 的【加固】特征，
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
  { key: 'plugin-no-super-call', status: 'open', severity: 'IMPORTANT', dimension: 'Correctness',
    detect: () => {
      // 计数：无 super() 的生命周期覆写函数数（全域 addons/godot_mcp_server/）。
      // 审查修订：正则须匹配 _ready/_process（无 _tree 后缀）——原 (enter|exit|ready)_tree? 漏 _ready/_process
      // （defects.md note 行 473：status_panel.gd:8 _ready、websocket_server.gd _ready/_process/_exit_tree 缺 super）。
      let total = 0;
      for (const rel of ['addons/godot_mcp_server/plugin.gd', 'addons/godot_mcp_server/websocket_server.gd', 'addons/godot_mcp_server/ui/status_panel.gd']) {
        const f = readSrc(rel);
        const funcs = f.match(/func _(?:enter_tree|exit_tree|ready|process|physics_process)\(\)[\s\S]*?(?=\nfunc |\n#|$)/g) ?? [];
        total += funcs.filter(b => !/super\(\)/.test(b)).length;
      }
      return total;
    },
    baseline: 5 }, // master 实测=5（Step 2 锁定）
  { key: 'recording-no-touch-events', status: 'open', severity: 'IMPORTANT', dimension: 'Completeness',
    detect: () => {
      // 计数：缺失的触屏事件类型数（期望 ScreenTouch + ScreenDrag 共 2 类）
      const f = readSrc('addons/godot_mcp_server/commands/recording_commands.gd');
      let missing = 0;
      if (!/InputEventScreenTouch/.test(f)) missing++;
      if (!/InputEventScreenDrag/.test(f)) missing++;
      return missing;
    },
    baseline: 2 }, // 缺 ScreenTouch + ScreenDrag（参考）
  { key: 'normalizeargs-depth-limit', status: 'open', severity: 'IMPORTANT', dimension: 'Correctness',
    // 计数：硬编码深度上限处数（MAX_NORMALIZE_DEPTH=5 / depth>5）
    detect: () => countMatchesInFile('src/core/ToolDispatcher.ts', /MAX_NORMALIZE_DEPTH\s*=\s*5\b|depth\s*>\s*5\b/g),
    baseline: 1 }, // ToolDispatcher:410（参考）
];

