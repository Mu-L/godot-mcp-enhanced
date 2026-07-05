import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { GROUP_SOURCE_FILES, DANGER_PATTERNS, scanDangerApi, EDITOR_COMMAND_ROUTING, findEditorCommandForTool } from '../../src/capability/static-grep.js';

const ROOT = join(tmpdir(), `mcp-m1-staticgrep-${Date.now()}`);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('static-grep', () => {
  it('GROUP_SOURCE_FILES covers all non-empty groups', () => {
    // 核验基线：module-loader 注册的 26 模块对应这些 group 主文件
    expect(GROUP_SOURCE_FILES['core']).toContain('scene.ts');
    expect(GROUP_SOURCE_FILES['animation']).toContain('animation/animation-ops.ts');
    expect(GROUP_SOURCE_FILES['ui']).toContain('ui/ui-create.ts');
    expect(GROUP_SOURCE_FILES['physics']).toEqual(['physics-ops.ts']);
  });

  it('DANGER_PATTERNS includes OS.execute / str2var / ClassDB.instantiate / execute_gdscript', () => {
    const src = DANGER_PATTERNS.map(r => r.source).join('|');
    expect(src).toMatch(/OS\.execute/);
    expect(src).toMatch(/str2var/);
    expect(src).toMatch(/ClassDB\.instantiate/);
    expect(src).toMatch(/execute_gdscript/);
  });

  it('scanDangerApi returns files hitting danger patterns', () => {
    mkdirSync(join(ROOT, 'src/tools'), { recursive: true });
    writeFileSync(join(ROOT, 'src/tools/scene.ts'), 'OS.execute("ls")');
    writeFileSync(join(ROOT, 'src/tools/docs.ts'), 'return null; // safe');
    const hits = scanDangerApi(['scene.ts', 'docs.ts'], ROOT);
    expect(hits).toContain('scene.ts');
    expect(hits).not.toContain('docs.ts');
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('findEditorCommandForTool returns path for routed tools, null for unrouted', () => {
    // 路由表里的工具 → 返回实现文件路径
    expect(findEditorCommandForTool('open_scene')).toContain('scene_commands.gd');
    expect(findEditorCommandForTool('add_node')).toContain('node_commands.gd');
    // editor_guards.gd 在 addons 根（非 commands/ 子目录）
    expect(findEditorCommandForTool('guard_text_resource_write')).toContain('editor_guards.gd');
    // 不在路由表的工具（headless-only 或无 editor 实现）→ null
    expect(findEditorCommandForTool('manage_tools')).toBeNull();
  });

  it('EDITOR_COMMAND_ROUTING 与 command_handler.gd handle() 路由表一致（drift 检测）', () => {
    // 防止 editor 加命令时 ROUTING 漏更新：解析 handle() match 块提取路由 method，
    // 与 ROUTING keys 双向比对。任一方向缺失即 drift（测试红）。
    const handlerPath = join(REPO_ROOT, 'addons/godot_mcp_server/command_handler.gd');
    const src = readFileSync(handlerPath, 'utf8');
    const start = src.indexOf('func handle(');
    const end = src.indexOf('\nfunc ', start + 1);
    const block = src.slice(start, end === -1 ? undefined : end);
    // match 分支："method": 格式（行尾冒号）；排除默认分支 "_"。
    const routed = new Set(
      [...block.matchAll(/^\s*"(\w+)":\s*$/gm)].map(m => m[1]).filter(m => m !== '_'),
    );
    const routing = new Set(Object.keys(EDITOR_COMMAND_ROUTING));
    const missingInRouting = [...routed].filter(m => !routing.has(m));
    const missingInHandler = [...routing].filter(m => !routed.has(m));
    expect(
      missingInRouting,
      `command_handler.gd 路由了但 ROUTING 缺失: ${missingInRouting.join(', ')}（加到 EDITOR_COMMAND_ROUTING）`,
    ).toEqual([]);
    expect(
      missingInHandler,
      `ROUTING 有但 command_handler.gd 未路由: ${missingInHandler.join(', ')}（删除或核实）`,
    ).toEqual([]);
  });
});
