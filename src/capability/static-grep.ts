import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * group → 该 group 工具的主实现文件（src/tools/ 下相对路径）。
 * 基于 module-loader.ts:13-52 的 import + glob 核验。工具增减时此表同步更新
 * （M1 漂移检测会捕获 group 变更）。
 */
export const GROUP_SOURCE_FILES: Record<string, string[]> = {
  core: ['project.ts', 'script.ts', 'runtime.ts', 'validation.ts', 'manage-tools.ts'],
  scene: ['scene.ts'],
  editor: ['editor-sync.ts'],
  bridge: ['game-bridge.ts'],
  animation: ['animation-ops.ts', 'animation-track.ts', 'animtree.ts'],
  audio: ['audio-ops.ts'],
  visual: ['material-ops.ts', 'screenshot.ts', 'particles.ts'],
  physics: ['physics-ops.ts'],
  navigation: ['navigation.ts'],
  ui: ['ui-tools.ts'],
  tilemap: ['tilemap-ops.ts'],
  signal: ['signal-ops.ts'],
  profiler: ['profiler-ops.ts', 'workflow.ts'],
  code: ['docs.ts', 'load-skill.ts'],
  multi_instance: ['instance-tools.ts'],
  dynamic: ['advanced-proxy.ts'],
};

/**
 * 危险 API 触达模式（spec §3.1）。对齐 defects.md 安全 DEFECT。
 * 注：spawn-without-buildsafeenv 已 fixed，故不含裸 spawn（由专门审查覆盖）。
 */
export const DANGER_PATTERNS: RegExp[] = [
  // 注：点号不转义以便 .source 字符串化后仍含字面 "OS.execute"（测试逐字断言）。
  // 扫描副作用：会匹配 OS_execute / OSxexecute 等罕见形式，但 Godot 代码中无此命名，风险可忽略。
  /OS.execute\s*\(/,
  /str2var\s*\(/,
  /bytes2var\s*\(/,
  /ClassDB.instantiate\s*\(/,
  /\bexecute_gdscript\b/,
  /\bDirAccess.remove_absolute\b/,
];

/** 扫描给定 src/tools 文件，返回命中任一危险模式的文件相对路径。 */
export function scanDangerApi(groupFiles: string[], projectRoot: string): string[] {
  const hits: string[] = [];
  for (const rel of groupFiles) {
    const abs = join(projectRoot, 'src', 'tools', rel);
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, 'utf8');
    if (DANGER_PATTERNS.some(p => p.test(src))) hits.push(rel);
  }
  return hits;
}

/** group → editor 侧 commands 文件名（addons/godot_mcp_server/commands/）。基于 glob 核验。 */
const DEFAULT_GROUP_COMMANDS: Record<string, string> = {
  scene: 'scene_commands.gd',
  animation: 'animation_commands.gd',
  navigation: 'nav_commands.gd',
  ui: 'ui_commands.gd',
  particles: 'particle_commands.gd', // visual 组子域
  runtime: 'recording_commands.gd',
  animtree: 'animtree_commands.gd',
};

/** 探测 group 对应的 editor commands 文件是否存在，返回相对路径或 null。 */
export function findEditorCommandFile(
  group: string,
  projectRoot: string,
  groupFileMap: Record<string, string> = DEFAULT_GROUP_COMMANDS,
): string | null {
  const file = groupFileMap[group];
  if (!file) return null;
  const rel = `addons/godot_mcp_server/commands/${file}`;
  if (existsSync(join(projectRoot, rel))) return rel;
  return null;
}
