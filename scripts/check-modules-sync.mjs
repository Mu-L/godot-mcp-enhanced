#!/usr/bin/env node
// scripts/check-modules-sync.mjs
// CMP-13 N-3 (2026-08-09): 检测 module-loader.ts 的 import 块与 ALL_MODULES 数组是否同步。
// 防新增工具加 import 后忘记跑 `npm run generate:modules`(import 数 ≠ ALL_MODULES 数)。
//
// 用法: node scripts/check-modules-sync.mjs  (或 npm run check:modules-sync)
// 退出码: 0=同步 / 1=不同步

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loaderPath = join(__dirname, '..', 'src', 'module-loader.ts');
const src = readFileSync(loaderPath, 'utf-8');

// 提取 import 别名(非注释行)
const importAliases = new Set();
for (const line of src.split('\n')) {
  if (/^\s*\/\//.test(line)) continue;
  // 2026-08-21 D-2:module-loader 移到 src/ 根后相对深度为 ./tools/;兼容两种深度(与 generate-all-modules.mjs 同步)
  const m = line.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]\.{1,2}\/tools\//);
  if (m) importAliases.add(m[1]);
}

// 提取 ALL_MODULES 数组项
const arrayMatch = src.match(/const ALL_MODULES: ToolModule\[\]\s*=\s*\[([\s\S]*?)\]/);
if (!arrayMatch) {
  console.error('[modules-sync] 无法提取 ALL_MODULES 数组');
  process.exit(1);
}
const arrayAliases = new Set();
for (const m of arrayMatch[1].matchAll(/(\w+)/g)) {
  arrayAliases.add(m[1]);
}

// 对比
const inImportNotArray = [...importAliases].filter(a => !arrayAliases.has(a));
const inArrayNotImport = [...arrayAliases].filter(a => !importAliases.has(a));

if (inImportNotArray.length === 0 && inArrayNotImport.length === 0) {
  console.log(`[modules-sync] ✓ 同步 (${importAliases.size} import = ${arrayAliases.size} ALL_MODULES)`);
  process.exit(0);
}

console.error(`[modules-sync] ✗ 不同步 (${importAliases.size} import ≠ ${arrayAliases.size} ALL_MODULES)`);
if (inImportNotArray.length > 0) {
  console.error(`  import 有但 ALL_MODULES 缺: ${inImportNotArray.join(', ')}`);
  console.error('  修复: 跑 `npm run generate:modules` 重生成数组');
}
if (inArrayNotImport.length > 0) {
  console.error(`  ALL_MODULES 有但 import 缺: ${inArrayNotImport.join(', ')}`);
  console.error('  修复: 检查是否误删 import 或需手动清理数组');
}
process.exit(1);
