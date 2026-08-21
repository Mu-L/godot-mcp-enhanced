import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';

/** Gemini CLI(project scope,.gemini/settings.json)。user-state(trust/timeout/
 *  includeTools/excludeTools)官方默认无 seed,reconfigure 仅保留已存在的旧值
 *  (preserveUserState 不给 defaults 即"仅保留已有")。detect 沿原实现用 process.cwd()。 */
export class GeminiCliAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Gemini CLI',
      scope: 'project',
      configPath: (projectDir) => join(projectDir, '.gemini', 'settings.json'),
      detectPaths: () => [join(process.cwd(), '.gemini', 'settings.json')],
      preserveUserState: { keys: ['trust', 'timeout', 'includeTools', 'excludeTools'] },
    });
  }
}
