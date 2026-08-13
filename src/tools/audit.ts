// src/tools/audit.ts
/**
 * audit — 操作审计日志查询工具(G3,2026-08-13)。
 * action=get_log 读 {project}/.godot/mcp_audit.jsonl 统计回放;
 * action=suggest_rollback 对指定条目给诚实回滚建议(create 可删/project.godot before/其余 Git)。
 * 只读工具(审计数据由 ToolDispatcher 的 audit after middleware 自动落盘,见 audit-log.ts)。
 */
import type { Tool } from '@modelcontextprotocol/server';
import type { ToolResult, ToolContext } from '../types.js';
import { textResult } from '../types.js';
import { opsSuccess, opsErrorResult } from './shared.js';
import { readAuditLog, suggestRollback, AUDIT_LOG_REL } from '../core/audit-log.js';
import { resolveProjectPath } from '../core/path-utils.js';
import { join } from 'path';

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'audit',
    description: '操作审计日志查询(G3)。action=get_log 读 {project}/.godot/mcp_audit.jsonl 统计回放'
      + '(操作计数/风险高亮/最近条目/时间范围);action=suggest_rollback 对指定条目给诚实回滚建议'
      + '(create 类可删/project.godot before_values/其余靠 Git)。write/destructive 操作经 audit '
      + 'after middleware 自动落盘(changed_files 为项目相对路径,PII 护栏)。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['get_log', 'suggest_rollback'],
          description: 'get_log=读统计回放;suggest_rollback=对指定条目给回滚建议',
        },
        project_path: { type: 'string', description: '项目路径(默认 resolveProjectPath 自动解析)' },
        limit: { type: 'number', description: 'get_log:取末尾 N 条(默认全部)' },
        since: { type: 'string', description: 'get_log:ISO 时间过滤(只看此后)' },
        entry_index: { type: 'number', description: 'suggest_rollback:条目序号(从 get_log entries[].index)' },
      },
      required: ['action'],
    },
  }];
}

export async function handleTool(
  toolName: string,
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (toolName !== 'audit') return null;
  const action = args.action as string;
  const projectPath =
    (typeof args.project_path === 'string' && args.project_path) || resolveProjectPath();
  if (!projectPath) {
    return opsErrorResult(
      'INVALID_PARAMS',
      'project_path required (pass explicitly or run from a Godot project)',
    );
  }
  try {
    if (action === 'get_log') {
      const summary = await readAuditLog(projectPath, {
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        since: typeof args.since === 'string' ? args.since : undefined,
      });
      return textResult(
        JSON.stringify(
          opsSuccess(summary, [
            `audit 文件: ${join(projectPath, ...AUDIT_LOG_REL)}`,
            'changed_files 为项目相对路径(PII 护栏);riskHighlights 标 destructive/delete/failed',
            '回滚用 suggest_rollback + entry_index',
          ]),
        ),
      );
    }
    if (action === 'suggest_rollback') {
      const idx = typeof args.entry_index === 'number' ? args.entry_index : -1;
      if (idx < 0) {
        return opsErrorResult(
          'INVALID_PARAMS',
          'entry_index required (get it from get_log entries[].index)',
        );
      }
      const summary = await readAuditLog(projectPath); // 全量,每条带全局 index
      const entry = summary.entries.find((e) => e.index === idx);
      if (!entry) {
        return opsErrorResult(
          'NOT_FOUND',
          `entry_index ${idx} not found (total entries: ${summary.entries.length})`,
        );
      }
      const suggestion = suggestRollback(entry);
      return textResult(
        JSON.stringify(
          opsSuccess({ entry, suggestion }, [
            'supported=true 仅 create 类可自动删 / project.godot 需 before_values;其余靠 Git(诚实)',
          ]),
        ),
      );
    }
    return opsErrorResult('INVALID_PARAMS', `unknown action: ${action}`);
  } catch (err) {
    return opsErrorResult(
      'AUDIT_ERROR',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export const TOOL_META = {
  audit: {
    readonly: true,
    long_running: false,
    actionRisks: { get_log: 'read' as const, suggest_rollback: 'read' as const },
  },
};
