// src/tools/help.ts — P0-6 Help 工具（on-demand 文档展开）
//
// agent 传 tool_name 获取完整工具文档（从 docs/tools/{name}.md 读取）。
// 拼写纠错：unknown tool_name 时返回 "Did you mean 'X'?" 提示。
// 目的：降低 tools/list 的 token 占用（工具描述可压缩为单行 + "Use help tool for full docs"）。

import type { ToolResult, ToolContext } from '../types.js';
import { textResult } from '../types.js';
import type { Tool } from '@modelcontextprotocol/server';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Tool name enum（从 capability-matrix 动态构建，含 help 自身）────────────

const TOOL_NAMES = [
  'android', 'animation', 'animation_track', 'animtree', 'asset', 'audio', 'blender',
  'cpp', 'csv_to_resources', 'docs', 'editor', 'game', 'godot_advanced_tool',
  'godot_get_context', 'godot_list_dynamic_routes', 'godot_list_instances',
  'godot_select_instance', 'help', 'load_skill', 'manage_tools', 'material', 'nav',
  'particles', 'physics', 'profiler', 'project', 'runtime', 'runtime_assert', 'scene',
  'screenshot', 'script', 'self_update', 'signal', 'testing', 'tilemap', 'ui',
  'validation', 'workflow',
] as const;

// ─── Tool definitions ───────────────────────────────────────────────────────

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'help',
      description: `获取任意工具的完整文档。可用工具名：${TOOL_NAMES.join(', ')}。传 tool_name 获取该工具的详细用法、参数、action 列表。拼写纠错自动提示最接近的工具名。`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          tool_name: {
            type: 'string',
            enum: [...TOOL_NAMES],
            description: '要查询的工具名',
          },
        },
        required: ['tool_name'],
      },
    },
  ];
}

// ─── Tool metadata ──────────────────────────────────────────────────────────

export const TOOL_META = {
  'help': {
    readonly: true,
    long_running: false,
    actionRisks: {},
  },
};

// ─── Tool handler ───────────────────────────────────────────────────────────

export async function handleTool(name: string, args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult | null> {
  if (name !== 'help') return null;
  const toolName = args.tool_name as string;
  if (!toolName) {
    return textResult(JSON.stringify({ error: 'tool_name is required', available: [...TOOL_NAMES] }));
  }

  // 读 docs/tools/{toolName}.md
  const here = dirname(fileURLToPath(import.meta.url));
  // 开发环境：src/tools/help.ts → ../../docs/tools/
  // 构建环境：build/tools/help.js → ../../docs/tools/（docs 不打包进 build，用 cwd 兜底）
  const candidates = [
    join(here, '..', '..', 'docs', 'tools', `${toolName}.md`),
    join(process.cwd(), 'docs', 'tools', `${toolName}.md`),
    join(here, '..', '..', '..', 'docs', 'tools', `${toolName}.md`),
  ];

  for (const docPath of candidates) {
    if (existsSync(docPath)) {
      try {
        const content = readFileSync(docPath, 'utf-8');
        return textResult(content);
      } catch {
        // 读失败继续尝试下一个路径
      }
    }
  }

  // 文档不存在——返回拼写纠错
  const suggestion = findClosestMatch(toolName, [...TOOL_NAMES]);
  return textResult(JSON.stringify({
    error: `No documentation found for tool '${toolName}'`,
    suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
    available: [...TOOL_NAMES],
  }));
}

// ─── Levenshtein 拼写纠错 ───────────────────────────────────────────────────

/** 找编辑距离 ≤ 2 的最接近工具名 */
function findClosestMatch(input: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDist && dist <= 2) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}
