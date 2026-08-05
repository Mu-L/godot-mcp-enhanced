import type { Tool } from "@modelcontextprotocol/server";

// src/tools/editor-sync.ts — Editor real-time scene tree sync tools
import type { ToolResult } from '../types.js';
import type { RiskLevel } from '../core/tool-registry.js';
import { textResult } from '../types.js';

const TOOL_NAMES = ['editor'] as const;

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean; actionRisks: Record<string, RiskLevel> }> = {
  editor: {
    readonly: false,
    long_running: false,
    // 该工具原不在 GUARDED 表中 → 所有 action 此前一律不确认 → 零行为改变要求全部标 'read'
    // （任何非 read 都会收紧确认，超出本次迁移范围；见 spec §4.1）
    actionRisks: {
      sync_start: 'read',
      sync_stop: 'read',
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
