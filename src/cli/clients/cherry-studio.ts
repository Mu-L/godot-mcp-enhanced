import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';
import { globalConfigRoot } from './paths.js';

/** Cherry Studio(global scope;CherryStudio 驼峰目录,GUI 应用仅全局)。
 *  type:'stdio' 是 schema enum 强制(缺 type 破坏传输协商);isActive 首建 seed。 */
export class CherryStudioAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Cherry Studio',
      scope: 'global',
      configPath: () => join(globalConfigRoot(), 'CherryStudio', 'mcp_servers.json'),
      detectPaths: () => [join(globalConfigRoot(), 'CherryStudio', 'mcp_servers.json')],
      entryExtras: () => ({ type: 'stdio' }),
      preserveUserState: {
        keys: ['isActive', 'installSource'],
        defaults: { isActive: true },
      },
    });
  }
}
