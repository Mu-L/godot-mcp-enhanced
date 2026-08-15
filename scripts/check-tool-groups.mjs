#!/usr/bin/env node
// scripts/check-tool-groups.mjs
// CMP-12/13 替代方案 (2026-08-08): CI invariant 检测——防"module 注册了但 TOOL_GROUPS 漏加"。
// 源于 CMP-4 第三方审查 B-1: engine/debug 工具在 module-loader 注册但不在 TOOL_GROUPS,
// 致 isToolAllowed 恒 false 工具不可用(第三次重蹈 D1 asset/android 覆辙)。
//
// C-1 (2026-08-14) 第 4 次复现后改造: 正则提取 TOOL_NAMES → require build 产物枚举。
// 旧版靠正则扫各工具文件源码里的 `TOOL_NAMES = [...]`,工具不导出 TOOL_NAMES 即隐身
// (audit.ts 即此盲区: 注册了 41 个工具但正则只扫到 40,exit 0 假绿)。
// 新版直接 import build/core/module-loader.js + tool-registry.js,用运行时真实注册集
// (registerAllModules → getAllToolDefinitions)对账 TOOL_GROUPS/ALWAYS_ALLOWED,
// 不依赖任何源码文本模式,天然覆盖"不导出 TOOL_NAMES 的新工具"。
//
// 检测逻辑: registerAllModules() 枚举全部工具定义,断言每个工具名都在 TOOL_GROUPS 的
// 某组 tools 或 ALWAYS_ALLOWED 里。任一缺失 → exit 1 + 列出缺失工具。
//
// 用法: node scripts/check-tool-groups.mjs(需先 npm run build)
// 退出码: 0=通过 / 1=有工具未归组(或 build 产物缺失/无法加载)

const root = process.cwd();

// build 产物是 ESM(type:module),用 dynamic import 加载运行时真实值
let registry, moduleLoader;
try {
  registry = await import(`file://${root.replaceAll('\\', '/')}/build/core/tool-registry.js`);
  moduleLoader = await import(`file://${root.replaceAll('\\', '/')}/build/core/module-loader.js`);
} catch (err) {
  console.error(`[tool-groups] 无法加载 build 产物(build/core/{tool-registry,module-loader}.js): ${err instanceof Error ? err.message : String(err)}`);
  console.error('  请先 npm run build');
  process.exit(1);
}

// 真实注册集:registerAllModules 注入全部 ToolModule 后枚举工具定义
moduleLoader.registerAllModules();
const registeredTools = registry.getAllToolDefinitions().map((t) => t.name);
if (registeredTools.length === 0) {
  console.error('[tool-groups] build 产物注册集为空——module-loader 未注册任何工具?');
  process.exit(1);
}

// 运行时真实分组信息(非正则提取)
const groupedTools = new Set();
for (const def of Object.values(registry.TOOL_GROUPS)) {
  for (const t of def.tools) groupedTools.add(t);
}
const alwaysAllowed = new Set(registry.ALWAYS_ALLOWED);

// 检测:每个注册工具必须在 groupedTools 或 alwaysAllowed 里
const orphan = [];
for (const t of registeredTools) {
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
  console.error('  根因:module-loader 注册了工具但忘记在 TOOL_GROUPS 登记(第 4 次复现:audit)');
  process.exit(1);
}

console.log(`[tool-groups] ✓ 全部 ${registeredTools.length} 个注册工具已归组(${groupedTools.size} grouped + ${alwaysAllowed.size} always-allowed,build 产物运行时枚举)`);
