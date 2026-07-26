import { existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class TraeAdapter implements ClientAdapter {
  name = 'Trae';
  scope = 'global' as const;

  private configPath(): string {
    // Trae 是 VS Code fork，全局路径 {APPDATA}/Trae/User/mcp.json
    return join(globalConfigRoot(), 'Trae', 'User', 'mcp.json');
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
    // 注：Trae stdio entry 的 type 字段未确认（docs.trae.ai JS 渲染抓不到正文）。
    // 保守不加 type；若实机验证 Trae 要求 type，改加 type:"stdio"（见 spec §3.2 中等不确定项）。
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
    const tmpPath = join(configDir, `.mcp.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
