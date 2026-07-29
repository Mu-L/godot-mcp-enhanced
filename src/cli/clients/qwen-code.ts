import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck, writeFileAtomicWithMode, buildEnv } from './json-config.js';

export class QwenCodeAdapter implements ClientAdapter {
  name = 'Qwen Code';
  scope = 'project' as const;

  // user-state 字段（官方默认无 seed，reconfigure 仅保留已存在的旧值）
  private static readonly USER_STATE_KEYS = ['trust', 'includeTools', 'excludeTools', 'timeout', 'description'] as const;

  async detect(): Promise<boolean> {
    return existsSync(join(process.cwd(), '.qwen', 'settings.json'));
  }

  async isConfigured(projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(join(projectDir, '.qwen', 'settings.json'));
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const qwenDir = join(projectDir, '.qwen');
    const configPath = join(qwenDir, 'settings.json');
    if (!existsSync(qwenDir)) mkdirSync(qwenDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    const mcp = config.mcpServers as Record<string, Record<string, unknown>>;
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of QwenCodeAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
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
