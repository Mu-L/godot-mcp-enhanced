import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck, writeFileAtomicWithMode, buildEnv } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class ZedAdapter implements ClientAdapter {
  name = 'Zed';
  scope = 'global' as const;

  private configPath(): string {
    return join(globalConfigRoot(), 'Zed', 'settings.json');
  }

  async detect(): Promise<boolean> {
    return existsSync(this.configPath());
  }

  async isConfigured(_projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(this.configPath());
    if (!content) return false;
    // Zed 用 context_servers（非 mcpServers）
    return !!(content.context_servers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(_projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = this.configPath();
    const configDir = join(configPath, '..');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.context_servers) config.context_servers = {};
    // C1: 保留旧 entry 的白名单 env（Zed 用 context_servers 键,非 mcpServers）
    const oldEntry = (config.context_servers as Record<string, unknown>).godot as Record<string, unknown> | undefined;
    (config.context_servers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: buildEnv(godotPath, oldEntry?.env as Record<string, unknown> | undefined),
    };
    // F3: 原子写入 + 保持原文件 mode（adapter-no-mode-preserve）
    writeFileAtomicWithMode(configPath, JSON.stringify(config, null, 2) + '\n');
  }
}
