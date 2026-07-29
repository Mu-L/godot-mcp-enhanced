import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck, writeFileAtomicWithMode, buildEnv } from './json-config.js';
import { globalConfigRoot } from './paths.js';

export class ClineAdapter implements ClientAdapter {
  name = 'Cline';
  scope = 'global' as const;

  // user-state 白名单（reconfigure 保留，首次创建 seed 默认）
  private static readonly USER_STATE_KEYS = ['disabled', 'autoApprove'] as const;
  private static readonly USER_STATE_DEFAULTS: Record<typeof ClineAdapter.USER_STATE_KEYS[number], unknown> = { disabled: false, autoApprove: [] };

  private configPath(): string {
    // VS Code globalStorage 路径（Cline 是 VS Code 扩展，唯一稳定 MCP 配置位置）
    return join(globalConfigRoot(), 'Code', 'User', 'globalStorage',
      'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
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
    for (const key of ClineAdapter.USER_STATE_KEYS) {
      preserved[key] = key in oldEntry ? oldEntry[key] : ClineAdapter.USER_STATE_DEFAULTS[key];
    }
    mcp.godot = {
      ...preserved,
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      // C1: 保留旧 entry.env 的白名单前缀
      env: buildEnv(godotPath, oldEntry.env as Record<string, unknown> | undefined),
    };
    // F3: 原子写入 + 保持原文件 mode（adapter-no-mode-preserve）
    writeFileAtomicWithMode(configPath, JSON.stringify(config, null, 2) + '\n');
  }
}
