import { join } from 'path';
import { homedir } from 'os';
import { JsonAdapterBase } from './json-adapter.js';

/**
 * ZCodeAdapter — 智谱 ZCode (GLM ADE) 客户端配置 adapter。
 *
 * 三点关键差异(实测 ~/.zcode/cli/config.json 确认):
 *  1. 路径用 homedir()/.zcode/cli/config.json(非 globalConfigRoot 的 %APPDATA%)
 *  2. 嵌套键 mcp.servers.godot(非顶层 mcpServers;rootKeys 数组表达)
 *  3. readJsonConfigWithBackup 读全量后只改 mcp.servers.godot,原子写回时
 *     plugins/hooks/其他 servers 天然保留
 * ZCode 用 mcp.servers.<name>.enable=false 禁用 server(实测 figma 条目),
 * 属用户可变状态,reconfigure 保留(enable 无默认,仅保留已有)。
 */
export class ZCodeAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'ZCode',
      scope: 'global',
      configPath: () => join(homedir(), '.zcode', 'cli', 'config.json'),
      // ZCode 已安装 → ~/.zcode 目录存在(config.json 可能尚未生成,故探测目录非文件)
      detectPaths: () => [join(homedir(), '.zcode')],
      rootKeys: ['mcp', 'servers'],
      entryExtras: () => ({ type: 'stdio' }),
      preserveUserState: { keys: ['enable'] },
    });
  }
}
