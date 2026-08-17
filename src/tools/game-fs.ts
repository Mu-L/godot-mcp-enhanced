// src/tools/game-fs.ts — 游戏侧 user:// URI ↔ 本机绝对路径解析
//
// 2026-08-17 从 qa/runner.ts 上移:runtime-assert 的 screenshot_diff 真实现需要同一
// 函数,而依赖方向是 qa/runner → runtime-assert(复用 4 断言),反向引用会成环,
// 故下沉到本文件(runtime-assert 与 qa/runner 都在其下游)。

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 把游戏侧 user:// URI 解析为本地绝对路径(Godot app_userdata 布局,三平台)。
 * 读 project.godot 的 config/name(use_custom_user_dir 时用 custom_user_dir_name)。
 * 解析不出/文件不存在返回 null(调用方诚实降级,只记录游戏侧路径)。
 */
export function resolveGameDataPath(projectPath: string, userUri: string): string | null {
  if (!userUri.startsWith('user://')) return null;
  const rel = userUri.slice('user://'.length);
  let projectName: string;
  let customDir: string;
  try {
    const cfg = readFileSync(join(projectPath, 'project.godot'), 'utf-8');
    const nameM = cfg.match(/^config\/name\s*=\s*"([^"]*)"/m);
    projectName = nameM?.[1] ?? '';
    const customM = cfg.match(/^config\/custom_user_dir_name\s*=\s*"([^"]*)"/m);
    customDir = customM?.[1] ?? '';
    if (/^config\/use_custom_user_dir\s*=\s*true/m.test(cfg)) {
      // use_custom_user_dir: 目录 = <appdata>/<custom_user_dir_name>(Godot 用项目名兜底)
      customDir = customDir || projectName;
      projectName = '';
    }
  } catch {
    return null;
  }
  const home = homedir();
  let base: string;
  if (process.platform === 'win32') {
    base = join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Godot');
  } else if (process.platform === 'darwin') {
    base = join(home, 'Library', 'Application Support', 'Godot');
  } else {
    base = join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'godot');
  }
  const dir = customDir ? join(base, customDir) : projectName ? join(base, 'app_userdata', projectName) : null;
  if (!dir) return null;
  const abs = join(dir, rel);
  return existsSync(abs) ? abs : null;
}
