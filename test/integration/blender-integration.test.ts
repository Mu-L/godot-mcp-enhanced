import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'fs';
import { tmpdir } from 'os';

function hasBlender(): boolean {
  const bin = process.env.GODOT_BLENDER_PATH || 'blender';
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    return /blender/i.test(out) && /\d+\.\d+/.test(out);
  } catch { return false; }
}

const run = hasBlender();
describe.skipIf(!run)('execute_bpy integration (real blender)', () => {
  let proj: string;
  beforeAll(() => {
    proj = mkdtempSync(join(tmpdir(), 'mcp-bpy-'));
    writeFileSync(join(proj, 'project.godot'), '', 'utf-8');
  });
  afterAll(() => { try { rmSync(proj, { recursive: true, force: true }); } catch { /* */ } });

  it('creates a cube and exports glb', async () => {
    const { handleTool } = await import('../../src/tools/blender.js');
    const r = await handleTool('blender', {
      project_path: proj,
      action: 'execute_bpy',
      export_path: 'assets/models/cube.glb',
      code: "bpy.ops.mesh.primitive_cube_add(size=2)",
    }, {} as any);
    const glb = join(proj, 'assets', 'models', 'cube.glb');
    expect(existsSync(glb)).toBe(true);
    expect(statSync(glb).size).toBeGreaterThan(0);
    expect(JSON.stringify(r)).toContain('glb exported');
  }, 120_000);

  it('argv contract: -- preserved in sys.argv, index("--")+1 resolves export_path', async () => {
    // 探针:buildBlenderScript 的 FOOTER 用 index("--")+1;若 Blender 不保留 -- 则 export 失败 → 上一条已验证。
    // 本条显式断言 export 走的是 argv 而非插值(glb 文件名来自 export_path 参数)。
    const { handleTool } = await import('../../src/tools/blender.js');
    const r = await handleTool('blender', {
      project_path: proj,
      action: 'execute_bpy',
      export_path: 'probe.glb',
      code: "bpy.ops.mesh.primitive_uv_sphere_add()",
    }, {} as any);
    expect(existsSync(join(proj, 'probe.glb'))).toBe(true);
    expect(JSON.stringify(r)).not.toContain('probe.glb\"'); // filepath 走 argv,不出现在脚本字面量
  }, 120_000);
});

describe.skipIf(run)('execute_bpy integration', () => {
  it('skipped (no blender — set GODOT_BLENDER_PATH to enable)', () => { expect(true).toBe(true); });
});
