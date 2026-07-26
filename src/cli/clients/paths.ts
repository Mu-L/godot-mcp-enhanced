import { join } from 'path';
import { homedir } from 'os';

/**
 * 全局配置根目录（跨平台）。
 *
 * - Win: %APPDATA% (优先) → %LOCALAPPDATA% → ~/AppData/Roaming
 * - mac: ~/Library/Application Support
 * - Linux/其他: $XDG_CONFIG_HOME (优先) → ~/.config
 *
 * os.homedir() Win 返 %USERPROFILE%（C:\Users\xxx），非 %APPDATA%；Claude Desktop /
 * Cline / Zed / Trae / Cherry Studio 的全局配置在 %APPDATA% 下，故须 env 优先定位
 * Roaming，而非直接用 homedir()。参考 spec §3.3。
 */
export function globalConfigRoot(): string {
  switch (process.platform) {
    case 'win32':
      return process.env.APPDATA
        ?? process.env.LOCALAPPDATA
        ?? join(homedir(), 'AppData', 'Roaming');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support');
    default:
      return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  }
}
