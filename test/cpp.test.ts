import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fs mock 覆盖 handleTool 写盘 + 路径校验链(validatePath/isPathInAllowedRoots)可能用到的 fs 方法。
// 范式对齐 test/android.test.ts(realpathSync/statSync/lstatSync 等)。
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => [] as string[]),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  realpathSync: vi.fn((p: string) => p),
  statSync: vi.fn(() => ({ size: 0 }) as any),
  lstatSync: vi.fn(() => ({ isSymbolicLink: () => false }) as any),
  readFileSync: vi.fn(() => ''),
}));
vi.mock('fs', () => fsMock);

// P1-4 (2026-08-11): 改用 asUnrestrictedPath helper(per-test stubEnv + afterEach restore)。
// 原模块顶层 stubEnv 无 restore,致跨文件 env 泄漏(同 worker 后续路径安全测试继承
// UNRESTRICTED=true → bypass ALLOWED_PROJECT_PATHS → 安全测试假绿)。对齐 11 个规范文件。
let restoreUnrestricted: () => void;
beforeEach(() => { restoreUnrestricted = asUnrestrictedPath(); });
afterEach(() => { restoreUnrestricted(); });

import {
  renderScaffold, PARENT_CLASS_WHITELIST, SUPPORTED_GODOT_VERSIONS, CLASS_NAME_RE,
  isGodotCppV10Track, godotCppCloneCommand,
} from '../src/tools/cpp-templates.js';
import { handleTool } from '../src/tools/cpp.js';
import { asUnrestrictedPath } from './helpers/path-isolation.js';

describe('cpp-templates renderScaffold', () => {
  const ctx = { className: 'Example', parentClass: 'Node', parentInc: 'node', lib: 'example', godotVersion: '4.6' };

  it('返回 8 个文件', () => {
    const files = renderScaffold(ctx);
    expect(files).toHaveLength(8);
    expect(files.map(f => f.path).sort()).toEqual(
      ['.gitignore', 'README.md', 'SConstruct', 'example.gdextension',
       'src/Example.cpp', 'src/Example.h', 'src/register_types.cpp', 'src/register_types.h'].sort()
    );
  });

  it('类名/父类/lib 正确替换进头文件', () => {
    const h = renderScaffold(ctx).find(f => f.path === 'src/Example.h')!.content;
    expect(h).toContain('class Example : public Node {');
    expect(h).toContain('GDCLASS(Example, Node)');
    expect(h).toContain('<godot_cpp/classes/node.hpp>');
  });

  it('register_types 含 entry_symbol 与 GDREGISTER_CLASS', () => {
    const cpp = renderScaffold(ctx).find(f => f.path === 'src/register_types.cpp')!.content;
    expect(cpp).toContain('example_library_init');
    expect(cpp).toContain('GDREGISTER_CLASS(Example)');
  });

  it('.gdextension 的 compatibility_minimum 随 godot_version 变化', () => {
    const v46 = renderScaffold({ ...ctx, godotVersion: '4.6' })
      .find(f => f.path === 'example.gdextension')!.content;
    const v44 = renderScaffold({ ...ctx, godotVersion: '4.4' })
      .find(f => f.path === 'example.gdextension')!.content;
    expect(v46).toContain('compatibility_minimum = "4.6"');
    expect(v44).toContain('compatibility_minimum = "4.4"');
    expect(v46).toContain('entry_symbol = "example_library_init"');
  });

  it('SConstruct 引用 ./godot-cpp 且输出 bin/libgdexample', () => {
    const s = renderScaffold(ctx).find(f => f.path === 'SConstruct')!.content;
    // ctx.godotVersion='4.6' 属 v10 轨 → 显式 api_version
    expect(s).toContain('SConscript("godot-cpp/SConstruct", {"api_version": "4.6"})');
    expect(s).toContain('libgdexample');
  });

  it('parent 白名单含 CharacterBody2D/3D 且 include 命名正确', () => {
    expect(PARENT_CLASS_WHITELIST.CharacterBody2D).toBe('character_body_2d');
    expect(PARENT_CLASS_WHITELIST.CharacterBody3D).toBe('character_body_3d');
    expect(PARENT_CLASS_WHITELIST.Node2D).toBe('node2d');
  });

  it('CLASS_NAME_RE 接受 PascalCase 拒绝其余', () => {
    expect(CLASS_NAME_RE.test('Example')).toBe(true);
    expect(CLASS_NAME_RE.test('MyClass2D')).toBe(true);
    expect(CLASS_NAME_RE.test('example')).toBe(false);   // 小写开头
    expect(CLASS_NAME_RE.test('My-Class')).toBe(false);   // 连字符
    expect(CLASS_NAME_RE.test('2DThing')).toBe(false);    // 数字开头
  });

  it('SUPPORTED_GODOT_VERSIONS 含 4.4/4.5/4.6/4.7', () => {
    expect([...SUPPORTED_GODOT_VERSIONS]).toEqual(['4.4', '4.5', '4.6', '4.7']);
  });

  it('分轨:v10 轨(4.6/4.7)SConstruct 传 api_version,README 用 master clone', () => {
    for (const ver of ['4.6', '4.7'] as const) {
      const files = renderScaffold({ ...ctx, godotVersion: ver });
      const s = files.find(f => f.path === 'SConstruct')!.content;
      const readme = files.find(f => f.path === 'README.md')!.content;
      expect(s).toContain(`{"api_version": "${ver}"}`);
      expect(readme).toContain('git clone https://github.com/godotengine/godot-cpp godot-cpp');
      // 回归锚:godot-cpp 无 godot-4.6-stable/4.7-stable ref,不得再生成该 clone 指引
      expect(readme).not.toContain(`-b godot-${ver}-stable`);
      expect(godotCppCloneCommand(ver)).not.toContain('-b ');
    }
  });

  it('分轨:旧轨(4.4/4.5)SConstruct 不传 api_version,README 用 stable 分支 clone', () => {
    for (const ver of ['4.4', '4.5'] as const) {
      const files = renderScaffold({ ...ctx, godotVersion: ver });
      const s = files.find(f => f.path === 'SConstruct')!.content;
      const readme = files.find(f => f.path === 'README.md')!.content;
      expect(s).toContain('SConscript("godot-cpp/SConstruct")');
      expect(s).not.toContain('api_version');
      expect(readme).toContain(`git clone -b godot-${ver}-stable https://github.com/godotengine/godot-cpp godot-cpp`);
      expect(godotCppCloneCommand(ver)).toContain(`-b godot-${ver}-stable`);
    }
  });

  it('分轨:isGodotCppV10Track 判定', () => {
    expect(isGodotCppV10Track('4.6')).toBe(true);
    expect(isGodotCppV10Track('4.7')).toBe(true);
    expect(isGodotCppV10Track('4.5')).toBe(false);
    expect(isGodotCppV10Track('4.4')).toBe(false);
  });

  it('.gdextension compatibility_minimum 在 4.7 下随版本写入', () => {
    const v47 = renderScaffold({ ...ctx, godotVersion: '4.7' })
      .find(f => f.path === 'example.gdextension')!.content;
    expect(v47).toContain('compatibility_minimum = "4.7"');
  });
});

describe('cpp scaffold_gdextension handleTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readdirSync.mockReturnValue([] as any);
  });

  it('生成全部 8 文件并返回清单', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', class_name: 'Foo', parent_class: 'Node' },
      {} as any);
    const parsed = JSON.parse(r!.content[0].text);
    expect(parsed.files).toHaveLength(8);
    // 默认版本 4.7(v10 轨)→ master clone,无 -b stable ref
    expect(parsed.godot_cpp_clone_hint).toBe('git clone https://github.com/godotengine/godot-cpp godot-cpp');
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('src'), { recursive: true });
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(8);
  });

  it('非法 parent_class → 报错且不写盘', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', parent_class: 'Sprite' /* 不在白名单 */ },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('非法 class_name → 报错', async () => {
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', class_name: 'lower' },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
  });

  it('非法 godot_version → 报错', async () => {
    for (const bad of ['3.5', '4.8']) {
      const r = await handleTool('cpp',
        { action: 'scaffold_gdextension', project_path: '/proj/ext', godot_version: bad },
        {} as any);
      expect(r!.content[0].text).toContain('Error');
    }
  });

  it('目标已存在非空 + 未 force → 拒绝', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['a.cpp'] as any);
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext' },
      {} as any);
    expect(r!.content[0].text).toContain('Error');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('force=true 时覆盖已存在非空目录', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(['a.cpp'] as any);
    const r = await handleTool('cpp',
      { action: 'scaffold_gdextension', project_path: '/proj/ext', force: true },
      {} as any);
    const parsed = JSON.parse(r!.content[0].text);
    expect(parsed.files).toHaveLength(8);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(8);
  });
});
