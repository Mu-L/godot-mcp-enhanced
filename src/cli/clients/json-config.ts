import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

/** 去除 UTF-8 BOM（Windows 工具有时写入 BOM，会破坏 JSON.parse）。 */
export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * 读取 JSON 配置文件,用于 CLI client adapter 的 configure()。
 *
 * F3: 当文件存在但 JSON 解析失败(用户配置损坏)时,**不静默用空对象覆盖**——
 * 先把原始内容备份到 `<path>.corrupt.<uuid>.bak` 并打印警告,再返回 {} 让调用方
 * 以干净状态继续写入。备份失败(磁盘满/权限)则抛错,绝不覆盖未备份的损坏文件。
 *
 * - 文件不存在 → 返回 {}
 * - 合法 JSON（含 BOM，经 stripBom）→ 返回解析结果
 * - 损坏 JSON → 备份 raw 后返回 {}
 */
export function readJsonConfigWithBackup(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(stripBom(raw)) as Record<string, unknown>;
  } catch {
    const backupPath = `${filePath}.corrupt.${randomUUID()}.bak`;
    writeFileSync(backupPath, raw, 'utf-8'); // 失败则抛错 — 不覆盖未备份的损坏文件
    console.warn(
      `[godot-mcp] ${filePath} contained invalid JSON — backed up to ${backupPath} before overwriting.`,
    );
    return {};
  }
}

/**
 * 读取 JSON 配置文件,用于 isConfigured() 只读检查。
 *
 * - 文件不存在 → 返回 null（调用方返 false）
 * - 合法 JSON（含 BOM，经 stripBom）→ 返回解析结果
 * - 损坏 JSON（BOM strip 后仍损坏）→ 返回 null（调用方返 false，不抛错、不备份）
 *
 * 与 readJsonConfigWithBackup 区别：只读不备份、不抛错、not_found 返 null。
 * 设计原因：isConfigured 现状是 try{...}catch{return false} 吞错；带 BOM 的合法配置
 * 若内联 JSON.parse 会 throw→catch→false→doctor 误报 + setup 破坏幂等。统一改用本函数。
 */
export function readJsonForCheck(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(filePath, 'utf-8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}
