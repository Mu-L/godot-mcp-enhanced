import { describe, it, expect } from 'vitest';
import {
  renderScaffold, PARENT_CLASS_WHITELIST, SUPPORTED_GODOT_VERSIONS, CLASS_NAME_RE,
} from '../src/tools/cpp-templates.js';

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
    expect(s).toContain('SConscript("godot-cpp/SConstruct")');
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

  it('SUPPORTED_GODOT_VERSIONS 含 4.4/4.5/4.6', () => {
    expect([...SUPPORTED_GODOT_VERSIONS]).toEqual(['4.4', '4.5', '4.6']);
  });
});
