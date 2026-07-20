import type { ToolResult } from '../../types.js';

const RUNTIME_PERSIST_HINT = '是运行时操作，headless 进程退出后丢失。持久化须 add_node + save_scene 写入 .tscn（运行时工具仅用于验证/测试）';

/** 运行时工具返回末尾追加的不持久化提示。action = 工具 action 名（如 audio_play）。 */
export function runtimePersistWarning(action: string): string {
  return `\n⚠ ${action} ${RUNTIME_PERSIST_HINT}`;
}

/**
 * 把 runtimePersistWarning 作为独立 text content 元素追加到 ToolResult。
 * - 仅在成功结果（!isError）时追加，错误结果保持原样
 * - 不可变：不修改 content[0]（parseGdscriptResult 返回的 content[0] 是 JSON 字符串，
 *   MCP 客户端用 JSON.parse(result.content[0].text) 消费；mutate 末尾会破坏 JSON 语法）
 * - MCP content 数组多元素，AI 遍历看到独立 warning text（content[1]），原 JSON（content[0]）不被破坏
 * - 用于运行时工具（audio/particles/signal/tilemap/animation 等）返回包装
 */
export function appendRuntimePersistWarning(result: ToolResult, action: string): ToolResult {
  if (result.isError) return result;
  return {
    ...result,
    content: [...result.content, { type: 'text', text: runtimePersistWarning(action).trim() }],
  };
}
