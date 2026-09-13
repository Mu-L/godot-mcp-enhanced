#!/usr/bin/env node
// scripts/check-e2e-l2-coverage.mjs
/**
 * 架构检查 D1 (2026-09-12): L2 e2e CI 覆盖对账——机械防"新 L2 文件漏加 CI 白名单"。
 *
 * 背景:p3-e2e/p8-e2e 连续两批漏加 ci.yml L2 列表(P8 审查 N-1 补),架构检查又发现
 * 6 个更早的 L2-only 文件(p7-e2e/e2e-qa-suite/e2e-qa-assert-batch/e2e-bridge-feedback-pits/
 * e2e-bridge-input-sequence/e2e-gd-symmetry)引用 GODOT_MCP_E2E_L2 gate 却从未进过
 * CI L2 job——其 L2 用例在 CI 恒 skip(白名单制 + opt-in gate 双重叠加 = 静默漏跑)。
 *
 * 对账方向(双向):
 *   ① 引用 GODOT_MCP_E2E_L2 gate 的 test 文件 ⊆ ci.yml L2 run 行文件列表
 *      ——漏加 = CI 永远 skip 该文件 L2 用例(gate 是 opt-in 语义,无 env 即 skip)。
 *   ② ci.yml L2 列表每项文件必须实际存在
 *      ——改名/删除后 CI 静默跑空(部分被 e2e non-empty gate 兜住,此处机械全查)。
 *
 * 豁免:文件头注释标记 `e2e-l2-coverage: exempt(<原因>)` 允许 gate 文件不进 L2 列表
 * (输出 warn 不阻断;豁免必须给原因,防止豁免滥用)。
 *
 * L2 run 行识别:ci.yml 中含 `--no-file-parallelism` 的 `npx vitest run` 行
 * (bridge 单端口 9081,L2 文件必须文件级串行——该 flag 即 L2 run 行的机械特征)。
 * 提取 0 个文件时直接 fail(防 run 行格式漂移后本脚本静默失效)。
 *
 * 退出码:0 通过 / 1 发现漂移(CI 阻断)。
 * 用法:node scripts/check-e2e-l2-coverage.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CI_PATH = join(ROOT, '.github', 'workflows', 'ci.yml');
const TEST_DIR = join(ROOT, 'test');

const EXEMPT_MARKER = /e2e-l2-coverage:\s*exempt/;

// ─── ① 从 ci.yml 提取 L2 run 行文件列表 ─────────────────────────────────────

function extractCiL2List() {
  const ci = readFileSync(CI_PATH, 'utf8');
  const files = new Set();
  for (const line of ci.split(/\r?\n/)) {
    // L2 run 行特征:npx vitest run + --no-file-parallelism(bridge 端口串行)
    if (!/npx vitest run/.test(line) || !/--no-file-parallelism/.test(line)) continue;
    for (const m of line.matchAll(/test\/[\w\-./]+\.(?:test|spec)\.(?:ts|js)/g)) {
      files.add(m[0]);
    }
  }
  return files;
}

// ─── ② 扫 test/ 下引用 L2 gate 的测试文件 ───────────────────────────────────

function* walkTestFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walkTestFiles(p);
    else if (/\.(test|spec)\.(ts|js)$/.test(entry)) yield p;
  }
}

function scanGateFiles() {
  const found = [];
  for (const p of walkTestFiles(TEST_DIR)) {
    const content = readFileSync(p, 'utf8');
    if (/GODOT_MCP_E2E_L2/.test(content)) {
      found.push({
        rel: relative(ROOT, p).replaceAll('\\', '/'),
        exempt: EXEMPT_MARKER.test(content),
      });
    }
  }
  return found;
}

// ─── 对账 ───────────────────────────────────────────────────────────────────

const ciList = extractCiL2List();
if (ciList.size === 0) {
  console.error('[e2e-l2-coverage] FAIL: ci.yml 提取到 0 个 L2 文件——run 行格式漂移?');
  console.error('  (识别特征:含 npx vitest run 且含 --no-file-parallelism 的行)');
  process.exit(1);
}

const gateFiles = scanGateFiles();
let fail = false;

// 方向①:gate 文件 ⊆ CI 列表(豁免标记除外)
for (const g of gateFiles) {
  if (ciList.has(g.rel)) continue;
  if (g.exempt) {
    console.warn(`[e2e-l2-coverage] WARN: ${g.rel} 引用 L2 gate 但已豁免(e2e-l2-coverage: exempt)`);
  } else {
    console.error(
      `[e2e-l2-coverage] FAIL: ${g.rel} 引用 GODOT_MCP_E2E_L2 gate(L2-only opt-in)但不在 ci.yml L2 列表——` +
        `其 L2 用例在 CI 恒 skip。补进 ci.yml 的 --no-file-parallelism run 行,或加豁免标记 "e2e-l2-coverage: exempt(<原因>)"`,
    );
    fail = true;
  }
}

// 方向②:CI 列表文件必须存在
for (const f of ciList) {
  if (!existsSync(join(ROOT, f))) {
    console.error(`[e2e-l2-coverage] FAIL: ci.yml L2 列表含不存在文件 ${f}(改名/删除后未同步)`);
    fail = true;
  }
}

if (fail) process.exit(1);
console.log(`[e2e-l2-coverage] ✓ 通过:CI L2 列表 ${ciList.size} 文件,gate 引用 ${gateFiles.length} 文件全部覆盖(含豁免 ${gateFiles.filter((g) => g.exempt).length})`);
