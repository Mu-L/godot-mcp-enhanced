import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

/**
 * ZCodeAdapter — 智谱 ZCode (GLM ADE) 客户端配置 adapter。
 *
 * 与 CherryStudio 同属「global scope + schema 强制 type:stdio + user-state 白名单」一类，
 * 但三点关键差异（实测 ~/.zcode/cli/config.json 确认）：
 *  1. 路径用 homedir()/.zcode/cli/config.json（非 globalConfigRoot 的 %APPDATA%）
 *  2. 嵌套键 mcp.servers.godot（非顶层 mcpServers）
 *  3. 顶层与 plugins/hooks 共存 → readJsonConfigWithBackup 读全量后只改 mcp.servers.godot，
 *     原子写回时 plugins/hooks/其他 servers 天然保留
 */
export class ZCodeAdapter implements ClientAdapter {
  name = 'ZCode';
  scope = 'global' as const;

  // ZCode 用 mcp.servers.<name>.enable=false 禁用 server（实测 figma 条目），
  // 属用户可变状态，reconfigure 保留；type/command/args/env 由 configure 覆写。
  private static readonly USER_STATE_KEYS = ['enable'] as const;

  private configPath(): string {
    return join(homedir(), '.zcode', 'cli', 'config.json');
  }

  async detect(): Promise<boolean> {
    // ZCode 已安装 → ~/.zcode 目录存在（config.json 可能尚未生成，故探测目录非文件）
    return existsSync(join(homedir(), '.zcode'));
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    const mcp = content.mcp as Record<string, Record<string, unknown>> | undefined;
    return !!mcp?.servers?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcp) config.mcp = {};
    const mcp = config.mcp as Record<string, unknown>;
    if (!mcp.servers) mcp.servers = {};
    const servers = mcp.servers as Record<string, Record<string, unknown>>;
    const oldEntry = servers.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of ZCodeAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
    }
    servers.godot = {
      ...preserved,
      type: 'stdio', // ZCode schema：每条 server 必填 type(stdio|http)，缺则传输协商失败
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
