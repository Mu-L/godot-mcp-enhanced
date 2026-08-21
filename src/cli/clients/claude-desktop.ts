import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';
import { globalConfigRoot } from './paths.js';

/** Claude Desktop(global scope,%APPDATA%/Claude/claude_desktop_config.json)。 */
export class ClaudeDesktopAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Claude Desktop',
      scope: 'global',
      configPath: () => join(globalConfigRoot(), 'Claude', 'claude_desktop_config.json'),
      detectPaths: () => [join(globalConfigRoot(), 'Claude', 'claude_desktop_config.json')],
    });
  }
}
