import type { ChildProcess } from 'child_process';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ─── Shared type definitions for tool handlers ─────────────────────────────

export type ToolResult = CallToolResult;

export interface ToolContext {
  opsScript: string;
  findGodot: (projectPath?: string) => Promise<string>;
  runningProcess: ChildProcess | null;
  setRunningProcess: (proc: ChildProcess | null, skipBusyCheck?: boolean) => void;
  outputBuffer: string[];
  setOutputBuffer: (buf: string[]) => void;
  processStartTime: number;
  setProcessStartTime: (t: number) => void;
  projectDir: string;
  setProjectDir: (d: string) => void;
  parseGodotConfig: (content: string) => Record<string, unknown>;
  /** P1-2 (2026-07-06 review): editor 文本资源写守卫 — script/scene 写脚本前调,
   *  editorExecutor 可用时由 dispatcher 注入(经 WS 调 guard_text_resource_write)。
   *  返回 {blocked:true} 表示编辑器内存状态冲突(打开的脚本/缓存 Resource), 应中止写。
   *  headless 无编辑器状态可守, 回调未注入(undefined), 调用方跳过。 */
  checkEditorTextResourceWrite?: (path: string) => Promise<{ blocked: boolean; code?: number; message?: string }>;
  /** P1-2: 场景离线保存守卫(防覆盖编辑器中打开的场景, 与 guard_offline_scene_save 对称)。 */
  checkEditorSceneSave?: (path: string) => Promise<{ blocked: boolean; code?: number; message?: string }>;
}

// Helper to create a text result
export function textResult(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }] };
}

// Helper to create an error result (signals failure to MCP clients)
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Safely extract a message string from an unknown thrown value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

// ─── Middleware types (competitive borrowing Phase 5) ──────────────────────────

export type ConnectionState = 'disconnected' | 'connected' | 'degraded' | 'reconnecting';

export interface DispatchContext {
  toolName: string;
  args: Record<string, unknown>;
  startTime: number;
  phase: 'before' | 'after';
}

export type MiddlewareResult =
  | { passed: true }
  | { rejected: true; error: ToolResult };

export interface Middleware {
  name: string;
  before(ctx: DispatchContext): Promise<MiddlewareResult>;
  after?(ctx: DispatchContext, result: ToolResult): Promise<ToolResult>;
}

/** Delegate for proxy tool to re-dispatch through the full middleware chain. */
export type ToolCallDelegate = (toolName: string, args: Record<string, unknown>) => Promise<ToolResult>;
