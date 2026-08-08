// SEC-P1-1 (2026-08-08): write_script/edit_script 沙箱扫描守卫测试。
// write/edit 写入 .gd 前对齐 execute_gdscript 走 scanGdscriptSandbox,防 @tool/OS.execute 脚本写入。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock import-check 避免 --import 真实 spawn godot
vi.mock('../src/tools/import-check.js', () => ({
  runImport: vi.fn().mockResolvedValue(undefined),
  needsImport: () => false,
  resetImportCache: () => {},
}));

const DANGEROUS_CONTENT = `extends Node

func _ready() -> void:
    OS.execute("calc", [])
`;

const SAFE_CONTENT = `extends Node

func _ready() -> void:
    print("hello")
`;

describe('SEC-P1-1: write_script/edit_script 沙箱扫描', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-sec-'));
    writeFileSync(join(tmpDir, 'project.godot'), '[application]\nconfig/name="t"\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // 清理可能被测试 stub 的 env
    vi.unstubAllEnvs();
  });

  it('write_script 含 OS.execute 被阻断(SANDBOX_VIOLATION)', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'test/danger.gd',
      content: DANGEROUS_CONTENT,
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    expect(text).toContain('OS system command');
  });

  it('write_script 正常脚本不受影响', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'test/safe.gd',
      content: SAFE_CONTENT,
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('Script written');
  });

  it('write_script 双 opt-in 旁路放行(UNRESTRICTED + DISABLE_SAFETY)', async () => {
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
    vi.stubEnv('GODOT_MCP_DISABLE_SAFETY', 'true');
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'test/bypass.gd',
      content: DANGEROUS_CONTENT,
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('Script written');
  });

  it('write_script 单 env 不够(仅 UNRESTRICTED,无 DISABLE_SAFETY)仍阻断', async () => {
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
    // 不设 DISABLE_SAFETY / ALLOW_UNSAFE
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'test/single.gd',
      content: DANGEROUS_CONTENT,
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
  });

  it('edit_script search_and_replace 含 OS.execute 被阻断(occurrence=0 全量)', async () => {
    const targetPath = join(tmpDir, 'edit_target.gd');
    writeFileSync(targetPath, 'extends Node\n\nfunc _ready():\n    pass\n');
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'edit_script',
      project_path: tmpDir,
      script_path: 'edit_target.gd',
      search_and_replace: { search: '    pass', replace: '    OS.execute("calc", [])', occurrence: 0 },
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    // 确认文件未被写入(原内容保持)
    expect(readFileSync(targetPath, 'utf-8')).toContain('    pass');
  });

  it('edit_script search_and_replace 含 OS.execute 被阻断(occurrence=1 单次,独立 substring 路径)', async () => {
    // 守护 script.ts 单 occurrence 路径(独立 substring 拼接 finalContent)的沙箱扫描
    const targetPath = join(tmpDir, 'edit_occurrence.gd');
    writeFileSync(targetPath, 'extends Node\n\nfunc a():\n    pass\n\nfunc b():\n    pass\n');
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'edit_script',
      project_path: tmpDir,
      script_path: 'edit_occurrence.gd',
      search_and_replace: { search: '    pass', replace: '    OS.execute("calc", [])', occurrence: 1 },
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    // 确认文件未被写入(两个 pass 都在)
    const after = readFileSync(targetPath, 'utf-8');
    expect(after.match(/    pass/g)?.length).toBe(2);
  });

  it('edit_script 行号模式含 OS.execute 被阻断', async () => {
    const targetPath = join(tmpDir, 'edit_lines.gd');
    writeFileSync(targetPath, 'extends Node\n\nfunc _ready():\n    pass\n');
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('script', {
      action: 'edit_script',
      project_path: tmpDir,
      script_path: 'edit_lines.gd',
      start_line: 4,
      end_line: 4,
      new_content: '    OS.execute("calc", [])',
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    expect(readFileSync(targetPath, 'utf-8')).toContain('    pass');
  });

  it('非 .gd 文件(.cs)跳过沙箱扫描', async () => {
    const { handleTool } = await import('../src/tools/script.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    // .cs 不应被 scanGdscriptSandbox 拦(它只扫 GDScript 模式)
    const res = await handleTool('script', {
      action: 'write_script',
      project_path: tmpDir,
      script_path: 'test/code.cs',
      content: 'using Godot;\npublic partial class C : Node { public override void _Ready() { OS.Execute("calc"); } }\n',
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('Script written');
    expect(text).not.toContain('SANDBOX_VIOLATION');
  });
});
