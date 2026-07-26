import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class CherryStudioAdapter implements ClientAdapter {
  name = 'Cherry Studio';
  scope = 'global' as const;

  private static readonly USER_STATE_KEYS = ['isActive', 'installSource'] as const;
  private static readonly USER_STATE_DEFAULTS: Record<string, unknown> = { isActive: true };

  private configPath(): string {
    // CherryStudio 驼峰目录（非 .cherrystudio），GUI 应用仅全局
    return join(globalConfigRoot(), 'CherryStudio', 'mcp_servers.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of CherryStudioAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
      else if (key in CherryStudioAdapter.USER_STATE_DEFAULTS) preserved[key] = CherryStudioAdapter.USER_STATE_DEFAULTS[key];
    }
    mcp.godot = {
      ...preserved,
      type: 'stdio', // Cherry Studio schema enum 强制（缺 type 破坏传输协商）
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.mcp_servers.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
