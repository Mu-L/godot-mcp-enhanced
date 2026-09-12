import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// P0-2 (2026-09-11): .pc 日志 rotate race 防护 — 契约测试。
// 坑(aigengame conftest.py 实测):并发 Godot 实例共享 user://logs,桌面端 RotatedFileLogger
// 在 rotate_file() 竞争,abort 被伪装成 engine_crashed(最阴险的 flaky 来源)。
// 修复:enhanced 管理的项目(fixture + create_project 产物)双 key 关文件日志——必须同时写
//   debug/file_logging/enable_file_logging=false
//   debug/file_logging/enable_file_logging.pc=false   ← .pc feature-tag 桌面默认 true 且启动时获胜,
//                                                        只关 base 是 no-op(godot main/main.cpp)
// 边界:用户项目不注入(非 enhanced 管理面);MULTI_INSTANCE 对同一用户项目开多实例的
// race 是已知限制,见 docs/reviews 审查文档。

describe('P0-2: .pc 日志 rotate race 防护(fixture + create_project 契约)', () => {
  const fixtureDirs = [
    'test/e2e-scene',
    ...readdirSync('test/fixtures', { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join('test/fixtures', d.name))
      .filter(d => {
        try { readFileSync(join(d, 'project.godot')); return true; } catch { return false; }
      }),
  ];

  it('P0-2a: 所有含 project.godot 的 fixture 都有双 key(含 .pc override)', () => {
    expect(fixtureDirs.length, '应发现 ≥7 个 fixture 项目').toBeGreaterThanOrEqual(7);
    for (const dir of fixtureDirs) {
      const cfg = readFileSync(join(dir, 'project.godot'), 'utf8');
      expect(cfg.includes('file_logging/enable_file_logging=false'), `${dir} 缺 base key`).toBe(true);
      expect(cfg.includes('file_logging/enable_file_logging.pc=false'), `${dir} 缺 .pc override key(只关 base 是 no-op)`).toBe(true);
      expect(cfg.includes('[debug]'), `${dir} 缺 [debug] 段头`).toBe(true);
    }
  });

  it('P0-2b: create_project 模板含双 key(project.ts)', () => {
    const ts = readFileSync('src/tools/project.ts', 'utf8');
    const templateStart = ts.indexOf("const projectGodot = [");
    const templateEnd = ts.indexOf('].join', templateStart);
    const template = ts.slice(templateStart, templateEnd);
    expect(templateStart, '缺 projectGodot 模板').toBeGreaterThan(-1);
    expect(template.includes('file_logging/enable_file_logging=false'), 'create_project 模板缺 base key').toBe(true);
    expect(template.includes('file_logging/enable_file_logging.pc=false'), 'create_project 模板缺 .pc override key').toBe(true);
  });

  it('P0-2c: cli init 两处动态模板均含双 key(init.ts,审查 Nit-1 修复)', () => {
    const ts = readFileSync('src/cli/init.ts', 'utf8');
    const count = (ts.match(/file_logging\/enable_file_logging\.pc=false/g) ?? []).length;
    expect(count, 'init.ts 应有 game 模板 + 空白模板两处 .pc key').toBe(2);
  });
});
