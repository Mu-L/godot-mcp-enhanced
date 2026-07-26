import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class ClaudeDesktopAdapter implements ClientAdapter {
  name = 'Claude Desktop';
  scope = 'global' as const;

  private configPath(): string {
    return join(globalConfigRoot(), 'Claude', 'claude_desktop_config.json');
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
    const tmpPath = join(configDir, `.claude_desktop_config.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
