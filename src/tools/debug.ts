import type { Tool } from "@modelcontextprotocol/server";
import type { ToolContext, ToolResult } from '../types.js';
import { opsErrorResult } from './shared.js';
import type { RiskLevel } from '../core/tool-registry.js';

// ─── CMP-3 (2026-08-08): debug 组 Phase 1 — 断点管理 (editor-only) ──────────
//
// 提供 set/clear/list breakpoint 三个同步 action。走 CodeEdit gutter 路径
// (竞品 regiellis/godot-mcp-go 验证可行),断点进入 editor breakpoint map,
// gutter 可见 + 现行 game 命中 + 下次 run 同步。
//
// Headless mode: 三个 action 硬返回 EDITOR_ONLY — 断点需要 EditorInterface +
// CodeEdit(editor 专属 API)。editor 模式 GodotServer.ts 经 EditorToolExecutor
// 转发给 GD 侧 debug_commands.gd,不走 TS handler。

const TOOL_NAMES = ['debug'] as const;
export { TOOL_NAMES };

const ACTIONS = ['set_breakpoint', 'clear_breakpoint', 'list_breakpoints'] as const;

// ─── Tool definitions ──────────────────────────────────────────────────────

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'debug',
      description: [
        '交互式调试器 — 断点管理（editor-only）：在 GDScript 脚本中设置/清除/列出断点。',
        'set_breakpoint: 在指定行设置断点（走 CodeEdit gutter，进入 editor breakpoint map：gutter 可见 + 现行 game 命中 + 下次 run 同步保持）。',
        'clear_breakpoint: 清除指定行的断点。',
        'list_breakpoints: 列出当前活跃 tab 脚本的断点。',
        '⚠️ 脚本必须在编辑器中打开且是当前活跃 tab（Phase 1 限制，Phase 2 将支持自动打开）。',
        '⚠️ editor-only：headless 模式返回 EDITOR_ONLY。需 GODOT_MCP_MODE=editor 并安装 Godot 插件。',
      ].join(' '),
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: [...ACTIONS],
            description: 'Action type: set_breakpoint | clear_breakpoint | list_breakpoints',
          },
          path: {
            type: 'string',
            description: 'set/clear: res:// 路径的 .gd 脚本（必须在编辑器中打开且是当前活跃 tab）。list: 可选，过滤特定脚本',
          },
          line: {
            type: 'number',
            description: 'set/clear: 1-based 行号（AI 友好；内部转 0-based CodeEdit 行号）',
          },
        },
        required: ['action'],
      },
    },
  ];
}

// ─── Tool handler ───────────────────────────────────────────────────────────

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'debug') return null;

  const action = args.action as string;
  if (!action) return opsErrorResult('INVALID_PARAMS', 'action is required');
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return opsErrorResult('INVALID_ACTION', `Unknown action: ${action}. Supported: ${ACTIONS.join(', ')}`);
  }

  // All actions are editor-only: breakpoints need EditorInterface +
  // CodeEdit. In editor mode GodotServer dispatches to EditorToolExecutor
  // before reaching this module, so this branch only fires in headless.
  return opsErrorResult(
    'EDITOR_ONLY',
    `Action "${action}" requires Editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin. ` +
      'Breakpoints need EditorInterface + CodeEdit (unavailable headless).',
  );
}

// ─── Tool metadata ──────────────────────────────────────────────────────────

export const TOOL_META: Record<
  string,
  { readonly: boolean; long_running: boolean; actionRisks?: Record<string, RiskLevel> }
> = {
  debug: {
    readonly: true,
    long_running: false,
    actionRisks: {
      set_breakpoint: 'read',
      clear_breakpoint: 'read',
      list_breakpoints: 'read',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
};
