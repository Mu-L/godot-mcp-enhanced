// SEC-P1-1 (2026-08-08): write_script/edit_script 沙箱扫描守卫测试。
// write/edit 写入 .gd 前对齐 execute_gdscript 走 scanGdscriptSandbox,防 @tool/OS.execute 脚本写入。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
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

// SEC-P1-1 续 (2026-08-14 B-1): write_script/edit_script 之外的 3 个 .gd 写入旁路入口
// (quick_scene / batch create_files / templates apply_template)统一接沙箱扫描。
// 根因:三入口直接 writeFileSync 绕过 scanScriptSandboxOrThrow,tscn 绑 ExtResource 后
// 编辑器打开/run_project 即执行 — 与 write_script 同一威胁面。
describe('SEC-P1-1 B-1: 三旁路入口沙箱扫描', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-sec-b1-'));
    writeFileSync(join(tmpDir, 'project.godot'), '[application]\nconfig/name="t"\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('quick_scene script_content 含 OS.execute 被阻断(场景+脚本均不落盘)', async () => {
    const { handleTool } = await import('../src/tools/scene/index.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('scene', {
      action: 'quick_scene',
      project_path: tmpDir,
      scene_path: 'test/danger.tscn',
      script_path: 'test/danger.gd',
      script_content: DANGEROUS_CONTENT,
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    // 场景与脚本都不能落盘(tscn 绑 ExtResource 即执行向量)
    expect(existsSync(join(tmpDir, 'test/danger.tscn'))).toBe(false);
    expect(existsSync(join(tmpDir, 'test/danger.gd'))).toBe(false);
  });

  it('quick_scene 安全 script_content 正常创建(不误判)', async () => {
    const { handleTool } = await import('../src/tools/scene/index.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('scene', {
      action: 'quick_scene',
      project_path: tmpDir,
      scene_path: 'test/safe.tscn',
      script_path: 'test/safe.gd',
      script_content: SAFE_CONTENT,
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('Created scene');
    expect(existsSync(join(tmpDir, 'test/safe.tscn'))).toBe(true);
    expect(existsSync(join(tmpDir, 'test/safe.gd'))).toBe(true);
  });

  it('batch create_files 危险 .gd 被拒入 failed 且不落盘', async () => {
    const { handleTool } = await import('../src/tools/batch-tools.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('batch', {
      action: 'create_files',
      project_path: tmpDir,
      validate: false,
      files: [{ path: 'scripts/evil.gd', content: DANGEROUS_CONTENT }],
    }, ctx);

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    const parsed = JSON.parse(text) as { created: number; failed: number; details: { failed: Array<{ path: string; error: string }> } };
    expect(parsed.failed).toBe(1);
    expect(parsed.details.failed[0]!.path).toBe('scripts/evil.gd');
    expect(parsed.details.failed[0]!.error).toContain('SANDBOX_VIOLATION');
    expect(existsSync(join(tmpDir, 'scripts/evil.gd'))).toBe(false);
  });

  it('batch create_files 非 .gd 文件(.tscn/.json)不受沙箱影响正常写入(不误判)', async () => {
    const { handleTool } = await import('../src/tools/batch-tools.js');
    const ctx = { findGodot: async () => '/fake/godot' };
    const res = await handleTool('batch', {
      action: 'create_files',
      project_path: tmpDir,
      validate: false,
      files: [
        { path: 'scenes/main.tscn', content: '[gd_scene format=3]\nOS.execute("calc", [])\n' },
        { path: 'data/cfg.json', content: '{"cmd": "OS.execute(\\"calc\\", [])"}\n' },
      ],
    }, ctx);

    const text = res.content[0].text;
    expect(text).not.toContain('SANDBOX_VIOLATION');
    const parsed = JSON.parse(text) as { created: number; failed: number };
    expect(parsed.created).toBe(2);
    expect(parsed.failed).toBe(0);
    expect(existsSync(join(tmpDir, 'scenes/main.tscn'))).toBe(true);
    expect(existsSync(join(tmpDir, 'data/cfg.json'))).toBe(true);
  });

  it('apply_template 用户模板渲染含 OS.execute 被阻断(.mcp-templates 投毒向量)', async () => {
    // .mcp-templates/ 投毒向量:validateUserTemplate 零内容审查,危险 code 经 apply_template
    // 渲染写 .gd — 修复后该写入点被沙箱扫描拦截
    mkdirSync(join(tmpDir, '.mcp-templates'));
    writeFileSync(join(tmpDir, '.mcp-templates', 'evil.json'), JSON.stringify({
      id: 'user-evil',
      name: 'evil',
      description: 'evil template',
      code: 'extends Node\n\nfunc _ready() -> void:\n    OS.execute("calc", [])\n',
    }));
    const { handleTool } = await import('../src/tools/code-templates.js');
    const res = await handleTool('templates', {
      action: 'apply',
      project_path: tmpDir,
      template_id: 'user-evil',
      script_path: 'scripts/evil.gd',
    }, {});

    const text = res.content[0].text;
    expect(text).toContain('SANDBOX_VIOLATION');
    expect(existsSync(join(tmpDir, 'scripts/evil.gd'))).toBe(false);
  });

  it('apply_template 内置安全模板正常写入 .gd(不误判)', async () => {
    const { handleTool } = await import('../src/tools/code-templates.js');
    const res = await handleTool('templates', {
      action: 'apply',
      project_path: tmpDir,
      template_id: 'T001',
      script_path: 'scripts/camera.gd',
      variables: { position: 'Vector3(0, 5, 10)' },
    }, {});

    const text = res.content[0].text;
    expect(text).not.toContain('SANDBOX_VIOLATION');
    expect(text).toContain('applied to scripts/camera.gd');
    expect(existsSync(join(tmpDir, 'scripts/camera.gd'))).toBe(true);
  });
});
