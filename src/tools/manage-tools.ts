// src/tools/manage-tools.ts — manage_tools meta-tool (Task 4)
//
// Always-available tool for dynamically managing tool group activation.
// Belongs to the protected 'core' group and cannot be deactivated.

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import type { ConnectionState } from '../types.js';
import {
  TOOL_GROUPS,
  setActiveGroups,
  getActiveGroups,
  notifyToolsChanged,
  LEGACY_TOOL_MAP,
} from '../core/tool-registry.js';
import { opsSuccess, opsError } from './shared.js';

type ManageAction = 'list_groups' | 'activate' | 'deactivate' | 'sync' | 'reconnect' | 'migrate';

export interface ConnectionStatus {
  editor: { installed: boolean; connected: boolean; state: ConnectionState | null };
  bridge: { note: string };
}

/** Optional callback fired when groups change (set by GodotServer). */
let _onGroupsChanged: (() => void) | null = null;

/** Connection status provider (set by GodotServer). */
let _connectionStatusProvider: (() => ConnectionStatus) | null = null;

/** Reconnect editor handler (set by GodotServer). */
let _reconnectEditor: (() => Promise<{ connected: boolean; detail: string }>) | null = null;

/** Set notification callback (called by GodotServer). */
export function setOnGroupsChanged(fn: (() => void) | null): void {
  _onGroupsChanged = fn;
}

/** Set connection status provider (called by GodotServer). */
export function setConnectionStatusProvider(fn: (() => ConnectionStatus) | null): void {
  _connectionStatusProvider = fn;
}

/** Set reconnect editor handler (called by GodotServer). */
export function setReconnectEditor(fn: (() => Promise<{ connected: boolean; detail: string }>) | null): void {
  _reconnectEditor = fn;
}

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'manage_tools',
      description:
        '动态管理工具组的启用/停用状态。始终可用，不可被禁用。' +
        '支持 list_groups（列出所有组）、activate（启用组）、deactivate（停用组）、sync（同步连接状态）、reconnect（手动重连）。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['list_groups', 'activate', 'deactivate', 'sync', 'reconnect', 'migrate'],
            description: '操作类型',
          },
          groups: {
            type: 'array',
            items: { type: 'string' },
            description: '目标组名数组（activate/deactivate 时使用）',
          },
        },
        required: ['action'],
      },
    },
  ];
}

export async function handleTool(
  toolName: string,
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (toolName !== 'manage_tools') return null;

  const action = args.action as ManageAction;

  switch (action) {
    case 'list_groups': return handleListGroups();
    case 'activate': return handleActivate(args);
    case 'deactivate': return handleDeactivate(args);
    case 'sync': return handleSync();
    case 'reconnect': return await handleReconnect();
    case 'migrate': return handleMigrate();
    default:
      return textResult(JSON.stringify(opsError('INVALID_ACTION', `Unknown action: ${action}`)));
  }
}

function handleListGroups(): ToolResult {
  const active = getActiveGroups();
  const groups = Object.entries(TOOL_GROUPS).map(([name, def]) => ({
    name,
    description: def.description,
    active: active.has(name),
    protected: def.protected ?? false,
    requires: def.requires,
    toolCount: def.tools.length,
  }));
  return textResult(JSON.stringify(opsSuccess({ groups })));
}

function handleActivate(args: Record<string, unknown>): ToolResult {
  const targetGroups = (args.groups as string[]) ?? [];
  if (targetGroups.length === 0) {
    return textResult(JSON.stringify(opsError('MISSING_GROUPS', 'groups array is required for activate')));
  }
  const current = getActiveGroups();
  const updated = new Set(current);
  for (const g of targetGroups) {
    if (TOOL_GROUPS[g]) updated.add(g);
  }
  setActiveGroups(updated);
  _onGroupsChanged?.();
  notifyToolsChanged();
  return textResult(JSON.stringify(opsSuccess({
    activated: targetGroups,
    activeGroups: [...updated],
  })));
}

function handleDeactivate(args: Record<string, unknown>): ToolResult {
  const targetGroups = (args.groups as string[]) ?? [];
  if (targetGroups.length === 0) {
    return textResult(JSON.stringify(opsError('MISSING_GROUPS', 'groups array is required for deactivate')));
  }
  // Reject attempts to deactivate protected groups
  const protectedNames = targetGroups.filter(g => TOOL_GROUPS[g]?.protected);
  if (protectedNames.length > 0) {
    return textResult(JSON.stringify(opsError(
      'PROTECTED_GROUP',
      `Cannot deactivate protected groups: ${protectedNames.join(', ')}`,
    )));
  }
  const current = getActiveGroups();
  const updated = new Set(current);
  for (const g of targetGroups) updated.delete(g);
  setActiveGroups(updated);
  _onGroupsChanged?.();
  notifyToolsChanged();
  return textResult(JSON.stringify(opsSuccess({
    deactivated: targetGroups,
    activeGroups: [...updated],
  })));
}

async function handleReconnect(): Promise<ToolResult> {
  let editor: { reconnected: boolean; detail: string } | null;
  if (_reconnectEditor) {
    const r = await _reconnectEditor();
    editor = { reconnected: r.connected, detail: r.detail };
  } else {
    editor = null;
  }
  return textResult(JSON.stringify(opsSuccess({
    editor,
    bridge: { reconnected: false, detail: 'bridge 每请求建连,无需重连;用 game_query(method=ping) 探测' },
  })));
}

function handleSync(): ToolResult {
  const provider = _connectionStatusProvider;
  const groups = Object.entries(TOOL_GROUPS).map(([name, def]) => {
    const requires = def.requires ?? [];
    let status: string;
    if (!provider) {
      status = 'unknown (no provider)';
    } else {
      const cs = provider();
      if (requires.includes('editor')) status = cs.editor.connected ? 'connected' : 'disconnected';
      else if (requires.includes('bridge')) status = 'probe-required';
      else status = 'n/a';
    }
    return { name, requires, status };
  });
  return textResult(JSON.stringify(opsSuccess({
    groups,
    editor: provider?.().editor ?? null,
    bridge: provider?.().bridge ?? null,
  })));
}

export const TOOL_META = {
  manage_tools: { readonly: true, long_running: false },
};

function handleMigrate(): ToolResult {
  const mapping: Record<string, { tool: string; action: string }> = {};
  const renamed: Record<string, string> = {};
  const removed: string[] = [];
  const unchanged = ['confirm_and_execute', 'godot_advanced_tool', 'manage_tools', 'godot_list_instances', 'godot_select_instance'];

  for (const [oldName, target] of Object.entries(LEGACY_TOOL_MAP)) {
    mapping[oldName] = target;
    removed.push(oldName);
    if (oldName.includes('_')) {
      renamed[oldName] = `${target.tool}(action="${target.action}")`;
    }
  }

  return textResult(JSON.stringify(opsSuccess({
    version: '0.18.0',
    description: '旧工具名到新 (tool, action) 的迁移映射',
    mapping,
    renamed,
    removed,
    unchanged,
  })));
}
