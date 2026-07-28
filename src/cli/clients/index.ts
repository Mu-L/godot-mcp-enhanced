/** 统一导出所有客户端适配器 + ALL_ADAPTERS 列表 */
import type { ClientAdapter } from './types.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CursorAdapter } from './cursor.js';
import { OpenCodeAdapter } from './opencode.js';
import { CodexAdapter } from './codex.js';
import { ClaudeDesktopAdapter } from './claude-desktop.js';
import { WindsurfAdapter } from './windsurf.js';
import { ClineAdapter } from './cline.js';
import { ZedAdapter } from './zed.js';
import { AntigravityAdapter } from './antigravity.js';
import { TraeAdapter } from './trae.js';
import { CherryStudioAdapter } from './cherry-studio.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { QwenCodeAdapter } from './qwen-code.js';
import { ZCodeAdapter } from './zcode.js';

export type { ClientAdapter } from './types.js';
export {
  ClaudeCodeAdapter, CursorAdapter, OpenCodeAdapter, CodexAdapter,
  ClaudeDesktopAdapter, WindsurfAdapter, ClineAdapter, ZedAdapter,
  AntigravityAdapter, TraeAdapter, CherryStudioAdapter, GeminiCliAdapter, QwenCodeAdapter, ZCodeAdapter,
};

export const ALL_ADAPTERS: ClientAdapter[] = [
  // project scope
  new ClaudeCodeAdapter(),
  new CursorAdapter(),
  new OpenCodeAdapter(),
  new GeminiCliAdapter(),
  new QwenCodeAdapter(),
  // global scope
  new CodexAdapter(),
  new ClaudeDesktopAdapter(),
  new WindsurfAdapter(),
  new ClineAdapter(),
  new ZedAdapter(),
  new AntigravityAdapter(),
  new TraeAdapter(),
  new CherryStudioAdapter(),
  new ZCodeAdapter(),
];
