// src/core/EditorToolExecutor.ts
import type { EditorConnection } from './EditorConnection.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export class EditorToolExecutor {
  private syncActive = false;
  private treeChangeBuffer: Array<{ type: string; path: string; node_type: string }> = [];
  private readonly conn: EditorConnection;

  constructor(conn: EditorConnection) {
    this.conn = conn;
    this.conn.onDisconnect = () => {
      this.syncActive = false;
      this.treeChangeBuffer = [];
    };
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      if (toolName === 'editor_sync_start') {
        return this.handleSyncStart(args);
      }
      if (toolName === 'editor_sync_stop') {
        return this.handleSyncStop(args);
      }
      if (toolName === 'editor_get_scene_tree') {
        return this.handleGetSceneTree(args);
      }

      // Default: forward to plugin
      const result = await this.conn.request(toolName, args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  private handleTreeChange = (params: unknown): void => {
    const p = params as { type: string; path: string; node_type: string };
    this.treeChangeBuffer.push(p);
  };

  private async handleSyncStart(args: Record<string, unknown>): Promise<ToolResult> {
    if (this.syncActive) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SYNC_ALREADY_ACTIVE' }) }],
        isError: true,
      };
    }
    this.treeChangeBuffer = [];
    this.conn.onNotification('scene_tree_changed', this.handleTreeChange);
    try {
      const result = await this.conn.request('editor_sync_start', args);
      this.syncActive = true;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      this.conn.offNotification('scene_tree_changed', this.handleTreeChange);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  private async handleSyncStop(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.syncActive) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SYNC_NOT_ACTIVE' }) }],
        isError: true,
      };
    }
    this.conn.offNotification('scene_tree_changed', this.handleTreeChange);
    this.syncActive = false;
    const changes = [...this.treeChangeBuffer];
    this.treeChangeBuffer = [];
    try {
      const result = await this.conn.request('editor_sync_stop', args);
      const merged = { ...(result as Record<string, unknown>), buffered_changes: changes };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(merged) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  private async handleGetSceneTree(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.conn.request('editor_get_scene_tree', args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
}
