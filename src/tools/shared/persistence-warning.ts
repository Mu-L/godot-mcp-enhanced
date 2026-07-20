import type { ToolResult } from '../../types.js';

const RUNTIME_PERSIST_HINT = '是运行时操作，headless 进程退出后丢失。持久化须 add_node + save_scene 写入 .tscn（运行时工具仅用于验证/测试）';

/** 运行时工具返回末尾追加的不持久化提示。action = 工具 action 名（如 audio_play）。 */
export function runtimePersistWarning(action: string): string {
  return `\n⚠ ${action} ${RUNTIME_PERSIST_HINT}`;
}

/**
 * 把 runtimePersistWarning 追加到 ToolResult 的首个 text content 末尾。
 * - 仅在成功结果（!isError）且首个 content 是 text 时追加，错误结果保持原样
 * - 用于运行时工具（audio/particles/signal/tilemap/animation 等）返回包装
 */
export function appendRuntimePersistWarning(result: ToolResult, action: string): ToolResult {
  if (result.isError) return result;
  const first = result.content[0];
  if (!first || first.type !== 'text') return result;
  first.text += runtimePersistWarning(action);
  return result;
}
