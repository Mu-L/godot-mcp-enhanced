#!/usr/bin/env node
// scripts/check-tool-groups.mjs
// CMP-12/13 替代方案 (2026-08-08): CI invariant 检测——防"module 注册了但 TOOL_GROUPS 漏加"。
// 源于 CMP-4 第三方审查 B-1: engine/debug 工具在 module-loader 注册但不在 TOOL_GROUPS,
// 致 isToolAllowed 恒 false 工具不可用(第三次重蹈 D1 asset/android 覆辙)。
//
// 检测逻辑:扫描 ALL_MODULES 的每个 TOOL_NAMES,断言都在 TOOL_GROUPS 的 tools 或
// ALWAYS_ALLOWED 里。任一缺失 → exit 1 + 列出缺失工具。
//
// 用法: node scripts/check-tool-groups.mjs
// 退出码: 0=通过 / 1=有工具未归组

import { readFileSync } from 'fs';

// 从编译产物读(build/module-loader.js + build/core/tool-registry.js)
// 避免源码 grep 的正则脆弱性,直接读 JS 运行时值
const root = process.cwd();

// 读 tool-registry.js 提取 TOOL_GROUPS + ALWAYS_ALLOWED
const registrySrc = readFileSync(`${root}/build/core/tool-registry.js`, 'utf-8');

// 提取 TOOL_GROUPS 里所有 tools 数组的工具名
const toolGroupsMatch = registrySrc.match(/TOOL_GROUPS\s*=\s*\{([\s\S]*?)\n\}/);
if (!toolGroupsMatch) {
  console.error('[tool-groups] 无法从 tool-registry.js 提取 TOOL_GROUPS');
  process.exit(1);
}
const groupBody = toolGroupsMatch[1];
const groupedTools = new Set();
for (const m of groupBody.matchAll(/tools:\s*\[([^\]]*)\]/g)) {
  for (const t of m[1].matchAll(/'([^']+)'/g)) {
    groupedTools.add(t[1]);
  }
}

// 提取 ALWAYS_ALLOWED
const alwaysMatch = registrySrc.match(/ALWAYS_ALLOWED\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
const alwaysAllowed = new Set();
if (alwaysMatch) {
  for (const t of alwaysMatch[1].matchAll(/'([^']+)'/g)) {
    alwaysAllowed.add(t[1]);
  }
}

// 读 module-loader.js 提取所有实际 import 的工具模块(注释掉的 import 不算)
const loaderSrc = readFileSync(`${root}/build/core/module-loader.js`, 'utf-8');
const allTools = new Set();
// 只匹配非注释行的 import ... from '../tools/xxx'
// module-loader.js 里注释掉的 import 是 // import * as xxx from ...（行首 //）
for (const m of loaderSrc.matchAll(/^(?!\/\/)\s*import\s+\*\s+as\s+\w+\s+from\s+['"]\.\.\/tools\/([^'"]+?)['"]/gm)) {
  const name = m[1].replace(/\.js$/, '');
  try {
    const toolSrc = readFileSync(`${root}/build/tools/${name}.js`, 'utf-8');
    for (const tm of toolSrc.matchAll(/TOOL_NAMES\s*=\s*\[([^\]]*)\]/g)) {
      for (const t of tm[1].matchAll(/'([^']+)'/g)) {
        allTools.add(t[1]);
      }
    }
  } catch { /* sub-dir module (e.g. tools/scene/index.js), read index.js */ }
}
// 也匹配子目录模块(tools/scene/index.js 等)
for (const m of loaderSrc.matchAll(/^(?!\/\/)\s*import\s+\*\s+as\s+\w+\s+from\s+['"]\.\.\/tools\/([^'"]+?)\/index['"]/gm)) {
  try {
    const toolSrc = readFileSync(`${root}/build/tools/${m[1]}/index.js`, 'utf-8');
    for (const tm of toolSrc.matchAll(/TOOL_NAMES\s*=\s*\[([^\]]*)\]/g)) {
      for (const t of tm[1].matchAll(/'([^']+)'/g)) {
        allTools.add(t[1]);
      }
    }
  } catch { /* skip */ }
}

// 检测:每个 allTools 的工具必须在 groupedTools 或 alwaysAllowed 里
const orphan = [];
for (const t of allTools) {
  if (!groupedTools.has(t) && !alwaysAllowed.has(t)) {
    orphan.push(t);
  }
}

if (orphan.length > 0) {
  console.error(`[tool-groups] ✗ 检测到 ${orphan.length} 个工具未归组(isToolAllowed 恒 false,工具不可用):`);
  for (const t of orphan) {
    console.error(`  ${t} — 不在 TOOL_GROUPS 任何组的 tools 数组里,也不在 ALWAYS_ALLOWED 里`);
  }
  console.error('  修复:在 src/core/tool-registry.ts TOOL_GROUPS 补组,或加入 ALWAYS_ALLOWED');
  console.error('  根因:module-loader 注册了工具但忘记在 TOOL_GROUPS 登记(CMP-4 B-1 第三次复现)');
  process.exit(1);
}

console.log(`[tool-groups] ✓ 全部 ${allTools.size} 个工具已归组(${groupedTools.size} grouped + ${alwaysAllowed.size} always-allowed)`);
