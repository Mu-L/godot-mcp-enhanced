// src/core/addon-version.ts
// 复刻 scripts/version-sync.mjs:57（读版本正则）+ scripts/install-plugin.js:17-65（cp+verify）。
// 改进：MCP 场景加 deny-by-default 白名单门（CLI 是用户主动信任，MCP 是 AI 调用）。
import { readFileSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateProjectRoot, isPathInAllowedRoots, safeRealPath } from './path-utils.js';

const ADDON_REL = ['addons', 'godot_mcp_server'] as const;
// build/core/addon-version.js → 上两级包根 → addons/godot_mcp_server
// tsconfig outDir=build/rootDir=src；开发时同理指仓库根/addons
const addonSource = join(dirname(fileURLToPath(import.meta.url)), '..', '..', ...ADDON_REL);

/** 读目标项目 addon 版本。正则复刻 version-sync.mjs:57。 */
export function readAddonVersion(projectPath: string): { version: string | null; installed: boolean } {
  if (!isPathInAllowedRoots(projectPath)) {
    throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS（deny-by-default）');
  }
  const cfg = join(projectPath, ...ADDON_REL, 'plugin.cfg');
  // S1: 校验 cfg 真实路径在 allowlist 内——堵 addons/ 子段符号链接越界读（信息泄漏）。
  const realCfg = safeRealPath(cfg);
  if (!isPathInAllowedRoots(realCfg)) {
    throw new Error(`readAddonVersion path escapes allowed roots: ${realCfg}`);
  }
  if (!existsSync(realCfg)) return { version: null, installed: false };
  const m = readFileSync(realCfg, 'utf-8').match(/^version="([^"\r]*)"/m);
  return { version: m?.[1] ?? null, installed: true };
}

/** 包内 addon 源 cp 到目标项目。复刻 install-plugin.js:17-65 + 加门。 */
export function updateAddon(projectPath: string): { dest: string; verifyOk: boolean } {
  if (!isPathInAllowedRoots(projectPath)) {
    throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS（deny-by-default）');
  }
  const real = safeRealPath(validateProjectRoot(projectPath));  // project.godot 检查 + symlink 归一
  const dest = join(real, ...ADDON_REL);
  // S1: 校验 dest 真实路径在 allowlist 内——堵 addons/ 子段符号链接越界写。
  // safeRealPath 对不存在路径 walk-up 找存在祖先再 realpath（首装 dest 不存在安全）。
  const realDest = safeRealPath(dest);
  if (!isPathInAllowedRoots(realDest)) {
    throw new Error(`updateAddon dest escapes allowed roots (symlink?): ${realDest}`);
  }
  // cpSync 目标始终用 dest（逻辑路径），避免写到 symlink 解析目标反而固化越界。
  cpSync(addonSource, dest, { recursive: true });
  const content = readFileSync(join(dest, 'plugin.cfg'), 'utf-8');
  const verifyOk = content.includes('[plugin]') && content.includes('script="plugin.gd"');
  return { dest, verifyOk: verifyOk && isPathInAllowedRoots(safeRealPath(join(dest, 'plugin.cfg'))) };
}
