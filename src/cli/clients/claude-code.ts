import { join } from 'path';
import { homedir } from 'os';
import { JsonAdapterBase } from './json-adapter.js';

/** Claude Code(project scope,~/.claude 目录探测;entry 写 .claude/settings.json)。
 *  configure 公共行为(F3 备份/C1 env 保留/原子写)见 json-adapter.ts 基座。 */
export class ClaudeCodeAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Claude Code',
      scope: 'project',
      configPath: (projectDir) => join(projectDir, '.claude', 'settings.json'),
      detectPaths: () => [join(homedir(), '.claude')],
    });
  }
}
