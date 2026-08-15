// src/core/tool-discovery.ts
/**
 * Three-tier lazy tool discovery (Phase 1 of unity-mcp-server tool-system migration).
 *
 * 对标 unity-mcp-server/src/tool-tiers.js:284-451 的 catalogTool(2026-08-10 深挖报告)。
 * godot-mcp-enhanced 已有 merged tool 架构(40 工具 = 228 actions)和 advanced-proxy,
 * 本模块只服务 godot_list_dynamic_routes 的三级 drill-down,不改动 tools/list 暴露。
 *
 * 三级协议(对齐 unity):
 *   Level 1  无参        → category 计数(summary)
 *   Level 2a search=kw   → 模糊匹配 + 排序,上限 20(不带 schema)
 *   Level 2b category=N  → 该类工具清单 + brief + 参数名(lean 视图)
 *   Level 3  tool=name   → 单工具完整 schema
 *
 * includeSchemas=true 配合 category 可一次性返回完整 schema(单次往返场景)。
 *
 * 本模块是纯函数集合,无副作用,便于单测。调用方(advanced-proxy.ts)负责接入。
 */

import type { Tool } from '@modelcontextprotocol/server';
import { firstSentence } from './response-format.js';

/** Discovery 请求参数(对齐 unity catalogTool,字段名本土化)。 */
export interface DiscoveryParams {
  /** 关键词,空格分隔,全部命中才匹配;名字命中排名优先。 */
  search?: string;
  /** 类别名,返回该类工具清单 + brief + 参数名(lean)。 */
  category?: string;
  /** 工具名,返回单个完整 schema。优先级最高。 */
  tool?: string;
  /** 配合 category,一次性返回完整 schema(体积大,慎用)。 */
  includeSchemas?: boolean;
}

/** discovery 搜索结果上限(对齐 unity tool-tiers.js:385 .slice(0, 20))。 */
const SEARCH_RESULTS_LIMIT = 20;

/**
 * 从工具名提取 category,对齐 unity tool-tiers.js:226-232 的按首段归类。
 *
 * 规则:
 *   - 去掉 godot_ 前缀后的第一段下划线分隔 = category
 *   - 无下划线的(如 merged tool: scene/nav/script)→ 'core'
 *
 * 示例:
 *   godot_terrain_raise_lower → 'terrain'
 *   scene                     → 'core'
 *   godot_custom_thing        → 'custom'
 */
export function categoryOf(toolName: string): string {
  const stripped = toolName.replace(/^godot_/, '');
  const parts = stripped.split('_');
  return parts.length >= 2 ? parts[0]! : 'core';
}

/**
 * Level 1:无参 → category 计数。
 * 对齐 unity tool-tiers.js:441-450,返回 summary(实测 < 2KB)。
 */
export function buildSummary(
  staticTools: Tool[],
  dynamicTools: Tool[],
): {
  totalTools: number;
  totalDynamic: number;
  categories: Record<string, number>;
  hint: string;
} {
  const categories: Record<string, number> = {};
  for (const t of [...staticTools, ...dynamicTools]) {
    const cat = categoryOf(t.name);
    categories[cat] = (categories[cat] ?? 0) + 1;
  }
  return {
    totalTools: staticTools.length + dynamicTools.length,
    totalDynamic: dynamicTools.length,
    categories,
    hint: 'Drill down: search=<keywords>, category=<name>, tool=<name> (full schema).',
  };
}

/** searchTools 的单条结果。 */
export interface SearchResultEntry {
  name: string;
  category: string;
  brief?: string;
  dynamic?: boolean;
}

/**
 * Level 2a:search=keywords → 模糊匹配 + 排序,上限 20(不带 schema)。
 * 对齐 unity tool-tiers.js:363-400。
 *
 * 规则:
 *   - tokens(空格分隔)全部命中(name+category+description 拼接的 blob)才匹配
 *   - 名字命中所有 tokens → rank=0(优先);否则 rank=1
 *   - 按 rank 升序、name 字母序排序,取前 SEARCH_RESULTS_LIMIT(20)条
 *   - 可选 opts.category 限定类别
 */
export function searchTools(
  query: string,
  tools: Tool[],
  opts: { category?: string; dynamicNames?: Set<string>; limit?: number } = {},
): { totalMatches: number; results: SearchResultEntry[] } {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = opts.limit ?? SEARCH_RESULTS_LIMIT;
  const dynamicNames = opts.dynamicNames ?? new Set<string>();

  if (tokens.length === 0) {
    return { totalMatches: 0, results: [] };
  }

  const candidates = tools.map((t) => ({
    name: t.name,
    category: categoryOf(t.name),
    description: t.description ?? '',
    dynamic: dynamicNames.has(t.name),
  }));

  const matches: Array<{ rank: number; c: (typeof candidates)[number] }> = [];
  for (const c of candidates) {
    if (opts.category && c.category !== opts.category.toLowerCase()) continue;
    const nameText = c.name.toLowerCase();
    const blob = `${nameText} ${c.category} ${c.description.toLowerCase()}`;
    if (!tokens.every((tok) => blob.includes(tok))) continue;
    const rank = tokens.every((tok) => nameText.includes(tok)) ? 0 : 1;
    matches.push({ rank, c });
  }

  matches.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const results: SearchResultEntry[] = matches.slice(0, limit).map(({ c }) => {
    const entry: SearchResultEntry = { name: c.name, category: c.category };
    const brief = firstSentence(c.description);
    if (brief) entry.brief = brief;
    if (c.dynamic) entry.dynamic = true;
    return entry;
  });
  return { totalMatches: matches.length, results };
}

/**
 * Level 2b:category=name → 该类工具清单 + brief + 参数名(lean 视图)。
 * 对齐 unity tool-tiers.js:402-438(默认 lean,< 8KB)。
 *
 * includeSchemas=true 时返回完整 schema(体积大,单次往返场景)。
 * category 不存在时返回 {error}。
 */
export function listCategory(
  category: string,
  tools: Tool[],
  includeSchemas: boolean,
): unknown {
  const cat = category.toLowerCase();
  const matching = tools.filter((t) => categoryOf(t.name) === cat);
  if (matching.length === 0) {
    return { error: `No tools in category "${category}".` };
  }
  if (includeSchemas) {
    return matching.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }
  // lean 视图:只暴露 name + brief + 参数名(不暴露类型),对齐 unity tool-tiers.js:421-429
  const out = matching.map((t) => {
    const entry: Record<string, unknown> = { name: t.name, brief: firstSentence(t.description ?? '') };
    const props = (t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
    const params = Object.keys(props);
    if (params.length > 0) entry.params = params;
    const required = (t.inputSchema as { required?: string[] } | undefined)?.required;
    if (Array.isArray(required) && required.length > 0) entry.required = required;
    return entry;
  });
  return { category: cat, count: out.length, tools: out };
}

/**
 * Level 3:tool=name → 单工具完整 schema。
 * 对齐 unity tool-tiers.js:329-360。
 * 找不到时返回 null(调用方负责附加 did-you-mean 建议)。
 */
export function getToolSchema(toolName: string, tools: Tool[]): unknown {
  const t = tools.find((x) => x.name === toolName);
  if (!t) return null;
  return {
    name: t.name,
    category: categoryOf(t.name),
    description: t.description,
    inputSchema: t.inputSchema,
  };
}
