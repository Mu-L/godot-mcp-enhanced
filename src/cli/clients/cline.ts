import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';
import { globalConfigRoot } from './paths.js';

/** Cline(global scope;VS Code 扩展,唯一稳定 MCP 配置位置是 globalStorage)。
 *  user-state 白名单(disabled/autoApprove)reconfigure 保留,首建 seed 默认值。 */
export class ClineAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Cline',
      scope: 'global',
      configPath: () => join(globalConfigRoot(), 'Code', 'User', 'globalStorage',
        'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      detectPaths: () => [join(globalConfigRoot(), 'Code', 'User', 'globalStorage',
        'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')],
      preserveUserState: {
        keys: ['disabled', 'autoApprove'],
        defaults: { disabled: false, autoApprove: [] },
      },
    });
  }
}
