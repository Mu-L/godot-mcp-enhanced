import { join } from 'path';
import { homedir } from 'os';
import { JsonAdapterBase } from './json-adapter.js';

/** Cursor(project scope,~/.cursor 目录探测;entry 写 .cursor/mcp.json)。 */
export class CursorAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Cursor',
      scope: 'project',
      configPath: (projectDir) => join(projectDir, '.cursor', 'mcp.json'),
      detectPaths: () => [join(homedir(), '.cursor')],
    });
  }
}
