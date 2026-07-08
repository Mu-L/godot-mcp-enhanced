import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from './logger.js';

/**
 * 读取 server instructions（静态中文速查卡）。
 *
 * 编译后位于 build/instructions.md；instructions.ts 在 build/core/，故默认路径上溯一级。
 * filePath 可选：省略走默认路径，传入则读指定路径（测试注入用）。
 *
 * 失败时返回 undefined：SDK 内部 `this._instructions && {instructions:...}` 对 falsy 不带字段，
 * 故 server 正常启动、仅退化无注入；不把错误字符串塞给 client（避免内部信息泄露）。
 */
export function readInstructions(filePath?: string): string | undefined {
  const dir = dirname(fileURLToPath(import.meta.url));
  const resolved = filePath ?? join(dir, '..', 'instructions.md');
  try {
    return readFileSync(resolved, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().warn('godot-mcp', `instructions.md not loaded: ${msg}`);
    return undefined;
  }
}
