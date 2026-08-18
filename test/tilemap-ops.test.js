import { expect } from 'vitest';
import {
  TILEMAP_ERROR_CODES,
  validateCoords,
  validateRect2i,
  genTilemapReadScript, genTilemapSetCellScript, genTilemapEraseCellScript,
  genTilemapFillRectScript, genTilemapClearScript, genTilemapCopyScript,
  genTilemapPasteScript, genTilemapSetTransformScript,
} from '../src/tools/tilemap-ops.js';

describe('TILEMAP_ERROR_CODES', () => {
  it('has TILEMAP_NOT_FOUND', () => { expect('TILEMAP_NOT_FOUND' in TILEMAP_ERROR_CODES).toBeTruthy(); });
  it('has INVALID_TILE_COORDS', () => { expect('INVALID_TILE_COORDS' in TILEMAP_ERROR_CODES).toBeTruthy(); });
  it('has INVALID_REGION', () => { expect('INVALID_REGION' in TILEMAP_ERROR_CODES).toBeTruthy(); });
  it('has SCRIPT_EXEC_FAILED', () => { expect('SCRIPT_EXEC_FAILED' in TILEMAP_ERROR_CODES).toBeTruthy(); });
});

describe('validateCoords', () => {
  it('accepts valid integer coords', () => {
    expect(validateCoords({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
  it('accepts zero coords', () => {
    expect(validateCoords({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  it('accepts negative coords', () => {
    expect(validateCoords({ x: -1, y: -5 })).toEqual({ x: -1, y: -5 });
  });
  it('rejects float coords', () => {
    expect(() => validateCoords({ x: 1.5, y: 2 })).toThrow(/integer/);
  });
  it('rejects missing y', () => {
    expect(() => validateCoords({ x: 1 })).toThrow(/integer/);
  });
  it('rejects string values', () => {
    expect(() => validateCoords({ x: '1', y: 2 })).toThrow(/integer/);
  });
  it('rejects null', () => {
    expect(() => validateCoords(null)).toThrow(/object/);
  });
});

describe('validateRect2i', () => {
  it('accepts valid region', () => {
    expect(validateRect2i({ x: 0, y: 0, w: 10, h: 5 })).toEqual({ x: 0, y: 0, w: 10, h: 5 });
  });
  it('rejects w=0', () => {
    expect(() => validateRect2i({ x: 0, y: 0, w: 0, h: 5 })).toThrow(/must be > 0/);
  });
  it('rejects negative w', () => {
    expect(() => validateRect2i({ x: 0, y: 0, w: -1, h: 5 })).toThrow(/must be > 0/);
  });
  it('rejects float w', () => {
    expect(() => validateRect2i({ x: 0, y: 0, w: 1.5, h: 5 })).toThrow(/integer/);
  });
  it('rejects null', () => {
    expect(() => validateRect2i(null)).toThrow(/object/);
  });
});

describe('genTilemapReadScript', () => {
  it('contains TileMap and TileMapLayer branches', () => {
    const script = genTilemapReadScript('/root/Map', { x: 0, y: 0, w: 5, h: 5 }, 0);
    expect(script).toContain('TileMap');
    expect(script).toContain('TileMapLayer');
    expect(script).toContain('get_cell_source_id');
  });
  it('works without region', () => {
    const script = genTilemapReadScript('/root/Map');
    expect(script).toContain('get_used_cells');
  });
});

describe('genTilemapSetCellScript', () => {
  it('contains set_cell with coords and source_id', () => {
    const script = genTilemapSetCellScript('/root/Map', { x: 3, y: 4 }, 1, { x: 0, y: 0 }, 0, 0);
    expect(script).toContain('set_cell');
    expect(script).toContain('Vector2i(3, 4)');
    expect(script).toContain('TileMap');
    expect(script).toContain('TileMapLayer');
  });
});

describe('genTilemapEraseCellScript', () => {
  it('contains erase_cell', () => {
    const script = genTilemapEraseCellScript('/root/Map', { x: 1, y: 2 }, 0);
    expect(script).toContain('erase_cell');
    expect(script).toContain('Vector2i(1, 2)');
  });
});

describe('genTilemapFillRectScript', () => {
  it('contains fill rect loop', () => {
    const script = genTilemapFillRectScript('/root/Map', { x: 0, y: 0, w: 3, h: 2 }, 1, { x: 0, y: 0 }, 0, 0);
    expect(script).toContain('range(3)');
    expect(script).toContain('range(2)');
    expect(script).toContain('set_cell');
  });
});

describe('genTilemapClearScript', () => {
  it('contains clear', () => {
    const script = genTilemapClearScript('/root/Map', 0);
    expect(script).toContain('.clear()');
    expect(script).toContain('TileMap');
    expect(script).toContain('TileMapLayer');
  });
});

describe('genTilemapCopyScript', () => {
  it('contains cell reading', () => {
    const script = genTilemapCopyScript('/root/Map', { x: 0, y: 0, w: 2, h: 2 }, 0);
    expect(script).toContain('get_cell_source_id');
    expect(script).toContain('cells');
  });
});

describe('genTilemapPasteScript', () => {
  it('contains set_cell with target offset', () => {
    const pattern = { cells: [{ coords: [0, 0], source_id: 1, atlas_coords: [0, 0], alternative_tile: 0 }], size: { w: 1, h: 1 } };
    const script = genTilemapPasteScript('/root/Map', { x: 5, y: 5 }, pattern, 0);
    expect(script).toContain('set_cell');
  });
  // T2c (debt-cleanup-20260818): patternJson 消费点是 JSON.parse_string("...") 的
  // 字面量实参(纯值,不参与 % 格式化)。handler 只校验 cells 是数组,pattern 附加字段
  // 原样透传 JSON.stringify——含 % 的字符串值被 gdEscape 双写后 round-trip 破坏
  // (parse 出 "50%%" ≠ 用户传入 "50%")。双断言锁 % 原样。
  it('T2c: pattern JSON 含 % 不双写(JSON.parse_string 字面量 round-trip)', () => {
    const pattern = { cells: [{ coords: [0, 0], source_id: 1, atlas_coords: [0, 0], alternative_tile: 0 }], size: { w: 1, h: 1 }, note: '50%' };
    const script = genTilemapPasteScript('/root/Map', { x: 5, y: 5 }, pattern, 0);
    // JSON 字面量内 " 被(无条件)转义为 \",% 需原样不被双写
    expect(script).toContain('\\"note\\":\\"50%\\"');
    expect(script).not.toContain('50%%');
  });
});

describe('genTilemapSetTransformScript', () => {
  it('contains flip_h', () => {
    const script = genTilemapSetTransformScript('/root/Map', { x: 1, y: 1 }, true, false, false, 0);
    expect(script).toContain('flip_h');
    expect(script).toContain('set_cell');
  });
  it('handles combined transforms (flip_h + flip_v + transpose)', () => {
    const script = genTilemapSetTransformScript('/root/Map', { x: 2, y: 3 }, true, true, true, 0);
    expect(script).toContain('new_alt = new_alt | 1');
    expect(script).toContain('new_alt = new_alt | 2');
    expect(script).toContain('new_alt = new_alt | 4');
  });
  it('uses get_class for both node types', () => {
    const script = genTilemapSetTransformScript('/root/Map', { x: 0, y: 0 }, false, false, false, 0);
    expect(script).toContain('node.get_class() == "TileMap"');
    expect(script).toContain('node.get_class() == "TileMapLayer"');
  });
});

describe('genTilemapClearScript clearAll', () => {
  it('uses clear() when clearAll is true', () => {
    const script = genTilemapClearScript('/root/Map', undefined, true);
    expect(script).toContain('node.clear()');
    expect(script.includes('clear_layer')).toBeFalsy();
  });
  it('uses clear_layer when clearAll is false', () => {
    const script = genTilemapClearScript('/root/Map', 2, false);
    expect(script).toContain('clear_layer(2)');
  });
});

describe('genTilemapReadScript empty region', () => {
  it('reads used cells without region', () => {
    const script = genTilemapReadScript('/root/Map');
    expect(script).toContain('get_used_cells');
    expect(script.includes('range(')).toBeFalsy();
  });
  it('uses get_class for node type checks', () => {
    const script = genTilemapReadScript('/root/Map', { x: 0, y: 0, w: 3, h: 3 }, 0);
    expect(script).toContain('node.get_class() == "TileMap"');
    expect(script).toContain('node.get_class() == "TileMapLayer"');
  });
});

describe('scene_path targeting', () => {
  const SCENE = '/proj/scenes/levels/TrackA.tscn';
  // The shared header *defines* both loaders, so assertions must target the call
  // inside _initialize, not the bare function name.
  const MAIN_CALL = '\n\t_mcp_load_main_scene()\n';
  const sceneCall = (p) => `if not _mcp_load_scene("${p}"):`;

  it('defaults to the main scene when scenePath is omitted', () => {
    const script = genTilemapReadScript('root/Ground');
    expect(script).toContain(MAIN_CALL);
    expect(script).toContain('var node = _mcp_get_node("root/Ground")');
    expect(script).not.toContain(sceneCall(SCENE));
  });

  it('loads the named scene and resolves the node inside it', () => {
    const script = genTilemapReadScript('root/Ground', undefined, undefined, SCENE);
    expect(script).toContain(sceneCall(SCENE));
    expect(script).toContain('var node = _mcp_get_scene_node("root/Ground")');
    expect(script).not.toContain(MAIN_CALL);
  });

  it('keeps the node null-check on both paths', () => {
    for (const script of [
      genTilemapReadScript('root/Ground'),
      genTilemapReadScript('root/Ground', undefined, undefined, SCENE),
    ]) {
      expect(script).toContain('Node not found: root/Ground');
    }
  });

  it('escapes quotes in scenePath', () => {
    const script = genTilemapReadScript('root/Ground', undefined, undefined, 'a"b.tscn');
    expect(script).toContain('_mcp_load_scene("a\\"b.tscn")');
  });

  it('is honoured by every generator', () => {
    const pattern = { cells: [{ coords: [0, 0], source_id: 1, atlas_coords: [0, 0], alternative_tile: 0 }], size: { w: 1, h: 1 } };
    const scripts = [
      genTilemapReadScript('root/M', undefined, 0, SCENE),
      genTilemapSetCellScript('root/M', { x: 1, y: 1 }, 1, { x: 0, y: 0 }, 0, 0, SCENE),
      genTilemapEraseCellScript('root/M', { x: 1, y: 1 }, 0, SCENE),
      genTilemapFillRectScript('root/M', { x: 0, y: 0, w: 2, h: 2 }, 1, { x: 0, y: 0 }, 0, 0, SCENE),
      genTilemapClearScript('root/M', 0, false, SCENE),
      genTilemapCopyScript('root/M', { x: 0, y: 0, w: 2, h: 2 }, 0, SCENE),
      genTilemapPasteScript('root/M', { x: 5, y: 5 }, pattern, 0, SCENE),
      genTilemapSetTransformScript('root/M', { x: 1, y: 1 }, true, false, false, 0, SCENE),
    ];
    for (const script of scripts) {
      expect(script).toContain(sceneCall(SCENE));
      expect(script).toContain('var node = _mcp_get_scene_node("root/M")');
      expect(script).not.toContain(MAIN_CALL);
    }
  });
});

// ─── handler 级 scene_path 白名单负向 + 解析透传(PR#36 集成补)────────────────
// 模式沿 test/ui-import-prototype.test.ts 逃逸用例:isolatePathEnv 白名单隔离 +
// mock executeGdscript(tilemap 走 executeGdscript 非 trusted)+ 不触达断言。
import { vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatePathEnv } from './helpers/path-isolation.js';
import { createToolContext } from './helpers/tool-context.js';
import { mockSuccessResult } from './helpers/mock-results.js';
import { handleTool as tilemapHandleTool } from '../src/tools/tilemap-ops.js';

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: execMock,
  executeGdscriptTrusted: vi.fn(),
}));

describe('scene_path handler 白名单与解析', () => {
  let tmpProj;
  let restore;
  beforeEach(() => {
    vi.clearAllMocks();
    tmpProj = mkdtempSync(join(tmpdir(), 'tilemap-scene-path-'));
    writeFileSync(join(tmpProj, 'project.godot'), '[application]\nname="Test"\n');
    restore = isolatePathEnv({ allowed: [tmpProj] });
  });
  afterEach(() => {
    restore?.();
    rmSync(tmpProj, { recursive: true, force: true });
  });
  const ctx = () => {
    const c = createToolContext(tmpProj);
    c.findGodot = async () => '/fake/godot';
    return c;
  };

  it('../ 逃逸 → INVALID_PARAMS,不触达 executor', async () => {
    const result = await tilemapHandleTool('tilemap', {
      action: 'tilemap_read', project_path: tmpProj, node_path: 'root/Ground',
      scene_path: '../outside/level.tscn',
    }, ctx());
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toMatch(/traversal|越权|非法/i);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('白名单外绝对路径 → INVALID_PARAMS,不触达 executor', async () => {
    const result = await tilemapHandleTool('tilemap', {
      action: 'tilemap_read', project_path: tmpProj, node_path: 'root/Ground',
      scene_path: join(tmpdir(), 'outside-evil.tscn'),
    }, ctx());
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('INVALID_PARAMS');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('合法 scene_path → resolveWithinRoot 解析后的绝对路径注入生成脚本', async () => {
    execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: [{ key: 'read', value: '{}' }] }));
    const result = await tilemapHandleTool('tilemap', {
      action: 'tilemap_read', project_path: tmpProj, node_path: 'root/Ground',
      scene_path: 'levels/TrackA.tscn',
    }, ctx());
    expect(result.isError).toBeFalsy();
    const code = execMock.mock.calls[0][0].code;
    // 分隔符无关断言:resolveWithinRoot 产物为绝对路径(Win 反斜杠经转义),匹配文件名即可
    expect(code).toMatch(/_mcp_load_scene\(".*TrackA\.tscn"\)/);
    expect(code).toContain('_mcp_get_scene_node("/root/Ground")');
    expect(code).not.toContain('\n\t_mcp_load_main_scene()\n');  // 调用形态;SCENE_TREE_HEADER 内含函数定义,裸名会误匹配
  });
});
