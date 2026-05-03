import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TILEMAP_ERROR_CODES,
  validateCoords,
  validateRect2i,
  genTilemapReadScript, genTilemapSetCellScript, genTilemapEraseCellScript,
  genTilemapFillRectScript, genTilemapClearScript, genTilemapCopyScript,
  genTilemapPasteScript, genTilemapSetTransformScript,
} from '../build/tools/tilemap-ops.js';

describe('TILEMAP_ERROR_CODES', () => {
  it('has TILEMAP_NOT_FOUND', () => { assert.ok('TILEMAP_NOT_FOUND' in TILEMAP_ERROR_CODES); });
  it('has INVALID_TILE_COORDS', () => { assert.ok('INVALID_TILE_COORDS' in TILEMAP_ERROR_CODES); });
  it('has INVALID_REGION', () => { assert.ok('INVALID_REGION' in TILEMAP_ERROR_CODES); });
  it('has TILE_SOURCE_NOT_FOUND', () => { assert.ok('TILE_SOURCE_NOT_FOUND' in TILEMAP_ERROR_CODES); });
});

describe('validateCoords', () => {
  it('accepts valid integer coords', () => {
    assert.deepStrictEqual(validateCoords({ x: 1, y: 2 }), { x: 1, y: 2 });
  });
  it('accepts zero coords', () => {
    assert.deepStrictEqual(validateCoords({ x: 0, y: 0 }), { x: 0, y: 0 });
  });
  it('accepts negative coords', () => {
    assert.deepStrictEqual(validateCoords({ x: -1, y: -5 }), { x: -1, y: -5 });
  });
  it('rejects float coords', () => {
    assert.throws(() => validateCoords({ x: 1.5, y: 2 }), { message: /integer/ });
  });
  it('rejects missing y', () => {
    assert.throws(() => validateCoords({ x: 1 }), { message: /integer/ });
  });
  it('rejects string values', () => {
    assert.throws(() => validateCoords({ x: '1', y: 2 }), { message: /integer/ });
  });
  it('rejects null', () => {
    assert.throws(() => validateCoords(null), { message: /object/ });
  });
});

describe('validateRect2i', () => {
  it('accepts valid region', () => {
    assert.deepStrictEqual(validateRect2i({ x: 0, y: 0, w: 10, h: 5 }), { x: 0, y: 0, w: 10, h: 5 });
  });
  it('rejects w=0', () => {
    assert.throws(() => validateRect2i({ x: 0, y: 0, w: 0, h: 5 }), { message: /must be > 0/ });
  });
  it('rejects negative w', () => {
    assert.throws(() => validateRect2i({ x: 0, y: 0, w: -1, h: 5 }), { message: /must be > 0/ });
  });
  it('rejects float w', () => {
    assert.throws(() => validateRect2i({ x: 0, y: 0, w: 1.5, h: 5 }), { message: /integer/ });
  });
  it('rejects null', () => {
    assert.throws(() => validateRect2i(null), { message: /object/ });
  });
});

describe('genTilemapReadScript', () => {
  it('contains TileMap and TileMapLayer branches', () => {
    const script = genTilemapReadScript('/root/Map', { x: 0, y: 0, w: 5, h: 5 }, 0);
    assert.ok(script.includes('TileMap'));
    assert.ok(script.includes('TileMapLayer'));
    assert.ok(script.includes('get_cell_source_id'));
  });
  it('works without region', () => {
    const script = genTilemapReadScript('/root/Map');
    assert.ok(script.includes('get_used_cells'));
  });
});

describe('genTilemapSetCellScript', () => {
  it('contains set_cell with coords and source_id', () => {
    const script = genTilemapSetCellScript('/root/Map', { x: 3, y: 4 }, 1, { x: 0, y: 0 }, 0, 0);
    assert.ok(script.includes('set_cell'));
    assert.ok(script.includes('Vector2i(3, 4)'));
    assert.ok(script.includes('TileMap'));
    assert.ok(script.includes('TileMapLayer'));
  });
});

describe('genTilemapEraseCellScript', () => {
  it('contains erase_cell', () => {
    const script = genTilemapEraseCellScript('/root/Map', { x: 1, y: 2 }, 0);
    assert.ok(script.includes('erase_cell'));
    assert.ok(script.includes('Vector2i(1, 2)'));
  });
});

describe('genTilemapFillRectScript', () => {
  it('contains fill rect loop', () => {
    const script = genTilemapFillRectScript('/root/Map', { x: 0, y: 0, w: 3, h: 2 }, 1, { x: 0, y: 0 }, 0, 0);
    assert.ok(script.includes('range(3)'));
    assert.ok(script.includes('range(2)'));
    assert.ok(script.includes('set_cell'));
  });
});

describe('genTilemapClearScript', () => {
  it('contains clear', () => {
    const script = genTilemapClearScript('/root/Map', 0);
    assert.ok(script.includes('.clear()'));
    assert.ok(script.includes('TileMap'));
    assert.ok(script.includes('TileMapLayer'));
  });
});

describe('genTilemapCopyScript', () => {
  it('contains cell reading', () => {
    const script = genTilemapCopyScript('/root/Map', { x: 0, y: 0, w: 2, h: 2 }, 0);
    assert.ok(script.includes('get_cell_source_id'));
    assert.ok(script.includes('cells'));
  });
});

describe('genTilemapPasteScript', () => {
  it('contains set_cell with target offset', () => {
    const pattern = { cells: [{ coords: [0, 0], source_id: 1, atlas_coords: [0, 0], alternative_tile: 0 }], size: { w: 1, h: 1 } };
    const script = genTilemapPasteScript('/root/Map', { x: 5, y: 5 }, pattern, 0);
    assert.ok(script.includes('set_cell'));
  });
});

describe('genTilemapSetTransformScript', () => {
  it('contains flip_h', () => {
    const script = genTilemapSetTransformScript('/root/Map', { x: 1, y: 1 }, true, false, false, 0);
    assert.ok(script.includes('flip_h'));
    assert.ok(script.includes('set_cell'));
  });
});
