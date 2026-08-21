import { join } from 'path';
import { homedir } from 'os';
import { JsonAdapterBase } from './json-adapter.js';

/** Windsurf(global scope)。官方仅文档化全局路径 ~/.codeium/windsurf/mcp_config.json
 *  (Win 用 %USERPROFILE%),故 homedir 直拼而非 globalConfigRoot。 */
export class WindsurfAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Windsurf',
      scope: 'global',
      configPath: () => join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
      detectPaths: () => [join(homedir(), '.codeium', 'windsurf', 'mcp_config.json')],
    });
  }
}
