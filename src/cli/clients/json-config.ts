import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * 读取 JSON 配置文件,用于 CLI client adapter 的 configure()。
 *
 * F3: 当文件存在但 JSON 解析失败(用户配置损坏)时,**不静默用空对象覆盖**——
 * 先把原始内容备份到 `<path>.corrupt.<uuid>.bak` 并打印警告,再返回 {} 让调用方
 * 以干净状态继续写入。备份失败(磁盘满/权限)则抛错,绝不覆盖未备份的损坏文件。
 *
 * - 文件不存在 → 返回 {}
 * - 合法 JSON  → 返回解析结果(原样,不额外校验是否为对象,保持与原 try/catch 一致)
 */
export function readJsonConfigWithBackup(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const backupPath = `${filePath}.corrupt.${randomUUID()}.bak`;
    writeFileSync(backupPath, raw, 'utf-8'); // 失败则抛错 — 不覆盖未备份的损坏文件
    console.warn(
      `[godot-mcp] ${filePath} contained invalid JSON — backed up to ${backupPath} before overwriting.`,
    );
    return {};
  }
}
