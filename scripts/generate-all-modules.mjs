#!/usr/bin/env node
// scripts/generate-all-modules.mjs
// CMP-13 (2026-08-09): 从 module-loader.ts 的 import 块(手写权威)自动生成 ALL_MODULES 数组。
// 新增工具只需加 import 行,跑本脚本重生成数组,无需手动维护数组项。
//
// 用法: node scripts/generate-all-modules.mjs  (或 npm run generate:modules)
// 原理: 读 module-loader.ts → 提取 import 别名(跳过注释行)→ 重写 ALL_MODULES 数组段
//
// 安全: 提取到 0 别名 / 找不到数组声明 → exit 1(防误覆盖)

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loaderPath = join(__dirname, '..', 'src', 'core', 'module-loader.ts');
const src = readFileSync(loaderPath, 'utf-8');

// 提取所有非注释 import 的别名: ^import * as NAME from '../tools/...'
const aliases = [];
for (const line of src.split('\n')) {
  if (/^\s*\/\//.test(line)) continue;  // 跳过注释行(已合并的历史 import)
  const m = line.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\.\/tools\//);
  if (m) aliases.push(m[1]);
}

if (aliases.length === 0) {
  console.error('[generate-all-modules] 未提取到任何 import 别名,中止(防覆盖空数组)');
  process.exit(1);
}

// 定位 ALL_MODULES 数组段
const MARKER = 'const ALL_MODULES: ToolModule[] = [';
const arrayStart = src.indexOf(MARKER);
if (arrayStart === -1) {
  console.error('[generate-all-modules] 未找到 ALL_MODULES 数组声明,中止');
  process.exit(1);
}
const arrayEnd = src.indexOf('];', arrayStart);
if (arrayEnd === -1) {
  console.error('[generate-all-modules] 未找到 ALL_MODULES 数组结束 ];,中止');
  process.exit(1);
}

const before = src.slice(0, arrayStart);
const after = src.slice(arrayEnd + 2);  // 跳过 "];"

// 格式化:每个别名独占一行 + 尾逗号(满足字面量契约测试 /^\s+NAME,/m,如 CMP-3f/CMP-4e)
// N-1: 末行也加尾逗号,防 debug/engine 成为最后一项时契约测试失败
const lines = aliases.map(alias => '  ' + alias + ',');

const newArray = `${MARKER}\n${lines.join('\n')}\n];`;
writeFileSync(loaderPath, before + newArray + after, 'utf-8');
console.log(`[generate-all-modules] 生成 ${aliases.length} 个模块 → ALL_MODULES 数组 (${loaderPath})`);
