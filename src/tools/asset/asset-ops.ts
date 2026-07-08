// src/tools/asset/asset-ops.ts — merged asset 工具（7 action）
//
// 单工具聚合：create / path / batch / undo / save / list_shapes / list_materials。
// 设计依据：T1-T6 GD 侧全就绪（command_handler 5 路由 + asset_commands 真实 handle_* +
// 工厂/阵列/放置/undo/save）。本模块为 TS 入口，负责：(1) 暴露工具 schema 给 MCP
// 客户端；(2) list_* 静态返回；(3) 写动作经 editor 盲转持久化。
//
// 路由大图（已核实 ToolDispatcher.ts:347-357 + editorExecutor 注入 GodotServer.ts:420-421）：
//   editor 模式：ToolDispatcher.executeToolCall 对所有工具盲转 currentExecutor.execute。
//     - asset_create / asset_path / asset_batch / asset_undo / asset_save 在
//       command_handler.gd match 命中 → 持久化（视口可见、可 undo）。
//     - asset_list_shapes / asset_list_materials 在 command_handler.gd 无 match → -32601
//       → ToolDispatcher._isUnknownMethod 检测 → 回退 dispatchTool → 本 handleTool
//       → 静态返回（多 1 次 WS 往返，功能正确）。
//   headless 模式：ToolDispatcher currentExecutor=null，dispatchTool → 本 handleTool：
//     - list_* 静态返回。
//     - create/path/batch/undo/save → 返 EDITOR_ONLY（无编辑器可持久化）。
//
// 因此本 handleTool **不**实现 ctx.editorExecutor 探索块（brief Step 2 原始设计已被
// IMPORTANT-1 修订为依赖 ToolDispatcher 盲转——见 ToolDispatcher.ts:347-357）。

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../../types.js';
import type { RiskLevel } from '../../core/tool-registry.js';
import { opsErrorResult } from '../shared.js';
import { SHAPES, SHAPE_NAMES, MATERIAL_PRESETS } from './schema.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const ACTIONS = ['create', 'path', 'batch', 'undo', 'save', 'list_shapes', 'list_materials'] as const;

// ─── 工具定义 ─────────────────────────────────────────────────────────────────

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'asset',
    description: '参数化 3D shape 生成（11 shape）+ 路径阵列 + batch + undo + save 预制件。'
      + 'create/path/batch/undo/save 经 editor 持久化（视口可见、可 undo）；'
      + 'list_shapes/list_materials 静态返回。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string', description: 'Godot 项目目录' },
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: '操作类型',
        },
        shape: {
          type: 'string',
          enum: [...SHAPE_NAMES],
          description: 'create/path: shape 名（见 list_shapes）',
        },
        params: { type: 'object', description: 'shape 参数（见 list_shapes 默认值）' },
        material: {
          type: ['string', 'object', 'null'],
          description: '预设名 / PBR dict（color(hex),alpha,emissive,metallic,roughness）/ res://.tres / null',
        },
        name: { type: 'string', description: '节点名（碰撞自增 _001）' },
        parent: { type: 'string', description: '父节点路径（绝对 /Root/X 或相对 X/Y）' },
        position: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
        rotation: { type: 'array', items: { type: 'number' }, description: '[x,y,z] 弧度' },
        scale: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
        items: { type: 'array', description: 'batch: [{shape,params,material,name,...}] ≤64' },
        path: { type: 'array', description: 'path: [[x,y,z],...] ≥2 点（与 path_node 互斥）' },
        path_node: { type: 'string', description: 'path: 场景 Path3D 节点路径（与 path 互斥）' },
        mode: {
          type: 'string',
          enum: ['discrete', 'continuous'],
          description: 'path 采样模式',
        },
        spacing: { type: 'number', description: 'path discrete: 等间距（与 count 互斥）' },
        count: { type: 'number', description: 'path discrete: 等数量（与 spacing 互斥）' },
        align: {
          type: 'string',
          enum: ['none', 'path', 'normal'],
          description: 'path 朝向（默认 path）',
        },
        align_vertices: {
          type: 'boolean',
          description: 'path continuous+spacing: 折线顶点段边界对齐',
        },
        node_path: { type: 'string', description: 'save: 要存的子树节点路径' },
        resource_path: { type: 'string', description: 'save: res://xxx.tscn 输出路径' },
      },
      required: ['action'],
    },
  }];
}

// ─── 工具处理 ─────────────────────────────────────────────────────────────────

const TOOL_NAMES = ['asset'] as const;

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<ToolResult | null> {
  // 非 asset 工具不归本模块处理
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return null;

  // action 经 inputSchema.enum 校验，但 enum 是 schema 层约束，TS 无法窄化。
  // 此处是整个模块唯一允许的裸 as（action 已 enum 校验通过）。
  const action = args.action as string;
  if (!action) return opsErrorResult('INVALID_PARAMS', 'action is required');

  // ── list_* 静态返回（不经 editor，headless/editor 双模式都到此处）──
  // editor 模式下 list_* 经 ToolDispatcher 盲转到 command_handler → -32601 →
  // 回退 dispatchTool → 本 handleTool，多 1 次 WS 往返但功能正确。
  if (action === 'list_shapes') {
    return { content: [{ type: 'text', text: JSON.stringify({ shapes: SHAPES }) }] };
  }
  if (action === 'list_materials') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          presets: MATERIAL_PRESETS,
          custom_rule: '{color(hex 或 #hex),alpha?,emissive?,metallic?,roughness?}',
          external: 'res://*.tres',
        }),
      }],
    };
  }

  // ── create/path/batch/undo/save: editor 模式由 ToolDispatcher 盲转 ──
  // editor 模式不会到此（已被 currentExecutor.execute 转发到 command_handler）。
  // 仅 headless 模式 dispatchTool 落到此处 → 返 EDITOR_ONLY。
  return opsErrorResult(
    'EDITOR_ONLY',
    `asset action "${action}" requires Editor mode. Set GODOT_MCP_MODE=editor and install the Godot plugin.`,
  );
}

// ─── 工具元数据（注册到 tool-registry 供权限/风险分级）────────────────────────

export const TOOL_META: Record<string, {
  readonly: boolean;
  long_running: boolean;
  actionRisks?: Record<string, RiskLevel>;
}> = {
  asset: {
    readonly: false,
    long_running: false,
    actionRisks: {
      list_shapes: 'read',
      list_materials: 'read',
      create: 'write',
      path: 'write',
      batch: 'write',
      undo: 'write',
      save: 'write',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
};
