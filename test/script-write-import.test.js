// M6 (2026-06-23): write_script 创建含 class_name 的 .gd 后自动触发 --import 重建 cache。
// 根因:ASSET_SCAN_DIRS=['assets','scenes','scripts'] 不扫 autoload/combat/data 等自定义目录,
// needsImport 漏检 → execute_gdscript 不 warm → 新 class_name "Identifier not declared"。
import { expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock import-check 避免 --import 真实 spawn godot
vi.mock('../src/tools/import-check.js', () => ({
  runImport: vi.fn().mockResolvedValue(undefined),
  needsImport: () => false,
  resetImportCache: () => {},
}));

describe('write_script class_name import (M6)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-m6-'));
    writeFileSync(join(tmpDir, 'project.godot'), '[application]\nconfig/name="t"\nconfig/features=PackedStringArray("4.6")\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('triggers runImport when .gd contains class_name (custom dir, not in ASSET_SCAN_DIRS)', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const { runImport } = await import('../src/tools/import-check.js');
    runImport.mockClear();

    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'autoload/player_data.gd',
      content: 'class_name PlayerData\nextends RefCounted\n\nvar hp: int = 100\n',
    }, ctx);

    expect(runImport).toHaveBeenCalledTimes(1);
    expect(runImport).toHaveBeenCalledWith(tmpDir, '/fake/godot', 30_000);
    const text = res.content[0].text;
    expect(text).toContain("class_name 'PlayerData'");
    expect(text).toContain('--import');
  });

  it('does not trigger runImport when .gd has no class_name', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const { runImport } = await import('../src/tools/import-check.js');
    runImport.mockClear();

    const ctx = { findGodot: async () => '/fake/godot' };
    await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'scripts/no_class.gd',
      content: 'extends Node\n\nfunc _ready():\n\tpass\n',
    }, ctx);

    expect(runImport).not.toHaveBeenCalled();
  });

  it('does not trigger runImport for non-.gd files', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const { runImport } = await import('../src/tools/import-check.js');
    runImport.mockClear();

    const ctx = { findGodot: async () => '/fake/godot' };
    await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'README.md',
      content: '# class_name InComment\n',
    }, ctx);

    expect(runImport).not.toHaveBeenCalled();
  });

  it('still succeeds (with hint) when runImport throws', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const { runImport } = await import('../src/tools/import-check.js');
    runImport.mockRejectedValueOnce(new Error('godot not found'));

    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'autoload/x.gd',
      content: 'class_name X\nextends RefCounted\n',
    }, ctx);

    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain('自动 --import 失败');
    expect(text).toContain('手动');
  });
});
