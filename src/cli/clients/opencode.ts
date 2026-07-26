import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck } from './json-config.js';

const execFileAsync = promisify(execFile);

export class OpenCodeAdapter implements ClientAdapter {
  name = 'OpenCode';
  scope = 'project' as const;

  async detect(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('opencode', ['--version'], { timeout: 5000 });
      return stdout.length > 0;
    } catch { return false; }
  }

  // IMPORTANT-6: opencode `mcp add` 是交互式 prompts(不接受 --command/--args/--env flag,
  // 见 sst/opencode packages/opencode/src/cli/cmd/mcp.ts 的 McpAddCommand —— 全程 prompts.text/select)。
  // 非交互式 execFile 调用会挂起超时。改为直接读/写 opencode.json 配置(与 cursor/claude-code 一致)。
  async isConfigured(projectDir: string): Promise<boolean> {
    const configPath = join(projectDir, 'opencode.json');
    const content = readJsonForCheck(configPath);
    if (!content) return false;
    return !!(content.mcp as Record<string, unknown> | undefined)?.godot;
  }

  private static readonly USER_STATE_KEYS = ['enabled'] as const;

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const configPath = join(projectDir, 'opencode.json');
    // F3: 损坏 JSON 时备份原文件 + warn,不静默覆盖用户配置
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcp) config.mcp = {};
    const mcp = config.mcp as Record<string, Record<string, unknown>>;
    // user-state 保留:读旧 entry 的白名单字段 merge 进新 entry(首次创建 seed 默认)
    const oldEntry = mcp.godot ?? {};
    const preserved: Record<string, unknown> = {};
    for (const key of OpenCodeAdapter.USER_STATE_KEYS) {
      if (key in oldEntry) preserved[key] = oldEntry[key];
    }
    // opencode local MCP 配置:command 数组 + environment 对象(见 mcp.ts local 分支)
    mcp.godot = {
      ...preserved,
      type: 'local',
      command: [mcpCommand, ...mcpArgs],
      environment: { GODOT_PATH: godotPath },
    };
    // 原子写入:先写临时文件再 rename,防止并发竞态
    const tmpPath = join(projectDir, `.opencode.${randomUUID()}.tmp`);
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
  }
}
