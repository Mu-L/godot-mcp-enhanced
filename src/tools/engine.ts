import type { Tool } from "@modelcontextprotocol/server";
import type { ToolContext, ToolResult } from '../types.js';
import { opsErrorResult } from './shared.js';
import type { RiskLevel } from '../core/tool-registry.js';

// ─── CMP-4 (2026-08-08): engine 组 — 实时 ClassDB 内省 (editor-only) ──────────
//
// 让 AI 发现运行中引擎的实际可用类/方法/属性/信号/枚举。
// 补静态 docs 工具(extension_api.json 4.7 快照)的缺口:
// - 第三方 addon 注册的 ClassDB 类不在静态 JSON 里
// - 4.6/4.8 build 的 API 差异不在 4.7 快照里
// - 自定义 C# / GDExtension 注册的类不在 JSON 里
//
// 心智模型:静态查 docs / 实时查 engine。docs 是离线快照(4.7),
// engine 是运行中引擎的真实 ClassDB(实际版本 + 第三方 addon + 自定义类)。
//
// Headless mode: 三个 action 硬返回 EDITOR_ONLY — ClassDB 在 gdscript-executor
// 沙箱里被列为危险模式(gdscript-executor.ts:83),实时内省走 editor 层直调(不经沙箱)。

const TOOL_NAMES = ['engine'] as const;
export { TOOL_NAMES };

const ACTIONS = ['class_info', 'search', 'get_inheritance'] as const;

// ─── Tool definitions ──────────────────────────────────────────────────────

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'engine',
      description: [
        '实时 ClassDB 内省（editor-only）：查询运行中引擎的实际可用类/方法/属性/信号/枚举。',
        'class_info: 查单个类的完整结构（属性/方法/信号/枚举/继承），默认 no_inherit=true 只看本类 own 成员。',
        'search: substring 匹配类名（返回 {name, parent} 列表，上限 100 条）。搜到类名后用 class_info 查具体成员。',
        'get_inheritance: 返回类的继承链（从本类到 Object）。',
        '⚠️ 补 docs 工具的缺口：docs 是静态 4.7 快照（不含第三方 addon/自定义类/4.6/4.8 差异），engine 是运行中引擎的真实 ClassDB。',
        '⚠️ editor-only：headless 模式返回 EDITOR_ONLY（ClassDB 在沙箱里被拦，走 editor 层直调）。',
      ].join(' '),
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: [...ACTIONS],
            description: 'Action type: class_info | search | get_inheritance',
          },
          class: {
            type: 'string',
            description: 'class_info/get_inheritance: 类名（如 Node、Sprite2D、RigidBody3D，或第三方 addon 注册的类名）',
          },
          query: {
            type: 'string',
            description: 'search: substring 匹配类名（大小写不敏感）',
          },
          no_inherit: {
            type: 'boolean',
            description: 'class_info: true=只看本类 own 成员（默认，翻继承链会淹没新 API）；false=含继承链合并',
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
  if (name !== 'engine') return null;

  const action = args.action as string;
  if (!action) return opsErrorResult('INVALID_PARAMS', 'action is required');
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return opsErrorResult('INVALID_ACTION', `Unknown action: ${action}. Supported: ${ACTIONS.join(', ')}`);
  }

  // All actions are editor-only: ClassDB introspection runs in the editor addon
  // (not through the sandboxed gdscript-executor where ClassDB is blocked).
  return opsErrorResult(
    'EDITOR_ONLY',
    `Action "${action}" requires Editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin. ` +
      'ClassDB introspection runs in the editor addon (not the sandboxed executor).',
  );
}

// ─── Tool metadata ──────────────────────────────────────────────────────────

export const TOOL_META: Record<
  string,
  { readonly: boolean; long_running: boolean; actionRisks?: Record<string, RiskLevel> }
> = {
  engine: {
    readonly: true,
    long_running: false,
    actionRisks: {
      class_info: 'read',
      search: 'read',
      get_inheritance: 'read',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
};
