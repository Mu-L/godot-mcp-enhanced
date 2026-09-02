// P2-1: Autoload overrides — 启动游戏前注入任意调试脚本(日志钩子/状态快照等)到目标项目。
//
// 设计:参数化 game-bridge.ts:545-621 的 game_bridge_install 改写逻辑(复用同一套
// project.godot [autoload] 段 find/insert + 原子 rename 模式),key 用 MCPOVERRIDE_ 前缀
// 便于卸载时识别。源脚本路径与目标项目路径都必须过 isPathInAllowedRoots(堵 deny-by-default 逃逸口)。
//
// 双入口(见 plan P2-1):
// - MCP 工具 action(主入口):game_bridge 工具加 install_override/uninstall_override,agent 显式调用
// - CLI flag(便捷):--overrides=<path> 指定默认 overrides,在 run_project 时自动注入

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { isPathInAllowedRoots } from './path-utils.js';
import { getLogger } from './logger.js';
import { scanGdscriptSandbox } from '../gdscript-executor.js';

/** overrides 注入的 autoload key 前缀(卸载时按前缀批量清理)。
 *  G-5 (2026-08-14 批D实测发现): autoload 段键名即 Godot 节点名,旧版(≤0.23.x)误带
 *  'autoload/' 前缀 → Godot 截断为同名 "autoload" 节点(与 MCPBridge 键冲突,override 未加载)。
 *  写入键已去前缀;legacy key = LEGACY_KEY_PREFIX + 新 key(识别/迁移/清理旧项目遗留键)。 */
export const OVERRIDE_AUTOLOAD_PREFIX = 'MCPOVERRIDE_';
const LEGACY_KEY_PREFIX = 'autoload/';

export interface OverrideEntry {
  /** 写入 project.godot 的 autoload key(如 MCPOVERRIDE_debug_log) */
  autoloadKey: string;
  /** 拷贝到项目根的脚本文件名(如 mcpoverride_debug_log.gd) */
  destScriptName: string;
  /** 目标项目根目录(绝对路径) */
  projectRoot: string;
  /** 拷贝后的目标脚本绝对路径 */
  destScriptPath: string;
}

/**
 * 校验源脚本路径在白名单内(堵 deny-by-default 逃逸口)。
 * @throws 若源路径不在 ALLOWED_PROJECT_PATHS / cwd / UNRESTRICTED 范围内
 */
function assertSourceAllowed(sourceScriptPath: string): void {
  if (!isPathInAllowedRoots(sourceScriptPath)) {
    throw new Error(
      `Override source script not in allowed roots: ${sourceScriptPath}. ` +
      `Set ALLOWED_PROJECT_PATHS to include the script location, or run with GODOT_MCP_UNRESTRICTED=true.`,
    );
  }
}

/**
 * 校验目标项目根目录在白名单内。
 * @throws 若目标项目不在白名单内
 */
function assertProjectAllowed(projectRoot: string): void {
  if (!isPathInAllowedRoots(projectRoot)) {
    throw new Error(
      `Target project not in allowed roots: ${projectRoot}. ` +
      `Set ALLOWED_PROJECT_PATHS to include the project, or run with GODOT_MCP_UNRESTRICTED=true.`,
    );
  }
}

/**
 * 从脚本路径派生 autoload key 与目标脚本名(基于文件 basename,去扩展名)。
 * 如 /path/to/debug_log.gd → key=MCPOVERRIDE_debug_log, dest=mcpoverride_debug_log.gd
 */
export function deriveOverrideEntry(sourceScriptPath: string, projectRoot: string): OverrideEntry {
  const stem = basename(sourceScriptPath, extname(sourceScriptPath));
  const safeStem = stem.replace(/[^A-Za-z0-9_]/g, '_');
  return {
    autoloadKey: `${OVERRIDE_AUTOLOAD_PREFIX}${safeStem}`,
    destScriptName: `mcpoverride_${safeStem}.gd`,
    projectRoot,
    destScriptPath: join(projectRoot, `mcpoverride_${safeStem}.gd`),
  };
}

/**
 * 安装单个 override 脚本到目标项目的 project.godot [autoload] 段。
 * 复用 game-bridge.ts:545-585 的 project.godot 改写模式(find/insert [autoload] + 原子 rename)。
 *
 * @param sourceScriptPath 源脚本绝对路径(必须在白名单内)
 * @param projectRoot 目标项目根目录(必须含 project.godot 且在白名单内)
 * @returns OverrideEntry(含写入的 key/路径;内容更新路径带 updated:true);
 *          完全幂等(已注册且内容一致)返回 null
 * @throws 路径越权 / project.godot 缺失 / 沙箱扫描失败 / 脚本拷贝失败
 */
export function installOverride(sourceScriptPath: string, projectRoot: string): (OverrideEntry & { updated?: boolean }) | null {
  assertSourceAllowed(sourceScriptPath);
  assertProjectAllowed(projectRoot);

  if (!existsSync(sourceScriptPath)) {
    throw new Error(`Override source script not found: ${sourceScriptPath}`);
  }
  const configPath = join(projectRoot, 'project.godot');
  if (!existsSync(configPath)) {
    throw new Error(`project.godot not found at ${configPath}`);
  }

  const entry = deriveOverrideEntry(sourceScriptPath, projectRoot);

  // 2026-08-06 审查 P1 修复：autoload 脚本 _ready 在游戏启动时执行 = 任意代码执行面，
  // 与 execute_gdscript 同威胁面，须对称走沙箱扫描（gdscript-executor.ts:1013 强制扫描）。
  // 双 opt-in 旁路对齐 execute_gdscript（gdscript-executor.ts:1017-1018）：
  // UNRESTRICTED && (DISABLE_SAFETY || ALLOW_UNSAFE)——单 env 不够，防误设。
  // 扫描置于幂等检查之前：重复 install 走内容更新路径时同样重扫（新内容 = 新威胁面）。
  const bypassSandbox = process.env.GODOT_MCP_UNRESTRICTED === 'true'
    && (process.env.GODOT_MCP_DISABLE_SAFETY === 'true'
      || process.env.GODOT_MCP_ALLOW_UNSAFE === 'true');
  if (!bypassSandbox) {
    const overrideContent = readFileSync(sourceScriptPath, 'utf-8');
    const sandboxWarnings = scanGdscriptSandbox(overrideContent);
    if (sandboxWarnings.length > 0) {
      throw new Error(
        `Override script failed sandbox scan: ${sourceScriptPath}\n` +
        `Dangerous patterns detected:\n${sandboxWarnings.join('\n')}\n` +
        `Set GODOT_MCP_DISABLE_SAFETY=true + GODOT_MCP_UNRESTRICTED=true to override (P0-1 double-opt-in).`,
      );
    }
  }

  // 幂等:新键已注册则跳过 autoload 改写(G-5: 行首精确匹配,防短前缀误命中)。
  // G-5 迁移:仅旧带前缀键存在 → 删旧行(下方插入逻辑写新行,旧项目自愈,
  // 旧键在 Godot 侧截断为 "autoload" 节点与 MCPBridge 键冲突 → override 未加载)。
  let config = readFileSync(configPath, 'utf-8');
  const legacyKey = LEGACY_KEY_PREFIX + entry.autoloadKey;  // autoload/MCPOVERRIDE_<stem>
  const hasNewKey = new RegExp(`^${entry.autoloadKey}\\s*=`, 'm').test(config);
  if (hasNewKey) {
    // 反馈 2026-08-30 (fr2-standalone-game): 幂等跳过曾从不比对内容——修改源脚本后重复
    // install 返回成功但目标文件仍是旧版,「改动不生效」极易误判为脚本本身问题(排障>5min)。
    // 修:内容一致才跳过;漂移则重拷贝(autoload 已注册不动),返回带 updated 标记。
    const srcContent = readFileSync(sourceScriptPath, 'utf-8');
    const destContent = existsSync(entry.destScriptPath)
      ? readFileSync(entry.destScriptPath, 'utf-8')
      : null;
    if (destContent === srcContent) {
      getLogger().info('overrides', `Override already registered, skipping: ${entry.autoloadKey}`);
      return null;
    }
    copyFileSync(sourceScriptPath, entry.destScriptPath);
    getLogger().info('overrides', `Override already registered, dest script updated (content drift): ${entry.autoloadKey}`);
    return { ...entry, updated: true };
  }
  const hasLegacyKey = new RegExp(`^${legacyKey}\\s*=`, 'm').test(config);
  if (hasLegacyKey) {
    config = config.split('\n').filter(line => !line.startsWith(legacyKey + '=')).join('\n');
    getLogger().info('overrides', `Migrating legacy prefixed override key to unprefixed: ${entry.autoloadKey}`);
  }

  // 拷贝脚本到项目根(参考 game-bridge.ts:556 copyFileSync)
  copyFileSync(sourceScriptPath, entry.destScriptPath);

  // project.godot 改写:find/insert [autoload] 段(参考 game-bridge.ts:568-574)
  const autoloadEntry = `${entry.autoloadKey}="*res://${entry.destScriptName}"`;
  const autoloadRegex = /^\[autoload\]/m;
  if (autoloadRegex.test(config)) {
    // 反馈坑3(2026-08-21): 插到 [autoload] 段【末尾】而非段头——autoload 声明顺序即 _ready
    // 执行顺序,override 排在游戏 autoload 之后,注入脚本的 _ready 可直接访问游戏单例
    // (如 GameData.player)。段头插入曾致 _ready 时游戏 autoload 尚未初始化(null),
    // 须手动 await <Singleton>.ready 兜底(文档未说明插入位置语义,踩坑 >5min)。
    const header = config.match(autoloadRegex);
    const headerEnd = (header?.index ?? 0) + header![0].length;
    const rest = config.slice(headerEnd);
    const nextSectionRel = rest.search(/^\[[^\]\r\n]+\]/m);
    if (nextSectionRel === -1) {
      // 段末即文件末(可能无尾换行)
      const nl = config === '' || config.endsWith('\n') ? '' : '\n';
      config += `${nl}${autoloadEntry}\n`;
    } else {
      // 插在下一个 [section] 头之前(该行首前的换行已存在,自帧行尾换行)
      const insertAt = headerEnd + nextSectionRel;
      config = config.slice(0, insertAt) + `${autoloadEntry}\n` + config.slice(insertAt);
    }
  } else {
    config += `\n[autoload]\n${autoloadEntry}\n`;
  }

  // 原子写:tmp + rename(参考 game-bridge.ts:577-579)
  const tmpPath = configPath + '.mcp-tmp';
  writeFileSync(tmpPath, config, 'utf-8');
  renameSync(tmpPath, configPath);

  getLogger().info('overrides', `Override installed: ${entry.autoloadKey} → ${entry.destScriptName}`);
  return entry;
}

/**
 * 卸载单个 override(按 sourceScriptPath 派生的 key)。
 * 参 game-bridge.ts:588-621 的 uninstall 模式(filter 行 + 原子写 + 删脚本)。
 *
 * @returns true 若找到并卸载;false 若未注册
 */
export function uninstallOverride(sourceScriptPath: string, projectRoot: string): boolean {
  assertProjectAllowed(projectRoot);

  const configPath = join(projectRoot, 'project.godot');
  if (!existsSync(configPath)) {
    return false;
  }

  const entry = deriveOverrideEntry(sourceScriptPath, projectRoot);
  const legacyKey = LEGACY_KEY_PREFIX + entry.autoloadKey;  // G-5: 旧带前缀键 autoload/MCPOVERRIDE_<stem>
  const config = readFileSync(configPath, 'utf-8');
  const hasNewKey = new RegExp(`^${entry.autoloadKey}\\s*=`, 'm').test(config);
  const hasLegacyKey = new RegExp(`^${legacyKey}\\s*=`, 'm').test(config);
  if (!hasNewKey && !hasLegacyKey) {
    return false;
  }

  // 移除 autoload 行(G-5: 新键行 + 旧带前缀键行都清)
  const lines = config.split('\n').filter(line =>
    !line.startsWith(entry.autoloadKey + '=') && !line.startsWith(legacyKey + '='));
  const tmpPath = configPath + '.mcp-tmp';
  writeFileSync(tmpPath, lines.join('\n'), 'utf-8');
  renameSync(tmpPath, configPath);

  // 删拷贝的脚本(参考 game-bridge.ts:606-609)
  if (existsSync(entry.destScriptPath)) {
    try { unlinkSyncQuiet(entry.destScriptPath); } catch { /* best effort */ }
  }

  getLogger().info('overrides', `Override uninstalled: ${entry.autoloadKey}`);
  return true;
}

/**
 * 批量卸载:移除项目里所有 MCPOVERRIDE_* autoload 条目与对应脚本。
 * 用于 server 退出时的自动清理(SIGINT/SIGTERM graceful shutdown)。
 *
 * @returns 清理的条目数
 */
export function uninstallAllOverrides(projectRoot: string): number {
  assertProjectAllowed(projectRoot);

  const configPath = join(projectRoot, 'project.godot');
  if (!existsSync(configPath)) {
    return 0;
  }

  const config = readFileSync(configPath, 'utf-8');
  const lines = config.split('\n');
  const removed: string[] = [];
  const kept = lines.filter(line => {
    // G-5: 新前缀 + 旧带前缀行都清(批量卸载兼容旧项目遗留键;autoload/MCPOVERRIDE_ 精确组合,
    // 不能裸 startsWith('autoload/') — 那会误删 MCPBridge 等其它键)
    if (line.startsWith(OVERRIDE_AUTOLOAD_PREFIX) || line.startsWith(LEGACY_KEY_PREFIX + OVERRIDE_AUTOLOAD_PREFIX)) {
      removed.push(line);
      return false;
    }
    return true;
  });

  if (removed.length === 0) {
    return 0;
  }

  const tmpPath = configPath + '.mcp-tmp';
  writeFileSync(tmpPath, kept.join('\n'), 'utf-8');
  renameSync(tmpPath, configPath);

  // 删对应脚本(从 autoload 行解析脚本名)
  for (const line of removed) {
    const m = line.match(/res:\/\/([^"]+)\.gd/);
    if (m) {
      const scriptPath = join(projectRoot, m[1]! + '.gd');
      if (existsSync(scriptPath)) {
        try { unlinkSyncQuiet(scriptPath); } catch { /* best effort */ }
      }
    }
  }

  getLogger().info('overrides', `All overrides uninstalled: ${removed.length} entries from ${projectRoot}`);
  return removed.length;
}

// unlinkSync 的 quiet 包装(best effort,删失败不抛)
function unlinkSyncQuiet(p: string): void {
  unlinkSync(p);
}

/**
 * 批量安装多个 override(用于 CLI flag --overrides=path1;path2 场景)。
 * 源路径列表中任一越权即整体抛错(atomic: 全装或全不装)。
 *
 * @param sourcePaths 源脚本绝对路径数组
 * @param projectRoot 目标项目根
 * @returns 安装的 OverrideEntry 数组(已注册的跳过,不在结果里)
 */
export function installOverrides(sourcePaths: string[], projectRoot: string): OverrideEntry[] {
  // 预校验全部源路径(atomic: 任一失败则整体不装,避免半装状态)
  for (const p of sourcePaths) {
    assertSourceAllowed(p);
    if (!existsSync(p)) {
      throw new Error(`Override source script not found: ${p}`);
    }
  }
  assertProjectAllowed(projectRoot);

  const installed: OverrideEntry[] = [];
  for (const p of sourcePaths) {
    const entry = installOverride(p, projectRoot);
    if (entry) installed.push(entry);
  }
  return installed;
}
