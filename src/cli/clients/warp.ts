import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ClientAdapter } from './types.js';
import { readJsonConfigWithBackup, readJsonForCheck, writeFileAtomicWithMode, buildEnv } from './json-config.js';

/**
 * Warp 终端适配器(第 14 个,P0-2 2026-08-19)。
 *
 * 配置形态:file-based MCP(`<项目根>/.warp/.mcp.json`,project scope)。
 * 依据 docs/使用指南-Warp.md(官方 MCP 文档 + 源码研究 + 协议层实测):
 * - working_directory 必须显式设 —— Warp spawn MCP server 的 cwd 默认不是 Godot 项目,
 *   godot-mcp 的 resolveProjectPath 会 WARN 且每次调用都要传 project_path(指南 §5 最大坑)。
 *   本 adapter 把 working_directory 写为 projectDir,一处解决。
 * - 项目级配置有审批闸:Warp 不会自动 spawn,需在 Settings > Agents > MCP servers 手动开启
 *   (防恶意仓库自动执行本地命令)。configure 后的提示语会说明这一点。
 * - detect:Warp 配置目录 ~/.warp 存在(Warp 跨平台统一用家目录,Windows 亦然)。
 */
export class WarpAdapter implements ClientAdapter {
  name = 'Warp';
  scope = 'project' as const;

  async detect(): Promise<boolean> {
    return existsSync(join(homedir(), '.warp'));
  }

  async isConfigured(projectDir: string): Promise<boolean> {
    const content = readJsonForCheck(join(projectDir, '.warp', '.mcp.json'));
    if (!content) return false;
    return !!(content.mcpServers as Record<string, unknown> | undefined)?.godot;
  }

  async configure(projectDir: string, godotPath: string, mcpCommand: string, mcpArgs: string[]): Promise<void> {
    const warpDir = join(projectDir, '.warp');
    const configPath = join(warpDir, '.mcp.json');
    if (!existsSync(warpDir)) mkdirSync(warpDir, { recursive: true });
    const config = readJsonConfigWithBackup(configPath);
    if (!config.mcpServers) config.mcpServers = {};
    // C1: 保留旧 entry 的白名单 env(防 reconfigure 静默丢失)
    const oldEntry = (config.mcpServers as Record<string, unknown>).godot as Record<string, unknown> | undefined;
    (config.mcpServers as Record<string, unknown>).godot = {
      command: mcpCommand,
      ...(mcpArgs.length > 0 ? { args: mcpArgs } : {}),
      env: buildEnv(godotPath, oldEntry?.env as Record<string, unknown> | undefined),
      // Warp 特有:显式 working_directory,让 server cwd = Godot 项目根(指南 §5)
      working_directory: projectDir,
    };
    writeFileAtomicWithMode(configPath, JSON.stringify(config, null, 2) + '\n');
  }
}
