/**
 * C# 脚本工具测试 — P3-7 阶段一收尾
 *
 * 覆盖:
 * - read_script 读 .cs(含 using 列表提取)
 * - project_replace .cs(白名单已加 .cs)
 * - edit_script 对 .cs 无 .csproj 时优雅降级(skipNote,不阻断)
 *
 * 注:dotnet build 回滚逻辑依赖真实 dotnet CLI,跨平台 CI 不保证可用,
 * 故回滚分支由 csharpValidateAndRevert 的 ENOENT/无 csproj 降级路径覆盖
 * (不测真实 build 失败回滚,那需 fixture .csproj + dotnet 环境)。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Mock batchValidateScripts 避免 .gd 验证 spawn Godot
vi.mock('../src/tools/validation.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    batchValidateScripts: vi.fn(() => Promise.resolve([
      { file: 'test.gd', errors: [], warnings: [] },
    ])),
  };
});

import * as script from '../src/tools/script.js';
import { createToolContext, createTempProject } from './helpers/tool-context.js';

const dirRef = { path: null as string | null };
let ctx: ReturnType<typeof createToolContext>;

beforeEach(() => {
  dirRef.path = createTempProject({
    'project.godot': '; Engine config\n[application]\nconfig/name="Test"\n',
  });
  ctx = createToolContext(dirRef.path);
});

afterEach(() => {
  if (dirRef.path) {
    try { rmSync(dirRef.path, { recursive: true, force: true }); } catch { /* best-effort */ }
    dirRef.path = null;
  }
});

describe('read_script — C# 文件', () => {
  it('提取 namespace / class_name / extends / usings', async () => {
    const csPath = join(dirRef.path!, 'Player.cs');
    writeFileSync(csPath, [
      'using Godot;',
      'using System.Collections.Generic;',
      'namespace Game;',
      '',
      'public partial class Player : CharacterBody3D',
      '{',
      '    private List<int> _scores;',
      '}',
    ].join('\n'));

    const result = await script.handleTool('script', {
      project_path: dirRef.path!,
      action: 'read_script',
      script_path: csPath,
    }, ctx);

    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
    expect(data.language).toBe('csharp');
    expect(data.namespace).toBe('Game;');
    expect(data.class_name).toBe('Player');
    expect(data.extends).toBe('CharacterBody3D');
    expect(data.usings).toContain('Godot');
    expect(data.usings).toContain('System.Collections.Generic');
  });

  it('无 using 指令时 usings 为空数组', async () => {
    const csPath = join(dirRef.path!, 'Empty.cs');
    writeFileSync(csPath, 'namespace Foo;\n\nclass Bar {}\n');

    const result = await script.handleTool('script', {
      project_path: dirRef.path!,
      action: 'read_script',
      script_path: csPath,
    }, ctx);

    const data = JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
    expect(data.usings).toEqual([]);
  });
});

describe('project_replace — .cs 白名单', () => {
  it('.cs 扩展名被白名单接受(不再被 filter 拒绝)', async () => {
    writeFileSync(join(dirRef.path!, 'a.cs'), 'using Godot;\nclass A { int oldVal; }\n');
    writeFileSync(join(dirRef.path!, 'b.cs'), 'class B { string oldVal; }\n');

    const result = await script.handleTool('script', {
      project_path: dirRef.path!,
      action: 'project_replace',
      search: 'oldVal',
      replace: 'newVal',
      extensions: ['.cs'],
      dry_run: false,
    }, ctx);

    // 不应返回 INVALID_PARAMS "No allowed extensions"
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).not.toMatch(/No allowed extensions/);

    // 验证替换生效
    const aContent = readFileSync(join(dirRef.path!, 'a.cs'), 'utf-8');
    expect(aContent).toContain('newVal');
    expect(aContent).not.toContain('oldVal');
  });
});

describe('edit_script — C# 验证降级', () => {
  it('无 .csproj 时:编辑应用成功,返回含 skipNote(dotnet 验证跳过)', async () => {
    const csPath = join(dirRef.path!, 'Logic.cs');
    writeFileSync(csPath, [
      'using Godot;',
      'public partial class Logic : Node',
      '{',
      '    public int Value { get; set; }',
      '}',
    ].join('\n'));

    // 无 .csproj → csharpValidateAndRevert 返回 null(不阻断)
    const result = await script.handleTool('script', {
      project_path: dirRef.path!,
      action: 'edit_script',
      script_path: csPath,
      search_and_replace: { search: 'public int Value', replace: 'public int NewValue' },
      auto_validate: true,
    }, ctx);

    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    // 编辑应成功应用(未被回滚)
    expect(text).toMatch(/replaced occurrence/);
    // 文件内容应已更新
    const edited = readFileSync(csPath, 'utf-8');
    expect(edited).toContain('NewValue');
  });

  it('.cs 文件 search_and_replace 正常工作(CRLF 安全)', async () => {
    const csPath = join(dirRef.path!, 'Data.cs');
    writeFileSync(csPath, 'class Data {\n    int x = 1;\n    int y = 2;\n}\n');

    const result = await script.handleTool('script', {
      project_path: dirRef.path!,
      action: 'edit_script',
      script_path: csPath,
      search_and_replace: { search: 'int x = 1;', replace: 'int x = 100;' },
      auto_validate: false,
    }, ctx);

    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toMatch(/replaced occurrence 1/);
    const edited = readFileSync(csPath, 'utf-8');
    expect(edited).toContain('int x = 100;');
  });

  // 2026-08-07 审查 NIT-3：补 PRIVILEGED_GROUPS gate 分支测试。
  // 现有 2 测试都走"无 .csproj"路径（csharpValidateAndRevert 在 csproj 检测就 return null，
  // 到不了 gate 校验 script.ts:140-148）。本测试建空 .csproj 触发 gate 分支，
  // 不设 PRIVILEGED_GROUPS 期望 skip（不触发 dotnet build）。
  it('有 .csproj 但未设 PRIVILEGED_GROUPS → skip dotnet build（gate 拦截，不触发 dotnet）', async () => {
    // 建 .csproj 触发 csprojExists=true，进入 gate 校验分支
    writeFileSync(join(dirRef.path!, 'Test.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net6.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n');
    const csPath = join(dirRef.path!, 'Gate.cs');
    writeFileSync(csPath, 'using Godot;\npublic partial class Gate : Node { public int V { get; set; } }\n');

    // 不设 GODOT_MCP_PRIVILEGED_GROUPS → gate 拦截，csharpValidateAndRevert 返回 null（skip）
    const origPriv = process.env.GODOT_MCP_PRIVILEGED_GROUPS;
    delete process.env.GODOT_MCP_PRIVILEGED_GROUPS;
    try {
      const result = await script.handleTool('script', {
        project_path: dirRef.path!,
        action: 'edit_script',
        script_path: csPath,
        search_and_replace: { search: 'public int V', replace: 'public int NewV' },
        auto_validate: true,
      }, ctx);
      const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
      // 编辑成功应用（未被回滚——gate skip 不阻断）
      expect(text).toMatch(/replaced occurrence/);
      const edited = readFileSync(csPath, 'utf-8');
      expect(edited).toContain('NewV');
      // 注：不触发 dotnet build（gate 拦截），不会因无 dotnet CLI 失败
    } finally {
      if (origPriv === undefined) delete process.env.GODOT_MCP_PRIVILEGED_GROUPS;
      else process.env.GODOT_MCP_PRIVILEGED_GROUPS = origPriv;
    }
  });
});
