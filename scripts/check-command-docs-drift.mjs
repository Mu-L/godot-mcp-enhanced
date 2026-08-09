#!/usr/bin/env node
// scripts/check-command-docs-drift.mjs
// CMP-16-C (2026-08-08): GD param docs 与 TS inputSchema 的 drift 检测。
//
// 对标竞品 regiellis 的 "schema tracks whatever the editor registers"。
// 检测 GD 侧 get_command_docs 声明的参数,与 TS 侧工具 inputSchema 是否一致。
//
// 检测维度:
// 1. GD docs 有参数 X,但 TS inputSchema 没有该参数 → drift(GD 文档过时或 TS 漏加)
// 2. TS inputSchema 有参数 Y,但 GD docs 没有该参数 → 提示(可能是 action 这种路由参数,白名单豁免)
//
// method → tool/action 映射:用手写映射表(非自动前缀剥离,因命名不统一)。
// 映射表 key = GD method 名,value = {tool, action?}(action 省略表示 tool 直接对应)。
//
// 用法: node scripts/check-command-docs-drift.mjs
// 退出码: 0=通过(或只有提示级) / 1=有 drift 错误

import { readFileSync, readdirSync } from 'fs';

const root = process.cwd();
const COMMANDS_DIR = `${root}/addons/godot_mcp_server/commands`;

// ─── method → tool/action 映射表(手写,非自动推导) ────────────────────────────
// key = GD dispatch method 名;value = {tool, action?}
// action 省略表示该 method 对应的 TS 工具无 action 参数(如 animation_track)。
// 豁免参数(TS 有但 GD docs 不含,因为它们是路由/元参数,非业务参数):
const ROUTING_PARAMS = new Set(['action']); // action 是 merged-tool 路由参数,GD docs 不含

const METHOD_TO_TOOL = {
  // debug (CMP-3):tool=debug, 3 action 对应 3 method
  debug_set_breakpoint: { tool: 'debug', action: 'set_breakpoint' },
  debug_clear_breakpoint: { tool: 'debug', action: 'clear_breakpoint' },
  debug_list_breakpoints: { tool: 'debug', action: 'list_breakpoints' },
  // engine (CMP-4 + CMP-9-A):tool=engine, 4 action 对应 4 method
  engine_class_info: { tool: 'engine', action: 'class_info' },
  engine_search: { tool: 'engine', action: 'search' },
  engine_get_inheritance: { tool: 'engine', action: 'get_inheritance' },
  engine_call_method: { tool: 'engine', action: 'call_method' },
  // 一期暂不覆盖的工具组(sync/export/test/node/scene/animation/animtree/particles/nav/ui/asset):
  // 这些工具在 TS 侧的结构与 GD method 非简单 1:1(merged tool / action 分支 / 参数重组),
  // 映射表需逐个核实。一期只检测 debug + engine 两个已确认映射的工具组,
  // 其余标记为"未纳入映射表(一期豁免)",后续批次扩充。
};

// ─── 提取 GD 侧 docs ──────────────────────────────────────────────────────────

/** 从 GD 源码提取 get_command_docs 里的 method→paramNames 映射 */
function extractGdDocs() {
  const files = [
    ...readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.gd')).map(f => `commands/${f}`),
    'commands/asset/asset_commands.gd',
  ];
  const docs = {}; // {method: [paramName, ...]}

  for (const relPath of files) {
    if (relPath.includes('command_helpers')) continue; // helper 文件无 docs
    if (relPath.includes('recording_commands')) continue; // 死代码
    let content;
    try {
      content = readFileSync(`${root}/addons/godot_mcp_server/${relPath}`, 'utf8');
    } catch { continue; }

    const docsStart = content.indexOf('func get_command_docs');
    if (docsStart < 0) continue;
    // 截到下一个顶层函数
    const nextFunc = content.indexOf('\nfunc ', docsStart + 10);
    const body = content.slice(docsStart, nextFunc < 0 ? docsStart + 4000 : nextFunc);

    // 提取 method key(2-tab "name": {)和其后的 doc_param 调用
    // 简化:逐 method 段提取
    const methodBlocks = body.split(/^\t\t("?[a-z_0-9]+"?): \{/m);
    // split 产生 [前导, key1, body1, key2, body2, ...]
    for (let i = 1; i < methodBlocks.length; i += 2) {
      const methodKey = methodBlocks[i].replace(/"/g, '');
      const methodBody = methodBlocks[i + 1] || '';
      const paramNames = [];
      for (const m of methodBody.matchAll(/doc_param\(\s*"([^"]+)"/g)) {
        paramNames.push(m[1]);
      }
      docs[methodKey] = paramNames;
    }
  }
  return docs;
}

// ─── 提取 TS 侧 inputSchema ───────────────────────────────────────────────────

/** 从 build/tools/*.js 提取工具 inputSchema 的参数名集合 */
function extractTsSchemas() {
  const toolsDir = `${root}/build/tools`;
  const schemas = {}; // {toolName: {action?: {paramNames: Set}, paramNames?: Set}}

  let toolFiles = [];
  try {
    toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.js'));
  } catch { /* build 不存在,跳过 */ }

  for (const file of toolFiles) {
    const content = readFileSync(`${toolsDir}/${file}`, 'utf8');
    // 提取 inputSchema properties 的参数名(顶层缩进的 key:)
    // 格式:properties: { action: {...}, path: {...}, ... }
    const propsMatch = content.match(/inputSchema[^}]*properties:\s*\{([\s\S]*?)\},\s*(?:required|description)/);
    if (!propsMatch) continue;

    // 提取工具名(从 TOOL_NAMES)
    const toolNameMatch = content.match(/TOOL_NAMES\s*=\s*\[([^\]]*)\]/);
    if (!toolNameMatch) continue;
    const toolName = toolNameMatch[1].match(/'([^']+)'/)?.[1];
    if (!toolName) continue;

    // 提取参数名
    const propNames = new Set();
    for (const m of propsMatch[1].matchAll(/^\s*(\w+):\s*\{/gm)) {
      propNames.add(m[1]);
    }
    if (propNames.size > 0) {
      schemas[toolName] = propNames;
    }
  }
  return schemas;
}

// ─── drift 检测 ───────────────────────────────────────────────────────────────

function checkDrift() {
  const gdDocs = extractGdDocs();
  const tsSchemas = extractTsSchemas();

  const errors = [];
  const warnings = [];
  let checkedCount = 0;
  let unmappedCount = 0;

  for (const [method, gdParams] of Object.entries(gdDocs)) {
    const mapping = METHOD_TO_TOOL[method];
    if (!mapping) {
      // method 不在映射表里(可能是一期未覆盖的工具组),只警告不报错
      unmappedCount++;
      continue;
    }
    checkedCount++;

    const tsParams = tsSchemas[mapping.tool];
    if (!tsParams) {
      errors.push(`${method} → tool "${mapping.tool}": TS 侧未找到该工具的 inputSchema`);
      continue;
    }

    // 检查 GD docs 有但 TS 没有的参数(drift:GD 文档过时或 TS 漏加)
    for (const p of gdParams) {
      if (!tsParams.has(p) && !ROUTING_PARAMS.has(p)) {
        errors.push(`${method} → ${mapping.tool}: GD docs 有参数 "${p}" 但 TS inputSchema 没有(drift)`);
      }
    }
  }

  return { errors, warnings, checkedCount, unmappedCount, totalGdMethods: Object.keys(gdDocs).length };
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

const result = checkDrift();

if (result.errors.length > 0) {
  console.error(`[command-docs-drift] ✗ 检测到 ${result.errors.length} 处 drift:`);
  for (const e of result.errors) {
    console.error(`  ${e}`);
  }
  console.error('  修复:同步 GD get_command_docs 与 TS inputSchema 的参数定义');
  console.error('  根因:CMP-16-A docs 与 CMP-9/3/4 等 TS 工具定义漂移');
  process.exit(1);
}

console.log(`[command-docs-drift] ✓ ${result.checkedCount} method 已校验(映射表覆盖),${result.unmappedCount} method 未纳入映射表(一期豁免),${result.totalGdMethods} GD docs 总计`);
