import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck, writeFileAtomicWithMode, buildEnv } from './json-config.js';

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
    // C1: 保留旧 entry 的白名单 env(防 reconfigure 静默丢失 ALLOWED_PROJECT_PATHS / GODOT_MCP_BRIDGE_*)
    const oldEntry = (settings.mcpServers as Record<string, unknown>).godot as Record<string, unknown> | undefined;
    (settings.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: buildEnv(godotPath, oldEntry?.env as Record<string, unknown> | undefined),
    };
    // F3: 原子写入 + 保持原文件 mode（adapter-no-mode-preserve）
    writeFileAtomicWithMode(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
}
