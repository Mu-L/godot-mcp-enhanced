import type { Tool } from "@modelcontextprotocol/server";
import type { ToolContext, ToolResult } from '../types.js';
import { opsErrorResult } from './shared.js';
import type { RiskLevel } from '../core/tool-registry.js';

// ─── debug 组 — Phase 1 断点管理 + Phase 2/3 调试器集成 (editor-only) ──────────
//
// Phase 1 (CMP-3): set/clear/list breakpoint — 走 CodeEdit gutter 路径(同步)。
// Phase 2 (CMP-14): stack_trace/inspect_frame/evaluate — 读栈帧/变量/表达式求值(异步)。
// Phase 3 (CMP-14): step/continue/pause/reload_scripts — 执行控制 + 热重载(异步)。
//
// Phase 2/3 经 EditorDebuggerPlugin 子类(debugger_bridge.gd)与运行中游戏调试会话交互。
// 对标竞品 regiellis/godot-mcp-go 的 debug 组(state/frame/step/resume/pause/reload_scripts)。
//
// Headless mode: 所有 action 硬返回 EDITOR_ONLY — 需要 EditorInterface +
// CodeEdit(Phase 1)+ EditorDebuggerSession(Phase 2/3),均为 editor 专属 API。

const TOOL_NAMES = ['debug'] as const;
export { TOOL_NAMES };

const ACTIONS = [
  // Phase 1(同步)
  'set_breakpoint', 'clear_breakpoint', 'list_breakpoints',
  // Phase 2(异步)
  'stack_trace',        // 读当前断点调用栈 + 当前帧变量
  'inspect_frame',      // 切栈帧 + 读该帧局部变量
  'evaluate',           // 断点上下文表达式求值(REPL)
  // Phase 3(异步)
  'step',               // 单步执行(mode: into/over)
  'continue',           // 继续运行到下一断点
  'pause',              // 请求中断(暂停运行中游戏)
  'reload_scripts',     // 热重载指定脚本到运行中游戏
] as const;

// ─── Tool definitions ──────────────────────────────────────────────────────

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'debug',
      description: [
        '交互式调试器 — 断点管理 + Phase 2/3 调试器集成（editor-only）。',
        'Phase 1: set/clear/list breakpoint（走 CodeEdit gutter，CMP-14 后支持自动打开脚本）。',
        'Phase 2: stack_trace（读调用栈+变量）/ inspect_frame（切帧+读变量）/ evaluate（断点上下文 REPL）。',
        'Phase 3: step（into/over 单步）/ continue（继续到下断点）/ pause（请求中断）/ reload_scripts（热重载）。',
        '⚠️ editor-only：需 GODOT_MCP_MODE=editor + 安装 Godot 插件 + 运行中游戏(F5)。',
        '⚠️ Phase 2/3 需游戏暂停在断点(step/inspect/evaluate)或运行中(pause/reload)。',
      ].join(' '),
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: [...ACTIONS],
            description: 'Action type: set_breakpoint | clear_breakpoint | list_breakpoints | stack_trace | inspect_frame | evaluate | step | continue | pause | reload_scripts',
          },
          path: {
            type: 'string',
            description: 'set/clear/list: res:// 路径的 .gd 脚本（CMP-14 后自动打开，无需预先激活 tab）',
          },
          line: {
            type: 'number',
            description: 'set/clear: 1-based 行号',
          },
          frame_index: {
            type: 'number',
            description: 'inspect_frame: 要查看的栈帧索引（0=最内层，默认 0）',
          },
          expression: {
            type: 'string',
            description: 'evaluate: 要在断点上下文求值的 GDScript 表达式',
          },
          mode: {
            type: 'string',
            enum: ['into', 'over'],
            description: 'step: 单步模式（into=进入函数, over=跨过函数；注：Godot wire 协议不支持 out）',
          },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'reload_scripts: 要热重载的 res:// 脚本路径数组',
          },
          all_vars: {
            type: 'boolean',
            description: 'stack_trace/inspect_frame: true=返回全部变量（默认截断 100 个）',
          },
          filter: {
            type: 'string',
            description: 'stack_trace/inspect_frame: 变量名子串过滤',
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

  // All actions are editor-only: Phase 1 needs EditorInterface + CodeEdit;
  // Phase 2/3 needs EditorDebuggerSession + debugger plugin. All unavailable headless.
  return opsErrorResult(
    'EDITOR_ONLY',
    `Action "${action}" requires Editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin. ` +
      'Phase 1 (breakpoints) needs EditorInterface + CodeEdit; Phase 2/3 (stack/step/reload) needs a running game with the debugger attached.',
  );
}

// ─── Tool metadata ──────────────────────────────────────────────────────────

export const TOOL_META: Record<
  string,
  { readonly: boolean; long_running: boolean; actionRisks?: Record<string, RiskLevel> }
> = {
  debug: {
    // 组级:含 write action(step/continue/pause/reload),非纯只读
    readonly: false,
    // Phase 2/3 异步操作可能长时(step/reload),标 long_running
    long_running: true,
    actionRisks: {
      // Phase 1(断点是 gutter 操作,不改运行时状态)
      set_breakpoint: 'read',
      clear_breakpoint: 'read',
      list_breakpoints: 'read',
      // Phase 2(读取类)
      stack_trace: 'read',
      inspect_frame: 'read',
      evaluate: 'read',  // 求值可能有副作用(如调用 setter),但默认归 read;竞品也不 gate
      // Phase 3(执行控制/热重载有副作用)
      step: 'write',
      continue: 'write',
      pause: 'write',
      reload_scripts: 'write',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
};
