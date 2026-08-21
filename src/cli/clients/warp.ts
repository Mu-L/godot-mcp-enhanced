import { join } from 'path';
import { homedir } from 'os';
import { JsonAdapterBase } from './json-adapter.js';

/**
 * Warp 终端(project scope,<项目根>/.warp/.mcp.json,第 14 个,P0-2 2026-08-19)。
 *
 * working_directory 必须显式设 —— Warp spawn MCP server 的 cwd 默认不是 Godot 项目,
 * godot-mcp 的 resolveProjectPath 会 WARN 且每次调用都要传 project_path(指南 §5 最大坑)。
 * entryExtras 把 working_directory 写为 projectDir,一处解决。
 * 项目级配置有审批闸:Warp 不会自动 spawn,需在 Settings > Agents > MCP servers 手动开启
 * (防恶意仓库自动执行本地命令)。
 * detect:~/.warp 存在(Warp 跨平台统一用家目录,Windows 亦然)。
 */
export class WarpAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Warp',
      scope: 'project',
      configPath: (projectDir) => join(projectDir, '.warp', '.mcp.json'),
      detectPaths: () => [join(homedir(), '.warp')],
      entryExtras: (projectDir) => ({ working_directory: projectDir }),
    });
  }
}
