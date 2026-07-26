import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

export class WindsurfAdapter implements ClientAdapter {
  name = 'Windsurf';
  scope = 'global' as const;

  private configPath(): string {
    // 官方仅文档化全局路径 ~/.codeium/windsurf/mcp_config.json（Win 用 %USERPROFILE%）
    return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
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
    (config.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    const tmpPath = join(configDir, `.mcp_config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
