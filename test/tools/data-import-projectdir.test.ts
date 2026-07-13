/**
 * A2 (2026-07-13 enhanced-vs-godogen 对比测试核实): csv_to_resources 用 args.project_path
 * 而非 ctx.projectDir。data-import.ts:268 原用 ctx.projectDir(全局 process-state, getProjectDir
 * 初始 ''), 未先 run_project 时 ctx.projectDir='' → resolveWithinRoot('', csv_path) → base=cwd →
 * "csv_path not found"。异类于 verify_delivery(delivery.ts:218 用 requireProjectPath(args))。
 *
 * 本测试 ctx.projectDir=''(模拟未 run_project)+ args.project_path=临时项目, 断言 csv_path
 * 按 args.project_path 解析(非 cwd)。mock executeGdscriptTrusted 拦截真 Godot spawn。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ToolContext } from '../../src/types.js';

vi.mock('../../src/gdscript-executor.js', () => ({
  executeGdscriptTrusted: vi.fn(async () => ({
    success: true,
    compile_success: true,
    compile_error: '',
    errors: [],
    run_success: true,
    run_error: '',
    outputs: [
      { key: 'generated', value: '[]' },
      { key: 'errors', value: '[]' },
      { key: 'stats', value: '{"rows":1,"generated":0,"failed":0}' },
    ],
    raw_output: '',
    duration_ms: 1,
  })),
}));

import { handleTool } from '../../src/tools/data-import.js';
import { executeGdscriptTrusted } from '../../src/gdscript-executor.js';

const mockExec = executeGdscriptTrusted as unknown as ReturnType<typeof vi.fn>;

describe('csv_to_resources projectPath source (A2)', () => {
  let proj: string;
  beforeEach(() => {
    // UNRESTRICTED 绕过 isPathInAllowedRoots(tmpdir 项目不在 ALLOWED_PROJECT_PATHS)
    process.env.GODOT_MCP_UNRESTRICTED = 'true';
    mockExec.mockClear();
    proj = mkdtempSync(join(tmpdir(), 'csv-projdir-'));
    writeFileSync(join(proj, 'project.godot'), '; test\n');
    writeFileSync(join(proj, 'item.gd'), 'extends Resource\n');
    writeFileSync(join(proj, 'items.csv'), 'name,type\nx,w\n');
    mkdirSync(join(proj, 'resources'), { recursive: true });
  });
  afterEach(() => {
    delete process.env.GODOT_MCP_UNRESTRICTED;
    try { rmSync(proj, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('uses args.project_path, not ctx.projectDir, when projectDir unset (A2)', async () => {
    // ctx.projectDir='' 模拟"未 run_project"(getProjectDir 初始 '');project_path 在 args 传临时项目
    const ctx = {
      projectDir: '',
      opsScript: '/fake/ops.gd',
      findGodot: vi.fn(async () => '/fake/godot'),
    } as unknown as ToolContext;
    const result = await handleTool('csv_to_resources', {
      project_path: proj,
      action: 'csv_to_resources',
      class_path: 'res://item.gd',
      output_dir: 'resources',
      filename_column: 'name',
      csv_path: 'items.csv',
    }, ctx);
    const text = (result?.content?.[0]?.text) ?? '';
    // 修复前: projectPath=ctx.projectDir='' → resolveWithinRoot('', 'items.csv') → cwd/items.csv
    //         → existsSync false → "csv_path not found: items.csv"; mockExec 不被调用
    // 修复后: projectPath=requireProjectPath(args)=proj → proj/items.csv → 找到 → 继续 GDScript(mock 拦截)
    expect(text).not.toContain('csv_path not found');
    expect(mockExec).toHaveBeenCalled();
  });
});
