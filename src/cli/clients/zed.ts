import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';
import { globalConfigRoot } from './paths.js';

/** Zed(global scope,settings.json)。Zed 的 MCP 根键是 context_servers(非 mcpServers)。 */
export class ZedAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Zed',
      scope: 'global',
      configPath: () => join(globalConfigRoot(), 'Zed', 'settings.json'),
      detectPaths: () => [join(globalConfigRoot(), 'Zed', 'settings.json')],
      rootKeys: ['context_servers'],
    });
  }
}
