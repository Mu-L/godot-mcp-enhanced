// test/scene-commit.test.ts
import { describe, it, expect } from 'vitest';
import { generateCommitScript, COMMIT_OPERATIONS, validateCommitOperations } from '../src/tools/scene/scene-commit.js';

describe('validateCommitOperations (IMPORTANT-7)', () => {
  it('returns null for all-valid operations', () => {
    expect(validateCommitOperations([
      { op: 'tile_set', node_path: 'G', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } },
      { op: 'node_property', path: 'P', property: 'x', value: 1 },
    ])).toBeNull();
  });

  it('returns error for unknown op', () => {
    const err = validateCommitOperations([{ op: 'evil_op', foo: 1 }]);
    expect(err).toContain('invalid op');
    expect(err).toContain('evil_op');
  });

  it('returns error for missing op field', () => {
    const err = validateCommitOperations([{ foo: 1 }]);
    expect(err).toContain('invalid op');
    expect(err).toContain('Op 0');
  });

  it('includes the offending index', () => {
    const err = validateCommitOperations([
      { op: 'tile_set', node_path: 'G', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } },
      { op: 'bad' },
    ]);
    expect(err).toContain('Op 1');
  });

  // F-5: 数值字段运行时校验,堵 as unknown as 强转的 GDScript 注入面
  it('F-5: rejects non-numeric coords.x (injection vector)', () => {
    const err = validateCommitOperations([
      { op: 'tile_set', node_path: 'G', coords: { x: '0), OS.execute("sh",["-c","rm -rf ~"]) #', y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } },
    ]);
    expect(err).toMatch(/coords.*\{x:number.*y:number\}/);
  });

  it('F-5: rejects non-numeric source_id', () => {
    const err = validateCommitOperations([
      { op: 'tile_set', node_path: 'G', coords: { x: 1, y: 1 }, source_id: 'evil', atlas: { x: 0, y: 0 } },
    ]);
    expect(err).toMatch(/source_id.*finite number/);
  });

  it('F-5: rejects malformed region for tile_fill', () => {
    const err = validateCommitOperations([
      { op: 'tile_fill', node_path: 'G', region: { x: 0, y: 0, w: 'wide', h: 1 }, source_id: 0, atlas: { x: 0, y: 0 } },
    ]);
    expect(err).toMatch(/region.*\{x,y,w,h: number\}/);
  });

  it('F-5: rejects non-string node_path', () => {
    const err = validateCommitOperations([
      { op: 'tile_erase', node_path: 123, coords: { x: 1, y: 1 } },
    ]);
    expect(err).toMatch(/node_path.*string/);
  });

  it('F-5: accepts well-formed tile_set (no false rejection)', () => {
    const err = validateCommitOperations([
      { op: 'tile_set', node_path: 'G/T', coords: { x: 1, y: 2 }, source_id: 0, atlas: { x: 0, y: 0 }, alternative_tile: 5 },
    ]);
    expect(err).toBeNull();
  });
});

describe('scene-commit: generateCommitScript', () => {
  it('generates valid GDScript for tile_set operation', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_set', node_path: 'Ground', coords: { x: 5, y: 10 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true, // save
    );
    expect(script).toContain('extends SceneTree');
    expect(script).toContain('get_node_or_null("Ground")');
    expect(script).toContain('set_cell(Vector2i(5, 10)');
    expect(script).toContain('ResourceSaver.save');
  });

  it('generates _fill_tiles helper for tile_fill', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_fill', node_path: 'Ground', region: { x: 0, y: 0, w: 20, h: 2 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true,
    );
    expect(script).toContain('func _fill_tiles(');
    // _fill_tiles uses parameterized range, not hardcoded values
    expect(script).toContain('range(ry, ry + rh)');
    // But the call site passes concrete values
    expect(script).toContain('_fill_tiles(n1, 0, 0, 20, 2,');
  });

  it('does not generate _fill_tiles when no tile_fill ops', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_set', node_path: 'Ground', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true,
    );
    expect(script).not.toContain('func _fill_tiles');
  });

  it('escapes \\r and \\t in string property values (IMPORTANT-6)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Label', property: 'text', value: 'a\tb\rc' }],
      true,
    );
    // 控制字符 \r \t 须转义为 GDScript 字面,不能保留原始字符(防 .gd 文本注入/破坏字符串)
    // SEC-P2-6 (2026-08-10): \r 现统一为 \n(与 gdEscape 共享 escapeGdStringCore),原 \\r 行为废弃
    expect(script).toContain('"a\\tb\\nc"');
  });

  it('generates node_property operation', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'node_property', path: 'Player', property: 'position', value: 'Vector2(100, 200)' },
      ],
      true,
    );
    expect(script).toContain('get_node_or_null("Player")');
    expect(script).toContain('.position');
  });

  it('generates node_add operation', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'node_add', parent: '.', name: 'Coin', type: 'Area2D' },
      ],
      true,
    );
    expect(script).toContain('Area2D.new()');
    expect(script).toContain('.name = "Coin"');
  });

  it('generates node_add with root parent (".")', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'node_add', parent: '.', name: 'Player', type: 'CharacterBody2D' },
      ],
      true,
    );
    // I-5: parent "." 是根,get_node_or_null(".") 命中根节点(原代码转空串导致必失败)
    expect(script).toContain('get_node_or_null(".")');
    expect(script).not.toContain('get_node_or_null("")');
  });

  it('stops on error when stop_on_error=true', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_set', node_path: 'Ground', coords: { x: 5, y: 10 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true,
      true, // stop_on_error
    );
    expect(script).toContain('_has_error');
    expect(script).toContain('if _has_error');
  });

  it('does not include stop check when stop_on_error=false', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_set', node_path: 'Ground', coords: { x: 5, y: 10 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true,
      false, // stop_on_error
    );
    expect(script).toContain('continue despite error');
    // Should not have the final stop block
    expect(script).not.toMatch(/if _has_error:\s+print\("COMMIT_RESULT/);
  });

  it('includes COMMIT_RESULT output', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_set', node_path: 'Ground', coords: { x: 5, y: 10 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true,
    );
    expect(script).toContain('COMMIT_RESULT');
  });

  it('generates tile_erase operation', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_erase', node_path: 'Ground', coords: { x: 5, y: 10 } },
      ],
      false,
    );
    expect(script).toContain('set_cell(Vector2i(5, 10), -1)');
  });

  it('generates tile_clear operation', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_clear', node_path: 'Ground' },
      ],
      false,
    );
    expect(script).toContain('.clear()');
  });

  it('skips save block when save=false', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_set', node_path: 'Ground', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      false,
    );
    expect(script).not.toContain('ResourceSaver.save');
    expect(script).toContain('"saved": false');
  });

  // F-2 (批 F, 2026-08-14): save=true 时 saveBlock 的顶层 success 不再硬编码 true。
  // 原字面量 {"success": true, "saved": err == OK} 并存 → 磁盘满/权限失败(EACCES/ENOSPC)时
  // AI 与 middleware 把写盘失败当成功(假成功)。修复后 success 绑定 err == OK。
  it('F-2: save=true 时 COMMIT_RESULT success 绑定 err == OK,不再硬编码 true', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_set', node_path: 'Ground', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } }],
      true,
    );
    expect(script).toContain('"success": err == OK');
    expect(script).toContain('"saved": err == OK');
    // 保存路径的 COMMIT_RESULT 不再含硬编码 success:true
    expect(script).not.toContain('"success": true');
  });

  it('F-2: save=false 分支保持 success:true + saved:false（未请求保存,无保存失败可掩盖）', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_set', node_path: 'Ground', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } }],
      false,
    );
    expect(script).toContain('"success": true');
    expect(script).toContain('"saved": false');
  });

  it('generates tileset_assign operation', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tileset_assign', node_path: 'TileMap', tileset_path: 'res://assets/tiles.tres' },
      ],
      true,
    );
    expect(script).toContain('get_node_or_null("TileMap")');
    expect(script).toContain('load("res://assets/tiles.tres")');
    expect(script).toContain('.tile_set = ');
  });

  it('generates load failure guard', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [],
      true,
    );
    expect(script).toContain('if scene == null');
    expect(script).toContain('Failed to load scene');
  });

  it('generates cells_affected for tile_fill', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_fill', node_path: 'Ground', region: { x: 0, y: 0, w: 10, h: 5 }, source_id: 0, atlas: { x: 0, y: 0 } },
      ],
      true,
    );
    expect(script).toContain('"cells_affected": 50');
  });

  it('exports COMMIT_OPERATIONS with all 16 ops after layer/data expansion', () => {
    expect(COMMIT_OPERATIONS.length).toBe(16);
    expect(COMMIT_OPERATIONS).toEqual([
      'tile_set', 'tile_fill', 'tile_erase', 'tile_clear',
      'tileset_assign', 'node_property', 'node_add',
      'tileset_physics_layer_add', 'tile_collision_set',
      'tileset_physics_layer_set', 'tileset_physics_layer_remove',
      'tileset_navigation_layer_add', 'tile_navigation_set',
      'tileset_custom_data_layer_add', 'tile_custom_data_set',
      'tile_collision_clear',
    ]);
  });

  it('handles multiple operations in sequence', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_fill', node_path: 'Ground', region: { x: 0, y: 0, w: 10, h: 2 }, source_id: 0, atlas: { x: 0, y: 0 } },
        { op: 'tile_set', node_path: 'Ground', coords: { x: 5, y: 5 }, source_id: 1, atlas: { x: 1, y: 0 } },
        { op: 'node_property', path: 'Player', property: 'speed', value: 200 },
      ],
      true,
    );
    // Each op gets a unique var name
    expect(script).toContain('var n1');
    expect(script).toContain('var n2');
    expect(script).toContain('var n3');
    expect(script).toContain('_fill_tiles');
    expect(script).toContain('speed');
  });
});

describe('serializeGdValue type inference', () => {
  it('infers Vector3 from {x, y, z}', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Player', property: 'position', value: { x: 10, y: 0, z: 5 } }],
      true,
    );
    expect(script).toContain('.position = Vector3(10, 0, 5)');
  });

  it('infers Vector2 from {x, y}', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Player', property: 'position', value: { x: 100, y: 200 } }],
      true,
    );
    expect(script).toContain('.position = Vector2(100, 200)');
  });

  it('infers Rect2 from {x, y, w, h}', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Camera', property: 'limit', value: { x: 0, y: 0, w: 800, h: 600 } }],
      true,
    );
    expect(script).toContain('.limit = Rect2(0, 0, 800, 600)');
  });

  it('infers Color from {r, g, b}', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Light', property: 'color', value: { r: 1, g: 0.5, b: 0, a: 0.8 } }],
      true,
    );
    expect(script).toContain('.color = Color(1, 0.5, 0, 0.8)');
  });

  it('uses _type override for Vector2i', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Grid', property: 'cell_size', value: { x: 32, y: 32, _type: 'Vector2i' } }],
      true,
    );
    expect(script).toContain('.cell_size = Vector2i(32, 32)');
  });

  it('uses _type override for Rect2i', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Region', property: 'bounds', value: { x: 0, y: 0, w: 100, h: 50, _type: 'Rect2i' } }],
      true,
    );
    expect(script).toContain('.bounds = Rect2i(0, 0, 100, 50)');
  });

  it('serializes arrays', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Node', property: 'values', value: [1, 2, 3] }],
      true,
    );
    expect(script).toContain('.values = [1, 2, 3]');
  });

  it('falls back to JSON for unknown objects', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Node', property: 'data', value: { foo: 'bar', baz: 42 } }],
      true,
    );
    expect(script).toContain('.data = {"foo":"bar","baz":42}');
  });

  it('node_add properties also use type inference', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_add', type: 'Node3D', name: 'Marker', parent: '.', properties: { position: { x: 5, y: 0, z: 10 } } }],
      true,
    );
    expect(script).toContain('.position = Vector3(5, 0, 10)');
  });

  // SEC-P2-6 (2026-08-10): string 属性值转义经 escapeForGdLiteral(与 gdEscape 共享 core)
  it('preserves % in string property values (not escaped, no % formatting)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Label', property: 'text', value: '50% off' }],
      true,
    );
    expect(script).toContain('"50% off"');
    expect(script).not.toContain('%%');
  });

  it("preserves single quote in string property values", () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Label', property: 'text', value: "it's" }],
      true,
    );
    expect(script).toContain("\"it's\"");
  });

  it('removes null bytes in string property values (shared with gdEscape)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Label', property: 'text', value: 'before\0after' }],
      true,
    );
    expect(script).toContain('"beforeafter"');
  });
});

describe('Imp-1: scene_commit BLOCKED_PROPS (防绕过 edit_node S1 拦截)', () => {
  it('node_property 命中 script 返回明确警告,不生成赋值(防持久化绕过)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Player', property: 'script', value: 'res://evil.gd' }],
      true,
    );
    expect(script).toContain('"ok": false');
    expect(script).toContain('blocked');
    expect(script).not.toContain('.script = ');
  });

  it('node_property 命中 owner/name 同样拦截', () => {
    for (const blocked of ['owner', 'name'] as const) {
      const script = generateCommitScript(
        'res://scenes/Level.tscn',
        [{ op: 'node_property', path: 'Player', property: blocked, value: '/root/Main' }],
        true,
      );
      expect(script).toContain('"ok": false');
      expect(script).not.toContain(`.${blocked} = `);
    }
  });

  it('node_add properties 含 script 被过滤,正常属性保留', () => {
    // P2-3: type 必须用白名单内的类(Node3D);裸 Node 已被白名单拒(防 extends Node RCE)
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_add', type: 'Node3D', name: 'X', parent: '.', properties: { script: 'res://evil.gd', position: { x: 1, y: 0, z: 2 } } }],
      true,
    );
    expect(script).not.toContain('.script = ');
    expect(script).toContain('.position = Vector3(1, 0, 2)');
  });

  it('node_property 正常属性不受 BLOCKED_PROPS 影响', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'node_property', path: 'Player', property: 'speed', value: 200 }],
      true,
    );
    expect(script).toContain('.speed = 200');
    expect(script).not.toContain('is blocked');  // 无 BLOCKED_PROPS 警告(模板其他处的 "ok":false 与此无关)
  });
});

// ─── TileSet 碰撞配置 op（tileset_physics_layer_add / tile_collision_set，2026-08-19）───
// 依据可行性评估 D:\workspace\Obsidian\GodotMCP\系统文档\可行性评估-TileSet碰撞配置工具-2026-08-18.md §2.3
// 安全约束:两 op 会经 ResourceSaver 写 .tres → tileset_path 必须限定 res:// 项目内(deny-by-default)。
describe('TileSet collision ops: validateCommitOperations', () => {
  it('accepts tileset_physics_layer_add without optional fields', () => {
    expect(validateCommitOperations([
      { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' },
    ])).toBeNull();
  });

  it('accepts tileset_physics_layer_add with collision_layer/mask', () => {
    expect(validateCommitOperations([
      { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres', collision_layer: 1, collision_mask: 3 },
    ])).toBeNull();
  });

  it('rejects tileset_physics_layer_add with non-string tileset_path', () => {
    const err = validateCommitOperations([
      { op: 'tileset_physics_layer_add', tileset_path: 42 },
    ]);
    expect(err).toMatch(/tileset_path.*string/);
  });

  it('rejects tileset_physics_layer_add with non-numeric collision_layer', () => {
    const err = validateCommitOperations([
      { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres', collision_layer: '1' },
    ]);
    expect(err).toMatch(/collision_layer.*finite number/);
  });

  it('rejects tileset_physics_layer_add tileset_path without res:// prefix (写盘越界面)', () => {
    const err = validateCommitOperations([
      { op: 'tileset_physics_layer_add', tileset_path: 'C:/evil/outside.tres' },
    ]);
    expect(err).toMatch(/res:\/\//);
  });

  it('accepts tile_collision_set with shape=rect', () => {
    expect(validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
    ])).toBeNull();
  });

  it('accepts tile_collision_set with shape=polygon + points', () => {
    expect(validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }], one_way: true },
    ])).toBeNull();
  });

  it('rejects tile_collision_set with invalid shape', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'circle' },
    ]);
    expect(err).toMatch(/shape.*"rect" or "polygon"/);
  });

  it('rejects tile_collision_set polygon without points', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'polygon' },
    ]);
    expect(err).toMatch(/points.*non-empty array.*polygon/);
  });

  it('rejects tile_collision_set polygon with empty points', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'polygon', points: [] },
    ]);
    expect(err).toMatch(/points.*non-empty array.*polygon/);
  });

  it('rejects tile_collision_set rect with points (防歧义:rect 点集运行时生成)', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect', points: [{ x: 0, y: 0 }] },
    ]);
    expect(err).toMatch(/points.*omitted.*rect/);
  });

  it('rejects tile_collision_set points item with injected string coord (F-5 注入向量)', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'polygon', points: [{ x: 'OS.execute("sh",["-c","rm -rf ~"])', y: 0 }] },
    ]);
    expect(err).toMatch(/points\[0\].*\{x:number.*y:number\}/);
  });

  it('rejects tile_collision_set with non-numeric physics_layer', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 'zero', shape: 'rect' },
    ]);
    expect(err).toMatch(/physics_layer.*finite number/);
  });

  it('rejects tile_collision_set with non-boolean one_way', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect', one_way: 'yes' },
    ]);
    expect(err).toMatch(/one_way.*boolean/);
  });

  it('rejects tile_collision_set tileset_path with traversal segments (写盘越界面)', () => {
    const err = validateCommitOperations([
      { op: 'tile_collision_set', tileset_path: 'res://../outside.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
    ]);
    expect(err).toMatch(/traversal/);
  });
});

describe('TileSet collision ops: generateCommitScript', () => {
  it('generates add_physics_layer + layer/mask + layer_id for tileset_physics_layer_add', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres', collision_layer: 1, collision_mask: 3 }],
      true,
    );
    expect(script).toContain('add_physics_layer()');
    expect(script).toContain('set_physics_layer_collision_layer(');
    expect(script).toContain('set_physics_layer_collision_mask(');
    // 上报新 layer_id(添加前的 count 即新层索引)
    expect(script).toContain('"layer_id": lid1');
    // 资源不存在守卫
    expect(script).toContain('TileSet resource not found');
  });

  it('omits set_physics_layer_collision_* when layer/mask not given', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' }],
      true,
    );
    expect(script).toContain('add_physics_layer()');
    expect(script).not.toContain('set_physics_layer_collision_layer(');
    expect(script).not.toContain('set_physics_layer_collision_mask(');
  });

  it('generates full guard chain for tile_collision_set rect', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 2, y: 3 }, physics_layer: 0, shape: 'rect' }],
      true,
    );
    // 守卫链:atlas source 类型 + has_tile + physics_layer 越界
    expect(script).toContain('is TileSetAtlasSource');
    expect(script).toContain('.has_tile(Vector2i(2, 3)');
    expect(script).toContain('get_physics_layers_count()');
    expect(script).toContain('.get_tile_data(Vector2i(2, 3)');
    expect(script).toContain('.set_collision_polygons_count(0, 1)');
    // rect 模式四点来自运行时瓦片尺寸(等价编辑器按 F)
    expect(script).toContain('.get_tile_size()');
    expect(script).toContain('PackedVector2Array(');
  });

  it('generates literal PackedVector2Array for polygon shape', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 8, y: 12 }] }],
      true,
    );
    expect(script).toContain('PackedVector2Array([Vector2(0, 0), Vector2(16, 0), Vector2(8, 12)])');
    expect(script).not.toContain('.get_tile_size()');
  });

  it('generates one_way when requested', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect', one_way: true }],
      true,
    );
    expect(script).toContain('.set_collision_polygon_one_way(0, 0, true)');
  });

  it('saves modified TileSets via atomic _save_resource when save=true', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' }],
      true,
    );
    expect(script).toContain('func _save_resource(');
    expect(script).toContain('"res://assets/tiles.tres"');
  });

  it('deduplicates tileset save for multiple ops on the same resource', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' },
        { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
      ],
      true,
    );
    // save 数组字面量只含该路径一次(load 缓存同一实例,去重保存);未去重会含两次
    const saveArr = script.match(/for _p in \[[^\]]*\]:/g) ?? [];
    expect(saveArr).toHaveLength(1);
    expect(saveArr[0]).toBe('for _p in ["res://assets/tiles.tres"]:');
  });

  it('does not generate tileset save section when no tileset ops', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_set', node_path: 'G', coords: { x: 1, y: 1 }, source_id: 0, atlas: { x: 0, y: 0 } }],
      true,
    );
    expect(script).not.toContain('for _p in [');
    expect(script).not.toContain('func _save_resource(');
    // 场景保存仍走 tmp+rename(内联,不抽 helper——见实现说明)
    expect(script).toContain('ResourceSaver.save');
  });

  it('does not save TileSets when save=false', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' }],
      false,
    );
    expect(script).not.toContain('ResourceSaver.save');
    expect(script).toContain('"saved": false');
  });

  it('mixes tileset ops with node ops in sequence', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' },
        { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
        { op: 'node_property', path: 'Player', property: 'speed', value: 100 },
      ],
      true,
    );
    expect(script).toContain('var ts1 = load(');
    expect(script).toContain('var ts2 = load(');
    expect(script).toContain('.speed = 100');
  });
});

// ─── TileSet 层配置扩展批(physics set/remove + navigation + custom data + collision clear,2026-08-19)───
// 把 TileSet 三大层(physics/navigation/custom data)全部纳入可编程配置面;API 依据本地 godot-docs
// class_tileset.rst/class_tiledata.rst/class_navigationpolygon.rst 核对(navigation 是对象级
// set_navigation_polygon(layer, NavigationPolygon),与 collision 点集式不对称)。
describe('TileSet layer/data ops: validateCommitOperations', () => {
  it('accepts tileset_physics_layer_set with collision_layer only', () => {
    expect(validateCommitOperations([
      { op: 'tileset_physics_layer_set', tileset_path: 'res://assets/tiles.tres', layer: 0, collision_layer: 2 },
    ])).toBeNull();
  });

  it('rejects tileset_physics_layer_set with neither collision_layer nor collision_mask', () => {
    const err = validateCommitOperations([
      { op: 'tileset_physics_layer_set', tileset_path: 'res://assets/tiles.tres', layer: 0 },
    ]);
    expect(err).toMatch(/at least one/i);
  });

  it('rejects tileset_physics_layer_set with non-numeric layer', () => {
    const err = validateCommitOperations([
      { op: 'tileset_physics_layer_set', tileset_path: 'res://assets/tiles.tres', layer: 'zero', collision_layer: 1 },
    ]);
    expect(err).toMatch(/layer.*finite number/);
  });

  it('accepts tileset_physics_layer_remove', () => {
    expect(validateCommitOperations([
      { op: 'tileset_physics_layer_remove', tileset_path: 'res://assets/tiles.tres', layer: 0 },
    ])).toBeNull();
  });

  it('rejects tileset_physics_layer_remove tileset_path without res:// (写盘越界面)', () => {
    const err = validateCommitOperations([
      { op: 'tileset_physics_layer_remove', tileset_path: '../outside.tres', layer: 0 },
    ]);
    expect(err).toMatch(/res:\/\//);
  });

  it('accepts tileset_navigation_layer_add with optional layers', () => {
    expect(validateCommitOperations([
      { op: 'tileset_navigation_layer_add', tileset_path: 'res://assets/tiles.tres', layers: 2 },
    ])).toBeNull();
  });

  it('rejects tileset_navigation_layer_add with non-numeric layers', () => {
    const err = validateCommitOperations([
      { op: 'tileset_navigation_layer_add', tileset_path: 'res://assets/tiles.tres', layers: 'two' },
    ]);
    expect(err).toMatch(/layers.*finite number/);
  });

  it('accepts tile_navigation_set rect and polygon', () => {
    expect(validateCommitOperations([
      { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'rect' },
      { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 1, y: 0 }, navigation_layer: 0, shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 4, y: 8 }] },
    ])).toBeNull();
  });

  it('rejects tile_navigation_set with invalid shape / polygon without points', () => {
    expect(validateCommitOperations([
      { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'circle' },
    ])).toMatch(/shape.*"rect" or "polygon"/);
    expect(validateCommitOperations([
      { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'polygon' },
    ])).toMatch(/points.*non-empty array.*polygon/);
  });

  it('rejects tile_navigation_set points injection (F-5)', () => {
    const err = validateCommitOperations([
      { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'polygon', points: [{ x: 1, y: 'OS.execute("x")' }] },
    ]);
    expect(err).toMatch(/points\[0\].*\{x:number.*y:number\}/);
  });

  it('accepts tileset_custom_data_layer_add with name and type', () => {
    expect(validateCommitOperations([
      { op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres', name: 'damage', type: 'float' },
    ])).toBeNull();
  });

  it('rejects tileset_custom_data_layer_add missing name / bad type', () => {
    expect(validateCommitOperations([
      { op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres' },
    ])).toMatch(/name.*string/);
    expect(validateCommitOperations([
      { op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres', name: 'd', type: 'quaternion' },
    ])).toMatch(/type.*(int|float|bool|string|color|vector2)/i);
  });

  it('审查 N-1: type 传原型链属性名(constructor)不绕过白名单', () => {
    // `in` 查原型链时 constructor/toString 会通过白名单并生成非法 GD;hasOwnProperty 判定须拒绝
    const err = validateCommitOperations([
      { op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres', name: 'd', type: 'constructor' },
    ]);
    expect(err).toMatch(/type.*(int|float|bool|string|color|vector2)/i);
  });

  it('审查 N-2: 全部 9 资源 op 的生成物含 is TileSet 守卫(非 TileSet 资源结构化报错)', () => {
    const ops = [
      { op: 'tileset_physics_layer_add', tileset_path: 'res://assets/tiles.tres' },
      { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
      { op: 'tileset_physics_layer_set', tileset_path: 'res://assets/tiles.tres', layer: 0, collision_layer: 1 },
      { op: 'tileset_physics_layer_remove', tileset_path: 'res://assets/tiles.tres', layer: 0 },
      { op: 'tileset_navigation_layer_add', tileset_path: 'res://assets/tiles.tres' },
      { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'rect' },
      { op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres', name: 'x' },
      { op: 'tile_custom_data_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, layer: 0, value: 1 },
      { op: 'tile_collision_clear', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0 },
    ];
    const script = generateCommitScript('res://scenes/Level.tscn', ops as never, true, true);
    // 精确匹配 `is TileSet):`(不带右括号会误中 `is TileSetAtlasSource`)
    const guardCount = script.split('is TileSet):').length - 1;
    expect(guardCount).toBe(9);
    expect(script).toContain('"error": "Resource is not a TileSet"');
  });

  it('accepts tile_custom_data_set and rejects missing value', () => {
    expect(validateCommitOperations([
      { op: 'tile_custom_data_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, layer: 0, value: 12.5 },
    ])).toBeNull();
    expect(validateCommitOperations([
      { op: 'tile_custom_data_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, layer: 0 },
    ])).toMatch(/value.*required/);
  });

  it('accepts tile_collision_clear', () => {
    expect(validateCommitOperations([
      { op: 'tile_collision_clear', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0 },
    ])).toBeNull();
  });
});

describe('TileSet layer/data ops: generateCommitScript', () => {
  it('tileset_physics_layer_set 生成位掩码修改 + 越界守卫(仅提供的字段)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_physics_layer_set', tileset_path: 'res://assets/tiles.tres', layer: 0, collision_mask: 5 }],
      true,
    );
    expect(script).toContain('.set_physics_layer_collision_mask(0, 5)');
    expect(script).not.toContain('.set_physics_layer_collision_layer(');
    expect(script).toContain('get_physics_layers_count()');
    expect(script).toContain('physics_layer 0 out of range');
  });

  it('tileset_physics_layer_remove 生成 remove + 守卫', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_physics_layer_remove', tileset_path: 'res://assets/tiles.tres', layer: 1 }],
      true,
    );
    expect(script).toContain('.remove_physics_layer(1)');
    expect(script).toContain('get_physics_layers_count()');
  });

  it('tileset_navigation_layer_add 生成 add_navigation_layer + 可选 layers + layer_id', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_navigation_layer_add', tileset_path: 'res://assets/tiles.tres', layers: 2 }],
      true,
    );
    expect(script).toContain('add_navigation_layer()');
    expect(script).toContain('.set_navigation_layer_layers(lid1, 2)');
    expect(script).toContain('"layer_id": lid1');
  });

  it('tile_navigation_set rect 生成 NavigationPolygon 构造 + 越界守卫', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'rect' }],
      true,
    );
    expect(script).toContain('NavigationPolygon.new()');
    expect(script).toContain('.vertices = PackedVector2Array(');
    expect(script).toContain('.add_polygon(PackedInt32Array(');
    expect(script).toContain('.set_navigation_polygon(0, np1)');
    expect(script).toContain('get_navigation_layers_count()');
    expect(script).toContain('get_tile_size()');
  });

  it('tile_navigation_set polygon 生成字面点集', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'polygon', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
      true,
    );
    expect(script).toContain('PackedVector2Array([Vector2(1, 2), Vector2(3, 4)])');
    expect(script).not.toContain('.get_tile_size()');
  });

  it('tileset_custom_data_layer_add 生成 name + type 映射', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres', name: 'damage', type: 'float' }],
      true,
    );
    expect(script).toContain('add_custom_data_layer()');
    expect(script).toContain('.set_custom_data_layer_name(lid1, "damage")');
    expect(script).toContain('.set_custom_data_layer_type(lid1, TYPE_FLOAT)');
    expect(script).toContain('"layer_id": lid1');
  });

  it('tileset_custom_data_layer_add 无 type 不生成 set_custom_data_layer_type', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/tiles.tres', name: 'flag' }],
      true,
    );
    expect(script).toContain('.set_custom_data_layer_name(lid1, "flag")');
    expect(script).not.toContain('.set_custom_data_layer_type(');
  });

  it('tile_custom_data_set 生成 set_custom_data_by_layer_id + 守卫', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_custom_data_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, layer: 0, value: 12.5 }],
      true,
    );
    expect(script).toContain('.set_custom_data_by_layer_id(0, 12.5)');
    expect(script).toContain('get_custom_data_layers_count()');
    expect(script).toContain('.has_tile(Vector2i(0, 0))');
  });

  it('tile_collision_clear 生成 set_collision_polygons_count(x, 0)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [{ op: 'tile_collision_clear', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0 }],
      true,
    );
    expect(script).toContain('.set_collision_polygons_count(0, 0)');
    expect(script).toContain('get_physics_layers_count()');
  });

  it('新 layer/data op 同样进 tileset 保存链(collectTilesetPaths 扩展)', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tileset_navigation_layer_add', tileset_path: 'res://assets/nav.tres' },
        { op: 'tileset_custom_data_layer_add', tileset_path: 'res://assets/data.tres', name: 'x' },
        { op: 'tileset_physics_layer_remove', tileset_path: 'res://assets/nav.tres', layer: 0 },
      ],
      true,
    );
    const saveArr = script.match(/for _p in \[[^\]]*\]:/g) ?? [];
    expect(saveArr).toHaveLength(1);
    expect(saveArr[0]).toContain('res://assets/nav.tres');
    expect(saveArr[0]).toContain('res://assets/data.tres');
  });

  it('tile_navigation_set 与 tile_collision_set 混用各自守卫独立', () => {
    const script = generateCommitScript(
      'res://scenes/Level.tscn',
      [
        { op: 'tile_collision_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, physics_layer: 0, shape: 'rect' },
        { op: 'tile_navigation_set', tileset_path: 'res://assets/tiles.tres', source_id: 0, atlas: { x: 0, y: 0 }, navigation_layer: 0, shape: 'rect' },
      ],
      true,
    );
    expect(script).toContain('ts1.get_physics_layers_count()');
    expect(script).toContain('ts2.get_navigation_layers_count()');
  });
});
