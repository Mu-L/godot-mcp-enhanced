// src/tools/editor-sync.ts — Editor real-time scene tree sync tools
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolResult } from '../types.js';
import type { RiskLevel } from '../core/tool-registry.js';
import { textResult } from '../types.js';

const TOOL_NAMES = ['editor'] as const;

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean; actionRisks: Record<string, RiskLevel> }> = {
  editor: {
    readonly: false,
    long_running: false,
    actionRisks: {
      sync_start: 'process',  // 启动场景树监听
      sync_stop: 'process',  // 停止监听
      get_scene_tree: 'read',
    },
  },
};

const EDITOR_NOT_CONNECTED = JSON.stringify({
  error: 'EDITOR_NOT_CONNECTED',
  message: 'These tools require editor mode with plugin connection. Use headless query_scene_tree as alternative.',
});

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'editor',
      description: 'Editor real-time operations: sync_start (start scene tree listening), sync_stop (stop listening), get_scene_tree (get current snapshot). Requires editor mode with plugin connection.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          project_path: { type: 'string', description: 'Godot project directory path' },
          action: {
            type: 'string',
            enum: ['sync_start', 'sync_stop', 'get_scene_tree'],
            description: 'Operation type',
          },
        },
        required: ['action'],
      },
    },
  ];
}



export async function handleTool(
  name: string,
  _args: Record<string, unknown>,
  _ctx: unknown,
): Promise<ToolResult | null> {
  // Check if this is one of our tools
  const names: readonly string[] = TOOL_NAMES;
  if (!names.includes(name)) return null;

  // In headless mode, these tools return error (not silent failure)
  // In editor mode, EditorToolExecutor handles them directly, never reaching here
  return textResult(EDITOR_NOT_CONNECTED);
}
