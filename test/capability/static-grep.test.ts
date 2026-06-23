import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GROUP_SOURCE_FILES, DANGER_PATTERNS, scanDangerApi, findEditorCommandFile } from '../../src/capability/static-grep.js';

const ROOT = join(tmpdir(), `mcp-m1-staticgrep-${Date.now()}`);

describe('static-grep', () => {
  it('GROUP_SOURCE_FILES covers all non-empty groups', () => {
    // 核验基线：module-loader 注册的 26 模块对应这些 group 主文件
    expect(GROUP_SOURCE_FILES['core']).toContain('scene.ts');
    expect(GROUP_SOURCE_FILES['animation']).toContain('animation-ops.ts');
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

  it('findEditorCommandFile returns path when commands file exists', () => {
    const groupFileMap: Record<string, string> = { scene: 'scene_commands.gd', ui: 'ui_commands.gd' };
    mkdirSync(join(ROOT, 'addons/godot_mcp_server/commands'), { recursive: true });
    writeFileSync(join(ROOT, 'addons/godot_mcp_server/commands/scene_commands.gd'), 'extends Node');
    // scene_commands.gd 存在
    expect(findEditorCommandFile('scene', ROOT, groupFileMap)).toContain('scene_commands.gd');
    // navigation 组对应 nav_commands.gd，此处未创建 → null
    expect(findEditorCommandFile('navigation', ROOT, { navigation: 'nav_commands.gd' })).toBeNull();
    rmSync(ROOT, { recursive: true, force: true });
  });
});
