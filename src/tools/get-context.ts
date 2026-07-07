// src/tools/get-context.ts
/**
 * godot_get_context — 会话全景元工具。
 * 一次返回模式/项目/连接/场景快照/调用统计/工具组/workflow/rules/performance，
 * 减少 AI 反复 list_nodes/get_scene_tree/manage_tools(sync)/health 摸环境。
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { opsSuccess } from './shared.js';
import { getCallRecorder } from '../core/call-recorder.js';
import { listPromptDefs } from '../prompts.js';
import { TOOL_GROUPS, getActiveGroups } from '../core/tool-registry.js';

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'godot_get_context',
    description: '一次返回会话全景（模式/项目/连接/场景快照/最近调用统计/工具组/推荐 workflow/规则/性能），减少反复探路。headless 模式 scene=null。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string', description: '项目路径（可选；传了补 project/rules 字段，没传降级 null/[]）' },
        include_scene: { type: 'boolean', description: '是否采集场景快照（默认 true；headless 恒 null）' },
        include_performance: { type: 'boolean', description: '是否采集性能（默认 true；仅 bridge 有效）' },
      },
    },
  }];
}

export async function handleTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  if (toolName !== 'godot_get_context') return null;
  // 外层 try/catch：任何未预期错误都降级为 partial，永不抛给调用方
  try {
    return handleGetContext(args, ctx);
  } catch {
    return textResult(JSON.stringify(opsSuccess({
      status: 'partial',
      failedFields: ['__handler__'],
      hint: 'godot_get_context 内部异常，已降级返回',
    })));
  }
}

function handleGetContext(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const failedFields: string[] = [];
  const includeScene = args.include_scene !== false;
  const includePerf = args.include_performance !== false;
  const projectPath = args.project_path as string | undefined;

  const mode = safe(() => computeMode(ctx), 'mode', failedFields);
  const project = safe(() => readProject(projectPath), 'project', failedFields);
  const connections = safe(() => readConnections(ctx), 'connections', failedFields);
  const scene = (!includeScene || mode === 'headless' || mode === null)
    ? null
    : safe(() => readScene(mode as 'editor' | 'bridge', ctx), 'scene', failedFields);
  const callStats = safe(() => getCallRecorder().getStats(), 'callStats', failedFields);
  const recentCalls = safe(() => getCallRecorder().getRecent(50), 'recentCalls', failedFields);
  const toolGroups = safe(() => readToolGroups(), 'toolGroups', failedFields);
  const workflows = safe(
    () => listPromptDefs().map(p => ({ name: p.name, type: 'prompt' as const, desc: p.description })),
    'workflows',
    failedFields,
  );
  const rules = safe(() => readRules(projectPath), 'rules', failedFields);
  const performance = (includePerf && mode === 'bridge')
    ? safe(() => readPerformance(ctx), 'performance', failedFields)
    : null;

  return textResult(JSON.stringify(opsSuccess({
    status: failedFields.length === 0 ? 'ok' : 'partial',
    failedFields,
    mode,
    project,
    connections,
    scene,
    recentCalls,
    callStats,
    toolGroups,
    workflows,
    rules,
    performance,
    hint: 'scene.nodeCount=节点总数；recentCalls=最近操作；callStats.topTools=最常用工具；workflows=推荐入口(prompt)；performance 仅 bridge；status=partial 时看 failedFields',
  })));
}

/** 字段级降级 wrapper：抛错 → 字段名入 failedFields，返回 null。 */
function safe<T>(fn: () => T, field: string, failed: string[]): T | null {
  try { return fn(); } catch { failed.push(field); return null; }
}

// ─── 字段采集 helper ──────────────────────────────────────────────────────────

/** 摘要：bridge 连了→bridge，否则 editor 连了→editor，否则 headless。 */
function computeMode(ctx: ToolContext): 'headless' | 'editor' | 'bridge' {
  // MVP 占位：从 ctx 读 connectionMode（mock 或后续 ToolContext 扩展注入）；
  // 读不到或非 bridge/editor → headless。真实 editor/bridge 探测待 follow-up 接入
  // manage-tools.ts handleSync 的 editorConn/bridge ping 探测逻辑。
  const m = (ctx as unknown as { connectionMode?: string }).connectionMode;
  if (m === 'bridge' || m === 'editor') return m;
  return 'headless';
}

/**
 * project = { name, godot, path }。读 project.godot + godot --version。
 * MVP 占位：始终返回 null。真实采集（复用 src/tools/project.ts 解析 +
 * findGodot 版本探测）待 follow-up。
 */
function readProject(_projectPath: string | undefined): { name: string; godot: string; path: string } | null {
  return null;
}

/**
 * editor 安装/连接态 + bridge 探测。
 * MVP 占位：返回默认未连接态。真实探测（参照 manage-tools.ts handleSync：
 * editorConn 注入/连接 + game-bridge ping）待 follow-up。
 */
function readConnections(_ctx: ToolContext): {
  editor: { installed: boolean; connected: boolean; state: string | null };
  bridge: { status: string };
} {
  return { editor: { installed: false, connected: false, state: null }, bridge: { status: 'probe-required' } };
}

/**
 * 场景快照：editor 用 editor_get_scene_tree，bridge 用 game_query(get_tree)。
 * headless 不调（外层已 null）。
 * MVP 占位：始终返回 null。真实采集（editor-sync 场景树 / game-bridge get_tree
 * + 递归统计 typeTopN，>2000 节点只返回 nodeCount）待 follow-up。
 */
function readScene(_mode: string, _ctx: ToolContext): { path: string; root: string; nodeCount: number; typeTopN: Array<{ type: string; n: number }> } | null {
  return null;
}

/** toolGroups 清单。复用 manage-tools.ts handleListGroups 模式。 */
function readToolGroups(): Array<{ name: string; active: boolean; requires: string[] }> {
  const active = getActiveGroups();
  return Object.entries(TOOL_GROUPS).map(([name, def]) => ({
    name,
    active: active.has(name),
    requires: def.requires,
  }));
}

/** rules = {project_path}/.claude/rules/*.md 文件名。无 project_path → []。 */
function readRules(projectPath: string | undefined): string[] {
  if (!projectPath) return [];
  // MVP 占位：不采集文件系统。真实读取（src/core/path-utils.ts 安全 join +
  // glob .claude/rules/*.md，返回 basename 列表）待 follow-up。
  return [];
}

/**
 * performance = { fps, memory_mb }。仅 bridge（外层已守卫）。game_query(get_performance)。
 * MVP 占位：始终返回 null。真实采集（game-bridge get_performance）待 follow-up。
 */
function readPerformance(_ctx: ToolContext): { fps: number; memory_mb: number } | null {
  return null;
}

export const TOOL_META = {
  godot_get_context: { readonly: true, long_running: false, actionRisks: { _: 'read' as const } },
};
