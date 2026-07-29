import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck, writeFileAtomicWithMode } from './json-config.js';

export class ClaudeCodeAdapter implements ClientAdapter {
  name = 'Claude Code';
  scope = 'project' as const;

  async detect(): Promise<boolean> {
    return existsSync(join(homedir(), '.claude'));
  }

  async isConfigured(projectDir: string): Promise<boolean> {
    const settingsPath = join(projectDir, '.claude', 'settings.json');
    const content = readJsonForCheck(settingsPath);
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const claudeDir = join(projectDir, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
    // F3: 损坏 JSON 时备份原文件 + warn,不静默覆盖用户配置
    const settings = readJsonConfigWithBackup(settingsPath);
    if (!settings.mcpServers) settings.mcpServers = {};
    (settings.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: { GODOT_PATH: godotPath },
    };
    // F3: 原子写入 + 保持原文件 mode（adapter-no-mode-preserve）
    writeFileAtomicWithMode(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
}
