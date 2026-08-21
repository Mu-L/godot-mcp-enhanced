import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';

/** Qwen Code(project scope,.qwen/settings.json)。user-state 仅保留已存在旧值
 *  (官方默认无 seed);detect 沿原实现用 process.cwd()。 */
export class QwenCodeAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Qwen Code',
      scope: 'project',
      configPath: (projectDir) => join(projectDir, '.qwen', 'settings.json'),
      detectPaths: () => [join(process.cwd(), '.qwen', 'settings.json')],
      preserveUserState: { keys: ['trust', 'includeTools', 'excludeTools', 'timeout', 'description'] },
    });
  }
}
