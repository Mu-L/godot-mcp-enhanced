import { join } from 'path';
import { JsonAdapterBase } from './json-adapter.js';
import { globalConfigRoot } from './paths.js';

/** Trae(global scope;Trae 是 VS Code fork,全局路径 {APPDATA}/Trae/User/mcp.json)。
 *  注:Trae stdio entry 的 type 字段未确认(docs.trae.ai JS 渲染抓不到正文),保守不加 type;
 *  若实机验证 Trae 要求 type,在 spec 加 entryExtras: () => ({ type: 'stdio' })。 */
export class TraeAdapter extends JsonAdapterBase {
  constructor() {
    super({
      name: 'Trae',
      scope: 'global',
      configPath: () => join(globalConfigRoot(), 'Trae', 'User', 'mcp.json'),
      detectPaths: () => [join(globalConfigRoot(), 'Trae', 'User', 'mcp.json')],
    });
  }
}
